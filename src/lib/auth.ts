import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { logAudit } from "./audit";
import { authConfig } from "./auth.config";
import { isBootstrapAdminEmail } from "./roles";

const isDevAuthEnabled =
  process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_AUTH === "true";

const providers: any[] = [...(authConfig.providers || [])];

if (isDevAuthEnabled) {
  providers.push(
    Credentials({
      id: "escola-dev-auth",
      name: "Login Homologação Local (@escola.pr.gov.br)",
      credentials: {
        email: { label: "E-mail Institucional (@escola.pr.gov.br)", type: "email" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "").toLowerCase().trim();
        if (!email.endsWith("@escola.pr.gov.br")) {
          throw new Error("Acesso restrito a contas institucionais @escola.pr.gov.br");
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (!existing && !isBootstrapAdminEmail(email)) {
          throw new Error("E-mail não autorizado na equipe da escola.");
        }
        if (existing && !existing.active && !isBootstrapAdminEmail(email)) {
          throw new Error("Conta desativada.");
        }

        const user =
          existing ||
          (await prisma.user.create({
            data: {
              email,
              name: email.split("@")[0].replace(".", " ").toUpperCase(),
              role: "ADMIN",
              active: true,
            },
          }));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: isBootstrapAdminEmail(email) ? "ADMIN" : user.role,
          active: user.active,
        } as any;
      },
    })
  );
}

const SESSION_REVALIDATE_MS = 5 * 60 * 1000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      const email = user.email?.toLowerCase().trim();

      if (!email || !email.endsWith("@escola.pr.gov.br")) {
        console.warn(`[AUTH] Tentativa de login negada para e-mail não institucional: ${email}`);
        await logAudit({
          action: "LOGIN_DENIED",
          entityType: "User",
          details: { reason: "DOMINIO_NAO_INSTITUCIONAL", email: email || "desconhecido" },
          user: { name: user.name || "Visitante Externo", email: email || "desconhecido" },
        });
        return "/login?error=DomainRestricted";
      }

      try {
        const isRootAdmin = isBootstrapAdminEmail(email);
        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        // Se não for o admin semente, exige estar previamente autorizado na tabela User da escola
        if (!isRootAdmin && !existingUser) {
          console.warn(`[AUTH] Login negado para conta fora da equipe autorizada: ${email}`);
          await logAudit({
            action: "LOGIN_DENIED",
            entityType: "User",
            details: { reason: "FORA_DA_LISTA_AUTORIZADA", email },
            user: { name: user.name || email.split("@")[0], email },
          });
          return "/login?error=NotAuthorizedTeam";
        }

        if (!isRootAdmin && existingUser && !existingUser.active) {
          console.warn(`[AUTH] Login negado para conta desativada: ${email}`);
          await logAudit({
            action: "LOGIN_DENIED",
            entityType: "User",
            entityId: existingUser.id,
            details: { reason: "CONTA_DESATIVADA", email },
            user: { id: existingUser.id, name: existingUser.name, email },
          });
          return "/login?error=AccountInactive";
        }

        const dbUser = await prisma.user.upsert({
          where: { email },
          update: {
            name: user.name || existingUser?.name || email.split("@")[0],
            image: user.image ?? existingUser?.image,
            ...(isRootAdmin ? { role: "ADMIN", active: true } : {}),
          },
          create: {
            email,
            name: user.name || email.split("@")[0],
            image: user.image,
            role: "ADMIN",
            active: true,
          },
        });

        (user as any).dbId = dbUser.id;
        (user as any).role = isRootAdmin ? "ADMIN" : dbUser.role;
        (user as any).active = isRootAdmin ? true : dbUser.active;

        await logAudit({
          action: "USER_LOGIN",
          entityType: "User",
          entityId: dbUser.id,
          details: { provider: account?.provider || "google", email, role: dbUser.role },
          user: { id: dbUser.id, name: dbUser.name, email: dbUser.email },
        });
      } catch (err) {
        console.error("[AUTH] Erro ao validar/sincronizar usuário no banco:", err);
        return "/login?error=ServerError";
      }

      return true;
    },
    async jwt({ token, user }) {
      const email = ((user?.email || token?.email || "") as string).toLowerCase().trim();
      const isRootAdmin = isBootstrapAdminEmail(email);

      if (user) {
        token.userId = (user as any).dbId || user.id;
        token.role = isRootAdmin ? "ADMIN" : (user as any).role || "PEDAGOGA";
        token.active = isRootAdmin ? true : (user as any).active !== false;
        token.checkedAt = Date.now();
        return token;
      }

      const lastChecked = Number(token.checkedAt || 0);
      const needsRefresh = !token.userId || Date.now() - lastChecked > SESSION_REVALIDATE_MS;

      if (email && needsRefresh) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true, role: true, active: true, name: true },
          });
          if (dbUser) {
            token.userId = dbUser.id;
            token.name = dbUser.name;
            token.role = isRootAdmin ? "ADMIN" : dbUser.role;
            token.active = isRootAdmin ? true : dbUser.active;
          } else if (!isRootAdmin) {
            token.active = false;
          }
          token.checkedAt = Date.now();
        } catch (err) {
          console.error("[AUTH] Falha leve ao revalidar JWT:", err);
        }
      }

      return token;
    },
  },
});
