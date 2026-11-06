/**
 * Content Script Bridge — Sincronizador Leopoldina (Manifest V3)
 * Injetado na aplicação web Registro (local ou em nuvem).
 * Conecta eventos de postMessage da página web ao Background Service Worker da extensão
 * e repassa confirmações de envio de WhatsApp em tempo real.
 */

(function () {
  try {
    // 1. Marcação no DOM para detecção síncrona instantânea pela aplicação
    if (document.documentElement) {
      document.documentElement.dataset.redeativaExtension = "true";
      document.documentElement.dataset.redeativaExtensionVersion = "1.5.0";
      document.documentElement.dataset.leopoldinaExtension = "true";
      document.documentElement.dataset.leopoldinaExtensionVersion = "1.5.0";
    }

    // 2. Anúncio via postMessage para listeners ativos
    const readyPayload = {
      version: "1.5.0",
      capabilities: ["WHATSAPP_DISPATCH", "WHATSAPP_AUTO_CONFIRMATION", "SERE_SYNC", "SERP_SCRAPER"],
    };
    window.postMessage({ type: "REDEATIVA_EXTENSION_READY", ...readyPayload }, "*");
    window.postMessage({ type: "LEOPOLDINA_EXTENSION_READY", ...readyPayload }, "*");

    // 3. Escuta eventos de despacho emitidos pela aplicação Registro
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;

      if (
        (event.data.type === "REDEATIVA_DISPATCH_WHATSAPP" || event.data.type === "LEOPOLDINA_DISPATCH_WHATSAPP") &&
        event.data.url
      ) {
        // Validação defensiva prévia da URL antes de encaminhar ao service worker
        try {
          const parsed = new URL(event.data.url);
          const host = parsed.hostname.toLowerCase();
          if (parsed.protocol !== "https:" || (host !== "web.whatsapp.com" && host !== "wa.me" && host !== "api.whatsapp.com")) {
            console.warn("[Sincronizador Leopoldina] URL ignorada por segurança:", event.data.url);
            return;
          }
        } catch {
          return;
        }

        chrome.storage.local.get(["opt_whatsapp_tab_reuse"], (res) => {
          if (res && res.opt_whatsapp_tab_reuse === false) {
            // Usuário desligou a função na extensão: opera no modo convencional
            return;
          }

          chrome.runtime.sendMessage(
            {
              type: "LEOPOLDINA_DISPATCH_WHATSAPP",
              url: event.data.url,
              logId: event.data.logId || null,
              studentId: event.data.studentId || null,
              studentName: event.data.studentName || null,
              phone: event.data.phone || null,
              autoSend: event.data.autoSend,
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn(
                  "[Sincronizador Leopoldina] Aviso ao enviar para background:",
                  chrome.runtime.lastError.message
                );
                return;
              }

              window.postMessage(
                {
                  type: "LEOPOLDINA_DISPATCH_WHATSAPP_ACK",
                  response,
                },
                "*"
              );
            }
          );
        });
      }
    });

    // 4. Escuta mensagens vindas do Background Service Worker e repassa à página web
    chrome.runtime.onMessage.addListener((message) => {
      if (
        message?.type === "REDEATIVA_WHATSAPP_DISPATCH_OUTCOME_RELAY" ||
        message?.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME_RELAY"
      ) {
        const confirmPayload = {
          outcome: message.outcome, // "SENT" | "FAILED_NO_WHATSAPP"
          logId: message.logId,
          phone: message.phone,
          studentName: message.studentName,
          timestamp: message.timestamp,
        };
        window.postMessage({ type: "REDEATIVA_WHATSAPP_CONFIRMED", ...confirmPayload }, "*");
        window.postMessage({ type: "LEOPOLDINA_WHATSAPP_CONFIRMED", ...confirmPayload }, "*");
      }
    });
  } catch (err) {
    console.error("[Sincronizador Leopoldina] Falha ao inicializar bridge:", err);
  }
})();
