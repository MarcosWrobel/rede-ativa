"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TopHeader from "./TopHeader";
import ElevationBanner from "./ElevationBanner";

interface AppLayoutClientProps {
  children: React.ReactNode;
  currentUser?: {
    name: string;
    email: string;
    role: string;
    schoolId?: string | null;
    schools?: Array<{
      schoolId: string;
      name: string;
      network?: string;
      city?: string;
      role: string;
      isDefault?: boolean;
    }>;
  } | null;
  currentSchool?: any;
}

export default function AppLayoutClient({ children, currentUser, currentSchool }: AppLayoutClientProps) {
  const pathname = usePathname() || "";
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

  const isStandalonePage =
    pathname === "/login" ||
    pathname.startsWith("/validar/ata/") ||
    pathname.startsWith("/assinar/ata/");

  if (isStandalonePage) {
    return <main className="min-h-screen bg-slate-50">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 print:bg-white flex transition-colors">
      {/* Sidebar */}
      <div className="print:hidden">
        <Sidebar
          currentUser={currentUser}
          currentSchool={currentSchool}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
        />
      </div>

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 print:pl-0 ${
          collapsed ? "lg:pl-20" : "lg:pl-64"
        }`}
      >
        <div className="print:hidden">
          <TopHeader
            currentUser={currentUser}
            currentSchool={currentSchool}
            onOpenMobile={() => setMobileOpen(true)}
          />
          <ElevationBanner
            currentUser={currentUser}
            currentSchool={currentSchool}
          />
        </div>

        <main className="flex-1 max-w-[1800px] w-full mx-auto p-3 sm:p-5 lg:p-6 print:p-0 print:max-w-none">
          {children}
        </main>

        <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-4 px-6 text-center text-xs text-slate-500 dark:text-slate-400 print:hidden transition-colors">
          {currentSchool?.name || "Colégio Estadual Leopoldina B. Pedroso"} — Sistema de Busca Ativa & Comunicação Escolar 2026. Acesso institucional seguro.
        </footer>
      </div>
    </div>
  );
}
