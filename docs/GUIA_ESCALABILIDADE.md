# Guia de Escalabilidade e Infraestrutura de Alta Disponibilidade — Rede Ativa SaaS

> **Sistema:** Rede Ativa SaaS — Plataforma Educacional Multi-Escola & Livro Oficial Digital de Atas  
> **Status Operacional:** **100% Scale-Ready (Pronto para Expansão Multi-Rede)**  
> **Unidade Piloto Fundadora:** Colégio Estadual Leopoldina B. Pedroso (INEP `41042730`) — NRE Ponta Grossa / Tibagi (SEED-PR)  
> **Edição:** 1.0 · **Data:** 06/11/2026  
> **Referência:** Complementar a [`docs/ARQUITETURA_E_ENGENHARIA.md`](ARQUITETURA_E_ENGENHARIA.md) e [`docs/BACKLOG.md`](BACKLOG.md).

---

## 1. Visão Geral: Por que o Sistema é "Scale-Ready"?

A plataforma foi arquitetada sob o modelo **Monólito Modular Serverless Multi-Tenant**. Isso significa que, do ponto de vista de código e arquitetura de dados, **uma única escola piloto ou uma rede com 500 escolas operam sobre a mesma base lógica**, sem necessidade de refatorações estruturais ou criação de novas instâncias de banco de dados para cada instituição.

### Princípio do Desacoplamento Zero-Custo no Presente / Alta Escala no Futuro:
1. **Ambiente Piloto Atual (Custo Zero Adicional):**
   - Roda 100% sobre o **Neon PostgreSQL Serverless (AWS `sa-east-1`)** e **Vercel Serverless (`gru1`)**.
   - Rate limiting opera de forma híbrida distribuída utilizando a tabela atômica `RateLimitBucket` no PostgreSQL + cache L1 local.
   - Vias físicas digitalizadas de atas são persistidas em Base64 na coluna `physicalSignedScanData` com custódia de integridade `physicalScanSha256`.
   - Nenhuma conta externa (AWS S3, Cloudflare, Upstash) é necessária para a operação plena da escola piloto.
2. **Ambiente de Grande Escala (Plug-and-Play sem Alteração de Código):**
   - O código possui **sensores de ambiente automáticos**: basta preencher as variáveis correspondentes no painel da Vercel para descarregar arquivos pesados para Object Storage dedicado (Cloudflare R2 / AWS S3) e transferir a contagem de taxa para Upstash Redis REST.

```mermaid
flowchart TD
    subgraph CLIENTS ["Acessos Concorrentes de N Escolas"]
        PED["Pedagogas / Direção (Painel Web)"]
        EXT["Extensões Chrome (Power BI / SERP)"]
        PUB["Comunidade Escolar / QR Code / Validação Pública"]
    end

    subgraph VERCEL ["Camada de Borda & Serverless (Vercel gru1)"]
        PROXY["src/proxy.ts (Edge JWT Guard)"]
        RL["src/lib/rateLimit.ts (Sliding Window)"]
        API["Next.js 16 Route Handlers (45 endpoints)"]
    end

    subgraph CACHE ["Perímetro de Cache & Rate Limit (Opcional)"]
        UPSTASH["Upstash Redis REST (Se configurado)"]
        PGLIM["RateLimitBucket (Neon PostgreSQL - Zero Custo)"]
    end

    subgraph DB ["Camada Transacional (Neon PostgreSQL Serverless)"]
        POOLER["PgBouncer Pooler (-pooler.sa-east-1.aws.neon.tech)"]
        NEON["PostgreSQL 16 Multi-Tenant (Particionamento por schoolId)"]
    end

    subgraph STORAGE ["Guarda Binária & Arquivística (Object Storage)"]
        R2["Cloudflare R2 / AWS S3 (Se configurado via SigV4)"]
        FALLBACK["PostgreSQL Base64 (Fallback Padrão Zero-Custo)"]
    end

    CLIENTS --> PROXY --> RL
    RL -->|"UPSTASH_REDIS_REST_URL"| UPSTASH
    RL -->|"Padrão Zero-Custo"| PGLIM
    RL --> API
    API --> POOLER --> NEON
    API -->|"S3_BUCKET configurado"| R2
    API -->|"Padrão Zero-Custo"| FALLBACK
```

---

## 2. Pilares de Escalabilidade Implementados

### 2.1 Isolamento Lógico Multi-Tenant (Prevenção Absoluta contra Vazamentos)
- Toda consulta e mutação em tabelas operacionais (`Student`, `ClassGroup`, `PedagogicalMinute`, `MessageLog`, etc.) aplica obrigatoriamente `where: { schoolId }`.
- O utilitário [`src/lib/tenantGuard.ts`](../src/lib/tenantGuard.ts) valida a posse do recurso via `assertTenantOwnership(...)` antes de qualquer alteração por ID direto, impedindo vetores BOLA / IDOR.
- A escola sede **Colégio Estadual Leopoldina B. Pedroso (INEP `41042730`)** possui blindagem atômica no banco, sendo imune a exclusões ou sanitizações acidentais mesmo em rotas de superadministrador.

### 2.2 Pool de Conexões Serverless (PgBouncer Neon)
- Em Serverless (Vercel Functions), múltiplas lambdas podem subir simultaneamente para atender rajadas de requisições.
- A plataforma utiliza a porta `5432` com pooler de conexões (`-pooler.sa-east-1.aws.neon.tech`) via `DATABASE_URL` para operações transacionais rotineiras, e `DIRECT_URL` exclusivamente para migrações não-destrutivas (`scripts/vercel_db_push.cjs`).
- **Capacidade:** Suporta centenas de conexões concorrentes sem esgotar o limite do PostgreSQL.

### 2.3 Rate Limiting Distribuído e Defesa Anti-Brute-Force (`SEC-08`)
Localizado em [`src/lib/rateLimit.ts`](../src/lib/rateLimit.ts), o motor protege os recursos críticos:
- **Endpoints de IA (`/api/ai/*`):** Cota de 20 requisições/min por instituição e usuário, evitando custos descontrolados de API.
- **Validação Pública (`/api/atas/public/[code]`):** Cota de 30 requisições/min por hash de IP para prevenir raspagem (scraping).
- **Assinatura por Link/QR (`/api/atas/sign-token/[token]`):** 15 requisições/min por IP.
- **Trava de PIN de Fé Pública (`/finalize`, `/addendums`, `/void`):** Bloqueio de 15 minutos após 10 tentativas incorretas consecutivas com auditoria `SIGNING_PIN_LOCKOUT`.
- **Token de Sincronização da Extensão (`/frequencia/sync`, `/serp/sync`):** 10 tentativas falhas geram bloqueio temporário por IP.

### 2.4 Preservação Arquivística Determinística `PDF/A-1b` (`JUR-08`)
- O gerador [`src/lib/ataPdfArchive.ts`](../src/lib/ataPdfArchive.ts) utiliza `pdf-lib` + `@pdf-lib/fontkit` com fontes TrueType embarcadas (`LiberationSans`), perfil sRGB ICC e metadados XMP estritos (ISO 19005-1 Level B).
- **Vantagem de Escala:** Os PDFs oficiais são gerados **sob demanda** via `GET /api/atas/[id]/pdfa` em tempo de execução, registrando apenas o hash `pdfArchiveSha256` na ata. **Não há inchaço de gigabytes de arquivos PDF estáticos no banco relacional**.

### 2.5 Externalização de Arquivos Pesados Multi-Driver (`STORAGE-01`)
- Gerenciado por [`src/lib/objectStorage.ts`](../src/lib/objectStorage.ts).
- No cenário inicial, grava no PostgreSQL em Base64 (`physicalSignedScanData`), mas já calcula o hash de integridade `physicalScanSha256`.
- Ao plugar um bucket, o envio passa a ser feito diretamente para o bucket, gravando `null` no banco de dados e zerando o peso das linhas no Neon.

---

## 3. Passo a Passo: Como Realizar a Escalabilidade do Projeto

Quando a plataforma passar da Escola Piloto para uma rede municipal ou estadual com dezenas ou centenas de escolas, siga as 4 etapas abaixo:

### Etapa 1: Provisionar Storage Externo Privado (Cloudflare R2 ou AWS S3)
*Objetivo: Remover anexos de imagem e PDF de até 8MB das linhas do PostgreSQL.*

Recomendamos o **Cloudflare R2** devido a:
- Custo zero de tráfego de saída (Egress Free).
- Compatibilidade 100% com a API S3 da AWS.
- Excelente latência global.

**Como configurar:**
1. No painel do Cloudflare, crie um bucket R2 (ex: `rede-ativa-anexos`).
2. Mantenha o bucket **100% privado** (não ative acesso público; o acesso será exclusivamente autenticado via backend Next.js).
3. Gere uma chave de API R2 com permissões de Leitura e Escrita.
4. Adicione as seguintes variáveis de ambiente no projeto na Vercel:
   ```bash
   S3_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
   S3_BUCKET="rede-ativa-anexos"
   S3_ACCESS_KEY_ID="<SUA_ACCESS_KEY>"
   S3_SECRET_ACCESS_KEY="<SUA_SECRET_KEY>"
   S3_REGION="auto"
   ```
5. Faça o redeploy na Vercel. **Pronto!** O backend detectará automaticamente o driver `S3` e todos os novos uploads serão salvos no bucket R2 com chave escopada por escola (`atas/{schoolId}/{year}/{minuteId}-{sha256}.pdf`), mantendo a coluna `physicalSignedScanData` como `null` no banco.

---

### Etapa 2: Ativar Upstash Redis REST para Rate Limiting Ultra-Rápido
*Objetivo: Descarregar a tabela `RateLimitBucket` do banco transacional, operando o controle de concorrência na borda da rede.*

**Como configurar:**
1. Crie uma conta gratuita no [Upstash Redis](https://upstash.com/).
2. Crie uma base Redis Serverless na região **São Paulo (`sa-east-1`)** para menor latência com a Vercel (`gru1`).
3. Copie as credenciais da aba **REST API**:
   ```bash
   UPSTASH_REDIS_REST_URL="https://...upstash.io"
   UPSTASH_REDIS_REST_TOKEN="<SEU_REST_TOKEN>"
   ```
4. Salve nas variáveis da Vercel e faça o redeploy. O backend passará a utilizar o pipeline atômico REST do Redis para controle de cota em milissegundos.

---

### Etapa 3: Dimensionamento do Neon PostgreSQL
*Objetivo: Ajustar a capacidade computacional para suportar alta concorrência de escriturações simultâneas.*

No plano gratuito do Neon, a computação escala até 0.25 Compute Units (CU). Para redes com mais de 30 escolas ativas:
1. No console do Neon, faça upgrade para o plano **Launch** ou **Scale**.
2. Configure o **Autoscaling** de Compute:
   - **Mínimo:** `0.5 CU`
   - **Máximo:** `2 CU` a `4 CU` (para picos de fechamento de trimestre letivo ou sincronização em massa via SERE).
3. Mantenha sempre ativado o pool de conexões (PgBouncer) na string de conexão do arquivo de ambiente:
   ```env
   DATABASE_URL="postgresql://user:pass@ep-delicate-leaf-b6hzdz3t-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
   DIRECT_URL="postgresql://user:pass@ep-delicate-leaf-b6hzdz3t.sa-east-1.aws.neon.tech/neondb?sslmode=require"
   ```

---

### Etapa 4: Cadastramento e Expansão de Redes Escolares

O sistema já possui as interfaces e endpoints prontos para o crescimento hierárquico:

1. **Criação de Redes de Ensino (`EducationNetwork`):**
   - Acesse `/admin` com usuário `SUPERADMIN`.
   - Cadastre a rede municipal (ex: *Secretaria Municipal de Educação de Ponta Grossa*) com CNPJ, esfera institucional e logotipo oficial.
2. **Criação de Unidades Escolares (`School`):**
   - No painel da rede ou em `/admin/escolas`, cadastre novas escolas informando nome oficial, código INEP (8 dígitos), e-mail institucional e endereço.
   - Cada escola recebe seu próprio **Token de Sincronização da Extensão** gerado criptograficamente ([`syncToken.ts`](../src/lib/syncToken.ts)).
3. **Distribuição da Extensão Chrome:**
   - A extensão pré-compilada fica disponível para download imediato em `/public/extensao-leopoldina.zip`.
   - A equipe da nova escola instala a extensão e insere o Token de Sincronização exclusivo de sua unidade, isolando 100% os dados importados do Power BI e SERP.

---

## 4. Tabela de Dimensionamento Recomendada

| Métrica / Recurso | Unidade Piloto (Atual) | Rede Pequena (5 a 20 escolas) | Rede Média/Grande (20 a 100+ escolas) |
| :--- | :--- | :--- | :--- |
| **Estudantes Ativos** | ~700 | 3.000 a 15.000 | 15.000 a 100.000+ |
| **Atas Anuais Estimadas** | ~150 | ~2.000 | ~15.000 |
| **Neon Compute** | Serverless Free (0.25 CU) | Neon Launch (0.5 – 1.0 CU) | Neon Scale (1.0 – 4.0 CU Autoscaling) |
| **Armazenamento de Scans** | PostgreSQL Base64 (Zero Custo) | Cloudflare R2 ou Base64 | Cloudflare R2 Obrigatório |
| **Rate Limiter** | PostgreSQL (`RateLimitBucket`) | PostgreSQL ou Upstash | Upstash Redis REST Dedicado |
| **Plano Vercel** | Hobby / Pro | Vercel Pro | Vercel Pro / Enterprise |
| **Custo Mensal Estimado** | **R$ 0,00 (Grátis)** | **~R$ 100 – 150/mês** | **~R$ 250 – 500/mês** |

---

## 5. Garantia de Preservação e Conformidade

Em qualquer cenário de escala:
- A escola sede **Colégio Estadual Leopoldina B. Pedroso** permanece blindada de qualquer impacto operacional.
- Todos os relatórios SERE, atas assinadas e registros de busca ativa respeitam rigorosamente a **Lei nº 14.063/2020 (Assinatura Eletrônica Avançada)**, o **ECA (Lei nº 8.069/1990, Arts. 17 e 143)** e a **LGPD (Lei nº 13.709/2018)**.
- Qualquer evolução de banco segue o pipeline seguro `prisma db push --accept-data-loss=false`, garantindo perda zero de dados históricos.
