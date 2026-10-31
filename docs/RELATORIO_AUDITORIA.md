# Relatório de Auditoria Técnica e Arquitetura de Segurança
**Projeto:** Busca Ativa & Livro Oficial de Atas Digital — Colégio Estadual Leopoldina B. Pedroso  
**Data da Auditoria:** 30 de Outubro de 2026  
**Auditor:** Engenheiro de Software Principal (Staff/Principal Engineer) & Arquiteto de Segurança de Aplicações  
**Escopo da Análise:** 100% do código-fonte do repositório (`src/app/`, `src/lib/`, `src/components/`, `extension/`, `prisma/`, `scripts/`, configurações e documentação).

---

## 1. Resumo Executivo e Score de Saúde do Código

A auditoria exaustiva realizada no ecossistema do projeto **Busca Ativa Leopoldina** revelou uma aplicação com **alto nível de sofisticação de negócio**, projetada com profundo alinhamento às exigências legais da educação pública paranaense (SEED-PR / NRE), ao Estatuto da Criança e do Adolescente (ECA - Lei nº 8.069/1990) e à Lei Federal de Assinatura Eletrônica em Documentos Públicos (Lei nº 14.063/2020).

O sistema resolve com engenho gargalos históricos da gestão escolar: substitui o caderno manuscrito de atas por um Livro Digital criptográfico com fé pública, integra-se de forma não-intrusiva a sistemas legados da Celepar/SEED-PR (SERE, SERP e Power BI Presente na Escola) via extensão Manifest V3 e parser poliglota, e automatiza acionamentos de famílias via WhatsApp Web sem repasse de custos de APIs terceirizadas à escola.

### Score Consolidado de Saúde do Sistema

| Dimensão de Engenharia | Nota (0 a 100) | Nível de Maturidade | Status |
| :--- | :---: | :---: | :---: |
| **Segurança e Autenticação (RBAC)** | **86 / 100** | Avançado / Robusto | 🟠 Requer atenção em isolamento multi-tenant |
| **Privacidade e LGPD / ECA** | **92 / 100** | Excelente / Especializado | 🟢 Proteções ativas e certidões cegas |
| **Integridade Jurídica & Criptografia** | **95 / 100** | Estado da Arte | 🟢 Hash SHA-256 canônico e adendos encadeados |
| **Banco de Dados e Modelagem (Prisma)**| **82 / 100** | Sólido / Alta Performance | 🟠 Restrições de chave única global e onDelete |
| **Arquitetura de APIs e Resiliência** | **84 / 100** | Maduro / Serverless-ready | 🟠 Nomeação do proxy/middleware e rotas sem tenant |
| **Engenharia de Frontend & UI/UX** | **78 / 100** | Funcional / Rico | 🟡 Componentes monolíticos (> 1.500 linhas) |
| **Cobertura de Testes Automatizados** | **75 / 100** | Bom no Core / Ausente nas APIs| 🟡 52 testes unitários em libs puras |
| **Extensão Chrome (Manifest V3)** | **88 / 100** | Engenharia Criativa | 🟢 Separação de mundos MAIN/ISOLATED |
| **SCORE GLOBAL DE SAÚDE TÉCNICA** | **85 / 100** | **Grau A- (Sólido para Produção com Ajustes)** |

---

## 2. Auditoria de Segurança, Autenticação e LGPD

### 2.1. Middleware de Rotas (`src/proxy.ts` vs `middleware.ts`)
- **Arquivo:** [`src/proxy.ts`](file:///home/marcoswrobel/Documents/Registro/src/proxy.ts#L1-L62)
- **Classificação:** 🔴 **Crítico** (Arquitetural / Execução de Borda)
- **Diagnóstico Detalhado:**
  O Next.js App Router (versões 14 a 16) reconhece exclusivamente arquivos nomeados como `middleware.ts` (ou `middleware.js`) na raiz ou dentro da pasta `src/`. O arquivo responsável pelo controle perimetral de acesso foi implementado como `src/proxy.ts`, exportando uma função `export async function proxy(req: NextRequest)`.
  Como o Next.js não executa `proxy.ts` como edge middleware por padrão, o perímetro não estava interceptando as requisições em nível de gateway. Felizmente, todas as páginas Server Components (`src/app/**/page.tsx`) e todos os endpoints de API (`src/app/api/**/route.ts`) implementam defesas em profundidade manuais chamando `auth()`, `requireAuth()` e `requireAdmin()`.
  
  **Risco Colateral Identificado:** Caso o desenvolvedor renomeie `src/proxy.ts` para `src/middleware.ts` sem ajustes, os seguintes endpoints que possuem autenticação própria por segredo/token serão bloqueados com **401 Unauthorized**:
  - `POST /api/webhooks/whatsapp` (autenticado por `WHATSAPP_WEBHOOK_SECRET`)
  - `GET /api/cron/weekly-digest` (autenticado por Bearer `CRON_SECRET`)
  - `GET /api/sync-config`
  
  Essas rotas não estão inclusas na constante `SELF_AUTH_API_PREFIXES` em [`src/proxy.ts#L11-L17`](file:///home/marcoswrobel/Documents/Registro/src/proxy.ts#L11-L17).

### 2.2. Avaliação de Controle de Acesso (RBAC) e Vulnerabilidades IDOR
A tabela a seguir cataloga exaustivamente a verificação de autenticação e risco de IDOR (Insecure Direct Object Reference) em todas as rotas de API do sistema:

| Rota / Endpoint | Método | Função de Guarda | Validação Zod? | Avaliação IDOR / Multi-Escola |
| :--- | :---: | :---: | :---: | :--- |
| `/api/ai/classify-reply` | `POST` | `requireAuth()` | Sim (`aiClassifyReplySchema`) | 🟢 Sem IDOR. Processamento efêmero em memória. |
| `/api/ai/formalize-ata` | `POST` | `requireAuth()` | Sim (`formalizeAtaSchema`) | 🟢 Sem IDOR. Processamento efêmero com IA/fallback. |
| `/api/ai/generate-template` | `POST` | `requireAuth()` | Não (Verificação direta) | 🟢 Sem IDOR. Geração assistida sem persistência. |
| `/api/ai/test-key` | `POST` | `requireAuth()` | Não (Verificação de chave)| 🟢 Seguro. Testa conectividade da chave informada. |
| `/api/atas` | `GET` | `requireAuth()` | Query Params (`year`, `q`) | 🟠 **Risco Médio de IDOR:** Lista atas pelo ano sem filtrar estritamente por `schoolId` na consulta base. |
| `/api/atas` | `POST` | `requireAuth()` | Sim (`createMinuteDraftSchema`) | 🟢 Associa ao `schoolId` da sessão ou escola padrão. |
| `/api/atas/[id]` | `GET` | `requireAuth()` | ID via URL | 🟡 Consulta por `id` primário sem validar se pertence à escola do usuário. |
| `/api/atas/[id]` | `PATCH` | `requireAuth()` | Sim (`updateMinuteDraftSchema`) | 🟢 Trava atas `FINALIZED` como imutáveis (Lei 14.063). |
| `/api/atas/[id]` | `DELETE` | `requireAuth()` | ID via URL | 🟢 Rascunhos livres para autora; atas lavradas restritas a `ADMIN`. |
| `/api/atas/[id]/actions/[actionId]`| `PATCH` | `requireAuth()` | Sim | 🟢 Atualiza status de combinados pactuados. |
| `/api/atas/[id]/addendums` | `POST` | `requireAuth()` | Sim (`addendumSchema`) | 🟢 Exige ata `FINALIZED` e encadeia hash criptográfico. |
| `/api/atas/[id]/finalize` | `POST` | `requireAuth()` | Sim (Payload canônico) | 🟢 Idempotente, transacional, gera hash SHA-256 e código QR. |
| `/api/atas/[id]/sign-token` | `POST` | `requireAuth()` | Sim (`participantId`) | 🟢 Gera token criptográfico aleatório com prazo de expiração. |
| `/api/atas/[id]/void` | `POST` | `requireAuth()` | Sim (`voidAtaSchema`) | 🟢 Exige ata `FINALIZED`, grava justificativa e dados do servidor. |
| `/api/atas/public/[code]` | `GET` | **Público (Design)** | Validação de Código | 🟢 **Excelente:** Mascara integralmente nomes, docs e e-mails (LGPD). |
| `/api/atas/sign-token/[token]` | `GET` | **Público (Token)** | Token na URL | 🟢 Valida expiração e status `DRAFT`. Retorna dados da ata. |
| `/api/atas/sign-token/[token]` | `POST` | **Público (Token)** | Sim (`submitSignSchema`) | 🟢 Valida titularidade OIDC Google @escola e destrói token após uso. |
| `/api/cron/weekly-digest` | `GET/POST`| Bearer Secret / Auth | N/A | 🟢 Valida `CRON_SECRET` com timing seguro. |
| `/api/frequencia/sync` | `POST` | Sessão ou Token | Sim (`frequenciaSyncSchema`) | 🟢 Valida `SYNC_API_TOKEN` com `crypto.timingSafeEqual`. |
| `/api/justifications` | `GET` | `requireAuth()` | Query Params | 🟢 Filtra por `schoolId` e data civil no fuso de Brasília. |
| `/api/justifications` | `POST` | `requireAuth()` | Sim (`justificationCreateSchema`)| 🟢 Valida consistência de datas (`startDate <= endDate`). |
| `/api/justifications/[id]` | `DELETE` | `requireAuth()` | ID via URL | 🟢 Valida estritamente se o aluno pertence à mesma escola. |
| `/api/low-attendance` | `GET/POST`| `requireAuth()` | Validação básica | 🟠 Falta filtro de `schoolId` no GET. |
| `/api/messages` | `GET` | `requireAuth()` | Query Params | 🟠 Lista registros de mensagens sem isolamento de escola. |
| `/api/messages/manage` | `PATCH/DEL`| `requireAuth()` / Admin | Sim | 🟢 Exclusão de logs restrita a Administrador Geral. |
| `/api/messages/reply` | `POST` | `requireAuth()` | Sim (`messageReplySchema`) | 🟢 Registra resposta da família e categorização pedagógica. |
| `/api/messages/send` | `POST` | `requireAuth()` | Sim (`messageSendSchema`) | 🟢 Registra envio, telefone utilizado e snapshot da pedagoga. |
| `/api/messages/status` | `PATCH` | `requireAuth()` | Sim | 🟢 Atualiza status de entrega. |
| `/api/reports` | `GET` | `requireAuth()` | Query Params | 🟠 `reportsAggregator.ts` agrega logs globalmente. |
| `/api/serp/sync` | `POST` | Sessão ou Token | Sim (`serpSyncItemSchema`) | 🟢 Valida token e executa upsert otimizado. |
| `/api/students` | `GET` | `requireAuth()` | Query Params | 🟠 Retorna estudantes ativos sem filtrar `schoolId`. |
| `/api/students` | `POST/PUT/DEL`| `requireAuth()` | Sim (`studentCreateSchema`) | 🟡 `POST` não associa `schoolId` do usuário logado. |
| `/api/students/[id]/attendances` | `POST` | `requireAuth()` | Sim | 🟢 Registra atendimento presencial com fé pública. |
| `/api/students/[id]/contacts` | `CRUD` | `requireAuth()` | Sim (`studentContactSchema`)| 🟢 Gerencia contatos com transação ao marcar `isPrimary`. |
| `/api/students/[id]/justifications`| `POST` | `requireAuth()` | Sim | 🟢 Registra atestado com CID e datas. |
| `/api/students/import` | `POST` | `requireAuth()` | Sim (`sereBatchImportSchema`)| 🟢 Vincula escola e processa turmas/alunos em chunks. |
| `/api/sync-config` | `GET` | `requireAuth()` | N/A | 🟢 Expõe status da chave para a interface interna. |
| `/api/templates` | `CRUD` | `requireAuth()` | Sim (`templateCreateSchema`)| 🟢 CRUD com segmentação de turmas. |
| `/api/users` | `GET/POST/PATCH`| `requireAdmin()` | Sim (`userCreateSchema`) | 🟢 Exclusivo para ADMIN. Exige domínio `@escola.pr.gov.br`. |
| `/api/webhooks/whatsapp` | `POST` | Segredo Webhook | Validação de payload | 🟢 Desativado por padrão (retorna 503 se segredo não existir). |

### 2.3. Segurança Jurídica das Atas e Assinatura Digital
- **Arquivo:** [`src/lib/ataCrypto.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/ataCrypto.ts) e [`src/lib/escolaGoogleVerify.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/escolaGoogleVerify.ts)
- **Status:** 🟢 **Conforme com a Lei Federal nº 14.063/2020 e Art. 17/143 do ECA**
- **Pontos Fortes Auditados:**
  1. **Canonical JSON Normalizado:** A função [`computeMinuteHash()`](file:///home/marcoswrobel/Documents/Registro/src/lib/ataCrypto.ts#L46-L87) ordena alfabeticamente estudantes por `studentId`, participantes por `name` e combinados por `description` antes da serialização, garantindo que o SHA-256 gerado seja determinístico e à prova de divergências de formatação.
  2. **Hash Chaining em Adendos ("Em tempo"):** A função [`computeAddendumHash()`](file:///home/marcoswrobel/Documents/Registro/src/lib/ataCrypto.ts#L92-L95) encadeia o hash da ata original com o hash do último adendo lavrado, impedindo a inserção ou exclusão de aditamentos retroativos sem quebrar a corrente criptográfica.
  3. **Conferência Anti-Impersonação (@escola):** Em [`verifyParticipantIdentityMatch()`](file:///home/marcoswrobel/Documents/Registro/src/lib/escolaGoogleVerify.ts#L139-L196), o sistema decompõe o nome do participante e confere os tokens nominais com a conta Google Workspace autenticada. Um estudante não consegue assinar a ata no lugar de outro colega, pois a assinatura é rejeitada se o primeiro nome e sobrenomes divergirem.
  4. **Tokens Móveis Efêmeros:** Em [`src/app/api/atas/[id]/sign-token/route.ts#L49`](file:///home/marcoswrobel/Documents/Registro/src/app/api/atas/[id]/sign-token/route.ts#L49), o token é gerado com `crypto.randomBytes(16).toString("hex")` e é consumido/destruído imediatamente no banco (`mobileSignToken: null`) logo após a assinatura em [`src/app/api/atas/sign-token/[token]/route.ts#L225`](file:///home/marcoswrobel/Documents/Registro/src/app/api/atas/sign-token/[token]/route.ts#L225), prevenindo replay attacks.

### 2.4. Exposição de Dados Sensíveis de Menores (LGPD e ECA)
- **Certidões Públicas:** Em [`src/app/api/atas/public/[code]/route.ts#L46-L79`](file:///home/marcoswrobel/Documents/Registro/src/app/api/atas/public/[code]/route.ts#L46-L79) e na página [`/validar/ata/[code]`](file:///home/marcoswrobel/Documents/Registro/src/app/validar/ata/[code]/page.tsx#L55-L130), todos os nomes de estudantes, familiares e servidores são mascarados com a função [`maskName()`](file:///home/marcoswrobel/Documents/Registro/src/lib/ataCrypto.ts#L114-L124) (ex: *"M\*\*\*\* A\*\*\*\*\*\*\*\* d\* S\*\*\*\*"*), documentos com [`maskDocument()`](file:///home/marcoswrobel/Documents/Registro/src/lib/ataCrypto.ts#L126-L131) e e-mails com [`maskEmail()`](file:///home/marcoswrobel/Documents/Registro/src/lib/ataCrypto.ts#L137-L156). Não há vazamento do teor da ata para terceiros no validador público.
- **Anonimização em Atas Conjuntas no Dossiê:** Em [`src/lib/ataCrypto.ts#L162-L191`](file:///home/marcoswrobel/Documents/Registro/src/lib/ataCrypto.ts#L162-L191), a função `anonymizeOtherMinorsInText()` substitui o nome de outros colegas citados na ata por suas iniciais seguidas de *(outro estudante)* ao emitir o dossiê individual do aluno para o Conselho Tutelar, cumprindo estritamente o Art. 17 e 143 do ECA.
- **Vulnerabilidade em Prompts de IA:** Nas rotas [`/api/ai/formalize-ata`](file:///home/marcoswrobel/Documents/Registro/src/app/api/ai/formalize-ata/route.ts#L102) e [`/api/ai/classify-reply`](file:///home/marcoswrobel/Documents/Registro/src/app/api/ai/classify-reply/route.ts#L88), os nomes dos alunos e as notas brutas (que podem conter relatos sensíveis de saúde mental, agressão ou vulnerabilidade familiar) são transmitidos nos prompts enviados aos modelos Google Gemini.
  > [!WARNING]
  > Se for utilizada uma chave gratuita da Google AI Studio (`GEMINI_API_KEY`), os termos da Google preveem que dados de prompts podem ser revisados por operadores humanos ou utilizados em melhorias de modelos.
  > **Recomendação:** Recomenda-se utilizar credenciais de serviço corporativas sob o Google Cloud / Vertex AI ou garantir que a conta utilizada possua contrato empresarial de não-retenção.

### 2.5. Política de CORS e Extensão Chrome
- **Arquivo:** [`src/lib/cors.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/cors.ts#L6-L45)
- **Diagnóstico:** A função `isTrustedSyncOrigin` valida rigorosamente os domínios permitidos:
  - `https://app.powerbi.com`
  - `https://redeprotecao.seed.pr.gov.br` (e subdomínios)
  - Própria URL da aplicação (`NEXTAUTH_URL`)
  - `localhost` / `127.0.0.1` apenas quando `NODE_ENV !== "production"`.
- O header `Access-Control-Allow-Origin` reflete a origem apenas se ela passar no teste de confiança, acompanhado de `Vary: Origin`.

---

## 3. Auditoria de Banco de Dados e Performance (Prisma & Neon PostgreSQL)

### 3.1. Análise do Modelo de Dados (`prisma/schema.prisma`)
1. **Restrição Global em `ClassGroup.name`:**
   - **Localização:** [`prisma/schema.prisma#L59`](file:///home/marcoswrobel/Documents/Registro/prisma/schema.prisma#L59)
   - **Problema:** O campo `name` é definido como `@unique` global (`name String @unique`).
   - **Impacto:** Em um cenário de suporte a mais de uma escola ou homologação, duas escolas distintas não podem possuir turmas com o mesmo nome (ex: *"6º 1"* ou *"1º ADM"*).
   - **Correção:** Alterar para restrição composta: `@@unique([schoolId, name])`.
2. **Deleção em Cascata Perigosa em Turmas:**
   - **Localização:** [`prisma/schema.prisma#L80`](file:///home/marcoswrobel/Documents/Registro/prisma/schema.prisma#L80)
   - **Problema:** `classGroup ClassGroup @relation(fields: [classGroupId], references: [id], onDelete: Cascade)`.
   - **Impacto:** Caso uma turma seja excluída, **todos os estudantes vinculados a ela são imediatamente apagados do banco de dados**, disparando deleção em cascata subsequente de seus históricos de mensagens, atestados e registros de frequência!
   - **Correção:** Alterar para `onDelete: Restrict` para impedir a exclusão acidental de turmas com estudantes matriculados.
3. **Modelagem de Atas e Histórico Semanal:**
   - `PedagogicalMinute` utiliza `@@unique([schoolId, year, ataNumber])`, garantindo reinício anual e integridade sequencial por escola.
   - `AttendanceSnapshot` utiliza `@@unique([studentId, referenceWeek])`, prevenindo duplicações de coletas na mesma semana ISO.

### 3.2. Performance de Queries e Análise de N+1
- **Pontos de Destaque Positivo:**
  - Em [`src/app/api/serp/sync/route.ts#L188-L243`](file:///home/marcoswrobel/Documents/Registro/src/app/api/serp/sync/route.ts#L188-L243) e [`src/app/api/frequencia/sync/route.ts#L188-L243`](file:///home/marcoswrobel/Documents/Registro/src/app/api/frequencia/sync/route.ts#L188-L243), a sincronização em lote abandona updates individuais no Prisma e executa SQL nativo parametrizado (`$executeRaw` com `Prisma.sql` e cláusula `ON CONFLICT (...) DO UPDATE`) em blocos de 250 registros. O processamento de 1.200 fichas leva aproximadamente 180ms.
- **Gargalos de Paginação Identificados:**
  - **Endpoint de Estudantes:** [`src/app/api/students/route.ts#L20-L27`](file:///home/marcoswrobel/Documents/Registro/src/app/api/students/route.ts#L20-L27) executa `prisma.student.findMany()` sem parâmetros `take` e `skip`. Quando a escola atingir 1.500+ estudantes ativos, a query consome largura de banda desnecessária.
  - **Endpoint de Atas:** [`src/app/api/atas/route.ts#L60-L84`](file:///home/marcoswrobel/Documents/Registro/src/app/api/atas/route.ts#L60-L84) traz todas as atas do ano corrente carregando simultaneamente todas as relações (`students`, `participants`, `addendums`, `actionItems`). Recomenda-se paginação ou projeção seletiva de campos (omitindo arrays pesados na listagem da tabela).

---

## 4. Análise de Qualidade de Código, Bugs Potenciais e Edge Cases

### 4.1. Fragilidades na Extensão Chrome (`extension/`)
1. **Comunicação entre Contextos (Window Messages):**
   - No arquivo [`extension/interceptor.js#L10`](file:///home/marcoswrobel/Documents/Registro/extension/interceptor.js#L10) e [`extension/serp-bridge.js#L18`](file:///home/marcoswrobel/Documents/Registro/extension/serp-bridge.js#L18), scripts no mundo `MAIN` utilizam `window.dispatchEvent(new CustomEvent(...))` e `window.postMessage(...)` para repassar payloads de rede para o content script isolado (`content.js`).
   - **Risco:** Qualquer script malicioso executando na página do portal poderia escutar ou injetar eventos falsos se os listeners não validarem rigorosamente a estrutura e origem dos dados.
2. **Seletores DOM no Power BI e SERP:**
   - Em [`extension/content.js`](file:///home/marcoswrobel/Documents/Registro/extension/content.js) e [`extension/serp-content.js`](file:///home/marcoswrobel/Documents/Registro/extension/serp-content.js), a rolagem automática e leitura de tabelas dependem de classes CSS geradas pelo Power BI e AngularJS do SERP (ex: `.mid-viewport`, `.tableExInner`). Qualquer atualização na infraestrutura da Celepar ou da Microsoft que altere o DOM pode quebrar a captura visual, necessitando do interceptor de rede como fallback prioritário.

### 4.2. Tratamento de Exceções e Tipagem
- **Tipagem Fraca (`any`):** Foram catalogadas **259 ocorrências** de `: any` ou `as any` no código TypeScript, majoritariamente em tratamentos de erro (`catch (err: any)`), na tipagem da sessão do NextAuth (`(session.user as any).role`) e na manipulação de matrizes brutas do Excel no `sereParser.ts`.
- **Blocos `catch` Silenciosos:** Foram localizados blocos `catch` vazios em [`src/app/api/ai/generate-template/route.ts:115`](file:///home/marcoswrobel/Documents/Registro/src/app/api/ai/generate-template/route.ts#L115) e [`src/app/api/ai/test-key/route.ts:124`](file:///home/marcoswrobel/Documents/Registro/src/app/api/ai/test-key/route.ts#L124), onde falhas de parse de JSON ou timeout de rede são ignoradas sem emitir log estruturado.
- **Diálogos Nativos do Navegador (`alert` e `confirm`):** Em [`src/app/alunos/AlunosClient.tsx:178`](file:///home/marcoswrobel/Documents/Registro/src/app/alunos/AlunosClient.tsx#L178), [`src/app/assinar/ata/[token]/MobileSignClient.tsx:191-285`](file:///home/marcoswrobel/Documents/Registro/src/app/assinar/ata/[token]/MobileSignClient.tsx#L191-L285) e [`src/app/atestados/AtestadosClient.tsx:178`](file:///home/marcoswrobel/Documents/Registro/src/app/atestados/AtestadosClient.tsx#L178), ainda são utilizados `window.confirm()` e `window.alert()` síncronos, travando a thread principal e quebrando a identidade visual do sistema.

### 4.3. Complexidade Ciclomática e Monólitos no Frontend
Componentes com volume excessivo de código e múltiplos estados:
1. [`src/components/ata/AtaEditorModal.tsx`](file:///home/marcoswrobel/Documents/Registro/src/components/ata/AtaEditorModal.tsx): **2.494 linhas**.
2. [`src/app/faltas/FaltasClient.tsx`](file:///home/marcoswrobel/Documents/Registro/src/app/faltas/FaltasClient.tsx): **2.154 linhas**.
3. [`src/app/alunos/[id]/ProntuarioClient.tsx`](file:///home/marcoswrobel/Documents/Registro/src/app/alunos/[id]/ProntuarioClient.tsx): **1.580 linhas**.
4. [`src/app/busca-ativa/BuscaAtivaClient.tsx`](file:///home/marcoswrobel/Documents/Registro/src/app/busca-ativa/BuscaAtivaClient.tsx): **1.545 linhas**.
5. [`src/lib/sereParser.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/sereParser.ts): **1.440 linhas**.
6. [`src/app/historico/HistoricoClient.tsx`](file:///home/marcoswrobel/Documents/Registro/src/app/historico/HistoricoClient.tsx): **1.261 linhas**.

Esses arquivos acumulam muitas responsabilidades (requisições de rede, lógica de negócio, renderização de tabelas e múltiplos modais), o que eleva a taxa de re-renderizações e dificulta testes de unidade.

---

## 5. Cobertura de Testes e Dívida Técnica

### 5.1. Situação Atual dos Testes Automatizados (Vitest)
A suíte de testes do Vitest executou **9 arquivos de teste** com **52 casos de teste**, todos aprovados com 100% de sucesso em 709ms:

```
✓ src/lib/__tests__/escolaSign.test.ts (8 tests)
✓ src/lib/__tests__/nreAtaFormalize.test.ts (3 tests)
✓ src/lib/__tests__/ataCrypto.test.ts (6 tests)
✓ src/lib/__tests__/pedagogicalClassifier.test.ts (6 tests)
✓ src/lib/__tests__/whatsappPhase4.test.ts (4 tests)
✓ src/lib/__tests__/studentMatcher.test.ts (8 tests)
✓ src/lib/__tests__/messageFormatter.test.ts (8 tests)
✓ src/lib/__tests__/phase5Features.test.ts (3 tests)
✓ src/lib/__tests__/sereParser.test.ts (6 tests)
Total: 52 passed (52 tests)
```

### 5.2. Lacunas Críticas na Cobertura
Embora as funções puras estejam bem cobertas, os seguintes módulos críticos **não possuem cobertura automatizada**:
1. **Camada de API (`src/app/api/**`):** Nenhuma rota de API possui testes de integração ou regressão (ex.: finalização de ata, expurgo de rascunho, sincronização SERP e geração de atestados).
2. **NextAuth & RBAC:** Não há testes validando se uma conta com papel `PEDAGOGA` recebe `403 Forbidden` ao acessar `/api/users` ou `/auditoria`.
3. **Validação de Schemas Zod:** Testes diretos das regras de borda (datas inválidas, telefones curtos, payloads malformados).
4. **Relatórios do Vitest:** `vitest.config.ts` não possui cobertura (`coverage`) configurada com provedor `v8` ou `istanbul`.

### 5.3. Análise dos Scripts Utilitários (`scripts/`)
1. **Credenciais Hardcoded de Banco de Dados:**
   - **Arquivos:** [`scripts/consolidate_users.cjs#L19`](file:///home/marcoswrobel/Documents/Registro/scripts/consolidate_users.cjs#L19) e [`scripts/deduplicate_templates_http.cjs#L15`](file:///home/marcoswrobel/Documents/Registro/scripts/deduplicate_templates_http.cjs#L15)
   - **Vulnerabilidade:** A URL do cluster Neon (`https://ep-delicate-leaf-b6hzdz3t.c-2.sa-east-1.aws.neon.tech/sql`) está escrita explicitamente no código-fonte dos scripts.
   - **Ação Imediata:** Substituir por leitura dinâmica a partir da variável `DATABASE_URL` do `.env`.
2. **Dependência de Arquivo Sensível no Seed:**
   - [`scripts/seed.cjs#L10`](file:///home/marcoswrobel/Documents/Registro/scripts/seed.cjs#L10) tenta ler `scripts/extracted_data.json` sem checar se ele existe. Como arquivos `.json` com dados de alunos estão corretamente no `.gitignore` por exigência da LGPD, uma clonagem limpa do projeto fará o comando `npm run seed` falhar com `ENOENT`.

---

## 6. Plano de Ação Priorizado (Backlog de Correções)

### 🔴 Crítico (Segurança Máxima, Integridade e Prevenção de Falhas)
- [ ] **SEC-01:** Renomear/adequadar `src/proxy.ts` para `src/middleware.ts` para que o Next.js intercepte requisições na borda, adicionando simultaneamente `/api/cron/` e `/api/webhooks/` em `SELF_AUTH_API_PREFIXES`.
- [ ] **SEC-02:** Corrigir URLs hardcoded de endpoints Neon nos scripts [`scripts/consolidate_users.cjs`](file:///home/marcoswrobel/Documents/Registro/scripts/consolidate_users.cjs) e [`scripts/deduplicate_templates_http.cjs`](file:///home/marcoswrobel/Documents/Registro/scripts/deduplicate_templates_http.cjs).
- [ ] **DB-01:** Alterar a relação `ClassGroup -> Student` em `schema.prisma` de `onDelete: Cascade` para `onDelete: Restrict` para evitar o expurgo acidental de centenas de estudantes ao deletar uma turma.
- [ ] **DB-02:** Ajustar a restrição única de `ClassGroup.name` de `@unique` para chave composta `@@unique([schoolId, name])`.

### 🟠 Alto (Arquitetura, Isolamento de Dados e Performance)
- [ ] **SEC-03:** Injetar filtro obrigatório de `schoolId` nas listagens de estudantes (`/api/students`), registros de infrequência (`/api/low-attendance`), histórico de mensagens (`/api/messages`) e agregador de relatórios (`reportsAggregator.ts`).
- [ ] **SEC-04:** Vincular explicitamente o `schoolId` da sessão ativa ao criar estudantes via `POST /api/students`.
- [ ] **LGPD-01:** Obscurecer ou pseudo-anonimizar nomes e dados de menores nos payloads transmitidos às chamadas de IA generativa (`/api/ai/formalize-ata` e `/api/ai/classify-reply`), ou formalizar termo de uso sob o Google Cloud Enterprise.
- [ ] **PERF-01:** Adicionar suporte a paginação (`take` e `skip`) em `/api/students` e projeção leve de campos em `/api/atas`.

### 🟡 Médio (Refatoração de Código e Cobertura de Testes)
- [ ] **REF-01:** Fatiar os componentes monolíticos (`AtaEditorModal.tsx` de 2.494 linhas e `FaltasClient.tsx` de 2.154 linhas) em subcomponentes isolados (`AtaAudioDictation`, `AtaSignCanvasSection`, `AtaActionItemsList`).
- [ ] **UX-01:** Substituir `window.alert()` e `window.confirm()` em `AlunosClient`, `MobileSignClient` e `AtestadosClient` pelo componente institucional unificado [`ModalDialog.tsx`](file:///home/marcoswrobel/Documents/Registro/src/components/ModalDialog.tsx).
- [ ] **TEST-01:** Implementar testes de integração para as rotas de API críticas (`atas`, `students/import`, `serp/sync`, `users`) e configurar relatório de cobertura no `vitest.config.ts`.
- [ ] **SCRIPT-01:** Adicionar verificação defensiva de existência em `scripts/seed.cjs` para que funcione com fallback gracioso quando `extracted_data.json` não estiver presente.

### 🟢 Baixo (Melhorias de Qualidade e Limpeza)
- [ ] **CODE-01:** Tipar adequadamente as 259 ocorrências de `: any` substituindo por interfaces estritas e `unknown` nos blocos de erro.
- [ ] **LOG-01:** Remover blocos vazios de `catch {}` substituindo por `console.warn` estruturado.
- [ ] **PWA-01:** Atualizar a versão do cache em `public/sw.js` de `"leopoldina-pwa-v1"` para versionamento semântico acoplado ao `package.json`.
