import { describe, expect, it, beforeEach, beforeAll, vi } from "vitest";
import {
  dispatchWhatsAppToBrowser,
  getWhatsAppDispatchPreference,
  setWhatsAppDispatchPreference,
  extractWhatsAppReplyViaExtension,
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
  let messageListeners: Array<(event: any) => void> = [];

  beforeAll(() => {
    (globalThis as any).localStorage = localStorageMock;
    (globalThis as any).window = {
      location: {
        origin: "http://localhost:3000",
      },
      addEventListener: vi.fn((event: string, listener: any) => {
        if (event === "message") {
          messageListeners.push(listener);
        }
      }),
      removeEventListener: vi.fn((event: string, listener: any) => {
        if (event === "message") {
          messageListeners = messageListeners.filter((l) => l !== listener);
        }
      }),
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
    messageListeners = [];
    delete (globalThis.window as any).__LEOPOLDINA_EXTENSION_ACTIVE__;
    delete (globalThis.window as any).__REDEATIVA_EXTENSION_ACTIVE__;
    (globalThis.document.documentElement as any).dataset = {};
    (globalThis.window as any).location = { origin: "http://localhost:3000" };
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

  describe("extractWhatsAppReplyViaExtension (Fluxo Assistido de Retorno MV3)", () => {
    it("dispara postMessage REDEATIVA_EXTRACT_WHATSAPP_REPLY com logId e phone", () => {
      const postMessageSpy = vi.spyOn(globalThis.window, "postMessage");
      extractWhatsAppReplyViaExtension("log_test_123", "5542988887777");

      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: "REDEATIVA_EXTRACT_WHATSAPP_REPLY",
          logId: "log_test_123",
          phone: "5542988887777",
        },
        "http://localhost:3000"
      );
    });

    it("extrai retorno com sucesso ao receber REDEATIVA_WHATSAPP_REPLY_EXTRACTED da extensão", async () => {
      const promise = extractWhatsAppReplyViaExtension("log_abc", "5542999991111");

      // Simula resposta assíncrona do content-script bridge
      const responsePayload = {
        origin: "http://localhost:3000",
        data: {
          type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
          logId: "log_abc",
          success: true,
          rawText: "Bom dia, o aluno Lucas compareceu ao médico e levará atestado amanhã.",
          domTimestamp: "[08:45, 08/11/2026]",
          activeChatTitle: "Mãe do Lucas Gabriel",
        },
      };

      messageListeners.forEach((listener) => listener(responsePayload));

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.logId).toBe("log_abc");
      expect(result.rawText).toBe("Bom dia, o aluno Lucas compareceu ao médico e levará atestado amanhã.");
      expect(result.domTimestamp).toBe("[08:45, 08/11/2026]");
      expect(result.activeChatTitle).toBe("Mãe do Lucas Gabriel");
      expect(globalThis.window.removeEventListener).toHaveBeenCalled();
    });

    it("compatibilidade dual: aceita evento LEOPOLDINA_WHATSAPP_REPLY_EXTRACTED", async () => {
      const promise = extractWhatsAppReplyViaExtension("log_legacy_1");

      const responsePayload = {
        origin: "http://localhost:3000",
        data: {
          type: "LEOPOLDINA_WHATSAPP_REPLY_EXTRACTED",
          logId: "log_legacy_1",
          success: true,
          rawText: "Sim, confirmado.",
        },
      };

      messageListeners.forEach((listener) => listener(responsePayload));

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.rawText).toBe("Sim, confirmado.");
    });

    it("repasse de erro vindo da extensão (ex: WHATSAPP_TAB_NOT_FOUND)", async () => {
      const promise = extractWhatsAppReplyViaExtension("log_not_found");

      messageListeners.forEach((listener) =>
        listener({
          origin: "http://localhost:3000",
          data: {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            logId: "log_not_found",
            success: false,
            error: "WHATSAPP_TAB_NOT_FOUND",
            message: "Abra o WhatsApp Web antes de capturar o retorno.",
          },
        })
      );

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("WHATSAPP_TAB_NOT_FOUND");
      expect(result.message).toBe("Abra o WhatsApp Web antes de capturar o retorno.");
    });

    it("repasse de erro NUMBER_NOT_ON_WHATSAPP quando número não possui conta", async () => {
      const promise = extractWhatsAppReplyViaExtension("log_invalid_num", "5541999999999");

      messageListeners.forEach((listener) =>
        listener({
          origin: "http://localhost:3000",
          data: {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            logId: "log_invalid_num",
            success: false,
            error: "NUMBER_NOT_ON_WHATSAPP",
            message: "Este número de telefone não possui conta ativa no WhatsApp.",
          },
        })
      );

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("NUMBER_NOT_ON_WHATSAPP");
      expect(result.message).toBe("Este número de telefone não possui conta ativa no WhatsApp.");
    });

    it("repasse de NO_INCOMING_MESSAGE com metadados de chat localizado mas sem resposta", async () => {
      const promise = extractWhatsAppReplyViaExtension("log_no_msg", "5542988881234");

      messageListeners.forEach((listener) =>
        listener({
          origin: "http://localhost:3000",
          data: {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            logId: "log_no_msg",
            success: false,
            error: "NO_INCOMING_MESSAGE",
            activeChatTitle: "Mãe do Aluno Pedro",
            message: "Conversa localizada, mas nenhuma resposta foi recebida da família até o momento.",
          },
        })
      );

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("NO_INCOMING_MESSAGE");
      expect(result.activeChatTitle).toBe("Mãe do Aluno Pedro");
      expect(result.message).toContain("nenhuma resposta foi recebida");
    });

    it("ignora mensagens com logId diferente ou de origem não confiável", async () => {
      vi.useFakeTimers();
      const promise = extractWhatsAppReplyViaExtension("log_real", "5542999999999", 5000);

      // 1. Mensagem de origem maliciosa
      messageListeners.forEach((listener) =>
        listener({
          origin: "https://site-invasor.com",
          data: {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            logId: "log_real",
            success: true,
            rawText: "Texto injetado malicioso",
          },
        })
      );

      // 2. Mensagem com logId de outro chamado
      messageListeners.forEach((listener) =>
        listener({
          origin: "http://localhost:3000",
          data: {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            logId: "outro_log_id",
            success: true,
            rawText: "Texto de outro aluno",
          },
        })
      );

      // 3. Agora envia a resposta legítima
      messageListeners.forEach((listener) =>
        listener({
          origin: "http://localhost:3000",
          data: {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            logId: "log_real",
            success: true,
            rawText: "Resposta legítima",
          },
        })
      );

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.rawText).toBe("Resposta legítima");
      vi.useRealTimers();
    });

    it("aciona timeout padrão de 15000ms de EXTENSION_TIMEOUT se a extensão não responder a tempo e remove listener", async () => {
      vi.useFakeTimers();
      const removeEventListenerSpy = vi.spyOn(globalThis.window, "removeEventListener");

      // Chama sem timeout explicito para testar o novo padrão de 15000ms
      const promise = extractWhatsAppReplyViaExtension("log_timeout");

      // Avança 14000ms (ainda não deve expirar)
      vi.advanceTimersByTime(14000);
      expect(removeEventListenerSpy).not.toHaveBeenCalled();

      // Avança além dos 15000ms
      vi.advanceTimersByTime(1001);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("EXTENSION_TIMEOUT");
      expect(result.message).toBe(
        "A extensão não respondeu a tempo. Verifique se ela está ativa ou cole o texto manualmente."
      );
      expect(removeEventListenerSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
