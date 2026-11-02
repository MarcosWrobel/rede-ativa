# GitHub Copilot Repository Instructions — Rede Ativa SaaS

Este repositório é o **Rede Ativa SaaS** (antigo Busca Ativa Leopoldina), uma plataforma educacional multi-escola para gestão de busca ativa escolar, comunicação via WhatsApp e Livro Oficial de Atas Pedagógicas Digital com validade jurídica.

## Diretrizes Fundamentais para Sugestões de Código:
- **Fonte de Verdade**: Leia atentamente o arquivo `AI_CONTEXT.md` na raiz do projeto.
- **Stack**: Next.js 16 (App Router com Turbopack), React 19, TypeScript estrito, Prisma ORM 6, Tailwind CSS v4, Neon PostgreSQL.
- **Multi-Tenancy**: Toda operação relacional sobre alunos, turmas, faltas e atas DEVE filtrar por `schoolId`. Não gere código que permita acesso cruzado entre instituições escolares.
- **Proteção da Sede Piloto**: O Colégio Estadual Leopoldina B. Pedroso (INEP `41042730`) é a escola piloto com 689 alunos reais. É proibido gerar rotinas que excluam ou redefinam essa unidade.
- **Privacidade (LGPD e ECA)**: Ao interagir com APIs de IA (Google Gemini), utilize sempre o pseudonimizador `src/lib/aiPseudonymizer.ts` para proteger dados de estudantes menores de idade.
- **Fé Pública de Atas**: Atas finalizadas são imutáveis. Alterações devem ser propostas como adendos (`PedagogicalMinuteAddendum`).
- **Arquitetura**: Siga o padrão Server Component (`page.tsx`) para fetching de dados e Client Component (`*Client.tsx`) para interações na UI.
- **Validação**: Valide sempre os payloads com os schemas Zod de `src/lib/schemas.ts`.
