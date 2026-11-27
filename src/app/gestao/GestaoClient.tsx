"use client";

import { useId, useRef, useState } from "react";
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
  Plus,
  Loader2,
  CheckCircle2,
  Pencil,
} from "lucide-react";
import ModalDialog from "@/components/ModalDialog";

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
  const [classes, setClasses] = useState(classesSummary);
  const [totalClassesCount, setTotalClassesCount] = useState(metrics.totalClasses);
  const [isAddClassModalOpen, setIsAddClassModalOpen] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [newClassSegment, setNewClassSegment] = useState<
    "FUNDAMENTAL" | "MEDIO" | "NOTURNO" | "INFANTIL" | "EJA"
  >("FUNDAMENTAL");
  const [newClassShift, setNewClassShift] = useState<
    "MANHA" | "TARDE" | "NOITE" | "INTEGRAL"
  >("MANHA");
  const [isSubmittingClass, setIsSubmittingClass] = useState(false);
  const [classNameError, setClassNameError] = useState("");
  const [classError, setClassError] = useState("");
  const [classSuccessToast, setClassSuccessToast] = useState("");

  // Edit Class Modal
  const [editingClass, setEditingClass] = useState<{
    id: string;
    name: string;
    segment: string;
    shift: string;
  } | null>(null);
  const [editClassName, setEditClassName] = useState("");
  const [editClassSegment, setEditClassSegment] = useState<
    "FUNDAMENTAL" | "MEDIO" | "NOTURNO" | "INFANTIL" | "EJA"
  >("MEDIO");
  const [editClassShift, setEditClassShift] = useState<
    "MANHA" | "TARDE" | "NOITE" | "INTEGRAL"
  >("MANHA");
  const [isUpdatingClass, setIsUpdatingClass] = useState(false);
  const [editClassError, setEditClassError] = useState("");

  const handleOpenEditClassModal = (cg: {
    id: string;
    name: string;
    segment: string;
    shift: string;
  }) => {
    setEditingClass(cg);
    setEditClassName(cg.name);
    setEditClassSegment(cg.segment as any);
    setEditClassShift(cg.shift as any);
    setEditClassError("");
  };

  const handleCloseEditClassModal = () => {
    if (isUpdatingClass) return;
    setEditingClass(null);
    setEditClassError("");
  };

  const handleUpdateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass || isUpdatingClass) return;

    const fieldMsg = validateClassName(editClassName);
    if (fieldMsg) {
      setEditClassError(fieldMsg);
      return;
    }

    setIsUpdatingClass(true);
    setEditClassError("");
    try {
      const res = await fetch(`/api/classes/${editingClass.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editClassName.trim(),
          segment: editClassSegment,
          shift: editClassShift,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Erro ao atualizar turma.");
      }

      const updated = data.classGroup;
      setClasses((prev) =>
        prev
          .map((cg) =>
            cg.id === editingClass.id
              ? {
                  ...cg,
                  name: updated.name,
                  segment: updated.segment,
                  shift: updated.shift,
                }
              : cg
          )
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingClass(null);
      setClassSuccessToast(`Turma "${updated.name}" atualizada.`);
      setTimeout(() => setClassSuccessToast(""), 5000);
    } catch (err: any) {
      setEditClassError(err.message || "Erro inesperado ao atualizar turma.");
    } finally {
      setIsUpdatingClass(false);
    }
  };

  const classNameInputId = useId();
  const classNameErrorId = useId();
  const classSegmentInputId = useId();
  const classShiftInputId = useId();
  const classNameInputRef = useRef<HTMLInputElement>(null);

  const validateClassName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "Informe o nome da turma.";
    if (trimmed.length < 2) return "O nome da turma deve ter ao menos 2 caracteres.";
    return "";
  };

  const handleOpenClassModal = () => {
    setNewClassName("");
    setNewClassSegment("FUNDAMENTAL");
    setNewClassShift("MANHA");
    setClassNameError("");
    setClassError("");
    setIsAddClassModalOpen(true);
  };

  const handleCloseClassModal = () => {
    if (isSubmittingClass) return;
    setIsAddClassModalOpen(false);
    setClassNameError("");
    setClassError("");
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingClass) return;

    const fieldMsg = validateClassName(newClassName);
    if (fieldMsg) {
      setClassNameError(fieldMsg);
      setClassError("");
      classNameInputRef.current?.focus();
      return;
    }

    setIsSubmittingClass(true);
    setClassNameError("");
    setClassError("");

    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newClassName.trim(),
          segment: newClassSegment,
          shift: newClassShift,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Erro ao cadastrar turma.");
      }

      setClasses((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setTotalClassesCount((prev) => prev + 1);
      setNewClassName("");
      setClassNameError("");
      setClassError("");
      setIsAddClassModalOpen(false);
      setClassSuccessToast(`Turma "${data.name}" vinculada à escola ${school.name} com sucesso.`);
      setTimeout(() => setClassSuccessToast(""), 5000);
    } catch (err: any) {
      setClassError(err.message || "Erro inesperado ao salvar turma. Revise e tente novamente.");
    } finally {
      setIsSubmittingClass(false);
    }
  };

  return (
    <div className="space-y-6">
      {classSuccessToast && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center space-x-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{classSuccessToast}</span>
        </div>
      )}

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
            Em {totalClassesCount} turmas ativas
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
        <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-red-200 dark:border-red-900/60 p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-red-100 dark:border-red-900/40">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Alunos em Risco Crítico</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-900 border border-red-300 text-[11px] font-black tabular-nums">
                    {criticalStudents.length}
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Estudantes abaixo de 75% de frequência aguardando acompanhamento prioritário
                </p>
              </div>
            </div>
            <Link href="/faltas" className="text-xs font-bold text-sky-700 hover:text-sky-900 dark:text-sky-400 shrink-0">
              Ver todos &rarr;
            </Link>
          </div>

          {criticalStudents.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              Nenhum aluno em situação de infrequência crítica registrada no momento.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {[...criticalStudents]
                .sort((a, b) => a.attendancePercent - b.attendancePercent)
                .map((st) => (
                  <div key={st.id} className="py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {st.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Turma: {st.className}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="inline-flex items-center gap-1 text-xs font-extrabold text-red-900 dark:text-red-200 bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded-full tabular-nums">
                        <span>Crítico</span>
                        <span aria-hidden="true">•</span>
                        <span>{st.attendancePercent}%</span>
                      </span>
                      <Link
                        href={`/busca-ativa?studentId=${st.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition shadow-2xs"
                      >
                        <span>Revisar e enviar</span>
                      </Link>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Classes Summary */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center space-x-2">
              <GraduationCap className="w-4 h-4 text-sky-600" />
              <span>Quadro de Turmas da Unidade</span>
            </h3>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleOpenClassModal}
                className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-sky-600 hover:bg-sky-700 text-white transition shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Turma</span>
              </button>
              <Link href="/alunos" className="text-xs font-bold text-sky-600 hover:text-sky-800">
                Enturmação &rarr;
              </Link>
            </div>
          </div>

          {classes.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              <p>Nenhuma turma cadastrada nesta escola ainda.</p>
              <button
                type="button"
                onClick={handleOpenClassModal}
                className="mt-3 inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold hover:bg-sky-100 transition border border-sky-200 dark:border-sky-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Cadastrar Primeira Turma</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
              {classes.map((cg) => (
                <div
                  key={cg.id}
                  className="relative p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-center group"
                >
                  <button
                    type="button"
                    onClick={() => handleOpenEditClassModal(cg)}
                    aria-label={`Editar turma ${cg.name}`}
                    className="absolute top-1.5 right-1.5 p-1 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-700 transition cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 pr-4 truncate">{cg.name}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{cg.shift}</p>
                  <p className="text-xs font-black text-sky-600 dark:text-sky-400 mt-1 tabular-nums">
                    {cg.studentsCount} alunos
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Nova Turma */}
      <ModalDialog
        open={isAddClassModalOpen}
        onClose={handleCloseClassModal}
        preventClose={isSubmittingClass}
        title="Cadastrar Nova Turma"
        subtitle={`Vincular nova turma à unidade ${school.name}.`}
      >
        <form onSubmit={handleCreateClass} noValidate className="space-y-4 text-xs">
          <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-bold text-sky-950 dark:text-sky-200 truncate">
              Unidade: {school.name}
            </span>
            <span className="font-mono font-bold text-sky-800 dark:text-sky-300 tabular-nums">
              INEP {school.inepCode}
            </span>
          </div>

          <fieldset className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5">
            <legend className="px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Identificação e Turno
            </legend>

            <div className="space-y-1">
              <label htmlFor={classNameInputId} className="font-semibold text-slate-700 dark:text-slate-200 block">
                Nome da Turma *
              </label>
              <input
                ref={classNameInputRef}
                id={classNameInputId}
                type="text"
                data-autofocus
                placeholder="Ex: 6º Ano A, 1º Ano Médio B, EJA Fase I..."
                value={newClassName}
                disabled={isSubmittingClass}
                aria-invalid={Boolean(classNameError)}
                aria-describedby={classNameError ? classNameErrorId : undefined}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewClassName(val);
                  if (classNameError) {
                    setClassNameError(validateClassName(val));
                  }
                }}
                onBlur={() => {
                  if (newClassName.trim()) {
                    setClassNameError(validateClassName(newClassName));
                  }
                }}
                className={`w-full p-2.5 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 disabled:opacity-60 ${
                  classNameError
                    ? "border-red-400 focus:ring-red-500"
                    : "border-slate-300 dark:border-slate-700 focus:ring-sky-500"
                }`}
              />
              {classNameError ? (
                <p id={classNameErrorId} role="alert" className="text-[11px] text-red-700 dark:text-red-300 font-semibold">
                  {classNameError}
                </p>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Use nomenclaturas padronizadas (ex: &ldquo;6º Ano A&rdquo; ou &ldquo;1ª Série Noturno&rdquo;).
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={classSegmentInputId} className="font-semibold text-slate-700 dark:text-slate-200 block">
                  Segmento / Nível *
                </label>
                <select
                  id={classSegmentInputId}
                  value={newClassSegment}
                  disabled={isSubmittingClass}
                  onChange={(e) => setNewClassSegment(e.target.value as any)}
                  className="w-full p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white disabled:opacity-60"
                >
                  <option value="FUNDAMENTAL">Ensino Fundamental</option>
                  <option value="MEDIO">Ensino Médio</option>
                  <option value="NOTURNO">Noturno / EJA</option>
                  <option value="INFANTIL">Educação Infantil</option>
                  <option value="EJA">EJA Geral</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor={classShiftInputId} className="font-semibold text-slate-700 dark:text-slate-200 block">
                  Turno *
                </label>
                <select
                  id={classShiftInputId}
                  value={newClassShift}
                  disabled={isSubmittingClass}
                  onChange={(e) => setNewClassShift(e.target.value as any)}
                  className="w-full p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white disabled:opacity-60"
                >
                  <option value="MANHA">Manhã</option>
                  <option value="TARDE">Tarde</option>
                  <option value="NOITE">Noite</option>
                  <option value="INTEGRAL">Integral</option>
                </select>
              </div>
            </div>
          </fieldset>

          {isSubmittingClass && (
            <div
              role="status"
              aria-live="polite"
              className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-xs font-semibold flex items-center gap-2"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Cadastrando turma para {school.name}...</span>
            </div>
          )}

          {classError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 font-semibold">
              {classError}
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handleCloseClassModal}
              disabled={isSubmittingClass}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmittingClass}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingClass ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Cadastrando...</span>
                </>
              ) : (
                <span>Criar Turma</span>
              )}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Modal Editar Turma */}
      <ModalDialog
        open={Boolean(editingClass)}
        onClose={handleCloseEditClassModal}
        preventClose={isUpdatingClass}
        title="Editar Turma"
        subtitle={`Ajuste o nome, nível ou turno da turma em ${school.name}.`}
      >
        <form onSubmit={handleUpdateClass} noValidate className="space-y-4 text-xs">
          <div className="space-y-1">
            <label htmlFor="gestao-edit-class-name" className="font-semibold text-slate-700 dark:text-slate-200 block">
              Nome da Turma *
            </label>
            <input
              id="gestao-edit-class-name"
              type="text"
              data-autofocus
              value={editClassName}
              onChange={(e) => {
                setEditClassName(e.target.value);
                if (editClassError) setEditClassError("");
              }}
              placeholder="Ex: 1º 3, 2º 3, 3º 3"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-white"
              disabled={isUpdatingClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="gestao-edit-class-segment" className="font-semibold text-slate-700 dark:text-slate-200 block">
                Nível
              </label>
              <select
                id="gestao-edit-class-segment"
                value={editClassSegment}
                onChange={(e) => setEditClassSegment(e.target.value as any)}
                className="w-full border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                disabled={isUpdatingClass}
              >
                <option value="FUNDAMENTAL">Ensino Fundamental</option>
                <option value="MEDIO">Ensino Médio</option>
                <option value="NOTURNO">Noturno</option>
                <option value="INFANTIL">Educação Infantil</option>
                <option value="EJA">EJA</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="gestao-edit-class-shift" className="font-semibold text-slate-700 dark:text-slate-200 block">
                Turno
              </label>
              <select
                id="gestao-edit-class-shift"
                value={editClassShift}
                onChange={(e) => setEditClassShift(e.target.value as any)}
                className="w-full border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                disabled={isUpdatingClass}
              >
                <option value="MANHA">Manhã</option>
                <option value="TARDE">Tarde</option>
                <option value="NOITE">Noite</option>
                <option value="INTEGRAL">Integral</option>
              </select>
            </div>
          </div>

          {editClassError && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-semibold">
              {editClassError}
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handleCloseEditClassModal}
              disabled={isUpdatingClass}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isUpdatingClass}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isUpdatingClass ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <span>Salvar Alterações</span>
              )}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
