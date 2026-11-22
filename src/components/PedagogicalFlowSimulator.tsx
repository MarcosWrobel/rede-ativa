"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Play,
  Pause,
  RotateCcw,
  FileSpreadsheet,
  MessageSquare,
  FileCheck2,
  FolderKanban,
  QrCode,
  KeyRound,
  CheckCircle2,
  Send,
  FileDown,
  Video,
  Monitor,
  AppWindow,
  Users,
  AlertTriangle,
  Stethoscope,
  BookOpenCheck,
  ListTodo,
  GraduationCap,
  Search,
  Upload,
  Check,
  CheckCheck,
  EyeOff,
  Smartphone,
  ShieldAlert,
  Printer,
} from "lucide-react";
import styles from "./landing/landingMotion.module.css";
import type { PlatformEdition } from "@/lib/platformEditions";

export interface PedagogicalFlowSimulatorProps {
  mode: "public" | "internal";
  schoolEdition?: PlatformEdition;
  isSuperAdmin?: boolean;
  videoUrl?: string;
}

type SidebarItemId =
  | "busca-ativa"
  | "faltas"
  | "alunos"
  | "atestados"
  | "atas"
  | "encaminhamentos"
  | "treinamento";

type SubPhaseIndex = 0 | 1 | 2 | 3 | 4;
type CursorState = "moving" | "clicking" | "settled";

interface SubPhaseConfig {
  label: string;
  actionLabel: string;
  targetId: string;
  hasClick: boolean;
  fallbackCursor: { x: number; y: number };
}

interface SimulatorStep {
  id: 1 | 2 | 3 | 4 | 5;
  shortLabel: string;
  title: string;
  subtitle: string;
  headerTitle: string;
  activeSidebar: SidebarItemId;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  subPhases: [
    SubPhaseConfig,
    SubPhaseConfig,
    SubPhaseConfig,
    SubPhaseConfig,
    SubPhaseConfig,
  ];
}

const SUBPHASE_DURATION_MS = 2200;
const PHASE_A_MOVE_MS = 620;
const PHASE_B_CLICK_END_MS = 920;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const SIDEBAR_ITEMS: Array<{
  id: SidebarItemId;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  { id: "busca-ativa", label: "Busca Ativa", icon: Send },
  { id: "faltas", label: "Faltas e Frequência", icon: AlertTriangle },
  { id: "alunos", label: "Estudantes e Turmas", icon: Users },
  { id: "atestados", label: "Atestados", icon: Stethoscope },
  { id: "atas", label: "Atas Pedagógicas", icon: BookOpenCheck },
  { id: "encaminhamentos", label: "Encaminhamentos", icon: ListTodo },
  { id: "treinamento", label: "Orientação e Guias", icon: GraduationCap },
];

const BASE_STEPS: SimulatorStep[] = [
  {
    id: 1,
    shortLabel: "1. Matrículas e faltas",
    title: "Matrículas, turmas e atualização de faltas",
    subtitle:
      "Separação entre cadastro de turmas por turno e leitura periódica de faltas consecutivas e alternadas.",
    headerTitle: "Estudantes e Turmas",
    activeSidebar: "alunos",
    icon: FileSpreadsheet,
    subPhases: [
      {
        label: "Abrir envio",
        actionLabel: "Acionando importação de planilha compatível",
        targetId: "btn-import-sheet",
        hasClick: true,
        fallbackCursor: { x: 85, y: 12 },
      },
      {
        label: "Enviar CSV",
        actionLabel: "Carregando arquivo relatorio_turmas_faltas.csv",
        targetId: "upload-dropzone",
        hasClick: true,
        fallbackCursor: { x: 50, y: 38 },
      },
      {
        label: "Separar dados",
        actionLabel: "Separando matrículas por turma e faltas do período",
        targetId: "counters-split",
        hasClick: false,
        fallbackCursor: { x: 50, y: 60 },
      },
      {
        label: "Confirmar",
        actionLabel: "Confirmando atualização das turmas e faltas",
        targetId: "btn-confirm-import",
        hasClick: true,
        fallbackCursor: { x: 74, y: 82 },
      },
      {
        label: "Atualizado",
        actionLabel: "Tabela atualizada com alertas de frequência",
        targetId: "row-student-lucas",
        hasClick: false,
        fallbackCursor: { x: 50, y: 54 },
      },
    ],
  },
  {
    id: 2,
    shortLabel: "2. Busca ativa",
    title: "Busca ativa e contato com a família",
    subtitle:
      "Estudantes com atestado vigente são preservados; a equipe revisa a mensagem e registra o retorno da família.",
    headerTitle: "Busca Ativa",
    activeSidebar: "busca-ativa",
    icon: MessageSquare,
    subPhases: [
      {
        label: "Fila da turma",
        actionLabel: "Selecionando estudante na fila da turma 1º Ano A",
        targetId: "row-student-lucas",
        hasClick: true,
        fallbackCursor: { x: 24, y: 54 },
      },
      {
        label: "Revisar e enviar",
        actionLabel: "Revisando destinatário e mensagem antes do envio",
        targetId: "btn-review-send",
        hasClick: true,
        fallbackCursor: { x: 80, y: 78 },
      },
      {
        label: "Retorno WhatsApp",
        actionLabel: "Acompanhando conversa assistida e resposta da família",
        targetId: "whatsapp-reply-bubble",
        hasClick: false,
        fallbackCursor: { x: 72, y: 62 },
      },
      {
        label: "Conferir registro",
        actionLabel: "Conferindo classificação sugerida pela equipe",
        targetId: "reply-category-card",
        hasClick: false,
        fallbackCursor: { x: 54, y: 54 },
      },
      {
        label: "Salvar",
        actionLabel: "Salvando tentativa de contato revisada",
        targetId: "btn-save-reply",
        hasClick: true,
        fallbackCursor: { x: 74, y: 78 },
      },
    ],
  },
  {
    id: 3,
    shortLabel: "3. Ata pedagógica",
    title: "Registro de atendimento e ata pedagógica",
    subtitle:
      "Minuta revisada pela pedagoga, assinatura ao vivo no celular e confirmação de autoria por PIN.",
    headerTitle: "Atas Pedagógicas",
    activeSidebar: "atas",
    icon: FileCheck2,
    subPhases: [
      {
        label: "Gerar minuta",
        actionLabel: "Acionando geração de minuta do atendimento",
        targetId: "btn-generate-draft",
        hasClick: true,
        fallbackCursor: { x: 82, y: 16 },
      },
      {
        label: "Revisar texto",
        actionLabel: "Revisando minuta elaborada com controle humano",
        targetId: "ata-draft-box",
        hasClick: false,
        fallbackCursor: { x: 52, y: 38 },
      },
      {
        label: "Coletar assinatura",
        actionLabel: "Coletando assinatura manuscrita do responsável legal",
        targetId: "btn-collect-signature",
        hasClick: true,
        fallbackCursor: { x: 42, y: 66 },
      },
      {
        label: "Confirmar PIN",
        actionLabel: "Confirmando autoria da servidora com PIN",
        targetId: "btn-confirm-pin",
        hasClick: true,
        fallbackCursor: { x: 78, y: 84 },
      },
      {
        label: "Confirmada",
        actionLabel: "Ata confirmada com histórico preservado",
        targetId: "ata-post-confirm-notice",
        hasClick: false,
        fallbackCursor: { x: 76, y: 68 },
      },
    ],
  },
  {
    id: 4,
    shortLabel: "4. Histórico e envio",
    title: "Histórico de acompanhamento e relatório exportável",
    subtitle:
      "Linha do tempo unificada separando fatos de relatos e protegendo identidade de terceiros.",
    headerTitle: "Estudantes e Turmas",
    activeSidebar: "alunos",
    icon: FolderKanban,
    subPhases: [
      {
        label: "Fatos",
        actionLabel: "Consultando fatos registrados na linha do tempo",
        targetId: "timeline-facts-card",
        hasClick: false,
        fallbackCursor: { x: 42, y: 34 },
      },
      {
        label: "Relatos e proteção",
        actionLabel: "Diferenciando relatos familiares e terceiros protegidos",
        targetId: "timeline-reports-card",
        hasClick: false,
        fallbackCursor: { x: 42, y: 54 },
      },
      {
        label: "Gerar relatório",
        actionLabel: "Acionando geração do relatório de intervenções",
        targetId: "btn-generate-report",
        hasClick: true,
        fallbackCursor: { x: 82, y: 14 },
      },
      {
        label: "Folha A4",
        actionLabel: "Pré-visualizando documento A4 estruturado",
        targetId: "a4-report-sheet",
        hasClick: false,
        fallbackCursor: { x: 72, y: 54 },
      },
      {
        label: "Baixar PDF",
        actionLabel: "Exportando relatório conforme procedimentos da rede",
        targetId: "btn-download-pdf",
        hasClick: true,
        fallbackCursor: { x: 86, y: 34 },
      },
    ],
  },
];

const PILOT_STEP: SimulatorStep = {
  id: 5,
  shortLabel: "5. Janela compacta",
  title: "Janela compacta de apoio e sincronização",
  subtitle:
    "Operação lado a lado da janela dedicada compacta (480x760) com o painel escolar da unidade piloto.",
  headerTitle: "Orientação e Guias",
  activeSidebar: "treinamento",
  icon: AppWindow,
  subPhases: [
    {
      label: "Painel piloto",
      actionLabel: "Selecionando estudante na unidade piloto",
      targetId: "pilot-panel-card",
      hasClick: false,
      fallbackCursor: { x: 28, y: 42 },
    },
    {
      label: "Abrir compacta",
      actionLabel: "Abrindo janela compacta lateral dedicada",
      targetId: "btn-open-compact",
      hasClick: true,
      fallbackCursor: { x: 26, y: 70 },
    },
    {
      label: "Conversa isolada",
      actionLabel: "Mantendo conversa ativa sem expor outros contatos",
      targetId: "compact-window-card",
      hasClick: false,
      fallbackCursor: { x: 74, y: 46 },
    },
    {
      label: "Capturar retorno",
      actionLabel: "Transferindo resposta para conferência da equipe",
      targetId: "btn-capture-compact",
      hasClick: true,
      fallbackCursor: { x: 82, y: 74 },
    },
    {
      label: "Sincronizado",
      actionLabel: "Retorno confirmado no painel da unidade",
      targetId: "pilot-panel-card",
      hasClick: false,
      fallbackCursor: { x: 28, y: 42 },
    },
  ],
};

const DRAFT_MINUTE_TEXT =
  "Aos quatorze dias do mês de novembro, a equipe pedagógica registrou atendimento com a responsável legal referente às faltas consecutivas de Lucas Mendes (1º Ano A), firmando compromisso de retorno às aulas.";

export default function PedagogicalFlowSimulator({
  mode,
  schoolEdition = "INSTITUCIONAL_ESSENCIAL",
  isSuperAdmin = false,
  videoUrl,
}: PedagogicalFlowSimulatorProps) {
  const showPilotStep =
    mode === "internal" && (schoolEdition === "PILOTO_INTEGRADA" || Boolean(isSuperAdmin));

  const steps = useMemo(
    () => (showPilotStep ? [...BASE_STEPS, PILOT_STEP] : BASE_STEPS),
    [showPilotStep]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [subPhase, setSubPhase] = useState<SubPhaseIndex>(0);
  const [cursorState, setCursorState] = useState<CursorState>("moving");
  const [actionCommitted, setActionCommitted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [viewMode, setViewMode] = useState<"simulator" | "video">("simulator");
  const [cycleKey, setCycleKey] = useState(0);

  const isPublic = mode === "public";
  const simulatorRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState<{
    x: number;
    y: number;
    unit: "px" | "%";
  }>({
    x: BASE_STEPS[0].subPhases[0].fallbackCursor.x,
    y: BASE_STEPS[0].subPhases[0].fallbackCursor.y,
    unit: "%",
  });

  useEffect(() => {
    if (activeIndex >= steps.length) {
      setActiveIndex(0);
      setSubPhase(0);
    }
  }, [activeIndex, steps.length]);

  const currentStep = steps[activeIndex] || steps[0];
  const currentSubPhase = currentStep.subPhases[subPhase];
  const activeTargetId = currentSubPhase.targetId;
  const progressPercent = ((subPhase + 1) / 5) * 100;

  // Pilar 2: Cadência física em 3 tempos por sub-fase (moving -> clicking -> settled)
  useEffect(() => {
    if (viewMode !== "simulator") return;

    setCursorState("moving");
    setActionCommitted(false);

    const clickTimer = setTimeout(() => {
      setCursorState(currentSubPhase.hasClick ? "clicking" : "settled");
    }, PHASE_A_MOVE_MS);

    const settleTimer = setTimeout(() => {
      setCursorState("settled");
      setActionCommitted(true);
    }, PHASE_B_CLICK_END_MS);

    return () => {
      clearTimeout(clickTimer);
      clearTimeout(settleTimer);
    };
  }, [activeIndex, subPhase, cycleKey, viewMode, currentSubPhase.hasClick]);

  useEffect(() => {
    const simulator = simulatorRef.current;
    if (!isPublic || !simulator) return;

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pauseForReducedMotion = () => {
      if (preference.matches) setIsPlaying(false);
    };

    pauseForReducedMotion();
    preference.addEventListener("change", pauseForReducedMotion);

    const observer = typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer?.observe(simulator);
    if (!observer) setInView(true);

    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", pauseForReducedMotion);
    };
  }, [isPublic]);

  // Avanço contínuo entre sub-etapas e etapas
  useEffect(() => {
    if (!isPlaying || viewMode !== "simulator" || (isPublic && !inView)) return;

    const interval = setInterval(() => {
      setSubPhase((prevSub) => {
        if (prevSub < 4) {
          return (prevSub + 1) as SubPhaseIndex;
        }
        setActiveIndex((prevIdx) => (prevIdx + 1) % steps.length);
        return 0;
      });
      setCycleKey((k) => k + 1);
    }, SUBPHASE_DURATION_MS);

    return () => clearInterval(interval);
  }, [isPlaying, viewMode, steps.length, isPublic, inView]);

  // Pilar 1: Rastreamento exato via DOM (getBoundingClientRect + data-sim-target + ResizeObserver)
  const measureTarget = useCallback(() => {
    const stageEl = stageRef.current;
    if (!stageEl) {
      setCursorPos({
        x: currentSubPhase.fallbackCursor.x,
        y: currentSubPhase.fallbackCursor.y,
        unit: "%",
      });
      return;
    }

    const targetEl = stageEl.querySelector<HTMLElement>(
      `[data-sim-target="${activeTargetId}"]`
    );

    if (!targetEl) {
      setCursorPos({
        x: currentSubPhase.fallbackCursor.x,
        y: currentSubPhase.fallbackCursor.y,
        unit: "%",
      });
      return;
    }

    const stageRect = stageEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    if (
      stageRect.width === 0 ||
      stageRect.height === 0 ||
      targetRect.width === 0 ||
      targetRect.height === 0
    ) {
      setCursorPos({
        x: currentSubPhase.fallbackCursor.x,
        y: currentSubPhase.fallbackCursor.y,
        unit: "%",
      });
      return;
    }

    const x = targetRect.left - stageRect.left + targetRect.width * 0.5;
    const y = targetRect.top - stageRect.top + targetRect.height * 0.5;
    setCursorPos({ x, y, unit: "px" });
  }, [activeTargetId, currentSubPhase.fallbackCursor.x, currentSubPhase.fallbackCursor.y]);

  useIsomorphicLayoutEffect(() => {
    if (viewMode !== "simulator") return;

    measureTarget();

    // Re-mede após transições elásticas caso o layout interno mude
    const rafId =
      typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(() => measureTarget())
        : null;

    const stageEl = stageRef.current;
    let observer: ResizeObserver | null = null;
    if (stageEl && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measureTarget());
      observer.observe(stageEl);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", measureTarget);
    }

    return () => {
      if (rafId !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafId);
      }
      if (observer) {
        observer.disconnect();
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", measureTarget);
      }
    };
  }, [measureTarget, viewMode, activeIndex, subPhase, actionCommitted]);

  const handleSelectStep = (idx: number) => {
    if (isPublic) setIsPlaying(false);
    setActiveIndex(idx);
    setSubPhase(0);
    setCycleKey((k) => k + 1);
  };

  const handleSelectSubPhase = (nextSub: SubPhaseIndex) => {
    if (isPublic) setIsPlaying(false);
    setSubPhase(nextSub);
    setCycleKey((k) => k + 1);
  };

  const handleRestart = () => {
    setActiveIndex(0);
    setSubPhase(0);
    setIsPlaying(true);
    setCycleKey((k) => k + 1);
  };

  return (
    <section
      ref={simulatorRef}
      aria-label="Simulação demonstrativa do acompanhamento pedagógico"
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden text-slate-900 ${isPublic ? styles.simulator : ""}`}
    >
      {/* Cabeçalho de Controles e Identificação */}
      <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Simulação demonstrativa
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {videoUrl && (
            <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5 mr-1">
              <button
                type="button"
                onClick={() => setViewMode("simulator")}
                aria-label="Exibir simulação interativa"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  viewMode === "simulator"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Simulação</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("video")}
                aria-label="Exibir vídeo demonstrativo"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  viewMode === "video"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Video className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Vídeo</span>
              </button>
            </div>
          )}

          {viewMode === "simulator" && (
            <>
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? "Pausar reprodução automática" : "Reproduzir simulação automática"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                    <span>Pausar</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                    <span>Reproduzir</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleRestart}
                aria-label="Reiniciar simulação na primeira etapa"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reiniciar</span>
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === "video" && videoUrl ? (
        <div className="p-4 sm:p-6 bg-slate-900">
          <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
            <video
              src={videoUrl}
              controls
              className="w-full h-full object-contain"
              aria-label="Vídeo demonstrativo da rotina pedagógica"
            />
          </div>
        </div>
      ) : (
        <>
          {/* Navegação por Etapas */}
          <div
            role="tablist"
            aria-label="Etapas da simulação"
            className={`grid grid-cols-2 ${
              steps.length === 5 ? "lg:grid-cols-5" : "md:grid-cols-4"
            } border-b border-slate-200 bg-slate-50/70`}
          >
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isSelected = idx === activeIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-label={`Selecionar ${step.shortLabel}`}
                  onClick={() => handleSelectStep(idx)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-left text-xs font-bold border-b-2 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-emerald-600 ${
                    isSelected
                      ? "border-emerald-600 bg-white text-emerald-900"
                      : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-white/60"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isSelected ? "text-emerald-600" : "text-slate-400"
                    }`}
                    aria-hidden={true}
                  />
                  <span className="truncate">{step.shortLabel}</span>
                </button>
              );
            })}
          </div>

          {/* Barra de Sub-etapas Manuais + Progresso Contínuo */}
          <div className="px-4 sm:px-6 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                {currentStep.title}
              </h3>
              <p className="text-xs text-slate-600">{currentStep.subtitle}</p>
            </div>

            <div
              role="group"
              aria-label="Sub-etapas da simulação"
              className="flex flex-wrap items-center gap-1.5"
            >
              {currentStep.subPhases.map((sp, idx) => {
                const isSubActive = idx === subPhase;
                return (
                  <button
                    key={sp.label}
                    type="button"
                    aria-pressed={isSubActive}
                    aria-label={`Sub-etapa ${idx + 1}: ${sp.label}`}
                    onClick={() => handleSelectSubPhase(idx as SubPhaseIndex)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                      isSubActive
                        ? "bg-emerald-600 text-white shadow-2xs"
                        : idx < subPhase
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {idx + 1}. {sp.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-1 w-full bg-slate-100 overflow-hidden" aria-hidden="true">
            <div
              key={`bar-${activeIndex}-${subPhase}-${cycleKey}`}
              className="h-full bg-emerald-600 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Moldura Fiel do App Shell Interativo */}
          <div className="p-3 sm:p-5 bg-slate-100/80">
            <div className="rounded-xl border border-slate-300 bg-slate-50 shadow-md overflow-hidden">
              {/* Barra Superior da Janela do Navegador */}
              <div className="h-8 px-3 bg-slate-200/90 border-b border-slate-300 flex items-center justify-between text-[11px] text-slate-600">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
                <span className="font-semibold text-slate-700 truncate px-2">
                  Rede Ativa — Colégio Estadual Exemplo
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 text-[10px] font-bold text-slate-700 border border-slate-300">
                  Simulação demonstrativa
                </span>
              </div>

              {/* Corpo do App Shell: Mini Sidebar + Mini TopHeader + Palco Interativo */}
              <div className="flex min-h-[445px] sm:min-h-[470px]">
                {/* Mini Sidebar Lateral Esquerda */}
                <aside
                  aria-label="Menu lateral da simulação"
                  className="hidden md:flex w-52 shrink-0 flex-col bg-slate-900 text-slate-100 border-r border-slate-800"
                >
                  <div className="h-12 px-3 border-b border-slate-800 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center p-0.5 shrink-0">
                      <GraduationCap className="w-4 h-4 text-sky-700" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-bold text-white text-[11px] leading-tight block truncate">
                        Colégio Estadual Exemplo
                      </span>
                      <span className="text-[9px] text-sky-400 font-semibold uppercase tracking-wider block truncate">
                        Rede de Ensino
                      </span>
                    </div>
                  </div>

                  <nav className="flex-1 p-2 space-y-1">
                    {SIDEBAR_ITEMS.filter(
                      (item) => item.id !== "treinamento" || showPilotStep
                    ).map((item) => {
                      const Icon = item.icon;
                      const isActive = item.id === currentStep.activeSidebar;
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition-colors ${
                            isActive
                              ? "bg-sky-600 text-white shadow-sm font-bold"
                              : "text-slate-400"
                          }`}
                        >
                          <Icon
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isActive ? "text-white" : "text-slate-400"
                            }`}
                            aria-hidden={true}
                          />
                          <span className="truncate">{item.label}</span>
                        </div>
                      );
                    })}
                  </nav>

                  <div className="p-2.5 border-t border-slate-800 text-[10px] text-slate-400">
                    Equipe Pedagógica (Exemplo)
                  </div>
                </aside>

                {/* Área Principal: Mini TopHeader + Palco Relativo com Rastreamento DOM */}
                <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
                  <div className="min-h-12 px-3 sm:px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 min-w-0">
                      <GraduationCap
                        className="w-3.5 h-3.5 text-sky-600 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="hidden sm:inline truncate">
                        Colégio Estadual Exemplo — Ensino Médio e Fundamental
                      </span>
                      <span className="text-slate-300 hidden sm:inline">/</span>
                      <span className="text-slate-800 font-bold truncate">
                        {currentStep.headerTitle}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-800">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"
                          aria-hidden="true"
                        />
                        {currentSubPhase.actionLabel}
                      </span>
                    </div>
                  </div>

                  {/* Palco Relativo das Telas + Cursor Virtual Ancorado ao DOM */}
                  <div ref={stageRef} className={`relative flex-1 p-3 sm:p-4 overflow-hidden ${isPublic ? styles.stage : ""}`}>
                    <VirtualCursor
                      x={cursorPos.x}
                      y={cursorPos.y}
                      unit={cursorPos.unit}
                      cursorState={cursorState}
                    />

                    {currentStep.id === 1 && (
                      <StageOneReplica
                        subPhase={subPhase}
                        cursorState={cursorState}
                        actionCommitted={actionCommitted}
                        activeTargetId={activeTargetId}
                      />
                    )}
                    {currentStep.id === 2 && (
                      <StageTwoReplica
                        subPhase={subPhase}
                        cursorState={cursorState}
                        actionCommitted={actionCommitted}
                        activeTargetId={activeTargetId}
                      />
                    )}
                    {currentStep.id === 3 && (
                      <StageThreeReplica
                        subPhase={subPhase}
                        cursorState={cursorState}
                        actionCommitted={actionCommitted}
                        activeTargetId={activeTargetId}
                      />
                    )}
                    {currentStep.id === 4 && (
                      <StageFourReplica
                        subPhase={subPhase}
                        cursorState={cursorState}
                        actionCommitted={actionCommitted}
                        activeTargetId={activeTargetId}
                      />
                    )}
                    {currentStep.id === 5 && (
                      <StageFiveReplica
                        subPhase={subPhase}
                        cursorState={cursorState}
                        actionCommitted={actionCommitted}
                        activeTargetId={activeTargetId}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Rodapé discreto da simulação */}
          <div className="px-4 sm:px-6 py-2 bg-slate-50/70 border-t border-slate-200/80 flex items-center justify-end">
            <span className="text-[11px] text-slate-400">
              Simulação demonstrativa • Dados fictícios
            </span>
          </div>
        </>
      )}
    </section>
  );
}

interface StageReplicaProps {
  subPhase: SubPhaseIndex;
  cursorState: CursorState;
  actionCommitted: boolean;
  activeTargetId: string;
}

function VirtualCursor({
  x,
  y,
  unit,
  cursorState,
}: {
  x: number;
  y: number;
  unit: "px" | "%";
  cursorState: CursorState;
}) {
  const isClicking = cursorState === "clicking";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-50"
      style={{
        left: `${x}${unit}`,
        top: `${y}${unit}`,
        transition:
          "left 600ms cubic-bezier(0.22, 1, 0.36, 1), top 600ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div className="relative">
        {isClicking && (
          <>
            <span className="sim-click-ripple absolute left-0 top-0 w-8 h-8 rounded-full border-2 border-cyan-400 bg-emerald-400/30" />
            <span
              className="sim-click-ripple absolute left-0 top-0 w-8 h-8 rounded-full border-2 border-emerald-400 bg-sky-400/25"
              style={{ animationDelay: "110ms" }}
            />
          </>
        )}
        <svg
          viewBox="0 0 24 24"
          className={`w-6 h-6 -translate-x-[4px] -translate-y-[3px] drop-shadow-md transition-transform duration-150 ${
            isClicking ? "scale-[0.85]" : "scale-100"
          }`}
          fill="none"
        >
          <path
            d="M4 3L19 11.5L12.2 13.4L9.2 20L4 3Z"
            fill="#0f172a"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function getButtonHighlight(
  targetId: string,
  activeTargetId: string,
  cursorState: CursorState
): string {
  if (targetId !== activeTargetId) return "";
  if (cursorState === "clicking") {
    return "sim-focus-neon scale-[0.96] brightness-110";
  }
  return "sim-focus-neon";
}

/* ============================================================================
 * ETAPA 1: Réplica de AlunosClient + SereImportModal
 * ========================================================================== */
function StageOneReplica({
  subPhase,
  cursorState,
  actionCommitted,
  activeTargetId,
}: StageReplicaProps) {
  const modalOpen =
    (subPhase === 0 && actionCommitted) ||
    subPhase === 1 ||
    subPhase === 2 ||
    (subPhase === 3 && !actionCommitted);

  const fileLoaded = (subPhase === 1 && actionCommitted) || subPhase >= 2;
  const countersSeparated = (subPhase === 2 && actionCommitted) || subPhase >= 3;
  const isUpdated = (subPhase === 3 && actionCommitted) || subPhase === 4;

  return (
    <div className="relative h-full space-y-3">
      {/* Toast de Sucesso */}
      <div
        role="status"
        className={`absolute top-1 right-1 z-30 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-md transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isUpdated
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Turmas e faltas atualizadas.</span>
      </div>

      {/* Cabeçalho da tela Estudantes e Turmas */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 ${
          modalOpen ? "sim-card-dimmed" : ""
        }`}
      >
        <div>
          <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-sky-600" aria-hidden="true" />
            <span>Estudantes e Turmas</span>
          </h4>
          <span className="text-[11px] text-slate-500">
            {isUpdated ? "64 estudantes ativos em 2 turmas" : "58 estudantes ativos em 2 turmas"}
          </span>
        </div>

        <button
          type="button"
          tabIndex={-1}
          data-sim-target="btn-import-sheet"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 shadow-xs transition-all duration-200 ${getButtonHighlight(
            "btn-import-sheet",
            activeTargetId,
            cursorState
          )}`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Importar planilha</span>
        </button>
      </div>

      {/* Barra de Filtros */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] ${
          modalOpen ? "sim-card-dimmed" : ""
        }`}
      >
        <div className="relative sm:col-span-2">
          <Search
            className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2"
            aria-hidden="true"
          />
          <div className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-400">
            Buscar por estudante, matrícula ou responsável...
          </div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700">
          Turmas: 1º Ano A, 2º Ano B
        </div>
      </div>

      {/* Tabela de Estudantes */}
      <div
        className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${
          modalOpen ? "sim-card-dimmed" : ""
        }`}
      >
        <div className="grid grid-cols-12 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
          <span className="col-span-4">Estudante</span>
          <span className="col-span-3">Turma e turno</span>
          <span className="col-span-3">Responsável legal</span>
          <span className="col-span-2 text-right">Situação</span>
        </div>

        <div className="divide-y divide-slate-100 text-[11px]">
          <div
            data-sim-target="row-student-lucas"
            className={`grid grid-cols-12 items-center px-3 py-2.5 rounded-lg transition-all duration-300 ${
              activeTargetId === "row-student-lucas"
                ? `bg-sky-50/70 ${getButtonHighlight(
                    "row-student-lucas",
                    activeTargetId,
                    cursorState
                  )}`
                : ""
            }`}
          >
            <span className="col-span-4 font-bold text-slate-900">Lucas Mendes</span>
            <span className="col-span-3 text-slate-600">1º Ano A • Manhã</span>
            <span className="col-span-3 text-slate-600">Helena Mendes</span>
            <span className="col-span-2 text-right">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                  isUpdated
                    ? "bg-rose-100 text-rose-800 border border-rose-200"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {isUpdated ? "Faltas consecutivas" : "Em análise"}
              </span>
            </span>
          </div>

          <div className="grid grid-cols-12 items-center px-3 py-2.5">
            <span className="col-span-4 font-bold text-slate-900">Ana Clara Souza</span>
            <span className="col-span-3 text-slate-600">1º Ano A • Manhã</span>
            <span className="col-span-3 text-slate-600">Marcos Souza</span>
            <span className="col-span-2 text-right">
              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                Atestado vigente
              </span>
            </span>
          </div>

          <div className="grid grid-cols-12 items-center px-3 py-2.5">
            <span className="col-span-4 font-bold text-slate-900">Rafael Oliveira</span>
            <span className="col-span-3 text-slate-600">2º Ano B • Tarde</span>
            <span className="col-span-3 text-slate-600">Patrícia Oliveira</span>
            <span className="col-span-2 text-right">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  isUpdated
                    ? "bg-amber-100 text-amber-800 border border-amber-200"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {isUpdated ? "Faltas alternadas" : "Matriculado"}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Modal de Importação sempre montado para transição elástica sem cortes */}
      <div
        aria-hidden={!modalOpen}
        className={`absolute inset-0 z-20 flex items-center justify-center bg-slate-900/35 p-2 sm:p-4 transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          modalOpen
            ? "opacity-100 scale-100"
            : "opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div className="sim-card-spotlight w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span className="text-xs font-extrabold text-slate-900">
                Importação de matrículas e atualização de faltas
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-800">
              Planilha compatível
            </span>
          </div>

          {/* Área de upload */}
          <div
            data-sim-target="upload-dropzone"
            className={`rounded-xl border-2 border-dashed p-3 flex items-center justify-between gap-2 transition-all duration-300 ${
              fileLoaded
                ? "border-emerald-300 bg-emerald-50/40"
                : "border-slate-300 bg-slate-50"
            } ${getButtonHighlight("upload-dropzone", activeTargetId, cursorState)}`}
          >
            <div
              className={`flex items-center gap-2 transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                fileLoaded ? "opacity-100 translate-y-0" : "opacity-60 -translate-y-1"
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Upload className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="text-[11px]">
                <p className="font-bold text-slate-900">relatorio_turmas_faltas.csv</p>
                <p className="text-[10px] text-slate-600">
                  {fileLoaded ? "Arquivo compatível carregado" : "Pronto para leitura do arquivo"}
                </p>
              </div>
            </div>
            <CheckCircle2
              className={`w-4 h-4 shrink-0 transition-opacity ${
                fileLoaded ? "text-emerald-600 opacity-100" : "text-slate-300 opacity-40"
              }`}
              aria-hidden="true"
            />
          </div>

          {/* Barra de leitura + dois cards separados em destaque */}
          <div
            data-sim-target="counters-split"
            className={`space-y-2 rounded-xl p-2 transition-all duration-300 ${
              activeTargetId === "counters-split"
                ? `sim-card-spotlight bg-sky-50/40 ${getButtonHighlight(
                    "counters-split",
                    activeTargetId,
                    cursorState
                  )}`
                : ""
            }`}
          >
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-600">
              <span>Leitura do arquivo</span>
              <span>{countersSeparated ? "100%" : fileLoaded ? "45%" : "0%"}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-700"
                style={{
                  width: countersSeparated ? "100%" : fileLoaded ? "45%" : "0%",
                }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div
                className={`rounded-lg border border-sky-200 bg-sky-50/70 p-2.5 transition-all duration-300 ${
                  countersSeparated ? "sim-card-spotlight" : ""
                }`}
              >
                <span className="text-[10px] font-bold text-sky-900 block">
                  Matrículas por turma (1º Ano A, 2º Ano B)
                </span>
                <span className="text-base font-extrabold text-sky-700">
                  {countersSeparated ? "64 estudantes" : "..."}
                </span>
              </div>
              <div
                className={`rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 transition-all duration-300 ${
                  countersSeparated ? "sim-card-spotlight" : ""
                }`}
              >
                <span className="text-[10px] font-bold text-amber-900 block">
                  Atualização de faltas consecutivas e alternadas
                </span>
                <span className="text-base font-extrabold text-amber-700">
                  {countersSeparated ? "9 atualizações" : "..."}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <span className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600">
              Cancelar
            </span>
            <button
              type="button"
              tabIndex={-1}
              data-sim-target="btn-confirm-import"
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 transition-all duration-200 ${getButtonHighlight(
                "btn-confirm-import",
                activeTargetId,
                cursorState
              )}`}
            >
              Confirmar importação
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * ETAPA 2: Réplica de BuscaAtivaClient + WhatsApp + WhatsAppReplyCaptureModal
 * ========================================================================== */
function StageTwoReplica({
  subPhase,
  cursorState,
  actionCommitted,
  activeTargetId,
}: StageReplicaProps) {
  const showWhatsAppWindow = (subPhase === 1 && actionCommitted) || subPhase === 2;
  const showReplyModal = subPhase === 3 || (subPhase === 4 && !actionCommitted);
  const isRegistered = subPhase === 4 && actionCommitted;
  const replyArrived = (subPhase === 2 && actionCommitted) || subPhase >= 3;

  return (
    <div className="relative h-full space-y-3">
      <div
        role="status"
        className={`absolute top-1 right-1 z-30 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-md transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isRegistered
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Tentativa de contato registrada.</span>
      </div>

      <div
        className={`grid grid-cols-1 lg:grid-cols-12 gap-3 h-full ${
          showReplyModal ? "sim-card-dimmed" : ""
        }`}
      >
        {/* Coluna Esquerda: Fila da Turma */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-900">1º Ano A — Manhã</span>
            <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 text-[10px] font-bold">
              Fila da turma
            </span>
          </div>

          {/* Ana Clara: Destaque esmeralda mostrando proteção contra cobrança indevida */}
          <div className="p-2.5 rounded-lg border border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50/70 flex items-center justify-between gap-2 shadow-2xs">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-slate-800 truncate">Ana Clara Souza</p>
              <p className="text-[10px] text-emerald-800 font-medium">
                Preservada na fila por justificativa
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[10px] font-bold shrink-0 shadow-2xs">
              Atestado vigente
            </span>
          </div>

          {/* Lucas Mendes: Alvo em foco */}
          <div
            data-sim-target="row-student-lucas"
            className={`p-2.5 rounded-lg border-2 border-sky-500 bg-sky-50/70 flex items-center justify-between gap-2 transition-all duration-300 ${
              subPhase === 0 ? "sim-card-spotlight" : ""
            } ${getButtonHighlight("row-student-lucas", activeTargetId, cursorState)}`}
          >
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold text-slate-900 truncate">
                Lucas Mendes (3 faltas consecutivas)
              </p>
              <p className="text-[10px] text-slate-600">Responsável: Helena Mendes</p>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                isRegistered
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                  : "bg-amber-100 text-amber-800 border border-amber-200"
              }`}
            >
              {isRegistered ? "Registrado" : "Pendente"}
            </span>
          </div>

          {/* Toggle Redução da exposição de conversas na tela */}
          <div
            className={`pt-2 border-t border-slate-100 space-y-1.5 rounded-lg p-1.5 transition-all duration-300 ${
              subPhase === 1 ? "sim-card-spotlight bg-teal-50/50" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-teal-800">
              <span className="inline-flex items-center gap-1">
                <EyeOff className="w-3 h-3 text-teal-600" aria-hidden="true" />
                <span>Redução da exposição de conversas na tela</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-teal-600 text-white text-[9px]">
                Ativo
              </span>
            </div>
            <div className="p-2 rounded bg-slate-100 text-[10px] text-slate-500 blur-[3px] select-none">
              Conversa lateral ocultada durante o atendimento
            </div>
          </div>
        </div>

        {/* Coluna Direita: Painel de Mensagem / Janela WhatsApp */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-3 flex flex-col justify-between gap-3">
          {showWhatsAppWindow ? (
            <div className="sim-sheet-slide rounded-xl border border-emerald-300 bg-emerald-50/30 overflow-hidden flex-1 flex flex-col">
              <div className="px-3 py-2 bg-emerald-700 text-white flex items-center justify-between text-[11px]">
                <span className="font-bold">Janela assistida do WhatsApp • Helena Mendes</span>
                <span className="text-[10px] text-emerald-100">Contato conferido</span>
              </div>
              <div className="p-3 space-y-2.5 flex-1 bg-slate-100/70">
                <div className="sim-chat-bubble ml-auto max-w-[85%] rounded-xl rounded-tr-none bg-emerald-100 border border-emerald-200 p-2.5 text-[11px] text-slate-800 shadow-2xs">
                  <p>
                    Bom dia, Helena. Notamos 3 faltas consecutivas de Lucas Mendes (1º Ano A) e
                    gostaríamos de saber como ele está.
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-emerald-800">
                    <span>08:42</span>
                    <CheckCheck className="w-3 h-3 text-sky-600" aria-hidden="true" />
                  </div>
                </div>

                {!replyArrived && (
                  <div className="flex items-center gap-1 px-2.5 py-1.5 w-fit rounded-full bg-white border border-slate-200 text-[10px] text-slate-500">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-slate-400"
                      style={{ animation: "simTypingDot 1s infinite 0ms" }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-slate-400"
                      style={{ animation: "simTypingDot 1s infinite 180ms" }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-slate-400"
                      style={{ animation: "simTypingDot 1s infinite 360ms" }}
                    />
                  </div>
                )}

                <div
                  data-sim-target="whatsapp-reply-bubble"
                  className={`max-w-[88%] rounded-xl rounded-tl-none bg-white border border-slate-200 p-2.5 text-[11px] text-slate-800 transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    replyArrived
                      ? "opacity-100 translate-y-0 sim-card-spotlight"
                      : "opacity-35 translate-y-1"
                  } ${getButtonHighlight(
                    "whatsapp-reply-bubble",
                    activeTargetId,
                    cursorState
                  )}`}
                >
                  <p className="font-semibold text-slate-900">
                    &ldquo;Bom dia! Ele teve febre ontem, mas retorna amanhã sem falta.&rdquo;
                  </p>
                  <span className="text-[9px] text-slate-400 block mt-1">
                    08:44 • Helena Mendes
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-900">
                    Mensagem preparada para o responsável legal
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
                    Revisão humana
                  </span>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700 leading-relaxed">
                  &ldquo;Bom dia, Helena. Notamos 3 faltas consecutivas de Lucas Mendes (1º Ano A) e
                  gostaríamos de saber se está tudo bem com o estudante.&rdquo;
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-500">
                  A equipe confere destinatário e texto antes do envio
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  data-sim-target="btn-review-send"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 transition-all duration-200 ${getButtonHighlight(
                    "btn-review-send",
                    activeTargetId,
                    cursorState
                  )}`}
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Revisar e enviar</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal de Registro de Atendimento sempre montado para transição elástica */}
      <div
        aria-hidden={!showReplyModal}
        className={`absolute inset-0 z-20 flex items-center justify-center bg-slate-900/35 p-2 sm:p-4 transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          showReplyModal
            ? "opacity-100 scale-100"
            : "opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div className="sim-card-spotlight w-full max-w-md rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-extrabold text-slate-900">
              Registrar retorno da família • Lucas Mendes
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-800">
              Conferência da equipe
            </span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-700">
            <span className="text-[10px] font-bold text-slate-500 block mb-0.5">
              Resposta recebida:
            </span>
            &ldquo;Bom dia! Ele teve febre ontem, mas retorna amanhã sem falta.&rdquo;
          </div>

          <div
            data-sim-target="reply-category-card"
            className={`rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5 text-[11px] transition-all duration-300 ${
              activeTargetId === "reply-category-card"
                ? `sim-card-spotlight ${getButtonHighlight(
                    "reply-category-card",
                    activeTargetId,
                    cursorState
                  )}`
                : ""
            }`}
          >
            <span className="text-[10px] font-bold text-emerald-800 block">
              Sugestão de classificação (editável pela equipe pedagógica):
            </span>
            <span className="font-bold text-emerald-950">
              Motivo de saúde — Retorno previsto
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <span className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600">
              Editar
            </span>
            <button
              type="button"
              tabIndex={-1}
              data-sim-target="btn-save-reply"
              className={`px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold transition-all duration-200 ${getButtonHighlight(
                "btn-save-reply",
                activeTargetId,
                cursorState
              )}`}
            >
              Salvar registro
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * ETAPA 3: Réplica de AtaEditorModal + SignatureCanvas + SigningPinModal
 * ========================================================================== */
function StageThreeReplica({
  subPhase,
  cursorState,
  actionCommitted,
  activeTargetId,
}: StageReplicaProps) {
  const draftVisible = (subPhase === 0 && actionCommitted) || subPhase >= 1;
  const isSignatureOpen = (subPhase === 2 && actionCommitted) || subPhase >= 3;
  const isPinModalOpen = subPhase === 3 && actionCommitted;
  const isConfirmed = subPhase === 4;

  const visibleDraftChars = !draftVisible
    ? 0
    : subPhase === 1 && !actionCommitted
      ? Math.floor(DRAFT_MINUTE_TEXT.length * 0.72)
      : DRAFT_MINUTE_TEXT.length;

  return (
    <div className="relative h-full">
      <div
        className={`rounded-xl border border-slate-200 bg-white shadow-xs p-3.5 space-y-3 h-full flex flex-col justify-between ${
          isPinModalOpen ? "sim-card-dimmed" : ""
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="w-4 h-4 text-teal-600" aria-hidden="true" />
            <span className="text-xs font-extrabold text-slate-900">
              Ata Pedagógica • Atendimento presencial (Lucas Mendes)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                isConfirmed
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
            >
              {isConfirmed ? "Confirmada" : "Minuta em revisão"}
            </span>

            <button
              type="button"
              tabIndex={-1}
              data-sim-target="btn-generate-draft"
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-teal-600 transition-all duration-200 ${getButtonHighlight(
                "btn-generate-draft",
                activeTargetId,
                cursorState
              )}`}
            >
              Gerar minuta
            </button>
          </div>
        </div>

        {/* Campo de Texto com Brilho Progressivo */}
        <div
          data-sim-target="ata-draft-box"
          className={`rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-800 space-y-1.5 transition-all duration-300 ${
            activeTargetId === "ata-draft-box"
              ? `sim-card-spotlight bg-teal-50/40 ${getButtonHighlight(
                  "ata-draft-box",
                  activeTargetId,
                  cursorState
                )}`
              : ""
          }`}
        >
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-bold text-slate-600">Texto da ata pedagógica</span>
            <span className="text-teal-700 font-semibold">
              Revisão humana pela pedagoga
            </span>
          </div>
          <p className="min-h-[42px] leading-relaxed text-slate-700">
            {visibleDraftChars > 0
              ? DRAFT_MINUTE_TEXT.slice(0, visibleDraftChars)
              : "Aguardando geração da minuta a partir do relato registrado..."}
          </p>
        </div>

        {/* Área de Assinatura + QR Code + Confirmação */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          <div
            data-sim-target="canvas-signature"
            className={`sm:col-span-7 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-2 transition-all duration-300 ${
              isSignatureOpen && subPhase === 2 ? "sim-card-spotlight" : ""
            }`}
          >
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-bold text-slate-700">
                Assinatura do responsável legal (Helena Mendes)
              </span>
              <button
                type="button"
                tabIndex={-1}
                data-sim-target="btn-collect-signature"
                className={`px-2 py-0.5 rounded font-bold bg-white border border-slate-300 text-slate-700 transition-all duration-200 ${getButtonHighlight(
                  "btn-collect-signature",
                  activeTargetId,
                  cursorState
                )}`}
              >
                Coletar assinatura
              </button>
            </div>

            {isSignatureOpen ? (
              <div className="flex items-center gap-2.5">
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <QrCode className="w-8 h-8 text-slate-800" aria-hidden="true" />
                </div>
                <div className="flex-1 h-12 rounded-lg border border-dashed border-slate-300 bg-white flex items-center px-2 overflow-hidden">
                  <svg viewBox="0 0 220 44" className="w-full h-10" fill="none" aria-hidden="true">
                    <path
                      d="M12 30 C 24 8, 36 34, 48 18 C 60 6, 72 34, 92 22 C 110 12, 128 32, 148 20 C 166 10, 184 28, 206 16"
                      stroke="#0f172a"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      className="sim-signature-path"
                    />
                  </svg>
                </div>
                <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              </div>
            ) : (
              <div className="h-12 rounded-lg border border-dashed border-slate-300 bg-white/70 flex items-center justify-center text-[10px] text-slate-400">
                Presencial ou no celular via QR Code
              </div>
            )}
          </div>

          <div className="sm:col-span-5 flex flex-col justify-between gap-2">
            <div
              data-sim-target="ata-post-confirm-notice"
              className={`rounded-xl border p-2.5 text-[10px] leading-snug transition-all duration-300 ${
                isConfirmed
                  ? `border-amber-300 bg-amber-50/90 text-amber-950 font-medium sim-card-spotlight ${getButtonHighlight(
                      "ata-post-confirm-notice",
                      activeTargetId,
                      cursorState
                    )}`
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              {isConfirmed
                ? "Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico."
                : "Separação entre registro do responsável legal, confirmação da servidora e verificação de integridade."}
            </div>

            <button
              type="button"
              tabIndex={-1}
              data-sim-target="btn-confirm-pin"
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold text-white transition-all duration-200 ${
                isConfirmed ? "bg-emerald-700" : "bg-slate-900"
              } ${getButtonHighlight("btn-confirm-pin", activeTargetId, cursorState)}`}
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isConfirmed ? "Autoria confirmada" : "Confirmar PIN"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mini-modal SigningPinModal com 4 indicadores iluminados */}
      <div
        aria-hidden={!isPinModalOpen}
        className={`absolute inset-0 z-20 flex items-center justify-center bg-slate-900/35 p-3 transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isPinModalOpen
            ? "opacity-100 scale-100"
            : "opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div className="sim-card-spotlight w-full max-w-xs rounded-2xl bg-white border border-slate-200 p-4 space-y-3 text-center">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto">
            <KeyRound className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h5 className="text-xs font-extrabold text-slate-900">
              Confirmação de autoria por PIN
            </h5>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Informe o PIN da servidora para confirmar a ata
            </p>
          </div>

          <div className="flex items-center justify-center gap-2.5 py-1">
            {[0, 1, 2, 3].map((dotIdx) => (
              <div
                key={dotIdx}
                className={`w-9 h-10 rounded-xl border-2 border-emerald-500 bg-emerald-50/50 flex items-center justify-center ${
                  isPinModalOpen ? "sim-focus-neon" : ""
                }`}
              >
                {isPinModalOpen && (
                  <span
                    className="sim-pin-dot w-2.5 h-2.5 rounded-full bg-slate-900"
                    style={{ animationDelay: `${dotIdx * 180}ms` }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * ETAPA 4: Réplica de ProntuarioClient + DossieClient
 * ========================================================================== */
function StageFourReplica({
  subPhase,
  cursorState,
  actionCommitted,
  activeTargetId,
}: StageReplicaProps) {
  const highlightSeparation = subPhase >= 1;
  const showA4Sheet = (subPhase === 2 && actionCommitted) || subPhase >= 3;
  const isPdfGenerated = subPhase === 4 && actionCommitted;

  return (
    <div className="relative h-full space-y-3">
      <div
        role="status"
        className={`absolute top-1 right-1 z-30 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-md transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isPdfGenerated
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Relatório gerado.</span>
      </div>

      {/* Cabeçalho do Prontuário / Histórico */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div>
          <h4 className="text-sm font-extrabold text-slate-900">
            Histórico de Acompanhamento Pedagógico • Lucas Mendes
          </h4>
          <span className="text-[11px] text-slate-500">
            1º Ano A • Manhã • Linha do tempo unificada
          </span>
        </div>

        <button
          type="button"
          tabIndex={-1}
          data-sim-target="btn-generate-report"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-slate-900 transition-all duration-200 ${getButtonHighlight(
            "btn-generate-report",
            activeTargetId,
            cursorState
          )}`}
        >
          <Printer className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
          <span>Gerar relatório</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Linha do Tempo */}
        <div
          className={`${
            showA4Sheet ? "lg:col-span-6" : "lg:col-span-12"
          } space-y-2 transition-all duration-300`}
        >
          <div
            data-sim-target="timeline-facts-card"
            className={`p-2.5 rounded-xl border bg-white text-[11px] transition-all duration-300 ${
              highlightSeparation || activeTargetId === "timeline-facts-card"
                ? "border-sky-300 bg-gradient-to-r from-sky-50/60 to-cyan-50/40 sim-card-spotlight"
                : "border-slate-200"
            } ${getButtonHighlight("timeline-facts-card", activeTargetId, cursorState)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900">
                Tentativa de contato • WhatsApp assistido
              </span>
              <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 text-[10px] font-bold">
                Fatos registrados
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Fonte: Painel escolar • Data: 14/11 08:42 • Autoria: Equipe pedagógica
            </p>
          </div>

          <div
            data-sim-target="timeline-reports-card"
            className={`p-2.5 rounded-xl border bg-white text-[11px] transition-all duration-300 ${
              highlightSeparation
                ? "border-amber-300 bg-gradient-to-r from-amber-50/70 to-emerald-50/50 sim-card-spotlight"
                : "border-slate-200"
            } ${getButtonHighlight("timeline-reports-card", activeTargetId, cursorState)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900">
                Retorno e justificativa informada pela família
              </span>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                Relatos e justificativas da família
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Fonte: Helena Mendes • Data: 14/11 08:44 • Revisado por: Coordenação
            </p>
          </div>

          <div
            className={`p-2.5 rounded-xl border border-slate-200 bg-white text-[11px] transition-all duration-300 ${
              highlightSeparation ? "sim-card-spotlight border-emerald-200" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900 flex flex-wrap items-center gap-1.5">
                <span>Ata pedagógica confirmada • Menção a</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold">
                  M. S. (protegido)
                </span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[10px] font-bold">
                <ShieldAlert className="w-3 h-3" aria-hidden="true" />
                Confirmada
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Fonte: Ata presencial • Data: 14/11 10:15 • Autoria: Direção e Pedagoga
            </p>
          </div>
        </div>

        {/* Folha A4 Estilizada */}
        {showA4Sheet && (
          <div
            data-sim-target="a4-report-sheet"
            className={`lg:col-span-6 sim-sheet-slide rounded-xl border-2 border-slate-800 bg-white p-3.5 space-y-2.5 ${
              subPhase === 3 ? "sim-card-spotlight" : "shadow-md"
            } ${getButtonHighlight("a4-report-sheet", activeTargetId, cursorState)}`}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div>
                <p className="text-[11px] font-extrabold text-slate-900 uppercase">
                  Relatório de Contatos e Intervenções
                </p>
                <p className="text-[10px] text-slate-500">
                  Colégio Estadual Exemplo • Folha A4
                </p>
              </div>
              <button
                type="button"
                tabIndex={-1}
                data-sim-target="btn-download-pdf"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold text-white bg-emerald-600 transition-all duration-200 ${getButtonHighlight(
                  "btn-download-pdf",
                  activeTargetId,
                  cursorState
                )}`}
              >
                <FileDown className="w-3 h-3" aria-hidden="true" />
                <span>Baixar PDF</span>
              </button>
            </div>

            <div className="space-y-1.5 text-[10px] text-slate-700">
              <p>
                <strong>Estudante:</strong> Lucas Mendes (1º Ano A)
              </p>
              <p>
                <strong>Registros incluídos:</strong> 1 tentativa de contato, 1 relato familiar e 1
                ata pedagógica com assinaturas registradas.
              </p>
              <p className="p-2 rounded bg-slate-50 border border-slate-200 text-slate-600">
                O arquivo exportável subsidia encaminhamentos conforme os procedimentos da rede e do
                órgão destinatário.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * ETAPA 5 CONDICIONAL: Janela Compacta da Unidade Piloto (PILOTO_INTEGRADA)
 * ========================================================================== */
function StageFiveReplica({
  subPhase,
  cursorState,
  actionCommitted,
  activeTargetId,
}: StageReplicaProps) {
  const showCompactWindow = (subPhase === 1 && actionCommitted) || subPhase >= 2;
  const replyCaptured = (subPhase === 3 && actionCommitted) || subPhase === 4;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 h-full">
      <div
        data-sim-target="pilot-panel-card"
        className={`lg:col-span-6 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 transition-all duration-300 ${
          activeTargetId === "pilot-panel-card" ? "sim-card-spotlight" : ""
        } ${getButtonHighlight("pilot-panel-card", activeTargetId, cursorState)}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-900">
            Painel da Unidade Piloto
          </span>
          <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 text-[10px] font-bold border border-sky-200">
            Edição Piloto
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] space-y-1">
          <p className="font-bold text-slate-800">Lucas Mendes • 1º Ano A</p>
          <p className="text-slate-600">
            {replyCaptured
              ? "Retorno capturado para conferência da equipe."
              : "Aguardando abertura na janela dedicada compacta."}
          </p>
        </div>

        <button
          type="button"
          tabIndex={-1}
          data-sim-target="btn-open-compact"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-sky-600 transition-all duration-200 ${getButtonHighlight(
            "btn-open-compact",
            activeTargetId,
            cursorState
          )}`}
        >
          <AppWindow className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Abrir janela compacta</span>
        </button>
      </div>

      <div className="lg:col-span-6 flex items-center justify-center">
        <div
          data-sim-target="compact-window-card"
          className={`w-full max-w-[280px] rounded-2xl border-2 border-slate-800 bg-white overflow-hidden transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
            showCompactWindow
              ? "opacity-100 translate-x-0 scale-100 sim-card-spotlight"
              : "opacity-45 translate-x-2 scale-95"
          } ${getButtonHighlight("compact-window-card", activeTargetId, cursorState)}`}
        >
          <div className="px-3 py-2 bg-slate-900 text-white flex items-center justify-between text-[10px]">
            <span className="font-bold">Janela Compacta (480x760)</span>
            <span className="text-emerald-400 font-semibold">Isolada</span>
          </div>
          <div className="p-3 space-y-2.5 text-[11px]">
            <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[10px] font-semibold">
              Conversa isolada sem exibir lista lateral de contatos pessoais
            </div>
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
              &ldquo;Bom dia! Ele retorna amanhã.&rdquo;
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-500">Revisão humana ativa</span>
              <button
                type="button"
                tabIndex={-1}
                data-sim-target="btn-capture-compact"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-white bg-emerald-600 transition-all duration-200 ${getButtonHighlight(
                  "btn-capture-compact",
                  activeTargetId,
                  cursorState
                )}`}
              >
                <Check className="w-3 h-3" aria-hidden="true" />
                <span>{replyCaptured ? "Confirmado" : "Capturar"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
