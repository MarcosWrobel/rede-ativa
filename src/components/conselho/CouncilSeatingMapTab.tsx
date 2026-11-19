"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownUp,
  Ban,
  Check,
  Copy,
  DoorOpen,
  Eraser,
  GripVertical,
  LayoutGrid,
  Minus,
  Pencil,
  Plus,
  Printer,
  RotateCw,
  Save,
  Search,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { buildClassCouncilAnalytics } from "./councilAnalytics";
import {
  assignStudentToSeat,
  calculateRecommendedRows,
  clearAllSeats,
  createSeatingMapVersion,
  duplicateMapVersion,
  fillSeatsAlphabetically,
  formatShortStudentName,
  getDisplayGridForPerspective,
  parseSeatingMapStore,
  resizeSeatingMapGrid,
  rotateSeatingMapColumns,
  swapOrMoveSeats,
  toggleSeatBlocked,
  type ClassroomDoorSide,
  type SeatingMapStore,
  type SeatingMapVersion,
  type TeacherDeskPosition,
} from "./seatingMapUtils";
import {
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_SEATING_MAP_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  getStudentInitials,
  type CouncilBoardDetailRecord,
  type CouncilEnrollmentStatus,
  type CouncilSeatingMapMode,
  type CouncilTrimesterNumber,
} from "./types";

interface CouncilSeatingMapTabProps {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  hideSensitiveTags: boolean;
  onBoardUpdated: (updated: CouncilBoardDetailRecord) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

type SelectionSource =
  | { kind: "unassigned"; studentId: string; studentName: string }
  | { kind: "seat"; col: number; row: number; studentId: string; studentName: string };

type DragPayload =
  | { kind: "unassigned"; studentId: string }
  | { kind: "seat"; col: number; row: number; studentId: string };

function generateLocalMapId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `map-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function getDefaultMapName(): string {
  const now = new Date();
  const months = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  return `${months[now.getMonth()]} / ${now.getFullYear()}`;
}

export default function CouncilSeatingMapTab({
  board,
  activeTrimester,
  hideSensitiveTags,
  onBoardUpdated,
  onNotify,
  readOnly = false,
}: CouncilSeatingMapTabProps) {
  const initialStore = useMemo(
    () => parseSeatingMapStore(board.seatingMapLayoutJson),
    [board.seatingMapLayoutJson]
  );

  const [store, setStore] = useState<SeatingMapStore>(initialStore);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(
    initialStore.activeMapId ?? initialStore.maps[0]?.id ?? null
  );
  const [seatingMapMode, setSeatingMapMode] = useState<CouncilSeatingMapMode>(
    (board.seatingMapMode as CouncilSeatingMapMode) || "REVEZAMENTO_MENSAL"
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showIndicators, setShowIndicators] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selection, setSelection] = useState<SelectionSource | null>(null);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dragOverCoord, setDragOverCoord] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  // Controles inline de versão (sem window.prompt / window.confirm)
  const [creatingNew, setCreatingNew] = useState(false);
  const [newMapName, setNewMapName] = useState("");
  const [newMapDate, setNewMapDate] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStore(initialStore);
    setSelectedMapId((prev) => {
      if (prev && initialStore.maps.some((m) => m.id === prev)) return prev;
      return initialStore.activeMapId ?? initialStore.maps[0]?.id ?? null;
    });
    setSeatingMapMode((board.seatingMapMode as CouncilSeatingMapMode) || "REVEZAMENTO_MENSAL");
    setHasUnsavedChanges(false);
  }, [initialStore, board.seatingMapMode]);

  useEffect(() => {
    return () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, []);

  // Cancela seleção por clique com tecla Escape
  useEffect(() => {
    if (!selection) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelection(null);
        announce("Seleção cancelada.");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection]);

  function announce(msg: string) {
    setLiveAnnouncement("");
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => {
      setLiveAnnouncement(msg);
    }, 30);
  }

  const activeMap = useMemo(
    () => store.maps.find((m) => m.id === selectedMapId) ?? store.maps[0] ?? null,
    [store.maps, selectedMapId]
  );

  const activeEnrollmentCards = useMemo(() => {
    const ativos = board.studentCards.filter((c) => c.enrollmentStatus === "ATIVO");
    return ativos.length > 0 ? ativos : board.studentCards;
  }, [board.studentCards]);

  const cardByStudentId = useMemo(
    () => new Map(board.studentCards.map((c) => [c.studentId, c])),
    [board.studentCards]
  );

  const analyticsByStudentId = useMemo(() => {
    if (!showIndicators) return new Map();
    const summary = buildClassCouncilAnalytics(board, activeTrimester);
    return new Map(summary.students.map((s) => [s.studentId, s]));
  }, [board, activeTrimester, showIndicators]);

  const tagOptionMap = useMemo(
    () => new Map(COUNCIL_STUDENT_TAG_OPTIONS.map((t) => [t.value, t])),
    []
  );

  const positionedStudentIds = useMemo(() => {
    if (!activeMap) return new Set<string>();
    return new Set(
      activeMap.seats.map((s) => s.studentId).filter((id): id is string => Boolean(id))
    );
  }, [activeMap]);

  const unassignedStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return activeEnrollmentCards
      .filter((c) => !positionedStudentIds.has(c.studentId))
      .filter((c) => {
        if (!q) return true;
        return (
          c.student.name.toLowerCase().includes(q) ||
          (c.student.cgm || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.student.name.localeCompare(b.student.name, "pt-BR"));
  }, [activeEnrollmentCards, positionedStudentIds, searchTerm]);

  const displayGrid = useMemo(
    () => (activeMap ? getDisplayGridForPerspective(activeMap, "ROOM") : null),
    [activeMap]
  );

  function updateSelectedMap(updater: (current: SeatingMapVersion) => SeatingMapVersion) {
    if (!activeMap || readOnly) return;
    setStore((prev) => ({
      ...prev,
      maps: prev.maps.map((m) => (m.id === activeMap.id ? updater(m) : m)),
    }));
    setHasUnsavedChanges(true);
  }

  function handleCreateInitialOrNewMap(customName?: string, customDate?: string) {
    if (readOnly) return;
    const cols = activeMap?.columns ?? 5;
    const rows = calculateRecommendedRows(activeEnrollmentCards.length, cols);
    const id = generateLocalMapId();
    const created = createSeatingMapVersion({
      id,
      name: (customName ?? "").trim() || getDefaultMapName(),
      effectiveDate: customDate?.trim() || new Date().toISOString().slice(0, 10),
      columns: cols,
      rows,
      teacherDeskPosition: activeMap?.teacherDeskPosition ?? "CENTER",
      doorSide: activeMap?.doorSide ?? "LEFT",
      notes: board.seatingMapNotes ?? null,
    });

    setStore((prev) => ({
      version: 1,
      activeMapId: prev.activeMapId ?? created.id,
      maps: [...prev.maps, created],
    }));
    setSelectedMapId(created.id);
    setCreatingNew(false);
    setNewMapName("");
    setNewMapDate("");
    setHasUnsavedChanges(true);
    announce(`Mapa ${created.name} criado.`);
  }

  function handleDuplicateAndRotate() {
    if (!activeMap || readOnly) return;
    if (store.maps.length >= 24) {
      onNotify("Limite de 24 versões salvas atingido para esta turma.", "error");
      return;
    }
    const id = generateLocalMapId();
    const copy = duplicateMapVersion(activeMap, {
      id,
      name: `${activeMap.name} (próx. ciclo)`,
      effectiveDate: new Date().toISOString().slice(0, 10),
      rotateDirection: "RIGHT",
    });

    setStore((prev) => ({
      version: 1,
      activeMapId: copy.id,
      maps: [...prev.maps, copy],
    }));
    setSelectedMapId(copy.id);
    setSelection(null);
    setHasUnsavedChanges(true);
    announce(`Nova versão ${copy.name} criada com rotação de filas.`);
  }

  function handleSetActiveMap() {
    if (!activeMap || readOnly) return;
    setStore((prev) => ({
      ...prev,
      activeMapId: activeMap.id,
    }));
    setHasUnsavedChanges(true);
    announce(`${activeMap.name} definido como mapa vigente.`);
  }

  function handleCommitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!activeMap || readOnly) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    updateSelectedMap((cur) => ({
      ...cur,
      name: trimmed.slice(0, 100),
      updatedAt: new Date().toISOString(),
    }));
    setRenaming(false);
    announce(`Mapa renomeado para ${trimmed}.`);
  }

  function handleDeleteSelectedMap() {
    if (!activeMap || readOnly) return;
    const remaining = store.maps.filter((m) => m.id !== activeMap.id);
    const nextActiveId =
      store.activeMapId === activeMap.id ? remaining[0]?.id ?? null : store.activeMapId;
    setStore({
      version: 1,
      activeMapId: nextActiveId,
      maps: remaining,
    });
    setSelectedMapId(remaining[0]?.id ?? null);
    setConfirmingDelete(false);
    setSelection(null);
    setHasUnsavedChanges(true);
    announce(`Mapa ${activeMap.name} removido.`);
  }

  function handleChangeColumns(nextColumns: number) {
    if (!activeMap || readOnly) return;
    const clampedCols = Math.max(2, Math.min(8, nextColumns));
    const recommendedRows = calculateRecommendedRows(activeEnrollmentCards.length, clampedCols);
    const result = resizeSeatingMapGrid(activeMap, clampedCols, recommendedRows);
    updateSelectedMap(() => result.map);
    setSelection(null);
    if (result.displacedStudentIds.length > 0) {
      onNotify(
        `${result.displacedStudentIds.length} estudante(s) retornaram à lista lateral ao reduzir a grade.`,
        "error"
      );
    }
    announce(`Planta ajustada para ${clampedCols} filas e ${recommendedRows} carteiras por fila.`);
  }

  function handleChangeRows(nextRows: number) {
    if (!activeMap || readOnly) return;
    const clampedRows = Math.max(1, Math.min(12, nextRows));
    const result = resizeSeatingMapGrid(activeMap, activeMap.columns, clampedRows);
    updateSelectedMap(() => result.map);
    setSelection(null);
    if (result.displacedStudentIds.length > 0) {
      onNotify(
        `${result.displacedStudentIds.length} estudante(s) retornaram à lista lateral ao reduzir as linhas.`,
        "error"
      );
    }
  }

  function handleSeatAction(col: number, row: number) {
    if (!activeMap || readOnly) return;
    const targetSeat = activeMap.seats.find((s) => s.col === col && s.row === row);
    if (!targetSeat || targetSeat.blocked) return;

    if (!selection) {
      if (targetSeat.studentId) {
        const stName = cardByStudentId.get(targetSeat.studentId)?.student.name ?? "Estudante";
        setSelection({
          kind: "seat",
          col,
          row,
          studentId: targetSeat.studentId,
          studentName: stName,
        });
        announce(`${stName} selecionado para mover ou trocar de lugar.`);
      }
      return;
    }

    if (selection.kind === "seat") {
      if (selection.col === col && selection.row === row) {
        setSelection(null);
        return;
      }
      updateSelectedMap((cur) =>
        swapOrMoveSeats(cur, { col: selection.col, row: selection.row }, { col, row })
      );
      announce(`${selection.studentName} movido para Fila ${col + 1}, posição ${row + 1}.`);
      setSelection(null);
      return;
    }

    // Seleção veio da lista de não posicionados
    updateSelectedMap((cur) => assignStudentToSeat(cur, col, row, selection.studentId));
    announce(`${selection.studentName} posicionado na Fila ${col + 1}, posição ${row + 1}.`);
    setSelection(null);
  }

  function handleDropOnSeat(col: number, row: number, payload: DragPayload | null) {
    if (!activeMap || readOnly || !payload) return;
    const targetSeat = activeMap.seats.find((s) => s.col === col && s.row === row);
    if (!targetSeat || targetSeat.blocked) return;

    if (payload.kind === "unassigned") {
      updateSelectedMap((cur) => assignStudentToSeat(cur, col, row, payload.studentId));
      const stName = cardByStudentId.get(payload.studentId)?.student.name ?? "Estudante";
      announce(`${stName} posicionado na Fila ${col + 1}, posição ${row + 1}.`);
    } else {
      updateSelectedMap((cur) =>
        swapOrMoveSeats(cur, { col: payload.col, row: payload.row }, { col, row })
      );
      const stName = cardByStudentId.get(payload.studentId)?.student.name ?? "Estudante";
      announce(`${stName} movido para Fila ${col + 1}, posição ${row + 1}.`);
    }
    setDragPayload(null);
    setDragOverCoord(null);
    setSelection(null);
  }

  async function handleSaveStore() {
    if (readOnly || saving) return;
    setSaving(true);
    try {
      const currentActive =
        store.maps.find((m) => m.id === store.activeMapId) ?? activeMap ?? null;
      const res = await fetch(`/api/conselho-classe/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatingMapMode,
          seatingMapNotes: currentActive?.notes ?? board.seatingMapNotes ?? null,
          seatingMapLayout: store,
        }),
      });
      const data: { success?: boolean; board?: CouncilBoardDetailRecord; error?: string } =
        await res.json();

      if (!res.ok || !data.board) {
        onNotify(data.error || "Não foi possível salvar o mapa de sala.", "error");
        return;
      }

      onBoardUpdated(data.board);
      setHasUnsavedChanges(false);
      onNotify("Mapa de sala salvo.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar o mapa de sala.", "error");
    } finally {
      setSaving(false);
    }
  }

  const activeMapIsVigente = Boolean(activeMap && store.activeMapId === activeMap.id);
  const printHref = activeMap
    ? `/conselho-classe/${board.id}/imprimir?mode=mapa-sala&mapId=${encodeURIComponent(activeMap.id)}`
    : `/conselho-classe/${board.id}/imprimir?mode=mapa-sala`;

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Cabeçalho de Histórico e Ações de Versão */}
      <section
        aria-label="Versões do mapa de sala"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-sky-600" />
              <label
                htmlFor="seating-map-version-select"
                className="text-xs font-black text-slate-800 dark:text-slate-100"
              >
                Versão do mapa:
              </label>
            </div>

            {store.maps.length > 0 ? (
              <select
                id="seating-map-version-select"
                value={activeMap?.id ?? ""}
                onChange={(e) => {
                  setSelectedMapId(e.target.value);
                  setSelection(null);
                  setRenaming(false);
                  setConfirmingDelete(false);
                }}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100 min-w-[220px]"
              >
                {store.maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.effectiveDate ? ` (${m.effectiveDate.split("-").reverse().join("/")})` : ""}
                    {store.activeMapId === m.id ? " • Vigente" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-semibold text-slate-500">
                Nenhum mapa criado para esta turma
              </span>
            )}

            {activeMap && activeMapIsVigente && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold">
                <Star className="w-3 h-3" />
                <span>Mapa vigente</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setNewMapName(getDefaultMapName());
                    setNewMapDate(new Date().toISOString().slice(0, 10));
                    setCreatingNew((prev) => !prev);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-sky-600" />
                  <span>Novo mapa</span>
                </button>

                {activeMap && (
                  <>
                    <button
                      type="button"
                      onClick={handleDuplicateAndRotate}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900 text-xs font-bold text-sky-900 dark:text-sky-200 transition cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Duplicar e rotacionar</span>
                    </button>

                    {!activeMapIsVigente && (
                      <button
                        type="button"
                        onClick={handleSetActiveMap}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-xs font-bold text-emerald-900 dark:text-emerald-200 transition cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Definir como vigente</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(activeMap.name);
                        setRenaming((prev) => !prev);
                      }}
                      aria-label="Renomear versão do mapa"
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Renomear</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmingDelete((prev) => !prev)}
                      aria-label="Excluir versão do mapa"
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/40 hover:bg-rose-100 text-xs font-bold text-rose-700 dark:text-rose-300 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir</span>
                    </button>
                  </>
                )}
              </>
            )}

            {activeMap && (
              <Link
                href={printHref}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold transition"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span>Imprimir A4</span>
              </Link>
            )}

            {!readOnly && (
              <button
                type="button"
                disabled={saving || !hasUnsavedChanges}
                onClick={handleSaveStore}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-45 text-white text-xs font-bold transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Salvando..." : "Salvar mapa"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Formulário inline: Novo mapa */}
        {creatingNew && !readOnly && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateInitialOrNewMap(newMapName, newMapDate);
            }}
            className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-end gap-2"
          >
            <div>
              <label
                htmlFor="new-seating-map-name"
                className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                Nome da versão
              </label>
              <input
                id="new-seating-map-name"
                type="text"
                required
                maxLength={100}
                value={newMapName}
                onChange={(e) => setNewMapName(e.target.value)}
                placeholder="Ex.: Abril / 2026"
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 min-w-[210px]"
              />
            </div>
            <div>
              <label
                htmlFor="new-seating-map-date"
                className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                Data de vigência
              </label>
              <input
                id="new-seating-map-date"
                type="date"
                value={newMapDate}
                onChange={(e) => setNewMapDate(e.target.value)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer"
            >
              Criar versão
            </button>
            <button
              type="button"
              onClick={() => setCreatingNew(false)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              Cancelar
            </button>
          </form>
        )}

        {/* Formulário inline: Renomear */}
        {renaming && activeMap && !readOnly && (
          <form
            onSubmit={handleCommitRename}
            className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              aria-label="Novo nome para o mapa de sala"
              required
              maxLength={100}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 min-w-[220px]"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
            >
              Aplicar nome
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              Cancelar
            </button>
          </form>
        )}

        {/* Confirmação inline: Excluir versão */}
        {confirmingDelete && activeMap && !readOnly && (
          <div className="pt-3 border-t border-rose-200 dark:border-rose-900 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-rose-800 dark:text-rose-200">
              Excluir a versão &ldquo;{activeMap.name}&rdquo;? Clique em &ldquo;Salvar mapa&rdquo; para confirmar no banco.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDeleteSelectedMap}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
              >
                Confirmar exclusão
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {hasUnsavedChanges && !readOnly && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
            <span>Alterações pendentes no mapa de sala.</span>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveStore}
              className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
            >
              Salvar agora
            </button>
          </div>
        )}
      </section>

      {/* Estado vazio inicial */}
      {!activeMap || !displayGrid ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-3 shadow-xs">
          <LayoutGrid className="w-8 h-8 text-sky-600 mx-auto" />
          <h3 className="text-base font-black text-slate-900 dark:text-white">
            Organizador de Sala — {board.classGroup.name}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            Defina a quantidade de filas para os {activeEnrollmentCards.length} estudantes ativos,
            associe cada carteira e gere versões para impressão em A4 paisagem.
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={() => handleCreateInitialOrNewMap(getDefaultMapName())}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Criar primeiro mapa</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Barra de configuração da planta */}
          <section
            aria-label="Configuração da planta da sala"
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Filas (2..8) */}
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    Filas:
                  </span>
                  <button
                    type="button"
                    disabled={readOnly || activeMap.columns <= 2}
                    onClick={() => handleChangeColumns(activeMap.columns - 1)}
                    aria-label="Diminuir quantidade de filas"
                    className="p-1 rounded-lg hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-5 text-center text-xs font-black text-slate-900 dark:text-white">
                    {activeMap.columns}
                  </span>
                  <button
                    type="button"
                    disabled={readOnly || activeMap.columns >= 8}
                    onClick={() => handleChangeColumns(activeMap.columns + 1)}
                    aria-label="Aumentar quantidade de filas"
                    className="p-1 rounded-lg hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Carteiras por fila (1..12) */}
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    Carteiras/fila:
                  </span>
                  <button
                    type="button"
                    disabled={readOnly || activeMap.rows <= 1}
                    onClick={() => handleChangeRows(activeMap.rows - 1)}
                    aria-label="Diminuir carteiras por fila"
                    className="p-1 rounded-lg hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-5 text-center text-xs font-black text-slate-900 dark:text-white">
                    {activeMap.rows}
                  </span>
                  <button
                    type="button"
                    disabled={readOnly || activeMap.rows >= 12}
                    onClick={() => handleChangeRows(activeMap.rows + 1)}
                    aria-label="Aumentar carteiras por fila"
                    className="p-1 rounded-lg hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <select
                  aria-label="Posição da mesa do professor"
                  disabled={readOnly}
                  value={activeMap.teacherDeskPosition}
                  onChange={(e) =>
                    updateSelectedMap((cur) => ({
                      ...cur,
                      teacherDeskPosition: e.target.value as TeacherDeskPosition,
                      updatedAt: new Date().toISOString(),
                    }))
                  }
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  <option value="LEFT">Mesa: Esquerda</option>
                  <option value="CENTER">Mesa: Centro</option>
                  <option value="RIGHT">Mesa: Direita</option>
                </select>

                <select
                  aria-label="Posição da porta da sala"
                  disabled={readOnly}
                  value={activeMap.doorSide}
                  onChange={(e) =>
                    updateSelectedMap((cur) => ({
                      ...cur,
                      doorSide: e.target.value as ClassroomDoorSide,
                      updatedAt: new Date().toISOString(),
                    }))
                  }
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  <option value="LEFT">Porta: Esquerda</option>
                  <option value="RIGHT">Porta: Direita</option>
                  <option value="NONE">Porta: Ocultar</option>
                </select>

                <select
                  aria-label="Regime de revezamento do mapa"
                  disabled={readOnly}
                  value={seatingMapMode}
                  onChange={(e) => {
                    setSeatingMapMode(e.target.value as CouncilSeatingMapMode);
                    setHasUnsavedChanges(true);
                  }}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  {Object.entries(COUNCIL_SEATING_MAP_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={showIndicators}
                  onClick={() => setShowIndicators((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    showIndicators
                      ? "bg-sky-600 border-sky-600 text-white"
                      : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Indicadores do conselho</span>
                </button>

                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        updateSelectedMap((cur) =>
                          fillSeatsAlphabetically(
                            cur,
                            activeEnrollmentCards.map((c) => ({
                              studentId: c.studentId,
                              name: c.student.name,
                              enrollmentStatus: c.enrollmentStatus,
                            }))
                          )
                        );
                        setSelection(null);
                        announce("Carteiras livres preenchidas em ordem alfabética.");
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
                    >
                      <ArrowDownUp className="w-3.5 h-3.5 text-sky-600" />
                      <span>Preencher A–Z</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        updateSelectedMap((cur) => rotateSeatingMapColumns(cur, "RIGHT"));
                        setSelection(null);
                        announce("Filas rotacionadas.");
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Rotacionar filas</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        updateSelectedMap((cur) => clearAllSeats(cur));
                        setSelection(null);
                        announce("Todas as carteiras foram esvaziadas.");
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 transition cursor-pointer"
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      <span>Limpar carteiras</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {selection && (
              <div className="rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/60 px-3 py-2 text-xs font-bold text-sky-900 dark:text-sky-100 flex flex-wrap items-center justify-between gap-2">
                <span>
                  Selecionado: <strong>{selection.studentName}</strong> — clique em uma carteira para posicionar ou trocar de lugar (Esc cancela).
                </span>
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-xs font-bold cursor-pointer"
                >
                  Cancelar seleção
                </button>
              </div>
            )}
          </section>

          {/* Planta Retangular + Painel Lateral */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            {/* Planta da Sala */}
            <section
              aria-label="Planta da sala de aula"
              className="xl:col-span-9 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs"
            >
              {/* Quadro e Mesa do Professor */}
              <div className="space-y-2">
                <div className="mx-auto max-w-2xl rounded-xl border-2 border-slate-700 dark:border-slate-600 bg-slate-800 text-white py-2 px-4 text-center text-xs font-black tracking-widest uppercase">
                  Quadro / Frente da sala
                </div>

                <div
                  className={`flex items-center justify-between gap-2 text-[11px] font-bold ${
                    activeMap.doorSide === "RIGHT" ? "flex-row-reverse" : ""
                  }`}
                >
                  {activeMap.doorSide !== "NONE" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200">
                      <DoorOpen className="w-3.5 h-3.5" />
                      <span>Porta</span>
                    </span>
                  ) : (
                    <span />
                  )}

                  <div
                    className={`flex-1 flex ${
                      activeMap.teacherDeskPosition === "LEFT"
                        ? "justify-start"
                        : activeMap.teacherDeskPosition === "RIGHT"
                        ? "justify-end"
                        : "justify-center"
                    }`}
                  >
                    <span className="px-4 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                      Mesa do professor
                    </span>
                  </div>
                </div>
              </div>

              {/* Grade de Filas e Carteiras */}
              <div className="overflow-x-auto pb-1">
                <div
                  className="grid gap-2.5 min-w-[600px]"
                  style={{
                    gridTemplateColumns: `repeat(${activeMap.columns}, minmax(115px, 1fr))`,
                  }}
                >
                  {displayGrid.colIndices.map((colIdx) => (
                    <div
                      key={`col-head-${colIdx}`}
                      className="text-center text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80"
                    >
                      Fila {colIdx + 1}
                    </div>
                  ))}

                  {displayGrid.rowsGrid.flatMap((rowCells) =>
                    rowCells.map((cell) => {
                      const { seat, logicalCol, logicalRow, positionLabel } = cell;
                      const coordKey = `${logicalCol}:${logicalRow}`;
                      const studentCard = seat.studentId
                        ? cardByStudentId.get(seat.studentId) ?? null
                        : null;
                      const studentSummary = seat.studentId
                        ? analyticsByStudentId.get(seat.studentId) ?? null
                        : null;
                      const isSelectedSource =
                        selection?.kind === "seat" &&
                        selection.col === logicalCol &&
                        selection.row === logicalRow;
                      const isDragOver = dragOverCoord === coordKey;
                      const isInactiveStudent =
                        studentCard !== null && studentCard.enrollmentStatus !== "ATIVO";

                      const visibleTags = studentCard
                        ? studentCard.tags.filter((tagValue) => {
                            const meta = tagOptionMap.get(tagValue as never);
                            if (!meta) return false;
                            if (hideSensitiveTags && meta.isSensitiveHealth) return false;
                            return true;
                          })
                        : [];

                      if (seat.blocked) {
                        return (
                          <div
                            key={coordKey}
                            className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/40 p-2 min-h-[86px] flex flex-col justify-between text-[11px] text-slate-500"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold">{positionLabel}</span>
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSelectedMap((cur) =>
                                      toggleSeatBlocked(cur, logicalCol, logicalRow)
                                    )
                                  }
                                  className="text-[10px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                                >
                                  Ativar
                                </button>
                              )}
                            </div>
                            <div className="text-center font-semibold text-slate-400 py-2">
                              Espaço livre
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={coordKey}
                          onDragOver={(e) => {
                            if (readOnly) return;
                            e.preventDefault();
                            if (dragOverCoord !== coordKey) setDragOverCoord(coordKey);
                          }}
                          onDragLeave={() => {
                            if (dragOverCoord === coordKey) setDragOverCoord(null);
                          }}
                          onDrop={(e) => {
                            if (readOnly) return;
                            e.preventDefault();
                            handleDropOnSeat(logicalCol, logicalRow, dragPayload);
                          }}
                          className={`rounded-xl border p-2 min-h-[86px] flex flex-col justify-between gap-1.5 transition ${
                            isSelectedSource
                              ? "border-sky-500 bg-sky-50 dark:bg-sky-950/60 ring-2 ring-sky-500/40"
                              : isDragOver
                              ? "border-sky-400 bg-sky-50/80 dark:bg-sky-950/40"
                              : studentCard
                              ? isInactiveStudent
                                ? "border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30"
                                : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                              : "border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-extrabold text-slate-400">
                              {positionLabel}
                            </span>

                            <div className="flex items-center gap-1">
                              {!readOnly && studentCard && (
                                <>
                                  <span
                                    draggable
                                    onDragStart={() =>
                                      setDragPayload({
                                        kind: "seat",
                                        col: logicalCol,
                                        row: logicalRow,
                                        studentId: studentCard.studentId,
                                      })
                                    }
                                    onDragEnd={() => {
                                      setDragPayload(null);
                                      setDragOverCoord(null);
                                    }}
                                    aria-label={`Arrastar ${studentCard.student.name}`}
                                    title="Arrastar para mover ou trocar"
                                    className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing select-none"
                                  >
                                    <GripVertical className="w-3.5 h-3.5" />
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`Remover ${studentCard.student.name} da carteira ${positionLabel}`}
                                    onClick={() => {
                                      updateSelectedMap((cur) =>
                                        assignStudentToSeat(cur, logicalCol, logicalRow, null)
                                      );
                                      if (
                                        selection?.kind === "seat" &&
                                        selection.col === logicalCol &&
                                        selection.row === logicalRow
                                      ) {
                                        setSelection(null);
                                      }
                                      announce(
                                        `${studentCard.student.name} removido da carteira ${positionLabel}.`
                                      );
                                    }}
                                    className="p-0.5 rounded text-slate-400 hover:text-rose-600 cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}

                              {!readOnly && !studentCard && (
                                <button
                                  type="button"
                                  aria-label={`Bloquear carteira ${positionLabel}`}
                                  title="Marcar espaço livre / corredor"
                                  onClick={() =>
                                    updateSelectedMap((cur) =>
                                      toggleSeatBlocked(cur, logicalCol, logicalRow)
                                    )
                                  }
                                  className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                                >
                                  <Ban className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => handleSeatAction(logicalCol, logicalRow)}
                            aria-label={
                              studentCard
                                ? `Carteira ${positionLabel}: ${studentCard.student.name}`
                                : `Carteira ${positionLabel} vazia`
                            }
                            className="w-full text-left flex-1 flex flex-col justify-center cursor-pointer disabled:cursor-default"
                          >
                            {studentCard ? (
                              <div className="space-y-1">
                                <div className="text-xs font-extrabold text-slate-900 dark:text-white leading-tight line-clamp-2">
                                  {formatShortStudentName(studentCard.student.name)}
                                </div>

                                {isInactiveStudent && (
                                  <div className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    <span>
                                      {COUNCIL_ENROLLMENT_STATUS_LABELS[
                                        studentCard.enrollmentStatus as CouncilEnrollmentStatus
                                      ] || studentCard.enrollmentStatus}
                                    </span>
                                  </div>
                                )}

                                {showIndicators && studentSummary && (
                                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                    {studentSummary.priority === "CRITICAL" && (
                                      <span className="px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-200 text-[9px] font-black">
                                        Crítico
                                      </span>
                                    )}
                                    {studentSummary.hasLowAttendance && (
                                      <span className="px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-950/70 text-orange-800 dark:text-orange-200 text-[9px] font-bold">
                                        Freq. &lt; 75%
                                      </span>
                                    )}
                                    {studentSummary.descriptorCounts[3] > 0 && (
                                      <span className="px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-200 text-[9px] font-bold">
                                        Conduta
                                      </span>
                                    )}
                                    {studentSummary.descriptorCounts[2] > 0 && (
                                      <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 text-[9px] font-bold">
                                        Dificuldade
                                      </span>
                                    )}
                                    {visibleTags.map((tagVal) => {
                                      const meta = tagOptionMap.get(tagVal as never);
                                      if (!meta) return null;
                                      return (
                                        <span
                                          key={tagVal}
                                          className={`px-1 py-0.5 rounded border text-[9px] font-bold ${meta.badgeClass}`}
                                        >
                                          {meta.shortLabel}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] font-semibold text-slate-400 text-center">
                                {selection ? "Posicionar aqui" : "Carteira livre"}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Observações desta versão */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label
                  htmlFor="seating-map-version-notes"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Observações deste mapa
                </label>
                <textarea
                  id="seating-map-version-notes"
                  rows={2}
                  disabled={readOnly}
                  value={activeMap.notes || ""}
                  onChange={(e) =>
                    updateSelectedMap((cur) => ({
                      ...cur,
                      notes: e.target.value,
                      updatedAt: new Date().toISOString(),
                    }))
                  }
                  placeholder="Critérios de organização, combinados de revezamento ou observações para os professores..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
              </div>
            </section>

            {/* Painel Lateral: Estudantes sem carteira */}
            <aside
              aria-label="Estudantes sem carteira associada"
              className="xl:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-800 dark:text-slate-100">
                  Sem carteira ({unassignedStudents.length})
                </h3>
                <span className="text-[11px] font-bold text-slate-500">
                  {positionedStudentIds.size}/{activeEnrollmentCards.length} alocados
                </span>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Buscar estudante sem carteira"
                  placeholder="Buscar por estudante..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              {unassignedStudents.length === 0 ? (
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-center text-xs font-bold text-emerald-800 dark:text-emerald-200">
                  Todos os estudantes ativos estão associados a uma carteira.
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-[540px] overflow-y-auto pr-1">
                  {unassignedStudents.map((card) => {
                    const isSelected =
                      selection?.kind === "unassigned" &&
                      selection.studentId === card.studentId;
                    const summary = showIndicators
                      ? analyticsByStudentId.get(card.studentId)
                      : null;

                    return (
                      <li key={card.studentId}>
                        <div
                          className={`flex items-center gap-2 rounded-xl border p-2 transition ${
                            isSelected
                              ? "border-sky-500 bg-sky-50 dark:bg-sky-950/60 ring-2 ring-sky-500/30"
                              : "border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          {!readOnly && (
                            <span
                              draggable
                              onDragStart={() =>
                                setDragPayload({
                                  kind: "unassigned",
                                  studentId: card.studentId,
                                })
                              }
                              onDragEnd={() => {
                                setDragPayload(null);
                                setDragOverCoord(null);
                              }}
                              aria-label={`Arrastar ${card.student.name}`}
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing select-none shrink-0"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                          )}

                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => {
                              if (isSelected) {
                                setSelection(null);
                                return;
                              }
                              setSelection({
                                kind: "unassigned",
                                studentId: card.studentId,
                                studentName: card.student.name,
                              });
                              announce(`${card.student.name} selecionado. Escolha uma carteira.`);
                            }}
                            className="flex-1 min-w-0 text-left flex items-center gap-2 cursor-pointer disabled:cursor-default"
                          >
                            <span
                              aria-hidden="true"
                              className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200 font-extrabold text-[10px] flex items-center justify-center shrink-0"
                            >
                              {getStudentInitials(card.student.name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {card.student.name}
                              </div>
                              {showIndicators && summary && summary.priority === "CRITICAL" && (
                                <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300">
                                  Prioridade crítica
                                </span>
                              )}
                            </div>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
