# Guia de Colaboração & Onboarding de Desenvolvedores — Rede Ativa SaaS

> **Este guia orienta passo a passo como configurar o ambiente de desenvolvimento em um novo computador e como um parceiro de desenvolvimento pode colaborar de forma segura, produtiva e alinhada às práticas do projeto.**

---

## 🚀 1. Pré-Requisitos

Antes de iniciar, certifique-se de ter instalado no seu computador:
- **Node.js**: Versão LTS 20.x ou superior (verifique com `node -v`);
- **npm**: Versão 10.x ou superior (verifique com `npm -v`);
- **Git**: Configurado com seu nome e e-mail (`git config --global user.name` e `user.email`);
- **Acesso ao GitHub**: Ter acesso de colaborador ao repositório [MarcosWrobel/busca-ativa-lepoldina](https://github.com/MarcosWrobel/busca-ativa-lepoldina), preferencialmente com chave SSH configurada.

---

## 💻 2. Setup Inicial Passo a Passo

### Passo 2.1: Clonar o Repositório
No seu terminal:
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
A plataforma utiliza o **Neon PostgreSQL Serverless**. Para desenvolver sem risco de afetar os dados de produção ou a base da **Escola Piloto Leopoldina (689 alunos)**:

1. Acesse o console do **[Neon](https://console.neon.tech)** no projeto da plataforma.
2. Na aba **Branches**, clique em **New Branch**:
   - Dê um nome para a branch (ex: `dev-seu-nome` ou `staging`);
   - Selecione a branch `main` como pai (*parent*).
3. O Neon criará instantaneamente uma cópia isolada do banco (copy-on-write, sem custo adicional).
4. Copie a string de conexão com pooler (`DATABASE_URL`) e a string direta (`DIRECT_URL`).

### Passo 2.4: Criar e Preencher o `.env.local`
Copie o arquivo de exemplo:
```bash
cp .env.example .env.local
```

Abra o `.env.local` e configure as variáveis principais:
```bash
# URLs da aplicação local
NEXTAUTH_URL="http://localhost:3000"

# Chave secreta de sessão (gere com: openssl rand -base64 32)
NEXTAUTH_SECRET="uma-chave-aleatoria-qualquer-para-desenvolvimento"

# Conexões do Neon (sua branch de desenvolvimento gerada no passo 2.3)
DATABASE_URL="postgresql://neondb_owner:senha@ep-xyz-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://neondb_owner:senha@ep-xyz.sa-east-1.aws.neon.tech/neondb?sslmode=require"

# Super Admin da plataforma
ADMIN_EMAIL="marcos.wrobel@escola.pr.gov.br"

# Habilita autenticação rápida para desenvolvimento sem precisar de Google OAuth
ENABLE_DEV_AUTH="true"
NODE_ENV="development"

# Chaves opcionais para testes de IA e sincronização
GEMINI_API_KEY="" # Chave da Google Gemini API (opcional para rodar local)
SYNC_API_TOKEN="token-para-testes-locais"
CRON_SECRET="segredo-para-testes-locais"
```

### Passo 2.5: Gerar o Client do Prisma
Gere os tipos do Prisma mapeados no schema:
```bash
npx prisma generate
```

*(Opcional)* Se estiver iniciando em um banco Neon totalmente novo e vazio, sincronize o schema e popule a base da Escola Piloto:
```bash
npx prisma db push
npm run seed
```

### Passo 2.6: Iniciar o Servidor Local
```bash
npm run dev
```
Acesse no seu navegador: **[http://localhost:3000](http://localhost:3000)**.

---

## 🔑 3. Login e Autenticação em Desenvolvimento

Com a flag `ENABLE_DEV_AUTH="true"` ativa no seu `.env.local`, você não precisa de credenciais do Google Cloud Console para testar:

1. Acesse `http://localhost:3000/login`.
2. A página exibirá opções rápidas de login simulado para homologação:
   - **Super Admin**: `marcos.wrobel@escola.pr.gov.br` (acesso a `/admin` e visão global);
   - **Gestor da Escola**: e-mail com vínculo de direção (acesso a `/gestao`);
   - **Equipe Pedagógica**: e-mail com perfil pedagoga (acesso a `/busca-ativa`).

*(Essa opção é estritamente bloqueada em produção pelo `NODE_ENV === "production"` e pelo proxy de borda).*

---

## 🌿 4. Fluxo de Trabalho no Git (Git Flow Colaborativo)

Para manter a branch `main` sempre estável e pronta para deploy contínuo na Vercel, adotamos o modelo de **Feature Branches com Validação Obrigatória**:

```mermaid
gitGraph
   commit id: "main-base"
   branch feature/nova-funcionalidade
   checkout feature/nova-funcionalidade
   commit id: "desenvolvimento"
   commit id: "testes-vitest"
   checkout main
   merge feature/nova-funcionalidade id: "PR-Aprovado"
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
   # ou para correção de bugs:
   # git checkout -b fix/descricao-do-bug
   ```
3. **Desenvolva seguindo as diretrizes de código:**
   - Leia o [AI_CONTEXT.md](file:///home/marcoswrobel/Documents/Registro/AI_CONTEXT.md) para alinhar as regras de negócio;
   - Respeite o isolamento multi-tenant por `schoolId`;
   - Se alterar modelos de banco em `prisma/schema.prisma`, execute `npx prisma db push` na sua branch Neon de desenvolvimento.
4. **Execute a Validação Obrigatória (Checklist de Qualidade):**
   ```bash
   # 1. Executar os 96 testes automatizados
   npm test

   # 2. Executar a compilação de produção do Next.js
   npm run build
   ```
   > ⚠️ **Nenhum commit deve ser enviado se houver falhas em testes ou no build.**
5. **Envie sua branch para o GitHub e abra um Pull Request:**
   ```bash
   git add -A
   git commit -m "feat(modulo): descricao clara da melhoria"
   git push origin feature/nome-da-funcionalidade
   ```
6. **No GitHub**, abra um **Pull Request (PR)** apontando para a branch `main`.

---

## 🧠 5. Integração com Ferramentas de IA (Cursor, Copilot, Antigravity)

O repositório já conta com regras e arquivos pré-configurados para leitura automática de contexto:
- **Cursor IDE**: O arquivo `.cursorrules` na raiz carrega automaticamente as 7 Regras de Ouro e o contexto do `AI_CONTEXT.md`.
- **GitHub Copilot**: O arquivo `.github/copilot-instructions.md` instrui o assistente sobre o padrão Next.js 16 e conformidade LGPD.
- **Outros Assistentes (ChatGPT, Claude, etc.)**: Basta copiar e colar o **Bloco de Inicialização Rápida** presente no topo do [AI_CONTEXT.md](file:///home/marcoswrobel/Documents/Registro/AI_CONTEXT.md).

---

## 📌 6. Resumo das Regras de Ouro
1. **Nunca apagar o Leopoldina**: O INEP `41042730` é a unidade sede permanente.
2. **Multi-Tenancy Obrigatório**: Sempre vincular queries e mutações ao `schoolId`.
3. **Fé Pública nas Atas**: Atas lavradas são imutáveis; retificações exigem termo aditivo encadeado (*"Em tempo"*).
4. **LGPD / ECA**: Anonimizar dados de estudantes antes de chamadas ao Google Gemini.
5. **Portão de Qualidade**: `npm test` e `npm run build` sempre verdes antes de abrir PR.
