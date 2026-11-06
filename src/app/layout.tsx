import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppLayoutClient from "@/components/AppLayoutClient";
import PwaRegister from "@/components/PwaRegister";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { prisma } from "@/lib/prisma";
import { isBootstrapAdminEmail } from "@/lib/roles";

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
  let session: any = null;
  let currentSchool: any = null;

  try {
    session = await auth();
    const sessionUser = session?.user as any;
    currentSchool = await getCurrentSchool(sessionUser?.schoolId);
  } catch (err: any) {
    if (err?.digest === "DYNAMIC_SERVER_USAGE" || err?.message?.includes("Dynamic server usage")) {
      throw err;
    }
    console.error("[RootLayout] Erro na resolução da sessão ou escola:", err);
  }

  const sessionUser = session?.user as any;
  const isSuper =
    isBootstrapAdminEmail(sessionUser?.email) ||
    sessionUser?.role === "SUPERADMIN" ||
    sessionUser?.role === "ADMIN";
  const isSecretariat = sessionUser?.role === "GESTAO_SECRETARIA";

  let userSchoolsList = Array.isArray(sessionUser?.schools) ? sessionUser.schools : [];
  if (isSuper) {
    try {
      const allActiveSchools = await prisma.school.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          inepCode: true,
          city: true,
          network: true,
          logoUrl: true,
        },
        orderBy: { name: "asc" },
      });
      userSchoolsList = allActiveSchools.map((s) => ({
        schoolId: s.id,
        name: s.name,
        inepCode: s.inepCode,
        city: s.city,
        network: (s as any).network || "ESTADUAL",
        logoUrl: s.logoUrl || null,
        role: "SUPERADMIN",
      }));
    } catch (e) {
      console.warn("[RootLayout] Falha não crítica ao buscar escolas para SuperAdmin:", e);
    }
  } else if (isSecretariat) {
    try {
      const userNetworks = Array.isArray(sessionUser?.networks) ? sessionUser.networks : [];
      const networkIds = userNetworks.map((n: any) => n.networkId);
      const networkSchools = await prisma.school.findMany({
        where: {
          active: true,
          OR: [
            { networkId: { in: networkIds } },
            ...userNetworks.map((n: any) => ({ city: n.city, network: "MUNICIPAL" })),
          ],
        },
        select: {
          id: true,
          name: true,
          inepCode: true,
          city: true,
          network: true,
          logoUrl: true,
        },
        orderBy: { name: "asc" },
      });
      userSchoolsList = networkSchools.map((s) => ({
        schoolId: s.id,
        name: s.name,
        inepCode: s.inepCode,
        city: s.city,
        network: (s as any).network || "MUNICIPAL",
        logoUrl: s.logoUrl || null,
        role: "GESTAO_SECRETARIA",
      }));
    } catch (e) {
      console.warn("[RootLayout] Falha não crítica ao buscar escolas da rede municipal:", e);
    }
  }

  const currentUser = session?.user
    ? {
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
        role: isSuper ? "SUPERADMIN" : sessionUser?.role || "PEDAGOGA",
        schoolId: currentSchool?.id || sessionUser?.schoolId || null,
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
