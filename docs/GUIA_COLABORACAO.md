# Guia de Colaboração & Onboarding de Desenvolvedores — Rede Ativa SaaS

> **Este guia orienta passo a passo como configurar o ambiente de desenvolvimento em um novo computador e colaborar de forma segura, produtiva e alinhada às práticas arquiteturais do projeto.**

---

## 🚀 1. Pré-Requisitos

Antes de iniciar, certifique-se de ter instalado no seu computador:
- **Node.js**: Versão LTS 20.x ou superior (verifique com `node -v`);
- **npm**: Versão 10.x ou superior (verifique com `npm -v`);
- **Git**: Configurado com seu nome e e-mail (`git config --global user.name` e `user.email`);
- **Acesso ao GitHub**: Acesso de colaborador ao repositório [MarcosWrobel/busca-ativa-lepoldina](https://github.com/MarcosWrobel/busca-ativa-lepoldina), preferencialmente com chave SSH configurada.

---

## 💻 2. Setup Inicial Passo a Passo

### Passo 2.1: Clonar o Repositório
```bash
git clone git@github.com:MarcosWrobel/busca-ativa-lepoldina.git
# ou via HTTPS:
# git clone https://github.com/MarcosWrobel/busca-ativa-lepoldina.git

cd busca-ativa-lepoldina
```

### Passo 2.2: Instalar as Dependências
```bash
npm install
```

### Passo 2.3: Configurar o Banco de Dados (Estratégia Neon Branching)
A plataforma utiliza o **Neon PostgreSQL Serverless**. Para desenvolver sem qualquer risco de afetar os dados de produção ou a base da **Escola Piloto Leopoldina (689 alunos)**:

1. Acesse o console do **[Neon](https://console.neon.tech)** no projeto da plataforma.
2. Na aba **Branches**, clique em **New Branch**:
   - Dê um nome para a branch (ex.: `dev-seu-nome` ou `staging`);
   - Selecione a branch `main` como pai (*parent*).
3. O Neon criará instantaneamente uma cópia isolada do banco (*copy-on-write*).
4. Copie a string de conexão com pooler (`DATABASE_URL`) e a string direta (`DIRECT_URL`).

### Passo 2.4: Criar e Preencher o `.env.local`
Copie o arquivo de exemplo:
```bash
cp .env.example .env.local
```

Abra o `.env.local` e configure as variáveis principais (atenção à porta **`3001`**, definida em `package.json`):
```bash
# URL da aplicação local (npm run dev utiliza -p 3001)
NEXTAUTH_URL="http://localhost:3001"

# Chaves secretas de sessão (gere com: openssl rand -base64 32)
AUTH_SECRET="uma-chave-aleatoria-qualquer-para-desenvolvimento"
NEXTAUTH_SECRET="uma-chave-aleatoria-qualquer-para-desenvolvimento"

# Conexões do Neon (sua branch isolada de desenvolvimento gerada no passo 2.3)
DATABASE_URL="postgresql://neondb_owner:senha@ep-xyz-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://neondb_owner:senha@ep-xyz.sa-east-1.aws.neon.tech/neondb?sslmode=require"

# Super Admin para testes locais
ADMIN_EMAIL="seu.nome@escola.pr.gov.br"

# Habilita autenticação rápida em desenvolvimento sem precisar de Google OAuth
ENABLE_DEV_AUTH="true"
NODE_ENV="development"

# Chaves opcionais para testes de IA e sincronização
GEMINI_API_KEY="" # Opcional localmente (o sistema possui fallback determinístico offline)
SYNC_API_TOKEN="token-para-testes-locais"
CRON_SECRET="segredo-para-testes-locais"
```

### Passo 2.5: Gerar o Client do Prisma
```bash
npx prisma generate
```

*(Opcional)* Se estiver iniciando em um banco Neon totalmente vazio, sincronize o schema e popule a carga inicial (`scripts/seed.cjs`):
```bash
npx prisma db push
npm run seed
```

### Passo 2.6: Iniciar o Servidor Local
```bash
npm run dev
```
Acesse no seu navegador: **[http://localhost:3001](http://localhost:3001)**.

---

## 🔑 3. Login e Autenticação em Desenvolvimento

Com a flag `ENABLE_DEV_AUTH="true"` ativa no `.env.local`, você não precisa de credenciais do Google Cloud Console para homologar localmente:

1. Acesse `http://localhost:3001/login`.
2. Utilize o formulário de login rápido de homologação com contas `@escola.pr.gov.br` cadastradas na sua branch de desenvolvimento:
   - **Super Admin**: e-mail configurado em `ADMIN_EMAIL` (acesso a `/admin` e visão global);
   - **Gestor da Escola**: e-mail com papel `GESTOR_ESCOLAR` (acesso a `/gestao`);
   - **Equipe Pedagógica**: e-mail com papel `PEDAGOGA` (acesso a `/busca-ativa`).

*(Esse provider é bloqueado automaticamente em produção por `NODE_ENV === "production"`).*

---

## 🌿 4. Fluxo de Trabalho no Git (Feature Branches + Quality Gate)

Para manter a branch `main` sempre estável para deploy contínuo na Vercel, adotamos **Feature Branches com Portão de Qualidade Obrigatório**:

```mermaid
flowchart LR
    M1["main (atualizada)"] --> FB["feature/minha-melhoria"]
    FB --> DEV["Implementação + Testes Vitest"]
    DEV --> QG{"npm test && npm run build"}
    QG -->|100% Verde| PR["Pull Request -> main"]
```

### Passo a Passo de um Ciclo de Trabalho:
1. **Atualize sua branch local com a `main`:**
   ```bash
   git checkout main
   git pull origin main
   ```
2. **Crie uma branch específica para a sua tarefa:**
   ```bash
   git checkout -b feature/nome-da-funcionalidade
   # ou para correção:
   # git checkout -b fix/descricao-do-bug
   ```
3. **Desenvolva seguindo as diretrizes canônicas:**
   - Consulte [`AI_CONTEXT.md`](../AI_CONTEXT.md) e [`docs/ARQUITETURA_E_ENGENHARIA.md`](./ARQUITETURA_E_ENGENHARIA.md);
   - Respeite o isolamento multi-tenant por `schoolId` e `assertTenantOwnership(...)`;
   - Se alterar modelos em `prisma/schema.prisma`, execute `npx prisma db push` apenas na sua **branch Neon de desenvolvimento**.
4. **Execute a Validação Obrigatória (Portão de Qualidade):**
   ```bash
   # 1. Executar toda a suíte Vitest (364 testes em 52 suítes, incluindo adversarialQa.test.ts e atasArchiveUsability.test.ts)
   npm test

   # 2. Executar a compilação estrita de produção (Next.js 16 + Turbopack)
   npm run build
   ```
   > [!IMPORTANT]
   > Nenhum commit ou Pull Request deve ser enviado com falhas em `npm test` ou `npm run build`.
5. **Envie sua branch e abra um Pull Request:**
   ```bash
   git add -A
   git commit -m "feat(modulo): descricao clara da melhoria"
   git push origin feature/nome-da-funcionalidade
   ```

---

## 🧠 5. Integração com Ferramentas de IA (Antigravity, Cursor, Copilot)

O repositório mantém instruções sincronizadas com a fonte canônica [`AI_CONTEXT.md`](../AI_CONTEXT.md):
- **Google Antigravity / Gemini**: [`GEMINI.md`](../GEMINI.md) na raiz + skill especializada de auditoria em [`.agents/skills/multi-tenant-security-audit/SKILL.md`](../.agents/skills/multi-tenant-security-audit/SKILL.md).
- **Cursor IDE**: [`.cursorrules`](../.cursorrules) na raiz.
- **GitHub Copilot**: [`.github/copilot-instructions.md`](../.github/copilot-instructions.md).
- **Outros Assistentes (ChatGPT, Claude, etc.)**: Copie o **Bloco de Inicialização Rápida** no topo de [`AI_CONTEXT.md`](../AI_CONTEXT.md).

---

## 📌 6. Resumo das Regras de Ouro
1. **Nunca apagar ou resetar o Leopoldina**: O INEP `41042730` é a unidade piloto fundadora permanente.
2. **Multi-Tenancy Estrito**: Filtrar queries por `schoolId`, validar `active_school_id`, checar FKs e aplicar `assertTenantOwnership(...)` em APIs e SSR.
3. **Fé Pública nas Atas**: Atas `FINALIZED` são imutáveis; exigem PIN do servidor na lavratura e adendos encadeados (*"Em tempo"*) para retificações.
4. **LGPD / ECA**: Sempre pseudonimizar dados de menores via `src/lib/aiPseudonymizer.ts` antes de chamadas ao Google Gemini.
5. **Portão de Qualidade**: `npm test` e `npm run build` 100% verdes antes de qualquer PR.
