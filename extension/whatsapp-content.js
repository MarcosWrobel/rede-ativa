// whatsapp-content.js - Captura Assistida de Retornos e Confirmação Verificada de Envio (WhatsApp Web)
// Versão 1.6.2 — Ciclo de vida idempotente, troca rápida SPA na mesma instância, proteção anti-microfone e verificação estrita de despacho

if (typeof window.__REDEATIVA_WA_CLEANUP__ === "function") {
  try {
    window.__REDEATIVA_WA_CLEANUP__();
  } catch {}
}

(function () {
  const EXTENSION_VERSION = "1.6.2";

  let isInstanceDisposed = false;
  let dispatchGeneration = 0;

  let activeDispatch = null;
  let lastCompletedRequestId = null;
  let hasReportedOutcome = false;
  let autoSendTimer = null;
  let autoSendTriggered = false;
  let autoSendInFlight = false;
  let sendActionTriggered = false;
  let composeBoxHadTextBeforeSend = false;
  let userSwitchedChat = false;
  let isCaptureInProgress = false;

  let dispatchObserver = null;
  let dispatchObserverTarget = null;
  let dispatchObserverThrottleTimer = null;
  let rootContainerObserver = null;
  let selectionDebounceTimer = null;

  let topBarContainer = null;
  let statusBanner = null;
  let captureActionBtn = null;

  let lastCaptureBtnHasSelection = null;
  let lastBannerText = null;
  let lastBannerBg = null;

  // Estado de linha de base e correlação da conversa para o despacho ativo
  let baselineCapturedForMain = null;
  let baselineOutgoingNodes = new WeakSet();
  let baselineOutgoingIds = new Set();
  let baselineLastOutgoingNode = null;
  let initialVerifiedHeaderTitle = null;
  let spaSwitchPending = false;
  let spaPreviousTitle = "";
  let spaSwitchStartedAt = 0;
  let spaFallbackUrl = "";
  let spaFallbackTriggered = false;
  let expectedMessageText = "";
  let lastCapturedComposeText = "";

  const pendingTimeouts = new Set();

  function scheduleTimeout(fn, delayMs) {
    if (isInstanceDisposed) return null;
    const timerId = setTimeout(() => {
      pendingTimeouts.delete(timerId);
      if (isInstanceDisposed) return;
      fn();
    }, delayMs);
    pendingTimeouts.add(timerId);
    return timerId;
  }

  function cancelScheduledTimeout(timerId) {
    if (timerId !== null && timerId !== undefined) {
      clearTimeout(timerId);
      pendingTimeouts.delete(timerId);
    }
  }

  function clearAllPendingTimeouts() {
    for (const timerId of pendingTimeouts) {
      clearTimeout(timerId);
    }
    pendingTimeouts.clear();
    dispatchObserverThrottleTimer = null;
    selectionDebounceTimer = null;
  }

  /**
   * Obtém eventual texto selecionado manualmente pela usuária dentro da área da conversa (#main)
   */
  function getSelectedWhatsAppText() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return "";
      const text = sel.toString().trim();
      if (text.length < 2) return "";

      const mainEl = document.querySelector("#main");
      if (mainEl && sel.anchorNode && !mainEl.contains(sel.anchorNode)) {
        return "";
      }
      return text;
    } catch {
      return "";
    }
  }

  /**
   * Atualiza o rótulo e estilo do botão de captura somente quando o estado de seleção muda,
   * evitando mutações redundantes no DOM a cada evento selectionchange.
   */
  function syncCaptureButtonsState(force = false) {
    if (isInstanceDisposed || !captureActionBtn) return;

    const selectedText = getSelectedWhatsAppText();
    const hasSelection = selectedText.length >= 2;

    if (!force && lastCaptureBtnHasSelection === hasSelection) {
      return;
    }
    lastCaptureBtnHasSelection = hasSelection;

    const nextLabel = hasSelection ? "📥 Capturar Seleção Marcada" : "📥 Capturar Retorno";
    const nextBg = hasSelection ? "#2563eb" : "#059669";
    const nextBorder = hasSelection ? "1px solid #60a5fa" : "1px solid #10b981";
    const nextTitle = hasSelection
      ? "Capturar trecho selecionado na conversa"
      : "Capturar automaticamente as últimas mensagens recebidas nesta conversa";

    if (captureActionBtn.textContent !== nextLabel) {
      captureActionBtn.textContent = nextLabel;
    }
    if (captureActionBtn.dataset.appliedBg !== nextBg) {
      captureActionBtn.style.background = nextBg;
      captureActionBtn.dataset.appliedBg = nextBg;
    }
    if (captureActionBtn.dataset.appliedBorder !== nextBorder) {
      captureActionBtn.style.border = nextBorder;
      captureActionBtn.dataset.appliedBorder = nextBorder;
    }
    if (captureActionBtn.title !== nextTitle) {
      captureActionBtn.title = nextTitle;
    }
  }

  /**
   * Garante que a barra superior compacta exista no topo do WhatsApp Web sem recriar nós sem necessidade.
   */
  function ensureTopBar() {
    if (isInstanceDisposed || !document.body) return;

    if (topBarContainer && document.body.contains(topBarContainer)) {
      return;
    }

    const existing = document.getElementById("leopoldina-wa-topbar");
    if (existing) {
      existing.remove();
    }

    topBarContainer = document.createElement("div");
    topBarContainer.id = "leopoldina-wa-topbar";
    topBarContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 999999;
      background: #0f172a;
      color: #ffffff;
      padding: 6px 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      border-bottom: 1px solid rgba(255,255,255,0.12);
    `;

    statusBanner = document.createElement("div");
    statusBanner.id = "leopoldina-wa-banner";
    statusBanner.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 2px 6px;
      border-radius: 4px;
    `;
    const initialBannerText = "🎓 Busca Ativa Escolar • Selecione um trecho ou clique ao lado para capturar";
    statusBanner.textContent = initialBannerText;
    lastBannerText = initialBannerText;
    lastBannerBg = "#0f172a";

    captureActionBtn = document.createElement("button");
    captureActionBtn.id = "leopoldina-wa-capture-btn";
    captureActionBtn.type = "button";
    captureActionBtn.style.cssText = `
      background: #059669;
      color: #ffffff;
      border: 1px solid #10b981;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      transition: background 0.15s ease;
    `;
    captureActionBtn.addEventListener("click", handleHumanCaptureButtonClick);

    topBarContainer.appendChild(statusBanner);
    topBarContainer.appendChild(captureActionBtn);
    document.body.appendChild(topBarContainer);

    lastCaptureBtnHasSelection = null;
    syncCaptureButtonsState(true);
  }

  function createOrUpdateBanner(text, bgColor = "#0f172a") {
    if (isInstanceDisposed || !document.body) return;
    ensureTopBar();

    if (
      topBarContainer &&
      statusBanner &&
      lastBannerText === text &&
      lastBannerBg === bgColor
    ) {
      return;
    }

    lastBannerText = text;
    lastBannerBg = bgColor;

    if (topBarContainer) {
      topBarContainer.style.background = bgColor;
    }
    if (statusBanner) {
      statusBanner.textContent = text;
    }
  }

  function observeRootContainer() {
    if (isInstanceDisposed || !document.body) return;
    if (rootContainerObserver) {
      rootContainerObserver.disconnect();
    }

    rootContainerObserver = new MutationObserver((mutations) => {
      if (isInstanceDisposed) return;

      let topBarRemoved = false;
      let appContainerChanged = false;

      for (let i = 0; i < mutations.length; i++) {
        const record = mutations[i];
        for (let j = 0; j < record.removedNodes.length; j++) {
          const node = record.removedNodes[j];
          if (node === topBarContainer || (node.nodeType === 1 && node.id === "leopoldina-wa-topbar")) {
            topBarRemoved = true;
          }
          if (node === dispatchObserverTarget || (node.nodeType === 1 && (node.id === "app" || node.id === "main"))) {
            appContainerChanged = true;
          }
        }
        for (let j = 0; j < record.addedNodes.length; j++) {
          const node = record.addedNodes[j];
          if (node.nodeType === 1 && (node.id === "app" || node.id === "main")) {
            appContainerChanged = true;
          }
        }
      }

      if (topBarRemoved && (!topBarContainer || !document.body.contains(topBarContainer))) {
        ensureTopBar();
      }

      if (appContainerChanged && activeDispatch && !hasReportedOutcome) {
        ensureDispatchObserverConnected();
      }
    });

    rootContainerObserver.observe(document.body, {
      childList: true,
      subtree: false,
    });
  }

  function onSelectionChange() {
    if (isInstanceDisposed) return;
    const selectedText = getSelectedWhatsAppText();
    const hasSelection = selectedText.length >= 2;
    if (lastCaptureBtnHasSelection === hasSelection) {
      return;
    }
    if (selectionDebounceTimer !== null) {
      cancelScheduledTimeout(selectionDebounceTimer);
    }
    selectionDebounceTimer = scheduleTimeout(() => {
      selectionDebounceTimer = null;
      syncCaptureButtonsState(false);
    }, 60);
  }

  document.addEventListener("selectionchange", onSelectionChange);

  function normalizePhoneDigits(value) {
    if (typeof value !== "string") return "";
    return value.replace(/\D/g, "");
  }

  function samePhone(a, b) {
    const da = normalizePhoneDigits(a);
    const db = normalizePhoneDigits(b);
    if (!da || !db) return false;
    if (da === db) return true;
    const stripCountry = (v) => (v.startsWith("55") && v.length >= 12 ? v.slice(2) : v);
    const na = stripCountry(da);
    const nb = stripCountry(db);
    if (na === nb) return true;
    if (na.length >= 10 && nb.length >= 10 && na.slice(0, 2) === nb.slice(0, 2)) {
      const stripNinth = (v) => (v.length === 11 && v[2] === "9" ? v.slice(0, 2) + v.slice(3) : v);
      return stripNinth(na) === stripNinth(nb);
    }
    return false;
  }

  const SEND_BUTTON_SELECTOR = [
    'span[data-icon="wds-ic-send-filled"]',
    'span[data-icon="send"]',
    'span[data-icon*="send"]',
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]',
    'div[role="button"][aria-label*="Enviar"]',
    'div[role="button"][aria-label*="Send"]',
    '[data-testid="compose-btn-send"]',
    'button[data-tab="11"]',
  ].join(", ");

  function isVoiceOrMicButton(el) {
    if (!el) return false;
    const checkAttrs = (node) => {
      if (!node || typeof node.getAttribute !== "function") return false;
      const label = (
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.getAttribute("data-testid") ||
        node.getAttribute("data-icon") ||
        ""
      ).toLowerCase();
      return (
        label.includes("voz") ||
        label.includes("voice") ||
        label.includes("microfone") ||
        label.includes("microphone") ||
        label.includes("áudio") ||
        label.includes("audio") ||
        label.includes("ptt") ||
        label.includes("mic") ||
        label.includes("gravar")
      );
    };
    if (checkAttrs(el)) return true;
    const parentBtn =
      typeof el.closest === "function" ? el.closest('button, div[role="button"]') : null;
    if (parentBtn && checkAttrs(parentBtn)) return true;
    const scope = parentBtn || el;
    if (typeof scope.querySelector === "function") {
      const micIcon = scope.querySelector(
        'span[data-icon*="ptt"], span[data-icon*="mic"], span[data-icon*="voice"], [data-testid*="ptt"]'
      );
      if (micIcon) return true;
    }
    return false;
  }

  function normalizeMessageText(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/\n?\s*\d{1,2}:\d{2}\s*$/g, "")
      .replace(/[*_~`]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isCompatibleDispatchText(actualText, expectedText) {
    const normActual = normalizeMessageText(actualText);
    const normExpected = normalizeMessageText(expectedText);
    if (!normActual || !normExpected) return false;
    if (normActual === normExpected) return true;
    if (normActual.includes(normExpected) || normExpected.includes(normActual)) {
      return true;
    }
    const minPrefix = Math.min(24, normExpected.length, normActual.length);
    if (minPrefix >= 10 && normActual.slice(0, minPrefix) === normExpected.slice(0, minPrefix)) {
      return true;
    }
    return false;
  }

  function extractUrlIntendedText() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return (params.get("text") || "").trim();
    } catch {
      return "";
    }
  }

  function extractUrlIntendedPhone() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const p = normalizePhoneDigits(params.get("phone") || "");
      return p.length >= 10 ? p : "";
    } catch {
      return "";
    }
  }

  function isPresenceOrSubtitleText(value) {
    if (!value) return true;
    return /^(online|visto por|last seen|digitando|typing|clique aqui|click here|dados do contato|contact info|conta comercial|business account)/i.test(
      value.trim()
    );
  }

  function getHeaderTitle(mainEl) {
    const scope = mainEl || document.querySelector("#main");
    if (!scope) return null;
    const primaryEl = scope.querySelector(
      'header [data-testid="conversation-info-header-chat-title"], header span[title]'
    );
    if (primaryEl) {
      const raw = (primaryEl.getAttribute("title") || primaryEl.textContent || "").trim();
      if (raw && !isPresenceOrSubtitleText(raw)) return raw;
    }

    const candidates = scope.querySelectorAll('header span[dir="auto"]');
    for (let i = 0; i < candidates.length; i++) {
      const text = (candidates[i].getAttribute("title") || candidates[i].textContent || "").trim();
      if (text && !isPresenceOrSubtitleText(text)) {
        return text;
      }
    }
    return null;
  }

  /**
   * Verifica se há modal de número inválido ("O número de telefone compartilhado através de url é inválido")
   */
  function checkInvalidNumberDialog() {
    const root = document.getElementById("app") || document.body;
    if (!root) return false;

    const dialogs = root.querySelectorAll(
      'div[role="dialog"], div[data-animate-modal-popup="true"]'
    );
    for (let i = 0; i < dialogs.length; i++) {
      const dialog = dialogs[i];
      const rawText = (dialog.textContent || "").toLowerCase();
      if (!rawText) continue;
      if (
        rawText.includes("número de telefone compartilhado") ||
        rawText.includes("phone number shared via url is invalid") ||
        rawText.includes("não está no whatsapp") ||
        rawText.includes("isn't on whatsapp") ||
        rawText.includes("url é inválido") ||
        rawText.includes("url is invalid")
      ) {
        return true;
      }
    }
    return false;
  }

  function extractExplicitMainPhoneJid(mainEl) {
    const scope = mainEl || document.querySelector("#main");
    if (!scope) return null;

    const mainDataId = scope.getAttribute("data-id") || "";
    const mainJidMatch = mainDataId.match(/(?:true_|false_)?(\d{10,15})@c\.us/);
    if (mainJidMatch && mainJidMatch[1]) {
      return mainJidMatch[1];
    }

    const idNodes = scope.querySelectorAll("[data-id]");
    for (let i = idNodes.length - 1; i >= 0; i--) {
      const dataId = idNodes[i].getAttribute("data-id") || "";
      const jidMatch = dataId.match(/(?:true_|false_)?(\d{10,15})@c\.us/);
      if (jidMatch && jidMatch[1]) {
        return jidMatch[1];
      }
    }
    return null;
  }

  /**
   * Extrai a correlação da conversa ativa no painel #main.
   * Prioriza o cabeçalho visível da conversa (#main header) para detectar imediatamente
   * trocas de conversa para outros números ou contatos nomeados.
   */
  function extractActiveChatCorrelation() {
    let activeChatTitle = null;
    let phone = null;

    try {
      const mainEl = document.querySelector("#main");
      activeChatTitle = getHeaderTitle(mainEl);

      // 1. Se o cabeçalho visível de #main contém dígitos de telefone, ele é a fonte primária da conversa aberta
      if (activeChatTitle) {
        const titleDigits = normalizePhoneDigits(activeChatTitle);
        if (titleDigits.length >= 10 && titleDigits.length <= 15) {
          phone = titleDigits;
          return { phone, activeChatTitle };
        }
      }

      // 2. Se #main possui cabeçalho com nome salvo (sem dígitos), verifica se o cabeçalho mudou
      // desde a abertura do despacho ou se a usuária trocou de conversa na barra lateral
      if (
        userSwitchedChat ||
        (activeChatTitle &&
          initialVerifiedHeaderTitle &&
          activeChatTitle !== initialVerifiedHeaderTitle)
      ) {
        return { phone: null, activeChatTitle };
      }

      // 3. Verifica data-id @c.us no próprio painel #main ou na última mensagem quando o título não contradiz a sessão
      if (mainEl) {
        const jidPhone = extractExplicitMainPhoneJid(mainEl);
        if (jidPhone) {
          phone = jidPhone;
          return { phone, activeChatTitle };
        }
      }

      // 4. Fallback para o parâmetro phone da URL (/send?phone=...) apenas se o cabeçalho não trocou para outra conversa
      if (!phone) {
        const urlPhone = extractUrlIntendedPhone();
        if (
          urlPhone &&
          (!activeChatTitle || !initialVerifiedHeaderTitle || activeChatTitle === initialVerifiedHeaderTitle)
        ) {
          phone = urlPhone;
        }
      }
    } catch {}

    return { phone, activeChatTitle };
  }

  /**
   * Verifica se a conversa atualmente aberta em #main pertence ao destinatário do activeDispatch.
   * Suporta tanto cabeçalhos com número visível quanto conversas com contato salvo/pushName, @lid ou 0 mensagens
   * após o WhatsApp Web remover ?phone= da URL via history.replaceState, bloqueando qualquer divergência explícita.
   */
  function isDispatchConversationVerified() {
    if (isInstanceDisposed || !activeDispatch || !activeDispatch.phone || userSwitchedChat) {
      return false;
    }
    const mainEl = document.querySelector("#main");
    if (!mainEl) return false;

    const currentTitle = getHeaderTitle(mainEl);
    if (currentTitle) {
      const currentTitleDigits = normalizePhoneDigits(currentTitle);
      if (currentTitleDigits.length >= 10 && currentTitleDigits.length <= 15) {
        if (!samePhone(currentTitleDigits, activeDispatch.phone)) {
          return false;
        }
        if (!initialVerifiedHeaderTitle) {
          initialVerifiedHeaderTitle = currentTitle;
        }
        return true;
      }

      if (initialVerifiedHeaderTitle && currentTitle !== initialVerifiedHeaderTitle) {
        return false;
      }
    }

    const jidPhone = extractExplicitMainPhoneJid(mainEl);
    if (jidPhone) {
      if (!samePhone(jidPhone, activeDispatch.phone)) {
        return false;
      }
      if (currentTitle && !initialVerifiedHeaderTitle) {
        initialVerifiedHeaderTitle = currentTitle;
      }
      return true;
    }

    const urlPhone = extractUrlIntendedPhone();
    if (urlPhone) {
      if (!samePhone(urlPhone, activeDispatch.phone)) {
        return false;
      }
      if (currentTitle && !initialVerifiedHeaderTitle) {
        initialVerifiedHeaderTitle = currentTitle;
      }
      return true;
    }

    // Aba dedicada autorizada pelo background após history.replaceState limpar ?phone= e sem @c.us (ex.: @lid ou 1º contato)
    if (currentTitle && !initialVerifiedHeaderTitle) {
      initialVerifiedHeaderTitle = currentTitle;
    }
    return true;
  }

  function getOutgoingBubblesInMain(mainEl) {
    const scope = mainEl || document.querySelector("#main");
    if (!scope) return [];
    let raw = Array.from(
      scope.querySelectorAll("div.message-out, div[data-id^='true_']")
    );
    if (raw.length === 0) {
      const statusIcons = scope.querySelectorAll(
        'span[data-icon="msg-time"], span[data-icon="msg-check"], span[data-icon="msg-dblcheck"], span[data-icon^="status-"], span[data-icon*="status-"], span[data-icon*="check"], span[aria-label*="Entregue"], span[aria-label*="Lida"], span[aria-label*="Enviada"]'
      );
      const containers = [];
      for (let i = 0; i < statusIcons.length; i++) {
        const row = statusIcons[i].closest('[role="row"], [data-testid="msg-container"], div[data-id]');
        if (row && !containers.includes(row)) {
          containers.push(row);
        }
      }
      raw = containers;
    }
    if (raw.length <= 1) return raw;
    return raw.filter(
      (el, idx) => !raw.some((other, otherIdx) => otherIdx !== idx && other.contains(el))
    );
  }

  function getBubbleIdentifier(bubbleEl) {
    if (!bubbleEl) return "";
    const direct = bubbleEl.getAttribute("data-id") || bubbleEl.id;
    if (direct) return direct;
    const ancestorWithId =
      typeof bubbleEl.closest === "function" ? bubbleEl.closest("[data-id]") : null;
    return ancestorWithId ? ancestorWithId.getAttribute("data-id") || "" : "";
  }

  function extractBubbleBodyText(bubbleEl) {
    if (!bubbleEl) return "";
    try {
      const selectableSpans = Array.from(
        bubbleEl.querySelectorAll(
          "span.selectable-text.copyable-text, span.selectable-text"
        )
      );
      if (selectableSpans.length > 0) {
        const joined = selectableSpans
          .map((s) => (s.textContent || "").trim())
          .filter(Boolean)
          .join("\n");
        if (joined) return joined;
      }
      const clone = bubbleEl.cloneNode(true);
      const metas = clone.querySelectorAll('[data-testid="msg-meta"]');
      metas.forEach((m) => m.remove());
      return (clone.textContent || "").replace(/\n?\s*\d{1,2}:\d{2}\s*$/, "").trim();
    } catch {
      return "";
    }
  }

  function getComposeBoxElement(mainEl) {
    const scope = mainEl || document.querySelector("#main");
    if (!scope) return null;
    return scope.querySelector(
      'footer div[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-tab="10"]'
    );
  }

  function getComposeBoxText(mainEl) {
    const box = getComposeBoxElement(mainEl);
    if (!box) return "";
    return (box.textContent || "").trim();
  }

  function findSendButton(mainEl) {
    const scope = mainEl || document.querySelector("#main");
    if (!scope) return null;
    const candidates = scope.querySelectorAll(SEND_BUTTON_SELECTOR);
    for (let i = 0; i < candidates.length; i++) {
      const raw = candidates[i];
      if (isVoiceOrMicButton(raw)) continue;
      const btn =
        (typeof raw.closest === "function" && raw.closest('button, div[role="button"]')) || raw;
      if (isVoiceOrMicButton(btn)) continue;
      return btn;
    }
    return null;
  }

  function simulateNativeClick(el) {
    if (!el || isVoiceOrMicButton(el)) return;
    if (typeof el.click === "function") {
      el.click();
    }
  }

  /**
   * Registra a linha de base das mensagens enviadas existentes em #main antes do envio atual.
   * Uma vez que uma ação de envio foi acionada (sendActionTriggered), congela a linha de base
   * para nunca absorver a própria bolha recém-enviada.
   */
  function ensureBaselineForMain(mainEl) {
    const scope = mainEl || document.querySelector("#main");
    if (!scope) return;

    const composeText = getComposeBoxText(scope);
    if (composeText) {
      lastCapturedComposeText = composeText;
      composeBoxHadTextBeforeSend = true;
    }

    if (baselineCapturedForMain === scope || sendActionTriggered) {
      return;
    }

    baselineCapturedForMain = scope;
    const existing = getOutgoingBubblesInMain(scope);
    baselineOutgoingNodes = new WeakSet(existing);
    baselineOutgoingIds = new Set();
    for (let i = 0; i < existing.length; i++) {
      const id = getBubbleIdentifier(existing[i]);
      if (id) baselineOutgoingIds.add(id);
    }
    baselineLastOutgoingNode = existing.length > 0 ? existing[existing.length - 1] : null;

    const currentTitle = getHeaderTitle(scope);
    if (currentTitle && !initialVerifiedHeaderTitle) {
      const titleDigits = normalizePhoneDigits(currentTitle);
      if (!titleDigits || (activeDispatch && samePhone(titleDigits, activeDispatch.phone))) {
        initialVerifiedHeaderTitle = currentTitle;
      }
    }
  }

  /**
   * Avalia se há evidência concreta de uma nova mensagem enviada no final da conversa correlacionada.
   * Nunca confirma por histórico antigo carregado no topo, conversa trocada, clique isolado ou tempo fixo.
   */
  function evaluateSendConfirmation(triggerSource, expectedGen) {
    if (isInstanceDisposed || !activeDispatch || hasReportedOutcome) return false;
    if (expectedGen !== undefined && activeDispatch.generation !== expectedGen) return false;

    const mainEl = document.querySelector("#main");
    if (!mainEl) return false;

    if (!isDispatchConversationVerified()) {
      return false;
    }

    const currentMessages = getOutgoingBubblesInMain(mainEl);
    if (currentMessages.length > 0) {
      const lastBubble = currentMessages[currentMessages.length - 1];
      if (lastBubble && !baselineOutgoingNodes.has(lastBubble)) {
        const lastBubbleId = getBubbleIdentifier(lastBubble);
        const isInBaselineIds = Boolean(lastBubbleId && baselineOutgoingIds.has(lastBubbleId));
        if (!isInBaselineIds) {
          let jidMatches = true;
          if (lastBubbleId) {
            const jidMatch = lastBubbleId.match(/(?:true_|false_)?(\d{10,15})@c\.us/);
            if (jidMatch && jidMatch[1] && !samePhone(jidMatch[1], activeDispatch.phone)) {
              jidMatches = false;
            }
          }

          let orderMatches = true;
          if (baselineLastOutgoingNode && mainEl.contains(baselineLastOutgoingNode)) {
            const pos = baselineLastOutgoingNode.compareDocumentPosition(lastBubble);
            if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) {
              orderMatches = false;
            }
          }

          if (jidMatches && orderMatches) {
            const bubbleText = extractBubbleBodyText(lastBubble);
            const hasReferenceText = Boolean(expectedMessageText || lastCapturedComposeText);

            let textMatches = false;
            if (bubbleText && hasReferenceText) {
              const matchesExpected =
                Boolean(expectedMessageText) &&
                isCompatibleDispatchText(bubbleText, expectedMessageText);
              const matchesComposed =
                Boolean(lastCapturedComposeText) &&
                isCompatibleDispatchText(bubbleText, lastCapturedComposeText);
              textMatches = matchesExpected || matchesComposed;
            } else if (sendActionTriggered) {
              textMatches = true;
            }

            if (textMatches) {
              reportOutcome(
                "SENT",
                {
                  trigger: triggerSource || "DOM_NEW_BOTTOM_OUTGOING_VERIFIED",
                  messageId: lastBubbleId || null,
                },
                activeDispatch.generation
              );
              return true;
            }
          }
        }
      }
    }

    // Caminho complementar: quando o disparo de envio (auto ou manual) ocorreu nesta conversa verificada,
    // a caixa de composição possuía o texto antes do envio e foi esvaziada pelo WhatsApp Web (e o botão Enviar sumiu)
    if (
      sendActionTriggered &&
      composeBoxHadTextBeforeSend &&
      getComposeBoxText(mainEl).length === 0 &&
      !findSendButton(mainEl) &&
      !checkInvalidNumberDialog()
    ) {
      reportOutcome(
        "SENT",
        {
          trigger: triggerSource || "COMPOSE_CONSUMED_VERIFIED",
          messageId: null,
        },
        activeDispatch.generation
      );
      return true;
    }

    return false;
  }

  function disconnectDispatchObserver() {
    if (dispatchObserverThrottleTimer !== null) {
      cancelScheduledTimeout(dispatchObserverThrottleTimer);
      dispatchObserverThrottleTimer = null;
    }
    if (dispatchObserver) {
      dispatchObserver.disconnect();
      dispatchObserver = null;
    }
    dispatchObserverTarget = null;
  }

  function stopDispatchMonitoring(reason = "STOPPED") {
    if (autoSendTimer !== null) {
      clearInterval(autoSendTimer);
      autoSendTimer = null;
    }
    autoSendInFlight = false;
    spaSwitchPending = false;
    spaFallbackUrl = "";
    spaFallbackTriggered = false;
    disconnectDispatchObserver();
    if (reason === "CANCELLED" || reason === "EXPIRED") {
      activeDispatch = null;
      sendActionTriggered = false;
      composeBoxHadTextBeforeSend = false;
      autoSendTriggered = false;
    }
  }

  /**
   * Envia o resultado verificado para o background script e encerra imediatamente o monitoramento.
   */
  function reportOutcome(outcome, details = {}, expectedGen = dispatchGeneration) {
    if (isInstanceDisposed || hasReportedOutcome || !activeDispatch) return;
    if (activeDispatch.generation !== expectedGen) return;

    const dispatchSnapshot = activeDispatch;
    hasReportedOutcome = true;
    lastCompletedRequestId = dispatchSnapshot.requestId;

    stopDispatchMonitoring(outcome);

    if (outcome === "SENT") {
      createOrUpdateBanner(
        `✅ Mensagem enviada para ${dispatchSnapshot.studentName || dispatchSnapshot.phone}! Registrando na plataforma...`,
        "#059669"
      );
    } else if (outcome === "FAILED_NO_WHATSAPP") {
      createOrUpdateBanner(
        `⚠️ O número ${dispatchSnapshot.phone || ""} não possui WhatsApp ativo. Prontuário atualizado automaticamente.`,
        "#dc2626"
      );
    }

    chrome.runtime
      .sendMessage({
        type: "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME",
        outcome,
        requestId: dispatchSnapshot.requestId,
        logId: dispatchSnapshot.logId,
        studentId: dispatchSnapshot.studentId,
        studentName: dispatchSnapshot.studentName,
        phone: dispatchSnapshot.phone,
        timestamp: Date.now(),
        ...details,
      })
      .catch(() => {});
  }

  /**
   * Aciona o botão nativo de envio (ou tecla Enter na caixa de texto) somente após validar a conversa.
   * Nunca clica em botões de microfone/voz e nunca repete clique após o campo de texto esvaziar.
   */
  function triggerSendAction(sendBtn, composeBox, currentGen) {
    if (isInstanceDisposed || autoSendTriggered || hasReportedOutcome || !activeDispatch) {
      autoSendInFlight = false;
      return;
    }
    if (activeDispatch.generation !== currentGen || !isDispatchConversationVerified()) {
      autoSendInFlight = false;
      return;
    }

    const mainEl = document.querySelector("#main");
    ensureBaselineForMain(mainEl);

    const currentComposeText = getComposeBoxText(mainEl);
    if (currentComposeText) {
      lastCapturedComposeText = currentComposeText;
      composeBoxHadTextBeforeSend = true;
    }

    if (sendBtn && isVoiceOrMicButton(sendBtn)) {
      sendBtn = null;
    }
    if (!sendBtn && !currentComposeText) {
      autoSendInFlight = false;
      return;
    }

    autoSendTriggered = true;
    sendActionTriggered = true;

    createOrUpdateBanner(
      `🚀 Enviando mensagem para ${activeDispatch?.studentName || activeDispatch?.phone || "responsável"}...`,
      "#0284c7"
    );

    if (sendBtn) {
      simulateNativeClick(sendBtn);
      scheduleTimeout(() => {
        autoSendInFlight = false;
        if (isInstanceDisposed || hasReportedOutcome || !activeDispatch || activeDispatch.generation !== currentGen) {
          return;
        }
        if (evaluateSendConfirmation("AUTO_SEND_BUTTON", currentGen)) {
          return;
        }
        const remainingBox = getComposeBoxElement();
        if (remainingBox && getComposeBoxText().length > 0) {
          remainingBox.focus();
          const enterEvent = new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          });
          remainingBox.dispatchEvent(enterEvent);
          scheduleTimeout(() => {
            evaluateSendConfirmation("AUTO_SEND_ENTER_FALLBACK", currentGen);
          }, 300);
        }
      }, 350);
    } else if (composeBox) {
      composeBox.focus();
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      composeBox.dispatchEvent(enterEvent);
      scheduleTimeout(() => {
        autoSendInFlight = false;
        evaluateSendConfirmation("AUTO_SEND_DIRECT_ENTER", currentGen);
      }, 350);
    } else {
      autoSendInFlight = false;
    }
  }

  function scheduleManualSendVerification(triggerSource, currentGen) {
    const delays = [150, 450, 900];
    for (let i = 0; i < delays.length; i++) {
      scheduleTimeout(() => {
        evaluateSendConfirmation(triggerSource, currentGen);
      }, delays[i]);
    }
  }

  function handleDocClick(e) {
    if (isInstanceDisposed || !activeDispatch || hasReportedOutcome) return;
    const target = e.target;
    if (!target || typeof target.closest !== "function") return;
    if (topBarContainer && topBarContainer.contains(target)) return;

    if (target.closest('#pane-side, [data-testid="chat-list"], [aria-label*="Lista de conversas"]')) {
      userSwitchedChat = true;
      return;
    }

    const sendBtn = target.closest(SEND_BUTTON_SELECTOR);
    if (sendBtn && !isVoiceOrMicButton(sendBtn) && isDispatchConversationVerified()) {
      const currentGen = activeDispatch.generation;
      const mainEl = document.querySelector("#main");
      ensureBaselineForMain(mainEl);
      const currentComposeText = getComposeBoxText(mainEl);
      if (currentComposeText) {
        lastCapturedComposeText = currentComposeText;
        composeBoxHadTextBeforeSend = true;
      }
      sendActionTriggered = true;
      scheduleManualSendVerification("MANUAL_SEND_BUTTON_CLICK", currentGen);
    }
  }

  function isComposeInputTarget(node) {
    if (!node) return false;
    if (typeof node.getAttribute === "function") {
      if (
        node.getAttribute("contenteditable") === "true" ||
        node.getAttribute("role") === "textbox"
      ) {
        return true;
      }
    }
    if (typeof node.closest === "function") {
      return Boolean(node.closest('div[contenteditable="true"], [role="textbox"]'));
    }
    return false;
  }

  function handleDocKeydown(e) {
    if (isInstanceDisposed || !activeDispatch || hasReportedOutcome) return;
    if (e.key === "Enter" && !e.shiftKey) {
      if (
        (isComposeInputTarget(e.target) || isComposeInputTarget(document.activeElement)) &&
        isDispatchConversationVerified()
      ) {
        const currentGen = activeDispatch.generation;
        const mainEl = document.querySelector("#main");
        ensureBaselineForMain(mainEl);
        const currentComposeText = getComposeBoxText(mainEl);
        if (currentComposeText) {
          lastCapturedComposeText = currentComposeText;
          composeBoxHadTextBeforeSend = true;
        }
        sendActionTriggered = true;
        scheduleManualSendVerification("MANUAL_ENTER_KEY_PRESS", currentGen);
      }
    }
  }

  function ensureDispatchObserverConnected() {
    if (isInstanceDisposed || !activeDispatch || hasReportedOutcome) {
      disconnectDispatchObserver();
      return;
    }

    const desiredTarget =
      document.getElementById("app") || document.body;
    if (!desiredTarget) return;

    if (dispatchObserver && dispatchObserverTarget === desiredTarget) {
      return;
    }

    disconnectDispatchObserver();
    dispatchObserverTarget = desiredTarget;
    const currentGen = activeDispatch.generation;

    dispatchObserver = new MutationObserver((mutations) => {
      if (isInstanceDisposed || !activeDispatch || hasReportedOutcome || activeDispatch.generation !== currentGen) {
        disconnectDispatchObserver();
        return;
      }

      let hasRelevantMutation = false;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (topBarContainer && (m.target === topBarContainer || topBarContainer.contains(m.target))) {
          continue;
        }
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
          hasRelevantMutation = true;
          break;
        }
      }

      if (!hasRelevantMutation) return;
      if (dispatchObserverThrottleTimer !== null) return;

      dispatchObserverThrottleTimer = scheduleTimeout(() => {
        dispatchObserverThrottleTimer = null;
        if (isInstanceDisposed || !activeDispatch || hasReportedOutcome || activeDispatch.generation !== currentGen) {
          return;
        }

        if (checkInvalidNumberDialog()) {
          reportOutcome("FAILED_NO_WHATSAPP", { trigger: "DOM_MUTATION_MODAL" }, currentGen);
          return;
        }

        const mainEl = document.querySelector("#main");
        if (mainEl && tryResolveSpaSwitch(mainEl) && isDispatchConversationVerified()) {
          ensureBaselineForMain(mainEl);
          evaluateSendConfirmation("DOM_OUTGOING_BUBBLE_DETECTED", currentGen);
        }
      }, 60);
    });

    dispatchObserver.observe(desiredTarget, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Verifica se o WhatsApp Web já está carregado e autenticado para troca SPA sem recarregar.
   */
  function isWhatsAppWebAppReadyForSpa() {
    if (isInstanceDisposed) return false;
    const appEl = document.getElementById("app");
    if (!appEl) return false;
    if (document.querySelector('[data-ref], canvas[aria-label*="QR"]')) {
      return false;
    }
    return Boolean(
      document.querySelector("#side") ||
        document.querySelector("#pane-side") ||
        document.querySelector('[data-testid="chat-list"]') ||
        document.querySelector("#main")
    );
  }

  /**
   * Dispara navegação interna via link <a href="..."> dentro da mesma instância do WhatsApp Web.
   */
  function triggerInPageSpaNavigation(targetUrl) {
    const parent = document.getElementById("app") || document.body || document.documentElement;
    if (!parent) return false;
    const anchor = document.createElement("a");
    anchor.href = targetUrl;
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    parent.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  /**
   * Aguarda a troca de conversa no #main após clique SPA antes de capturar a baseline.
   */
  function tryResolveSpaSwitch(mainEl) {
    if (!spaSwitchPending) return true;

    const elapsed = Date.now() - spaSwitchStartedAt;
    const currentTitle = mainEl ? getHeaderTitle(mainEl) : "";
    const composeText = mainEl ? getComposeBoxText(mainEl) : "";

    const titleChanged = Boolean(currentTitle && currentTitle !== spaPreviousTitle);
    const titleMatchesPhone = Boolean(
      currentTitle &&
        activeDispatch?.phone &&
        normalizePhoneDigits(currentTitle).endsWith(
          normalizePhoneDigits(activeDispatch.phone).slice(-8)
        )
    );
    const composeReady = Boolean(composeText && composeText.length > 0);

    if (titleChanged || (composeReady && (titleMatchesPhone || elapsed >= 150)) || elapsed >= 450) {
      spaSwitchPending = false;
      return true;
    }

    return false;
  }

  /**
   * Se a troca rápida SPA não abrir a conversa nem preencher o compose em 2.5s,
   * solicita ao background o fallback seguro via chrome.tabs.update({ url }).
   */
  function maybeTriggerSpaFallback(mainEl, currentGen) {
    if (
      !spaFallbackUrl ||
      spaFallbackTriggered ||
      hasReportedOutcome ||
      sendActionTriggered ||
      autoSendTriggered ||
      !activeDispatch ||
      activeDispatch.generation !== currentGen
    ) {
      return false;
    }

    const elapsed = Date.now() - spaSwitchStartedAt;
    if (elapsed < 2500) return false;

    const currentTitle = mainEl ? getHeaderTitle(mainEl) : "";
    const composeText = mainEl ? getComposeBoxText(mainEl) : "";
    const switchedOrHasText =
      Boolean(currentTitle && currentTitle !== spaPreviousTitle) ||
      Boolean(composeText && composeText.length > 0);

    if (!switchedOrHasText && chrome?.runtime?.sendMessage) {
      spaFallbackTriggered = true;
      const reqId = activeDispatch.requestId;
      const fallbackUrl = spaFallbackUrl;
      try {
        chrome.runtime.sendMessage({
          type: "LEOPOLDINA_SPA_NAVIGATE_FALLBACK",
          requestId: reqId,
          targetUrl: fallbackUrl,
        });
      } catch {}
      return true;
    }

    return false;
  }

  /**
   * Inicia o monitoramento vinculado exclusivamente à geração e identidade do despacho.
   */
  function startDispatchMonitoring(dispatch, options = {}) {
    if (isInstanceDisposed || !dispatch || !dispatch.requestId || !dispatch.logId) return;

    // Impede reinício duplicado do mesmo requestId (ex.: tabs.onUpdated após init)
    if (
      (activeDispatch && activeDispatch.requestId === dispatch.requestId) ||
      lastCompletedRequestId === dispatch.requestId
    ) {
      return;
    }

    stopDispatchMonitoring("SUPERSEDED");

    const currentGen = ++dispatchGeneration;
    activeDispatch = {
      ...dispatch,
      generation: currentGen,
    };
    hasReportedOutcome = false;
    autoSendTriggered = false;
    autoSendInFlight = false;
    sendActionTriggered = false;
    composeBoxHadTextBeforeSend = false;
    userSwitchedChat = false;
    baselineCapturedForMain = null;
    baselineOutgoingNodes = new WeakSet();
    baselineOutgoingIds = new Set();
    baselineLastOutgoingNode = null;
    initialVerifiedHeaderTitle = null;
    spaSwitchPending = Boolean(options && options.spaSwitch);
    spaPreviousTitle = options && typeof options.previousTitle === "string" ? options.previousTitle : "";
    spaSwitchStartedAt = spaSwitchPending ? Date.now() : 0;
    spaFallbackUrl = options && typeof options.fallbackUrl === "string" ? options.fallbackUrl : "";
    spaFallbackTriggered = false;
    expectedMessageText = (dispatch.text || extractUrlIntendedText() || "").trim();
    lastCapturedComposeText = "";

    const autoSendEnabled = dispatch.autoSend === true;

    createOrUpdateBanner(
      autoSendEnabled
        ? `⚡ Busca Ativa: Preparando envio automático para ${dispatch.studentName || dispatch.phone}...`
        : `🎓 Busca Ativa (${dispatch.studentName || dispatch.phone}): Confira a mensagem e clique em Enviar`,
      "#1e293b"
    );

    const mainNow = document.querySelector("#main");
    if (mainNow && tryResolveSpaSwitch(mainNow) && isDispatchConversationVerified()) {
      ensureBaselineForMain(mainNow);
    }

    ensureDispatchObserverConnected();

    let ticks = 0;
    const maxTicks = autoSendEnabled ? 45 : 150;

    autoSendTimer = setInterval(() => {
      if (isInstanceDisposed || !activeDispatch || hasReportedOutcome || activeDispatch.generation !== currentGen) {
        stopDispatchMonitoring("STOPPED");
        return;
      }

      ticks++;

      if (checkInvalidNumberDialog()) {
        reportOutcome("FAILED_NO_WHATSAPP", { trigger: "AUTO_DETECT_MODAL" }, currentGen);
        return;
      }

      const mainEl = document.querySelector("#main");
      if (maybeTriggerSpaFallback(mainEl, currentGen)) {
        return;
      }

      if (mainEl && tryResolveSpaSwitch(mainEl) && isDispatchConversationVerified()) {
        ensureBaselineForMain(mainEl);

        if (evaluateSendConfirmation("DOM_POLL_VERIFIED", currentGen)) {
          return;
        }

        if (autoSendEnabled && !autoSendTriggered && !autoSendInFlight) {
          const clickableBtn = findSendButton(mainEl);
          const composeBox = getComposeBoxElement(mainEl);
          const textContent = composeBox ? (composeBox.textContent || "").trim() : "";

          if (clickableBtn && (!composeBox || textContent.length > 0)) {
            autoSendInFlight = true;
            scheduleTimeout(() => triggerSendAction(clickableBtn, composeBox, currentGen), 250);
            return;
          }

          if (composeBox && ticks >= 4 && textContent.length > 1) {
            autoSendInFlight = true;
            scheduleTimeout(() => triggerSendAction(null, composeBox, currentGen), 250);
            return;
          }
        }
      }

      if (ticks >= maxTicks) {
        stopDispatchMonitoring("EXPIRED");
        if (!hasReportedOutcome) {
          createOrUpdateBanner(
            `⚠️ Confirmação automática encerrada para ${dispatch.studentName || dispatch.phone}. Confira a conversa e envie manualmente se necessário.`,
            "#b45309"
          );
        }
      }
    }, 600);
  }

  document.addEventListener("click", handleDocClick, true);
  document.addEventListener("keydown", handleDocKeydown, true);

  /**
   * Extrai as últimas mensagens recebidas (message-in) da conversa atualmente aberta no WhatsApp Web,
   * ou o texto selecionado manualmente pela usuária.
   */
  function extractIncomingMessagesFromDOM(expectedPhone) {
    if (isInstanceDisposed) {
      return {
        success: false,
        error: "INSTANCE_DISPOSED",
        message: "Contexto da extensão encerrado.",
      };
    }

    if (checkInvalidNumberDialog()) {
      return {
        success: false,
        error: "NUMBER_NOT_ON_WHATSAPP",
        message: "Este número não possui conta ativa no WhatsApp.",
      };
    }

    const chatCorrelation = extractActiveChatCorrelation();
    const activeChatTitle = chatCorrelation.activeChatTitle;

    if (expectedPhone) {
      if (!chatCorrelation.phone) {
        return {
          success: false,
          error: "CHAT_PHONE_UNAVAILABLE",
          activeChatTitle,
          message: "Não foi possível confirmar o número desta conversa no WhatsApp Web.",
        };
      }
      if (!samePhone(chatCorrelation.phone, expectedPhone)) {
        return {
          success: false,
          error: "CHAT_MISMATCH",
          activeChatTitle,
          detectedPhone: chatCorrelation.phone,
          message: "A conversa aberta no WhatsApp Web pertence a outro número.",
        };
      }
    }

    const selectedText = getSelectedWhatsAppText();
    if (selectedText.length >= 2) {
      return {
        success: true,
        rawText: selectedText,
        selectionUsed: true,
        domTimestamp: new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        activeChatTitle,
        phone: chatCorrelation.phone || normalizePhoneDigits(expectedPhone) || null,
        messageCount: 1,
      };
    }

    const mainEl = document.querySelector("#main");
    if (!mainEl) {
      return {
        success: false,
        error: "NO_ACTIVE_CHAT_PANEL",
        activeChatTitle,
        message: "Nenhuma conversa aberta no painel principal do WhatsApp Web.",
      };
    }

    let incomingNodes = Array.from(
      mainEl.querySelectorAll("div.message-in, div[data-id^='false_']")
    );

    if (incomingNodes.length === 0) {
      const allRows = Array.from(mainEl.querySelectorAll('[role="row"]'));
      incomingNodes = allRows.filter(
        (row) =>
          !row.querySelector("div.message-out") &&
          !row.querySelector("div[data-id^='true_']") &&
          (row.querySelector("span.selectable-text") ||
            row.querySelector("div.copyable-text"))
      );
    }

    if (incomingNodes.length === 0) {
      return {
        success: false,
        error: "NO_INCOMING_MESSAGE",
        activeChatTitle,
        phone: chatCorrelation.phone || normalizePhoneDigits(expectedPhone) || null,
        message: "Nenhuma mensagem recebida do responsável foi localizada nesta conversa.",
      };
    }

    const recentNodes = incomingNodes.slice(-6);
    const extractedMessages = [];
    let lastTimestamp = null;

    for (const node of recentNodes) {
      const prePlainNode = node.querySelector("[data-pre-plain-text]");
      if (prePlainNode) {
        const prePlain = prePlainNode.getAttribute("data-pre-plain-text") || "";
        const timeMatch = prePlain.match(/\[(\d{1,2}:\d{2})/);
        if (timeMatch) {
          lastTimestamp = timeMatch[1];
        }
      }

      const textSpans = Array.from(
        node.querySelectorAll(
          "span.selectable-text.copyable-text, span.selectable-text"
        )
      );

      let msgText = "";
      if (textSpans.length > 0) {
        msgText = textSpans
          .map((s) => (s.innerText || s.textContent || "").trim())
          .filter(Boolean)
          .join("\n");
      } else {
        const copyableDiv = node.querySelector("div.copyable-text");
        if (copyableDiv) {
          msgText = (copyableDiv.innerText || copyableDiv.textContent || "").trim();
        } else {
          const clone = node.cloneNode(true);
          const metaEls = clone.querySelectorAll('[data-testid="msg-meta"]');
          metaEls.forEach((m) => m.remove());
          msgText = (clone.innerText || clone.textContent || "").trim();
        }
      }

      msgText = msgText.replace(/\n\d{1,2}:\d{2}\s*$/, "").trim();

      if (msgText && !extractedMessages.includes(msgText)) {
        extractedMessages.push(msgText);
      }
    }

    if (extractedMessages.length === 0) {
      return {
        success: false,
        error: "EMPTY_MESSAGE_TEXT",
        activeChatTitle,
        phone: chatCorrelation.phone || normalizePhoneDigits(expectedPhone) || null,
        message:
          "As mensagens recebidas parecem ser apenas mídia/áudio sem texto selecionável. Selecione o texto manualmente ou use o campo de colagem.",
      };
    }

    return {
      success: true,
      rawText: extractedMessages.join("\n---\n"),
      selectionUsed: false,
      domTimestamp: lastTimestamp,
      activeChatTitle,
      phone: chatCorrelation.phone || normalizePhoneDigits(expectedPhone) || null,
      messageCount: extractedMessages.length,
    };
  }

  /**
   * Acionado quando a usuária clica no botão "📥 Capturar Retorno" na barra superior do WhatsApp Web.
   */
  function handleHumanCaptureButtonClick() {
    if (isInstanceDisposed || isCaptureInProgress) return;
    ensureTopBar();

    const chatCorrelation = extractActiveChatCorrelation();
    if (!chatCorrelation.phone) {
      createOrUpdateBanner("⚠️ Número da conversa indisponível. Use 'Extrair resposta' na plataforma ou copie o texto.", "#b45309");
      return;
    }

    isCaptureInProgress = true;
    if (captureActionBtn) {
      captureActionBtn.textContent = "⏳ Capturando...";
      captureActionBtn.style.background = "#0284c7";
      captureActionBtn.dataset.appliedBg = "#0284c7";
    }

    chrome.runtime.sendMessage(
      { type: "LEOPOLDINA_GET_CAPTURE_CONTEXT", phone: chatCorrelation.phone },
      (ctx) => {
        if (isInstanceDisposed) {
          isCaptureInProgress = false;
          return;
        }
        if (chrome.runtime.lastError || !ctx?.success) {
          isCaptureInProgress = false;
          createOrUpdateBanner("⚠️ Abra 'Capturar Retorno' no atendimento correspondente na plataforma antes de enviar.", "#b45309");
          lastCaptureBtnHasSelection = null;
          syncCaptureButtonsState(true);
          return;
        }

        const extraction = extractIncomingMessagesFromDOM(ctx.phone);
        chrome.runtime.sendMessage(
          {
            type: "LEOPOLDINA_PUSH_CAPTURED_REPLY",
            requestId: ctx.requestId,
            logId: ctx.logId,
            phone: ctx.phone,
            rawText: extraction.rawText || "",
            selectionUsed: Boolean(extraction.selectionUsed),
            domTimestamp: extraction.domTimestamp || null,
            activeChatTitle: extraction.activeChatTitle || chatCorrelation.activeChatTitle || null,
            extractionError: extraction.error || null,
          },
          (res) => {
            isCaptureInProgress = false;
            if (isInstanceDisposed) return;

            const hasErr = chrome.runtime.lastError || !res || !res.success;
            if (hasErr) {
              createOrUpdateBanner(
                "⚠️ Não foi possível entregar automaticamente. Abra o modal 'Capturar Retorno' na plataforma e tente novamente.",
                "#b45309"
              );
              if (captureActionBtn) {
                captureActionBtn.textContent = "⚠️ Reabra o Modal na Plataforma";
                captureActionBtn.style.background = "#b45309";
                captureActionBtn.dataset.appliedBg = "#b45309";
              }
            } else {
              const modeLabel = extraction.selectionUsed
                ? "Seleção enviada para a Plataforma!"
                : extraction.rawText
                ? ` Conversa (${extraction.activeChatTitle || "Ativa"}) enviada para a Plataforma!`
                : "Tela capturada enviada para leitura na Plataforma!";

              createOrUpdateBanner(`✅ ${modeLabel} Volte à aba do Rede Ativa.`, "#059669");
              if (captureActionBtn) {
                captureActionBtn.textContent = "✅ Enviado para a Plataforma!";
                captureActionBtn.style.background = "#059669";
                captureActionBtn.dataset.appliedBg = "#059669";
              }
            }

            scheduleTimeout(() => {
              lastCaptureBtnHasSelection = null;
              syncCaptureButtonsState(true);
            }, 3500);
          }
        );
      }
    );
  }

  function onRuntimeMessage(request, _sender, sendResponse) {
    if (isInstanceDisposed) return false;

    if (request?.type === "LEOPOLDINA_PING") {
      ensureTopBar();
      sendResponse({ pong: true, version: EXTENSION_VERSION });
      return true;
    }

    if (request?.type === "LEOPOLDINA_ACTIVATE_DISPATCH") {
      ensureTopBar();
      if (request.activeDispatch && request.activeDispatch.requestId && request.activeDispatch.logId) {
        startDispatchMonitoring(request.activeDispatch);
        sendResponse({ activated: true, requestId: request.activeDispatch.requestId });
      } else {
        sendResponse({ activated: false });
      }
      return true;
    }

    if (request?.type === "LEOPOLDINA_SPA_NAVIGATE_AND_DISPATCH") {
      ensureTopBar();
      if (
        !isWhatsAppWebAppReadyForSpa() ||
        !request.targetUrl ||
        !request.activeDispatch ||
        !request.activeDispatch.requestId ||
        !request.activeDispatch.logId
      ) {
        sendResponse({ accepted: false, reason: "WHATSAPP_NOT_READY" });
        return true;
      }

      const mainNow = document.querySelector("#main");
      const previousTitle = mainNow ? getHeaderTitle(mainNow) : "";
      startDispatchMonitoring(request.activeDispatch, {
        spaSwitch: true,
        previousTitle,
        fallbackUrl: request.targetUrl,
      });

      const clicked = triggerInPageSpaNavigation(request.targetUrl);
      if (!clicked) {
        stopDispatchMonitoring("SPA_CLICK_FAILED");
        sendResponse({ accepted: false, reason: "SPA_CLICK_FAILED" });
        return true;
      }

      sendResponse({ accepted: true, requestId: request.activeDispatch.requestId });
      return true;
    }

    if (request?.type === "LEOPOLDINA_CANCEL_DISPATCH") {
      if (!request.requestId || (activeDispatch && activeDispatch.requestId === request.requestId)) {
        stopDispatchMonitoring("CANCELLED");
        sendResponse({ cancelled: true });
      } else {
        sendResponse({ cancelled: false });
      }
      return true;
    }

    if (request?.type === "LEOPOLDINA_TRIGGER_HUMAN_CAPTURE") {
      handleHumanCaptureButtonClick();
      sendResponse({ triggered: true });
      return true;
    }

    if (request?.type === "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE") {
      ensureTopBar();
      const requestId = request.requestId || null;
      const logId = request.logId || null;
      const expectedPhone = request.phone || null;

      let attempts = 0;
      const maxAttempts = 6;

      const attemptExtract = () => {
        if (isInstanceDisposed) return;
        attempts++;
        const result = extractIncomingMessagesFromDOM(expectedPhone);

        const shouldRetry =
          !result.success &&
          attempts < maxAttempts &&
          (result.error === "NO_ACTIVE_CHAT_PANEL" ||
            result.error === "NO_INCOMING_MESSAGE" ||
            result.error === "CHAT_PHONE_UNAVAILABLE");

        if (shouldRetry) {
          scheduleTimeout(attemptExtract, 550);
          return;
        }

        if (result.success) {
          createOrUpdateBanner(
            result.selectionUsed
              ? "✅ Trecho selecionado enviado para a plataforma!"
              : `✅ Resposta de ${result.activeChatTitle || "responsável"} capturada com sucesso!`,
            "#059669"
          );
        }

        sendResponse({
          ...result,
          requestId,
          logId,
          phone: expectedPhone || result.phone || null,
        });
      };

      attemptExtract();
      return true;
    }

    return false;
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  function init() {
    if (isInstanceDisposed) return;
    ensureTopBar();
    observeRootContainer();

    const urlPhone = extractUrlIntendedPhone();

    chrome.runtime.sendMessage(
      {
        type: "LEOPOLDINA_GET_ACTIVE_DISPATCH",
        phone: urlPhone || null,
      },
      (res) => {
        if (isInstanceDisposed || chrome.runtime.lastError) return;
        const dispatch = res?.activeDispatch;
        if (!dispatch || !dispatch.requestId || !dispatch.logId) return;

        // Se já recebemos um despacho mais recente via LEOPOLDINA_ACTIVATE_DISPATCH, preserva-o
        if (activeDispatch && activeDispatch.requestId === dispatch.requestId) {
          return;
        }

        const ageMs = Date.now() - (dispatch.dispatchedAt || dispatch.timestamp || 0);
        if (ageMs < 120000) {
          startDispatchMonitoring(dispatch);
        }
      }
    );
  }

  window.__REDEATIVA_WA_CLEANUP__ = () => {
    if (isInstanceDisposed) {
      stopDispatchMonitoring("CLEANUP");
      clearAllPendingTimeouts();
      return;
    }
    isInstanceDisposed = true;
    dispatchGeneration++;

    stopDispatchMonitoring("CLEANUP");
    clearAllPendingTimeouts();

    if (rootContainerObserver) {
      rootContainerObserver.disconnect();
      rootContainerObserver = null;
    }

    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("click", handleDocClick, true);
    document.removeEventListener("keydown", handleDocKeydown, true);

    if (chrome?.runtime?.onMessage?.removeListener) {
      try {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      } catch {}
    }

    if (captureActionBtn) {
      try {
        captureActionBtn.removeEventListener("click", handleHumanCaptureButtonClick);
      } catch {}
    }

    if (topBarContainer) {
      try {
        topBarContainer.remove();
      } catch {}
    }
    const orphanBar = document.getElementById("leopoldina-wa-topbar");
    if (orphanBar) {
      try {
        orphanBar.remove();
      } catch {}
    }

    topBarContainer = null;
    statusBanner = null;
    captureActionBtn = null;
    activeDispatch = null;
    isCaptureInProgress = false;
  };

  if (document.body) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
