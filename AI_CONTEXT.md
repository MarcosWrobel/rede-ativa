# AI_CONTEXT.md — Contexto Mestre do Projeto Rede Ativa SaaS

> **Este documento é a fonte canônica (Single Source of Truth) de contexto técnico, histórico, diretrizes arquiteturais e regras inegociáveis para qualquer Assistente de Inteligência Artificial (Antigravity, Cursor, GitHub Copilot, Claude, ChatGPT, etc.) e desenvolvedores que atuem neste repositório.**

---

## 🤖 Bloco de Inicialização Rápida (System Prompt para IAs)

*Copie e cole o bloco abaixo ao iniciar uma conversa com qualquer IA em um novo ambiente ou ferramenta:*

```text
Você é um engenheiro de software sênior atuando no repositório do "Rede Ativa SaaS" (antigo Busca Ativa Leopoldina).
A plataforma é uma aplicação full-stack multi-escola de alta performance construída com Next.js 16 (App Router + Turbopack), React 19, TypeScript 6 estrito, Prisma ORM 6, Neon PostgreSQL Serverless (AWS sa-east-1) e NextAuth v5.

Seu trabalho deve seguir estritamente as diretrizes do arquivo AI_CONTEXT.md:
1. O Colégio Estadual Leopoldina B. Pedroso (INEP 41042730) é a UNIDADE PILOTO FUNDADORA. Ele possui 689 estudantes reais e NUNCA pode ter seus dados apagados, alterados inadvertidamente ou sofrer exclusão. Tolerância a registros legados (schoolId: null ou "default-leopoldina") é restrita a sessões com inepCode === "41042730".
2. Toda query/mutação de dados operacionais DEVE respeitar o isolamento multi-tenant por schoolId (prevenção absoluta contra IDOR/BOLA via assertTenantOwnership, validação de cookie active_school_id, validação institucional de FKs e schoolId raiz em logAudit).
3. A governança opera em 4 camadas hierárquicas: SUPERADMIN (/admin), GESTAO_SECRETARIA (/secretaria), GESTOR_ESCOLAR (/gestao) e PEDAGOGA (/busca-ativa). Flags restritas a perfis superiores (ex.: updateSchoolInfo: true) devem retornar explicitamente 403 Forbidden.
4. O Livro de Atas Digital possui fé pública documental (Lei nº 14.063/2020) com PIN do servidor (PBKDF2-SHA512), selo SHA-256 canônico, perícia vetorial de traço, governança extemporânea (> 5 dias úteis), adendos encadeados ("Em tempo") e biometria móvel WebAuthn.
5. Em conformidade com a LGPD e o ECA (Arts. 17 e 143), dados de menores NUNCA são enviados diretamente para a Google Gemini API sem prévia pseudonimização (aiPseudonymizer.ts).
6. Antes de finalizar qualquer alteração, garanta que todos os testes passem (npm test — 330 testes em 50 suítes, incluindo adversarialQa.test.ts, messageReplySecurity.test.ts, securityAndStabilityAuditV3.test.ts e teacherAtas.test.ts) e que o build de produção compile sem erros (npm run build).
7. Preserve todos os comentários e docstrings existentes. Utilize o padrão Server Component (page.tsx) + Client Component (*Client.tsx), lembrando que Server Components dinâmicos devem validar auth() e assertTenantOwnership(...).
```

---

## 📖 1. Histórico e Evolução do Projeto

### Fase 1: Origem e Validação na Escola Piloto (Outubro/2026)
O projeto nasceu no **Colégio Estadual Leopoldina B. Pedroso** (Tibagi / Ponta Grossa - PR, INEP `41042730`) com a missão de resolver quatro dores críticas da equipe pedagógica:
- **Evasão Escolar e Busca Ativa:** As pedagogas gastavam horas copiando números de planilhas e digitando mensagens repetitivas no WhatsApp Web pessoal.
- **Interoperabilidade SERE:** O sistema estadual do Paraná (SERE) exportava relatórios em formatos variados (`.xls` BIFF8, `.pdf`, `.csv`), com duplicação de turmas técnicas do Novo Ensino Médio.
- **Caderno de Atas Manuscrito:** Atas de atendimento a pais eram lavradas à mão em cadernos físicos, sujeitas a rasuras, perda de registros, ausência de busca textual e dificuldade de comprovação judicial.
- **Falta de Arcabouço Jurídico:** Cobranças do Conselho Tutelar e Ministério Público exigiam dossiês consolidados de difícil compilação manual.

### Fase 2: Robustez, Extensão Universal v1.5 e Proteção Perimetral
- Implementação de autenticação institucional `@escola.pr.gov.br` (e contas municipais convidadas) via **NextAuth v5** e proxy de borda ([`src/proxy.ts`](file:///home/marcoswrobel/Documents/Registro/src/proxy.ts)).
- Criação da **Extensão Web (Manifest V3 — v1.5.0)** para coleta automatizada de dados de infrequência do Power BI estadual (*Presente na Escola*), portal SERP/Celepar e confirmação automática de envio/detecção de número inválido no WhatsApp Web.
- Integração da **Janela Dedicada Compacta (480x760px)** para Linux/Chrome, isolando a conversa de busca ativa sem expor a lista de contatos do WhatsApp (proteção contra *shoulder-surfing* na coordenação).
- Assistência de IA com **Google Gemini (`@google/genai`)** com pseudonimização prévia para formalização de atas e classificação de retornos familiares.

### Fase 3: Fé Pública, Perícia Forense & Livro de Atas Digital
- Criação do Livro Oficial Digital de Atas Pedagógicas sob a **Lei Federal nº 14.063/2020**:
  - Numeração anual sequencial por escola atômica e imutável;
  - PIN de Fé Pública do servidor (`PBKDF2-SHA512`) exigido no ato da lavratura;
  - Selagem criptográfica `SHA-256` canônica e governança de lavratura extemporânea (> 5 dias úteis);
  - Captura forense da dinâmica biométrica do traço (`x, y, t, p` + `User-Agent`) e autenticação **WebAuthn / Passkeys FIDO2** via QR Code móvel;
  - Digitalização de vias físicas e averbação de protocolo **Gov.br / ITI**;
  - Termos de aditamento encadeados (*"Em tempo"*) e averbação de cancelamento (*"Tornada Sem Efeito"*);
  - Diagramação oficial A4 em folha única (`1 of 1`) com brasão e certidão pública cega (`/validar/ata/[code]`).

### Fase 4: Transformação em SaaS Multi-Escola ("Rede Ativa SaaS") & Blindagem Adversarial
- Expansão da arquitetura para atender prefeituras (Secretarias Municipais de Educação - SEMEC) e múltiplas escolas estaduais e privadas simultaneamente (`EducationNetwork`, `UserNetwork`, `School`, `UserSchool`).
- Implementação da hierarquia de governança em 4 camadas com dashboards isolados, wizard de auto-onboarding (`/onboarding`) e análise preditiva de evasão (`predictiveAnalytics.ts`).
- Blindagem adversarial contra os 7 vetores multi-tenant (BOLA/IDOR em REST e SSR, cookie/parameter spoofing, SERE cross-tenant, FK traversal, escalada RBAC, CSV Injection CWE-1236 e isolamento de auditoria).

### Fase 5: Conclusão do Roadmap & Arquitetura Scale-Ready (Novembro/2026)
- **`INFRA-01`**: Pipeline CI automatizado via GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) com typecheck TypeScript 6, execução de 40 suítes Vitest e build Next.js 16 Turbopack.
- **`SEC-08`**: Rate Limiting Distribuído híbrido ([`src/lib/rateLimit.ts`](src/lib/rateLimit.ts)) com motor padrão Neon PostgreSQL (`RateLimitBucket`) + cache L1 em memória + adapter opcional Upstash Redis REST, protegendo IA (20 req/min), rotas públicas e trava anti-brute-force contra ataques a PIN de Fé Pública e tokens de sincronização.
- **`JUR-08`**: Preservação Arquivística Binária `PDF/A-1b` (ISO 19005-1 Level B) determinística server-side ([`src/lib/ataPdfArchive.ts`](src/lib/ataPdfArchive.ts)) com metadados XMP, fontes TrueType embutidas (`LiberationSans`), perfil sRGB ICC e emissão via [`GET /api/atas/[id]/pdfa`](src/app/api/atas/[id]/pdfa/route.ts).
- **`STORAGE-01`**: Externalização multi-driver de vias físicas ([`src/lib/objectStorage.ts`](src/lib/objectStorage.ts)) com assinatura nativa AWS SigV4 para S3/Cloudflare R2, Vercel Blob e fallback automático zero-custo para PostgreSQL Base64 com custódia `physicalScanSha256` e proxy autenticado anti-IDOR ([`GET /api/atas/[id]/physical-scan`](src/app/api/atas/[id]/physical-scan/route.ts)).
- **Guia de Alta Escala**: Diretrizes completas de transição da Escola Piloto para redes de centenas de escolas documentadas em [`docs/GUIA_ESCALABILIDADE.md`](docs/GUIA_ESCALABILIDADE.md).
- Suíte automatizada consolidada em **232 testes em 40 suítes Vitest (100% verdes)** e 0 erros de compilação Turbopack.

### Fase 6: Desacoplamento de Scrapers & Duas Edições no Paraná (Novembro/2026)
- **`JUR-09`**: Arquitetura de Duas Edições da Plataforma no Paraná ([`src/lib/platformEditions.ts`](src/lib/platformEditions.ts)):
  1. `PILOTO_INTEGRADA`: Recursos completos SEED-PR (Power BI, SERP Celepar, tokens de extensão);
  2. `INSTITUCIONAL_ESSENCIAL`: Foco juridicamente viável para SEMECs municipais (Busca Ativa WhatsApp, Livro de Atas Lei nº 14.063/2020 e Faltas via CSV/SERE), ocultando scrapers governamentais.
- **`JUR-10`**: Herança de Governança Multi-Tenant: Superadmin define a versão no cadastro da SEMEC (`EducationNetwork`); quando gestores municipais (`GESTAO_SECRETARIA`) adicionam escolas, elas herdam automaticamente a versão definida pelo Superadmin.
- **`JUR-11`**: Blindagem de Defesa em Profundidade: `/api/frequencia/sync` e `/api/serp/sync` retornam expressamente `403 Forbidden` quando a escola de destino estiver na edição `INSTITUCIONAL_ESSENCIAL`.
- **`JUR-12`**: Interface Adaptativa: painel de `/faltas`, `/alunos/[id]` (Prontuário) e `/alunos/[id]/dossie` adaptam dinamicamente botões e termos textuais.

### Fase 7: Auditoria de Segurança, Estabilidade V3 & Hardening Pré-Expansão (Novembro/2026)
- **`SEC-09`**: Comparação Criptográfica em Tempo Constante (`safeCompareStrings` via `crypto.timingSafeEqual` sobre digests SHA-256 uniformes) eliminando timing attacks nos webhooks WhatsApp e cron semanal.
- **`SEC-10`**: Contenção Absoluta de Vazamento de Exceções (`H-11`): sanitizadas 100% das respostas HTTP 500 em todos os Route Handlers sob `src/app/api/**`, e resolução dinâmica de `BOOTSTRAP_ADMIN_EMAIL` (`H-10`) via `process.env.ADMIN_EMAIL`.
- **`DATA-01`**: Proteção Cadastral contra Sobrescrita de Homônimos SERE (`Q-01`): desambiguação estrita exigindo CGM em `studentMatcher.ts`, clamp matemático de percentuais (`Q-02`) e blindagem de dispensas manuais no sync de amparos (`Q-03`).
- **`MSG-01`**: Atomicidade Probatória na Mensageria (`P-07` / `P-08`): persistência do `MessageLog` com hash SHA-256 no PostgreSQL prévia ao acionamento do gateway externo e validação Zod estrita de status inicial.
- **`PERF-06`**: Otimização do Schema Prisma (`D-04`): remoção de 3 diretivas `@@index` redundantes sobre campos já `@unique`.

### Fase 8: Fluxo Assistido de Retorno do WhatsApp Web & Selagem Probatória Bipartida (Novembro/2026)
- **`AUT-05`**: Criptografia Canônica Bipartida de Retorno (`messageCrypto.ts` & `POST /api/messages/reply`): expansão de `computeMessageContentHash` com regra bipartida (7 chaves no despacho + 4 chaves condicionais quando `guardianReplied === true`), blindagem contra IDOR (`assertTenantOwnership`), atualização transacional para status `READ` e auditoria com `schoolId` raiz.
- **`AUT-06`**: Extração Assistida Read-Only no WhatsApp Web via Extensão MV3 (`whatsapp-content.js` & `clientDispatcher.ts`): captura do último balão de mensagem recebida (`div.message-in`) sem simular digitação, despachando metadados forenses com timeout defensivo de 8s e checagem de origem autorizada.
- **`AUT-07`**: Modal Human-in-the-Loop de Revisão, Triagem IA e Selagem SHA-256 (`WhatsAppReplyCaptureModal.tsx`): esteira guiada com tema escuro nativo, triagem por IA Google Gemini com pseudonimizador LGPD/ECA e fallback heurístico, reatividade instantânea no Prontuário 360º e no Histórico.
- Suíte automatizada consolidada em **50 suítes / 330 testes Vitest (100% verdes)** e 0 erros de compilação Turbopack.

---

## 🛡️ 2. As 7 Regras de Ouro Inegociáveis

Qualquer assistente de IA ou desenvolvedor deve respeitar rigorosamente estas regras:

### Regra 1: A Escola Piloto Leopoldina é Inviolável & Tolerância a Legados Restrita à Sede
- O **Colégio Estadual Leopoldina B. Pedroso** (INEP `41042730`) é a semente fundadora do sistema e contém 689 alunos reais.
- **NUNCA** execute comandos ou crie rotinas que apaguem, redefinam ou sobreponham dados do Leopoldina.
- O backend rejeita requisições destrutivas com `403 Forbidden` (`target.inepCode === "41042730"`). Não contorne essa proteção.
- **Tolerância a Dados Legados Restrita à Sede:** Qualquer filtro de retrocompatibilidade com registros legados (`schoolId: null` ou `"default-leopoldina"`) **DEVE** ser estritamente condicionado à comprovação de que a sessão ativa pertence à Escola Piloto Fundadora (`inepCode === "41042730"`). Nunca inclua `schoolId: null` ou `"default-leopoldina"` em cláusulas `OR` para outras escolas nem execute *auto-healing* de `schoolId` a partir de sessões externas.

### Regra 2: Isolamento Multi-Tenant Estrito (Sem IDOR / BOLA)
- Toda consulta e mutação a entidades filhas (`Student`, `ClassGroup`, `PedagogicalMinute`, `MessageLog`, `AbsenceJustification`, `StudentContact`, etc.) **deve filtrar obrigatoriamente por `schoolId`**:
  ```typescript
  // CORRETO
  const students = await prisma.student.findMany({
    where: { schoolId, active: true },
  });
  ```
- **Validação de Cookie de Contexto (`active_school_id`):** Em [`getCurrentSchool()`](file:///home/marcoswrobel/Documents/Registro/src/lib/currentSchool.ts), nunca confie no cookie `active_school_id` sem validar se o usuário autenticado na sessão possui vínculo ativo com aquela escola (`session.user.schools` / `schoolId`) ou privilégio global (`SUPERADMIN` / `GESTAO_SECRETARIA` autorizado). Nunca confie em `schoolId` vindo do corpo da requisição (*parameter spoofing*): o tenant efetivo sempre deriva da sessão validada.
- **Integridade de FKs em Criação E Atualização (`POST`, `PUT`, `PATCH`, `/finalize`):** Sempre valide que chaves estrangeiras referenciadas em arrays ou campos (`studentIds`, `classGroupId`, `templateId`) pertençam estritamente ao mesmo `schoolId` do recurso/sessão (conferindo `matched.length === requestedIds.length`), inclusive em edições de rascunho e finalizações de atas.
- **Rejeição Explícita de Parâmetros Restritos (RBAC):** Quando um payload contiver flags ou operações restritas a papéis superiores (ex.: `updateSchoolInfo: true` para não-`SUPERADMIN`), retorne explicitamente **`403 Forbidden`** — nunca ignore silenciosamente retornando `200 OK`.
- **Auditoria com `schoolId` Raiz Obrigatório & Exportação CSV Segura:** Toda chamada [`logAudit(...)`](file:///home/marcoswrobel/Documents/Registro/src/lib/audit.ts) em contexto escolar **DEVE** receber `schoolId` na raiz do objeto (nunca apenas dentro de `details`), e consultas em `/auditoria` nunca devem expor `{ schoolId: null }` entre tenants. Em exportações CSV, todas as colunas textuais devem aplicar [`sanitizeCsvField(...)`](file:///home/marcoswrobel/Documents/Registro/src/lib/csvSanitizer.ts) combinado ao escape RFC 4180 (`.replace(/"/g, '""')`).
- Em mutações por ID (`/api/students/[id]`, `/api/atas/[id]`), valide se o registro pertence à escola do usuário antes de atualizar ou excluir ([`assertTenantOwnership`](file:///home/marcoswrobel/Documents/Registro/src/lib/tenantGuard.ts)).

### Regra 3: Fé Pública e Imutabilidade das Atas
- Atas no status `FINALIZED` **nunca sofrem edição de texto in loco**.
- A lavratura oficial (`/api/atas/[id]/finalize`) exige validação do PIN de Fé Pública do servidor e justificativa expressa (`extemporaneousReason`) quando o atendimento ocorreu há mais de 5 dias úteis.
- Retificações devem ser feitas via Termo Aditivo (`/api/atas/[id]/addendums`) com *hash-chaining*.
- Cancelamentos devem manter o registro histórico marcado como `VOIDED` (`/api/atas/[id]/void`), exigindo justificativa expressa (`voidReason`).
- A exclusão física de atas é restrita ao papel `SUPERADMIN` / administradores gerais e exclusiva para minutas de teste.

### Regra 4: Conformidade Estrita com LGPD e ECA
- Dados identificáveis de menores (nome, CGM, telefone) **nunca** podem ser enviados diretamente para a API do Google Gemini. Passe sempre pelo [`src/lib/aiPseudonymizer.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/aiPseudonymizer.ts).
- No validador público (`/validar/ata/[code]`), exponha apenas metadados e nomes mascarados (`maskName`, `maskDocument`, `maskEmail`).
- No Dossiê em PDF (`/alunos/[id]/dossie`), aplique anonimização automática por iniciais a outros menores citados em atas coletivas.

### Regra 5: Arquitetura Híbrida (Server vs. Client Components) e Escopo do Proxy
- Mantenha o padrão de pares:
  - `page.tsx`: Server Component para resolver sessão, escola ativa e buscar dados iniciais sem waterfall.
  - `*Client.tsx`: Client Component (`"use client"`) para gerenciar estados, modais, filtros e chamadas `fetch`.
- **Atenção ao Escopo do Middleware ([`src/proxy.ts`](file:///home/marcoswrobel/Documents/Registro/src/proxy.ts)):** O middleware valida apenas autenticação ativa, **não** posse de tenant sobre parâmetros dinâmicos `[id]` ou `[ano]`. Todo Server Component (`page.tsx`, rotas de impressão `/imprimir`, dossiês e livros anuais) **DEVE** validar `auth()` e `assertTenantOwnership(...)` antes de renderizar dados ou executar escritas de *auto-healing*.
- Não importe Prisma Client dentro de Client Components.

### Regra 6: Portão de Qualidade: Testes e Build Verificados
- Antes de concluir qualquer tarefa ou gerar commit:
  1. Execute `npm test` — **100% da suíte Vitest deve passar (250+ testes em 42+ suítes, incluindo `adversarialQa.test.ts` e `platformEditions.test.ts`)**.
  2. Execute `npm run build` — **o TypeScript e o Turbopack devem compilar com 0 erros**.
- Se criar uma nova funcionalidade de negócio ou segurança, adicione os testes correspondentes em `src/lib/__tests__/` ou `src/app/api/__tests__/`.

### Regra 7: Modo de Desenvolvimento Local (`ENABLE_DEV_AUTH` na porta `3001`)
- O servidor local roda na porta **`3001`** (`npm run dev` executa `next dev -p 3001`).
- Para rodar localmente sem credenciais Google OAuth, configure no `.env.local`:
  ```bash
  NEXTAUTH_URL="http://localhost:3001"
  ENABLE_DEV_AUTH="true"
  NODE_ENV="development"
  ```
- O provider `"escola-dev-auth"` em [`src/lib/auth.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/auth.ts) permite login imediato com e-mails `@escola.pr.gov.br` pré-cadastrados, bloqueado automaticamente em produção (`NODE_ENV === "production"`).

### Regra 8: Duas Versões da Plataforma no Paraná & Herança de Governança
- A plataforma opera sob duas edições oficiais no Paraná ([`src/lib/platformEditions.ts`](src/lib/platformEditions.ts)):
  1. **`PILOTO_INTEGRADA`**: Recursos completos SEED-PR (Power BI, SERP Celepar, tokens de extensão);
  2. **`INSTITUCIONAL_ESSENCIAL`**: Versão padrão para novas escolas e SEMECs focada naquilo que é juridicamente viável e autônomo (Busca Ativa WhatsApp via `wa.me` ou companion, Livro Oficial de Atas sob a Lei nº 14.063/2020, Gestão de Faltas via CSV/SERE e Dossiê ECA), ocultando botões e menções a scrapers governamentais.
- **Inviolabilidade da Escola Piloto:** O INEP `41042730` e o id `default-leopoldina` operam permanentemente em `PILOTO_INTEGRADA`. Tentativas de alteração via `PUT /api/schools/[id]` retornam expressamente `403 Forbidden`.
- **Herança de Políticas (Superadmin ➔ SEMEC ➔ Escolas):**
  - O `SUPERADMIN` define a versão no cadastro da SEMEC (`EducationNetwork`) ou de escolas individuais no painel `/admin/escolas`.
  - Quando os gestores da SEMEC (`GESTAO_SECRETARIA`) cadastram novas escolas municipais vinculadas à sua rede, as escolas **herdam automaticamente** a versão definida pelo Superadmin para aquela SEMEC.
- **Blindagem Dupla de Backend:** As rotas `POST /api/frequencia/sync` e `POST /api/serp/sync` avaliam a versão do tenant de destino (`currentSchool.edition`) e rejeitam qualquer tentativa de raspagem com `403 Forbidden` quando o tenant estiver configurado na edição `INSTITUCIONAL_ESSENCIAL`.

---

## 🏛️ 3. Governança e Hierarquia de Acesso (RBAC)

| Nível | Role Prisma | Descrição | Rota Principal |
| :---: | :--- | :--- | :---: |
| **1** | `SUPERADMIN` | Gestão Global do SaaS, diretório de escolas e redes, auditoria unificada. | `/admin` |
| **2** | `GESTAO_SECRETARIA` | Secretários(as) Municipais de Educação (SEMEC) com visão consolidada da rede. | `/secretaria` |
| **3** | `GESTOR_ESCOLAR` | Direção da escola ativa, gestão da equipe local (`/equipe`), turmas e token. | `/gestao` |
| **4** | `PEDAGOGA` | Equipe pedagógica local: busca ativa WhatsApp, faltas, prontuário e atas. | `/busca-ativa` |

*(Nota: O papel legado `"ADMIN"` permanece suportado em [`src/lib/roles.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/roles.ts) por retrocompatibilidade).*

---

## 📁 4. Estrutura do Repositório

```text
├── src/
│   ├── app/                        # 27 Páginas SSR + 44 Route Handlers (Next.js 16 App Router)
│   │   ├── admin/                  # Painel Super Admin (/admin) e Diretório (/admin/escolas)
│   │   ├── secretaria/             # Painel Executivo Municipal SEMEC e análise preditiva
│   │   ├── gestao/                 # Painel da Direção Escolar
│   │   ├── visao-geral/            # Resumo operacional da unidade
│   │   ├── onboarding/             # Wizard de adesão em 4 etapas para novas escolas/redes
│   │   ├── busca-ativa/            # Fila inteligente de disparos WhatsApp
│   │   ├── atas/                   # Livro Oficial Digital de Atas, Impressão A4 e Livro Anual
│   │   ├── encaminhamentos/        # Gestão de prazos e alertas de combinados das atas
│   │   ├── alunos/                 # Base cadastral, Importação SERE, Prontuário 360º e Dossiê
│   │   ├── faltas/                 # Monitoramento de infrequência, SERP e queda abrupta
│   │   ├── atestados/              # Gestão de atestados médicos e dispensas legais
│   │   ├── boletim/                # Boletim executivo semanal de infrequência
│   │   ├── equipe/                 # Allowlist e controle de servidores autorizados da escola
│   │   ├── configuracoes/escola/   # Identidade visual, brasão oficial e token de sync
│   │   ├── historico/              # Linha do tempo paginada com hash SHA-256 e triagem IA
│   │   ├── modelos/                # Biblioteca de comunicados institucionais
│   │   ├── relatorios/             # Indicadores analíticos consolidados
│   │   ├── auditoria/              # Trilha de auditoria imutável escopada por escola
│   │   ├── validar/ata/[code]/     # Portal público LGPD de validação cega de atas
│   │   ├── assinar/ata/[token]/    # Portal móvel de assinatura com biometria e traço vetorial
│   │   └── api/                    # 44 Route Handlers REST serverless
│   ├── components/                 # Componentes React reutilizáveis
│   │   ├── ata/                    # Editor widescreen, PIN modal, scan físico, canvas forense
│   │   └── whatsapp/               # Alternador de Janela Dedicada Compacta
│   ├── lib/                        # Regras de negócio, segurança, criptografia e integrações
│   │   ├── auth.ts / auth.config.ts# Configuração NextAuth v5 (Edge + Prisma)
│   │   ├── roles.ts / permissions.ts# Hierarquia RBAC 4-Tier e guardas de rota
│   │   ├── currentSchool.ts        # Resolvedor contextual multi-tenant anti-spoofing
│   │   ├── tenantGuard.ts          # Guarda atômica assertTenantOwnership (REST e SSR)
│   │   ├── ataCrypto.ts            # Motor canônico SHA-256, hash-chaining e máscaras ECA
│   │   ├── signingPin.ts           # Criptografia PBKDF2-SHA512 e lockout do PIN do servidor
│   │   ├── messageCrypto.ts        # Selagem SHA-256 de comunicações e Dossiê Pericial
│   │   ├── aiPseudonymizer.ts      # Anonimizador LGPD/ECA pré-chamada ao Gemini
│   │   ├── csvSanitizer.ts         # Proteção contra CSV Formula Injection (CWE-1236)
│   │   ├── sereParser.ts           # Parser multiformato (.xls BIFF8, .xlsx, .pdf, .csv)
│   │   ├── predictiveAnalytics.ts  # Motor preditivo de risco de evasão para SEMEC
│   │   ├── actionClassifier.ts     # Classificador temático e alertas de encaminhamentos
│   │   ├── whatsappProvider.ts     # Formatação e chaveamento mobile/desktop do WhatsApp
│   │   ├── audit.ts                # Registrador de auditoria com IP e schoolId raiz
│   │   ├── prisma.ts               # Instância singleton do Prisma Client
│   │   └── __tests__/              # Suítes unitárias, SSR e regressão multi-tenant (Vitest)
│   └── proxy.ts                    # Middleware de borda (Next.js 16 Proxy)
├── prisma/
│   └── schema.prisma               # Schema declarativo multi-tenant PostgreSQL (21 models)
├── extension/                      # Extensão Chrome MV3 (v1.5.0) — Power BI, SERP e WhatsApp
├── scripts/                        # Scripts ativos (package_extension.cjs, vercel_db_push.cjs, seed.cjs)
│   └── legacy/                     # Utilitários históricos arquivados
└── docs/                           # Documentação canônica (ARQUITETURA_E_ENGENHARIA, BACKLOG, DEPLOY, GUIA_COLABORACAO)
    └── auditorias/                 # Relatórios históricos point-in-time de auditoria
```

---

## 🛠️ 5. Comandos Essenciais

```bash
# Instalação de dependências
npm install

# Gerar o client do Prisma após alterações no schema
npx prisma generate

# Executar suíte completa de testes (Vitest — 50 suítes / 330 testes)
npm test

# Executar compilação completa de produção (Extensão + Schema Check + Turbopack)
npm run build

# Iniciar servidor local de desenvolvimento (http://localhost:3001)
npm run dev

# Sincronizar schema Prisma com o banco de desenvolvimento
npx prisma db push

# Popular carga inicial de homologação (Escola Piloto)
npm run seed
```

---

## ⚠️ 6. Armadilhas Conhecidas e Boas Práticas (Gotchas)

1. **Fusos Horários:** O servidor opera em UTC, mas a escola e os atos jurídicos operam no horário de Brasília (`America/Sao_Paulo`, UTC-3). Em formatações de data por extenso de atas, cálculo de dias úteis de lavratura extemporânea e vigência de atestados, utilize sempre utilitários com fuso explícito (`-03:00`).
2. **Turbopack e Scripts de Build:** O `npm run build` executa automaticamente `scripts/package_extension.cjs` (gerando `public/extensao-leopoldina.zip`) e `scripts/vercel_db_push.cjs`. Nunca edite manualmente o `.zip` gerado em `public/`.
3. **Papéis no Prisma:** Campos de papel no banco utilizam strings compatíveis (`SUPERADMIN`, `ADMIN`, `GESTAO_SECRETARIA`, `GESTOR_ESCOLAR`, `PEDAGOGA`). Sempre utilize os helpers de [`src/lib/roles.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/roles.ts) e [`src/lib/permissions.ts`](file:///home/marcoswrobel/Documents/Registro/src/lib/permissions.ts) para checagens de privilégio.
4. **Transações em Mutações Complexas:** Em operações como lavratura de atas, adendos encadeados, exclusão de escolas ou higienização, use sempre `prisma.$transaction(async (tx) => { ... })` para garantir atomicidade total e prevenir orfandade de registros.
