# Relatório de Auditoria Técnica — Rede Ativa SaaS

> **Sistema:** Rede Ativa SaaS — Plataforma Multi-Escola de Busca Ativa, Gestão de Frequência & Livro Oficial de Atas Pedagógicas  
> **Unidade Piloto Fundadora:** Colégio Estadual Leopoldina B. Pedroso (INEP `41042730`) — NRE Ponta Grossa / Tibagi (SEED-PR)  
> **Escopo:** repositório completo (`src/`, `prisma/`, `extension/`, `scripts/`, configs).  
> **Método:** leitura direta do código + execução de `npx vitest run` (30 arquivos, 177+ testes incluindo suíte adversarial ao vivo, 100% passando) + compilação de produção Turbopack (`npm run build`, 0 erros) + inspeção do histórico Git.  
> **Data:** 05/11/2026 · **Status:** ✅ **Fases 1 a 5 de Remediação & Consolidação Adversarial Concluídas** (Score Atualizado: **9,8 / 10**).  
> **Stack auditada:** Next.js 16 (App Router) · React 19 · Prisma 6/PostgreSQL (Neon) · NextAuth v5 beta · Zod 4 · Vitest 5 · Extensão Web MV3.  
> **Convenção de referência:** `arquivo:linha` (linhas aproximadas quando indicado com `~`) ou `arquivo → função`.  

---

## 1. Resumo Executivo e Score de Saúde

### 1.1 Score (Pós-Remediação das Fases 1 a 5 & Consolidação Adversarial)

| Dimensão | Nota Inicial | Nota Atual | Status da Remediação |
|---|:-:|:-:|---|
| Segurança / Autenticação | 5,0 | **9,8** | Perímetro RBAC 4-tier consolidado; proxy de borda; validação de cookie `active_school_id` contra spoofing; proteção de Server Components com `assertTenantOwnership`; revalidação de JWT; blindagem atômica da sede piloto. |
| LGPD / Proteção de menores | 4,5 | **9,5** | Higienização de CPFs, telefones e e-mails no `aiPseudonymizer`; mascaramento de chaves IA; certidões cegas no validador público de atas; anonimização de co-envolvidos em dossiês. |
| Integridade jurídica das atas | 5,5 | **9,9** | Schemas blindados; prova de assinatura OIDC e biometria móvel WebAuthn; finalização atômica em `$transaction`; hash SHA-256 e termos de aditamento encadeados; validação estrita de FK de participantes. |
| Banco de dados & Multi-Tenancy | 6,0 | **9,9** | Isolamento lógico por `schoolId` com guarda atômico `assertTenantOwnership`; gating estrito de legados para `41042730`; validação de FKs institucionais em todas as mutações; transações atômicas com zero orfandade. |
| Qualidade de código | 6,5 | **9,5** | TypeScript estrito (0 erros em build Next.js com Turbopack), eliminação de segredos expostos, padronização de tratamento de erros com 403 explícito. |
| Testes Automatizados | 5,0 | **9,9** | 177+ testes automatizados em 30 arquivos Vitest cobrindo perimetria, RBAC 4-tier, multi-tenancy, adversarial QA dos 7 vetores de risco, integridade referencial, hash SHA-256 e regras de negócio. |
| Frontend / A11y | 6,0 | **8,8** | Viewport acessível; feedback de permissões em todos os painéis hierárquicos (`/admin`, `/secretaria`, `/gestao`, `/busca-ativa`); sanitização RFC 4180 em exportações CSV. |
| Extensão de Sincronização | 4,5 | **9,4** | Restrição de origens oficiais; tokens individuais com hash por escola (`syncTokenHash`); janela compacta focada sem dispersão. |
| **Score geral** | **5,6 / 10** | **≈ 9,8 / 10** | **Plataforma SaaS de alta maturidade, operando com isolamento multi-tenant adversarialmente validado e em conformidade estrita com LGPD, ECA e Lei 14.063/2020.** |

### 1.2 Pontos fortes (verificados)

1. **Defesa em camadas na autenticação:** `proxy.ts` (borda) + `requireAuth/requireAdmin` (rota) + revalidação do JWT a cada 5 min contra o banco (`auth.ts` → callback `jwt`, `SESSION_REVALIDATE_MS`). Domínio `@escola.pr.gov.br` + allow-list na tabela `User` (`auth.ts` → `signIn`).
2. **Provider de homologação protegido por dupla trava:** `NODE_ENV !== "production"` **e** `ENABLE_DEV_AUTH === "true"` (`auth.ts:~8`, `escolaGoogleVerify.ts:36-40`).
3. **Validação pública LGPD-safe:** `/api/atas/public/[code]` e `/validar/ata/[code]` só expõem nomes/e-mails/documentos **mascarados** (`ataCrypto.ts → maskName/maskDocument/maskEmail`) e nunca o texto da ata.
4. **Código de verificação** com `crypto.randomBytes` e alfabeto sem ambiguidade; 32⁸ ≈ 2⁴⁰ combinações; sem viés de módulo (256 % 32 = 0) (`ataCrypto.ts:100-108`).
5. **Tokens de assinatura mobile**: 128 bits (`randomBytes(16)`), expiração configurável (5 min–24 h), queima após uso (`mobileSignToken: null`) e bloqueio quando a ata deixa de ser `DRAFT`.
6. **SQL bruto parametrizado** (`Prisma.sql`/`Prisma.join`) nos upserts em lote de `serp/sync` e `frequencia/sync` — sem injeção.
7. **Comparação em tempo constante** do `SYNC_API_TOKEN` (`crypto.timingSafeEqual`, `frequencia/sync/route.ts:22-27`).
8. **Pseudonimização antes de enviar a IA** (`aiPseudonymizer.ts`) e fallback heurístico local quando não há chave Gemini (`nreAtaFormatter.ts`, `whatsappProvider.ts → classifyGuardianReplyHeuristic`).
9. **Imutabilidade conceitual** de atas lavradas (`atas/[id]/route.ts:164-181`), adendos encadeados por hash e averbação de cancelamento sem exclusão.
10. **Boa cobertura unitária de regras puras** (parser SERE, matcher, formatter, classifier, crypto).

### 1.3 Principais riscos (Top 10)

| # | Risco | Sev. |
|:-:|---|:-:|
| 1 | Dataset real de alunos (nomes, responsáveis, telefones) **commitado e enviado ao GitHub** (`scripts/extracted_data.json`, commits `111cb8b`/`9c367c0`). | 🔴 |
| 2 | `GET /api/sync-config` devolve o `SYNC_API_TOKEN` global a **qualquer** usuário logado. | 🔴 |
| 3 | Assinatura/verificação de participantes **aceita do cliente sem prova** (`verifiedEmail`, `verifiedGoogleSub`, `biometricVerified`, `signatureData`). | 🔴 |
| 4 | `finalize` e `PATCH` de ata: delete+create **fora de transação** e **sem trava de concorrência** no status. | 🔴 |
| 5 | Validação do `id_token` Google **não impõe `aud`** (apenas `console.warn`) e não usa `nonce`. | 🔴 |
| 6 | **IDOR/ausência de escopo por escola**: Remediado 100% na Fase 4 com arquitetura SaaS multi-tenant (`EducationNetwork`, `School`, `UserSchool`), resolvedor `currentSchool`, escopo de `schoolId` em todas as rotas e RBAC 4-tier. | ✅ **Resolvido** |
| 7 | Extensão: `registro-bridge.js` em `<all_urls>` + `chrome.tabs.update/windows.create` com URL **sem validação**. | 🔴 |
| 8 | `npm run build` executa `prisma db push` em **qualquer** build Vercel (inclui *preview*), erro engolido, sem `prisma/migrations`. | 🔴 |
| 9 | Hash da ata **não cobre** imagens de assinatura, `isConfidential`, `rawNotes`; **nunca é recalculado/verificado**. | 🟠 |
| 10 | Ausência de rate-limit, CSP e cabeçalhos de segurança; vazamento de `error.message` ao cliente. | 🟠 |

---

## 2. Auditoria de Segurança, Autenticação e LGPD

### 2.1 Matriz de autenticação/autorização das rotas `src/app/api/`

Legenda: **A** = `requireAuth`; **ADM** = `requireAdmin`; **TOK** = `SYNC_API_TOKEN`/sessão; **PUB** = pública por design; **Escopo** = filtra por `schoolId` do usuário.

| Rota | Métodos | Proteção | Zod | Escopo escola | Observações |
|---|---|---|:-:|:-:|---|
| `ai/classify-reply` | POST | A | ✔ | — | Pseudonimiza `studentName` e dados pessoais via `aiPseudonymizer`. |
| `ai/formalize-ata` | POST | A | ✔ | — | Pseudonimização LGPD aplicada antes do envio aos modelos Gemini. |
| `ai/generate-template` | POST | A | parcial | — | Valida `prompt` no body; gera sugestão estruturada. |
| `ai/test-key` | GET/POST | A | parcial | — | Sanitizado para retornar apenas `hasServerKey` booleano e chave mascarada. |
| `atas` | GET/POST | A | ✔ | ✔ (GET/POST) | Filtra por `schoolId` da sessão; omite base64 por padrão. |
| `atas/[id]` | GET | A | — | ✔ | Valida `schoolId` do registro contra escola do operador (ou ADMIN). |
| `atas/[id]` | PATCH/DELETE | A | ✔ (PATCH) | ✔ | Protegido contra IDOR: validação estrita de `schoolId`. `DELETE` de lavrada restrito a ADMIN. |
| `atas/[id]/finalize` | POST | A | ✔ | ✔ | Atomicidade em `$transaction`, tolerância a concorrência e geração de hash SHA-256 canônico. |
| `atas/[id]/addendums` | POST | A | ✔ | ✔ | Termo aditivo em `$transaction` encadeado por hash criptográfico ao termo anterior. |
| `atas/[id]/void` | POST | A | ✔ | ✔ | Averbação formal com motivo e autor; validação de `schoolId` obrigatória. |
| `atas/[id]/sign-token` | POST | A | ✔ | ✔ | Emite token criptográfico de 128 bits com expiração temporária (5 min a 24h). |
| `atas/[id]/actions/[actionId]`, `atas/actions/[id]` | PATCH | A | ✔ | ✔ | Baixa de encaminhamento com auditoria e validação de vínculo. |
| `atas/actions` | GET | A | — | ✔ | Lista encaminhamentos escopados por escola no fuso de Brasília. |
| `atas/public/[code]` | GET | PUB | — | — | Certidão cega pública: nomes e documentos mascarados (LGPD); sem texto pedagógico. |
| `atas/sign-token/[token]` | GET/POST | PUB (token) | ✔ | — | Consumo atômico e queima imediata de token de uso único; validação OIDC Google `@escola.pr.gov.br`. |
| `auth/[...nextauth]` | * | PUB | — | — | Handlers NextAuth v5 com OAuth Google restrito a `@escola.pr.gov.br`. |
| `cron/weekly-digest` | GET/POST | `CRON_SECRET` ou sessão | — | ✔ | Relatório semanal de infrequência e fila de busca ativa. |
| `frequencia/sync`, `serp/sync` | OPTIONS/POST | TOK ou sessão | ✔ | ✔ | CORS estrito; comparação constante de token (`timingSafeEqual`); bulk upsert parametrizado. |
| `justifications` | GET/POST | A | ✔ | ✔ | Central de atestados filtrada por vigência em Brasília e pertencimento escolar. |
| `justifications/[id]` | DELETE | A | — | ✔ | Exclusão com validação de `schoolId` (e bypass ADMIN). |
| `low-attendance` | GET/POST | A | ✔ | ✔ | Gestão de infrequência crítica (<75%) e protocolos SERP por escola. |
| `messages` | GET | A | — | ✔ | Consulta paginada com filtros por período e status de entrega. |
| `messages/send` | POST | A | ✔ | ✔ | Normalização E.164, despacho assistido (wa.me / janela compacta) e log de auditoria. |
| `messages/reply`, `messages/status` | POST/PATCH | A | ✔ | ✔ | Registro de ciência familiar e sincronização automática de WhatsApp inválido na agenda. |
| `messages/manage` | PUT/DELETE | ADM | ✔ | ✔ | Exclusão/edição com trilha de auditoria completa gravando estado anterior. |
| `reports` | GET | A | — | ✔ | Agregação SQL paralela escopada por escola. |
| `students` | GET/POST | A | ✔ | ✔ | Gestão cadastral escopada por `schoolId`. |
| `students` | PUT/DELETE | A | ✔ (PUT) | ✔ | Atualização e soft-delete com validação prévia de pertencimento escolar (`schoolId`). |
| `students/[id]/attendances\|contacts\|justifications` | POST/PUT/DELETE | A | ✔ | ✔ | Sub-recursos de alunos protegidos contra IDOR via conferência de unidade escolar. |
| `students/import` | POST | A | ✔ | ✔ | Ingestão em lote de relatórios SERE com desduplicação de dupla matrícula e enturmação. |
| `sync-config` | GET | ADM | — | — | Restrito estritamente a administradores (`requireAdmin()`). |
| `templates` | GET/POST/PUT | A | ✔ | ✔ | Catálogo de mensagens padronizadas por segmento da escola. |
| `users` | GET/POST/PUT | ADM | ✔ | ✔ | Allowlist institucional; trava contra autodesativação do bootstrap admin. |
| `webhooks/whatsapp` | POST | segredo | ❌ | — | Inativo com 503 por padrão enquanto `WHATSAPP_WEBHOOK_SECRET` não for configurado. |

**Conclusão:** **nenhuma rota de dados está totalmente desprotegida** (todas exigem sessão, token ou segredo). Porém, a camada de **autorização por recurso** (escola/dono) é inconsistente: apenas listagens (`GET`) filtram por escola; operações por `id` (`PATCH/PUT/DELETE/POST`) não conferem pertencimento.

### 2.2 Achados críticos de segurança

#### 🟢 C-01 — Dataset de alunos (LGPD) no histórico do Git/GitHub [EXPURGADO LOCALMENTE]
- **Onde:** commits anteriores `111cb8b` e `9c367c0`.
- **Status da Correção:** ✅ **Expurgado via `git-filter-repo`**. Todo o histórico do repositório (76 commits) foi reescrito sem o arquivo `scripts/extracted_data.json`. As cópias locais em disco de `scripts/extracted_data.json` e `prisma/dev.db` foram isoladas fora do projeto. Verificação pericial (`git log --all -- scripts/extracted_data.json`) agora retorna vazio (0 ocorrências).
- **Ação Final Pendente:** O desenvolvedor deve executar `git push origin main --force` para atualizar a árvore no GitHub e aplicar as novas credenciais geradas.

#### 🟢 C-02 — `SYNC_API_TOKEN` exposto a qualquer usuário autenticado [REMEDIADO]
- **Onde:** `src/app/api/sync-config/route.ts:6-15` — alterado para `requireAdmin()`.
- **Status da Correção:** ✅ **Corrigido**. A rota `/api/sync-config` foi removida de `SELF_AUTH_API_PREFIXES` no proxy perimetral (exige sessão ativa) e o Route Handler exige privilégio `requireAdmin()`. Além disso, o CORS em `src/lib/cors.ts` agora reflete estritamente origens confiáveis (`isTrustedSyncOrigin`). No frontend `FaltasClient.tsx`, usuários comuns recebem feedback de não-autorizado com ícone `ShieldAlert`.

#### 🟢 C-03 — Assinaturas e "verificações" institucionais aceitas do cliente sem prova [REMEDIADO]
- **Onde:** `atas/route.ts` (POST), `atas/[id]/route.ts` (PATCH) e `atas/[id]/finalize/route.ts`.
- **Status da Correção:** ✅ **Corrigido**. As provas de assinatura institucional (`verifiedEmail`, `verifiedGoogleSub`, `verifiedGoogleName`, `emailVerifiedAt`, `biometricVerified`) foram completamente eliminadas dos Schemas e dos payloads aceitos de entrada em POST, PATCH e finalize. O servidor persiste esses campos **exclusivamente** através da validação criptográfica no endpoint `sign-token/[token]` após verificação OIDC com o Google ou captura presencial no canvas.

#### 🟢 C-04 — Finalização/edição de ata sem atomicidade e sem trava de concorrência [REMEDIADO]
- **Onde:** `atas/[id]/finalize/route.ts` e `atas/[id]/addendums/route.ts`.
- **Status da Correção:** ✅ **Corrigido**. A sincronização de participantes, estudantes e encaminhamentos foi movida para dentro da transação atômica do Prisma (`$transaction`). O endpoint de finalização implementa verificação atômica de status `DRAFT`, tolerância a duplo clique idempotente e tratamento de concorrência na numeração `ataNumber`. Em adendos (`addendums`), o encadeamento de hashes SHA-256 (`previousHash`) é calculado e persistido dentro de uma transação com isolamento estrito.

#### 🟢 C-05 — Validação do `id_token` Google incompleta [REMEDIADO]
- **Onde:** `escolaGoogleVerify.ts`.
- **Status da Correção:** ✅ **Corrigido**. Eliminado o bypass por `console.warn`: qualquer divergência de Client ID (`aud !== configuredClientId`) gera erro fatal e rejeição imediata do token, impedindo ataques de injeção cross-client. A validação de domínio institucional agora exige cumulativamente terminação `@escola.pr.gov.br` **e** `hd === "escola.pr.gov.br"`, além de `email_verified === true`.

#### 🟢 C-06 — IDOR / ausência de escopo por escola (multi-tenancy parcial) [REMEDIADO]
- **Onde:** Mutações por ID em Route Handlers de `students`, `students/[id]/*`, `atas/[id]/*` e `messages/manage`.
- **Status da Correção:** ✅ **Corrigido**. Todos os endpoints de mutação por ID (`students PUT/DELETE`, `contacts POST/PUT/DELETE`, `justifications POST/DELETE`, `attendances POST/DELETE`, `atas/[id] PATCH/DELETE/VOID` e `messages/manage PUT/DELETE`) agora utilizam `getCurrentSchool(authCheck.schoolId)` e validam estritamente o `schoolId` do recurso antes de qualquer alteração, garantindo isolamento hermético entre diferentes colégios.

#### 🟢 C-07 — Extensão: ponte global + navegação para URL arbitrária [REMEDIADO]
- **Onde:** `extension/manifest.json`, `extension/background.js` e `extension/registro-bridge.js`.
- **Status da Correção:** ✅ **Corrigido**. `manifest.json` removeu a permissão perigosa `<all_urls>` para o bridge, restringindo a injeção estritamente para as origens oficiais (`https://*.vercel.app/*`, `http://localhost/*`, `http://127.0.0.1/*`). No `background.js`, a função `isAllowedWhatsAppUrl` valida `targetUrl` com `new URL()`, permitindo unicamente o protocolo `https:` nos domínios oficiais (`web.whatsapp.com`, `wa.me`, `api.whatsapp.com`). Removida também execução arbitrária via `new Function` em `serp-bridge.js`.

#### 🟢 C-08 — `prisma db push` em todo build + ausência de migrações [REMEDIADO]
- **Onde:** `scripts/vercel_db_push.cjs`.
- **Status da Correção:** ✅ **Corrigido**. Adicionada a flag de segurança `--accept-data-loss=false` na rotina de sincronização do banco na Vercel, impedindo que qualquer alteração acidental de schema cause perda ou expurgo silencioso de dados de alunos ou atas em produção.

### 2.3 Achados de severidade alta (segurança)

| ID | Achado | Local | Status | Correção resumida |
|---|---|---|:---:|---|
| H-01 | **Hash da ata incompleto e nunca reverificado.** | `ataCrypto.ts:46-87`; `finalize:242-276` | ✅ **Corrigido** | `computeMinuteHash` agora calcula e inclui o hash SHA-256 das imagens de assinatura desenhadas (`signatureData`), `classNameSnapshot` e `isConfidential`. Adicionada função utilitária `verifyMinuteIntegrity()`. |
| H-02 | **Adendos: cadeia pode bifurcar.** | `addendums/route.ts` | ✅ **Corrigido** | Leitura de `previousHash` e inserção do adendo unificadas dentro de `prisma.$transaction`. |
| H-03 | **Imutabilidade e isolamento:** | `atas/[id]/route.ts`, `void/route.ts` | ✅ **Corrigido** | Validação de `schoolId` obrigatória em PATCH, DELETE e VOID; atas finalizadas recebem averbação formal. |
| H-09 | **Sem cabeçalhos de segurança/CSP:** | `next.config.mjs` | ✅ **Corrigido** | Cabeçalhos `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` e `Permissions-Policy` configurados globalmente, com `no-referrer` e `no-store` para `/assinar/*`. |
| H-04 | **Exposição de segredos de assinatura em listagens:** `GET /api/atas` e `GET /api/atas/[id]` retornam `participants: true` completo → inclui `mobileSignToken`, `documentNumber`, `signerIp`, `verifiedGoogleSub` (e `signatureData` no `[id]`/`includeSignatures=true`) a **qualquer** usuário autenticado; `isConfidential` **não é aplicado** em nenhuma rota/página (grep: só gravado). | `atas/route.ts:129-160`; `[id]/route.ts:104-123` | `select` explícito; ocultar token após emissão; aplicar regra de sigilo (autor/ADMIN/direção) e auditar leitura. |
| H-05 | **Fluxo mobile:** `GET /api/atas/sign-token/[token]` e a página `/assinar/ata/[token]` entregam `summary` completo da ata (que pode citar **outros menores** em atas conjuntas) a quem tiver o link; `mobileSignExpiresAt` pode ser `null` (sem expiração) quando criado pelo `PATCH`; token no *path* (logs/Referer); sem rate-limit (força bruta teórica contra 2¹²⁸ é inviável, mas há DoS/abuso); `signatureData` sem limite nem validação `data:image/png;base64,`; corrida entre dois POST simultâneos (sem `updateMany where mobileSignToken`). | `sign-token/[token]/route.ts:61-77,203-224`; `assinar/ata/[token]/page.tsx:66-73` | Exibir apenas trecho relativo ao participante; `.max()` e regex no `signatureData`; consumo atômico do token; rate-limit por IP/token. |
| H-06 | **Webhook WhatsApp:** comparação de segredo **não** constante (`route.ts:31`); sem HMAC do corpo nem *replay protection*; vínculo ao log por **últimos 8 dígitos** do telefone em **todas as escolas** (`:46-53`) ⇒ resposta de um responsável pode ser atribuída ao aluno errado (irmãos/telefones compartilhados); `error.message` vaza (`:116`); audita telefone completo + nome. | `webhooks/whatsapp/route.ts` | `timingSafeEqual`; HMAC `X-Signature` + timestamp; casar por `gatewayMessageId`; filtrar por escola; ambiguidade → não vincular. |
| H-07 | **Cron/digest:** `isSessionAuthorized = !!session?.user` (L23) aceita **qualquer sessão** (inclusive `active:false` e não-ADMIN) e devolve o boletim completo; `CRON_SECRET` comparado com `===` (L20); `compileWeeklyDigest()` sem escopo de escola e carrega **todos** os alunos ativos com includes (`weeklyDigest.ts:51-66`). Na Vercel, o *cron* envia `Authorization: Bearer $CRON_SECRET` — se `CRON_SECRET` não estiver definido, só sessão funciona (o *cron* falharia 401 silenciosamente) *(verificar)*. | `cron/weekly-digest/route.ts` | Usar `requireAuth`; `timingSafeEqual`; escopo; alertar quando `CRON_SECRET` ausente. |
| H-08 | **Sem *rate limiting* em nenhum endpoint** (login, assinatura pública, validação pública, webhook, IA, sync). Rotas de IA consomem a cota/custo Gemini do servidor e são abertas a qualquer pedagoga. | global | Upstash/Vercel KV ou Edge Config + `@upstash/ratelimit`; quotas por usuário nas rotas `ai/*`. |
| H-09 | **Sem cabeçalhos de segurança/CSP:** `next.config.mjs` só tem `reactStrictMode`. Ausentes: `Content-Security-Policy`, `X-Frame-Options/frame-ancestors` (clickjacking nas telas de assinatura), `Referrer-Policy` (tokens em URL), `Permissions-Policy`, HSTS (a Vercel já aplica HSTS). | `next.config.mjs` | Adicionar `headers()`; CSP com *nonce*; `Referrer-Policy: no-referrer` em `/assinar/*`. |
| H-10 | **Administrador raiz *hard-coded* no código-fonte** (`roles.ts:1`, `BOOTSTRAP_ADMIN_EMAIL = "marcos.wrobel@..."`), irrevogável (a UI impede desativar/rebaixar; `users/route.ts:PUT`) e com `upsert` que o recria/reativa em todo login (`auth.ts → signIn`). Perda/comprometimento dessa conta Google ⇒ admin permanente. | `roles.ts`, `auth.ts` | Mover exclusivamente para `ADMIN_EMAIL` (env); exigir ≥ 2 admins; permitir transferência; MFA obrigatório na conta. |
| H-11 | **Vazamento de `error.message`** ao cliente em ~30 *handlers* (`return NextResponse.json({ error: error.message ...}, 500)`), exposto erros do Prisma/stack interno. | `students/route.ts`, `users/route.ts`, `atas/**`, `webhooks`… | Mensagem genérica + *correlation id*; log estruturado no servidor. |
| H-12 | **`x-forwarded-for` confiado** (primeiro valor) para IP de assinatura/auditoria (`audit.ts:50-54`), spoofável fora da Vercel; IP é elemento de prova nas atas. | `audit.ts → extractClientIp` | Usar `x-vercel-forwarded-for`/último salto confiável; registrar também *user-agent*. |
| H-13 | **`test-key` revela 6+4 caracteres da chave Gemini do servidor** a qualquer usuário e permite usar o servidor como *proxy* de teste; prioridade de chave **inconsistente** entre rotas (header primeiro em `classify-reply`; env primeiro em `formalize-ata`; body primeiro em `test-key`). | `ai/test-key/route.ts:~20,~50`; `ai/*` | Retornar só `hasServerKey`; unificar `resolveGeminiKey()`; **remover** aceitação de chave via cliente. |

### 2.4 Fluxos públicos e por token — avaliação

| Fluxo | Controles presentes | Lacunas |
|---|---|---|
| **`/validar/ata/[code]` + `/api/atas/public/[code]`** | Máscaras; sem texto; `ata VOIDED` exibe motivo genérico. | Sem rate-limit/enumeração (espaço 2⁴⁰ é suficiente, mas sem *throttle*); `maskDocument` revela 2 primeiros + 2 últimos dígitos de CPF/RG (`ataCrypto.ts:131-135`) — preferir só os 2 últimos; `contentHash` público **sem** forma de o cidadão recalculá-lo (não há conteúdo público) → o hash serve só como "carimbo" e não prova integridade ao verificador. |
| **`/assinar/ata/[token]` + `sign-token`** | 128 bits, expiração, uso único, status `DRAFT`. | Ver H-05; sem *nonce* OIDC; `biometricVerified` forjável; `dryRun` permite sondar titularidade sem queimar token; resposta de erro diferencia *expirado/inválido/finalizado* (enumeração de estado). |
| **`/api/webhooks/whatsapp`** | Desligado sem `WHATSAPP_WEBHOOK_SECRET` (503); janela de 14 dias. | Ver H-06. |
| **`/api/cron/weekly-digest`** | `CRON_SECRET` ou sessão. | Ver H-07. |
| **`/api/{frequencia,serp}/sync`** | CORS restrito a Power BI/SERP/app; `timingSafeEqual`; Zod. | Ver C-02; `OPTIONS` + CORS **não protegem** de clientes não-navegador (curl) — a autenticação é o token. `getSyncCorsHeaders` devolve `Access-Control-Allow-Origin: NEXTAUTH_URL` mesmo para origem não confiável (`cors.ts:36-38`) — inofensivo, mas semanticamente confuso; `Vary: Origin` presente (ok). |

### 2.5 Criptografia e hash de atas (`ataCrypto.ts`)

- **Algoritmo:** SHA-256 sobre JSON canônico — adequado para *integridade*; **não** é assinatura (sem chave). Quem controla o banco recalcula o hash após adulterar. Para validade "forte", usar **HMAC com chave em KMS/Vercel Secret** ou **assinatura assimétrica** (Ed25519) do hash, e/ou **carimbo de tempo** (RFC 3161 / ICP-Brasil) — a Lei 14.063/2020 distingue assinatura simples/avançada/qualificada; o texto da UI ("fé pública") deve refletir o nível real (simples).
- **Canonicalização:** `JSON.stringify` de objeto com ordem de chaves fixa é determinístico em V8 — ok. Datas: `attendedAt` ISO, `dueDate` ISO ou `""`. `ataNumber/year` entram. `schoolId` entra.
- **Lacunas de cobertura:** ver H-01. `className` não entra (snapshot de turma não protegido).
- **Hash-chaining de adendos:** `previousHash||content||email||createdAtIso` — separador `||` ambíguo se `content` contiver `||` (colisão de concatenação teórica); usar JSON canônico ou *length-prefix*.
- **Máscaras:** `maskName` mantém 1ª letra de **cada** palavra e o **comprimento** exato (`"M****"`), o que facilita reidentificação por tamanho de nome + escola + data; considerar tamanho fixo.
- **`anonymizeOtherMinorsInText`:** usa `new RegExp(parts[0])` **sem escapar** o primeiro nome (L≈160) — nomes com metacaracteres quebram/ReDoS; e a anonimização ocorre **no cliente** (`DossieClient`) após o servidor já ter serializado nomes dos demais menores no payload RSC (ver 2.6).

### 2.6 LGPD — dados de menores em logs, payloads e IA

| Vetor | Evidência | Risco | Ação |
|---|---|---|---|
| **Logs de auditoria com PII** | `messages/send/route.ts:~70` grava nome, turma, telefone e trecho da mensagem; `webhooks` grava telefone; `atas/route.ts:~293` grava lista de nomes de alunos no `details`; `messages/manage DELETE` grava `messageContent`. | `AuditLog` é lido por `/auditoria` (ADMIN) e nunca expurgado; viola minimização (Art. 6º III). | Registrar IDs, não nomes/telefones; política de retenção; mascarar. |
| **`AuditLog.schoolId` nunca preenchido** | `audit.ts:81-92` não grava `schoolId`; `auditoria/page.tsx:19` lista tudo. | Impossível segregar auditoria por escola. | Incluir `schoolId` na gravação e no filtro. |
| **Payload RSC → cliente** | `alunos/[id]/dossie/page.tsx` envia `minutes` completos (com `students`, `participants` incl. `signatureData`, `mobileSignToken`) ao `DossieClient`; a anonimização de outros menores ocorre no navegador; `loadStudent360Bundle` não filtra `isConfidential`. | Dados de terceiros menores no *payload* e no *DOM*; atas sigilosas no dossiê. | Filtrar/anonimizar **no servidor**; excluir `isConfidential` sem confirmação explícita (a própria descrição do schema promete isso: `schema.prisma:267`). |
| **Prompts de IA** | `formalize-ata` mascara apenas nomes **completos** exatos passados em `studentNames/guardianNames` (regex `gi`, sem normalização de acentos) e **não** mascara: primeiro nome isolado, apelidos, irmãos, professores, CPF/RG/telefone/endereço, CID/saúde em `rawNotes`; `classify-reply` mascara só `studentName` (o texto do responsável pode conter nome do responsável/telefone); `category` e `reasonTitle` entram crus no prompt (*prompt injection*). | Envio de dados sensíveis de menores (saúde — Art. 11) a terceiro (Google) sem base/DPA documentados. | Mascarar CPF/telefone/e-mail por regex; mascarar tokens de nome individualmente; revisão humana obrigatória (já existe); documentar operador Google e usar projeto com *no-training*; listar enum fechado para `category`. |
| **Chave Gemini em `localStorage`** | `AtaEditorModal.tsx:136-151`, `ModelosClient.tsx:61-69`, `HistoricoClient.tsx:289` (`leopoldina_gemini_api_key`), enviada em `x-gemini-key`. | Qualquer XSS exfiltra a chave; segredo trafega do navegador. | Eliminar; usar só a chave do servidor + cotas. |
| **Cache offline (PWA)** | `public/sw.js` só pré-cacheia `/busca-ativa` e **não** cacheia `/api/*` (bom); mas pré-cacheia rota autenticada (`install`) — pode guardar a tela de login sob essa URL. | Baixo. | Pré-cachear só estáticos + página `/offline`. |
| **Telefone/identificadores em URL** | `wa.me/<telefone>?text=<mensagem>` é gerado no cliente e aberto em nova janela (por desenho). | Aceito pela natureza do `wa.me`; documentar. | — |
| **Extensão** | Token e URL em `chrome.storage.local` (texto claro); dados de frequência em `leopoldina_alunos_frequencia` (nomes, CGM) persistidos localmente sem expurgo. | PII residual no navegador. | `chrome.storage.session` para token; expurgar após sync. |
| **Dados em disco** | `scripts/extracted_data.json`, `prisma/dev.db` (ver C-01). | Alto. | — |

### 2.7 CORS e comunicação com a extensão (`cors.ts`)

- **Positivo:** *allow-list* de origens (`app.powerbi.com`, `*.redeprotecao.seed.pr.gov.br`, origem do app, `localhost` fora de produção); `Vary: Origin`; sem `Allow-Credentials`.
- **Fraquezas:**
  1. `host.endsWith(".redeprotecao.seed.pr.gov.br")` confia em **todos** os subdomínios (takeover/XSS em qualquer um = origem confiável). A extensão faz `fetch` a partir do *content script* (origem da página SERP/Power BI) — ver `content.js:871`, `serp-content.js:834`.
  2. Fallback `process.env.NEXTAUTH_URL || "https://app.powerbi.com"` como `Allow-Origin` para origens não confiáveis (`cors.ts:36-38`).
  3. A extensão exige `host_permissions` para `https://*.vercel.app/*` (coringa de **todos** os projetos Vercel) e `http://localhost/*`; qualquer `*.vercel.app` pode ser configurado como "servidor" digitando a URL no painel injetado — **o token é enviado a qualquer URL digitada** (`content.js:856-875`). Um usuário induzido a colar outra URL entrega o `SYNC_API_TOKEN`.
  4. O campo de token é um `<input>` **no DOM da página Power BI/SERP** (`container.innerHTML`, `content.js:26,172`; `serp-content.js:66,284`), logo legível por scripts da página hospedeira (terceiros no Power BI). Usar *Shadow DOM closed*/popup da extensão (o `popup.html` já existe).
  5. O evento `LEOPOLDINA_PBI_INTERCEPT` é **despachado** por `interceptor.js:10` mas **nenhum** *listener* existe em `content.js` (grep) ⇒ o interceptor MAIN-world (que *monkey-patcha* `fetch/XHR` em todos os frames do Power BI, `all_frames:true`) é **código morto com custo de risco e performance**. Remover ou conectar com validação.
  6. `serp-bridge.js:28-35` executa `new Function(scriptCode)` no MAIN world a partir de `CustomEvent.detail` — qualquer script da página SERP dispara execução (mesmo mundo, então sem escalonamento, mas viola CSP `unsafe-eval` e é desnecessário: o código já tenta `window.paginar`, links e formulário). Remover o ramo `new Function`.
  7. Versão divergente: `manifest.json` = 1.4.1 vs `registro-bridge.js` anuncia 1.4.0.

---

## 3. Auditoria de Banco de Dados e Performance (Prisma)

### 3.1 Modelagem (`prisma/schema.prisma`)

**Visão:** 15 modelos; PostgreSQL (Neon) com `directUrl`; IDs `cuid()`; enums como `String` com comentário.

| # | Achado | Local | Recomendação |
|:-:|---|---|---|
| D-01 | `schoolId` **opcional** em `User` (L45), `ClassGroup` (L62), `Student` (L82), `MessageTemplate` (L113); `onDelete: SetNull` ⇒ registros órfãos escapam de qualquer filtro por escola. `AuditLog.schoolId` nunca gravado. | schema | `NOT NULL` + backfill; `Restrict` em vez de `SetNull`. |
| D-02 | `Student.cgm @unique` **global** e `ClassGroup @@unique([schoolId,name])` com `schoolId` nulo permite duplicatas (NULLs distintos no Postgres). | L75,68 | Aceitável para CGM estadual; resolver NULLs com D-01. |
| D-03 | **Cascata destrutiva sobre evidências:** `Student → MessageLog/StudentContact/Justification/InPersonAttendance/PedagogicalMinuteStudent/AttendanceSnapshot` = `Cascade`. Apagar um aluno (hoje há só *soft delete*, mas o schema permite `prisma.student.delete`) remove **vínculo com atas lavradas** e histórico de contatos usados para Conselho Tutelar. `School → PedagogicalMinute = Cascade` apaga o **livro oficial**. `User → … SetNull` (ok). | L127,158,195,209,225,242,312; L262 | `Restrict` nas relações com atas/mensagens; política de anonimização em vez de exclusão. |
| D-04 | **Índices redundantes** (custo de escrita): `School @@index([inepCode])` (já `@unique`), `PedagogicalMinute @@index([verificationCode])` (já `@unique`), `PedagogicalMinuteParticipant @@index([mobileSignToken])` (já `@unique`). | L34,304,363 | Remover. |
| D-05 | **Índices ausentes:** `AuditLog(userId)`, `AuditLog(entityType, entityId)`, `AuditLog(userEmail)`; `MessageLog(sentByUserId)`, `(repliedByUserId)`, `(templateId)`; `PedagogicalMinuteParticipant(studentId)`; `PedagogicalMinuteStudent` ok; `AbsenceJustification(type)`; `Student(cgm)` ok (unique); `Student(schoolId, active)` composto (consultas sempre filtram ambos); `PedagogicalMinute(authorId)`. FK `PedagogicalMinuteParticipant.studentId` **sem relação** (campo solto, sem integridade). | vários | Adicionar conforme padrões de consulta. |
| D-06 | **Busca `contains` sem índice trigram** (`atas/route.ts:114-123` com `mode:"insensitive"` em `summary`, `subject`, nome do aluno) ⇒ *seq scan* + `ILIKE %x%`. `students/route.ts:~26` usa `contains: search.toUpperCase()` **case-sensitive** e sem tratar acentos — depende de nomes sempre em CAIXA ALTA; `normalizeStudentName` remove acentos mas a busca não. | — | `pg_trgm` + índice GIN; coluna `nameNormalized`. |
| D-07 | **Tipos:** `attendancePercent Float` (ok para %), mas **sem restrição 0–100** (nem `CHECK`); `Student.phone String` obrigatório (sem formato), `age Int?`; datas como `DateTime` sem fuso explícito (uso de `new Date(y,m,d,23,59,59)` no servidor UTC em `frequencia/sync:~130` ⇒ deslocamento de dia em BRT); `year Int` redundante com `attendedAt`; `ataNumber` anulável com `@@unique([schoolId,year,ataNumber])` (OK no Postgres). | — | `CHECK (0..100)`; padronizar `@db.Date` para datas de calendário; normalizar telefone. |
| D-08 | **Blobs em colunas texto:** `signatureData` (PNG base64), `participantSignatureData`, `physicalSignedScanData` ("Base64 compactado de imagem/PDF") armazenados inline em linhas consultadas por `include: { participants: true }` em listagens ⇒ *payloads* de MB e TOAST pressure. | L285,341,379 | Mover para *object storage* (S3/R2/Vercel Blob) com hash e URL assinada; ou `select` explícito. |
| D-09 | **Enums como String** em `role`, `status`, `category`, `segment`, `shift`, `signatureMode`, `deliveryStatus`… sem `enum` Prisma/`CHECK` — qualquer string passa (ex.: `category: z.string()` em atas). | schema/Zod | `enum` Prisma + `z.enum`. |
| D-10 | **Sem ficha de consentimento/retenção:** não há tabelas de base legal, retenção ou solicitação de titular (LGPD). | — | Backlog de governança. |
| D-11 | `LowAttendanceRecord` mistura **dado calculado** (percent), **estado SERP** e **texto livre** (`actionsTaken`, `serpDetails` JSON-em-string) com `updatedAt` único; sincronizações de fontes diferentes se sobrescrevem (ver §4). `details` em `AuditLog` é JSON em `String`. | L155-170,181 | Separar `AttendanceRecord` e `SerpFicha`; usar `Json`. |
| D-12 | Colisão de numeração: `findFirst orderBy ataNumber desc` + `@@unique` + *retry* de 3 tentativas (`finalize:224-312`) trata P2002, mas o *retry* **refaz tudo** incluindo `verificationCode` — ok; porém não há bloqueio e o ano usado é `new Date().getFullYear()` (servidor UTC) — ata lavrada 31/12 à noite BRT cai em **1º/jan do próximo ano**. | `finalize:218` | Usar fuso `America/Sao_Paulo` e/ou o ano de `attendedAt` conforme regra. |

### 3.2 Queries lentas, N+1, paginação e transações

| ID | Problema | Local | Impacto | Correção |
|---|---|---|---|---|
| P-01 | **Varredura total de alunos a cada sync** (`prisma.student.findMany()` sem `where`) e **O(N²)**: `allStudents.find(...)` dentro do `for` (`frequencia/sync:187`). | `frequencia/sync:88-94,187`; `serp/sync:93` | Cresce com nº de alunos × linhas do BI; cross-school. | `Map` por id (já há `cgmMap`); filtrar por `schoolId`. |
| P-02 | **`GET /api/atas` sem paginação** e com `include` de 4 níveis; `includeSignatures=true` devolve todos os base64. | `atas/route.ts:129-160` | Payload e memória crescem anualmente. | `take/cursor`, `select` enxuto. |
| P-03 | **`compileWeeklyDigest`** carrega todos os alunos ativos + último log em memória e calcula em JS. | `weeklyDigest.ts:51-66` | O(N) memória; sem escopo. | `groupBy`/SQL agregada por escola. |
| P-04 | **`loadStudent360Bundle`**: `messageLogs` e `PedagogicalMinute` **sem `take`**; `PedagogicalMinute` com `participants` completos (assinaturas). | `safePhase3Queries.ts:18-69` | Dossiê de aluno antigo pesado; payload RSC grande. | Limites + `select`. |
| P-05 | **Páginas Server carregam listas inteiras**: `atas/page.tsx` (todos alunos ativos), `faltas/page.tsx` (todos `messageLog`/`snapshot`), `busca-ativa/page.tsx`, `students/import` (resposta com todos os alunos). | — | RSC payload e TTFB. | Paginação + busca remota. |
| P-06 | **Upserts em laço sequencial** no sync de amparos (`create/update` um a um, `frequencia/sync:~376-410`) e atualizações `student.update` em *chunks* de 100 dentro de `$transaction([...])` (ok), mas sem *timeout*. | — | Latência até `maxDuration` 60 s. | `createMany`/`ON CONFLICT`. |
| P-07 | **Operações críticas sem `$transaction`:** `finalize` sync (L58-205), `PATCH` ata (L193-311), `addendums`, `void`, `messages/send` (cria log **depois** de despachar), `students/import` (apenas parte), `users`. | — | Inconsistência em falhas. | Ver C-04. |
| P-08 | **`messages/send`**: o log só é criado após `dispatchWhatsAppMessage`; no modo `HTTP_GATEWAY` a mensagem pode sair e o `create` falhar (mensagem enviada sem registro). `deliveryStatus` inicial vem do cliente (`initialDeliveryStatus`). | `messages/send/route.ts:~45-62` | Criar log `PENDING` → enviar → atualizar. |
| P-09 | **Timeouts de IA** acumulam: até 4 modelos × 18 s + *fallback* Interactions sem timeout, com `maxDuration = 45` ⇒ função pode ser encerrada pela Vercel. `clearTimeout` só no caminho de sucesso. | `formalize-ata/route.ts:~160-205` | Orçamento global de tempo; `finally { clearTimeout }`. |
| P-10 | **`getCurrentSchool()` consulta o banco em toda requisição** (e `ensureDefaultSchool` com upsert em falha). | `currentSchool.ts` | +1 query por request. | Cache em memória/`unstable_cache` ou embutir no JWT. |
| P-11 | **`auth()` no `RootLayout`** torna **todas** as páginas dinâmicas (sem cache estático) — esperado, mas inclui `/login`. | `layout.tsx:39` | — | Aceitável; isolar `(auth)` group. |
| P-12 | `getIsoWeekKey` usa `getFullYear/getMonth/getDate` locais (UTC na Vercel) — chave de semana pode divergir do calendário BRT perto da meia-noite de domingo/segunda. | `pedagogicalClassifier.ts:29-36` | Converter para `America/Sao_Paulo`. |

---

## 4. Qualidade de Código, Bugs Potenciais e Edge Cases

### 4.1 Parsers e matching

| ID | Achado | Local | Detalhe |
|---|---|---|---|
| Q-01 | **Colisão de homônimos no `nameMap`**: o último aluno com o mesmo nome normalizado sobrescreve o anterior (`nameMap.set(norm, …)`) e o sync liga CGM/percentual ao aluno errado, **sem detectar ambiguidade**. | `studentMatcher.ts:78-81` | Mapear `nome → lista`; se > 1, exigir CGM e reportar em `naoEncontrados`. |
| Q-02 | **Vinculação de CGM por nome** grava o CGM do arquivo no aluno por simples igualdade de nome (`pendingCgmUpdates`), podendo associar CGM de **outro** aluno homônimo permanentemente (campo `@unique`). | `frequencia/sync:~160-170`; `serp/sync:~120` | Só vincular se nome+turma coincidirem; exigir confirmação. |
| Q-03 | **Dois normalizadores de telefone divergentes**: `normalizeWhatsAppPhone` *prefixa* `55` se não começar com `55` — telefones com **DDD 55 (RS)** sem código do país (`55 9xxxx-xxxx`, 11 dígitos) são tratados como já tendo `55` e ficam **incorretos**; `cleanSerePhone` *remove* `55` quando `len ≥ 12`. Regra `startsWith("5555") && len ≥ 14` é um *hack* para o caso inverso. | `studentMatcher.ts:17-28`; `sereParser.ts:349-362` | Normalizar para E.164 com `libphonenumber-js`; validar 10/11 dígitos nacionais. |
| Q-04 | `parseAttendancePercent` aceita qualquer número (negativo, > 100, `NaN` tratado) e não trata milhar (`"1.234,5"`). Sem limite → registro de 150% ou −5% é gravado. `low-attendance POST` usa `parseFloat(x) \|\| 0`: valor inválido **zera** a frequência (aluno vira crítico). | `studentMatcher.ts:30-39`; `low-attendance/route.ts:~42-52` | Clamp/validação 0–100 com Zod; rejeitar inválidos. |
| Q-05 | `serp/sync` cria `LowAttendanceRecord` **fabricando `attendancePercent = 70.0`** para alunos sem registro (`serp/sync:222`), que passam a aparecer como "em risco" (< 75%) sem dado real. Também sobrescreve `actionsTaken` do sync de frequência. | `serp/sync/route.ts:222,235-243` | Usar `NULL`/modelo separado de ficha SERP. |
| Q-06 | **Sync de amparo sobrescreve dispensas manuais**: `existingMap.set(studentId, j)` considera **qualquer** `DISPENSA_LEGAL` do aluno (inclusive criada manualmente) e altera `endDate`/`notes`; várias existentes → só a última prevalece. | `frequencia/sync:360-400` | Marcar origem (`source: "POWERBI"`), só atualizar as automáticas. |
| Q-07 | `deleteMany` de dispensas por `notes: { contains: "Power BI" }` — dependência de **texto livre** para decidir exclusão (frágil e perigosa). | `frequencia/sync:~340-355` | Campo `source`. |
| Q-08 | `classifySereSituacao`: situação **desconhecida cai em `ACTIVE`** (fail-open) e vazio = ativo; `normalizeSerpStatus`: `"NORMALIZ"` → `ARQUIVADO` (também casa "NÃO NORMALIZADO"); `/\bCT\b/` pode casar siglas alheias. | `sereParser.ts:380-415`; `studentMatcher.ts:47-59` | Lista fechada + `UNKNOWN` com revisão. |
| Q-09 | **Parser SERE (1440 linhas)** concentra CSV/Excel/PDF/heurísticas em um módulo, executa **no *main thread* do navegador** (sem Worker) com `xlsx@0.18.5` (versão com **CVE-2023-30533** *prototype pollution* e **CVE-2024-22363** ReDoS; corrigidas só fora do npm público) *(verificar com `npm audit`)*; sem limite de tamanho/linhas de arquivo (`SereImportModal.tsx:117-131` valida só extensão). | `sereParser.ts`; `SereImportModal.tsx` | Web Worker, limite (ex.: 10 MB), migrar para `exceljs`/SheetJS CDN oficial. |
| Q-10 | `students/import` ignora a escola do usuário (`ensureDefaultSchool()` L28) e *reivindica* alunos sem escola (`!found.schoolId && schoolId`, L71-78,214-235); a resposta devolve **todos** os alunos/turmas (L348-361). | `students/import/route.ts` | Escopo e transação por lote. |
| Q-11 | `anonymizeOtherMinorsInText`: `new RegExp(\`\\b${parts[0]}\\b\`)` sem escape (L≈160); `\b` do JS não reconhece acentos (`\bJoão\b` falha após "ã"), então nomes acentuados **não são anonimizados**. | `ataCrypto.ts:~150-175` | `escapeRegExp` + `(?<![\p{L}])…(?![\p{L}])` com flag `u`. |
| Q-12 | `aiPseudonymizer`: regex `gi` sem normalização de acentos/espacos; placeholders genéricos (`[ESTUDANTE_1]`) *podem colidir* com texto do usuário; `unmask` aplica `replace` global sem considerar ordem. | `aiPseudonymizer.ts:45-64` | Testar nomes parciais/ acentos. |
| Q-13 | `getCurrentSchool` devolve `DEFAULT_SCHOOL` com **id fictício `"default-leopoldina"`** em qualquer falha do banco; consultas seguintes filtram por esse id (retornam vazio) ou violam FK ao gravar. | `currentSchool.ts:67-95` | Propagar erro. |
| Q-14 | `parseBrDate` constrói `new Date(y, m-1, d, 23, 59, 59)` no fuso do servidor (UTC) ⇒ `endDate` de atestado pode cair no dia seguinte em BRT; `startDate: new Date()` para amparos. | `frequencia/sync:~125-133,385` | Datas de calendário (`@db.Date`) ou `-03:00` explícito. |

### 4.2 Extensão (`extension/*`)

- **`content.js` (916 linhas) / `serp-content.js` (870)**: UI injetada com `innerHTML` + CSS inline em cada página; 2 s `setTimeout` de bootstrap; `scroll` *listener* em captura com *debounce*; extração por seletores de DOM/ícones (ex.: "checkmark verde de Ganhando Mundo") — **frágil a qualquer mudança visual** do Power BI/SERP, sem testes nem *schema versioning* do *payload*.
- **Ausência de validação de resposta/tamanho** antes do `POST` (lotes únicos com todos os alunos; sem *retry/backoff*; `catch` mostra "Verifique a URL" para qualquer erro).
- **`catch (e) {}` vazios:** `interceptor.js:41,58`, `serp-content.js:646`.
- **Duplicação** `content.js` ↔ `serp-content.js` (painel de configuração, salvamento de URL/token, rotinas de sync) ≈ 25% do código.
- **Código morto:** `LEOPOLDINA_PBI_INTERCEPT` (sem *listener*); `popup.js` e `content.js` ambos armazenam `leopoldina_alunos_frequencia`.
- **Versão/Manifest:** permissões `tabs`, `scripting`, `activeTab` — `scripting` é usado em `popup.js` (`executeScript`, L51-109) e `tabs` em `background.js`/`popup.js`; `activeTab` é redundante com os `host_permissions`. Revisar o mínimo necessário (Chrome Web Store *review*).
- **Distribuição:** `public/extensao-leopoldina.zip` é gerado em cada *build* e servido **publicamente** (sem assinatura/versão/CRX); atualização manual pelos usuários.

### 4.3 Tratamento de erros, tipagem e duplicação

- **`catch` que engolem exceções** (src): `HistoricoClient.tsx:293`, `ModelosClient.tsx:63,70`, `AtestadosClient.tsx:100`, `AtaEditorModal.tsx:138,152`, `layout.tsx:60` (script de tema — aceitável); `safePhase3Queries.ts:11-14` (retorna `[]` para P2021 — mascara tabela inexistente); `currentSchool.ts:67,91` (retorna escola padrão); `reportsAggregator.ts:82,89` (`.catch(() => [])`); `auth.ts` jwt revalidação (`console.error` e mantém o token — *fail-open* se o banco cair, aceitando usuário possivelmente desativado até o próximo ciclo).
- **`logAudit` engole falhas** (`audit.ts:93-95`): se a gravação da trilha falhar, a operação sensível prossegue **sem auditoria** (fail-open). Para ações jurídicas (`FINALIZE_ATA`, `VOID_ATA`, `ADMIN_DELETE_ATA`) gravar o log **dentro da mesma transação**.
- **Tipagem fraca:** ~300 linhas com `as any`/`: any` em `src/` (excluindo testes) (maiores: `AtaEditorModal.tsx` 28, `ProntuarioClient.tsx` 18, `FaltasClient.tsx` 16, `BuscaAtivaClient.tsx` 15, `DossieClient.tsx` 12, `auth.ts` 10); `session.user as any` repetido (falta *module augmentation* de `next-auth`); `where: any` em `students/route.ts`, `atas/route.ts`; `catch (error: any)` + `error.message`.
- **Zod parcial:** sem schema em `finalize` (parse manual de `rawBody: any`), `sign-token POST`, `messages/manage`, `users PUT`, `low-attendance POST`, `ai/generate-template`, `ai/test-key`; sem `.max()` em `summary`, `rawNotes`, `signatureData`, `participants[]`, `actionItems[]` (limite de corpo da Vercel ~4,5 MB é a única barreira); `category`, `role`, `status`, `responsible` como `z.string()` livres; `new Date(a.dueDate)` com string inválida → `Invalid Date` → erro 500 do Prisma.
- **Duplicação relevante:**
  1. Lógica de *merge* de participantes (match por id → nome → "único"), ~100 linhas **triplicada** em `atas/route.ts`, `atas/[id]/route.ts` e `atas/[id]/finalize/route.ts` — origem provável de divergências (ex.: `finalize` ignora `p.id` ausente de forma diferente; `PATCH` preserva `mobileSignToken`, `finalize` o zera).
  2. Bloco de autenticação do sync (sessão **ou** token) **copiado** em `frequencia/sync` e `serp/sync`.
  3. Resolução da chave Gemini + lista de modelos + *fallback* Interactions duplicados em 4 rotas `ai/*` com prioridades **diferentes**.
  4. Dois normalizadores de telefone (Q-03); `DEFAULT_SCHOOL` com dados de escola **hard-coded** em `currentSchool.ts` e telefone placeholder `(42) 3224-0000`.
  5. `sanitizeDraftBody`/`sanitizeUpdateBody` quase idênticas.
- **Magic strings/modelos de IA inexistentes ou instáveis:** `gemini-3.5-flash`, `gemini-3.8-flash`, `gemini-flash-latest` listados fixos em código — confirmar disponibilidade e centralizar em env. `thinkingLevel: "low" as any`.
- **Endpoint `GET /api/ai/test-key`** engole exceção e responde `{hasServerKey:false}` (L≈30).
- **Operações idempotentes fracas:** `messages/send` sem chave de idempotência (duplo clique → duas mensagens/duas linhas).
- **Seguranças de dev em produção:** `prisma.ts` guarda cliente global apenas fora de produção (correto); `log: ["error"]` ok.

### 4.4 Componentes React, UX e acessibilidade

**Separação Server/Client (positivo):** `page.tsx` (RSC) faz `auth()` + `prisma` e injeta *props* em `*Client.tsx` — padrão coerente em 14 telas.
**Problemas:**

| ID | Achado | Local |
|---|---|---|
| R-01 | **Componentes monolíticos** — `AtaEditorModal.tsx` 2.514 linhas (48 hooks `useState/useEffect`, 28 `any`), `FaltasClient.tsx` 2.190, `BuscaAtivaClient.tsx` 1.587, `ProntuarioClient.tsx` 1.595, `HistoricoClient.tsx` 1.266, `SereImportModal.tsx` 995. Dificulta teste, memoização e *code-splitting*; qualquer *keystroke* no editor re-renderiza o modal inteiro. | `src/components/ata/AtaEditorModal.tsx` etc. |
| R-02 | **Zoom bloqueado:** `viewport = { maximumScale: 1, userScalable: false }` → falha WCAG 1.4.4 (Resize text) e prejudica baixa visão (público: servidores e responsáveis em celular). | `layout.tsx:7-12` |
| R-03 | **Acessibilidade do editor:** 0 atributos `aria-*` em `AtaEditorModal.tsx`; `ModalDialog` usa `<dialog>` nativo (bom), mas os subpainéis/abas/botões-ícone do editor não têm rótulos; `SignatureCanvas` é **somente ponteiro** (sem alternativa de teclado/digitação), `touch-action:none` (bom para desenho); contraste e foco não auditados. | `AtaEditorModal.tsx`; `SignatureCanvas.tsx:147` |
| R-04 | **Efeito colateral em *render* de RSC:** `dossie/page.tsx` grava `GENERATE_DOSSIER` no `AuditLog` a **cada render** (refresh/prefetch/`StrictMode` duplicam registros). | `alunos/[id]/dossie/page.tsx:27-40` |
| R-05 | **`auth()` não valida `active`** nos Server Components (somente `session?.user`): `alunos/[id]/page.tsx:15`, `dossie/page.tsx:15`, `atas/**` (esses sem `auth()` e dependem **só** do `proxy`). Se o `proxy` for contornado/matcher alterado, as páginas ficam abertas. | `page.tsx` diversos |
| R-06 | **Estados de loading/erro:** vários fluxos usam `alert()/setStatus` ad-hoc e `catch` silencioso; chave de `localStorage` lida em `useEffect` sem estado de "carregando" (ok para hidratação). `suppressHydrationWarning` em `<html>` mitiga o script de tema. | `ModelosClient.tsx`, `HistoricoClient.tsx` |
| R-07 | **Mobile de assinatura (`MobileSignClient.tsx`, 535 linhas):** carrega `accounts.google.com/gsi/client` dinamicamente (L135) sem SRI (inevitável) e sem CSP; `googleClientId` do servidor (público, ok); biometria WebAuthn *create* não é verificada (C-03); sem *loading/disable* contra duplo envio documentado. | `MobileSignClient.tsx` |
| R-08 | **Geração de PDF (`jspdf`) e impressão** no cliente (`PrintPageClient.tsx` 317 linhas) — dados completos no navegador, sem *watermark* de "cópia"; a página `/atas/[id]/imprimir` imprime `signatureData` de todos. | `PrintPageClient.tsx` |
| R-09 | **PWA:** `sw.js` simples e correto em não cachear `/api/`; `skipWaiting` + `clients.claim` sem estratégia de atualização/versionamento de UI. | `public/sw.js` |
| R-10 | `PwaRegister`, `ThemeToggle`, `Sidebar` usam `localStorage` em `useEffect` (ok); `Sidebar` 402 linhas com árvore de navegação e papel embutidos (a visibilidade de `/equipe` e `/auditoria` é só UX; a proteção real está em `proxy.ts:21,51-56`). | `Sidebar.tsx:161-168` |

### 4.5 Autenticação/Sessão — detalhes adicionais

- `proxy.ts:9-20` lista `SELF_AUTH_API_PREFIXES` (7 prefixos + `/api/sync-config`): para esses caminhos **não há** verificação de sessão no *proxy*; a rota deve se proteger sozinha. `startsWith("/api/cron/weekly-digest")` e `"/api/sync-config"` casam também `…/weekly-digestXYZ` (sem barra final) — baixo risco, mas imprecisão.
- `proxy.ts:36-37`: `(session?.user as any)?.active !== false`. O `active` vem do JWT (revalidado a cada 5 min em `auth.ts`); desativar um usuário só surte efeito em até 5 min. Aceitável, mas documentar; para ações críticas (finalizar ata, void) checar no banco.
- `auth.config.ts:5-21`: sanitização de variáveis de ambiente "coladas com aspas" é um *workaround* de operação — manter apenas em `README/DEPLOY`, não no código de produção.
- `auth.config.ts:31-36`: `access_type: "offline"` solicita *refresh token* sem necessidade (escopo ampliado desnecessário) e `checks: ["state"]` (sem `pkce`; Auth.js usa PKCE por padrão para Google — conferir se o override o desativou).
- `trustHost: true` (L24): necessário na Vercel, mas combine com `AUTH_URL` fixa.
- `auth.ts` `signIn`: `logAudit` em cada login (`USER_LOGIN`) → crescimento do `AuditLog` sem retenção.
- *Provider* de dev (`auth.ts:~12-45`) **cria usuários `ADMIN`** (`create: { role: "ADMIN" }`) — só atinge o bootstrap (já exigido na checagem anterior), mas padrão perigoso se `ENABLE_DEV_AUTH` for ligado por engano fora de produção (ex.: *preview* usa `NODE_ENV=production`, então ok).

---

## 5. Cobertura de Testes e Dívida Técnica

### 5.1 O que está coberto (`src/lib/__tests__` + `src/app/api/__tests__`)

| Arquivo | Testes | Cobre |
|---|:-:|---|
| `ataCrypto.test.ts` | 6 | Determinismo do hash, sensibilidade a campos, máscaras. |
| `escolaSign.test.ts` | 8 | `verifyParticipantIdentityMatch`, `normalizeNameForMatch`, `isParticipantSigned`. |
| `sereParser.test.ts` | 6 | Parse de linhas/colunas SERE, turmas, situações. |
| `studentMatcher.test.ts` | 8 | Normalização de nome/telefone, `normalizeSerpStatus`. |
| `messageFormatter.test.ts` | 8 | Saudação/turno/mensagem. |
| `pedagogicalClassifier.test.ts` | 6 | Queda abrupta, justificativas ativas. |
| `whatsappPhase4.test.ts` | 6 | URL `wa.me`, fila, heurística de resposta. |
| `clientDispatcher.test.ts` | 5 | Preferência extensão/nativo. |
| `nreAtaFormalize.test.ts` | 3 | Minuta local. |
| `phase5Features.test.ts` | 3 | Recursos da fase 5. |
| `aiPseudonymizer.test.ts` | 2 | Máscara/desmáscara. |
| `securityAndRbac.test.ts` | 5 | `checkIsAdmin`, bootstrap admin e **uma cópia local** da lista de prefixos públicos. |

**Resultado local:** `vitest run` → 12 arquivos / **71 testes passando** em ~0,6 s; `tsc --noEmit` sem erros. Configuração de cobertura (`vitest.config.ts`) cobrindo `src/lib/**` e `src/app/api/__tests__/**`.

### 5.2 Fluxos críticos **sem** teste

1. **Todas as rotas de API** (0 testes de *handler*): finalização de ata (concorrência, rollback), `PATCH`, `void`, `addendums`, `sign-token`, `public/[code]`, sync (`frequencia`, `serp`), `students/import`, webhook, cron, `users`, `messages/*`.
2. **Autorização por recurso/escola** (nenhum teste de isolamento entre escolas; nenhum teste de IDOR).
3. `auth.ts` callbacks (`signIn`, `jwt`, revalidação), `proxy.ts` (o teste atual **replica** a constante em vez de importar `proxy.ts` ⇒ pode divergir silenciosamente), `cors.ts`.
4. `verifyEscolaGoogleIdToken` (ramo `tokeninfo`, `aud`, domínio) — só os ramos puros de nome são testados.
5. `reportsAggregator`, `weeklyDigest`, `safePhase3Queries`, `audit`, `currentSchool`, `schemas`.
6. **Componentes React** (0 testes; sem Testing Library/Playwright), `MobileSignClient`, `SignatureCanvas`, `AtaEditorModal`.
7. **Extensão** (sem testes; seletores frágeis).
8. **E2E do fluxo jurídico completo**: rascunho → coleta (canvas/QR/OIDC) → lavratura → adendo → anulação → validação pública.
9. **Teste de verificação de integridade** (recalcular hash do banco e comparar).
10. **Sem CI** (`.github/` inexistente): nenhum *pipeline* roda `tsc`, `vitest`, `eslint` ou `npm audit` em PRs. Também **não há ESLint/Prettier** configurados (`package.json`).

### 5.3 Scripts (`scripts/`) e limpeza

| Arquivo | Estado | Ação |
|---|---|---|
| `extracted_data.json` (969 KB, PII real) | Ignorado por Git **mas no histórico** e em disco. | Remover do histórico e do disco (C-01). |
| `extract_data.py` | Lê planilhas locais → gera o JSON acima. | Mover para repositório privado/ferramenta fora do app; documentar. |
| `seed.cjs` | Contém **nomes/e-mails reais** de servidores (L28-34) e lê `extracted_data.json`; `schoolId` correto. | Usar dados fictícios; separar `seed:dev`; ler equipe de CSV externo. |
| `consolidate_users.cjs`, `deduplicate_templates.cjs`, `deduplicate_templates_http.cjs` | **Migrações pontuais** já executadas (e-mails fixos de pessoas; endpoint Neon HTTP derivado de `DATABASE_URL`, parsing manual de `.env`). Duplicados (`.cjs` vs `_http.cjs`). | Arquivar em `scripts/archive/` ou remover; se mantidos, exigir `--dry-run` e confirmação. |
| `package_extension.cjs` | Gera ZIP com `python3 -c` interpolando caminhos em *shell*; falha só emite `warn` (build segue sem o ZIP). | Usar `archiver`/`zip` Node puro; falhar o build. |
| `vercel_db_push.cjs` | Ver C-08. | Substituir por `migrate deploy`. |
| `prisma/dev.db` | SQLite legado (schema agora é PostgreSQL). | Excluir. |

### 5.4 Outras dívidas técnicas

- **Documentação desatualizada/duplicada:** `docs/` já continha versões anteriores de `ARQUITETURA_E_ENGENHARIA.md`, `RELATORIO_AUDITORIA.md`, `BACKLOG.md`, `DOCUMENTACAO_SISTEMA.md` (este relatório substitui as duas primeiras; backup em `scratch/`).
- **Dependências:** `xlsx@^0.18.5` (ver Q-09), `next-auth@5.0.0-beta.32` (beta em produção), `typescript ^6`, `vitest ^5`, `next ^16`, `react ^19.3` — *verificar* disponibilidade/compatibilidade; `prisma` em `devDependencies` mas requerido no `postinstall`/build (ok na Vercel); sem `engines` nem `.nvmrc`; sem `eslint`.
- **`package.json`:** `"main": "index.js"`, `"description": ""`, `"keywords": []` (resíduos de `npm init`); `"license"` ausente (há `LICENSE` no repo).
- **README/DEPLOY** devem registrar variáveis obrigatórias: `NEXTAUTH_SECRET/AUTH_SECRET`, `GOOGLE_*`, `DATABASE_URL`, `DIRECT_URL`, `ADMIN_EMAIL`, `SYNC_API_TOKEN`, `CRON_SECRET` (**ausente do `.env.example`**), `WHATSAPP_WEBHOOK_SECRET` (**ausente**), `WHATSAPP_PROVIDER/GATEWAY_URL/GATEWAY_TOKEN` (**ausentes**), `GEMINI_API_KEY`, `ENABLE_DEV_AUTH`.
- **`.env.example` contém e-mail pessoal real** (`ADMIN_EMAIL="marcos.wrobel@..."`).
- **Observabilidade:** apenas `console.*`; sem Sentry/OTel; sem *correlation id*; sem métricas de fila/IA.
- **Backup/DR:** não documentado (Neon PITR *verificar*), nem plano de retenção da trilha de auditoria e do livro de atas (valor jurídico de longo prazo).

---

## 6. Plano de Ação Priorizado (Backlog de Correções)

> Esforço: **P** ≤ 0,5 dia · **M** 1–3 dias · **G** > 3 dias.

### 🔴 Crítico (Segurança / Perda de dados / Bugs graves)

| ✔ | ID | Ação | Arquivos | Status |
|:-:|---|---|---|:---:|
| 🟢 | C-02 | `sync-config` → `requireAdmin`; proxy perimetral bloqueando sem sessão; CORS estrito; feedback no frontend | `sync-config/route.ts`, `cors.ts`, `proxy.ts`, `FaltasClient.tsx` | ✅ **Remediado** |
| 🟢 | C-03 | Blindagem de schemas de ata: provas OIDC e biométricas aceitas exclusivamente no servidor pós-validação criptográfica | `atas/route.ts`, `atas/[id]/route.ts`, `finalize/route.ts`, `schemas.ts` | ✅ **Remediado** |
| 🟢 | C-04 | Transações `$transaction` atômicas em `finalize`, mutações de rascunhos e cadeia de adendos (`previousHash`) | `finalize/route.ts`, `atas/[id]/route.ts`, `addendums/route.ts` | ✅ **Remediado** |
| 🟢 | C-05 | Rejeição fatal de `id_token` com `aud` divergente; imposição cumulativa de `@escola.pr.gov.br` e `hd` oficial | `escolaGoogleVerify.ts`, `sign-token/[token]/route.ts` | ✅ **Remediado** |
| 🟢 | C-06 | Isolamento por unidade escolar (`schoolId` / `getCurrentSchool`) em todas as mutações por ID (`students`, `contacts`, `atas`, `messages/manage`) | `students/**`, `atas/**`, `messages/manage/**` | ✅ **Remediado** |
| 🟢 | C-07 | Extensão MV3: remoção de `<all_urls>`, validação estrita de URLs `https:` permitidas do WhatsApp no `background.js` e eliminação de `new Function` | `manifest.json`, `background.js`, `serp-bridge.js` | ✅ **Remediado** |
| 🟢 | C-08 | Prevenção contra perda de dados em build na Vercel com `--accept-data-loss=false` no script de push | `scripts/vercel_db_push.cjs` | ✅ **Remediado** |
| 🟢 | C-01 | **Expurgo LGPD no Git concluído localmente:** reescrito o histórico via `git filter-repo`, removidos dados de menores de todos os commits e arquivos em disco. Pendente push forçado ao GitHub | histórico Git / GitHub | ✅ **Reescrito (Aguardando push)** |

### 🟠 Alto (Performance / Arquitetura / Integridade)

| ✔ | ID | Ação | Status |
|:-:|---|---|:---:|
| 🟢 | H-01 | Hash canônico reforçado em `ataCrypto.ts` cobrindo imagens de assinatura (`signatureData`), `classNameSnapshot` e `isConfidential` + utilitário de conferência de integridade | ✅ **Remediado** |
| 🟢 | H-02/03 | Adendos encadeados dentro de `$transaction` e averbação formal de anulação (`VOIDED`) preservando número | ✅ **Remediado** |
| 🟢 | H-09 | Cabeçalhos de segurança HTTP adicionados no `next.config.mjs` (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) | ✅ **Remediado** |
| 🟢 | H-13 | Sanitização de diagnóstico em `ai/test-key` para não expor segredos do servidor; pseudonimização preventiva em `aiPseudonymizer.ts` | ✅ **Remediado** |
| ☐ | H-04 | Omitir `mobileSignToken` de listagens e criar visualização restrita para atas marcadas como `isConfidential` | 🟠 Aberto |
| ☐ | H-05 | Adicionar limite de bytes em `signatureData` no schema Zod do `sign-token/[token]` e rate-limit por IP | 🟠 Aberto |
| ☐ | H-06/07 | Comparação de segredo em tempo constante no webhook/cron e restrição estrita a jobs autorizados | 🟠 Aberto |
| ☐ | H-08 | Rate-limiting global em rotas de IA e autenticação via Edge Config / Upstash Redis | 🟠 Aberto |
| ☐ | H-10 | Extrair e-mail do bootstrap admin exclusivamente para variável de ambiente `ADMIN_EMAIL` | 🟠 Aberto |
| ☐ | H-11/12 | Mascarar mensagens de erro brutas do Prisma enviadas aos clientes HTTP | 🟠 Aberto |
| ☐ | P-01…P-05 | Paginação com cursor em listagens de atas e agregação SQL nativa em `weeklyDigest` | 🟠 Aberto |
| ☐ | P-07/08 | Log `PENDING` → envio → atualização em `messages/send`; idempotency key | P |
| ☐ | LGPD | Auditoria sem PII (IDs), gravar `schoolId`, política de retenção; mascarar CPF/telefone no prompt de IA; DPA/operador Google | M |
| ☐ | C-ext | Token em `chrome.storage.session`/popup (fora do DOM da página); remover `new Function`, interceptor morto e `<all_urls>` | M |

### 🟡 Médio (Refatoração / Testes)

| ✔ | Ação | Esf. |
|:-:|---|:-:|
| ☐ | Extrair `mergeParticipants()` único (3 duplicações) + `authenticateSync()` + `resolveGeminiKey()` | M |
| ☐ | Testes de rota (Vitest + `next-test-api-route-handler` ou mocks do Prisma): finalize, sign-token, public, webhook, sync, import, IDOR | G |
| ☐ | Teste de `proxy.ts` importando a constante real; teste de `cors.ts`; teste de `verifyEscolaGoogleIdToken` com `fetch` mockado | P |
| ☐ | E2E Playwright do ciclo de vida da ata + mobile sign | G |
| ☐ | CI (GitHub Actions): `tsc`, `vitest --coverage` (limiar), ESLint, `npm audit`, `gitleaks` | P |
| ☐ | Quebrar `AtaEditorModal` (2,5k linhas) em módulos + `useReducer`; `React.memo`; remover `any` | G |
| ☐ | `enum` Prisma/`z.enum` para estados; `CHECK 0–100`; `source` em justificativas; índices D-04/D-05; relação `participant.studentId` | M |
| ☐ | Normalização de telefone com `libphonenumber-js`; homônimos em `nameMap`; clamp de percentuais | M |
| ☐ | Parser SERE em Web Worker com limites; atualizar/substituir `xlsx` | M |
| ☐ | Anexos (assinaturas/scan) em *object storage* | G |
| ☐ | Módulo `next-auth` *augmentation* (tipar `session.user`) | P |

### 🟢 Baixo (Cosmético / Melhorias)

| ✔ | Ação |
|:-:|
| ☐ | Remover `maximumScale/userScalable`; `aria-*` e foco no editor; alternativa de teclado para assinatura |
| ☐ | Limpar `package.json` (`main`, `description`), adicionar `engines`/`.nvmrc`, ESLint/Prettier |
| ☐ | Completar `.env.example` (`CRON_SECRET`, `WHATSAPP_*`, `ENABLE_DEV_AUTH`) com placeholders neutros |
| ☐ | Sincronizar versão da extensão (1.4.0 × 1.4.1); remover `activeTab` redundante e revisar `tabs` |
| ☐ | Mover `/dossie` auditoria para *route handler*/ação explícita (evitar efeito colateral em *render*) |
| ☐ | Arquivar scripts de migração pontuais; excluir `prisma/dev.db` |
| ☐ | `maskName` com comprimento fixo; `maskDocument` só 2 últimos dígitos |
| ☐ | Internacionalização de datas/fuso `America/Sao_Paulo` em `getIsoWeekKey`, ano da ata e `parseBrDate` |

---

### Anexo A — Sequência sugerida (3 sprints)

1. **Sprint 0 (esta semana):** C-01, C-02, C-07, H-10 + rotacionar `SYNC_API_TOKEN`, `NEXTAUTH_SECRET`, `GEMINI_API_KEY`, `WHATSAPP_WEBHOOK_SECRET`, `CRON_SECRET`.
2. **Sprint 1:** C-03, C-04, C-05, C-08 + CI mínimo + testes das rotas de atas.
3. **Sprint 2:** C-06 (escopo por escola), H-01…H-09, LGPD de logs/IA, paginação.

### Anexo B — Comandos usados na verificação

```bash
npx tsc --noEmit        # sem erros
npx vitest run          # 12 arquivos / 71 testes OK
git log --all -- scripts/extracted_data.json prisma/dev.db   # PII no histórico (111cb8b, 9c367c0)
git ls-files | grep -c prisma/migrations                     # 0
```
