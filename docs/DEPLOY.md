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

1. No painel da **[Vercel](https://vercel.com/new)**, importe o repositório GitHub (`MarcosWrobel/busca-ativa-lepoldina`).
2. Mantenha o Framework Preset como **Next.js** (região `gru1` já configurada em [`vercel.json`](../vercel.json)).
3. Em **Environment Variables**, configure as variáveis abaixo:

| Variável | Obrigatória | Descrição |
| :--- | :---: | :--- |
| `DATABASE_URL` | Sim | String PostgreSQL Neon **com pooler** (`-pooler`) para consultas da aplicação. |
| `DIRECT_URL` | Sim | String PostgreSQL Neon **direta** (sem pooler) para sincronização DDL do Prisma. |
| `AUTH_SECRET` | Sim | Chave criptográfica HMAC SHA-256 do Auth.js v5 (`openssl rand -base64 32`). |
| `NEXTAUTH_SECRET` | Sim | Mesmo valor de `AUTH_SECRET` (compatibilidade retroativa NextAuth). |
| `NEXTAUTH_URL` | Sim | URL canônica de produção (ex.: `https://busca-ativa-leopoldina.vercel.app`). |
| `AUTH_TRUST_HOST` | Recomendada | Definir como `"true"` para validação de host proxy na Vercel. |
| `GOOGLE_CLIENT_ID` | Sim | Client ID OAuth 2.0 Web Client do Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | Sim | Client Secret OAuth 2.0 correspondente. |
| `ADMIN_EMAIL` | Sim | E-mail institucional do Super Admin global da plataforma. |
| `GEMINI_API_KEY` | Recomendada | Chave da Google Gemini API para redação NRE de atas e classificação de retornos. |
| `CRON_SECRET` | Sim | Segredo Bearer exigido pelo Vercel Cron semanal (`/api/cron/weekly-digest`). |
| `SYNC_API_TOKEN` | Opcional | Token global legado de sincronização (novas escolas usam `syncTokenHash` individual). |
| `WHATSAPP_WEBHOOK_SECRET` | Opcional | Segredo para ativar o endpoint `/api/webhooks/whatsapp` (retorna `503` se omitido). |

4. Ao acionar **Deploy**, o script `npm run build` executará automaticamente:
   - Compactação da extensão universal v1.5.0 (`scripts/package_extension.cjs` -> `public/extensao-leopoldina.zip`);
   - Sincronização segura do schema Prisma com trava `--accept-data-loss=false` (`scripts/vercel_db_push.cjs`);
   - Compilação otimizada Next.js 16 com Turbopack.

---

## 3. Configurar Credenciais OAuth no Google Cloud Console

1. Acesse [Google Cloud Console -> Credentials](https://console.cloud.google.com/apis/credentials).
2. Edite o **ID do cliente OAuth 2.0 (Aplicativo da Web)**:
   - **Origens JavaScript autorizadas**: adicione a URL de produção (ex.: `https://busca-ativa-leopoldina.vercel.app`) e domínios customizados (necessário também para assinatura OIDC `@escola.pr.gov.br` em atas).
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
3. **Instalação do Agente Universal de Sincronização (`v1.5.0`)**:
   - Os operadores baixam `/extensao-leopoldina.zip`, configuram a chave individual da sua escola obtida em `/configuracoes/escola` e conectam seus navegadores ao Power BI, SERP e Janela Compacta do WhatsApp.

---

## 6. Higienização de Homologação

- **Higienizar Escola de Teste (`POST /api/schools/[id]/sanitize`)**: Em `/admin/escolas`, zera estudantes, turmas e atas criados durante testes de implantação em uma nova unidade, preservando o cadastro da escola e seus modelos.
- **Exclusão Segura (`DELETE /api/schools/[id]`)**: Remove em cascata unidades criadas exclusivamente para demonstração (com bloqueio inviolável sobre o INEP `41042730`).
