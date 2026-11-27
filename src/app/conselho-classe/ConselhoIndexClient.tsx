"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Calendar,
  Check,
  ClipboardList,
  FileUp,
  KeyRound,
  Loader2,
  Pencil,
  Search,
  Users,
  X,
} from "lucide-react";
import CouncilSerePdfImportModal from "@/components/conselho/CouncilSerePdfImportModal";
import CouncilTeacherInviteModal from "@/components/conselho/CouncilTeacherInviteModal";
import {
  formatSegmentLabel,
  formatShiftLabel,
  type CouncilBoardDetailRecord,
  type CouncilIndexBoardItem,
  type CouncilIndexClassGroupItem,
  type CouncilTrimesterNumber,
} from "@/components/conselho/types";

interface ConselhoIndexClientProps {
  initialYear: number;
  initialClassGroups: CouncilIndexClassGroupItem[];
  initialBoards: CouncilIndexBoardItem[];
  schoolName: string;
  canEdit: boolean;
  canUseBiScraper?: boolean;
}

const SHIFT_OPTIONS = [
  { value: "MANHA", label: "Manhã" },
  { value: "TARDE", label: "Tarde" },
  { value: "NOITE", label: "Noite" },
  { value: "INTEGRAL", label: "Integral" },
] as const;

export default function ConselhoIndexClient({
  initialYear,
  initialClassGroups,
  initialBoards,
  schoolName,
  canEdit,
  canUseBiScraper = false,
}: ConselhoIndexClientProps) {
  const router = useRouter();
  const [year, setYear] = useState<number>(initialYear);
  const [classGroups, setClassGroups] =
    useState<CouncilIndexClassGroupItem[]>(initialClassGroups);
  const [boards, setBoards] = useState<CouncilIndexBoardItem[]>(initialBoards);
  const [searchTerm, setSearchTerm] = useState("");
  const [shiftFilter, setShiftFilter] = useState("ALL");
  const [loadingYear, setLoadingYear] = useState(false);
  const [openingTarget, setOpeningTarget] = useState<{
    classGroupId: string;
    trimester?: CouncilTrimesterNumber;
    action: "open" | "sere";
  } | null>(null);
  const [savingShiftClassId, setSavingShiftClassId] = useState<string | null>(null);
  const [editingNameClassId, setEditingNameClassId] = useState<string | null>(null);
  const [editingNameDraft, setEditingNameDraft] = useState("");
  const [savingNameClassId, setSavingNameClassId] = useState<string | null>(null);
  const [sereModalTarget, setSereModalTarget] = useState<{
    boardId: string;
    classNameLabel: string;
  } | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  function notify(message: string, kind: "success" | "error" = "success") {
    setToast({ message, kind });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 4000);
  }

  const boardByClassId = useMemo(() => {
    return new Map(boards.map((b) => [b.classGroupId, b]));
  }, [boards]);

  const filteredClassGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return classGroups.filter((cg) => {
      if (shiftFilter !== "ALL" && cg.shift.toUpperCase() !== shiftFilter) {
        return false;
      }
      if (q && !cg.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [classGroups, searchTerm, shiftFilter]);

  async function refreshYearData(targetYear: number) {
    const res = await fetch(`/api/conselho-classe?year=${targetYear}`);
    const data: {
      success?: boolean;
      classGroups?: CouncilIndexClassGroupItem[];
      boards?: CouncilIndexBoardItem[];
      error?: string;
    } = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Não foi possível carregar as turmas do ano letivo.");
    }
    setClassGroups(data.classGroups || []);
    setBoards(data.boards || []);
  }

  async function handleYearChange(nextYear: number) {
    setYear(nextYear);
    setLoadingYear(true);
    setErrorMsg(null);
    try {
      await refreshYearData(nextYear);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Falha de conexão ao consultar o ano letivo."
      );
    } finally {
      setLoadingYear(false);
    }
  }

  async function ensureBoard(classGroupId: string): Promise<string | null> {
    const existing = boardByClassId.get(classGroupId);
    if (existing) {
      return existing.id;
    }
    if (!canEdit) {
      setErrorMsg("Conselho de classe ainda não iniciado para esta turma.");
      return null;
    }

    const res = await fetch("/api/conselho-classe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classGroupId, year }),
    });
    const data: {
      success?: boolean;
      board?: { id: string };
      error?: string;
    } = await res.json();

    if (!res.ok || !data.board) {
      setErrorMsg(data.error || "Não foi possível inicializar o conselho desta turma.");
      return null;
    }

    return data.board.id;
  }

  async function handleOpenTrimester(classGroupId: string, trimester: CouncilTrimesterNumber) {
    setOpeningTarget({ classGroupId, trimester, action: "open" });
    setErrorMsg(null);
    try {
      const boardId = await ensureBoard(classGroupId);
      if (boardId) {
        router.push(`/conselho-classe/${boardId}?trimestre=${trimester}`);
      }
    } catch {
      setErrorMsg("Falha de conexão ao abrir o conselho da turma.");
    } finally {
      setOpeningTarget(null);
    }
  }

  async function handleOpenSereImport(cg: CouncilIndexClassGroupItem) {
    if (!canEdit) return;
    setOpeningTarget({ classGroupId: cg.id, action: "sere" });
    setErrorMsg(null);
    try {
      const hadBoard = boardByClassId.has(cg.id);
      const boardId = await ensureBoard(cg.id);
      if (!boardId) return;
      if (!hadBoard) {
        await refreshYearData(year).catch(() => {});
      }
      setSereModalTarget({ boardId, classNameLabel: cg.name });
    } catch {
      setErrorMsg("Falha de conexão ao preparar a importação da turma.");
    } finally {
      setOpeningTarget(null);
    }
  }

  async function handleBoardUpdatedFromSere(updatedBoard: CouncilBoardDetailRecord) {
    setClassGroups((prev) =>
      prev.map((cg) =>
        cg.id === updatedBoard.classGroupId
          ? { ...cg, shift: updatedBoard.classGroup.shift }
          : cg
      )
    );
    await refreshYearData(year).catch(() => {});
  }

  async function handleShiftChange(cg: CouncilIndexClassGroupItem, nextShift: string) {
    if (!canEdit || cg.shift === nextShift) return;
    const previousShift = cg.shift;
    setSavingShiftClassId(cg.id);
    setErrorMsg(null);
    setClassGroups((prev) =>
      prev.map((item) => (item.id === cg.id ? { ...item, shift: nextShift } : item))
    );

    try {
      const res = await fetch(`/api/classes/${cg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift: nextShift }),
      });
      const data: { success?: boolean; error?: string } = await res.json();
      if (!res.ok) {
        setClassGroups((prev) =>
          prev.map((item) => (item.id === cg.id ? { ...item, shift: previousShift } : item))
        );
        notify(data.error || "Não foi possível alterar o turno.", "error");
        return;
      }
      notify(`Turno de ${cg.name} atualizado para ${formatShiftLabel(nextShift)}.`);
    } catch {
      setClassGroups((prev) =>
        prev.map((item) => (item.id === cg.id ? { ...item, shift: previousShift } : item))
      );
      notify("Falha de conexão ao atualizar o turno.", "error");
    } finally {
      setSavingShiftClassId(null);
    }
  }

  async function handleSaveName(cg: CouncilIndexClassGroupItem) {
    if (!canEdit || savingNameClassId === cg.id) return;
    const trimmed = editingNameDraft.trim();
    if (trimmed.length < 2) {
      notify("Nome da turma deve ter pelo menos 2 caracteres.", "error");
      return;
    }
    if (trimmed === cg.name) {
      setEditingNameClassId(null);
      return;
    }
    setSavingNameClassId(cg.id);
    try {
      const res = await fetch(`/api/classes/${cg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data: { success?: boolean; classGroup?: { name: string }; error?: string } =
        await res.json().catch(() => ({}));
      if (!res.ok || !data.classGroup) {
        notify(data.error || "Não foi possível alterar o nome da turma.", "error");
        return;
      }
      const nextName = data.classGroup.name;
      setClassGroups((prev) =>
        prev.map((item) => (item.id === cg.id ? { ...item, name: nextName } : item))
      );
      setEditingNameClassId(null);
      notify(`Turma renomeada para ${nextName}.`);
    } catch {
      notify("Falha de conexão ao atualizar o nome da turma.", "error");
    } finally {
      setSavingNameClassId(null);
    }
  }

  const yearOptions = Array.from(
    new Set([initialYear - 1, initialYear, initialYear + 1])
  ).sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      <header className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-5 py-4 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              Conselho de Classe e Pós-Conselho
            </h1>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {schoolName}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => setInviteModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-xs font-bold text-sky-900 dark:text-sky-200 transition cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Código de Vínculo Docente</span>
            </button>
          )}
          {canUseBiScraper && (
            <Link
              href="/gestao"
              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Gestão Escolar
            </Link>
          )}
          <div className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-sky-600" />
            <label htmlFor="council-year-select" className="sr-only">
              Ano letivo
            </label>
            <select
              id="council-year-select"
              disabled={loadingYear}
              value={year}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Ano letivo {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-4 py-3 text-xs font-bold text-rose-800 dark:text-rose-200"
        >
          {errorMsg}
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl border shadow-lg text-xs font-bold ${
            toast.kind === "error"
              ? "bg-rose-600 border-rose-700 text-white"
              : "bg-slate-900 border-slate-800 text-white dark:bg-emerald-600 dark:border-emerald-700"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar turma"
            placeholder="Buscar turma..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          aria-label="Filtrar por turno"
          value={shiftFilter}
          onChange={(e) => setShiftFilter(e.target.value)}
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-100"
        >
          <option value="ALL">Todos os turnos</option>
          <option value="MANHA">Manhã</option>
          <option value="TARDE">Tarde</option>
          <option value="NOITE">Noite</option>
          <option value="INTEGRAL">Integral</option>
        </select>
      </div>

      {/* Lista Compacta de Turmas */}
      {filteredClassGroups.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
          Nenhuma turma encontrada para o filtro selecionado.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="hidden lg:grid lg:grid-cols-[minmax(180px,1.2fr)_130px_145px_minmax(280px,1.5fr)_auto] items-center gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span>Turma</span>
            <span>Turno</span>
            <span>Composição</span>
            <span>Acessar trimestre</span>
            {canEdit && <span className="text-right">Notas SERE</span>}
          </div>

          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredClassGroups.map((cg) => {
              const board = boardByClassId.get(cg.id);
              const isRowBusy = openingTarget?.classGroupId === cg.id;
              const isOpeningSere = isRowBusy && openingTarget?.action === "sere";
              const isSavingShift = savingShiftClassId === cg.id;

              return (
                <li
                  key={cg.id}
                  className="px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition grid grid-cols-1 lg:grid-cols-[minmax(180px,1.2fr)_130px_145px_minmax(280px,1.5fr)_auto] items-center gap-3"
                >
                  {/* Turma e Segmento */}
                  <div className="flex items-center justify-between lg:justify-start gap-2.5 min-w-0">
                    <div className="min-w-0 flex-1">
                      {editingNameClassId === cg.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            aria-label={`Novo nome para ${cg.name}`}
                            value={editingNameDraft}
                            onChange={(e) => setEditingNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleSaveName(cg);
                              } else if (e.key === "Escape") {
                                setEditingNameClassId(null);
                              }
                            }}
                            disabled={savingNameClassId === cg.id}
                            className="w-32 sm:w-40 rounded-lg border border-sky-400 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-bold text-slate-900 dark:text-white focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            aria-label={`Salvar nome da turma ${cg.name}`}
                            disabled={savingNameClassId === cg.id}
                            onClick={() => void handleSaveName(cg)}
                            className="p-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 cursor-pointer"
                          >
                            {savingNameClassId === cg.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label="Cancelar edição do nome"
                            disabled={savingNameClassId === cg.id}
                            onClick={() => setEditingNameClassId(null)}
                            className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <h2 className="text-sm font-black text-slate-900 dark:text-white truncate">
                            {cg.name}
                          </h2>
                          {canEdit && (
                            <button
                              type="button"
                              aria-label={`Editar nome da turma ${cg.name}`}
                              onClick={() => {
                                setEditingNameClassId(cg.id);
                                setEditingNameDraft(cg.name);
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                              board
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
                                : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                            }`}
                          >
                            {board ? "Iniciado" : "Pendente"}
                          </span>
                        </div>
                      )}
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                        {formatSegmentLabel(cg.segment)}
                      </p>
                    </div>
                  </div>

                  {/* Turno (Editável inline para canEdit) */}
                  <div className="flex items-center gap-1.5">
                    {canEdit ? (
                      <select
                        aria-label={`Turno da turma ${cg.name}`}
                        disabled={isSavingShift}
                        value={cg.shift.toUpperCase()}
                        onChange={(e) => handleShiftChange(cg, e.target.value)}
                        className="w-full lg:w-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-100 disabled:opacity-60 cursor-pointer"
                      >
                        {SHIFT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {formatShiftLabel(cg.shift)}
                      </span>
                    )}
                  </div>

                  {/* Composição */}
                  <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1" title="Estudantes ativos">
                      <Users className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                      <span className="font-semibold">{cg._count.students}</span>
                    </span>
                    <span className="inline-flex items-center gap-1" title="Componentes curriculares">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="font-semibold">
                        {board ? board._count.subjects : 0} comp.
                      </span>
                    </span>
                  </div>

                  {/* Botões de Acesso Direto por Trimestre */}
                  <div
                    role="group"
                    aria-label={`Trimestres de ${cg.name}`}
                    className="grid grid-cols-3 gap-1.5"
                  >
                    {([1, 2, 3] as const).map((tri) => {
                      const triRec = board?.trimesters.find((t) => t.trimester === tri);
                      const consolidated = triRec?.status === "CONSOLIDATED";
                      const isOpeningThisTri =
                        isRowBusy &&
                        openingTarget?.action === "open" &&
                        openingTarget?.trimester === tri;
                      const statusText = isOpeningThisTri
                        ? "Abrindo..."
                        : consolidated
                          ? "Consolidado"
                          : board
                            ? "Em aberto"
                            : "Iniciar";

                      return (
                        <button
                          key={tri}
                          type="button"
                          disabled={isRowBusy}
                          onClick={() => handleOpenTrimester(cg.id, tri)}
                          className={`rounded-lg border px-2 py-1.5 text-center transition cursor-pointer disabled:opacity-60 ${
                            consolidated
                              ? "bg-emerald-50/80 hover:bg-emerald-100 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:border-emerald-800 dark:text-emerald-200"
                              : board
                                ? "bg-sky-50/60 hover:bg-sky-100 border-sky-200 text-sky-900 dark:bg-sky-950/30 dark:hover:bg-sky-900/50 dark:border-sky-800 dark:text-sky-200"
                                : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800 dark:border-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <div className="text-[11px] font-extrabold leading-tight">
                            {tri}º Trim.
                          </div>
                          <div className="text-[10px] leading-tight opacity-85">
                            {statusText}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Ação direta Importar SERE */}
                  {canEdit && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isRowBusy}
                        onClick={() => handleOpenSereImport(cg)}
                        className="w-full lg:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-sky-300 dark:border-sky-700 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/60 text-sky-900 dark:text-sky-200 text-xs font-bold transition cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      >
                        {isOpeningSere ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileUp className="w-3.5 h-3.5" />
                        )}
                        <span>Importar SERE</span>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sereModalTarget && (
        <CouncilSerePdfImportModal
          open={Boolean(sereModalTarget)}
          onClose={() => setSereModalTarget(null)}
          boardId={sereModalTarget.boardId}
          classNameLabel={sereModalTarget.classNameLabel}
          onBoardUpdated={handleBoardUpdatedFromSere}
          onNotify={notify}
        />
      )}

      {canEdit && (
        <CouncilTeacherInviteModal
          open={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          onNotify={notify}
        />
      )}
    </div>
  );
}
