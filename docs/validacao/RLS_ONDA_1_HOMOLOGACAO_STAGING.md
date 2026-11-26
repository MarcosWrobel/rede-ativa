# Roteiro de Homologação em Staging Neon — RLS Onda 1

- **Branch de referência:** `auditoria/rls-onda-1`
- **Revisão do fechamento da R10 (diagnóstico original):** commit `e02f5af12062170e36619cd4d9d0f72fcccf28ef` (árvore `5fd3ca904069ec8634c25e4278782026d11dc127`, sobre a base `2810c3cc5cf58d1e1b27dd466e939794b6f400ef`)
- **Ponta verificada da branch:** commit `59366eeb9d2d6079b3177c5e36316e5cc58dd5bb` (árvore `2027403429c0bc3e900a2bc3bfc067cec4ec4e75`), que incorpora o isolamento revisado do Conselho de Classe
- **Documento arquitetural de base:** [ADR-001: Adoção Progressiva de Row-Level Security (RLS)](../arquitetura/ADR_001_ADOCAO_PROGRESSIVA_RLS.md)
- **Artefatos do piloto técnico local:** [pilot_rls_setup.sql](../../lab/rls-pilot/pilot_rls_setup.sql), [rlsTenantContext.ts](../../src/lib/rlsTenantContext.ts) e [rlsPilotReal.test.ts](../../src/lib/__tests__/rlsPilotReal.test.ts)

> [!NOTE]
> Este documento consolida o diagnóstico em modo somente leitura e o roteiro de homologação em staging Neon com *transaction pooling*. A implementação das adaptações na aplicação, criação de roles/migrations em staging, execução de testes no Neon e deploy dependem de autorização explícita em etapas próprias.

---

## 1. Diagnóstico de Prontidão na Ponta Verificada (`59366ee`)

Na revisão examinada (`59366eeb9d2d6079b3177c5e36316e5cc58dd5bb`, mantendo as referências do fechamento R10 `e02f5af12062170e36619cd4d9d0f72fcccf28ef`):

1. **Zero chamadas de `withTenantContext` em produção:** `withTenantContext` ([src/lib/rlsTenantContext.ts](../../src/lib/rlsTenantContext.ts)) é utilizado apenas em [src/lib/__tests__/rlsPilotReal.test.ts](../../src/lib/__tests__/rlsPilotReal.test.ts). Todas as rotas SSR, Route Handlers, serviços, cron e webhook executam atualmente sobre o cliente `prisma` global (ou `tx` sem `SELECT set_config('app.current_school_id', ..., true)`).
2. **`MessageLog.schoolId` ainda não materializado no schema:** em [prisma/schema.prisma](../../prisma/schema.prisma), `MessageLog` ainda deriva a escola via `studentId -> Student.schoolId` e não possui coluna `schoolId`, índice `(schoolId, sentAt DESC)` nem FKs compostas.
3. **Isolamento do Conselho de Classe na ponta `59366ee`:** a guarda `isCouncilBoardAuthorizedInActiveSchool` ([src/services/classCouncilService.ts](../../src/services/classCouncilService.ts)) passou a exigir `ownership.schoolId === activeSchool.id` (inclusive para `SUPERADMIN`) antes de consultar `ClassGroup` e `Student`, permanecendo pendente apenas a execução dentro de `withTenantContext`.

---

## 2. Inventário por Operação (`ClassGroup`, `Student`, `MessageTemplate`, `MessageLog`)

| Tabela / Operação | Arquivo e Linha / Função | Origem da Escola Autorizada | Guarda de Vínculo e Papel | Consultas Diretas, Relações Prisma e SQL Bruto | Cliente / Lacuna `withTenantContext` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`ClassGroup` (`SELECT`)** | `src/app/busca-ativa/page.tsx` (`L39`), `src/app/alunos/page.tsx` (`L31`), `src/app/faltas/page.tsx` (`L111`), `src/app/atestados/page.tsx` (`L50`), `src/app/historico/page.tsx` (`L36`), `src/app/gestao/page.tsx` (`L42, L68`), `src/app/encaminhamentos/page.tsx` (`L92`), `src/app/api/classes/route.ts` (`GET L21`), `src/app/api/justifications/route.ts` (`L113`), `src/services/classCouncilService.ts` (`listSchoolCouncilBoards L354`, `L459`), `src/services/classCouncilBiSyncService.ts` (`L379`) | `getAuthorizedCurrentSchool(session, schoolId)`, `requireAuthorizedSchool(...)`, `resolveAuthorizedSchoolForCouncil(...)` ou `resolveSyncSchool` | `auth()` / `requireAuth()`, `User.active !== false`, vínculo ativo em `UserSchool`/`UserNetwork` ou `SUPERADMIN` | Direta: `classGroup.findMany`/`count`. Indireta via relação Prisma: `include: { classGroup }` em `Student` (`busca-ativa L68`, `visao-geral L47`, `historico L29`, `messageDispatchService L88`, `ataFinalizationService L371`) e `ClassCouncilBoard` | `prisma` global; **falta** `withTenantContext` |
| **`ClassGroup` (`CREATE`/`UPDATE`)** | `src/app/api/classes/route.ts` (`POST L64-L86`), `src/app/api/classes/[id]/route.ts` (`PATCH L39-L75`), `src/app/api/students/import/route.ts` (`L69-L104`), `src/services/classCouncilSerePdfService.ts` (`L700`) | `requireAuthorizedSchool(...)` / `school.id` (após `isCouncilBoardAuthorizedInActiveSchool` no Conselho) | `requireSchoolAdmin`, `requireSchoolOperator`, `canMutateSchoolCouncil` + `assertTenantOwnership` | Direta: `classGroup.findFirst`/`create`/`update`/`updateMany` | `prisma` global; **falta** `withTenantContext` |
| **`Student` (`SELECT`)** | `src/app/busca-ativa/page.tsx` (`L56`), `src/app/alunos/page.tsx` (`L23`), `src/app/alunos/[id]/page.tsx` + `src/lib/safePhase3Queries.ts` (`loadStudent360Bundle L23`), `src/app/alunos/[id]/dossie/page.tsx` (`L47`), `src/app/atestados/page.tsx` (`L55`), `src/app/atas/page.tsx` (`L31`), `src/app/gestao/page.tsx` (`L41`), `src/app/visao-geral/page.tsx` (`L39`), `src/app/api/students/route.ts` (`GET L35`), `src/app/api/ai/formalize-ata/route.ts` (`L616`), `src/app/api/atas/route.ts` (`L400`), `src/app/api/atas/participant-candidates/route.ts` (`L279`), `src/app/api/low-attendance/route.ts` (`L49`), `src/services/frequencySyncService.ts` (`L169`), `src/services/classCouncilService.ts` (`L239, L312, L1551`), `src/services/classCouncilBiSyncService.ts` (`L383`), `src/services/ataParticipantService.ts` (`L379`) | `getAuthorizedCurrentSchool` / `requireAuthorizedSchool` / `resolveSyncSchool` | `requireAuth` + vínculo ativo + papel efetivo + `assertTenantOwnership` (em `[id]`, valida `bundle.student.schoolId`) | Direta: `student.findMany`/`findUnique`/`count`. Indireta: `include: { student }` em `MessageLog`, `LowAttendanceRecord`, `AbsenceJustification`, `StudentCouncilCard` | `prisma` global (ou `tx` sem `set_config` em `ataParticipantService`); **falta** `withTenantContext` |
| **`Student` (`CREATE`/`UPDATE`)** | `src/app/api/students/route.ts` (`POST L69-L100`, `PATCH L162-L211`, `DELETE soft L269-L281`), `src/app/api/students/import/route.ts` (`L129-L357`), `src/app/api/students/[id]/contacts/route.ts` (`L34-L149`), `src/app/api/students/[id]/attendances/route.ts` (`L30`), `src/app/api/students/[id]/justifications/route.ts` (`L30`), `src/app/api/justifications/route.ts` (`L156`), `src/app/api/atas/[id]/route.ts` (`L486`), `src/services/ataFinalizationService.ts` (`L369`), `src/services/classCouncilBiSyncService.ts` (`L602` SQL bruto, `L614`), `src/services/frequencySyncService.ts` (`L491` SQL bruto) | `requireAuthorizedSchool` / `resolveSyncSchool` | `requireSchoolOperator` / `requireSchoolAdmin` + `assertTenantOwnership` | Direta: `student.create`/`createMany`/`update`/`updateMany`; **SQL bruto:** `prisma.$executeRaw` `UPDATE "Student" AS s ...` em `classCouncilBiSyncService.ts:602` e `frequencySyncService.ts:491` | `prisma` global (`tx` sem `set_config` em `atas/[id]` e `ataFinalizationService`); **falta** `withTenantContext` |
| **`MessageTemplate` (`SELECT`/`CREATE`/`UPDATE`)** | `src/app/busca-ativa/page.tsx` (`L44`), `src/app/faltas/page.tsx` (`L116`), `src/app/modelos/page.tsx` (`L13`), `src/app/api/templates/route.ts` (`GET L30`, `POST L57`, `PATCH L104-L127`), `src/services/messageDispatchService.ts` (`L101`) | `getAuthorizedCurrentSchool` / `requireAuthorizedSchool` | `requireAuth` + `requireSchoolOperator` / `requireSchoolAdmin` + `assertTenantOwnership` | Direta: `messageTemplate.findMany`/`findUnique`/`create`/`update`. Indireta: `include: { template }` em `MessageLog` | `prisma` global; **falta** `withTenantContext`; exclusões futuras exigem `ON DELETE SET NULL ("templateId")` |
| **`MessageLog` (`SELECT`)** | `src/app/busca-ativa/page.tsx` (`L82`), `src/app/faltas/page.tsx` (`L40`), `src/app/historico/page.tsx` (`L23, L33, L40`), `src/app/gestao/page.tsx` (`L59`), `src/app/visao-geral/page.tsx` (`L40-L42`), `src/app/api/messages/route.ts` (`L89-L90`), `src/app/api/messages/pending/route.ts` (`L24-L41`), `src/lib/reportsAggregator.ts` (`L65-L73`) | `getAuthorizedCurrentSchool` / `requireAuthorizedSchool` | `requireAuth` + vínculo ativo + papel efetivo; filtro atual deriva via `{ student: { schoolId } }` | Direta: `messageLog.findMany`/`count`/`groupBy`. Indireta: `student.messageLogs` (`busca-ativa L74`, `loadStudent360Bundle`) | `prisma` global; **falta** `withTenantContext` e coluna `MessageLog.schoolId` |
| **`MessageLog` (`CREATE`/`UPDATE`/`DELETE`)** | `src/app/api/messages/send/route.ts` → `src/services/messageDispatchService.ts` (`L149, L174, L237, L253`), `src/app/api/messages/manage/route.ts` (`PATCH L39-L113`, `DELETE L178-L201`), `src/app/api/messages/reply/route.ts` (`L60-L136`), `src/app/api/messages/status/route.ts` (`L23-L49`) | `requireAuthorizedSchool` | `requireSchoolOperator` / `requireSchoolAdmin` + `assertTenantOwnership(student.schoolId, currentSchool.id, session)` | Direta: `messageLog.create`/`update`/`delete`; **SQL bruto:** `prisma.$executeRaw` `UPDATE "MessageLog" ml ...` (`L237`) e `prisma.$queryRaw` `UPDATE "MessageLog" ... RETURNING ...` (`L253`) em `messageDispatchService.ts` | `prisma` global; **falta** `withTenantContext` e gravação explícita de `MessageLog.schoolId` |

---

## 3. Fluxos Globais, SEMEC, Cron, Token e Webhook

| Fluxo (Arquivo / Linha) | Efeito Sob RLS Fail-Closed | Estratégia Proposta (Sem `BYPASSRLS`) | Critério de Aceite |
| :--- | :--- | :--- | :--- |
| **Admin Global** (`src/app/admin/page.tsx:51-52`: `student.count`, `messageLog.count`) | Contagens globais retornam `0` sem contexto escolar | **1ª opção:** agregação por escola autorizada (iterando escolas ativas em `withTenantContext` ou métrica derivada). Como alternativa secundária, função `SECURITY DEFINER` dedicada de métricas agregadas globais restrita a `app_runtime` e invocada apenas após `checkIsSuperAdmin(session)` | `SUPERADMIN` visualiza totais agregados sem expor linhas individuais; consultas diretas às tabelas sem `withTenantContext` continuam retornando `0` linhas |
| **SEMEC (`GESTAO_SECRETARIA`)** (`src/app/secretaria/page.tsx:299-307`, `src/app/api/secretaria/metrics/route.ts:253-261`) | Filtro `schoolId: { in: schoolIds }` falha em contexto single-school | **1ª opção (Onda 1):** agregação por escola autorizada iterando `schoolIds` da rede dentro de `withTenantContext(prisma, sid, ...)`. **Onda 4:** variável de sessão multi-escola validada na policy (sem `BYPASSRLS`) | `GESTAO_SECRETARIA` enxerga apenas escolas do seu `networkId`; tentativa de consultar escola fora da rede retorna `0` linhas / `403` |
| **Cron Semanal** (`src/app/api/cron/weekly-digest/route.ts:55-88` → `src/lib/weeklyDigest.ts:60-149`) | `compileWeeklyDigest(s.id)` usa `prisma` global sem `set_config` | Envolver cada chamada a `compileWeeklyDigest(s.id)` em `withTenantContext(prisma, s.id, tx => compileWeeklyDigest(s.id, tx))` | Execução via `CRON_SECRET` processa cada escola ativa isoladamente, descartando `app.current_school_id` entre iterações |
| **Ciclo de Vida de Escola** (`src/app/api/schools/route.ts:512`, `src/app/api/schools/[id]/route.ts:453-485`, `src/app/api/schools/[id]/sanitize/route.ts:61-92`) | Criação de modelos padrão e limpeza de dados operam fora de `withTenantContext` | Executar `messageTemplate.create` e `deleteMany` das 4 tabelas dentro de `withTenantContext(prisma, targetSchoolId, ...)` preservando o bloqueio ao INEP `41042730` | Criação de escola grava modelos com `schoolId` correto; exclusão/saneamento afeta apenas a escola-alvo |
| **Token Público de Ata** (`src/app/api/atas/sign-token/[token]/route.ts:554`) | `prisma.student.updateMany` executa sem `withTenantContext` | Após validar o token da ata, executar a atualização dentro de `withTenantContext(prisma, minute.schoolId, tx => tx.student.updateMany(...))` | Assinatura móvel atualiza apenas o estudante vinculado à ata e escola do token |
| **Webhook Passivo WhatsApp** (`src/app/api/webhooks/whatsapp/route.ts:73-170`) | Busca inicial em `MessageLog` por `id` ou sufixo de telefone retorna `0` linhas | Se exigir função `SECURITY DEFINER` (`resolve_whatsapp_webhook_target(...)` retornando apenas `{ logId, schoolId, distinctSchoolCount }`), o desenho ainda precisa definir **proprietário dedicado**, **permissões de execução** (`REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO app_runtime`) e **política aplicável sob `FORCE ROW LEVEL SECURITY`** (evitando bypass não intencional). Se `distinctSchoolCount > 1` sem `explicitSchoolId`, ignorar; se único, abrir `withTenantContext(prisma, resolved.schoolId, ...)` para atualizar | Número compartilhado entre duas escolas sem `schoolId` explícito é descartado; webhook inequívoco atualiza apenas o `MessageLog` da escola proprietária |

---

## 4. Pré-Requisitos de Schema e Credenciais em Staging

1. **Materialização de `MessageLog.schoolId` (Fase A já preparada vs Fase B pendente):**
   - **Fase A (`20261126140000_rls_wave1_message_log_school_id_phase_a`):** adiciona `schoolId String?` anulável em `MessageLog` ([prisma/schema.prisma](../../prisma/schema.prisma)), cria o índice `("schoolId", "sentAt" DESC)`, adiciona FK simples `MessageLog_schoolId_fkey` (`ON DELETE RESTRICT`) e executa backfill a partir de `Student.schoolId` **somente onde `MessageLog.schoolId IS NULL`**, preservando valores já preenchidos e deixando eventuais divergências visíveis ao pré-flight.
   - **Decisão sobre `MessageLog_schoolId_fkey` (`ON DELETE RESTRICT`) na Fase A vs `DELETE /api/schools/[id]`:**
     - **Mantida na Fase A** porque impede que `MessageLog.schoolId` aponte para uma `School` inexistente ou excluída enquanto a FK composta `("schoolId", "studentId")` ainda não está ativa.
     - Em **dados coerentes**, `DELETE /api/schools/[id]` ([route.ts](../../src/app/api/schools/[id]/route.ts)) já remove `messageLog.deleteMany({ where: { student: { schoolId: id } } })` dentro da mesma batch `$transaction` antes de `prisma.school.delete({ where: { id } })`, concluindo a exclusão normalmente sem acionar bloqueio.
     - Em **caso de divergência** (ex.: `MessageLog.schoolId = id` vinculado a `Student` de outra escola), `MessageLog_schoolId_fkey` impede `prisma.school.delete({ where: { id } })`, força **rollback atômico** de toda a `$transaction` (preservando integralmente os registros da outra escola e todos os registros da escola alvo que seriam apagados na transação) e o endpoint sinaliza explicitamente **HTTP `409 Conflict`** (`SCHOOL_DELETE_INTEGRITY_CONFLICT`) apenas quando `MessageLog_schoolId_fkey` for identificada na violação (`meta.constraint`, `meta.field_name` ou `message`). Para violações `P2003` de outras constraints, responde `409 Conflict` com `SCHOOL_DELETE_FK_CONFLICT` e mensagem genérica de integridade referencial.
   - **Pré-flight e reconciliação ([src/lib/rlsWave1Preflight.ts](../../src/lib/rlsWave1Preflight.ts)):**
     - `runRlsWave1Preflight` (somente leitura, reutilizável antes da Fase A — quando `hasMessageLogSchoolIdColumn === false` — e antes da Fase B) separa `blockingForPhaseA` / `readyForPhaseA` de `blockingForPhaseB` / `readyForPhaseB`:
       - **Bloqueantes já para a Fase A e para a Fase B (`blockingForPhaseA: true`, `blockingForPhaseB: true`):** `studentsWithoutSchool` (`Student.schoolId` sem `School` correspondente, verificável inclusive antes da migração) e `logsWithMissingSchool` (`MessageLog.schoolId` preenchido sem `School` correspondente, quando a coluna existir).
       - **Bloqueantes apenas para a Fase B (`blockingForPhaseA: false`, `blockingForPhaseB: true`):** `logsWithoutStudent`, `logsMissingSchoolId` (esperado durante transição enquanto escritores antigos estiverem ativos, porém bloqueante para `NOT NULL`), `logsDivergentSchoolId`, `logsWithMissingTemplate`, `logsWithCrossSchoolTemplate`, `studentsWithMissingClassGroup` e `studentsWithCrossSchoolClassGroup` (preservando `templateId IS NULL` como legítimo).
     - `reconcileMessageLogSchoolId` reexecuta o backfill de nulos de forma idempotente após a retirada dos escritores antigos.
   - **Fase B (pendente):** após `readyForPhaseB === true` no pré-flight, aplicar `ALTER COLUMN "schoolId" SET NOT NULL` e FKs compostas.
2. **Restrições Compostas e Preservação de `schoolId` ao Excluir Modelo:**
   - `UNIQUE ("schoolId", "id")` em `ClassGroup`, `Student` e `MessageTemplate`.
   - `Student`: FK composta `("schoolId", "classGroupId") -> "ClassGroup" ("schoolId", "id") ON DELETE RESTRICT`.
   - `MessageLog`: FK composta `("schoolId", "studentId") -> "Student" ("schoolId", "id") ON DELETE RESTRICT` e FK opcional:
     ```sql
     FOREIGN KEY ("schoolId", "templateId")
       REFERENCES "MessageTemplate" ("schoolId", "id")
       ON DELETE SET NULL ("templateId")
       ON UPDATE CASCADE
     ```
   - Conferência obrigatória em staging: após excluir um `MessageTemplate` vinculado a `MessageLog`, consultar `SELECT "id", "schoolId", "templateId" FROM "MessageLog"` e verificar `templateId IS NULL` com `schoolId` preservado (`NOT NULL`).
3. **Políticas RLS (`ENABLE` e `FORCE ROW LEVEL SECURITY`):**
   - Aplicar `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` nas 4 tabelas e policies fail-closed em `USING` e `WITH CHECK` (`NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')`) para `app_runtime`.
   - Conferir catálogo antes da bateria:
     ```sql
     SELECT relname, relrowsecurity, relforcerowsecurity
     FROM pg_class
     WHERE relname IN ('ClassGroup', 'Student', 'MessageTemplate', 'MessageLog');
     ```
     Todas devem retornar `relrowsecurity = true` e `relforcerowsecurity = true`.
4. **Separação `app_migrator` vs `app_runtime`:**
   - **`app_migrator`** (`DIRECT_URL`): proprietário das tabelas e responsável exclusivo por `prisma migrate deploy`.
   - **`app_runtime`** (`DATABASE_URL` no endpoint `-pooler`): `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, sem propriedade das tabelas (`pg_tables.tableowner != 'app_runtime'`), com `GRANT USAGE ON SCHEMA public`, `SELECT` em `School` (e tabelas auxiliares necessárias) e `SELECT, INSERT, UPDATE, DELETE` nas 4 tabelas.

---

## 5. Suíte Dedicada de Staging e Matriz de Aceite no Pooler Neon

- **Preservação do piloto local:** manter [src/lib/__tests__/rlsPilotReal.test.ts](../../src/lib/__tests__/rlsPilotReal.test.ts) inalterado com `assertSafeLocalPilotUrl` (exigindo `localhost`/`127.0.0.1` e banco `rls_pilot_test`).
- **Suíte dedicada para staging (`src/lib/__tests__/rlsStagingPooler.test.ts`):**
  - Habilitada exclusivamente por `RUN_RLS_STAGING_POOLER_TEST=true`, exigindo `RLS_STAGING_ADMIN_URL` (`app_migrator`) e `RLS_STAGING_RUNTIME_POOLER_URL` (`app_runtime` no endpoint `-pooler` Neon com `pgbouncer=true`).
  - Travada por marcador explícito contra execução acidental em produção e usando apenas duas escolas sintéticas (`rls-stg-alpha` e `rls-stg-beta`).
  - **Detecção de casos ignorados:** quando `RUN_RLS_STAGING_POOLER_TEST=true`, a suíte **falha explicitamente** se qualquer pré-condição ou caso obrigatório for pulado (`skipped > 0` deve reprovar o portão de homologação).

| Caso de Aceite (Endpoint `-pooler` Neon) | Procedimento | Resultado Esperado |
| :--- | :--- | :--- |
| **1. Privilégios e RLS no catálogo** | Consultar `pg_roles`, `pg_tables` e `pg_class` | `app_runtime` sem `SUPERUSER`/`BYPASSRLS`/posse; `ENABLE` e `FORCE` ativos nas 4 tabelas |
| **2. Operações legítimas (`Alpha` e `Beta`)** | `withTenantContext` cria e lê `ClassGroup → Student → MessageTemplate → MessageLog` | Sucesso em `Alpha` e `Beta`, cada qual enxergando apenas seus registros |
| **3. Isolamento de leitura e escrita (`WITH CHECK`)** | Sob contexto `Alpha`, consultar dados de `Beta` e tentar `INSERT` com `schoolId = 'rls-stg-beta'` | `SELECT` retorna `0` linhas; `INSERT` falha com `SQLSTATE 42501` |
| **4. `UPDATE` e `DELETE` sem visibilidade** | Ler snapshot de `Beta` via `app_runtime` no contexto de `Beta`; sob contexto `Alpha` (e sem contexto), tentar `UPDATE` e `DELETE` nos IDs de `Beta`; reler via `app_runtime` no contexto de `Beta` | `0` linhas afetadas; estado persistido lido com `app_runtime` no contexto de `Beta` permanece idêntico antes e depois |
| **5. Referências cruzadas (FKs compostas)** | `Student(Alpha)` com `classGroupId(Beta)` e `MessageLog(Alpha)` com `studentId(Beta)`/`templateId(Beta)` | Rejeição imediata com `SQLSTATE 23503` |
| **6. Exclusão de modelo** | `DELETE FROM "MessageTemplate"` em `Alpha` vinculado a `MessageLog` | `MessageLog.templateId = NULL` e `MessageLog.schoolId = 'rls-stg-alpha'` preservado |
| **7. Contexto ausente ou vazio** | Consultas e mutações fora de `withTenantContext` ou com `set_config('app.current_school_id', '', true)` | `SELECT` retorna `0` linhas; `INSERT` falha com `42501`/`23502` |
| **8. Alternância `A → B → sem contexto` após `COMMIT`** | Três transações sequenciais (`Alpha` → `Beta` → sem `set_config`), registrando `pg_backend_pid()` e `current_setting` | `Alpha`, `Beta` e `NULL` respectivamente; `0` linhas na transação sem contexto |
| **9. Limpeza após `ROLLBACK`** | Transação em `Alpha` executa escrita válida e lança erro forçado (`ROLLBACK`); transação seguinte roda sem contexto, registrando `pg_backend_pid()` | `current_setting` retorna `NULL`, escrita revertida e `0` linhas visíveis |
| **10. Reutilização de conexão (`pg_backend_pid()`)** | Comparar `pg_backend_pid()` entre as transações de `COMMIT` e `ROLLBACK` no pooler Neon | Se o mesmo PID se repetir, comprova reutilização direta sem vazamento; **se o pooler rotear para PIDs distintos**, marcar a comprovação de reutilização de backend como **PENDENTE** |
| **11. Concorrência (`Promise.all`)** | Executar leituras e escritas paralelas intercaladas para `Alpha` e `Beta` no endpoint `-pooler` | Zero vazamento cruzado e zero erro de contaminação de `app.current_school_id` |

---

## 6. Ativação, Compatibilidade e Reversão Segura

| Versão da Aplicação | Schema (`MessageLog.schoolId` + FKs) | Políticas RLS | Compatibilidade | Observação |
| :--- | :--- | :--- | :---: | :--- |
| **App Atual (`59366ee`)** | Atual (sem `schoolId` em `MessageLog`) | Desligadas | **Compatível** | Estado atual antes da Onda 1 |
| **App Atual (`59366ee`)** | Novo (`NOT NULL` + FKs) | Desligadas ou Ligadas | **Incompatível** | Falha em `MessageLog.create` (`23502`) e leituras sem `set_config` (`0` linhas / `42501`) |
| **App Onda 1 (`withTenantContext` + `schoolId`)** | Aditivo (`MessageLog.schoolId` nullable) ou Novo (`NOT NULL`) | Desligadas | **Compatível (Janela de Transição / Reversão)** | App já envia `schoolId` e `set_config`; segura para transição e rollback sem perda de dados |
| **App Onda 1 (`withTenantContext` + `schoolId`)** | Novo (`NOT NULL` + FKs compostas) | Ligadas (`ENABLE` + `FORCE`) | **Compatível (Alvo Onda 1)** | Defesa em profundidade completa |

- **Ordem segura de transição (credencial efetiva e versões compatíveis por etapa):**
  1. **Etapa 1 — Migration Fase A (`app_migrator` via `DIRECT_URL`):** aplicar `20261126140000_rls_wave1_message_log_school_id_phase_a` (coluna `MessageLog.schoolId` anulável, backfill de nulos, índice `("schoolId", "sentAt" DESC)` e FK simples). **Versão compatível:** tanto **App Atual (`59366ee`)** (que continua criando logs com `schoolId: null`) quanto **App Onda 1** funcionam durante esta janela.
  2. **Etapa 2 — Deploy da App Onda 1 (`DATABASE_URL` ainda no papel anterior ou pré-RLS):** publicar aplicação gravando `MessageLog.schoolId` explicitamente e usando `withTenantContext` + estratégias globais/SEMEC/cron/webhook, mantendo RLS desligada até retirar 100% dos escritores antigos.
  3. **Etapa 3 — Reconciliação final + Pré-flight (`app_migrator`):** após retirar todos os escritores antigos, executar `reconcileMessageLogSchoolId` para preencher logs criados com `schoolId: null` durante a Fase A e reexecutar `runRlsWave1Preflight` até confirmar `readyForPhaseB === true` (zero nulos e zero inconsistências bloqueantes).
  4. **Etapa 4 — Migration Fase B (`app_migrator` via `DIRECT_URL`):** aplicar `NOT NULL`, `UNIQUE ("schoolId", "id")`, FKs compostas (`ON DELETE SET NULL ("templateId")`) e `ENABLE` + `FORCE ROW LEVEL SECURITY` para `app_runtime`. **Compatível apenas com App Onda 1.**
  5. **Etapa 5 — Troca de credencial (`app_runtime` via `DATABASE_URL` `-pooler`):** apontar o runtime da App Onda 1 para `app_runtime` (`NOBYPASSRLS`) no endpoint `-pooler`. *(Na transição da Etapa 4→5, usar janela curta sem tráfego se `app_runtime` ainda não estiver ativo na Etapa 4.)*
- **Reversão segura:**
  - **Versão de aplicação compatível para reversão:** manter o build da **App Onda 1** (ou suspender apenas as policies RLS em janela aprovada mantendo `requireAuthorizedSchool` + `assertTenantOwnership` ativos na aplicação). Não reverter para a App Atual (`59366ee`) após `NOT NULL` sem antes remover `NOT NULL`/RLS.
  - **Restrições invioláveis de credencial:** **nunca** apontar `DATABASE_URL` de runtime para `neondb_owner`/`app_migrator` e **nunca** conceder `BYPASSRLS` ou `SUPERUSER` a `app_runtime`.

---

## 7. Estado das Evidências e Lista de Mudanças Prévias

- **Disponível (verificado na revisão `59366eeb9d2d6079b3177c5e36316e5cc58dd5bb`, validado em PostgreSQL 16 sintético em `999ad2263e2e9521ac7e669cd8175c9bc08a56bf` e revisado em `6e0c1e0e0cf92e161b551b24c65503ca52c7f159`):**
  - Especificação em [docs/arquitetura/ADR_001_ADOCAO_PROGRESSIVA_RLS.md](../arquitetura/ADR_001_ADOCAO_PROGRESSIVA_RLS.md) e piloto local em [lab/rls-pilot/pilot_rls_setup.sql](../../lab/rls-pilot/pilot_rls_setup.sql), [src/lib/rlsTenantContext.ts](../../src/lib/rlsTenantContext.ts) e [src/lib/__tests__/rlsPilotReal.test.ts](../../src/lib/__tests__/rlsPilotReal.test.ts) (validado localmente contra PostgreSQL 16 com `connection_limit=1`, fora do pooler Neon).
  - Schema aditivo em [prisma/schema.prisma](../../prisma/schema.prisma), migration da Fase A em [20261126140000_rls_wave1_message_log_school_id_phase_a](../../prisma/migrations/20261126140000_rls_wave1_message_log_school_id_phase_a/migration.sql), pré-flight/reconciliação em [src/lib/rlsWave1Preflight.ts](../../src/lib/rlsWave1Preflight.ts) e suíte sintética [src/lib/__tests__/rlsWave1PhaseAPreflightRealPg.test.ts](../../src/lib/__tests__/rlsWave1PhaseAPreflightRealPg.test.ts):
    - O commit `6e0c1e0e0cf92e161b551b24c65503ca52c7f159` teve revisão de código aprovada e seu diff corresponde ao SHA-256 do patch validado (`bf6b44083185344dafe8cbc14dcba21e9c7c9406e869c1bdea5a7a10d1b3bd50`).
    - Resultados relatados pelo Antigravity sobre `6e0c1e0` (com conferência independente dos logs pendente até que os arquivos estejam acessíveis): `8/8` casos aprovados na suíte direcionada com PostgreSQL 16 sintético, `718` aprovados e `51` ignorados (`85` arquivos aprovados, `11` ignorados) na suíte padrão (`npm test`), e `npm run build` com saída `0`.
- **Lacunas de implementação pendentes antes da homologação:**
  1. Migration da Fase B (`NOT NULL` + FKs compostas com `ON DELETE SET NULL ("templateId")` + `ENABLE`/`FORCE ROW LEVEL SECURITY`).
  2. Provisionamento de `app_migrator` e `app_runtime` (`NOBYPASSRLS`) no staging Neon.
  3. Adoção de `withTenantContext` em todas as leituras, escritas e SQLs brutos (`messageDispatchService.ts`, `classCouncilBiSyncService.ts`, `frequencySyncService.ts`) das 4 tabelas e gravação explícita de `MessageLog.schoolId`.
  4. Estratégias explícitas para `admin/page.tsx`, `secretaria/page.tsx`, `api/secretaria/metrics/route.ts` (agregação por escola autorizada como 1ª opção), `api/cron/weekly-digest/route.ts`, `api/schools/**`, `api/atas/sign-token/[token]/route.ts` e `api/webhooks/whatsapp/route.ts` (definindo proprietário, `EXECUTE` e política sob `FORCE RLS` se usar `SECURITY DEFINER`).
  5. Criação da suíte dedicada `src/lib/__tests__/rlsStagingPooler.test.ts`.
- **Pendente de execução:** homologação completa em staging Neon (`-pooler`) e liberação efetiva para produção (ambas aguardando implementação e autorização explícita).
