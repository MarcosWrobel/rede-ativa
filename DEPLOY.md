# Guia de Implantação: Vercel + PostgreSQL na Nuvem (Colégio Leopoldina)

Este guia orienta o processo de deploy do **Sistema de Busca Ativa & Comunicação Escolar** na Vercel com banco de dados PostgreSQL persistente na nuvem.

---

## 1. Criar o Banco PostgreSQL Gratuito (Supabase ou Neon)

Como a Vercel opera em ambiente serverless, o banco de dados deve estar hospedado em nuvem:

### Opção A: Supabase (Recomendado)
1. Acesse **[supabase.com](https://supabase.com)** e crie uma conta gratuita.
2. Clique em **"New project"** e defina um nome (ex: `busca-ativa-leopoldina`) e uma senha forte para o banco.
3. Escolha a região `São Paulo (South America)` para menor latência.
4. Após criar, vá em **Project Settings** > **Database** > **Connection string** > **URI** (selecione o modo **Transaction** ou **Session**).
5. Copie a URL gerada (substituindo `[YOUR-PASSWORD]` pela senha definida). Exemplo:
   ```
   postgresql://postgres.xxxx:sua_senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require
   ```

### Opção B: Neon
1. Acesse **[neon.tech](https://neon.tech)**, crie uma conta e crie um novo projeto.
2. Copie a string de conexão direta exibida no dashboard.

---

## 2. Subir o Código para o GitHub

O repositório Git local já foi inicializado e commitado na branch `main`.

1. Acesse **[github.com/new](https://github.com/new)** e crie um novo repositório **Privado** (ex: `busca-ativa-leopoldina`).
2. No seu terminal, vincule o repositório remoto e faça o push:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/busca-ativa-leopoldina.git
   git push -u origin main
   ```

---

## 3. Conectar e Publicar na Vercel

1. Acesse **[vercel.com/new](https://vercel.com/new)**.
2. Selecione o repositório `busca-ativa-leopoldina` importado do GitHub.
3. Na seção **Environment Variables**, adicione as seguintes variáveis:
   - `DATABASE_URL`: Cole a string de conexão do PostgreSQL (obtida no Passo 1).
   - `NEXTAUTH_SECRET`: Uma string aleatória longa ou gerada com `openssl rand -base64 32`.
   - `NEXTAUTH_URL`: `https://busca-ativa-leopoldina.vercel.app` (ou o domínio que a Vercel atribuir).
   - `GOOGLE_CLIENT_ID`: Seu Client ID do Google Cloud Console.
   - `GOOGLE_CLIENT_SECRET`: Seu Client Secret do Google Cloud Console.
   - `ADMIN_EMAIL`: E-mail institucional do administrador principal (ex: `marcos.wrobel@escola.pr.gov.br`).
   - `SYNC_API_TOKEN`: Token secreto exigido pela Extensão Chrome para sincronizar Power BI e SERP (gere com `openssl rand -hex 24`).
4. Clique em **Deploy**. A Vercel executará automaticamente `prisma generate` e `next build`.

---

## 4. Popular o Banco na Nuvem com os Dados Migrados das Planilhas

Com a URL do banco PostgreSQL em mãos, execute os dois comandos abaixo no seu computador para sincronizar o schema e transferir os **688 alunos**, **3.323 históricos de envios**, turmas e modelos para o banco da nuvem:

```bash
# 1. Cria as tabelas no PostgreSQL da nuvem
DATABASE_URL="sua-string-do-supabase-ou-neon" npx prisma db push

# 2. Popula todos os dados históricos das 3 planilhas
DATABASE_URL="sua-string-do-supabase-ou-neon" npm run seed
```

---

## 5. Configurar o Google Cloud Console para o Domínio da Vercel

No [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
1. Edite seu **ID do cliente OAuth 2.0**.
2. Em **Origens JavaScript autorizadas**, adicione:
   - `https://seu-projeto.vercel.app`
3. Em **URIs de redirecionamento autorizados**, adicione:
   - `https://seu-projeto.vercel.app/api/auth/callback/google`
4. Salve as alterações.
