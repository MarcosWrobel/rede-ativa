# Relatório Técnico de Otimização de Egress, Cache & Custo no Neon PostgreSQL (`PERF-01`)

> [!NOTE]
> **Registro Oficial Point-in-Time (Data-Base: 10/11/2026 — Pós-Sprint 18 / Neon Launch):** Este documento registra o diagnóstico empírico em produção, as alterações permanentes de arquitetura aplicadas (`PERF-01`), o impacto operacional em escalabilidade e usabilidade e o roteiro exato de reversão (*rollback*) para futuras auditorias técnicas do **Rede Ativa SaaS**. Para o estado arquitetural consolidado (SSOT), consulte [`../ARQUITETURA_E_ENGENHARIA.md`](../ARQUITETURA_E_ENGENHARIA.md).

---

## 1. Diagnóstico Empírico & Motivação (`10/11/2026`)

Após a conclusão da Sprint 18 (`94aa7cf`), a cota mensal gratuita do **Neon Free (`5 GB` de *Network Transfer / Egress*)** foi esgotada (`PG ERROR 53000: Your account or project has exceeded the quota`), ocasionando falha de *build* na Vercel (`P1001` em `scripts/vercel_db_push.cjs`) e indisponibilidade temporária em produção.

A inspeção direta das tabelas no banco de produção revelou que o tamanho total armazenado era de apenas **`18 MB`**, porém três padrões estruturais multiplicavam o tráfego de rede e as operações de escrita:

| Fator Identificado em Produção | Evidência Medida no Neon | Efeito Real |
| :--- | :--- | :--- |
| **`School.logoUrl` em Base64 sem *projection*** | **1.138.122 bytes (~1,14 MB)** na Unidade Piloto (SVG Base64) | Trafegado em praticamente todo SSR (`layout.tsx`, `getCurrentSchool()`), revalidação JWT de 5 min (`auth.ts`) e listagens `/api/schools`, `/admin`, `/secretaria` — consumindo megabytes por navegação. |
| **Blobs jurídicos carregados em listagens** | **1.319.988 bytes (~1,32 MB)** em `physicalSignedScanData` (2 atas) + `signatureData` + `biometricStrokeData` | Baixados desnecessariamente no Prontuário 360º (`safePhase3Queries.ts`), em `GET /api/atas` e no Livro Anual (`/atas/livro/[ano]`), mesmo quando o cliente precisava apenas de metadados/flags. |
| **Escritas ociosas em `RateLimitBucket`** | `checkRateLimit` + `resetRateLimit` em toda requisição da extensão | Cada sync legítimo de `/api/frequencia/sync` ou `/api/serp/sync` executava **2 escritas SQL** (`UPSERT` + `DELETE`) mesmo quando não havia nenhuma falha de autenticação. |

---

## 2. Estratégia Permanente vs. Configuração de Fase Inicial

1. **Otimizações Permanentes no Código-Fonte (`PERF-01`):** Todas as mudanças em `src/` seguem padrões definitivos de engenharia SaaS multi-tenant (entrega de ativos binários cacheáveis por CDN, projeções SQL explícitas via `select`, cache em memória de contexto com invalidação explícita e leitura prévia *zero-write* em rate limiting). Elas **não são paliativos de desenvolvimento**: quanto maior a rede municipal (dezenas de escolas com brasões e centenas de atas), mais indispensáveis se tornam.
2. **Parâmetros Específicos da Fase Piloto sem Receita (Console Neon Launch):** Apenas as configurações operacionais de infraestrutura no painel do Neon (`0.25 CU` mínimo, *Scale to Zero* com suspensão em `5 minutes` e uso de *branch* isolada `dev` no `.env` local) são voltadas à economia imediata de computação e podem ser ajustadas a qualquer momento no console sem alterar uma linha de código.

---

## 3. Catálogo Técnico das Alterações Aplicadas

### 3.1. Proxy Binário Cacheado de Brasões (`/api/schools/[id]/logo`)
- **Helpers neutros ([`src/lib/schoolLogo.ts`](../../src/lib/schoolLogo.ts)):** Implementadas `isInlineBase64Logo`, `isProxyLogoPath` e `resolveSchoolLogoProxyUrl`. URLs curtas externas (`<= 512` caracteres, ex.: `/brasao-tibagi.png`) são preservadas intactas; payloads `data:image/*` ou campos omitidos via `select` são convertidos para `/api/schools/${id}/logo?v=${timestamp}`.
- **Route Handler Cacheável ([`src/app/api/schools/[id]/logo/route.ts`](../../src/app/api/schools/[id]/logo/route.ts)):** Decodifica SVG, PNG, JPEG e WebP armazenados em `School.logoUrl` para resposta binária HTTP `200` com `Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400`, `X-Content-Type-Options: nosniff` e CSP estrita (`default-src 'none'; style-src 'unsafe-inline'`) para SVG (ou redirecionamento `307` seguro para URLs externas / `/logo.svg`).
- **Perímetro Edge ([`src/proxy.ts`](../../src/proxy.ts)):** Rota `GET /api/schools/[id]/logo` liberada publicamente para que tags `<img>` e o cache CDN da Vercel operem sem dependência de cookie de sessão.
- **Preservação em Mutação ([`src/app/api/schools/[id]/route.ts`](../../src/app/api/schools/[id]/route.ts)):** `PUT /api/schools/[id]` verifica `!isProxyLogoPath(data.logoUrl)` antes de gravar `logoUrl`, impedindo que edições administrativas via [`AdminEscolasClient.tsx`](../../src/app/admin/escolas/AdminEscolasClient.tsx) sobrescrevam o Base64 original no banco ao enviar de volta o caminho proxy. A tela dedicada [`/configuracoes/escola`](../../src/app/configuracoes/escola/page.tsx) segue selecionando `logoUrl: true` para edição integral.

### 3.2. Cache Multi-Camadas & Omissão Estrita de `logoUrl`
- **[`src/lib/currentSchool.ts`](../../src/lib/currentSchool.ts):** Introduzido `SCHOOL_CONTEXT_SELECT` (omitindo `logoUrl` e `syncTokenHash`), deduplicação por requisição com `React.cache()`, cache TTL *in-memory* de `60s` (`SCHOOL_CACHE_TTL_MS`, desativado automaticamente em `VITEST`/`test`) e helpers de diretório (`getCachedDirectory`, `setCachedDirectory`, `invalidateSchoolCache`).
- **Invalidação Imediata em Mutações:** [`invalidateSchoolCache`](../../src/lib/currentSchool.ts#L102-L110) é acionada em `updateSchoolProfile`, `POST /api/schools`, `PUT/DELETE /api/schools/[id]`, `POST /api/schools/[id]/sanitize` e `POST /api/schools/[id]/sync-token`.
- **Demais Consultas Enxugadas:** Removida a seleção implícita/explícita de `logoUrl` em [`src/lib/auth.ts`](../../src/lib/auth.ts), [`src/app/layout.tsx`](../../src/app/layout.tsx), [`src/app/api/schools/route.ts`](../../src/app/api/schools/route.ts), [`src/app/admin/page.tsx`](../../src/app/admin/page.tsx), [`src/app/admin/escolas/page.tsx`](../../src/app/admin/escolas/page.tsx), [`src/app/secretaria/page.tsx`](../../src/app/secretaria/page.tsx), [`src/app/api/secretaria/metrics/route.ts`](../../src/app/api/secretaria/metrics/route.ts) e [`src/app/atas/[id]/imprimir/page.tsx`](../../src/app/atas/%5Bid%5D/imprimir/page.tsx).

### 3.3. Omissão de Anexos Base64 & Traços Vetoriais em Listagens
- **[`src/lib/safePhase3Queries.ts`](../../src/lib/safePhase3Queries.ts) & [`ProntuarioClient.tsx`](../../src/app/alunos/%5Bid%5D/ProntuarioClient.tsx):** `loadStudent360Bundle` usa `select` explícito omitindo `physicalSignedScanData`, `signatureData` e `biometricStrokeData`, mantendo a flag booleana `hasPhysicalScan` a partir das colunas leves de custódia (`physicalScanStorageKey`, `physicalScanSha256`, `physicalScanUploadedAt`, etc.).
- **[`src/app/api/atas/route.ts`](../../src/app/api/atas/route.ts):** Quando `includeSignatures !== "true"`, a consulta SQL omite `physicalSignedScanData`, `signatureData` e `biometricStrokeData`, preservando `hasScan` e `hasSignature` a partir dos metadados (`signedAt`, `verifiedEmail`, `signatureMode`, `physicalScanSha256`, etc.).
- **[`src/app/atas/livro/[ano]/page.tsx`](../../src/app/atas/livro/%5Bano%5D/page.tsx) & [`src/app/atas/[id]/imprimir/page.tsx`](../../src/app/atas/%5Bid%5D/imprimir/page.tsx):** O Livro Anual omite `physicalSignedScanData`, `signatureData` e `biometricStrokeData`; a página de impressão A4 mantém apenas `signatureData` (necessário para imprimir as assinaturas) e omite `physicalSignedScanData` e `biometricStrokeData`.

### 3.4. Autenticação Zero-Write da Extensão & SSR `/faltas`
- **[`src/lib/extensionSyncAuth.ts`](../../src/lib/extensionSyncAuth.ts):** Helper compartilhado por [`/api/frequencia/sync`](../../src/app/api/frequencia/sync/route.ts) e [`/api/serp/sync`](../../src/app/api/serp/sync/route.ts) que executa apenas leitura leve prévia via [`getRateLimitStatus`](../../src/lib/rateLimit.ts#L255-L270). Somente quando o token falha (`401`) há escrita em `RateLimitBucket` (`checkRateLimit`), e `resetRateLimit` só roda se `rateStatus.count > 0`.
- **[`src/app/faltas/page.tsx`](../../src/app/faltas/page.tsx):** Removida subconsulta redundante `student.messageLogs` em `absenceLogs` (mantida apenas em `lowAttendanceRecord`, única aba que exibe último contato) e aplicado `select` enxuto em `attendanceSnapshot.findMany`.

---

## 4. Impacto Arquitetural, Escalabilidade & Usabilidade

| Aspecto | Avaliação Técnica Factual |
| :--- | :--- |
| **Schema & Dados Históricos** | **Zero alterações em `prisma/schema.prisma`.** Nenhuma migração DDL ou exclusão de colunas foi realizada; todos os brasões, digitalizações (`physicalSignedScanData`) e assinaturas permanecem intactos no banco. |
| **Escalabilidade Multi-Instância** | Permite escalar para dezenas de escolas sem multiplicar egress de brasões ou scans. **Observação de consistência:** o TTL *in-memory* de `60s` em `currentSchool.ts` é por instância serverless; alterações cadastrais da escola podem levar até **60 segundos** para propagar entre lambdas concorrentes já aquecidas (rotação de tokens em `findSchoolBySyncToken` e versionamento de imagem `?v=` continuam imediatos). |
| **Usabilidade & Fluxo Diário** | Redução de payload SSR/API sem perda funcional: imagens usam cache HTTP/CDN, [`PhysicalScanModal`](../../src/components/ata/PhysicalScanModal.tsx) carrega digitalizações via `/api/atas/[id]/physical-scan`, e a impressão A4 exibe assinaturas digitais normalmente. Em `/admin/escolas`, o input de logotipo exibe `/api/schools/<id>/logo?v=...` em vez da string Base64 longa, preservando o arquivo original ao salvar. |
| ***Scale to Zero* (Console Neon)** | Se ativado em `5 minutes` no plano Launch, apenas a primeira requisição após o período de inatividade sofre ~0,5s–1,5s de *cold start* para despertar o compute; requisições subsequentes permanecem rápidas. |

---

## 5. Guia de Referência para Auditoria e Reversão (*Rollback*)

Todas as alterações de código e testes referentes a **`PERF-01`** estão isoladas em **um commit atômico único na branch `main` (sucessor direto de `94aa7cf`)**, sem mudanças de banco de dados.

1. **Reversão Total Atômica (1 comando):**
   ```bash
   # Identifique o hash do commit PERF-01 imediatamente acima de 94aa7cf e reverta com segurança:
   git revert <HASH_DO_COMMIT_PERF_01>
   ```
   A aplicação volta instantaneamente às consultas diretas originais sem necessidade de ajuste em banco de dados ou variáveis de ambiente.

2. **Reversão Seletiva (se desejar ajustar apenas 1 ponto específico no futuro):**
   - **Desativar apenas o cache TTL de `60s` entre instâncias mantendo `React.cache()` e o proxy `/logo`:** basta alterar `SCHOOL_CACHE_TTL_MS` ou `isCacheEnabled()` em [`src/lib/currentSchool.ts`](../../src/lib/currentSchool.ts).
   - **Voltar a retornar `physicalSignedScanData`/`signatureData` em `GET /api/atas`:** utilizar o query param já preservado `?includeSignatures=true` na chamada cliente, sem modificar o backend.

---

## 6. Homologação & Portão de Qualidade (`10/11/2026`)

- **Suíte dedicada criada:** [`src/lib/__tests__/egressAndCacheOptimization.test.ts`](../../src/lib/__tests__/egressAndCacheOptimization.test.ts) (10 testes automatizados validando proxy SVG/PNG, cache/select de `getCurrentSchool`, proteção anti-sobrescrita em `PUT /api/schools/[id]`, omissão de Base64 em `loadStudent360Bundle` e fluxo *zero-write* de `authenticateExtensionSyncToken`).
- **Portão Completo (`npm test`):** **57 suítes / 418 testes aprovados (100% verdes)**.
- **Compilação (`npm run build`):** Extensão MV3 + Next.js 16.4.3 Turbopack + TypeScript 6 estrito compilados com **0 erros** (**21 models Prisma**, **29 páginas SSR**, **50 Route Handlers**).
