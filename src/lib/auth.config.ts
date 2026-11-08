import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { isBootstrapAdminEmail } from "./roles";
import { CANONICAL_PRODUCTION_HOST, APEX_PRODUCTION_HOST } from "./proxyConstants";

export interface GoogleCredentials {
  clientId: string | undefined;
  clientSecret: string | undefined;
}

/**
 * Remove prefixos de declaração de variáveis (ex: GOOGLE_CLIENT_ID=...), export,
 * aspas simples/duplas/crases, caracteres de escape, pontos-e-vírgulas residuais
 * e espaços em branco acidentalmente colados no painel de ambiente.
 */
export function sanitizeCredentialValue(val: string | undefined): string | undefined {
  if (val === undefined || val === null) return undefined;
  let cleaned = String(val).trim();
  if (!cleaned) return undefined;

  let prev = "";
  // Executa ciclos sucessivos para desempacotar aspas externas, comandos export,
  // atribuições de chaves e pontuações finais (ex: ponto e vírgula de bash/shell)
  for (let iter = 0; iter < 5 && prev !== cleaned; iter++) {
    prev = cleaned;
    cleaned = cleaned
      .replace(/^\\?["'`]|\\?["'`]$/g, "")
      .trim()
      .replace(/^export\s+/i, "")
      .trim()
      .replace(/^[A-Za-z0-9_]+\s*=\s*/, "")
      .trim()
      .replace(/[;,]+$/, "")
      .trim();
  }

  if (
    !cleaned ||
    cleaned === '""' ||
    cleaned === "''" ||
    cleaned === "``" ||
    cleaned === "undefined" ||
    cleaned === "null"
  ) {
    return undefined;
  }

  return cleaned;
}

/**
 * Garante que apenas URLs estáticas ou relativas leves sejam serializadas no JWT.
 * Rejeita categoricamente data URIs / base64 e URLs maiores que 255 caracteres
 * para prevenir estouro do limite de 14 KB de headers da Vercel e fracionamento de cookies.
 */
export function sanitizeJwtLogoUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  const lower = trimmed.toLowerCase();
  if (
    !trimmed ||
    lower === "null" ||
    lower === "undefined" ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("javascript:") ||
    trimmed.length > 255
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Canoniciza uma URL para uso em AUTH_URL / NEXTAUTH_URL.
 * - Higieniza valores com aspas, export ou pontos e vírgulas.
 * - Neutraliza domínios legados/preview (.vercel.app) retornando undefined para que
 *   o Auth.js opere dinamicamente via trustHost: true (x-forwarded-host).
 * - Converte o apex (redeativa.app.br) para o domínio canônico (https://www.redeativa.app.br).
 * - Remove caminhos residuais como /api/auth e barras finais.
 */
export function canonicalizeAuthUrl(rawUrl: string | undefined): string | undefined {
  const sanitized = sanitizeCredentialValue(rawUrl);
  if (!sanitized) return undefined;

  let val = sanitized;
  if (!/^https?:\/\//i.test(val)) {
    val = val.startsWith("localhost") || val.startsWith("127.0.0.1")
      ? `http://${val}`
      : `https://${val}`;
  }

  try {
    const parsed = new URL(val);

    // Domínios preview/legados .vercel.app devem ser neutralizados
    if (parsed.hostname.endsWith(".vercel.app")) {
      return undefined;
    }

    // Normaliza apex para o domínio canônico seguro com HTTPS
    if (parsed.hostname === APEX_PRODUCTION_HOST) {
      parsed.hostname = CANONICAL_PRODUCTION_HOST;
      parsed.protocol = "https:";
      parsed.port = "";
    } else if (parsed.hostname === CANONICAL_PRODUCTION_HOST) {
      parsed.protocol = "https:";
      parsed.port = "";
    }

    // Remove /api/auth residual e trailing slashes
    const cleanPath = parsed.pathname.replace(/\/api\/auth\/?$/, "").replace(/\/+$/, "");
    parsed.pathname = cleanPath;

    return parsed.origin + (cleanPath ? cleanPath : "");
  } catch {
    return undefined;
  }
}

// 1. Resolve e canoniciza AUTH_URL e NEXTAUTH_URL
const rawAuthUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
const canonicalUrl = canonicalizeAuthUrl(rawAuthUrl);

if (canonicalUrl) {
  process.env.AUTH_URL = canonicalUrl;
  process.env.NEXTAUTH_URL = canonicalUrl;
} else {
  // Se for preview (.vercel.app) ou ausente/inválido, neutraliza para resolução dinâmica
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;

  const fallbackRaw = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const canonicalFallback = canonicalizeAuthUrl(fallbackRaw);
  if (canonicalFallback) {
    process.env.AUTH_URL = canonicalFallback;
    process.env.NEXTAUTH_URL = canonicalFallback;
  }
}

// 2. Higieniza AUTH_SECRET e NEXTAUTH_SECRET
for (const key of ["AUTH_SECRET", "NEXTAUTH_SECRET"] as const) {
  if (process.env[key]) {
    const cleaned = sanitizeCredentialValue(process.env[key]);
    if (cleaned) {
      process.env[key] = cleaned;
    } else {
      delete process.env[key];
    }
  }
}

// Garante compatibilidade estrita com Auth.js v5 e bloqueia segredo fixo em runtime de produção
export function resolveAuthSecret(env: Record<string, string | undefined> = process.env): string {
  const configured = sanitizeCredentialValue(env.AUTH_SECRET || env.NEXTAUTH_SECRET) || "";
  if (configured && configured.length >= 16) {
    return configured;
  }

  const isProdRuntime =
    env.NODE_ENV === "production" &&
    env.NEXT_PHASE !== "phase-production-build" &&
    env.VITEST !== "true";

  if (isProdRuntime) {
    throw new Error(
      "[CRITICAL SECURITY] AUTH_SECRET / NEXTAUTH_SECRET ausente ou curto demais em ambiente de produção. Configure um segredo criptográfico forte (>= 32 bytes)."
    );
  }

  return "rede-ativa-saas-dev-test-ephemeral-secret-only";
}

/**
 * Resolve e normaliza com segurança as credenciais OAuth do Google a partir das variáveis
 * suportadas pelo ecossistema Auth.js e NextAuth, garantindo que valores ausentes retornem
 * undefined (em vez de string vazia "") para permitir que o Auth.js opere seus fallbacks.
 */
export function resolveGoogleCredentials(
  env: Record<string, string | undefined> = process.env
): GoogleCredentials {
  const idCandidates = [
    env.AUTH_GOOGLE_ID,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_ID,
    env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  ];
  let clientId: string | undefined;
  for (const candidate of idCandidates) {
    const cleaned = sanitizeCredentialValue(candidate);
    if (cleaned) {
      clientId = cleaned;
      break;
    }
  }

  const secretCandidates = [
    env.AUTH_GOOGLE_SECRET,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_SECRET,
  ];
  let clientSecret: string | undefined;
  for (const candidate of secretCandidates) {
    const cleaned = sanitizeCredentialValue(candidate);
    if (cleaned) {
      clientSecret = cleaned;
      break;
    }
  }

  return {
    clientId,
    clientSecret,
  };
}

const resolvedSecret = resolveAuthSecret(process.env);
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = resolvedSecret;
}
if (!process.env.AUTH_TRUST_HOST) {
  process.env.AUTH_TRUST_HOST = "true";
}

const googleCreds = resolveGoogleCredentials(process.env);
if (googleCreds.clientId) {
  process.env.AUTH_GOOGLE_ID = googleCreds.clientId;
  process.env.GOOGLE_CLIENT_ID = googleCreds.clientId;
} else {
  delete process.env.AUTH_GOOGLE_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_ID;
}

if (googleCreds.clientSecret) {
  process.env.AUTH_GOOGLE_SECRET = googleCreds.clientSecret;
  process.env.GOOGLE_CLIENT_SECRET = googleCreds.clientSecret;
} else {
  delete process.env.AUTH_GOOGLE_SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_SECRET;
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: resolvedSecret,
  providers: [
    Google({
      clientId: googleCreds.clientId,
      clientSecret: googleCreds.clientSecret,
      checks: ["pkce"],
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  logger: {
    error(error) {
      console.error("[AUTH_CRITICAL_LOGGER_ERROR]", {
        name: (error as any)?.name,
        message: (error as any)?.message,
        stack: (error as any)?.stack,
        cause: (error as any)?.cause,
      });
    },
    warn(code) {
      console.warn("[AUTH_LOGGER_WARN]", code);
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      const canonicalBase = baseUrl.replace(
        /^https?:\/\/redeativa\.app\.br(?::\d+)?/i,
        `https://${CANONICAL_PRODUCTION_HOST}`
      );

      if (url.startsWith("/")) {
        return `${canonicalBase}${url}`;
      }

      try {
        const parsedUrl = new URL(url);
        const parsedBase = new URL(canonicalBase);

        if (parsedUrl.origin === parsedBase.origin) {
          return url;
        }

        // Se a navegação envolver redeativa.app.br ou www.redeativa.app.br,
        // força redirecionamento estrito para a origem canônica www.redeativa.app.br
        const isApexOrWww =
          parsedUrl.hostname === APEX_PRODUCTION_HOST ||
          parsedUrl.hostname === CANONICAL_PRODUCTION_HOST;

        if (isApexOrWww) {
          return `https://${CANONICAL_PRODUCTION_HOST}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        }
      } catch {
        // url inválida
      }
      return canonicalBase;
    },
    async session({ session, token }) {
      if (session.user) {
        const email = (session.user.email || "").toLowerCase().trim();
        const isRoot = isBootstrapAdminEmail(email);
        (session.user as any).id = token.userId as string | undefined;
        (session.user as any).role = isRoot ? "SUPERADMIN" : (token.role as string) || "PEDAGOGA";
        (session.user as any).active = isRoot ? true : token.active !== false;
        if (token.name) {
          session.user.name = String(token.name);
        }
        if (token.schoolId) {
          (session.user as any).schoolId = String(token.schoolId);
        }
        if (token.userSchools) {
          (session.user as any).schools = token.userSchools;
        }
        if (token.userNetworks) {
          (session.user as any).networks = token.userNetworks;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
