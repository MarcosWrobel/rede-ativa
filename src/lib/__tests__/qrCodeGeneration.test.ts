import { describe, it, expect } from "vitest";
import {
  generateQrCodeSvg,
  generateQrCodeDataUrl,
  getAtaValidationUrl,
  getRequestOrigin,
} from "../qrCode";
import { GET as getQrRoute } from "@/app/api/atas/qr/route";

describe("QR Code Generation & Autonomy Unit Tests", () => {
  const sampleCode = "ATA-8K2P-9M4X";
  const expectedUrl = `https://registro-leopoldina.vercel.app/validar/ata/${sampleCode}`;

  it("should generate a valid, standalone SVG without external HTTP requests", async () => {
    const svg = await generateQrCodeSvg(expectedUrl, { width: 200, margin: 1 });
    expect(svg).toBeDefined();
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<path");
    expect(svg.length).toBeGreaterThan(200);
  });

  it("should generate a valid PNG Data URL locally", async () => {
    const dataUrl = await generateQrCodeDataUrl(expectedUrl, { width: 150, margin: 1 });
    expect(dataUrl).toBeDefined();
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(500);
  });

  it("should reject empty or null text safely", async () => {
    await expect(generateQrCodeSvg("")).rejects.toThrow();
    await expect(generateQrCodeDataUrl("")).rejects.toThrow();
  });

  it("should format the canonical validation URL properly with uppercase and origin", () => {
    const url = getAtaValidationUrl("ata-7k9p-4x2m", "https://escola.gov.br");
    expect(url).toBe("https://escola.gov.br/validar/ata/ATA-7K9P-4X2M");

    const fallbackUrl = getAtaValidationUrl("ATA-1111-2222");
    expect(fallbackUrl).toContain("/validar/ata/ATA-1111-2222");
  });

  it("should extract request origin accurately from headers", () => {
    const headersMock = new Map<string, string>([
      ["x-forwarded-host", "portal.colegioleopoldina.com.br"],
      ["x-forwarded-proto", "https"],
    ]);

    const origin = getRequestOrigin({
      get: (k) => headersMock.get(k.toLowerCase()) || null,
    });
    expect(origin).toBe("https://portal.colegioleopoldina.com.br");
  });

  it("[M-01] getTrustedAppOrigin bloqueia Host Header Injection e prioriza base confiável", async () => {
    const { getTrustedAppOrigin } = await import("@/lib/qrCode");
    const env = process.env as Record<string, string | undefined>;
    const prevAppUrl = env.APP_URL;
    const prevPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
    const prevVercelEnv = env.VERCEL_ENV;

    try {
      delete env.APP_URL;
      delete env.NEXT_PUBLIC_APP_URL;
      env.VERCEL_ENV = "production";

      const evilHeaders = new Map<string, string>([
        ["x-forwarded-host", "evil.attacker.test"],
        ["host", "evil.attacker.test"],
        ["x-forwarded-proto", "http"],
      ]);
      const safeOrigin = getTrustedAppOrigin({
        get: (k) => evilHeaders.get(k.toLowerCase()) || null,
      });
      expect(safeOrigin).not.toContain("evil.attacker.test");
      expect(safeOrigin.startsWith("https://")).toBe(true);

      env.NEXT_PUBLIC_APP_URL = "https://painel.redeativa.com.br";
      const envOrigin = getTrustedAppOrigin({
        get: (k) => evilHeaders.get(k.toLowerCase()) || null,
      });
      expect(envOrigin).toBe("https://painel.redeativa.com.br");
    } finally {
      if (prevAppUrl === undefined) delete env.APP_URL;
      else env.APP_URL = prevAppUrl;
      if (prevPublicAppUrl === undefined) delete env.NEXT_PUBLIC_APP_URL;
      else env.NEXT_PUBLIC_APP_URL = prevPublicAppUrl;
      if (prevVercelEnv === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = prevVercelEnv;
    }
  });

  it("should serve SVG via internal /api/atas/qr endpoint with immutable cache headers", async () => {
    const req = new Request(
      `https://localhost/api/atas/qr?data=${encodeURIComponent(expectedUrl)}&format=svg&size=200`
    );
    const res = await getQrRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(res.headers.get("Cache-Control")).toContain("immutable");

    const text = await res.text();
    expect(text).toContain("<svg");
  });

  it("should serve PNG via internal /api/atas/qr endpoint", async () => {
    const req = new Request(
      `https://localhost/api/atas/qr?data=${encodeURIComponent(expectedUrl)}&format=png&size=120`
    );
    const res = await getQrRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(200);
  });
});
