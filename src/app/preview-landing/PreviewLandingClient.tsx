'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Send,
  MessageSquare,
  CheckCheck,
  Clock,
  User,
  ShieldCheck,
  FileText,
  ChevronRight,
  ArrowRight,
  Sparkles,
  Lock,
  Building2,
  ExternalLink,
  Check,
  Layers,
  Zap,
} from 'lucide-react';
import WorkflowAnimation from '@/components/landing/WorkflowAnimation';
import MasterWorkflowAnimation from '@/components/landing/MasterWorkflowAnimation';

export default function PreviewLandingClient() {
  const [animationMode, setAnimationMode] = useState<'master' | 'simple'>('master');
  const scrollToDemo = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const element = document.getElementById('workflow-demo');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 text-slate-900 selection:bg-blue-100 selection:text-blue-900 font-sans">
      {/* 1. Barra Superior de Notificação (Ambiente de Demonstração) */}
      <div className="bg-blue-900 text-white text-xs py-2 px-4 shadow-sm border-b border-blue-950 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 max-w-4xl mx-auto w-full justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold tracking-wide">
              Ambiente de Demonstração / Preview Landing Page
            </span>
            <span className="hidden md:inline text-blue-200">
              — Simulação interativa do fluxo assistido da Rede Ativa SaaS
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-blue-800 text-blue-100 font-mono border border-blue-700">
              Modo Claro • Dados Fictícios (LGPD/ECA)
            </span>
          </div>
        </div>
      </div>

      {/* 2. Cabeçalho de Navegação Institucional */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Marca Rede Ativa */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-black text-slate-900 text-lg tracking-tight block leading-tight">
                Rede Ativa<span className="text-blue-600"> SaaS</span>
              </span>
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                Busca Ativa & Fé Pública
              </span>
            </div>
          </div>

          {/* Links Centrais de Navegação */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-600">
            <a
              href="#workflow-demo"
              onClick={scrollToDemo}
              className="hover:text-blue-600 transition-colors"
            >
              Fluxo Operacional
            </a>
            <a href="#beneficios" className="hover:text-blue-600 transition-colors">
              Benefícios
            </a>
            <a href="#fe-publica" className="hover:text-blue-600 transition-colors">
              Fé Pública & Lei 14.063
            </a>
          </nav>

          {/* Botão de Ação para o Sistema */}
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Acessar Plataforma</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* 3. Seção Hero */}
      <section className="relative pt-12 pb-16 sm:pt-16 sm:pb-20 overflow-hidden bg-gradient-to-b from-white via-slate-50 to-slate-100/60 border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          {/* Badge de Impacto */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Tecnologia Educacional & Fé Pública Probatória</span>
          </div>

          {/* Título Principal */}
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.15]">
            Combate à evasão escolar com busca ativa assistida e fé pública probatória
          </h1>

          {/* Subtítulo Explicativo */}
          <p className="max-w-3xl mx-auto text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
            A plataforma educacional desenhada no chão de escola que devolve até 80% do tempo da equipe
            pedagógica, automatiza a busca ativa e formaliza o Livro de Atas com Fé Pública (Lei nº 14.063/2020).
          </p>

          {/* Botões de Ação */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <a
              href="#workflow-demo"
              onClick={scrollToDemo}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Explorar Demonstração Interativa</span>
              <ChevronRight className="w-4 h-4" />
            </a>

            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-2xs transition-all hover:text-slate-900"
            >
              <span>Acessar Painel</span>
              <ExternalLink className="w-4 h-4 text-slate-400" />
            </Link>
          </div>

          {/* Faixa de Destaques Rápidos */}
          <div className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-3 text-left max-w-4xl mx-auto">
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-medium text-slate-700">
                Zero digitação manual no WhatsApp
              </span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-medium text-slate-700">
                Conformidade LGPD e ECA Arts. 17 e 143
              </span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-medium text-slate-700">
                Livro de Atas Digital (Lei nº 14.063/2020)
              </span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-medium text-slate-700">
                Prontuário 360º com Dossiê em PDF
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Seção Central de Destaque: Componentes de Animação */}
      <section id="workflow-demo" className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Layers className="w-3.5 h-3.5 text-emerald-600" />
            <span>Fluxo Operacional na Prática</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Como funciona na prática: Da detecção à fé pública probatória
          </h2>
          <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-600">
            Veja como a plataforma elimina horas de burocracia mecânica e formaliza a escrituração
            escolar com respaldo legal irrefutável.
          </p>

          {/* Seletor de Experiência da Demonstração */}
          <div className="pt-4 flex items-center justify-center">
            <div className="inline-flex p-1 rounded-xl bg-slate-200/80 border border-slate-300 shadow-2xs gap-1">
              <button
                type="button"
                onClick={() => setAnimationMode('master')}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  animationMode === 'master'
                    ? 'bg-white text-blue-900 shadow-xs ring-1 ring-slate-300'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-blue-600" />
                <span>Fluxo Completo (Busca Ativa, Atas e Dossiê)</span>
              </button>

              <button
                type="button"
                onClick={() => setAnimationMode('simple')}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  animationMode === 'simple'
                    ? 'bg-white text-emerald-900 shadow-xs ring-1 ring-slate-300'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                <span>Busca Ativa WhatsApp</span>
              </button>
            </div>
          </div>
        </div>

        {/* Instância Alternável de Animação */}
        {animationMode === 'master' ? <MasterWorkflowAnimation /> : <WorkflowAnimation />}
      </section>

      {/* 5. Seção de Benefícios em 3 Colunas */}
      <section id="beneficios" className="py-16 sm:py-20 bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-3 mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Projetado para a rotina real da equipe pedagógica
            </h2>
            <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-600">
              Elimine pilhas de papéis, anotações perdidas em agendas pessoais e atenda às exigências
              legais com rigor probatório.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            {/* Benefício 1: Disparo Ágil WhatsApp */}
            <div className="bg-slate-50/70 rounded-2xl p-6 sm:p-7 border border-slate-200 flex flex-col justify-between hover:border-slate-300 transition-colors">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Disparo Ágil via WhatsApp
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Sem digitação manual de mensagens e sem a necessidade de salvar centenas de números
                  de responsáveis em celulares pessoais de pedagogas.
                </p>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Modelos nominais e pré-formatados em 1 clique</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Controle rígido de tentativas e contatos sem retorno</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Respeito absoluto à privacidade e horários escolares</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Benefício 2: Linha do Tempo e Prontuário 360º */}
            <div className="bg-slate-50/70 rounded-2xl p-6 sm:p-7 border border-slate-200 flex flex-col justify-between hover:border-slate-300 transition-colors">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center border border-blue-200">
                  <User className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Linha do Tempo e Prontuário 360º
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Histórico pedagógico centralizado do estudante ao longo de todo o ano letivo,
                  unificando faltas, justificativas, atas e contatos.
                </p>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>Visão longitudinal da frequência e infrequência escolar</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>Alertas precoces de risco de abandono antes do teto do ECA</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>Histórico familiar preservado mesmo em mudanças de turma</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Benefício 3: Livro de Atas e Dossiês Oficiais */}
            <div id="fe-publica" className="bg-slate-50/70 rounded-2xl p-6 sm:p-7 border border-slate-200 flex flex-col justify-between hover:border-slate-300 transition-colors">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center border border-indigo-200">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Livro de Atas e Dossiês Oficiais
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Imutabilidade probatória com respaldo na Lei Federal nº 14.063/2020. Assinatura com
                  PIN de Fé Pública e cadeia de custódia inquestionável.
                </p>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <span>Hash criptográfico SHA-256 com rastreamento bipartido</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <span>Dossiê Oficial em PDF com certidão cega para o Conselho Tutelar</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <span>Termos Aditivos (&quot;Em Tempo&quot;) com encadeamento seguro</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Seção de Chamada Final para Ação */}
      <section className="py-16 sm:py-20 bg-slate-900 text-white text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-900/60 text-blue-300 border border-blue-700">
            <Lock className="w-3.5 h-3.5 text-blue-400" />
            <span>Infraestrutura Multi-Escola Segura</span>
          </div>

          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight">
            Pronto para transformar a gestão de infrequência e atas da sua escola?
          </h2>

          <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-300 font-normal">
            Acesse a plataforma institucional e experimente a velocidade da Busca Ativa combinada ao
            respaldo probatório da Fé Pública digital.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Acessar Plataforma</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 7. Rodapé Institucional da Demonstração */}
      <footer className="bg-slate-950 text-slate-400 py-8 px-4 sm:px-6 lg:px-8 border-t border-slate-800 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-300">
            <ShieldCheck className="w-4 h-4 text-blue-500" />
            <span className="font-semibold">Rede Ativa SaaS</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">
              Busca Ativa, Frequência Escolar & Livro Digital de Atas
            </span>
          </div>

          <div className="text-slate-500 text-center md:text-right space-y-1">
            <p>
              Em conformidade com a Lei nº 14.063/2020, Lei nº 13.709/2018 (LGPD) e Arts. 17 e 143 do
              ECA.
            </p>
            <p className="text-[11px] text-slate-600">
              Página de Demonstração e Homologação de Interface • Todos os dados exibidos são puramente
              fictícios.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
