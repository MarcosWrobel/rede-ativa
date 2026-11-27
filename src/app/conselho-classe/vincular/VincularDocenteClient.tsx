"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import type { TeacherInviteBoardGroup } from "@/services/classCouncilService";
import {
  consumeRedirectGsiCredential,
  getSafeGsiButtonWidth,
  isInAppWebViewUserAgent,
  isMobileBrowserUserAgent,
  prepareGsiRedirectReturnCookie,
  readGsiRedirectErrorFromUrl,
} from "@/lib/googleGsiMobile";

interface VincularDocenteClientProps {
  inviteToken: string | null;
  schoolId: string;
  schoolName: string;
  googleClientId?: string;
  enableDevAuth?: boolean;
}

export default function VincularDocenteClient({
  inviteToken,
  schoolId,
  schoolName,
  googleClientId,
  enableDevAuth = false,
}: VincularDocenteClientProps) {
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [boards, setBoards] = useState<TeacherInviteBoardGroup[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );
  const [devEmail, setDevEmail] = useState("docente.teste@escola.pr.gov.br");
  const [isWebView, setIsWebView] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  const loadCatalog = useCallback(
    async (credential: string, codeOverride?: string) => {
      setLoading(true);
      setAuthError(null);
      setFeedback(null);
      try {
        const res = await fetch("/api/conselho-classe/teacher-invite/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: credential,
            schoolId,
            ...(inviteToken ? { inviteToken } : { inviteCode: (codeOverride ?? inviteCode).trim() }),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          verifiedEmail?: string;
          boards?: TeacherInviteBoardGroup[];
        };
        if (!res.ok || !data.verifiedEmail) {
          throw new Error(data.error || "Não foi possível validar sua conta @escola.pr.gov.br.");
        }
        setGoogleIdToken(credential);
        setVerifiedEmail(data.verifiedEmail);
        setBoards(data.boards || []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao validar vínculo.";
        setAuthError(msg);
      } finally {
        setLoading(false);
      }
    },
    [inviteCode, inviteToken, schoolId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsWebView(isInAppWebViewUserAgent(navigator.userAgent));
    const urlError = readGsiRedirectErrorFromUrl();
    if (urlError) setAuthError(urlError);

    void consumeRedirectGsiCredential().then((cred) => {
      if (cred) {
        setGoogleIdToken(cred);
        if (inviteToken) {
          void loadCatalog(cred);
        }
      }
    });
  }, [inviteToken, loadCatalog]);

  useEffect(() => {
    if (!googleClientId || googleIdToken) return;
    let isMounted = true;

    const initGsi = () => {
      if (typeof window === "undefined" || !window.google?.accounts?.id) return;
      try {
        const isMobile = isMobileBrowserUserAgent(navigator.userAgent);
        if (isMobile) {
          prepareGsiRedirectReturnCookie(window.location.pathname + window.location.search);
        }
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          hosted_domain: "escola.pr.gov.br",
          ...(isMobile
            ? {
                ux_mode: "redirect",
                login_uri: `${window.location.origin}/api/conselho-classe/google-gsi-callback`,
              }
            : {
                callback: async (response: { credential?: string }) => {
                  if (!isMounted || !response?.credential) return;
                  if (inviteToken) {
                    await loadCatalog(response.credential);
                  } else {
                    setGoogleIdToken(response.credential);
                  }
                },
              }),
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
            width: getSafeGsiButtonWidth(googleBtnContainerRef.current),
          });
        }
      } catch {
        // Silencia erro externo de inicialização
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
  }, [googleClientId, googleIdToken, inviteToken, loadCatalog]);

  function toggleSubject(subjectId: string) {
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId) ? prev.filter((id) => id !== subjectId) : [...prev, subjectId]
    );
  }

  async function handleClaimSelected() {
    if (!googleIdToken || selectedSubjectIds.length === 0) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/conselho-classe/teacher-invite/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleIdToken,
          schoolId,
          ...(inviteToken ? { inviteToken } : { inviteCode: inviteCode.trim() }),
          subjectIds: selectedSubjectIds,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        boards?: TeacherInviteBoardGroup[];
        claimResult?: {
          claimedIds: string[];
          skippedClaimedByOtherIds: string[];
        };
      };
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível concluir a vinculação.");
      }
      setBoards(data.boards || []);
      setSelectedSubjectIds([]);
      const claimedCount = data.claimResult?.claimedIds.length ?? 0;
      const skippedCount = data.claimResult?.skippedClaimedByOtherIds.length ?? 0;
      setFeedback({
        type: "success",
        message:
          skippedCount > 0
            ? `${claimedCount} componente(s) vinculado(s). ${skippedCount} já estavam atribuídos a outro docente.`
            : `${claimedCount} componente(s) vinculado(s) ao seu e-mail institucional.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Falha ao vincular componentes.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyCurrentUrl() {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // ignora erro de clipboard
    }
  }

  if (!verifiedEmail) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 p-7 shadow-xs space-y-5">
          <div className="space-y-1.5 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-900 text-[11px] font-bold">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Vínculo Docente</span>
            </span>
            <h1 className="text-lg font-black text-slate-900">{schoolName}</h1>
            <p className="text-xs text-slate-600">
              Entre com sua conta <strong>@escola.pr.gov.br</strong> para vincular suas turmas e
              componentes curriculares.
            </p>
          </div>

          {isWebView && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 space-y-2">
              <p className="font-semibold">
                Você está no navegador interno do aplicativo. Para evitar falhas no login Google,
                abra este endereço no <strong>Chrome</strong> ou <strong>Safari</strong>.
              </p>
              <button
                type="button"
                onClick={() => void handleCopyCurrentUrl()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-white font-bold text-amber-950 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedUrl ? "Endereço copiado" : "Copiar endereço"}</span>
              </button>
            </div>
          )}

          {authError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {!inviteToken && (
            <div className="space-y-1.5">
              <label
                htmlFor="vincular-school-code"
                className="block text-xs font-bold text-slate-700"
              >
                Código de convite da escola
              </label>
              <input
                id="vincular-school-code"
                type="text"
                placeholder="Ex.: A7K9-M2P4"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base sm:text-xs font-mono uppercase text-slate-900 bg-white"
              />
            </div>
          )}

          {googleIdToken && !inviteToken ? (
            <button
              type="button"
              disabled={loading || !inviteCode.trim()}
              onClick={() => void loadCatalog(googleIdToken)}
              className="w-full min-h-[42px] rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              {loading ? "Validando código..." : "Continuar com código"}
            </button>
          ) : googleClientId ? (
            <div
              ref={googleBtnContainerRef}
              className="min-h-[44px] flex items-center justify-center"
            />
          ) : null}

          {enableDevAuth && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <input
                type="email"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base sm:text-xs text-slate-900 bg-white"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadCatalog(`dev-mock-token:${devEmail.trim()}`)}
                className="w-full min-h-[40px] rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
              >
                Entrar (Desenvolvimento)
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-36 sm:pb-28 overflow-x-clip max-w-full [color-scheme:light]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase text-slate-500 truncate">{schoolName}</p>
            <h1 className="text-base font-black text-slate-900">
              Vincular Turmas e Componentes
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold min-w-0 max-w-full">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{verifiedEmail}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setGoogleIdToken(null);
                setVerifiedEmail(null);
                setBoards([]);
                setSelectedSubjectIds([]);
              }}
              className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>Trocar conta</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {feedback && (
          <div
            role="status"
            className={`rounded-2xl border p-3.5 text-xs font-bold flex items-center gap-2 ${
              feedback.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                : "border-rose-300 bg-rose-50 text-rose-900"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {boards.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-600">
            Nenhuma turma com componentes cadastrados para o ano letivo atual.
          </div>
        ) : (
          boards.map((board) => (
            <section
              key={board.boardId}
              className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-900">{board.className}</h2>
                <span className="text-[11px] font-semibold text-slate-500">
                  {board.subjects.length} componente(s)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {board.subjects.map((subj) => {
                  const checked = selectedSubjectIds.includes(subj.id);
                  const disabled = subj.status !== "AVAILABLE";
                  return (
                    <label
                      key={subj.id}
                      className={`min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs transition ${
                        subj.status === "MINE"
                          ? "border-emerald-300 bg-emerald-50/70 text-emerald-950 font-bold"
                          : subj.status === "CLAIMED_OTHER"
                          ? "border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed"
                          : checked
                          ? "border-sky-500 bg-sky-50 text-sky-950 font-bold cursor-pointer"
                          : "border-slate-200 bg-white hover:bg-slate-50 text-slate-800 cursor-pointer"
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={subj.status === "MINE" || checked}
                          onChange={() => toggleSubject(subj.id)}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 bg-white accent-sky-600 [color-scheme:light]"
                        />
                        <span className="truncate">{subj.name}</span>
                      </span>
                      <span className="text-[10px] font-bold shrink-0">
                        {subj.status === "MINE"
                          ? "Vinculado a você"
                          : subj.status === "CLAIMED_OTHER"
                          ? "Ocupado"
                          : "Disponível"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-xs font-bold text-slate-700">
            {selectedSubjectIds.length} componente(s) selecionado(s)
          </p>
          <button
            type="button"
            disabled={saving || selectedSubjectIds.length === 0}
            onClick={() => void handleClaimSelected()}
            className="w-full sm:w-auto min-h-[42px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-extrabold transition cursor-pointer"
          >
            {saving ? "Vinculando..." : "Vincular selecionados"}
          </button>
        </div>
      </footer>
    </div>
  );
}
