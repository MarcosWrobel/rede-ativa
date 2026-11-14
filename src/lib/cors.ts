/**
 * Controle estrito de CORS para endpoints de sincronização da Extensão Chrome
 * Permite exclusivamente os portais oficiais da SEED-PR (Power BI e SERP) e o próprio domínio da aplicação.
 */

const EXACT_TRUSTED_HTTPS_HOSTS = new Set([
  "app.powerbi.com",
  "redeprotecao.seed.pr.gov.br",
  "redeativa.app.br",
  "www.redeativa.app.br",
  "app.redeativa.app.br",
  "redeativa.com.br",
  "www.redeativa.com.br",
  "app.redeativa.com.br",
  "registro-leopoldina.vercel.app",
  "busca-ativa-leopoldina.vercel.app",
]);

export function isTrustedSyncOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (url.protocol === "https:") {
      if (EXACT_TRUSTED_HTTPS_HOSTS.has(host)) return true;
      if (host.endsWith(".redeprotecao.seed.pr.gov.br")) {
        return true;
      }
    }

    const appUrlStr = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
    if (appUrlStr) {
      const appUrl = new URL(appUrlStr);
      if (url.origin === appUrl.origin) return true;
    }

    if (process.env.NODE_ENV !== "production" && (host === "localhost" || host === "127.0.0.1")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getSyncCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-sync-token",
    Vary: "Origin",
  };

  if (origin && isTrustedSyncOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}
