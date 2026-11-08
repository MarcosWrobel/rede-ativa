# Backlog Geral de Evolução & Roadmap — Rede Ativa SaaS

Este é o **Registro Evolutivo Único e Roadmap** da plataforma **Rede Ativa SaaS**.
- Status: `[x]` Concluído • `[/]` Em Andamento • `[ ]` Pendente (Roadmap Futuro)
- Prioridade: `P0` Crítico (Segurança/LGPD/Jurídico) • `P1` Alta (Estabilidade/Performance) • `P2` Média (Valor Pedagógico) • `P3` Expansão Estratégica
- Esforço: `P` Pequeno (1–2h) • `M` Médio (3–6h) • `G` Grande (1–3 dias)

---

## Épico 1 — Blindagem LGPD, Autenticação & RBAC (Sprint 1) — ✅ Concluído

- [x] **`SEC-01`** `[P0 | Esforço: P]` **Fechar rotas `GET` anônimas nas APIs** — Sessão exigida em `GET /api/students`, `GET /api/low-attendance` e `GET /api/templates` ([`src/app/api/students/route.ts`](../src/app/api/students/route.ts)).
- [x] **`SEC-02`** `[P0 | Esforço: P]` **Restringir provider `Credentials` ao ambiente local** — `"escola-dev-auth"` bloqueado em produção (`ENABLE_DEV_AUTH=true` + `NODE_ENV !== "production"`) em [`src/lib/auth.ts`](../src/lib/auth.ts).
- [x] **`SEC-03`** `[P0 | Esforço: M]` **Implementar `src/proxy.ts` global (Next.js 16 Proxy)** — Perímetro de autenticação em todas as páginas e `/api/*` via [`src/proxy.ts`](../src/proxy.ts).
- [x] **`SEC-04`** `[P0 | Esforço: M]` **Controle de Equipe Autorizada (*Allowlist*) e Tela `/equipe`** — Gestão de servidores autorizados em [`src/app/equipe/EquipeClient.tsx`](../src/app/equipe/EquipeClient.tsx) e [`src/app/api/users/route.ts`](../src/app/api/users/route.ts).
- [x] **`SEC-05`** `[P0 | Esforço: P]` **Proteger token da Extensão e CORS estrito** — CORS restrito às origens oficiais em [`src/lib/cors.ts`](../src/lib/cors.ts) e guarda administrativa em [`src/app/api/sync-config/route.ts`](../src/app/api/sync-config/route.ts).
- [x] **`SEC-06`** `[P0 | Esforço: P]` **Higienização LGPD no Git e Captura de IP na Auditoria** — Expurgo de datasets sensíveis do histórico Git e gravação de `ipAddress` em [`src/lib/audit.ts`](../src/lib/audit.ts).

---

## Épico 2 — Performance Serverless, Banco & Qualidade (Sprint 2) — ✅ Concluído

- [x] **`PERF-01`** `[P1 | Esforço: M]` **Sincronização em Lote (*Batch Upsert*) para Power BI e SERP** — Pareamento `O(N)` em [`src/lib/studentMatcher.ts`](../src/lib/studentMatcher.ts) e *batch upsert* em blocos de 250 linhas em [`src/app/api/frequencia/sync/route.ts`](../src/app/api/frequencia/sync/route.ts) e [`src/app/api/serp/sync/route.ts`](../src/app/api/serp/sync/route.ts).
- [x] **`PERF-02`** `[P1 | Esforço: P]` **Sessão JWT com janela de revalidação de 5 min** — Evita consulta repetitiva ao PostgreSQL a cada request em [`src/lib/auth.ts`](../src/lib/auth.ts).
- [x] **`PERF-03`** `[P1 | Esforço: P]` **Índices Compostos no `schema.prisma`** — Índices secundários e sincronização segura `--accept-data-loss=false` em [`scripts/vercel_db_push.cjs`](../scripts/vercel_db_push.cjs).
- [x] **`PERF-04`** `[P1 | Esforço: M]` **Paginação e Filtros *Server-Side* em `/historico`** — `GET` paginado em [`src/app/api/messages/route.ts`](../src/app/api/messages/route.ts) e [`src/app/historico/HistoricoClient.tsx`](../src/app/historico/HistoricoClient.tsx).
- [x] **`PERF-05`** `[P1 | Esforço: M]` **Agregações SQL e Filtro de Período em `/relatorios`** — Agregador em [`src/lib/reportsAggregator.ts`](../src/lib/reportsAggregator.ts).
- [x] **`QUAL-01`** `[P1 | Esforço: P]` **Unificar Regra de Contagem de Faltas (`isAbsenceRelated`)** — Alinhamento em [`src/app/faltas/page.tsx`](../src/app/faltas/page.tsx).
- [x] **`QUAL-02`** `[P1 | Esforço: M]` **Validação de Payloads (`Zod`) + Fundação de Testes (`Vitest`)** — Schemas em [`src/lib/schemas.ts`](../src/lib/schemas.ts) e [`vitest.config.ts`](../vitest.config.ts).

---

## Épico 3 — Módulos Pedagógicos Core & Respaldo Jurídico (Sprints 3 e 4) — ✅ Concluído

- [x] **`PED-01`** `[P2 | Esforço: M]` **Gerador de Dossiê Individual em PDF** — Emissão A4 em [`src/app/alunos/[id]/dossie/DossieClient.tsx`](../src/app/alunos/[id]/dossie/DossieClient.tsx).
- [x] **`PED-02`** `[P2 | Esforço: M]` **Série Histórica (`AttendanceSnapshot`) e Alerta de Queda Abrupta** — Detector em [`src/lib/pedagogicalClassifier.ts`](../src/lib/pedagogicalClassifier.ts).
- [x] **`PED-03`** `[P2 | Esforço: M]` **Gestão de Atestados Médicos e Justificativas com Vigência** — API [`src/app/api/students/[id]/justifications/route.ts`](../src/app/api/students/[id]/justifications/route.ts) e central `/atestados`.
- [x] **`PED-04`** `[P2 | Esforço: M]` **Múltiplos Contatos de Responsáveis (`StudentContact`)** — Agenda familiar transacional em [`src/app/api/students/[id]/contacts/route.ts`](../src/app/api/students/[id]/contacts/route.ts).
- [x] **`PED-05`** `[P2 | Esforço: G]` **Prontuário 360º do Aluno (`/alunos/[id]`)** — Visão integral em [`src/app/alunos/[id]/ProntuarioClient.tsx`](../src/app/alunos/[id]/ProntuarioClient.tsx).

---

## Épico 4 — Automação de WhatsApp & IA na Triagem (Sprint 5) — ✅ Concluído

- [x] **`AUT-01`** `[P2 | Esforço: M]` **Rastreamento de Entrega (`deliveryStatus`) e Saneamento de Números** — Invalidação automática `FAILED_NO_WHATSAPP` em [`src/app/api/messages/status/route.ts`](../src/app/api/messages/status/route.ts) e confirmação automática via extensão `v1.5.0`.
- [x] **`AUT-02`** `[P2 | Esforço: G]` **Fila Assistida de Disparo por Turma** — [`src/app/busca-ativa/BuscaAtivaClient.tsx`](../src/app/busca-ativa/BuscaAtivaClient.tsx) + [`src/lib/whatsappProvider.ts`](../src/lib/whatsappProvider.ts) com salto de atestados vigentes.
- [x] **`AUT-03`** `[P3 | Esforço: G]` **Formalização & Classificação de Retorno com IA Gemini** — [`src/app/api/ai/classify-reply/route.ts`](../src/app/api/ai/classify-reply/route.ts) com pseudonimização prévia e fallback heurístico.
- [x] **`AUT-04`** `[P2 | Esforço: M]` **Janela Dedicada Compacta (`480x760px`) & Detecção Mobile/Desktop** — Orquestração via [`extension/background.js`](../extension/background.js) e [`src/components/whatsapp/WhatsAppDispatchToggle.tsx`](../src/components/whatsapp/WhatsAppDispatchToggle.tsx).

---

## Épico 5 — Mobilidade PWA & Boletim Semanal (Sprint 6) — ✅ Concluído

- [x] **`ESC-01`** `[P3 | Esforço: G]` **Fundação Multi-Escola (`School`)** — Resolução contextual em [`src/lib/currentSchool.ts`](../src/lib/currentSchool.ts).
- [x] **`ESC-02`** `[P3 | Esforço: P]` **PWA Mobile Instalável** — Manifesto web, [`public/sw.js`](../public/sw.js) e [`src/components/PwaRegister.tsx`](../src/components/PwaRegister.tsx).
- [x] **`ESC-03`** `[P3 | Esforço: M]` **Boletim Executivo Semanal Automatizado (`Vercel Cron`)** — [`src/app/api/cron/weekly-digest/route.ts`](../src/app/api/cron/weekly-digest/route.ts) e [`src/app/boletim/BoletimClient.tsx`](../src/app/boletim/BoletimClient.tsx).

---

## Épico 6 — Importação Oficial SERE/SEED-PR & Saneamento (Sprint 7) — ✅ Concluído

- [x] **`SERE-01`** `[P1 | Esforço: G]` **Parser Multiformato Nativo SERE (`.xls` BIFF8, `.xlsx`, `.pdf`, `.csv`)** — [`src/lib/sereParser.ts`](../src/lib/sereParser.ts) com fusão de dupla matrícula técnica e exclusão de turmas complementares.
- [x] **`SERE-02`** `[P1 | Esforço: M]` **Assistente Guiado de Importação em Lote (`/alunos`)** — [`src/app/alunos/SereImportModal.tsx`](../src/app/alunos/SereImportModal.tsx) e [`src/app/api/students/import/route.ts`](../src/app/api/students/import/route.ts).
- [x] **`SERE-03`** `[P1 | Esforço: P]` **Consolidação Cadastral Histórica de Equipe** — Utilitário histórico arquivado em [`scripts/legacy/consolidate_users.cjs`](../scripts/legacy/consolidate_users.cjs) e carga base em [`scripts/seed.cjs`](../scripts/seed.cjs).

---

## Épico 7 — Livro Oficial de Atas Digital & Biometria (Sprint 8) — ✅ Concluído

- [x] **`ATA-01`** `[P0 | Esforço: G]` **Criptografia `SHA-256` Canônica & Numeração Sequencial Atômica** — [`src/lib/ataCrypto.ts`](../src/lib/ataCrypto.ts) e [`src/app/api/atas/[id]/finalize/route.ts`](../src/app/api/atas/[id]/finalize/route.ts).
- [x] **`ATA-02`** `[P1 | Esforço: G]` **Editor Widescreen Bimodal, Voz e IA Generativa NRE/SEED-PR** — [`src/components/ata/AtaEditorModal.tsx`](../src/components/ata/AtaEditorModal.tsx), [`src/app/api/ai/formalize-ata/route.ts`](../src/app/api/ai/formalize-ata/route.ts) e [`src/lib/nreAtaFormatter.ts`](../src/lib/nreAtaFormatter.ts).
- [x] **`ATA-03`** `[P1 | Esforço: G]` **Assinatura OIDC `@escola`, QR Code Móvel & Biometria WebAuthn/FIDO2** — [`src/components/ata/SignatureCanvas.tsx`](../src/components/ata/SignatureCanvas.tsx) e [`src/app/assinar/ata/[token]/MobileSignClient.tsx`](../src/app/assinar/ata/[token]/MobileSignClient.tsx).
- [x] **`ATA-04`** `[P1 | Esforço: M]` **Imutabilidade, Adendos Encadeados (*"Em tempo"*) & Cancelamento (`VOIDED`)** — [`src/app/api/atas/[id]/addendums/route.ts`](../src/app/api/atas/[id]/addendums/route.ts) e [`src/app/api/atas/[id]/void/route.ts`](../src/app/api/atas/[id]/void/route.ts).
- [x] **`ATA-05`** `[P1 | Esforço: M]` **Impressão A4 (`1 of 1`), Livro Anual, Certidão Cega LGPD & Sigilo ECA** — [`/atas/[id]/imprimir`](../src/app/atas/[id]/imprimir/PrintPageClient.tsx), [`/atas/livro/[ano]`](../src/app/atas/livro/[ano]/page.tsx) e [`/validar/ata/[code]`](../src/app/validar/ata/[code]/page.tsx).
- [x] **`ATA-06`** `[P1 | Esforço: M]` **Atas de Orientação Docente / Equipe Escolar (`ORIENTACAO_DOCENTE`)** — Suporte nativo a atas com `studentIds: []` e participantes docentes registrados, formalização NRE/SEED-PR sem citar responsáveis familiares, pseudonimização LGPD `[DOCENTE_n]`, assinatura OIDC `@escola.pr.gov.br` e renderização de Docentes Envolvidos na impressão e PDF/A-1b, validado por 8 testes em [`src/lib/__tests__/teacherAtas.test.ts`](../src/lib/__tests__/teacherAtas.test.ts).

---

## Épico 8 — Transformação SaaS Multi-Escola & Governança 4-Tier (Sprints 9 e 10) — ✅ Concluído

- [x] **`SAAS-01`** `[P0 | Esforço: G]` **Modelagem Multi-Tenant Completa (`EducationNetwork`, `UserNetwork`, `School`, `UserSchool`)** — Segregação lógica em [`prisma/schema.prisma`](../prisma/schema.prisma).
- [x] **`SAAS-02`** `[P0 | Esforço: M]` **Governança e RBAC de 4 Níveis (`SUPERADMIN`, `GESTAO_SECRETARIA`, `GESTOR_ESCOLAR`, `PEDAGOGA`)** — [`src/lib/roles.ts`](../src/lib/roles.ts) e [`src/lib/permissions.ts`](../src/lib/permissions.ts).
- [x] **`SAAS-03`** `[P0 | Esforço: G]` **Painéis Isolados de Aterrissagem** — `/admin`, `/secretaria`, `/gestao` e `/busca-ativa`.
- [x] **`SAAS-04`** `[P1 | Esforço: M]` **Diretório Global de Escolas (`/admin/escolas`) & Turmas Manuais (`/api/classes`)** — Provisionamento automático de modelos e gestão de turmas.
- [x] **`SAAS-05`** `[P0 | Esforço: M]` **Higienização (`/sanitize`) e Exclusão Segura com Blindagem Atômica da Escola Piloto (`41042730`)**.

---

## Épico 9 — Consolidação Adversarial Multi-Tenant & Defesa em Profundidade (Sprint 11) — ✅ Concluído

- [x] **`SEC-ADV-01`** `[P0 | Esforço: M]` **Neutralização de Cookie Spoofing (`active_school_id`)** em [`src/lib/currentSchool.ts`](../src/lib/currentSchool.ts).
- [x] **`SEC-ADV-02`** `[P0 | Esforço: M]` **Gating Estrito de Dados Legados (`null` / `"default-leopoldina"`)** restrito ao INEP `41042730`.
- [x] **`SEC-ADV-03`** `[P0 | Esforço: M]` **Isolamento de Tenant em Server Components (SSR)** via [`src/lib/tenantGuard.ts`](../src/lib/tenantGuard.ts).
- [x] **`SEC-ADV-04`** `[P0 | Esforço: M]` **Defesa contra Cross-Tenant FK Traversal** (`studentIds`, `classGroupId`, `templateId`).
- [x] **`SEC-ADV-05`** `[P0 | Esforço: P]` **Rejeição Explícita `403 Forbidden`** para flags restritas (`updateSchoolInfo: true` e escalada em `/api/users`).
- [x] **`SEC-ADV-06`** `[P0 | Esforço: P]` **Escopo Raiz Mandatório `schoolId` em `logAudit(...)`** e isolamento de `/auditoria`.
- [x] **`SEC-ADV-07`** `[P0 | Esforço: P]` **Proteção Contra CSV Formula Injection (CWE-1236 + RFC 4180)** via [`src/lib/csvSanitizer.ts`](../src/lib/csvSanitizer.ts).
- [x] **`TEST-ADV-01`** `[P0 | Esforço: G]` **Bateria Adversarial ao Vivo** em [`src/app/api/__tests__/adversarialQa.test.ts`](../src/app/api/__tests__/adversarialQa.test.ts).

---

## Épico 10 — Arcabouço Probatório Avançado, Onboarding & Preditiva SEMEC (Sprint 12) — ✅ Concluído

- [x] **`JUR-01`** `[P1 | Esforço: G]` **Dossiê Unificado com Selo Pericial (`computeDossierIntegritySeal`)** em [`src/lib/messageCrypto.ts`](../src/lib/messageCrypto.ts) e [`src/app/alunos/[id]/dossie/DossieClient.tsx`](../src/app/alunos/[id]/dossie/DossieClient.tsx).
- [x] **`JUR-02`** `[P1 | Esforço: M]` **Certificação `SHA-256` Individual de Mensagens (`MessageLog.contentHash`)** em [`src/lib/messageCrypto.ts`](../src/lib/messageCrypto.ts).
- [x] **`JUR-03`** `[P2 | Esforço: M]` **Alertas Automáticos de Prazos de Encaminhamentos** em [`src/lib/actionClassifier.ts`](../src/lib/actionClassifier.ts) e [`src/app/api/atas/actions/alerts/route.ts`](../src/app/api/atas/actions/alerts/route.ts).
- [x] **`JUR-04`** `[P2 | Esforço: M]` **Captura de Vias Físicas & Averbação de Protocolo Gov.br/ITI** em [`src/components/ata/PhysicalScanModal.tsx`](../src/components/ata/PhysicalScanModal.tsx) e [`src/app/api/atas/[id]/physical-scan/route.ts`](../src/app/api/atas/[id]/physical-scan/route.ts).
- [x] **`SAAS-06`** `[P2 | Esforço: G]` **Wizard de Auto-Onboarding (`/onboarding`)** em [`src/app/onboarding/OnboardingClient.tsx`](../src/app/onboarding/OnboardingClient.tsx).
- [x] **`SAAS-07`** `[P2 | Esforço: M]` **Análise Preditiva de Evasão para Secretarias (SEMEC)** em [`src/lib/predictiveAnalytics.ts`](../src/lib/predictiveAnalytics.ts) e [`src/app/api/secretaria/metrics/route.ts`](../src/app/api/secretaria/metrics/route.ts).

---

## Épico 11 — Perícia Forense Grafotécnica, PIN de Fé Pública & Lavratura Extemporânea (Sprint 13) — ✅ Concluído

> Base legal: Lei Federal nº 14.063/2020 (Art. 4º II), LGPD, ECA (Arts. 17 e 143), Código Civil (Arts. 219 e 225) e CPC (Arts. 411 e 440).

- [x] **`JUR-05`** `[P0 | Esforço: M]` **Captura Forense & Perícia Grafotécnica de Assinaturas (`PointerEvent`)**  
  Coleta vetorial de coordenadas, tempo e pressão (`[{x, y, t, p}]`) em `biometricStrokeData`, `signerUserAgent` e `clientTimestampIso` no [`SignatureCanvas.tsx`](../src/components/ata/SignatureCanvas.tsx) e [`MobileSignClient.tsx`](../src/app/assinar/ata/[token]/MobileSignClient.tsx), cobertos pelo hash `SHA-256` da ata.
- [x] **`JUR-06`** `[P0 | Esforço: M]` **PIN de Fé Pública do Servidor na Lavratura (`PBKDF2-SHA512`)**  
  Criptografia com 100.000 iterações, bloqueio temporário após 3 tentativas incorretas, onboarding modal ([`SigningPinModal.tsx`](../src/components/ata/SigningPinModal.tsx)) e redefinição via OIDC `@escola.pr.gov.br` em [`src/lib/signingPin.ts`](../src/lib/signingPin.ts) e [`src/app/api/user/signing-pin/route.ts`](../src/app/api/user/signing-pin/route.ts).
- [x] **`JUR-07`** `[P0 | Esforço: M]` **Governança da Sequência Cronológica e Lavratura Extemporânea (> 5 dias úteis)**  
  Exigência obrigatória de `extemporaneousReason` quando o intervalo entre `attendedAt` e `finalizedAt` excede 5 dias úteis, com impressão de **Nota de Escrituração & Fé Pública** na folha A4 e na certidão pública, validada em [`complianceAndForensics.test.ts`](../src/lib/__tests__/complianceAndForensics.test.ts), [`signingPin.test.ts`](../src/lib/__tests__/signingPin.test.ts) e [`securityAndLegalAuditV2.test.ts`](../src/lib/__tests__/securityAndLegalAuditV2.test.ts) (**215 testes em 37 suítes**).

---

## Épico 12: Roadmap de Conclusão da Fundação SaaS (Sprint 14)

- [x] **`INFRA-01`** `[P1 | Esforço: P]` **Pipeline CI Automatizado (GitHub Actions)**  
  Execução automática de `npx prisma generate`, `npx tsc --noEmit`, `npm test` e `npm run build` em todo Pull Request/push apontando para `main` via [ci.yml](file:///home/marcoswrobel/Documents/Registro/.github/workflows/ci.yml).
- [x] **`SEC-08`** `[P2 | Esforço: M]` **Rate Limiting Distribuído em Endpoints Públicos, IA e Proteção Anti-Brute-Force**  
  Proteção por janela deslizante híbrida (Neon PostgreSQL + L1 Memory + Upstash Redis opcional via [rateLimit.ts](file:///home/marcoswrobel/Documents/Registro/src/lib/rateLimit.ts)) para `/api/ai/*` (20 req/min), `/api/atas/public/[code]` (30 req/min), `/api/atas/sign-token/[token]` (15 req/min), trava de 15 min contra força bruta no PIN de Fé Pública e bloqueio de tentativas espúrias de Token de Sincronização.
- [x] **`JUR-08`** `[P2 | Esforço: G]` **Preservação Arquivística Binária `PDF/A-1b` (ISO 19005)**  
  Geração determinística server-side de artefato PDF/A-1b com metadados XMP (`pdfaid:part=1`, `conformance=B`), perfil de cor `sRGB IEC61966-2.1` (`/GTS_PDFA1`), fontes TrueType embutidas (`LiberationSans`), QR Code e chancela de fé pública via [ataPdfArchive.ts](file:///home/marcoswrobel/Documents/Registro/src/lib/ataPdfArchive.ts) e rota protegida [GET /api/atas/[id]/pdfa](file:///home/marcoswrobel/Documents/Registro/src/app/api/atas/[id]/pdfa/route.ts).
- [x] **`STORAGE-01`** `[P3 | Esforço: G]` **Externalização de Scans Físicos Pesados para Object Storage (S3/R2/Vercel Blob)**  
  Arquitetura multi-driver em [objectStorage.ts](file:///home/marcoswrobel/Documents/Registro/src/lib/objectStorage.ts) com validação de magic bytes anti-spoofing, assinatura nativa AWS SigV4, hash de integridade SHA-256 (`physicalScanSha256`), proxy autenticado anti-IDOR e com sigilo ECA em [GET /api/atas/[id]/physical-scan](file:///home/marcoswrobel/Documents/Registro/src/app/api/atas/[id]/physical-scan/route.ts), e **fallback automático zero-custo para PostgreSQL Base64** quando nenhuma credencial externa estiver configurada.

---

## Épico 13 — Desacoplamento de Scrapers & Duas Versões no Paraná (Sprint 15) — ✅ Concluído

> Base legal e regulatória: Marco Civil da Internet (Lei nº 12.965/2014), LGPD (Lei nº 13.709/2018), ECA (Lei nº 8.069/1990) e termos de uso de portais estaduais (SEED-PR / Celepar).

- [x] **`JUR-09`** `[P0 | Esforço: M]` **Modelagem de Edições e Inviolabilidade Piloto (`platformEditions.ts`)**  
  Tipagem estrita (`PILOTO_INTEGRADA` | `INSTITUCIONAL_ESSENCIAL`), resolução contextual sem bloatware armazenada em `School.settingsJson`, e trava inviolável estrita por INEP (`41042730`) que impede rebaixamento da Escola Piloto Leopoldina.
- [x] **`JUR-10`** `[P0 | Esforço: M]` **Bloqueio de Backend em Roteadores de Scraping Governamental**  
  Retorno explícito `403 Forbidden` nos endpoints de sincronização automatizada ([`POST /api/frequencia/sync`](../src/app/api/frequencia/sync/route.ts) e [`POST /api/serp/sync`](../src/app/api/serp/sync/route.ts)) quando acionados por escolas na edição `INSTITUCIONAL_ESSENCIAL`.
- [x] **`JUR-11`** `[P1 | Esforço: M]` **Herança Automática de Governança por Rede Municipal (SEMEC)**  
  Configuração de edição pelo Superadmin no diretório de escolas ([`AdminEscolasClient.tsx`](../src/app/admin/escolas/AdminEscolasClient.tsx)) e herança automática da versão da rede quando novos estabelecimentos são criados por gestores de secretaria ([`/api/schools`](../src/app/api/schools/route.ts)).
- [x] **`JUR-12`** `[P1 | Esforço: M]` **Adaptação Dinâmica do Frontend & Neutralidade de Nomenclaturas Governamentais**  
  Ocultação de gatilhos de sincronização de Power BI e tokens de extensão em `/faltas`, e substituição de termos proprietários de governo por nomenclaturas administrativas neutras em `/alunos/[id]` (Prontuário) e [`/alunos/[id]/dossie`](../src/app/alunos/[id]/dossie/DossieClient.tsx). Coberto por 9 testes unitários em [`platformEditions.test.ts`](../src/lib/__tests__/platformEditions.test.ts).

---

## Épico 14 — Auditoria Técnica, de Segurança e Estabilidade V3 (Sprint 16 — Pré-Expansão) — ✅ Concluído

- [x] **`SEC-09`** `[P0 | Esforço: P]` **Comparação Criptográfica em Tempo Constante nos Webhooks & Cron (`H-06` / `H-07`)**  
  Eliminação de timing attacks via `safeCompareStrings` (`crypto.timingSafeEqual` sobre digests SHA-256 de tamanho uniforme) em [`src/app/api/webhooks/whatsapp/route.ts`](../src/app/api/webhooks/whatsapp/route.ts) e [`src/app/api/cron/weekly-digest/route.ts`](../src/app/api/cron/weekly-digest/route.ts).
- [x] **`SEC-10`** `[P0 | Esforço: M]` **Contenção Total de Vazamento de Exceções Internas (`H-11`) & Bootstrap Dinâmico (`H-10`)**  
  Mascaramento estrito de `error.message` do Prisma/banco em 500 em todos os Route Handlers sob `src/app/api/**`, e resolução dinâmica de `BOOTSTRAP_ADMIN_EMAIL` com prioridade para `process.env.ADMIN_EMAIL` em [`src/lib/roles.ts`](../src/lib/roles.ts).
- [x] **`DATA-01`** `[P0 | Esforço: M]` **Proteção Cadastral contra Sobrescrita de Homônimos SERE & Clamp de Percentuais (`Q-01` / `Q-02` / `Q-03`)**  
  Detecção de homônimos na mesma escola em `buildStudentLookupMaps` (`isHomonym: true`), exigindo CGM explícito para pareamento, clamp matemático de frequência no intervalo `[0, 100]` em `parseAttendancePercent` ([`src/lib/studentMatcher.ts`](../src/lib/studentMatcher.ts)), e preservação de dispensas manuais no sync de amparos em [`src/app/api/frequencia/sync/route.ts`](../src/app/api/frequencia/sync/route.ts).
- [x] **`MSG-01`** `[P0 | Esforço: P]` **Atomicidade Probatória na Mensageria & Validação Zod Estrita (`P-07` / `P-08`)**  
  Persistência obrigatória do `MessageLog` no banco antes de acionar gateways externos de rede, e restrição de `initialDeliveryStatus` aos estados válidos de despacho em [`src/lib/schemas.ts`](../src/lib/schemas.ts) e [`src/app/api/messages/send/route.ts`](../src/app/api/messages/send/route.ts).
- [x] **`PERF-06`** `[P1 | Esforço: P]` **Remoção de Índices Redundantes no Prisma Schema (`D-04`)**  
  Expurgo de `@@index` duplicados em campos já cobertos por restrições `@unique` (`School.inepCode`, `PedagogicalMinute.verificationCode`, `PedagogicalMinuteParticipant.mobileSignToken`) em [`prisma/schema.prisma`](../prisma/schema.prisma), validado por 12 testes em [`securityAndStabilityAuditV3.test.ts`](../src/lib/__tests__/securityAndStabilityAuditV3.test.ts). Suíte global expandida para **311 testes em 47 suítes**.

---

## Roadmap Estratégico Futuro — Excelência SaaS & Expansão de Larga Escala (Não-Essencial no Momento)

> **Contexto Estratégico:** Os itens abaixo foram mapeados a partir de auditoria técnica baseada nas melhores práticas de mercado para SaaS B2B/GovTech (Twelve-Factor App, SOC 2, Clean Architecture e APM).  
> **Classificação de Prioridade:** **Não são necessários nem essenciais para a operação atual ou para a entrada das primeiras dezenas de escolas**, pois a plataforma já é estável, segura e auditada. Devem ser ativados gradualmente conforme o projeto alcançar escala de múltiplas redes municipais e geração de receita.

- [ ] **`SAAS-OPS-01`** `[P3 | Esforço: P]` **Observabilidade Externa & Error Tracking em Tempo Real (Sentry / BetterStack)**  
  - **Objetivo:** Captura automatizada de exceções em runtime no cliente (`error.tsx`), no middleware (`src/proxy.ts`) e nos Route Handlers de background (sincronização SERE, webhooks).  
  - **Gatilho de Ativação:** Operação simultânea com mais de 20 escolas ativas, reduzindo a necessidade de suporte técnico reativo.
- [ ] **`SAAS-ARCH-01`** `[P3 | Esforço: M]` **Camada de Casos de Uso / Domain Services (Refatoração DDD)**  
  - **Objetivo:** Desacoplar regras de negócio complexas hoje contidas diretamente em Route Handlers extensos (ex: `/api/atas/[id]/finalize` e `/api/frequencia/sync`) para serviços puros de aplicação em `src/services/` (ex: `AtaFinalizationService.ts`, `SereIngestionService.ts`).  
  - **Gatilho de Ativação:** Entrada de novos desenvolvedores no time ou necessidade de expor funcionalidades via CLI/SDK.
- [ ] **`SAAS-QUEUE-01`** `[P4 | Esforço: G]` **Processamento Assíncrono com Filas em Background (Inngest / QStash)**  
  - **Objetivo:** Deslocar importações massivas do SERE (> 5.000 alunos) e disparos em lote de mensagens para filas desacopladas com *retries* automáticos, emitindo `202 Accepted` e barra de progresso via Server-Sent Events (SSE).  
  - **Gatilho de Ativação:** Contratação da plataforma por redes municipais de grande porte (capitais ou redes com mais de 50.000 matrículas).
- [ ] **`SAAS-UI-01`** `[P3 | Esforço: M]` **Modularização Componentizada do Editor de Atas (`AtaEditorModal.tsx`)**  
  - **Objetivo:** Decomposição do modal mestre (~2.600 linhas) em submódulos isolados com tipagem limpa (`AtaWizardStep1.tsx`, `AtaWizardStep2.tsx`, `AtaViewerMode.tsx`, `AtaAddendumForm.tsx`), facilitando a manutenção e testes isolados de interface.  
  - **Gatilho de Ativação:** Manutenções evolutivas na interface ou inclusão de novos tipos de atas especializadas (ex: atas de Conselho de Classe).

---

## Resumo Consolidado de Sprints

| Sprint | Foco Principal | Épico | Status |
| :--- | :--- | :---: | :---: |
| **Sprint 1** | Blindagem LGPD, Proxy & Equipe Autorizada | Épico 1 | ✅ Concluído |
| **Sprint 2** | Performance Serverless, Batch SQL & Vitest | Épico 2 | ✅ Concluído |
| **Sprints 3–4** | Dossiê PDF, Atestados, Queda Abrupta & Prontuário 360º | Épico 3 | ✅ Concluído |
| **Sprint 5** | Automação WhatsApp, Janela Compacta & Triagem IA | Épico 4 | ✅ Concluído |
| **Sprint 6** | Fundação Multi-Escola, Mobile PWA & Boletim Cron | Épico 5 | ✅ Concluído |
| **Sprint 7** | Parser Poliglota SERE (`.xls`/`.pdf`/`.csv`) & Saneamento | Épico 6 | ✅ Concluído |
| **Sprint 8** | Livro Oficial de Atas Digital, QR Móvel & WebAuthn | Épico 7 | ✅ Concluído |
| **Sprints 9–10** | SaaS Multi-Escola, 4-Tier RBAC & Proteção Piloto | Épico 8 | ✅ Concluído |
| **Sprint 11** | Consolidação Adversarial dos 7 Vetores Multi-Tenant | Épico 9 | ✅ Concluído |
| **Sprint 12** | Selo Pericial de Mensagens/Dossiê, Onboarding & Preditiva | Épico 10 | ✅ Concluído |
| **Sprint 13** | Perícia Grafotécnica Vetorial, PIN PBKDF2 & Extemporânea | Épico 11 | ✅ Concluído |
| **Sprint 14** | CI GitHub Actions, Rate-Limiter, PDF/A-1b & Storage Multi-Driver | Épico 12 | ✅ Concluído |
| **Sprint 15** | Duas Versões PR, Desacoplamento de Scrapers & Herança SEMEC | Épico 13 | ✅ Concluído |
| **Futuro** | Observabilidade APM, Filas Assíncronas & Refatoração DDD | Expansão | ⏳ Planejado sob Demanda |
