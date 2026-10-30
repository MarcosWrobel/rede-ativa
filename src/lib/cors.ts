/**
 * Controle estrito de CORS para endpoints de sincronização da Extensão Chrome
 * Permite exclusivamente os portais oficiais da SEED-PR (Power BI e SERP) e o próprio domínio da aplicação.
 */

function isTrustedSyncOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (url.protocol === "https:") {
      if (host === "app.powerbi.com") return true;
      if (host === "redeprotecao.seed.pr.gov.br" || host.endsWith(".redeprotecao.seed.pr.gov.br")) {
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
  const allowedOrigin = isTrustedSyncOrigin(origin)
    ? origin!
    : process.env.NEXTAUTH_URL || "https://app.powerbi.com";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-sync-token",
    Vary: "Origin",
  };
}
