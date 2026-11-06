import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { getStoredPreference, setStoredPreference, removeStoredPreference } from "../storageKeys";
import { getBaseAppUrl, getAtaValidationUrl, getRequestOrigin, DEFAULT_FALLBACK_DOMAIN } from "../qrCode";

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

describe("NEUTRAL-01: Neutralização de LocalStorage com Retrocompatibilidade", () => {
  const localStorageMock = new LocalStorageMock();

  beforeAll(() => {
    (globalThis as any).localStorage = localStorageMock;
    (globalThis as any).window = {
      location: { origin: "https://registro-leopoldina.vercel.app" },
    };
  });

  beforeEach(() => {
    localStorageMock.clear();
  });

  it("retorna fallbackValue quando nenhuma chave está configurada", () => {
    expect(getStoredPreference("theme", "light")).toBe("light");
    expect(getStoredPreference("gemini_api_key", "")).toBe("");
  });

  it("lê preferência legada 'leopoldina_*' se a chave neutra não existir", () => {
    localStorage.setItem("leopoldina_theme", "dark");
    localStorage.setItem("leopoldina_gemini_api_key", "test-key-12345");

    expect(getStoredPreference("theme")).toBe("dark");
    expect(getStoredPreference("gemini_api_key")).toBe("test-key-12345");
  });

  it("prioriza a chave neutra 'redeativa_*' quando ambas existem", () => {
    localStorage.setItem("leopoldina_theme", "light");
    localStorage.setItem("redeativa_theme", "dark");

    expect(getStoredPreference("theme")).toBe("dark");
  });

  it("grava na chave neutra 'redeativa_*' via setStoredPreference", () => {
    setStoredPreference("theme", "dark");
    expect(localStorage.getItem("redeativa_theme")).toBe("dark");
    expect(localStorage.getItem("leopoldina_theme")).toBeNull();
  });

  it("remove ambas as chaves via removeStoredPreference", () => {
    localStorage.setItem("leopoldina_theme", "dark");
    localStorage.setItem("redeativa_theme", "dark");

    removeStoredPreference("theme");
    expect(localStorage.getItem("redeativa_theme")).toBeNull();
    expect(localStorage.getItem("leopoldina_theme")).toBeNull();
  });
});

describe("DOMAIN-01: Resolução Dinâmica de Domínio & URL Base da Plataforma", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_URL;
  });

  it("retorna DEFAULT_FALLBACK_DOMAIN quando nenhuma variável de ambiente ou origem é fornecida", () => {
    const url = getBaseAppUrl();
    expect(url).toBe(`https://${DEFAULT_FALLBACK_DOMAIN}`);
  });

  it("prioriza NEXT_PUBLIC_APP_URL para permitir ativação instantânea de domínio próprio", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.redeativa.com.br";
    expect(getBaseAppUrl()).toBe("https://app.redeativa.com.br");

    const valUrl = getAtaValidationUrl("ATA-ABC-123");
    expect(valUrl).toBe("https://app.redeativa.com.br/validar/ata/ATA-ABC-123");
  });

  it("remove barras finais duplicadas de domínios configurados", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.redeativa.com.br///";
    expect(getBaseAppUrl()).toBe("https://app.redeativa.com.br");
  });

  it("getRequestOrigin extrai host dinâmico de headers de proxy (x-forwarded-host)", () => {
    const mockHeaders = new Headers({
      "x-forwarded-host": "escola.redeativa.com.br",
      "x-forwarded-proto": "https",
    });

    const origin = getRequestOrigin(mockHeaders);
    expect(origin).toBe("https://escola.redeativa.com.br");
  });
});
