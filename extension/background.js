/**
 * Background Service Worker — Sincronizador Leopoldina (Manifest V3)
 * 1. Abre o WhatsApp Web em Janela Dedicada Compacta (tipo 'popup' minimalista)
 *    posicionada no canto direito da tela, reutilizando a mesma janela durante todo o fluxo.
 * 2. Gerencia o contexto de despacho da Busca Ativa (aluno, telefone, logId).
 * 3. Faz o relay bidirecional de eventos de confirmação do WhatsApp Web para a plataforma Registro.
 */

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 760;

function isAllowedWhatsAppUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "web.whatsapp.com" || host === "wa.me" || host === "api.whatsapp.com";
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Despacho de WhatsApp da aplicação Registro para a janela dedicada
  if (request?.type === "LEOPOLDINA_DISPATCH_WHATSAPP" && request.url) {
    if (!isAllowedWhatsAppUrl(request.url)) {
      sendResponse({ success: false, error: "URL de destino não permitida. Apenas domínios WhatsApp são aceitos." });
      return false;
    }

    (async () => {
      try {
        // Armazena contexto no storage com expiração
        const storageRes = await chrome.storage.local.get(["opt_whatsapp_auto_send"]);
        const autoSendPref = Boolean(storageRes?.opt_whatsapp_auto_send);

        await chrome.storage.local.set({
          leopoldina_active_dispatch: {
            logId: request.logId || null,
            studentId: request.studentId || null,
            studentName: request.studentName || null,
            phone: request.phone || null,
            autoSend: request.autoSend !== undefined ? Boolean(request.autoSend) : autoSendPref,
            dispatchedAt: Date.now(),
          },
        });

        const result = await handleWhatsAppDispatch(request.url);
        sendResponse({ success: true, ...result });
      } catch (err) {
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true; // Mantém o canal aberto para resposta assíncrona
  }

  // 2. Consulta de contexto ativo feita pelo content script do WhatsApp Web
  if (request?.type === "LEOPOLDINA_GET_ACTIVE_DISPATCH") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(["leopoldina_active_dispatch"]);
        const dispatch = data?.leopoldina_active_dispatch;

        // Se o despacho tiver menos de 5 minutos, considera ativo
        if (dispatch && Date.now() - dispatch.dispatchedAt < 300000) {
          sendResponse({ activeDispatch: dispatch });
        } else {
          sendResponse({ activeDispatch: null });
        }
      } catch (err) {
        sendResponse({ activeDispatch: null });
      }
    })();
    return true;
  }

  // 3. Resultado de envio emitido pelo content script do WhatsApp Web
  if (request?.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME") {
    (async () => {
      try {
        console.log("[Sincronizador Leopoldina] Resultado de envio recebido:", request.outcome, request.logId);

        // Notifica todas as abas abertas da aplicação Registro
        const targetUrls = [
          "https://*.vercel.app/*",
          "https://redeativa.app.br/*",
          "https://*.redeativa.app.br/*",
          "http://localhost/*",
          "http://127.0.0.1/*",
        ];

        const tabs = await chrome.tabs.query({ url: targetUrls });
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME_RELAY",
              outcome: request.outcome,
              logId: request.logId,
              phone: request.phone,
              studentName: request.studentName,
              timestamp: request.timestamp || Date.now(),
            }).catch(() => {});
          }
        }

        // Limpa o despacho pendente
        await chrome.storage.local.remove(["leopoldina_active_dispatch"]);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err?.message });
      }
    })();
    return true;
  }
});

/**
 * Localiza qualquer janela/aba aberta do WhatsApp Web e a atualiza/foca.
 * Se nenhuma estiver aberta, cria uma Janela Dedicada Compacta (Popup Minimalista)
 * posicionada no lado direito da tela.
 */
async function handleWhatsAppDispatch(targetUrl) {
  try {
    // 1. Procura se já temos qualquer aba/janela do WhatsApp Web aberta
    const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });

    if (tabs && tabs.length > 0) {
      const existingTab = tabs[0];
      const windowId = existingTab.windowId;

      // Atualiza o chat na aba/janela já existente
      await chrome.tabs.update(existingTab.id, {
        url: targetUrl,
        active: true,
      });

      // Traz a janela dedicada para o primeiro plano imediato
      if (windowId) {
        await chrome.windows.update(windowId, { focused: true });
      }

      return {
        reusedTab: true,
        windowId,
        tabId: existingTab.id,
      };
    }

    // 2. Se nenhuma estiver aberta, calcula a posição ideal no lado direito da tela
    let left = 1000;
    let top = 40;

    try {
      const currentWin = await chrome.windows.getCurrent();
      if (currentWin && currentWin.width) {
        left = Math.max(0, (currentWin.left || 0) + currentWin.width - POPUP_WIDTH - 20);
        top = Math.max(0, (currentWin.top || 0) + 30);
      }
    } catch (e) {
      console.warn("[Sincronizador Leopoldina] Geometria da janela não obtida, usando padrão:", e);
    }

    // 3. Cria a Janela Dedicada Compacta (Popup Minimalista nativo do Chrome)
    const newWindow = await chrome.windows.create({
      url: targetUrl,
      type: "popup", // Sem barra de abas, sem favoritos e sem omnibox
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      left,
      top,
      focused: true,
    });

    return {
      reusedTab: false,
      windowId: newWindow.id,
      tabId: newWindow.tabs && newWindow.tabs[0] ? newWindow.tabs[0].id : null,
    };
  } catch (error) {
    console.error("[Sincronizador Leopoldina] Erro ao despachar WhatsApp:", error);
    throw error;
  }
}
