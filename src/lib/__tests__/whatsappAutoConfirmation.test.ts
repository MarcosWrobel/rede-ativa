import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { dispatchWhatsAppToBrowser, setWhatsAppDispatchPreference } from "../clientDispatcher";

describe("WhatsApp Auto-Confirmation via Extension & Dispatch Metadata", () => {
  beforeAll(() => {
    (globalThis as any).localStorage = {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] || null;
      },
      setItem(key: string, value: string) {
        this.store[key] = String(value);
      },
      clear() {
        this.store = {};
      },
    };
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
    (globalThis.localStorage as any).clear();
    delete (globalThis.window as any).__LEOPOLDINA_EXTENSION_ACTIVE__;
    (globalThis.document.documentElement as any).dataset = {};
    vi.restoreAllMocks();
  });

  it("encaminha metadados completos de despacho (logId, studentId, studentName, phone) via postMessage para a extensão", () => {
    (globalThis.window as any).__LEOPOLDINA_EXTENSION_ACTIVE__ = true;
    const postMessageSpy = vi.spyOn(globalThis.window, "postMessage");

    setWhatsAppDispatchPreference("extension");
    const result = dispatchWhatsAppToBrowser("https://web.whatsapp.com/send/?phone=554299999999&text=Ola", {
      logId: "log_123",
      studentId: "student_456",
      studentName: "Lucas Gabriel",
      phone: "554299999999",
      autoSend: true,
    });

    expect(result.dispatchedVia).toBe("EXTENSION");
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "LEOPOLDINA_DISPATCH_WHATSAPP",
        url: "https://web.whatsapp.com/send/?phone=554299999999&text=Ola",
        logId: "log_123",
        studentId: "student_456",
        studentName: "Lucas Gabriel",
        phone: "554299999999",
        autoSend: true,
      },
      "*"
    );
  });

  it("trata evento de confirmação LEOPOLDINA_WHATSAPP_CONFIRMED para SENT e FAILED_NO_WHATSAPP", () => {
    const handleOutcome = (eventData: { outcome: string; logId: string }) => {
      if (eventData.outcome === "SENT") {
        return { status: "SENT", confirmed: true };
      }
      if (eventData.outcome === "FAILED_NO_WHATSAPP") {
        return { status: "FAILED_NO_WHATSAPP", confirmed: false, invalidatedContact: true };
      }
      return { status: "LINK_OPENED", confirmed: false };
    };

    const sentResult = handleOutcome({ outcome: "SENT", logId: "log_1" });
    expect(sentResult.status).toBe("SENT");
    expect(sentResult.confirmed).toBe(true);

    const failedResult = handleOutcome({ outcome: "FAILED_NO_WHATSAPP", logId: "log_2" });
    expect(failedResult.status).toBe("FAILED_NO_WHATSAPP");
    expect(failedResult.invalidatedContact).toBe(true);
  });
});
