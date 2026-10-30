# Documentação Técnica do Sistema de Busca Ativa & Comunicação Escolar
**Colégio Estadual Leopoldina B. Pedroso — Ponta Grossa / Paraná**

---

## 1. Visão Geral

O **Sistema de Busca Ativa & Comunicação Escolar** foi concebido e estruturado especificamente para a realidade operacional do **Colégio Estadual Leopoldina B. Pedroso (Paraná)**. Ele atende às demandas pedagógicas de contato rápido com famílias, combate preventivo ao abandono escolar e integração com os ecossistemas oficiais do estado: o relatório **PRESENTE NA ESCOLA (Power BI)** e o **SERP (Sistema Educacional da Rede de Proteção / Celepar)**.

### Objetivos do Projeto
- Substituir o uso de planilhas manuais descentralizadas por um banco de dados relacional íntegro na nuvem (**Neon PostgreSQL**).
- Reduzir o tempo que a equipe pedagógica gasta redigindo mensagens para responsáveis, padronizando a linguagem institucional.
- Adaptar automaticamente a saudação e o contexto conforme o turno do estudante (Manhã, Tarde ou Noturno).
- Registrar com precisão jurídica e auditoria os contatos efetuados, respaldando a escola perante o Conselho Tutelar e a Rede de Proteção (SERP/FICAI).
- Oferecer assistência de redação pedagógica por Inteligência Artificial generativa (**Google Gemini 3.5 Flash**) com custo R$ 0,00 na cota gratuita do Google AI Studio.
- Prover uma **Extensão Chrome Multissistema (Manifest V3)** para extrair dados oficiais do Power BI e do SERP sem exigir permissões de backend da SEED-PR ou senhas em servidores.

---

## 2. Arquitetura da Solução

```mermaid
flowchart TD
    User([Pedagoga / Administrador]) --> Browser[Navegador Chrome]
    
    subgraph ClientSide [Navegador & Extensão Chrome]
        Browser --> NextApp[Next.js 16 App Router na Vercel]
        ExtLeopoldina["Extensão Leopoldina Sync (Manifest V3)"] -.->|Auto-scroll / DOM Extração| PowerBI["Power BI SEED-PR (Presente na Escola)"]
        ExtLeopoldina -.->|Main World Bridge paginar()| SERPPortal["SERP / Rede de Proteção (Celepar)"]
    end

    subgraph AuthLayer [Camada de Segurança]
        NextApp --> NextAuth[NextAuth.js v5]
        NextAuth --> GoogleOAuth[Google OAuth @escola.pr.gov.br]
        NextAuth --> RBAC{Controle de Papéis}
        RBAC -->|ADMIN| AdminPrivileges[Edição de Histórico + /auditoria]
        RBAC -->|PEDAGOGA| UserPrivileges[Visualização + Busca Ativa + Faltas + Modelos]
    end

    subgraph BusinessLayer [Módulos da Aplicação]
        NextApp --> BuscaAtiva[/busca-ativa - Disparo WhatsApp]
        NextApp --> Faltas[/faltas - Painel de Risco e SERP]
        NextApp --> Modelos[/modelos - Editor Bi-Coluna & IA]
        NextApp --> Historico[/historico - Controle de Retornos]
        NextApp --> Relatorios[/relatorios - Gráficos e Exportação]
        NextApp --> Auditoria[/auditoria - Trilha de Conformidade]
        NextApp --> Alunos[/alunos - Gestão Cadastral]
    end

    subgraph DataAndAI [Persistência e Inteligência]
        NextApp --> Prisma[Prisma ORM Client]
        Prisma --> NeonDB[(Neon PostgreSQL Serverless - AWS SP)]
        Modelos --> GeminiAPI[Google Gemini 3.5 Flash API]
        ExtLeopoldina -->|POST Seguro com Bearer Token| SyncFreq["/api/frequencia/sync"]
        ExtLeopoldina -->|POST Seguro com Bearer Token| SyncSerp["/api/serp/sync"]
        SyncFreq --> Prisma
        SyncSerp --> Prisma
    end

    subgraph ExternalDelivery [Disparo ao Destinatário]
        BuscaAtiva --> WhatsAppLink[API WhatsApp wa.me / Desktop]
        WhatsAppLink --> Pais[Pais / Responsáveis Legais]
    end
```

---

## 3. Modelo de Dados Relacional Atualizado (Prisma / PostgreSQL)

O banco de dados relacional está hospedado no **Neon PostgreSQL Serverless (AWS São Paulo - `sa-east-1`)**, otimizado com índices e relacionamentos em cascata:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id          String       @id @default(cuid())
  name        String
  email       String       @unique
  image       String?
  role        String       @default("PEDAGOGA") // ADMIN | PEDAGOGA
  active      Boolean      @default(true)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  messageLogs MessageLog[] @relation("SentByUser")
  repliedLogs MessageLog[] @relation("RepliedByUser")
  auditLogs   AuditLog[]
}

model ClassGroup {
  id        String    @id @default(cuid())
  name      String    @unique // Ex: "6º 1", "9º 2", "1º ADM", "2º Série 3"
  segment   String    // FUNDAMENTAL | MEDIO | NOTURNO
  shift     String    @default("MANHA") // MANHA | TARDE | NOITE
  createdAt DateTime  @default(now())

  students  Student[]
}

model Student {
  id                   String                @id @default(cuid())
  cgm                  String?               @unique // Cadastro Geral de Matrícula oficial SEED-PR (10 dígitos)
  name                 String
  guardianName         String?
  phone                String                // Ex: "42988189394"
  classGroupId         String
  classGroup           ClassGroup            @relation(fields: [classGroupId], references: [id], onDelete: Cascade)
  active               Boolean               @default(true)
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt

  messageLogs          MessageLog[]
  lowAttendanceRecord  LowAttendanceRecord?
}

model MessageTemplate {
  id               String       @id @default(cuid())
  title            String       // Ex: "ALUNO FALTOU", "CONVOCAÇÃO URGENTE"
  segment          String       @default("TODOS") // TODOS | FUNDAMENTAL | MEDIO | NOTURNO
  prefixText       String       // Texto antes da identificação do estudante
  suffixText       String       // Texto pós identificação do estudante
  isAbsenceRelated Boolean      @default(false)   // Alimenta índice e ranking de faltas
  active           Boolean      @default(true)
  createdAt        DateTime     @default(now())

  messageLogs      MessageLog[]
}

model MessageLog {
  id              String           @id @default(cuid())
  studentId       String
  student         Student          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  templateId      String?
  template        MessageTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  reasonTitle     String
  messageContent  String
  phoneUsed       String
  sentByUserId    String?
  sentByUser      User?            @relation("SentByUser", fields: [sentByUserId], references: [id], onDelete: SetNull)
  sentByName      String           // Snapshot auditado do nome da pedagoga
  guardianReplied Boolean          @default(false)
  replyNotes      String?          // Justificativa apresentada pelo responsável
  repliedAt       DateTime?
  repliedByUserId String?
  repliedByUser   User?            @relation("RepliedByUser", fields: [repliedByUserId], references: [id], onDelete: SetNull)
  sentAt          DateTime         @default(now())
}

model LowAttendanceRecord {
  id                String    @id @default(cuid())
  studentId         String    @unique
  student           Student   @relation(fields: [studentId], references: [id], onDelete: Cascade)
  attendancePercent Float     // Percentual consolidado (ex: 74.20)
  enrollmentDetail  String?   // Detalhes semanais (ex: "Semana Atual: 50,00% | Semana Anterior: 88,00%")
  actionsTaken      String?   // Resumo de encaminhamentos
  serpProtocol      String?   // Número oficial da Ficha SERP/FICAI
  serpStatus        String?   // "CONSELHO_TUTELAR" | "EM_ACOMPANHAMENTO" | "MINISTERIO_PUBLICO" | "ARQUIVADO"
  serpOpenedAt      DateTime? // Data de instauração no SERP
  serpDetails       String?   // Histórico completo de buscas no SERP
  updatedAt         DateTime  @updatedAt
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  userEmail  String
  userName   String
  action     String   // SEND_MESSAGE | CREATE_STUDENT | UPDATE_STUDENT | DELETE_STUDENT | MARK_REPLY | UPDATE_LOW_ATTENDANCE | LOGIN
  entityType String   // Student | MessageLog | MessageTemplate | LowAttendanceRecord | SerpSync
  entityId   String?
  details    String?  // JSON estruturado com os dados da operação
  ipAddress  String?
  createdAt  DateTime @default(now())
}
```

---

## 4. Integrações Oficiais & Scraping Autenticado

### 4.1. Extensão Chrome Leopoldina Sync (`extension/`)
Como o Power BI estadual bloqueia exportação direta para `.CSV` e o portal SERP é protegido pela Central de Segurança da Celepar, a escola utiliza a **Extensão Chrome Leopoldina Sync (Manifest V3)**:
- **`manifest.json`**: Concede permissões para `*://app.powerbi.com/*` e `*://*.redeprotecao.seed.pr.gov.br/*`.
- **`content.js` (Power BI)**: Injeta o widget flutuante no portal Power BI, realiza auto-scroll suave pela tabela de estudantes no *Modo de Foco*, extrai CGMs, Turmas, Médias Gerais e Semanas, baixando em CSV ou sincronizando diretamente na nuvem.
- **`serp-bridge.js` (Main World)**: Executa no contexto nativo do portal SERP para ter acesso direto às funções globais da Celepar (como `window.paginar(página, 119)`), contornando as restrições de CSP do Chrome.
- **`serp-content.js` (SERP Isolated World)**: Varre as 12 páginas de fichas da escola, identifica estudantes encaminhados ao **Conselho Tutelar**, protocolos e datas, salvando em cache de sessão (`sessionStorage`) com console de logs em tempo real.
- **Empacotamento Automático**: O script [`scripts/package_extension.cjs`](file:///home/marcoswrobel/Documents/Registro/scripts/package_extension.cjs) é executado automaticamente a cada build (`npm run build`), gerando o arquivo `public/extensao-leopoldina.zip` para download com 1 clique pela equipe escolar.

### 4.2. API de Frequência Power BI (`/api/frequencia/sync`)
- **Autenticação Híbrida**: Aceita `Authorization: Bearer <TOKEN>` (usando `SYNC_API_TOKEN`) da Extensão ou sessão web ativa.
- **Pareamento em 2 Etapas**:
  1. Busca por `cgm` oficial (10 dígitos).
  2. Fallback por `name` normalizado (sem acentos, maiúsculas limpas).
  3. Salva retroativamente o CGM no cadastro do aluno (`Student.cgm`).
- **Persistência**: Grava a Média Geral e o resumo de semanas em `LowAttendanceRecord` e cria registro em `AuditLog`.

### 4.3. API de Fichas do SERP (`/api/serp/sync`)
- Recebe o lote de fichas capturadas no portal `redeprotecao.seed.pr.gov.br`.
- Normaliza o status para `CONSELHO_TUTELAR`, `MINISTERIO_PUBLICO`, `EM_ACOMPANHAMENTO` ou `ARQUIVADO`.
- Vincula o protocolo e atualiza o histórico pedagógico do aluno.

---

## 5. Módulos do Sistema & Interface

### 5.1. Painel de Faltas & Infrequência (`/faltas`)
Redesenhado para responsividade total em **monitores Full HD (1920x1080 até 1800px)** e **notebooks escolares (1366x768)**:
- **Cabeçalho Fixo (*Sticky Header*)**: Colunas congeladas no topo durante a rolagem de mais de 600 alunos.
- **Alternador de Densidade**: Modo *Compacto* (ideal para telas de 768p, cabendo 12 a 15 alunos por tela) e modo *Espaçoso*.
- **5 Cards de Resumo Executivo (KPIs em Tempo Real)**:
  - *Total Monitorados*;
  - *🚨 Risco Crítico (< 75%)*;
  - *⚠️ Em Atenção (75% a 85%)*;
  - *Média Geral da Escola*;
  - *🏛️ Casos no Conselho Tutelar*.
- **Filtros Multi-Critério Combináveis**:
  - Busca global simultânea por **Nome** ou **CGM**;
  - Filtro de Segmento (Fundamental, Médio, Noturno);
  - Filtro de Turno (Manhã, Tarde, Noite);
  - Chips rápidos por faixa de risco;
  - Filtro de status SERP (Conselho Tutelar, MP, Acompanhamento);
  - Ordenação por Menor Frequência, Maior Frequência, A-Z e **Maior Queda Semanal**;
  - Botão de **Exportar CSV** filtrado e botão para **Baixar Extensão (.ZIP)**.
- **Ação Direta In-Page (Drawer Lateral)**: Botão **"Mensagem"** em cada linha que abre instantaneamente uma gaveta lateral (*slide-over*) na própria tela, sem redirecionar ou perder filtros e paginação. O painel exibe resumo de frequência, seletor de templates, alternador de turno (Manhã/Tarde/Noite), telefone editável e disparo via WhatsApp com registro auditado.

### 5.2. Editor de Modelos com Redação por IA (`/modelos`)
- **Layout Bi-Coluna Ergonômico (*Side-by-Side*)**:
  - **Lado Esquerdo**: Título, Nível, Assistente Google Gemini compacto, paleta de tags (incluindo métricas do B.I. e SERP) e campos de texto.
  - **Lado Direito**: **Simulador WhatsApp em tempo real** com alternador de turnos (**M**anhã / **T**arde / **N**oite) que renderiza a mensagem instantaneamente enquanto a IA ou o usuário digita.
- **Rodapé Fixo (*Sticky Footer*)**: Os botões **"Cancelar"** e **"Salvar Modelo"** nunca saem da área visível da tela, garantindo que mesmo após a IA redigir um texto longo, o botão de salvar permanece acessível sem rolagem.

### 5.3. Painel de Disparo de Busca Ativa (`/busca-ativa`)
- Seleção por Segmento $\rightarrow$ Turma $\rightarrow$ Aluno.
- Card de Alerta de Infrequência: exibe a média do aluno, dados da semana e histórico de contatos prévios.
- Telefone editável pontualmente para o envio.
- Integração direta com a API do WhatsApp (`wa.me`) e gravação auditada com o nome da pedagoga logada.

### 5.4. Trilha de Auditoria (`/auditoria`) & Gestão de Retornos (`/historico`)
- Pedagogas registram se o pai/mãe respondeu ao WhatsApp e anotam o motivo da ausência.
- Administradores possuem visão de governança completa com registro imutável de quem enviou, editou ou excluiu qualquer mensagem.

---

## 6. Engine de Formatação de Mensagens (`src/lib/messageFormatter.ts`)

O motor de formatação processa o texto do modelo e substitui as seguintes variáveis dinâmicas em tempo de execução:

| Tag | Descrição | Exemplo de Saída |
| :--- | :--- | :--- |
| `{saudacao}` | Saudação formal contextualizada pelo turno do aluno ou horário | `Bom dia!`, `Boa tarde!` ou `Boa noite!` |
| `{aluno}` | Nome completo do estudante | `Gabriel Silva dos Santos` |
| `{turma}` | Turma oficial do estudante | `8º Ano A - Ensino Fundamental` |
| `{responsavel}` | Nome do pai, mãe ou responsável legal cadastrado | `Maria de Fátima Silva` |
| `{pedagoga}` | Nome da pedagoga logada na sessão institucional | `Profª Ana Cláudia` |
| `{periodo}` / `{turno}` | Turno escolar por extenso | `matutino`, `vespertino` ou `noturno` |
| `{frequencia}` / `{media_geral}` | Frequência escolar apurada no Power BI | `68,5%` |
| `{semana_atual}` | Percentual de presença na semana mais recente | `40,00%` |
| `{semana_anterior}` | Percentual de presença na semana de referência anterior | `75,00%` |
| `{situacao_frequencia}` | Classificação contextual do nível de risco | `em nível crítico (abaixo do mínimo legal de 75%)` |
| `{protocolo_serp}` | Ficha SERP ou número de protocolo de proteção | `Ficha SERP nº 119/2026` |

---

## 7. Inteligência Artificial Generativa (Google Gemini)

### 7.1. Arquitetura da Rota `/api/ai/generate-template`
- **SDK**: `@google/genai` oficial.
- **Modelo Principal**: `gemini-3.5-flash` (com fallback para `gemini-flash-latest`, `gemini-3.5-flash-lite` e `gemini-3.8-flash`).
- **Otimização de Latência e Tokens**:
  ```typescript
  config: {
    systemInstruction,
    responseMimeType: "application/json",
    temperature: 0.2,
    thinkingConfig: {
      thinkingLevel: "low", // Reduz latência de resposta para ~1.5s
    },
    abortSignal: abortController.signal,
  }
  ```
- **Resiliência Serverless**: `export const maxDuration = 60` para evitar cortes de execução na Vercel.

### 7.2. Teste Instantâneo da Chave (`/api/ai/test-key`)
- Permite que a pedagoga teste ou informe uma chave personalizada do Google AI Studio diretamente pelo navegador, gravada em `localStorage`, sem depender de novo deploy na Vercel.

---

## 8. Governança, Perfis de Acesso & Segurança

1. **Autenticação Restrita `@escola.pr.gov.br`**:
   - NextAuth v5 com validação estrita de domínio. Tentativas com e-mails particulares (`@gmail.com`) são rejeitadas na camada de callback.
2. **Controle de Acesso Baseado em Papéis (RBAC)**:
   - `PEDAGOGA`: Visualiza dados, dispara mensagens pelo WhatsApp, registra respostas de pais, cria/edita modelos e importa planilhas.
   - `ADMIN` (`marcos.wrobel@escola.pr.gov.br`): Gerencia turmas, cadastra/edita estudantes, remove mensagens incorretas e audita logs no `/auditoria`.
3. **Segurança de APIs de Sincronização**:
   - Endpoints `/api/frequencia/sync` e `/api/serp/sync` protegidos por token Bearer configurado em variável de ambiente (`SYNC_API_TOKEN`).
