"use client";

import { useState, useEffect, useRef } from "react";
import { Lock, ShieldCheck, KeyRound, AlertCircle, RefreshCw, X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (pin: string) => void;
  hasPinInitial?: boolean;
}

export default function SigningPinModal({
  isOpen,
  onClose,
  onSuccess,
  hasPinInitial,
}: Props) {
  const [mode, setMode] = useState<"PROMPT" | "SETUP" | "RESET_GOOGLE">("PROMPT");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [lockExpiresIn, setLockExpiresIn] = useState<number | null>(null);

  const googleBtnContainerRef = useRef<HTMLDivElement | null>(null);

  // Consulta se o usuário já possui PIN
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setPin("");
    setConfirmPin("");

    if (hasPinInitial !== undefined) {
      setMode(hasPinInitial ? "PROMPT" : "SETUP");
      setCheckingStatus(false);
      return;
    }

    setCheckingStatus(true);
    fetch("/api/user/signing-pin")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (data.isLocked) {
            setLockExpiresIn(data.lockExpiresInMinutes || 5);
            setError(`PIN temporariamente bloqueado. Aguarde ${data.lockExpiresInMinutes || 5} minuto(s).`);
          }
          setMode(data.hasPin ? "PROMPT" : "SETUP");
        }
      })
      .catch(() => {
        setMode("PROMPT");
      })
      .finally(() => {
        setCheckingStatus(false);
      });
  }, [isOpen, hasPinInitial]);

  if (!isOpen) return null;

  // Ação 1: Enviar PIN existente para lavratura
  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPin = pin.trim();
    if (!/^\d{4,6}$/.test(cleanPin)) {
      setError("O PIN deve conter entre 4 e 6 números.");
      return;
    }

    onSuccess(cleanPin);
  };

  // Ação 2: Cadastrar PIN pela primeira vez (Onboarding)
  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPin = pin.trim();
    const cleanConfirm = confirmPin.trim();

    if (!/^\d{4,6}$/.test(cleanPin)) {
      setError("O PIN deve conter entre 4 e 6 dígitos numéricos.");
      return;
    }

    if (cleanPin !== cleanConfirm) {
      setError("Os PINs informados não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/user/signing-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup", pin: cleanPin }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao cadastrar PIN.");
      }

      onSuccess(cleanPin);
    } catch (err: any) {
      setError(err.message || "Erro ao salvar PIN.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-5 text-slate-800 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition p-1.5 rounded-full hover:bg-slate-100 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Cabeçalho */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
            {mode === "SETUP" ? <KeyRound className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900">
              {mode === "SETUP"
                ? "Cadastrar PIN de Fé Pública"
                : "Assinatura com Fé Pública"}
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Lei Federal nº 14.063/2020 • Autenticação do Servidor
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 font-bold flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {checkingStatus ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-2 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
            <span className="text-xs font-semibold">Verificando credenciais...</span>
          </div>
        ) : mode === "SETUP" ? (
          /* MODO SETUP (ONBOARDING) */
          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-emerald-600 inline mr-1 -mt-0.5" />
              Para sua segurança e conformidade jurídica, crie um <strong>PIN de 4 a 6 dígitos</strong>. Ele será exigido para lavrar e assinar oficialmente qualquer ata, prevenindo o uso indevido em caso de tela aberta.
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-extrabold text-slate-700 block mb-1">
                  Defina seu PIN (4 a 6 números):
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Ex: 8392"
                  autoFocus
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-center text-lg font-black tracking-widest bg-white"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-700 block mb-1">
                  Confirme o PIN:
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Repita o PIN"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-center text-lg font-black tracking-widest bg-white"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || pin.length < 4 || pin !== confirmPin}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {loading ? "Gravando..." : "Salvar PIN e Lavrar"}
              </button>
            </div>
          </form>
        ) : (
          /* MODO PROMPT (DIGITAR PIN) */
          <form onSubmit={handlePromptSubmit} className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Confirme sua identidade funcional digitando o seu PIN cadastrado para assinar eletronicamente sob fé pública:
            </p>

            <div>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
                autoFocus
                required
                className="w-full px-4 py-3 rounded-2xl border-2 border-slate-300 focus:border-emerald-500 focus:outline-hidden text-center text-2xl font-black tracking-widest bg-slate-50/50"
              />
            </div>

            <div className="pt-1 flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pin.length < 4 || Boolean(lockExpiresIn)}
                className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs transition shadow-sm disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Confirmar e Lavrar</span>
              </button>
            </div>

            <div className="text-center pt-1">
              <a
                href="/configuracoes/escola"
                className="text-xs font-semibold text-slate-500 hover:text-emerald-700 transition"
                title="Redefinir PIN nas configurações"
              >
                Precisa alterar seu PIN? Acesse Configurações da Escola
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
