---
name: multi-tenant-security-audit
description: >-
  Executes an adversarial multi-tenant and RBAC security audit across Next.js API
  Route Handlers, Server Components, SERE batch imports, audit logs, and CSV exports
  in Rede Ativa SaaS. Use this skill whenever the user asks for a security audit,
  QA adversarial testing, IDOR/BOLA verification, multi-tenant isolation checks,
  or comparison against previous security audits.
---

# Multi-Tenant Adversarial Security Audit

Never rely solely on static code reading or isolated helper unit tests when auditing tenant isolation. Always validate the real Next.js Route Handlers and Server Components with stateful persistence assertions.

## Audit Workflow

1. **Inspect Delta Since Last Audit**
   - Check `docs/auditorias/2026-11-05_AUDITORIA_ADVERSARIAL_MULTITENANT.md` (and any newer audit reports in `docs/auditorias/`) and run `git log --oneline` / `git diff` from the last audited commit to `HEAD` to pinpoint newly touched routes, SSR pages, and Prisma filters.

2. **Execute & Extend Live Adversarial Integration Suite**
   - Run the integration suite in `src/app/api/__tests__/adversarialQa.test.ts` via `npx vitest run src/app/api/__tests__/adversarialQa.test.ts`.
   - Ensure test cases instantiate at least three distinct contexts (`authContextSchoolA`, `authContextSchoolB`, and `authContextLeopoldina` with INEP `41042730`), simulate `next/headers` cookies (including forged `active_school_id=escola-b`), and assert both HTTP status codes and post-request database state (confirming failed `4xx` calls leave zero partial mutations).

3. **Verify the 10 Mandatory Risk Vectors**
   - **V1 — BOLA / IDOR (API & SSR):** Test `GET`, `PATCH`, `PUT`, `DELETE`, `/addendums`, `/void`, `/finalize` on `/api/atas/*`, `/api/messages/*`, `/api/justifications/*`, plus dynamic SSR pages (`/atas/[id]/imprimir`, `/atas/livro/[ano]`, `/alunos/[id]/dossie`).
   - **V2 — Tenant Context & Cookie Spoofing:** Inject `"schoolId": "escola-b"` in JSON bodies AND `Cookie: active_school_id=escola-b` in headers on creation/read routes.
   - **V3 — SERE Batch Import & Founding School Protection:** Test `/api/students/import` with foreign CGMs, `transferredStudents`, `options.updateSchoolInfo: true` (must return `403` for non-`SUPERADMIN`), and confirm external tenants never match or leak `schoolId: null` / `"default-leopoldina"` records.
   - **V4 — Cross-Tenant FK Traversal:** Test foreign `classGroupId`, mixed `studentIds` (on `POST`, `PATCH`, and `/finalize`), and foreign private `templateId`.
   - **V5 — Horizontal & Vertical RBAC Escalation:** Test `PUT /api/users` targeting another school's user (`403`) and self/peer promotion to `SUPERADMIN`, `GESTAO_SECRETARIA`, or `ADMIN` (`403`).
   - **V6 — CSV Injection & RFC 4180 Escaping:** Verify `sanitizeCsvField` prefixes `=`, `+`, `-`, `@`, `\t`, `\r` with `'` AND all exported columns escape internal `"` as `""`.
   - **V7 — Tenant-Blind Audit Logging:** Scan all `logAudit({ ... })` calls in `src/` to verify top-level `schoolId` is passed (not nested only inside `details`), and verify `/auditoria` never leaks cross-tenant or orphan `null` logs.
   - **V8 — Webhook Cross-Tenant Phone Disambiguation & Passive IDOR:** Verify that passive webhook ingestion (`/api/webhooks/whatsapp`) refuses blind auto-association when the same phone number has recent contacts across multiple distinct schools without an explicit tenant identifier or unambiguous student name match.
   - **V9 — Bipartite Cryptographic Hash Invariant (SHA-256):** Verify that all message mutation routes (`/api/messages/reply`, `PUT /api/messages/manage`, `/api/webhooks/whatsapp`) calculate and preserve the canonical bipartite SHA-256 hash (11 keys when `guardianReplied: true`) passing `verifyMessageIntegrity`.
   - **V10 — Diacritic-Insensitive LGPD/ECA Masking & 500 Sanitization:** Verify that `aiPseudonymizer.ts` masks unaccented family inputs against accented student/guardian names, and confirm all AI route catch blocks sanitize HTTP 500 responses without exposing `error.message`.

4. **Protocolo de Auditoria Pós-Implementação de Features (Checklist 6 Eixos)**
   Sempre que uma nova funcionalidade, mutação ou integração externa for adicionada à plataforma, execute a validação determinística linha a linha cobrindo os 6 eixos inegociáveis de conformidade:
   - **Eixo A (Isolamento Multi-Tenant & Anti-IDOR):** Resolução estrita do tenant ativo exclusivamente via `getCurrentSchool(authCheck.schoolId)` a partir da sessão autenticada (rejeitando injeção de `schoolId` vindo do payload). Invocação obrigatória da guarda `assertTenantOwnership(resourceSchoolId, currentSchool.id, authCheck.session)` retornando expressamente `403 Forbidden` em caso de divergência em Route Handlers de mutação (`PUT`, `PATCH`, `DELETE`, `/finalize`) e Server Components dinâmicos (`page.tsx`, `/imprimir`, dossiês e livros anuais). Prevenção de colisão entre instituições em webhooks passivos (`/api/webhooks/*`) e rotas públicas: quando um identificador compartilhado (ex.: número de telefone) existir em mais de uma escola ativa (`distinctSchoolIds.length > 1`), recusar associação cega exigindo escopo explícito de tenant ou desambiguação comprovada por nome.
   - **Eixo B (Neutralidade de Domínio & Edições):** Proibição absoluta de hardcodes vinculados à Escola Piloto Fundadora (`"default-leopoldina"`, INEP `"41042730"`, chaves legadas `leopoldina_*` ou substrings no nome). Uso obrigatório dos utilitários de `src/lib/storageKeys.ts` no frontend (leitura dual com fallback transparente e persistência exclusiva sob o prefixo neutro `redeativa_*`). Compatibilidade total com as duas edições oficiais do Paraná (`src/lib/platformEditions.ts`): a feature deve operar de forma idêntica e autônoma tanto na `PILOTO_INTEGRADA` quanto na `INSTITUCIONAL_ESSENCIAL`, sem acoplamento a scrapers governamentais (Power BI / Celepar).
   - **Eixo C (Integridade Probatória SHA-256):** Preservação da cadeia de custódia e não-repúdio probatório sob a Lei Federal nº 14.063/2020: Livro de Atas com selagem canônica via `computeMinuteHash()` (`src/lib/ataCrypto.ts`); Mensageria e Retornos Familiares com selagem bipartida via `computeMessageContentHash()` (`src/lib/messageCrypto.ts`), assegurando que criações (7 chaves iniciais), retificações administrativas (`PUT /manage`) e respostas do responsável (4 chaves condicionais quando `guardianReplied === true`) mantenham `verifyMessageIntegrity()` 100% válido; Dossiê Unificado com chancela forense via `computeDossierIntegritySeal()`.
   - **Eixo D (Privacidade LGPD/ECA, Pseudonimização Diacrítica & Rate Limit):** Higienização prévia e obrigatória de dados de estudantes menores e responsáveis legais via `src/lib/aiPseudonymizer.ts` antes de qualquer despacho para APIs de IA externas (Google Gemini). O mascaramento deve ser insensível a acentuação (`buildDiacriticInsensitivePattern`) para proteger variações informais digitadas por famílias ("Joao" vs "João", "Sonia" vs "Sônia"). Garantia de fallback heurístico determinístico e offline (`classifyGuardianReplyHeuristic` em `src/lib/whatsappProvider.ts`), preservando a UX e a continuidade do fluxo caso o serviço externo de IA esteja indisponível. Aplicação de controle de taxa distribuído via `enforceRateLimit()` (`src/lib/rateLimit.ts`) em todos os endpoints de IA e rotas de mensageria.
   - **Eixo E (Trilha Forense & Transações):** Registro de auditoria (`logAudit`) com `schoolId: currentSchool.id` na raiz do payload (nunca apenas aninhado em `details`), captura do IP real (`req`) em conformidade com o Marco Civil da Internet (Art. 15), e minimização estrita de PII (LGPD Art. 6º, III). Sincronização transacional atômica e segura na agenda de contatos familiares (`StudentContact`), contida exclusivamente no escopo do estudante validado no tenant ativo.
   - **Eixo F (Validação Zod Estrita & Sanitização HTTP 500):** Validação de 100% dos payloads de entrada via schemas `Zod` estritos em `src/lib/schemas.ts`, impondo limites máximos defensivos (`.max()`) em campos textuais livres para prevenção de payload abuse e enums fechados para status e categorias. Sanitização integral de blocos `catch`: proibição absoluta de expor `error.message` ou stack traces do Prisma/banco ao cliente HTTP, retornando sempre mensagens funcionais padronizadas com status code apropriado (CWE-209 / regra `H-11`).

5. **Reporting & Quality Gate**
   - For each vector, report: **Vetor Testado**, **Request Enviada** (method, URL, headers, payload), **Status Code Recebido**, **Comportamento do Banco**, and **Veredito (`PASS` / `FAIL`)**, followed by a comparison table against the previous audit if requested.
   - If running in read-only audit mode, keep `git status` clean (use artifact `scratch/` for temporary harnesses). If applying fixes, run `npm test` and `npm run build` before finishing.
