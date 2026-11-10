'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  Send,
  MessageSquare,
  CheckCheck,
  Clock,
  ShieldCheck,
  FileText,
  Play,
  Pause,
  ArrowRight,
  Check,
  AlertCircle,
  RotateCcw,
  Sparkles,
  Building2,
  Lock,
  FileCheck2,
  QrCode,
  Scale,
  Award,
  Zap,
} from 'lucide-react';

export interface MasterActTab {
  id: number;
  label: string;
  tagline: string;
  targetPhase: number;
}

const MASTER_ACT_TABS: readonly MasterActTab[] = [
  {
    id: 0,
    label: '1. Busca Ativa WhatsApp',
    tagline: 'Disparo nominal em 1 clique',
    targetPhase: 0,
  },
  {
    id: 1,
    label: '2. Livro de Atas & PIN',
    tagline: 'Lavratura com fé pública',
    targetPhase: 3,
  },
  {
    id: 2,
    label: '3. Dossiê ECA em 1 Clique',
    tagline: 'Comprovação para Conselho Tutelar',
    targetPhase: 8,
  },
] as const;

interface MasterPhaseConfig {
  phase: number;
  actIndex: number;
  duration: number; // ms
  name: string;
  route: string;
}

// Timeline contínua de ~18s com micro-fases coreografadas
const MASTER_PHASES: readonly MasterPhaseConfig[] = [
  // --- ATO 1: BUSCA ATIVA WHATSAPP (~5.0s) ---
  {
    phase: 0,
    actIndex: 0,
    duration: 1600,
    name: 'Ato 1 • Alerta de Infrequência',
    route: '/busca-ativa',
  },
  {
    phase: 1,
    actIndex: 0,
    duration: 1200,
    name: 'Ato 1 • Disparo em 1 Clique',
    route: '/busca-ativa',
  },
  {
    phase: 2,
    actIndex: 0,
    duration: 2200,
    name: 'Ato 1 • Recibo SHA-256',
    route: 'SHA-256 & Fé Pública',
  },

  // --- ATO 2: LIVRO DE ATAS & PIN (~6.3s) ---
  {
    phase: 3,
    actIndex: 1,
    duration: 1500,
    name: 'Ato 2 • Livro de Atas',
    route: '/atas/042-2026',
  },
  {
    phase: 4,
    actIndex: 1,
    duration: 1000,
    name: 'Ato 2 • Assinatura da Servidora',
    route: '/atas/042-2026',
  },
  {
    phase: 5,
    actIndex: 1,
    duration: 800,
    name: 'Ato 2 • Digitação do PIN (Parte 1)',
    route: '/atas/042-2026',
  },
  {
    phase: 6,
    actIndex: 1,
    duration: 800,
    name: 'Ato 2 • Digitação do PIN (Parte 2)',
    route: '/atas/042-2026',
  },
  {
    phase: 7,
    actIndex: 1,
    duration: 2200,
    name: 'Ato 2 • Fé Pública e QR Code',
    route: 'Lei nº 14.063/2020',
  },

  // --- ATO 3: DOSSIÊ ECA EM 1 CLIQUE (~6.9s) ---
  {
    phase: 8,
    actIndex: 2,
    duration: 1500,
    name: 'Ato 3 • Ofício do Conselho Tutelar',
    route: '/alunos/104829-3/dossie',
  },
  {
    phase: 9,
    actIndex: 2,
    duration: 1200,
    name: 'Ato 3 • Emissão em 1 Clique',
    route: '/alunos/104829-3/dossie',
  },
  {
    phase: 10,
    actIndex: 2,
    duration: 1700,
    name: 'Ato 3 • Dossiê Compilado',
    route: '/alunos/104829-3/dossie',
  },
  {
    phase: 11,
    actIndex: 2,
    duration: 2500,
    name: 'Ato 3 • Economia de ~14 Horas',
    route: 'ECA Arts. 17 e 143',
  },
] as const;

export default function MasterWorkflowAnimation() {
  const [phase, setPhase] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const animKey = useId();

  const currentPhaseConfig = MASTER_PHASES[phase] || MASTER_PHASES[0];
  const activeAct = currentPhaseConfig.actIndex;

  // State Machine de linha do tempo contínua com setTimeout encadeados
  useEffect(() => {
    if (!isPlaying) return;

    const currentDuration = currentPhaseConfig.duration;
    const timer = setTimeout(() => {
      setPhase((prev) => (prev + 1) % MASTER_PHASES.length);
    }, currentDuration);

    return () => clearTimeout(timer);
  }, [phase, isPlaying, currentPhaseConfig.duration]);

  const handleActSelect = useCallback((actIndex: number) => {
    const targetTab = MASTER_ACT_TABS[actIndex];
    if (targetTab) {
      setPhase(targetTab.targetPhase);
    }
  }, []);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const handleRestart = useCallback(() => {
    setPhase(0);
    setIsPlaying(true);
  }, []);

  // Helpers de estado para o Ato 2 (PIN de fé pública)
  const pinDigitsCount =
    phase === 5 ? 2 : phase === 6 ? 4 : phase >= 7 ? 4 : 0;
  const isAtaSigned = phase >= 7;

  // Helpers de estado para o Ato 3 (Dossiê)
  const isDossieCompiling = phase === 9;
  const isDossieReady = phase >= 10;
  const isImpactConsolidated = phase >= 11;

  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden flex flex-col transition-all">
      {/* Estilos e animações com foco, feixe de luz e ondulação */}
      <style>{`
        @keyframes shineSweep {
          0% { transform: translateX(-100%); opacity: 0; }
          30% { opacity: 0.9; }
          100% { transform: translateX(200%); opacity: 0; }
        }
        @keyframes cursorRipple {
          0% { transform: scale(0.6); opacity: 1; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes laserSweep {
          0% { transform: translateX(-100%); opacity: 0; }
          40% { opacity: 0.85; }
          100% { transform: translateX(200%); opacity: 0; }
        }
        @keyframes scanGlow {
          0%, 100% { box-shadow: 0 0 15px rgba(16, 185, 129, 0.2); }
          50% { box-shadow: 0 0 30px rgba(16, 185, 129, 0.45); }
        }
        .animate-shine-sweep {
          animation: shineSweep 2s ease-in-out infinite;
        }
        .animate-ripple {
          animation: cursorRipple 0.8s ease-out infinite;
        }
        .animate-laser {
          animation: laserSweep 1.6s ease-in-out infinite;
        }
        .animate-scan-glow {
          animation: scanGlow 1.8s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-shine-sweep,
          .animate-ripple,
          .animate-laser,
          .animate-scan-glow {
            animation: none !important;
          }
        }
      `}</style>

      {/* Top Header com Controles do Ciclo */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-blue-600 ring-4 ring-blue-100" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Rotina Pedagógica Oficial
          </span>
          <span className="hidden sm:inline-block text-xs text-slate-400">|</span>
          <span className="hidden sm:inline-block text-xs font-mono text-slate-500">
            {currentPhaseConfig.route}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            {currentPhaseConfig.name}
          </span>
        </div>

        {/* Controles de Reprodução */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTogglePlay}
            aria-label={isPlaying ? 'Pausar animação' : 'Reproduzir animação'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 text-blue-600" />
                <span>Pausar</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />
                <span>Reproduzir</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleRestart}
            aria-label="Reiniciar animação a partir do Ato 1"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 bg-white transition-colors shadow-xs cursor-pointer"
            title="Reiniciar"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-mono text-slate-500 px-2 py-1 bg-white border border-slate-200 rounded-md">
            {`Ato ${activeAct + 1}/3`}
          </span>
        </div>
      </div>

      {/* Indicadores dos 3 Atos com Barra de Progresso */}
      <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/50">
        {MASTER_ACT_TABS.map((tab, idx) => {
          const isActive = activeAct === idx;
          const isPassed = activeAct > idx;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleActSelect(idx)}
              aria-current={isActive ? 'step' : undefined}
              className={`relative px-3 py-3 sm:px-5 sm:py-3.5 text-left transition-colors flex flex-col justify-between cursor-pointer ${
                isActive ? 'bg-white shadow-xs' : 'hover:bg-slate-100/70 text-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : isPassed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isPassed ? <Check className="w-3 h-3 stroke-[3]" /> : idx + 1}
                </span>
                <span
                  className={`text-xs sm:text-sm font-bold truncate ${
                    isActive ? 'text-blue-900' : 'text-slate-700'
                  }`}
                >
                  {tab.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate hidden sm:block">
                {tab.tagline}
              </p>

              {/* Barra de Progresso Linear */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 overflow-hidden">
                  <div
                    key={`${animKey}-tab-progress-${idx}-${phase}`}
                    className="h-full bg-blue-600 transition-all duration-300 w-full"
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Palco Principal Coreografado (3 Telas Distintas com Transição Fluida e Zoom de Foco) */}
      <div className="p-4 sm:p-6 lg:p-8 bg-slate-50/50 min-h-[530px] sm:min-h-[510px] flex items-center justify-center relative overflow-hidden">
        {/* =========================================================================
            TELA 1 (ATO 1): BUSCA ATIVA WHATSAPP
            Fases 0, 1 e 2
            ========================================================================= */}
        <div
          className={`w-full max-w-3xl transition-all duration-700 ease-out ${
            activeAct === 0
              ? 'opacity-100 scale-100 translate-y-0 z-10 pointer-events-auto'
              : activeAct > 0
              ? 'opacity-0 scale-95 -translate-y-6 pointer-events-none absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-6 z-0'
              : 'opacity-0 scale-95 translate-y-6 pointer-events-none absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-6 z-0'
          }`}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5 font-medium text-slate-700">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                <span>Colégio Estadual Modelo • Busca Ativa</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                Faltas consecutivas ≥ 5 dias (ECA Art. 56)
              </span>
            </div>

            {/* Janela Principal com Faixa Luminosa */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4 relative overflow-hidden">
              {/* Faixa Brilhante Passando sobre a Janela que Surge */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-blue-500/10 to-transparent transform -skew-x-12 animate-shine-sweep" />
              </div>

              {/* Identificação do Aluno */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm border border-blue-200 shrink-0">
                    LM
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-slate-900 text-base">Lucas M.</h4>
                      <span className="text-xs text-slate-500 font-mono">CGM: 104.829-3</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      1º Ano B • Turno Matutino • Responsável: Marlene M. (Mãe)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-center">
                    <span className="block text-[10px] text-slate-500 uppercase font-semibold">
                      Frequência
                    </span>
                    <span className="text-xs font-bold text-slate-800">68%</span>
                  </div>
                  <div className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-center">
                    <span className="block text-[10px] text-rose-600 uppercase font-semibold flex items-center justify-center gap-1">
                      <AlertCircle className="w-2.5 h-2.5" /> Alerta
                    </span>
                    <span className="text-xs font-bold text-rose-700">7 faltas seguidas</span>
                  </div>
                </div>
              </div>

              {/* Balão WhatsApp Pré-formatado */}
              <div
                className={`rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2 transition-all duration-500 ${
                  phase === 2
                    ? 'ring-2 ring-emerald-400/50 bg-emerald-50/50 scale-[1.01]'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    Modelo: Notificação de Infrequência Escolar
                  </span>
                  <span className="text-[11px] text-slate-400">Canal WhatsApp Oficial</span>
                </div>

                <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 leading-relaxed shadow-2xs">
                  <p>
                    <span className="font-semibold text-slate-900">Olá Marlene</span>,
                    identificamos que o estudante <span className="font-semibold text-slate-900">Lucas M.</span> acumulou
                    7 faltas consecutivas no 1º Ano B. Solicitamos comparecimento à escola para acolhimento e justificativa.
                  </p>
                </div>
              </div>

              {/* Botão de Disparo & Selo SHA-256 */}
              <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setPhase(1)}
                    className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs font-semibold shadow-md transition-all duration-300 cursor-pointer ${
                      phase === 1
                        ? 'bg-emerald-700 scale-95 ring-4 ring-emerald-300/70 shadow-inner'
                        : 'bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02]'
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    <span>Disparar Notificação WhatsApp</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1 opacity-70" />
                  </button>

                  {/* Cursor Vetorial SVG no clique da Phase 1 */}
                  <div
                    className={`absolute -right-2 -bottom-2 pointer-events-none z-30 transition-all duration-700 ease-out flex items-center gap-1.5 ${
                      phase === 1
                        ? 'opacity-100 translate-x-0 translate-y-0 scale-95'
                        : 'opacity-0 translate-x-8 translate-y-8 scale-75'
                    }`}
                  >
                    {phase === 1 && (
                      <span className="absolute -left-1 -top-1 w-6 h-6 rounded-full border-2 border-emerald-500 animate-ripple" />
                    )}
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="drop-shadow-lg"
                    >
                      <path
                        d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z"
                        fill="#0f172a"
                        stroke="#ffffff"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-bold shadow-md tracking-wider">
                      1 clique
                    </span>
                  </div>
                </div>

                {/* Recibo Criptográfico SHA-256 Carimbado */}
                <div
                  className={`transition-all duration-500 ${
                    phase === 2
                      ? 'opacity-100 scale-100 shadow-md ring-2 ring-emerald-400/40'
                      : 'opacity-40 scale-95'
                  }`}
                >
                  <div className="bg-slate-900 rounded-lg px-3 py-2 text-slate-100 text-[11px] font-mono flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-emerald-300 select-all truncate max-w-[200px] sm:max-w-[260px]">
                      SHA-256: e3b0c44298fc1c14...855
                    </span>
                    <span className="text-[10px] text-slate-400 border-l border-slate-700 pl-2 shrink-0">
                      Lei nº 14.063/2020
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            TELA 2 (ATO 2): LIVRO DE ATAS & ASSINATURA COM PIN
            Fases 3, 4, 5, 6 e 7
            ========================================================================= */}
        <div
          className={`w-full max-w-3xl transition-all duration-700 ease-out ${
            activeAct === 1
              ? 'opacity-100 scale-100 translate-y-0 z-10 pointer-events-auto'
              : activeAct > 1
              ? 'opacity-0 scale-95 -translate-y-6 pointer-events-none absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-6 z-0'
              : 'opacity-0 scale-95 translate-y-6 pointer-events-none absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-6 z-0'
          }`}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2 font-medium text-slate-700">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>Livro Oficial de Atas Pedagógicas</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                <Scale className="w-3.5 h-3.5" />
                <span>Lei nº 14.063/2020</span>
              </span>
            </div>

            {/* Janela Principal da Ata com Faixa Luminosa */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4 relative overflow-hidden">
              {/* Faixa Brilhante Passando sobre a Janela que Surge */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-blue-400/15 to-transparent transform -skew-x-12 animate-shine-sweep" />
              </div>

              {/* Identificador da Ata */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 leading-tight">
                    Ata Pedagógica nº 042/2026
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Registro de Atendimento e Acolhimento Familiar
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500">03/11/2026</span>
              </div>

              {/* Registro do Atendimento Presencial */}
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs text-slate-700 space-y-1.5 leading-relaxed">
                <div className="flex items-center justify-between font-semibold text-slate-800 text-[11px] pb-1 border-b border-slate-200">
                  <span>Pauta: Regularização da Frequência Escolar</span>
                  <span className="font-mono text-slate-500">Presente: Marlene M. (Mãe)</span>
                </div>
                <p>
                  Reunião de alinhamento com a responsável pelo estudante <span className="font-semibold text-slate-900">Lucas M.</span> (CGM 104.829-3).
                  Firmado compromisso familiar de retorno imediato às aulas e plano de reposição pedagógica de conteúdos.
                </p>
              </div>

              {/* Zoom de Foco: Bloco de Assinatura Eletrônica com PIN do Servidor */}
              <div
                className={`rounded-xl border p-4 transition-all duration-500 relative overflow-hidden ${
                  isAtaSigned
                    ? 'bg-slate-900 text-white border-slate-700 shadow-xl scale-[1.01] ring-4 ring-emerald-500/20'
                    : phase >= 4
                    ? 'bg-blue-50/90 text-slate-800 border-blue-300 ring-2 ring-blue-400/30'
                    : 'bg-blue-50/60 text-slate-800 border-blue-200'
                }`}
              >
                {/* Feixe laser no momento da assinatura (Phase 7) */}
                {isAtaSigned && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent transform -skew-x-12 animate-laser" />
                  </div>
                )}

                <div className="flex items-center justify-between text-xs pb-1 border-b border-blue-200/40">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Award className="w-4 h-4 text-emerald-400" />
                    <span>Assinatura da Servidora: Helena D. (Equipe Pedagógica)</span>
                  </div>
                  <span className={`text-[10px] font-mono ${isAtaSigned ? 'text-blue-300' : 'text-slate-500'}`}>
                    PBKDF2 SHA-512
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 relative">
                  {/* Dígitos Animados do PIN com Digitação Fluida */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-medium ${isAtaSigned ? 'text-blue-200' : 'text-slate-600'}`}>
                      PIN de Fé Pública:
                    </span>
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2, 3].map((slotIdx) => {
                        const isFilled = pinDigitsCount > slotIdx;
                        return (
                          <span
                            key={slotIdx}
                            className={`w-7 h-7 rounded-md font-bold flex items-center justify-center text-xs transition-all duration-300 ${
                              isFilled
                                ? isAtaSigned
                                  ? 'bg-emerald-500 text-white shadow-xs scale-100 ring-1 ring-emerald-300'
                                  : 'bg-blue-600 text-white shadow-xs scale-105 ring-1 ring-blue-300'
                                : 'bg-white text-slate-400 border border-slate-300'
                            }`}
                          >
                            {isFilled ? '•' : ''}
                          </span>
                        );
                      })}
                    </div>

                    {isAtaSigned ? (
                      <span className="ml-1 text-[11px] font-bold text-emerald-300 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5 stroke-[3]" /> Assinada
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPhase(5)}
                        className="ml-2 text-xs text-blue-600 font-semibold hover:underline cursor-pointer"
                      >
                        Digitar PIN
                      </button>
                    )}
                  </div>

                  {/* Certidão Cega com QR Code */}
                  <div className={`flex items-center gap-2 text-[11px] ${isAtaSigned ? 'text-blue-200' : 'text-slate-600'}`}>
                    <QrCode className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold">QR Code Cego (Imutabilidade Legal)</span>
                  </div>

                  {/* Cursor Vetorial SVG demonstrando o PIN na Phase 4 */}
                  <div
                    className={`absolute left-40 -bottom-4 pointer-events-none z-30 transition-all duration-700 ease-out flex items-center gap-1.5 ${
                      phase === 4
                        ? 'opacity-100 translate-x-0 translate-y-0 scale-95'
                        : 'opacity-0 translate-x-8 translate-y-8 scale-75'
                    }`}
                  >
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="drop-shadow-lg"
                    >
                      <path
                        d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z"
                        fill="#0f172a"
                        stroke="#ffffff"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-bold shadow-md tracking-wider">
                      PIN servidor
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            TELA 3 (ATO 3): DOSSIÊ ECA EM 1 CLIQUE & IMPACTO
            Fases 8, 9, 10 e 11
            ========================================================================= */}
        <div
          className={`w-full max-w-3xl transition-all duration-700 ease-out ${
            activeAct === 2
              ? 'opacity-100 scale-100 translate-y-0 z-10 pointer-events-auto'
              : 'opacity-0 scale-95 translate-y-6 pointer-events-none absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-6 z-0'
          }`}
        >
          <div className="space-y-4">
            {/* Ofício do Conselho Tutelar com Requerimento */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-700" />
                  <span>Ofício do Conselho Tutelar nº 284/2026</span>
                </div>
                <p className="text-[11px] text-amber-800">
                  Requisita comprovação oficial de busca ativa e intervenções do estudante Lucas M.
                </p>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPhase(9)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold shadow-sm transition-all cursor-pointer ${
                    isDossieCompiling
                      ? 'bg-emerald-700 scale-95 ring-4 ring-emerald-300'
                      : isDossieReady
                      ? 'bg-emerald-700'
                      : 'bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02]'
                  }`}
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>{isDossieCompiling ? 'Compilando...' : isDossieReady ? 'Dossiê Pronto' : 'Emitir Dossiê'}</span>
                </button>

                {/* Cursor Vetorial SVG sobre o botão de emitir dossiê (Phase 9) */}
                <div
                  className={`absolute -right-2 -bottom-2 pointer-events-none z-30 transition-all duration-700 ease-out flex items-center gap-1.5 ${
                    phase === 9
                      ? 'opacity-100 translate-x-0 translate-y-0 scale-95'
                      : 'opacity-0 translate-x-8 translate-y-8 scale-75'
                  }`}
                >
                  {phase === 9 && (
                    <span className="absolute -left-1 -top-1 w-6 h-6 rounded-full border-2 border-emerald-500 animate-ripple" />
                  )}
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="drop-shadow-lg"
                  >
                    <path
                      d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z"
                      fill="#0f172a"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-bold shadow-md tracking-wider">
                    1 clique
                  </span>
                </div>
              </div>
            </div>

            {/* Folha Oficial A4 do Dossiê com Faixa Luminosa */}
            <div className="bg-white rounded-xl border border-slate-300 p-4 sm:p-5 shadow-lg space-y-3.5 relative overflow-hidden">
              {/* Faixa Brilhante Passando sobre o Documento */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-400/15 to-transparent transform -skew-x-12 animate-shine-sweep" />
              </div>

              {/* Cabeçalho Oficial do Dossiê */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                    <FileCheck2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-tight">
                      Dossiê Probatório Circunstanciado (ECA Arts. 17 e 143)
                    </h4>
                    <span className="text-[10px] text-slate-500">
                      Destinatário: Conselho Tutelar & Ministério Público
                    </span>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-700" />
                  Pronto
                </span>
              </div>

              {/* Linha do Tempo Unificada com Provas Encadernadas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div
                  className={`bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1 transition-all duration-500 ${
                    isDossieReady ? 'ring-1 ring-emerald-300 bg-emerald-50/40' : ''
                  }`}
                >
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    1. Notificação WhatsApp (Ato 1)
                  </span>
                  <p className="text-[10px] text-slate-600">
                    Entregue à mãe Marlene M. Recibo SHA-256 verificado (#REC-849201).
                  </p>
                </div>

                <div
                  className={`bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1 transition-all duration-500 ${
                    isDossieReady ? 'ring-1 ring-blue-300 bg-blue-50/40' : ''
                  }`}
                >
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    2. Ata de Acolhimento (Ato 2)
                  </span>
                  <p className="text-[10px] text-slate-600">
                    Ata nº 042/2026 lavrada com PIN de fé pública (Lei nº 14.063/2020).
                  </p>
                </div>
              </div>

              {/* Foco de Impacto: Comparativo Factual de Economia de Tempo */}
              <div
                className={`rounded-xl bg-slate-900 text-white p-3.5 space-y-2 transition-all duration-500 shadow-md ${
                  isImpactConsolidated
                    ? 'ring-2 ring-emerald-400 scale-[1.01]'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    Economia de Tempo e Fé Pública
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Lei nº 14.063/2020</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-0.5">
                  <div className="bg-white/5 rounded-lg p-2.5 border border-white/10 space-y-0.5">
                    <span className="block text-[10px] text-rose-300 font-bold uppercase">
                      Processo em papel físico
                    </span>
                    <span className="font-extrabold text-white text-sm">~14 horas</span>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      Procura em livros, folhas soltas e cadernos.
                    </p>
                  </div>

                  <div className="bg-emerald-500/20 rounded-lg p-2.5 border border-emerald-400/40 space-y-0.5">
                    <span className="block text-[10px] text-emerald-300 font-bold uppercase flex items-center gap-1">
                      <Check className="w-3 h-3" /> Na Rede Ativa SaaS
                    </span>
                    <span className="font-extrabold text-emerald-300 text-sm">1 clique (5s)</span>
                    <p className="text-[10px] text-emerald-100 leading-tight">
                      Histórico unificado com fé pública digital.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé Informativo */}
      <div className="border-t border-slate-200 bg-white px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
          <span>Fé Pública sob a Lei Federal nº 14.063/2020 e Arts. 17 e 143 do ECA.</span>
        </div>
        <span className="font-mono text-slate-400">
          De ~14 horas para 1 clique
        </span>
      </div>
    </div>
  );
}
