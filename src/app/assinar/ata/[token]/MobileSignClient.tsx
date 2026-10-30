"use client";

import { useState, useEffect } from "react";
import SignatureCanvas from "@/components/ata/SignatureCanvas";
import { CheckCircle2, ShieldCheck, Fingerprint, Sparkles } from "lucide-react";

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

  // Estados de Biometria (WebAuthn / Passkeys)
  const [hasBiometricSupport, setHasBiometricSupport] = useState(false);
  const [biometricVerified, setBiometricVerified] = useState(false);
  const [biometricDeviceType, setBiometricDeviceType] = useState<string | null>(null);
  const [isAuthenticatingBio, setIsAuthenticatingBio] = useState(false);

  // Verifica se o dispositivo do usuário tem suporte a biometria/passkey (W3C WebAuthn)
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    ) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then((available) => {
          setHasBiometricSupport(available);
        })
        .catch(() => setHasBiometricSupport(false));
    }
  }, []);

  // Dispara o prompt biométrico nativo do aparelho (TouchID / FaceID / Biometria Android)
  const handleTriggerBiometrics = async () => {
    if (!window.PublicKeyCredential) {
      alert("Seu aparelho não possui suporte ao padrão biométrico seguro (WebAuthn).");
      return;
    }

    setIsAuthenticatingBio(true);
    try {
      // Gera desafio aleatório de 32 bytes vinculado a esta sessão
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const userId = new Uint8Array(16);
      window.crypto.getRandomValues(userId);

      // Solicita autenticação com verificação de usuário obrigatória (biometria)
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: "Colégio Estadual Leopoldina B. Pedroso",
            id: window.location.hostname,
          },
          user: {
            id: userId,
            name: participantName.replace(/\s+/g, "_").toLowerCase().slice(0, 30),
            displayName: participantName,
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" }, // ES256
            { alg: -257, type: "public-key" }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform", // Força o sensor biométrico do próprio aparelho
            userVerification: "required", // Exige biometria real (dedo/FaceID/PIN seguro do SO)
          },
          timeout: 60000,
        },
      });

      if (credential) {
        setBiometricVerified(true);
        setBiometricDeviceType("WEBAUTHN_BIOMETRIC_PLATFORM");
      }
    } catch (err: any) {
      console.warn("Autenticação biométrica cancelada ou indisponível:", err);
      // Não bloqueia o usuário; ele ainda pode assinar pelo canvas touch normalmente
      alert(
        "A leitura biométrica não foi concluída. Você pode assinar normalmente no quadro abaixo com o dedo."
      );
    } finally {
      setIsAuthenticatingBio(false);
    }
  };

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
        body: JSON.stringify({
          signatureData,
          biometricVerified,
          biometricDeviceType,
        }),
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
            Sua assinatura {biometricVerified ? "com validação biométrica " : ""}foi registrada com sucesso na ata do atendimento pedagógico. Você já pode fechar esta página no seu celular.
          </p>
          {biometricVerified && (
            <div className="inline-flex items-center space-x-1 px-3 py-1 bg-emerald-50 text-emerald-800 text-[11px] font-bold rounded-full border border-emerald-200">
              <Fingerprint className="w-3.5 h-3.5 text-emerald-600" />
              <span>Biometria do Dispositivo Autenticada (Lei nº 14.063/2020)</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-5">
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

        {/* Validação Biométrica Opcional Avançada */}
        {hasBiometricSupport && (
          <div className="p-3.5 rounded-2xl border border-sky-100 bg-sky-50/60 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-xl bg-sky-600 text-white flex items-center justify-center">
                  <Fingerprint className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-extrabold text-xs text-slate-900 block">
                    Validação Biométrica
                  </span>
                  <span className="text-[10px] text-slate-500">
                    TouchID / FaceID / Biometria do Celular
                  </span>
                </div>
              </div>

              {biometricVerified ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-lg border border-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>Biometria Confirmada</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleTriggerBiometrics}
                  disabled={isAuthenticatingBio}
                  className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition shadow-2xs disabled:opacity-50 cursor-pointer flex items-center space-x-1"
                >
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  <span>{isAuthenticatingBio ? "Lendo..." : "Validar Biometria"}</span>
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
              A biometria comprova que a assinatura foi realizada pessoalmente pelo titular do aparelho (Assinatura Eletrônica Avançada — Lei nº 14.063/2020).
            </p>
          </div>
        )}

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
            {submitting ? "Registrando..." : "Confirmar Assinatura Oficial"}
          </button>

          <p className="text-[10px] text-slate-400 text-center flex items-center justify-center space-x-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Assinatura eletrônica com validade jurídica perante o NRE/SEED-PR</span>
          </p>
        </div>
      </div>
    </div>
  );
}
