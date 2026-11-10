/**
 * Content Script WhatsApp Web — Sincronizador Rede Ativa (Manifest V3)
 * Injetado em web.whatsapp.com para:
 * 1. Executar o Disparo Assistido (Auto-Send) resiliente com suporte a ícones WDS e editor Lexical.
 * 2. Monitorar e confirmar automaticamente o envio de mensagens da Busca Ativa.
 * 3. Detectar diálogos nativos de número inválido ou sem conta no WhatsApp.
 * 4. Injetar o botão humano "📥 Capturar Retorno" diretamente no cabeçalho da conversa (#main header)
 *    e na barra flutuante superior, mantendo-o sempre visível ao trocar de conversa.
 */

(function () {
  "use strict";

  // Permite re-injeção limpa sem duplicar timers caso a extensão seja recarregada
  if (window.__REDEATIVA_WA_CLEANUP__) {
    try {
      window.__REDEATIVA_WA_CLEANUP__();
    } catch {}
  }

  let activeDispatch = null;
  let hasReportedOutcome = false;
  let autoSendTimer = null;
  let uiHeartbeatTimer = null;
  let domObserver = null;
  let topBarContainer = null;
  let statusBanner = null;
  let captureActionBtn = null;

  // Atualiza a aparência do botão de captura único da barra superior
  function syncCaptureButtonsState(customLabel = null, customBg = null) {
    if (!captureActionBtn) return;
    const sel = (window.getSelection()?.toString() || "").trim();
    const hasSelection = sel.length > 2;

    const label = customLabel || (hasSelection ? "📥 Enviar Selecionado" : "📥 Capturar Retorno");
    const bg = customBg || (hasSelection ? "#4f46e5" : "#059669");
    const border = hasSelection ? "#818cf8" : "#34d399";

    captureActionBtn.innerHTML = label;
    captureActionBtn.style.background = bg;
    captureActionBtn.style.borderColor = border;
  }

  // 1. Garante a barra flutuante oficial no topo direito da janela (Single Source of Truth)
  function ensureTopBar() {
    const rootTarget = document.body || document.documentElement;
    if (!rootTarget) return;

    // Limpa eventuais botões legados ou duplicados no header
    document.getElementById("leopoldina-wa-header-capture-btn")?.remove();

    const existingBar = document.getElementById("leopoldina-wa-topbar");
    if (existingBar && topBarContainer === existingBar) {
      return;
    }
    if (existingBar && topBarContainer !== existingBar) {
      existingBar.remove();
    }

    topBarContainer = document.createElement("div");
    topBarContainer.id = "leopoldina-wa-topbar";
    topBarContainer.style.cssText = `
      position: fixed !important;
      top: 8px !important;
      right: 12px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      pointer-events: auto !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    `;

    statusBanner = document.createElement("div");
    statusBanner.id = "leopoldina-wa-status-banner";
    statusBanner.style.cssText = `
      background: #0f172a !important;
      color: #f8fafc !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      padding: 6px 11px !important;
      border-radius: 999px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35) !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      white-space: nowrap !important;
    `;
    statusBanner.innerHTML = "⚡ Rede Ativa";

    captureActionBtn = document.createElement("button");
    captureActionBtn.id = "leopoldina-wa-capture-btn";
    captureActionBtn.type = "button";
    captureActionBtn.title =
      "Lê a resposta desta conversa (ou o texto selecionado com o mouse) e envia para a plataforma Rede Ativa";
    captureActionBtn.style.cssText = `
      background: #059669 !important;
      color: #ffffff !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      padding: 6px 12px !important;
      border-radius: 999px !important;
      border: 1px solid #34d399 !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      gap: 5px !important;
      white-space: nowrap !important;
    `;
    captureActionBtn.innerHTML = "📥 Capturar Retorno";

    captureActionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleHumanCaptureButtonClick();
    });

    topBarContainer.appendChild(statusBanner);
    topBarContainer.appendChild(captureActionBtn);
    rootTarget.appendChild(topBarContainer);
  }

  function createOrUpdateBanner(text, type = "info") {
    ensureTopBar();
    if (!statusBanner) return;

    let bg = "#0f172a";
    let border = "rgba(255, 255, 255, 0.15)";
    if (type === "success") {
      bg = "#065f46";
      border = "#10b981";
    } else if (type === "error") {
      bg = "#881337";
      border = "#f43f5e";
    } else if (type === "warning") {
      bg = "#78350f";
      border = "#f59e0b";
    }

    statusBanner.style.background = bg;
    statusBanner.style.borderColor = border;
    statusBanner.innerHTML = text;
  }

  function onSelectionChange() {
    syncCaptureButtonsState();
  }
  document.addEventListener("selectionchange", onSelectionChange);

  // Notifica o Background Service Worker sobre o resultado do envio
  function reportOutcome(outcome, details = {}) {
    if (hasReportedOutcome) return;
    hasReportedOutcome = true;
    if (autoSendTimer) {
      clearInterval(autoSendTimer);
      autoSendTimer = null;
    }

    const payload = {
      type: "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME",
      outcome, // "SENT" | "FAILED_NO_WHATSAPP"
      logId: activeDispatch?.logId || null,
      phone: activeDispatch?.phone || null,
      studentName: activeDispatch?.studentName || null,
      timestamp: Date.now(),
      ...details,
    };

    try {
      chrome.runtime.sendMessage(payload, () => {
        if (chrome.runtime.lastError) {
          console.warn("[Rede Ativa WA] Aviso ao comunicar background:", chrome.runtime.lastError.message);
        }
      });
    } catch (e) {
      console.warn("[Rede Ativa WA] Falha ao enviar mensagem:", e);
    }

    if (outcome === "SENT") {
      createOrUpdateBanner("✅ Envio confirmado!", "success");
    } else if (outcome === "FAILED_NO_WHATSAPP") {
      createOrUpdateBanner("⚠️ Número sem WhatsApp", "error");
    }
  }

  // Detecta diálogos de erro nativos do WhatsApp (número inválido / não cadastrado)
  function checkInvalidNumberDialog() {
    if (hasReportedOutcome) return false;

    const dialogs = document.querySelectorAll('div[role="dialog"], div[data-animate-modal-popup="true"]');
    for (const dialog of dialogs) {
      const text = (dialog.innerText || "").toLowerCase();
      if (
        text.includes("inválido") ||
        text.includes("invalido") ||
        text.includes("invalid") ||
        text.includes("não está no whatsapp") ||
        text.includes("nao esta no whatsapp") ||
        text.includes("is not on whatsapp") ||
        text.includes("phone number shared via url")
      ) {
        reportOutcome("FAILED_NO_WHATSAPP", { reason: "INVALID_NUMBER_MODAL" });

        const okBtn = dialog.querySelector('button, div[role="button"]');
        if (okBtn) {
          setTimeout(() => {
            try {
              okBtn.click();
            } catch {}
          }, 900);
        }
        return true;
      }
    }
    return false;
  }

  // Localiza o campo de digitação (Lexical Editor) no rodapé da conversa
  function findComposeBox() {
    return (
      document.querySelector('#main footer div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('footer div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('footer div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]')
    );
  }

  // Localiza o botão Enviar suportando tanto ícones clássicos quanto WhatsApp Design System (WDS)
  function findSendButton() {
    const iconEl =
      document.querySelector('#main footer span[data-icon="wds-ic-send-filled"]') ||
      document.querySelector('#main footer span[data-icon="send"]') ||
      document.querySelector('#main footer span[data-icon*="send"]') ||
      document.querySelector('span[data-icon="wds-ic-send-filled"]') ||
      document.querySelector('span[data-icon="send"]');

    if (iconEl) {
      return iconEl.closest('button, div[role="button"]') || iconEl;
    }

    return (
      document.querySelector('#main footer button[aria-label="Enviar"]') ||
      document.querySelector('#main footer button[aria-label="Send"]') ||
      document.querySelector('#main footer div[role="button"][aria-label="Enviar"]') ||
      document.querySelector('#main footer div[role="button"][aria-label="Send"]') ||
      document.querySelector('button[aria-label="Enviar"]') ||
      document.querySelector('button[aria-label="Send"]') ||
      document.querySelector('button[data-tab="11"]')
    );
  }

  // Dispara clique humano sintético + fallback de tecla Enter no editor Lexical
  function triggerSendAction() {
    if (hasReportedOutcome) return false;

    const composeBox = findComposeBox();
    const sendBtn = findSendButton();

    if (composeBox) {
      try {
        composeBox.focus();
      } catch {}
    }

    if (sendBtn) {
      try {
        const targetBtn = sendBtn.closest('button, div[role="button"]') || sendBtn;
        const mouseOpts = { bubbles: true, cancelable: true, view: window };
        targetBtn.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
        targetBtn.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
        targetBtn.dispatchEvent(new PointerEvent("pointerup", mouseOpts));
        targetBtn.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
        targetBtn.click();

        // Fallback: se após 750ms o texto ainda estiver na caixa de digitação, envia Enter no editor Lexical
        setTimeout(() => {
          if (hasReportedOutcome) return;
          const boxAfter = findComposeBox();
          const remainingText = boxAfter ? (boxAfter.textContent || boxAfter.innerText || "").trim() : "";
          if (boxAfter && remainingText.length > 2) {
            boxAfter.focus();
            const enterEvent = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            });
            boxAfter.dispatchEvent(enterEvent);
            setTimeout(() => {
              if (!hasReportedOutcome) {
                reportOutcome("SENT", { trigger: "AUTO_SEND_ENTER_FALLBACK" });
              }
            }, 500);
          } else if (!hasReportedOutcome) {
            reportOutcome("SENT", { trigger: "AUTO_SEND_BUTTON" });
          }
        }, 750);

        return true;
      } catch (err) {
        console.warn("[Rede Ativa WA] Erro ao acionar botão Enviar:", err);
      }
    }

    if (composeBox) {
      const txt = (composeBox.textContent || composeBox.innerText || "").trim();
      if (txt.length > 2) {
        try {
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
          setTimeout(() => {
            if (!hasReportedOutcome) {
              reportOutcome("SENT", { trigger: "AUTO_SEND_DIRECT_ENTER" });
            }
          }, 600);
          return true;
        } catch {}
      }
    }

    return false;
  }

  // Motor de Auto-Send com polling resiliente
  function startAutoSendLoop() {
    if (autoSendTimer) {
      clearInterval(autoSendTimer);
      autoSendTimer = null;
    }

    const shouldAutoSend = activeDispatch ? Boolean(activeDispatch.autoSend) : window.location.href.includes("text=");
    if (!shouldAutoSend) return;

    let ticks = 0;
    let sendTriggered = false;
    const maxTicks = 30;

    autoSendTimer = setInterval(() => {
      ticks++;
      if (hasReportedOutcome || ticks > maxTicks) {
        clearInterval(autoSendTimer);
        autoSendTimer = null;
        return;
      }

      if (checkInvalidNumberDialog()) {
        return;
      }

      const composeBox = findComposeBox();
      const sendBtn = findSendButton();
      const currentText = composeBox ? (composeBox.textContent || composeBox.innerText || "").trim() : "";

      if ((composeBox && currentText.length > 2) || sendBtn) {
        if (!sendTriggered) {
          sendTriggered = true;
          createOrUpdateBanner("⚡ Enviando mensagem...", "warning");
          setTimeout(() => {
            if (!hasReportedOutcome) {
              triggerSendAction();
            }
          }, 900);
        }
      }
    }, 600);
  }

  function handleDocClick(e) {
    if (hasReportedOutcome) return;
    const target = e.target;
    if (!target || typeof target.closest !== "function") return;

    const isSendButton =
      target.closest('span[data-icon="wds-ic-send-filled"]') ||
      target.closest('span[data-icon="send"]') ||
      target.closest('span[data-icon*="send"]') ||
      target.closest('button[data-tab="11"]') ||
      target.closest('button[aria-label="Enviar"]') ||
      target.closest('button[aria-label="Send"]') ||
      target.closest('div[role="button"][aria-label="Enviar"]') ||
      target.closest('div[role="button"][aria-label="Send"]') ||
      target.closest('footer button[aria-label*="Enviar"]');

    if (isSendButton) {
      setTimeout(() => {
        reportOutcome("SENT", { trigger: "BUTTON_CLICK" });
      }, 400);
    }
  }

  function handleDocKeydown(e) {
    if (hasReportedOutcome) return;
    if (e.key === "Enter" && !e.shiftKey) {
      const input = e.target;
      if (
        input &&
        (input.getAttribute?.("contenteditable") === "true" ||
          input.closest?.('footer div[contenteditable="true"]'))
      ) {
        setTimeout(() => {
          reportOutcome("SENT", { trigger: "ENTER_KEY" });
        }, 400);
      }
    }
  }

  function setupSendListeners() {
    document.addEventListener("click", handleDocClick, true);
    document.addEventListener("keydown", handleDocKeydown, true);
  }

  // Observa mudanças no DOM do chat e garante a presença contínua dos botões na interface
  function observeChatDOM() {
    let previousMessageCount = document.querySelectorAll("div.message-out, div[data-id^='true_']").length;

    domObserver = new MutationObserver(() => {
      ensureTopBar();

      if (hasReportedOutcome) return;

      checkInvalidNumberDialog();

      const currentMessages = document.querySelectorAll("div.message-out, div[data-id^='true_']");
      if (currentMessages.length > previousMessageCount) {
        previousMessageCount = currentMessages.length;
        reportOutcome("SENT", { trigger: "MESSAGE_BUBBLE_DETECTED" });
      }
    });

    if (document.body) {
      domObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  function getActiveChatTitle() {
    const headerTitleEl =
      document.querySelector("#main header span[title]") ||
      document.querySelector("#main header div[role='button'] span[title]") ||
      document.querySelector("header span[title]") ||
      document.querySelector("#main header span[dir='auto']");
    if (headerTitleEl) {
      return (headerTitleEl.getAttribute("title") || headerTitleEl.innerText || "").trim() || null;
    }
    return null;
  }

  function extractBubbleText(bubbleEl) {
    if (!bubbleEl) return "";
    const selectors = [
      ".selectable-text span",
      ".selectable-text",
      "div.copyable-text span",
      "div.copyable-text",
      "span.copyable-text",
      "span._ao3e",
      'span[dir="ltr"]',
      'span[dir="auto"]',
      "p",
    ];

    for (const selector of selectors) {
      const nodes = bubbleEl.querySelectorAll(selector);
      if (nodes && nodes.length > 0) {
        const parts = [];
        for (const n of nodes) {
          let t = (n.innerText || n.textContent || "").trim();
          // Remove timestamp isolado
          if (t && !/^\d{1,2}:\d{2}(\s*[ap]m)?$/i.test(t) && !parts.includes(t)) {
            parts.push(t);
          }
        }
        if (parts.length > 0) {
          return parts.join(" ").replace(/\n?\s*\b\d{1,2}:\d{2}(\s*[ap]m)?\b\s*$/i, "").trim();
        }
      }
    }

    const raw = (bubbleEl.innerText || bubbleEl.textContent || "").trim();
    return raw
      .replace(/^\[\d{1,2}:\d{2}[^\]]*\]\s*[^:]+:\s*/i, "")
      .replace(/\n?\s*\b\d{1,2}:\d{2}(\s*[ap]m)?\b\s*$/i, "")
      .trim();
  }

  function extractIncomingFromOpenChat() {
    const activeChatTitle = getActiveChatTitle();

    // Camada 1: Texto selecionado manualmente pela usuária na conversa
    const selectedText = (window.getSelection()?.toString() || "").trim();
    if (selectedText.length > 1) {
      return {
        success: true,
        rawText: selectedText,
        selectionUsed: true,
        domTimestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        activeChatTitle,
      };
    }

    const mainEl =
      document.querySelector("#main") ||
      document.querySelector("div[data-testid='conversation-panel-wrapper']") ||
      document.querySelector("div[role='region']");

    if (!mainEl) {
      return {
        success: false,
        activeChatTitle,
        error: "NO_CHAT_OPEN",
        message: "Nenhuma conversa está aberta no WhatsApp Web.",
      };
    }

    // Camada 2: Seletores modernos de mensagens recebidas (compatível com @lid, @c.us e message-in)
    let incomingNodes = Array.from(
      mainEl.querySelectorAll(
        "div.message-in, [class*='message-in'], div[data-id*='false_'], [data-id*='_false_']"
      )
    );

    if (incomingNodes.length === 0) {
      const allRows = Array.from(mainEl.querySelectorAll('div[role="row"], div.focusable-list-item'));
      incomingNodes = allRows.filter((row) => {
        const isOutgoing =
          row.querySelector?.(
            "div.message-out, [class*='message-out'], [data-id*='true_'], span[data-icon*='check'], span[data-icon='tail-out']"
          ) || row.matches?.("div.message-out, [class*='message-out'], [data-id*='true_']");
        const hasText = row.querySelector?.(
          ".selectable-text, .copyable-text, span._ao3e, span[dir='ltr'], span[dir='auto'], p"
        );
        return !isOutgoing && Boolean(hasText);
      });
    }

    if (incomingNodes.length === 0) {
      return {
        success: false,
        activeChatTitle,
        error: "NO_INCOMING_MESSAGE",
        message: "Conversa localizada, mas nenhuma resposta em texto foi detectada no DOM.",
      };
    }

    const recentBubbles = incomingNodes.slice(-3);
    const extractedTexts = [];
    let domTimestamp = null;

    for (const bubble of recentBubbles) {
      const txt = extractBubbleText(bubble);
      if (txt && !extractedTexts.includes(txt)) {
        extractedTexts.push(txt);
      }

      const copyableEl = bubble.querySelector?.("div.copyable-text[data-pre-plain-text]");
      if (copyableEl) {
        domTimestamp = (copyableEl.getAttribute("data-pre-plain-text") || "").trim() || domTimestamp;
      }
    }

    if (!domTimestamp) {
      const lastBubble = recentBubbles[recentBubbles.length - 1];
      const timeSpans = lastBubble ? lastBubble.querySelectorAll("span") : [];
      for (let i = timeSpans.length - 1; i >= 0; i--) {
        const text = (timeSpans[i].innerText || timeSpans[i].textContent || "").trim();
        if (/\d{1,2}:\d{2}/.test(text)) {
          domTimestamp = text;
          break;
        }
      }
    }

    const combinedText = extractedTexts.join("\n").trim();
    if (!combinedText) {
      return {
        success: false,
        activeChatTitle,
        error: "EMPTY_TEXT",
        message: "A última mensagem recebida é um áudio/imagem ou não contém texto legível.",
      };
    }

    return {
      success: true,
      rawText: combinedText,
      selectionUsed: false,
      domTimestamp,
      activeChatTitle,
    };
  }

  function handleHumanCaptureButtonClick() {
    createOrUpdateBanner("⏳ Capturando retorno...", "warning");
    syncCaptureButtonsState("⏳ Capturando...", "#d97706");
    const domExtracted = extractIncomingFromOpenChat();

    if (!domExtracted || !domExtracted.rawText || !domExtracted.rawText.trim()) {
      createOrUpdateBanner("⚠️ Nenhuma resposta em texto encontrada. Selecione a mensagem com o mouse e tente novamente.", "warning");
      syncCaptureButtonsState("⚠️ Selecione o texto", "#d97706");
      setTimeout(() => {
        syncCaptureButtonsState();
      }, 3500);
      return;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: "LEOPOLDINA_PUSH_CAPTURED_REPLY",
          rawText: domExtracted.rawText || "",
          selectionUsed: Boolean(domExtracted.selectionUsed),
          domTimestamp: domExtracted.domTimestamp || null,
          activeChatTitle: domExtracted.activeChatTitle || null,
        },
        (res) => {
          if (chrome.runtime.lastError || !res?.success) {
            createOrUpdateBanner("⚠️ Falha ao comunicar com a extensão", "error");
            syncCaptureButtonsState();
            return;
          }

          if (res.relayedCount === 0) {
            createOrUpdateBanner("⚠️ Abra o modal 'Capturar Retorno' no Rede Ativa", "warning");
            syncCaptureButtonsState("⚠️ Abra o Rede Ativa", "#d97706");
          } else {
            createOrUpdateBanner("✅ Retorno enviado ao Rede Ativa!", "success");
            syncCaptureButtonsState("✅ Retorno Enviado!", "#059669");
          }

          setTimeout(() => {
            syncCaptureButtonsState();
          }, 3000);
        }
      );
    } catch (err) {
      createOrUpdateBanner("⚠️ Falha ao enviar retorno", "error");
      syncCaptureButtonsState();
    }
  }

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.leopoldina_active_dispatch?.newValue) {
        activeDispatch = changes.leopoldina_active_dispatch.newValue;
        hasReportedOutcome = false;
        createOrUpdateBanner(
          `⚡ Busca Ativa: <strong>${activeDispatch.studentName || "Estudante"}</strong>`,
          "info"
        );
        startAutoSendLoop();
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "LEOPOLDINA_PING") {
      ensureTopBar();
      sendResponse({ pong: true });
      return false;
    }

    if (message?.type === "LEOPOLDINA_PREPARE_SCREENSHOT") {
      if (topBarContainer) {
        topBarContainer.style.visibility = message.hide ? "hidden" : "visible";
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "LEOPOLDINA_TRIGGER_HUMAN_CAPTURE") {
      handleHumanCaptureButtonClick();
      sendResponse({ triggered: true });
      return false;
    }

    if (message?.type === "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE") {
      (async () => {
        try {
          if (checkInvalidNumberDialog()) {
            sendResponse({
              success: false,
              logId: message.logId,
              phone: message.phone,
              error: "NUMBER_NOT_ON_WHATSAPP",
              message: "Este número de telefone não possui conta ativa no WhatsApp.",
            });
            return;
          }

          let mainEl = document.querySelector("#main");
          if (!mainEl) {
            const startWait = Date.now();
            while (!mainEl && Date.now() - startWait < 2500) {
              await new Promise((r) => setTimeout(r, 200));
              mainEl = document.querySelector("#main");
              if (checkInvalidNumberDialog()) {
                sendResponse({
                  success: false,
                  logId: message.logId,
                  phone: message.phone,
                  error: "NUMBER_NOT_ON_WHATSAPP",
                  message: "Este número de telefone não possui conta ativa no WhatsApp.",
                });
                return;
              }
            }
          }

          const result = extractIncomingFromOpenChat();
          sendResponse({
            ...result,
            logId: message.logId,
            phone: message.phone,
          });
        } catch (err) {
          sendResponse({
            success: false,
            logId: message.logId,
            phone: message?.phone,
            error: "EXTRACTION_EXCEPTION",
            message: err?.message || "Erro ao ler elementos da conversa.",
          });
        }
      })();
      return true;
    }
  });

  window.__REDEATIVA_WA_CLEANUP__ = () => {
    if (autoSendTimer) clearInterval(autoSendTimer);
    if (uiHeartbeatTimer) clearInterval(uiHeartbeatTimer);
    if (domObserver) domObserver.disconnect();
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("click", handleDocClick, true);
    document.removeEventListener("keydown", handleDocKeydown, true);
    document.getElementById("leopoldina-wa-topbar")?.remove();
    document.getElementById("leopoldina-wa-header-capture-btn")?.remove();
  };

  async function init() {
    try {
      ensureTopBar();
      setupSendListeners();
      observeChatDOM();

      // Heartbeat contínuo a cada 1s para garantir que a barra flutuante oficial permaneça visível após trocas de conversa
      uiHeartbeatTimer = setInterval(() => {
        ensureTopBar();
      }, 1000);

      chrome.runtime.sendMessage({ type: "LEOPOLDINA_GET_ACTIVE_DISPATCH" }, (res) => {
        if (res && res.activeDispatch) {
          activeDispatch = res.activeDispatch;
          hasReportedOutcome = false;
          createOrUpdateBanner(
            `⚡ Busca Ativa: <strong>${activeDispatch.studentName || "Estudante"}</strong>`,
            "info"
          );
          startAutoSendLoop();
        } else if (window.location.href.includes("/send") || window.location.href.includes("text=")) {
          createOrUpdateBanner("⚡ Busca Ativa • Envio Monitorado", "info");
          if (res?.autoSendDefault !== false) {
            startAutoSendLoop();
          }
        }
      });
    } catch (e) {
      console.warn("[Rede Ativa WA] Erro na inicialização:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
