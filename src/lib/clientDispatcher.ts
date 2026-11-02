import { WA_ME_REUSABLE_WINDOW_NAME } from "./whatsappProvider";

export const WHATSAPP_DISPATCH_STORAGE_KEY = "leopoldina_whatsapp_dispatch_mode";
export type WhatsAppDispatchMode = "extension" | "native";

declare global {
  interface Window {
    __LEOPOLDINA_EXTENSION_ACTIVE__?: boolean;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.type === "LEOPOLDINA_EXTENSION_READY") {
      window.__LEOPOLDINA_EXTENSION_ACTIVE__ = true;
    }
  });
}

/**
 * Lê a preferência do usuário armazenada no navegador (padrão: "extension").
 */
export function getWhatsAppDispatchPreference(): WhatsAppDispatchMode {
  if (typeof window === "undefined") return "extension";
  try {
    const saved = localStorage.getItem(WHATSAPP_DISPATCH_STORAGE_KEY);
    return saved === "native" ? "native" : "extension";
  } catch {
    return "extension";
  }
}

/**
 * Atualiza a preferência do usuário e notifica os componentes na página.
 */
export function setWhatsAppDispatchPreference(mode: WhatsAppDispatchMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WHATSAPP_DISPATCH_STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent("leopoldina_whatsapp_preference_changed", { detail: mode })
    );
  } catch (err) {
    console.warn("[clientDispatcher] Falha ao persistir preferência:", err);
  }
}

/**
 * Verifica se a Extensão Leopoldina está carregada no navegador do usuário.
 */
export function isExtensionActive(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.__LEOPOLDINA_EXTENSION_ACTIVE__ ||
      document.documentElement.dataset.leopoldinaExtension === "true"
  );
}

export interface DispatchWhatsAppMetadata {
  logId?: string;
  studentId?: string;
  studentName?: string;
  phone?: string;
  autoSend?: boolean;
}

/**
 * Despacha uma mensagem do WhatsApp otimizada para o navegador da secretária:
 * 1. Se a preferência for "native": ignora a extensão intencionalmente e abre via window.open convencional.
 * 2. Se a preferência for "extension" e a Extensão Leopoldina estiver ativa: reutiliza a aba já aberta do WhatsApp Web
 *    e traz para o foco (sem abrir abas novas e sem conflito de sessão "Usar aqui"), repassando metadados de rastreio.
 * 3. Fallback: abre na janela nomeada fixa (WA_ME_REUSABLE_WINDOW_NAME) de forma síncrona,
 *    evitando bloqueios de popup do navegador.
 */
export function dispatchWhatsAppToBrowser(
  targetUrl: string,
  metadata?: DispatchWhatsAppMetadata
): {
  dispatchedVia: "EXTENSION" | "WINDOW_OPEN";
} {
  if (typeof window === "undefined") {
    return { dispatchedVia: "WINDOW_OPEN" };
  }

  const preference = getWhatsAppDispatchPreference();

  // Modo Convencional explicitamente escolhido pelo usuário:
  if (preference === "native") {
    window.open(targetUrl, WA_ME_REUSABLE_WINDOW_NAME);
    return { dispatchedVia: "WINDOW_OPEN" };
  }

  // Modo Extensão:
  if (isExtensionActive()) {
    const payload: any = {
      type: "LEOPOLDINA_DISPATCH_WHATSAPP",
      url: targetUrl,
    };
    if (metadata?.logId) payload.logId = metadata.logId;
    if (metadata?.studentId) payload.studentId = metadata.studentId;
    if (metadata?.studentName) payload.studentName = metadata.studentName;
    if (metadata?.phone) payload.phone = metadata.phone;
    if (metadata?.autoSend !== undefined) payload.autoSend = metadata.autoSend;

    window.postMessage(payload, "*");
    return { dispatchedVia: "EXTENSION" };
  }

  // Fallback nativo: janela nomeada síncrona
  window.open(targetUrl, WA_ME_REUSABLE_WINDOW_NAME);
  return { dispatchedVia: "WINDOW_OPEN" };
}
