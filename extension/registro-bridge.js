/**
 * Content Script Bridge — Sincronizador Rede Ativa (Manifest V3)
 * Injetado apenas nas origens autorizadas da plataforma Rede Ativa.
 * Conecta eventos postMessage da aba autorizada ao Background Service Worker da extensão
 * com validação estrita de origem, correlação obrigatória (requestId + logId), expiração e consumo único por operação.
 */

(function () {
  try {
    if (typeof window.__REDEATIVA_BRIDGE_CLEANUP__ === "function") {
      try {
        window.__REDEATIVA_BRIDGE_CLEANUP__();
      } catch {}
    }

    let isBridgeDisposed = false;
    const EXACT_TRUSTED_HTTPS_HOSTS = new Set([
      "redeativa.app.br",
      "www.redeativa.app.br",
      "app.redeativa.app.br",
      "redeativa.com.br",
      "www.redeativa.com.br",
      "app.redeativa.com.br",
      "registro-leopoldina.vercel.app",
      "busca-ativa-leopoldina.vercel.app",
    ]);

    const REQUEST_TTL_MS = 20000;
    const CAPTURE_CONTEXT_TTL_MS = 120000;
    const pendingRequests = new Map();
    const activeCaptures = new Map();
    const activeDispatches = new Map();
    const consumedRequestIds = new Set();
    function isTrustedSyncOrigin(origin) {
      if (!origin || typeof origin !== "string") return false;
      try {
        const parsed = new URL(origin);
        const protocol = parsed.protocol;
        const hostname = parsed.hostname.toLowerCase();

        if (protocol === "http:") {
          if (hostname === "localhost" || hostname === "127.0.0.1") {
            return true;
          }
        }

        if (protocol === "https:") {
          if (EXACT_TRUSTED_HTTPS_HOSTS.has(hostname)) {
            return true;
          }
        }

        return false;
      } catch {
        return false;
      }
    }

    function pruneExpiredState() {
      const now = Date.now();
      for (const [reqId, meta] of pendingRequests.entries()) {
        if (!meta || now > meta.expiresAt) {
          pendingRequests.delete(reqId);
        }
      }
      for (const [reqId, meta] of activeCaptures.entries()) {
        if (!meta || now > meta.expiresAt) {
          activeCaptures.delete(reqId);
        }
      }
      for (const [reqId, meta] of activeDispatches.entries()) {
        if (!meta || now > meta.expiresAt) {
          activeDispatches.delete(reqId);
        }
      }
      if (consumedRequestIds.size > 500) {
        const excess = consumedRequestIds.size - 400;
        let removed = 0;
        for (const id of consumedRequestIds) {
          consumedRequestIds.delete(id);
          removed++;
          if (removed >= excess) break;
        }
      }
    }

    const pageOrigin = window.location?.origin || "";
    if (!isTrustedSyncOrigin(pageOrigin)) {
      return;
    }
    const isLocalPage = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    function traceLocal(stage) {
      if (!isLocalPage) return;
      try {
        if (sessionStorage.getItem("redeativa_extension_diagnostics") !== "1") return;
        window.postMessage({ type: "REDEATIVA_EXTENSION_DIAGNOSTIC", stage }, pageOrigin);
      } catch {}
    }

    // Limpa eventuais caches residuais de capturas anteriores na página
    try {
      sessionStorage.removeItem("redeativa_last_pushed_reply");
      delete window.__REDEATIVA_LAST_PUSHED_REPLY__;
    } catch {}

    // 1. Marcação no DOM para detecção síncrona instantânea pela aplicação autorizada
    if (document.documentElement) {
      document.documentElement.dataset.redeativaExtension = "true";
      document.documentElement.dataset.redeativaExtensionVersion = "1.6.0";
      document.documentElement.dataset.leopoldinaExtension = "true";
      document.documentElement.dataset.leopoldinaExtensionVersion = "1.6.0";
    }

    // 2. Anúncio via postMessage restrito à origem exata da página
    const readyPayload = {
      version: "1.6.0",
      capabilities: [
        "WHATSAPP_TAB_REUSE",
        "WHATSAPP_AUTO_SEND",
        "WHATSAPP_REPLY_EXTRACT",
        "POWERBI_INTERCEPTOR",
        "SERP_SCRAPER",
      ],
    };
    window.postMessage({ type: "REDEATIVA_EXTENSION_READY", ...readyPayload }, pageOrigin);
    window.postMessage({ type: "LEOPOLDINA_EXTENSION_READY", ...readyPayload }, pageOrigin);

    // 3. Escuta eventos emitidos pela aplicação Rede Ativa na mesma janela e origem autorizada
    const handleWindowMessage = (event) => {
      if (isBridgeDisposed) return;
      if (event.source !== window || !event.data || typeof event.data !== "object") return;
      const currentOrigin = window.location?.origin || "";
      if (!currentOrigin || event.origin !== currentOrigin) return;
      if (!isTrustedSyncOrigin(event.origin)) return;

      const data = event.data;

      // 3.0 Registro de contexto de captura ativa (exige requestId + logId explícitos e não consumidos)
      if (
        data.type === "REDEATIVA_REGISTER_CAPTURE_CONTEXT" ||
        data.type === "LEOPOLDINA_REGISTER_CAPTURE_CONTEXT"
      ) {
        pruneExpiredState();
        const requestId =
          typeof data.requestId === "string" ? data.requestId.trim() : "";
        const logId =
          typeof data.logId === "string" ? data.logId.trim() : "";

        if (!requestId || !logId) return;
        if (consumedRequestIds.has(requestId) || activeCaptures.has(requestId)) return;

        const now = Date.now();
        activeCaptures.set(requestId, {
          requestId,
          logId,
          phone: data.phone || null,
          createdAt: now,
          expiresAt: now + CAPTURE_CONTEXT_TTL_MS,
        });

        try {
          chrome.runtime.sendMessage(
            {
              type: "LEOPOLDINA_REGISTER_CAPTURE_CONTEXT",
              requestId,
              logId,
              phone: data.phone || null,
              studentName: data.studentName || null,
            },
            () => {
              void chrome.runtime.lastError;
            }
          );
        } catch {}
        return;
      }

      // 3.1 Extração de retorno do WhatsApp Web vinculada a requestId + logId (uso único)
      if (
        data.type === "REDEATIVA_EXTRACT_WHATSAPP_REPLY" ||
        data.type === "LEOPOLDINA_EXTRACT_WHATSAPP_REPLY"
      ) {
        traceLocal("bridge.extract.received");
        pruneExpiredState();
        const requestId =
          typeof data.requestId === "string" ? data.requestId.trim() : "";
        const logId =
          typeof data.logId === "string" ? data.logId.trim() : "";

        if (!requestId || !logId) return;
        if (consumedRequestIds.has(requestId) || pendingRequests.has(requestId)) return;

        const now = Date.now();
        pendingRequests.set(requestId, {
          requestId,
          logId,
          phone: data.phone || null,
          createdAt: now,
          expiresAt: now + REQUEST_TTL_MS,
        });

        chrome.runtime.sendMessage(
          {
            type: "LEOPOLDINA_EXTRACT_WHATSAPP_REPLY",
            requestId,
            logId,
            phone: data.phone,
            studentName: data.studentName,
            diagnostics: isLocalPage && data.diagnostics === true,
          },
          (response) => {
            traceLocal("bridge.extract.response");
            const pending = pendingRequests.get(requestId);
            pendingRequests.delete(requestId);

            // Descarta se já consumido, expirado ou inexistente
            if (!pending || consumedRequestIds.has(requestId) || Date.now() > pending.expiresAt) {
              return;
            }

            if (chrome.runtime.lastError) {
              consumedRequestIds.add(requestId);
              const errPayload = {
                type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
                requestId,
                logId: pending.logId,
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

            // Exige correlação estrita na resposta do background (requestId e logId devem coincidir)
            if (!response || response.requestId !== requestId) {
              return;
            }
            if (response.logId && response.logId !== pending.logId) {
              return;
            }

            consumedRequestIds.add(requestId);

            const replyPayload = {
              type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
              ...response,
              requestId,
              logId: response.logId || pending.logId,
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

      // 3.2 Despacho de mensagem para o WhatsApp Web
      if (data.type === "LEOPOLDINA_DISPATCH_WHATSAPP" && typeof data.url === "string") {
        traceLocal("bridge.send.received");
        try {
          const parsed = new URL(data.url);
          const host = parsed.hostname.toLowerCase();
          if (
            parsed.protocol !== "https:" ||
            (host !== "web.whatsapp.com" && host !== "wa.me" && host !== "api.whatsapp.com")
          ) {
            console.warn("[Sincronizador Rede Ativa] URL ignorada por segurança:", data.url);
            return;
          }
        } catch {
          return;
        }

        pruneExpiredState();
        const requestId =
          typeof data.requestId === "string" && data.requestId.trim()
            ? data.requestId.trim()
            : `disp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const logId =
          typeof data.logId === "string" && data.logId.trim()
            ? data.logId.trim()
            : `log_${requestId}`;

        if (consumedRequestIds.has(requestId) || activeDispatches.has(requestId)) {
          return;
        }

        const now = Date.now();
        activeDispatches.set(requestId, {
          requestId,
          logId,
          phone: data.phone || null,
          createdAt: now,
          expiresAt: now + CAPTURE_CONTEXT_TTL_MS,
        });

        chrome.storage.local.get(["opt_whatsapp_tab_reuse"], (res) => {
          chrome.runtime.sendMessage(
            {
              type: "LEOPOLDINA_DISPATCH_WHATSAPP",
              requestId,
              url: data.url,
              logId,
              studentName: data.studentName || null,
              phone: data.phone || null,
              autoSend: data.autoSend,
              reuseTab: res?.opt_whatsapp_tab_reuse !== false,
              diagnostics: isLocalPage && data.diagnostics === true,
            },
            (response) => {
              traceLocal("bridge.send.response");
              if (chrome.runtime.lastError) {
                console.warn(
                  "[Sincronizador Rede Ativa] Aviso ao enviar para background:",
                  chrome.runtime.lastError.message
                );
                window.postMessage({
                  type: "LEOPOLDINA_DISPATCH_WHATSAPP_ACK",
                  requestId,
                  response: { success: false, error: "EXTENSION_ERROR" },
                }, currentOrigin);
                return;
              }

              window.postMessage(
                {
                  type: "LEOPOLDINA_DISPATCH_WHATSAPP_ACK",
                  requestId,
                  response,
                },
                currentOrigin
              );
            }
          );
        });
      }

      // 3.3 Limpeza explícita de cache ou de operação específica
      if (
        data.type === "REDEATIVA_CLEAR_LAST_CAPTURED_REPLY" ||
        data.type === "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY"
      ) {
        try {
          sessionStorage.removeItem("redeativa_last_pushed_reply");
          delete window.__REDEATIVA_LAST_PUSHED_REPLY__;
        } catch {}
        const clearReqId = typeof data.requestId === "string" ? data.requestId.trim() : "";
        if (clearReqId) {
          activeCaptures.delete(clearReqId);
        }
        try {
          chrome.runtime.sendMessage(
            {
              type: "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY",
              requestId: clearReqId || null,
            },
            () => {
              void chrome.runtime.lastError;
            }
          );
        } catch {}
        return;
      }

      // 3.4 Consulta legada ao último retorno: limpa estado residual sem reenviar cache antigo
      if (
        data.type === "REDEATIVA_GET_LAST_CAPTURED_REPLY" ||
        data.type === "LEOPOLDINA_GET_LAST_CAPTURED_REPLY"
      ) {
        try {
          sessionStorage.removeItem("redeativa_last_pushed_reply");
          delete window.__REDEATIVA_LAST_PUSHED_REPLY__;
        } catch {}
        return;
      }
    };
    window.addEventListener("message", handleWindowMessage);

    // 4. Escuta mensagens direcionadas pelo Background Service Worker exclusivamente a esta aba
    const handleRuntimeMessage = (message, sender) => {
      if (isBridgeDisposed) return;
      if (sender?.id && chrome?.runtime?.id && sender.id !== chrome.runtime.id) {
        return;
      }
      const currentOrigin = window.location?.origin || "";
      if (!isTrustedSyncOrigin(currentOrigin)) {
        return;
      }

      pruneExpiredState();

      if (message?.type === "REDEATIVA_EXTENSION_DIAGNOSTIC" && isLocalPage && [
        "background.send.registered", "background.send.opening", "background.send.opened", "background.send.error",
        "background.extract.registered", "background.extract.no_tab", "background.extract.multiple_tabs", "background.extract.tab_selected", "background.extract.reply_received",
      ].includes(message.stage)) {
        traceLocal(message.stage);
        return;
      }

      if (
        message?.type === "REDEATIVA_WHATSAPP_DISPATCH_OUTCOME_RELAY" ||
        message?.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME_RELAY"
      ) {
        const reqId = typeof message.requestId === "string" ? message.requestId.trim() : "";
        const logId = typeof message.logId === "string" ? message.logId.trim() : "";
        if (!reqId || !logId || consumedRequestIds.has(reqId)) {
          return;
        }

        const pendingDisp = activeDispatches.get(reqId);
        if (!pendingDisp || Date.now() > pendingDisp.expiresAt || pendingDisp.logId !== logId) {
          return;
        }

        activeDispatches.delete(reqId);
        consumedRequestIds.add(reqId);

        const confirmPayload = {
          outcome: message.outcome, // "SENT" | "FAILED_NO_WHATSAPP"
          requestId: reqId,
          logId,
          phone: message.phone || pendingDisp.phone || null,
          studentName: message.studentName || null,
          timestamp: message.timestamp,
        };
        window.postMessage({ type: "REDEATIVA_WHATSAPP_CONFIRMED", ...confirmPayload }, currentOrigin);
        window.postMessage({ type: "LEOPOLDINA_WHATSAPP_CONFIRMED", ...confirmPayload }, currentOrigin);
      }

      if (message?.type === "LEOPOLDINA_WHATSAPP_REPLY_PUSH_RELAY") {
        const reqId = typeof message.requestId === "string" ? message.requestId.trim() : "";
        const logId = typeof message.logId === "string" ? message.logId.trim() : "";
        if (!reqId || !logId || consumedRequestIds.has(reqId)) {
          return;
        }

        const pendingCap = activeCaptures.get(reqId);
        if (!pendingCap || Date.now() > pendingCap.expiresAt || pendingCap.logId !== logId) {
          return;
        }

        activeCaptures.delete(reqId);
        consumedRequestIds.add(reqId);

        const pushedPayload = {
          type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
          pushedFromWhatsApp: true,
          requestId: reqId,
          captureId: message.captureId || null,
          success: Boolean(message.success),
          logId,
          phone: message.phone || pendingCap.phone || null,
          studentName: message.studentName || null,
          rawText: message.rawText || "",
          selectionUsed: Boolean(message.selectionUsed),
          domTimestamp: message.domTimestamp || null,
          activeChatTitle: message.activeChatTitle || null,
          screenshotDataUrl: message.screenshotDataUrl || null,
          capturedAt: message.capturedAt || new Date().toISOString(),
          receivedAt: Date.now(),
        };

        window.postMessage(pushedPayload, currentOrigin);
        window.postMessage(
          { ...pushedPayload, type: "LEOPOLDINA_WHATSAPP_REPLY_EXTRACTED" },
          currentOrigin
        );
      }
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    window.__REDEATIVA_BRIDGE_CLEANUP__ = () => {
      if (isBridgeDisposed) return;
      isBridgeDisposed = true;
      window.removeEventListener("message", handleWindowMessage);
      if (chrome?.runtime?.onMessage?.removeListener) {
        try {
          chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
        } catch {}
      }
      pendingRequests.clear();
      activeCaptures.clear();
      activeDispatches.clear();
    };
  } catch (err) {
    console.error("[Sincronizador Rede Ativa] Falha ao inicializar bridge:", err);
  }
})();
