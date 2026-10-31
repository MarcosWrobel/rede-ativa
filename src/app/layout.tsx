import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppLayoutClient from "@/components/AppLayoutClient";
import PwaRegister from "@/components/PwaRegister";
import { auth } from "@/lib/auth";

export const viewport: Viewport = {
  themeColor: "#0284c7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Busca Ativa & Comunicação | Colégio Estadual Leopoldina",
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
  const session = await auth();
  const currentUser = session?.user
    ? {
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
        role: (session.user as any).role || "PEDAGOGA",
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
        <AppLayoutClient currentUser={currentUser}>
          {children}
        </AppLayoutClient>
        <PwaRegister />
      </body>
    </html>
  );
}
