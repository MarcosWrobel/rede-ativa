"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Eye,
  EyeOff,
  Minus,
  Save,
  UserRound,
  X,
} from "lucide-react";
import {
  COUNCIL_DESCRIPTORS,
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  formatCouncilGradePtBr,
  getCardBelowAvgForTrimester,
  getStudentInitials,
  type CouncilBoardDetailRecord,
  type CouncilEnrollmentStatus,
  type CouncilStudentCardRecord,
  type CouncilStudentTag,
  type CouncilTrimesterNumber,
} from "./types";
import {
  sortStudentCellsByCriticality,
  type StudentAnalyticsSummary,
  type StudentPriorityLevel,
} from "./councilAnalytics";

interface CouncilStudentFocusModalProps {
  open: boolean;
  onClose: () => void;
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  students: StudentAnalyticsSummary[];
  currentIndex: number;
  onSelectIndex: (nextIndex: number) => void;
  hideSensitiveTags: boolean;
  onToggleHideSensitiveTags: () => void;
  onOpenFullFicha: (card: CouncilStudentCardRecord) => void;
  onCardUpdated: (updatedCard: CouncilStudentCardRecord) => void;
  onMatrixSaved: () => Promise<void>;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

type PendingNavigationAction =
  | { type: "close" }
  | { type: "index"; targetIndex: number };

const PRIORITY_BADGE_META: Record<
  StudentPriorityLevel,
  { label: string; className: string }
> = {
  CRITICAL: {
    label: "Prioridade crítica",
    className:
      "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800",
  },
  ATTENTION: {
    label: "Em atenção",
    className:
      "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800",
  },
  REGULAR: {
    label: "Regular",
    className:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800",
  },
};

function arraysEqualSorted(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((val, idx) => val === sb[idx]);
}

function stringSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((item) => setA.has(item));
}

export default function CouncilStudentFocusModal({
  open,
  onClose,
  board,
  activeTrimester,
  students,
  currentIndex,
  onSelectIndex,
  hideSensitiveTags,
  onToggleHideSensitiveTags,
  onOpenFullFicha,
  onCardUpdated,
  onMatrixSaved,
  onNotify,
  readOnly = false,
}: CouncilStudentFocusModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const unsavedNoticeId = useId();

  const safeIndex =
    students.length > 0 ? Math.max(0, Math.min(currentIndex, students.length - 1)) : 0;
  const currentStudent = students[safeIndex] ?? null;

  const [dirtyDescriptors, setDirtyDescriptors] = useState<Map<string, number[]>>(new Map());
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftOpinion, setDraftOpinion] = useState("");
  const [showPrevOpinion, setShowPrevOpinion] = useState(false);
  const [savingDescriptors, setSavingDescriptors] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingNavigationAction | null>(null);

  // Sincroniza o estado local quando o estudante ou trimestre muda
  useEffect(() => {
    if (!currentStudent) return;
    setDirtyDescriptors(new Map());
    setDraftTags(currentStudent.card.tags || []);
    setDraftOpinion(currentStudent.opinion || "");
    setShowPrevOpinion(false);
    setPendingAction(null);
  }, [currentStudent?.studentId, activeTrimester, open]);

  // Controle nativo do <dialog> modal no navegador (protegido contra SSR)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== "function") return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const sortedCells = useMemo(
    () => (currentStudent ? sortStudentCellsByCriticality(currentStudent.subjectCells) : []),
    [currentStudent]
  );

  const hasDirtyDescriptors = dirtyDescriptors.size > 0;
  const hasDirtyProfile = useMemo(() => {
    if (!currentStudent) return false;
    const opinionChanged = draftOpinion.trim() !== (currentStudent.opinion || "").trim();
    const tagsChanged = !stringSetsEqual(draftTags, currentStudent.card.tags || []);
    return opinionChanged || tagsChanged;
  }, [currentStudent, draftOpinion, draftTags]);

  const hasUnsavedChanges = !readOnly && (hasDirtyDescriptors || hasDirtyProfile);

  const visibleTagOptions = useMemo(
    () =>
      COUNCIL_STUDENT_TAG_OPTIONS.filter(
        (opt) => !hideSensitiveTags || !opt.isSensitiveHealth
      ),
    [hideSensitiveTags]
  );

  function requestAction(action: PendingNavigationAction) {
    if (hasUnsavedChanges) {
      setPendingAction(action);
      return;
    }
    executeAction(action);
  }

  function executeAction(action: PendingNavigationAction) {
    setPendingAction(null);
    if (action.type === "close") {
      onClose();
      return;
    }
    onSelectIndex(action.targetIndex);
  }

  // Navegação por teclado (setas esquerda/direita) quando fora de campos editáveis
  useEffect(() => {
    if (!open || !currentStudent) return;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }

      if (e.key === "ArrowLeft" && safeIndex > 0) {
        e.preventDefault();
        requestAction({ type: "index", targetIndex: safeIndex - 1 });
      } else if (e.key === "ArrowRight" && safeIndex < students.length - 1) {
        e.preventDefault();
        requestAction({ type: "index", targetIndex: safeIndex + 1 });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!open || !currentStudent) {
    return null;
  }

  const priorityMeta = PRIORITY_BADGE_META[currentStudent.priority];

  function getDescriptorCodesForSubject(subjectId: string, persistedCodes: number[]): number[] {
    return dirtyDescriptors.get(subjectId) ?? persistedCodes;
  }

  function handleToggleDescriptor(subjectId: string, persistedCodes: number[], code: number) {
    if (readOnly) return;
    const current = getDescriptorCodesForSubject(subjectId, persistedCodes);
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code].sort((a, b) => a - b);

    setDirtyDescriptors((prev) => {
      const updated = new Map(prev);
      if (arraysEqualSorted(next, persistedCodes)) {
        updated.delete(subjectId);
      } else {
        updated.set(subjectId, next);
      }
      return updated;
    });
  }

  function handleToggleTag(tagValue: CouncilStudentTag) {
    if (readOnly) return;
    setDraftTags((prev) =>
      prev.includes(tagValue) ? prev.filter((t) => t !== tagValue) : [...prev, tagValue]
    );
  }

  async function handleSaveDescriptors() {
    if (readOnly || !currentStudent || dirtyDescriptors.size === 0) return;
    setSavingDescriptors(true);
    try {
      const entries = Array.from(dirtyDescriptors.entries()).map(
        ([subjectId, descriptorCodes]) => ({
          studentId: currentStudent.studentId,
          subjectId,
          descriptorCodes,
        })
      );

      const res = await fetch(`/api/conselho-classe/${board.id}/matrix`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: activeTrimester,
          entries,
        }),
      });
      const data: { success?: boolean; error?: string } = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Não foi possível salvar os descritivos.", "error");
        return;
      }

      setDirtyDescriptors(new Map());
      await onMatrixSaved();
      onNotify("Descritivos salvos.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar os descritivos.", "error");
    } finally {
      setSavingDescriptors(false);
    }
  }

  async function handleSaveProfile() {
    if (readOnly || !currentStudent) return;
    setSavingProfile(true);
    try {
      // Preserva tags sensíveis já existentes caso estejam ocultas na tela
      const sensitiveValues = new Set(
        COUNCIL_STUDENT_TAG_OPTIONS.filter((o) => o.isSensitiveHealth).map((o) => o.value)
      );
      const preservedHiddenSensitive = hideSensitiveTags
        ? (currentStudent.card.tags || []).filter((t) => sensitiveValues.has(t as CouncilStudentTag))
        : [];
      const mergedTags = Array.from(
        new Set([
          ...draftTags.filter((t) => !hideSensitiveTags || !sensitiveValues.has(t as CouncilStudentTag)),
          ...preservedHiddenSensitive,
        ])
      );

      const persistedBelow = getCardBelowAvgForTrimester(currentStudent.card, activeTrimester);

      const res = await fetch(
        `/api/conselho-classe/${board.id}/students/${currentStudent.studentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollmentStatus: currentStudent.card.enrollmentStatus,
            externalEvalEd1Percent: currentStudent.card.externalEvalEd1Percent,
            externalEvalEd2Percent: currentStudent.card.externalEvalEd2Percent,
            externalEvalEd3Percent: currentStudent.card.externalEvalEd3Percent,
            tags: mergedTags,
            trimester: activeTrimester,
            qualitativeOpinion: draftOpinion.trim() || null,
            belowAverageSubjects: persistedBelow,
          }),
        }
      );

      const data: {
        success?: boolean;
        card?: CouncilStudentCardRecord;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.card) {
        onNotify(data.error || "Não foi possível salvar parecer e tags.", "error");
        return;
      }

      onCardUpdated(data.card);
      setDraftTags(data.card.tags || []);
      onNotify("Parecer e tags salvos.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar parecer e tags.", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  const prevExists = safeIndex > 0;
  const nextExists = safeIndex < students.length - 1;
  const formattedAvg = formatCouncilGradePtBr(currentStudent.averageGrade);
  const comp = currentStudent.comparison;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestAction({ type: "close" });
      }}
      className="m-auto w-[min(96vw,1380px)] max-w-none h-[min(94vh,920px)] max-h-[94vh] p-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-2xl overscroll-contain backdrop:bg-slate-950/75 backdrop:overscroll-contain backdrop:overflow-hidden"
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* Cabeçalho de navegação do Modo Foco */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              aria-hidden="true"
              className="w-11 h-11 rounded-xl bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200 font-black text-sm flex items-center justify-center shrink-0"
            >
              {getStudentInitials(currentStudent.studentName)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id={titleId}
                  className="text-lg sm:text-xl font-black text-slate-900 dark:text-white truncate"
                >
                  {currentStudent.studentName}
                </h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full border text-xs font-bold ${priorityMeta.className}`}
                >
                  {priorityMeta.label}
                </span>
                {currentStudent.card.enrollmentStatus !== "ATIVO" && (
                  <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold">
                    {COUNCIL_ENROLLMENT_STATUS_LABELS[
                      currentStudent.card.enrollmentStatus as CouncilEnrollmentStatus
                    ] || currentStudent.card.enrollmentStatus}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Estudante {safeIndex + 1} de {students.length}
                </span>
                <span>{board.classGroup.name} • {activeTrimester}º Trimestre</span>
                {currentStudent.card.student.cgm && (
                  <span>CGM {currentStudent.card.student.cgm}</span>
                )}
                {currentStudent.attendancePercent !== null && (
                  <span
                    className={`font-bold ${
                      currentStudent.hasLowAttendance
                        ? "text-rose-700 dark:text-rose-300"
                        : "text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    Frequência {currentStudent.attendancePercent.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5">
              <button
                type="button"
                disabled={!prevExists}
                onClick={() => requestAction({ type: "index", targetIndex: safeIndex - 1 })}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                aria-label="Estudante anterior"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>
              <button
                type="button"
                disabled={!nextExists}
                onClick={() => requestAction({ type: "index", targetIndex: safeIndex + 1 })}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                aria-label="Próximo estudante"
              >
                <span>Próximo</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleHideSensitiveTags}
              aria-pressed={hideSensitiveTags}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                hideSensitiveTags
                  ? "bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200"
                  : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {hideSensitiveTags ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{hideSensitiveTags ? "Exibir laudo e AEE" : "Ocultar laudo e AEE"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullFicha(currentStudent.card);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
            >
              <UserRound className="w-3.5 h-3.5 text-sky-600" />
              <span>Ficha completa</span>
            </button>

            <button
              type="button"
              onClick={() => requestAction({ type: "close" })}
              aria-label="Fechar modo foco"
              className="inline-flex items-center justify-center p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Faixa reservada para confirmação de alterações não salvas (sem deslocar botões) */}
        <div
          id={unsavedNoticeId}
          aria-live="polite"
          className={`px-5 py-2.5 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 ${
            pendingAction ? "visible" : "hidden"
          }`}
        >
          <span className="inline-flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Existem alterações não salvas neste estudante. Deseja descartá-las?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-describedby={unsavedNoticeId}
              onClick={() => {
                if (pendingAction) executeAction(pendingAction);
              }}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold transition cursor-pointer"
            >
              Descartar e continuar
            </button>
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="px-3 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-100 font-bold transition cursor-pointer"
            >
              Continuar editando
            </button>
          </div>
        </div>

        {/* Corpo em 2 colunas */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Coluna Esquerda: Componentes Curriculares ordenados por criticidade */}
          <section
            aria-label="Componentes curriculares do estudante"
            className="lg:col-span-7 flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                Componentes curriculares ({sortedCells.length})
              </h3>
              {!readOnly && (
                <button
                  type="button"
                  disabled={savingDescriptors || !hasDirtyDescriptors}
                  onClick={handleSaveDescriptors}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-45 text-white text-xs font-bold transition cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>
                    {savingDescriptors
                      ? "Salvando..."
                      : hasDirtyDescriptors
                      ? `Salvar descritivos (${dirtyDescriptors.size})`
                      : "Salvar descritivos"}
                  </span>
                </button>
              )}
            </div>

            {sortedCells.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-xs text-slate-500">
                Nenhum componente curricular ativo nesta turma.
              </div>
            ) : (
              <div className="space-y-2.5">
                {sortedCells.map((cell) => {
                  const codes = getDescriptorCodesForSubject(cell.subjectId, cell.descriptorCodes);
                  const isDirty = dirtyDescriptors.has(cell.subjectId);
                  const formattedGrade = formatCouncilGradePtBr(cell.grade);
                  const deltaFormatted =
                    cell.gradeDelta !== null && cell.gradeDelta !== 0
                      ? `${cell.gradeDelta > 0 ? "+" : ""}${formatCouncilGradePtBr(cell.gradeDelta)}`
                      : null;

                  return (
                    <div
                      key={cell.subjectId}
                      className={`rounded-xl border p-3.5 transition ${
                        isDirty
                          ? "border-sky-400 bg-sky-50/70 dark:border-sky-600 dark:bg-sky-950/30"
                          : cell.isBelowAvg
                          ? "border-rose-200 bg-rose-50/50 dark:border-rose-900/80 dark:bg-rose-950/20"
                          : cell.hasAlertDescriptor
                          ? "border-amber-200 bg-amber-50/40 dark:border-amber-900/70 dark:bg-amber-950/20"
                          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                            {cell.subjectName}
                          </div>
                          {cell.teacherName && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {cell.teacherName}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {formattedGrade !== null ? (
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border text-xs font-extrabold ${
                                cell.isBelowAvg
                                  ? "border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
                                  : "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              }`}
                            >
                              Nota {formattedGrade}
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-slate-400">
                              Sem nota
                            </span>
                          )}

                          {deltaFormatted && (
                            <span
                              className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                (cell.gradeDelta ?? 0) > 0
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                  : "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                              }`}
                              title={`Variação em relação ao ${comp?.prevTrimester ?? ""}º trimestre`}
                            >
                              {(cell.gradeDelta ?? 0) > 0 ? (
                                <ArrowUpRight className="w-3 h-3" />
                              ) : (
                                <ArrowDownRight className="w-3 h-3" />
                              )}
                              {deltaFormatted}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {COUNCIL_DESCRIPTORS.map((d) => {
                          const selected = codes.includes(d.code);
                          return (
                            <button
                              key={d.code}
                              type="button"
                              disabled={readOnly}
                              aria-pressed={selected}
                              aria-label={`${currentStudent.studentName} — ${cell.subjectName} — ${d.shortLabel}`}
                              onClick={() =>
                                handleToggleDescriptor(cell.subjectId, cell.descriptorCodes, d.code)
                              }
                              title={d.fullLabel}
                              className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                                selected
                                  ? d.activeClass
                                  : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              }`}
                            >
                              {d.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Coluna Direita: Síntese, Comparativo, Tags e Parecer */}
          <aside className="lg:col-span-5 flex flex-col gap-4">
            {/* Indicadores individuais */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Abaixo da média
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span
                    className={`text-2xl font-black ${
                      currentStudent.belowAvgCount > 0
                        ? "text-rose-700 dark:text-rose-300"
                        : "text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    {currentStudent.belowAvgCount}
                  </span>
                  {comp?.hasPrevData && (
                    <span
                      className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
                        comp.belowAvgDelta < 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : comp.belowAvgDelta > 0
                          ? "text-rose-700 dark:text-rose-300"
                          : "text-slate-500"
                      }`}
                    >
                      {comp.belowAvgDelta < 0 ? (
                        <>
                          <ArrowDownRight className="w-3 h-3" />
                          {Math.abs(comp.belowAvgDelta)} vs {comp.prevTrimester}ºT
                        </>
                      ) : comp.belowAvgDelta > 0 ? (
                        <>
                          <ArrowUpRight className="w-3 h-3" />+{comp.belowAvgDelta} vs{" "}
                          {comp.prevTrimester}ºT
                        </>
                      ) : (
                        <>
                          <Minus className="w-3 h-3" />
                          Igual ao {comp.prevTrimester}ºT
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Média geral
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-slate-900 dark:text-white">
                    {formattedAvg ?? "—"}
                  </span>
                  {comp?.hasPrevData && comp.averageGradeDelta !== null && (
                    <span
                      className={`text-[11px] font-bold ${
                        comp.averageGradeDelta > 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : comp.averageGradeDelta < 0
                          ? "text-rose-700 dark:text-rose-300"
                          : "text-slate-500"
                      }`}
                    >
                      {comp.averageGradeDelta > 0 ? "+" : ""}
                      {formatCouncilGradePtBr(comp.averageGradeDelta)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Avaliações Externas (quando houver) */}
            {(currentStudent.card.externalEvalEd1Percent !== null ||
              currentStudent.card.externalEvalEd2Percent !== null ||
              currentStudent.card.externalEvalEd3Percent !== null) && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2">
                <h4 className="text-xs font-black text-slate-800 dark:text-slate-100">
                  Avaliações externas
                </h4>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "1ª Ed.", value: currentStudent.card.externalEvalEd1Percent },
                    { label: "2ª Ed.", value: currentStudent.card.externalEvalEd2Percent },
                    { label: "3ª Ed.", value: currentStudent.card.externalEvalEd3Percent },
                  ].map((ed) => (
                    <div
                      key={ed.label}
                      className="rounded-lg bg-slate-50 dark:bg-slate-800/70 px-2 py-1.5"
                    >
                      <div className="text-[10px] font-bold text-slate-500">{ed.label}</div>
                      <div className="text-sm font-black text-slate-900 dark:text-white">
                        {ed.value !== null && ed.value !== undefined ? `${ed.value}%` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tags do Estudante (edição ao vivo) */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-black text-slate-800 dark:text-slate-100">
                  Marcações do estudante
                </h4>
                {hideSensitiveTags && (
                  <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Laudo e AEE ocultos
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {visibleTagOptions.map((opt) => {
                  const selected = draftTags.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={selected}
                      onClick={() => handleToggleTag(opt.value)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                        selected
                          ? opt.badgeClass + " ring-2 ring-sky-500/60"
                          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {opt.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Parecer e Encaminhamentos do Trimestre (edição ao vivo) */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 flex-1 flex flex-col">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="focus-student-opinion"
                  className="text-xs font-black text-slate-800 dark:text-slate-100"
                >
                  Parecer do {activeTrimester}º Trimestre
                </label>
                {currentStudent.prevOpinion && comp && (
                  <button
                    type="button"
                    onClick={() => setShowPrevOpinion((prev) => !prev)}
                    className="text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                  >
                    {showPrevOpinion
                      ? `Ocultar parecer do ${comp.prevTrimester}ºT`
                      : `Ver parecer do ${comp.prevTrimester}ºT`}
                  </button>
                )}
              </div>

              {showPrevOpinion && currentStudent.prevOpinion && comp && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <div className="text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                    Parecer anterior ({comp.prevTrimester}º Trimestre)
                  </div>
                  <p className="whitespace-pre-wrap">{currentStudent.prevOpinion}</p>
                </div>
              )}

              <textarea
                id="focus-student-opinion"
                rows={5}
                disabled={readOnly}
                value={draftOpinion}
                onChange={(e) => setDraftOpinion(e.target.value)}
                placeholder="Registrar observações e encaminhamentos deliberados no conselho..."
                className="w-full flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-60"
              />

              {!readOnly && (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    disabled={savingProfile || !hasDirtyProfile}
                    onClick={handleSaveProfile}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-45 text-white text-xs font-bold transition cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingProfile ? "Salvando..." : "Salvar parecer e tags"}</span>
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </dialog>
  );
}
