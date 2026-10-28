import type { Metadata } from "next";
import "./globals.css";
import AppLayoutClient from "@/components/AppLayoutClient";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Busca Ativa & Comunicação | Colégio Estadual Leopoldina",
  description: "Sistema web de busca ativa, comunicação escolar automatizada e controle de faltas",
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
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <AppLayoutClient currentUser={currentUser}>
          {children}
        </AppLayoutClient>
      </body>
    </html>
  );
}
