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
  Building2,
  Lock,
  FileCheck2,
  QrCode,
  Award,
  Sparkles,
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
    label: '1. Mensagem com revisão',
    tagline: 'Preparo e conferência pela equipe',
    targetPhase: 0,
  },
  {
    id: 1,
    label: '2. Ata com confirmação por PIN',
    tagline: 'Registro e autoria vinculados',
    targetPhase: 3,
  },
  {
    id: 2,
    label: '3. Relatório de histórico',
    tagline: 'Contatos e atendimentos reunidos',
    targetPhase: 8,
  },
] as const;

interface MasterPhaseConfig {
  phase: number;
  actIndex: number;
  duration: number; // ms
  name: string;
  moduleLabel: string;
}

// Timeline contínua de ~18.3s com micro-fases coreografadas
const MASTER_PHASES: readonly MasterPhaseConfig[] = [
  // --- ATO 1: MENSAGEM COM REVISÃO HUMANA (~5.0s) ---
  {
    phase: 0,
    actIndex: 0,
    duration: 1600,
    name: 'Ato 1 • Mensagem preparada',
    moduleLabel: 'Contatos com famílias',
  },
  {
    phase: 1,
    actIndex: 0,
    duration: 1200,
    name: 'Ato 1 • Conferência humana',
    moduleLabel: 'Contatos com famílias',
  },
  {
    phase: 2,
    actIndex: 0,
    duration: 2200,
    name: 'Ato 1 • Contato registrado',
    moduleLabel: 'Registro de envio',
  },

  // --- ATO 2: ATA COM CONFIRMAÇÃO POR PIN (~6.3s) ---
  {
    phase: 3,
    actIndex: 1,
    duration: 1500,
    name: 'Ato 2 • Livro de Atas',
    moduleLabel: 'Atendimento e ata',
  },
  {
    phase: 4,
    actIndex: 1,
    duration: 1000,
    name: 'Ato 2 • Confirmação da servidora',
    moduleLabel: 'Atendimento e ata',
  },
  {
    phase: 5,
    actIndex: 1,
    duration: 800,
    name: 'Ato 2 • Digitação do PIN (Parte 1)',
    moduleLabel: 'Atendimento e ata',
  },
  {
    phase: 6,
    actIndex: 1,
    duration: 800,
    name: 'Ato 2 • Digitação do PIN (Parte 2)',
    moduleLabel: 'Atendimento e ata',
  },
  {
    phase: 7,
    actIndex: 1,
    duration: 2200,
    name: 'Ato 2 • Ata confirmada',
    moduleLabel: 'Histórico preservado',
  },

  // --- ATO 3: RELATÓRIO DE HISTÓRICO (~7.0s) ---
  {
    phase: 8,
    actIndex: 2,
    duration: 1500,
    name: 'Ato 3 • Exportar histórico',
    moduleLabel: 'Relatório de acompanhamento',
  },
  {
    phase: 9,
    actIndex: 2,
    duration: 1200,
    name: 'Ato 3 • Seleção de registros',
    moduleLabel: 'Relatório de acompanhamento',
  },
  {
    phase: 10,
    actIndex: 2,
    duration: 1800,
    name: 'Ato 3 • Relatório gerado',
    moduleLabel: 'Relatório de acompanhamento',
  },
  {
    phase: 11,
    actIndex: 2,
    duration: 2500,
    name: 'Ato 3 • Registros organizados',
    moduleLabel: 'Continuidade do trabalho',
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

  // Estados do Ato 2 (Confirmação sequencial por PIN)
  const pinDigitsCount =
    phase === 5 ? 2 : phase === 6 ? 4 : phase >= 7 ? 4 : 0;
  const isAtaSigned = phase >= 7;

  // Estados do Ato 3 (Relatório de acompanhamento)
  const isReportGenerating = phase === 9;
  const isReportReady = phase >= 10;
  const isSummaryHighlighted = phase >= 11;

  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden flex flex-col transition-all">
      {/* Estilos de brilho, laser e ondulação com respeito a reduced-motion */}
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
        .animate-shine-sweep {
          animation: shineSweep 2s ease-in-out infinite;
        }
        .animate-ripple {
          animation: cursorRipple 0.8s ease-out infinite;
        }
        .animate-laser {
          animation: laserSweep 1.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-shine-sweep,
          .animate-ripple,
          .animate-laser {
            animation: none !important;
          }
        }
      `}</style>

      {/* Top Header com Controles do Ciclo */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Simulação demonstrativa • Dados fictícios
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
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
                <Pause className="w-3.5 h-3.5 text-emerald-700" />
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
            aria-label="Reiniciar simulação"
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 bg-white transition-colors shadow-xs cursor-pointer"
            title="Reiniciar"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-mono text-slate-600 px-2 py-1 bg-white border border-slate-200 rounded-md">
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
                      ? 'bg-emerald-600 text-white'
                      : isPassed
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {isPassed ? <Check className="w-3 h-3 stroke-[3]" /> : idx + 1}
                </span>
                <span
                  className={`text-xs sm:text-sm font-bold truncate ${
                    isActive ? 'text-emerald-950' : 'text-slate-700'
                  }`}
                >
                  {tab.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 truncate hidden sm:block">
                {tab.tagline}
              </p>

              {/* Barra de Progresso Linear */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 overflow-hidden">
                  <div
                    key={`${animKey}-tab-progress-${idx}-${phase}`}
                    className="h-full bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 transition-all duration-300 w-full"
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Palco Principal Coreografado (3 Telas Distintas com Transição Fluida) */}
      <div className="p-4 sm:p-6 lg:p-8 bg-slate-50/50 min-h-[540px] sm:min-h-[520px] flex items-center justify-center relative overflow-hidden">
        {/* =========================================================================
            TELA 1 (ATO 1): MENSAGEM PREPARADA COM REVISÃO HUMANA
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
            <div className="flex items-center justify-between text-xs text-slate-600 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5 font-medium text-slate-700">
                <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Escola Exemplo • Busca Ativa</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
                Alerta de faltas
              </span>
            </div>

            {/* Janela Principal com Faixa Luminosa */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent transform -skew-x-12 animate-shine-sweep" />
              </div>

              {/* Identificação do Estudante */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-sm border border-emerald-200 shrink-0">
                    LM
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-slate-900 text-base">Lucas M.</h4>
                      <span className="text-xs text-slate-500 font-mono">Matrícula: 104.829-3</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      1º Ano B • Turno Matutino • Responsável legal: Marlene M. (Mãe)
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
                      <AlertCircle className="w-2.5 h-2.5" /> Faltas
                    </span>
                    <span className="text-xs font-bold text-rose-700">7 faltas seguidas</span>
                  </div>
                </div>
              </div>

              {/* Mensagem Preparada para Conferência Humana */}
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
                    Modelo: Aviso de Infrequência Escolar
                  </span>
                  <span className="text-[11px] text-slate-500">Abertura assistida (WhatsApp)</span>
                </div>

                <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 leading-relaxed shadow-2xs">
                  <p>
                    <span className="font-semibold text-slate-900">Olá Marlene</span>,
                    identificamos que o estudante <span className="font-semibold text-slate-900">Lucas M.</span> acumulou
                    7 faltas consecutivas no 1º Ano B. Solicitamos contato com a equipe pedagógica para atendimento e justificativa.
                  </p>
                </div>
              </div>

              {/* Ação de Revisão & Envio + Registro Operacional */}
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
                    <span>Revisar e enviar</span>
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
                      Revisado
                    </span>
                  </div>
                </div>

                {/* Registro Operacional sem Poluição Técnica */}
                <div
                  className={`transition-all duration-500 ${
                    phase === 2
                      ? 'opacity-100 scale-100 shadow-md ring-2 ring-emerald-400/50 rounded-lg'
                      : 'opacity-50 scale-95'
                  }`}
                >
                  <div className="bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200 text-emerald-900 text-[11px] flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span className="font-semibold">
                      Contato registrado • Hoje, 14:32
                    </span>
                    <span className="text-[10px] text-emerald-700 border-l border-emerald-300 pl-2 shrink-0">
                      Autora: Helena D.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            TELA 2 (ATO 2): ATA PEDAGÓGICA & CONFIRMAÇÃO DE AUTORIA POR PIN
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
            <div className="flex items-center justify-between text-xs text-slate-600 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2 font-medium text-slate-700">
                <FileText className="w-3.5 h-3.5 text-sky-600" />
                <span>Livro de Atas Pedagógicas</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                <Lock className="w-3 h-3" />
                <span>{isAtaSigned ? 'Confirmada' : 'Em elaboração'}</span>
              </span>
            </div>

            {/* Janela Principal da Ata com Faixa Luminosa */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-sky-400/15 to-transparent transform -skew-x-12 animate-shine-sweep" />
              </div>

              {/* Identificador da Ata (Sem subtítulo redundante) */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h4 className="text-sm font-bold text-slate-900 leading-tight">
                  Ata Pedagógica nº 042/2026
                </h4>
                <span className="text-xs font-mono text-slate-600">03/11/2026</span>
              </div>

              {/* Registro do Atendimento Presencial */}
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs text-slate-700 space-y-1.5 leading-relaxed">
                <div className="flex items-center justify-between font-semibold text-slate-800 text-[11px] pb-1 border-b border-slate-200">
                  <span>Pauta: Frequência Escolar</span>
                  <span className="font-mono text-slate-600">Presente: Marlene M. (Mãe)</span>
                </div>
                <p>
                  Reunião com a responsável legal pelo estudante <span className="font-semibold text-slate-900">Lucas M.</span> (Matrícula 104.829-3).
                  Registrado compromisso de acompanhamento diário da frequência e entrega de justificativas.
                </p>
              </div>

              {/* Zoom de Foco: Bloco de Confirmação de Autoria por PIN */}
              <div
                className={`rounded-xl border p-4 transition-all duration-500 relative overflow-hidden ${
                  isAtaSigned
                    ? 'bg-slate-900 text-white border-slate-700 shadow-xl scale-[1.01] ring-4 ring-emerald-500/20'
                    : phase >= 4
                    ? 'bg-sky-50/90 text-slate-800 border-sky-300 ring-2 ring-sky-400/30'
                    : 'bg-sky-50/60 text-slate-800 border-sky-200'
                }`}
              >
                {isAtaSigned && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent transform -skew-x-12 animate-laser" />
                  </div>
                )}

                <div className="flex items-center justify-between text-xs pb-1 border-b border-sky-200/50">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Award className="w-4 h-4 text-emerald-500" />
                    <span>Confirmação de autoria: Helena D.</span>
                  </div>
                  <span className={`text-[10px] font-medium ${isAtaSigned ? 'text-sky-200' : 'text-slate-600'}`}>
                    Equipe pedagógica
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 relative">
                  {/* Dígitos Animados do PIN com Digitação Fluida */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${isAtaSigned ? 'text-slate-200' : 'text-slate-700'}`}>
                      Confirmação por PIN:
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
                                  : 'bg-sky-600 text-white shadow-xs scale-105 ring-1 ring-sky-300'
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
                        <Check className="w-3.5 h-3.5 stroke-[3]" /> Confirmada
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPhase(5)}
                        className="ml-2 text-xs text-sky-800 font-semibold hover:underline cursor-pointer"
                      >
                        Confirmar PIN
                      </button>
                    )}
                  </div>

                  {/* Conferência do Responsável */}
                  <div className={`flex items-center gap-2 text-[11px] ${isAtaSigned ? 'text-sky-200' : 'text-slate-600'}`}>
                    <QrCode className="w-4 h-4 text-emerald-500" />
                    <span className="font-semibold">Código de conferência e registro do responsável</span>
                  </div>

                  {/* Cursor Vetorial SVG na Phase 4 */}
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
                      Digitar PIN
                    </span>
                  </div>
                </div>

                {/* Explicação Factual de Pós-Confirmação */}
                <p className={`text-[11px] mt-3 pt-2 border-t ${isAtaSigned ? 'text-slate-300 border-slate-700' : 'text-slate-600 border-sky-200/70'}`}>
                  Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            TELA 3 (ATO 3): RELATÓRIO DE HISTÓRICO E CONTINUIDADE PEDAGÓGICA
            ========================================================================= */}
        <div
          className={`w-full max-w-3xl transition-all duration-700 ease-out ${
            activeAct === 2
              ? 'opacity-100 scale-100 translate-y-0 z-10 pointer-events-auto'
              : 'opacity-0 scale-95 translate-y-6 pointer-events-none absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-6 z-0'
          }`}
        >
          <div className="space-y-4">
            {/* Solicitação de Histórico para Encaminhamento */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-amber-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-700" />
                  <span>Exportação do histórico • Lucas M.</span>
                </div>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPhase(9)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold shadow-sm transition-all cursor-pointer ${
                    isReportGenerating
                      ? 'bg-emerald-700 scale-95 ring-4 ring-emerald-300'
                      : isReportReady
                      ? 'bg-emerald-700'
                      : 'bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02]'
                  }`}
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>{isReportGenerating ? 'Gerando...' : isReportReady ? 'Gerado' : 'Gerar relatório'}</span>
                </button>

                {/* Cursor Vetorial SVG sobre o botão de gerar relatório (Phase 9) */}
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
                    Exportar
                  </span>
                </div>
              </div>
            </div>

            {/* Documento de Relatório com Faixa Luminosa */}
            <div className="bg-white rounded-xl border border-slate-300 p-4 sm:p-5 shadow-lg space-y-3.5 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-400/15 to-transparent transform -skew-x-12 animate-shine-sweep" />
              </div>

              {/* Cabeçalho do Relatório Exportável */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center">
                    <FileCheck2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-tight">
                      Relatório de Contatos e Intervenções
                    </h4>
                    <span className="text-[10px] text-slate-600">
                      Origem, data e autoria identificados por registro
                    </span>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-teal-100 text-teal-800 border border-teal-200">
                  <CheckCheck className="w-3.5 h-3.5 text-teal-700" />
                  Exportado
                </span>
              </div>

              {/* Registros Vinculados por Origem e Autoria */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div
                  className={`bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1 transition-all duration-500 ${
                    isReportReady ? 'ring-1 ring-emerald-300 bg-emerald-50/40' : ''
                  }`}
                >
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    1. Tentativa de contato (Ato 1)
                  </span>
                  <p className="text-[10px] text-slate-600">
                    Abertura assistida para Marlene M. registrada por Helena D. às 14:32.
                  </p>
                </div>

                <div
                  className={`bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1 transition-all duration-500 ${
                    isReportReady ? 'ring-1 ring-sky-300 bg-sky-50/40' : ''
                  }`}
                >
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-sky-600" />
                    2. Ata nº 042/2026 (Ato 2)
                  </span>
                  <p className="text-[10px] text-slate-600">
                    Atendimento presencial em 03/11/2026 com autoria confirmada por PIN.
                  </p>
                </div>
              </div>

              {/* Síntese Factual da Continuidade Pedagógica */}
              <div
                className={`rounded-xl bg-slate-900 text-white p-3.5 space-y-2 transition-all duration-500 shadow-md ${
                  isSummaryHighlighted ? 'ring-2 ring-emerald-400 scale-[1.01]' : ''
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-400" />
                    Continuidade sem retrabalho
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-0.5">
                  <div className="bg-white/5 rounded-lg p-2.5 border border-white/10 space-y-0.5">
                    <span className="block text-[11px] text-slate-200 font-bold">
                      Registros diferenciados
                    </span>
                    <p className="text-[10px] text-slate-300 leading-tight">
                      Fatos registrados, relatos da família e justificativas apresentados separadamente.
                    </p>
                  </div>

                  <div className="bg-emerald-500/20 rounded-lg p-2.5 border border-emerald-400/40 space-y-0.5">
                    <span className="block text-[11px] text-emerald-200 font-bold">
                      Apoio a encaminhamentos
                    </span>
                    <p className="text-[10px] text-emerald-100 leading-tight">
                      Exportação conforme os procedimentos da escola e da secretaria de educação.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé Informativo */}
      <div className="border-t border-slate-200 bg-white px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Controle humano antes de enviar mensagens ou confirmar registros.</span>
        </div>
        <span className="font-mono text-slate-600">
          Histórico contínuo
        </span>
      </div>
    </div>
  );
}
