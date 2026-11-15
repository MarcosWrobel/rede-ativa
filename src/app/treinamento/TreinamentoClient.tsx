"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Share2,
  FileSpreadsheet,
  MessageSquare,
  FileCheck2,
  FolderKanban,
  AppWindow,
  ChevronDown,
  Check,
  ExternalLink,
  GraduationCap,
} from "lucide-react";
import PedagogicalFlowSimulator from "@/components/PedagogicalFlowSimulator";
import type { PlatformEdition } from "@/lib/platformEditions";

export interface TreinamentoClientProps {
  schoolEdition: PlatformEdition;
  isSuperAdmin?: boolean;
  schoolName?: string;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const OPERATIONAL_FAQS: FaqItem[] = [
  {
    id: "faq-faltas",
    question: "Qual a diferença entre importar matrículas e atualizar faltas?",
    answer:
      "A importação de matrículas organiza as turmas, os turnos e a lista de estudantes da escola. Já a atualização de faltas lê a planilha periódica compatível com relatórios para destacar faltas consecutivas ou alternadas sem duplicar cadastros.",
  },
  {
    id: "faq-whatsapp",
    question: "O sistema envia mensagens de WhatsApp sozinho?",
    answer:
      "Não. O sistema prepara o texto com os dados do estudante e abre a conversa de forma assistida. A equipe pedagógica confere o destinatário e o conteúdo antes de confirmar o envio e registrar o retorno da família.",
  },
  {
    id: "faq-ata-edicao",
    question: "O que acontece após confirmar uma ata pedagógica com PIN?",
    answer:
      "Após a confirmação de autoria por PIN, o texto principal da ata fica bloqueado para edição direta. Qualquer retificação ou acréscimo é registrado em complemento vinculado à ata, preservando o histórico.",
  },
  {
    id: "faq-ata-prazo",
    question: "É possível registrar um atendimento ocorrido há mais de 5 dias úteis?",
    answer:
      "Sim. Ao informar uma data de atendimento anterior a 5 dias úteis, o editor solicita uma justificativa de registro fora do prazo antes da confirmação final.",
  },
  {
    id: "faq-relatorio",
    question: "Como preparar o histórico do estudante para encaminhamento externo?",
    answer:
      "No prontuário do estudante, a equipe pode gerar o relatório de contatos e intervenções com data, fonte e autoria de cada registro. O arquivo exportável subsidia o envio conforme os procedimentos da rede e do órgão destinatário.",
  },
];

export default function TreinamentoClient({
  schoolEdition,
  isSuperAdmin = false,
  schoolName,
}: TreinamentoClientProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [openFaqId, setOpenFaqId] = useState<string | null>(OPERATIONAL_FAQS[0].id);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPilotGuide = schoolEdition === "PILOTO_INTEGRADA" || Boolean(isSuperAdmin);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleSharePresentation = async () => {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";
    const shareUrl = `${origin}/impacto`;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setToastMessage("Link copiado.");
    } catch {
      setToastMessage("Não foi possível copiar.");
    }

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  return (
    <div className="space-y-8 pb-10">
      {/* Cabeçalho da Central de Orientação */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Orientação e Guias Operacionais
            </h1>
            {schoolName && (
              <span className="inline-block mt-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                {schoolName}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {toastMessage && (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200"
            >
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              {toastMessage}
            </span>
          )}
          <button
            type="button"
            onClick={handleSharePresentation}
            aria-label="Copiar link público da apresentação da plataforma"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <Share2 className="w-4 h-4 text-emerald-400 dark:text-white" aria-hidden="true" />
            <span>Compartilhar apresentação</span>
          </button>
        </div>
      </div>

      {/* Simulador no Topo */}
      <PedagogicalFlowSimulator
        mode="internal"
        schoolEdition={schoolEdition}
        isSuperAdmin={isSuperAdmin}
      />

      {/* Guias Passo a Passo */}
      <section aria-labelledby="guias-titulo" className="space-y-4">
        <h2
          id="guias-titulo"
          className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight"
        >
          Guias passo a passo por atividade pedagógica
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Guia 1 */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Guia 1: Importação de Matrículas e Atualização de Faltas
                </h3>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <li>
                  Cadastre ou importe primeiro as turmas por turno e a relação de estudantes matriculados.
                </li>
                <li>
                  Periodicamente, importe o arquivo compatível com relatórios (planilha ou CSV) para atualizar faltas consecutivas e alternadas.
                </li>
                <li>
                  Confira a lista por turma antes de iniciar a busca ativa com as famílias.
                </li>
              </ol>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <Link
                href="/alunos"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition"
              >
                <span>Abrir estudantes</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
          </article>

          {/* Guia 2 */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Guia 2: Busca Ativa, Tentativas de Contato e Atestados
                </h3>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <li>
                  Verifique na fila se o estudante já possui atestado médico ou justificativa vigente antes do contato.
                </li>
                <li>
                  Acione a abertura assistida do WhatsApp, revise o destinatário e o texto preparado e conclua com envio pela equipe.
                </li>
                <li>
                  Registre a resposta da família e o resultado da tentativa de contato no histórico.
                </li>
              </ol>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
              <Link
                href="/busca-ativa"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition"
              >
                <span>Abrir busca ativa</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
              <Link
                href="/atestados"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition"
              >
                <span>Ver atestados</span>
              </Link>
            </div>
          </article>

          {/* Guia 3 */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 flex items-center justify-center shrink-0">
                  <FileCheck2 className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Guia 3: Ata Pedagógica, Assinatura do Responsável e Complementos
                </h3>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <li>
                  Revise a minuta da ata pedagógica e, quando o atendimento tiver mais de 5 dias úteis, informe a justificativa fora do prazo.
                </li>
                <li>
                  Colete a assinatura do responsável legal presencialmente ou via QR Code e finalize com confirmação de autoria por PIN.
                </li>
                <li>
                  Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico.
                </li>
              </ol>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <Link
                href="/atas"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition"
              >
                <span>Abrir atas</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
          </article>

          {/* Guia 4 */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
                  <FolderKanban className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Guia 4: Histórico de Acompanhamento e Relatório de Intervenções
                </h3>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <li>
                  Abra o prontuário do estudante para consultar em ordem cronológica as tentativas de contato, atestados e atas pedagógicas.
                </li>
                <li>
                  Confira a separação entre fatos registrados e relatos da família, com proteção de identidade de terceiros.
                </li>
                <li>
                  Exporte o relatório de contatos e intervenções para subsidiar o encaminhamento conforme as normas da rede.
                </li>
              </ol>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <Link
                href="/alunos"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold transition"
              >
                <span>Ver estudantes</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
          </article>

          {/* Guia 5: Exclusivo para PILOTO_INTEGRADA ou SUPERADMIN */}
          {showPilotGuide && (
            <article className="md:col-span-2 rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/30 p-5 shadow-xs flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 border border-sky-200 flex items-center justify-center shrink-0">
                      <AppWindow className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Guia 5: Configuração da Extensão de Navegador e Janela Compacta
                    </h3>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
                    Edição Piloto
                  </span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  <li>
                    Instale o pacote da extensão de navegador no computador da coordenação e informe a chave da escola disponível na área de gestão.
                  </li>
                  <li>
                    Utilize a janela dedicada compacta ao abrir o WhatsApp Web para manter a redução da exposição de conversas na tela durante o atendimento.
                  </li>
                  <li>
                    Ao receber o retorno do responsável legal, acione a captura assistida e revise o registro antes de salvar no histórico.
                  </li>
                </ol>
              </div>
              <div className="pt-2 border-t border-sky-200/70 dark:border-sky-800/70">
                <Link
                  href="/configuracoes/escola"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold transition"
                >
                  <span>Abrir configurações</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </div>
            </article>
          )}
        </div>
      </section>

      {/* Perguntas Frequentes Operacionais */}
      <section aria-labelledby="faq-titulo" className="space-y-4">
        <h2
          id="faq-titulo"
          className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight"
        >
          Perguntas frequentes operacionais
        </h2>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800 shadow-xs overflow-hidden">
          {OPERATIONAL_FAQS.map((faq) => {
            const isOpen = openFaqId === faq.id;
            return (
              <div key={faq.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`${faq.id}-panel`}
                  onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                  className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-emerald-600"
                >
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {faq.question}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <div
                    id={`${faq.id}-panel`}
                    className="px-5 pb-4 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
                  >
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
