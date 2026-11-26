# ADR-001: Adoção Progressiva de Row-Level Security (RLS) no PostgreSQL

- **Status:** Aprovado para Piloto Técnico Isolado (Onda 1 delimitada após Fase 01)
- **Data:** 2026-11-23
- **Referência base do código:** `2810c3cc5cf58d1e1b27dd466e939794b6f400ef` (`2810c3c`) + endurecimento Fase 01
- **Escopo deste documento:** Decisão arquitetural, mapeamento de consultas pré-escola e escopos especiais, especificação da Onda 1 (`ClassGroup` -> `Student` -> `MessageTemplate` -> `MessageLog`), critérios de expansão e plano de reversão seguro.

---

## 1. Contexto e Motivação

Na Fase 01, a plataforma corrigiu na camada de aplicação o isolamento de contexto (`getAuthorizedCurrentSchool` / `requireAuthorizedSchool`), RBAC por unidade, revogação imediata no banco, remoção do fallback implícito para a primeira escola ativa, sanitização de PIN e proteção do histórico PWA/IA.

Entretanto, confiar exclusivamente em filtros `WHERE schoolId = ...` aplicados pelo código TypeScript deixa a plataforma vulnerável caso um novo Route Handler, Server Component, consulta Prisma ou serviço em background omita o predicado de tenant.

Esta decisão estabelece **Row-Level Security (RLS) no PostgreSQL como camada adicional de defesa em profundidade (*defense-in-depth*)**, adotada de forma **progressiva por ondas**, sem quebrar fluxos globais de autenticação, redes municipais (SEMEC), webhooks passivos ou portais públicos por token.

---

## 2. Mapeamento de Consultas Pré-Escola e Escopos Especiais

Antes de habilitar RLS nas tabelas de negócio, classificamos todas as consultas que **não podem depender de um único `app.current_school_id` de sessão** ou que executam antes de a escola ser resolvida:

### 2.1 Tabelas Pré-Escola e de Infraestrutura Global (Fora de RLS Single-School)
Estas tabelas são consultadas durante login, troca de escola, verificação de revogação, resolução de redes, rate limiting e trilha de auditoria raiz:

| Modelo Prisma | Motivo para permanecer fora de RLS single-school na fase inicial | Controles aplicáveis |
|---|---|---|
| `User` | Autenticação (`auth.ts`), validação de revogação (`serverAuthContext.ts`), PIN do servidor (`signingPin.ts`) | Nunca expor `signingPinHash`/`pin*`; filtros explícitos por `userId`/`schoolId` em `/api/users` |
| `UserSchool` | Lista vínculos ativos do usuário antes e durante seleção da escola | Filtrado por `userId` na sessão e por `schoolId` sob `requireSchoolAdmin(targetSchoolId)` |
| `UserNetwork` | Determina vínculos de Secretaria (`GESTAO_SECRETARIA`) independentes de `UserSchool` | Filtrado por `userId` autenticado |
| `School` | Catálogo multi-escola de login, `switch-school`, portais públicos (`/api/schools/[id]/logo`) e `SUPERADMIN` | Nunca expor `syncTokenHash`; bloqueio de proteção ao INEP `41042730` |
| `EducationNetwork` | Gestão municipal e herança de edição (`PILOTO_INTEGRADA` / `INSTITUCIONAL_ESSENCIAL`) | Restrito a `SUPERADMIN` e `GESTAO_SECRETARIA` autorizada |
| `RateLimitBucket` | Controle global/IP/usuário contra força bruta (`rateLimit.ts`) | Sem dados pessoais de estudantes |
| `AuditLog` | Inclui eventos sem escola fixa (`LOGIN_DENIED`, `SUPERADMIN` global, falhas de PIN) | Políticas futuras multi-escopo (`schoolId = current_school_id` OR papel auditor) |

### 2.2 Escopos Especiais e Estratégia de Contexto

1. **Gestão da Secretaria Municipal (`GESTAO_SECRETARIA`):**
   - Opera sobre um **conjunto de escolas** de uma rede municipal (`networkId` / `city`), não sobre um único `schoolId`.
   - Solução progressiva: introdução futura de variável de sessão complementar (`app.current_role` / `app.allowed_school_ids` validados em tabela ou CSV assinado na transação, ou consultas agregadoras via *view*/função controlada após autorização de rede). Nunca usar `BYPASSRLS`.
2. **Filas em Background e Serviços de Mensageria (`src/services/messaging/*`):**
   - Cada item enfileirado (`job`) carrega explicitamente `schoolId` validado no momento do enfileiramento.
   - O worker executa cada tarefa dentro de `withTenantContext(prisma, job.schoolId, tx => ...)` por transação.
3. **Cron Jobs (`GET/POST /api/cron/weekly-digest`):**
   - Autenticado via `CRON_SECRET`. Quando `schoolId` explícito é informado, abre `withTenantContext` para essa unidade. Sem parâmetro, itera explicitamente `School.findMany({ where: { active: true } })` e executa `compileWeeklyDigest` por unidade dentro de `withTenantContext` individual.
4. **Webhooks Passivos (`POST /api/webhooks/whatsapp`):**
   - Nunca usam fallback de primeira escola. Identificam primeiro o registro/tenant sem ambiguidade (`distinctSchoolIds.length === 1` ou identificador explícito de instância/escola; descartam colisões passivas), passando então a processar dentro do contexto do tenant resolvido.
5. **Portais Públicos e por Token (`/validar/ata/[code]`, `/assinar/ata/[token]`, `/conselho-classe/professor/[token]`, `/conselho-classe/pre-conselho/[token]`):**
   - Chegam **sem sessão escolar prévia**, apenas com código verificador ou token aleatório.
   - A resolução inicial do token deve ocorrer via função `SECURITY DEFINER` dedicada exclusivamente à consulta mínima pelo hash/token (retornando `id` e `schoolId` se ativo/não expirado), seguida de `withTenantContext(prisma, resolved.schoolId, ...)` para ler/gravar os registros autorizados daquela ata/conselho.

---

## 3. Decisões Técnicas da Onda 1 (Fluxo Piloto Delimitado)

### 3.1 Fluxo Escolhido: `ClassGroup` -> `Student` -> `MessageTemplate` -> `MessageLog`
Escolhido por representar a espinha dorsal da Busca Ativa com:
- Entidade pai (`ClassGroup`),
- Entidade principal de dados pessoais de menores (`Student`, referenciando `ClassGroup`),
- Entidade configurável com referência opcional/anulável (`MessageTemplate`),
- Registro transacional de comunicação (`MessageLog`, referenciando obrigatoriamente `Student` e opcionalmente `MessageTemplate`).

### 3.2 Propagação de Contexto Compatível com Neon + PgBouncer Transaction Pooling
O Neon utiliza **PgBouncer em *transaction pooling mode*** em produção. Em *transaction pooling*:
- Variáveis de sessão globais (`SET app.current_school_id = ...`) vazam entre transações e requisições de clientes distintos que reutilizem a mesma conexão física no pool.
- Portanto, o helper canônico `src/lib/rlsTenantContext.ts` (`withTenantContext`) **DEVE** abrir uma transação Prisma (`prisma.$transaction`) e executar na primeira instrução da mesma transação:

```sql
SELECT set_config('app.current_school_id', $1, true);
```

O terceiro argumento `true` equivale a **`SET LOCAL`**: o valor existe **exclusivamente durante a transação corrente** e é descartado no `COMMIT` ou `ROLLBACK`, antes de a conexão retornar ao pool.

**Política fail-closed nas tabelas:**
Todas as políticas de `ClassGroup`, `Student`, `MessageTemplate` e `MessageLog` exigem:

```sql
NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
```

Tanto em `USING` quanto em `WITH CHECK`. Se a consulta rodar fora de `withTenantContext` (contexto ausente ou vazio), `SELECT` retorna `0` linhas e `INSERT`/`UPDATE`/`DELETE` falham com `SQLSTATE 42501`.

### 3.3 Separação de Papéis no PostgreSQL (`app_migrator` vs `app_runtime`)
- **`app_migrator`** (role proprietário de schema/DDL): usado apenas em janelas de migração (`prisma migrate deploy`), dono das tabelas.
- **`app_runtime`** (role de execução da aplicação Next.js/API): criado estritamente com `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`.
- Todas as tabelas da onda recebem `ENABLE ROW LEVEL SECURITY` **e** `FORCE ROW LEVEL SECURITY` (impedindo bypass acidental mesmo pelo owner quando aplicável).

### 3.4 Chaves Estrangeiras Compostas e `ON DELETE SET NULL ("templateId")`
Para impedir referências cruzadas mesmo em caso de bug no payload:
- Adiciona-se restrição `UNIQUE ("schoolId", "id")` em `ClassGroup`, `Student` e `MessageTemplate`.
- Em `Student`, adiciona-se FK composta `("schoolId", "classGroupId") -> "ClassGroup" ("schoolId", "id") ON DELETE RESTRICT`.
- Para `MessageLog`, no schema atual do Prisma (`prisma/schema.prisma`), `MessageLog` ainda não possui coluna `schoolId` materializada (a escola é derivada de `Student.schoolId`). Na migração futura da Onda 1 real:
  1. Adiciona-se `"schoolId"` em `MessageLog` com backfill verificado a partir de `"Student"."schoolId"` (`UPDATE ... FROM "Student"`) + `NOT NULL` + índice `("schoolId", "sentAt" DESC)`.
  2. Adiciona-se FK composta `("schoolId", "studentId") -> "Student" ("schoolId", "id") ON DELETE RESTRICT`.
  3. Adiciona-se FK composta opcional para modelo:
     ```sql
     FOREIGN KEY ("schoolId", "templateId")
       REFERENCES "MessageTemplate" ("schoolId", "id")
       ON DELETE SET NULL ("templateId")
     ```
     A sintaxe de **lista explícita de colunas no `ON DELETE SET NULL ("templateId")`** (suportada nativamente pelo PostgreSQL 15+, incluindo PostgreSQL 16 em uso no Neon e no piloto) garante que, ao excluir um `MessageTemplate` da escola, **apenas `"templateId"` seja anulado**, preservando `"schoolId"` intacto (`NOT NULL`) sem violar integridade referencial nem RLS.

### 3.5 Nota sobre o Piloto Técnico Isolado (`lab/rls-pilot/`)
O piloto técnico foi mantido **fora de `prisma/migrations/` e sem alterar o `prisma/schema.prisma` ou `.env` local**.
Em `lab/rls-pilot/pilot_rls_setup.sql`, além de criar `app_runtime` (`NOBYPASSRLS`), FKs compostas e políticas RLS, a coluna `"MessageLog"."schoolId"` recebe `NOT NULL` e `DEFAULT NULLIF(current_setting('app.current_school_id', true), '')`, garantindo aderência integral ao contrato estrutural da Onda 1 antes de evoluir `prisma/schema.prisma`.

**Limitação explícita do ambiente local:** O piloto local validou PostgreSQL 16 real em container Docker efêmero (`postgres:16-alpine`) com `connection_limit=1` e verificação direta de `pg_backend_pid()`, comprovando reutilização da mesma conexão entre transações sequenciais (`school-alpha` -> `school-beta` -> sem contexto) sem vazamento de `app.current_school_id`. Como não há container PgBouncer separado no ambiente local, **a homologação com pooler PgBouncer real em staging permanece etapa obrigatória** antes de ligar em produção.

---

## 4. Critérios de Expansão por Ondas

| Onda | Tabelas / Fluxo | Pré-requisitos antes de avançar |
|---|---|---|
| **Onda 0 (Atual)** | Piloto técnico isolado (`ClassGroup`, `Student`, `MessageTemplate`, `MessageLog`) | Prova automatizada em PG 16 passando + revisão de ADR |
| **Onda 1 (Produção)** | Busca Ativa Core (`ClassGroup`, `Student`, `MessageTemplate`, `MessageLog` + `schoolId` materializado em `MessageLog`) | Homologação em staging com Neon PgBouncer transaction pooling + refatoração de queries/workers do núcleo para `withTenantContext` + role `app_runtime` dedicada em runtime |
| **Onda 2** | `PedagogicalMinute`, `PedagogicalMinuteStudent`, `PedagogicalMinuteParticipant`, `PedagogicalMinuteAddendum`, `PedagogicalActionItem`, `AbsenceJustification`, `InPersonAttendance`, `StudentContact`, `LowAttendanceRecord`, `AttendanceSnapshot` | Função `SECURITY DEFINER` para `/validar/ata/[code]` e `/assinar/ata/[token]` + `withTenantContext` em todas as rotas de atas e dossiês |
| **Onda 3** | Módulo Conselho de Classe (`ClassCouncilBoard`, `CouncilTrimesterState`, `StudentCouncilCard`, portais docentes por token) | Funções `SECURITY DEFINER` para tokens de docente/pré-conselho + validação de concorrência (`counselMigrationsAndConcurrencyReal`) com RLS ativo |
| **Onda 4** | Telemetria/Mensageria (`AuditLog`, extensões de fila/webhook) + suporte controlado a leitura agregada da SEMEC (`GESTAO_SECRETARIA`) | Políticas explícitas para escopo de rede SEMEC e `SUPERADMIN` sem uso de `BYPASSRLS` |

---

## 5. Estratégia de Reversão Segura (*Rollback*)

Em caso de regressão funcional durante ou após o rollout de uma onda em staging/produção:

1. **Permitido para contenção operacional:**
   - Reverter deploy de aplicação para versão compatível com o contrato `withTenantContext` da onda anterior **ou** ajustar a expressão da policy RLS específica em janela controlada garantindo que todas as rotas continuem exigindo `requireAuthorizedSchool`.
   - Em caso extremo e estritamente sob janela aprovada e registro de incidente, remover/suspender temporariamente uma constraint ou policy recém-adicionada da onda atual apenas enquanto as travas de aplicação (`requireAuthorizedSchool` + `assertTenantOwnership`) estão 100% ativas e monitoradas.
2. **ESTRIBAMENTE PROIBIDO como rollback:**
   - **NUNCA** reverter `DATABASE_URL` de runtime da aplicação para o usuário proprietário/administrativo (`neondb_owner` ou `app_migrator`).
   - **NUNCA** conceder `BYPASSRLS` ou `SUPERUSER` à role `app_runtime`.
   - **NUNCA** desabilitar RLS em tabelas que já dependam exclusivamente de isolamento no banco sem restaurar previamente guardas equivalentes e auditar o impacto.
