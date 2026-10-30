# Sistema de Busca Ativa & Comunicação Escolar
**Colégio Estadual Leopoldina B. Pedroso — Paraná**

Aplicação web institucional para gestão de busca ativa escolar, comunicação ágil e acolhedora com famílias via WhatsApp (`wa.me`), monitoramento de infrequência em tempo real, controle de atestados médicos, emissão de dossiês individuais (Conselho Tutelar / SERP) e triagem assistida com Inteligência Artificial.

---

## 🚀 Tecnologias

- **Frontend & Backend**: Next.js 16 (App Router + Turbopack), React 19, TypeScript
- **PWA Mobile**: Instalável nativamente no smartphone com Service Worker (`sw.js`), suporte offline e ícones maskable
- **Estilização**: Tailwind CSS v4, Lucide Icons, Modern Web Guidance (Dialogs acessíveis, Checkboxes `:indeterminate`, Progress bars nativas)
- **Banco de Dados**: Neon PostgreSQL (Serverless na AWS São Paulo - `sa-east-1`) + Prisma ORM 6 com suporte multi-escola (`School`)
- **Autenticação & Segurança**: NextAuth.js v5 (Google OAuth `@escola.pr.gov.br`), Proxy Middleware global (`proxy.ts`), Allowlist de equipe (`/equipe`) e trilha de auditoria completa com IP
- **Rotinas Automatizadas**: Vercel Cron semanal (`/api/cron/weekly-digest`) para diagnóstico executivo e fila de intervenção às segundas-feiras
- **Inteligência Artificial**: Google Gemini API (`@google/genai`) — Redação de comunicados e triagem/formalização de retornos com JSON estruturado
- **Automação de Mensageria**: Fluxo operacional gratuito e ilimitado via WhatsApp Web (`wa.me`) com reuso de guia única (`leopoldina_whatsapp_dispatch`) e camada plugável para gateways futuros
- **Extensão Chrome**: Manifest V3 para extração segura de dados do Power BI estadual e do portal SERP/Celepar
- **Testes & Qualidade**: Vitest com 29 testes unitários automatizados cobrindo classificadores pedagógicos, pareamento, schemas Zod e recursos da Fase 5

---

## 📋 Módulos Principais

| Módulo | Rota | Descrição |
| :--- | :--- | :--- |
| **Busca Ativa** | `/busca-ativa` | Disparo individual ou **Fila Guiada por Turma** via `wa.me`, salto automático de atestados médicos, múltiplos contatos familiares e confirmação de entrega com saneamento de números. |
| **Boletim Semanal** | `/boletim` | Diagnóstico semanal automatizado (Vercel Cron) com alertas de alunos críticos sem busca recente, casos SERP, taxa de retorno dos pais e exportação A4 para reuniões pedagógicas. |
| **Prontuário 360º** | `/alunos/[id]` | Visão integral do aluno: indicadores do B.I., múltiplos contatos, controle de atestados médicos vigentes, atas presenciais e linha do tempo de WhatsApp. |
| **Dossiê Oficial PDF** | `/alunos/[id]/dossie` | Emissão em 1 clique de relatório A4 auditado e formatado para envio formal ao Conselho Tutelar, Promotoria da Infância ou SERP. |
| **Painel de Frequência** | `/faltas` | Monitoramento de infrequência com chips de risco, alerta de **📉 Queda Abrupta**, drawer lateral de envio sem perda de contexto e atalho para fila da turma. |
| **Modelos de Mensagem** | `/modelos` | Padronização institucional de comunicados, tags dinâmicas do B.I. e assistente de redação com IA generativa (Google Gemini). |
| **Histórico de Envios** | `/historico` | Linha do tempo paginada no servidor com status de entrega (`deliveryStatus`), registro de retorno dos pais e botão **"✨ Formalizar & Classificar com IA"**. |
| **Gestão de Equipe** | `/equipe` | Controle restrito a administradores para aprovação, atribuição de perfis (`ADMIN` / `PEDAGOGA`) e desativação de usuários institucionais. |
| **Relatórios Gerenciais** | `/relatorios` | Gráficos consolidados por motivo, pedagoga, recorte temporal (trimestres/30 dias), causas de faltas e taxa de números sem WhatsApp. |
| **Auditoria** | `/auditoria` | Trilha de logs imutável com registro de ações, usuário, IP de origem, data/hora e dados modificados. |
| **Alunos** | `/alunos` | Base de estudantes com CGM, turma, contatos e filtros rápidos por atestado e infrequência. |

---

## 🤖 Inteligência Artificial & Automação Pedagógica

1. **Redação de Modelos Institucionais**:
   - Transforma solicitações informais das pedagogas em modelos acolhedores e padronizados com saudações automáticas para manhã, tarde ou noite.
2. **Formalização e Classificação de Retornos dos Pais**:
   - A pedagoga cola a mensagem informal recebida da família no WhatsApp (ex.: *"ele tá com febre desde ontem e foi no postinho"*).
   - O Gemini transforma o relato em texto administrativo formal para ata/dossiê e classifica a causa da ausência:
     - 🩺 **Saúde / Consulta / Atestado**
     - 🚌 **Transporte Escolar / Clima**
     - 💼 **Trabalho / Conflito de Horário**
     - 🧳 **Viagem / Compromisso Familiar**
     - ⚠️ **Vulnerabilidade / Desmotivação**
     - 📌 **Ciente — Sem Justificativa Formal**
     - 📝 **Outros Motivos**
   - Possui *fallback* determinístico inteligente caso a chave de IA não esteja configurada no momento.
3. **Fila Guiada por Turma via `wa.me`**:
   - Disparo assistido para os faltosos da turma sem necessidade de APIs pagas da Meta.
   - Reutiliza a mesma aba do navegador, evitando acúmulo de dezenas de guias abertas.
   - Saneia a base cadastral ao marcar números sem WhatsApp (`FAILED_NO_WHATSAPP`), documentando tentativas frustradas para proteção jurídica da escola.

---

## 📖 Documentação Detalhada

- 👉 **[Documentação Técnica Completa do Sistema](docs/DOCUMENTACAO_SISTEMA.md)** (Arquitetura, Banco, APIs, Segurança e Manuais)
- 👉 **[Guia de Implantação e Deploy](DEPLOY.md)** (Configuração na Vercel, Neon e Google Cloud)
