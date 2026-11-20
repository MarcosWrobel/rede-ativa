"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Filter,
  Grid2X2,
  List,
  Maximize2,
  Minimize2,
  Presentation,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import CouncilStudentFocusModal from "./CouncilStudentFocusModal";
import {
  buildClassCouncilAnalytics,
  filterAndSortStudentAnalytics,
  type AnalysisQuickFilter,
  type AnalysisSortMode,
  type StudentPriorityLevel,
} from "./councilAnalytics";
import {
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  formatCouncilGradePtBr,
  getStudentInitials,
  type CouncilBoardDetailRecord,
  type CouncilEnrollmentStatus,
  type CouncilStudentCardRecord,
  type CouncilTrimesterNumber,
} from "./types";

type ListDisplayMode = "consolidated" | "heatmap";

interface CouncilAnalysisPanelProps {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  onChangeTrimester: (tri: CouncilTrimesterNumber) => void;
  hideSensitiveTags: boolean;
  onToggleHideSensitiveTags: () => void;
  onOpenStudentModal: (card: CouncilStudentCardRecord) => void;
  onOpenSubjectsModal: () => void;
  onCardUpdated: (updatedCard: CouncilStudentCardRecord) => void;
  onMatrixSaved: () => Promise<void>;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
  hideTopActionBar?: boolean;
  presentationRequestNonce?: number;
  projectorRequestNonce?: number;
}

const PRIORITY_STYLES: Record<
  StudentPriorityLevel,
  { label: string; badgeClass: string; stripeClass: string }
> = {
  CRITICAL: {
    label: "Crítico",
    badgeClass:
      "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800",
    stripeClass: "border-l-4 border-l-rose-500",
  },
  ATTENTION: {
    label: "Atenção",
    badgeClass:
      "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800",
    stripeClass: "border-l-4 border-l-amber-500",
  },
  REGULAR: {
    label: "Regular",
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800",
    stripeClass: "border-l-4 border-l-emerald-500",
  },
};

export default function CouncilAnalysisPanel({
  board,
  activeTrimester,
  onChangeTrimester,
  hideSensitiveTags,
  onToggleHideSensitiveTags,
  onOpenStudentModal,
  onOpenSubjectsModal,
  onCardUpdated,
  onMatrixSaved,
  onNotify,
  readOnly = false,
  hideTopActionBar = false,
  presentationRequestNonce = 0,
  projectorRequestNonce = 0,
}: CouncilAnalysisPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [quickFilter, setQuickFilter] = useState<AnalysisQuickFilter>("ALL");
  const [subjectIdFilter, setSubjectIdFilter] = useState("");
  const [sortMode, setSortMode] = useState<AnalysisSortMode>("PRIORITY");
  const [displayMode, setDisplayMode] = useState<ListDisplayMode>("consolidated");
  const [isProjectorMode, setIsProjectorMode] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [showAllSubjectsRanking, setShowAllSubjectsRanking] = useState(false);
  const [focusModalOpen, setFocusModalOpen] = useState(false);
  const [focusStudentId, setFocusStudentId] = useState<string | null>(null);
  const [expandedStudentIds, setExpandedStudentIds] = useState<Record<string, boolean>>({});

  const projectorContainerRef = useRef<HTMLDivElement | null>(null);
  const heatmapCaptionId = useId();
  const lastPresentationNonceRef = useRef(presentationRequestNonce);
  const lastProjectorNonceRef = useRef(projectorRequestNonce);

  const analytics = useMemo(
    () => buildClassCouncilAnalytics(board, activeTrimester),
    [board, activeTrimester]
  );

  const activeSubjects = useMemo(
    () => board.subjects.filter((s) => s.active),
    [board.subjects]
  );

  const tagOptionMap = useMemo(
    () => new Map(COUNCIL_STUDENT_TAG_OPTIONS.map((t) => [t.value, t])),
    []
  );

  const visibleStudents = useMemo(
    () =>
      filterAndSortStudentAnalytics(analytics.students, {
        searchTerm,
        quickFilter,
        subjectIdFilter,
        sortMode,
      }),
    [analytics.students, searchTerm, quickFilter, subjectIdFilter, sortMode]
  );

  const focusIndex = useMemo(() => {
    if (!focusStudentId) return 0;
    const idx = visibleStudents.findIndex((s) => s.studentId === focusStudentId);
    return idx >= 0 ? idx : 0;
  }, [visibleStudents, focusStudentId]);

  // Sincroniza saída do Modo Telão quando o usuário sai do fullscreen nativo via Esc
  useEffect(() => {
    if (typeof document === "undefined") return;
    function handleFullscreenChange() {
      if (!document.fullscreenElement && isProjectorMode) {
        // Mantém o usuário no controle sem forçar saída abrupta caso o navegador tenha bloqueado fullscreen
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [isProjectorMode]);

  function enterProjectorMode() {
    setIsProjectorMode(true);
    if (typeof document !== "undefined" && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {
        // Fallback silencioso: overlay fixo em tela cheia já está ativo
      });
    }
  }

  function exitProjectorMode() {
    setIsProjectorMode(false);
    if (typeof document !== "undefined" && document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {
        // Ignora erro caso já tenha saído do fullscreen
      });
    }
  }

  function toggleQuickFilter(next: AnalysisQuickFilter) {
    setQuickFilter((prev) => (prev === next ? "ALL" : next));
  }

  function openFocusForStudent(studentId: string) {
    setFocusStudentId(studentId);
    setFocusModalOpen(true);
  }

  function openFocusFromTop() {
    if (visibleStudents.length === 0) return;
    setFocusStudentId(visibleStudents[0].studentId);
    setFocusModalOpen(true);
  }

  function clearAllFilters() {
    setSearchTerm("");
    setQuickFilter("ALL");
    setSubjectIdFilter("");
  }

  function toggleStudentExpanded(studentId: string) {
    setExpandedStudentIds((prev) => ({
      ...prev,
      [studentId]: !prev[studentId],
    }));
  }

  useEffect(() => {
    if (presentationRequestNonce !== lastPresentationNonceRef.current) {
      lastPresentationNonceRef.current = presentationRequestNonce;
      if (visibleStudents.length > 0) {
        setFocusStudentId(visibleStudents[0].studentId);
        setFocusModalOpen(true);
      }
    }
  }, [presentationRequestNonce, visibleStudents]);

  useEffect(() => {
    if (projectorRequestNonce !== lastProjectorNonceRef.current) {
      lastProjectorNonceRef.current = projectorRequestNonce;
      enterProjectorMode();
    }
  }, [projectorRequestNonce]);

  const hasActiveFilters =
    searchTerm.trim().length > 0 || quickFilter !== "ALL" || subjectIdFilter !== "";

  const rankedSubjects = useMemo(() => {
    const withAttention = analytics.subjects.filter(
      (s) => s.belowAvgCount > 0 || s.difficultyCount > 0 || s.conductCount > 0 || s.infrequencyCount > 0
    );
    const base = withAttention.length > 0 ? withAttention : analytics.subjects;
    return showAllSubjectsRanking ? base : base.slice(0, 6);
  }, [analytics.subjects, showAllSubjectsRanking]);

  const totalSubjectsWithAttention = useMemo(
    () =>
      analytics.subjects.filter(
        (s) => s.belowAvgCount > 0 || s.difficultyCount > 0 || s.conductCount > 0 || s.infrequencyCount > 0
      ).length,
    [analytics.subjects]
  );

  const selectedSubjectMeta = useMemo(
    () => activeSubjects.find((s) => s.id === subjectIdFilter) || null,
    [activeSubjects, subjectIdFilter]
  );

  if (board.studentCards.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
          Nenhum estudante vinculado a este conselho.
        </p>
      </div>
    );
  }

  const containerClass = isProjectorMode
    ? "fixed inset-0 z-50 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 space-y-5"
    : "space-y-4";

  return (
    <div ref={projectorContainerRef} className={containerClass}>
      {/* Barra dedicada do Modo Telão */}
      {isProjectorMode && (
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Conselho de Classe — {board.classGroup.name} ({board.year})
            </h2>
            <div
              role="group"
              aria-label="Selecionar trimestre no modo telão"
              className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800"
            >
              {([1, 2, 3] as const).map((tri) => (
                <button
                  key={tri}
                  type="button"
                  aria-pressed={activeTrimester === tri}
                  onClick={() => onChangeTrimester(tri)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeTrimester === tri
                      ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {tri}º Trimestre
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowOverview((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              {showOverview ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>{showOverview ? "Ocultar panorama" : "Mostrar panorama"}</span>
            </button>

            <button
              type="button"
              onClick={onToggleHideSensitiveTags}
              aria-pressed={hideSensitiveTags}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                hideSensitiveTags
                  ? "bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200"
                  : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {hideSensitiveTags ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{hideSensitiveTags ? "Exibir laudo e AEE" : "Ocultar laudo e AEE"}</span>
            </button>

            <button
              type="button"
              onClick={openFocusFromTop}
              disabled={visibleStudents.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
            >
              <Presentation className="w-3.5 h-3.5" />
              <span>Aluno a aluno</span>
            </button>

            <button
              type="button"
              onClick={exitProjectorMode}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold transition cursor-pointer"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Sair do telão</span>
            </button>
          </div>
        </header>
      )}

      {/* Barra de ações rápidas (modo normal quando standalone) */}
      {!isProjectorMode && !hideTopActionBar && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-xs">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-extrabold text-slate-900 dark:text-white">
              {activeTrimester}º Trimestre
            </span>
            <span>•</span>
            <span>
              {analytics.activeStudentsCount} estudantes ativos
            </span>
            {activeSubjects.length === 0 && !readOnly && (
              <button
                type="button"
                onClick={onOpenSubjectsModal}
                className="ml-2 text-sky-700 dark:text-sky-400 font-bold underline cursor-pointer"
              >
                Cadastrar componentes
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openFocusFromTop}
              disabled={visibleStudents.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
            >
              <Presentation className="w-3.5 h-3.5" />
              <span>Apresentar aluno a aluno</span>
            </button>

            <button
              type="button"
              onClick={enterProjectorMode}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-bold transition cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Modo Telão</span>
            </button>
          </div>
        </div>
      )}

      {!isProjectorMode && hideTopActionBar && activeSubjects.length === 0 && !readOnly && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
          <span>Nenhum componente curricular cadastrado nesta turma.</span>
          <button
            type="button"
            onClick={onOpenSubjectsModal}
            className="font-bold underline cursor-pointer shrink-0"
          >
            Cadastrar componentes
          </button>
        </div>
      )}

      {/* BLOCO 1: Panorama da Turma em faixa única + Grade horizontal de Componentes */}
      {showOverview && (
        <section
          aria-label="Panorama consolidado da turma"
          className="space-y-3"
        >
          {/* KPIs + Cruzamentos em faixa compacta */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                {
                  key: "CRITICAL" as const,
                  label: "Prioridade crítica",
                  count: analytics.criticalCount,
                  activeClass:
                    "border-rose-500 bg-rose-50 dark:bg-rose-950/60 ring-2 ring-rose-500/30",
                  idleClass:
                    "border-rose-200 dark:border-rose-900/70 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-50 dark:hover:bg-rose-950/40",
                  numberClass: "text-rose-700 dark:text-rose-300",
                },
                {
                  key: "ATTENTION" as const,
                  label: "Em atenção",
                  count: analytics.attentionCount,
                  activeClass:
                    "border-amber-500 bg-amber-50 dark:bg-amber-950/60 ring-2 ring-amber-500/30",
                  idleClass:
                    "border-amber-200 dark:border-amber-900/70 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/40",
                  numberClass: "text-amber-700 dark:text-amber-300",
                },
                {
                  key: "BELOW_AVG" as const,
                  label: "Abaixo da média",
                  count: analytics.belowAvgStudentsCount,
                  activeClass:
                    "border-sky-500 bg-sky-50 dark:bg-sky-950/60 ring-2 ring-sky-500/30",
                  idleClass:
                    "border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800",
                  numberClass: "text-slate-900 dark:text-white",
                },
                {
                  key: "LOW_ATTENDANCE" as const,
                  label: "Frequência < 75%",
                  count: analytics.lowAttendanceStudentsCount,
                  activeClass:
                    "border-orange-500 bg-orange-50 dark:bg-orange-950/60 ring-2 ring-orange-500/30",
                  idleClass:
                    "border-orange-200 dark:border-orange-900/70 bg-orange-50/40 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/40",
                  numberClass: "text-orange-700 dark:text-orange-300",
                },
              ].map((kpi) => {
                const isSelected = quickFilter === kpi.key;
                return (
                  <button
                    key={kpi.key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleQuickFilter(kpi.key)}
                    className={`rounded-xl border px-3.5 py-2.5 text-left transition cursor-pointer flex items-center justify-between gap-2 ${
                      isSelected ? kpi.activeClass : kpi.idleClass
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {kpi.label}
                    </span>
                    <span className={`font-black ${isProjectorMode ? "text-2xl" : "text-xl"} ${kpi.numberClass}`}>
                      {kpi.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Cruzamentos pedagógicos em linha */}
            <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500 mr-1">
                Cruzamentos:
              </span>
              {[
                {
                  key: "CORR_INFREQ_BELOW" as const,
                  label: "Infrequência + Abaixo da média",
                  count: analytics.correlations.lowAttendanceAndBelowAvg,
                },
                {
                  key: "CORR_CONDUCT_BELOW" as const,
                  label: "Conduta + Abaixo da média",
                  count: analytics.correlations.conductAndBelowAvg,
                },
                {
                  key: "CORR_DIFFICULTY_REGULAR_ATT" as const,
                  label: "Dificuldade com frequência regular",
                  count: analytics.correlations.difficultyWithRegularAttendance,
                },
                {
                  key: "HIGHLIGHTS" as const,
                  label: "Destaques e assiduidade",
                  count: analytics.correlations.highlights,
                },
              ].map((corr) => {
                const selected = quickFilter === corr.key;
                return (
                  <button
                    key={corr.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleQuickFilter(corr.key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold transition cursor-pointer ${
                      selected
                        ? "bg-sky-600 border-sky-600 text-white"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {corr.key === "HIGHLIGHTS" && <Sparkles className="w-3 h-3" />}
                    <span>{corr.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[11px] font-black ${
                        selected
                          ? "bg-white/20 text-white"
                          : "bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      }`}
                    >
                      {corr.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ranking de Componentes Críticos em grade horizontal */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-sky-600" />
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-800 dark:text-slate-100">
                  Componentes com mais atenção
                </h3>
              </div>
              {totalSubjectsWithAttention > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllSubjectsRanking((prev) => !prev)}
                  className="text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                >
                  {showAllSubjectsRanking ? "Ver principais" : `Ver todos (${analytics.subjects.length})`}
                </button>
              )}
            </div>

            {rankedSubjects.length === 0 ? (
              <p className="text-xs text-slate-500 py-2 text-center">
                Nenhum componente curricular cadastrado.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {rankedSubjects.map((subj) => {
                  const selected = subjectIdFilter === subj.subjectId;
                  const barWidth = Math.min(100, Math.max(subj.belowAvgPercent, subj.belowAvgCount > 0 ? 8 : 0));

                  return (
                    <button
                      key={subj.subjectId}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setSubjectIdFilter((prev) =>
                          prev === subj.subjectId ? "" : subj.subjectId
                        )
                      }
                      className={`w-full text-left rounded-xl border p-2.5 transition cursor-pointer ${
                        selected
                          ? "border-sky-500 bg-sky-50 dark:bg-sky-950/50 ring-2 ring-sky-500/30"
                          : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-extrabold text-slate-900 dark:text-white truncate">
                          {subj.subjectName}
                        </span>
                        <span className="text-[11px] font-black text-rose-700 dark:text-rose-300 shrink-0">
                          {subj.belowAvgCount} ({subj.belowAvgPercent}%)
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-rose-500 dark:bg-rose-400 transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      {(subj.difficultyCount > 0 || subj.conductCount > 0) && (
                        <div className="mt-1.5 flex items-center gap-2 text-[10px] font-bold text-slate-600 dark:text-slate-400">
                          {subj.difficultyCount > 0 && <span>{subj.difficultyCount} dif.</span>}
                          {subj.conductCount > 0 && <span>{subj.conductCount} cond.</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* BLOCO 2: Barra de Filtros + Lista Consolidada / Mapa de Calor */}
      <section
        aria-label="Lista consolidada de estudantes"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden"
      >
        {/* Controles de filtro, busca, ordenação e densidade */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Buscar estudante no painel de análise"
                  placeholder="Buscar por estudante ou matrícula..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="inline-flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <select
                  aria-label="Filtrar por componente curricular"
                  value={subjectIdFilter}
                  onChange={(e) => setSubjectIdFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  <option value="">Todos os componentes</option>
                  {activeSubjects.map((subj) => (
                    <option key={subj.id} value={subj.id}>
                      Atenção em {subj.name}
                    </option>
                  ))}
                </select>
              </div>

              <select
                aria-label="Ordenar estudantes"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as AnalysisSortMode)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
              >
                <option value="PRIORITY">Ordenar: Prioridade pedagógica</option>
                <option value="BELOW_AVG">Ordenar: Mais abaixo da média</option>
                <option value="ATTENDANCE">Ordenar: Menor frequência</option>
                <option value="NAME">Ordenar: Ordem alfabética (A–Z)</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Modo de exibição dos estudantes"
                className="inline-flex items-center rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={displayMode === "consolidated"}
                  onClick={() => setDisplayMode("consolidated")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    displayMode === "consolidated"
                      ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Consolidado</span>
                </button>
                <button
                  type="button"
                  aria-pressed={displayMode === "heatmap"}
                  onClick={() => setDisplayMode("heatmap")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    displayMode === "heatmap"
                      ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  <Grid2X2 className="w-3.5 h-3.5" />
                  <span>Mapa de calor</span>
                </button>
              </div>
            </div>
          </div>

          {/* Pílulas de filtro rápido */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: "ALL", label: `Todos (${analytics.students.length})` },
                  { key: "CRITICAL", label: `Crítico (${analytics.criticalCount})` },
                  { key: "ATTENTION", label: `Atenção (${analytics.attentionCount})` },
                  { key: "REGULAR", label: `Regular (${analytics.regularCount})` },
                  { key: "DIFFICULTY", label: "Dificuldade" },
                  { key: "CONDUCT", label: "Conduta" },
                  { key: "INFREQUENCY", label: "Infrequência" },
                ] as Array<{ key: AnalysisQuickFilter; label: string }>
              ).map((pill) => {
                const selected = quickFilter === pill.key;
                return (
                  <button
                    key={pill.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setQuickFilter(pill.key)}
                    className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition cursor-pointer ${
                      selected
                        ? "bg-sky-600 border-sky-600 text-white"
                        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {pill.label}
                  </button>
                );
              })}

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Limpar filtros</span>
                </button>
              )}
            </div>

            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Exibindo {visibleStudents.length} de {analytics.students.length}
              {selectedSubjectMeta ? ` • Componente: ${selectedSubjectMeta.name}` : ""}
            </div>
          </div>
        </div>

        {/* Conteúdo da Lista */}
        {visibleStudents.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <AlertTriangle className="w-6 h-6 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Nenhum estudante corresponde aos filtros selecionados.
            </p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer"
            >
              Limpar filtros
            </button>
          </div>
        ) : displayMode === "consolidated" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Estudante</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Frequência</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Abaixo da média</th>
                  <th className="py-2.5 px-3">Ocorrências</th>
                  <th className="py-2.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleStudents.map((item) => {
                  const pStyle = PRIORITY_STYLES[item.priority];
                  const visibleTags = item.card.tags.filter((tagValue) => {
                    const meta = tagOptionMap.get(tagValue as never);
                    if (!meta) return false;
                    if (hideSensitiveTags && meta.isSensitiveHealth) return false;
                    return true;
                  });
                  const comp = item.comparison;
                  const isExpanded = Boolean(expandedStudentIds[item.studentId]);
                  const occurrenceParts: string[] = [];
                  if (item.descriptorCounts[2] > 0) {
                    occurrenceParts.push(`${item.descriptorCounts[2]} Dificuldade`);
                  }
                  if (item.descriptorCounts[3] > 0) {
                    occurrenceParts.push(`${item.descriptorCounts[3]} Conduta`);
                  }
                  if (item.descriptorCounts[4] > 0) {
                    occurrenceParts.push(`${item.descriptorCounts[4]} Infrequência`);
                  }

                  return (
                    <tr
                      key={item.card.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition align-top ${pStyle.stripeClass}`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-start gap-2.5 min-w-[200px]">
                          <div
                            aria-hidden="true"
                            className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5"
                          >
                            {getStudentInitials(item.studentName)}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onOpenStudentModal(item.card)}
                                aria-label={`Abrir ficha completa de ${item.studentName}`}
                                title="Abrir ficha do estudante"
                                className={`font-black text-slate-900 dark:text-white hover:text-sky-700 dark:hover:text-sky-400 hover:underline text-left leading-tight cursor-pointer ${
                                  isProjectorMode ? "text-base" : "text-sm"
                                }`}
                              >
                                {item.studentName}
                              </button>
                              <span
                                className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${pStyle.badgeClass}`}
                              >
                                {pStyle.label}
                              </span>
                              {!item.isActiveEnrollment && (
                                <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                                  {COUNCIL_ENROLLMENT_STATUS_LABELS[
                                    item.card.enrollmentStatus as CouncilEnrollmentStatus
                                  ] || item.card.enrollmentStatus}
                                </span>
                              )}
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

                            {item.opinion && (
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-1">
                                <strong className="font-bold text-slate-700 dark:text-slate-300">
                                  Parecer:
                                </strong>{" "}
                                {item.opinion}
                              </p>
                            )}

                            {isExpanded && item.belowAvgItems.length > 0 && (
                              <div className="pt-1.5 flex flex-wrap gap-1.5">
                                {item.belowAvgItems.map((b) => (
                                  <span
                                    key={`${item.studentId}-${b.subjectName}`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 text-[11px] font-bold"
                                  >
                                    <span>{b.subjectName}</span>
                                    {b.grade !== null && (
                                      <span className="font-black">
                                        {formatCouncilGradePtBr(b.grade)}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.attendancePercent !== null ? (
                          <span
                            className={`font-bold ${
                              item.hasLowAttendance
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {item.attendancePercent.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          {item.belowAvgCount > 0 ? (
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() => toggleStudentExpanded(item.studentId)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-800 dark:text-rose-200 font-bold cursor-pointer transition"
                            >
                              <span>
                                {item.belowAvgCount} de {activeSubjects.length || item.belowAvgCount}
                              </span>
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          ) : (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                              Nenhuma
                            </span>
                          )}

                          {comp?.hasPrevData && comp.trend !== "NONE" && (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
                                comp.trend === "IMPROVED"
                                  ? "text-emerald-700 dark:text-emerald-300"
                                  : comp.trend === "WORSENED"
                                  ? "text-rose-700 dark:text-rose-300"
                                  : "text-slate-500 dark:text-slate-400"
                              }`}
                            >
                              {comp.trend === "IMPROVED" && <ArrowDownRight className="w-3 h-3" />}
                              {comp.trend === "WORSENED" && <ArrowUpRight className="w-3 h-3" />}
                              <span>
                                {comp.belowAvgDelta < 0
                                  ? `${Math.abs(comp.belowAvgDelta)} a menos vs ${comp.prevTrimester}ºT`
                                  : comp.belowAvgDelta > 0
                                  ? `+${comp.belowAvgDelta} vs ${comp.prevTrimester}ºT`
                                  : `Estável vs ${comp.prevTrimester}ºT`}
                              </span>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {occurrenceParts.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {occurrenceParts.map((part) => (
                              <span
                                key={part}
                                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-semibold whitespace-nowrap"
                              >
                                {part}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openFocusForStudent(item.studentId)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer"
                        >
                          <Presentation className="w-3.5 h-3.5" />
                          <span>Focar</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* MAPA DE CALOR COMPACTO */
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={heatmapCaptionId}
            className="overflow-auto max-w-full max-h-[70vh]"
          >
            <table className="w-full border-separate border-spacing-0 text-xs">
              <caption id={heatmapCaptionId} className="sr-only">
                Mapa de calor consolidado por estudante e componente curricular no{" "}
                {activeTrimester}º trimestre
              </caption>
              <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-3 py-2.5 text-left font-extrabold text-slate-800 dark:text-slate-100 min-w-[200px]"
                  >
                    Estudante
                  </th>
                  <th
                    scope="col"
                    className="border-b border-r border-slate-200 dark:border-slate-700 px-2 py-2.5 text-center font-extrabold text-slate-700 dark:text-slate-200 min-w-[64px]"
                  >
                    Freq.
                  </th>
                  <th
                    scope="col"
                    className="border-b border-r border-slate-200 dark:border-slate-700 px-2 py-2.5 text-center font-extrabold text-slate-700 dark:text-slate-200 min-w-[66px]"
                  >
                    Abaixo
                  </th>
                  {activeSubjects.map((subj) => {
                    const summary = analytics.subjects.find((s) => s.subjectId === subj.id);
                    return (
                      <th
                        key={subj.id}
                        scope="col"
                        title={subj.name}
                        className="border-b border-r border-slate-200 dark:border-slate-700 px-1.5 py-2.5 text-center font-extrabold text-slate-800 dark:text-slate-100 min-w-[54px]"
                      >
                        <span className="block truncate">{summary?.shortName || subj.name.slice(0, 4)}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {visibleStudents.map((item) => {
                  const pStyle = PRIORITY_STYLES[item.priority];
                  return (
                    <tr
                      key={item.card.id}
                      onClick={() => openFocusForStudent(item.studentId)}
                      className="hover:bg-sky-50/70 dark:hover:bg-sky-950/30 transition-colors cursor-pointer"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-white dark:bg-slate-900 border-b border-r border-slate-200 dark:border-slate-800 px-3 py-2 text-left font-bold text-slate-900 dark:text-white"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate max-w-[140px]">{item.studentName}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${pStyle.badgeClass}`}
                          >
                            {pStyle.label}
                          </span>
                        </div>
                      </th>

                      <td className="border-b border-r border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-bold">
                        {item.attendancePercent !== null ? (
                          <span
                            className={
                              item.hasLowAttendance
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-slate-700 dark:text-slate-300"
                            }
                          >
                            {item.attendancePercent.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="border-b border-r border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-black">
                        <span
                          className={
                            item.belowAvgCount >= 3
                              ? "text-rose-700 dark:text-rose-300"
                              : item.belowAvgCount >= 1
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-emerald-700 dark:text-emerald-300"
                          }
                        >
                          {item.belowAvgCount}
                        </span>
                      </td>

                      {item.subjectCells.map((cell) => {
                        const formattedGrade = formatCouncilGradePtBr(cell.grade);
                        const hasDiff = cell.descriptorCodes.includes(2);
                        const hasCond = cell.descriptorCodes.includes(3);
                        const hasInf = cell.descriptorCodes.includes(4);

                        const cellTone = cell.isBelowAvg
                          ? "bg-rose-100/90 text-rose-900 dark:bg-rose-950/70 dark:text-rose-200"
                          : cell.hasAlertDescriptor
                          ? "bg-amber-100/80 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                          : formattedGrade !== null
                          ? "bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                          : "bg-white dark:bg-slate-900 text-slate-400";

                        return (
                          <td
                            key={cell.subjectId}
                            title={`${cell.subjectName}: ${
                              formattedGrade !== null ? `Nota ${formattedGrade}` : "Sem nota"
                            }${hasDiff ? " • Dificuldade" : ""}${hasCond ? " • Conduta" : ""}${
                              hasInf ? " • Infrequência" : ""
                            }`}
                            className={`border-b border-r border-slate-200 dark:border-slate-800 px-1 py-1.5 text-center align-middle ${cellTone}`}
                          >
                            <div className="font-extrabold leading-none">
                              {formattedGrade ?? "—"}
                            </div>
                            {(hasDiff || hasCond || hasInf) && (
                              <div className="mt-1 flex items-center justify-center gap-0.5">
                                {hasDiff && (
                                  <span
                                    aria-label="Dificuldade"
                                    className="w-1.5 h-1.5 rounded-full bg-amber-500"
                                  />
                                )}
                                {hasCond && (
                                  <span
                                    aria-label="Conduta"
                                    className="w-1.5 h-1.5 rounded-full bg-rose-600"
                                  />
                                )}
                                {hasInf && (
                                  <span
                                    aria-label="Infrequência"
                                    className="w-1.5 h-1.5 rounded-full bg-orange-500"
                                  />
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* BLOCO 3: Modo Foco (Estudante por Estudante com edição ao vivo) */}
      <CouncilStudentFocusModal
        open={focusModalOpen}
        onClose={() => setFocusModalOpen(false)}
        board={board}
        activeTrimester={activeTrimester}
        students={visibleStudents}
        currentIndex={focusIndex}
        onSelectIndex={(nextIndex) => {
          const target = visibleStudents[nextIndex];
          if (target) setFocusStudentId(target.studentId);
        }}
        hideSensitiveTags={hideSensitiveTags}
        onToggleHideSensitiveTags={onToggleHideSensitiveTags}
        onOpenFullFicha={onOpenStudentModal}
        onCardUpdated={onCardUpdated}
        onMatrixSaved={onMatrixSaved}
        onNotify={onNotify}
        readOnly={readOnly}
      />
    </div>
  );
}
