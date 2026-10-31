/**
 * Background Service Worker — Sincronizador Leopoldina (Manifest V3)
 * Abre o WhatsApp Web em Janela Dedicada Compacta (tipo 'popup' minimalista)
 * posicionada no canto direito da tela, sem abas e sem barra de endereços,
 * reutilizando a mesma janela durante todo o fluxo da Busca Ativa.
 */

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 760;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "LEOPOLDINA_DISPATCH_WHATSAPP" && request.url) {
    handleWhatsAppDispatch(request.url)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
    return true; // Mantém a porta de resposta assíncrona aberta
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
        // Alinha ao lado direito da janela atual do operador
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
