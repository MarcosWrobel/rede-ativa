"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  FileText,
  Grid3X3,
  Link2,
  MessageSquareText,
  Printer,
  RefreshCw,
  Save,
} from "lucide-react";
import CouncilMatrixGrid from "./CouncilMatrixGrid";
import CouncilTeacherLinkModal from "./CouncilTeacherLinkModal";
import CouncilPreCouncilConversationsView from "./CouncilPreCouncilConversationsView";
import CouncilPreCouncilSynthesisAckView from "./CouncilPreCouncilSynthesisAckView";
import {
  buildCitedStudentsSummary,
  buildInitialPreCouncilData,
  buildPreCouncilStudentAlertsBySubject,
  DEFAULT_PRE_COUNCIL_OBJECTIVE,
  DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
  getDefaultPreCouncilPeriodLabel,
  getMatrixFillStatsBySubject,
  getPreCouncilProgress,
  mergeSubjectsIntoPreCouncilConversations,
  parsePreCouncilData,
} from "./preCouncilUtils";
import type {
  CouncilBoardDetailRecord,
  CouncilStudentCardRecord,
  CouncilTrimesterNumber,
  CouncilTrimesterRecord,
  PreCouncilData,
  PreCouncilSubjectConversation,
} from "./types";

type PreCouncilSubView = "matrix" | "conversations" | "synthesis";

interface CouncilPreCouncilTabProps {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  trimesterRecord: CouncilTrimesterRecord | null;
  currentUserName?: string | null;
  hideSensitiveTags: boolean;
  onOpenStudentModal: (card: CouncilStudentCardRecord) => void;
  onOpenSubjectsModal: () => void;
  onTrimesterUpdated: (updated: CouncilTrimesterRecord) => void;
  onMatrixSaved: () => Promise<void>;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

function resolveInitialPreCouncilData(params: {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  trimesterRecord: CouncilTrimesterRecord | null;
  currentUserName?: string | null;
}): PreCouncilData {
  const parsed = parsePreCouncilData(params.trimesterRecord?.preCouncilJson);
  if (parsed) return parsed;
  return buildInitialPreCouncilData({
    trimester: params.activeTrimester,
    subjects: params.board.subjects,
    responsiblePedagogueName: params.currentUserName || "",
  });
}

function createCustomRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pre-custom-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `pre-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function CouncilPreCouncilTab({
  board,
  activeTrimester,
  trimesterRecord,
  currentUserName = "",
  hideSensitiveTags,
  onOpenStudentModal,
  onOpenSubjectsModal,
  onTrimesterUpdated,
  onMatrixSaved,
  onNotify,
  readOnly = false,
}: CouncilPreCouncilTabProps) {
  const [subView, setSubView] = useState<PreCouncilSubView>("conversations");
  const [draft, setDraft] = useState<PreCouncilData>(() =>
    resolveInitialPreCouncilData({
      board,
      activeTrimester,
      trimesterRecord,
      currentUserName,
    })
  );
  const [baselineSnapshot, setBaselineSnapshot] = useState<string>(() =>
    JSON.stringify(
      resolveInitialPreCouncilData({
        board,
        activeTrimester,
        trimesterRecord,
        currentUserName,
      })
    )
  );
  const [selectedConvId, setSelectedConvId] = useState<string>(
    () =>
      resolveInitialPreCouncilData({
        board,
        activeTrimester,
        trimesterRecord,
        currentUserName,
      }).conversations[0]?.id || ""
  );
  const [savingPreCouncil, setSavingPreCouncil] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [teacherLinkOpen, setTeacherLinkOpen] = useState(false);
  const [teacherLinkSubjectId, setTeacherLinkSubjectId] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (readOnly) return false;
    return JSON.stringify(draft) !== baselineSnapshot;
  }, [draft, baselineSnapshot, readOnly]);

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Reidrata quando troca turma ou trimestre
  useEffect(() => {
    const initial = resolveInitialPreCouncilData({
      board,
      activeTrimester,
      trimesterRecord,
      currentUserName,
    });
    setDraft(initial);
    setBaselineSnapshot(JSON.stringify(initial));
    setSelectedConvId(initial.conversations[0]?.id || "");
  }, [board.id, activeTrimester]);

  // Atualiza dados vindos do servidor sem descartar edições locais pendentes
  useEffect(() => {
    const parsed = parsePreCouncilData(trimesterRecord?.preCouncilJson);
    if (!parsed) return;

    if (!isDirtyRef.current) {
      setDraft(parsed);
      setBaselineSnapshot(JSON.stringify(parsed));
      setSelectedConvId((curr) =>
        curr && parsed.conversations.some((c) => c.id === curr)
          ? curr
          : parsed.conversations[0]?.id || ""
      );
      return;
    }

    // Mescla envios docentes verificados pelo servidor (incluindo observações e estudantes em acompanhamento)
    const serverById = new Map(parsed.conversations.map((c) => [c.id, c]));
    setDraft((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => {
        const srv = serverById.get(c.id);
        if (!srv) return c;
        const serverSubmittedNewer =
          Boolean(srv.teacherSubmittedAt) &&
          srv.teacherSubmittedAt !== c.teacherSubmittedAt;
        return {
          ...c,
          teacherName: c.teacherName.trim() ? c.teacherName : srv.teacherName,
          teacherEmail: c.teacherEmail || srv.teacherEmail,
          monitoredStudentIds:
            serverSubmittedNewer || c.monitoredStudentIds.length === 0
              ? srv.monitoredStudentIds
              : c.monitoredStudentIds,
          monitoredStudentsNotes:
            serverSubmittedNewer || !c.monitoredStudentsNotes.trim()
              ? srv.monitoredStudentsNotes
              : c.monitoredStudentsNotes,
          teacherSubmittedAt: srv.teacherSubmittedAt ?? c.teacherSubmittedAt ?? null,
          digitalAckEmail: srv.digitalAckEmail ?? c.digitalAckEmail,
          digitalAckName: srv.digitalAckName ?? c.digitalAckName,
          digitalAckAt: srv.digitalAckAt ?? c.digitalAckAt,
        };
      }),
    }));
  }, [trimesterRecord?.preCouncilJson]);

  const progress = useMemo(() => getPreCouncilProgress(draft), [draft]);

  const alertsBundle = useMemo(
    () => buildPreCouncilStudentAlertsBySubject(board, activeTrimester),
    [board, activeTrimester]
  );

  const citedSummary = useMemo(
    () => buildCitedStudentsSummary(draft.conversations, board.studentCards),
    [draft.conversations, board.studentCards]
  );

  const matrixStatsBySubjectId = useMemo(
    () => getMatrixFillStatsBySubject(board, activeTrimester),
    [board, activeTrimester]
  );

  const matrixSubjectsCompletedCount = useMemo(() => {
    const activeSubjects = board.subjects.filter((s) => s.active);
    return activeSubjects.filter((s) => {
      const st = matrixStatsBySubjectId[s.id];
      return st && st.totalActiveCount > 0 && st.filledCount === st.totalActiveCount;
    }).length;
  }, [board.subjects, matrixStatsBySubjectId]);

  const activeSubjectsTotal = useMemo(
    () => board.subjects.filter((s) => s.active).length,
    [board.subjects]
  );

  function handleOpenConversationForSubject(subjectId: string) {
    const subj = board.subjects.find((s) => s.id === subjectId);
    const matchedConv =
      draft.conversations.find((c) => c.subjectId === subjectId) ||
      (subj
        ? draft.conversations.find(
            (c) => c.subjectName.trim().toLowerCase() === subj.name.trim().toLowerCase()
          )
        : undefined);

    if (matchedConv) {
      setSelectedConvId(matchedConv.id);
    } else if (subj) {
      const merged = mergeSubjectsIntoPreCouncilConversations(draft.conversations, [subj]);
      setDraft((prev) => ({ ...prev, conversations: merged.conversations }));
      const added = merged.conversations.find((c) => c.subjectId === subjectId);
      if (added) setSelectedConvId(added.id);
    }
    setSubView("conversations");
  }

  function handleSyncSubjects() {
    if (readOnly) return;
    const merged = mergeSubjectsIntoPreCouncilConversations(draft.conversations, board.subjects);
    if (merged.addedCount === 0) {
      onNotify("Todos os componentes ativos da turma já estão listados.", "success");
      return;
    }
    setDraft((prev) => ({
      ...prev,
      conversations: merged.conversations,
    }));
    onNotify(`${merged.addedCount} componente(s) adicionado(s) ao Pré-Conselho.`, "success");
  }

  function handleAddCustomRow() {
    if (readOnly) return;
    const newId = createCustomRowId();
    const newRow: PreCouncilSubjectConversation = {
      id: newId,
      subjectId: null,
      subjectName: "",
      teacherName: "",
      teacherEmail: null,
      monitoredStudentIds: [],
      monitoredStudentsNotes: "",
      agreements: "",
      conversationStatus: "PENDING",
      conversationDate: null,
      teacherSubmittedAt: null,
      digitalAckEmail: null,
      digitalAckName: null,
      digitalAckAt: null,
    };
    setDraft((prev) => ({
      ...prev,
      conversations: [...prev.conversations, newRow],
    }));
    setSelectedConvId(newId);
    setSubView("conversations");
  }

  function handleRemoveConversation(convId: string) {
    if (readOnly) return;
    const remaining = draft.conversations.filter((c) => c.id !== convId);
    setDraft((prev) => ({
      ...prev,
      conversations: remaining,
    }));
    if (selectedConvId === convId) {
      setSelectedConvId(remaining[0]?.id || "");
    }
  }

  async function handleSavePreCouncil() {
    if (readOnly) return;

    const emptyNameRow = draft.conversations.find((c) => !c.subjectName.trim());
    if (emptyNameRow) {
      setSubView("conversations");
      setSelectedConvId(emptyNameRow.id);
      onNotify("Informe o nome do componente curricular em todas as linhas.", "error");
      return;
    }

    setSavingPreCouncil(true);
    try {
      const payloadToSend = {
        version: 1 as const,
        periodLabel:
          draft.periodLabel.trim() || getDefaultPreCouncilPeriodLabel(activeTrimester),
        objectiveText: draft.objectiveText.trim() || DEFAULT_PRE_COUNCIL_OBJECTIVE,
        responsiblePedagogueName: draft.responsiblePedagogueName.trim(),
        responsiblePedagogueRole:
          draft.responsiblePedagogueRole.trim() || DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
        conversations: draft.conversations.map((c) => ({
          id: c.id,
          subjectId: c.subjectId || null,
          subjectName: c.subjectName.trim(),
          teacherName: c.teacherName.trim(),
          teacherEmail: c.teacherEmail?.trim() || null,
          monitoredStudentIds: Array.from(new Set(c.monitoredStudentIds)),
          monitoredStudentsNotes: c.monitoredStudentsNotes.trim(),
          agreements: c.agreements.trim(),
          conversationStatus: c.conversationStatus,
          conversationDate: c.conversationDate?.trim() || null,
          teacherSubmittedAt: c.teacherSubmittedAt ?? null,
        })),
        synthesis: {
          mainDifficulties: draft.synthesis.mainDifficulties.trim(),
          priorityStudents: draft.synthesis.priorityStudents.trim(),
          attendanceIssues: draft.synthesis.attendanceIssues.trim(),
          behaviorIssues: draft.synthesis.behaviorIssues.trim(),
          pedagogicalActions: draft.synthesis.pedagogicalActions.trim(),
        },
      };

      const res = await fetch(`/api/conselho-classe/${board.id}/trimesters`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: activeTrimester,
          preCouncil: payloadToSend,
        }),
      });
      const data: {
        success?: boolean;
        trimesterRecord?: CouncilTrimesterRecord;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.trimesterRecord) {
        onNotify(data.error || "Não foi possível salvar o Pré-Conselho.", "error");
        return;
      }

      onTrimesterUpdated(data.trimesterRecord);
      const savedParsed = parsePreCouncilData(data.trimesterRecord.preCouncilJson);
      if (savedParsed) {
        setDraft(savedParsed);
        setBaselineSnapshot(JSON.stringify(savedParsed));
      }
      onNotify("Pré-Conselho salvo.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar o Pré-Conselho.", "error");
    } finally {
      setSavingPreCouncil(false);
    }
  }

  async function handleRefreshAll() {
    if (syncingAll) return;
    setSyncingAll(true);
    try {
      await onMatrixSaved();
      onNotify("Dados do Pré-Conselho sincronizados.", "success");
    } finally {
      setSyncingAll(false);
    }
  }

  function handleOpenUnifiedLink(subjectId: string | null) {
    setTeacherLinkSubjectId(subjectId);
    setTeacherLinkOpen(true);
  }

  const subViewItems: Array<{
    key: PreCouncilSubView;
    label: string;
    icon: typeof Grid3X3;
  }> = [
    {
      key: "conversations",
      label: `Conversas (${progress.completed}/${progress.total})`,
      icon: MessageSquareText,
    },
    {
      key: "synthesis",
      label: `Síntese (${progress.acknowledged}/${progress.total})`,
      icon: FileText,
    },
    { key: "matrix", label: "Matriz", icon: Grid3X3 },
  ];

  return (
    <div className="space-y-4">
      {/* Barra Consolidada do Pré-Conselho */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-black text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                <ClipboardCheck className="w-4 h-4 text-sky-600" />
                <span>Pré-Conselho de Classe — {activeTrimester}º Trimestre</span>
              </h2>
              {isDirty && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-[10px] font-bold text-amber-900 dark:text-amber-200">
                  Alterações não salvas
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Matriz preenchida:{" "}
                <strong className="text-slate-900 dark:text-slate-100">
                  {matrixSubjectsCompletedCount}/{activeSubjectsTotal} comp.
                </strong>
              </span>
              <span>
                Conversas realizadas:{" "}
                <strong className="text-slate-900 dark:text-slate-100">
                  {progress.completed}/{progress.total}
                </strong>
              </span>
              <span>
                Ciências digitais:{" "}
                <strong className="text-emerald-700 dark:text-emerald-300">
                  {progress.acknowledged}/{progress.total}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={syncingAll}
              onClick={() => void handleRefreshAll()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? "animate-spin" : ""}`} />
              <span>{syncingAll ? "Sincronizando..." : "Sincronizar"}</span>
            </button>

            {!readOnly && (
              <button
                type="button"
                onClick={() => handleOpenUnifiedLink(null)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-xs font-bold text-indigo-900 dark:text-indigo-200 transition cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Link do Pré-Conselho</span>
              </button>
            )}

            <Link
              href={`/conselho-classe/${board.id}/imprimir?mode=pre-conselho&trimester=${activeTrimester}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-100 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir A4</span>
            </Link>
          </div>
        </div>

        {/* Sub-visões do Pré-Conselho */}
        <div
          role="tablist"
          aria-label="Etapas do Pré-Conselho"
          className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800"
        >
          {subViewItems.map((item) => {
            const Icon = item.icon;
            const selected = subView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSubView(item.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  selected
                    ? "bg-slate-900 text-white dark:bg-sky-600 shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-visão 1: Matriz Geral */}
      {subView === "matrix" && (
        <CouncilMatrixGrid
          board={board}
          activeTrimester={activeTrimester}
          hideSensitiveTags={hideSensitiveTags}
          onOpenStudentModal={onOpenStudentModal}
          onOpenSubjectsModal={onOpenSubjectsModal}
          onMatrixSaved={onMatrixSaved}
          onNotify={onNotify}
          readOnly={readOnly}
          preCouncilData={draft}
          onOpenConversation={handleOpenConversationForSubject}
          onOpenUnifiedTeacherLink={handleOpenUnifiedLink}
        />
      )}

      {/* Sub-visão 2: Conversas por Componente */}
      {subView === "conversations" && (
        <CouncilPreCouncilConversationsView
          board={board}
          activeTrimester={activeTrimester}
          draft={draft}
          selectedConvId={selectedConvId}
          onSelectConvId={setSelectedConvId}
          onUpdateDraft={setDraft}
          onSyncSubjects={handleSyncSubjects}
          onAddCustomRow={handleAddCustomRow}
          onRemoveConversation={handleRemoveConversation}
          onOpenUnifiedTeacherLink={handleOpenUnifiedLink}
          onMatrixSaved={onMatrixSaved}
          onNotify={onNotify}
          alertsBundle={alertsBundle}
          matrixStatsBySubjectId={matrixStatsBySubjectId}
          hideSensitiveTags={hideSensitiveTags}
          readOnly={readOnly}
        />
      )}

      {/* Sub-visão 3: Síntese e Ciência */}
      {subView === "synthesis" && (
        <CouncilPreCouncilSynthesisAckView
          draft={draft}
          onUpdateDraft={setDraft}
          citedSummary={citedSummary}
          alertsBundle={alertsBundle}
          matrixStatsBySubjectId={matrixStatsBySubjectId}
          onOpenUnifiedTeacherLink={handleOpenUnifiedLink}
          readOnly={readOnly}
        />
      )}

      {!readOnly && subView !== "matrix" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          {isDirty && (
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
              Há alterações não salvas
            </span>
          )}
          <button
            type="button"
            disabled={savingPreCouncil}
            onClick={() => void handleSavePreCouncil()}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savingPreCouncil ? "Salvando..." : "Salvar pré-conselho"}</span>
          </button>
        </div>
      )}

      {!readOnly && (
        <CouncilTeacherLinkModal
          open={teacherLinkOpen}
          onClose={() => setTeacherLinkOpen(false)}
          boardId={board.id}
          classNameLabel={board.classGroup.name}
          activeTrimester={activeTrimester}
          subjects={board.subjects}
          initialSubjectId={teacherLinkSubjectId}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
