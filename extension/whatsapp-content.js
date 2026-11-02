/**
 * Content Script WhatsApp Web — Sincronizador Leopoldina (Manifest V3)
 * Injetado em web.whatsapp.com para:
 * 1. Monitorar e confirmar automaticamente o envio de mensagens da Busca Ativa.
 * 2. Detectar diálogos nativos de número inválido ou sem conta no WhatsApp.
 * 3. Notificar a extensão e a plataforma Registro em tempo real para avanço da fila.
 */

(function () {
  "use strict";

  let activeDispatch = null;
  let hasReportedOutcome = false;
  let statusBanner = null;

  // Cria um banner sutil de status na interface do WhatsApp Web
  function createOrUpdateBanner(text, type = "info") {
    if (!statusBanner) {
      statusBanner = document.createElement("div");
      statusBanner.id = "leopoldina-wa-status-banner";
      statusBanner.style.cssText = `
        position: fixed;
        top: 10px;
        right: 16px;
        z-index: 999999;
        background: #0f172a;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        padding: 6px 12px;
        border-radius: 999px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.3s ease;
        border: 1px solid rgba(255, 255, 255, 0.15);
      `;
      document.body.appendChild(statusBanner);
    }

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

  // Notifica o Background Service Worker sobre o resultado do envio
  function reportOutcome(outcome, details = {}) {
    if (hasReportedOutcome) return;
    hasReportedOutcome = true;

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
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          console.warn("[Leopoldina WA] Aviso ao comunicar background:", chrome.runtime.lastError.message);
        }
      });
    } catch (e) {
      console.warn("[Leopoldina WA] Falha ao enviar mensagem:", e);
    }

    if (outcome === "SENT") {
      createOrUpdateBanner("✅ Envio confirmado no Registro!", "success");
    } else if (outcome === "FAILED_NO_WHATSAPP") {
      createOrUpdateBanner("⚠️ Número sem WhatsApp / Inválido", "error");
    }
  }

  // Detecta diálogos de erro nativos do WhatsApp (número inválido / não cadastrado)
  function checkInvalidNumberDialog() {
    if (hasReportedOutcome) return;

    // Diálogos modais do WhatsApp
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
        console.warn("[Leopoldina WA] Diálogo de número inválido detectado no WhatsApp Web.");
        reportOutcome("FAILED_NO_WHATSAPP", { reason: "INVALID_NUMBER_MODAL" });

        // Tenta fechar o diálogo clicando no botão OK para não travar a janela
        const okBtn = dialog.querySelector('button, div[role="button"]');
        if (okBtn) {
          setTimeout(() => {
            try { okBtn.click(); } catch {}
          }, 1200);
        }
        return;
      }
    }
  }

  // Monitora cliques e teclas no chat para detecção imediata de envio
  function setupSendListeners() {
    // Intercepta clique no botão Enviar do WhatsApp
    document.addEventListener(
      "click",
      (e) => {
        if (hasReportedOutcome) return;
        const target = e.target;
        if (!target) return;

        const isSendButton =
          target.closest('button[data-tab="11"]') ||
          target.closest('span[data-icon="send"]') ||
          target.closest('button[aria-label="Enviar"]') ||
          target.closest('button[aria-label="Send"]') ||
          target.closest('footer button[aria-label*="Enviar"]');

        if (isSendButton) {
          console.log("[Leopoldina WA] Botão Enviar clicado pela usuária.");
          // Aguarda um pequeno instante para o balão ser criado
          setTimeout(() => {
            reportOutcome("SENT", { trigger: "BUTTON_CLICK" });
          }, 400);
        }
      },
      true
    );

    // Intercepta Enter no campo de edição
    document.addEventListener(
      "keydown",
      (e) => {
        if (hasReportedOutcome) return;
        if (e.key === "Enter" && !e.shiftKey) {
          const input = e.target;
          if (
            input &&
            (input.getAttribute("contenteditable") === "true" ||
              input.closest('footer div[contenteditable="true"]'))
          ) {
            console.log("[Leopoldina WA] Tecla Enter pressionada no chat.");
            setTimeout(() => {
              reportOutcome("SENT", { trigger: "ENTER_KEY" });
            }, 400);
          }
        }
      },
      true
    );
  }

  // Observa mudanças no DOM do chat (inserção de balão de mensagem de saída)
  function observeChatDOM() {
    let previousMessageCount = document.querySelectorAll("div.message-out").length;
    let autoSendAttempted = false;

    const observer = new MutationObserver(() => {
      if (hasReportedOutcome) return;

      // 1. Verifica se surgiu diálogo de erro
      checkInvalidNumberDialog();

      // 2. Verifica se surgiu novo balão de saída (div.message-out)
      const currentMessages = document.querySelectorAll("div.message-out");
      if (currentMessages.length > previousMessageCount) {
        previousMessageCount = currentMessages.length;
        console.log("[Leopoldina WA] Novo balão de mensagem de saída detectado!");
        reportOutcome("SENT", { trigger: "MESSAGE_BUBBLE_DETECTED" });
        return;
      }

      // 3. Assistente opcional de Auto-Clique (se configurado)
      if (activeDispatch?.autoSend && !autoSendAttempted) {
        const sendBtn =
          document.querySelector('span[data-icon="send"]') ||
          document.querySelector('button[aria-label="Enviar"]') ||
          document.querySelector('button[data-tab="11"]');

        const inputField = document.querySelector('footer div[contenteditable="true"]');
        const hasText = inputField && (inputField.innerText || "").trim().length > 3;

        if (sendBtn && hasText) {
          autoSendAttempted = true;
          createOrUpdateBanner("⚡ Disparo assistido em 1.5s...", "warning");
          setTimeout(() => {
            if (!hasReportedOutcome) {
              console.log("[Leopoldina WA] Disparo assistido automático executado.");
              try {
                sendBtn.closest("button")?.click() || sendBtn.click();
              } catch (err) {
                console.warn("[Leopoldina WA] Falha ao clicar no botão:", err);
              }
            }
          }, 1500);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Inicializa o script e busca o contexto atual
  async function init() {
    try {
      setupSendListeners();
      observeChatDOM();

      // Consulta o background para ver se há um despacho ativo para esta janela
      chrome.runtime.sendMessage({ type: "LEOPOLDINA_GET_ACTIVE_DISPATCH" }, (res) => {
        if (res && res.activeDispatch) {
          activeDispatch = res.activeDispatch;
          createOrUpdateBanner(
            `⚡ Busca Ativa Leopoldina: <strong>${activeDispatch.studentName || "Aluno"}</strong> (Monitorado)`,
            "info"
          );
        } else {
          // Se não há despacho ativo registrado, exibe indicador básico se for URL de envio
          if (window.location.href.includes("/send")) {
            createOrUpdateBanner("⚡ Busca Ativa Leopoldina — Envio Monitorado", "info");
          }
        }
      });
    } catch (e) {
      console.warn("[Leopoldina WA] Erro na inicialização:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
