'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  User,
  ShieldCheck,
  FileText,
  LogIn,
  ExternalLink,
  Check,
  Layers,
  Zap,
  LockKeyhole,
  EyeOff,
  Building2,
} from 'lucide-react';
import WorkflowAnimation from '@/components/landing/WorkflowAnimation';
import MasterWorkflowAnimation from '@/components/landing/MasterWorkflowAnimation';
import PedagogicalFlowSimulator from '@/components/PedagogicalFlowSimulator';

/**
 * Controla a exibição dos dois painéis legados da seção `#workflow-demo`
 * ("Fluxo completo" via `MasterWorkflowAnimation` e "Contatos com famílias"
 * via `WorkflowAnimation`) junto à barra de abas seletoras.
 *
 * Para reativar ambos os painéis em produção no futuro, altere o valor para
 * `true`. Enquanto permanecer `false`, apenas `<PedagogicalFlowSimulator mode="public" />`
 * é exibido como visão única da demonstração.
 */
export const ENABLE_LEGACY_WORKFLOW_PANELS = false;

export interface LandingPageClientProps {
  mode?: 'production' | 'preview';
}

const NETWORK_ROLES: Array<{
  key: 'pedagogica' | 'direcao' | 'secretaria';
  label: string;
  scope: string;
  summary: string;
  items: string[];
}> = [
  {
    key: 'pedagogica',
    label: 'Equipe Pedagógica',
    scope: 'Rotina diária da unidade',
    summary:
      'Organização das tentativas de contato por turma e turno, conferência de atestados vigentes, preparação de mensagens e atas pedagógicas.',
    items: [
      'Preparo de mensagens com dados do estudante e revisão antes do envio',
      'Registro de retorno da família e justificativas em sequência contínua',
      'Elaboração de minuta de ata com confirmação de autoria por PIN',
    ],
  },
  {
    key: 'direcao',
    label: 'Direção Escolar',
    scope: 'Acompanhamento da escola',
    summary:
      'Acompanhamento de encaminhamentos e prazos, confirmação de atas e gestão da equipe pedagógica.',
    items: [
      'Visão dos encaminhamentos pendentes e prazos da unidade escolar',
      'Acompanhamento das atas confirmadas e complementos vinculados',
      'Gestão de acessos e organização da equipe escolar',
    ],
  },
  {
    key: 'secretaria',
    label: 'Secretaria de Educação',
    scope: 'Visão consolidada da rede',
    summary:
      'Leitura consolidada de infrequência e acompanhamento de abandono e evasão entre as escolas da rede.',
    items: [
      'Indicadores consolidados de infrequência por unidade de ensino',
      'Acompanhamento de casos de abandono e evasão na rede',
      'Padronização de relatórios de contatos e intervenções',
    ],
  },
];

const INSTITUTIONAL_SAFEGUARDS: Array<{
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}> = [
  {
    title: 'Autoria por PIN e histórico preservado',
    description:
      'Atas confirmadas por PIN do servidor ficam bloqueadas contra edição direta; retificações posteriores são registradas em complemento vinculado à ata original.',
    icon: LockKeyhole,
  },
  {
    title: 'Privacidade em textos assistidos e relatórios',
    description:
      'Nomes e documentos de estudantes e responsáveis são substituídos por códigos antes de qualquer apoio automatizado, com proteção por iniciais para terceiros nos relatórios.',
    icon: EyeOff,
  },
  {
    title: 'Isolamento por escola e rede de ensino',
    description:
      'Cada unidade escolar e secretaria acessa exclusivamente os registros da própria instituição, com controle de permissões separado por perfil de atuação.',
    icon: Building2,
  },
];

const FINAL_STATEMENT_WORDS = [
  'Acompanhe',
  'cada',
  'estudante',
  'sem',
  'perder',
  'registros',
  'pelo',
  'caminho',
];

export default function LandingPageClient({ mode = 'production' }: LandingPageClientProps) {
  const [animationMode, setAnimationMode] = useState<'guided' | 'master' | 'simple'>('guided');
  const [litWordCount, setLitWordCount] = useState<number>(FINAL_STATEMENT_WORDS.length);
  const statementRef = useRef<HTMLDivElement>(null);
  const isPreview = mode === 'preview';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLitWordCount(FINAL_STATEMENT_WORDS.length);
      return;
    }

    let rafId = 0;
    const updateProgress = () => {
      rafId = 0;
      const el = statementRef.current;
      if (!el) return;
      const vh = window.innerHeight || 900;
      const atBottom =
        window.scrollY + vh >= document.documentElement.scrollHeight - 8;
      if (atBottom) {
        setLitWordCount(FINAL_STATEMENT_WORDS.length);
        return;
      }
      const rect = el.getBoundingClientRect();
      // Inicia o acendimento ao entrar na tela (90%) e conclui antes do fim da rolagem (55%)
      const raw = (vh * 0.9 - rect.top) / (vh * 0.35);
      const progress = Math.max(0, Math.min(1, raw));
      const count = Math.max(1, Math.round(progress * FINAL_STATEMENT_WORDS.length));
      setLitWordCount(count);
    };

    const onScroll = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(updateProgress);
      }
    };

    updateProgress();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const scrollToDemo = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const element = document.getElementById('workflow-demo');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      {/* 1. Barra Superior de Aviso (exclusiva da rota de preview/homologação) */}
      {isPreview && (
        <div className="bg-slate-900 text-white text-xs py-2 px-4 border-b border-slate-800">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" />
              <span className="font-semibold tracking-wide">
                Ambiente de Demonstração / Preview Landing Page
              </span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/70 text-emerald-200 font-mono text-[11px] border border-emerald-700/60">
              Modo Claro • Dados Fictícios
            </span>
          </div>
        </div>
      )}

      {/* 2. Cabeçalho Institucional com Logo */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          <Link
            href={isPreview ? '/preview-landing' : '/'}
            className="flex items-center py-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <img
              src="/logo.svg"
              alt="Rede Ativa"
              className="h-9 w-auto object-contain"
            />
          </Link>

          <nav
            aria-label="Navegação principal"
            className="hidden md:flex items-center gap-7 text-xs font-semibold text-slate-700"
          >
            <a
              href="#workflow-demo"
              onClick={scrollToDemo}
              className="landing-nav-link hover:text-emerald-700 transition-colors rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Fluxo na prática
            </a>
            <a
              href="#visao-papeis-titulo"
              className="landing-nav-link hover:text-emerald-700 transition-colors rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Atuação na rede
            </a>
            <a
              href="#beneficios"
              className="landing-nav-link hover:text-emerald-700 transition-colors rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Funcionalidades
            </a>
            <a
              href="#seguranca-dados"
              className="landing-nav-link hover:text-emerald-700 transition-colors rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Segurança dos registros
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="landing-btn px-4.5 py-2.5 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <LogIn className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Acessar sistema</span>
            </Link>
          </div>
        </div>
      </header>

      {/* 3. Hero */}
      <section className="relative overflow-hidden pt-14 pb-16 md:pt-20 md:pb-20 border-b border-slate-200/80 bg-gradient-to-b from-slate-50/70 via-white to-white">
        <div
          aria-hidden="true"
          className="landing-hero-dot-grid pointer-events-none absolute inset-0"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.16] max-w-4xl mx-auto">
            <span className="landing-hero-mask">
              <span className="landing-hero-line text-slate-800" style={{ animationDelay: '0ms' }}>
                Conecte os contatos com as famílias,
              </span>
            </span>
            <span className="landing-hero-mask">
              <span
                className="landing-hero-line bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 bg-clip-text text-transparent inline-block [@media(forced-colors:active)]:bg-none [@media(forced-colors:active)]:text-[CanvasText]"
                style={{ animationDelay: '80ms' }}
              >
                os atendimentos e as atas em um único fluxo.
              </span>
            </span>
          </h1>

          <p
            className="landing-hero-rise mt-6 text-base sm:text-lg lg:text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed"
            style={{ animationDelay: '240ms' }}
          >
            A Rede Ativa ajuda a equipe pedagógica a preparar e enviar mensagens com supervisão
            humana, registrar intervenções e consultar o histórico de cada estudante.
          </p>

          <div
            className="landing-hero-rise mt-8 flex flex-wrap items-center justify-center gap-4"
            style={{ animationDelay: '300ms' }}
          >
            <a
              href="#workflow-demo"
              onClick={scrollToDemo}
              className="landing-btn t-learn px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <span>Conhecer o fluxo</span>
              <span className="t-learn-chevron" aria-hidden="true">
                <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                  <path
                    className="t-learn-arm t-learn-arm-top"
                    d="M6 4L10 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    className="t-learn-arm t-learn-arm-bot"
                    d="M10 8L6 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </a>

            <Link
              href="/login"
              className="landing-btn px-6 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm border border-slate-300 flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <span>Acessar sistema</span>
              <ExternalLink className="landing-arrow w-4 h-4 text-slate-500" aria-hidden="true" />
            </Link>
          </div>

          {/* 4 Destaques Operacionais em Faixa Editorial Limpa */}
          <div
            className="landing-hero-rise mt-14 pt-8 border-t border-slate-200/90 max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-left"
            style={{ animationDelay: '360ms' }}
          >
            <div className="flex items-start gap-2.5">
              <MessageSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-800 leading-snug">
                Mensagem pronta em 1 clique
              </span>
            </div>

            <div className="flex items-start gap-2.5">
              <FileText className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-800 leading-snug">
                Atas padronizadas e prontas em instantes
              </span>
            </div>

            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-800 leading-snug">
                Redução da exposição de conversas na tela
              </span>
            </div>

            <div className="flex items-start gap-2.5">
              <Layers className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-800 leading-snug">
                Relatório de contatos e intervenções
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Seção Central: Simulação Demonstrativa */}
      <section id="workflow-demo" className="landing-anchor py-16 sm:py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-3 mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Da preparação do contato ao histórico do estudante
          </h2>

          {/* Seletor de Visualização (oculto quando ENABLE_LEGACY_WORKFLOW_PANELS = false) */}
          {ENABLE_LEGACY_WORKFLOW_PANELS && (
            <div className="pt-2 flex items-center justify-center">
              <div className="inline-flex flex-wrap justify-center p-1 rounded-xl bg-slate-100 border border-slate-200 gap-1">
                <button
                  type="button"
                  onClick={() => setAnimationMode('guided')}
                  className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                    animationMode === 'guided'
                      ? 'bg-white text-emerald-900 ring-1 ring-emerald-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                  <span>Simulação guiada</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAnimationMode('master')}
                  className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                    animationMode === 'master'
                      ? 'bg-white text-emerald-900 ring-1 ring-emerald-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                  <span>Fluxo completo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAnimationMode('simple')}
                  className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                    animationMode === 'simple'
                      ? 'bg-white text-sky-900 ring-1 ring-sky-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
                  <span>Contatos com famílias</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {ENABLE_LEGACY_WORKFLOW_PANELS ? (
          animationMode === 'guided' ? (
            <PedagogicalFlowSimulator mode="public" />
          ) : animationMode === 'master' ? (
            <MasterWorkflowAnimation />
          ) : (
            <WorkflowAnimation />
          )
        ) : (
          <PedagogicalFlowSimulator mode="public" />
        )}
      </section>

      {/* 4.5. Comparativo Direto por Papel na Rede de Ensino */}
      <section
        id="visao-papeis"
        aria-labelledby="visao-papeis-titulo"
        className="landing-anchor py-14 sm:py-18 border-t border-slate-200/80 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
      >
        <div className="mb-10 max-w-2xl">
          <h2
            id="visao-papeis-titulo"
            className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight"
          >
            Atuação por papel na rede de ensino
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-y border-slate-200">
          {NETWORK_ROLES.map((role) => (
            <div key={role.key} className="py-6 md:py-8 md:px-7 first:md:pl-0 last:md:pr-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                {role.scope}
              </p>
              <h3 className="mt-1.5 text-lg font-bold text-slate-900">{role.label}</h3>
              <p className="mt-2.5 text-xs text-slate-700 leading-relaxed">{role.summary}</p>
              <ul className="mt-4 space-y-2.5 text-xs text-slate-700 pt-4 border-t border-slate-200/80">
                {role.items.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Funcionalidades e Segurança dos Registros */}
      <section id="beneficios" className="landing-anchor py-16 sm:py-20 bg-slate-50/70 border-y border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="max-w-xl">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Menos retrabalho na busca ativa e nas atas
              </h2>
            </div>

            {/* Diagrama lanes com pulsos suaves (1 entrada -> núcleo -> 3 trilhas) */}
            <div
              aria-hidden="true"
              className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-[11px] font-semibold text-slate-700"
            >
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 whitespace-nowrap">
                Falta ou atendimento
              </span>
              <svg viewBox="0 0 36 16" className="w-8 h-4 shrink-0" fill="none">
                <path d="M0 8 H36" stroke="#cbd5e1" strokeWidth="1.5" />
                <path d="M0 8 H36" stroke="#059669" strokeWidth="1.75" className="landing-lane-pulse" />
              </svg>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold whitespace-nowrap">
                Rede Ativa
              </span>
              <svg viewBox="0 0 44 48" className="w-10 h-12 shrink-0" fill="none">
                <path d="M0 24 C18 24, 22 8, 44 8" stroke="#cbd5e1" strokeWidth="1.4" />
                <path d="M0 24 H44" stroke="#cbd5e1" strokeWidth="1.4" />
                <path d="M0 24 C18 24, 22 40, 44 40" stroke="#cbd5e1" strokeWidth="1.4" />
                <path d="M0 24 C18 24, 22 8, 44 8" stroke="#059669" strokeWidth="1.7" className="landing-lane-pulse" />
                <path d="M0 24 H44" stroke="#0284c7" strokeWidth="1.7" className="landing-lane-pulse" />
                <path d="M0 24 C18 24, 22 40, 44 40" stroke="#0d9488" strokeWidth="1.7" className="landing-lane-pulse" />
              </svg>
              <div className="flex flex-col gap-1 text-[10px] font-semibold text-slate-700 whitespace-nowrap">
                <span>Busca Ativa</span>
                <span>Ata Pedagógica</span>
                <span>Relatório</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            <div className="border-t-2 border-emerald-600 pt-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-5 h-5 text-emerald-700 shrink-0" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">
                  Contato com famílias sob revisão
                </h3>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Texto preenchido com dados do estudante, editável antes do envio</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Registro de abertura assistida no WhatsApp, tentativas e retornos</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Redução da exposição de conversas pessoais na tela</span>
                </li>
              </ul>
            </div>

            <div className="border-t-2 border-sky-600 pt-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <User className="w-5 h-5 text-sky-700 shrink-0" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">
                  Histórico contínuo do estudante
                </h3>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Faltas importadas de planilhas compatíveis e justificativas</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Identificação de origem, data e autoria por registro</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Acompanhamento familiar preservado em mudanças de turma</span>
                </li>
              </ul>
            </div>

            <div className="border-t-2 border-teal-600 pt-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-teal-700 shrink-0" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">
                  Atas pedagógicas e relatórios
                </h3>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Minuta editável com confirmação de autoria por PIN</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Correções após confirmação registradas em complemento vinculado</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Relatório de contatos e intervenções exportável conforme a rede</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Bloco objetivo de Segurança e Integridade Institucional */}
          <div id="seguranca-dados" className="landing-anchor mt-14 pt-12 border-t border-slate-200">
            <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight mb-6">
              Segurança dos registros e governança institucional
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {INSTITUTIONAL_SAFEGUARDS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-slate-700 shrink-0" aria-hidden={true} />
                      <h4 className="text-sm font-bold text-slate-900">{item.title}</h4>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">{item.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 6. Chamada Final Enxuta com word-highlight (Espaço reservado para futuro módulo de formulário de contato) */}
      <section className="py-16 md:py-24 bg-white text-center">
        <div ref={statementRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <img
            src="/logo-symbol.svg"
            alt=""
            aria-hidden="true"
            className="w-10 h-10 object-contain mx-auto mb-5"
          />

          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">
            {FINAL_STATEMENT_WORDS.map((word, index) => (
              <React.Fragment key={`${word}-${index}`}>
                <span
                  className={`transition-colors duration-200 ${
                    index < litWordCount ? 'text-slate-900' : 'text-slate-300'
                  }`}
                >
                  {word}
                </span>
                {index < FINAL_STATEMENT_WORDS.length - 1 ? ' ' : ''}
              </React.Fragment>
            ))}
          </h2>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/login"
              className="landing-btn t-learn px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <span>Acessar sistema</span>
              <span className="t-learn-chevron" aria-hidden="true">
                <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                  <path
                    className="t-learn-arm t-learn-arm-top"
                    d="M6 4L10 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    className="t-learn-arm t-learn-arm-bot"
                    d="M10 8L6 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* 7. Rodapé com Logo (Dados empresariais, privacidade e termos serão exibidos após configuração oficial) */}
      <footer className="border-t border-slate-200 bg-white py-10 text-xs text-slate-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center">
            <img src="/logo.svg" alt="Rede Ativa" className="h-8 w-auto object-contain" />
          </div>

          <p className="text-xs text-slate-600 text-center md:text-right">
            {isPreview
              ? 'Demonstração de interface • Dados exibidos puramente fictícios.'
              : 'Acompanhamento escolar e registro pedagógico.'}
          </p>
        </div>
      </footer>
    </div>
  );
}
