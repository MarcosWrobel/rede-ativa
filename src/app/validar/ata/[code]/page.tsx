import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ShieldCheck, School, Calendar, CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import { maskName, maskDocument } from "@/lib/ataCrypto";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function ValidarAtaPage({ params }: Props) {
  const { code } = await params;
  const cleanCode = code.toUpperCase().trim();

  const minute = await prisma.pedagogicalMinute.findUnique({
    where: { verificationCode: cleanCode },
    include: {
      school: true,
      participants: true,
      addendums: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!minute) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h1 className="text-lg font-black text-slate-900">Documento Não Encontrado</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            O código de validação <strong>{cleanCode}</strong> não corresponde a nenhum documento oficial lavrado no sistema. Verifique se o código digitado ou o QR Code escaneado está correto.
          </p>
        </div>
      </div>
    );
  }

  const isVoid = minute.status === "VOIDED";
  const numStr = minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "S/N";

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 flex items-center justify-center">
      <div className="max-w-xl w-full bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Banner de Status */}
        <div
          className={`p-6 text-center text-white ${
            isVoid ? "bg-rose-600" : "bg-emerald-600"
          }`}
        >
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3 backdrop-blur-xs">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest bg-black/20 px-3 py-1 rounded-full">
            Certidão de Autenticidade Digital
          </span>
          <h1 className="text-xl font-black mt-2">
            {isVoid ? "Ata Tornada Sem Efeito" : "Ata Pedagógica Oficial e Autêntica"}
          </h1>
          <p className="text-xs text-white/90 mt-1">
            Conferência em conformidade com a Lei Federal nº 14.063/2020 e ECA
          </p>
        </div>

        {/* Informações Institucionais e Criptográficas (LGPD-safe) */}
        <div className="p-6 sm:p-8 space-y-5 text-xs text-slate-700">
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
            <p className="text-[10px] font-bold uppercase text-slate-400">Estabelecimento de Ensino</p>
            <p className="text-sm font-extrabold text-slate-900">{minute.school.name}</p>
            <p className="text-slate-500">
              NRE {minute.school.nre} • INEP: {minute.school.inepCode} • {minute.school.city} - {minute.school.state}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">Número da Ata</span>
              <strong className="text-sm font-black text-slate-900 font-mono">
                {numStr}/{minute.year}
              </strong>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">Data de Lavratura</span>
              <strong className="text-sm font-black text-slate-900">
                {new Date(minute.attendedAt).toLocaleDateString("pt-BR")}
              </strong>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Servidora Responsável (Fé Pública)</span>
            <p className="font-bold text-slate-800">
              {maskName(minute.authorName)} — {minute.authorRole}
            </p>
          </div>

          {/* Participantes Mascarados (LGPD) */}
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Presentes e Assinaturas Registradas</span>
              <span className="text-[10px] text-slate-400 flex items-center space-x-1">
                <Lock className="w-3 h-3" />
                <span>Dados sensíveis mascarados (LGPD/ECA)</span>
              </span>
            </div>
            <ul className="space-y-1.5">
              {minute.participants.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100"
                >
                  <div>
                    <strong className="text-slate-900 block">{maskName(p.name)}</strong>
                    <span className="text-[10px] text-slate-500">
                      {p.role} • Doc: {maskDocument(p.documentNumber)}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {p.signatureMode === "REFUSED"
                      ? "Recusa Certificada"
                      : p.biometricVerified
                      ? "Assinatura Biométrica (WebAuthn)"
                      : "Assinatura Registrada"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Integridade Criptográfica */}
          <div className="space-y-1.5 border-t border-slate-100 pt-4">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Hash SHA-256 Canônico</span>
            <p className="font-mono text-[10px] text-slate-600 bg-slate-100 p-2.5 rounded-xl break-all">
              {minute.contentHash}
            </p>
          </div>

          {minute.addendums.length > 0 && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 space-y-1">
              <strong className="font-bold block">
                Aviso: Constam {minute.addendums.length} Termo(s) de Aditamento (&quot;Em tempo&quot;) encadeados.
              </strong>
              <p className="text-[11px] text-amber-800">
                O teor integral deste documento pedagógico e seus aditamentos pode ser consultado fisicamente na Secretaria Escolar ou mediante acesso autenticado ao sistema pelos órgãos de proteção competentes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
