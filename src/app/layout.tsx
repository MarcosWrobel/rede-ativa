import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppLayoutClient from "@/components/AppLayoutClient";
import PwaRegister from "@/components/PwaRegister";
import { auth } from "@/lib/auth";
import {
  getAuthorizedCurrentSchool,
  getCachedDirectory,
  setCachedDirectory,
} from "@/lib/currentSchool";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { prisma } from "@/lib/prisma";
import {
  buildSessionFromSnapshot,
  isSnapshotSuperAdmin,
  resolveEffectiveRoleForSchool,
  resolveEffectiveSessionRoleWithoutSchool,
  resolveServerUserAuthSnapshot,
  type ServerUserAuthSnapshot,
} from "@/lib/serverAuthContext";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#0284c7",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Busca Ativa & Comunicação | Gestão Escolar",
  description: "Sistema web de busca ativa, comunicação escolar automatizada e controle de faltas",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Busca Ativa",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png" }],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let effectiveSession: any = null;
  let snapshot: ServerUserAuthSnapshot | null = null;
  let currentSchool: any = null;

  try {
    const rawSession = await auth();
    if (rawSession?.user) {
      snapshot = await resolveServerUserAuthSnapshot(rawSession);
      if (snapshot && snapshot.active !== false) {
        effectiveSession = buildSessionFromSnapshot(rawSession, snapshot);
        currentSchool = await getAuthorizedCurrentSchool(
          effectiveSession,
          effectiveSession?.user?.schoolId,
          snapshot
        );
        if (currentSchool) {
          effectiveSession = buildSessionFromSnapshot(effectiveSession, snapshot, currentSchool);
        }
      } else {
        snapshot = null;
      }
    }
  } catch (err: any) {
    if (err?.digest === "DYNAMIC_SERVER_USAGE" || err?.message?.includes("Dynamic server usage")) {
      throw err;
    }
    console.error("[RootLayout] Erro na resolução da sessão ou escola:", err);
  }

  const sessionUser = effectiveSession?.user as any;
  const isSuper = isSnapshotSuperAdmin(snapshot);
  const activeNetworks = (snapshot?.networks || []).filter(
    (n) => n.active && n.network?.active !== false
  );
  const isSecretariat =
    !isSuper &&
    activeNetworks.some((n) => n.role.toUpperCase() === "GESTAO_SECRETARIA");

  let userSchoolsList = Array.isArray(sessionUser?.schools) ? sessionUser.schools : [];
  if (isSuper) {
    try {
      const cachedList = getCachedDirectory<any>("superadmin_schools");
      if (cachedList) {
        userSchoolsList = cachedList;
      } else {
        const allActiveSchools = await prisma.school.findMany({
          where: { active: true },
          select: {
            id: true,
            name: true,
            inepCode: true,
            city: true,
            network: true,
            updatedAt: true,
          },
          orderBy: { name: "asc" },
        });
        userSchoolsList = allActiveSchools.map((s) => ({
          schoolId: s.id,
          name: s.name,
          inepCode: s.inepCode,
          city: s.city,
          network: (s as any).network || "ESTADUAL",
          logoUrl: resolveSchoolLogoProxyUrl({ id: s.id, updatedAt: s.updatedAt }),
          role: "SUPERADMIN",
        }));
        setCachedDirectory("superadmin_schools", userSchoolsList);
      }
    } catch (e) {
      console.warn("[RootLayout] Falha não crítica ao buscar escolas para SuperAdmin:", e);
    }
  } else if (isSecretariat && activeNetworks.length > 0) {
    try {
      const networkIds = Array.from(
        new Set(activeNetworks.map((n) => n.networkId).filter(Boolean))
      );
      const cacheKey = `secretariat_schools:${[...networkIds].sort().join(",")}`;
      const cachedList = getCachedDirectory<any>(cacheKey);
      if (cachedList) {
        userSchoolsList = cachedList;
      } else if (networkIds.length > 0) {
        const networkSchools = await prisma.school.findMany({
          where: {
            active: true,
            networkId: { in: networkIds },
          },
          select: {
            id: true,
            name: true,
            inepCode: true,
            city: true,
            network: true,
            updatedAt: true,
          },
          orderBy: { name: "asc" },
        });
        userSchoolsList = networkSchools.map((s) => ({
          schoolId: s.id,
          name: s.name,
          inepCode: s.inepCode,
          city: s.city,
          network: (s as any).network || "MUNICIPAL",
          logoUrl: resolveSchoolLogoProxyUrl({ id: s.id, updatedAt: s.updatedAt }),
          role: "GESTAO_SECRETARIA",
        }));
        setCachedDirectory(cacheKey, userSchoolsList);
      }
    } catch (e) {
      console.warn("[RootLayout] Falha não crítica ao buscar escolas da rede municipal:", e);
    }
  }

  const resolvedRole = isSuper
    ? "SUPERADMIN"
    : (currentSchool ? resolveEffectiveRoleForSchool(snapshot, currentSchool) : null) ||
      resolveEffectiveSessionRoleWithoutSchool(snapshot) ||
      "PEDAGOGA";

  const currentUser = effectiveSession?.user
    ? {
        name: effectiveSession.user.name || "Pedagoga",
        email: effectiveSession.user.email || "",
        role: resolvedRole,
        schoolId: currentSchool?.id || null,
        schools: userSchoolsList,
        networks: Array.isArray(sessionUser?.networks) ? sessionUser.networks : [],
      }
    : null;

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem('redeativa_theme') || localStorage.getItem('leopoldina_theme');
                if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body className="bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen transition-colors duration-150">
        <AppLayoutClient currentUser={currentUser} currentSchool={currentSchool}>
          {children}
        </AppLayoutClient>
        <PwaRegister />
      </body>
    </html>
  );
}
