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
  const isRootAdmin = isBootstrapAdminEmail(sessionUser?.email) || sessionUser?.role === "ADMIN";

  let userSchoolsList = Array.isArray(sessionUser?.schools) ? sessionUser.schools : [];
  if (isRootAdmin) {
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
        role: "ADMIN",
      }));
    } catch (e) {
      console.warn("[RootLayout] Falha não crítica ao buscar escolas para admin:", e);
    }
  }

  const currentUser = session?.user
    ? {
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
        role: sessionUser?.role || "PEDAGOGA",
        schoolId: currentSchool?.id || sessionUser?.schoolId || null,
        schools: userSchoolsList,
      }
    : null;

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem('leopoldina_theme');
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
