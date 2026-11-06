# Relatório Oficial de Auditoria de Segurança Multi-Tenant & Conformidade Jurídico-Pericial (V2)

> [!NOTE]
> **Registro Oficial Point-in-Time (Data-Base: 05/11/2026 — Ciclo V2):** Este laudo técnico-jurídico documenta a auditoria *white-box* integral executada sobre as **74 rotas/páginas (`route.ts` / `page.tsx`)** e bibliotecas criptográficas (`src/lib/*`) do **Rede Ativa SaaS**, homologada por testes adversariais e periciais ao vivo em [`src/lib/__tests__/securityAndLegalAuditV2.test.ts`](../../src/lib/__tests__/securityAndLegalAuditV2.test.ts) (**37 suítes / 215 testes Vitest aprovados**). Para a especificação arquitetural viva (SSOT), consulte [`../ARQUITETURA_E_ENGENHARIA.md`](../ARQUITETURA_E_ENGENHARIA.md).

---

## 1. Sumário Executivo e Marco Regulatório Auditado

| Dimensão Auditada | Base Legal / Normativa | Status Pré-Auditoria | Status Pós-Remediação V2 |
| :--- | :--- | :---: | :---: |
| **Isolamento Multi-Tenant SSR & APIs (BOLA/IDOR)** | OWASP API1:2023 / LGPD Art. 46 | ⚠️ 2 Falhas Críticas (`SEC-01`, `SEC-02`) | ✅ **100% Isolado e Homologado** |
| **Fé Pública, Autoria Pessoal e Simetria das Formas** | Lei nº 14.063/2020 (Art. 4º, II) & MP nº 2.200-2/2001 | ⚠️ 1 Falha Crítica (`JUR-01`) | ✅ **PIN Obrigatório em Lavratura, Adendo e Anulação** |
| **Integridade Pericial e Cadeia de Custódia Documental** | CPC Arts. 411 e 440 | ⚠️ 1 Crítica (`JUR-02`) + 2 Altas (`JUR-03`, `JUR-04`) | ✅ **Recálculo SHA-256 Real + Biometria Selada** |
| **Proteção Integral de Crianças e Adolescentes** | ECA (Lei nº 8.069/1990 — Arts. 17, 18, 143 e 247) & LGPD Art. 14 | ⚠️ 1 Falha Alta (`JUR-05`) | ✅ **Anonimização Unicode + Sigilo Reforçado ECA** |
| **Gestão de Segredos, Sessão JWT e Proteção da Escola Sede** | ISO 27001 / Regra Inviolável INEP `41042730` | ⚠️ 2 Altas (`SEC-03`, `SEC-04`) + 1 Média (`SEC-05`) | ✅ **Hash SHA-256 + Fail-Fast Prod + Bloqueio Atômico** |
| **Rastreabilidade Forense de Logs (`schoolId` & IP)** | Marco Civil da Internet (Lei nº 12.965/2014 — Art. 15) | ⚠️ 1 Falha Média (`JUR-06`) | ✅ **100% dos Eventos com `schoolId` Raiz e IP** |

---

## 2. Catálogo Detalhado dos 11 Achados e Remediações Aplicadas

### 2.1. Eixo de Segurança Cibernética Multi-Tenant e Governança RBAC

1. **`SEC-01` [CRÍTICA] — BOLA/IDOR Direto em Server Components (`/alunos/[id]` e `/alunos/[id]/dossie`)**
   - **Diagnóstico:** [`ProntuarioPage`](../../src/app/alunos/%5Bid%5D/page.tsx) e [`DossiePage`](../../src/app/alunos/%5Bid%5D/dossie/page.tsx) renderizavam o prontuário 360° de qualquer estudante do banco sem invocar `assertTenantOwnership(...)`, além de gravar `GENERATE_DOSSIER` na trilha de auditoria da escola vítima durante `GET`.
   - **Remediação:** Inserida validação obrigatória `assertTenantOwnership(bundle.student.schoolId, currentSchool.id, session)` com retorno imediato `notFound()` antes de qualquer leitura ou escrita de auditoria, além de escopo de tenant sobre `minutes` em [`safePhase3Queries.ts`](../../src/lib/safePhase3Queries.ts).

2. **`SEC-02` [CRÍTICA] — Escalação Horizontal entre Municípios/Redes (`GESTAO_SECRETARIA` e `/secretaria`)**
   - **Diagnóstico:** [`currentSchool.ts`](../../src/lib/currentSchool.ts) tratava `GESTAO_SECRETARIA` como perfil global irrestrito para o cookie `active_school_id`; [`/api/secretaria/metrics`](../../src/app/api/secretaria/metrics/route.ts) aceitava `?city=OutroMunicipio` sem validar vínculo em `session.user.networks`; e [`/secretaria`](../../src/app/secretaria/page.tsx) permitia acesso de `GESTOR_ESCOLAR` isolado a métricas de toda a rede municipal.
   - **Remediação:** Restringido o aceite de `active_school_id` e `?city=` para `GESTAO_SECRETARIA` estritamente às redes/municípios vinculados (`403 Forbidden` em tentativa cruzada) e bloqueado acesso de `GESTOR_ESCOLAR` ao painel consolidado `/secretaria`.

3. **`SEC-03` [ALTA] — Exposição do `SYNC_API_TOKEN` Mestre e de `syncTokenHash` Escolar**
   - **Diagnóstico:** [`/api/sync-config`](../../src/app/api/sync-config/route.ts) expunha o token global da plataforma para qualquer `GESTOR_ESCOLAR`, e `/api/schools` retornava `syncTokenHash` em texto plano no JSON.
   - **Remediação:** `/api/sync-config` restrito a `requireSuperAdmin()`; criado [`src/lib/syncToken.ts`](../../src/lib/syncToken.ts) persistindo novos tokens escolares como `sha256:<digest>` (com fallback retrocompatível seguro para extensões já instaladas) e omitido `syncTokenHash` de todos os payloads JSON de `/api/schools`.

4. **`SEC-04` [ALTA] — Segredo JWT Fixo em Runtime de Produção e Hardening de Cookie**
   - **Diagnóstico:** [`auth.config.ts`](../../src/lib/auth.config.ts) continha fallback literal estático mesmo em runtime de produção, e `active_school_id` não definia `httpOnly: true` / `secure`.
   - **Remediação:** Implementado `resolveAuthSecret()` com *fail-fast* obrigatório em runtime de produção caso `AUTH_SECRET` / `NEXTAUTH_SECRET` esteja ausente ou curto (< 16 chars), e ativado `httpOnly: true` + `secure` condicional em [`switch-school/route.ts`](../../src/app/api/auth/switch-school/route.ts).

5. **`SEC-05` [MÉDIA] — Código Condicional em `sanitize` da Escola Sede (`41042730`) e Alçada em `POST /api/schools`**
   - **Diagnóstico:** [`schools/[id]/sanitize/route.ts`](../../src/app/api/schools/%5Bid%5D/sanitize/route.ts) possuía cláusula condicional `confirmationCode === "RESET_LEOPOLDINA_PROD"`, e `POST /api/schools` aceitava `GESTOR_ESCOLAR`.
   - **Remediação:** Removida qualquer exceção condicional em `/sanitize` — bloqueio atômico incondicional (`403 Forbidden`) para o **Colégio Estadual Leopoldina B. Pedroso** (`41042730`), e restrito `POST /api/schools` + `/onboarding` a `SUPERADMIN` e `GESTAO_SECRETARIA` (no limite de seu município).

---

### 2.2. Eixo de Conformidade Jurídica, Fé Pública, Perícia Grafotécnica e ECA/LGPD

6. **`JUR-01` [CRÍTICA] — Bypass do PIN de Fé Pública (`signingPinHash === null`) e Simetria das Formas**
   - **Diagnóstico:** Servidores sem PIN cadastrado conseguiam lavrar atas oficiais sem PIN em `finalize/route.ts`; além disso, `void/route.ts` e `addendums/route.ts` não exigiam PIN de Fé Pública (e `void` permitia anulação por `PEDAGOGA` sem alçada da Direção).
   - **Remediação:** Centralizado `verifyServerSigningPin()` em [`signingPin.ts`](../../src/lib/signingPin.ts), rejeitando `signingPinHash === null` com `401 PIN_REQUIRED` em `finalize`, `addendums` e `void` (acionando automaticamente o modal de cadastro/assinatura em [`AtaEditorModal.tsx`](../../src/components/ata/AtaEditorModal.tsx)), e exigida alçada de Direção Escolar (`GESTOR_ESCOLAR` / `SUPERADMIN`) para `VOID_ATA`.

7. **`JUR-02` [CRÍTICA] — Certidão Pública Cega com `isAuthentic: true` Estático (CPC Art. 411)**
   - **Diagnóstico:** [`/api/atas/public/[code]`](../../src/app/api/atas/public/%5Bcode%5D/route.ts) e [`/validar/ata/[code]`](../../src/app/validar/ata/%5Bcode%5D/page.tsx) declaravam autenticidade sem recalcular `verifyMinuteIntegrity()` nem a cadeia de `addendums`.
   - **Remediação:** Ambas passam a recalcular em tempo real `verifyMinuteIntegrity()` (com suporte dual v1/v2) e `verifyAddendumChain()`, exibindo alerta vermelho imediato de violação pericial caso o texto, assinaturas, traço biométrico ou adendos sofram adulteração no banco, além de exibir o protocolo Gov.br/ICP-Brasil quando presente.

8. **`JUR-03` [ALTA] — Perda de `biometricStrokeData` em Rascunhos e Ausência no Selo `SHA-256` (CPC Art. 440)**
   - **Diagnóstico:** `PATCH /api/atas/[id]` omitia `biometricStrokeData` e `signerUserAgent` ao recriar participantes, apagando os vetores biométricos colhidos via QR Code antes da lavratura; e `computeMinuteHash()` não selava `biometricStrokeData`.
   - **Remediação:** Preservados `biometricStrokeData`, `signerUserAgent` e `clientTimestampIso` no `PATCH` e priorizados os valores verificados do banco no `finalize`; incorporado `strokeHash` em `computeMinuteHash()` e assinatura de participante em `computeAddendumHash()` com verificação retrocompatível dual (v1/v2).

9. **`JUR-04` [ALTA] — Cadeia de Custódia da Via Física Digitalizada (`physical-scan`)**
   - **Diagnóstico:** `PATCH /api/atas/[id]` permitia sobrescrever/apagar `physicalSignedScanData` em atas `FINALIZED` sem auditoria; `physical-scan` aceitava `govBrVerified: true` sem protocolo e permitia `DELETE` por não-gestores em atas lavradas.
   - **Remediação:** Removido o atalho não auditado em `PATCH /api/atas/[id]`; exigido MIME estrito (`image/png|jpeg|webp` ou `application/pdf`), protocolo obrigatório para `govBrVerified`, gravação do `scanSha256` no `AuditLog`, e alçada `GESTOR_ESCOLAR`/`SUPERADMIN` para `DELETE` em atas `FINALIZED`/`VOIDED`.

10. **`JUR-05` [ALTA] — Proteção ECA (Arts. 17, 143 e 247): Acentuação Unicode, QR Code Coletivo e Sigilo Reforçado (`isConfidential`)**
    - **Diagnóstico:** `anonymizeOtherMinorsInText()` falhava em nomes acentuados (`José`, `Cauã`, `Inês`, `Théo`) por usar `\b` ASCII; `/assinar/ata/[token]` exibia nomes de outros menores em atas coletivas e sofria *race condition* no `POST`; atas `isConfidential: true` vazavam em `/alerts` e listagens para terceiros.
    - **Remediação:** Reescrito `anonymizeOtherMinorsInText()` com fronteiras Unicode `(?<![\p{L}\p{N}])...(?![\p{L}\p{N}])` (`giu`); aplicada anonimização automática de outros menores em `/assinar/ata/[token]` e `GET /api/atas/sign-token/[token]`; gravação atômica de uso único no `POST` com teto de bytes/MIME; ocultado `mobileSignToken` nas listagens; e implementado `canAccessConfidentialMinute()` protegendo APIs, alertas, prontuário, dossiê, impressão e livro anual.

11. **`JUR-06` [MÉDIA] — Marco Civil Art. 15 (`schoolId` Raiz e IP no `AuditLog`)**
    - **Diagnóstico:** Chamadas `logAudit` de gestão de escolas e troca de contexto omitiam `schoolId` raiz, e `DossiePage` não capturava o IP da requisição.
    - **Remediação:** Padronizado `schoolId` na raiz de todos os eventos `logAudit` auditados e injetado `req: await headers()` na emissão autorizada do Dossiê Oficial.

---

## 3. Evidência de Homologação Automatizada

- **Suíte Dedicada V2:** [`src/lib/__tests__/securityAndLegalAuditV2.test.ts`](../../src/lib/__tests__/securityAndLegalAuditV2.test.ts) (7 cenários integrados cobrindo `SEC-01..05` e `JUR-01..06`).
- **Suíte Global Vitest:** **37 arquivos de teste / 215 testes aprovados (100% verdes)**.
- **Compilação de Produção:** Next.js 16.2.1 (Turbopack + TypeScript 6 estrito) compilado com **0 erros**.
