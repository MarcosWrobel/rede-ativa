# Guia de Implantação e Operação Cloud — Rede Ativa SaaS

> **Plataforma Multi-Escola com Unidade Piloto Fundadora (C.E. Leopoldina B. Pedroso — INEP `41042730`)**

Este guia documenta o processo de implantação em produção, configuração de variáveis de ambiente e provisionamento de novas redes e escolas utilizando **Next.js 16 na Vercel (`gru1`)** e **Neon PostgreSQL Serverless (`sa-east-1`)**.

---

## 1. Banco de Dados Multi-Tenant na Nuvem (Neon PostgreSQL Serverless)

A plataforma utiliza o Neon PostgreSQL Serverless em São Paulo (`sa-east-1`) para assegurar baixa latência (~60ms) entre as funções serverless da Vercel (`gru1`) e o banco:

1. Acesse **[neon.tech](https://neon.tech)** e crie o projeto (ex.: `rede-ativa-saas`) na região **AWS São Paulo (`sa-east-1`)**.
2. Copie a string de conexão com pooler (`DATABASE_URL`) e a string direta sem pooler (`DIRECT_URL`):
   ```bash
   DATABASE_URL="postgresql://neondb_owner:senha@ep-xyz-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
   DIRECT_URL="postgresql://neondb_owner:senha@ep-xyz.sa-east-1.aws.neon.tech/neondb?sslmode=require"
   ```

---

## 2. Repositório e Deploy Contínuo na Vercel

1. No painel da **[Vercel](https://vercel.com/new)**, importe o repositório GitHub (`MarcosWrobel/rede-ativa`).
2. Mantenha o Framework Preset como **Next.js** (região `gru1` já configurada em [`vercel.json`](../vercel.json)).
3. Em **Environment Variables**, configure as variáveis abaixo:

| Variável | Obrigatória | Descrição |
| :--- | :---: | :--- |
| `DATABASE_URL` | Sim | String PostgreSQL Neon **com pooler** (`-pooler`) para consultas da aplicação. |
| `DIRECT_URL` | Sim | String PostgreSQL Neon **direta** (sem pooler) para sincronização DDL do Prisma. |
| `AUTH_SECRET` | Sim | Chave criptográfica HMAC SHA-256 do Auth.js v5 (`openssl rand -base64 32`). |
| `NEXTAUTH_SECRET` | Sim | Mesmo valor de `AUTH_SECRET` (compatibilidade retroativa NextAuth). |
| `NEXTAUTH_URL` | Sim | URL canônica de produção (`https://www.redeativa.app.br`; `src/proxy.ts` redireciona o apex para `www`). |
| `NEXT_PUBLIC_APP_URL` | Recomendada | URL pública canônica (`https://www.redeativa.app.br`) usada em QR Codes e portais de assinatura. |
| `AUTH_TRUST_HOST` | Recomendada | Definir como `"true"` para validação de host proxy na Vercel. |
| `GOOGLE_CLIENT_ID` | Sim | Client ID OAuth 2.0 Web Client do Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | Sim | Client Secret OAuth 2.0 correspondente. |
| `ADMIN_EMAIL` | Sim | E-mail institucional do Super Admin global da plataforma. |
| `GEMINI_API_KEY` | Recomendada (uso estrito no servidor) | Chave exclusiva do servidor para a Google Gemini API, consumida **apenas** por `POST /api/ai/formalize-ata` quando habilitado globalmente no servidor (`AI_FORMALIZE_EXTERNAL_ENABLED="true"`) e na escola pelo painel `/admin/escolas` → Política de IA (a classificação de retornos de WhatsApp executa 100% localmente em todas as escolas). |
| `AI_FORMALIZE_EXTERNAL_ENABLED` | Opcional (`"false"` padrão) | Controle geral exclusivo do servidor para o fluxo externo de formalização de atas (`"true"` / `"false"`), mantendo obrigatória a ativação por escola via `aiExternalFormalizeEnabled` em `/admin/escolas`. |
| `AI_FORMALIZE_ALLOWED_SCHOOL_IDS` | Obsoleta em runtime (entrada da transição) | Substituída pela autorização individual por escola gerenciada pelo `SUPERADMIN` no painel `/admin/escolas` → Política de IA (`settingsJson.aiExternalFormalizeEnabled` sob `aiExternalFormalizePolicyVersion: 2`). Na atualização de ambientes legados, execute a transição idempotente `node scripts/transition_ai_policy_to_panel.mjs` com `AI_FORMALIZE_ALLOWED_SCHOOL_IDS` preenchida antes de removê-la: escolas ligadas e presentes na lista preservam o estado ativo; escolas fora da lista (ou sem lista confiável) e escolas sem versão migrada permanecem fail-closed em modo local até ativação explícita no painel. |
| `CRON_SECRET` | Sim | Segredo Bearer exigido pelo Vercel Cron semanal (`/api/cron/weekly-digest`). |
| `SYNC_API_TOKEN` | Opcional | Token global legado de sincronização (o padrão por escola usa `syncTokenHash` individual). |
| `WHATSAPP_WEBHOOK_SECRET` | Opcional | Segredo para ativar o endpoint `/api/webhooks/whatsapp` (retorna `503` se omitido). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | Opcional | Credenciais AWS S3 / Cloudflare R2 para armazenamento externo de vias físicas (fallback em PostgreSQL se ausente). |
| `BLOB_READ_WRITE_TOKEN` | Opcional | Token do driver Vercel Blob REST (alternativa ao S3/R2 em `objectStorage.ts`). |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Opcional | Credenciais Upstash Redis REST para rate limit distribuído em borda (fallback em PostgreSQL se ausente). |

4. Ao acionar **Deploy**, o script `npm run build` executará automaticamente:
   - Compactação da extensão universal `v1.7.0` (`scripts/package_extension.cjs` -> `public/extensao-rede-ativa.zip`, mantendo `public/extensao-leopoldina.zip` automaticamente no build como alias de retrocompatibilidade);
   - Compilação otimizada Next.js 16 com Turbopack (conforme [`package.json`](../package.json), o build não executa `db push` automático).
5. A evolução de banco de dados ocorre separadamente por migrations declarativas em `prisma/migrations/` utilizando `DIRECT_URL`:
   - Valide o schema com `npx prisma validate`, inspecione o estado com `npx prisma migrate status` e aplique explicitamente com `npm run db:migrate:deploy`.
6. **Governança de Row-Level Security (RLS):** A adoção progressiva de RLS no PostgreSQL é regida por [`docs/arquitetura/ADR_001_ADOCAO_PROGRESSIVA_RLS.md`](arquitetura/ADR_001_ADOCAO_PROGRESSIVA_RLS.md). Scripts experimentais em `lab/rls-pilot/` não pertencem a `prisma/migrations/` e não devem ser aplicados automaticamente em produção; a Onda 1 segue para homologação própria em staging Neon com `app_runtime`, pooler em modo transacional e duas escolas sintéticas.
7. **Controle de IA Externa por Escola (`/admin/escolas` e `/api/schools/[id]/ai-policy`):** A formalização externa em `POST /api/ai/formalize-ata` exige cumulativamente habilitação geral no servidor (`AI_FORMALIZE_EXTERNAL_ENABLED="true"` e `GEMINI_API_KEY` configurada) **e** autorização confirmada sob o controle por painel da unidade (`aiExternalFormalizeEnabled === true` com `aiExternalFormalizePolicyVersion === 2`) via `PATCH /api/schools/[id]/ai-policy` ou via script idempotente de transição (`node scripts/transition_ai_policy_to_panel.mjs`), desligada por padrão em todas as escolas novas e alterável exclusivamente por `SUPERADMIN`. Antes da transição ou caso a flag legada não possua confirmação de versão/lista confiável, a política falha fechado em modo local, impedindo ativação inadvertida de unidades que estavam fora de `AI_FORMALIZE_ALLOWED_SCHOOL_IDS`. Reexecuções do script ignoram escolas já controladas pelo painel (`aiExternalFormalizePolicyVersion === 2`) e preservam demais chaves de `settingsJson`. A rota `PATCH /api/schools/[id]/ai-policy` persiste a alteração em `settingsJson` (com trava otimista CAS compartilhada com `syncTokenEncrypted` e `409 Conflict` para versão obsoleta) junto à auditoria `UPDATE_SCHOOL_AI_POLICY` na mesma transação (`prisma.$transaction`) registrando escola, operador, data e estados anterior e novo, com rollback completo na falha de auditoria ao ativar (`false -> true`), preservando bloqueio global emergencial e resiliência do desligamento emergencial (`true -> false`). O contrato de aceite institucional versionado será acrescentado ao painel em etapa posterior. Quando `minuteId` é informado, `POST /api/ai/formalize-ata` restringe a consulta inicial de metadados à escola autorizada e valida escola, sigilo (`canAccessConfidentialMinute`) e estado `DRAFT` antes de carregar participantes, vinculando a segunda leitura ao mesmo estado autorizado (versão `updatedAt`, `status`, `isConfidential` e autoria) e encerrando com `409` genérico (inclusive no modo local) caso haja mudança concorrente. A rota revalida a política vigente antes de cada chamada a `models.generateContent` e à alternativa `interactions.create(..., { maxRetries: 0 })` (com `store: false` e sem retentativas internas do SDK); sempre que configuração, escopo ou elegibilidade textual não puderem ser confirmados, conclui exclusivamente no gerador local, mantendo a classificação e o registro de retornos do WhatsApp 100% locais em todas as escolas.

---

## 3. Configurar Credenciais OAuth no Google Cloud Console

1. Acesse [Google Cloud Console -> Credentials](https://console.cloud.google.com/apis/credentials).
2. Edite o **ID do cliente OAuth 2.0 (Aplicativo da Web)**:
   - **Origens JavaScript autorizadas**: adicione a URL canônica de produção (`https://www.redeativa.app.br`) e eventuais domínios de preview/customizados (necessário também para assinatura OIDC `@escola.pr.gov.br` em atas).
   - **URIs de redirecionamento autorizados**: adicione `https://<seu-dominio>/api/auth/callback/google`.

---

## 4. Unidade Piloto Fundadora & Carga Inicial

Na inicialização de um ambiente novo, o sistema assegura a existência da **Unidade Piloto Fundadora** (`Colégio Estadual Leopoldina B. Pedroso` — INEP `41042730`). Para popular um ambiente de homologação vazio:

```bash
DATABASE_URL="sua-string-do-neon" npm run seed
```

> [!CAUTION]
> Nunca execute scripts de carga manual apontando para a branch `main` de produção do Neon. A base da Escola Piloto possui travas atômicas no código contra exclusão ou higienização (`403 Forbidden`).

---

## 5. Provisionamento de Novas Redes e Escolas (SaaS)

Com o `SUPERADMIN` autenticado, a adesão de novas redes municipais (SEMEC) e escolas ocorre diretamente pela interface web:

1. **Via Wizard Guiado (`/onboarding`) ou Diretório (`/admin/escolas`)**:
   - Cadastre a rede mantenedora (`EducationNetwork`) ou a escola (`School`) informando Nome, INEP, Município, UF e Rede (`MUNICIPAL`, `ESTADUAL` ou `PRIVADA`);
   - Configure o brasão oficial com pré-visualização A4 em tempo real, importe a carga inicial SERE e gere o token exclusivo da extensão (`syncTokenHash`).
2. **Credenciamento de Gestores e Equipe (`/admin` ou `/equipe`)**:
   - Cadastre os e-mails institucionais dos secretários municipais (`GESTAO_SECRETARIA`), diretores (`GESTOR_ESCOLAR`) e equipe pedagógica (`PEDAGOGA`).
3. **Instalação do Agente Universal de Sincronização (`v1.7.0` — Edição `PILOTO_INTEGRADA`)**:
   - Os operadores baixam `/extensao-rede-ativa.zip` (sendo `/extensao-leopoldina.zip` mantido automaticamente no build como alias de retrocompatibilidade), configuram a chave individual da sua escola obtida em `/configuracoes/escola` e conectam seus navegadores ao Power BI, SERP e Janela Compacta do WhatsApp.

---

## 6. Higienização de Homologação

- **Higienizar Escola de Teste (`POST /api/schools/[id]/sanitize`)**: Em `/admin/escolas`, zera estudantes, turmas e atas criados durante testes de implantação em uma nova unidade, preservando o cadastro da escola e seus modelos.
- **Exclusão Segura (`DELETE /api/schools/[id]`)**: Remove em cascata unidades criadas exclusivamente para demonstração (com bloqueio inviolável sobre o INEP `41042730`).
