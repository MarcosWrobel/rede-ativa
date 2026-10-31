# Sistema de Busca Ativa, Comunicação Escolar & Livro de Atas Digital
**Colégio Estadual Leopoldina B. Pedroso — Ponta Grossa / Paraná**

Aplicação web institucional para gestão de busca ativa escolar, comunicação ágil e acolhedora com famílias via WhatsApp (`wa.me`), monitoramento de infrequência em tempo real, importação cadastral oficial SERE (`.xls` / `.pdf`), controle de atestados médicos, **Livro Oficial de Atas Pedagógicas Digital** com validade jurídica (Lei nº 14.063/2020, Hash `SHA-256` e Biometria Móvel WebAuthn), emissão de dossiês individuais (Conselho Tutelar / SERP) e triagem/redação assistida com Inteligência Artificial.

---

## 🚀 Tecnologias

- **Frontend & Backend**: Next.js 16 (App Router + Turbopack), React 19, TypeScript
- **PWA Mobile**: Instalável nativamente no smartphone com Service Worker (`sw.js`), suporte offline e ícones maskable
- **Estilização**: Tailwind CSS v4, Lucide Icons, Modern Web Guidance (Dialogs widescreen acessíveis, Checkboxes `:indeterminate`, Progress bars nativas)
- **Banco de Dados**: Neon PostgreSQL (Serverless na AWS São Paulo - `sa-east-1`) + Prisma ORM 6 com suporte multi-escola (`School`)
- **Autenticação, Fé Pública & Segurança**: NextAuth.js v5 (Google OAuth `@escola.pr.gov.br`), Proxy Middleware global (`proxy.ts`), Allowlist de equipe (`/equipe`), integridade criptográfica `SHA-256`, biometria local **WebAuthn / FIDO2 (Passkeys)** e trilha de auditoria completa com IP
- **Importação Oficial SERE/SEED-PR**: Leitura nativa multiformato com `xlsx` (planilhas `.xls` BIFF8 / `.xlsx`), `unpdf` (relatórios `.pdf`) e parser `.csv` (`UTF-8` / `Windows-1252`)
- **Rotinas Automatizadas**: Vercel Cron semanal (`/api/cron/weekly-digest`) para diagnóstico executivo e fila de intervenção às segundas-feiras
- **Inteligência Artificial**: Google Gemini API (`@google/genai` 2026) — Redação de comunicados, formalização de atas com rigor gramatical NRE/SEED-PR, fuso horário oficial `America/Sao_Paulo`, thinking tokens otimizados (`thinkingLevel: "low"`) e classificação de retornos com JSON estruturado
- **Automação de Mensageria**: Fluxo operacional gratuito e ilimitado via WhatsApp Web (`wa.me`) com reuso de guia única (`leopoldina_whatsapp_dispatch`) e camada plugável para gateways futuros
- **Extensão Chrome**: Manifest V3 para extração segura de dados do Power BI estadual e do portal SERP/Celepar
- **Testes & Qualidade**: Vitest com **52 testes unitários automatizados** em 9 suítes cobrindo criptografia/anonimização de atas, assinaturas `@escola.pr.gov.br`, diretrizes NRE com IA, parser SERE (`.xls`/`.pdf`/`.csv`), classificadores pedagógicos, pareamento, schemas Zod e multi-escola

---

## 📋 Módulos Principais

| Módulo | Rota | Descrição |
| :--- | :--- | :--- |
| **Busca Ativa** | `/busca-ativa` | Disparo individual ou **Fila Guiada por Turma** via `wa.me`, salto automático de atestados médicos, múltiplos contatos familiares e confirmação de entrega com saneamento de números. |
| **Livro de Atas Digital** | `/atas` | Substituição jurídica do caderno manuscrito: numeração sequencial anual imutável, editor bimodal widescreen, ditado por voz + IA Gemini 2026, assinatura digital institucional `@escola.pr.gov.br` em 1 clique, assinatura em tela ou **QR Code Móvel com Biometria**, adendos *"Em tempo"*, PDF A4 em folha única (`1 of 1`) com brasão oficial e Livro Anual (`/atas/livro/[ano]`). |
| **Validação & Assinatura** | `/validar/ata/[code]`<br>`/assinar/ata/[token]` | Portal público LGPD-safe para conferência de autenticidade (`SHA-256`) via QR Code e página móvel temporária para assinatura com biometria do celular dos responsáveis. |
| **Boletim Semanal** | `/boletim` | Diagnóstico semanal automatizado (Vercel Cron) com alertas de alunos críticos sem busca recente, casos SERP, taxa de retorno dos pais e exportação A4 para reuniões pedagógicas. |
| **Prontuário 360º** | `/alunos/[id]` | Visão integral do aluno: indicadores do B.I., múltiplos contatos, controle de atestados médicos vigentes, atas oficiais do Livro Digital e linha do tempo de WhatsApp. |
| **Dossiê Oficial PDF** | `/alunos/[id]/dossie` | Emissão em 1 clique de relatório A4 auditado para Conselho Tutelar, Ministério Público ou SERP, com anonimização automática de outros menores citados em atas conjuntas (ECA). |
| **Painel de Frequência** | `/faltas` | Monitoramento de infrequência com chips de risco, alerta de **📉 Queda Abrupta**, drawer lateral de envio sem perda de contexto e atalho para fila da turma. |
| **Alunos & Importação SERE** | `/alunos` | Base de estudantes com CGM, turma, contatos, filtros rápidos e **Importador em Lote SERE/SEED-PR** para arquivos `.xls`, `.xlsx`, `.pdf` e `.csv`. |
| **Modelos de Mensagem** | `/modelos` | Padronização institucional de comunicados, tags dinâmicas do B.I. e assistente de redação com IA generativa (Google Gemini). |
| **Histórico de Envios** | `/historico` | Linha do tempo paginada no servidor com status de entrega (`deliveryStatus`), registro de retorno dos pais e botão **"✨ Formalizar & Classificar com IA"**. |
| **Gestão de Equipe** | `/equipe` | Controle restrito a administradores para aprovação, atribuição de perfis (`ADMIN` / `PEDAGOGA`) e desativação de usuários institucionais. |
| **Relatórios Gerenciais** | `/relatorios` | Gráficos consolidados por motivo, pedagoga, recorte temporal (trimestres/30 dias), causas de faltas e taxa de números sem WhatsApp. |
| **Auditoria** | `/auditoria` | Trilha de logs imutável com registro de ações, usuário, IP de origem, data/hora e dados modificados. |

---

## 🤖 Inteligência Artificial, Fé Pública & Automação Pedagógica

1. **Lavratura Assistida de Atas Pedagógicas (Voz + Gemini AI + Biometria)**:
   - A equipe pedagógica dita por voz (`pt-BR`) ou anota tópicos rápidos durante o atendimento presencial; o Gemini estrutura a ata completa em norma culta, objetiva e alinhada ao ECA, sugerindo prazos e encaminhamentos.
   - Os presentes assinam diretamente na tela ou apontando a câmera do celular para o **QR Code temporário**, autenticando a autoria com a biometria do próprio aparelho (**WebAuthn / FIDO2**) e selando o documento com hash `SHA-256`.
2. **Redação de Modelos Institucionais**:
   - Transforma solicitações informais das pedagogas em modelos acolhedores e padronizados com saudações automáticas para manhã, tarde ou noite.
3. **Formalização e Classificação de Retornos dos Pais**:
   - Transforma mensagens informais recebidas no WhatsApp em texto administrativo formal e classifica a causa da ausência (🩺 Saúde, 🚌 Transporte/Clima, 💼 Trabalho, 🧳 Viagem, ⚠️ Vulnerabilidade, 📌 Sem Justificativa, 📝 Outros), com *fallback* determinístico local.
4. **Fila Guiada por Turma via `wa.me`**:
   - Disparo assistido sem custos de API externa, reutilizando guia única do navegador e saneando números sem WhatsApp (`FAILED_NO_WHATSAPP`) para proteção jurídica da escola.

---

## 📖 Documentação Detalhada & Roadmap

- 👉 **[Documentação Técnica Completa do Sistema](docs/DOCUMENTACAO_SISTEMA.md)** (Arquitetura, Banco de Dados, Criptografia de Atas, SERE, APIs, Segurança e Manuais)
- 👉 **[Backlog Geral de Evolução & Roadmap](docs/BACKLOG.md)** (Histórico completo dos Épicos 1 a 7 concluídos e próximas evoluções planejadas)
- 👉 **[Guia de Implantação e Deploy](DEPLOY.md)** (Configuração na Vercel, Neon e Google Cloud)
