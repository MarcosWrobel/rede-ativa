"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, FileCheck2 } from "lucide-react";
import {
  KINSHIP_LABELS,
  JUSTIFICATION_TYPE_LABELS,
  parseEnrollmentDetailMetrics,
} from "@/lib/pedagogicalClassifier";
import { anonymizeOtherMinorsInText } from "@/lib/ataCrypto";
import {
  REPLY_CATEGORY_LABELS,
  type ReplyCategory,
} from "@/lib/whatsappProvider";

interface Props {
  student: any;
  contacts: any[];
  justifications: any[];
  attendances: any[];
  snapshots: any[];
  minutes?: any[];
  school?: {
    name: string;
    city: string;
    nre: string;
    inepCode?: string;
  };
  emittedBy: {
    name: string;
    email: string;
  };
  emittedAtIso: string;
}

export default function DossieClient({
  student,
  contacts,
  justifications,
  attendances,
  snapshots,
  minutes = [],
  school,
  emittedBy,
  emittedAtIso,
}: Props) {
  const lowAtt = student.lowAttendanceRecord;
  const detailMetrics = parseEnrollmentDetailMetrics(lowAtt?.enrollmentDetail);
  const cgm = student.cgm || detailMetrics.cgm || "Não informado";

  const [destinatario, setDestinatario] = useState(
    "Conselho Tutelar / Rede de Proteção à Criança e ao Adolescente (SERP)"
  );
  const [showFullMessages, setShowFullMessages] = useState(false);
  const [anonymizeOtherMinors, setAnonymizeOtherMinors] = useState(true);
  const [includeConfidential, setIncludeConfidential] = useState(false);

  const totalLogs = student.messageLogs?.length || 0;
  const failedLogs = (student.messageLogs || []).filter(
    (l: any) => l.deliveryStatus === "FAILED_NO_WHATSAPP"
  ).length;
  const effectiveLogs = Math.max(0, totalLogs - failedLogs);
  const repliedLogs = (student.messageLogs || []).filter((l: any) => l.guardianReplied).length;

  const [parecerFinal, setParecerFinal] = useState(() => {
    const freqTxt = lowAtt
      ? `apresenta percentual acumulado de frequência escolar de ${lowAtt.attendancePercent.toFixed(1)}%`
      : "encontra-se em acompanhamento preventivo de assiduidade escolar";
    const failedClause =
      failedLogs > 0
        ? ` (além de ${failedLogs} tentativa(s) frustrada(s) em número cadastral sem conta ativa no WhatsApp)`
        : "";
    return `Certificamos, para os devidos fins legais junto aos órgãos da Rede de Proteção (Art. 56, inciso II do Estatuto da Criança e do Adolescente — Lei nº 8.069/1990 e LDB — Lei nº 9.394/1996), que a Equipe Pedagógica do Colégio Estadual Leopoldina B. Pedroso realizou ${effectiveLogs} acionamento(s) efetivo(s) de Busca Ativa Escolar${failedClause}, obtendo ${repliedLogs} retorno(s) familiar(es), e ${attendances.length} atendimento(s) presencial(is) referentes ao(à) estudante ${student.name}, que atualmente ${freqTxt}.`;
  });

  useEffect(() => {
    const prevTitle = document.title;
    const cleanName = student.name.replace(/\s+/g, "_").slice(0, 35);
    document.title = `Dossie_Busca_Ativa_${cgm !== "Não informado" ? cgm + "_" : ""}${cleanName}`;
    return () => {
      document.title = prevTitle;
    };
  }, [student.name, cgm]);

  const emittedDate = new Date(emittedAtIso);
  const chronologicalSnapshots = [...snapshots].reverse();

  return (
    <div className="space-y-5">
      {/* Barra de Controle (Oculta na impressão) */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <Link
              href={`/alunos/${student.id}`}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar ao Prontuário 360º</span>
            </Link>
            <div>
              <h1 className="text-base font-extrabold text-slate-900 flex items-center space-x-1.5">
                <FileCheck2 className="w-5 h-5 text-emerald-600" />
                <span>Emissão de Dossiê Individual de Busca Ativa</span>
              </h1>
              <p className="text-xs text-slate-500">
                Revise o órgão destinatário e o parecer técnico abaixo antes de imprimir ou salvar como PDF.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Imprimir / Salvar PDF Oficial</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="lg:col-span-5 space-y-2">
            <label className="font-bold text-slate-700 block">
              Órgão / Destinatário do Encaminhamento:
            </label>
            <select
              value={destinatario}
              onChange={(e) => setDestinatario(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-medium"
            >
              <option value="Conselho Tutelar / Rede de Proteção à Criança e ao Adolescente (SERP)">
                Conselho Tutelar / Rede de Proteção (SERP)
              </option>
              <option value="Sistema Educacional da Rede de Proteção — SERP / SEED-PR">
                Sistema Educacional da Rede de Proteção (SERP / SEED-PR)
              </option>
              <option value="Ministério Público do Estado do Paraná — Promotoria da Infância e Juventude">
                Ministério Público do Paraná (Promotoria da Infância e Juventude)
              </option>
              <option value="Direção Escolar & Arquivo Pedagógico Interno">
                Direção Escolar & Arquivo Pedagógico Interno
              </option>
            </select>

            <label className="inline-flex items-center space-x-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showFullMessages}
                onChange={(e) => setShowFullMessages(e.target.checked)}
                className="rounded border-slate-300 text-sky-600"
              />
              <span className="text-slate-600 font-medium">
                Incluir texto integral de cada mensagem WhatsApp na tabela impressa
              </span>
            </label>

            <label className="inline-flex items-center space-x-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={anonymizeOtherMinors}
                onChange={(e) => setAnonymizeOtherMinors(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              <span className="text-slate-700 font-bold">
                Anonimizar iniciais de outros estudantes em atas conjuntas (ECA / Art. 17 e 143)
              </span>
            </label>

            <label className="inline-flex items-center space-x-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={includeConfidential}
                onChange={(e) => setIncludeConfidential(e.target.checked)}
                className="rounded border-slate-300 text-rose-600"
              />
              <span className="text-rose-700 font-bold">
                Incluir atas sob Sigilo Reforçado (exclusivo para Ministério Público / CT)
              </span>
            </label>
          </div>

          <div className="lg:col-span-7 space-y-1">
            <label className="font-bold text-slate-700 block">
              Parecer Técnico-Pedagógico Conclusivo (editável para este documento):
            </label>
            <textarea
              rows={3}
              value={parecerFinal}
              onChange={(e) => setParecerFinal(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-xs leading-relaxed"
            />
          </div>
        </div>
      </div>

      {/* FOLHA OFICIAL DO DOSSIÊ (A4) */}
      <article className="bg-white max-w-4xl mx-auto p-8 sm:p-10 print:p-0 border border-slate-300 print:border-0 rounded-xl print:rounded-none shadow-sm print:shadow-none text-slate-900 space-y-5 text-[12px] leading-snug">
        {/* 1. Cabeçalho Institucional Oficial */}
        <header className="border-b-2 border-slate-900 pb-4 flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
              Governo do Estado do Paraná • SEED-PR • {school?.nre ? `NRE ${school.nre}` : "NRE Ponta Grossa"} {school?.inepCode ? `• INEP: ${school.inepCode}` : ""}
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
              {school?.name || "Colégio Estadual Leopoldina B. Pedroso"}
            </h2>
            <div className="text-xs font-bold text-slate-800 pt-1">
              DOSSIÊ INDIVIDUAL DE BUSCA ATIVA ESCOLAR E ACOMPANHAMENTO DE FREQUÊNCIA
            </div>
            <div className="text-[11px] text-slate-600">
              Destinatário: <strong>{destinatario}</strong>
            </div>
          </div>

          <div className="text-right text-[10px] font-mono text-slate-600 shrink-0 space-y-0.5 border border-slate-300 rounded-lg p-2.5 bg-slate-50">
            <div>
              <strong>EMISSÃO OFICIAL</strong>
            </div>
            <div>
              Data: {emittedDate.toLocaleDateString("pt-BR")}{" "}
              {emittedDate.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div>Emitido por: {emittedBy.name}</div>
            {lowAtt?.serpProtocol && (
              <div className="font-bold text-slate-900">
                Ficha SERP: #{lowAtt.serpProtocol}
              </div>
            )}
          </div>
        </header>

        {/* 2. Identificação do Estudante e Contatos Familiares */}
        <section className="space-y-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            1. Identificação Cadastral do(a) Estudante e Responsáveis
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border border-slate-300 rounded-lg p-3 text-[11px]">
            <div className="col-span-2">
              <span className="text-slate-500 block text-[10px] uppercase">Nome Completo</span>
              <strong className="text-sm font-black">{student.name}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">CGM (Matrícula)</span>
              <strong className="font-mono">{cgm}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Turma / Turno</span>
              <strong>
                {student.classGroup.name} ({student.classGroup.shift || student.classGroup.segment})
              </strong>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 block text-[10px] uppercase">Responsável Principal</span>
              <strong>{student.guardianName || "Não informado no cadastro"}</strong>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 block text-[10px] uppercase">Telefone Principal</span>
              <strong className="font-mono">{student.phone}</strong>
            </div>
          </div>

          {contacts.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-2.5 text-[11px]">
              <strong className="block mb-1 text-slate-700">
                Contatos Adicionais Cadastrados da Família:
              </strong>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {contacts.map((c) => (
                  <li key={c.id}>
                    • <strong>{c.name}</strong> ({KINSHIP_LABELS[c.kinship] || c.kinship}):{" "}
                    <span className="font-mono">{c.phone}</span>
                    {!c.whatsappValid && " [Número sinalizado sem WhatsApp/desatualizado]"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* 3. Quadro de Frequência Escolar e Rede de Proteção (SERP) */}
        <section className="space-y-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            2. Indicadores Oficiais de Frequência Escolar (BI / SEED-PR) e SERP
          </h3>

          {lowAtt ? (
            <div className="border border-slate-300 rounded-lg p-3 space-y-2 text-[11px]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">
                    Frequência Acumulada
                  </span>
                  <strong className="text-base font-black">
                    {lowAtt.attendancePercent.toFixed(1)}%
                  </strong>{" "}
                  <span className="text-[10px]">
                    ({lowAtt.attendancePercent < 75 ? "Abaixo de 75%" : "Acima de 75%"})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">Semana Atual</span>
                  <strong className="font-mono">{detailMetrics.semanaAtual || "—"}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">Semana Anterior</span>
                  <strong className="font-mono">{detailMetrics.semanaAnterior || "—"}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">Status SERP</span>
                  <strong>{lowAtt.serpStatus || "Acompanhamento Escolar"}</strong>
                </div>
              </div>

              {lowAtt.actionsTaken && (
                <div className="pt-2 border-t border-slate-200">
                  <strong>Síntese SERP / Medidas Registradas:</strong> {lowAtt.actionsTaken}
                </div>
              )}

              {chronologicalSnapshots.length > 1 && (
                <div className="pt-2 border-t border-slate-200">
                  <strong className="block mb-1">Histórico Semanal Coletado:</strong>
                  <div className="flex flex-wrap gap-2 font-mono text-[10px]">
                    {chronologicalSnapshots.map((s: any) => (
                      <span
                        key={s.id}
                        className="px-2 py-0.5 border border-slate-300 rounded bg-slate-50"
                      >
                        {s.referenceWeek}: <strong>{Number(s.attendancePercent).toFixed(1)}%</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-600 border border-slate-200 rounded-lg p-3">
              Estudante sem registro ativo de infrequência crítica importado do Power BI na presente data.
            </p>
          )}
        </section>

        {/* 4. Atestados Médicos e Justificativas (se houver) */}
        <section className="space-y-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            3. Atestados Médicos e Justificativas Formais Apresentadas ({justifications.length})
          </h3>

          {justifications.length === 0 ? (
            <p className="text-[11px] text-slate-600 border border-slate-200 rounded-lg p-2.5">
              Nenhum atestado médico ou justificativa documental entregue na instituição no período.
            </p>
          ) : (
            <table className="w-full border-collapse border border-slate-300 text-[11px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="border border-slate-300 px-2 py-1 text-left">Tipo</th>
                  <th className="border border-slate-300 px-2 py-1 text-left">Vigência</th>
                  <th className="border border-slate-300 px-2 py-1 text-left">Observações</th>
                  <th className="border border-slate-300 px-2 py-1 text-left">Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {justifications.map((j) => (
                  <tr key={j.id} className="break-inside-avoid">
                    <td className="border border-slate-300 px-2 py-1 font-semibold">
                      {JUSTIFICATION_TYPE_LABELS[j.type] || j.type}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 font-mono whitespace-nowrap">
                      {new Date(j.startDate).toLocaleDateString("pt-BR")} a{" "}
                      {new Date(j.endDate).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">
                      {j.notes || "—"}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">
                      {j.createdByName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 4. Atas do Livro Oficial de Atendimento Pedagógico */}
        <section className="space-y-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            4. Atas Oficiais do Atendimento Pedagógico Digital ({minutes.filter((m) => m.status === "FINALIZED" && (!m.isConfidential || includeConfidential)).length})
          </h3>

          {minutes.filter((m) => m.status === "FINALIZED" && (!m.isConfidential || includeConfidential)).length === 0 ? (
            <p className="text-[11px] text-slate-600 border border-slate-200 rounded-lg p-2.5">
              Não constam atas oficiais lavradas no Livro Digital para este estudante até a presente data.
            </p>
          ) : (
            <div className="space-y-2.5">
              {minutes
                .filter((m) => m.status === "FINALIZED" && (!m.isConfidential || includeConfidential))
                .map((min) => {
                  const rawSummary = min.summary || "";
                  const linkedStudents = min.students?.map((s: any) => ({
                    id: s.studentId,
                    name: s.studentNameSnapshot,
                  })) || [];

                  const displaySummary = anonymizeOtherMinors
                    ? anonymizeOtherMinorsInText(rawSummary, student.id, linkedStudents)
                    : rawSummary;

                  return (
                    <div
                      key={min.id}
                      className="border border-slate-300 rounded-lg p-3 space-y-1.5 text-[11px] break-inside-avoid"
                    >
                      <div className="flex justify-between font-bold border-b border-slate-200 pb-1">
                        <span>
                          Ata nº {String(min.ataNumber).padStart(3, "0")}/{min.year} — {new Date(min.attendedAt).toLocaleDateString("pt-BR")} — {min.subject}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          Cód: {min.verificationCode}
                        </span>
                      </div>

                      <div>
                        <strong>Servidora:</strong> {min.authorName} ({min.authorRole}) • <strong>Presentes:</strong>{" "}
                        {min.participants?.map((p: any) => p.name).join(", ") || "Conforme ata"}
                      </div>

                      <div className="leading-relaxed whitespace-pre-line text-slate-800">
                        <strong>Síntese da Ata:</strong> {displaySummary}
                      </div>

                      {min.agreementsSummary && (
                        <div className="text-slate-700 bg-slate-50 p-1.5 rounded">
                          <strong>Deliberações e Combinados:</strong> {min.agreementsSummary}
                        </div>
                      )}

                      <div className="text-[9.5px] text-slate-400 font-mono">
                        Hash SHA-256: {min.contentHash}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {/* 5. Atas Legadas de Comparecimento Presencial */}
        {attendances.length > 0 && (
          <section className="space-y-2 break-inside-avoid">
            <h3 className="text-xs font-bold uppercase tracking-wider bg-slate-50 border-l-4 border-slate-400 px-2.5 py-1 text-slate-700">
              5. Atendimentos Presenciais Anteriores (Histórico Legado — {attendances.length})
            </h3>
            <div className="space-y-2">
              {attendances.map((att) => (
                <div
                  key={att.id}
                  className="border border-slate-200 rounded-lg p-2.5 space-y-1 text-[11px] break-inside-avoid bg-slate-50/50"
                >
                  <div className="flex justify-between font-bold">
                    <span>
                      {new Date(att.attendedAt).toLocaleDateString("pt-BR")} — {att.subject}
                    </span>
                    <span>Profissional: {att.recordedByName}</span>
                  </div>
                  <div>
                    <strong>Responsável Presente:</strong> {att.guardianPresent}
                  </div>
                  <div>
                    <strong>Síntese:</strong> {att.summary}
                  </div>
                  {att.agreements && (
                    <div>
                      <strong>Encaminhamentos Firmados:</strong> {att.agreements}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 6. Histórico Completo e Auditado de Tentativas de Contato (Busca Ativa) */}
        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            5. Registro Cronológico Auditado de Tentativas de Contato / Busca Ativa ({totalLogs})
          </h3>

          {totalLogs === 0 ? (
            <p className="text-[11px] text-slate-600 border border-slate-200 rounded-lg p-2.5">
              Nenhuma comunicação via WhatsApp registrada no sistema para este estudante.
            </p>
          ) : (
            <table className="w-full border-collapse border border-slate-300 text-[10.5px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Data / Hora</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Motivo do Acionamento</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Telefone</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Profissional</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-center">Retorno?</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">
                    Manifestação da Família / Observações
                  </th>
                </tr>
              </thead>
              <tbody>
                {student.messageLogs.map((log: any) => (
                  <tr key={log.id} className="break-inside-avoid align-top">
                    <td className="border border-slate-300 px-2 py-1 font-mono whitespace-nowrap">
                      {new Date(log.sentAt).toLocaleDateString("pt-BR")}{" "}
                      {new Date(log.sentAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">
                      <strong className="block">{log.reasonTitle}</strong>
                      {showFullMessages && log.messageContent && (
                        <div className="mt-1 p-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] whitespace-pre-wrap text-slate-600">
                          {log.messageContent}
                        </div>
                      )}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 font-mono whitespace-nowrap">
                      {log.phoneUsed}
                      {log.deliveryStatus === "FAILED_NO_WHATSAPP" && (
                        <span className="block font-sans text-[9.5px] font-bold text-rose-800">
                          [Sem WhatsApp]
                        </span>
                      )}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">
                      {log.sentByName}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-center font-bold">
                      {log.deliveryStatus === "FAILED_NO_WHATSAPP"
                        ? "FRUSTRADO"
                        : log.guardianReplied
                        ? "SIM"
                        : "NÃO"}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">
                      {log.deliveryStatus === "FAILED_NO_WHATSAPP" ? (
                        <strong>
                          Tentativa frustrada — Número informado no cadastro não possui WhatsApp ativo.
                        </strong>
                      ) : (
                        <>
                          {log.replyCategory && (
                            <strong className="block text-slate-800">
                              [{REPLY_CATEGORY_LABELS[log.replyCategory as ReplyCategory] || log.replyCategory}]
                            </strong>
                          )}
                          {log.replyNotes ||
                            (log.guardianReplied
                              ? "Retorno confirmado sem observação textual."
                              : "Sem retorno registrado.")}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 7. Parecer Técnico-Pedagógico e Assinaturas */}
        <section className="space-y-4 pt-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            6. Parecer Técnico-Pedagógico e Encaminhamento Institucional
          </h3>

          <p className="border border-slate-300 rounded-lg p-3 text-[11px] text-justify leading-relaxed">
            {parecerFinal}
          </p>

          <div className="grid grid-cols-3 gap-6 pt-10 text-center text-[10.5px]">
            <div className="border-t border-slate-800 pt-1.5">
              <strong>{emittedBy.name}</strong>
              <span className="block text-slate-600">Equipe Pedagógica</span>
            </div>

            <div className="border-t border-slate-800 pt-1.5">
              <strong>Direção Escolar</strong>
              <span className="block text-slate-600">Colégio Est. Leopoldina B. Pedroso</span>
            </div>

            <div className="border-t border-slate-800 pt-1.5">
              <strong>Ciência do Responsável / Órgão</strong>
              <span className="block text-slate-600">Data: ____/____/________</span>
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}
