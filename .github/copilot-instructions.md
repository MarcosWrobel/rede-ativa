# GitHub Copilot Repository Instructions — Rede Ativa SaaS

Este repositório é o **Rede Ativa SaaS** (antigo Busca Ativa Leopoldina), uma plataforma educacional multi-escola para gestão de busca ativa escolar, comunicação via WhatsApp e Livro Oficial de Atas Pedagógicas Digital com validade jurídica.

## Diretrizes Fundamentais para Sugestões de Código:
- **Fonte de Verdade**: Leia atentamente `AI_CONTEXT.md` na raiz e `docs/ARQUITETURA_E_ENGENHARIA.md`. Servidor local de desenvolvimento opera na porta `3001` (`npm run dev`).
- **Stack**: Next.js 16 (App Router com Turbopack), React 19, TypeScript 6 estrito, Prisma ORM 6, Tailwind CSS v4, Neon PostgreSQL.
- **Multi-Tenancy & Prevenção IDOR**: Toda operação relacional sobre alunos, turmas, faltas e atas DEVE filtrar por `schoolId`. Valide posse institucional com `assertTenantOwnership(...)`. Em `getCurrentSchool()`, o cookie `active_school_id` deve ser checado contra vínculos ativos da sessão.
- **Integridade Institucional de FKs**: Em criação e edição (`POST`, `PUT`, `PATCH`, `/finalize`), garanta que FKs (`studentIds`, `classGroupId`, `templateId`) pertençam estritamente ao mesmo `schoolId` da sessão (`matched.length === requestedIds.length`).
- **Proteção da Sede Piloto**: O Colégio Estadual Leopoldina B. Pedroso (INEP `41042730`) é a escola piloto com 689 alunos reais. É proibido gerar rotinas que excluam ou redefinam essa unidade. Tolerância a registros legados (`schoolId: null` ou `"default-leopoldina"`) é restrita a `inepCode === "41042730"`.
- **Privacidade (LGPD e ECA)**: Ao interagir com APIs de IA (Google Gemini), utilize sempre o pseudonimizador `src/lib/aiPseudonymizer.ts` para proteger dados de estudantes menores de idade.
- **Fé Pública de Atas**: Atas finalizadas são imutáveis. Lavraturas validam o PIN do servidor (`signingPin.ts`) e justificativa extemporânea (> 5 dias úteis). Alterações posteriores devem usar exclusivamente adendos encadeados (`PedagogicalMinuteAddendum`).
- **Arquitetura Server Components & Proxy**: `src/proxy.ts` valida apenas autenticação. Server Components dinâmicos (`/imprimir`, `/livro/[ano]`, `/dossie`) DEVEM validar `auth()` e `assertTenantOwnership(...)` antes de renderizar dados.
- **RBAC & Auditoria**: Flags restritas (como `updateSchoolInfo: true` na importação SERE) devem retornar `403 Forbidden` para papéis não autorizados. Registros de auditoria (`logAudit`) devem sempre incluir `schoolId` na raiz. Exportações CSV devem usar `sanitizeCsvField(...)` e escape RFC 4180.
- **Validação & Portão de Qualidade**: Valide payloads com schemas Zod (`src/lib/schemas.ts`). Antes de concluir tarefas, garanta que todos os testes passem (`npm test` — 364 testes em 52 suítes, incluindo `adversarialQa.test.ts` e `atasArchiveUsability.test.ts`) e o build compile com 0 erros (`npm run build`).
