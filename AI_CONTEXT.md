# AI_CONTEXT.md — Contexto Mestre do Projeto Rede Ativa SaaS

> **Este documento é a fonte canônica de contexto técnico, histórico, diretrizes arquiteturais e regras inegociáveis para qualquer Assistente de Inteligência Artificial (Antigravity, Cursor, Copilot, Claude, ChatGPT, etc.) e desenvolvedores que atuem neste repositório.**

---

## 🤖 Bloco de Inicialização Rápida (System Prompt para IAs)

*Copie e cole o bloco abaixo ao iniciar uma conversa com qualquer IA em um novo ambiente ou ferramenta:*

```text
Você é um engenheiro de software sênior atuando no repositório do "Rede Ativa SaaS" (antigo Busca Ativa Leopoldina).
A plataforma é uma aplicação full-stack multi-escola de alta performance construída com Next.js 16 (App Router + Turbopack), React 19, TypeScript estrito, Prisma ORM 6, Neon PostgreSQL Serverless (AWS sa-east-1) e NextAuth v5.

Seu trabalho deve seguir estritamente as diretrizes do arquivo AI_CONTEXT.md:
1. O Colégio Estadual Leopoldina B. Pedroso (INEP 41042730) é a UNIDADE PILOTO FUNDADORA. Ele possui 689 estudantes reais e NUNCA pode ter seus dados apagados, alterados inadvertidamente ou sofrer exclusão.
2. Toda query/mutação de dados operacionais DEVE respeitar o isolamento multi-tenant por schoolId (prevenção absoluta contra IDOR).
3. A governança opera em 4 camadas hierárquicas: SUPERADMIN (/admin), GESTAO_SECRETARIA (/secretaria), GESTOR_ESCOLAR (/gestao) e PEDAGOGA (/busca-ativa).
4. O Livro de Atas Digital possui fé pública documental (Lei nº 14.063/2020) com selo SHA-256 canônico, adendos encadeados ("Em tempo") e biometria móvel WebAuthn.
5. Em conformidade com a LGPD e o ECA (Arts. 17 e 143), dados de menores NUNCA são enviados diretamente para a Google Gemini API sem prévia pseudonimização (aiPseudonymizer.ts).
6. Antes de finalizar qualquer alteração, garanta que todos os testes passem (npm test — 177+ testes incluindo adversarialQa.test.ts) e que o build de produção compile sem erros (npm run build).
7. Preserve todos os comentários e docstrings existentes. Utilize o padrão Server Component (page.tsx) + Client Component (*Client.tsx).
```

---

## 📖 1. Histórico e Evolução do Projeto

### Fase 1: Origem e Validação na Escola Piloto (Outubro/2026)
O projeto nasceu no **Colégio Estadual Leopoldina B. Pedroso** (Tibagi / Ponta Grossa - PR, INEP `41042730`) com a missão de resolver quatro dores críticas da equipe pedagógica:
- **Evasão Escolar e Busca Ativa:** As pedagogas gastavam horas copiando números de planilhas e digitando mensagens repetitivas no WhatsApp Web pessoal.
- **Interoperabilidade SERE:** O sistema estadual do Paraná (SERE) exportava relatórios em formatos variados (`.xls` BIFF8, `.pdf`, `.csv`), com duplicação de turmas técnicas do Novo Ensino Médio.
- **Caderno de Atas Manuscrito:** Atas de atendimento a pais eram lavradas à mão em cadernos físicos, sujeitas a rasuras, perda de registros, ausência de busca textual e dificuldade de comprovação judicial.
- **Falta de Arcabouço Jurídico:** Cobranças do Conselho Tutelar e Ministério Público exigiam dossiês consolidados de difícil compilação manual.

### Fase 2: Robustez e Proteção Perimetral
- Implementação de autenticação institucional `@escola.pr.gov.br` via **NextAuth v5** e proxy de borda (`src/proxy.ts`).
- Criação da **Extensão Web (Manifest V3)** para coleta automatizada de dados de infrequência do Power BI estadual (*Presente na Escola*) e portal SERP/Celepar.
- Integração da **Janela Dedicada Compacta (480x760px)** para Linux/Chrome, isolando a conversa de busca ativa sem expor a lista de contatos do WhatsApp (proteção contra *shoulder-surfing* na coordenação).
- Assistência de IA com **Google Gemini 2026 (`gemini-3.5-flash`)** com pseudonimização prévia para formalização de atas e classificação de retornos familiares.

### Fase 3: Fé Pública & Livro de Atas Digital
- Criação do Livro Oficial Digital de Atas Pedagógicas sob a **Lei Federal nº 14.063/2020**:
  - Numeração anual sequencial por escola atômica e imutável;
  - Selagem criptográfica `SHA-256` canônica;
  - Assinatura digital institucional em 1 clique para servidores;
  - Coleta móvel de assinaturas via QR Code com autenticação biométrica do smartphone (**WebAuthn / Passkeys FIDO2**);
  - Termos de aditamento encadeados (*"Em tempo"*) e averbação de cancelamento (*"Tornada Sem Efeito"*);
  - Diagramação oficial A4 em folha única (`1 of 1`) com brasão e certidão pública cega (`/validar/ata/[code]`).

### Fase 4: Transformação em SaaS Multi-Escola ("Rede Ativa SaaS")
- Expansão da arquitetura para atender prefeituras (Secretarias Municipais de Educação - SEMEC) e múltiplas escolas estaduais e privadas simultaneamente.
- Modelagem de dados multi-tenant com `EducationNetwork`, `School` e `UserSchool`.
- Implementação da hierarquia de governança em 4 camadas com dashboards isolados.
- Criação de mecanismos de higienização de dados de teste (`/api/schools/[id]/sanitize`) e exclusão segura com blindagem atômica da **Escola Piloto Leopoldina**.
- Suíte automatizada expandida para **177+ testes unitários, integrados e adversariais (Vitest em 30 arquivos)** com 0 erros de build Turbopack.

---

## 🛡️ 2. As 7 Regras de Ouro Inegociáveis

Qualquer assistente de IA ou desenvolvedor deve respeitar rigorosamente estas regras:

### Regra 1: A Escola Piloto Leopoldina é Inviolável & Tolerância a Legados Restrita à Sede
- O **Colégio Estadual Leopoldina B. Pedroso** (INEP `41042730`) é a semente fundadora do sistema e contém 689 alunos reais.
- **NUNCA** execute comandos ou crie rotinas que apaguem, redefinam ou sobreponham dados do Leopoldina.
- O backend rejeita requisições destrutivas com `403 Forbidden` (`target.inepCode === "41042730"`). Não contorne essa proteção.
- **Tolerância a Dados Legados Restrita à Sede:** Qualquer filtro de retrocompatibilidade com registros legados (`schoolId: null` ou `"default-leopoldina"`) **DEVE** ser estritamente condicionado à comprovação de que a sessão ativa pertence à Escola Piloto Fundadora (`inepCode === "41042730"`). Nunca inclua `schoolId: null` ou `"default-leopoldina"` em cláusulas `OR` para outras escolas nem execute *auto-healing* de `schoolId` a partir de sessões externas.

### Regra 2: Isolamento Multi-Tenant Estrito (Sem IDOR / BOLA)
- Toda consulta e mutação a entidades filhas (`Student`, `ClassGroup`, `PedagogicalMinute`, `MessageLog`, `AbsenceJustification`, `StudentContact`, etc.) **deve filtrar obrigatoriamente por `schoolId`**:
  ```typescript
  // CORRETO
  const students = await prisma.student.findMany({
    where: { schoolId, active: true },
  });
  ```
- **Validação de Cookie de Contexto (`active_school_id`):** Em `getCurrentSchool()`, nunca confie no cookie `active_school_id` sem validar se o usuário autenticado na sessão possui vínculo ativo com aquela escola (`session.user.schools` / `schoolId`) ou privilégio global (`SUPERADMIN` / `GESTAO_SECRETARIA` autorizado). Nunca confie em `schoolId` vindo do corpo da requisição (*parameter spoofing*): o tenant efetivo sempre deriva da sessão validada.
- **Integridade de FKs em Criação E Atualização (`POST`, `PUT`, `PATCH`, `/finalize`):** Sempre valide que chaves estrangeiras referenciadas em arrays ou campos (`studentIds`, `classGroupId`, `templateId`) pertençam estritamente ao mesmo `schoolId` do recurso/sessão (conferindo `matched.length === requestedIds.length`), inclusive em edições de rascunho e finalizações de atas.
- **Rejeição Explícita de Parâmetros Restritos (RBAC):** Quando um payload contiver flags ou operações restritas a papéis superiores (ex.: `updateSchoolInfo: true` para não-`SUPERADMIN`), retorne explicitamente **`403 Forbidden`** — nunca ignore silenciosamente retornando `200 OK`.
- **Auditoria com `schoolId` Raiz Obrigatório & Exportação CSV Segura:** Toda chamada `logAudit(...)` em contexto escolar **DEVE** receber `schoolId` na raiz do objeto (nunca apenas dentro de `details`), e consultas em `/auditoria` nunca devem expor `{ schoolId: null }` entre tenants. Em exportações CSV, todas as colunas textuais devem aplicar `sanitizeCsvField(...)` combinado ao escape RFC 4180 (`.replace(/"/g, '""')`).
- Em mutações por ID (`/api/students/[id]`, `/api/atas/[id]`), valide se o registro pertence à escola do usuário antes de atualizar ou excluir (`assertTenantOwnership`).

### Regra 3: Fé Pública e Imutabilidade das Atas
- Atas no status `FINALIZED` **nunca sofrem edição de texto in loco**.
- Retificações devem ser feitas via Termo Aditivo (`/api/atas/[id]/addendums`) com *hash-chaining*.
- Cancelamentos devem manter o registro histórico marcado como `VOIDED` (`/api/atas/[id]/void`), exigindo justificativa expressa.
- A exclusão física de atas é restrita ao papel `SUPERADMIN` e exclusiva para minutas de teste.

### Regra 4: Conformidade Estrita com LGPD e ECA
- Dados identificáveis de menores (nome, CGM, telefone) **nunca** podem ser enviados diretamente para a API do Google Gemini. Passe sempre pelo [`src/lib/aiPseudonymizer.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/aiPseudonymizer.ts).
- No validador público (`/validar/ata/[code]`), exponha apenas metadados e nomes mascarados (`maskName`, `maskDocument`).
- No Dossiê em PDF (`/alunos/[id]/dossie`), aplique anonimização automática por iniciais a outros menores citados em atas coletivas.

### Regra 5: Arquitetura Híbrida (Server vs. Client Components) e Escopo do Proxy
- Mantenha o padrão de pares:
  - `page.tsx`: Server Component para resolver sessão, escola ativa e buscar dados iniciais sem waterfall.
  - `*Client.tsx`: Client Component (`"use client"`) para gerenciar estados, modais, filtros e chamadas `fetch`.
- **Atenção ao Escopo do Middleware (`src/proxy.ts`):** O middleware valida apenas autenticação ativa, **não** posse de tenant sobre parâmetros dinâmicos `[id]` ou `[ano]`. Todo Server Component (`page.tsx`, rotas de impressão `/imprimir`, dossiês e livros anuais) **DEVE** validar `auth()` e `assertTenantOwnership(...)` antes de renderizar dados ou executar escritas de *auto-healing*.
- Não importe Prisma Client dentro de Client Components.

### Regra 6: Portão de Qualidade: Testes e Build Verificados
- Antes de concluir qualquer tarefa ou gerar commit:
  1. Execute `npm test` — **todos os 177+ testes devem passar (incluindo `adversarialQa.test.ts`)**.
  2. Execute `npm run build` — **o TypeScript e o Turbopack devem compilar com 0 erros**.
- Se criar uma nova funcionalidade de negócio ou segurança, adicione os testes correspondentes em `src/lib/__tests__/` ou `src/app/api/__tests__/`.

### Regra 7: Modo de Desenvolvimento Local (`ENABLE_DEV_AUTH`)
- Para rodar localmente sem credenciais Google OAuth, configure no `.env.local`:
  ```bash
  ENABLE_DEV_AUTH="true"
  NODE_ENV="development"
  ```
- O provider `"escola-dev-auth"` em [`src/lib/auth.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/auth.ts) permite login imediato com e-mails pré-cadastrados, bloqueado automaticamente em produção (`NODE_ENV === "production"`).

---

## 🏛️ 3. Governança e Hierarquia de Acesso (RBAC)

| Nível | Role Prisma | Descrição | Rota Principal |
| :---: | :--- | :--- | :---: |
| **1** | `SUPERADMIN` | Gestão Global do SaaS, diretório de escolas e redes, auditoria unificada. | `/admin` |
| **2** | `GESTAO_SECRETARIA` | Secretários(as) Municipais de Educação (SEMEC) com visão consolidada da rede. | `/secretaria` |
| **3** | `GESTOR_ESCOLAR` | Direção da escola ativa, gestão da equipe local (`/equipe`), turmas e token. | `/gestao` |
| **4** | `PEDAGOGA` | Equipe pedagógica local: busca ativa WhatsApp, faltas, prontuário e atas. | `/busca-ativa` |

---

## 📁 4. Estrutura do Repositório

```text
├── src/
│   ├── app/                    # Rotas do Next.js 16 App Router
│   │   ├── admin/              # Painel Super Admin e Gestão de Escolas (/admin/escolas)
│   │   ├── secretaria/         # Painel Executivo Municipal SEMEC
│   │   ├── gestao/             # Painel da Direção Escolar
│   │   ├── busca-ativa/        # Fila inteligente de disparos WhatsApp
│   │   ├── atas/               # Livro Oficial Digital de Atas e Livro Anual (/atas/livro/[ano])
│   │   ├── alunos/             # Base cadastral, Prontuário 360º e Dossiê (/alunos/[id]/dossie)
│   │   ├── faltas/             # Monitoramento de infrequência e queda abrupta
│   │   ├── atestados/          # Gestão de atestados médicos e dispensas legais
│   │   ├── equipe/             # Allowlist e controle de servidores autorizados da escola
│   │   ├── historico/          # Linha do tempo paginada e triagem IA de retornos
│   │   ├── modelos/            # Biblioteca de comunicados institucionais
│   │   ├── relatorios/         # Indicadores analíticos consolidados
│   │   ├── auditoria/          # Trilha de auditoria imutável com IP e User-Agent
│   │   ├── validar/ata/[code]  # Portal público LGPD de validação de atas
│   │   ├── assinar/ata/[token] # Portal móvel de coleta de assinatura com biometria
│   │   └── api/                # Route Handlers REST serverless
│   ├── components/             # Componentes React reutilizáveis
│   │   ├── ata/                # Editor de atas widescreen, assinatura canvas, modais
│   │   └── ...                 # Modais de importação SERE, diálogos e layout
│   ├── lib/                    # Regras de negócio, segurança e integrações
│   │   ├── auth.ts             # Configuração NextAuth v5 e callbacks JWT
│   │   ├── permissions.ts      # Verificadores de autorização (requireSuperAdmin, etc.)
│   │   ├── currentSchool.ts    # Resolvedor contextual de escola ativa multi-tenant
│   │   ├── ataCrypto.ts        # Motor canônico SHA-256 e hash-chaining de atas
│   │   ├── aiPseudonymizer.ts  # Anonimizador LGPD/ECA pré-chamada ao Gemini
│   │   ├── sereParser.ts       # Parser multiformato (.xls BIFF8, .xlsx, .pdf, .csv)
│   │   ├── whatsappProvider.ts # Formatação e chaveamento mobile/desktop do WhatsApp
│   │   ├── audit.ts            # Registrador de auditoria com IP
│   │   └── prisma.ts           # Instância singleton do Prisma Client
│   └── proxy.ts                # Middleware de borda (Next.js 16 Proxy)
├── prisma/
│   ├── schema.prisma           # Schema declarativo multi-tenant PostgreSQL
│   └── seed.ts                 # Script de carga inicial com os dados da Escola Piloto
├── extension/                  # Extensão Web (Chrome MV3) para sincronização e janela compacta
├── scripts/                    # Scripts de build, empacotamento e migração
└── docs/                       # Documentação técnica e relatórios de engenharia
```

---

## 🛠️ 5. Comandos Essenciais

```bash
# Instalação de dependências
npm install

# Gerar o client do Prisma após alterações no schema
npx prisma generate

# Executar suíte de testes (Vitest)
npm test

# Executar compilação completa de produção (TypeScript + Turbopack)
npm run build

# Iniciar servidor local de desenvolvimento
npm run dev

# Sincronizar schema Prisma com o banco de desenvolvimento
npx prisma db push
```

---

## ⚠️ 6. Armadilhas Conhecidas e Boas Práticas (Gotchas)

1. **Fusos Horários:** O servidor opera em UTC, mas a escola e os atos jurídicos operam no horário de Brasília (`America/Sao_Paulo`, UTC-3). Em formatações de data por extenso de atas e atestados, utilize sempre utilitários com fuso explícito (`-03:00`).
2. **Turbopack e Scripts de Build:** O `npm run build` executa automaticamente `scripts/package_extension.cjs` e `scripts/vercel_db_push.cjs`. Nunca altere arquivos na pasta `public/` diretamente se eles forem artefatos gerados pelo build.
3. **Enum vs. Strings no Prisma:** Campos de papel no banco utilizam strings ou enums compatíveis (`ADMIN`, `SUPERADMIN`, `GESTAO_SECRETARIA`, `GESTOR_ESCOLAR`, `PEDAGOGA`). Sempre utilize os helpers de [`src/lib/roles.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/roles.ts) para checagens de privilégio.
4. **Transações em Mutações Complexas:** Em operações como lavratura de atas, exclusão de escolas ou higienização, use sempre `prisma.$transaction(async (tx) => { ... })` para garantir atomicidade total e prevenir orfandade de registros.
