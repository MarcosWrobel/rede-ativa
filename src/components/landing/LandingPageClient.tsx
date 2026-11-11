'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  User,
  ShieldCheck,
  FileText,
  ChevronRight,
  ArrowRight,
  LogIn,
  ExternalLink,
  Check,
  Layers,
  Zap,
} from 'lucide-react';
import WorkflowAnimation from '@/components/landing/WorkflowAnimation';
import MasterWorkflowAnimation from '@/components/landing/MasterWorkflowAnimation';

export interface LandingPageClientProps {
  mode?: 'production' | 'preview';
}

export default function LandingPageClient({ mode = 'production' }: LandingPageClientProps) {
  const [animationMode, setAnimationMode] = useState<'master' | 'simple'>('master');
  const isPreview = mode === 'preview';

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
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          <Link
            href={isPreview ? '/preview-landing' : '/'}
            className="flex items-center group py-1 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <div className="h-12 w-auto flex items-center justify-center p-1.5 rounded-xl bg-slate-50/80 border border-slate-200/80 shadow-xs transition-transform group-hover:scale-102">
              <img
                src="/logo.svg"
                alt="Rede Ativa"
                className="h-9 w-auto object-contain"
              />
            </div>
          </Link>

          <nav
            aria-label="Navegação principal"
            className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-600"
          >
            <a
              href="#workflow-demo"
              onClick={scrollToDemo}
              className="hover:text-emerald-700 transition-colors rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Fluxo na prática
            </a>
            <a
              href="#beneficios"
              className="hover:text-emerald-700 transition-colors rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Funcionalidades
            </a>
            <a
              href="#seguranca-dados"
              className="hover:text-emerald-700 transition-colors rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Atas e relatórios
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4.5 py-2.5 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-2 shadow-sm shadow-slate-900/10 transition-all transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <LogIn className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Acessar sistema</span>
            </Link>
          </div>
        </div>
      </header>

      {/* 3. Hero */}
      <section className="relative pt-12 pb-16 md:pt-16 md:pb-24 overflow-hidden border-b border-slate-100 bg-gradient-to-b from-slate-50/80 via-white to-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs mb-5">
            <User className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
            <span>Rotina da equipe pedagógica</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.2] max-w-4xl mx-auto">
            <span className="block text-slate-800">Conecte os contatos com as famílias,</span>
            <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 bg-clip-text text-transparent inline-block [@media(forced-colors:active)]:bg-none [@media(forced-colors:active)]:text-[CanvasText]">
              os atendimentos e as atas em um único fluxo.
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg lg:text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
            A Rede Ativa ajuda a equipe pedagógica a preparar e enviar mensagens com supervisão
            humana, registrar intervenções e consultar o histórico de cada estudante.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#workflow-demo"
              onClick={scrollToDemo}
              className="px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <span>Conhecer o fluxo</span>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </a>

            <Link
              href="/login"
              className="px-6 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm border border-slate-200 shadow-xs flex items-center justify-center gap-2 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <span>Acessar sistema</span>
              <ExternalLink className="w-4 h-4 text-slate-500" aria-hidden="true" />
            </Link>
          </div>

          {/* 4 Cards de Destaque Sem Redundância */}
          <div className="mt-12 pt-8 border-t border-slate-200/80 max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-xs font-semibold text-slate-800 leading-tight">
                Mensagem pronta em 1 clique
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-xs font-semibold text-slate-800 leading-tight">
                Atas padronizadas e prontas em instantes
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-xs font-semibold text-slate-800 leading-tight">
                Redução da exposição de conversas na tela
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-xs font-semibold text-slate-800 leading-tight">
                Relatório de contatos e intervenções
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Seção Central: Simulação Demonstrativa */}
      <section id="workflow-demo" className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80">
            <Layers className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
            <span>Simulação demonstrativa • Dados fictícios</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Da preparação do contato ao histórico do estudante
          </h2>

          {/* Seletor de Visualização */}
          <div className="pt-2 flex items-center justify-center">
            <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 shadow-2xs gap-1">
              <button
                type="button"
                onClick={() => setAnimationMode('master')}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                  animationMode === 'master'
                    ? 'bg-white text-emerald-900 shadow-xs ring-1 ring-emerald-200'
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
                    ? 'bg-white text-sky-900 shadow-xs ring-1 ring-sky-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
                <span>Contatos com famílias</span>
              </button>
            </div>
          </div>
        </div>

        {animationMode === 'master' ? <MasterWorkflowAnimation /> : <WorkflowAnimation />}
      </section>

      {/* 5. Funcionalidades em 3 Colunas */}
      <section id="beneficios" className="py-16 sm:py-20 bg-slate-50/70 border-y border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Menos retrabalho na busca ativa e nas atas
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            {/* Coluna 1: Emerald */}
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between hover:border-emerald-200 transition-colors">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200">
                  <MessageSquare className="w-6 h-6" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Contato com famílias sob revisão
                </h3>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
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
            </div>

            {/* Coluna 2: Sky */}
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between hover:border-sky-200 transition-colors">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center border border-sky-200">
                  <User className="w-6 h-6" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Histórico contínuo do estudante
                </h3>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
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
            </div>

            {/* Coluna 3: Teal */}
            <div
              id="seguranca-dados"
              className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between hover:border-teal-200 transition-colors"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center border border-teal-200">
                  <FileText className="w-6 h-6" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Atas pedagógicas e relatórios
                </h3>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
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
          </div>
        </div>
      </section>

      {/* 6. Chamada Final Enxuta (Espaço reservado para futuro módulo de formulário de contato) */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-slate-50 to-white text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center p-2.5 mx-auto mb-5">
            <img src="/logo-symbol.svg" alt="" aria-hidden="true" className="w-full h-full object-contain" />
          </div>

          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Acompanhe cada estudante sem perder registros pelo caminho
          </h2>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/login"
              className="px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <span>Acessar sistema</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
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
