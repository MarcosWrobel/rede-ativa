"use client";

import { usePathname } from "next/navigation";
import { Menu, GraduationCap, Bell, Search, ShieldCheck } from "lucide-react";

interface TopHeaderProps {
  currentUser?: {
    name: string;
    email: string;
    role: string;
  } | null;
  onOpenMobile: () => void;
}

export default function TopHeader({ currentUser, onOpenMobile }: TopHeaderProps) {
  const pathname = usePathname();

  if (pathname === "/login") return null;

  const pageTitles: Record<string, { title: string; subtitle: string }> = {
    "/": { title: "Visão Geral", subtitle: "Painel de controle e métricas" },
    "/busca-ativa": { title: "Painel de Envio", subtitle: "Disparo e registro de contatos escolares" },
    "/historico": { title: "Histórico de Envios", subtitle: "Controle de contatos e retornos dos pais" },
    "/faltas": { title: "Busca-ativa", subtitle: "Acompanhamento de infrequência e Conselho Tutelar" },
    "/relatorios": { title: "Relatórios & Estatísticas", subtitle: "Indicadores de ocorrências e comunicação" },
    "/alunos": { title: "Alunos & Turmas", subtitle: "Gestão cadastral de estudantes" },
    "/modelos": { title: "Modelos de Mensagem", subtitle: "Textos padronizados de comunicação" },
    "/auditoria": { title: "Trilha de Auditoria", subtitle: "Histórico imutável de conformidade" },
  };

  const currentInfo = pageTitles[pathname] || {
    title: "Colégio Leopoldina",
    subtitle: "Sistema de Busca Ativa",
  };

  return (
    <header className="h-14 bg-white border-b border-slate-200 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 lg:px-8">
      {/* Left: Mobile Toggle & Brand / Breadcrumb */}
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={onOpenMobile}
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-500">
          <GraduationCap className="w-4 h-4 text-sky-600 hidden sm:block" />
          <span className="text-slate-400 hidden sm:inline">Colégio Leopoldina</span>
          <span className="text-slate-300 hidden sm:inline">/</span>
          <span className="text-slate-700 font-bold">{currentInfo.title}</span>
        </div>
      </div>

      {/* Right: User Status */}
      <div className="flex items-center space-x-3">
        {currentUser ? (
          <div className="flex items-center space-x-2.5 bg-slate-50 border border-slate-200 py-1.5 px-3 rounded-full text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-slate-800">{currentUser.name}</span>
            <span className="text-slate-400 font-mono text-[11px] hidden md:inline">
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
