"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  History,
  Search,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  AlertTriangle,
  X,
  Check,
  Loader2,
  RotateCcw,
  Calendar,
  Sparkles,
  PhoneOff,
  Stethoscope,
  MessageSquare,
} from "lucide-react";
import { isBootstrapAdminEmail } from "@/lib/roles";
import ModalDialog from "@/components/ModalDialog";
import {
  DELIVERY_STATUS_LABELS,
  REPLY_CATEGORY_LABELS,
  REPLY_CATEGORY_OPTIONS,
  type DeliveryStatus,
  type ReplyCategory,
} from "@/lib/whatsappProvider";

interface Props {
  initialLogs: any[];
  initialTotal: number;
  pedagogas: string[];
  classGroups: any[];
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
}

export default function HistoricoClient({
  initialLogs,
  initialTotal,
  pedagogas,
  classGroups,
  currentUser,
}: Props) {
  const [logs, setLogs] = useState<any[]>(initialLogs);
  const [total, setTotal] = useState<number>(initialTotal);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSegment, setSelectedSegment] = useState("TODOS");
  const [selectedTurma, setSelectedTurma] = useState("");
  const [selectedPedagoga, setSelectedPedagoga] = useState("");
  const [selectedReplyFilter, setSelectedReplyFilter] = useState("TODOS");
  const [selectedDeliveryFilter, setSelectedDeliveryFilter] = useState("TODOS");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("TODOS");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [refreshTick, setRefreshTick] = useState(0);

  // Note + AI Triage modal state (AUT-03)
  const [activeModalLog, setActiveModalLog] = useState<any>(null);
  const [rawPasteText, setRawPasteText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteCategory, setNoteCategory] = useState<ReplyCategory | "">("");
  const [aiTip, setAiTip] = useState<{
    suggestedFollowUp: string;
    requiresMedicalCertificate: boolean;
    usedFallback: boolean;
  } | null>(null);
  const [isClassifyingAi, setIsClassifyingAi] = useState(false);
  const [aiClassifyError, setAiClassifyError] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Admin: Edit modal state
  const [activeEditLog, setActiveEditLog] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    reasonTitle: "",
    phoneUsed: "",
    sentByName: "",
    sentAt: "",
    guardianReplied: false,
    replyNotes: "",
    replyCategory: "",
    deliveryStatus: "SENT",
    messageContent: "",
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  // Admin: Delete modal state
  const [activeDeleteLog, setActiveDeleteLog] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const isAdmin =
    currentUser.role === "ADMIN" || isBootstrapAdminEmail(currentUser.email);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch server-paginated logs whenever filters or page change (skipping initial SSR state)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const controller = new AbortController();
    const fetchPage = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (selectedSegment !== "TODOS") params.set("segment", selectedSegment);
        if (selectedTurma) params.set("classGroupId", selectedTurma);
        if (selectedPedagoga) params.set("pedagoga", selectedPedagoga);
        if (selectedReplyFilter !== "TODOS") params.set("replied", selectedReplyFilter);
        if (selectedDeliveryFilter !== "TODOS")
          params.set("deliveryStatus", selectedDeliveryFilter);
        if (selectedCategoryFilter !== "TODOS")
          params.set("replyCategory", selectedCategoryFilter);
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);

        const res = await fetch(`/api/messages?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        setLogs(data.logs || []);
        setTotal(typeof data.total === "number" ? data.total : 0);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Erro ao consultar histórico paginado:", err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchPage();
    return () => controller.abort();
  }, [
    page,
    pageSize,
    debouncedSearch,
    selectedSegment,
    selectedTurma,
    selectedPedagoga,
    selectedReplyFilter,
    selectedDeliveryFilter,
    selectedCategoryFilter,
    dateFrom,
    dateTo,
    refreshTick,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    selectedSegment !== "TODOS" ||
    Boolean(selectedTurma) ||
    Boolean(selectedPedagoga) ||
    selectedReplyFilter !== "TODOS" ||
    selectedDeliveryFilter !== "TODOS" ||
    selectedCategoryFilter !== "TODOS" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const handleClearFilters = () => {
    setSearchTerm("");
    setDebouncedSearch("");
    setSelectedSegment("TODOS");
    setSelectedTurma("");
    setSelectedPedagoga("");
    setSelectedReplyFilter("TODOS");
    setSelectedDeliveryFilter("TODOS");
    setSelectedCategoryFilter("TODOS");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  // Toggle guardian reply
  const handleToggleReply = async (log: any) => {
    const nextStatus = !log.guardianReplied;
    try {
      const res = await fetch("/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: log.id,
          guardianReplied: nextStatus,
          replyNotes: log.replyNotes,
          replyCategory: nextStatus ? log.replyCategory : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) =>
          prev.map((item) =>
            item.id === log.id
              ? {
                  ...item,
                  guardianReplied: nextStatus,
                  replyCategory: data.updated?.replyCategory ?? item.replyCategory,
                  deliveryStatus: data.updated?.deliveryStatus ?? item.deliveryStatus,
                }
              : item
          )
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Quick update delivery status right from the table (AUT-01)
  const handleQuickDeliveryStatus = async (logId: string, nextStatus: DeliveryStatus) => {
    try {
      const res = await fetch("/api/messages/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId, deliveryStatus: nextStatus }),
      });
      if (res.ok) {
        setLogs((prev) =>
          prev.map((item) =>
            item.id === logId ? { ...item, deliveryStatus: nextStatus } : item
          )
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenNoteModal = (log: any) => {
    setActiveModalLog(log);
    setRawPasteText("");
    setNoteText(log.replyNotes || "");
    setNoteCategory((log.replyCategory as ReplyCategory) || "");
    setAiTip(null);
    setAiClassifyError("");
  };

  // AUT-03: Formalizar & Classificar retorno colado do WhatsApp com IA Gemini
  const handleAiClassifyReply = async () => {
    const sourceText = rawPasteText.trim() || noteText.trim();
    if (sourceText.length < 3) {
      setAiClassifyError(
        "Cole a mensagem do responsável ou digite um rascunho acima para classificar."
      );
      return;
    }

    setIsClassifyingAi(true);
    setAiClassifyError("");

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const savedKey = localStorage.getItem("leopoldina_gemini_api_key");
        if (savedKey && savedKey.trim().length > 10) {
          headers["x-gemini-key"] = savedKey.trim();
        }
      } catch {}

      const res = await fetch("/api/ai/classify-reply", {
        method: "POST",
        headers,
        body: JSON.stringify({
          rawReply: sourceText,
          studentName: activeModalLog?.student?.name || "",
          reasonTitle: activeModalLog?.reasonTitle || "",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao classificar retorno.");
      }

      if (data.classification) {
        setNoteText(data.classification.formalSummary);
        setNoteCategory(data.classification.category);
        setAiTip({
          suggestedFollowUp: data.classification.suggestedFollowUp,
          requiresMedicalCertificate: Boolean(data.classification.requiresMedicalCertificate),
          usedFallback: Boolean(data.usedFallback),
        });
      }
    } catch (err: any) {
      setAiClassifyError(err.message || "Falha ao processar com IA.");
    } finally {
      setIsClassifyingAi(false);
    }
  };

  // Save notes + category
  const handleSaveNotes = async () => {
    if (!activeModalLog) return;
    setIsUpdating(true);
    try {
      const res = await fetch("/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: activeModalLog.id,
          guardianReplied: true,
          replyNotes: noteText,
          replyCategory: noteCategory || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) =>
          prev.map((item) =>
            item.id === activeModalLog.id
              ? {
                  ...item,
                  guardianReplied: true,
                  replyNotes: noteText,
                  replyCategory: noteCategory || null,
                  deliveryStatus: data.updated?.deliveryStatus || item.deliveryStatus,
                }
              : item
          )
        );
        setActiveModalLog(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Open Edit Modal (Admin)
  const handleOpenEditModal = (log: any) => {
    setActiveEditLog(log);
    const dt = new Date(log.sentAt);
    const tzOffset = dt.getTimezoneOffset() * 60000;
    const localISOTime = new Date(dt.getTime() - tzOffset).toISOString().slice(0, 16);

    setEditForm({
      reasonTitle: log.reasonTitle || "",
      phoneUsed: log.phoneUsed || "",
      sentByName: log.sentByName || "",
      sentAt: localISOTime,
      guardianReplied: Boolean(log.guardianReplied),
      replyNotes: log.replyNotes || "",
      replyCategory: log.replyCategory || "",
      deliveryStatus: log.deliveryStatus || "SENT",
      messageContent: log.messageContent || "",
    });
    setEditError("");
  };

  // Save Edit (Admin)
  const handleSaveEdit = async () => {
    if (!activeEditLog) return;
    setIsSavingEdit(true);
    setEditError("");

    try {
      const res = await fetch("/api/messages/manage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeEditLog.id,
          reasonTitle: editForm.reasonTitle,
          phoneUsed: editForm.phoneUsed,
          sentByName: editForm.sentByName,
          sentAt: editForm.sentAt,
          guardianReplied: editForm.guardianReplied,
          replyNotes: editForm.replyNotes,
          replyCategory: editForm.replyCategory || null,
          deliveryStatus: editForm.deliveryStatus,
          messageContent: editForm.messageContent,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar alterações no registro");
      }

      setLogs((prev) =>
        prev.map((item) => (item.id === activeEditLog.id ? data.updated : item))
      );
      setActiveEditLog(null);
    } catch (err: any) {
      setEditError(err.message || "Erro desconhecido ao atualizar");
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Confirm Delete (Admin)
  const handleConfirmDelete = async () => {
    if (!activeDeleteLog) return;
    setIsDeleting(true);
    setDeleteError("");

    try {
      const res = await fetch(`/api/messages/manage?id=${activeDeleteLog.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao excluir registro");
      }

      const remainingOnPage = logs.length - 1;
      setLogs((prev) => prev.filter((item) => item.id !== activeDeleteLog.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setActiveDeleteLog(null);

      if (remainingOnPage === 0 && page > 1) {
        setPage((p) => Math.max(1, p - 1));
      } else {
        setRefreshTick((t) => t + 1);
      }
    } catch (err: any) {
      setDeleteError(err.message || "Erro desconhecido ao excluir");
    } finally {
      setIsDeleting(false);
    }
  };

  const renderDeliveryBadge = (log: any) => {
    const status = (log.deliveryStatus || "SENT") as DeliveryStatus;
    if (status === "FAILED_NO_WHATSAPP") {
      return (
        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
          <PhoneOff className="w-3 h-3" />
          <span>Sem WhatsApp</span>
        </span>
      );
    }
    if (status === "LINK_OPENED") {
      return (
        <div className="inline-flex items-center gap-1">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Link Aberto
          </span>
          <button
            type="button"
            onClick={() => handleQuickDeliveryStatus(log.id, "SENT")}
            title="Confirmar que a mensagem foi enviada no WhatsApp"
            className="p-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => handleQuickDeliveryStatus(log.id, "FAILED_NO_WHATSAPP")}
            title="Sinalizar número sem WhatsApp"
            className="p-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800"
          >
            <PhoneOff className="w-3 h-3" />
          </button>
        </div>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        {DELIVERY_STATUS_LABELS[status] || "Enviado"}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight flex items-center space-x-2">
            <History className="w-6 h-6 text-sky-600" />
            <span>Histórico de Envios & Retorno dos Pais</span>
            {isAdmin && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800 uppercase tracking-wider">
                Modo Administrador
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Busca paginada com rastreio de entrega (wa.me) e triagem inteligente de justificativas dos responsáveis.
          </p>
        </div>
        <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-sky-600" />}
          <span>
            Total encontrado: <strong>{total.toLocaleString("pt-BR")}</strong> registros
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
          {/* Search Input */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar aluno, CGM, motivo, fone ou observação..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>

          {/* Segment Filter */}
          <select
            value={selectedSegment}
            onChange={(e) => {
              setSelectedSegment(e.target.value);
              setSelectedTurma("");
              setPage(1);
            }}
            className="border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800"
          >
            <option value="TODOS">Todos os Níveis</option>
            <option value="FUNDAMENTAL">Ensino Fundamental</option>
            <option value="MEDIO">Ensino Médio</option>
            <option value="NOTURNO">Ensino Noturno</option>
          </select>

          {/* Turma Filter */}
          <select
            value={selectedTurma}
            onChange={(e) => {
              setSelectedTurma(e.target.value);
              setPage(1);
            }}
            className="border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800"
          >
            <option value="">Todas as Turmas</option>
            {classGroups
              .filter(
                (cg) => selectedSegment === "TODOS" || cg.segment === selectedSegment
              )
              .map((cg) => (
                <option key={cg.id} value={cg.id}>
                  {cg.name}
                </option>
              ))}
          </select>

          {/* Pedagoga Filter */}
          <select
            value={selectedPedagoga}
            onChange={(e) => {
              setSelectedPedagoga(e.target.value);
              setPage(1);
            }}
            className="border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800"
          >
            <option value="">Todas as Pedagogas</option>
            {pedagogas.map((ped) => (
              <option key={ped} value={ped}>
                {ped}
              </option>
            ))}
          </select>

          {/* Reply Status Filter */}
          <select
            value={selectedReplyFilter}
            onChange={(e) => {
              setSelectedReplyFilter(e.target.value);
              setPage(1);
            }}
            className="border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800"
          >
            <option value="TODOS">Retorno: Todos</option>
            <option value="SIM">Retornou (Sim)</option>
            <option value="NAO">Pendente (Não)</option>
          </select>
        </div>

        {/* Date Range + Delivery & Category Filters Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center space-x-1 font-semibold text-slate-600 dark:text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Período:</span>
            </span>
            <label className="inline-flex items-center space-x-1 text-slate-600 dark:text-slate-300">
              <span>De</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 font-mono text-xs"
              />
            </label>
            <label className="inline-flex items-center space-x-1 text-slate-600 dark:text-slate-300">
              <span>Até</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 font-mono text-xs"
              />
            </label>

            <select
              value={selectedDeliveryFilter}
              onChange={(e) => {
                setSelectedDeliveryFilter(e.target.value);
                setPage(1);
              }}
              className="border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800"
            >
              <option value="TODOS">Entrega: Todas</option>
              <option value="SENT">Enviados (Confirmados)</option>
              <option value="LINK_OPENED">Link Aberto (Aguardando confirmação)</option>
              <option value="FAILED_NO_WHATSAPP">📵 Número sem WhatsApp</option>
            </select>

            <select
              value={selectedCategoryFilter}
              onChange={(e) => {
                setSelectedCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800"
            >
              <option value="TODOS">Causa/Categoria: Todas</option>
              {REPLY_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar Filtros</span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto relative">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3 py-3 whitespace-nowrap">Data / Hora</th>
                <th className="px-3 py-3">Aluno</th>
                <th className="px-2.5 py-3">Turma</th>
                <th className="px-3 py-3">Motivo</th>
                <th className="px-3 py-3">Telefone / Entrega</th>
                <th className="px-2.5 py-3">Pedagoga</th>
                <th className="px-2.5 py-3 text-center">Retornou?</th>
                <th className="px-3 py-3">Retorno & Classificação</th>
                <th className="sticky right-0 z-20 bg-slate-50 dark:bg-slate-800 px-3 py-3 text-center border-l border-slate-200 dark:border-slate-700 shadow-[-6px_0_10px_-2px_rgba(0,0,0,0.06)] min-w-[110px]">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody
              className={`divide-y divide-slate-100 dark:divide-slate-800 transition-opacity ${
                isLoading ? "opacity-60" : "opacity-100"
              }`}
            >
              {logs.map((log) => {
                const dt = new Date(log.sentAt);
                return (
                  <tr key={log.id} className="group hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition">
                    <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap text-[11px] leading-tight">
                      <div className="font-semibold">{dt.toLocaleDateString("pt-BR")}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">
                        {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100 max-w-[170px]">
                      <Link
                        href={`/alunos/${log.student.id}`}
                        className="hover:text-sky-700 dark:hover:text-sky-400 hover:underline block truncate"
                        title={log.student.name}
                      >
                        {log.student.name}
                      </Link>
                    </td>
                    <td className="px-2.5 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {log.student.classGroup.name}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-full font-medium bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-100 dark:border-sky-800 text-[11px]">
                        {log.reasonTitle}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="font-mono text-slate-600 dark:text-slate-400 text-[11px]">{log.phoneUsed}</div>
                      <div className="mt-0.5">{renderDeliveryBadge(log)}</div>
                    </td>
                    <td className="px-2.5 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap font-medium text-[11px] max-w-[110px] truncate" title={log.sentByName}>
                      {log.sentByName}
                    </td>
                    <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleReply(log)}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold transition shadow-xs cursor-pointer ${
                          log.guardianReplied
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-200"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200"
                        }`}
                        title="Clique para alternar o status de resposta"
                      >
                        {log.guardianReplied ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                            Sim
                          </>
                        ) : (
                          "Pendente"
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 max-w-[220px]">
                      <div className="space-y-0.5 min-w-0">
                        {log.replyCategory && (
                          <span className="inline-block px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            {REPLY_CATEGORY_LABELS[log.replyCategory as ReplyCategory] ||
                              log.replyCategory}
                          </span>
                        )}
                        <span className="block truncate text-[11px] italic text-slate-500 dark:text-slate-400" title={log.replyNotes || ""}>
                          {log.replyNotes || "Nenhuma anotação"}
                        </span>
                      </div>
                    </td>
                    {/* Coluna Sticky de Ações Fixa à Direita */}
                    <td className="sticky right-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 px-3 py-2.5 text-center whitespace-nowrap border-l border-slate-200 dark:border-slate-800 shadow-[-6px_0_10px_-2px_rgba(0,0,0,0.06)] transition-colors">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenNoteModal(log)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            log.replyNotes
                              ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 hover:bg-sky-100 border border-sky-200 dark:border-sky-800"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 border border-slate-200 dark:border-slate-700"
                          }`}
                          title={log.replyNotes ? "Editar retorno / anotação" : "Registrar retorno familiar"}
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                          <span>{log.replyNotes ? "Editar" : "+ Nota"}</span>
                        </button>

                        {isAdmin && (
                          <div className="flex items-center gap-0.5 border-l border-slate-200 dark:border-slate-700 pl-1.5 ml-0.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(log)}
                              className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg transition"
                              title="Editar registro"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveDeleteLog(log)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition"
                              title="Excluir registro"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {logs.length === 0 && !isLoading && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-slate-400"
                  >
                    Nenhum envio encontrado com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <div>
            Página <strong>{page}</strong> de <strong>{totalPages}</strong> • Exibindo{" "}
            <strong>{logs.length}</strong> de <strong>{total.toLocaleString("pt-BR")}</strong>{" "}
            registros
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              title="Página Anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-bold font-mono px-2 text-slate-700 dark:text-slate-300">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              title="Próxima Página"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal Nativo <dialog> de Retorno + Triagem IA Gemini (AUT-03) */}
      <ModalDialog
        open={Boolean(activeModalLog)}
        onClose={() => setActiveModalLog(null)}
        title="Registrar Retorno do Responsável"
        subtitle={
          activeModalLog
            ? `${activeModalLog.student.name} (${activeModalLog.student.classGroup.name}) • ${activeModalLog.reasonTitle}`
            : undefined
        }
      >
        <div className="space-y-4 text-xs">
          {/* Bloco Opcional de Triagem / Formalização com IA Gemini */}
          <div className="p-3.5 rounded-xl bg-purple-50/70 border border-purple-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-extrabold text-purple-950 flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span>Colar mensagem recebida no WhatsApp (Opcional — IA Gemini):</span>
              </label>
            </div>

            <textarea
              rows={2}
              value={rawPasteText}
              onChange={(e) => setRawPasteText(e.target.value)}
              placeholder='Ex: "Oi professora, o João tá com febre desde ontem, levei ele no postinho hoje cedo e segunda mando o atestado"'
              className="w-full p-2.5 border border-purple-200 rounded-lg bg-white text-xs"
            />

            {aiClassifyError && (
              <p className="text-rose-700 font-semibold text-[11px]">{aiClassifyError}</p>
            )}

            <button
              type="button"
              disabled={isClassifyingAi}
              onClick={handleAiClassifyReply}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold transition shadow-2xs cursor-pointer"
            >
              {isClassifyingAi ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Classificando e formalizando...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Formalizar & Classificar com IA</span>
                </>
              )}
            </button>
          </div>

          {aiTip && (
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-950 space-y-1.5">
              <div className="font-bold">
                Encaminhamento sugerido: <span className="font-normal">{aiTip.suggestedFollowUp}</span>
              </div>
              {aiTip.requiresMedicalCertificate && activeModalLog && (
                <div className="pt-1 flex items-center justify-between gap-2 border-t border-sky-200/70">
                  <span className="inline-flex items-center space-x-1 text-emerald-800 font-bold">
                    <Stethoscope className="w-3.5 h-3.5" />
                    <span>Relato menciona atendimento de saúde / atestado.</span>
                  </span>
                  <Link
                    href={`/alunos/${activeModalLog.student.id}`}
                    className="font-extrabold text-sky-700 underline hover:text-sky-900"
                  >
                    Abrir Prontuário 360º →
                  </Link>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Categoria da Justificativa / Motivo da Ausência:
            </label>
            <select
              value={noteCategory}
              onChange={(e) => setNoteCategory(e.target.value as ReplyCategory | "")}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-semibold"
            >
              <option value="">-- Selecione uma categoria (opcional) --</option>
              {REPLY_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Registro Formal para Histórico e Dossiê SERP/Conselho Tutelar:
            </label>
            <textarea
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Ex: Responsável informou via WhatsApp que o(a) estudante passou por atendimento médico e apresentará atestado..."
              className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-slate-50 focus:bg-white leading-relaxed"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setActiveModalLog(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveNotes}
              disabled={isUpdating}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-xs cursor-pointer"
            >
              {isUpdating ? "Salvando..." : "Salvar Retorno Classificado"}
            </button>
          </div>
        </div>
      </ModalDialog>

      {/* Admin: Edit Modal */}
      {activeEditLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center space-x-2">
                <Pencil className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Editar Registro do Histórico (Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveEditLog(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700">
              <span className="font-bold text-slate-900">{activeEditLog.student.name}</span> — Turma:{" "}
              <span className="font-semibold">{activeEditLog.student.classGroup.name}</span>
            </div>

            {editError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Motivo / Título:</label>
                  <input
                    type="text"
                    value={editForm.reasonTitle}
                    onChange={(e) => setEditForm({ ...editForm, reasonTitle: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Pedagoga Responsável:
                  </label>
                  <input
                    type="text"
                    value={editForm.sentByName}
                    onChange={(e) => setEditForm({ ...editForm, sentByName: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Telefone Utilizado:
                  </label>
                  <input
                    type="text"
                    value={editForm.phoneUsed}
                    onChange={(e) => setEditForm({ ...editForm, phoneUsed: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Data e Hora do Envio:
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.sentAt}
                    onChange={(e) => setEditForm({ ...editForm, sentAt: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Status de Entrega:</label>
                  <select
                    value={editForm.deliveryStatus}
                    onChange={(e) => setEditForm({ ...editForm, deliveryStatus: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="LINK_OPENED">Link Aberto</option>
                    <option value="SENT">Enviado</option>
                    <option value="READ">Lido / Respondido</option>
                    <option value="FAILED_NO_WHATSAPP">Sem WhatsApp</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Status de Retorno:</label>
                  <select
                    value={editForm.guardianReplied ? "SIM" : "NAO"}
                    onChange={(e) =>
                      setEditForm({ ...editForm, guardianReplied: e.target.value === "SIM" })
                    }
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="SIM">Retornou (Sim)</option>
                    <option value="NAO">Pendente (Não)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Categoria:</label>
                  <select
                    value={editForm.replyCategory}
                    onChange={(e) => setEditForm({ ...editForm, replyCategory: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Sem categoria</option>
                    {REPLY_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {REPLY_CATEGORY_LABELS[opt.value]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Observações do Retorno:
                </label>
                <textarea
                  rows={2}
                  value={editForm.replyNotes}
                  onChange={(e) => setEditForm({ ...editForm, replyNotes: e.target.value })}
                  placeholder="Justificativa ou informações adicionais..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Conteúdo da Mensagem Enviada:
                </label>
                <textarea
                  rows={3}
                  value={editForm.messageContent}
                  onChange={(e) => setEditForm({ ...editForm, messageContent: e.target.value })}
                  placeholder="Texto integral enviado via WhatsApp..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white font-mono text-[11px]"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-200">
              <span className="text-[11px] text-slate-400">
                A alteração será auditada com seu usuário.
              </span>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setActiveEditLog(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs flex items-center space-x-1"
                >
                  {isSavingEdit ? (
                    "Salvando..."
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Salvar Alterações</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin: Delete Confirmation Modal */}
      {activeDeleteLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center space-x-3 text-rose-600 pb-2 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Excluir Registro do Histórico?
                </h3>
                <p className="text-xs text-rose-600 font-semibold">
                  Ação restrita de administrador
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Você está prestes a excluir permanentemente o registro de acionamento do aluno:
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div>
                Aluno: <strong>{activeDeleteLog.student.name}</strong>
              </div>
              <div>
                Turma: <strong>{activeDeleteLog.student.classGroup.name}</strong>
              </div>
              <div>
                Motivo: <strong>{activeDeleteLog.reasonTitle}</strong>
              </div>
              <div>
                Pedagoga: <strong>{activeDeleteLog.sentByName}</strong>
              </div>
              <div>
                Data:{" "}
                <strong>
                  {new Date(activeDeleteLog.sentAt).toLocaleDateString("pt-BR")}{" "}
                  {new Date(activeDeleteLog.sentAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <p className="text-[11px] text-slate-500 italic">
              Esta exclusão é registrada na Trilha de Auditoria com seu nome e e-mail institucional.
            </p>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActiveDeleteLog(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs"
              >
                {isDeleting ? "Excluindo..." : "Confirmar Exclusão"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
