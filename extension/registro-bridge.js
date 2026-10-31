/**
 * Content Script Bridge — Sincronizador Leopoldina
 * Injetado na aplicação web Registro (local ou em nuvem).
 * Conecta eventos de postMessage da página web ao Background Service Worker da extensão.
 */

(function () {
  try {
    // 1. Marcação no DOM para detecção síncrona instantânea pela aplicação
    if (document.documentElement) {
      document.documentElement.dataset.leopoldinaExtension = "true";
    }

    // 2. Anúncio via postMessage para listeners ativos
    window.postMessage(
      {
        type: "LEOPOLDINA_EXTENSION_READY",
        version: "1.4.1",
      },
      "*"
    );

    // 3. Escuta eventos de despacho emitidos pela aplicação Registro
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;

      if (event.data.type === "LEOPOLDINA_DISPATCH_WHATSAPP" && event.data.url) {
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
  } catch (err) {
    console.error("[Sincronizador Leopoldina] Falha ao inicializar bridge:", err);
  }
})();
