"use client";

import { useState, useEffect, useRef } from "react";
import SignatureCanvas from "@/components/ata/SignatureCanvas";
import {
  CheckCircle2,
  ShieldCheck,
  Fingerprint,
  Sparkles,
  AlertCircle,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Props {
  token: string;
  participantName: string;
  participantRole: string;
  expectedEmail?: string | null;
  schoolName: string;
  subject: string;
  summary?: string;
  agreementsSummary?: string | null;
  googleClientId?: string;
}

declare global {
  interface Window {
    google?: any;
  }
}

export default function MobileSignClient({
  token,
  participantName,
  participantRole,
  expectedEmail,
  schoolName,
  subject,
  summary,
  agreementsSummary,
  googleClientId,
}: Props) {
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successMode, setSuccessMode] = useState<string>("CANVAS");
  const [verifiedEmailSuccess, setVerifiedEmailSuccess] = useState<string | null>(null);
  const [showFullAta, setShowFullAta] = useState(false);
  const [manualDrawOpen, setManualDrawOpen] = useState(false);

  // Estados de Biometria (WebAuthn / Passkeys)
  const [hasBiometricSupport, setHasBiometricSupport] = useState(false);
  const [biometricVerified, setBiometricVerified] = useState(false);
  const [biometricDeviceType, setBiometricDeviceType] = useState<string | null>(null);
  const [isAuthenticatingBio, setIsAuthenticatingBio] = useState(false);

  // Estados de Autenticação @escola.pr.gov.br
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [googleVerifiedAccount, setGoogleVerifiedAccount] = useState<{
    email: string;
    name?: string;
  } | null>(null);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const [isVerifyingGoogle, setIsVerifyingGoogle] = useState(false);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  const isStudentOrStaff =
    participantRole === "ESTUDANTE" ||
    participantRole === "PROFESSOR" ||
    participantRole === "EQUIPE_ESCOLAR" ||
    participantRole === "TESTEMUNHA";

  // Verifica se o dispositivo tem suporte a biometria/passkey (W3C WebAuthn)
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

  // Carrega e inicializa o script Google Identity Services (GIS)
  useEffect(() => {
    if (!googleClientId) return;

    let isMounted = true;

    const initGsi = () => {
      if (typeof window === "undefined" || !window.google?.accounts?.id) return;

      try {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          hosted_domain: "escola.pr.gov.br",
          callback: async (response: any) => {
            if (!isMounted || !response.credential) return;
            await handleGoogleCredentialReceived(response.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        if (googleBtnContainerRef.current) {
          googleBtnContainerRef.current.innerHTML = "";
          window.google.accounts.id.renderButton(googleBtnContainerRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "signin_with",
            shape: "pill",
            logo_alignment: "left",
            width: "100%",
          });
        }
      } catch (err) {
        console.warn("[GSI] Falha ao inicializar Google Identity Services:", err);
      }
    };

    if (window.google?.accounts?.id) {
      initGsi();
    } else {
      const existingScript = document.getElementById("google-gsi-client");
      if (!existingScript) {
        const script = document.createElement("script");
        script.id = "google-gsi-client";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (isMounted) initGsi();
        };
        document.body.appendChild(script);
      } else {
        existingScript.addEventListener("load", () => {
          if (isMounted) initGsi();
        });
      }
    }

    return () => {
      isMounted = false;
    };
  }, [googleClientId]);

  // Pré-validação da credencial Google recebida do popup
  const handleGoogleCredentialReceived = async (credential: string) => {
    setGoogleAuthError(null);
    setIsVerifyingGoogle(true);

    try {
      const res = await fetch(`/api/atas/sign-token/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleIdToken: credential,
          dryRun: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Conta Google não aceita.");
      }

      setGoogleIdToken(credential);
      setGoogleVerifiedAccount({
        email: data.verifiedEmail,
        name: data.verifiedGoogleName,
      });
    } catch (err: any) {
      setGoogleAuthError(err.message || "Erro ao verificar conta institucional.");
      setGoogleIdToken(null);
      setGoogleVerifiedAccount(null);
    } finally {
      setIsVerifyingGoogle(false);
    }
  };

  // Dispara o prompt biométrico nativo do aparelho (TouchID / FaceID / Biometria Android)
  const handleTriggerBiometrics = async () => {
    if (!window.PublicKeyCredential) {
      alert("Seu aparelho não possui suporte ao padrão biométrico seguro (WebAuthn).");
      return;
    }

    setIsAuthenticatingBio(true);
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const userId = new Uint8Array(16);
      window.crypto.getRandomValues(userId);

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
            { alg: -7, type: "public-key" },
            { alg: -257, type: "public-key" },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
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
      alert(
        "A leitura biométrica não foi concluída. Você pode assinar normalmente no quadro abaixo com o dedo."
      );
    } finally {
      setIsAuthenticatingBio(false);
    }
  };

  // Submissão da assinatura
  const handleSubmit = async (preferEscolaAuth = false) => {
    if (preferEscolaAuth && !googleIdToken) {
      alert("Conecte sua conta @escola.pr.gov.br antes de confirmar.");
      return;
    }

    if (!preferEscolaAuth && !signatureData) {
      alert("Por favor, faça sua assinatura no quadro antes de confirmar.");
      return;
    }

    setSubmitting(true);
    setGoogleAuthError(null);

    try {
      const payload: any = {};
      if (preferEscolaAuth && googleIdToken) {
        payload.googleIdToken = googleIdToken;
        if (signatureData) payload.signatureData = signatureData;
        if (biometricVerified) {
          payload.biometricVerified = true;
          payload.biometricDeviceType = biometricDeviceType;
        }
      } else {
        payload.signatureData = signatureData;
        payload.biometricVerified = biometricVerified;
        payload.biometricDeviceType = biometricDeviceType;
      }

      const res = await fetch(`/api/atas/sign-token/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar assinatura");

      setSuccessMode(data.mode || (preferEscolaAuth ? "ESCOLA_OAUTH" : "MOBILE_QR"));
      setVerifiedEmailSuccess(data.verifiedEmail || googleVerifiedAccount?.email || null);
      setSuccess(true);
    } catch (err: any) {
      setGoogleAuthError(err.message || "Erro ao registrar assinatura.");
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
            Sua assinatura digital foi registrada com fé pública e validade jurídica na ata do atendimento pedagógico. Você já pode fechar esta página.
          </p>

          {successMode === "ESCOLA_OAUTH" && verifiedEmailSuccess && (
            <div className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 text-[11px] font-bold rounded-xl border border-emerald-300">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Autenticado via {verifiedEmailSuccess}</span>
            </div>
          )}

          {biometricVerified && (
            <div className="inline-flex items-center space-x-1 px-3 py-1 bg-sky-50 text-sky-800 text-[11px] font-bold rounded-full border border-sky-200">
              <Fingerprint className="w-3.5 h-3.5 text-sky-600" />
              <span>Biometria do Dispositivo Autenticada (Lei nº 14.063/2020)</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 flex items-center justify-center">
      <div className="max-w-lg w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-5">
        {/* Cabeçalho */}
        <div className="text-center space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {schoolName}
          </p>
          <h1 className="text-base font-black text-slate-900">
            Assinatura Digital de Atendimento Pedagógico
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Pauta: {subject}
          </p>
        </div>

        {/* Identificação do Signatário */}
        <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-[11px]">Signatário(a):</p>
            <p className="font-extrabold text-slate-900 text-sm">{participantName}</p>
            <p className="text-[11px] text-slate-500">
              {participantRole === "ESTUDANTE"
                ? "Estudante (Ciência e Escuta Ativa — ECA Art. 12)"
                : participantRole}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-bold text-[10px] text-slate-600 uppercase">
            {participantRole}
          </span>
        </div>

        {/* Acordeão de Leitura do Teor da Ata */}
        {summary && (
          <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50/60 text-xs">
            <button
              type="button"
              onClick={() => setShowFullAta(!showFullAta)}
              className="w-full p-3 flex items-center justify-between text-left font-bold text-slate-800 hover:bg-slate-100 transition cursor-pointer"
            >
              <span className="flex items-center space-x-1.5">
                <FileText className="w-4 h-4 text-sky-600" />
                <span>Ler Teor do Registro e Combinados</span>
              </span>
              {showFullAta ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {showFullAta && (
              <div className="p-3.5 border-t border-slate-200 bg-white space-y-3 font-serif text-slate-800 leading-relaxed text-xs">
                <p className="whitespace-pre-wrap">{summary}</p>
                {agreementsSummary && (
                  <div className="font-sans text-[11px] bg-sky-50 p-2.5 rounded-xl border border-sky-200 text-sky-900">
                    <strong>Síntese dos Combinados / Prazos:</strong>
                    <p className="mt-0.5">{agreementsSummary}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ALERTA DE ERRO */}
        {googleAuthError && (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{googleAuthError}</p>
          </div>
        )}

        {/* OPÇÃO 1: ASSINAR COM @ESCOLA.PR.GOV.BR (DESTAQUE MÁXIMO PARA ALUNO / PROFESSOR) */}
        <div className={`p-4 rounded-2xl border ${isStudentOrStaff ? "border-sky-300 bg-sky-50/50" : "border-slate-200 bg-slate-50/70"} space-y-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-xs">
                @
              </div>
              <div>
                <span className="font-extrabold text-xs text-slate-900 block">
                  Assinatura com Conta Institucional
                </span>
                <span className="text-[10px] text-slate-500">
                  Login Oficial SEED-PR (@escola.pr.gov.br)
                </span>
              </div>
            </div>
            {isStudentOrStaff && (
              <span className="px-2 py-0.5 bg-sky-200 text-sky-900 font-extrabold text-[9px] rounded-md uppercase">
                Recomendado
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-600 leading-relaxed">
            {isStudentOrStaff
              ? "Como estudante ou servidor, você pode assinar em 1 clique conectando sua conta institucional @escola do Google Classroom/Workspace."
              : "Caso possua conta oficial @escola.pr.gov.br, você pode utilizá-la para assinar com fé pública digital."}
          </p>

          {/* Estado Verificado: Conta Google reconhecida */}
          {googleVerifiedAccount ? (
            <div className="p-3 bg-white rounded-xl border border-emerald-300 space-y-2">
              <div className="flex items-center space-x-2 text-emerald-800 text-xs font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="truncate">
                  <span>Conta Reconhecida: </span>
                  <span className="font-mono text-[11px] underline">{googleVerifiedAccount.email}</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Titularidade conferida para <strong>{googleVerifiedAccount.name || participantName}</strong>. Clique abaixo para concluir em 1 clique.
              </p>
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition shadow-sm cursor-pointer disabled:opacity-50"
              >
                {submitting ? "Gravando assinatura..." : "Confirmar Assinatura em 1 Clique"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div ref={googleBtnContainerRef} className="min-h-[42px] flex items-center justify-center" />
              {isVerifyingGoogle && (
                <p className="text-center text-[10px] text-sky-700 animate-pulse font-semibold">
                  Validando titularidade da conta @escola.pr.gov.br...
                </p>
              )}
            </div>
          )}
        </div>

        {/* OPÇÃO 2: BIOMETRIA LOCAL DO APARELHO (WEBAUTHN) */}
        {hasBiometricSupport && (
          <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-xl bg-slate-800 text-white flex items-center justify-center">
                  <Fingerprint className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-extrabold text-xs text-slate-900 block">
                    Validação Biométrica do Aparelho
                  </span>
                  <span className="text-[10px] text-slate-500">
                    TouchID / FaceID / Biometria Android
                  </span>
                </div>
              </div>

              {biometricVerified ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-lg border border-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>Biometria Ok</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleTriggerBiometrics}
                  disabled={isAuthenticatingBio}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition shadow-2xs disabled:opacity-50 cursor-pointer flex items-center space-x-1"
                >
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  <span>{isAuthenticatingBio ? "Lendo..." : "Validar Biometria"}</span>
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
              A biometria comprova que a assinatura foi realizada pessoalmente pelo titular do aparelho (Lei nº 14.063/2020).
            </p>
          </div>
        )}

        {/* OPÇÃO 3: ASSINATURA MANUAL NO QUADRO (TOUCH / MOUSE) */}
        <div className="space-y-2">
          {isStudentOrStaff && !googleVerifiedAccount ? (
            <button
              type="button"
              onClick={() => setManualDrawOpen(!manualDrawOpen)}
              className="text-xs text-slate-500 hover:text-slate-800 font-bold flex items-center space-x-1 cursor-pointer mx-auto pt-1"
            >
              <span>{manualDrawOpen ? "▲ Ocultar quadro de assinatura com o dedo" : "▼ Ou assinar desenhando com o dedo na tela"}</span>
            </button>
          ) : null}

          {(!isStudentOrStaff || manualDrawOpen) && (
            <div className="space-y-3 pt-2">
              <label className="text-xs font-extrabold text-slate-800 block">
                Assinatura com o dedo ou caneta:
              </label>
              <SignatureCanvas
                signerName={participantName}
                onSave={(dataUrl) => setSignatureData(dataUrl)}
                onClear={() => setSignatureData(null)}
              />

              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={!signatureData || submitting}
                className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm transition shadow-sm disabled:opacity-40 cursor-pointer"
              >
                {submitting ? "Registrando..." : "Confirmar Assinatura Oficial"}
              </button>
            </div>
          )}
        </div>

        <p className="text-[10px] text-slate-400 text-center flex items-center justify-center space-x-1 pt-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Assinatura eletrônica com validade jurídica perante a SEED-PR e órgãos de controle</span>
        </p>
      </div>
    </div>
  );
}
