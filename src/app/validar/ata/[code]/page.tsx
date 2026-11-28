import { headers } from "next/headers";
import { ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import { normalizePublicAtaCode, resolvePublicAtaByCode } from "@/lib/ataPublicVerification";
import { formatParticipantRoleLabel } from "@/lib/participantKinship";
import { checkRateLimit, hashIp, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function ValidarAtaPage({ params }: Props) {
  const reqHeaders = await headers();
  const rawIp =
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    reqHeaders.get("x-real-ip")?.trim() ||
    "unknown";
  const rlCheck = await checkRateLimit(
    `rl:public-ata-page:${hashIp(rawIp)}`,
    RATE_LIMIT_POLICIES.PUBLIC_ATA_VERIFY
  );

  if (!rlCheck.success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h1 className="text-lg font-black text-slate-900">Limite de consultas excedido</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            Aguarde {rlCheck.retryAfterSeconds} segundos antes de realizar uma nova consulta de verificação.
          </p>
        </div>
      </div>
    );
  }

  const { code } = await params;
  const cleanCode = normalizePublicAtaCode(code, { decodeUriComponent: true });
  const ataData = await resolvePublicAtaByCode(cleanCode);

  if (!ataData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h1 className="text-lg font-black text-slate-900">Documento não encontrado</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            Código de validação <strong>{cleanCode}</strong> não localizado. Verifique os dados digitados ou o QR Code escaneado.
          </p>
        </div>
      </div>
    );
  }

  const isVoid = ataData.isVoided;
  const numStr = ataData.ataNumber ? String(ataData.ataNumber).padStart(3, "0") : "S/N";
  const isAuthentic = ataData.isAuthentic;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 flex items-center justify-center">
      <div className="max-w-xl w-full bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Banner de Status */}
        <div
          className={`p-6 text-center text-white ${
            !isAuthentic ? "bg-rose-700" : isVoid ? "bg-rose-600" : "bg-emerald-600"
          }`}
        >
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3 backdrop-blur-xs">
            {!isAuthentic ? (
              <AlertTriangle className="w-8 h-8 text-white" />
            ) : (
              <ShieldCheck className="w-8 h-8 text-white" />
            )}
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest bg-black/20 px-3 py-1 rounded-full">
            Verificação de Integridade
          </span>
          <h1 className="text-xl font-black mt-2">
            {!isAuthentic
              ? "Violação de integridade detectada"
              : isVoid
                ? "Ata Tornada Sem Efeito"
                : "Ata pedagógica íntegra"}
          </h1>
          <p className="text-xs text-white/90 mt-1">
            {!isAuthentic
              ? "O código recalculado diverge do registro original."
              : "Conferência de integridade com exibição de dados mascarados"}
          </p>
        </div>

        {/* Informações Institucionais e Criptográficas (LGPD-safe) */}
        <div className="p-6 sm:p-8 space-y-5 text-xs text-slate-700">
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
            <p className="text-[10px] font-bold uppercase text-slate-400">Estabelecimento de Ensino</p>
            <p className="text-sm font-extrabold text-slate-900">{ataData.school.name}</p>
            <p className="text-slate-500">
              NRE {ataData.school.nre} • INEP: {ataData.school.inepCode} • {ataData.school.city} - {ataData.school.state}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">Número da Ata</span>
              <strong className="text-sm font-black text-slate-900 font-mono">
                {numStr}/{ataData.year}
              </strong>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">Data de Lavratura</span>
              <strong className="text-sm font-black text-slate-900">
                {new Date(ataData.finalizedAt || ataData.attendedAt).toLocaleDateString("pt-BR")}
              </strong>
              {ataData.isExtemporaneous && (
                <span className="text-[9px] font-bold text-amber-700 block mt-0.5">
                  • Lavratura Extemporânea Averbada
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Responsável pela lavratura</span>
            <p className="font-bold text-slate-800">
              {ataData.authorName} — {ataData.authorRole}
            </p>
          </div>

          {/* Participantes Mascarados (LGPD) */}
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Participantes e assinaturas</span>
              <span className="text-[10px] text-slate-400 flex items-center space-x-1">
                <Lock className="w-3 h-3" />
                <span>Dados mascarados (LGPD)</span>
              </span>
            </div>
            <ul className="space-y-1.5">
              {ataData.participants.map((p, idx) => (
                <li
                  key={`${p.role}-${idx}`}
                  className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100"
                >
                  <div>
                    <strong className="text-slate-900 block">{p.maskedName}</strong>
                    <span className="text-[10px] text-slate-500">
                      {formatParticipantRoleLabel(p.role)} • Doc: {p.maskedDoc}
                      {p.maskedEmail ? ` • ${p.maskedEmail}` : ""}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {p.signatureMode === "REFUSED"
                      ? "Recusa registrada"
                      : p.isEscolaSigned
                      ? "✓ Assinado via @escola.pr.gov.br"
                      : p.biometricVerified
                      ? "Biometria (WebAuthn)"
                      : "Registrada"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Código de verificação de integridade */}
          <div className="space-y-1.5 border-t border-slate-100 pt-4">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Código de verificação de integridade</span>
            <p className="font-mono text-[10px] text-slate-600 bg-slate-100 p-2.5 rounded-xl break-all">
              {ataData.contentHash}
            </p>
            {ataData.govBrVerified && (
              <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
                ✓ Assinatura Gov.br verificada
                {ataData.govBrProtocol
                  ? ` • Protocolo: ${ataData.govBrProtocol}`
                  : ""}
              </p>
            )}
          </div>

          {ataData.addendumsCount > 0 && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 space-y-1">
              <strong className="font-bold block">
                Constam {ataData.addendumsCount} termo(s) de aditamento (&quot;Em tempo&quot;).
              </strong>
              <p className="text-[11px] text-amber-800">
                O teor integral pode ser consultado na secretaria escolar ou pelos órgãos de proteção competentes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
