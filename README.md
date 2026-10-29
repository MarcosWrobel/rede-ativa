# Sistema de Busca Ativa & Comunicação Escolar
**Colégio Estadual Leopoldina B. Pedroso — Paraná**

Aplicação web institucional para gestão de busca ativa escolar, comunicação ágil e acolhedora com famílias via WhatsApp, monitoramento de infrequência e geração assistida de comunicados com Inteligência Artificial.

---

## 🚀 Tecnologias

- **Frontend & Backend**: Next.js 16 (App Router + Turbopack), React 19, TypeScript
- **Estilização**: Tailwind CSS v4, Lucide Icons
- **Banco de Dados**: Neon PostgreSQL (Serverless na AWS São Paulo) + Prisma ORM
- **Autenticação**: NextAuth.js v5 com Google OAuth institucional (`@escola.pr.gov.br`)
- **Inteligência Artificial**: Google Gemini API (`gemini-3.5-flash` via `@google/genai`)
- **Hospedagem**: Vercel

---

## 📋 Módulos Principais

| Módulo | Rota | Descrição |
| :--- | :--- | :--- |
| **Busca Ativa** | `/busca-ativa` | Filtro por turma e aluno, alternador de período (Manhã, Tarde, Noite), prévia em tempo real e abertura direta no WhatsApp. |
| **Modelos de Mensagem** | `/modelos` | Padronização de comunicados, tags dinâmicas (`{saudacao}`, `{aluno}`, etc.) e assistente de redação com IA generativa. |
| **Ranking de Faltas** | `/faltas` | Monitoramento de alunos infrequentes com cálculo automático de avisos de ausência para suporte ao Conselho Tutelar/SERP. |
| **Histórico de Envios** | `/historico` | Linha do tempo dos comunicados expedidos. Administradores podem editar e excluir registros. |
| **Auditoria** | `/auditoria` | Trilha de logs de governança restrita exclusivamente a administradores. |
| **Alunos** | `/alunos` | Base de 688 estudantes com CGM, turma e contato dos responsáveis. |
| **Relatórios** | `/relatorios` | Visão consolidada de contatos por período, segmento e pedagoga. |

---

## 🤖 Assistente de Redação com Inteligência Artificial

O sistema conta com integração nativa com o **Google Gemini 3.5 Flash**:
- Permite que a pedagoga digite uma frase simples (ex.: *"avisar reunião de pais quinta às 18h30"*).
- A IA formata a mensagem institucional completa com saudação adaptada ao período e encerramento formal do colégio.
- Otimizado com `thinkingLevel: "low"` para gerar a resposta em **menos de 2 segundos**.
- Suporte a chave direta no navegador (`localStorage`) para uso imediato sem necessidade de reconfigurar a Vercel.
- Ferramenta de diagnóstico rápido com botão **"Testar Chave"** (`/api/ai/test-key`).

---

## 📖 Documentação Completa

Para a documentação técnica detalhada, diagramas de arquitetura, modelo relacional do banco e rotas de API, consulte:
👉 **[Documentação Técnica do Sistema](docs/DOCUMENTACAO_SISTEMA.md)**
👉 **[Guia de Implantação e Deploy](DEPLOY.md)**
