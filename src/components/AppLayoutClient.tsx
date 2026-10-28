"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TopHeader from "./TopHeader";

interface AppLayoutClientProps {
  children: React.ReactNode;
  currentUser?: {
    name: string;
    email: string;
    role: string;
  } | null;
}

export default function AppLayoutClient({ children, currentUser }: AppLayoutClientProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("leopoldina_sidebar_collapsed");
    if (saved !== null) {
      setCollapsed(saved === "true");
    }

    const handleStorageChange = () => {
      const current = localStorage.getItem("leopoldina_sidebar_collapsed");
      setCollapsed(current === "true");
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  if (pathname === "/login") {
    return <main className="min-h-screen bg-slate-50">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <Sidebar
        currentUser={currentUser}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          collapsed ? "lg:pl-20" : "lg:pl-64"
        }`}
      >
        <TopHeader
          currentUser={currentUser}
          onOpenMobile={() => setMobileOpen(true)}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>

        <footer className="bg-white border-t border-slate-200 py-4 px-6 text-center text-xs text-slate-500">
          Colégio Estadual Leopoldina B. Pedroso — Sistema de Busca Ativa & Comunicação Escolar 2026. Protegido por autenticação institucional @escola.pr.gov.br.
        </footer>
      </div>
    </div>
  );
}
