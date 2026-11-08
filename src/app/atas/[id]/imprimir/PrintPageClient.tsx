"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Printer, ArrowLeft, ShieldCheck, Download } from "lucide-react";
import AtaQrCode from "@/components/ata/AtaQrCode";
import { getAtaValidationUrl, getBaseAppUrl } from "@/lib/qrCode";

interface Props {
  minute: any;
  initialOrigin?: string;
  initialQrSvg?: string;
  initialVerificationUrl?: string;
}

function getSchoolNetworkHeader(school: any) {
  const network = school?.network || "ESTADUAL";
  if (network === "MUNICIPAL") {
    return {
      line1: `Prefeitura Municipal de ${school?.city || "Município"} • Secretaria Municipal de Educação`,
      line2: school?.nre ? `Supervisão / Regional: ${school.nre}` : "Secretaria Municipal de Educação",
      unitType: "Escola Municipal",
    };
  }
  if (network === "PRIVADA") {
    return {
      line1: "Rede de Ensino Particular / Privada",
      line2: school?.nre ? `Supervisão Regional: ${school.nre}` : "Diretoria de Ensino",
      unitType: "Instituição de Ensino",
    };
  }
  return {
    line1: `Governo do Estado ${school?.state === "PR" ? "do Paraná" : `de ${school?.state || "PR"}`} • Secretaria de Estado da Educação — SEED-PR`,
    line2: `Núcleo Regional de Educação de ${school?.nre || school?.city || "Ponta Grossa"}`,
    unitType: "Colégio Estadual",
  };
}

export default function PrintPageClient({
  minute,
  initialOrigin,
  initialQrSvg,
  initialVerificationUrl,
}: Props) {
  const isFinal = minute.status === "FINALIZED";
  const isVoid = minute.status === "VOIDED";
  const numStr = minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "S/N";
  const attendedDate = new Date(minute.attendedAt);
  const networkHeader = getSchoolNetworkHeader(minute.school);
  const schoolLogo = minute.school?.logoUrl || "/logo.svg";

  // Se o resumo oficial já contém a fórmula canônica de abertura com data, evita duplicar o parágrafo de preâmbulo
  const summaryAlreadyHasOpening = /^(?:Aos?|No dia|Em|Nesta data)\s+/i.test(
    (minute.summary || "").trim()
  );

  const [origin, setOrigin] = useState<string>(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      return window.location.origin;
    }
    return initialOrigin || getBaseAppUrl();
  });

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  const verificationUrl =
    minute.verificationCode
      ? getAtaValidationUrl(minute.verificationCode, origin)
      : initialVerificationUrl || "";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Barra de Ação (Oculta na Impressão) */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between print:hidden">
        <Link
          href="/atas"
          className="inline-flex items-center space-x-1.5 text-xs font-bold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Atas</span>
        </Link>

        <div className="flex items-center space-x-2">
          {isFinal && (
            <a
              href={`/api/atas/${minute.id}/pdfa?download=1`}
              className="inline-flex items-center space-x-2 px-3.5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition shadow-xs"
              title="Baixar arquivo binário padronizado para preservação arquivística de longo prazo (ISO 19005-1 Level B)"
            >
              <Download className="w-4 h-4 text-sky-600" />
              <span>Baixar PDF/A</span>
            </a>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Folha Oficial A4 com Moldura Perimétrica e Margem Padronizada */}
      <div className="bg-white p-6 sm:p-10 rounded-2xl border-2 border-slate-800 shadow-sm text-slate-900 font-serif space-y-5 print-page-frame print:space-y-3 print:shadow-none">
        {/* Cabeçalho Oficial com Brasão / Logo Dinâmico */}
        <div className="border-b-2 border-slate-900 pb-4 space-y-2 print:pb-2 print:space-y-1">
          <div className="flex items-center justify-between gap-4 print:gap-2">
            <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 flex items-center justify-center print:w-14 print:h-14">
              <img
                src={schoolLogo}
                alt={`Brasão / Logo de ${minute.school.name}`}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex-1 text-center space-y-0.5 print:space-y-0">
              <p className="font-sans text-[11px] font-bold tracking-wider uppercase text-slate-600 print:text-[10px]">
                {networkHeader.line1}
              </p>
              <p className="font-sans text-[11px] font-bold text-slate-600 print:text-[10px]">
                {networkHeader.line2}
              </p>
              <h1 className="font-sans text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 print:text-base">
                {minute.school.name}
              </h1>
              <p className="font-sans text-[10px] text-slate-500 print:text-[9px]">
                INEP: {minute.school.inepCode || "41042730"} • {minute.school.city} - {minute.school.state}
              </p>
            </div>
            {/* Espaçador simétrico para centralizar o texto em relação ao logo */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 hidden sm:flex items-center justify-center opacity-0 pointer-events-none print:w-14 print:h-14">
              <img src={schoolLogo} alt="" className="w-full h-full object-contain" />
            </div>
          </div>
        </div>

        {/* Título da Ata */}
        <div className="text-center space-y-1 print:space-y-0.5">
          <h2 className="font-sans text-lg font-black tracking-wide uppercase print:text-base">
            Ata do Atendimento Pedagógico nº {numStr}/{minute.year}
          </h2>
          <p className="font-sans text-xs font-bold text-slate-600 print:text-[11px]">
            Pauta: {minute.subject}
          </p>
          {minute.finalizedAt && (
            <p className="font-sans text-[11px] font-extrabold text-emerald-800 bg-emerald-50 py-1 px-3 rounded-full border border-emerald-200 inline-block print:py-0.5 print:px-2 print:text-[10px]">
              Lavrada eletronicamente em:{" "}
              {new Date(minute.finalizedAt).toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}{" "}
              às{" "}
              {new Date(minute.finalizedAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
          )}
          {isVoid && (
            <p className="font-sans text-xs font-black text-rose-600 uppercase border border-rose-300 bg-rose-50 p-2 rounded-lg">
              AVISO: ATA TORNADA SEM EFEITO ADMINISTRATIVO EM {new Date(minute.voidedAt).toLocaleDateString("pt-BR")}.
              MOTIVO: {minute.voidReason}
            </p>
          )}
          {minute.isExtemporaneous && minute.extemporaneousReason && (
            <div className="font-sans text-xs border border-amber-300 bg-amber-50/80 p-2.5 rounded-lg text-amber-950 space-y-0.5 print:p-2 print:text-[10px]">
              <p className="font-bold uppercase tracking-wider text-amber-900 text-[10px] print:text-[9px]">
                Lavratura extemporânea:
              </p>
              <p className="italic leading-relaxed">
                &ldquo;{minute.extemporaneousReason}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Informações dos Estudantes ou Docentes Vinculados */}
        {minute.students && minute.students.length > 0 ? (
          <div className="font-sans text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1 print:p-2 print:py-1.5 print:rounded-lg">
            <p className="font-bold text-slate-700">
              Estudantes vinculados:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-800">
              {minute.students.map((s: any) => (
                <li key={s.id}>
                  <strong>{s.studentNameSnapshot}</strong>
                  {s.classNameSnapshot ? ` — Turma: ${s.classNameSnapshot}` : ""}
                  {s.cgmSnapshot ? ` — CGM: ${s.cgmSnapshot}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="font-sans text-xs bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-200 space-y-1 print:p-2 print:py-1.5 print:rounded-lg">
            <p className="font-bold text-indigo-900">
              Docente(s) / Servidor(es) Envolvido(s):
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-800">
              {(minute.participants?.filter((p: any) => p.role === "PROFESSOR" || p.role === "EQUIPE_ESCOLAR")?.length > 0
                ? minute.participants.filter((p: any) => p.role === "PROFESSOR" || p.role === "EQUIPE_ESCOLAR")
                : minute.participants || []
              ).map((p: any, idx: number) => (
                <li key={p.id || idx}>
                  <strong>{p.name}</strong>
                  {p.kinship ? ` — Função/Disciplina: ${p.kinship}` : ""}
                  {p.expectedEmail ? ` — E-mail: ${p.expectedEmail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Corpo da Ata */}
        <div className="text-justify text-sm leading-relaxed space-y-3 font-serif print:text-[13px] print:leading-normal print:space-y-2">
          {!summaryAlreadyHasOpening && (
            <p>
              Aos {attendedDate.getDate()} dias do mês de{" "}
              {attendedDate.toLocaleDateString("pt-BR", { month: "long" })} de{" "}
              {attendedDate.getFullYear()}
              {minute.attendedAt
                ? ` (início do atendimento às ${attendedDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`
                : ""}
              , nas dependências da Equipe Pedagógica deste
              estabelecimento de ensino, lavrou-se a presente ata referente ao atendimento
              supracitado.
            </p>
          )}
          <p className="whitespace-pre-line">{minute.summary}</p>

          {minute.agreementsSummary && (
            <div className="pt-2 print:pt-1">
              <strong className="font-sans text-xs font-bold uppercase tracking-wider block text-slate-800 print:text-[11px]">
                Encaminhamentos e combinados:
              </strong>
              <p className="whitespace-pre-line mt-1 print:mt-0.5">{minute.agreementsSummary}</p>
            </div>
          )}
        </div>

        {/* Encaminhamentos */}
        {minute.actionItems && minute.actionItems.length > 0 && (
          <div className="font-sans text-xs space-y-1.5 pt-2 print:pt-1 print:space-y-1">
            <span className="font-bold text-slate-800 uppercase text-[11px] tracking-wider print:text-[10px]">
              Encaminhamentos e prazos:
            </span>
            <table className="w-full border-collapse border border-slate-300 text-[11px] print:text-[10px]">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-300 p-1.5 print:p-1">Encaminhamento</th>
                  <th className="border border-slate-300 p-1.5 print:p-1">Responsável</th>
                  <th className="border border-slate-300 p-1.5 print:p-1">Prazo Limite</th>
                </tr>
              </thead>
              <tbody>
                {minute.actionItems.map((act: any) => (
                  <tr key={act.id}>
                    <td className="border border-slate-300 p-1.5 print:p-1">{act.description}</td>
                    <td className="border border-slate-300 p-1.5 print:p-1">{act.responsible}</td>
                    <td className="border border-slate-300 p-1.5 print:p-1">
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
          <div className="space-y-2 border-t border-dashed border-slate-400 pt-4 font-sans text-xs print:pt-2 print:space-y-1">
            <h4 className="font-bold uppercase tracking-wider text-slate-800">
              Termos de aditamento (&quot;Em tempo&quot;):
            </h4>
            {minute.addendums.map((ad: any, idx: number) => (
              <div key={ad.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 print:p-1.5">
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
        <div className="pt-6 border-t-2 border-slate-900 space-y-6 font-sans print:pt-3 print:space-y-2 print:break-inside-avoid">
          <p className="text-center text-xs font-bold text-slate-700 uppercase tracking-wider print:text-[11px]">
            Participantes e assinaturas
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4 print:gap-4 print:pt-2">
            {/* Assinatura da Pedagoga / Servidora */}
            <div className="text-center space-y-1 print:space-y-0.5">
              <div className="border-b border-slate-800 pb-1 min-h-[45px] flex items-end justify-center print:min-h-[35px] print:pb-0.5">
                <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300 print:text-[10px]">
                  {minute.authorEmail?.endsWith("@escola.pr.gov.br")
                    ? "ASSINADO DIGITALMENTE VIA @ESCOLA.PR.GOV.BR"
                    : "ASSINADO DIGITALMENTE COM CONTA INSTITUCIONAL"}
                </span>
              </div>
              <p className="text-xs font-bold text-slate-900 print:text-[11px]">{minute.authorName}</p>
              <p className="text-[10px] text-slate-500 uppercase print:text-[9px]">{minute.authorRole} • Servidor(a) Público(a)</p>
            </div>

            {/* Participantes */}
            {minute.participants?.map((p: any) => (
              <div key={p.id} className="text-center space-y-1 print:space-y-0.5">
                <div className="border-b border-slate-800 pb-1 min-h-[45px] flex items-end justify-center print:min-h-[35px] print:pb-0.5">
                  {p.verifiedEmail ? (
                    <div className="space-y-0.5">
                      <span className="font-mono text-[11px] font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-300 block print:text-[10px]">
                        {p.verifiedEmail.endsWith("@escola.pr.gov.br")
                          ? "ASSINADO VIA @ESCOLA.PR.GOV.BR"
                          : "ASSINADO VIA E-MAIL INSTITUCIONAL"}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono block">
                        {p.verifiedEmail}
                      </span>
                    </div>
                  ) : p.signatureData ? (
                    <img
                      src={p.signatureData}
                      alt={`Assinatura ${p.name}`}
                      className="max-h-12 max-w-[200px] object-contain mx-auto print:max-h-9"
                    />
                  ) : p.signatureMode === "REFUSED" ? (
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-300 print:text-[9px]">
                      RECUSOU-SE A ASSINAR ({p.refusalReason})
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 print:text-[9px]">Assinatura física em via anexa</span>
                  )}
                </div>
                <p className="text-xs font-bold text-slate-900 print:text-[11px]">{p.name}</p>
                <p className="text-[10px] text-slate-500 uppercase print:text-[9px]">
                  {p.role} {p.documentNumber ? `• Doc: ${p.documentNumber}` : ""}
                  {p.verifiedEmail
                    ? p.role === "ESTUDANTE"
                      ? " • Ciência Discente (ECA Art. 12 / Lei 14.063/2020)"
                      : " • Certificação Institucional Digital"
                    : p.biometricVerified
                    ? " • Autenticação Biométrica FIDO2"
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Rodapé Jurídico de Fé Pública e QR Code */}
        {isFinal && (
          <div className="pt-6 border-t border-slate-200 font-sans flex items-center justify-between gap-4 text-xs print:pt-2.5 print:gap-3 print:break-inside-avoid">
            <div className="space-y-1 flex-1 print:space-y-0.5">
              <p className="font-bold text-slate-800 flex items-center space-x-1 print:text-[11px]">
                <ShieldCheck className="w-4 h-4 text-emerald-600 print:w-3.5 print:h-3.5" />
                <span>Autenticidade digital — Lei nº 14.063/2020</span>
              </p>
              <p className="text-[10px] text-slate-500 leading-tight print:text-[9px]">
                Documento oficial com integridade atestada por hash SHA-256 e código validador.
              </p>
              <p className="font-mono text-[9px] text-slate-600 break-all print:text-[8px]">
                Hash SHA-256: {minute.contentHash}
              </p>
              <div className="flex flex-wrap gap-x-4 text-[10px] text-slate-600 print:text-[9px]">
                <p>
                  Código de Verificação: <strong className="font-mono text-slate-900">{minute.verificationCode}</strong>
                </p>
                {minute.finalizedAt && (
                  <p>
                    Lavratura Oficial:{" "}
                    <strong className="text-slate-900">
                      {new Date(minute.finalizedAt).toLocaleDateString("pt-BR")} às{" "}
                      {new Date(minute.finalizedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </strong>
                  </p>
                )}
              </div>
            </div>

            <div className="text-center flex-shrink-0">
              <div className="w-20 h-20 mx-auto border border-slate-200 p-1 rounded-lg print:w-16 print:h-16 print:p-0.5 bg-white flex items-center justify-center">
                <AtaQrCode
                  value={verificationUrl}
                  size={76}
                  className="w-full h-full"
                  alt="QR Code Validação"
                  initialSvg={initialQrSvg}
                />
              </div>
              <span className="text-[9px] text-slate-500 font-bold block mt-0.5 print:text-[8px]">Validar documento</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
