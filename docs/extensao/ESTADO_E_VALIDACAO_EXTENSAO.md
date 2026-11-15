# Extensão Chrome MV3 — Estado, Evolução e Validação (`v1.6.5`)

**Última atualização:** 2026-11-14  
**Versão consolidada (`working tree`):** `1.6.5`  
**Status da homologação:** **Aprovada em suíte automatizada (executado) e em testes reais no navegador (relatado pelo usuário em 2026-11-14)**  
**Ponto de restauração anterior (`v1.6.2`):** `commit dd33084` em `main`  
**Sincronização com a plataforma:** `EXPECTED_EXTENSION_VERSION = "1.6.5"` (`src/lib/clientDispatcher.ts`)  
**Pacotes gerados:** `public/extensao-rede-ativa.zip` e `public/extensao-leopoldina.zip`

---

## 1. Resumo da Validação Atual (`v1.6.5`)

> **Distinção de evidências:** os itens automatizados abaixo foram **executados** neste ambiente (`npm test`, `npm run build` e empacotamento ZIP); a validação funcional completa no Chrome real + WhatsApp Web foi **relatada como aprovada pelo usuário** na `v1.6.5` (após os ajustes de hidratação, corrida `CLEAR` vs `REGISTER` e pareamento `@lid`/`Aluno(a)`). Commit/push/deploy seguem **não executados** aguardando autorização explícita.

| Escopo | Modalidade | Status | Observação |
| :--- | :--- | :--- | :--- |
| **Hidratação Next.js/React + inferência de aluno no modal** | `whatsappExtensionReliability.test.ts` #23(b) | **Executado — Aprovado (23/23 na suíte)** | Garante restauração automática de `data-redeativa-extension` / `v1.6.5` após hidratação via timers, eventos e `MutationObserver`, resposta a `LEOPOLDINA_BRIDGE_PING` e inferência de `studentName` do `<dialog open>` quando o frontend publicado ainda não o envia. |
| **Corrida `CLEAR` sem `requestId` vs `REGISTER`** | `whatsappExtensionReliability.test.ts` #23(a) | **Executado — Aprovado (23/23 na suíte)** | Garante que `LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY` sem `requestId` entre em `withOperationStoreLock` e limpe apenas o cache residual, preservando operações `CAPTURE` recém-registradas (TTL `15 min`). |
| **Extração `@lid` via `Aluno(a):` + filtro de figurinha + transição SPA** | `whatsappExtensionReliability.test.ts` #19–#23(c) | **Executado — Aprovado (23/23 na suíte)** | Valida pareamento por nome específico do estudante nas bolhas enviadas (bloqueando termos genéricos como `"Aluno"`), filtro de timestamps isolados de figurinha (`16:28`), confirmação de transição SPA (~1,4s) e `setVerifiedTabPhone` após `LEOPOLDINA_SPA_OPEN_CHAT`. |
| **Abertura em janela compacta, DDI `55` e isolamento** | `extensionOriginAndTabIsolation.test.ts`, `clientDispatcher.test.ts`, `whatsappReplyCaptureModal.test.tsx` | **Executado — Aprovado** | Zero regressão em isolamento de abas/origens, despacho individual/em lote, interceptação com DDI `55` e links com `onClick` + `href`. |
| **Suíte global do projeto** | `npm test` (Vitest) | **Executado — Aprovado** | **67 arquivos aprovados | 3 skipped** (`skipIf` de banco isolado) / **640 testes aprovados | 12 skipped** (652 total). |
| **Build de produção + ZIPs** | `npm run build` (`node scripts/package_extension.cjs && next build`) | **Executado — Aprovado** | Compilação Next.js 16.4.3 Turbopack e TypeScript concluída com código `0` e ZIPs regenerados. |
| **Fluxo ponta a ponta em navegador real (`v1.6.5`)** | Chrome MV3 + `redeativa.app.br` + WhatsApp Web | **Relatado pelo usuário — Aprovado (2026-11-14)** | Todas as funcionalidades validadas e funcionando conforme esperado: envio individual e em lote, abertura de conversa em janela compacta, detecção da extensão na plataforma, extração pelo botão **`Extrair resposta`** no modal e envio pela barra **`📥 Capturar Retorno`** no WhatsApp Web. |

### 1.1 Próximo Passo Recomendado
- **Não executado (aguardando autorização explícita):** `commit`, `push` e atualização do deploy da plataforma para publicar `EXPECTED_EXTENSION_VERSION = "1.6.5"`, `studentName` / `expectedOutgoingText` nativos no `WhatsAppReplyCaptureModal` e os ZIPs atualizados em `/public/extensao-*.zip`. Enquanto o frontend publicado permanecer no commit anterior, a extensão `v1.6.5` mantém compatibilidade retroativa completa via `inferStudentNameFromOpenDialog()`.

---

## 2. Registro Rígido de Alterações e Procedimento de Rollback (`v1.6.5` → `v1.6.2`)

Este inventário registra exatamente todos os arquivos alterados a partir da baseline estável **`dd33084` (`v1.6.2`)** para possibilitar rollback imediato e cirúrgico sem afetar o restante do repositório.

### 2.1 Inventário Exato de Arquivos Alterados até a `v1.6.5` (acumulado sobre `dd33084`)

| Arquivo | Resumo objetivo da alteração (`v1.6.3` + `v1.6.4` + `v1.6.5`) | Impacto em caso de rollback |
| :--- | :--- | :--- |
| `extension/manifest.json` | Bump `"version": "1.6.2"` → `"1.6.5"`. | Retorna versão do manifesto para `1.6.2`. |
| `extension/popup.html` | Atualização do fallback visual do badge `v1.6.2` → `v1.6.5`. | Exibe `v1.6.2` no popup. |
| `extension/registro-bridge.js` | Bump `"1.6.5"`, `CAPTURE_CONTEXT_TTL_MS = 15 min`, restauração de marcadores e reanúncio `READY` pós-hidratação (`120/450/1200/2500ms`, `DOMContentLoaded`, `load` e `MutationObserver` com guardas), inferência de `studentName` via `<dialog open>` aberto, remoção da limpeza em massa de `activeCaptures` quando `CLEAR` vem sem `requestId`, handlers `REDEATIVA_PING_EXTENSION` / `LEOPOLDINA_BRIDGE_PING`, limpeza integral em `__REDEATIVA_BRIDGE_CLEANUP__` e interceptação DDI `55` para `LEOPOLDINA_OPEN_WHATSAPP_CHAT`. | Restaura bridge original da `v1.6.2` sem interceptação/reforço de hidratação. |
| `extension/background.js` | `CAPTURE_CONTEXT_TTL_MS = 15 min`, limpeza atômica de `CAPTURE` prévio da mesma `(originTabId, originDocumentId)` dentro de `registerPendingOperation`, correção da condição de corrida em `LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY` (lock antes de `storage.local.remove` e sem deleção em massa quando `!reqIdToClear`), ping/re-injeção de `registro-bridge.js` em `chrome.tabs.onUpdated` para origens autorizadas, `verifiedTabPhoneByTabId` (incluindo gravação após `LEOPOLDINA_SPA_OPEN_CHAT` confirmado) e fallback `chrome.tabs.update` quando `spaNavNoTransition === true`. | Restaura comportamento de despacho/extração da `v1.6.2`. |
| `extension/whatsapp-content.js` | Bump `"1.6.5"`, pareamento por nome específico do estudante nas bolhas enviadas (`.message-out`, mínimo 4 caracteres sem acento, bloqueando termos genéricos), filtro de timestamps isolados de figurinha/mídia (`/^\d{1,2}:\d{2}$/`), verificação síncrona de transição SPA (~1,4s em `LEOPOLDINA_SPA_OPEN_CHAT`), camadas `@lid`/`expectedOutgoingText`/`TAB_NAVIGATION` e limpeza ao clicar em `#pane-side`. | Remove heurísticas `@lid` / `verifiedTabPhone` / `studentName` / SPA de extração e restaura `v1.6.2`. |
| `src/lib/clientDispatcher.ts` | Atualização de `EXPECTED_EXTENSION_VERSION` para `"1.6.5"`, parâmetros `expectedOutgoingText` e `studentName` em `extractWhatsAppReplyViaExtension` e exportação de `openWhatsAppChatViaExtension`. | Retorna `EXPECTED_EXTENSION_VERSION = "1.6.2"`. |
| `src/components/whatsapp/WhatsAppReplyCaptureModal.tsx` | Envio de `expectedOutgoingText`, `studentName` e handlers `onClick` (`openWhatsAppChatViaExtension`) em `"Abrir conversa"` e `"Abrir WhatsApp"` mantendo atributos `href`. | Links voltam a abrir nova aba nativa sem janela compacta. |
| `src/lib/__tests__/whatsappExtensionReliability.test.ts` | Atualização dos checks para `1.6.5` e inclusão dos testes `#19`–`#23` (pareamento `@lid`, `CLEAR` vs `REGISTER`, restauração pós-hidratação, inferência de `studentName`, filtro `16:28`, `verifiedTabPhone` + `!didTransition` + limpeza `#pane-side`). | Remove casos de teste `#19`–`#23`. |
| `public/extensao-rede-ativa.zip` e `public/extensao-leopoldina.zip` | Artefatos reempacotados para distribuição da `v1.6.5`. | Restaura ZIPs da `v1.6.2`. |

### 2.2 Comandos para Rollback Imediato para `v1.6.2` (`dd33084`)

Caso seja necessário reverter **somente** as alterações posteriores à `v1.6.2` preservando quaisquer outros arquivos não relacionados da árvore:

```bash
# 1. Restaura exatamente os arquivos de código e testes da extensão para o commit dd33084 (v1.6.2)
git checkout dd33084 -- \
  extension/ \
  src/lib/clientDispatcher.ts \
  src/components/whatsapp/WhatsAppReplyCaptureModal.tsx \
  src/lib/__tests__/whatsappExtensionReliability.test.ts \
  public/extensao-rede-ativa.zip \
  public/extensao-leopoldina.zip

# 2. Regera e valida os pacotes e suítes após rollback
node scripts/package_extension.cjs
npm test
npm run build
```

> **Importante:** Após o rollback no código, recarregue a pasta `extension/` em `chrome://extensions` para o navegador voltar imediatamente para a versão `v1.6.2`. Limpe também `sessionStorage` do WhatsApp Web se desejar descartar a chave `redeativa_verified_lid_phone_map_v1`.

---

## 3. Evolução das Versões Recentes

### `v1.6.5` — Resiliência Pós-Hidratação Next.js, Correção da Corrida `CLEAR` vs `REGISTER` e Pareamento por `Aluno(a):` em `@lid`
- **Detecção contínua pós-hidratação (`registro-bridge.js` & `background.js`):**
  - `registro-bridge.js` reafirma `data-redeativa-extension`, `data-redeativa-extension-version` (`1.6.5`), `data-leopoldina-*` e `REDEATIVA_EXTENSION_READY` no início, em `120/450/1200/2500ms`, em `DOMContentLoaded`/`load` e via `MutationObserver` sobre `document.documentElement` (neutralizando a remoção de atributos durante a hidratação do Next.js 16 / React 19).
  - `background.js` passa a enviar `LEOPOLDINA_BRIDGE_PING` ao concluir carga de abas em origens autorizadas da plataforma (`chrome.tabs.onUpdated`), reinjetando `registro-bridge.js` se o canal não responder.
- **Fim da corrida `CLEAR` vs `REGISTER` na abertura do modal:**
  - Em `background.js`, `LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY` entra em `withOperationStoreLock` antes de chamar `chrome.storage.local.remove` e remove operação pendente apenas quando `requestId` explícito é informado (sem deleção em massa que apagava o `CAPTURE` recém-registrado).
  - Ao registrar novo `CAPTURE` (`TTL = 15 min`), operações `CAPTURE` anteriores da mesma `(originTabId, originDocumentId)` são substituídas atomicamente dentro do lock.
- **Compatibilidade com o frontend publicado + pareamento `@lid` seguro:**
  - `registro-bridge.js` infere `studentName` do `<dialog open>` ("Capturar Retorno") quando o payload ainda não traz o campo (`origin/main`).
  - `hasMatchingOutgoingMessageInMain()` confirma conversas `@lid` com contato salvo também pelo nome específico do estudante nas bolhas enviadas (`Aluno(a): <nome>`, com no mínimo 4 caracteres sem acento e bloqueio de termos genéricos como `"aluno"`, `"aluna"`, `"estudante"`, `"responsavel"`).
  - `extractIncomingMessagesFromDOM()` descarta bolhas de figurinha/mídia cujo texto extraído seja apenas horário isolado (`/^\d{1,2}:\d{2}$/`, ex.: `"16:28"`).
  - `LEOPOLDINA_SPA_OPEN_CHAT` verifica a transição no `#main` (até `4 × 350ms ≈ 1,4s`) antes de responder `{ accepted: true, verified: true }`, e `background.js` grava `setVerifiedTabPhone(targetTab.id, navPhone)` quando confirmada (ou cai no fallback de URL se `accepted: false`).

### `v1.6.4` — Interceptação para Janela Compacta + Pareamento por Navegação Verificada (`TAB_NAVIGATION`) e Fallback Seguro
- **Abertura em janela compacta no fluxo de retorno (inclusive no domínio publicado):**
  - `registro-bridge.js` intercepta cliques em links WhatsApp (`web.whatsapp.com`, `wa.me`, `api.whatsapp.com`), normaliza o telefone para DDI `55` e envia `LEOPOLDINA_OPEN_WHATSAPP_CHAT` ao `background.js` (mantendo opt-out quando `localStorage` estiver em `"native"` ou `"TAB"`).
  - `WhatsAppReplyCaptureModal.tsx` e `clientDispatcher.ts` adicionam `openWhatsAppChatViaExtension()` em **"Abrir conversa"** e **"Abrir WhatsApp"**, preservando `href` padrão caso a extensão esteja ausente.
- **Correlação `verifiedTabPhone` por aba do WhatsApp Web sem `expectedOutgoingText`:**
  - `background.js` mantém `verifiedTabPhoneByTabId` (TTL 10 min) apenas quando a navegação ou troca SPA para `?phone=55...` é confirmada (`DISPATCH`, `OPEN_CHAT`, `EXTRACT`).
  - `whatsapp-content.js` confirma `TAB_NAVIGATION` quando `!userSwitchedChat`, `#main` está aberto sem grupo e sem modais `"Iniciando conversa"` ou número inválido, gravando o vínculo `@lid ↔ telefone`.
  - Cliques manuais em `#pane-side` limpam imediatamente `pendingTabVerifiedPhone` local e remoto (`LEOPOLDINA_CLEAR_TAB_VERIFIED_PHONE`).
- **Prevenção estrita contra vazamento de dados na troca SPA:**
  - Sem transição real de `#main` (`!didTransition`), nenhum `@lid` é vinculado (`spaNavNoTransition: true`), evitando pareamento acidental enquanto o spinner `"Iniciando conversa"` oculta o chat anterior.
  - Quando a troca SPA falha ou não transiciona em `LEOPOLDINA_EXTRACT_WHATSAPP_REPLY` ou `LEOPOLDINA_SPA_OPEN_CHAT`, `background.js` executa fallback único e verificado via `chrome.tabs.update({ url })`.
- **Higiene de contexto por aba:** `LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY` sem `requestId` remove apenas operações `CAPTURE` pendentes da mesma aba/documento de origem.

### `v1.6.3` — Pareamento Seguro de Extração em Contatos Salvos / `@lid` (incorporada e corrigida na `v1.6.4`)
- Introduziu mapa `@lid ↔ telefone` (`verifiedPhoneByLid`), bloqueio de grupos (`@g.us`), `expectedOutgoingText`, rastreamento contínuo de `#pane-side` e captura humana via barra superior.

### `v1.6.2` (`dd33084`) — Troca Rápida SPA na Mesma Instância + Reversibilidade
- Reuso SPA no `background.js` (`LEOPOLDINA_SPA_NAVIGATE_AND_DISPATCH`) evitando recarregar o popup durante fila em lote.
- Baseline diferida (`tryResolveSpaSwitch`) no `whatsapp-content.js` evitando mistura entre Chat A e Chat B.
- Fallback automático (`LEOPOLDINA_SPA_NAVIGATE_FALLBACK` / `tabs.update`) e toggle reversível **"Troca rápida sem recarregar"** (`opt_whatsapp_spa_reuse`) no popup.
- **Validação relatada pelo usuário na `v1.6.2`:** envios **individual** e **em lote (fila)** aprovados conforme esperado no navegador.

### `v1.6.1` (`65585a1` e `d366c2b`) — Estabilidade de Despacho, Anti-Microfone e Versionamento Visual
- Correção de correlação em `LEOPOLDINA_GET_ACTIVE_DISPATCH` por `targetTabId` após `history.replaceState`.
- Reinjeção automática de `registro-bridge.js` (`ensureBridgeInOpenPlatformTabs`), proteção anti-microfone em `button[data-tab="11"]`, leitura de `span[dir="auto"]`, suporte a `@lid` e normalização markdown `*negrito*`.
- Exibição visual de versão em 3 dígitos (`1.6.x`) no popup e em `WhatsAppDispatchToggle.tsx`.

---

## 4. Componentes da Extensão (`extension/`)

| Arquivo | Papel |
| :--- | :--- |
| `extension/manifest.json` | Manifesto MV3 (`version: "1.6.5"`), permissões e content scripts. |
| `extension/background.js` | Orquestração de operações (`pending`/`consumed`), janela compacta dedicada, `verifiedTabPhoneByTabId`, reuso SPA, fallback verificado e relay seguro. |
| `extension/whatsapp-content.js` | Monitoramento DOM no WhatsApp Web, auto-envio, confirmação anti-microfone, troca SPA verificada, mapa `@lid ↔ telefone`, pareamento por `Aluno(a)`, `TAB_NAVIGATION` e captura humana com bloqueio anti-vazamento. |
| `extension/registro-bridge.js` | Ponte isolada entre páginas da plataforma Rede Ativa e o service worker (`redeativaExtensionVersion`), reforço pós-hidratação, inferência de aluno em `<dialog open>` e interceptação segura de links WhatsApp para janela compacta. |
| `extension/popup.html` / `extension/popup.js` | Painel da extensão com badge de versão (`v1.6.5`) e preferências (`opt_whatsapp_tab_reuse`, `opt_whatsapp_auto_send`, `opt_whatsapp_spa_reuse`). |
