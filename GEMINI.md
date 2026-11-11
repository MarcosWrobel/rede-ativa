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

## 4. Autoria, Histórico e Integridade do Livro de Atas
- Atas no status `FINALIZED` **têm a edição direta do texto bloqueada pela aplicação**.
- A finalização exige confirmação de autoria por PIN do servidor (`signingPin.ts`) e justificativa de registro extemporâneo (`extemporaneousReason`) quando `attendedAt` exceder 5 dias úteis.
- Retificações ou complementações após a confirmação devem ser registradas obrigatoriamente por **complemento vinculado (*"Em tempo"* - `PedagogicalMinuteAddendum`)** com encadeamento de hashes (`hash-chaining`), preservando integralmente o histórico anterior.
- Cancelamentos devem manter o registro histórico marcado como `VOIDED` com justificativa expressa (`voidReason`), sem apagar o registro do banco.
- Exclusão física atômica de atas é estritamente restrita a administradores gerais e exclusiva para rascunhos/minutas de teste.
- Enquadramentos normativos da instituição ou rede contratante devem constar exclusivamente na documentação técnica/jurídica (`docs/`), nunca como promessa jurídica absoluta na interface.
- **Integridade Bipartida da Mensageria (`SHA-256` interno):** Qualquer rotina de backend que crie, atualize, retifique ou receba respostas de mensagens (`/reply`, `/manage`, `/webhooks`) **DEVE** preservar e atualizar deterministicamente o hash `SHA-256` (`computeMessageContentHash`) com a regra bipartida (7 chaves no registro inicial + 4 chaves condicionais quando `guardianReplied === true`), mantendo `verifyMessageIntegrity` íntegro.

---

## 5. Privacidade, Proteção de Dados e Controle em Chamadas de IA
- Nomes e informações identificáveis de estudantes e responsáveis **nunca** devem ser enviados diretamente a APIs de inteligência artificial externas (Google Gemini). Utilize sempre `src/lib/aiPseudonymizer.ts`, garantindo mascaramento de nomes conhecidos (insensível a acentos, ex.: "Joao" e "João") e padrões de CPF/e-mail/telefone, além de sanitização absoluta de mensagens de erro HTTP 500 sem vazar `error.message`.
- A saída assistida por IA (`formalize-ata`) produz **apenas uma minuta editável**, sempre sujeita à conferência, eventual desativação pela equipe e aprovação humana antes da confirmação da ata.
- No portal público de conferência por código (`/validar/ata/[code]`), exiba apenas visualização com dados reduzidos (nomes e documentos mascarados), sem expor o conteúdo do atendimento ou dados pessoais adicionais.
- No relatório de acompanhamento em PDF (`/alunos/[id]/dossie`), aplique mascaramento automático por iniciais a outros estudantes mencionados em registros conjuntos.

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
1. Execute `npm test` — garanta que **100% dos testes passem (418 testes em 57 suítes Vitest, incluindo `adversarialQa.test.ts`, `messageReplySecurity.test.ts`, `whatsappReplyCaptureModal.test.tsx`, `platformEditions.test.ts`, `atasArchiveUsability.test.ts`, `ataServices.test.ts`, `ataEditorSubcomponents.test.tsx`, `frequenciaSync.test.ts` e `egressAndCacheOptimization.test.ts`)**.
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

## 10. Padrão de UX Writing, Veracidade Operacional e Limpeza de Interface
A interface deve seguir os princípios de alta clareza operacional, concisão cotidiana e rigor factual absoluto (padrão Linear, Stripe, Notion), aplicando as seguintes camadas obrigatórias de guardrails em **toda nova interface, landing page, modal, simulação ou revisão de tela**:

- **1. Expurgo de "Fé Pública", Afirmações Jurídicas e Atestados de Órgãos:**
  - **O termo `"fé pública"` (e variações como `"PIN de Fé Pública"`, `"Fé Pública Administrativa"`, `"Fé Pública Digital"`, `"Fé Pública Probatória"`) DEVE ser expurgado das interfaces.**
  - **PROIBIDO na UI (telas, modais, landing pages, metas SEO, badges e rodapés):** afirmações jurídicas amplas ou conclusões normativas sem lastro específico (*"Assinatura Eletrônica Avançada"* como selo promocional, *"Sim, plenamente"*, *"com total respaldo"*, *"validade jurídica garantida"*, *"100% LGPD"*, *"cadeia de custódia inquestionável"*, citar artigos de lei como `Lei nº 14.063/2020`, `ECA Art. 56`, `Art. 143` ou normas como `ISO 19005-1` como selos publicitários de validação).
  - **PROIBIDO mencionar órgãos públicos ou privados como atestados de validação:** nunca afirmar ou insinuar que Conselhos Tutelares, Ministério Público, Secretarias de Educação ou outros órgãos aceitam automaticamente documentos gerados pela plataforma. Ao tratar de encaminhamentos, informar que o arquivo exportável subsidia o envio conforme os procedimentos da rede e do órgão destinatário.

- **2. Proibição de Poluição Técnica na Interface (Restrição à Documentação):**
  - Toda interface deve ser clara, objetiva e livre de poluição com nomes técnicos, siglas de infraestrutura ou termos de implementação (`SHA-256`, `PBKDF2`, `SHA-512`, `PDF/A-1b`, `hash-chaining`, `bipartido`, `webhook`, `API`, `gateway`, `database`, rotas internas na UI como `/busca-ativa`, `ISO`, `Turbopack`).
  - Tecnologias e tecnicidades só podem aparecer em locais **estritamente necessários** para a operação direta do usuário (por exemplo, rótulo objetivo de formato no botão de download).
  - **Toda justificativa técnica, explicação arquitetural, criptográfica ou enquadramento jurídico deve ficar estritamente restrita à documentação do projeto (`docs/`)**, jamais em cards, tooltips promocionais, simuladores ou textos de tela.

- **3. Mecanismos Concretos no Lugar de Garantias Absolutas:**
  - **PROIBIDO usar:** *"impossível rasurar"*, *"inviolável"*, *"imutável"*, *"sem risco de vazamento"*, *"à prova de falhas"*, *"zero extravio garantido"*, *"100% atualizado/seguro"*.
  - **OBRIGATÓRIO descrever apenas o comportamento verificável do sistema:**
    - Autoria e confirmação: usar **"Confirmação de autoria por PIN"** (diferenciando claramente confirmação da servidora, registro do responsável e verificação de integridade).
    - Pós-confirmação da ata: **"Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico."**
    - Privacidade em tela: usar **"Redução da exposição de conversas na tela"** em vez de *"100% LGPD"* ou *"tela blindada"*.
    - Documento consolidado exportável: preferir **"Histórico de acompanhamento pedagógico"** ou **"Relatório de contatos e intervenções"** no lugar de *"Dossiê Oficial"* ou *"Certidão"*, identificando fonte, data e autoria de cada registro e separando fatos registrados de relatos/justificativas.

- **4. Controle Humano Explícito (Mensageria e Apoio de IA):**
  - Nunca sugerir envio automático sem revisão humana nem autoria autônoma pela IA (*"automatiza a busca ativa"*, *"disparar sem revisão"*, *"redigir ata com IA"* como texto definitivo).
  - Explicitar sempre o papel humano: o sistema **prepara a mensagem com os dados do estudante** ou **gera uma minuta a partir do que foi registrado**; a equipe pedagógica **confere destinatário e conteúdo antes de enviar ou confirmar a ata**. Preferir ações como **"Revisar e enviar"**.

- **5. Transparência sobre WhatsApp, Fontes de Dados e Preservação:**
  - **WhatsApp:** informar com clareza qual integração está em uso (abertura assistida via `wa.me` / WhatsApp Web com envio pela equipe vs. eventuais integrações configuradas), se o número pertence à escola e quais estados são tecnicamente verificáveis (distinguindo *abertura do chat / tentativa registrada* de *envio, entrega e leitura confirmada*).
  - **Frequência / SERE:** usar **"importação de arquivos compatíveis com relatórios"** (CSV/planilha), separando importação de matrículas de atualização de faltas e evitando prazos absolutos sem condição de referência (*"em menos de 2 minutos"*).
  - **Preservação documental:** distinguir claramente **formato do arquivo exportado** de **política de guarda, backups e exportação ao encerramento do contrato**.

- **6. Rigor em Métricas, Calculadoras, Simuladores, Estudos de Caso e Dados Comerciais:**
  - **Proibição de métricas sem lastro:** nunca exibir ganhos não comprovados (ex.: *"+38% de retenção escolar"*, *"devolve 80% do tempo"*, *"~14 horas para 5s"*).
  - **Calculadoras:** devem exibir premissas transparentes em **"Como calculamos"**, permitir ajuste de quantidades (contatos, atendimentos, atas) e separar economia estimada de economia medida.
  - **Simuladores e Demos:** devem indicar explicitamente **"Simulação demonstrativa"** e **"Dados fictícios"**, separando funcionalidades disponíveis do que está em desenvolvimento.
  - **Estudos de Caso e Citações a Escolas:** nunca citar nominalmente escolas reais (como a unidade piloto) nem atribuir métricas operacionais sem autorização formal documentada, período observado, recorte amostral e metodologia descrita, evitando adjetivos vagos (*"comprovado"*).
  - **Hierarquia da Proposta de Valor & Placeholders Comerciais:** em landing pages, colocar o trabalho cotidiano da equipe pedagógica no centro (continuidade entre contato com famílias, atendimentos, atas e acompanhamento do estudante) antes de detalhes de arquivo/segurança; **nunca exibir telefones placeholder (`5542999999999`), CNPJ/razão social fictícios ou ofertas de precificação/contratação ainda não implementadas** (manter formulários/configurações preparados para ativação posterior).

- **7. Concisão Operacional, Léxico Pedagógico e Deleção de Redundâncias (Zero Vibecoding):**
  - **Deleção de Redundâncias:** se um `<h1/h2/h3>` ou título de Card/Modal já é autoexplicativo (ex.: *"Histórico de Contatos"*), **nunca adicione** um `<p>` ou subtítulo abaixo dele repetindo a mesma ideia.
  - **Corte Rígido de Enchimento de IA:** proibido usar termos vazios corporativos como *otimizar, potencializar, gerenciar de forma eficiente, ecossistema, jornada, insights, holístico, integrado, facilmente, centralizado, em um só lugar, robusto, revolucionário, inquestionável, workflow*.
  - **Léxico Pedagógico Operacional:**
    - **PROIBIDO USAR:** *Cliente, Usuário* (quando se referir ao aluno ou responsáveis), *Lead, Ticket, Chamado, Ocorrência genérica, Pipeline, Log* (na interface visível).
    - **OBRIGATÓRIO USAR:** *Estudante / Aluno, Responsável legal, Família, Busca Ativa, Infrequência, Evasão, Abandono, Faltas consecutivas / alternadas, Tentativa de contato, Registro de atendimento, Encaminhamento, Ata pedagógica, Conselho de classe, Justificativa / Atestado, Turma, Turno, Equipe pedagógica*.
  - **Botões, Badges, Placeholders e Toasts:** botões com no máximo 2 a 3 palavras no infinitivo/imperativo direto (*"Revisar e enviar"*, *"Nova ata"*, *"Confirmar PIN"*, *"Gerar relatório"*); badges com 1 a 2 palavras (*"Pendente"*, *"Confirmada"*, *"Registrado"*); placeholders objetivos (*"Buscar por estudante ou matrícula..."*); toasts factuais e curtos (*"Ata registrada."*).

- **8. Preservação de Acessibilidade & Testes SSR:**
  - Não depender apenas de cores para comunicar estados; garantir contraste adequado, navegação por teclado e associação de rótulos (`aria-label="..."` / `<label>`) consistentes com os testes e leitores de tela (sem reinserir nos `aria-label` termos proibidos acima).

---

## 11. Mapa Arquitetural e Contadores Vivos (SSOT)
- **Contadores Verificados do Repositório:** **21 models Prisma** (`prisma/schema.prisma`), **29 páginas `page.tsx`** (`src/app/`), **50 Route Handlers `route.ts`** (`src/app/api/`) e **57 suítes / 418 testes Vitest**.
- **Estrutura de Referência:**
  ```text
  src/
  ├── app/                 # 29 páginas SSR + 50 Route Handlers REST (/api/*)
  │   ├── /                # Dispatcher por papel ou landing pública ImpactoClient
  │   ├── /login           # Login institucional Google OAuth / dev condicional
  │   ├── /impacto         # Redirecionamento permanente (permanentRedirect("/"))
  │   ├── /preview-landing # Demonstração e simulador interativo público
  │   └── ...              # Demais rotas operacionais, RBAC e portais QR (/validar, /assinar)
  ├── services/            # Camada pura de domínio e transações de Atas
  │   ├── ataParticipantService.ts
  │   └── ataFinalizationService.ts
  ├── components/ata/editor/ # Subcomponentes acessíveis e tipagem estrita do editor de atas
  └── lib/                 # Segurança multi-tenant, criptografia SHA-256, IA e parsers
  ```
- **Pacote da Extensão MV3:** O build gera `/public/extensao-rede-ativa.zip` como artefato principal (mantendo `/public/extensao-leopoldina.zip` automaticamente como alias de retrocompatibilidade).


