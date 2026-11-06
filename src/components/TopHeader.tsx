"use client";

import { usePathname } from "next/navigation";
import { Menu, GraduationCap } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import SchoolSelector from "./SchoolSelector";

interface TopHeaderProps {
  currentUser?: {
    name: string;
    email: string;
    role: string;
    schools?: any[];
  } | null;
  currentSchool?: any;
  onOpenMobile: () => void;
}

export default function TopHeader({ currentUser, currentSchool, onOpenMobile }: TopHeaderProps) {
  const pathname = usePathname() || "";

  if (pathname === "/login") return null;

  const pageTitles: Record<string, { title: string }> = {
    "/": { title: "Início" },
    "/admin": { title: "Administração Global" },
    "/secretaria": { title: "Secretaria de Educação" },
    "/gestao": { title: "Gestão Escolar" },
    "/visao-geral": { title: "Visão Geral" },
    "/faltas": { title: "Frequência e Alertas" },
    "/busca-ativa": { title: "Busca Ativa" },
    "/historico": { title: "Histórico de Contatos" },
    "/alunos": { title: "Estudantes e Turmas" },
    "/atestados": { title: "Atestados e Justificativas" },
    "/atas": { title: "Livro de Atas" },
    "/encaminhamentos": { title: "Encaminhamentos e Prazos" },
    "/boletim": { title: "Boletim de Frequência" },
    "/relatorios": { title: "Relatórios" },
    "/modelos": { title: "Modelos de Mensagem" },
    "/equipe": { title: "Equipe Escolar" },
    "/auditoria": { title: "Auditoria" },
    "/configuracoes/escola": { title: "Configurações da Escola" },
    "/admin/escolas": { title: "Cadastro de Escolas" },
  };

  let currentInfo = pageTitles[pathname];
  if (!currentInfo) {
    if (pathname.includes("/dossie")) {
      currentInfo = { title: "Dossiê do Estudante" };
    } else if (pathname.startsWith("/alunos/")) {
      currentInfo = { title: "Prontuário do Estudante" };
    } else if (pathname.includes("/imprimir")) {
      currentInfo = { title: "Impressão da Ata" };
    } else if (pathname.startsWith("/atas/livro/")) {
      currentInfo = { title: "Livro Anual" };
    } else {
      currentInfo = { title: currentSchool?.name || "Rede Ativa" };
    }
  }

  return (
    <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 lg:px-8 transition-colors">
      {/* Left: Mobile Toggle & Brand / Breadcrumb */}
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={onOpenMobile}
          className="lg:hidden p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <GraduationCap className="w-4 h-4 text-sky-600 dark:text-sky-400 hidden sm:block" />
          <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">
            {currentSchool?.shortName || currentSchool?.name || "Colégio Estadual"}
          </span>
          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">/</span>
          <span className="text-slate-700 dark:text-slate-200 font-bold">{currentInfo.title}</span>
        </div>
      </div>

      {/* Right: School Selector, Theme Toggle & User Status */}
      <div className="flex items-center space-x-3">
        <SchoolSelector
          currentSchool={currentSchool}
          userSchools={currentUser?.schools}
          isAdmin={currentUser?.role === "ADMIN"}
        />

        <ThemeToggle />

        {currentUser ? (
          <div className="flex items-center space-x-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 py-1.5 px-3 rounded-full text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">{currentUser.name}</span>
            <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px] hidden md:inline">
              ({currentUser.email})
            </span>
          </div>
        ) : (
          <a
            href="/login"
            className="text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-100 transition"
          >
            Entrar com @escola
          </a>
        )}
      </div>
    </header>
  );
}
