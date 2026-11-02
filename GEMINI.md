# Diretrizes e Regras de Workspace — Rede Ativa SaaS

Você é o assistente técnico do projeto **Rede Ativa SaaS** (antigo Busca Ativa Leopoldina).
A plataforma é um SaaS educacional multi-escola full-stack construído com **Next.js 16 (App Router + Turbopack)**, **React 19**, **TypeScript estrito**, **Prisma ORM 6**, **Neon PostgreSQL Serverless (AWS sa-east-1)** e **NextAuth v5**.

Siga rigorosamente as diretrizes e regras inegociáveis abaixo em qualquer tarefa neste repositório:

---

## 1. Proteção Inviolável da Escola Piloto Fundadora
- O **Colégio Estadual Leopoldina B. Pedroso** (INEP `41042730`) é a Unidade Piloto Fundadora da plataforma e contém 689 estudantes reais.
- **NUNCA** gere código, scripts ou rotinas que excluam, resetem ou alterem inadvertidamente a escola sede ou seus registros históricos.
- Os endpoints `DELETE /api/schools/[id]` e `POST /api/schools/[id]/sanitize` possuem proteções atômicas contra a exclusão do INEP `41042730`. Nunca contorne ou desative essas proteções.

---

## 2. Isolamento Lógico Multi-Tenant (Prevenção Absoluta contra IDOR)
- Todas as consultas e mutações de dados operacionais (`Student`, `ClassGroup`, `MessageLog`, `PedagogicalMinute`, `AbsenceJustification`, `StudentContact`, etc.) **DEVEM conter o filtro obrigatório por `schoolId`**.
- Nunca realize buscas ou mutações globais que possam cruzar dados entre diferentes instituições escolares ou redes.
- Em rotas de mutação direta por ID (`/api/students/[id]`, `/api/atas/[id]`), valide se o registro pertence à instituição sob controle da sessão do usuário autenticado.

---

## 3. Governança Hierárquica em 4 Camadas (RBAC)
Respeite o modelo de papéis e o isolamento de painéis:
- **`SUPERADMIN`**: Acesso global à infraestrutura SaaS, diretório de redes e escolas via `/admin`.
- **`GESTAO_SECRETARIA`**: Acesso executivo municipal consolidado da rede de ensino via `/secretaria`.
- **`GESTOR_ESCOLAR`**: Gestão da unidade escolar ativa, turmas, equipe local (`/equipe`) e token da extensão via `/gestao`.
- **`PEDAGOGA`**: Operação da rotina pedagógica local de busca ativa, faltas, prontuário e atas via `/busca-ativa`.

---

## 4. Fé Pública & Imutabilidade do Livro de Atas (Lei nº 14.063/2020)
- Atas no status `FINALIZED` **nunca sofrem edição de texto in loco**.
- Retificações ou complementações devem ser lavradas obrigatoriamente através de **Termo Aditivo (*"Em tempo"* - `PedagogicalMinuteAddendum`)** com *hash-chaining* criptográfico.
- Cancelamentos devem manter o registro histórico marcado como `VOIDED` com justificativa legal expressa (`voidReason`), sem apagar a ata.
- Exclusão física atômica de atas é estritamente restrita a administradores gerais e exclusiva para minutas de teste.

---

## 5. Conformidade com LGPD e ECA (Arts. 17 e 143)
- Nomes e informações identificáveis de estudantes menores de idade **nunca** devem ser enviados diretamente a APIs de inteligência artificial externas (Google Gemini). Utilize sempre o pseudonimizador `src/lib/aiPseudonymizer.ts`.
- No portal público de conferência via QR Code (`/validar/ata/[code]`), exiba apenas a Certidão Cega com nomes e documentos mascarados, sem expor o texto da ata ou dados sensíveis.
- No Dossiê Oficial em PDF (`/alunos/[id]/dossie`), aplique anonimização automática por iniciais a outros menores citados em ocorrências conjuntas.

---

## 6. Arquitetura Híbrida de Componentes Next.js 16
- Mantenha o padrão de pares:
  - `page.tsx`: Server Component para resolver sessão, escola ativa e buscar dados iniciais no banco sem waterfall.
  - `*Client.tsx`: Client Component (`"use client"`) para gerenciar estados, modais, formulários interativos e chamadas `fetch`.
- Nunca importe o Prisma Client dentro de Client Components.

---

## 7. Portão de Qualidade Obrigatório
Antes de dar qualquer tarefa como concluída ou commitar:
1. Execute `npm test` — garanta que **todos os testes passem (96+ testes)**.
2. Execute `npm run build` — garanta que o **TypeScript e o Turbopack compilem com zero erros**.
3. Se adicionar novas funcionalidades ou regras de negócio, inclua os testes unitários/integrados correspondentes em `src/lib/__tests__/` ou `src/app/api/__tests__/`.
