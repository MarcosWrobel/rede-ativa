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
import {
  computeDossierIntegritySeal,
  formatMessageSeal,
  computeMessageContentHash,
} from "@/lib/messageCrypto";

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
    edition?: "PILOTO_INTEGRADA" | "INSTITUCIONAL_ESSENCIAL";
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
  const isIntegrated = school?.edition ? school.edition === "PILOTO_INTEGRADA" : true;
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
    const schoolUnit = school?.name || "Unidade Escolar";
    return `Certificamos, para instrução processual perante a Rede de Proteção à Criança e ao Adolescente (Art. 56, inciso II da Lei nº 8.069/1990 — ECA e Art. 12, incisos VII e VIII da Lei nº 9.394/1996 — LDB), que a Equipe Pedagógica do(a) ${schoolUnit} realizou ${effectiveLogs} acionamento(s) de Busca Ativa Escolar com certificação digital${failedClause}, obtendo ${repliedLogs} retorno(s) familiar(es), e ${attendances.length} atendimento(s) presencial(is) com ata lavrada referentes ao(à) estudante ${student.name}, que atualmente ${freqTxt}. O presente dossiê reúne a cadeia de custódia e evidências probatórias sob fé pública documental (Lei Federal nº 14.063/2020 e MP nº 2.200-2/2001).`;
  });

  const dossierIntegritySeal = computeDossierIntegritySeal({
    studentId: student.id,
    studentName: student.name,
    cgm,
    schoolId: student.schoolId || school?.inepCode || "school-default",
    schoolInep: school?.inepCode || null,
    totalMessages: totalLogs,
    totalMinutes: (minutes || []).length,
    totalJustifications: justifications.length,
    emittedAtIso,
    emittedByEmail: emittedBy.email,
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
              <span>Prontuário</span>
            </Link>
            <div>
              <h1 className="text-base font-extrabold text-slate-900 flex items-center space-x-1.5">
                <FileCheck2 className="w-5 h-5 text-emerald-600" />
                <span>Emissão de Dossiê de Busca Ativa</span>
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Imprimir dossiê</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="lg:col-span-5 space-y-2">
            <label className="font-bold text-slate-700 block">
              Órgão destinatário:
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
              <option value="Vara da Infância e da Juventude (Poder Judiciário)">
                Vara da Infância e da Juventude (Poder Judiciário)
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
                Incluir texto integral das mensagens
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
                Anonimizar outros estudantes (ECA)
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
                Incluir atas sob sigilo (Ministério Público / Conselho Tutelar)
              </span>
            </label>
          </div>

          <div className="lg:col-span-7 space-y-1">
            <label className="font-bold text-slate-700 block">
              Parecer técnico-pedagógico conclusivo:
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

      {/* FOLHA OFICIAL DO DOSSIÊ (A4) COM MOLDURA PERIMÉTRICA */}
      <article className="bg-white max-w-4xl mx-auto p-6 sm:p-10 rounded-2xl border-2 border-slate-800 shadow-sm text-slate-900 space-y-5 text-[12px] leading-snug print-page-frame print:space-y-3.5 print:shadow-none">
        {/* 1. Cabeçalho Institucional Oficial */}
        <header className="border-b-2 border-slate-900 pb-4 flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
              Governo do Estado do Paraná • SEED-PR • {school?.nre ? `NRE ${school.nre}` : "NRE Regional"} {school?.inepCode ? `• INEP: ${school.inepCode}` : ""}
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
              {school?.name || "Instituição de Ensino"}
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
            <div className="pt-1 text-[9px] font-mono font-bold text-emerald-800 border-t border-slate-200 mt-1">
              Selo de Integridade: {dossierIntegritySeal}
            </div>
          </div>
        </header>

        {/* 2. Identificação do Estudante e Contatos Familiares */}
        <section className="space-y-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            1. Identificação do Estudante e Responsáveis
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
                Contatos Adicionais da Família:
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

        {/* 3. Quadro de Frequência Escolar e Rede de Proteção */}
        <section className="space-y-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            {isIntegrated
              ? "2. Frequência Escolar e Acompanhamento na Rede"
              : "2. Frequência Escolar e Acompanhamento"}
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
                  <span className="text-slate-500 block text-[10px] uppercase">{isIntegrated ? "Status SERP" : "Situação na Rede"}</span>
                  <strong>{lowAtt.serpStatus || "Acompanhamento Escolar"}</strong>
                </div>
              </div>

              {lowAtt.actionsTaken && (
                <div className="pt-2 border-t border-slate-200">
                  <strong>{isIntegrated ? "Síntese SERP / Medidas Registradas:" : "Síntese de Medidas Registradas:"}</strong> {lowAtt.actionsTaken}
                </div>
              )}

              {chronologicalSnapshots.length > 1 && (
                <div className="pt-2 border-t border-slate-200">
                  <strong className="block mb-1">Histórico Semanal:</strong>
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
              Sem registros de infrequência crítica na data de emissão.
            </p>
          )}
        </section>

        {/* 4. Atestados Médicos e Justificativas (se houver) */}
        <section className="space-y-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            3. Atestados e Justificativas de Ausência ({justifications.length})
          </h3>

          {justifications.length === 0 ? (
            <p className="text-[11px] text-slate-600 border border-slate-200 rounded-lg p-2.5">
              Nenhuma justificativa ou atestado apresentado no período.
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
            4. Atas de Atendimento Pedagógico ({minutes.filter((m) => m.status === "FINALIZED" && (!m.isConfidential || includeConfidential)).length})
          </h3>

          {minutes.filter((m) => m.status === "FINALIZED" && (!m.isConfidential || includeConfidential)).length === 0 ? (
            <p className="text-[11px] text-slate-600 border border-slate-200 rounded-lg p-2.5">
              Nenhuma ata registrada para este estudante.
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
              5. Atendimentos Presenciais Anteriores ({attendances.length})
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
                      <strong>Encaminhamentos:</strong> {att.agreements}
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
            {attendances.length > 0 ? "6" : "5"}. Registro de Tentativas de Contato e Busca Ativa ({totalLogs})
          </h3>

          {totalLogs === 0 ? (
            <p className="text-[11px] text-slate-600 border border-slate-200 rounded-lg p-2.5">
              Nenhuma tentativa de contato registrada para este estudante.
            </p>
          ) : (
            <table className="w-full border-collapse border border-slate-300 text-[10.5px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Data / Hora</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Motivo / Mensagem</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Telefone</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Profissional</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Selo SHA-256</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-center">Retorno?</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">
                    Manifestação da Família / Observações
                  </th>
                </tr>
              </thead>
              <tbody>
                {student.messageLogs.map((log: any) => {
                  const messageHash =
                    log.contentHash ||
                    computeMessageContentHash({
                      studentId: student.id,
                      schoolId: student.schoolId || school?.inepCode || "",
                      phoneUsed: log.phoneUsed,
                      reasonTitle: log.reasonTitle,
                      messageContent: log.messageContent || "",
                      sentByName: log.sentByName,
                      sentAt: log.sentAt,
                    });

                  return (
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
                      <td className="border border-slate-300 px-2 py-1 font-mono text-[9px]">
                        <span className="block text-emerald-800 font-bold">
                          {formatMessageSeal(messageHash)}
                        </span>
                        <span className="block text-slate-500 text-[8.5px]">
                          Status: {log.deliveryStatus || "SENT"}
                        </span>
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
                            Tentativa sem entrega — Telefone sem WhatsApp ativo.
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
                                ? "Retorno confirmado."
                                : "Sem retorno registrado.")}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* 7. Parecer Técnico-Pedagógico e Assinaturas */}
        <section className="space-y-4 pt-2 break-inside-avoid">
          <h3 className="text-xs font-black uppercase tracking-wider bg-slate-100 border-l-4 border-slate-800 px-2.5 py-1">
            {attendances.length > 0 ? "7" : "6"}. Parecer Técnico-Pedagógico e Encaminhamentos
          </h3>

          <p className="border border-slate-300 rounded-lg p-3 text-[11px] text-justify leading-relaxed">
            {parecerFinal}
          </p>

          <div className="grid grid-cols-3 gap-6 pt-10 text-center text-[10.5px]">
            <div className="border-t border-slate-800 pt-1.5">
              <strong>{emittedBy.name}</strong>
              <span className="block text-slate-600">Equipe Pedagógica</span>
              <span className="block text-[9px] text-slate-400 font-mono">{emittedBy.email}</span>
            </div>

            <div className="border-t border-slate-800 pt-1.5">
              <strong>Direção Escolar</strong>
              <span className="block text-slate-600">{school?.name || "Unidade Escolar"}</span>
              <span className="block text-[9px] text-slate-400 font-mono">Assinatura Institucional</span>
            </div>

            <div className="border-t border-slate-800 pt-1.5">
              <strong>Ciência do Órgão Destinatário</strong>
              <span className="block text-slate-600 truncate">{destinatario}</span>
              <span className="block text-slate-500 text-[9.5px]">Data / Carimbo / Rubrica</span>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-300 text-[9px] text-slate-500 font-mono flex flex-wrap justify-between items-center gap-2">
            <div>
              <span className="font-bold text-slate-700 block">
                CERTIDÃO ELETRÔNICA DE INTEGRIDADE — LEI Nº 14.063/2020 E MP Nº 2.200-2/2001
              </span>
              <span>Selo de Integridade do Dossiê: <strong className="text-emerald-800 font-mono">{dossierIntegritySeal}</strong></span>
            </div>
            <div className="text-right">
              <span>Registros autenticados por hash SHA-256</span>
              <span className="block">Emissão: {emittedDate.toISOString()}</span>
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}
