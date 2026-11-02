# Guia de Implantação e Operação: Rede Ativa SaaS
## Plataforma Multi-Escola com Unidade Piloto Fundadora (C.E. Leopoldina B. Pedroso)

Este guia orienta o processo de deploy, configuração em nuvem e provisionamento de redes e escolas na plataforma **Rede Ativa SaaS** utilizando Next.js 16 na **Vercel** e **PostgreSQL Serverless** na AWS São Paulo (`sa-east-1`).

---

## 1. Banco de Dados Multi-Tenant na Nuvem (Neon PostgreSQL Serverless)

A plataforma utiliza o Neon PostgreSQL Serverless em São Paulo (`sa-east-1`) para garantir baixa latência (<60ms) e alta escalabilidade:

1. Acesse **[neon.tech](https://neon.tech)** e crie uma conta institucional.
2. Crie um novo projeto (ex: `rede-ativa-saas`) selecionando a região **AWS São Paulo (sa-east-1)**.
3. Copie a string de conexão com pooler (`DATABASE_URL`) e a string direta sem pooler (`DIRECT_URL`). Exemplo:
   ```
   DATABASE_URL="postgresql://neondb_owner:senha@ep-xyz-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
   DIRECT_URL="postgresql://neondb_owner:senha@ep-xyz.sa-east-1.aws.neon.tech/neondb?sslmode=require"
   ```

---

## 2. Repositório e Deploy Contínuo na Vercel

1. No painel da **[Vercel](https://vercel.com/new)**, importe o repositório GitHub do projeto (`MarcosWrobel/busca-ativa-lepoldina`).
2. Defina o Framework Preset como **Next.js**.
3. Na seção **Environment Variables**, configure as variáveis mandatórias:

| Variável | Descrição / Exemplo |
| :--- | :--- |
| `DATABASE_URL` | String de conexão do PostgreSQL Neon com pooler. |
| `DIRECT_URL` | String de conexão direta sem pooler para migrações de schema DDL. |
| `NEXTAUTH_SECRET` | Chave criptográfica HMAC SHA-256 (gerada com `openssl rand -base64 32`). |
| `NEXTAUTH_URL` | URL de produção (ex.: `https://busca-ativa-leopoldina.vercel.app`). |
| `GOOGLE_CLIENT_ID` | Client ID OAuth 2.0 do Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google Cloud Console. |
| `ADMIN_EMAIL` | E-mail do Super Admin da plataforma (`marcos.wrobel@escola.pr.gov.br`). |
| `CRON_SECRET` | Segredo para execução do cron semanal Vercel (`/api/cron/weekly-digest`). |
| `GEMINI_API_KEY` | Chave oficial Google Gemini API para redação e formalização de atas e retornos. |

4. Clique em **Deploy**. O pipeline automatizado executará:
   - Compactação da extensão universal (`scripts/package_extension.cjs`);
   - Sincronização segura do schema Prisma (`scripts/vercel_db_push.cjs`);
   - Compilação otimizada Next.js com Turbopack.

---

## 3. Configurar Credenciais OAuth no Google Cloud Console

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
2. Edite o **ID do cliente OAuth 2.0 Web Client**.
3. Em **Origens JavaScript autorizadas**, adicione:
   - `https://busca-ativa-leopoldina.vercel.app` (e seus domínios customizados).
4. Em **URIs de redirecionamento autorizados**, adicione:
   - `https://busca-ativa-leopoldina.vercel.app/api/auth/callback/google`
5. Salve as alterações.

---

## 4. Estrutura Inicial e Unidade Piloto Fundadora

Ao inicializar o banco pela primeira vez, a plataforma cria automaticamente a **Unidade Piloto Fundadora**:
- **Escola**: Colégio Estadual Leopoldina B. Pedroso
- **INEP**: `41042730`
- **Município / UF**: Tibagi - PR
- **Rede**: Estadual (SEED-PR / NRE Ponta Grossa)

Para popular a base histórica da escola piloto com os estudantes e mensagens consolidadas:
```bash
DATABASE_URL="sua-string-do-neon" npm run seed
```

A base do Leopoldina permanecerá protegida por travas no código contra exclusão ou higienização involuntária, servindo como o ambiente padrão de calibração para novas escolas.

---

## 5. Provisionamento de Novas Redes e Escolas (SaaS)

Com o Super Admin autenticado, a expansão para novas escolas e redes municipais é realizada diretamente pela interface web:

1. **Cadastrar Rede Municipal (SEMEC)**:
   - Acesse `/admin/escolas` e cadastre uma nova rede mantenedora municipal (ex.: `Secretaria Municipal de Educação de Tibagi - SEMEC`).
2. **Adicionar Escolas à Rede**:
   - Cadastre a instituição informando Nome, Código INEP oficial, Cidade, UF e Rede (`MUNICIPAL`, `ESTADUAL` ou `PRIVADA`).
   - O sistema gerará automaticamente o pacote inicial de modelos pedagógicos e atribuirá uma chave exclusiva de sincronização (`syncTokenHash`).
3. **Vincular Gestores e Equipe**:
   - No painel `/admin` ou `/equipe`, cadastre os e-mails institucionais dos diretores (`GESTOR_ESCOLAR`), pedagogos (`PEDAGOGA`) ou secretários municipais (`GESTAO_SECRETARIA`).
4. **Instalar o Agente Universal de Sincronização**:
   - Os operadores da nova escola baixam o arquivo ZIP em `/extensao-leopoldina.zip`, inserem a chave da sua escola em `/configuracoes/escola` e conectam seus navegadores com o B.I. e portais de frequência.

---

## 6. Higienização de Homologação e Ciclos Letivos

- **Limpar Dados de Homologação**: No `/admin/escolas` ou `/admin`, clique em **Higienizar** para zerar estudantes e turmas criados para testes em uma nova escola, preservando seus modelos e cadastro.
- **Exclusão Definitiva**: Escolas criadas por engano podem ser removidas em cascata via botão **Excluir** (com proteção inviolável da escola sede piloto).

---

*Rede Ativa SaaS — Documentação de Implantação e Operação Multi-Tenant.*
