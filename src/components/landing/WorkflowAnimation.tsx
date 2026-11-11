'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  Send,
  MessageSquare,
  CheckCheck,
  Clock,
  User,
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
} from 'lucide-react';

export interface WorkflowTab {
  id: number;
  label: string;
  tagline: string;
  targetPhase: number;
}

const WORKFLOW_TABS: readonly WorkflowTab[] = [
  {
    id: 0,
    label: '1. Preparar mensagem',
    tagline: 'Conferir destinatário e texto',
    targetPhase: 0,
  },
  {
    id: 1,
    label: '2. Registrar envio',
    tagline: 'Abertura assistida e horário',
    targetPhase: 2,
  },
  {
    id: 2,
    label: '3. Histórico do aluno',
    tagline: 'Continuidade do acompanhamento',
    targetPhase: 3,
  },
] as const;

interface PhaseConfig {
  phase: number;
  stepIndex: number;
  duration: number; // ms
  name: string;
  moduleLabel: string;
}

// Timeline contínua de 9.0s dividida em 5 micro-fases coreografadas
const PHASES: readonly PhaseConfig[] = [
  {
    phase: 0,
    stepIndex: 0,
    duration: 1500,
    name: 'Fase 1/5 • Mensagem preparada',
    moduleLabel: 'Contatos com famílias',
  },
  {
    phase: 1,
    stepIndex: 0,
    duration: 1100,
    name: 'Fase 2/5 • Revisão humana',
    moduleLabel: 'Contatos com famílias',
  },
  {
    phase: 2,
    stepIndex: 1,
    duration: 1900,
    name: 'Fase 3/5 • Registro salvo',
    moduleLabel: 'Registro de envio',
  },
  {
    phase: 3,
    stepIndex: 2,
    duration: 1500,
    name: 'Fase 4/5 • Encaixe no histórico',
    moduleLabel: 'Histórico do estudante',
  },
  {
    phase: 4,
    stepIndex: 2,
    duration: 3000,
    name: 'Fase 5/5 • Histórico atualizado',
    moduleLabel: 'Histórico do estudante',
  },
] as const;

export default function WorkflowAnimation() {
  const [phase, setPhase] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const animKey = useId();

  const currentPhaseConfig = PHASES[phase] || PHASES[0];
  const activeStep = currentPhaseConfig.stepIndex;

  // State Machine de linha do tempo contínua com setTimeout encadeados
  useEffect(() => {
    if (!isPlaying) return;

    const currentDuration = currentPhaseConfig.duration;
    const timer = setTimeout(() => {
      setPhase((prev) => (prev + 1) % PHASES.length);
    }, currentDuration);

    return () => clearTimeout(timer);
  }, [phase, isPlaying, currentPhaseConfig.duration]);

  const handleTabSelect = useCallback((stepIndex: number) => {
    const targetTab = WORKFLOW_TABS[stepIndex];
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

  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden flex flex-col transition-all">
      {/* Keyframes customizados para animações vetoriais e feixes luminosos */}
      <style>{`
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
            {`Etapa ${activeStep + 1}/3`}
          </span>
        </div>
      </div>

      {/* Indicadores / Passos Clicáveis com Barra de Progresso */}
      <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/50">
        {WORKFLOW_TABS.map((tab, idx) => {
          const isActive = activeStep === idx;
          const isPassed = activeStep > idx;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabSelect(idx)}
              aria-current={isActive ? 'step' : undefined}
              className={`relative px-3 py-3 sm:px-5 sm:py-4 text-left transition-colors flex flex-col justify-between cursor-pointer ${
                isActive
                  ? 'bg-white shadow-xs'
                  : 'hover:bg-slate-100/70 text-slate-600'
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
                  className={`text-xs sm:text-sm font-semibold truncate ${
                    isActive ? 'text-emerald-950' : 'text-slate-700'
                  }`}
                >
                  {tab.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 truncate hidden sm:block">
                {tab.tagline}
              </p>

              {/* Barra de Progresso Linear da Aba Ativa */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 overflow-hidden">
                  <div
                    key={`${animKey}-tab-${idx}-${phase}`}
                    className="h-full bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 transition-all duration-300 w-full"
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Palco Principal Coreografado (Physical Stage com Transições Fluidas) */}
      <div className="p-4 sm:p-6 lg:p-8 bg-slate-50/50 min-h-[520px] sm:min-h-[500px] flex items-center justify-center relative overflow-hidden">
        {/* =========================================================================
            CAMADA 1: PREPARO E CONFERÊNCIA DE MENSAGEM
            ========================================================================= */}
        <div
          className={`absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-6 sm:top-8 transition-all duration-700 ease-out ${
            phase === 0 || phase === 1
              ? 'opacity-100 scale-100 translate-y-0 z-10'
              : phase === 2
              ? 'opacity-20 scale-95 -translate-y-4 blur-[1px] pointer-events-none z-0'
              : 'opacity-0 scale-90 -translate-y-8 pointer-events-none z-0'
          }`}
        >
          {/* Barra Superior Simulada */}
          <div className="flex items-center justify-between text-xs text-slate-600 pb-2 border-b border-slate-200 mb-3">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Escola Exemplo • Busca Ativa</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
              Turma: 1º Ano B
            </span>
          </div>

          {/* Card Principal do Estudante */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
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

              {/* Badges de Frequência e Faltas */}
              <div className="flex items-center gap-2">
                <div className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-center">
                  <span className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    Frequência
                  </span>
                  <span className="text-xs font-bold text-slate-800">68%</span>
                </div>
                <div className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-center">
                  <span className="block text-[10px] text-rose-600 uppercase tracking-wider font-semibold flex items-center justify-center gap-1">
                    <AlertCircle className="w-2.5 h-2.5" /> Faltas
                  </span>
                  <span className="text-xs font-bold text-rose-700">7 faltas seguidas</span>
                </div>
              </div>
            </div>

            {/* Caixa de Mensagem Preparada para Revisão */}
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  Modelo: Aviso de Infrequência Escolar
                </span>
                <span className="text-[11px] text-slate-500">Abertura assistida (WhatsApp)</span>
              </div>

              <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 font-sans leading-relaxed relative">
                <div className="absolute top-2 left-[-6px] w-2 h-2 bg-white border-l border-t border-slate-200 rotate-[-45deg]" />
                <p>
                  <span className="font-semibold text-slate-900">Olá Marlene</span>,
                  identificamos que o estudante <span className="font-semibold text-slate-900">Lucas M.</span> acumulou
                  7 faltas consecutivas no 1º Ano B. Solicitamos contato com a equipe pedagógica
                  para atendimento e justificativa das ausências.
                </p>
              </div>
            </div>

            {/* Ação com Supervisão Humana + Cursor Vetorial Animado */}
            <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Texto preenchido • A equipe confere destinatário e conteúdo antes do envio</span>
              </div>

              <div className="relative w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setPhase(1)}
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow-md transition-all duration-300 cursor-pointer ${
                    phase === 1
                      ? 'scale-95 bg-emerald-700 shadow-inner ring-4 ring-emerald-300/70'
                      : 'hover:scale-[1.02] hover:bg-emerald-700'
                  }`}
                >
                  <Send className="w-4 h-4" />
                  <span>Revisar e enviar</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1 opacity-70" />
                </button>

                {/* Cursor Vetorial Demonstrativo (SVG) que desliza e clica na Phase 1 */}
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

                  <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-bold shadow-md tracking-wider flex items-center gap-1">
                    Revisado
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            CAMADA 2: REGISTRO OPERACIONAL DO CONTATO (SEM POLUIÇÃO TÉCNICA)
            ========================================================================= */}
        <div
          className={`absolute inset-x-4 sm:inset-x-8 max-w-2xl mx-auto top-12 z-30 transition-all duration-700 ease-out ${
            phase === 2
              ? 'opacity-100 scale-105 translate-y-0 pointer-events-auto'
              : phase === 3
              ? 'opacity-0 scale-95 translate-y-16 pointer-events-none'
              : 'opacity-0 scale-90 -translate-y-6 pointer-events-none'
          }`}
        >
          <div className="bg-white rounded-2xl border border-emerald-300 shadow-2xl p-4 sm:p-5 ring-4 ring-emerald-100 relative overflow-hidden animate-scan-glow">
            {/* Feixe luminoso passando sobre o cartão */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent transform -skew-x-12 animate-laser" />
            </div>

            {/* Cabeçalho do Cartão */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-900 block leading-tight">
                    Aviso de Infrequência Escolar
                  </span>
                  <span className="text-[10px] text-slate-500">Destinatário conferido: Marlene M. (Mãe)</span>
                </div>
              </div>

              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-2xs">
                <CheckCheck className="w-4 h-4 text-emerald-600" />
                <span>Registrado</span>
              </span>
            </div>

            {/* Texto da Mensagem Conferida */}
            <p className="text-xs text-slate-700 leading-relaxed mb-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="font-semibold text-slate-900">Olá Marlene</span>,
              identificamos que o estudante <span className="font-semibold text-slate-900">Lucas M.</span> acumulou
              7 faltas consecutivas no 1º Ano B. Solicitamos contato com a equipe pedagógica para atendimento e justificativa.
            </p>

            {/* Comprovante Operacional Claro em Modo Claro */}
            <div className="bg-emerald-50/70 rounded-xl p-3 border border-emerald-200 text-slate-700 text-[11px] space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold text-emerald-900 border-b border-emerald-200/70 pb-1">
                <span>Registro de Tentativa de Contato</span>
                <span className="text-emerald-700">Helena D.</span>
              </div>
              <p className="text-slate-700 leading-relaxed">
                Chat aberto no WhatsApp pela equipe após conferência do destinatário, com horário salvo na linha do tempo.
              </p>
              <div className="text-[10px] text-slate-600 flex items-center justify-between pt-1 border-t border-emerald-200/70">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-700" /> Hoje às 14:32
                </span>
                <span className="text-emerald-800 font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3" /> Incluído no histórico
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            CAMADA 3: HISTÓRICO DE ACOMPANHAMENTO DO ESTUDANTE
            ========================================================================= */}
        <div
          className={`absolute inset-x-4 sm:inset-x-8 max-w-3xl mx-auto top-4 sm:top-6 transition-all duration-700 ease-out ${
            phase === 3
              ? 'opacity-100 scale-100 translate-y-0 z-20 shadow-xl'
              : phase === 4
              ? 'opacity-100 scale-100 translate-y-0 z-20 shadow-2xl ring-2 ring-emerald-500/40'
              : 'opacity-0 scale-95 translate-y-24 pointer-events-none z-0'
          }`}
        >
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
            {/* Cabeçalho do Estudante */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 text-white font-bold flex items-center justify-center text-base shadow-sm shrink-0">
                  <User className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-900 text-base">Lucas M.</h4>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-teal-50 text-teal-800 border border-teal-200 font-semibold">
                      Em acompanhamento
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Matrícula: 104.829-3 • 1º Ano B • Turno Matutino
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <div className="text-right">
                  <span className="block text-slate-600 text-[10px] uppercase font-semibold">
                    Frequência Escolar
                  </span>
                  <span className="font-bold text-slate-800">68% (7 faltas seguidas)</span>
                </div>
                <div className="text-right pl-3 border-l border-slate-200">
                  <span className="block text-slate-600 text-[10px] uppercase font-semibold">
                    Histórico
                  </span>
                  <span className="font-bold text-emerald-700 flex items-center gap-1 justify-end">
                    <ShieldCheck className="w-3.5 h-3.5" /> Atualizado
                  </span>
                </div>
              </div>
            </div>

            {/* Linha do Tempo Unificada */}
            <div className="space-y-3">
              <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-teal-600" />
                Linha do Tempo de Contatos e Atendimentos
              </h5>

              <div className="relative pl-6 space-y-3 border-l-2 border-slate-200 ml-2">
                {/* SLOT 1: Registro do contato recém-enviado */}
                <div
                  className={`relative transition-all duration-500 ease-out ${
                    phase >= 3 ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
                  }`}
                >
                  <span className="absolute -left-[31px] top-0 flex h-4 w-4 rounded-full bg-emerald-600 ring-4 ring-emerald-100 items-center justify-center text-white">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </span>
                  <div className="bg-emerald-50/80 rounded-lg p-3 border border-emerald-300 text-xs space-y-1.5 shadow-2xs ring-1 ring-emerald-200">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                        Tentativa de contato via WhatsApp
                      </span>
                      <span className="text-[11px] text-emerald-800 font-mono font-semibold bg-emerald-100 px-2 py-0.5 rounded-md">
                        Hoje, 14:32
                      </span>
                    </div>
                    <p className="text-slate-700 text-[11px] leading-relaxed">
                      Mensagem conferida por Helena D. para a responsável legal Marlene M., com registro de abertura assistida no histórico.
                    </p>
                  </div>
                </div>

                {/* SLOT 2: Ata Pedagógica Prévia */}
                <div className="relative">
                  <span className="absolute -left-[31px] top-0 flex h-4 w-4 rounded-full bg-sky-600 ring-4 ring-sky-100 items-center justify-center text-white">
                    <FileText className="w-2.5 h-2.5" />
                  </span>
                  <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-sky-600" />
                        Ata de Atendimento Pedagógico nº 042/2026
                      </span>
                      <span className="text-[11px] text-slate-600 font-mono">03/11/2026</span>
                    </div>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Reunião presencial com a família. Registrados os encaminhamentos de acompanhamento e justificativas apresentadas.
                    </p>
                  </div>
                </div>

                {/* SLOT 3: Alerta Preventivo */}
                <div className="relative">
                  <span className="absolute -left-[31px] top-0 flex h-4 w-4 rounded-full bg-slate-500 ring-4 ring-slate-100 items-center justify-center text-white">
                    <Clock className="w-2.5 h-2.5" />
                  </span>
                  <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">
                        Registro de Infrequência Alternada
                      </span>
                      <span className="text-[11px] text-slate-600 font-mono">27/10/2026</span>
                    </div>
                    <p className="text-slate-600 text-[11px]">
                      Primeiro aviso preventivo gerado para acompanhamento pela equipe pedagógica.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Barra de Ações do Histórico */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-600">
                Contatos, atas e justificativas reunidos em um só histórico.
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reiniciar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé Informativo da Animação */}
      <div className="border-t border-slate-200 bg-white px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Controle humano antes de enviar cada mensagem.</span>
        </div>
        <span className="font-mono text-slate-600">
          Fluxo demonstrativo
        </span>
      </div>
    </div>
  );
}
