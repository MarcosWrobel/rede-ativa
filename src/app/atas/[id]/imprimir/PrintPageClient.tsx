"use client";

import Link from "next/link";
import { Printer, ArrowLeft, ShieldCheck, FileCheck2, Lock } from "lucide-react";

interface Props {
  minute: any;
}

export default function PrintPageClient({ minute }: Props) {
  const isFinal = minute.status === "FINALIZED";
  const isVoid = minute.status === "VOIDED";
  const numStr = minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "S/N";
  const attendedDate = new Date(minute.attendedAt);

  const verificationUrl = typeof window !== "undefined"
    ? `${window.location.origin}/validar/ata/${minute.verificationCode}`
    : `https://registro-leopoldina.vercel.app/validar/ata/${minute.verificationCode}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Barra de Ação (Oculta na Impressão) */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between print:hidden">
        <Link
          href="/atas"
          className="inline-flex items-center space-x-1.5 text-xs font-bold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Livro de Atas</span>
        </Link>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
        >
          <Printer className="w-4 h-4 text-amber-400" />
          <span>Imprimir / Salvar PDF A4</span>
        </button>
      </div>

      {/* Folha Oficial A4 */}
      <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-sm text-slate-900 font-serif space-y-6 print:border-none print:shadow-none print:p-0 print:m-0">
        {/* Cabeçalho Oficial SEED-PR */}
        <div className="text-center border-b-2 border-slate-900 pb-4 space-y-1">
          <p className="font-sans text-[11px] font-bold tracking-wider uppercase text-slate-600">
            Governo do Estado do Paraná • Secretaria de Estado da Educação — SEED-PR
          </p>
          <p className="font-sans text-[11px] font-bold text-slate-600">
            Núcleo Regional de Educação de {minute.school.nre}
          </p>
          <h1 className="font-sans text-base font-black uppercase tracking-tight text-slate-900">
            {minute.school.name}
          </h1>
          <p className="font-sans text-[10px] text-slate-500">
            INEP: {minute.school.inepCode || "41042730"} • {minute.school.city} - {minute.school.state}
          </p>
        </div>

        {/* Título da Ata */}
        <div className="text-center space-y-1">
          <h2 className="font-sans text-lg font-black tracking-wide uppercase">
            Ata do Atendimento Pedagógico nº {numStr}/{minute.year}
          </h2>
          <p className="font-sans text-xs font-bold text-slate-600">
            Pauta: {minute.subject}
          </p>
          {isVoid && (
            <p className="font-sans text-xs font-black text-rose-600 uppercase border border-rose-300 bg-rose-50 p-2 rounded-lg">
              AVISO: ATA TORNADA SEM EFEITO ADMINISTRATIVO EM {new Date(minute.voidedAt).toLocaleDateString("pt-BR")}.
              MOTIVO: {minute.voidReason}
            </p>
          )}
        </div>

        {/* Informações dos Estudantes Vinculados */}
        <div className="font-sans text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1">
          <p className="font-bold text-slate-700">
            Estudante(s) Objeto do Atendimento:
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-slate-800">
            {minute.students?.map((s: any) => (
              <li key={s.id}>
                <strong>{s.studentNameSnapshot}</strong>
                {s.classNameSnapshot ? ` — Turma: ${s.classNameSnapshot}` : ""}
                {s.cgmSnapshot ? ` — CGM: ${s.cgmSnapshot}` : ""}
              </li>
            ))}
          </ul>
        </div>

        {/* Corpo da Ata */}
        <div className="text-justify text-sm leading-relaxed space-y-3 font-serif">
          <p>
            Aos {attendedDate.getDate()} dias do mês de{" "}
            {attendedDate.toLocaleDateString("pt-BR", { month: "long" })} de{" "}
            {attendedDate.getFullYear()}, nas dependências da Equipe Pedagógica deste
            estabelecimento de ensino, lavrou-se a presente ata referente ao atendimento
            supracitado.
          </p>
          <p className="whitespace-pre-line">{minute.summary}</p>

          {minute.agreementsSummary && (
            <div className="pt-2">
              <strong className="font-sans text-xs font-bold uppercase tracking-wider block text-slate-800">
                Deliberações e Combinados Pactuados:
              </strong>
              <p className="whitespace-pre-line mt-1">{minute.agreementsSummary}</p>
            </div>
          )}
        </div>

        {/* Encaminhamentos */}
        {minute.actionItems && minute.actionItems.length > 0 && (
          <div className="font-sans text-xs space-y-1.5 pt-2">
            <span className="font-bold text-slate-800 uppercase text-[11px] tracking-wider">
              Quadro de Encaminhamentos e Prazos:
            </span>
            <table className="w-full border-collapse border border-slate-300 text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-300 p-1.5">Ação / Encaminhamento</th>
                  <th className="border border-slate-300 p-1.5">Responsável</th>
                  <th className="border border-slate-300 p-1.5">Prazo Limite</th>
                </tr>
              </thead>
              <tbody>
                {minute.actionItems.map((act: any) => (
                  <tr key={act.id}>
                    <td className="border border-slate-300 p-1.5">{act.description}</td>
                    <td className="border border-slate-300 p-1.5">{act.responsible}</td>
                    <td className="border border-slate-300 p-1.5">
                      {act.dueDate ? new Date(act.dueDate).toLocaleDateString("pt-BR") : "Acompanhamento contínuo"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Adendos / Retificações "Em tempo" */}
        {minute.addendums && minute.addendums.length > 0 && (
          <div className="space-y-2 border-t border-dashed border-slate-400 pt-4 font-sans text-xs">
            <h4 className="font-bold uppercase tracking-wider text-slate-800">
              Termos de Aditamento / Retificação (&quot;Em tempo&quot;):
            </h4>
            {minute.addendums.map((ad: any, idx: number) => (
              <div key={ad.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                <p className="font-semibold text-slate-700">
                  Aditamento nº {idx + 1} — Lavrado em {new Date(ad.createdAt).toLocaleString("pt-BR")} por{" "}
                  {ad.authorName}:
                </p>
                <p className="font-serif italic text-slate-800">&quot;{ad.content}&quot;</p>
                <p className="font-mono text-[9px] text-slate-500">Hash encadeado: {ad.addendumHash}</p>
              </div>
            ))}
          </div>
        )}

        {/* Bloco de Assinaturas */}
        <div className="pt-6 border-t-2 border-slate-900 space-y-6 font-sans">
          <p className="text-center text-xs font-bold text-slate-700 uppercase tracking-wider">
            Assinaturas e Ciência dos Presentes
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4">
            {/* Assinatura da Pedagoga / Servidora */}
            <div className="text-center space-y-1">
              <div className="border-b border-slate-800 pb-1 min-h-[45px] flex items-end justify-center">
                <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                  ASSINADO DIGITALMENTE VIA @ESCOLA.PR.GOV.BR
                </span>
              </div>
              <p className="text-xs font-bold text-slate-900">{minute.authorName}</p>
              <p className="text-[10px] text-slate-500 uppercase">{minute.authorRole} • Servidor(a) Público(a)</p>
            </div>

            {/* Participantes */}
            {minute.participants?.map((p: any) => (
              <div key={p.id} className="text-center space-y-1">
                <div className="border-b border-slate-800 pb-1 min-h-[45px] flex items-end justify-center">
                  {p.signatureData ? (
                    <img
                      src={p.signatureData}
                      alt={`Assinatura ${p.name}`}
                      className="max-h-12 max-w-[200px] object-contain mx-auto"
                    />
                  ) : p.signatureMode === "REFUSED" ? (
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-300">
                      RECUSOU-SE A ASSINAR ({p.refusalReason})
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">Assinatura física em via anexa</span>
                  )}
                </div>
                <p className="text-xs font-bold text-slate-900">{p.name}</p>
                <p className="text-[10px] text-slate-500 uppercase">
                  {p.role} {p.documentNumber ? `• Doc: ${p.documentNumber}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Rodapé Jurídico de Fé Pública e QR Code */}
        {isFinal && (
          <div className="pt-6 border-t border-slate-200 font-sans flex items-center justify-between gap-4 text-xs">
            <div className="space-y-1 flex-1">
              <p className="font-bold text-slate-800 flex items-center space-x-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Autenticidade e Fé Pública — Lei Federal nº 14.063/2020</span>
              </p>
              <p className="text-[10px] text-slate-500 leading-tight">
                Documento emitido eletronicamente pela Equipe Pedagógica. A integridade do conteúdo é garantida
                pelo algoritmo criptográfico SHA-256 e pelo código validador.
              </p>
              <p className="font-mono text-[9px] text-slate-600 break-all">
                Hash SHA-256: {minute.contentHash}
              </p>
              <p className="text-[10px] text-slate-600">
                Código de Verificação: <strong className="font-mono text-slate-900">{minute.verificationCode}</strong>
              </p>
            </div>

            <div className="text-center flex-shrink-0">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(
                  verificationUrl
                )}`}
                alt="QR Code Validação"
                className="w-20 h-20 mx-auto border border-slate-200 p-1 rounded-lg"
              />
              <span className="text-[9px] text-slate-500 font-bold block mt-0.5">Conferir Autenticidade</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
