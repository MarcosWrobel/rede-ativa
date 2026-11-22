import QRCode from "qrcode";
import { APEX_PRODUCTION_HOST, CANONICAL_PRODUCTION_HOST } from "./proxyConstants";

export interface QrCodeOptions {
  margin?: number;
  width?: number;
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
}

/**
 * Gera o QR Code em formato SVG vetorial (sem perda de nitidez na impressão A4).
 * Funciona de forma 100% autônoma e offline (zero dependência externa de APIs terceiras).
 */
export async function generateQrCodeSvg(
  text: string,
  options?: QrCodeOptions
): Promise<string> {
  if (!text || typeof text !== "string") {
    throw new Error("Texto ou URL inválida para geração de QR Code.");
  }
  return await QRCode.toString(text, {
    type: "svg",
    margin: options?.margin ?? 1,
    width: options?.width ?? 256,
    errorCorrectionLevel: options?.errorCorrectionLevel ?? "M",
  });
}

/**
 * Gera o QR Code em formato Data URL PNG (base64) para renderização compatível em tags <img> ou canvas.
 */
export async function generateQrCodeDataUrl(
  text: string,
  options?: QrCodeOptions
): Promise<string> {
  if (!text || typeof text !== "string") {
    throw new Error("Texto ou URL inválida para geração de QR Code.");
  }
  return await QRCode.toDataURL(text, {
    margin: options?.margin ?? 1,
    width: options?.width ?? 256,
    errorCorrectionLevel: options?.errorCorrectionLevel ?? "M",
  });
}

export const DEFAULT_FALLBACK_DOMAIN = "redeativa.app.br";

/**
 * Resolve a URL base absoluta da aplicação respeitando variáveis de ambiente,
 * o contexto do cliente/browser ou o fallback institucional.
 */
export function getBaseAppUrl(origin?: string): string {
  return (
    origin?.replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    process.env.APP_URL?.replace(/\/+$/, "") ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "") ||
    `https://${DEFAULT_FALLBACK_DOMAIN}`
  );
}

/**
 * Normaliza e resolve a URL canônica de validação pública da ata.
 */
export function getAtaValidationUrl(verificationCode: string, origin?: string): string {
  const cleanCode = (verificationCode || "").trim().toUpperCase();
  const base = getBaseAppUrl(origin);
  return `${base}/validar/ata/${encodeURIComponent(cleanCode)}`;
}

function extractHostFromUrl(raw: string | undefined | null): string | null {
  const clean = (raw || "").trim();
  if (!clean) return null;
  try {
    const withScheme = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function sanitizeHostHeader(raw: string | null | undefined): string | null {
  const first = (raw || "").split(",")[0]?.trim().toLowerCase() || "";
  if (!first || first.length > 253) return null;
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(first)) return null;
  const [hostname, portStr] = first.split(":");
  if (!hostname || hostname.startsWith(".") || hostname.endsWith(".") || hostname.includes("..")) {
    return null;
  }
  if (hostname.startsWith("-") || hostname.endsWith("-")) {
    return null;
  }
  if (portStr !== undefined) {
    const port = Number.parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
  }
  return first;
}

function sanitizeProtoHeader(raw: string | null | undefined, host: string): "http" | "https" {
  const first = (raw || "").split(",")[0]?.trim().toLowerCase() || "";
  const hostname = host.split(":")[0].toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

  if (isProduction && !isLocal) {
    return "https";
  }
  if (first === "http" || first === "https") {
    if (first === "http" && !isLocal && isProduction) {
      return "https";
    }
    return first;
  }
  return isLocal ? "http" : "https";
}

function isTrustedAppHost(host: string): boolean {
  const cleanHost = host.toLowerCase();
  const hostname = cleanHost.split(":")[0];

  if (
    hostname === CANONICAL_PRODUCTION_HOST ||
    hostname === APEX_PRODUCTION_HOST ||
    hostname === DEFAULT_FALLBACK_DOMAIN ||
    hostname === "redeativa.com.br" ||
    hostname.endsWith(`.${DEFAULT_FALLBACK_DOMAIN}`) ||
    hostname.endsWith(".redeativa.com.br")
  ) {
    return true;
  }

  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (!isProduction && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return true;
  }

  const configuredHosts = [
    extractHostFromUrl(process.env.NEXT_PUBLIC_APP_URL),
    extractHostFromUrl(process.env.APP_URL),
    extractHostFromUrl(process.env.VERCEL_URL),
    ...(process.env.ALLOWED_APP_HOSTS || "")
      .split(",")
      .map((item) => sanitizeHostHeader(item))
      .filter((item): item is string => Boolean(item)),
  ].filter((item): item is string => Boolean(item));

  return configuredHosts.some((allowed) => {
    const allowedHostname = allowed.split(":")[0];
    return cleanHost === allowed || hostname === allowedHostname;
  });
}

/**
 * Resolve uma origem confiável contra Host Header Injection:
 * 1. Prioriza URL explícita configurada em ambiente (`NEXT_PUBLIC_APP_URL` / `APP_URL`);
 * 2. Aceita cabeçalho `x-forwarded-host` / `host` apenas se sanitizado e pertencente à allowlist da plataforma;
 * 3. Caso contrário, retorna o domínio canônico de fallback.
 */
export function getTrustedAppOrigin(headersObj?: { get(name: string): string | null }): string {
  for (const envUrl of [process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL]) {
    const clean = (envUrl || "").trim();
    if (!clean) continue;
    try {
      const parsed = new URL(clean);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Ignora URL de ambiente malformada
    }
  }

  if (headersObj) {
    const sanitizedHost = sanitizeHostHeader(
      headersObj.get("x-forwarded-host") || headersObj.get("host")
    );
    if (sanitizedHost && isTrustedAppHost(sanitizedHost)) {
      const proto = sanitizeProtoHeader(headersObj.get("x-forwarded-proto"), sanitizedHost);
      return `${proto}://${sanitizedHost}`;
    }
  }

  return `https://${DEFAULT_FALLBACK_DOMAIN}`;
}

/**
 * Extrai a origem pública da requisição a partir dos headers HTTP (Server Components e Route Handlers).
 */
export function getRequestOrigin(headersObj?: { get(name: string): string | null }): string {
  if (!headersObj) {
    return getBaseAppUrl();
  }

  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (isProduction) {
    return getTrustedAppOrigin(headersObj);
  }

  const rawHost = headersObj.get("x-forwarded-host") || headersObj.get("host");
  const sanitizedHost = sanitizeHostHeader(rawHost);
  if (!sanitizedHost) {
    return getTrustedAppOrigin(headersObj);
  }

  const proto = sanitizeProtoHeader(headersObj.get("x-forwarded-proto"), sanitizedHost);
  return `${proto}://${sanitizedHost}`;
}
