# Backlog Geral de Evolução — Busca Ativa, Comunicação Escolar & Livro de Atas Digital

Este é o **Backlog Vivo** do projeto. À medida que planejamos e implementamos cada evolução, os status são atualizados (`[ ]` Pendente • `[/]` Em Andamento • `[x]` Concluído).

**Legenda de Prioridade & Esforço:**
- **Prioridade:** `P0` Bloqueante/Urgente (Segurança/LGPD/Jurídico) • `P1` Alta (Estabilidade/Performance) • `P2` Média (Alto Valor Pedagógico) • `P3` Expansão Estratégica
- **Esforço:** `P` Pequeno (1–2h) • `M` Médio (3–6h) • `G` Grande (1–3 dias)

---

## Épico 1 — Blindagem LGPD, Autenticação & RBAC (Fase 1 • Sprint 1) — ✅ Concluído

- [x] **`SEC-01`** `[P0 | Esforço: P]` **Fechar rotas `GET` anônimas nas APIs**  
  Exigir sessão válida em `GET /api/students`, `GET /api/low-attendance` e `GET /api/templates`, padronizando RBAC de escrita/exclusão em [`src/app/api/students/route.ts`](../src/app/api/students/route.ts).
- [x] **`SEC-02`** `[P0 | Esforço: P]` **Desativar backdoor `Credentials` em produção e centralizar RBAC**  
  Restringir `"escola-dev-auth"` em [`src/lib/auth.ts`](../src/lib/auth.ts) exclusivamente ao ambiente local (`ENABLE_DEV_AUTH=true`) e centralizar checagem estrita de `role === "ADMIN"` em [`src/lib/roles.ts`](../src/lib/roles.ts) e [`src/lib/permissions.ts`](../src/lib/permissions.ts).
- [x] **`SEC-03`** `[P0 | Esforço: M]` **Implementar `src/proxy.ts` global (Next.js 16 Proxy Middleware)**  
  Interceptar acessos não autenticados em todas as rotas de páginas e `/api/*` (exceto endpoints públicos controlados de assinatura/validação de ata) via [`src/proxy.ts`](../src/proxy.ts).
- [x] **`SEC-04`** `[P0 | Esforço: M]` **Controle de Equipe Autorizada (*Allowlist*) e Tela `/equipe`**  
  Bloquear auto-cadastro irrestrito de e-mails `@escola.pr.gov.br` externos à escola; criada tela [`src/app/equipe/EquipeClient.tsx`](../src/app/equipe/EquipeClient.tsx) + [`src/app/api/users/route.ts`](../src/app/api/users/route.ts) para o `ADMIN` autorizar, promover ou desativar membros.
- [x] **`SEC-05`** `[P0 | Esforço: P]` **Expurgar segredos *hardcoded* e proteger token da Extensão Chrome**  
  Removidos valores fixos de `AUTH_SECRET` e `SYNC_API_TOKEN`, CORS restrito às origens do Power BI/SERP ([`src/lib/cors.ts`](../src/lib/cors.ts)) e botão autenticado **"Chave da Extensão"** em `/faltas`.
- [x] **`SEC-06`** `[P0 | Esforço: P]` **Higienização LGPD no Git e Captura de IP na Auditoria**  
  Dados brutos expurgados do índice Git (`.gitignore`) e gravação/exibição de `ipAddress` implementadas em [`src/lib/audit.ts`](../src/lib/audit.ts) e [`src/app/auditoria/AuditoriaClient.tsx`](../src/app/auditoria/AuditoriaClient.tsx).

---

## Épico 2 — Performance Serverless, Banco & Qualidade (Fase 2 • Sprint 2) — ✅ Concluído

- [x] **`PERF-01`** `[P1 | Esforço: M]` **Sincronização em Lote (*Batch Upsert*) para Power BI e SERP**  
  Refatorados [`src/app/api/frequencia/sync/route.ts`](../src/app/api/frequencia/sync/route.ts) e [`src/app/api/serp/sync/route.ts`](../src/app/api/serp/sync/route.ts) com `maxDuration = 60`, pareamento `O(1)` via [`src/lib/studentMatcher.ts`](../src/lib/studentMatcher.ts) e *batch upsert* em lotes de 250 linhas (~150ms vs ~25s).
- [x] **`PERF-02`** `[P1 | Esforço: P]` **Otimizar Sessão JWT sem consulta repetitiva ao PostgreSQL**  
  Armazenados `userId`, `role` e `active` no token JWT com janela de revalidação de 5 min em [`src/lib/auth.ts`](../src/lib/auth.ts) e [`src/lib/auth.config.ts`](../src/lib/auth.config.ts).
- [x] **`PERF-03`** `[P1 | Esforço: P]` **Criar Índices Compostos no `schema.prisma`**  
  Adicionados índices compostos e secundários em todas as tabelas críticas de [`prisma/schema.prisma`](../prisma/schema.prisma), com sincronização automática no build da Vercel via [`scripts/vercel_db_push.cjs`](../scripts/vercel_db_push.cjs).
- [x] **`PERF-04`** `[P1 | Esforço: M]` **Paginação e Filtros *Server-Side* em `/historico`**  
  Criado `GET` paginado em [`src/app/api/messages/route.ts`](../src/app/api/messages/route.ts) integrado a [`src/app/historico/HistoricoClient.tsx`](../src/app/historico/HistoricoClient.tsx) com *debounce*, busca textual e recorte de datas.
- [x] **`PERF-05`** `[P1 | Esforço: M]` **Agregações SQL e Filtro de Período em `/relatorios`**  
  Criado agregador SQL (`count` + `groupBy`) em [`src/lib/reportsAggregator.ts`](../src/lib/reportsAggregator.ts) e [`src/app/relatorios/RelatoriosClient.tsx`](../src/app/relatorios/RelatoriosClient.tsx) com recortes por Trimestre, Últimos 30 dias e Período Personalizado.
- [x] **`QUAL-01`** `[P1 | Esforço: P]` **Unificar Regra de Contagem de Faltas (`isAbsenceRelated`)**  
  Unificada a consulta de acionamentos de faltas em [`src/app/faltas/page.tsx`](../src/app/faltas/page.tsx) priorizando `template: { isAbsenceRelated: true }`.
- [x] **`QUAL-02`** `[P1 | Esforço: M]` **Validação de Payloads (`Zod`) + Testes Unitários (`Vitest`)**  
  Schemas centralizados em [`src/lib/schemas.ts`](../src/lib/schemas.ts) e suíte automatizada com Vitest configurada e validada (`41 testes` em 7 suítes).

---

## Épico 3 — Módulos Pedagógicos Core & Respaldo Jurídico (Fase 3 • Sprints 3 e 4) — ✅ Concluído

- [x] **`PED-01`** `[P2 | Esforço: M]` **Gerador de Dossiê Individual em PDF (Conselho Tutelar / SERP / MP)**  
  Emissão oficial em 1 clique em [`src/app/alunos/[id]/dossie/DossieClient.tsx`](../src/app/alunos/[id]/dossie/DossieClient.tsx) com cabeçalho SEED-PR, série de frequência, atestados, atas oficiais, buscas ativas e parecer técnico.
- [x] **`PED-02`** `[P2 | Esforço: M]` **Série Histórica de Frequência (`AttendanceSnapshot`) e Alerta de Queda Abrupta**  
  Detector preventivo em [`src/lib/pedagogicalClassifier.ts`](../src/lib/pedagogicalClassifier.ts) e filtro rápido `📉 Queda Abrupta` em `/faltas`.
- [x] **`PED-03`** `[P2 | Esforço: M]` **Gestão de Atestados Médicos e Justificativas com Vigência**  
  Modelo `AbsenceJustification` + API [`src/app/api/students/[id]/justifications/route.ts`](../src/app/api/students/[id]/justifications/route.ts) e selo 🩺 **"Atestado Vigente"** em todo o sistema.
- [x] **`PED-04`** `[P2 | Esforço: M]` **Múltiplos Contatos de Responsáveis (`StudentContact`)**  
  Cadastro de Mãe, Pai, Avós e Recado em [`src/app/api/students/[id]/contacts/route.ts`](../src/app/api/students/[id]/contacts/route.ts) com sinalização de validade de WhatsApp e troca em 1 clique.
- [x] **`PED-05`** `[P2 | Esforço: G]` **Prontuário 360º do Aluno (`/alunos/[id]`)**  
  Visão integral em [`src/app/alunos/[id]/ProntuarioClient.tsx`](../src/app/alunos/[id]/ProntuarioClient.tsx) reunindo presença, contatos, atestados, atas do Livro Oficial e linha do tempo de mensagens.

---

## Épico 4 — Automação de WhatsApp (`wa.me`) & IA na Triagem (Fase 4 • Sprint 5) — ✅ Concluído

- [x] **`AUT-01`** `[P2 | Esforço: M]` **Rastreamento de Status de Entrega (`deliveryStatus`) e Saneamento de Números**  
  Confirmação rápida (`SENT`) ou invalidação (`FAILED_NO_WHATSAPP`) via [`src/app/api/messages/status/route.ts`](../src/app/api/messages/status/route.ts), atualizando `whatsappValid` e documentando tentativas frustradas no Dossiê.
- [x] **`AUT-02`** `[P2 | Esforço: G]` **Fila Assistida de Disparo por Turma via `wa.me` + Camada Plugável**  
  Modo **"Fila por Turma"** em [`src/app/busca-ativa/BuscaAtivaClient.tsx`](../src/app/busca-ativa/BuscaAtivaClient.tsx) + [`src/lib/whatsappProvider.ts`](../src/lib/whatsappProvider.ts) com reuso de aba única e salto inteligente de atestados vigentes.
- [x] **`AUT-03`** `[P3 | Esforço: G]` **Formalização & Classificação de Retorno com IA Gemini + Webhook Futuro**  
  Rota [`src/app/api/ai/classify-reply/route.ts`](../src/app/api/ai/classify-reply/route.ts) com JSON estruturado + *fallback* determinístico local, estatísticas de causas em `/relatorios` e webhook passivo futuro.
- [x] **`AUT-04`** `[P2 | Esforço: M]` **Janela Dedicada Compacta (Linux) & Detecção de Plataforma Mobile/Desktop**  
  Implementação de `isMobileDevice` e `buildWhatsAppDispatchUrl` em [`src/lib/whatsappProvider.ts`](../src/lib/whatsappProvider.ts), Janela Dedicada Compacta (tipo popup minimalista 480x760px à direita) gerenciada pela extensão Chrome (`extension/background.js`) e componente de alternância liga/desliga (`WhatsAppDispatchToggle.tsx`).

---

## Épico 5 — Escala Regional SEED-PR & Mobilidade PWA (Fase 5 • Sprint 6) — ✅ Concluído

- [x] **`ESC-01`** `[P3 | Esforço: G]` **Arquitetura Multi-Escola (`School` Multi-Tenancy)**  
  Entidade `School` no schema e resolução contextual em [`src/lib/currentSchool.ts`](../src/lib/currentSchool.ts) com provisão automática da escola padrão (`ensureDefaultSchool`).
- [x] **`ESC-02`** `[P3 | Esforço: P]` **Transformação em PWA Mobile Instalável**  
  [`public/manifest.json`](../public/manifest.json), ícones adaptativos, Service Worker [`public/sw.js`](../public/sw.js) e banner [`src/components/PwaRegister.tsx`](../src/components/PwaRegister.tsx).
- [x] **`ESC-03`** `[P3 | Esforço: M]` **Boletim Executivo Semanal Automatizado (`Vercel Cron`)**  
  Cron job semanal (`0 10 * * 1`) em [`vercel.json`](../vercel.json), API [`src/app/api/cron/weekly-digest/route.ts`](../src/app/api/cron/weekly-digest/route.ts) e painel [`src/app/boletim/BoletimClient.tsx`](../src/app/boletim/BoletimClient.tsx).

---

## Épico 6 — Importação Oficial SERE/SEED-PR & Saneamento de Equipe (Fase 6 • Sprint 7) — ✅ Concluído

- [x] **`SERE-01`** `[P1 | Esforço: G]` **Parser Multiformato Nativo SERE (`.xls` BIFF8, `.xlsx`, `.pdf` e `.csv`)**  
  Implementado [`src/lib/sereParser.ts`](../src/lib/sereParser.ts) com `xlsx` (SheetJS) e `unpdf`, decodificação automática `UTF-8`/`Windows-1252`, fusão de turmas técnicas duplas e exclusão automática de turmas de contraturno/programas complementares (AEE, PMA, Edutech, Robótica), coberto por testes reais de buffer em [`src/lib/__tests__/sereParser.test.ts`](../src/lib/__tests__/sereParser.test.ts).
- [x] **`SERE-02`** `[P1 | Esforço: M]` **Assistente Guiado de Importação em Lote (`/alunos`)**  
  Modal [`src/app/alunos/SereImportModal.tsx`](../src/app/alunos/SereImportModal.tsx) com upload simultâneo de múltiplos arquivos `.xls`/`.pdf`, prévia de inclusões/atualizações/transferências e sincronização auditada em [`src/app/api/students/import/route.ts`](../src/app/api/students/import/route.ts).
- [x] **`SERE-03`** `[P1 | Esforço: P]` **Consolidação Cadastral de Equipe Escolar**  
  Script [`scripts/consolidate_users.cjs`](../scripts/consolidate_users.cjs) e ajustes em [`scripts/seed.cjs`](../scripts/seed.cjs) eliminando duplicidades históricas entre nomes das planilhas legadas e contas institucionais `@escola.pr.gov.br`.

---

## Épico 7 — Livro Oficial de Atas Pedagógicas Digital & Biometria (Fase 7 • Sprint 8) — ✅ Concluído

- [x] **`ATA-01`** `[P0 | Esforço: G]` **Fundação Jurídica, Criptografia `SHA-256` & Numeração Sequencial Atômica**  
  Modelos `PedagogicalMinute`, `PedagogicalMinuteStudent`, `PedagogicalMinuteParticipant`, `PedagogicalMinuteAddendum` e `PedagogicalActionItem` em [`prisma/schema.prisma`](../prisma/schema.prisma); motor criptográfico canônico em [`src/lib/ataCrypto.ts`](../src/lib/ataCrypto.ts) e lavratura atômica resiliente com proteção contra concorrência em [`src/app/api/atas/[id]/finalize/route.ts`](../src/app/api/atas/[id]/finalize/route.ts).
- [x] **`ATA-02`** `[P1 | Esforço: G]` **Editor Bimodal Widescreen, Voz e IA Generativa com Diretrizes NRE/SEED-PR**  
  Interface widescreen (`min(98vw, 1560px)`) em duas colunas em [`src/components/ata/AtaEditorModal.tsx`](../src/components/ata/AtaEditorModal.tsx) e [`src/components/ata/AtaDialog.tsx`](../src/components/ata/AtaDialog.tsx), catálogo ágil de alunos/turmas, ditado por voz (`pt-BR`) e motor de revisão ortográfica, concordância e sintaxe seguindo as diretrizes oficiais do NRE/SEED-PR em [`src/app/api/ai/formalize-ata/route.ts`](../src/app/api/ai/formalize-ata/route.ts) e [`src/lib/nreAtaFormatter.ts`](../src/lib/nreAtaFormatter.ts). Aprimorado com **Gemini 2026 (`gemini-3.5-flash`)**, latência otimizada (`thinkingLevel: "low"`), data por extenso travada no fuso oficial `America/Sao_Paulo`, estruturação JSON estrita (`responseSchema`) e preenchimento automático de encaminhamentos com prazos calculados.
- [x] **`ATA-03`** `[P1 | Esforço: G]` **Assinatura Digital @escola em 1 Clique, QR Code Móvel & Biometria Local WebAuthn/FIDO2**  
  Assinatura digital institucional `@escola.pr.gov.br` em 1 clique para servidores e discentes (Lei 14.063/2020 e Art. 12 do ECA), coleta manuscrita em tela ([`src/components/ata/SignatureCanvas.tsx`](../src/components/ata/SignatureCanvas.tsx)), link temporário com QR Code e portal móvel [`src/app/assinar/ata/[token]/MobileSignClient.tsx`](../src/app/assinar/ata/[token]/MobileSignClient.tsx) com biometria do smartphone (Passkey FIDO2) e Termo de Recusa inline.
- [x] **`ATA-04`** `[P1 | Esforço: M]` **Imutabilidade, Adendos Encadeados (*"Em tempo"*), Averbação de Cancelamento & Expurgo ADMIN**  
  Bloqueio estrito pós-lavratura (`403`), termos de retificação com *hash-chaining* ([`src/app/api/atas/[id]/addendums/route.ts`](../src/app/api/atas/[id]/addendums/route.ts)), cancelamento justificado ([`src/app/api/atas/[id]/void/route.ts`](../src/app/api/atas/[id]/void/route.ts)), baixa de encaminhamentos e exclusão atômica de atas de teste restrita a Administrador Geral (`DELETE /api/atas/:id`).
- [x] **`ATA-05`** `[P1 | Esforço: M]` **Impressão A4 em Folha Única (`1 of 1`), Livro Anual, Validação Pública LGPD & Dossiê ECA-safe**  
  Emissão individual A4 em página única sem transbordo ([`/atas/[id]/imprimir`](../src/app/atas/[id]/imprimir/PrintPageClient.tsx)) com Brasão oficial (SVG) e carimbo de data/hora exato, Livro Anual com Termo de Abertura e Encerramento ([`/atas/livro/[ano]`](../src/app/atas/livro/[ano]/page.tsx)), Certidão Pública mascarada ([`/validar/ata/[code]`](../src/app/validar/ata/[code]/page.tsx)) e blindagem de **Sigilo Reforçado** no Dossiê Individual.

---

## Épico 9 — Transformação SaaS Multi-Escola & Governança Hierárquica 4-Tier (Fase 9 • Sprints 9 e 10) — ✅ Concluído

- [x] **`SAAS-01`** `[P0 | Esforço: G]` **Modelo de Dados Relacional Multi-Tenant (`EducationNetwork`, `School`, `UserSchool`)**  
  Implementada segregação lógica estrita de inquilinos em `prisma/schema.prisma` com `schoolId` obrigatório em estudantes, turmas, atestados, atas e logs, associando usuários a escolas com permissões granulares.
- [x] **`SAAS-02`** `[P0 | Esforço: M]` **Governança e RBAC de 4 Níveis (`SUPERADMIN`, `GESTAO_SECRETARIA`, `GESTOR_ESCOLAR`, `PEDAGOGA`)**  
  Controle centralizado em [`src/lib/roles.ts`](../src/lib/roles.ts) e [`src/lib/permissions.ts`](../src/lib/permissions.ts), com proteções perimetrais e roteamento inteligente por papel na rota raiz (`/`).
- [x] **`SAAS-03`** `[P0 | Esforço: G]` **Painéis Isolados de Aterrissagem**  
  - `/admin`: Dashboard Global do SaaS com métricas consolidadas, diretório de escolas, emulação de contexto e trilha de auditoria global.  
  - `/secretaria`: Dashboard Executivo Municipal para secretários(as) de educação (SEMEC), com indicadores de frequência da rede.  
  - `/gestao`: Painel de controle da Direção Escolar com atalhos de gestão da unidade, equipe e turmas.  
  - `/busca-ativa`: Operação da equipe pedagógica com interface focada e limpa.
- [x] **`SAAS-04`** `[P1 | Esforço: M]` **Diretório Global de Escolas & Provisionamento Automático (`/admin/escolas`)**  
  Interface para cadastro de novas escolas, vínculo com redes municipais ou estaduais, e auto-provisionamento dos modelos pedagógicos institucionais padrão.
- [x] **`SAAS-05`** `[P0 | Esforço: M]` **Higienização Operacional e Exclusão Segura com Proteção da Unidade Piloto**  
  - `POST /api/schools/[id]/sanitize`: Limpeza atômica em transação de registros de teste (estudantes, turmas, atas), retornando a escola a zero.  
  - `DELETE /api/schools/[id]`: Exclusão em cascata atômica de escolas e registros dependentes.  
  - **Blindagem do Piloto Leopoldina**: Travas no backend e frontend impedem a exclusão ou higienização da unidade piloto (INEP `41042730`).

---

## Épico 11 — Consolidação Adversarial Multi-Tenant & Defesa em Profundidade (Fase 11 • Sprint 11) — ✅ Concluído

- [x] **`SEC-ADV-01`** `[P0 | Esforço: M]` **Prevenção de Falsificação de Contexto de Escola (`active_school_id`)**  
  Validação estrita no resolvedor `getCurrentSchool()` garantindo que o cookie `active_school_id` seja aceito somente se o usuário tiver vínculo ativo comprovado em `UserSchool` ou perfil `SUPERADMIN`/`GESTAO_SECRETARIA`.
- [x] **`SEC-ADV-02`** `[P0 | Esforço: M]` **Gating Estrito de Dados Legados da Sede Piloto Fundadora**  
  Restrição de tolerância a `schoolId: null` ou `"default-leopoldina"` exclusivamente à sessão da Unidade Piloto Fundadora (INEP `41042730`), impedindo adoção de registros orfãos por outras escolas.
- [x] **`SEC-ADV-03`** `[P0 | Esforço: M]` **Isolamento de Tenant em Server Components (SSR Tenancy)**  
  Aplicação de `auth()` e `assertTenantOwnership(...)` em todas as páginas SSR com parâmetros dinâmicos (`/atas/[id]/imprimir`, `/atas/livro/[ano]`, `/alunos/[id]/dossie`), fechando brechas BOLA/IDOR fora do alcance do proxy.
- [x] **`SEC-ADV-04`** `[P0 | Esforço: M]` **Integridade Institucional de Chaves Estrangeiras (FK Traversal Defense)**  
  Validação estrita de pertencimento de arrays e referências (`studentIds`, `classGroupId`, `templateId`) ao tenant da sessão ativa em rotas de criação, atualização e finalização.
- [x] **`SEC-ADV-05`** `[P0 | Esforço: P]` **Rejeição Explícita com 403 Forbidden em Operações Restritas**  
  Substituição de aceitações silenciosas (`200 OK`) por `403 Forbidden` quando flags restritas a perfis superiores forem enviadas (ex.: `updateSchoolInfo: true` na importação SERE para não-`SUPERADMIN`).
- [x] **`SEC-ADV-06`** `[P0 | Esforço: P]` **Escopo Raiz Mandatório na Trilha de Auditoria e Isolamento de Painel**  
  Obrigatoriedade de passar `schoolId` na raiz de `logAudit(...)` e filtro estrito na rota `/auditoria` para blindagem total contra vazamento de telemetria entre escolas.
- [x] **`SEC-ADV-07`** `[P0 | Esforço: P]` **Proteção Contra Injeção de Fórmulas em CSV (CWE-1236 & RFC 4180)**  
  Sanitização de caracteres de controle de fórmulas (`=`, `+`, `-`, `@`, `\t`, `\r`) combinada ao escape padrão RFC 4180 de aspas duplas em exportações na central `/faltas`.
- [x] **`TEST-ADV-01`** `[P0 | Esforço: G]` **Suíte Automatizada Adversarial ao Vivo (177+ Testes em 30 Arquivos)**  
  Criação e execução contínua da bateria `src/app/api/__tests__/adversarialQa.test.ts` e suítes `m1MultiTenantFixes.test.ts` e `m2DataIntegrityFixes.test.ts`, validando os 7 vetores de risco com Route Handlers reais.

---

## Épico 12 — Fortalecimento do Arcabouço Jurídico & Escala do SaaS (Fase 12+ • Sprint 12) — ✅ Concluído

- [x] **`JUR-02`** `[P1 | Esforço: M]` **Certificação Criptográfica de Mensagens e Linha do Tempo Imutável**  
  Implementação de hash de integridade canônico individual (`SHA-256`) para cada registro de comunicação no histórico (`MessageLog.contentHash`), validado em [`src/lib/messageCrypto.ts`](../src/lib/messageCrypto.ts), persistido nas rotas de envio e edição com auditoria, garantindo blindagem contra alegações de adulteração perante a Justiça da Infância e Juventude.
- [x] **`JUR-01`** `[P1 | Esforço: G]` **Dossiê Unificado de Evidências Jurídicas (Conselho Tutelar & Ministério Público)**  
  Geração pericial probatória consolidada em 1 clique ([`src/app/alunos/[id]/dossie/DossieClient.tsx`](../src/app/alunos/[id]/dossie/DossieClient.tsx)), reunindo cronologia completa: todas as mensagens WhatsApp disparadas com status de entrega e selo `SHA-256`, respostas familiares categorizadas, atestados médicos, atas do Livro Digital assinadas e **Selo de Autenticidade Pericial do Dossiê** (`computeDossierIntegritySeal`) com respaldo legal na Lei 14.063/2020, MP 2.200-2/2001, ECA (Art. 56) e LDB (Art. 12).
- [x] **`JUR-03`** `[P2 | Esforço: M]` **Alertas Automáticos de Prazos de Encaminhamentos das Atas (`PedagogicalActionItem`)**  
  Central de alertas de prazos com categorização temática inteligente (`src/lib/actionClassifier.ts`: Laudos/Exames, Retornos Familiares, CRAS/CREAS/CT, Pedagógico), banner de avisos com contador dinâmico de vencidos/a vencer, badge em tempo real no menu lateral (`Sidebar.tsx`), endpoint dedicado [`/api/atas/actions/alerts`](../src/app/api/atas/actions/alerts/route.ts), botões de disparo de lembrete via WhatsApp para os responsáveis e exibição de prazos das atas no Prontuário 360º.
- [x] **`JUR-04`** `[P2 | Esforço: M]` **Captura Fotográfica de Vias Físicas & Assinatura Gov.br**  
  Interface móvel e desktop em [`src/components/ata/PhysicalScanModal.tsx`](../src/components/ata/PhysicalScanModal.tsx) para capturar foto da folha física assinada à mão ou anexar PDF autenticado no Assinador ITI / Gov.br (`assinador.iti.br`) com protocolo de validação, integrado ao Prontuário 360º ([`src/app/alunos/[id]/ProntuarioClient.tsx`](../src/app/alunos/[id]/ProntuarioClient.tsx)) e à API auditada [`/api/atas/[id]/physical-scan`](../src/app/api/atas/[id]/physical-scan/route.ts) com isolamento multi-tenant estrito.
- [x] **`SAAS-06`** `[P2 | Esforço: G]` **Wizard de Auto-Onboarding e Adesão de Novas Escolas e Redes**  
  Fluxo guiado passo a passo em [`/onboarding`](../src/app/onboarding/page.tsx) e [`OnboardingClient.tsx`](../src/app/onboarding/OnboardingClient.tsx) para adesão de novas instituições municipais, estaduais ou privadas em 4 etapas: identificação com proteção incondicional contra duplicidade do INEP `41042730`, upload de brasão oficial com pré-visualização A4 em tempo real, carga inicial de alunos via SERE/RCO e geração imediata do token de sincronização da Extensão Chrome com comutação de tenant via `/api/auth/switch-school`.
- [x] **`SAAS-07`** `[P2 | Esforço: M]` **Relatórios Analíticos Preditivos de Evasão para Secretarias (SEMEC)**  
  Motor analítico preditivo em [`src/lib/predictiveAnalytics.ts`](../src/lib/predictiveAnalytics.ts) e painel executivo em [`src/app/secretaria/SecretariaClient.tsx`](../src/app/secretaria/SecretariaClient.tsx) e [`/api/secretaria/metrics`](../src/app/api/secretaria/metrics/route.ts) cruzando causas de infrequência comunicadas pelas famílias (transporte escolar rural, saúde, trabalho infantil, vulnerabilidade) com diretrizes automáticas de políticas públicas e matriz de risco das unidades escolares.

---

## Resumo de Sprints & Entregas

| Sprint | Foco Principal | Itens do Backlog | Status |
| :--- | :--- | :--- | :--- |
| **Sprint 1** | Blindagem LGPD & Controle de Equipe | `SEC-01` a `SEC-06` | ✅ Concluído |
| **Sprint 2** | Alta Performance & Histórico Completo | `PERF-01` a `PERF-05`, `QUAL-01`, `QUAL-02` | ✅ Concluído |
| **Sprint 3** | Respaldo Jurídico & Prevenção | `PED-01`, `PED-02`, `PED-03` | ✅ Concluído |
| **Sprint 4** | Visão 360º da Família | `PED-04`, `PED-05` | ✅ Concluído |
| **Sprint 5** | Automação WhatsApp & IA | `AUT-01` a `AUT-04` | ✅ Concluído |
| **Sprint 6** | Expansão Regional & Mobile PWA | `ESC-01` a `ESC-03` | ✅ Concluído |
| **Sprint 7** | Importação SERE (`.xls`/`.pdf`) & Equipe | `SERE-01` a `SERE-03` | ✅ Concluído |
| **Sprint 8** | Livro Oficial de Atas Digital & Biometria | `ATA-01` a `ATA-05` | ✅ Concluído |
| **Sprint 9** | Auditoria Técnica, Multi-Escola & LGPD | `SEC-01` a `SEC-04`, `DB-01`, `DB-02`, `TEST-01` | ✅ Concluído |
| **Sprint 10** | SaaS Multi-Escola & Hierarquia 4-Tier | `SAAS-01` a `SAAS-05` | ✅ Concluído |
| **Sprint 11** | Consolidação Adversarial Multi-Tenant & Defesa em Profundidade | `SEC-ADV-01` a `SEC-ADV-07`, `TEST-ADV-01` | ✅ Concluído |
| **Sprint 12+** | Arcabouço Jurídico Probatório & Escala SaaS | `JUR-01` a `JUR-04`, `SAAS-06`, `SAAS-07` | ✅ Concluído |
