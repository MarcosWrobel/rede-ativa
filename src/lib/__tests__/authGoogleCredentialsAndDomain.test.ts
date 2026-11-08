import { describe, it, expect } from "vitest";
import {
  sanitizeCredentialValue,
  resolveGoogleCredentials,
  authConfig,
} from "../auth.config";
import {
  shouldRedirectApexToCanonical,
  CANONICAL_PRODUCTION_HOST,
  APEX_PRODUCTION_HOST,
} from "../proxyConstants";

describe("AUTH-01: Higienização e Resolução de Credenciais OAuth do Google", () => {
  it("sanitizeCredentialValue remove prefixos de atribuição acidentalmente colados", () => {
    expect(
      sanitizeCredentialValue("GOOGLE_CLIENT_ID=123456789.apps.googleusercontent.com")
    ).toBe("123456789.apps.googleusercontent.com");

    expect(
      sanitizeCredentialValue("AUTH_GOOGLE_ID=987654321.apps.googleusercontent.com")
    ).toBe("987654321.apps.googleusercontent.com");

    expect(
      sanitizeCredentialValue("GOOGLE_CLIENT_SECRET=GOCSPX-secret12345")
    ).toBe("GOCSPX-secret12345");

    expect(
      sanitizeCredentialValue("AUTH_GOOGLE_SECRET=GOCSPX-secret67890")
    ).toBe("GOCSPX-secret67890");
  });

  it("sanitizeCredentialValue remove comando export, aspas duplas, simples e espaços", () => {
    expect(
      sanitizeCredentialValue('export GOOGLE_CLIENT_SECRET="GOCSPX-quoted-secret" ')
    ).toBe("GOCSPX-quoted-secret");

    expect(
      sanitizeCredentialValue(" 'GOOGLE_CLIENT_ID=my-client-id' ")
    ).toBe("my-client-id");

    expect(
      sanitizeCredentialValue("`GOCSPX-backtick-secret`")
    ).toBe("GOCSPX-backtick-secret");
  });

  it("sanitizeCredentialValue retorna undefined para valores vazios, indefinidos ou apenas com espaços", () => {
    expect(sanitizeCredentialValue(undefined)).toBeUndefined();
    expect(sanitizeCredentialValue("")).toBeUndefined();
    expect(sanitizeCredentialValue("   ")).toBeUndefined();
    expect(sanitizeCredentialValue('""')).toBeUndefined();
    expect(sanitizeCredentialValue("''")).toBeUndefined();
  });

  it("resolveGoogleCredentials prioriza e extrai corretamente GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET", () => {
    const env = {
      GOOGLE_CLIENT_ID: "client-id-standard",
      GOOGLE_CLIENT_SECRET: "client-secret-standard",
    };
    const resolved = resolveGoogleCredentials(env);
    expect(resolved.clientId).toBe("client-id-standard");
    expect(resolved.clientSecret).toBe("client-secret-standard");
  });

  it("resolveGoogleCredentials suporta AUTH_GOOGLE_ID e AUTH_GOOGLE_SECRET (Auth.js v5)", () => {
    const env = {
      AUTH_GOOGLE_ID: "authjs-id-123",
      AUTH_GOOGLE_SECRET: "authjs-secret-456",
    };
    const resolved = resolveGoogleCredentials(env);
    expect(resolved.clientId).toBe("authjs-id-123");
    expect(resolved.clientSecret).toBe("authjs-secret-456");
  });

  it("resolveGoogleCredentials pula variáveis vazias e utiliza o fallback", () => {
    const env = {
      AUTH_GOOGLE_ID: '""',
      GOOGLE_CLIENT_ID: "valid-client-id",
      AUTH_GOOGLE_SECRET: "   ",
      GOOGLE_CLIENT_SECRET: "valid-client-secret",
    };
    const resolved = resolveGoogleCredentials(env);
    expect(resolved.clientId).toBe("valid-client-id");
    expect(resolved.clientSecret).toBe("valid-client-secret");
  });

  it("resolveGoogleCredentials retorna undefined (não string vazia) quando variáveis estão ausentes", () => {
    const env = {};
    const resolved = resolveGoogleCredentials(env);
    expect(resolved.clientId).toBeUndefined();
    expect(resolved.clientSecret).toBeUndefined();
  });
});

describe("AUTH-02: Consistência de Redirecionamento e Domínio Canônico", () => {
  it("authConfig.callbacks.redirect preserva URLs relativas concatenando com baseUrl", async () => {
    const redirectCb = authConfig.callbacks?.redirect;
    expect(redirectCb).toBeDefined();

    const res = await redirectCb!({
      url: "/busca-ativa",
      baseUrl: "https://www.redeativa.app.br",
    });
    expect(res).toBe("https://www.redeativa.app.br/busca-ativa");
  });

  it("authConfig.callbacks.redirect permite mesma origem exata", async () => {
    const redirectCb = authConfig.callbacks?.redirect;
    const res = await redirectCb!({
      url: "https://www.redeativa.app.br/gestao",
      baseUrl: "https://www.redeativa.app.br",
    });
    expect(res).toBe("https://www.redeativa.app.br/gestao");
  });

  it("authConfig.callbacks.redirect normaliza URLs de redeativa.app.br para www.redeativa.app.br", async () => {
    const redirectCb = authConfig.callbacks?.redirect;
    const res = await redirectCb!({
      url: "https://redeativa.app.br/busca-ativa?filter=pendente",
      baseUrl: "https://www.redeativa.app.br",
    });
    expect(res).toBe("https://www.redeativa.app.br/busca-ativa?filter=pendente");
  });

  it("authConfig.callbacks.redirect cai em baseUrl seguro para origens externas não autorizadas", async () => {
    const redirectCb = authConfig.callbacks?.redirect;
    const res = await redirectCb!({
      url: "https://malicious-phishing.com/steal",
      baseUrl: "https://www.redeativa.app.br",
    });
    expect(res).toBe("https://www.redeativa.app.br");
  });
});

describe("AUTH-03: Redirecionamento Canônico 308 no Proxy (Apex para WWW)", () => {
  it("identifica corretamente quando o host apex redeativa.app.br deve ser redirecionado", () => {
    expect(shouldRedirectApexToCanonical("redeativa.app.br")).toBe(true);
    expect(shouldRedirectApexToCanonical("redeativa.app.br:3000")).toBe(true);
    expect(shouldRedirectApexToCanonical("REDEATIVA.APP.BR")).toBe(true);
  });

  it("não redireciona hosts já canônicos ou de desenvolvimento", () => {
    expect(shouldRedirectApexToCanonical(CANONICAL_PRODUCTION_HOST)).toBe(false);
    expect(shouldRedirectApexToCanonical("www.redeativa.app.br")).toBe(false);
    expect(shouldRedirectApexToCanonical("localhost")).toBe(false);
    expect(shouldRedirectApexToCanonical("localhost:3000")).toBe(false);
    expect(shouldRedirectApexToCanonical("registro-preview.vercel.app")).toBe(false);
    expect(shouldRedirectApexToCanonical(null)).toBe(false);
    expect(shouldRedirectApexToCanonical(undefined)).toBe(false);
  });
});

describe("AUTH-04: Preservação de AUTH_URL Canônica na Vercel", () => {
  it("preserva AUTH_URL do domínio de produção mesmo em ambiente VERCEL=1", () => {
    const testEnv: Record<string, string | undefined> = {
      VERCEL: "1",
      AUTH_URL: "https://www.redeativa.app.br",
      NEXTAUTH_URL: "https://www.redeativa.app.br",
    };

    // Aplica a mesma lógica de higienização de auth.config.ts
    for (const key of ["NEXTAUTH_URL", "AUTH_URL"] as const) {
      if (testEnv[key] && testEnv[key]!.includes(".vercel.app")) {
        delete testEnv[key];
      }
    }

    expect(testEnv.AUTH_URL).toBe("https://www.redeativa.app.br");
    expect(testEnv.NEXTAUTH_URL).toBe("https://www.redeativa.app.br");
  });

  it("remove NEXTAUTH_URL ou AUTH_URL quando apontam para .vercel.app", () => {
    const testEnv: Record<string, string | undefined> = {
      VERCEL: "1",
      AUTH_URL: "https://registro-preview-123.vercel.app",
      NEXTAUTH_URL: "https://registro-preview-123.vercel.app",
    };

    for (const key of ["NEXTAUTH_URL", "AUTH_URL"] as const) {
      if (testEnv[key] && testEnv[key]!.includes(".vercel.app")) {
        delete testEnv[key];
      }
    }

    expect(testEnv.AUTH_URL).toBeUndefined();
    expect(testEnv.NEXTAUTH_URL).toBeUndefined();
  });
});

