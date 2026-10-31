import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import {
  dispatchWhatsAppToBrowser,
  getWhatsAppDispatchPreference,
  setWhatsAppDispatchPreference,
  WHATSAPP_DISPATCH_STORAGE_KEY,
} from "../clientDispatcher";
import { WA_ME_REUSABLE_WINDOW_NAME } from "../whatsappProvider";

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

describe("clientDispatcher — Controle Liga/Desliga (Modo Extensão vs Convencional)", () => {
  const localStorageMock = new LocalStorageMock();

  beforeAll(() => {
    (globalThis as any).localStorage = localStorageMock;
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      postMessage: vi.fn(),
      open: vi.fn(),
    };
    (globalThis as any).document = {
      documentElement: {
        dataset: {},
      },
    };
  });

  beforeEach(() => {
    localStorageMock.clear();
    delete (globalThis.window as any).__LEOPOLDINA_EXTENSION_ACTIVE__;
    (globalThis.document.documentElement as any).dataset = {};
    vi.restoreAllMocks();
  });

  it("retorna 'extension' como padrão quando nenhuma preferência foi gravada", () => {
    expect(getWhatsAppDispatchPreference()).toBe("extension");
  });

  it("grava e recupera a preferência 'native' (modo convencional) no localStorage", () => {
    setWhatsAppDispatchPreference("native");
    expect(localStorageMock.getItem(WHATSAPP_DISPATCH_STORAGE_KEY)).toBe("native");
    expect(getWhatsAppDispatchPreference()).toBe("native");

    setWhatsAppDispatchPreference("extension");
    expect(localStorageMock.getItem(WHATSAPP_DISPATCH_STORAGE_KEY)).toBe("extension");
    expect(getWhatsAppDispatchPreference()).toBe("extension");
  });

  it("quando no modo 'native' (convencional), ignora a extensão e despacha via window.open", () => {
    // Simula extensão ativa no ambiente
    (globalThis.window as any).__LEOPOLDINA_EXTENSION_ACTIVE__ = true;
    const postMessageSpy = vi.spyOn(globalThis.window, "postMessage");
    const openSpy = vi.spyOn(globalThis.window, "open").mockImplementation(() => null as any);

    setWhatsAppDispatchPreference("native");
    const result = dispatchWhatsAppToBrowser("https://web.whatsapp.com/send/?phone=554299999999");

    expect(result.dispatchedVia).toBe("WINDOW_OPEN");
    expect(openSpy).toHaveBeenCalledWith(
      "https://web.whatsapp.com/send/?phone=554299999999",
      WA_ME_REUSABLE_WINDOW_NAME
    );
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("quando no modo 'extension' e extensão ativa, despacha via postMessage", () => {
    (globalThis.window as any).__LEOPOLDINA_EXTENSION_ACTIVE__ = true;
    const postMessageSpy = vi.spyOn(globalThis.window, "postMessage");
    const openSpy = vi.spyOn(globalThis.window, "open").mockImplementation(() => null as any);

    setWhatsAppDispatchPreference("extension");
    const result = dispatchWhatsAppToBrowser("https://web.whatsapp.com/send/?phone=554299999999");

    expect(result.dispatchedVia).toBe("EXTENSION");
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "LEOPOLDINA_DISPATCH_WHATSAPP",
        url: "https://web.whatsapp.com/send/?phone=554299999999",
      },
      "*"
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("quando no modo 'extension' mas extensão ausente, faz fallback gracioso para window.open", () => {
    const postMessageSpy = vi.spyOn(globalThis.window, "postMessage");
    const openSpy = vi.spyOn(globalThis.window, "open").mockImplementation(() => null as any);

    setWhatsAppDispatchPreference("extension");
    const result = dispatchWhatsAppToBrowser("https://web.whatsapp.com/send/?phone=554299999999");

    expect(result.dispatchedVia).toBe("WINDOW_OPEN");
    expect(openSpy).toHaveBeenCalledWith(
      "https://web.whatsapp.com/send/?phone=554299999999",
      WA_ME_REUSABLE_WINDOW_NAME
    );
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
