"use client";

import { useState, useMemo, useEffect } from "react";
import { CheckCheck, Filter, Save, Search, UserRound } from "lucide-react";
import {
  COUNCIL_DESCRIPTORS,
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  getCardBelowAvgForTrimester,
  getStudentInitials,
  isBelowAverageGradeUi,
  type CouncilBoardDetailRecord,
  type CouncilEnrollmentStatus,
  type CouncilStudentCardRecord,
  type CouncilTrimesterNumber,
} from "./types";

interface MatrixCellDraft {
  studentId: string;
  subjectId: string;
  descriptorCodes: number[];
  grade: number | null;
}

type MatrixFilterMode = "ALL" | "ALERTS" | "BELOW_AVG";

interface CouncilMatrixGridProps {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  hideSensitiveTags: boolean;
  onOpenStudentModal: (card: CouncilStudentCardRecord) => void;
  onOpenSubjectsModal: () => void;
  onMatrixSaved: () => Promise<void>;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

function cellKey(studentId: string, subjectId: string): string {
  return `${studentId}::${subjectId}`;
}

export default function CouncilMatrixGrid({
  board,
  activeTrimester,
  hideSensitiveTags,
  onOpenStudentModal,
  onOpenSubjectsModal,
  onMatrixSaved,
  onNotify,
  readOnly = false,
}: CouncilMatrixGridProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<MatrixFilterMode>("ALL");
  const [dirtyCells, setDirtyCells] = useState<Map<string, MatrixCellDraft>>(new Map());
  const [saving, setSaving] = useState(false);

  // Limpa rascunhos locais pendentes ao trocar o trimestre ou recarregar o conselho
  useEffect(() => {
    setDirtyCells(new Map());
  }, [activeTrimester, board.id]);

  const activeSubjects = useMemo(
    () => board.subjects.filter((s) => s.active),
    [board.subjects]
  );

  const tagOptionMap = useMemo(
    () => new Map(COUNCIL_STUDENT_TAG_OPTIONS.map((t) => [t.value, t])),
    []
  );

  const persistedEntryMap = useMemo(() => {
    const map = new Map<string, { descriptorCodes: number[]; grade: number | null }>();
    for (const card of board.studentCards) {
      for (const entry of card.subjectEntries) {
        if (entry.trimester === activeTrimester) {
          map.set(cellKey(card.studentId, entry.subjectId), {
            descriptorCodes: entry.descriptorCodes || [],
            grade: entry.grade ?? null,
          });
        }
      }
    }
    return map;
  }, [board.studentCards, activeTrimester]);

  function getCellState(studentId: string, subjectId: string): MatrixCellDraft {
    const key = cellKey(studentId, subjectId);
    const dirty = dirtyCells.get(key);
    if (dirty) return dirty;
    const persisted = persistedEntryMap.get(key);
    return {
      studentId,
      subjectId,
      descriptorCodes: persisted ? [...persisted.descriptorCodes] : [],
      grade: persisted ? persisted.grade : null,
    };
  }

  function updateCellDraft(nextCell: MatrixCellDraft) {
    if (readOnly) return;
    const key = cellKey(nextCell.studentId, nextCell.subjectId);
    setDirtyCells((prev) => {
      const next = new Map(prev);
      next.set(key, {
        ...nextCell,
        descriptorCodes: Array.from(new Set(nextCell.descriptorCodes)).sort((a, b) => a - b),
      });
      return next;
    });
  }

  function toggleDescriptorCode(studentId: string, subjectId: string, code: number) {
    if (readOnly) return;
    const current = getCellState(studentId, subjectId);
    const exists = current.descriptorCodes.includes(code);
    const nextCodes = exists
      ? current.descriptorCodes.filter((c) => c !== code)
      : [...current.descriptorCodes, code];
    updateCellDraft({
      ...current,
      descriptorCodes: nextCodes,
    });
  }

  function handleGradeChange(studentId: string, subjectId: string, rawVal: string) {
    if (readOnly) return;
    const current = getCellState(studentId, subjectId);
    const clean = rawVal.trim().replace(",", ".");
    if (!clean) {
      updateCellDraft({ ...current, grade: null });
      return;
    }
    const num = Number.parseFloat(clean);
    if (!Number.isFinite(num)) return;
    updateCellDraft({
      ...current,
      grade: Math.max(0, Math.min(100, num)),
    });
  }

  function handleFillEmptyWithOne(subjectId: string) {
    if (readOnly) return;
    setDirtyCells((prev) => {
      const next = new Map(prev);
      for (const card of filteredCards) {
        if (card.enrollmentStatus !== "ATIVO") continue;
        const key = cellKey(card.studentId, subjectId);
        const existing = next.get(key) || persistedEntryMap.get(key);
        if (!existing || existing.descriptorCodes.length === 0) {
          next.set(key, {
            studentId: card.studentId,
            subjectId,
            descriptorCodes: [1],
            grade: existing?.grade ?? null,
          });
        }
      }
      return next;
    });
  }

  const filteredCards = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return board.studentCards.filter((card) => {
      if (q) {
        const matchName = card.student.name.toLowerCase().includes(q);
        const matchCgm = (card.student.cgm || "").toLowerCase().includes(q);
        if (!matchName && !matchCgm) return false;
      }

      if (filterMode === "ALERTS") {
        return activeSubjects.some((subj) => {
          const state = getCellState(card.studentId, subj.id);
          return state.descriptorCodes.some((c) => c === 2 || c === 3 || c === 4);
        });
      }

      if (filterMode === "BELOW_AVG") {
        const persistedBelow = getCardBelowAvgForTrimester(card, activeTrimester).length > 0;
        const matrixBelow = activeSubjects.some((subj) => {
          const state = getCellState(card.studentId, subj.id);
          return isBelowAverageGradeUi(state.grade);
        });
        return persistedBelow || matrixBelow;
      }

      return true;
    });
  }, [board.studentCards, searchTerm, filterMode, activeSubjects, activeTrimester, dirtyCells, persistedEntryMap]);

  async function handleSaveMatrix() {
    if (readOnly || dirtyCells.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/conselho-classe/${board.id}/matrix`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: activeTrimester,
          entries: Array.from(dirtyCells.values()),
        }),
      });
      const data: { success?: boolean; updatedCount?: number; error?: string } = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Não foi possível salvar a matriz do trimestre.", "error");
        return;
      }
      setDirtyCells(new Map());
      await onMatrixSaved();
      onNotify("Matriz atualizada.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar a matriz.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (activeSubjects.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
          Nenhum componente curricular cadastrado para esta turma.
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={onOpenSubjectsModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer"
          >
            <span>Cadastrar ou importar componentes</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Legenda dos Descritivos 1..5 */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {COUNCIL_DESCRIPTORS.map((d) => (
            <span
              key={d.code}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${d.badgeClass}`}
            >
              <strong className="font-black">{d.code}</strong>
              <span>{d.fullLabel}</span>
            </span>
          ))}
        </div>

        {/* Barra de Filtros e Ação de Salvamento */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Buscar estudante na matriz"
                placeholder="Buscar por estudante ou matrícula..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="inline-flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                aria-label="Filtrar estudantes na matriz"
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as MatrixFilterMode)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
              >
                <option value="ALL">Todos os estudantes ({board.studentCards.length})</option>
                <option value="ALERTS">Com alertas (2, 3, 4)</option>
                <option value="BELOW_AVG">Abaixo da média</option>
              </select>
            </div>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2">
              {dirtyCells.size > 0 && (
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800">
                  {dirtyCells.size} {dirtyCells.size === 1 ? "célula alterada" : "células alteradas"}
                </span>
              )}
              <button
                type="button"
                disabled={saving || dirtyCells.size === 0}
                onClick={handleSaveMatrix}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Salvando..." : "Salvar matriz"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabela Scrollável Acessível com Cabeçalhos Fixos */}
      <div
        tabIndex={0}
        role="region"
        aria-label={`Matriz de descritivos do ${activeTrimester}º Trimestre`}
        className="overflow-auto max-w-full max-h-[70vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs"
      >
        <table className="w-full border-separate border-spacing-0 text-xs">
          <caption className="sr-only">
            Lançamento de descritivos de 1 a 5 por estudante e componente curricular no{" "}
            {activeTrimester}º trimestre
          </caption>
          <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 p-3 text-left font-extrabold text-slate-800 dark:text-slate-100 min-w-[250px]"
              >
                Estudante
              </th>
              {activeSubjects.map((subj) => (
                <th
                  key={subj.id}
                  scope="col"
                  className="border-b border-r border-slate-200 dark:border-slate-700 p-2.5 text-left align-top min-w-[190px] bg-slate-100 dark:bg-slate-800"
                >
                  <div className="space-y-1">
                    <div className="font-extrabold text-slate-900 dark:text-white leading-tight">
                      {subj.name}
                    </div>
                    {subj.teacherName && (
                      <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate">
                        {subj.teacherName}
                      </div>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => handleFillEmptyWithOne(subj.id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100/80 dark:bg-emerald-950/60 hover:bg-emerald-200 dark:hover:bg-emerald-900 text-emerald-900 dark:text-emerald-200 text-[10px] font-bold transition cursor-pointer"
                        title="Preenche com código 1 apenas os estudantes ativos sem descritivo lançado neste componente"
                      >
                        <CheckCheck className="w-3 h-3" />
                        <span>Vazios = 1</span>
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredCards.length === 0 ? (
              <tr>
                <td
                  colSpan={activeSubjects.length + 1}
                  className="p-8 text-center text-xs text-slate-500"
                >
                  Nenhum estudante corresponde ao filtro selecionado.
                </td>
              </tr>
            ) : (
              filteredCards.map((card) => {
                const visibleTags = card.tags.filter((tagValue) => {
                  const meta = tagOptionMap.get(tagValue as never);
                  if (!meta) return false;
                  if (hideSensitiveTags && meta.isSensitiveHealth) return false;
                  return true;
                });

                const attendance = card.student.lowAttendanceRecord?.attendancePercent;

                return (
                  <tr
                    key={card.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-white dark:bg-slate-900 border-b border-r border-slate-200 dark:border-slate-800 p-2.5 text-left align-top font-normal"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <div
                            aria-hidden="true"
                            className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5"
                          >
                            {getStudentInitials(card.student.name)}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="font-bold text-slate-900 dark:text-white leading-snug truncate max-w-[165px]">
                              {card.student.name}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                              {card.student.cgm && <span>CGM {card.student.cgm}</span>}
                              {card.enrollmentStatus !== "ATIVO" && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                                  {COUNCIL_ENROLLMENT_STATUS_LABELS[
                                    card.enrollmentStatus as CouncilEnrollmentStatus
                                  ] || card.enrollmentStatus}
                                </span>
                              )}
                              {attendance !== undefined && attendance !== null && (
                                <span
                                  className={`px-1.5 py-0.5 rounded font-bold ${
                                    attendance < 75
                                      ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                  }`}
                                >
                                  Freq. {attendance.toFixed(1)}%
                                </span>
                              )}
                            </div>
                            {visibleTags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {visibleTags.map((tagVal) => {
                                  const meta = tagOptionMap.get(tagVal as never);
                                  if (!meta) return null;
                                  return (
                                    <span
                                      key={tagVal}
                                      className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${meta.badgeClass}`}
                                    >
                                      {meta.shortLabel}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onOpenStudentModal(card)}
                          aria-label={`Abrir ficha de ${card.student.name}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-sky-950/50 text-[10px] font-bold text-slate-700 dark:text-slate-200 shrink-0 transition cursor-pointer"
                        >
                          <UserRound className="w-3 h-3 text-sky-600" />
                          <span>Ficha</span>
                        </button>
                      </div>
                    </th>

                    {activeSubjects.map((subj) => {
                      const state = getCellState(card.studentId, subj.id);
                      const isDirty = dirtyCells.has(cellKey(card.studentId, subj.id));
                      const gradeIsBelow = isBelowAverageGradeUi(state.grade);

                      return (
                        <td
                          key={subj.id}
                          onKeyDown={(e) => {
                            if (e.target instanceof HTMLInputElement) return;
                            if (e.key >= "1" && e.key <= "5") {
                              e.preventDefault();
                              toggleDescriptorCode(card.studentId, subj.id, Number(e.key));
                            }
                          }}
                          className={`border-b border-r border-slate-200 dark:border-slate-800 p-2 align-top ${
                            isDirty ? "bg-sky-50/70 dark:bg-sky-950/30" : ""
                          }`}
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1">
                              {COUNCIL_DESCRIPTORS.map((d) => {
                                const selected = state.descriptorCodes.includes(d.code);
                                return (
                                  <button
                                    key={d.code}
                                    type="button"
                                    disabled={readOnly}
                                    aria-pressed={selected}
                                    aria-label={`${card.student.name} — ${subj.name} — Descritivo ${d.code}: ${d.fullLabel}`}
                                    onClick={() =>
                                      toggleDescriptorCode(card.studentId, subj.id, d.code)
                                    }
                                    title={`${d.code}: ${d.fullLabel}`}
                                    className={`w-7 h-7 rounded-lg border text-xs font-extrabold transition cursor-pointer disabled:cursor-not-allowed ${
                                      selected
                                        ? d.activeClass
                                        : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    }`}
                                  >
                                    {d.code}
                                  </button>
                                );
                              })}
                            </div>

                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-semibold text-slate-500">
                                Nota:
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.1"
                                disabled={readOnly}
                                aria-label={`Nota de ${card.student.name} em ${subj.name}`}
                                placeholder="—"
                                value={state.grade !== null ? String(state.grade) : ""}
                                onChange={(e) =>
                                  handleGradeChange(card.studentId, subj.id, e.target.value)
                                }
                                className={`w-16 rounded-lg border px-2 py-1 text-[11px] font-bold ${
                                  gradeIsBelow
                                    ? "border-rose-400 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200"
                                    : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                }`}
                              />
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
