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
for (const key of ["AUTH_SECRET", "NEXTAUTH_SECRET"]) {
  if (process.env[key]) {
    let val = process.env[key]!.trim();
    val = val.replace(/^AUTH_SECRET=/, "").replace(/^NEXTAUTH_SECRET=/, "").trim();
    val = val.replace(/^["']|["']$/g, "").trim();
    process.env[key] = val;
  }
}

// Garante compatibilidade estrita com Auth.js v5 em qualquer host da Vercel
const fallbackSecret = "rede-ativa-saas-auth-secret-production-stable-2026";
const resolvedSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || fallbackSecret;
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
      checks: ["state"],
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
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
  },
  session: {
    strategy: "jwt",
  },
};
