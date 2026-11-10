/**
 * Background Service Worker — Sincronizador Rede Ativa (Manifest V3)
 * 1. Abre o WhatsApp Web em Janela Dedicada Compacta (tipo 'popup' minimalista)
 *    posicionada no canto direito da tela, reutilizando a mesma janela durante todo o fluxo.
 * 2. Gerencia o contexto de despacho da Busca Ativa (aluno, telefone, logId) com Auto-Send ativo por padrão.
 * 3. Faz o relay bidirecional de eventos de confirmação do WhatsApp Web para a plataforma.
 * 4. Faz a ponte de extração de retornos (Texto Selecionado / DOM + Captura Visual OCR via captureVisibleTab).
 */

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 760;

const PLATFORM_TARGET_URLS = [
  "https://*.vercel.app/*",
  "https://redeativa.app.br/*",
  "https://*.redeativa.app.br/*",
  "https://redeativa.com.br/*",
  "https://*.redeativa.com.br/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];

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

function sanitizeWhatsAppPhone(phone) {
  if (!phone || (typeof phone !== "string" && typeof phone !== "number")) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }
  if (digits.length === 10 || digits.length === 11) {
    return "55" + digits;
  }
  return digits;
}

function waitForTabLoad(tabId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let timer = null;
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve(true);
      }
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getPopupCoordinates() {
  let left = 1000;
  let top = 40;
  try {
    const currentWin = await chrome.windows.getCurrent();
    if (currentWin && currentWin.width) {
      left = Math.max(0, (currentWin.left || 0) + currentWin.width - POPUP_WIDTH - 20);
      top = Math.max(0, (currentWin.top || 0) + 30);
    }
  } catch (e) {
    console.warn("[Sincronizador Rede Ativa] Geometria da janela não obtida, usando padrão:", e);
  }
  return { left, top };
}

/**
 * Captura um screenshot JPEG rápido da janela visível do WhatsApp Web para OCR Multimodal.
 */
async function captureWhatsAppTabScreenshot(windowId, tabId) {
  try {
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "LEOPOLDINA_PREPARE_SCREENSHOT", hide: true });
        await new Promise((r) => setTimeout(r, 60));
      } catch {}
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId || null, {
      format: "jpeg",
      quality: 85,
    });

    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "LEOPOLDINA_PREPARE_SCREENSHOT", hide: false });
      } catch {}
    }

    return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? dataUrl : null;
  } catch (err) {
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "LEOPOLDINA_PREPARE_SCREENSHOT", hide: false });
      } catch {}
    }
    console.warn("[Background] Não foi possível capturar screenshot da aba:", err?.message || err);
    return null;
  }
}

/**
 * Localiza todas as abas abertas da plataforma Rede Ativa (seja em localhost:3000,
 * localhost:3001, rede local ou domínios em nuvem Vercel/oficial).
 * Elimina a limitação da API chrome.tabs.query com portas não-padrão (ex.: localhost:3001).
 */
async function queryPlatformTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    return allTabs.filter((tab) => {
      if (!tab?.id || !tab.url || typeof tab.url !== "string") return false;
      try {
        const parsed = new URL(tab.url);
        const host = parsed.hostname.toLowerCase();
        const protocol = parsed.protocol;
        if (protocol === "http:" || protocol === "https:") {
          // Descarte de domínios externos e governamentais
          if (
            host === "web.whatsapp.com" ||
            host === "wa.me" ||
            host === "api.whatsapp.com" ||
            host === "app.powerbi.com" ||
            host.includes("seed.pr.gov.br")
          ) {
            return false;
          }
          // Aceita localhost em qualquer porta, IPs de LAN e domínios da aplicação
          if (
            host === "localhost" ||
            host === "127.0.0.1" ||
            host === "0.0.0.0" ||
            host.startsWith("192.168.") ||
            host.startsWith("10.") ||
            host.endsWith(".local") ||
            host.endsWith(".vercel.app") ||
            host === "redeativa.app.br" ||
            host.endsWith(".redeativa.app.br") ||
            host === "redeativa.com.br" ||
            host.endsWith(".redeativa.com.br")
          ) {
            return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    });
  } catch (err) {
    console.warn("[Background] Falha ao consultar abas da plataforma:", err);
    return [];
  }
}

/**
 * Retransmite um retorno capturado no WhatsApp Web para todas as abas abertas da plataforma.
 */
async function relayCapturedReplyToPlatformTabs(payload) {
  const tabs = await queryPlatformTabs();
  let relayedCount = 0;
  for (const tab of tabs) {
    if (tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "LEOPOLDINA_WHATSAPP_REPLY_PUSH_RELAY",
          ...payload,
        });
        relayedCount++;
      } catch {}
    }
  }
  return relayedCount;
}

/**
 * Garante que todas as abas abertas do WhatsApp Web tenham o content script mais recente injetado,
 * mesmo sem precisar dar F5 manual após atualizar ou recarregar a extensão.
 */
async function ensureContentScriptInOpenWhatsAppTabs() {
  try {
    const waTabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });
    for (const tab of waTabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["whatsapp-content.js"],
        });
      } catch (e) {
        console.warn("[Background] Aviso ao injetar script na aba WhatsApp:", tab.id, e?.message || e);
      }
    }
  } catch (err) {
    console.warn("[Background] Falha ao varrer abas do WhatsApp:", err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(["leopoldina_last_captured_reply"]).catch(() => {});
  ensureContentScriptInOpenWhatsAppTabs();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove(["leopoldina_last_captured_reply"]).catch(() => {});
  ensureContentScriptInOpenWhatsAppTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url && tab.url.includes("web.whatsapp.com")) {
    chrome.tabs.sendMessage(tabId, { type: "LEOPOLDINA_PING" }).catch(() => {
      chrome.scripting
        .executeScript({
          target: { tabId },
          files: ["whatsapp-content.js"],
        })
        .catch(() => {});
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Despacho de WhatsApp da aplicação Registro para a janela dedicada
  if (request?.type === "LEOPOLDINA_DISPATCH_WHATSAPP" && request.url) {
    if (!isAllowedWhatsAppUrl(request.url)) {
      sendResponse({ success: false, error: "URL de destino não permitida. Apenas domínios WhatsApp são aceitos." });
      return false;
    }

    (async () => {
      try {
        // Por padrão, o Auto-Send assistido fica ATIVO (a menos que explicitamente desativado em opt_whatsapp_auto_send === false)
        const storageRes = await chrome.storage.local.get(["opt_whatsapp_auto_send"]);
        const autoSendPref = storageRes?.opt_whatsapp_auto_send !== false;

        const dispatchPayload = {
          logId: request.logId || null,
          studentId: request.studentId || null,
          studentName: request.studentName || null,
          phone: request.phone || null,
          autoSend: request.autoSend !== undefined ? Boolean(request.autoSend) : autoSendPref,
          dispatchedAt: Date.now(),
        };

        await chrome.storage.local.set({
          leopoldina_active_dispatch: dispatchPayload,
        });

        const result = await handleWhatsAppDispatch(request.url);
        sendResponse({ success: true, ...result });
      } catch (err) {
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  // 2. Consulta de contexto ativo feita pelo content script do WhatsApp Web
  if (request?.type === "LEOPOLDINA_GET_ACTIVE_DISPATCH") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(["leopoldina_active_dispatch", "opt_whatsapp_auto_send"]);
        const dispatch = data?.leopoldina_active_dispatch;
        const autoSendPref = data?.opt_whatsapp_auto_send !== false;

        // Se o despacho tiver menos de 5 minutos, considera ativo
        if (dispatch && Date.now() - dispatch.dispatchedAt < 300000) {
          sendResponse({
            activeDispatch: {
              ...dispatch,
              autoSend: dispatch.autoSend !== undefined ? Boolean(dispatch.autoSend) : autoSendPref,
            },
          });
        } else {
          sendResponse({ activeDispatch: null, autoSendDefault: autoSendPref });
        }
      } catch (err) {
        sendResponse({ activeDispatch: null, autoSendDefault: true });
      }
    })();
    return true;
  }

  // 3. Resultado de envio emitido pelo content script do WhatsApp Web
  if (request?.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME") {
    (async () => {
      try {
        console.log("[Sincronizador Rede Ativa] Resultado de envio recebido:", request.outcome, request.logId);

        const tabs = await queryPlatformTabs();
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

  // 4. Push ativo disparado pelo botão humano dentro do WhatsApp Web ("📥 Capturar Retorno")
  if (request?.type === "LEOPOLDINA_PUSH_CAPTURED_REPLY") {
    (async () => {
      try {
        const senderTabId = sender?.tab?.id || request.tabId || null;
        const senderWinId = sender?.tab?.windowId || request.windowId || null;

        const screenshotDataUrl = await captureWhatsAppTabScreenshot(senderWinId, senderTabId);

        const finalPayload = {
          captureId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          success: Boolean(request.rawText?.trim() || screenshotDataUrl),
          logId: request.logId || null,
          phone: request.phone || null,
          studentName: request.studentName || null,
          rawText: request.rawText || "",
          selectionUsed: Boolean(request.selectionUsed),
          domTimestamp: request.domTimestamp || null,
          activeChatTitle: request.activeChatTitle || null,
          screenshotDataUrl,
          capturedAt: new Date().toISOString(),
        };

        await chrome.storage.local.remove(["leopoldina_last_captured_reply"]);

        const relayedCount = await relayCapturedReplyToPlatformTabs(finalPayload);
        sendResponse({
          success: Boolean(request.rawText?.trim() || screenshotDataUrl),
          relayedCount,
          hasText: Boolean(request.rawText?.trim()),
          hasScreenshot: Boolean(screenshotDataUrl),
        });
      } catch (err) {
        sendResponse({
          success: false,
          error: err?.message || "Falha ao enviar captura para a plataforma.",
        });
      }
    })();
    return true;
  }

  // 4.1 Limpeza explícita de eventual cache residual de retorno capturado
  if (request?.type === "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY") {
    (async () => {
      try {
        await chrome.storage.local.remove(["leopoldina_last_captured_reply"]);
        sendResponse({ success: true });
      } catch {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  // 5. Extração assistida solicitada pela plataforma (Botão "Extrair resposta" / "Ler Tela OCR" no Modal)
  if (request?.type === "LEOPOLDINA_EXTRACT_WHATSAPP_REPLY") {
    (async () => {
      try {
        const cleanPhone = sanitizeWhatsAppPhone(request.phone);
        const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });

        // Caso nenhuma aba do WhatsApp Web esteja aberta no momento
        if (!tabs || tabs.length === 0) {
          let targetUrl = "https://web.whatsapp.com";
          if (cleanPhone && cleanPhone.length >= 10) {
            targetUrl = `https://web.whatsapp.com/send/?phone=${cleanPhone}`;
          }
          if (!isAllowedWhatsAppUrl(targetUrl)) {
            targetUrl = "https://web.whatsapp.com";
          }

          const { left, top } = await getPopupCoordinates();
          const newWindow = await chrome.windows.create({
            url: targetUrl,
            type: "popup",
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
            left,
            top,
            focused: true,
          });

          const createdTab = newWindow.tabs && newWindow.tabs[0] ? newWindow.tabs[0] : null;
          if (!createdTab || !createdTab.id) {
            sendResponse({
              success: false,
              error: "WINDOW_CREATION_FAILED",
              message: "Não foi possível abrir a janela do WhatsApp Web.",
            });
            return;
          }

          await waitForTabLoad(createdTab.id, 10000);
          await new Promise((r) => setTimeout(r, 800));

          let replyResult = null;
          try {
            replyResult = await chrome.tabs.sendMessage(createdTab.id, {
              type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
              logId: request.logId,
              phone: request.phone,
              studentName: request.studentName,
            });
          } catch (firstCommErr) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: createdTab.id },
                files: ["whatsapp-content.js"],
              });
              replyResult = await chrome.tabs.sendMessage(createdTab.id, {
                type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
                logId: request.logId,
                phone: request.phone,
                studentName: request.studentName,
              });
            } catch (injectErr) {
              sendResponse({
                success: false,
                error: "TAB_COMMUNICATION_ERROR",
                message: "Não foi possível comunicar com a janela recém-aberta do WhatsApp Web.",
              });
              return;
            }
          }

          const screenshotDataUrl = await captureWhatsAppTabScreenshot(newWindow.id, createdTab.id);

          sendResponse({
            ...(replyResult || {
              success: Boolean(screenshotDataUrl),
              logId: request.logId,
            }),
            screenshotDataUrl: screenshotDataUrl || null,
          });
          return;
        }

        // Se já existe aba do WhatsApp Web aberta: prioriza janela compacta dedicada (tipo popup) ou a aba ativa
        let targetTab = null;
        for (const tab of tabs) {
          try {
            const win = await chrome.windows.get(tab.windowId);
            if (win && win.type === "popup") {
              targetTab = tab;
              break;
            }
          } catch {}
        }

        if (!targetTab) {
          targetTab = tabs.find((t) => t.active) || tabs[0];
        }

        if (!targetTab || !targetTab.id) {
          sendResponse({
            success: false,
            error: "WHATSAPP_TAB_NOT_FOUND",
            message: "Abra o WhatsApp Web antes de capturar o retorno.",
          });
          return;
        }

        // Traz a aba e janela do WhatsApp para o foco imediato SEM RECARREGAR (Zero F5)
        if (targetTab.windowId) {
          try {
            await chrome.windows.update(targetTab.windowId, { focused: true });
          } catch {}
        }
        if (targetTab.id) {
          try {
            await chrome.tabs.update(targetTab.id, { active: true });
          } catch {}
        }

        // Breve pausa para garantir renderização da janela focada antes do screenshot
        await new Promise((r) => setTimeout(r, 150));

        // Solicita extração ao content script da aba ativa
        let replyResult = null;
        try {
          replyResult = await chrome.tabs.sendMessage(targetTab.id, {
            type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
            logId: request.logId,
            phone: request.phone,
            studentName: request.studentName,
          });
        } catch (commErr) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ["whatsapp-content.js"],
            });
            replyResult = await chrome.tabs.sendMessage(targetTab.id, {
              type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
              logId: request.logId,
              phone: request.phone,
              studentName: request.studentName,
            });
          } catch (injectErr) {
            console.warn("[Background] Content script indisponível, tentando captura visual pura:", injectErr);
          }
        }

        // Captura screenshot da aba visível do WhatsApp Web para OCR no servidor caso necessário
        const screenshotDataUrl = await captureWhatsAppTabScreenshot(targetTab.windowId, targetTab.id);

        if (replyResult && (replyResult.success || replyResult.error === "NUMBER_NOT_ON_WHATSAPP" || replyResult.error === "CHAT_MISMATCH")) {
          sendResponse({
            ...replyResult,
            screenshotDataUrl: screenshotDataUrl || null,
          });
          return;
        }

        if (screenshotDataUrl) {
          sendResponse({
            ...(replyResult || {}),
            success: Boolean(replyResult?.rawText),
            logId: request.logId,
            phone: request.phone,
            screenshotDataUrl,
            error: replyResult?.error || "DOM_EMPTY_WITH_SCREENSHOT",
            message:
              replyResult?.message ||
              "Imagem da conversa capturada para leitura inteligente (OCR).",
          });
          return;
        }

        sendResponse(
          replyResult || {
            success: false,
            error: "EMPTY_RESPONSE",
            message: "Resposta vazia da aba do WhatsApp Web.",
          }
        );
      } catch (err) {
        sendResponse({
          success: false,
          error: "TAB_COMMUNICATION_ERROR",
          message:
            err?.message ||
            "Não foi possível comunicar com a aba do WhatsApp Web.",
        });
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
    const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });

    if (tabs && tabs.length > 0) {
      const existingTab = tabs[0];
      const windowId = existingTab.windowId;

      await chrome.tabs.update(existingTab.id, {
        url: targetUrl,
        active: true,
      });

      if (windowId) {
        await chrome.windows.update(windowId, { focused: true });
      }

      return {
        reusedTab: true,
        windowId,
        tabId: existingTab.id,
      };
    }

    const { left, top } = await getPopupCoordinates();

    const newWindow = await chrome.windows.create({
      url: targetUrl,
      type: "popup",
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
    console.error("[Sincronizador Rede Ativa] Erro ao despachar WhatsApp:", error);
    throw error;
  }
}
