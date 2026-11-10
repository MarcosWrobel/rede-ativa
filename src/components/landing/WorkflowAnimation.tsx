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
  Lock,
  FileCheck,
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
    label: '1. Busca Ativa',
    tagline: 'Disparo 1-Clique sem digitação',
    targetPhase: 0,
  },
  {
    id: 1,
    label: '2. Confirmação & Fé Pública',
    tagline: 'Selo SHA-256 em trânsito',
    targetPhase: 2,
  },
  {
    id: 2,
    label: '3. Prontuário 360º',
    tagline: 'Encaixe no Prontuário 360º',
    targetPhase: 3,
  },
] as const;

interface PhaseConfig {
  phase: number;
  stepIndex: number;
  duration: number; // ms
  name: string;
  route: string;
}

// Timeline contínua de 9.0s dividida em 5 micro-fases coreografadas
const PHASES: readonly PhaseConfig[] = [
  {
    phase: 0,
    stepIndex: 0,
    duration: 1500,
    name: 'Fase 1/5 • Busca Ativa',
    route: '/busca-ativa',
  },
  {
    phase: 1,
    stepIndex: 0,
    duration: 1100,
    name: 'Fase 2/5 • Ação de 1 Clique',
    route: '/busca-ativa',
  },
  {
    phase: 2,
    stepIndex: 1,
    duration: 1900,
    name: 'Fase 3/5 • Voo & Selo SHA-256',
    route: 'SHA-256 & Fé Pública',
  },
  {
    phase: 3,
    stepIndex: 2,
    duration: 1500,
    name: 'Fase 4/5 • Morphing & Encaixe',
    route: '/alunos/104829-3',
  },
  {
    phase: 4,
    stepIndex: 2,
    duration: 3000,
    name: 'Fase 5/5 • Prontuário Consolidado',
    route: '/alunos/104829-3',
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
      {/* Keyframes customizados em tag interna para animações vetoriais e efeitos */}
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
            Simulador de Workflow Operacional
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
            aria-label="Reiniciar animação a partir da primeira etapa"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 bg-white transition-colors shadow-xs cursor-pointer"
            title="Reiniciar ciclo"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-mono text-slate-500 px-2 py-1 bg-white border border-slate-200 rounded-md">
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
                      ? 'bg-blue-600 text-white'
                      : isPassed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isPassed ? <Check className="w-3 h-3 stroke-[3]" /> : idx + 1}
                </span>
                <span
                  className={`text-xs sm:text-sm font-semibold truncate ${
                    isActive ? 'text-blue-900' : 'text-slate-700'
                  }`}
                >
                  {tab.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate hidden sm:block">
                {tab.tagline}
              </p>

              {/* Barra de Progresso Linear da Aba Ativa */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 overflow-hidden">
                  <div
                    key={`${animKey}-tab-${idx}-${phase}`}
                    className="h-full bg-blue-600 transition-all duration-300 w-full"
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
            CAMADA 1: PAINEL DE BUSCA ATIVA (/busca-ativa)
            Fases 0 e 1: Centro do palco
            Fase 2: Recua, diminui e desfoca
            Fases 3 e 4: Desvanece completamente
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
          {/* Barra do Navegador Simulado */}
          <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-200 mb-3">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              <span>Colégio Estadual Modelo • Frequência & Infrequência</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 border border-blue-200 font-medium">
              Filtro: 1º Ano B • Faltas ≥ 5 dias
            </span>
          </div>

          {/* Card Principal do Aluno em Risco */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
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
                    1º Ano B • Ensino Médio • Responsável: Marlene M. (Mãe)
                  </p>
                </div>
              </div>

              {/* Badges de Frequência e Alerta */}
              <div className="flex items-center gap-2">
                <div className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-center">
                  <span className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    Frequência
                  </span>
                  <span className="text-xs font-bold text-slate-800">68%</span>
                </div>
                <div className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-center">
                  <span className="block text-[10px] text-rose-600 uppercase tracking-wider font-semibold flex items-center justify-center gap-1">
                    <AlertCircle className="w-2.5 h-2.5" /> Alerta
                  </span>
                  <span className="text-xs font-bold text-rose-700">7 faltas seguidas</span>
                </div>
              </div>
            </div>

            {/* Caixa de Mensagem Pré-formatada (WhatsApp) */}
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  Modelo: Notificação de Infrequência Escolar
                </span>
                <span className="text-[11px] text-slate-400">Canal WhatsApp Oficial</span>
              </div>

              <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 shadow-2xs font-sans leading-relaxed relative">
                <div className="absolute top-2 left-[-6px] w-2 h-2 bg-white border-l border-t border-slate-200 rotate-[-45deg]" />
                <p>
                  <span className="font-semibold text-slate-900">Olá Marlene</span>,
                  identificamos que o estudante <span className="font-semibold text-slate-900">Lucas M.</span> acumulou
                  7 faltas consecutivas no 1º Ano B. Solicitamos contato com a equipe pedagógica
                  para acolhimento, justificativa e regularização da frequência escolar.
                </p>
              </div>
            </div>

            {/* Botão de Disparo + Cursor Vetorial Animado */}
            <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                <span>Sem digitação manual • Disparo assistido em 1 clique</span>
              </div>

              <div className="relative w-full sm:w-auto">
                {/* Botão com efeito de clique na Phase 1 */}
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
                  <span>Disparar Notificação WhatsApp</span>
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
                  {/* Onda de Ripple no Clique */}
                  {phase === 1 && (
                    <span className="absolute -left-1 -top-1 w-6 h-6 rounded-full border-2 border-emerald-500 animate-ripple" />
                  )}

                  {/* Ponteiro de Mouse SVG */}
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

                  {/* Badge Flutuante "1 clique" */}
                  <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-bold shadow-md tracking-wider flex items-center gap-1">
                    1 clique
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            CAMADA 2: BALÃO HÍBRIDO EM VOO & SELO SHA-256
            Fase 2: O balão ganha destaque no centro, recebe feixe luminoso e selo imutável
            Fase 3: Começa o morphing e encaixe no documento
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
            {/* Feixe luminoso vetorial passando sobre a mensagem */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent transform -skew-x-12 animate-laser" />
            </div>

            {/* Cabeçalho do Balão */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-900 block leading-tight">
                    Notificação de Infrequência Escolar
                  </span>
                  <span className="text-[10px] text-slate-500">Destinatário: Marlene M. (Mãe)</span>
                </div>
              </div>

              {/* Badge Dinâmico de Entrega */}
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-2xs">
                <CheckCheck className="w-4 h-4 text-emerald-600" />
                <span>Entregue • Check Duplo</span>
              </span>
            </div>

            {/* Texto da Mensagem */}
            <p className="text-xs text-slate-700 leading-relaxed mb-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="font-semibold text-slate-900">Olá Marlene</span>,
              identificamos que o estudante <span className="font-semibold text-slate-900">Lucas M.</span> acumulou
              7 faltas consecutivas no 1º Ano B. Solicitamos comparecimento à escola ou contato com a equipe pedagógica.
            </p>

            {/* Selo Probatório SHA-256 Carimbado ao Vivo */}
            <div className="bg-slate-900 rounded-xl p-3 text-slate-100 text-[11px] font-mono space-y-1.5 shadow-inner">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-sans border-b border-slate-800 pb-1">
                <span className="flex items-center gap-1.5 text-emerald-400 font-bold uppercase tracking-wider">
                  <Lock className="w-3.5 h-3.5" /> Selo Criptográfico Imutável (SHA-256)
                </span>
                <span className="text-slate-400">Lei nº 14.063/2020</span>
              </div>
              <div className="break-all font-mono text-emerald-300 text-[11px] py-0.5 select-all">
                e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
              </div>
              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" /> Registrado hoje às 14:32:08 (UTC-3)
                </span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3" /> Integridade Probatória Válida
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            CAMADA 3: FOLHA OFICIAL DO PRONTUÁRIO 360º (/alunos/[id])
            Fases 0 a 2: Repousa abaixo da tela
            Fase 3: Desliza para o centro e acolhe a mensagem no primeiro slot
            Fase 4: Consolidação total com brilho verde e dossiê 100% atualizado
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
            {/* Cabeçalho do Prontuário */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-base shadow-sm shrink-0">
                  <User className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-900 text-base">Lucas M.</h4>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                      Acompanhamento Ativo
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    CGM: 104.829-3 • 1º Ano B • Ensino Médio • Turno Matutino
                  </p>
                </div>
              </div>

              {/* Indicador de Respaldo Probatório */}
              <div className="flex items-center gap-3 text-xs">
                <div className="text-right">
                  <span className="block text-slate-400 text-[10px] uppercase font-semibold">
                    Frequência Escolar
                  </span>
                  <span className="font-bold text-slate-800">68% (7 faltas seguidas)</span>
                </div>
                <div className="text-right pl-3 border-l border-slate-200">
                  <span className="block text-slate-400 text-[10px] uppercase font-semibold">
                    Dossiê Probatório
                  </span>
                  <span className="font-bold text-emerald-700 flex items-center gap-1 justify-end">
                    <ShieldCheck className="w-3.5 h-3.5" /> 100% Atualizado
                  </span>
                </div>
              </div>
            </div>

            {/* Linha do Tempo Pedagógica Unificada (Timeline 360º) */}
            <div className="space-y-3">
              <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                Linha do Tempo de Intervenções e Atendimentos
              </h5>

              <div className="relative pl-6 space-y-3 border-l-2 border-slate-200 ml-2">
                {/* SLOT 1: Onde a mensagem recém-enviada e carimbada se encaixa perfeitamente */}
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
                        Notificação WhatsApp de Busca Ativa (Entregue)
                      </span>
                      <span className="text-[11px] text-emerald-800 font-mono font-semibold bg-emerald-100 px-2 py-0.5 rounded-md">
                        Hoje, 14:32:08
                      </span>
                    </div>
                    <p className="text-slate-700 text-[11px] leading-relaxed">
                      Mensagem entregue à responsável Marlene M. Recibo criptográfico #REC-849201
                      comprovado com hash SHA-256 e fé pública formalizada.
                    </p>
                    <div className="text-[10px] font-mono text-emerald-800 flex items-center gap-1 pt-0.5">
                      <Lock className="w-3 h-3" />
                      <span>SHA-256: e3b0c442...b855 (Lei nº 14.063/2020)</span>
                    </div>
                  </div>
                </div>

                {/* SLOT 2: Ata Pedagógica Prévia */}
                <div className="relative">
                  <span className="absolute -left-[31px] top-0 flex h-4 w-4 rounded-full bg-blue-600 ring-4 ring-blue-100 items-center justify-center text-white">
                    <FileText className="w-2.5 h-2.5" />
                  </span>
                  <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        Ata de Atendimento Pedagógico nº 042/2026
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">03/11/2026</span>
                    </div>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Reunião presencial de alinhamento com a equipe pedagógica. Registrado plano
                      de acolhimento e compromisso familiar de assiduidade.
                    </p>
                  </div>
                </div>

                {/* SLOT 3: Alerta Preventivo */}
                <div className="relative">
                  <span className="absolute -left-[31px] top-0 flex h-4 w-4 rounded-full bg-slate-400 ring-4 ring-slate-100 items-center justify-center text-white">
                    <Clock className="w-2.5 h-2.5" />
                  </span>
                  <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">
                        Identificação de Infrequência Alternada
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">27/10/2026</span>
                    </div>
                    <p className="text-slate-500 text-[11px]">
                      Primeiro alerta preventivo gerado antes do atingimento do teto crítico do ECA.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Barra de Ações do Documento Oficial */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500">
                Prontuário probatório consolidado para emissão oficial.
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reiniciar Demonstração</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé Informativo da Animação */}
      <div className="border-t border-slate-200 bg-white px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
          <span>Fé Pública amparada na Lei nº 14.063/2020 e Arts. 17 e 143 do ECA.</span>
        </div>
        <span className="font-mono text-slate-400">
          Coreografia Contínua ~9s • Zero Digitação Manual
        </span>
      </div>
    </div>
  );
}
