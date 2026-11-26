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
        if (existing && !existing.active) {
          throw new Error("Conta desativada.");
        }

        const user =
          existing ||
          (await prisma.user.create({
            data: {
              email,
              name: email.split("@")[0].replace(".", " ").toUpperCase(),
              role: isRootAdmin ? "SUPERADMIN" : "PEDAGOGA",
              active: isRootAdmin,
            },
          }));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: resolveTokenRole({ isRootAdmin, dbRole: user.role }),
          active: user.active !== false,
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
            schoolId: null,
            details: { reason: "CONTA_NAO_AUTORIZADA_NA_PLATAFORMA", email },
            user: { name: user.name || "Visitante Externo", email },
          });
          return "/login?error=NotAuthorizedTeam";
        }

        if (!existingUser) {
          console.warn(`[AUTH] Login negado para conta fora da equipe autorizada: ${email}`);
          if (!isRootAdmin) {
            await logAudit({
              action: "LOGIN_DENIED",
              entityType: "User",
              schoolId: null,
              details: {
                reason: isSeedPrDomain ? "FORA_DA_LISTA_AUTORIZADA" : "CONTA_NAO_AUTORIZADA_NA_PLATAFORMA",
                email,
              },
              user: { name: user.name || email.split("@")[0], email },
            });
            return "/login?error=NotAuthorizedTeam";
          }
        }

        if (existingUser && !existingUser.active) {
          console.warn(`[AUTH] Login negado para conta desativada: ${email}`);
          await logAudit({
            action: "LOGIN_DENIED",
            entityType: "User",
            entityId: existingUser.id,
            schoolId: existingUser.schoolId ?? null,
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
            ...(isRootAdmin && existingUser?.active !== false ? { role: "SUPERADMIN" } : {}),
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
        user.active = dbUser.active !== false;
        user.schoolId = dbUser.schoolId;

        await logAudit({
          action: "USER_LOGIN",
          entityType: "User",
          entityId: dbUser.id,
          schoolId: dbUser.schoolId ?? null,
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
          networkId: s.networkId ?? null,
          logoUrl: sanitizeJwtLogoUrl(s.logoUrl),
          active: s.active !== false,
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
          active: n.active !== false,
        }));
      }

      const requestedSchoolFromUpdate =
        trigger === "update" && session?.activeSchoolId
          ? String(session.activeSchoolId).trim()
          : null;

      if (user) {
        token.userId = user.dbId || user.id;
        token.role = resolveTokenRole({
          isRootAdmin,
          dbRole: user.role,
        });
        token.active = user.active !== false;
        token.schoolId = user.schoolId ?? null;
        token.checkedAt = 0; // Força carregamento completo dos vínculos no banco
      }

      const lastChecked = Number(token.checkedAt || 0);
      const needsRefresh =
        trigger === "update" ||
        !token.userId ||
        !token.userSchools ||
        Date.now() - lastChecked > SESSION_REVALIDATE_MS;

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
                where: {
                  active: true,
                  school: { active: true },
                },
                include: {
                  school: {
                    select: {
                      id: true,
                      name: true,
                      inepCode: true,
                      city: true,
                      network: true,
                      networkId: true,
                      active: true,
                      updatedAt: true,
                    },
                  },
                },
              },
              networks: {
                where: {
                  active: true,
                  network: { active: true },
                },
                include: {
                  network: {
                    select: {
                      id: true,
                      name: true,
                      shortName: true,
                      city: true,
                      type: true,
                      active: true,
                    },
                  },
                },
              },
            },
          });
          if (dbUser && dbUser.active !== false) {
            token.userId = dbUser.id;
            token.name = dbUser.name;
            token.active = true;

            const mappedSchools: SessionSchoolLink[] = dbUser.schools
              .filter((s) => s.active !== false && s.school?.active !== false)
              .map((s) => ({
                schoolId: s.schoolId,
                role: s.role === "ADMIN" ? "GESTOR_ESCOLAR" : s.role,
                name: s.school.name,
                inepCode: s.school.inepCode,
                city: s.school.city,
                network: s.school.network || "ESTADUAL",
                networkId: s.school.networkId ?? null,
                logoUrl: `/api/schools/${s.schoolId}/logo?v=${s.school.updatedAt ? new Date(s.school.updatedAt).getTime() : 1}`,
                active: true,
              }));
            token.userSchools = mappedSchools;

            const mappedNetworks: SessionNetworkLink[] = (dbUser.networks || [])
              .filter((n) => n.active !== false && n.network?.active !== false)
              .map((n) => ({
                networkId: n.networkId,
                role: n.role,
                name: n.network.name,
                shortName: n.network.shortName,
                city: n.network.city,
                type: n.network.type,
                logoUrl: null,
              }));
            token.userNetworks = mappedNetworks;

            const candidateSchoolId =
              requestedSchoolFromUpdate ||
              (dbUser.schoolId ? String(dbUser.schoolId).trim() : null) ||
              (token.schoolId ? String(token.schoolId).trim() : null);

            let validSelected: string | null = null;
            if (candidateSchoolId) {
              if (mappedSchools.some((s) => s.schoolId === candidateSchoolId)) {
                validSelected = candidateSchoolId;
              } else if (isRootAdmin || dbUser.role === "SUPERADMIN") {
                const activeCandidate = await prisma.school.findFirst({
                  where: { id: candidateSchoolId, active: true },
                  select: { id: true },
                });
                if (activeCandidate) validSelected = activeCandidate.id;
              } else if (mappedNetworks.length > 0) {
                const candidateSchool = await prisma.school.findFirst({
                  where: { id: candidateSchoolId, active: true },
                  select: { id: true, networkId: true },
                });
                if (candidateSchool?.networkId) {
                  const allowedIds = mappedNetworks.map((n) => n.networkId);
                  if (allowedIds.includes(candidateSchool.networkId)) {
                    validSelected = candidateSchool.id;
                  }
                }
              }
            }

            if (!validSelected) {
              validSelected = mappedSchools[0]?.schoolId || null;
            }

            token.schoolId = validSelected;
            const activeSchoolInfo = mappedSchools.find((s) => s.schoolId === validSelected);
            const hasSecNet = mappedNetworks.some(
              (n) => !n.role || n.role === "GESTAO_SECRETARIA"
            );

            if (isRootAdmin || dbUser.role === "SUPERADMIN") {
              token.role = "SUPERADMIN";
            } else if (
              activeSchoolInfo?.role === "GESTOR_ESCOLAR" ||
              activeSchoolInfo?.role === "GESTAO_SECRETARIA"
            ) {
              token.role = activeSchoolInfo.role;
            } else if (hasSecNet) {
              token.role = "GESTAO_SECRETARIA";
            } else if (activeSchoolInfo) {
              token.role = activeSchoolInfo.role;
            } else {
              token.role = "PEDAGOGA";
            }
          } else {
            token.active = false;
            token.schoolId = null;
            token.userSchools = [];
            token.userNetworks = [];
            token.role = "PEDAGOGA";
          }
          token.checkedAt = Date.now();
        } catch (err) {
          console.error("[AUTH] Falha ao revalidar JWT no banco (sem renovar checkedAt):", err);
        }
      }

      return token;
    },
  },
});
