"use client";

import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { isBootstrapAdminEmail } from "@/lib/roles";

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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [refreshTick, setRefreshTick] = useState(0);

  // Note modal state (regular pedagoga return notes)
  const [activeModalLog, setActiveModalLog] = useState<any>(null);
  const [noteText, setNoteText] = useState("");
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
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const handleClearFilters = () => {
    setSearchTerm("");
    setDebouncedSearch("");
    setSelectedSegment("TODOS");
    setSelectedTurma("");
    setSelectedPedagoga("");
    setSelectedReplyFilter("TODOS");
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
        }),
      });
      if (res.ok) {
        setLogs((prev) =>
          prev.map((item) =>
            item.id === log.id ? { ...item, guardianReplied: nextStatus } : item
          )
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Save notes
  const handleSaveNotes = async () => {
    if (!activeModalLog) return;
    setIsUpdating(true);
    try {
      const res = await fetch("/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: activeModalLog.id,
          guardianReplied: true, // Auto-mark replied if pedagoga enters note
          replyNotes: noteText,
        }),
      });
      if (res.ok) {
        setLogs((prev) =>
          prev.map((item) =>
            item.id === activeModalLog.id
              ? { ...item, guardianReplied: true, replyNotes: noteText }
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
    // Format YYYY-MM-DDTHH:mm
    const tzOffset = dt.getTimezoneOffset() * 60000;
    const localISOTime = new Date(dt.getTime() - tzOffset).toISOString().slice(0, 16);

    setEditForm({
      reasonTitle: log.reasonTitle || "",
      phoneUsed: log.phoneUsed || "",
      sentByName: log.sentByName || "",
      sentAt: localISOTime,
      guardianReplied: Boolean(log.guardianReplied),
      replyNotes: log.replyNotes || "",
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

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <History className="w-6 h-6 text-sky-600" />
            <span>Histórico de Envios & Retorno dos Pais</span>
            {isAdmin && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 uppercase tracking-wider">
                Modo Administrador
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Busca paginada em todo o acervo histórico de acionamentos e retornos dos responsáveis.
            {isAdmin && " Como administrador, você pode editar qualquer campo ou excluir registros incorretos."}
          </p>
        </div>
        <div className="flex items-center space-x-2 text-xs text-slate-500 font-medium">
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-sky-600" />}
          <span>
            Total encontrado: <strong>{total.toLocaleString("pt-BR")}</strong> registros
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar aluno, CGM, motivo, fone..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
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
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
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
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
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
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
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
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
          >
            <option value="TODOS">Status: Todos</option>
            <option value="SIM">Retornou (Sim)</option>
            <option value="NAO">Pendente (Não)</option>
          </select>
        </div>

        {/* Date Range Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center space-x-1 font-semibold text-slate-600">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Período:</span>
            </span>
            <label className="inline-flex items-center space-x-1.5 text-slate-600">
              <span>De</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:bg-white font-mono text-xs"
              />
            </label>
            <label className="inline-flex items-center space-x-1.5 text-slate-600">
              <span>Até</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:bg-white font-mono text-xs"
              />
            </label>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar Filtros</span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Data / Hora</th>
                <th className="px-4 py-3">Aluno</th>
                <th className="px-4 py-3">Turma</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Pedagoga</th>
                <th className="px-4 py-3 text-center">Retornou?</th>
                <th className="px-4 py-3">Observações do Retorno</th>
                {isAdmin && <th className="px-4 py-3 text-center">Ações (ADM)</th>}
              </tr>
            </thead>
            <tbody className={`divide-y divide-slate-100 transition-opacity ${isLoading ? "opacity-60" : "opacity-100"}`}>
              {logs.map((log) => {
                const dt = new Date(log.sentAt);
                return (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                      {dt.toLocaleDateString("pt-BR")}{" "}
                      <span className="text-[10px] text-slate-400">
                        {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {log.student.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {log.student.classGroup.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-full font-medium bg-sky-50 text-sky-700 border border-sky-100">
                        {log.reasonTitle}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                      {log.phoneUsed}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap font-medium">
                      {log.sentByName}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleReply(log)}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold transition shadow-xs ${
                          log.guardianReplied
                            ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
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
                    <td className="px-4 py-3 text-slate-600">
                      <div className="flex items-center justify-between space-x-2">
                        <span className="truncate max-w-xs text-[11px] italic text-slate-500">
                          {log.replyNotes || "Nenhuma anotação"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveModalLog(log);
                            setNoteText(log.replyNotes || "");
                          }}
                          className="text-[11px] font-bold text-sky-600 hover:text-sky-800 underline whitespace-nowrap"
                        >
                          {log.replyNotes ? "Editar" : "+ Anotar"}
                        </button>
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(log)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                            title="Editar todos os campos deste registro"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveDeleteLog(log)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Excluir este registro"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {logs.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={isAdmin ? 9 : 8} className="px-4 py-8 text-center text-slate-400">
                    Nenhum envio encontrado com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div>
            Página <strong>{page}</strong> de <strong>{totalPages}</strong> • Exibindo{" "}
            <strong>{logs.length}</strong> de <strong>{total.toLocaleString("pt-BR")}</strong> registros
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Note modal (Pedagogas) */}
      {activeModalLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Registrar Retorno do Responsável
            </h3>
            <p className="text-xs text-slate-600">
              Aluno: <strong>{activeModalLog.student.name}</strong> ({activeModalLog.student.classGroup.name})<br />
              Motivo do envio: <strong>{activeModalLog.reasonTitle}</strong>
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Justificativa / Informação passada pela família:
              </label>
              <textarea
                rows={4}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Ex: Mãe entrou em contato via WhatsApp e informou que o aluno consultou o médico. Apresentará atestado na segunda-feira..."
                className="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveModalLog(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveNotes}
                disabled={isUpdating}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs"
              >
                {isUpdating ? "Salvando..." : "Salvar Retorno"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <span className="font-bold text-slate-900">{activeEditLog.student.name}</span> — Turma: <span className="font-semibold">{activeEditLog.student.classGroup.name}</span>
            </div>

            {editError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Motivo / Título:
                  </label>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Status de Retorno:
                  </label>
                  <select
                    value={editForm.guardianReplied ? "SIM" : "NAO"}
                    onChange={(e) =>
                      setEditForm({ ...editForm, guardianReplied: e.target.value === "SIM" })
                    }
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white"
                  >
                    <option value="SIM">Retornou (Sim)</option>
                    <option value="NAO">Pendente (Não)</option>
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
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
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
              <div>Aluno: <strong>{activeDeleteLog.student.name}</strong></div>
              <div>Turma: <strong>{activeDeleteLog.student.classGroup.name}</strong></div>
              <div>Motivo: <strong>{activeDeleteLog.reasonTitle}</strong></div>
              <div>Pedagoga: <strong>{activeDeleteLog.sentByName}</strong></div>
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
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
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
