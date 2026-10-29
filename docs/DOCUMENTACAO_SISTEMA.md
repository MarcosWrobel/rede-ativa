# Documentação Técnica do Sistema de Busca Ativa & Comunicação Escolar
**Colégio Estadual Leopoldina B. Pedroso — Paraná**

---

## 1. Visão Geral

O **Sistema de Busca Ativa & Comunicação Escolar** foi desenvolvido para centralizar, agilizar e padronizar as comunicações da equipe pedagógica com as famílias dos estudantes do Colégio Estadual Leopoldina B. Pedroso (Paraná).

### Objetivos do Projeto
- Substituir o uso de planilhas manuais descentralizadas por um banco de dados relacional íntegro na nuvem.
- Reduzir o tempo que as pedagogas gastam redigindo mensagens para responsáveis.
- Adaptar automaticamente a saudação e o contexto conforme o turno do estudante (Manhã, Tarde ou Noturno).
- Registrar com precisão os contatos efetuados para dar respaldo institucional perante o Conselho Tutelar e a Rede de Proteção (SERP/FICAI).
- Oferecer assistência de redação pedagógica por Inteligência Artificial generativa com custo R$ 0,00 na cota gratuita do Google AI Studio.

---

## 2. Arquitetura da Solução

```mermaid
flowchart TD
    User([Pedagoga / Administrador]) --> Browser[Navegador / Dispositivo]
    Browser --> NextApp[Next.js 16 App Router]

    subgraph AuthLayer [Camada de Segurança]
        NextApp --> NextAuth[NextAuth.js v5]
        NextAuth --> GoogleOAuth[Google OAuth @escola.pr.gov.br]
        NextAuth --> RBAC{Controle de Papéis}
        RBAC -->|ADMIN| AdminPriveleges[Edição de Histórico + /auditoria]
        RBAC -->|USER| UserPrivileges[Visualização + Busca Ativa + Modelos]
    end

    subgraph BusinessLayer [Módulos da Aplicação]
        NextApp --> BuscaAtiva[/busca-ativa]
        NextApp --> Modelos[/modelos]
        NextApp --> Faltas[/faltas]
        NextApp --> Historico[/historico]
        NextApp --> Auditoria[/auditoria]
        NextApp --> FormatterEngine[Engine de Formatação Dinâmica]
    end

    subgraph DataAndAI [Persistência e Inteligência]
        NextApp --> Prisma[Prisma ORM Client]
        Prisma --> NeonDB[(Neon PostgreSQL Serverless - AWS SP)]
        Modelos --> GeminiAPI[Google Gemini 3.5 Flash API]
    end

    subgraph ExternalDelivery [Disparo ao Destinatário]
        BuscaAtiva --> WhatsAppLink[API WhatsApp wa.me / App Desktop]
        WhatsAppLink --> Pais[Pais / Responsáveis]
    end
```

---

## 3. Modelo de Dados Relacional (Prisma / PostgreSQL)

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            String       @id @default(cuid())
  email         String       @unique
  name          String?
  image         String?
  role          String       @default("USER") // "ADMIN" ou "USER"
  createdAt     DateTime     @default(now())
  messagesSent  MessageLog[]
  auditActions  AuditLog[]
}

model Student {
  id          String       @id @default(cuid())
  name        String
  cgm         String       @unique
  classRoom   String       // Ex: "6A", "1EM", "3NOT"
  shift       String       @default("MANHA") // "MANHA", "TARDE", "NOITE"
  parentName  String?
  parentPhone String
  createdAt   DateTime     @default(now())
  messages    MessageLog[]
}

model MessageTemplate {
  id               String       @id @default(cuid())
  title            String
  prefixText       String       // Texto antes do nome do aluno (contém {saudacao})
  suffixText       String       // Texto pós identificação do aluno
  segment          String       @default("TODOS") // "TODOS", "FUNDAMENTAL", "MEDIO", "NOTURNO"
  isAbsenceRelated Boolean      @default(false)   // Conta para índice de faltas
  active           Boolean      @default(true)
  createdAt        DateTime     @default(now())
  messages         MessageLog[]
}

model MessageLog {
  id         String          @id @default(cuid())
  studentId  String
  templateId String?
  userId     String
  sentText   String
  channel    String          @default("WHATSAPP")
  status     String          @default("ENVIADO")
  sentAt     DateTime        @default(now())

  student    Student         @relation(fields: [studentId], references: [id])
  template   MessageTemplate? @relation(fields: [templateId], references: [id])
  user       User            @relation(fields: [userId], references: [id])
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String
  action    String   // "EDIT_MESSAGE", "DELETE_MESSAGE", "LOGIN"
  details   String
  timestamp DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])
}
```

---

## 4. Engine de Formatação de Mensagens (`src/lib/messageFormatter.ts`)

O motor de formatação processa o texto do modelo e substitui as seguintes variáveis em tempo de execução:

| Tag | Descrição | Exemplo de Saída |
| :--- | :--- | :--- |
| `{saudacao}` | Saudação formal de acordo com o turno selecionado | `Bom dia!`, `Boa tarde!` ou `Boa noite!` |
| `{aluno}` | Nome completo do estudante | `Gabriel Silva dos Santos` |
| `{turma}` | Turma do estudante | `8º Ano A - Ensino Fundamental` |
| `{responsavel}` | Nome do pai, mãe ou responsável legal | `Maria de Fátima Silva` |
| `{pedagoga}` | Nome da pedagoga logada na sessão | `Profª Ana Cláudia` |
| `{periodo}` | Turno escolar por extenso | `período da manhã`, `período da tarde`, `período noturno` |

---

## 5. Integração com Inteligência Artificial (Google Gemini)

### 5.1. Arquitetura da Rota `/api/ai/generate-template`
- **SDK**: `@google/genai`
- **Modelo Principal**: `gemini-3.5-flash` (versão 3.6-flash interna do Google).
- **Otimização de Latência**:
  ```typescript
  config: {
    systemInstruction,
    responseMimeType: "application/json",
    temperature: 0.2,
    thinkingConfig: {
      thinkingLevel: "low", // Reduz tokens de raciocínio de 139 para o mínimo, acelerando a resposta para ~1.8s
    },
    abortSignal: abortController.signal,
  }
  ```
- **Resiliência Serverless**:
  - `export const maxDuration = 60` evita timeouts rígidos em plataformas como a Vercel.
  - Cascata ordenada de modelos: `gemini-3.5-flash` $\rightarrow$ `gemini-flash-latest` $\rightarrow$ `gemini-3.5-flash-lite` $\rightarrow$ `gemini-3.8-flash`.

### 5.2. Diagnóstico em Tempo Real (`/api/ai/test-key`)
- Valida a conectividade da chave informada diretamente contra a API oficial do Google com um prompt mínimo (`"ping"` $\rightarrow$ `"pong"`).
- Retorna o modelo que respondeu, a latência exata em milissegundos e mensagens de erro decodificadas caso haja problemas de cota ou sintaxe de chave.

---

## 6. Governança e Regras de Negócio

1. **Permissões de Histórico**:
   - Pedagogas (`USER`): Podem consultar todo o histórico de contatos realizados, filtrar por turma, período e aluno, mas não podem alterar nem excluir registros.
   - Administradores (`ADMIN`, ex.: `marcos.wrobel@escola.pr.gov.br`): Podem corrigir registros de mensagens e excluir lançamentos incorretos. Todas as exclusões e edições geram eventos automáticos na tabela `AuditLog`.
2. **Trilha de Auditoria (`/auditoria`)**:
   - Acesso estritamente bloqueado para não-administradores (redireciona para `/`).
   - Apresenta data, hora, IP/agente e justificativa de operações críticas no sistema.
3. **Deduplicação de Templates**:
   - Elimina redundâncias de múltiplos modelos idênticos criados para turmas diferentes, unificando-os sob um modelo canônico adaptável via tags de turno e segmento.
