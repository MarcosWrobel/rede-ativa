"use client";

import { usePathname } from "next/navigation";
import { Menu, GraduationCap, Bell, Search, ShieldCheck } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

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
    "/": { title: "Visão Geral", subtitle: "Painel de controle e métricas gerais" },
    "/faltas": { title: "Painel de Frequência & Alertas", subtitle: "Monitoramento de infrequência, risco crítico e SERP" },
    "/busca-ativa": { title: "Enviar Mensagem", subtitle: "Envio individual e fila assistida por turma via wa.me" },
    "/historico": { title: "Histórico & Retornos", subtitle: "Controle de contatos e retornos familiares com IA" },
    "/alunos": { title: "Alunos e Turmas", subtitle: "Gestão cadastral, prontuários 360º e importação oficial" },
    "/atestados": { title: "Painel de Atestados", subtitle: "Lançamento ágil e controle de atestados e licenças médicas" },
    "/atas": { title: "Livro de Atas Digital", subtitle: "Atendimento pedagógico, assinaturas digitais e fé pública" },
    "/encaminhamentos": { title: "Combinados & Encaminhamentos", subtitle: "Gestão e baixa de prazos e compromissos firmados em atas" },
    "/boletim": { title: "Boletim Semanal", subtitle: "Diagnóstico executivo de busca ativa e infrequência" },
    "/relatorios": { title: "Relatórios & Estatísticas", subtitle: "Indicadores de ocorrências, causas e metas" },
    "/modelos": { title: "Modelos de Mensagem", subtitle: "Textos padronizados de comunicação institucional" },
    "/equipe": { title: "Equipe & Acessos", subtitle: "Controle institucional de servidores autorizados" },
    "/auditoria": { title: "Trilha de Auditoria", subtitle: "Histórico imutável de conformidade e auditoria com IP" },
  };

  let currentInfo = pageTitles[pathname];
  if (!currentInfo) {
    if (pathname.includes("/dossie")) {
      currentInfo = { title: "Dossiê Oficial do Estudante", subtitle: "Relatório técnico em conformidade com o ECA para CT/MP/SERP" };
    } else if (pathname.startsWith("/alunos/")) {
      currentInfo = { title: "Prontuário 360º do Aluno", subtitle: "Ficha individual com frequência, atestados e linha do tempo" };
    } else if (pathname.includes("/imprimir")) {
      currentInfo = { title: "Impressão da Ata Oficial", subtitle: "Documento oficial A4 com fé pública e assinaturas" };
    } else if (pathname.startsWith("/atas/livro/")) {
      currentInfo = { title: "Livro Anual Consolidado", subtitle: "Termo de abertura, atas sequenciais e encerramento anual" };
    } else {
      currentInfo = { title: "Colégio Leopoldina", subtitle: "Sistema de Busca Ativa & Atas" };
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
          <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">Colégio Leopoldina</span>
          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">/</span>
          <span className="text-slate-700 dark:text-slate-200 font-bold">{currentInfo.title}</span>
        </div>
      </div>

      {/* Right: Theme Toggle & User Status */}
      <div className="flex items-center space-x-3">
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
