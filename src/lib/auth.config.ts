import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { isBootstrapAdminEmail } from "./roles";

// Higieniza automaticamente variáveis de ambiente se foram coladas com aspas ou prefixo na Vercel
for (const key of ["NEXTAUTH_URL", "AUTH_URL"]) {
  if (process.env[key]) {
    let val = process.env[key]!.trim();
    val = val.replace(/^NEXTAUTH_URL=/, "").replace(/^AUTH_URL=/, "").trim();
    val = val.replace(/^["']|["']$/g, "").trim();
    val = val.replace(/\/api\/auth\/?$/, "").replace(/\/+$/, "");
    process.env[key] = val;
  }
}

// Na Vercel ou em produção, neutraliza NEXTAUTH_URL ou AUTH_URL estático para permitir que o Auth.js v5
// derive dinamicamente a origem da requisição via trustHost: true (x-forwarded-host),
// suportando perfeitamente www.redeativa.app.br, redeativa.app.br e domínios legados sem travar em hosts antigos.
if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
  for (const key of ["NEXTAUTH_URL", "AUTH_URL"]) {
    if (process.env[key] && (process.env.VERCEL === "1" || process.env[key]!.includes(".vercel.app"))) {
      delete process.env[key];
    }
  }
}
for (const key of ["AUTH_SECRET", "NEXTAUTH_SECRET"]) {
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

const resolvedSecret = resolveAuthSecret(process.env);
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = resolvedSecret;
}
if (!process.env.AUTH_TRUST_HOST) {
  process.env.AUTH_TRUST_HOST = "true";
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: resolvedSecret,
  providers: [
    Google({
      clientId: (process.env.GOOGLE_CLIENT_ID || "").replace(/^["']|["']$/g, "").trim(),
      clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").replace(/^["']|["']$/g, "").trim(),
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
