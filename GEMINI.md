# Diretrizes e Regras de Workspace — Rede Ativa SaaS

Você é o assistente técnico do projeto **Rede Ativa SaaS** (antigo Busca Ativa Leopoldina).
A plataforma é um SaaS educacional multi-escola full-stack construído com **Next.js 16 (App Router + Turbopack)**, **React 19**, **TypeScript 6 estrito**, **Prisma ORM 6**, **Neon PostgreSQL Serverless (AWS sa-east-1)** e **NextAuth v5**.

Consulte [`AI_CONTEXT.md`](file:///home/marcoswrobel/Documents/Registro/AI_CONTEXT.md) e [`docs/ARQUITETURA_E_ENGENHARIA.md`](file:///home/marcoswrobel/Documents/Registro/docs/ARQUITETURA_E_ENGENHARIA.md) para o catálogo completo de módulos, schemas e contratos. Siga rigorosamente as diretrizes e regras inegociáveis abaixo em qualquer tarefa neste repositório:

---

## 1. Proteção Inviolável da Escola Piloto Fundadora
- O **Colégio Estadual Leopoldina B. Pedroso** (INEP `41042730`) é a Unidade Piloto Fundadora da plataforma e contém 689 estudantes reais.
- **NUNCA** gere código, scripts ou rotinas que excluam, resetem ou alterem inadvertidamente a escola sede ou seus registros históricos.
- Os endpoints `DELETE /api/schools/[id]` e `POST /api/schools/[id]/sanitize` possuem proteções atômicas contra a exclusão do INEP `41042730`. Nunca contorne ou desative essas proteções.
- **Identificação Estrita por INEP (Sem String Matching):** A verificação de proteção da Unidade Piloto **DEVE** ser baseada estritamente no código MEC/INEP (`inepCode === "41042730"`) ou no identificador técnico legado (`id === "default-leopoldina"`). **NUNCA** utilize checagens de substring no nome da escola (`.toLowerCase().includes("leopoldina")`) para travas de negócio ou RBAC, preservando a neutralidade do núcleo de código.
- **Tolerância a Dados Legados Restrita à Sede:** Qualquer filtro de retrocompatibilidade com registros legados (`schoolId: null` ou `"default-leopoldina"`) **DEVE** ser estritamente condicionado à comprovação de que a sessão ativa pertence à Escola Piloto Fundadora (`inepCode === "41042730"`). Nunca inclua `schoolId: null` ou `"default-leopoldina"` em cláusulas `OR` para outras escolas nem execute *auto-healing* de `schoolId` a partir de sessões externas.

---

## 2. Isolamento Lógico Multi-Tenant (Prevenção Absoluta contra IDOR)
- Todas as consultas e mutações de dados operacionais (`Student`, `ClassGroup`, `MessageLog`, `PedagogicalMinute`, `AbsenceJustification`, `StudentContact`, etc.) **DEVEM conter o filtro obrigatório por `schoolId`**.
- Nunca realize buscas ou mutações globais que possam cruzar dados entre diferentes instituições escolares ou redes.
- Em rotas de mutação direta por ID (`/api/students/[id]`, `/api/atas/[id]`), valide se o registro pertence à instituição sob controle da sessão do usuário autenticado via `assertTenantOwnership(...)`.
- **Validação de Cookie de Contexto (`active_school_id`):** Em `getCurrentSchool()`, nunca confie no cookie `active_school_id` sem validar se o usuário autenticado na sessão possui vínculo ativo com aquela escola (`session.user.schools` / `schoolId`) ou privilégio global (`SUPERADMIN` / `GESTAO_SECRETARIA` autorizado). Nunca ignore `schoolId` do corpo apenas parcialmente: o tenant efetivo sempre deriva da sessão validada.
- **Integridade de FKs em Criação E Atualização (`POST`, `PUT`, `PATCH`, `/finalize`):** Sempre valide que chaves estrangeiras referenciadas em arrays ou campos (`studentIds`, `classGroupId`, `templateId`) pertençam estritamente ao mesmo `schoolId` do recurso/sessão (conferindo `matched.length === requestedIds.length`), inclusive em edições de rascunho e finalizações.
- **Rejeição Explícita de Parâmetros Restritos (RBAC):** Quando um payload contiver flags ou operações restritas a papéis superiores (ex.: `updateSchoolInfo: true` para não-`SUPERADMIN`), retorne explicitamente **`403 Forbidden`** — nunca ignore silenciosamente retornando `200 OK`.
- **Auditoria com `schoolId` Raiz Obrigatório & Exportação CSV Segura:** Toda chamada `logAudit(...)` em contexto escolar **DEVE** receber `schoolId` na raiz do objeto (nunca apenas dentro de `details`), e consultas em `/auditoria` nunca devem expor `{ schoolId: null }` entre tenants. Em exportações CSV, todas as colunas textuais devem aplicar `sanitizeCsvField(...)` combinado ao escape RFC 4180 (`.replace(/"/g, '""')`).
- **Desambiguação e Prevenção de Colisão em Webhooks:** Webhooks passivos que localizem registros de mensagens ou estudantes por telefone DEVEM exigir identificação explícita de tenant (`schoolId`) ou desambiguação por nome. Se o número pertencer a mais de uma escola ativa (`distinctSchoolIds.length > 1`), a associação cega é estritamente proibida e a requisição deve ser ignorada para evitar colisão cadastral ou vazamento cruzado (*passive IDOR*).

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
- A lavratura oficial exige verificação do PIN de Fé Pública do servidor (`signingPin.ts`) e justificativa de lavratura extemporânea (`extemporaneousReason`) quando `attendedAt` exceder 5 dias úteis.
- Retificações ou complementações devem ser lavradas obrigatoriamente através de **Termo Aditivo (*"Em tempo"* - `PedagogicalMinuteAddendum`)** com *hash-chaining* criptográfico.
- Cancelamentos devem manter o registro histórico marcado como `VOIDED` com justificativa legal expressa (`voidReason`), sem apagar a ata.
- Exclusão física atômica de atas é estritamente restrita a administradores gerais e exclusiva para minutas de teste.
- **Integridade Criptográfica Bipartida da Mensageria (SHA-256):** Qualquer rotina que crie, atualize, retifique ou receba respostas de mensagens (`/reply`, `/manage`, `/webhooks`) **DEVE** preservar e atualizar deterministicamente o hash SHA-256 (`computeMessageContentHash`) com a regra bipartida (7 chaves no disparo inicial + 4 chaves condicionais quando `guardianReplied === true`), garantindo que `verifyMessageIntegrity` permaneça 100% íntegro.

---

## 5. Conformidade com LGPD e ECA (Arts. 17 e 143)
- Nomes e informações identificáveis de estudantes menores de idade e seus responsáveis legais **nunca** devem ser enviados diretamente a APIs de inteligência artificial externas (Google Gemini). Utilize sempre o pseudonimizador `src/lib/aiPseudonymizer.ts`, garantindo mascaramento insensível a acentos (ex.: "Joao" e "João") e sanitização absoluta de mensagens de erro HTTP 500 sem vazar `error.message`.
- No portal público de conferência via QR Code (`/validar/ata/[code]`), exiba apenas a Certidão Cega com nomes e documentos mascarados, sem expor o texto da ata ou dados sensíveis.
- No Dossiê Oficial em PDF (`/alunos/[id]/dossie`), aplique anonimização automática por iniciais a outros menores citados em ocorrências conjuntas.

---

## 6. Arquitetura Híbrida de Componentes Next.js 16
- Mantenha o padrão de pares:
  - `page.tsx`: Server Component para resolver sessão, escola ativa e buscar dados iniciais no banco sem waterfall.
  - `*Client.tsx`: Client Component (`"use client"`) para gerenciar estados, modais, formulários interativos e chamadas `fetch`.
- **Atenção ao Escopo do Middleware (`src/proxy.ts`):** O middleware valida apenas autenticação ativa, **não** posse de tenant sobre parâmetros dinâmicos `[id]` ou `[ano]`. Todo Server Component (`page.tsx`, rotas de impressão `/imprimir`, dossiês e livros anuais) **DEVE** validar `auth()` e `assertTenantOwnership(...)` antes de renderizar dados ou executar escritas de *auto-healing*.
- Nunca importe o Prisma Client dentro de Client Components.

---

## 7. Portão de Qualidade Obrigatório
Antes de dar qualquer tarefa como concluída ou commitar:
1. Execute `npm test` — garanta que **100% dos testes passem (370 testes em 52 suítes Vitest, incluindo `adversarialQa.test.ts`, `messageReplySecurity.test.ts`, `whatsappReplyCaptureModal.test.tsx`, `platformEditions.test.ts` e `atasArchiveUsability.test.ts`)**.
2. Execute `npm run build` — garanta que o **TypeScript e o Turbopack compilem com zero erros**.
3. Se adicionar novas funcionalidades ou regras de negócio, inclua os testes unitários/integrados correspondentes em `src/lib/__tests__/` ou `src/app/api/__tests__/`.

---

## 8. Neutralidade da Marca Rede Ativa, Domínio Dinâmico & Armazenamento Local
- **Marca Neutra SaaS:** A interface pública, componentes visuais, telas de login e templates do sistema adotam a identidade institucional neutra **Rede Ativa SaaS**. Nomes de escolas específicas nunca devem constar como valores estáticos na interface — sempre renderize o nome dinâmico da instituição ativa via `currentSchool?.name` com fallback neutro (`"Rede Ativa"` ou `"Instituição de Ensino"`).
- **Resolução Dinâmica de Domínio:** **NUNCA** insira domínios hardcoded (como `registro-leopoldina.vercel.app`) em funções de validação, QR Codes, Dossiês ou mensagens. Utilize sempre `getBaseAppUrl()` ou `getRequestOrigin()` de `src/lib/qrCode.ts`, que prioriza `NEXT_PUBLIC_APP_URL` / `APP_URL`, permitindo apontamento instantâneo para domínio próprio personalizado (`app.redeativa.com.br`) sem quebrar documentos já lavrados e impressos.
- **Padrão Dual-Read / Single-Write em LocalStorage:** Ao persistir preferências no cliente (tema, chave Gemini, modo de despacho de WhatsApp), utilize obrigatoriamente as funções utilitárias de `src/lib/storageKeys.ts`. A leitura deve verificar a chave neutra (`redeativa_*`) com fallback silencioso para a chave legada (`leopoldina_*`), e a escrita deve persistir exclusivamente na chave neutra, prevenindo perda de configurações para usuárias já ativas.
- **Princípio do Zero Bloatware:** Não crie tabelas, colunas adicionais no banco ou bibliotecas pesadas quando a necessidade puder ser atendida por tipagem TypeScript estrita, helpers leves e variáveis de ambiente.

---

## 9. Duas Versões da Plataforma no Paraná & Herança de Governança
- A plataforma opera sob duas edições oficiais no Paraná (`src/lib/platformEditions.ts`):
  1. **`PILOTO_INTEGRADA`**: Versão completa com automações assistidas de frequência do Power BI (*Presente na Escola*), portal SERP da Celepar (*Rede de Proteção*) e gestão de tokens da Extensão Chrome MV3.
  2. **`INSTITUCIONAL_ESSENCIAL`**: Versão padrão para novas escolas e SEMECs focada naquilo que é juridicamente viável e autônomo (Busca Ativa WhatsApp via `wa.me` ou companion, Livro Oficial de Atas sob a Lei nº 14.063/2020, Gestão de Faltas via CSV/SERE e Dossiê ECA), ocultando botões e menções a scrapers governamentais.
- **Inviolabilidade da Escola Piloto:** O INEP `41042730` e o id `default-leopoldina` operam permanentemente em `PILOTO_INTEGRADA`. Tentativas de alteração via `PUT /api/schools/[id]` retornam expressamente `403 Forbidden`.
- **Herança de Políticas (Superadmin ➔ SEMEC ➔ Escolas):**
  - O `SUPERADMIN` define a versão atribuída no cadastro da SEMEC (`EducationNetwork`) ou de escolas individuais no painel `/admin/escolas`.
  - Quando os gestores da SEMEC (`GESTAO_SECRETARIA`) cadastram novas escolas municipais vinculadas à sua rede, as escolas **herdam automaticamente** a versão definida pelo Superadmin para aquela SEMEC.
- **Blindagem Dupla de Backend:** As rotas `POST /api/frequencia/sync` e `POST /api/serp/sync` avaliam a versão do tenant de destino (`currentSchool.edition`) e rejeitam qualquer tentativa de raspagem com `403 Forbidden` quando o tenant estiver configurado na edição `INSTITUCIONAL_ESSENCIAL`.

---

## 10. Padrão de UX Writing & Microcopy Operacional (Léxico Pedagógico Brasileiro)
A interface deve seguir os princípios de design de alta densidade de informação e concisão operacional (padrão Linear, Stripe, Notion):

- **Deleção de Redundâncias (Zero Vibecoding):** Se um `<h1/h2/h3>` ou título de Card/Modal já é autoexplicativo (ex.: *"Histórico de Contatos"*), **nunca adicione** um elemento `<p>` ou subtítulo abaixo dele que apenas repita a mesma ideia com palavras a mais. Remova a tag inteira para manter o layout limpo e direto.
- **Corte Rígido de Enchimento de IA:** É estritamente proibido o uso de termos vazios corporativos como *otimizar, potencializar, gerenciar de forma eficiente, ecossistema, jornada, insights, holístico, integrado, facilmente, centralizado, em um só lugar*.
- **Léxico Pedagógico Operacional:**
  - **PROIBIDO USAR:** *Cliente, Usuário* (quando se referir ao aluno ou responsáveis), *Lead, Ticket, Chamado, Ocorrência genérica, Pipeline, Log* (na interface visível).
  - **OBRIGATÓRIO USAR:** *Estudante / Aluno, Responsável legal, Família, Busca Ativa, Infrequência, Evasão, Abandono, Faltas consecutivas / alternadas, Tentativa de contato, Registro de atendimento, Encaminhamento (Rede de Proteção, Conselho Tutelar, CRAS/CREAS), Ata pedagógica, Conselho de classe, Justificativa / Atestado, Turma, Turno, Equipe pedagógica*.
- **Concisão Operacional:**
  - **Botões de Ação:** Máximo de 2 a 3 palavras no infinitivo/imperativo direto (*"Registrar contato"*, *"Nova ata"*, *"Encaminhar"*, *"Acessar"*, *"Imprimir"*).
  - **Badges/Status:** 1 a 2 palavras (*"Pendente"*, *"Em acompanhamento"*, *"Sem retorno"*, *"Concluído"*, *"Conselho Tutelar"*).
  - **Placeholders:** Objetivos e diretos (*"Buscar por estudante ou CGM..."* em vez de *"Digite aqui o nome do aluno que você deseja encontrar..."*).
  - **Toasts e Alertas:** Factuais e curtos (*"Ata registrada."* em vez de *"A sua ata foi salva com sucesso no banco de dados!"*).
- **Preservação de Acessibilidade & Testes SSR:** Quando testes legados de renderização exigirem strings descritivas para asserção de integridade, utilize atributos de acessibilidade (`aria-label="..."`) no elemento, mantendo a interface visual limpa, acessível para leitores de tela e 100% compatível com a suíte de testes.

