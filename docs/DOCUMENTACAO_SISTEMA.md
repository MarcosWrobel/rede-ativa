# Documentação Técnica do Sistema de Busca Ativa & Comunicação Escolar
**Colégio Estadual Leopoldina B. Pedroso — Ponta Grossa / Paraná**

---

## 1. Visão Geral

O **Sistema de Busca Ativa & Comunicação Escolar** foi concebido e estruturado especificamente para a realidade operacional do **Colégio Estadual Leopoldina B. Pedroso (Paraná)**. Ele atende às demandas pedagógicas de contato rápido com famílias, combate preventivo ao abandono escolar e integração com os ecossistemas oficiais do estado: o relatório **PRESENTE NA ESCOLA (Power BI)** e o **SERP (Sistema Educacional da Rede de Proteção / Celepar)**.

### Objetivos do Projeto
- Substituir o uso de planilhas manuais descentralizadas por um banco de dados relacional íntegro na nuvem (**Neon PostgreSQL Serverless**).
- Reduzir o tempo que a equipe pedagógica gasta redigindo mensagens para responsáveis, padronizando a linguagem institucional e acolhedora.
- Adaptar automaticamente a saudação e o contexto conforme o turno do estudante (Manhã, Tarde ou Noturno).
- Prover **Fila Assistida por Turma via WhatsApp Web (`wa.me`)**, permitindo acionar múltiplos faltosos com reuso de guia única sem custos de API externa.
- Registrar com precisão jurídica e auditoria os contatos efetuados, atestados médicos e atas presenciais, gerando **Dossiês em PDF** para respaldar a escola perante o Conselho Tutelar e a Rede de Proteção (SERP/FICAI).
- Oferecer assistência de redação e **triagem/formalização de retornos de responsáveis com Inteligência Artificial generativa (Google Gemini)** com JSON estruturado e *fallback* local.
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

    subgraph AuthSecurity [Camada de Segurança & Governança]
        NextApp --> Proxy[src/proxy.ts - Next.js Middleware Global]
        Proxy --> NextAuth[NextAuth.js v5 - Google OAuth @escola.pr.gov.br]
        NextAuth --> Allowlist["Allowlist de Usuários (/equipe)"]
        Allowlist --> RBAC{Controle de Papéis}
        RBAC -->|ADMIN| AdminPrivileges[Gestão de Equipe + Auditoria Completa + Edição de Histórico]
        RBAC -->|PEDAGOGA| UserPrivileges[Busca Ativa + Prontuário 360º + Faltas + Modelos + Dossiê]
    end

    subgraph BusinessLayer [Módulos da Aplicação]
        NextApp --> BuscaAtiva[/busca-ativa - Painel Individual & Fila por Turma]
        NextApp --> Prontuario[/alunos/:id - Prontuário 360º]
        NextApp --> Dossie[/alunos/:id/dossie - Dossiê A4 PDF]
        NextApp --> Faltas[/faltas - Frequência, Risco e SERP]
        NextApp --> Modelos[/modelos - Editor Bi-Coluna & IA Gemini]
        NextApp --> Historico[/historico - Controle Paginado & Triagem IA]
        NextApp --> Relatorios[/relatorios - Indicadores e Causas de Falta]
        NextApp --> Equipe[/equipe - Controle de Membros da Escola]
        NextApp --> Auditoria[/auditoria - Trilha de Conformidade com IP]
    end

    subgraph DataAndAI [Persistência e Inteligência]
        NextApp --> Prisma[Prisma ORM Client 6]
        Prisma --> NeonDB[(Neon PostgreSQL Serverless - AWS SP)]
        Modelos --> GeminiGen[Google Gemini API - Geração de Modelos]
        Historico --> GeminiTriage[Google Gemini API - Classificação de Retornos]
        ExtLeopoldina -->|POST em Lote com Bearer Token| SyncFreq["/api/frequencia/sync"]
        ExtLeopoldina -->|POST em Lote com Bearer Token| SyncSerp["/api/serp/sync"]
        SyncFreq --> Prisma
        SyncSerp --> Prisma
    end

    subgraph DeliveryTransport [Camada de Mensageria]
        BuscaAtiva --> WaMeProvider["WhatsApp Provider (src/lib/whatsappProvider.ts)"]
        WaMeProvider --> WaMeWeb["WhatsApp Web (wa.me) - Reuso de Aba"]
        WaMeProvider -.->|Pluggable Gateway Opcional| HttpGateway["HTTP Gateway (Futuro)"]
        WaMeWeb --> Pais[Pais e Responsáveis Legais]
    end
```

---

## 3. Modelo de Dados Relacional (Prisma / PostgreSQL)

O banco de dados relacional está hospedado no **Neon PostgreSQL Serverless (AWS São Paulo - `sa-east-1`)**, com índices otimizados, constraints de integridade e tabelas para visão 360º do estudante:

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

  @@index([segment, shift])
}

model Student {
  id                   String                @id @default(cuid())
  cgm                  String?               @unique // Cadastro Geral de Matrícula oficial SEED-PR
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
  contacts             StudentContact[]
  justifications       AbsenceJustification[]
  inPersonAttendances  InPersonAttendance[]
  attendanceSnapshots  AttendanceSnapshot[]

  @@index([classGroupId, active])
  @@index([name])
}

model StudentContact {
  id            String   @id @default(cuid())
  studentId     String
  student       Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  name          String
  kinship       String   @default("RESPONSAVEL") // MAE | PAI | AVOS | TIOS | IRMAOS | RECADO | PROPRIO_ALUNO | RESPONSAVEL
  phone         String
  isPrimary     Boolean  @default(false)
  whatsappValid Boolean  @default(true)
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([studentId, isPrimary])
}

model AbsenceJustification {
  id             String   @id @default(cuid())
  studentId      String
  student        Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  type           String   @default("ATESTADO_MEDICO") // ATESTADO_MEDICO | ATESTADO_ODONTOLOGICO | DECLARACAO_COMPARECIMENTO | JUSTIFICATIVA_FAMILIAR | DISPENSA_LEGAL
  startDate      DateTime
  endDate        DateTime
  cidCode        String?
  notes          String?
  createdByName  String
  createdByEmail String
  createdAt      DateTime @default(now())

  @@index([studentId, endDate(sort: Desc)])
  @@index([startDate, endDate])
}

model InPersonAttendance {
  id              String   @id @default(cuid())
  studentId       String
  student         Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  attendedAt      DateTime @default(now())
  guardianPresent String
  subject         String
  summary         String
  agreements      String?
  recordedByName  String
  recordedByEmail String
  createdAt       DateTime @default(now())

  @@index([studentId, attendedAt(sort: Desc)])
}

model AttendanceSnapshot {
  id                    String   @id @default(cuid())
  studentId             String
  student               Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  referenceWeek         String   // Ex: "2026-W44"
  attendancePercent     Float
  weeklyPercent         Float?
  previousWeeklyPercent Float?
  recordedAt            DateTime @default(now())

  @@unique([studentId, referenceWeek])
  @@index([studentId, recordedAt(sort: Desc)])
}

model MessageTemplate {
  id               String       @id @default(cuid())
  title            String       // Ex: "ALUNO FALTOU", "CONVOCAÇÃO URGENTE"
  segment          String       @default("TODOS") // TODOS | FUNDAMENTAL | MEDIO | NOTURNO
  prefixText       String
  suffixText       String
  isAbsenceRelated Boolean      @default(false)
  active           Boolean      @default(true)
  createdAt        DateTime     @default(now())

  messageLogs      MessageLog[]

  @@index([active, segment])
  @@index([isAbsenceRelated])
}

model MessageLog {
  id                String           @id @default(cuid())
  studentId         String
  student           Student          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  templateId        String?
  template          MessageTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  reasonTitle       String
  messageContent    String
  phoneUsed         String
  sentByUserId      String?
  sentByUser        User?            @relation("SentByUser", fields: [sentByUserId], references: [id], onDelete: SetNull)
  sentByName        String
  guardianReplied   Boolean          @default(false)
  replyNotes        String?
  replyCategory     String?          // SAUDE | TRANSPORTE | TRABALHO | VIAGEM_FAMILIAR | VULNERABILIDADE | SEM_JUSTIFICATIVA | OUTROS
  repliedAt         DateTime?
  repliedByUserId   String?
  repliedByUser     User?            @relation("RepliedByUser", fields: [repliedByUserId], references: [id], onDelete: SetNull)
  deliveryStatus    String           @default("SENT") // LINK_OPENED | SENT | DELIVERED | READ | FAILED_NO_WHATSAPP
  deliveryUpdatedAt DateTime?
  sentAt            DateTime         @default(now())

  @@index([sentAt(sort: Desc)])
  @@index([studentId, sentAt(sort: Desc)])
  @@index([guardianReplied])
  @@index([sentByName])
  @@index([reasonTitle])
  @@index([deliveryStatus])
  @@index([replyCategory])
}

model LowAttendanceRecord {
  id                String    @id @default(cuid())
  studentId         String    @unique
  student           Student   @relation(fields: [studentId], references: [id], onDelete: Cascade)
  attendancePercent Float
  enrollmentDetail  String?
  actionsTaken      String?
  serpProtocol      String?
  serpStatus        String?   // "CONSELHO_TUTELAR" | "EM_ACOMPANHAMENTO" | "MINISTERIO_PUBLICO" | "ARQUIVADO"
  serpOpenedAt      DateTime?
  serpDetails       String?
  updatedAt         DateTime  @updatedAt

  @@index([attendancePercent])
  @@index([serpStatus])
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  userEmail  String
  userName   String
  action     String   // SEND_MESSAGE | CREATE_STUDENT | UPDATE_STUDENT | DELETE_STUDENT | MARK_REPLY | UPDATE_DELIVERY_STATUS | WEBHOOK_REPLY | GENERATE_DOSSIER | etc.
  entityType String
  entityId   String?
  details    String?
  ipAddress  String?
  createdAt  DateTime @default(now())

  @@index([createdAt(sort: Desc)])
  @@index([action])
}
```

---

## 4. Módulos do Sistema & Interfaces

### 4.1. Painel de Busca Ativa (`/busca-ativa`)
Oferece dois modos integrados de operação:
1. **Envio Individual**:
   - Seleção encadeada de Nível $\rightarrow$ Turma $\rightarrow$ Aluno.
   - Detecção visual de 🩺 **Atestado Vigente** e alerta de infrequência.
   - Seletor de contatos múltiplos da família (Mãe, Pai, Avós, Recado).
   - Confirmação de entrega pós-abertura do `wa.me`: botão **"Confirmar Envio"** (`SENT`) ou **"Número sem WhatsApp"** (`FAILED_NO_WHATSAPP`).
2. **Fila Assistida por Turma (wa.me Cadenciado)**:
   - Seleção da turma e do modelo de mensagem.
   - Lista com checkbox mestre acessível (`:indeterminate`), desmarcando automaticamente alunos com atestado vigente, sem WhatsApp ou já acionados no dia.
   - Passo a passo guiado (`Aluno 1 de N`) com `<progress>` nativo, prévia editável, botão de disparo reusando a mesma guia do navegador (`leopoldina_whatsapp_dispatch`), confirmação e salto de estudantes.

### 4.2. Prontuário 360º do Estudante (`/alunos/[id]`)
- **Aba 1 (Geral)**: KPIs de frequência (média geral, semana atual, semana anterior), status no SERP e histórico de encaminhamentos.
- **Aba 2 (Contatos Familiares)**: Cadastro de múltiplos números com indicação de parentesco, contato principal e flag de WhatsApp válido.
- **Aba 3 (Atestados & Justificativas)**: Registro de atestados médicos com data inicial/final, código CID e observações, alimentando selos de vigência em todo o sistema.
- **Aba 4 (Atas Presenciais & Linha do Tempo)**: Registro formal de comparecimento da família na coordenação e histórico auditado de todas as mensagens de WhatsApp com status e retornos.

### 4.3. Emissão de Dossiê Oficial em PDF (`/alunos/[id]/dossie`)
- Formatação A4 padronizada para impressão física ou exportação em PDF.
- Cabeçalho oficial SEED-PR e Colégio Leopoldina.
- Quadro cadastral completo do aluno e contatos.
- Indicadores oficiais de frequência e série histórica semanal.
- Relação de atestados médicos entregues e atas presenciais firmadas.
- Relação cronológica auditada de tentativas de busca ativa, identificando com clareza **tentativas frustradas por número sem WhatsApp** (resguardando a responsabilidade da escola perante o Conselho Tutelar e SERP).
- Parecer técnico conclusivo personalizável e campo triplo de assinaturas (Pedagoga, Direção e Ciência do Responsável/Órgão).

### 4.4. Painel de Infrequência & SERP (`/faltas`)
- Monitoramento em tempo real dos alunos da escola com ordenação por menor frequência ou **📉 Maior Queda Abrupta**.
- Drawer lateral de envio rápido sem perda de filtros ou paginação.
- Confirmação imediata de envio/invalidação de número no banner de feedback.
- Atalho direto para iniciar a Fila da Turma selecionada.

### 4.5. Histórico de Envios & Triagem IA (`/historico`)
- Consulta paginada no PostgreSQL com busca textual rápida em nome, CGM, motivo, telefone e anotações.
- Filtros combinados por segmento, turma, pedagoga, status de retorno, status de entrega (`deliveryStatus`) e categoria de causa (`replyCategory`).
- Modal nativo `<dialog>` de retorno com assistente **"✨ Formalizar & Classificar com IA"** (Google Gemini).

### 4.6. Relatórios Gerenciais (`/relatorios`)
- Agregação SQL nativa (`groupBy` + `count`).
- Recortes temporais dinâmicos: Todo o período, Últimos 30 dias, 1º/2º/3º Trimestres ou Período Personalizado.
- Distribuição de contatos por motivo e por pedagoga responsável.
- Indicadores de **Índice de Retorno & Qualidade Cadastral** (confirmados, pendentes e taxa de números sem WhatsApp).
- Gráfico de **Causas / Categorias das Justificativas Familiares** (Saúde, Transporte, Trabalho, Viagem, Vulnerabilidade, Sem Justificativa, Outros).

### 4.7. Controle de Equipe (`/equipe`) & Auditoria (`/auditoria`)
- Restrito ao Administrador.
- Gerenciamento de e-mails autorizados `@escola.pr.gov.br`, impedindo que qualquer usuário do domínio acesse a plataforma sem permissão expressa da direção.
- Registro auditado imutável com data/hora exata, IP de origem, usuário responsável e payload das operações sensíveis.

---

## 5. Inteligência Artificial com Google Gemini (`@google/genai`)

O sistema adota o SDK oficial `@google/genai` com foco em agilidade e precisão:

1. **Geração de Modelos (`/api/ai/generate-template`)**:
   - Modelos utilizados: `gemini-3.5-flash`, `gemini-3.8-flash` ou `gemini-3.5-flash-lite`.
   - Gera modelos de comunicados estruturados em JSON (`title`, `prefixText`, `suffixText`, `isAbsenceRelated`) a partir de comandos em linguagem natural.
2. **Classificação & Formalização de Retorno (`/api/ai/classify-reply`)**:
   - Executa via `ai.interactions.create` com *Structured Outputs* (JSON Schema estrito).
   - Extrai:
     - `formalSummary`: Texto em norma culta para ata e dossiê (ex.: *"Responsável informou via WhatsApp que o aluno realizou consulta médica e apresentará atestado na próxima semana"*).
     - `category`: `SAUDE` | `TRANSPORTE` | `TRABALHO` | `VIAGEM_FAMILIAR` | `VULNERABILIDADE` | `SEM_JUSTIFICATIVA` | `OUTROS`.
     - `requiresMedicalCertificate`: Booleano sinalizando necessidade de recolhimento de atestado.
     - `suggestedFollowUp`: Recomendação de ação pedagógica prática.
   - **Fallback Determinístico Local**: Se a chave de IA não estiver disponível ou oscilar, o sistema executa imediatamente heurísticas locais de regex pedagógico sem travar o usuário.

---

## 6. Rotas de API e Endpoints

| Método | Rota | Autenticação | Descrição |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/messages/send` | Sessão Web | Registra log com `deliveryStatus` e gera URL `wa.me` normalizada. |
| `PATCH` | `/api/messages/status` | Sessão Web | Atualiza status de entrega (`SENT` / `FAILED_NO_WHATSAPP`) e invalida contatos. |
| `POST` | `/api/messages/reply` | Sessão Web | Registra retorno familiar, notas e causa classificada (`replyCategory`). |
| `GET` | `/api/messages` | Sessão Web | Listagem paginada do histórico com filtros combinados. |
| `PUT/DELETE`| `/api/messages/manage` | `ADMIN` | Edição ou exclusão administrativa de registros com auditoria. |
| `POST` | `/api/ai/classify-reply` | Sessão Web | Triagem e formalização de justificativas com Gemini AI. |
| `POST` | `/api/ai/generate-template`| Sessão Web | Geração generativa de modelos institucionais com Gemini AI. |
| `POST` | `/api/ai/test-key` | Sessão Web | Validação e teste de latência de chave Gemini informada no painel. |
| `POST` | `/api/students/:id/contacts` | Sessão Web | Criação de contatos secundários da família. |
| `POST` | `/api/students/:id/justifications` | Sessão Web | Registro de atestados médicos com vigência. |
| `POST` | `/api/students/:id/attendances` | Sessão Web | Registro de atas de comparecimento presencial. |
| `POST` | `/api/frequencia/sync` | Bearer Token / Sessão | Sincronização em lote (*batch upsert*) da frequência Power BI. |
| `POST` | `/api/serp/sync` | Bearer Token / Sessão | Sincronização em lote das fichas do portal SERP/Celepar. |
| `GET/POST` | `/api/cron/weekly-digest` | CRON_SECRET / Sessão | Compilação automática de indicadores e fila de prioridade para boletim semanal. |
| `POST` | `/api/webhooks/whatsapp` | Webhook Secret | Endpoint passivo futuro para gateways externos de mensageria. |

---

## 7. Escala, PWA & Rotinas Automatizadas (Fase 5)

### Transformação em PWA Mobile (`ESC-02`)
- **Web App Manifest (`public/manifest.json`)**: Configurado com exibição `standalone`, orientação `portrait-primary`, tema `#0284c7`, atalhos rápidos de tela inicial para a Fila por Turma e Busca Ativa.
- **Ícones Adaptativos**: Gerados nos tamanhos `192x192`, `512x512` e `maskable` a partir do brasão institucional.
- **Service Worker (`public/sw.js`)**: Cache estático para carregamento instantâneo no celular de pedagogas e gestores, com *bypass* obrigatório para APIs dinâmicas (`/api/*`) e rotas de autenticação.
- **Instalador Intuitivo (`PwaRegister.tsx`)**: Banner discreto que intercepta o evento `beforeinstallprompt` e oferece a instalação como app nativo no Android/iOS com memorização da preferência do usuário.

### Boletim Semanal Automatizado (`ESC-03`)
- **Vercel Cron (`0 10 * * 1`)**: Disparado toda segunda-feira às 07:00 da manhã no horário de Brasília (`10:00 UTC`).
- **Endpoint Seguro (`/api/cron/weekly-digest`)**: Protegido por `CRON_SECRET` e compatível com chamadas manuais autenticadas pela equipe escolar.
- **Painel Executivo `/boletim` (`BoletimClient.tsx`)**:
  - Diagnóstico de urgência: alunos com infrequência crítica (<75%) sem nenhum contato registrado há mais de 7 dias.
  - Monitoramento de casos SERP / Conselho Tutelar ativos.
  - Taxa de resposta dos responsáveis nos últimos 7 dias.
  - Destaque para turmas com maior concentração de faltosos e distribuição por turnos.
  - Layout otimizado para reunião de pedagógico e impressão A4 em 1 clique.

### Arquitetura Multi-Escola (`ESC-01`)
- **Modelo `School` no Prisma**: Entidade estruturada com `inepCode`, `name`, `city`, `state`, `nre`, `logoUrl` e `settingsJson`.
- **Relações Não-Destrutivas**: Chaves `schoolId String?` nos modelos `User`, `ClassGroup`, `Student`, `MessageTemplate` e `AuditLog`.
- **Fallback Seguro**: Módulo `currentSchool.ts` com fallback gracioso para os dados padrão do Colégio Leopoldina (INEP: `41042730`), garantindo retrocompatibilidade total com a base existente.

---

## 8. Qualidade, Testes & Conformidade

- **Testes Automatizados (Vitest)**:
  - `src/lib/__tests__/messageFormatter.test.ts`: Substituição de tags e saudações por turno.
  - `src/lib/__tests__/studentMatcher.test.ts`: Pareamento robusto por CGM e nome normalizado.
  - `src/lib/__tests__/pedagogicalClassifier.test.ts`: Detecção de queda abrupta e atestados vigentes.
  - `src/lib/__tests__/whatsappPhase4.test.ts`: Elegibilidade na fila, saneamento de números e classificação de retornos.
  - `src/lib/__tests__/phase5Features.test.ts`: Interpolação de `{escola}` e integridade do modelo multi-escola.
  - Total: **29 testes unitários** com 100% de aprovação.
- **Conformidade LGPD**:
  - Restrição de visualização de dados de menores a profissionais autenticados.
  - Expurgo de dados sensíveis de repositórios públicos.
  - Trilha imutável em `AuditLog` com IP e dados da modificação.
