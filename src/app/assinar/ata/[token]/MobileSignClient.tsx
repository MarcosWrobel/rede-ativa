"use client";

import { useState } from "react";
import SignatureCanvas from "@/components/ata/SignatureCanvas";
import { CheckCircle2, ShieldCheck } from "lucide-react";

interface Props {
  token: string;
  participantName: string;
  participantRole: string;
  schoolName: string;
  subject: string;
}

export default function MobileSignClient({
  token,
  participantName,
  participantRole,
  schoolName,
  subject,
}: Props) {
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!signatureData) {
      alert("Por favor, faça sua assinatura no quadro antes de confirmar.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/atas/sign-token/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar assinatura");

      setSuccess(true);
    } catch (err: any) {
      alert(err.message || "Erro ao enviar assinatura");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-black text-slate-900">Assinatura Concluída!</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Sua assinatura foi registrada com sucesso na ata do atendimento pedagógico. Você já pode fechar esta página no seu celular.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-6">
        <div className="text-center space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {schoolName}
          </p>
          <h1 className="text-base font-black text-slate-900">
            Assinatura Digital de Atendimento
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Pauta: {subject}
          </p>
        </div>

        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
          <p className="text-slate-500">Signatário(a):</p>
          <p className="font-extrabold text-slate-900 text-sm">{participantName}</p>
          <p className="text-[11px] text-slate-500">{participantRole}</p>
        </div>

        <div>
          <SignatureCanvas
            signerName={participantName}
            onSave={(dataUrl) => setSignatureData(dataUrl)}
            onClear={() => setSignatureData(null)}
          />
        </div>

        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!signatureData || submitting}
            className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm transition shadow-sm disabled:opacity-40 cursor-pointer"
          >
            {submitting ? "Registrando..." : "Confirmar Assinatura"}
          </button>

          <p className="text-[10px] text-slate-400 text-center flex items-center justify-center space-x-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Assinatura eletrônica com validade legal (Lei nº 14.063/2020)</span>
          </p>
        </div>
      </div>
    </div>
  );
}
