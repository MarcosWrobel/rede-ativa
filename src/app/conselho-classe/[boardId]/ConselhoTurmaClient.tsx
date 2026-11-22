"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  FileText,
  LayoutGrid,
  MessageSquareText,
  Presentation,
  Printer,
  Users,
} from "lucide-react";
import CouncilHeaderMetadataCard from "@/components/conselho/CouncilHeaderMetadataCard";
import CouncilSubjectsManagerModal from "@/components/conselho/CouncilSubjectsManagerModal";
import CouncilSerePdfImportModal from "@/components/conselho/CouncilSerePdfImportModal";
import CouncilAnalysisPanel from "@/components/conselho/CouncilAnalysisPanel";
import CouncilPreCouncilTab from "@/components/conselho/CouncilPreCouncilTab";
import CouncilSeatingMapTab from "@/components/conselho/CouncilSeatingMapTab";
import CouncilTrimesterOverviewTab from "@/components/conselho/CouncilTrimesterOverviewTab";
import CouncilPostMeetingTab from "@/components/conselho/CouncilPostMeetingTab";
import CouncilStudentFichaModal from "@/components/conselho/CouncilStudentFichaModal";
import { getPreCouncilProgress, parsePreCouncilData } from "@/components/conselho/preCouncilUtils";
import {
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_SEATING_MAP_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  formatCouncilGradePtBr,
  getCardBelowAvgForTrimester,
  getCardOpinionForTrimester,
  getStudentInitials,
  type CouncilBoardDetailRecord,
  type CouncilEnrollmentStatus,
  type CouncilSeatingMapMode,
  type CouncilSourceBoardOption,
  type CouncilStudentCardRecord,
  type CouncilSubjectRecord,
  type CouncilTrimesterNumber,
  type CouncilTrimesterRecord,
} from "@/components/conselho/types";

type ActiveTabKey = "hub" | "analysis" | "pre-council" | "seating-map" | "students" | "overview" | "post-council";

interface ConselhoTurmaClientProps {
  initialBoard: CouncilBoardDetailRecord;
  availableSourceBoards: CouncilSourceBoardOption[];
  canEdit: boolean;
  currentUserName?: string;
  initialTrimester?: CouncilTrimesterNumber;
}

export default function ConselhoTurmaClient({
  initialBoard,
  availableSourceBoards,
  canEdit,
  currentUserName = "",
  initialTrimester = 1,
}: ConselhoTurmaClientProps) {
  const entryTrimester: CouncilTrimesterNumber = initialTrimester;
  const [board, setBoard] = useState<CouncilBoardDetailRecord>(initialBoard);
  const [activeTrimester, setActiveTrimester] = useState<CouncilTrimesterNumber>(entryTrimester);
  const [activeTab, setActiveTab] = useState<ActiveTabKey>("hub");
  const [hideSensitiveTags, setHideSensitiveTags] = useState(false);
  const [isSubjectsModalOpen, setIsSubjectsModalOpen] = useState(false);
  const [isPdfImportModalOpen, setIsPdfImportModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [presentationRequestNonce, setPresentationRequestNonce] = useState(0);
  const [projectorRequestNonce, setProjectorRequestNonce] = useState(0);
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

  async function refreshBoard() {
    try {
      const res = await fetch(`/api/conselho-classe/${board.id}`);
      const data: { success?: boolean; board?: CouncilBoardDetailRecord } = await res.json();
      if (res.ok && data.board) {
        setBoard(data.board);
      }
    } catch {
      // Mantém estado atual em falha silenciosa de recarga
    }
  }

  function handleSubjectsUpdated(subjects: CouncilSubjectRecord[]) {
    setBoard((prev) => ({ ...prev, subjects }));
  }

  function handleTrimesterUpdated(updatedTrimester: CouncilTrimesterRecord) {
    setBoard((prev) => {
      const exists = prev.trimesters.some((t) => t.trimester === updatedTrimester.trimester);
      const nextTrimesters = exists
        ? prev.trimesters.map((t) =>
            t.trimester === updatedTrimester.trimester ? updatedTrimester : t
          )
        : [...prev.trimesters, updatedTrimester].sort((a, b) => a.trimester - b.trimester);
      return { ...prev, trimesters: nextTrimesters };
    });
  }

  function handleCardUpdated(updatedCard: CouncilStudentCardRecord) {
    setBoard((prev) => ({
      ...prev,
      studentCards: prev.studentCards.map((c) =>
        c.studentId === updatedCard.studentId ? { ...c, ...updatedCard } : c
      ),
    }));
  }

  const activeTrimesterRecord = useMemo(
    () => board.trimesters.find((t) => t.trimester === activeTrimester) || null,
    [board.trimesters, activeTrimester]
  );

  const preCouncilProgress = useMemo(() => {
    const parsed = parsePreCouncilData(activeTrimesterRecord?.preCouncilJson);
    if (!parsed) return null;
    const summary = getPreCouncilProgress(parsed);
    return { completed: summary.completed, total: summary.total };
  }, [activeTrimesterRecord]);

  const editingCard = useMemo(
    () => board.studentCards.find((c) => c.studentId === editingCardId) || null,
    [board.studentCards, editingCardId]
  );

  const tagOptionMap = useMemo(
    () => new Map(COUNCIL_STUDENT_TAG_OPTIONS.map((t) => [t.value, t])),
    []
  );

  const hubCards: Array<{
    key: Exclude<ActiveTabKey, "hub">;
    title: string;
    metric: string;
    icon: typeof ClipboardCheck;
    accentClass: string;
  }> = [
    {
      key: "analysis",
      title: "Painel de Análise",
      metric: `${board.studentCards.filter((c) => c.enrollmentStatus === "ATIVO").length} estudantes ativos`,
      icon: Presentation,
      accentClass: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    },
    {
      key: "pre-council",
      title: "Pré-Conselho",
      metric:
        preCouncilProgress && preCouncilProgress.total > 0
          ? `${preCouncilProgress.completed}/${preCouncilProgress.total} conversas`
          : `${board.subjects.filter((s) => s.active).length} componentes`,
      icon: ClipboardCheck,
      accentClass: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
    },
    {
      key: "seating-map",
      title: "Mapa de Sala",
      metric:
        COUNCIL_SEATING_MAP_LABELS[board.seatingMapMode as CouncilSeatingMapMode] ||
        "A configurar",
      icon: LayoutGrid,
      accentClass: "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    },
    {
      key: "students",
      title: "Fichas dos Estudantes",
      metric: `${board.studentCards.length} fichas`,
      icon: Users,
      accentClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    },
    {
      key: "overview",
      title: "Observações da Turma",
      metric:
        activeTrimesterRecord?.positivePoints || activeTrimesterRecord?.attentionPoints
          ? "Preenchido"
          : "Em aberto",
      icon: FileText,
      accentClass: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    },
    {
      key: "post-council",
      title: "Reunião de Pós-Conselho",
      metric: activeTrimesterRecord?.status === "CONSOLIDATED" ? "Consolidado" : "Em aberto",
      icon: MessageSquareText,
      accentClass: "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {activeTab === "hub" ? (
          <Link
            href="/conselho-classe"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Todas as turmas</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setActiveTab("hub")}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:text-sky-900 dark:hover:text-sky-200 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Painel da turma</span>
          </button>
        )}

        {/* Seletor de Trimestre */}
        <div className="flex flex-wrap items-center gap-2">
          {activeTrimester !== entryTrimester && (
            <div
              role="status"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-900 dark:text-amber-200"
            >
              <span>Acessado pelo {entryTrimester}º Trim.</span>
              <button
                type="button"
                onClick={() => setActiveTrimester(entryTrimester)}
                className="underline hover:no-underline text-amber-800 dark:text-amber-100 cursor-pointer"
              >
                Voltar ao {entryTrimester}º
              </button>
            </div>
          )}

          <div
            role="group"
            aria-label="Selecionar trimestre"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800"
          >
            {([1, 2, 3] as const).map((tri) => {
              const triRec = board.trimesters.find((t) => t.trimester === tri);
              const selected = activeTrimester === tri;
              const isEntry = entryTrimester === tri;
              const consolidated = triRec?.status === "CONSOLIDATED";
              return (
                <button
                  key={tri}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveTrimester(tri)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    selected
                      ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <span>{tri}º Trimestre</span>
                  {isEntry && (
                    <span
                      title="Trimestre de acesso"
                      className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200 text-[9px] font-extrabold"
                    >
                      Acesso
                    </span>
                  )}
                  {consolidated && <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 px-4 py-2.5 text-xs font-semibold text-sky-900 dark:text-sky-200">
          Visualização somente leitura para o perfil atual da rede.
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

      <CouncilHeaderMetadataCard
        board={board}
        activeTrimester={activeTrimester}
        hideSensitiveTags={hideSensitiveTags}
        onToggleHideSensitiveTags={() => setHideSensitiveTags((prev) => !prev)}
        onOpenSubjectsModal={() => setIsSubjectsModalOpen(true)}
        onOpenPdfImportModal={() => setIsPdfImportModalOpen(true)}
        onOpenSeatingMap={() => setActiveTab("seating-map")}
        showConfigMenu={activeTab === "hub"}
        showPrintButton={activeTab === "hub"}
        showSensitiveToggleButton={
          activeTab === "analysis" ||
          activeTab === "students" ||
          activeTab === "seating-map" ||
          activeTab === "pre-council"
        }
        onStartPresentation={
          activeTab === "analysis"
            ? () => setPresentationRequestNonce((n) => n + 1)
            : undefined
        }
        onEnterProjectorMode={
          activeTab === "analysis"
            ? () => setProjectorRequestNonce((n) => n + 1)
            : undefined
        }
        presentationDisabled={board.studentCards.length === 0}
        onBoardUpdated={setBoard}
        onNotify={notify}
        readOnly={!canEdit}
      />

      {/* HUB Inicial ou Seção Ativa */}
      {activeTab === "hub" ? (
        <section
          aria-label="Seções do conselho de classe"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          {hubCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => setActiveTab(card.key)}
                className="group text-left bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-sky-400 dark:hover:border-sky-600 p-4 shadow-xs transition cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.accentClass}`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-black text-slate-900 dark:text-white truncate">
                      {card.title}
                    </h2>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                      {card.metric}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-sky-600 transition shrink-0" />
              </button>
            );
          })}
        </section>
      ) : (
      <div className="mt-0">
        {activeTab === "analysis" && (
          <CouncilAnalysisPanel
            board={board}
            activeTrimester={activeTrimester}
            onChangeTrimester={setActiveTrimester}
            hideSensitiveTags={hideSensitiveTags}
            onToggleHideSensitiveTags={() => setHideSensitiveTags((prev) => !prev)}
            onOpenStudentModal={(card) => setEditingCardId(card.studentId)}
            onOpenSubjectsModal={() => setIsSubjectsModalOpen(true)}
            onCardUpdated={handleCardUpdated}
            onMatrixSaved={refreshBoard}
            onNotify={notify}
            readOnly={!canEdit}
            hideTopActionBar={true}
            presentationRequestNonce={presentationRequestNonce}
            projectorRequestNonce={projectorRequestNonce}
          />
        )}

        {activeTab === "pre-council" && (
          <CouncilPreCouncilTab
            board={board}
            activeTrimester={activeTrimester}
            trimesterRecord={activeTrimesterRecord}
            currentUserName={currentUserName}
            hideSensitiveTags={hideSensitiveTags}
            onOpenStudentModal={(card) => setEditingCardId(card.studentId)}
            onOpenSubjectsModal={() => setIsSubjectsModalOpen(true)}
            onTrimesterUpdated={handleTrimesterUpdated}
            onMatrixSaved={refreshBoard}
            onNotify={notify}
            readOnly={!canEdit}
          />
        )}

        {activeTab === "seating-map" && (
          <CouncilSeatingMapTab
            board={board}
            activeTrimester={activeTrimester}
            hideSensitiveTags={hideSensitiveTags}
            onBoardUpdated={setBoard}
            onNotify={notify}
            readOnly={!canEdit}
          />
        )}

        {activeTab === "students" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {board.studentCards.map((card) => {
              const visibleTags = card.tags.filter((tagValue) => {
                const meta = tagOptionMap.get(tagValue as never);
                if (!meta) return false;
                if (hideSensitiveTags && meta.isSensitiveHealth) return false;
                return true;
              });
              const belowAvg = getCardBelowAvgForTrimester(card, activeTrimester);
              const opinion = getCardOpinionForTrimester(card, activeTrimester);

              return (
                <article
                  key={card.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          aria-hidden="true"
                          className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200 font-extrabold text-xs flex items-center justify-center shrink-0"
                        >
                          {getStudentInitials(card.student.name)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {card.student.name}
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            {card.student.cgm ? `CGM ${card.student.cgm} • ` : ""}
                            {COUNCIL_ENROLLMENT_STATUS_LABELS[
                              card.enrollmentStatus as CouncilEnrollmentStatus
                            ] || card.enrollmentStatus}
                          </p>
                        </div>
                      </div>
                    </div>

                    {visibleTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {visibleTags.map((tagVal) => {
                          const meta = tagOptionMap.get(tagVal as never);
                          if (!meta) return null;
                          return (
                            <span
                              key={tagVal}
                              className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${meta.badgeClass}`}
                            >
                              {meta.shortLabel}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {belowAvg.length > 0 && (
                      <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl px-2.5 py-1.5">
                        Abaixo da média ({activeTrimester}º Trim.):{" "}
                        {belowAvg
                          .map((b) =>
                            b.grade !== null
                              ? `${b.subjectName} (${formatCouncilGradePtBr(b.grade)})`
                              : b.subjectName
                          )
                          .join(", ")}
                      </div>
                    )}

                    {opinion && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3">
                        {opinion}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <Link
                      href={`/conselho-classe/${board.id}/imprimir?mode=aluno&studentId=${card.studentId}&trimester=${activeTrimester}${
                        hideSensitiveTags ? "&hideHealthTags=1" : ""
                      }`}
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Imprimir</span>
                    </Link>

                    <button
                      type="button"
                      onClick={() => setEditingCardId(card.studentId)}
                      className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer"
                    >
                      Abrir ficha
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {activeTab === "overview" && (
          <CouncilTrimesterOverviewTab
            boardId={board.id}
            activeTrimester={activeTrimester}
            trimesterRecord={activeTrimesterRecord}
            onTrimesterUpdated={handleTrimesterUpdated}
            onNotify={notify}
            readOnly={!canEdit}
          />
        )}

        {activeTab === "post-council" && (
          <CouncilPostMeetingTab
            boardId={board.id}
            activeTrimester={activeTrimester}
            trimesterRecord={activeTrimesterRecord}
            onTrimesterUpdated={handleTrimesterUpdated}
            onNotify={notify}
            readOnly={!canEdit}
          />
        )}
      </div>
      )}

      <CouncilSubjectsManagerModal
        open={isSubjectsModalOpen}
        onClose={() => setIsSubjectsModalOpen(false)}
        boardId={board.id}
        classNameLabel={board.classGroup.name}
        initialSubjects={board.subjects}
        availableSourceBoards={availableSourceBoards}
        onSubjectsUpdated={handleSubjectsUpdated}
        onNotify={notify}
        readOnly={!canEdit}
      />

      {canEdit && (
        <CouncilSerePdfImportModal
          open={isPdfImportModalOpen}
          onClose={() => setIsPdfImportModalOpen(false)}
          boardId={board.id}
          classNameLabel={board.classGroup.name}
          onBoardUpdated={setBoard}
          onNotify={notify}
        />
      )}

      <CouncilStudentFichaModal
        open={Boolean(editingCard)}
        onClose={() => setEditingCardId(null)}
        board={board}
        card={editingCard}
        activeTrimester={activeTrimester}
        hideSensitiveTags={hideSensitiveTags}
        onCardUpdated={handleCardUpdated}
        onNotify={notify}
        readOnly={!canEdit}
      />
    </div>
  );
}
