import QRCode from "qrcode";

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

export const DEFAULT_FALLBACK_DOMAIN = "registro-leopoldina.vercel.app";

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

/**
 * Extrai a origem pública da requisição a partir dos headers HTTP (Server Components e Route Handlers).
 */
export function getRequestOrigin(headersObj?: { get(name: string): string | null }): string {
  if (!headersObj) {
    return getBaseAppUrl();
  }

  const host =
    headersObj.get("x-forwarded-host") ||
    headersObj.get("host") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "") ||
    DEFAULT_FALLBACK_DOMAIN;

  const proto =
    headersObj.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}
