import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { SessionSchoolLink, SessionNetworkLink } from "@/types/next-auth";
import { prisma } from "./prisma";
import { logAudit } from "./audit";
import { authConfig, sanitizeJwtLogoUrl } from "./auth.config";
import {
  isBootstrapAdminEmail,
  resolveTokenRole,
  assertNoDevAuthInProduction,
} from "./roles";

export { sanitizeJwtLogoUrl } from "./auth.config";

assertNoDevAuthInProduction(process.env);

const isDevAuthEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.VERCEL_ENV !== "production" &&
  process.env.ENABLE_DEV_AUTH === "true";

const providers: NonNullable<NextAuthConfig["providers"]> = [...(authConfig.providers || [])];

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

        const isRootAdmin = isBootstrapAdminEmail(email);
        const existing = await prisma.user.findUnique({ where: { email } });
        if (!existing && !isRootAdmin) {
          throw new Error("E-mail não autorizado na equipe da escola.");
        }
        if (existing && !existing.active && !isRootAdmin) {
          throw new Error("Conta desativada.");
        }

        const user =
          existing ||
          (await prisma.user.create({
            data: {
              email,
              name: email.split("@")[0].replace(".", " ").toUpperCase(),
              role: isRootAdmin ? "SUPERADMIN" : "PEDAGOGA",
              active: isRootAdmin ? true : false,
            },
          }));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: resolveTokenRole({ isRootAdmin, dbRole: user.role }),
          active: isRootAdmin ? true : user.active,
        };
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

      if (!email) {
        return "/login?error=InvalidEmail";
      }

      const isRootAdmin = isBootstrapAdminEmail(email);
      const isSeedPrDomain = email.endsWith("@escola.pr.gov.br");

      try {
        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        // Permite login se:
        // 1. For o SuperAdmin raiz da plataforma
        // 2. Ou pertencer ao domínio institucional da rede estadual (@escola.pr.gov.br) e estiver autorizado
        // 3. Ou se for uma conta municipal/externa previamente cadastrada/convidada pela gestão
        if (!isRootAdmin && !isSeedPrDomain && !existingUser) {
          console.warn(`[AUTH] Tentativa de login negada para e-mail externo não convidado: ${email}`);
          await logAudit({
            action: "LOGIN_DENIED",
            entityType: "User",
            details: { reason: "CONTA_NAO_AUTORIZADA_NA_PLATAFORMA", email },
            user: { name: user.name || "Visitante Externo", email },
          });
          return "/login?error=NotAuthorizedTeam";
        }

        if (!isRootAdmin && !existingUser && isSeedPrDomain) {
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

        const effectiveRole = resolveTokenRole({
          isRootAdmin,
          dbRole: existingUser?.role,
        });

        const dbUser = await prisma.user.upsert({
          where: { email },
          update: {
            name: user.name || existingUser?.name || email.split("@")[0],
            image: user.image ?? existingUser?.image,
            ...(isRootAdmin ? { role: "SUPERADMIN", active: true } : {}),
          },
          create: {
            email,
            name: user.name || email.split("@")[0],
            image: user.image,
            role: effectiveRole,
            active: true,
          },
        });

        user.dbId = dbUser.id;
        user.role = resolveTokenRole({ isRootAdmin, dbRole: dbUser.role });
        user.active = isRootAdmin ? true : dbUser.active;
        user.schoolId = dbUser.schoolId;

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
    async jwt({ token, user, trigger, session }) {
      const email = ((user?.email || token?.email || "") as string).toLowerCase().trim();
      const isRootAdmin = isBootstrapAdminEmail(email);

      // Higienização defensiva preventiva imediata:
      // Remove URLs base64/data/blob e pruna atributos não autorizados de tokens existentes ou recebidos
      if (
        typeof token.picture === "string" &&
        (token.picture.toLowerCase().startsWith("data:") ||
          token.picture.toLowerCase().startsWith("blob:") ||
          token.picture.length > 255)
      ) {
        delete token.picture;
      }
      if (
        typeof token.image === "string" &&
        (token.image.toLowerCase().startsWith("data:") ||
          token.image.toLowerCase().startsWith("blob:") ||
          token.image.length > 255)
      ) {
        delete token.image;
      }
      if (Array.isArray(token.userSchools)) {
        token.userSchools = (token.userSchools as SessionSchoolLink[]).map((s) => ({
          schoolId: String(s.schoolId || ""),
          role: s.role || "PEDAGOGA",
          name: s.name || "",
          inepCode: s.inepCode || "",
          city: s.city || "",
          network: s.network || "ESTADUAL",
          logoUrl: sanitizeJwtLogoUrl(s.logoUrl),
        }));
      }
      if (Array.isArray(token.userNetworks)) {
        token.userNetworks = (token.userNetworks as SessionNetworkLink[]).map((n) => ({
          networkId: String(n.networkId || ""),
          role: n.role || "GESTAO_SECRETARIA",
          name: n.name || "",
          shortName: n.shortName || "",
          city: n.city || "",
          type: n.type || "MUNICIPAL",
          logoUrl: sanitizeJwtLogoUrl(n.logoUrl),
        }));
      }

      // Trata requisição explícita de alternância de instituição ativa
      if (trigger === "update" && session?.activeSchoolId) {
        const targetSchoolId = String(session.activeSchoolId);
        const userSchools = (token.userSchools as SessionSchoolLink[]) || [];
        const hasAccess = isRootAdmin || userSchools.some((s) => s.schoolId === targetSchoolId);
        if (hasAccess) {
          token.schoolId = targetSchoolId;
          const activeLink = userSchools.find((s) => s.schoolId === targetSchoolId);
          if (activeLink && !isRootAdmin) {
            token.role = activeLink.role || "PEDAGOGA";
          }
        }
        return token;
      }

      if (user) {
        token.userId = user.dbId || user.id;
        token.role = resolveTokenRole({
          isRootAdmin,
          dbRole: user.role,
        });
        token.active = isRootAdmin ? true : user.active !== false;
        token.schoolId = user.schoolId;
        token.checkedAt = Date.now();
      }

      const lastChecked = Number(token.checkedAt || 0);
      const needsRefresh = !token.userId || !token.userSchools || Date.now() - lastChecked > SESSION_REVALIDATE_MS;

      if (email && needsRefresh) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              role: true,
              active: true,
              name: true,
              schoolId: true,
              schools: {
                where: { active: true },
                include: {
                  school: {
                    select: {
                      id: true,
                      name: true,
                      inepCode: true,
                      city: true,
                      network: true,
                      updatedAt: true,
                    },
                  },
                },
              },
              networks: {
                where: { active: true },
                include: {
                  network: {
                    select: {
                      id: true,
                      name: true,
                      shortName: true,
                      city: true,
                      type: true,
                    },
                  },
                },
              },
            },
          });
          if (dbUser) {
            token.userId = dbUser.id;
            token.name = dbUser.name;
            token.active = isRootAdmin ? true : dbUser.active;

            const mappedSchools: SessionSchoolLink[] = dbUser.schools.map((s) => ({
              schoolId: s.schoolId,
              role: s.role,
              name: s.school.name,
              inepCode: s.school.inepCode,
              city: s.school.city,
              network: s.school.network || "ESTADUAL",
              logoUrl: `/api/schools/${s.schoolId}/logo?v=${s.school.updatedAt ? new Date(s.school.updatedAt).getTime() : 1}`,
            }));
            token.userSchools = mappedSchools;

            const mappedNetworks: SessionNetworkLink[] = (dbUser.networks || []).map((n) => ({
              networkId: n.networkId,
              role: n.role,
              name: n.network.name,
              shortName: n.network.shortName,
              city: n.network.city,
              type: n.network.type,
              logoUrl: null,
            }));
            token.userNetworks = mappedNetworks;

            // Se o usuário ainda não tiver um schoolId ativo selecionado ou se o atual não pertencer à lista
            const currentSelected = (token.schoolId as string) || dbUser.schoolId;
            const validSelected =
              isRootAdmin || mappedSchools.some((s) => s.schoolId === currentSelected)
                ? currentSelected
                : mappedSchools[0]?.schoolId || dbUser.schoolId;

            token.schoolId = validSelected;
            const activeSchoolInfo = mappedSchools.find((s) => s.schoolId === validSelected);
            token.role = resolveTokenRole({
              isRootAdmin,
              activeSchoolRole: activeSchoolInfo?.role,
              dbRole: dbUser.role,
            });
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
