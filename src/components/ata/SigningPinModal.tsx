"use client";

import { useState, useEffect, useId, useRef } from "react";
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
  const [checkingStatus, setCheckingStatus] = useState(hasPinInitial === undefined);
  const [lockExpiresIn, setLockExpiresIn] = useState<number | null>(null);

  const googleBtnContainerRef = useRef<HTMLDivElement | null>(null);
  const dialogPanelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const errorId = useId();

  // Gerencia captura/retorno de foco, Tab trap e Escape enquanto o modal estiver aberto
  useEffect(() => {
    let focusRaf = 0;

    if (isOpen) {
      if (!wasOpenRef.current) {
        triggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      wasOpenRef.current = true;

      focusRaf = window.requestAnimationFrame(() => {
        const panel = dialogPanelRef.current;
        if (!panel || checkingStatus) return;
        const firstTarget = panel.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not(:disabled), button:not(:disabled)'
        );
        firstTarget?.focus({ preventScroll: true });
      });

      const handleKeyDown = (event: KeyboardEvent) => {
        const panel = dialogPanelRef.current;
        if (!panel) return;

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!loading) {
            onClose();
          }
          return;
        }

        if (event.key === "Tab") {
          const focusables = Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => el.offsetParent !== null || el === document.activeElement);

          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement;

          if (event.shiftKey) {
            if (active === first || !panel.contains(active)) {
              event.preventDefault();
              last.focus();
            }
          } else if (active === last || !panel.contains(active)) {
            event.preventDefault();
            first.focus();
          }
        }
      };

      document.addEventListener("keydown", handleKeyDown, true);
      return () => {
        if (focusRaf) window.cancelAnimationFrame(focusRaf);
        document.removeEventListener("keydown", handleKeyDown, true);
      };
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected) {
        window.requestAnimationFrame(() => {
          if (trigger.isConnected) {
            trigger.focus({ preventScroll: true });
          }
        });
      }
    }

    return () => {
      if (focusRaf) window.cancelAnimationFrame(focusRaf);
    };
  }, [isOpen, checkingStatus, loading, onClose]);

  useEffect(() => {
    return () => {
      const trigger = triggerRef.current;
      if (wasOpenRef.current && trigger && trigger.isConnected) {
        window.requestAnimationFrame(() => {
          if (trigger.isConnected) {
            trigger.focus({ preventScroll: true });
          }
        });
      }
    };
  }, []);

  // Consulta se o usuário já possui PIN e redefine o estado limpo ao fechar
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setPin("");
      setConfirmPin("");
      setCheckingStatus(hasPinInitial === undefined);
      return;
    }
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        ref={dialogPanelRef}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-5 text-slate-800 relative max-h-[90dvh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="Fechar"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition p-1.5 rounded-full hover:bg-slate-100 cursor-pointer disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Cabeçalho */}
        <div className="flex items-center space-x-3 pr-6">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
            {mode === "SETUP" ? <KeyRound className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <h3 id={titleId} className="text-base font-black text-slate-900">
              {mode === "SETUP"
                ? "Cadastrar PIN de confirmação"
                : "Confirmação de autoria por PIN"}
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Autenticação do servidor da equipe pedagógica
            </p>
          </div>
        </div>

        {error && (
          <div
            id={errorId}
            role="alert"
            className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 font-bold flex items-start space-x-2"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {checkingStatus ? (
          <div
            role="status"
            aria-live="polite"
            className="py-8 flex flex-col items-center justify-center space-y-2 text-slate-500"
          >
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
            <span className="text-xs font-semibold">Verificando credenciais...</span>
          </div>
        ) : mode === "SETUP" ? (
          /* MODO SETUP (ONBOARDING) */
          <form onSubmit={handleSetupSubmit} noValidate className="space-y-4">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-emerald-600 inline mr-1 -mt-0.5" />
              Crie um <strong>PIN de 4 a 6 dígitos</strong> para confirmar sua autoria ao registrar atas.
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
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ""));
                    if (error) setError(null);
                  }}
                  placeholder="Ex: 8392"
                  autoFocus
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-center text-lg font-black tracking-widest tabular-nums bg-white"
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
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(e) => {
                    setConfirmPin(e.target.value.replace(/\D/g, ""));
                    if (error) setError(null);
                  }}
                  placeholder="Repita o PIN"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-center text-lg font-black tracking-widest tabular-nums bg-white"
                />
              </div>
            </div>

            {loading && (
              <div role="status" aria-live="polite" className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                Registrando PIN e preparando confirmação da ata...
              </div>
            )}

            <div className="pt-2 flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || pin.length < 4 || pin !== confirmPin}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {loading ? "Gravando..." : "Salvar PIN"}
              </button>
            </div>
          </form>
        ) : (
          /* MODO PROMPT (DIGITAR PIN) */
          <form onSubmit={handlePromptSubmit} noValidate className="space-y-4">
            <p className="text-xs text-slate-600">
              Digite seu PIN para concluir a confirmação da ata:
            </p>

            <div>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                aria-label="PIN de confirmação"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ""));
                  if (error) setError(null);
                }}
                placeholder="••••"
                autoFocus
                required
                className="w-full px-4 py-3 rounded-2xl border-2 border-slate-300 focus:border-emerald-500 focus:outline-hidden text-center text-2xl font-black tracking-widest tabular-nums bg-slate-50/50"
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
