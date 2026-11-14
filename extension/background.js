/**
 * Background Service Worker — Sincronizador Rede Ativa (Manifest V3)
 * 1. Abre o WhatsApp Web em Janela Dedicada Compacta (tipo 'popup' minimalista)
 *    posicionada no canto direito da tela, reutilizando a mesma janela durante todo o fluxo.
 * 2. Gerencia operações pendentes (CAPTURE, DISPATCH, EXTRACT) indexadas por requestId (sem contexto global único sobrescrito).
 * 3. Exige correlação válida (requestId / logId / phone), expiração (TTL 2 min) e consumo único por operação (sem fallback para último contexto e sem substituir identificadores).
 * 4. Valida origem e remetente por operação (bloqueando subdomínios *.vercel.app de terceiros e origens não autorizadas).
 */

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 760;
const DISPATCH_CONTEXT_TTL_MS = 120 * 1000; // 2 minutos estritos
const CONSUMED_RETENTION_TTL_MS = 10 * 60 * 1000; // 10 minutos de retenção anti-replay

const PENDING_OPERATIONS_STORAGE_KEY = "redeativa_pending_operations";
const CONSUMED_OPERATIONS_STORAGE_KEY = "redeativa_consumed_operations";

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

// Fila de serialização em memória para impedir condições de corrida (read-modify-write) entre abas simultâneas
let operationStoreMutex = Promise.resolve();

function withOperationStoreLock(taskFn) {
  const next = operationStoreMutex.then(() => taskFn(), () => taskFn());
  operationStoreMutex = next.catch(() => {});
  return next;
}

function normalizeOrigin(urlOrOrigin) {
  if (!urlOrOrigin || typeof urlOrOrigin !== "string") return null;
  try {
    const parsed = new URL(urlOrOrigin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isAuthorizedPlatformOriginSync(urlOrOrigin) {
  if (!urlOrOrigin || typeof urlOrOrigin !== "string") return false;
  try {
    const parsed = new URL(urlOrOrigin);
    const protocol = parsed.protocol;
    const host = parsed.hostname.toLowerCase();

    if (protocol === "https:" && EXACT_TRUSTED_HTTPS_HOSTS.has(host)) {
      return true;
    }

    if (protocol === "http:" && (host === "localhost" || host === "127.0.0.1")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function validatePlatformSender(sender) {
  if (!sender || (sender.id && chrome?.runtime?.id && sender.id !== chrome.runtime.id)) {
    return { ok: false, error: "UNAUTHORIZED_SENDER" };
  }
  const tabId = sender?.tab?.id;
  const rawUrl = sender?.url || sender?.tab?.url;
  if (!tabId || !rawUrl || !sender.documentId || sender.frameId !== 0) {
    return { ok: false, error: "UNAUTHORIZED_ORIGIN" };
  }

  if (!isAuthorizedPlatformOriginSync(rawUrl)) {
    return { ok: false, error: "UNAUTHORIZED_ORIGIN" };
  }

  const origin = normalizeOrigin(rawUrl);
  if (!origin) {
    return { ok: false, error: "UNAUTHORIZED_ORIGIN" };
  }

  return {
    ok: true,
    tabId,
    documentId: sender.documentId,
    windowId: sender?.tab?.windowId || null,
    origin,
  };
}

function traceLocalOperation(senderCheck, enabled, stage) {
  if (!enabled || !senderCheck?.ok) return;
  try {
    const url = new URL(senderCheck.origin);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) return;
    chrome.tabs.sendMessage(senderCheck.tabId, { type: "REDEATIVA_EXTENSION_DIAGNOSTIC", stage }, { documentId: senderCheck.documentId }).catch(() => {});
  } catch {}
}

function validateWhatsAppSender(sender) {
  if (!sender || (sender.id && chrome?.runtime?.id && sender.id !== chrome.runtime.id)) {
    return { ok: false, error: "UNAUTHORIZED_SENDER" };
  }
  const tabId = sender?.tab?.id;
  const rawUrl = sender?.url || sender?.tab?.url;
  if (!tabId || !rawUrl) {
    return { ok: false, error: "UNAUTHORIZED_WHATSAPP_SENDER" };
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "web.whatsapp.com") {
      return {
        ok: true,
        tabId,
        windowId: sender?.tab?.windowId || null,
        url: rawUrl,
      };
    }
  } catch {}
  return { ok: false, error: "UNAUTHORIZED_WHATSAPP_SENDER" };
}

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

function arePhonesCompatible(phoneA, phoneB) {
  const cleanA = sanitizeWhatsAppPhone(phoneA);
  const cleanB = sanitizeWhatsAppPhone(phoneB);
  if (!cleanA || !cleanB) return false;
  return cleanA.length >= 10 && cleanA === cleanB;
}

/**
 * Carrega e higieniza os mapas de operações pendentes e já consumidas em storage.local.
 * Deve ser chamado sempre dentro de withOperationStoreLock.
 */
async function loadOperationMapsUnlocked(now = Date.now()) {
  const data = await chrome.storage.local.get([
    PENDING_OPERATIONS_STORAGE_KEY,
    CONSUMED_OPERATIONS_STORAGE_KEY,
  ]);

  const rawPending = data?.[PENDING_OPERATIONS_STORAGE_KEY];
  const rawConsumed = data?.[CONSUMED_OPERATIONS_STORAGE_KEY];

  const pending =
    rawPending && typeof rawPending === "object" && !Array.isArray(rawPending)
      ? { ...rawPending }
      : {};
  const consumed =
    rawConsumed && typeof rawConsumed === "object" && !Array.isArray(rawConsumed)
      ? { ...rawConsumed }
      : {};

  // Limpa registros de consumo com mais de 10 minutos
  for (const [reqId, ts] of Object.entries(consumed)) {
    if (typeof ts !== "number" || now - ts > CONSUMED_RETENTION_TTL_MS) {
      delete consumed[reqId];
    }
  }

  return { pending, consumed };
}

async function saveOperationMapsUnlocked(pending, consumed) {
  await chrome.storage.local.set({
    [PENDING_OPERATIONS_STORAGE_KEY]: pending,
    [CONSUMED_OPERATIONS_STORAGE_KEY]: consumed,
  });
}

/**
 * Registra uma operação individual (CAPTURE, DISPATCH ou EXTRACT) indexada por requestId,
 * sem sobrescrever operações pendentes de outras abas ou atendimentos.
 */
async function registerPendingOperation(params) {
  return withOperationStoreLock(async () => {
    const now = Date.now();
    const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
    const logId = typeof params.logId === "string" ? params.logId.trim() : "";

    if (!requestId || !logId) {
      return { ok: false, error: "MISSING_CORRELATION_ID" };
    }

    const { pending, consumed } = await loadOperationMapsUnlocked(now);

    // Purga operações expiradas antes de validar
    for (const [id, op] of Object.entries(pending)) {
      if (!op || typeof op.expiresAt !== "number" || now > op.expiresAt) {
        delete pending[id];
      }
    }

    if (consumed[requestId] || pending[requestId]) {
      await saveOperationMapsUnlocked(pending, consumed);
      return { ok: false, error: "OPERATION_ALREADY_CONSUMED" };
    }

    const entry = {
      requestId,
      kind: params.kind, // "CAPTURE" | "DISPATCH" | "EXTRACT"
      originTabId: params.originTabId,
      originDocumentId: params.originDocumentId,
      originOrigin: params.originOrigin,
      targetTabId: params.targetTabId || null,
      logId,
      phone: sanitizeWhatsAppPhone(params.phone) || null,
      studentName: params.studentName ? String(params.studentName).slice(0, 80) : null,
      intendedText: params.intendedText ? String(params.intendedText).slice(0, 2000) : null,
      autoSend: Boolean(params.autoSend),
      createdAt: now,
      expiresAt: now + DISPATCH_CONTEXT_TTL_MS,
    };

    pending[requestId] = entry;
    await saveOperationMapsUnlocked(pending, consumed);
    return { ok: true, operation: entry };
  });
}

/**
 * Resolve e consome atomicamente uma operação pendente com validação estrita de correlação e expiração.
 * NUNCA usa "último contexto" como fallback e NUNCA substitui os identificadores informados na captura/resposta.
 */
async function resolveAndConsumeOperation(expectedKind, correlation) {
  return withOperationStoreLock(async () => {
    const now = Date.now();
    const reqId =
      typeof correlation?.requestId === "string" ? correlation.requestId.trim() : "";
    const logId =
      typeof correlation?.logId === "string" ? correlation.logId.trim() : "";
    const cleanPhone = sanitizeWhatsAppPhone(correlation?.phone) || "";
    const senderTabId = correlation?.senderTabId || null;

    const { pending, consumed } = await loadOperationMapsUnlocked(now);

    // Caso 1: requestId explícito informado
    if (reqId) {
      if (consumed[reqId]) {
        await saveOperationMapsUnlocked(pending, consumed);
        return { ok: false, error: "OPERATION_ALREADY_CONSUMED" };
      }

      const op = pending[reqId];
      if (!op) {
        await saveOperationMapsUnlocked(pending, consumed);
        return { ok: false, error: "UNKNOWN_OPERATION_CONTEXT" };
      }

      if (typeof op.expiresAt !== "number" || now > op.expiresAt) {
        delete pending[reqId];
        await saveOperationMapsUnlocked(pending, consumed);
        return { ok: false, error: "OPERATION_CONTEXT_EXPIRED" };
      }

      if (op.kind !== expectedKind) {
        await saveOperationMapsUnlocked(pending, consumed);
        return { ok: false, error: "INVALID_OPERATION_KIND" };
      }

      if (expectedKind === "DISPATCH" && op.targetTabId && senderTabId && op.targetTabId !== senderTabId) {
        await saveOperationMapsUnlocked(pending, consumed);
        return { ok: false, error: "UNAUTHORIZED_WHATSAPP_TAB" };
      }

      // Valida que os identificadores informados na resposta/captura não divergem da operação registrada
      if (logId && logId !== op.logId) {
        await saveOperationMapsUnlocked(pending, consumed);
        return { ok: false, error: "CORRELATION_MISMATCH" };
      }
      if (cleanPhone && op.phone && !arePhonesCompatible(cleanPhone, op.phone)) {
        await saveOperationMapsUnlocked(pending, consumed);
        return { ok: false, error: "CORRELATION_MISMATCH" };
      }

      // Consome a operação (uso único)
      delete pending[reqId];
      consumed[reqId] = now;
      await saveOperationMapsUnlocked(pending, consumed);
      return { ok: true, operation: op };
    }

    // Eventos finais precisam manter o identificador obtido antes da captura.
    if (expectedKind === "CAPTURE" || expectedKind === "DISPATCH") {
      return { ok: false, error: "MISSING_CORRELATION_ID" };
    }

    // Compatibilidade para os demais tipos.
    if (!logId && !cleanPhone) {
      await saveOperationMapsUnlocked(pending, consumed);
      return { ok: false, error: "MISSING_CORRELATION_ID" };
    }

    let expiredMatched = false;
    const validCandidates = [];

    for (const [id, op] of Object.entries(pending)) {
      if (!op || op.kind !== expectedKind) continue;

      const matchesLog = logId ? op.logId === logId : true;
      const matchesPhone = cleanPhone
        ? Boolean(op.phone) && arePhonesCompatible(cleanPhone, op.phone)
        : true;

      if (matchesLog && matchesPhone) {
        if (typeof op.expiresAt !== "number" || now > op.expiresAt) {
          delete pending[id];
          expiredMatched = true;
        } else {
          validCandidates.push(op);
        }
      }
    }

    if (validCandidates.length === 0) {
      await saveOperationMapsUnlocked(pending, consumed);
      return {
        ok: false,
        error: expiredMatched ? "OPERATION_CONTEXT_EXPIRED" : "UNKNOWN_OPERATION_CONTEXT",
      };
    }

    if (validCandidates.length > 1) {
      await saveOperationMapsUnlocked(pending, consumed);
      return { ok: false, error: "AMBIGUOUS_OPERATION_CONTEXT" };
    }

    const matchedOp = validCandidates[0];
    delete pending[matchedOp.requestId];
    consumed[matchedOp.requestId] = now;
    await saveOperationMapsUnlocked(pending, consumed);
    return { ok: true, operation: matchedOp };
  });
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
 * captureVisibleTab captura a aba ativa da janela, não a aba identificada por tabId.
 * Sem uma API de captura vinculada à aba, retornar imagem poderia expor outra conversa.
 * A extração textual continua disponível; OCR visual fica desativado até haver vínculo seguro.
 */
async function captureWhatsAppTabScreenshot() {
  return null;
}

/**
 * Verifica se a aba de origem registrada ainda existe e permanece exatamente na mesma origem autorizada.
 */
async function verifyOriginTabStillMatches(originTabId, expectedOrigin) {
  if (!originTabId || !expectedOrigin) return false;
  try {
    if (!isAuthorizedPlatformOriginSync(expectedOrigin)) {
      return false;
    }

    if (typeof chrome.tabs.get === "function") {
      const tab = await chrome.tabs.get(originTabId);
      if (!tab || !tab.id || !tab.url) return false;
      return normalizeOrigin(tab.url) === expectedOrigin;
    }

    const allTabs = await chrome.tabs.query({});
    const matchingTab = allTabs.find((t) => t.id === originTabId);
    if (!matchingTab || !matchingTab.url) return false;
    return normalizeOrigin(matchingTab.url) === expectedOrigin;
  } catch {
    return false;
  }
}

/**
 * Garante que as abas abertas do WhatsApp Web tenham o content script ativo sem reinjetar desnecessariamente.
 */
async function ensureContentScriptInOpenWhatsAppTabs() {
  try {
    const waTabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });
    for (const tab of waTabs) {
      if (!tab.id) continue;
      try {
        const pingRes = await chrome.tabs.sendMessage(tab.id, { type: "LEOPOLDINA_PING" });
        if (pingRes && (pingRes.pong || pingRes.ok)) {
          continue;
        }
      } catch {}
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
  withOperationStoreLock(() => chrome.storage.local
    .remove([
      "leopoldina_last_captured_reply",
      "leopoldina_active_dispatch",
      "leopoldina_capture_context",
      PENDING_OPERATIONS_STORAGE_KEY,
      CONSUMED_OPERATIONS_STORAGE_KEY,
    ])).catch(() => {});
  ensureContentScriptInOpenWhatsAppTabs();
});

chrome.runtime.onStartup.addListener(() => {
  withOperationStoreLock(() => chrome.storage.local
    .remove([
      "leopoldina_last_captured_reply",
      "leopoldina_active_dispatch",
      "leopoldina_capture_context",
      PENDING_OPERATIONS_STORAGE_KEY,
      CONSUMED_OPERATIONS_STORAGE_KEY,
    ])).catch(() => {});
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
  // 0. Registro explícito de contexto de captura pelo modal ativo na aba autorizada (por operação, sem sobrescrever outras abas)
  if (request?.type === "LEOPOLDINA_REGISTER_CAPTURE_CONTEXT") {
    (async () => {
      const senderCheck = await validatePlatformSender(sender);
      if (!senderCheck.ok) {
        sendResponse({ success: false, error: senderCheck.error });
        return;
      }

      const reg = await registerPendingOperation({
        requestId: request.requestId,
        kind: "CAPTURE",
        originTabId: senderCheck.tabId,
        originDocumentId: senderCheck.documentId,
        originOrigin: senderCheck.origin,
        logId: request.logId,
        phone: request.phone,
        studentName: request.studentName,
      });

      if (!reg.ok) {
        sendResponse({ success: false, error: reg.error });
        return;
      }

      sendResponse({
        success: true,
        requestId: reg.operation.requestId,
        logId: reg.operation.logId,
      });
    })();
    return true;
  }

  // 1. Despacho de WhatsApp da aplicação Rede Ativa para a janela dedicada
  if (request?.type === "LEOPOLDINA_DISPATCH_WHATSAPP" && request.url) {
    (async () => {
      let senderCheck;
      try {
        senderCheck = await validatePlatformSender(sender);
        if (!senderCheck.ok) {
          sendResponse({
            success: false,
            error: senderCheck.error,
            message: "Origem ou aba não autorizada para despachar mensagens.",
          });
          return;
        }

        if (!isAllowedWhatsAppUrl(request.url)) {
          sendResponse({
            success: false,
            error: "URL de destino não permitida. Apenas domínios WhatsApp são aceitos.",
          });
          return;
        }

        const storageRes = await chrome.storage.local.get(["opt_whatsapp_auto_send"]);
        const autoSendPref = storageRes?.opt_whatsapp_auto_send !== false;

        let intendedText = "";
        try {
          const parsedDispatchUrl = new URL(request.url);
          intendedText = (parsedDispatchUrl.searchParams.get("text") || "").trim();
        } catch {}

        const reg = await registerPendingOperation({
          requestId: request.requestId,
          kind: "DISPATCH",
          originTabId: senderCheck.tabId,
          originDocumentId: senderCheck.documentId,
          originOrigin: senderCheck.origin,
          logId: request.logId,
          phone: request.phone,
          studentName: request.studentName,
          intendedText: request.text || intendedText || null,
          autoSend: request.autoSend !== undefined ? Boolean(request.autoSend) : autoSendPref,
        });

        if (!reg.ok) {
          sendResponse({
            success: false,
            requestId: request.requestId || null,
            error: reg.error,
          });
          return;
        }

        traceLocalOperation(senderCheck, request.diagnostics === true, "background.send.registered");
        traceLocalOperation(senderCheck, request.diagnostics === true, "background.send.opening");

        const result = await handleWhatsAppDispatch(request.url, request.reuseTab !== false);
        if (result && result.tabId) {
          await withOperationStoreLock(async () => {
            const { pending, consumed } = await loadOperationMapsUnlocked(Date.now());
            const existingOp = pending[reg.operation.requestId];
            if (existingOp) {
              existingOp.targetTabId = result.tabId;
              await saveOperationMapsUnlocked(pending, consumed);
            }
          });
        }
        traceLocalOperation(senderCheck, request.diagnostics === true, "background.send.opened");
        sendResponse({
          success: true,
          requestId: reg.operation.requestId,
          logId: reg.operation.logId,
          ...result,
        });
      } catch (err) {
        traceLocalOperation(senderCheck, request.diagnostics === true, "background.send.error");
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  // 2. Consulta de contexto de despacho pelo content script do WhatsApp Web (correlacionado por requestId, aba autorizada e phone da URL)
  if (request?.type === "LEOPOLDINA_GET_ACTIVE_DISPATCH") {
    (async () => {
      try {
        const waCheck = validateWhatsAppSender(sender);
        if (!waCheck.ok) {
          sendResponse({ activeDispatch: null, error: waCheck.error });
          return;
        }

        const storageRes = await chrome.storage.local.get(["opt_whatsapp_auto_send"]);
        const autoSendPref = storageRes?.opt_whatsapp_auto_send !== false;

        let urlPhone = "";
        try {
          const parsedUrl = new URL(waCheck.url);
          urlPhone = sanitizeWhatsAppPhone(parsedUrl.searchParams.get("phone")) || "";
        } catch {}

        const reqId = typeof request.requestId === "string" ? request.requestId.trim() : "";
        const reqPhone = sanitizeWhatsAppPhone(request.phone) || urlPhone;

        const matchedDispatch = await withOperationStoreLock(async () => {
          const now = Date.now();
          const { pending, consumed } = await loadOperationMapsUnlocked(now);
          let changed = false;

          for (const [id, op] of Object.entries(pending)) {
            if (!op || typeof op.expiresAt !== "number" || now > op.expiresAt) {
              delete pending[id];
              changed = true;
            }
          }
          if (changed) {
            await saveOperationMapsUnlocked(pending, consumed);
          }

          if (reqId) {
            const op = pending[reqId];
            if (!op || op.kind !== "DISPATCH") return null;
            if (op.targetTabId && waCheck.tabId && op.targetTabId !== waCheck.tabId) return null;
            return op;
          }

          if (!reqPhone) {
            return null;
          }

          const candidates = Object.values(pending).filter(
            (op) =>
              op &&
              op.kind === "DISPATCH" &&
              (!op.targetTabId || !waCheck.tabId || op.targetTabId === waCheck.tabId) &&
              op.phone &&
              arePhonesCompatible(reqPhone, op.phone)
          );
          if (candidates.length === 0) return null;
          candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          return candidates[0];
        });

        if (matchedDispatch) {
          sendResponse({
            activeDispatch: {
              requestId: matchedDispatch.requestId,
              logId: matchedDispatch.logId,
              studentName: matchedDispatch.studentName || null,
              phone: matchedDispatch.phone || null,
              text: matchedDispatch.intendedText || null,
              autoSend: matchedDispatch.autoSend,
              dispatchedAt: matchedDispatch.createdAt,
            },
          });
        } else {
          sendResponse({ activeDispatch: null, autoSendDefault: autoSendPref });
        }
      } catch {
        sendResponse({ activeDispatch: null, autoSendDefault: true });
      }
    })();
    return true;
  }

  // Consulta sem consumir: captura humana associa o clique à operação vigente antes de ler o conteúdo.
  if (request?.type === "LEOPOLDINA_GET_CAPTURE_CONTEXT") {
    (async () => {
      const waCheck = validateWhatsAppSender(sender);
      const phone = sanitizeWhatsAppPhone(request.phone);
      if (!waCheck.ok || !phone) {
        sendResponse({ success: false, error: waCheck.error || "MISSING_CORRELATION_ID" });
        return;
      }
      const result = await withOperationStoreLock(async () => {
        const { pending } = await loadOperationMapsUnlocked();
        const candidates = Object.values(pending).filter((op) =>
          op?.kind === "CAPTURE" && op.expiresAt > Date.now() && op.phone && arePhonesCompatible(phone, op.phone)
        );
        if (candidates.length !== 1) return { success: false, error: candidates.length ? "AMBIGUOUS_OPERATION_CONTEXT" : "UNKNOWN_OPERATION_CONTEXT" };
        const op = candidates[0];
        return { success: true, requestId: op.requestId, logId: op.logId, phone: op.phone };
      });
      sendResponse(result);
    })().catch(() => sendResponse({ success: false }));
    return true;
  }

  // 3. Resultado de envio emitido pelo content script do WhatsApp Web (exige correlação válida e uso único)
  if (request?.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME") {
    (async () => {
      try {
        const waCheck = validateWhatsAppSender(sender);
        if (!waCheck.ok) {
          sendResponse({ success: false, relayedCount: 0, error: waCheck.error });
          return;
        }

        const resolved = await resolveAndConsumeOperation("DISPATCH", {
          requestId: request.requestId,
          logId: request.logId,
          phone: request.phone,
          senderTabId: waCheck.tabId,
        });

        if (!resolved.ok) {
          sendResponse({
            success: false,
            relayedCount: 0,
            error: resolved.error,
          });
          return;
        }

        const op = resolved.operation;
        const isSameOriginTab = await verifyOriginTabStillMatches(
          op.originTabId,
          op.originOrigin
        );
        if (!isSameOriginTab) {
          sendResponse({
            success: false,
            relayedCount: 0,
            error: "ORIGIN_TAB_UNAVAILABLE",
          });
          return;
        }

        const now = Date.now();
        await chrome.tabs.sendMessage(op.originTabId, {
          type: "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME_RELAY",
          outcome: request.outcome,
          requestId: request.requestId || op.requestId,
          logId: request.logId || op.logId,
          phone: sanitizeWhatsAppPhone(request.phone) || op.phone,
          studentName: request.studentName || op.studentName || null,
          timestamp: request.timestamp || now,
        }, { documentId: op.originDocumentId });

        sendResponse({
          success: true,
          relayedCount: 1,
          requestId: op.requestId,
          logId: op.logId,
        });
      } catch (err) {
        sendResponse({ success: false, relayedCount: 0, error: err?.message });
      }
    })();
    return true;
  }

  // 4. Push ativo disparado pelo WhatsApp Web ("📥 Capturar Retorno")
  // Exige correlação válida, expiração e consumo único por operação; nunca usa último contexto como fallback nem substitui identificadores.
  if (request?.type === "LEOPOLDINA_PUSH_CAPTURED_REPLY") {
    (async () => {
      try {
        const waCheck = validateWhatsAppSender(sender);
        if (!waCheck.ok) {
          sendResponse({ success: false, relayedCount: 0, error: waCheck.error });
          return;
        }

        let urlPhone = "";
        try {
          const parsedUrl = new URL(waCheck.url);
          urlPhone = sanitizeWhatsAppPhone(parsedUrl.searchParams.get("phone")) || "";
        } catch {}

        const effectivePhone = sanitizeWhatsAppPhone(request.phone) || urlPhone || null;

        const resolved = await resolveAndConsumeOperation("CAPTURE", {
          requestId: request.requestId,
          logId: request.logId,
          phone: effectivePhone,
        });

        if (!resolved.ok) {
          sendResponse({
            success: false,
            relayedCount: 0,
            error: resolved.error,
          });
          return;
        }

        const op = resolved.operation;
        const isSameOriginTab = await verifyOriginTabStillMatches(
          op.originTabId,
          op.originOrigin
        );
        if (!isSameOriginTab) {
          sendResponse({
            success: false,
            relayedCount: 0,
            error: "ORIGIN_TAB_UNAVAILABLE",
          });
          return;
        }

        const senderTabId = waCheck.tabId;
        const senderWinId = waCheck.windowId;
        const screenshotDataUrl = await captureWhatsAppTabScreenshot(senderWinId, senderTabId);

        const correlatedRequestId =
          typeof request.requestId === "string" && request.requestId.trim()
            ? request.requestId.trim()
            : op.requestId;
        const correlatedLogId =
          typeof request.logId === "string" && request.logId.trim()
            ? request.logId.trim()
            : op.logId;
        const correlatedPhone = effectivePhone || op.phone || null;

        const finalPayload = {
          captureId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          success: Boolean(request.rawText?.trim() || screenshotDataUrl),
          requestId: correlatedRequestId,
          logId: correlatedLogId,
          phone: correlatedPhone,
          studentName: request.studentName || op.studentName || null,
          rawText: request.rawText || "",
          selectionUsed: Boolean(request.selectionUsed),
          domTimestamp: request.domTimestamp || null,
          activeChatTitle: request.activeChatTitle || null,
          screenshotDataUrl,
          capturedAt: new Date().toISOString(),
        };

        await chrome.storage.local.remove(["leopoldina_last_captured_reply"]);

        await chrome.tabs.sendMessage(op.originTabId, {
          type: "LEOPOLDINA_WHATSAPP_REPLY_PUSH_RELAY",
          ...finalPayload,
        }, { documentId: op.originDocumentId });

        sendResponse({
          success: Boolean(request.rawText?.trim() || screenshotDataUrl),
          relayedCount: 1,
          requestId: correlatedRequestId,
          logId: correlatedLogId,
          phone: correlatedPhone,
          hasText: Boolean(request.rawText?.trim()),
          hasScreenshot: Boolean(screenshotDataUrl),
        });
      } catch (err) {
        sendResponse({
          success: false,
          relayedCount: 0,
          error: err?.message || "Falha ao enviar captura para a plataforma.",
        });
      }
    })();
    return true;
  }

  // 4.1 Limpeza explícita de eventual cache residual de retorno capturado (restrita à operação específica da aba solicitante)
  if (request?.type === "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY") {
    (async () => {
      try {
        const senderCheck = await validatePlatformSender(sender);
        await chrome.storage.local.remove(["leopoldina_last_captured_reply"]);
        if (senderCheck.ok && typeof request.requestId === "string" && request.requestId.trim()) {
          const reqIdToClear = request.requestId.trim();
          await withOperationStoreLock(async () => {
            const { pending, consumed } = await loadOperationMapsUnlocked(Date.now());
            const existing = pending[reqIdToClear];
            if (existing && existing.originTabId === senderCheck.tabId && existing.originDocumentId === senderCheck.documentId) {
              delete pending[reqIdToClear];
              consumed[reqIdToClear] = Date.now();
              await saveOperationMapsUnlocked(pending, consumed);
            }
          });
        }
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
        const senderCheck = await validatePlatformSender(sender);
        if (!senderCheck.ok) {
          sendResponse({
            success: false,
            requestId: request.requestId || null,
            error: senderCheck.error,
            message: "Origem ou aba não autorizada para extrair conversas.",
          });
          return;
        }

        const reg = await registerPendingOperation({
          requestId: request.requestId,
          kind: "EXTRACT",
          originTabId: senderCheck.tabId,
          originDocumentId: senderCheck.documentId,
          originOrigin: senderCheck.origin,
          logId: request.logId,
          phone: request.phone,
          studentName: request.studentName,
        });

        if (!reg.ok) {
          sendResponse({
            success: false,
            requestId: request.requestId || null,
            error: reg.error,
            message: "Solicitação de extração sem correlação válida ou já consumida.",
          });
          return;
        }

        const op = reg.operation;
        const requestId = op.requestId;
        const cleanPhone = op.phone;
        const diagnostics = request.diagnostics === true && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(senderCheck.origin);
        traceLocalOperation(senderCheck, diagnostics, "background.extract.registered");

        const finalizeExtract = async (rawReplyResult, screenshotDataUrl, fallbackError) => {
          // Nunca consuma uma operação indicada por uma resposta diferente da solicitada.
          if (rawReplyResult && (
            (rawReplyResult.requestId && rawReplyResult.requestId !== op.requestId) ||
            (rawReplyResult.logId && rawReplyResult.logId !== op.logId) ||
            (rawReplyResult.phone && op.phone && !arePhonesCompatible(rawReplyResult.phone, op.phone))
          )) {
            sendResponse({ success: false, requestId: op.requestId, logId: op.logId, error: "CORRELATION_MISMATCH" });
            return;
          }
          const resolved = await resolveAndConsumeOperation("EXTRACT", {
            requestId: op.requestId,
            logId: op.logId,
            phone: op.phone,
          });

          if (!resolved.ok) {
            sendResponse({
              success: false,
              requestId: op.requestId,
              logId: op.logId,
              error: resolved.error,
              message: "Operação de extração expirada, já consumida ou com correlação divergente.",
            });
            return;
          }

          if (rawReplyResult && typeof rawReplyResult === "object") {
            if (rawReplyResult.requestId && rawReplyResult.requestId !== op.requestId) {
              sendResponse({
                success: false,
                requestId: op.requestId,
                logId: op.logId,
                error: "CORRELATION_MISMATCH",
              });
              return;
            }
            if (rawReplyResult.logId && rawReplyResult.logId !== op.logId) {
              sendResponse({
                success: false,
                requestId: op.requestId,
                logId: op.logId,
                error: "CORRELATION_MISMATCH",
              });
              return;
            }
            if (
              rawReplyResult.phone &&
              op.phone &&
              !arePhonesCompatible(rawReplyResult.phone, op.phone)
            ) {
              sendResponse({
                success: false,
                requestId: op.requestId,
                logId: op.logId,
                error: "CORRELATION_MISMATCH",
              });
              return;
            }
          }

          const isSameOriginTab = await verifyOriginTabStillMatches(
            op.originTabId,
            op.originOrigin
          );
          if (!isSameOriginTab) {
            sendResponse({
              success: false,
              requestId: op.requestId,
              logId: op.logId,
              error: "ORIGIN_TAB_UNAVAILABLE",
            });
            return;
          }

          if (fallbackError) {
            sendResponse({
              success: false,
              requestId: op.requestId,
              logId: op.logId,
              phone: op.phone,
              ...fallbackError,
            });
            return;
          }

          if (
            rawReplyResult &&
            (rawReplyResult.success ||
              rawReplyResult.error === "NUMBER_NOT_ON_WHATSAPP" ||
              rawReplyResult.error === "CHAT_PHONE_UNAVAILABLE" ||
              rawReplyResult.error === "CHAT_MISMATCH")
          ) {
            sendResponse({
              ...rawReplyResult,
              requestId: op.requestId,
              logId: op.logId,
              phone: op.phone,
              screenshotDataUrl: rawReplyResult.error === "CHAT_MISMATCH" || rawReplyResult.error === "CHAT_PHONE_UNAVAILABLE" ? null : screenshotDataUrl || null,
            });
            return;
          }

          if (screenshotDataUrl) {
            sendResponse({
              ...(rawReplyResult || {}),
              requestId: op.requestId,
              logId: op.logId,
              phone: op.phone,
              success: Boolean(rawReplyResult?.rawText),
              screenshotDataUrl,
              error: rawReplyResult?.error || "DOM_EMPTY_WITH_SCREENSHOT",
              message:
                rawReplyResult?.message ||
                "Imagem da conversa capturada para leitura inteligente (OCR).",
            });
            return;
          }

          sendResponse(
            rawReplyResult
              ? {
                  ...rawReplyResult,
                  requestId: op.requestId,
                  logId: op.logId,
                  phone: op.phone,
                }
              : {
                  success: false,
                  requestId: op.requestId,
                  logId: op.logId,
                  phone: op.phone,
                  error: "EMPTY_RESPONSE",
                  message: "Resposta vazia da aba do WhatsApp Web.",
                }
          );
        };

        const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });
        if (tabs?.length > 1) traceLocalOperation(senderCheck, diagnostics, "background.extract.multiple_tabs");

        // Caso nenhuma aba do WhatsApp Web esteja aberta no momento
        if (!tabs || tabs.length === 0) {
          traceLocalOperation(senderCheck, diagnostics, "background.extract.no_tab");
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
            await finalizeExtract(null, null, {
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
              requestId,
              logId: op.logId,
              phone: op.phone,
              studentName: op.studentName,
              diagnostics,
            });
          } catch {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: createdTab.id },
                files: ["whatsapp-content.js"],
              });
              replyResult = await chrome.tabs.sendMessage(createdTab.id, {
                type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
                requestId,
                logId: op.logId,
                phone: op.phone,
                studentName: op.studentName,
                diagnostics,
              });
            } catch {
              await finalizeExtract(null, null, {
                error: "TAB_COMMUNICATION_ERROR",
                message: "Não foi possível comunicar com a janela recém-aberta do WhatsApp Web.",
              });
              return;
            }
          }

          traceLocalOperation(senderCheck, diagnostics, "background.extract.reply_received");
          const screenshotDataUrl = await captureWhatsAppTabScreenshot(newWindow.id, createdTab.id);
          await finalizeExtract(replyResult, screenshotDataUrl, null);
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
          await finalizeExtract(null, null, {
            error: "WHATSAPP_TAB_NOT_FOUND",
            message: "Abra o WhatsApp Web antes de capturar o retorno.",
          });
          return;
        }
        traceLocalOperation(senderCheck, diagnostics, "background.extract.tab_selected");

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

        await new Promise((r) => setTimeout(r, 150));

        let replyResult = null;
        try {
          replyResult = await chrome.tabs.sendMessage(targetTab.id, {
            type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
            requestId,
            logId: op.logId,
            phone: op.phone,
            studentName: op.studentName,
            diagnostics,
          });
        } catch {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ["whatsapp-content.js"],
            });
            replyResult = await chrome.tabs.sendMessage(targetTab.id, {
              type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
              requestId,
              logId: op.logId,
              phone: op.phone,
              studentName: op.studentName,
              diagnostics,
            });
          } catch (injectErr) {
            console.warn("[Background] Content script indisponível, tentando captura visual pura:", injectErr);
          }
        }

        traceLocalOperation(senderCheck, diagnostics, "background.extract.reply_received");
        const screenshotDataUrl = await captureWhatsAppTabScreenshot(targetTab.windowId, targetTab.id);
        await finalizeExtract(replyResult, screenshotDataUrl, null);
      } catch (err) {
        sendResponse({
          success: false,
          requestId: request?.requestId || null,
          error: "TAB_COMMUNICATION_ERROR",
          message:
            err?.message ||
            "Falha ao comunicar com a aba do WhatsApp Web. Recarregue a página do WhatsApp (F5) e tente novamente.",
        });
      }
    })();
    return true;
  }
});

/**
 * Abre ou reutiliza uma janela dedicada compacta do WhatsApp Web.
 */
async function handleWhatsAppDispatch(targetUrl, reuseTab = true) {
  if (!isAllowedWhatsAppUrl(targetUrl)) {
    throw new Error("URL de destino não permitida.");
  }

  if (!reuseTab) {
    const tab = await chrome.tabs.create({ url: targetUrl, active: true });
    return { reusedTab: false, tabId: tab.id };
  }

  const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });

  if (tabs && tabs.length > 0) {
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
      targetTab = tabs[0];
    }

    const updatedTab = await chrome.tabs.update(targetTab.id, {
      url: targetUrl,
      active: true,
    });

    if (updatedTab && updatedTab.windowId) {
      try {
        await chrome.windows.update(updatedTab.windowId, { focused: true });
      } catch {}
    }

    return { reusedTab: true, tabId: targetTab.id };
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

  const createdTabId = newWindow.tabs && newWindow.tabs[0] ? newWindow.tabs[0].id : null;
  return { reusedTab: false, windowId: newWindow.id, tabId: createdTabId };
}
