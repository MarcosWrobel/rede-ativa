import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { logAudit } from "./audit";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "escola-leopoldina-busca-ativa-secret-key-2026-pr",
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    // Provedor institucional para homologação e login rápido das pedagogas
    Credentials({
      id: "escola-dev-auth",
      name: "Login Institucional (@escola.pr.gov.br)",
      credentials: {
        email: { label: "E-mail Institucional (@escola.pr.gov.br)", type: "email" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "").toLowerCase().trim();
        if (!email.endsWith("@escola.pr.gov.br")) {
          throw new Error("Acesso restrito a contas institucionais @escola.pr.gov.br");
        }

        let user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          user = await prisma.user.create({
            data: {
              email,
              name: email.split("@")[0].replace(".", " ").toUpperCase(),
              role: email.includes("marcos") ? "ADMIN" : "PEDAGOGA",
            },
          });
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = user.email?.toLowerCase().trim();
      if (!email || !email.endsWith("@escola.pr.gov.br")) {
        console.warn(`[AUTH] Tentativa de login negada para e-mail não institucional: ${email}`);
        return false;
      }

      // Upsert user in db
      try {
        const dbUser = await prisma.user.upsert({
          where: { email },
          update: {
            name: user.name || email.split("@")[0],
            image: user.image,
          },
          create: {
            email,
            name: user.name || email.split("@")[0],
            image: user.image,
            role: email.includes("marcos") ? "ADMIN" : "PEDAGOGA",
          },
        });

        await logAudit({
          action: "USER_LOGIN",
          entityType: "User",
          entityId: dbUser.id,
          details: { provider: account?.provider || "credentials", email },
          user: { id: dbUser.id, name: dbUser.name, email: dbUser.email },
        });
      } catch (err) {
        console.error("[AUTH] Erro ao sincronizar usuário no banco:", err);
      }

      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: session.user.email! },
          });
          if (dbUser) {
            (session.user as any).id = dbUser.id;
            (session.user as any).role = dbUser.role;
          }
        } catch (e) {
          console.error("Session user lookup error:", e);
        }
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
      }
      return token;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
