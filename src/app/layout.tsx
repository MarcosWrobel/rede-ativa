import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
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
      <body className="bg-slate-50 text-slate-900 min-h-screen flex flex-col">
        <Navbar currentUser={currentUser} />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
        <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          Colégio Estadual Leopoldina B. Pedroso — Sistema de Busca Ativa & Comunicação Escolar 2026. Protegido com autenticação institucional @escola.pr.gov.br.
        </footer>
      </body>
    </html>
  );
}
