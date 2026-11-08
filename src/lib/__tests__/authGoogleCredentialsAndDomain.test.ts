import { describe, it, expect } from "vitest";
import {
  sanitizeCredentialValue,
  canonicalizeAuthUrl,
  resolveGoogleCredentials,
  resolveAuthSecret,
  authConfig,
  sanitizeJwtLogoUrl,
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

  it("sanitizeCredentialValue remove comando export, aspas duplas, simples, crases e pontuação de fechamento", () => {
    expect(
      sanitizeCredentialValue('export GOOGLE_CLIENT_SECRET="GOCSPX-quoted-secret" ')
    ).toBe("GOCSPX-quoted-secret");

    expect(
      sanitizeCredentialValue('export GOOGLE_CLIENT_ID="123456789.apps.googleusercontent.com";')
    ).toBe("123456789.apps.googleusercontent.com");

    expect(
      sanitizeCredentialValue(" 'GOOGLE_CLIENT_ID=my-client-id' ")
    ).toBe("my-client-id");

    expect(
      sanitizeCredentialValue("`GOCSPX-backtick-secret`")
    ).toBe("GOCSPX-backtick-secret");

    expect(
      sanitizeCredentialValue('"export GOOGLE_CLIENT_SECRET="GOCSPX-secret";"')
    ).toBe("GOCSPX-secret");
  });

  it("sanitizeCredentialValue retorna undefined para valores vazios, indefinidos ou apenas com espaços", () => {
    expect(sanitizeCredentialValue(undefined)).toBeUndefined();
    expect(sanitizeCredentialValue("")).toBeUndefined();
    expect(sanitizeCredentialValue("   ")).toBeUndefined();
    expect(sanitizeCredentialValue('""')).toBeUndefined();
    expect(sanitizeCredentialValue("''")).toBeUndefined();
    expect(sanitizeCredentialValue("null")).toBeUndefined();
    expect(sanitizeCredentialValue("undefined")).toBeUndefined();
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

  it("resolveAuthSecret higieniza prefixos acidentais como export ou aspas no segredo", () => {
    const env = {
      AUTH_SECRET: 'export AUTH_SECRET="a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";',
    };
    const secret = resolveAuthSecret(env);
    expect(secret).toBe("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6");
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

  it("authConfig.callbacks.redirect normaliza baseUrl apex para www em URLs relativas", async () => {
    const redirectCb = authConfig.callbacks?.redirect;
    const res = await redirectCb!({
      url: "/busca-ativa",
      baseUrl: "https://redeativa.app.br",
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
      baseUrl: "https://redeativa.app.br",
    });
    expect(res).toBe("https://www.redeativa.app.br");
  });
});

describe("AUTH-03: Redirecionamento Canônico 308 no Proxy (Apex para WWW)", () => {
  it("identifica corretamente quando o host apex redeativa.app.br deve ser redirecionado", () => {
    expect(shouldRedirectApexToCanonical("redeativa.app.br")).toBe(true);
    expect(shouldRedirectApexToCanonical("redeativa.app.br:3000")).toBe(true);
    expect(shouldRedirectApexToCanonical("REDEATIVA.APP.BR")).toBe(true);
    expect(shouldRedirectApexToCanonical("redeativa.app.br, 10.0.0.1")).toBe(true);
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

describe("AUTH-04: Preservação e Canonicização de AUTH_URL", () => {
  it("canonicalizeAuthUrl preserva AUTH_URL de produção e normaliza para HTTPS www", () => {
    expect(canonicalizeAuthUrl("https://www.redeativa.app.br")).toBe("https://www.redeativa.app.br");
    expect(canonicalizeAuthUrl("https://www.redeativa.app.br/")).toBe("https://www.redeativa.app.br");
    expect(canonicalizeAuthUrl("https://www.redeativa.app.br/api/auth")).toBe("https://www.redeativa.app.br");
    expect(canonicalizeAuthUrl("https://redeativa.app.br")).toBe("https://www.redeativa.app.br");
    expect(canonicalizeAuthUrl("http://redeativa.app.br")).toBe("https://www.redeativa.app.br");
    expect(canonicalizeAuthUrl('export AUTH_URL="https://redeativa.app.br";')).toBe("https://www.redeativa.app.br");
    expect(canonicalizeAuthUrl("www.redeativa.app.br")).toBe("https://www.redeativa.app.br");
  });

  it("canonicalizeAuthUrl neutraliza URLs preview .vercel.app retornando undefined", () => {
    expect(canonicalizeAuthUrl("https://registro-preview-123.vercel.app")).toBeUndefined();
    expect(canonicalizeAuthUrl("https://minha-branch.vercel.app/api/auth")).toBeUndefined();
  });

  it("canonicalizeAuthUrl preserva ambiente de desenvolvimento local", () => {
    expect(canonicalizeAuthUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(canonicalizeAuthUrl("http://localhost:3000/api/auth")).toBe("http://localhost:3000");
  });

  it("canonicalizeAuthUrl retorna undefined para valores vazios ou inválidos", () => {
    expect(canonicalizeAuthUrl(undefined)).toBeUndefined();
    expect(canonicalizeAuthUrl("")).toBeUndefined();
    expect(canonicalizeAuthUrl("   ")).toBeUndefined();
    expect(canonicalizeAuthUrl("null")).toBeUndefined();
  });
});

describe("AUTH-05: Sanitização de Imagens e Logos no Token JWT", () => {
  it("sanitizeJwtLogoUrl rejeita categoricamente data URIs / base64", () => {
    const base64Svg = "data:image/svg+xml;base64," + "A".repeat(500);
    expect(sanitizeJwtLogoUrl(base64Svg)).toBeNull();

    const base64Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA";
    expect(sanitizeJwtLogoUrl(base64Png)).toBeNull();
  });

  it("sanitizeJwtLogoUrl rejeita strings maiores que 255 caracteres", () => {
    const longUrl = "https://cdn.example.com/" + "a".repeat(240);
    expect(longUrl.length).toBeGreaterThan(255);
    expect(sanitizeJwtLogoUrl(longUrl)).toBeNull();

    // Simula o payload de 1.14 MB da escola Leopoldina
    const giantPayload = "data:image/svg+xml;base64," + "X".repeat(1138000);
    expect(sanitizeJwtLogoUrl(giantPayload)).toBeNull();
  });

  it("sanitizeJwtLogoUrl retorna null para valores nulos, vazios ou indefinidos", () => {
    expect(sanitizeJwtLogoUrl(undefined)).toBeNull();
    expect(sanitizeJwtLogoUrl(null)).toBeNull();
    expect(sanitizeJwtLogoUrl("")).toBeNull();
    expect(sanitizeJwtLogoUrl("   ")).toBeNull();
  });

  it("sanitizeJwtLogoUrl preserva URLs relativas ou remotas compactas e faz trim", () => {
    expect(sanitizeJwtLogoUrl("/logo.svg")).toBe("/logo.svg");
    expect(sanitizeJwtLogoUrl("  /brasao-tibagi.png  ")).toBe("/brasao-tibagi.png");
    expect(sanitizeJwtLogoUrl("https://storage.googleapis.com/escola/logo.png")).toBe(
      "https://storage.googleapis.com/escola/logo.png"
    );
  });
});


