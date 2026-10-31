"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ListTodo,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  Search,
  Filter,
  CheckSquare,
  Square,
  User,
  Users,
  Building2,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  MessageSquare,
  Sparkles,
  FileText,
  RotateCcw,
  Check,
  X
} from "lucide-react";

interface ActionItemMinuteStudent {
  id: string;
  studentId: string;
  studentNameSnapshot: string;
  classNameSnapshot?: string | null;
  cgmSnapshot?: string | null;
  student?: {
    id: string;
    name: string;
    classGroup?: { id: string; name: string } | null;
  } | null;
}

interface ActionItem {
  id: string;
  description: string;
  responsible: "FAMILIA" | "ESTUDANTE" | "ESCOLA" | "REDE_PROTECAO" | string;
  dueDate?: string | Date | null;
  status: "PENDING" | "COMPLETED" | "CANCELED" | string;
  completedAt?: string | Date | null;
  completedByName?: string | null;
  completionNotes?: string | null;
  createdAt: string | Date;
  minute: {
    id: string;
    ataNumber?: number | null;
    year: number;
    subject: string;
    attendedAt: string | Date;
    finalizedAt?: string | Date | null;
    status: string;
    isConfidential?: boolean;
    students: ActionItemMinuteStudent[];
  };
}

interface Props {
  initialActionItems: any[];
  initialMetrics: {
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    dueSoon: number;
  };
  classes: any[];
  todayStr: string;
}

const RESPONSIBLE_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string; icon: any }
> = {
  FAMILIA: {
    label: "Família / Responsáveis",
    bg: "bg-purple-50 dark:bg-purple-950/40",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-200 dark:border-purple-800/60",
    icon: Users,
  },
  ESTUDANTE: {
    label: "Estudante",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200 dark:border-blue-800/60",
    icon: User,
  },
  ESCOLA: {
    label: "Escola / Docentes",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800/60",
    icon: Building2,
  },
  REDE_PROTECAO: {
    label: "Rede de Proteção",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800/60",
    icon: ShieldAlert,
  },
};

export default function EncaminhamentosClient({
  initialActionItems,
  initialMetrics,
  classes,
  todayStr,
}: Props) {
  const [actionItems, setActionItems] = useState<ActionItem[]>(initialActionItems);
  const [metrics, setMetrics] = useState(initialMetrics);

  // Filtros
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "OVERDUE" | "COMPLETED">("PENDING");
  const [responsibleFilter, setResponsibleFilter] = useState<string>("ALL");
  const [turmaFilter, setTurmaFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  // Modal de Baixa / Conclusão
  const [completingItem, setCompletingItem] = useState<ActionItem | null>(null);
  const [completionNotesInput, setCompletionNotesInput] = useState("");
  const [isSubmittingCompletion, setIsSubmittingCompletion] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  // Toast / Mensagem de feedback
  const [toastMsg, setToastMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMsg({ text, type });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  const startOfToday = useMemo(() => {
    return new Date(`${todayStr}T00:00:00.000-03:00`);
  }, [todayStr]);

  const in7Days = useMemo(() => {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() + 7);
    return d;
  }, [startOfToday]);

  // Recalcular métricas a partir dos itens em memória
  const updateMetrics = (items: ActionItem[]) => {
    let total = items.length;
    let completed = 0;
    let pending = 0;
    let overdue = 0;
    let dueSoon = 0;

    for (const a of items) {
      if (a.status === "COMPLETED") {
        completed++;
      } else {
        pending++;
        if (a.dueDate) {
          const due = new Date(a.dueDate);
          if (due < startOfToday) {
            overdue++;
          } else if (due <= in7Days) {
            dueSoon++;
          }
        }
      }
    }

    setMetrics({ total, completed, pending, overdue, dueSoon });
  };

  // Filtragem local
  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim();

    return actionItems.filter((item) => {
      // 1. Filtro de Status
      if (statusFilter === "PENDING" && item.status !== "PENDING") return false;
      if (statusFilter === "COMPLETED" && item.status !== "COMPLETED") return false;
      if (statusFilter === "OVERDUE") {
        if (item.status !== "PENDING") return false;
        if (!item.dueDate) return false;
        const due = new Date(item.dueDate);
        if (due >= startOfToday) return false;
      }

      // 2. Filtro de Responsável
      if (responsibleFilter !== "ALL" && item.responsible !== responsibleFilter) {
        return false;
      }

      // 3. Filtro de Turma
      if (turmaFilter !== "ALL") {
        const matchesTurma = item.minute.students.some((s) => {
          return (
            s.student?.classGroup?.id === turmaFilter ||
            s.classNameSnapshot?.toLowerCase() === classes.find((c) => c.id === turmaFilter)?.name.toLowerCase()
          );
        });
        if (!matchesTurma) return false;
      }

      // 4. Busca textual
      if (q) {
        const descMatch = item.description.toLowerCase().includes(q);
        const notesMatch = item.completionNotes?.toLowerCase().includes(q);
        const subjectMatch = item.minute.subject.toLowerCase().includes(q);
        const ataNumMatch = item.minute.ataNumber?.toString().includes(q);
        const studentMatch = item.minute.students.some(
          (s) =>
            s.studentNameSnapshot.toLowerCase().includes(q) ||
            s.student?.name.toLowerCase().includes(q) ||
            s.cgmSnapshot?.toLowerCase().includes(q)
        );

        if (!descMatch && !notesMatch && !subjectMatch && !ataNumMatch && !studentMatch) {
          return false;
        }
      }

      return true;
    });
  }, [actionItems, statusFilter, responsibleFilter, turmaFilter, search, startOfToday, classes]);

  // Abertura do modal de conclusão
  const handleOpenCompleteModal = (item: ActionItem) => {
    setCompletingItem(item);
    setCompletionNotesInput(item.completionNotes || "");
    setCompletionError(null);
  };

  // Submissão da conclusão (Dar Baixa)
  const handleConfirmCompletion = async () => {
    if (!completingItem) return;
    setIsSubmittingCompletion(true);
    setCompletionError(null);

    try {
      const res = await fetch(`/api/atas/actions/${completingItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "COMPLETED",
          completionNotes: completionNotesInput.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao concluir encaminhamento");
      }

      const updatedList = actionItems.map((item) =>
        item.id === completingItem.id ? { ...item, ...data.actionItem } : item
      );

      setActionItems(updatedList);
      updateMetrics(updatedList);
      showToast("Encaminhamento concluído com sucesso!");
      setCompletingItem(null);
    } catch (err: any) {
      setCompletionError(err.message || "Erro de conexão ao salvar conclusão");
    } finally {
      setIsSubmittingCompletion(false);
    }
  };

  // Reabrir combinado concluído
  const handleReopen = async (item: ActionItem) => {
    if (!confirm(`Deseja reabrir este combinando ("${item.description}") como pendente?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/atas/actions/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "PENDING",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao reabrir encaminhamento");
      }

      const updatedList = actionItems.map((it) =>
        it.id === item.id ? { ...it, ...data.actionItem } : it
      );

      setActionItems(updatedList);
      updateMetrics(updatedList);
      showToast("Encaminhamento reaberto como pendente!");
    } catch (err: any) {
      showToast(err.message || "Erro ao reabrir", "error");
    }
  };

  // Helper para status de prazo
  const getDeadlineInfo = (item: ActionItem) => {
    if (item.status === "COMPLETED") {
      const dateStr = item.completedAt
        ? new Date(item.completedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
        : null;
      return {
        type: "COMPLETED",
        badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
        label: dateStr ? `Concluído em ${dateStr}` : "Concluído",
        subLabel: item.completedByName ? `por ${item.completedByName}` : null,
      };
    }

    if (!item.dueDate) {
      return {
        type: "NO_DATE",
        badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
        label: "Sem prazo fixado",
        subLabel: null,
      };
    }

    const due = new Date(item.dueDate);
    const dateStr = due.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

    // Diferença em dias civis
    const diffTime = due.getTime() - startOfToday.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      const absDays = Math.abs(diffDays);
      return {
        type: "OVERDUE",
        badge: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-800 animate-pulse",
        label: absDays === 1 ? "Vencido há 1 dia" : `Vencido há ${absDays} dias`,
        subLabel: `Prazo: ${dateStr}`,
      };
    }

    if (diffDays === 0) {
      return {
        type: "DUE_TODAY",
        badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-700 font-bold",
        label: "Vence hoje!",
        subLabel: dateStr,
      };
    }

    if (diffDays <= 7) {
      return {
        type: "DUE_SOON",
        badge: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800/60",
        label: `Vence em ${diffDays} dias`,
        subLabel: dateStr,
      };
    }

    return {
      type: "UPCOMING",
      badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800/60",
      label: `Vence em ${dateStr}`,
      subLabel: `(${diffDays} dias)`,
    };
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Feedback */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all ${
            toastMsg.type === "success"
              ? "bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/20"
              : "bg-red-600 text-white border-red-500 shadow-red-900/20"
          }`}
        >
          {toastMsg.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          {toastMsg.text}
        </div>
      )}

      {/* Header com Ações Rápidas */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400">
              <ListTodo className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              Combinados & Encaminhamentos
            </h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Painel unificado para acompanhamento de prazos, pactuações e baixa em compromissos de atas pedagógicas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/atas"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <FileText className="w-4 h-4 text-slate-500" />
            Ver Livro de Atas
          </Link>
          <Link
            href="/atas/nova"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles className="w-4 h-4" />
            Nova Ata
          </Link>
        </div>
      </div>

      {/* Cards de Métricas Analíticas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Total */}
        <button
          onClick={() => setStatusFilter("ALL")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            statusFilter === "ALL"
              ? "bg-indigo-50/80 border-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-700 shadow-sm ring-1 ring-indigo-400"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total Geral
            </span>
            <ListTodo className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1.5">{metrics.total}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">registros em ata</p>
        </button>

        {/* Vencidos */}
        <button
          onClick={() => setStatusFilter("OVERDUE")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            statusFilter === "OVERDUE"
              ? "bg-red-50/80 border-red-300 dark:bg-red-950/40 dark:border-red-700 shadow-sm ring-1 ring-red-400"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">
              Vencidos
            </span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-black text-red-600 dark:text-red-400 mt-1.5">{metrics.overdue}</div>
          <p className="text-xs text-red-500/80 dark:text-red-400/80 mt-0.5">exigem cobrança urgente</p>
        </button>

        {/* A Vencer em 7 Dias */}
        <button
          onClick={() => setStatusFilter("PENDING")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            metrics.dueSoon > 0
              ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-80"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              A Vencer (7d)
            </span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1.5">{metrics.dueSoon}</div>
          <p className="text-xs text-amber-500/80 dark:text-amber-400/80 mt-0.5">próximos da data limite</p>
        </button>

        {/* Pendentes */}
        <button
          onClick={() => setStatusFilter("PENDING")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            statusFilter === "PENDING"
              ? "bg-blue-50/80 border-blue-300 dark:bg-blue-950/40 dark:border-blue-700 shadow-sm ring-1 ring-blue-400"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              Em Aberto
            </span>
            <Clock className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1.5">{metrics.pending}</div>
          <p className="text-xs text-blue-500/80 dark:text-blue-400/80 mt-0.5">aguardando cumprimento</p>
        </button>

        {/* Concluídos */}
        <button
          onClick={() => setStatusFilter("COMPLETED")}
          className={`p-4 rounded-2xl border text-left transition-all col-span-2 sm:col-span-1 ${
            statusFilter === "COMPLETED"
              ? "bg-emerald-50/80 border-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-700 shadow-sm ring-1 ring-emerald-400"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              Concluídos
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1.5">{metrics.completed}</div>
          <p className="text-xs text-emerald-500/80 dark:text-emerald-400/80 mt-0.5">cumpridos com sucesso</p>
        </button>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-4">
        {/* Abas de Status */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <button
            onClick={() => setStatusFilter("PENDING")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              statusFilter === "PENDING"
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <span>Pendentes</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                statusFilter === "PENDING" ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-700"
              }`}
            >
              {metrics.pending}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter("OVERDUE")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              statusFilter === "OVERDUE"
                ? "bg-red-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <span>Vencidos</span>
            {metrics.overdue > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  statusFilter === "OVERDUE" ? "bg-white/20 text-white" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                }`}
              >
                {metrics.overdue}
              </span>
            )}
          </button>

          <button
            onClick={() => setStatusFilter("COMPLETED")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              statusFilter === "COMPLETED"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <span>Concluídos</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                statusFilter === "COMPLETED" ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-700"
              }`}
            >
              {metrics.completed}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter("ALL")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              statusFilter === "ALL"
                ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            Todos ({metrics.total})
          </button>
        </div>

        {/* Linha de Busca, Responsável e Turma */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Busca por texto */}
          <div className="md:col-span-5 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por combinado, aluno, nº da ata ou nota..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filtro de Responsável */}
          <div className="md:col-span-4">
            <select
              value={responsibleFilter}
              onChange={(e) => setResponsibleFilter(e.target.value)}
              className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">Todos os Responsáveis</option>
              <option value="FAMILIA">Família / Responsáveis</option>
              <option value="ESTUDANTE">Estudante</option>
              <option value="ESCOLA">Escola / Docentes</option>
              <option value="REDE_PROTECAO">Rede de Proteção</option>
            </select>
          </div>

          {/* Filtro de Turma */}
          <div className="md:col-span-3">
            <select
              value={turmaFilter}
              onChange={(e) => setTurmaFilter(e.target.value)}
              className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">Todas as Turmas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.shift ? `(${c.shift})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Lista de Combinados */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-4">
            <ListTodo className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              Nenhum encaminhamento encontrado
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              Nenhum combinado corresponde aos filtros selecionados. Altere os filtros ou registre novas ações nas atas.
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const respCfg = RESPONSIBLE_CONFIG[item.responsible] || RESPONSIBLE_CONFIG.FAMILIA;
            const RespIcon = respCfg.icon;
            const deadline = getDeadlineInfo(item);
            const isCompleted = item.status === "COMPLETED";

            return (
              <div
                key={item.id}
                className={`group bg-white dark:bg-slate-900 border rounded-2xl p-4 sm:p-5 shadow-sm transition-all hover:shadow-md ${
                  isCompleted
                    ? "border-emerald-200/80 dark:border-emerald-950/60 bg-emerald-50/20 dark:bg-emerald-950/10"
                    : deadline.type === "OVERDUE"
                    ? "border-red-300 dark:border-red-900/60 ring-1 ring-red-400/30"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  {/* Lado Esquerdo: Checkbox de ação rápida + Conteúdo */}
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    {/* Botão de Check / Baixa rápida */}
                    <button
                      type="button"
                      onClick={() => (isCompleted ? handleReopen(item) : handleOpenCompleteModal(item))}
                      title={isCompleted ? "Clique para reabrir" : "Clique para dar baixa e concluir"}
                      className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-lg border flex items-center justify-center transition-all ${
                        isCompleted
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                          : "border-slate-300 dark:border-slate-600 hover:border-indigo-500 text-transparent hover:text-indigo-400"
                      }`}
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                    </button>

                    <div className="space-y-2 flex-1 min-w-0">
                      {/* Linha de Badges: Responsável + Prazo */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Badge de Responsável */}
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${respCfg.bg} ${respCfg.text} ${respCfg.border}`}
                        >
                          <RespIcon className="w-3.5 h-3.5" />
                          {respCfg.label}
                        </span>

                        {/* Badge de Prazo / Status */}
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${deadline.badge}`}
                        >
                          <Clock className="w-3 h-3" />
                          {deadline.label}
                        </span>

                        {deadline.subLabel && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                            {deadline.subLabel}
                          </span>
                        )}
                      </div>

                      {/* Descrição do Combinado */}
                      <p
                        className={`text-base font-semibold leading-snug break-words ${
                          isCompleted
                            ? "text-slate-600 dark:text-slate-400 line-through decoration-emerald-500/60"
                            : "text-slate-900 dark:text-white"
                        }`}
                      >
                        {item.description}
                      </p>

                      {/* Nota de Conclusão / Observação */}
                      {item.completionNotes && (
                        <div className="mt-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                          <MessageSquare className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                          <div>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              Nota de baixa:{" "}
                            </span>
                            {item.completionNotes}
                          </div>
                        </div>
                      )}

                      {/* Metadados: Alunos envolvidos e Ata vinculada */}
                      <div className="pt-2 flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800/60">
                        {/* Alunos Vinculados */}
                        {item.minute.students && item.minute.students.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-slate-600 dark:text-slate-400">Aluno(s):</span>
                            {item.minute.students.map((st) => (
                              <Link
                                key={st.id}
                                href={st.studentId ? `/alunos/${st.studentId}` : "#"}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 transition-colors font-medium text-xs"
                                title="Abrir Prontuário 360º"
                              >
                                <span>{st.studentNameSnapshot}</span>
                                {st.classNameSnapshot && (
                                  <span className="text-[10px] text-slate-400">({st.classNameSnapshot})</span>
                                )}
                              </Link>
                            ))}
                          </div>
                        )}

                        {/* Ata Vinculada */}
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-600 dark:text-slate-400">Origem:</span>
                          <Link
                            href={`/atas`}
                            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                          >
                            <span>
                              Ata{" "}
                              {item.minute.ataNumber
                                ? `${String(item.minute.ataNumber).padStart(3, "0")}/${item.minute.year}`
                                : "Rascunho"}
                            </span>
                            <span className="text-slate-400 truncate max-w-[200px] hidden sm:inline">
                              - {item.minute.subject}
                            </span>
                            <ExternalLink className="w-3 h-3 text-indigo-400" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Lado Direito: Ações */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                    {!isCompleted ? (
                      <button
                        onClick={() => handleOpenCompleteModal(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm shadow-emerald-600/20 transition-all hover:scale-[1.02]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Dar Baixa
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReopen(item)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors"
                        title="Reabrir como pendente"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reabrir
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Conclusão / Baixa */}
      {completingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Dar Baixa no Combinado</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Confirmar cumprimento e registrar observações da devolutiva
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCompletingItem(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {completionError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {completionError}
              </div>
            )}

            {/* Resumo do Combinado */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1.5">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Combinado</div>
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {completingItem.description}
              </div>
              <div className="text-xs text-slate-500">
                Responsável:{" "}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {RESPONSIBLE_CONFIG[completingItem.responsible]?.label || completingItem.responsible}
                </span>
              </div>
            </div>

            {/* Campo de Observação */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Observações de Cumprimento / Devolutiva (opcional)
              </label>
              <textarea
                value={completionNotesInput}
                onChange={(e) => setCompletionNotesInput(e.target.value)}
                placeholder="Ex.: Família compareceu na data prevista e apresentou o atestado/laudo. Aluno normalizou a frequência."
                rows={3}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Essa nota ficará gravada no histórico do encaminhamento e vinculada à ata pedagógica.
              </p>
            </div>

            {/* Botões do Modal */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCompletingItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmCompletion}
                disabled={isSubmittingCompletion}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm shadow-emerald-600/30 transition-all flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSubmittingCompletion ? "Salvando..." : "Confirmar Baixa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
