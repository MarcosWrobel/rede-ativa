/**
 * Content Script Bridge — Sincronizador Leopoldina (Manifest V3)
 * Injetado na aplicação web Registro (local ou em nuvem).
 * Conecta eventos de postMessage da página web ao Background Service Worker da extensão
 * e repassa confirmações de envio de WhatsApp e extração de retornos em tempo real.
 */

(function () {
  try {
    function isTrustedSyncOrigin(origin) {
      if (!origin || typeof origin !== "string") return false;
      try {
        const parsed = new URL(origin);
        const { protocol, hostname } = parsed;
        if (protocol === "http:") {
          return (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "0.0.0.0" ||
            hostname.startsWith("192.168.") ||
            hostname.startsWith("10.") ||
            hostname.endsWith(".local")
          );
        }
        if (protocol === "https:") {
          return (
            hostname === "redeativa.app.br" ||
            hostname.endsWith(".redeativa.app.br") ||
            hostname === "redeativa.com.br" ||
            hostname.endsWith(".redeativa.com.br") ||
            hostname.endsWith(".vercel.app")
          );
        }
        return false;
      } catch {
        return false;
      }
    }

    // Limpa eventuais caches residuais de capturas anteriores na página
    try {
      sessionStorage.removeItem("redeativa_last_pushed_reply");
    } catch {}
    try {
      delete window.__REDEATIVA_LAST_PUSHED_REPLY__;
    } catch {}

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
      capabilities: [
        "WHATSAPP_DISPATCH",
        "WHATSAPP_AUTO_CONFIRMATION",
        "WHATSAPP_REPLY_EXTRACTION",
        "SERE_SYNC",
        "SERP_SCRAPER",
      ],
    };
    const targetOrigin = window.location.origin || "*";
    window.postMessage({ type: "REDEATIVA_EXTENSION_READY", ...readyPayload }, targetOrigin);
    window.postMessage({ type: "LEOPOLDINA_EXTENSION_READY", ...readyPayload }, targetOrigin);

    // 3. Escuta eventos emitidos pela aplicação Registro
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;
      if (!isTrustedSyncOrigin(event.origin)) return;

      const data = event.data;

      // 3.1 Extração de retorno do WhatsApp Web
      if (
        data.type === "REDEATIVA_EXTRACT_WHATSAPP_REPLY" ||
        data.type === "LEOPOLDINA_EXTRACT_WHATSAPP_REPLY"
      ) {
        chrome.runtime.sendMessage(
          {
            type: "LEOPOLDINA_EXTRACT_WHATSAPP_REPLY",
            logId: data.logId,
            phone: data.phone,
            studentName: data.studentName,
          },
          (response) => {
            const currentOrigin = window.location.origin;
            if (chrome.runtime.lastError) {
              const errPayload = {
                type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
                logId: data.logId,
                success: false,
                error: "EXTENSION_ERROR",
                message: chrome.runtime.lastError.message,
              };
              window.postMessage(errPayload, currentOrigin);
              window.postMessage(
                { ...errPayload, type: "LEOPOLDINA_WHATSAPP_REPLY_EXTRACTED" },
                currentOrigin
              );
              return;
            }

            const replyPayload = {
              type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
              logId: data.logId,
              ...(response || {}),
            };
            window.postMessage(replyPayload, currentOrigin);
            window.postMessage(
              { ...replyPayload, type: "LEOPOLDINA_WHATSAPP_REPLY_EXTRACTED" },
              currentOrigin
            );
          }
        );
        return;
      }

      // 3.2 Despacho de mensagem do WhatsApp
      if (
        (data.type === "REDEATIVA_DISPATCH_WHATSAPP" || data.type === "LEOPOLDINA_DISPATCH_WHATSAPP") &&
        data.url
      ) {
        // Validação defensiva prévia da URL antes de encaminhar ao service worker
        try {
          const parsed = new URL(data.url);
          const host = parsed.hostname.toLowerCase();
          if (parsed.protocol !== "https:" || (host !== "web.whatsapp.com" && host !== "wa.me" && host !== "api.whatsapp.com")) {
            console.warn("[Sincronizador Leopoldina] URL ignorada por segurança:", data.url);
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
              url: data.url,
              logId: data.logId || null,
              studentId: data.studentId || null,
              studentName: data.studentName || null,
              phone: data.phone || null,
              autoSend: data.autoSend,
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
                window.location.origin
              );
            }
          );
        });
        return;
      }

      // 3.3 Limpeza explícita de caches de captura do WhatsApp Web solicitada pela aplicação
      if (
        data.type === "REDEATIVA_CLEAR_LAST_CAPTURED_REPLY" ||
        data.type === "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY"
      ) {
        try {
          sessionStorage.removeItem("redeativa_last_pushed_reply");
        } catch {}
        try {
          delete window.__REDEATIVA_LAST_PUSHED_REPLY__;
        } catch {}
        try {
          chrome.runtime.sendMessage({ type: "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY" }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}
        return;
      }

      // 3.4 Consulta legada ao último retorno: não reenviar capturas antigas em cache (cada abertura começa limpa)
      if (
        data.type === "REDEATIVA_GET_LAST_CAPTURED_REPLY" ||
        data.type === "LEOPOLDINA_GET_LAST_CAPTURED_REPLY"
      ) {
        try {
          chrome.storage.local.remove(["leopoldina_last_captured_reply"]);
        } catch {}
        return;
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
        const currentOrigin = window.location.origin;
        window.postMessage({ type: "REDEATIVA_WHATSAPP_CONFIRMED", ...confirmPayload }, currentOrigin);
        window.postMessage({ type: "LEOPOLDINA_WHATSAPP_CONFIRMED", ...confirmPayload }, currentOrigin);
      }

      if (message?.type === "LEOPOLDINA_WHATSAPP_REPLY_PUSH_RELAY") {
        const currentOrigin = window.location.origin;
        const pushedPayload = {
          type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
          pushedFromWhatsApp: true,
          captureId: message.captureId || null,
          success: Boolean(message.success),
          logId: message.logId || null,
          phone: message.phone || null,
          studentName: message.studentName || null,
          rawText: message.rawText || "",
          selectionUsed: Boolean(message.selectionUsed),
          domTimestamp: message.domTimestamp || null,
          activeChatTitle: message.activeChatTitle || null,
          screenshotDataUrl: message.screenshotDataUrl || null,
          receivedAt: Date.now(),
        };

        window.postMessage(pushedPayload, currentOrigin);
        window.postMessage(
          { ...pushedPayload, type: "LEOPOLDINA_WHATSAPP_REPLY_EXTRACTED" },
          currentOrigin
        );
      }
    });
  } catch (err) {
    console.error("[Sincronizador Leopoldina] Falha ao inicializar bridge:", err);
  }
})();
