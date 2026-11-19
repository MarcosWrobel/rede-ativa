"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import {
  DEFAULT_PRE_COUNCIL_ACK_STATEMENT,
  formatPreCouncilDatePtBr,
  formatPreCouncilDateTimePtBr,
} from "@/components/conselho/preCouncilUtils";
import type {
  CouncilTrimesterNumber,
  PreCouncilSynthesis,
} from "@/components/conselho/types";

interface PreCouncilPortalConversation {
  id: string;
  subjectId: string | null;
  subjectName: string;
  teacherName: string;
  teacherEmail: string | null;
  monitoredStudents: Array<{
    studentId: string;
    name: string;
  }>;
  monitoredStudentsNotes: string;
  agreements: string;
  conversationStatus: "PENDING" | "COMPLETED";
  conversationDate: string | null;
  digitalAckEmail: string | null;
  digitalAckName: string | null;
  digitalAckAt: string | null;
}

interface PreCouncilPortalContext {
  boardId: string;
  year: number;
  trimester: 1 | 2 | 3;
  lockedConversationId: string | null;
  schoolName: string;
  classGroup: {
    id: string;
    name: string;
    segment: string;
    shift: string;
  };
  periodLabel: string;
  objectiveText: string;
  responsiblePedagogueName: string;
  responsiblePedagogueRole: string;
  conversations: PreCouncilPortalConversation[];
  synthesis: PreCouncilSynthesis;
}

interface ProfessorPreConselhoClientProps {
  token: string;
  schoolName: string;
  classNameLabel: string;
  segmentLabel: string;
  shiftLabel: string;
  year: number;
  trimester: CouncilTrimesterNumber;
  lockedSubjectName: string | null;
  googleClientId?: string;
  enableDevAuth?: boolean;
}

declare global {
  interface Window {
    google?: any;
  }
}

export default function ProfessorPreConselhoClient({
  token,
  schoolName,
  classNameLabel,
  segmentLabel,
  shiftLabel,
  year,
  trimester,
  lockedSubjectName,
  googleClientId,
  enableDevAuth = false,
}: ProfessorPreConselhoClientProps) {
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [preCouncil, setPreCouncil] = useState<PreCouncilPortalContext | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [devEmail, setDevEmail] = useState("docente.teste@escola.pr.gov.br");
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  const authenticateWithCredential = useCallback(
    async (credential: string) => {
      setAuthError(null);
      setAuthLoading(true);
      setSubmitFeedback(null);

      try {
        const res = await fetch(
          `/api/conselho-classe/pre-council-portal/${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ googleIdToken: credential }),
          }
        );
        const data: {
          success?: boolean;
          error?: string;
          verifiedEmail?: string;
          verifiedName?: string;
          suggestedConversationId?: string | null;
          preCouncil?: PreCouncilPortalContext;
        } = await res.json();

        if (!res.ok || !data.preCouncil || !data.verifiedEmail) {
          throw new Error(
            data.error || "Não foi possível validar sua conta @escola.pr.gov.br."
          );
        }

        setGoogleIdToken(credential);
        setVerifiedEmail(data.verifiedEmail);
        setVerifiedName(data.verifiedName || data.verifiedEmail);
        setPreCouncil(data.preCouncil);
        setSelectedConversationId(
          data.suggestedConversationId || data.preCouncil.conversations[0]?.id || ""
        );
      } catch (err: any) {
        setAuthError(err?.message || "Erro ao verificar conta institucional.");
        setGoogleIdToken(null);
        setVerifiedEmail(null);
        setVerifiedName(null);
        setPreCouncil(null);
      } finally {
        setAuthLoading(false);
      }
    },
    [token]
  );

  // Carrega Google Identity Services somente enquanto não houver docente autenticado
  useEffect(() => {
    if (!googleClientId || preCouncil) return;

    let isMounted = true;

    const initGsi = () => {
      if (typeof window === "undefined" || !window.google?.accounts?.id) return;
      try {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          hosted_domain: "escola.pr.gov.br",
          callback: async (response: any) => {
            if (!isMounted || !response?.credential) return;
            await authenticateWithCredential(response.credential);
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
      } catch {
        // Silencia erro de inicialização externa quando indisponível
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
  }, [googleClientId, preCouncil, authenticateWithCredential]);

  const selectedConversation = useMemo(() => {
    if (!preCouncil) return null;
    return (
      preCouncil.conversations.find((c) => c.id === selectedConversationId) ||
      preCouncil.conversations[0] ||
      null
    );
  }, [preCouncil, selectedConversationId]);

  const isClaimedByOtherTeacher = useMemo(() => {
    if (!selectedConversation?.teacherEmail || !verifiedEmail) return false;
    return (
      selectedConversation.teacherEmail.trim().toLowerCase() !==
      verifiedEmail.trim().toLowerCase()
    );
  }, [selectedConversation, verifiedEmail]);

  const isAckByOtherTeacher = useMemo(() => {
    if (!selectedConversation?.digitalAckEmail || !verifiedEmail) return false;
    return (
      selectedConversation.digitalAckEmail.trim().toLowerCase() !==
      verifiedEmail.trim().toLowerCase()
    );
  }, [selectedConversation, verifiedEmail]);

  const isAckByCurrentTeacher = useMemo(() => {
    if (!selectedConversation?.digitalAckEmail || !verifiedEmail) return false;
    return (
      selectedConversation.digitalAckEmail.trim().toLowerCase() ===
      verifiedEmail.trim().toLowerCase()
    );
  }, [selectedConversation, verifiedEmail]);

  async function handleConfirmAck() {
    if (
      !preCouncil ||
      !googleIdToken ||
      !selectedConversation ||
      isClaimedByOtherTeacher ||
      isAckByOtherTeacher
    ) {
      return;
    }

    setConfirming(true);
    setSubmitFeedback(null);

    try {
      const res = await fetch(
        `/api/conselho-classe/pre-council-portal/${encodeURIComponent(token)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken,
            conversationId: selectedConversation.id,
          }),
        }
      );
      const data: {
        success?: boolean;
        error?: string;
        ack?: {
          subjectName: string;
          digitalAckName: string;
          digitalAckEmail: string;
        };
        preCouncil?: PreCouncilPortalContext;
      } = await res.json();

      if (!res.ok || !data.preCouncil || !data.ack) {
        throw new Error(data.error || "Não foi possível registrar a ciência docente.");
      }

      setPreCouncil(data.preCouncil);
      setSubmitFeedback({
        type: "success",
        message: `Ciência registrada para ${data.ack.subjectName}.`,
      });
    } catch (err: any) {
      setSubmitFeedback({
        type: "error",
        message: err?.message || "Falha de conexão ao registrar ciência.",
      });
    } finally {
      setConfirming(false);
    }
  }

  function handleLogoutTeacher() {
    setGoogleIdToken(null);
    setVerifiedEmail(null);
    setVerifiedName(null);
    setPreCouncil(null);
    setSelectedConversationId("");
    setSubmitFeedback(null);
    setAuthError(null);
  }

  if (!preCouncil) {
    return (
      <div className="min-h-screen bg-slate-50 py-8 px-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
          <div className="text-center space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {schoolName}
            </p>
            <h1 className="text-lg font-black text-slate-900">
              Pré-Conselho de Classe — Ciência Docente
            </h1>
            <p className="text-xs font-semibold text-slate-700">
              {classNameLabel} • {segmentLabel} • {shiftLabel}
            </p>
            <p className="text-xs text-slate-500">
              {trimester}º Trimestre / {year}
              {lockedSubjectName ? ` • ${lockedSubjectName}` : ""}
            </p>
          </div>

          <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 space-y-3">
            <div className="flex items-start gap-2.5 text-xs text-sky-900">
              <ShieldCheck className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Entre com sua conta institucional{" "}
                <strong>@escola.pr.gov.br</strong> para consultar os registros do
                Pré-Conselho e confirmar sua ciência.
              </p>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <div className="space-y-2">
              {googleClientId ? (
                <div
                  ref={googleBtnContainerRef}
                  className="min-h-[42px] flex items-center justify-center"
                />
              ) : (
                <p className="text-[11px] text-slate-600 text-center">
                  Autenticação Google institucional indisponível neste ambiente.
                </p>
              )}

              {authLoading && (
                <p className="text-center text-xs text-sky-700 font-semibold">
                  Validando conta @escola.pr.gov.br...
                </p>
              )}
            </div>

            {enableDevAuth && (
              <div className="pt-3 border-t border-sky-200 space-y-2">
                <label
                  htmlFor="dev-pre-council-email"
                  className="block text-[11px] font-bold text-slate-700"
                >
                  Homologação local (@escola.pr.gov.br)
                </label>
                <div className="flex gap-2">
                  <input
                    id="dev-pre-council-email"
                    type="email"
                    value={devEmail}
                    onChange={(e) => setDevEmail(e.target.value)}
                    placeholder="professor@escola.pr.gov.br"
                    className="flex-1 min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    disabled={authLoading || !devEmail.trim()}
                    onClick={() =>
                      void authenticateWithCredential(
                        `dev-mock-token:${devEmail.trim().toLowerCase()}`
                      )
                    }
                    className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                  >
                    Entrar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const hasSynthesisContent = Boolean(
    preCouncil.synthesis.mainDifficulties ||
      preCouncil.synthesis.priorityStudents ||
      preCouncil.synthesis.attendanceIssues ||
      preCouncil.synthesis.behaviorIssues ||
      preCouncil.synthesis.pedagogicalActions
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {preCouncil.schoolName}
            </p>
            <h1 className="text-base font-black text-slate-900">
              Pré-Conselho • {preCouncil.classGroup.name} ({preCouncil.periodLabel} /{" "}
              {preCouncil.year})
            </h1>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
              <span className="font-bold block leading-tight">{verifiedName}</span>
              <span className="text-[10px] text-emerald-700">{verifiedEmail}</span>
            </div>
            <button
              type="button"
              onClick={handleLogoutTeacher}
              aria-label="Trocar conta institucional"
              className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Trocar conta</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {/* Objetivo */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5 shadow-2xs">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-600">
            Objetivo
          </h2>
          <p className="text-xs text-slate-700 leading-relaxed">{preCouncil.objectiveText}</p>
        </section>

        {/* Seleção e Detalhes do Componente */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-2xs">
          <div className="space-y-1">
            <label
              htmlFor="pre-council-portal-subject"
              className="block text-xs font-bold text-slate-700"
            >
              Componente Curricular
            </label>
            {preCouncil.lockedConversationId ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-extrabold text-slate-900">
                {selectedConversation?.subjectName || lockedSubjectName}
              </div>
            ) : (
              <select
                id="pre-council-portal-subject"
                value={selectedConversation?.id || ""}
                onChange={(e) => {
                  setSelectedConversationId(e.target.value);
                  setSubmitFeedback(null);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
              >
                {preCouncil.conversations.map((conv) => (
                  <option key={conv.id} value={conv.id}>
                    {conv.subjectName}
                    {conv.teacherName ? ` (${conv.teacherName})` : ""}
                    {conv.digitalAckEmail ? " — Ciência registrada" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedConversation && (
            <div className="space-y-3 pt-2 border-t border-slate-100 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="font-bold text-slate-500 block text-[10px] uppercase">
                    Docente
                  </span>
                  <span className="font-semibold">
                    {selectedConversation.teacherName || "Não informado"}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block text-[10px] uppercase">
                    Data da conversa
                  </span>
                  <span className="font-semibold">
                    {formatPreCouncilDatePtBr(selectedConversation.conversationDate) || "Não informada"}
                  </span>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Estudantes em acompanhamento
                </span>
                {selectedConversation.monitoredStudents.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedConversation.monitoredStudents.map((st) => (
                      <span
                        key={st.studentId}
                        className="px-2.5 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-900 font-semibold"
                      >
                        {st.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500">Nenhum estudante listado para este componente.</p>
                )}
                {selectedConversation.monitoredStudentsNotes && (
                  <p className="mt-2 whitespace-pre-line text-slate-700 bg-slate-50 rounded-xl p-2.5 border border-slate-200">
                    {selectedConversation.monitoredStudentsNotes}
                  </p>
                )}
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Combinados / Encaminhamentos
                </span>
                <p className="whitespace-pre-line text-slate-700 bg-slate-50 rounded-xl p-2.5 border border-slate-200">
                  {selectedConversation.agreements || "Nenhum combinado registrado."}
                </p>
              </div>
            </div>
          )}

          {(isClaimedByOtherTeacher || isAckByOtherTeacher) && selectedConversation && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 font-semibold">
              {isAckByOtherTeacher
                ? `A ciência deste componente já foi confirmada por ${
                    selectedConversation.digitalAckName || selectedConversation.digitalAckEmail
                  }.`
                : `Este componente está vinculado a ${
                    selectedConversation.teacherName || selectedConversation.teacherEmail
                  }. Solicite ajuste à coordenação pedagógica se necessário.`}
            </div>
          )}
        </section>

        {/* Síntese da Turma (Somente Leitura) */}
        {hasSynthesisContent && (
          <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5 shadow-2xs text-xs">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">
              Síntese do Pré-Conselho da Turma
            </h2>
            {preCouncil.synthesis.mainDifficulties && (
              <div>
                <strong className="text-slate-800 block">
                  Principais dificuldades identificadas na turma:
                </strong>
                <p className="whitespace-pre-line text-slate-700">
                  {preCouncil.synthesis.mainDifficulties}
                </p>
              </div>
            )}
            {preCouncil.synthesis.priorityStudents && (
              <div>
                <strong className="text-slate-800 block">
                  Estudantes que necessitam de maior acompanhamento pedagógico:
                </strong>
                <p className="whitespace-pre-line text-slate-700">
                  {preCouncil.synthesis.priorityStudents}
                </p>
              </div>
            )}
            {preCouncil.synthesis.attendanceIssues && (
              <div>
                <strong className="text-slate-800 block">
                  Questões relacionadas à frequência:
                </strong>
                <p className="whitespace-pre-line text-slate-700">
                  {preCouncil.synthesis.attendanceIssues}
                </p>
              </div>
            )}
            {preCouncil.synthesis.behaviorIssues && (
              <div>
                <strong className="text-slate-800 block">
                  Questões relacionadas ao comportamento/convivência:
                </strong>
                <p className="whitespace-pre-line text-slate-700">
                  {preCouncil.synthesis.behaviorIssues}
                </p>
              </div>
            )}
            {preCouncil.synthesis.pedagogicalActions && (
              <div>
                <strong className="text-slate-800 block">
                  Encaminhamentos sob responsabilidade da equipe pedagógica:
                </strong>
                <p className="whitespace-pre-line text-slate-700">
                  {preCouncil.synthesis.pedagogicalActions}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Registro de Ciência */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs text-xs">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">
            Registro de Ciência Docente
          </h2>
          <p className="text-slate-600 leading-relaxed">{DEFAULT_PRE_COUNCIL_ACK_STATEMENT}</p>

          {isAckByCurrentTeacher && selectedConversation && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2 text-emerald-900 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div>Ciência confirmada por {selectedConversation.digitalAckName}</div>
                <div className="text-[11px] text-emerald-800 font-normal">
                  {selectedConversation.digitalAckEmail}
                  {selectedConversation.digitalAckAt
                    ? ` • ${formatPreCouncilDateTimePtBr(selectedConversation.digitalAckAt)}`
                    : ""}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Rodapé Fixo */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            {submitFeedback && (
              <p
                role="status"
                aria-live="polite"
                className={`text-xs font-bold flex items-center gap-1.5 ${
                  submitFeedback.type === "success" ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {submitFeedback.type === "success" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{submitFeedback.message}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={
              confirming ||
              !selectedConversation ||
              isClaimedByOtherTeacher ||
              isAckByOtherTeacher
            }
            onClick={() => void handleConfirmAck()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-extrabold transition cursor-pointer"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>
              {confirming
                ? "Confirmando..."
                : isAckByCurrentTeacher
                  ? "Atualizar ciência"
                  : "Confirmar ciência"}
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}
