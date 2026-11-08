import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { isBootstrapAdminEmail } from "./roles";

// Higieniza automaticamente variáveis de ambiente se foram coladas com aspas ou prefixo na Vercel
for (const key of ["NEXTAUTH_URL", "AUTH_URL"] as const) {
  if (process.env[key]) {
    let val = process.env[key]!.trim();
    val = val.replace(/^NEXTAUTH_URL=/, "").replace(/^AUTH_URL=/, "").trim();
    val = val.replace(/^["']|["']$/g, "").trim();
    val = val.replace(/\/api\/auth\/?$/, "").replace(/\/+$/, "");
    process.env[key] = val;
  }
}

// Se NEXTAUTH_URL ou AUTH_URL apontar para o domínio legado/preview .vercel.app, neutraliza a trava
// para permitir que o Auth.js derive dinamicamente a origem via trustHost: true.
// Se uma URL canônica (ex: https://www.redeativa.app.br) foi explicitamente configurada, ela é estritamente PRESERVADA.
for (const key of ["NEXTAUTH_URL", "AUTH_URL"] as const) {
  if (process.env[key] && process.env[key]!.includes(".vercel.app")) {
    delete process.env[key];
  }
}

// Sincroniza AUTH_URL e NEXTAUTH_URL se apenas um deles estiver configurado
if (process.env.AUTH_URL && !process.env.NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = process.env.AUTH_URL;
} else if (process.env.NEXTAUTH_URL && !process.env.AUTH_URL) {
  process.env.AUTH_URL = process.env.NEXTAUTH_URL;
}

// Fallback canônico se nenhuma variável de URL estiver definida, mas existir URL própria na plataforma
if (!process.env.AUTH_URL && !process.env.NEXTAUTH_URL) {
  const fallbackUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").trim();
  if (fallbackUrl && !fallbackUrl.includes(".vercel.app")) {
    const cleaned = fallbackUrl.replace(/\/+$/, "");
    process.env.AUTH_URL = cleaned;
    process.env.NEXTAUTH_URL = cleaned;
  }
}

for (const key of ["AUTH_SECRET", "NEXTAUTH_SECRET"] as const) {
  if (process.env[key]) {
    let val = process.env[key]!.trim();
    val = val.replace(/^AUTH_SECRET=/, "").replace(/^NEXTAUTH_SECRET=/, "").trim();
    val = val.replace(/^["']|["']$/g, "").trim();
    process.env[key] = val;
  }
}

// Garante compatibilidade estrita com Auth.js v5 e bloqueia segredo fixo em runtime de produção
export function resolveAuthSecret(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.AUTH_SECRET || env.NEXTAUTH_SECRET || "").trim();
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

export interface GoogleCredentials {
  clientId: string | undefined;
  clientSecret: string | undefined;
}

/**
 * Remove prefixos de declaração de variáveis (ex: GOOGLE_CLIENT_ID=...), export,
 * aspas simples/duplas e espaços residuais acidentalmente colados no painel da Vercel.
 */
export function sanitizeCredentialValue(val: string | undefined): string | undefined {
  if (!val) return undefined;
  let cleaned = val.trim();
  if (!cleaned) return undefined;

  // 1. Remove aspas externas se toda a linha foi envolvida em aspas
  cleaned = cleaned.replace(/^["'`]|["'`]$/g, "").trim();

  // 2. Remove "export " se colado diretamente de um script de ambiente
  cleaned = cleaned.replace(/^export\s+/i, "").trim();

  // 3. Remove prefixos de atribuição de variáveis
  cleaned = cleaned
    .replace(/^(?:AUTH_GOOGLE_ID|GOOGLE_CLIENT_ID|GOOGLE_ID)\s*=\s*/i, "")
    .replace(/^(?:AUTH_GOOGLE_SECRET|GOOGLE_CLIENT_SECRET|GOOGLE_SECRET)\s*=\s*/i, "")
    .trim();

  // 4. Remove aspas simples, duplas ou crases circundantes do valor
  cleaned = cleaned.replace(/^["'`]|["'`]$/g, "").trim();

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Resolve e normaliza com segurança as credenciais OAuth do Google a partir das variáveis
 * suportadas pelo ecossistema Auth.js e NextAuth, garantindo que valores ausentes retornem
 * undefined (em vez de string vazia "") para permitir que o Auth.js opere seus fallbacks.
 */
export function resolveGoogleCredentials(
  env: Record<string, string | undefined> = process.env
): GoogleCredentials {
  const idCandidates = [env.AUTH_GOOGLE_ID, env.GOOGLE_CLIENT_ID, env.GOOGLE_ID];
  let clientId: string | undefined;
  for (const candidate of idCandidates) {
    const cleaned = sanitizeCredentialValue(candidate);
    if (cleaned) {
      clientId = cleaned;
      break;
    }
  }

  const secretCandidates = [env.AUTH_GOOGLE_SECRET, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_SECRET];
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
if (googleCreds.clientId && !process.env.AUTH_GOOGLE_ID) {
  process.env.AUTH_GOOGLE_ID = googleCreds.clientId;
}
if (googleCreds.clientSecret && !process.env.AUTH_GOOGLE_SECRET) {
  process.env.AUTH_GOOGLE_SECRET = googleCreds.clientSecret;
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
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const parsedUrl = new URL(url);
        const parsedBase = new URL(baseUrl);
        if (parsedUrl.origin === parsedBase.origin) {
          return url;
        }
        // Normaliza navegação entre o apex e o subdomínio www
        const isApexOrWww =
          (parsedUrl.hostname === "redeativa.app.br" && parsedBase.hostname === "www.redeativa.app.br") ||
          (parsedUrl.hostname === "www.redeativa.app.br" && parsedBase.hostname === "redeativa.app.br");
        if (isApexOrWww) {
          return `${parsedBase.origin}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        }
      } catch {
        // url inválida
      }
      return baseUrl;
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
