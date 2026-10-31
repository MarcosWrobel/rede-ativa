"use client";

import Link from "next/link";
import {
  GraduationCap,
  Users,
  AlertTriangle,
  FileSpreadsheet,
  Settings,
  Send,
  BookOpenCheck,
  TrendingDown,
  Building2,
  ArrowRight,
  ShieldCheck,
  UserCheck,
  Clock,
  Sparkles,
} from "lucide-react";

interface GestaoClientProps {
  school: {
    id: string;
    name: string;
    inepCode: string;
    city: string;
    state: string;
    network?: string | null;
    phone?: string | null;
    email?: string | null;
    logoUrl?: string | null;
  };
  metrics: {
    totalStudents: number;
    totalClasses: number;
    lowAttendanceCount: number;
    messagesThisMonth: number;
    totalMinutes: number;
    staffCount: number;
    averageAttendancePercent: number;
  };
  classesSummary: Array<{
    id: string;
    name: string;
    segment: string;
    shift: string;
    studentsCount: number;
  }>;
  criticalStudents: Array<{
    id: string;
    name: string;
    className: string;
    attendancePercent: number;
    phone?: string | null;
  }>;
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
}

export default function GestaoClient({
  school,
  metrics,
  classesSummary,
  criticalStudents,
  currentUser,
}: GestaoClientProps) {
  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-sky-950 rounded-2xl p-6 sm:p-8 text-white border border-slate-800 shadow-lg">
        <div className="absolute top-0 right-0 -mt-6 -mr-6 w-56 h-56 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md flex items-center justify-center p-1.5 flex-shrink-0">
              {school.logoUrl ? (
                <img
                  src={school.logoUrl}
                  alt=""
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <Building2 className="w-7 h-7 text-sky-300" />
              )}
            </div>
            <div>
              <div className="inline-flex items-center space-x-2 bg-white/10 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-xs mb-2 border border-white/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Painel da Direção & Gestão Escolar</span>
                <span className="text-white/40">•</span>
                <span>INEP: {school.inepCode}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {school.name}
              </h1>
              <p className="text-slate-300 text-sm mt-1 max-w-xl">
                {school.city} • Rede {school.network === "MUNICIPAL" ? "Municipal (SEMEC)" : "Estadual (SEED-PR)"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/busca-ativa"
              className="inline-flex items-center space-x-2 bg-sky-500 hover:bg-sky-600 text-white font-bold px-4 py-2.5 rounded-xl shadow-md transition text-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Abrir Busca Ativa</span>
            </Link>
            <Link
              href="/equipe"
              className="inline-flex items-center space-x-2 bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-2.5 rounded-xl border border-white/20 shadow-sm transition text-xs"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Gerenciar Equipe</span>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total de Alunos
            </span>
            <GraduationCap className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.totalStudents}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Em {metrics.totalClasses} turmas ativas
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Média de Frequência
            </span>
            <TrendingDown className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {metrics.averageAttendancePercent}%
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Meta institucional: 85%
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Risco Crítico (&lt;75%)
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {metrics.lowAttendanceCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Alunos em acompanhamento SERP
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Atas & Equipe
            </span>
            <BookOpenCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            {metrics.totalMinutes}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {metrics.staffCount} servidores na equipe
          </div>
        </div>
      </div>

      {/* Quick Action Hub for Directors */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <span>Módulos de Gestão da Unidade Escolar</span>
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Atalhos administrativos</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            href="/equipe"
            className="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-sky-500 dark:hover:border-sky-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-sky-50/40 dark:hover:bg-sky-950/20 transition flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 flex items-center justify-center mb-3">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm group-hover:text-sky-600 dark:group-hover:text-sky-400 transition">
                Equipe & Servidores
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Cadastrar e gerenciar pedagogas e secretários da escola.
              </p>
            </div>
            <div className="mt-4 flex items-center text-xs font-bold text-sky-600 dark:text-sky-400">
              <span>Acessar Equipe</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition" />
            </div>
          </Link>

          <Link
            href="/alunos"
            className="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center mb-3">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                Importação & Turmas
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Importar planilhas SERE / Prefeitura e atualizar enturmação.
              </p>
            </div>
            <div className="mt-4 flex items-center text-xs font-bold text-indigo-600 dark:text-indigo-400">
              <span>Importar Dados</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition" />
            </div>
          </Link>

          <Link
            href="/configuracoes/escola"
            className="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mb-3">
                <Settings className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
                Identidade & Brasão
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Personalizar cabeçalhos de atas, telefones e brasão oficial.
              </p>
            </div>
            <div className="mt-4 flex items-center text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <span>Configurar Escola</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition" />
            </div>
          </Link>

          <Link
            href="/busca-ativa"
            className="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-amber-500 dark:hover:border-amber-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-amber-50/40 dark:hover:bg-amber-950/20 transition flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center mb-3">
                <Send className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm group-hover:text-amber-600 dark:group-hover:text-amber-400 transition">
                Área Pedagógica
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Acessar fila de mensagens, atas e registros de atendimento.
              </p>
            </div>
            <div className="mt-4 flex items-center text-xs font-bold text-amber-600 dark:text-amber-400">
              <span>Ir para Busca Ativa</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition" />
            </div>
          </Link>
        </div>
      </div>

      {/* Two-column layout: Critical Students & Classes summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Critical Students */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Alunos em Risco Crítico</span>
            </h3>
            <Link href="/faltas" className="text-xs font-bold text-sky-600 hover:text-sky-800">
              Ver todos &rarr;
            </Link>
          </div>

          {criticalStudents.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              Nenhum aluno em situação de infrequência crítica registrada no momento.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {criticalStudents.map((st) => (
                <div key={st.id} className="py-3 flex items-center justify-between">
                  <div className="min-w-0 pr-3">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {st.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Turma: {st.className}
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs font-extrabold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2.5 py-1 rounded-full">
                      {st.attendancePercent}%
                    </span>
                    <Link
                      href={`/busca-ativa?studentId=${st.id}`}
                      className="text-xs font-bold text-sky-600 hover:underline"
                    >
                      Disparar
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Classes Summary */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center space-x-2">
              <GraduationCap className="w-4 h-4 text-sky-600" />
              <span>Quadro de Turmas da Unidade</span>
            </h3>
            <Link href="/alunos" className="text-xs font-bold text-sky-600 hover:text-sky-800">
              Enturmação completa &rarr;
            </Link>
          </div>

          {classesSummary.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              Nenhuma turma cadastrada nesta escola ainda. Utilize a importação de alunos para cadastrar.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {classesSummary.slice(0, 9).map((cg) => (
                <div
                  key={cg.id}
                  className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-center"
                >
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{cg.name}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{cg.shift}</p>
                  <p className="text-xs font-black text-sky-600 dark:text-sky-400 mt-1">
                    {cg.studentsCount} alunos
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
