"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  LogOut,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  COUNCIL_DESCRIPTORS,
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  formatCouncilGradePtBr,
  getStudentInitials,
  isBelowAverageGradeUi,
  type CouncilEnrollmentStatus,
  type CouncilTrimesterNumber,
} from "@/components/conselho/types";

export interface TeacherPortalSubjectOption {
  id: string;
  name: string;
  teacherName: string | null;
  teacherEmail: string | null;
  displayOrder: number;
}

export interface TeacherPortalStudentItem {
  studentId: string;
  name: string;
  cgm: string | null;
  enrollmentStatus: string;
  attendancePercent: number | null;
  subjectEntries: Array<{
    subjectId: string;
    descriptorCodes: number[];
    grade: number | null;
    updatedByEmail: string | null;
  }>;
}

export interface TeacherPortalCouncilContext {
  boardId: string;
  year: number;
  trimester: 1 | 2 | 3;
  lockedSubjectId: string | null;
  schoolName: string;
  classGroup: {
    id: string;
    name: string;
    segment: string;
    shift: string;
  };
  trimesterStatus: string;
  subjects: TeacherPortalSubjectOption[];
  students: TeacherPortalStudentItem[];
}

interface ProfessorConselhoClientProps {
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

type DraftMapBySubject = Record<string, Record<string, number[]>>;
type PortalFilterMode = "ALL" | "PENDING" | "BELOW_AVG";

function buildInitialDrafts(council: TeacherPortalCouncilContext): DraftMapBySubject {
  const map: DraftMapBySubject = {};
  for (const subj of council.subjects) {
    const perStudent: Record<string, number[]> = {};
    for (const st of council.students) {
      const entry = st.subjectEntries.find((e) => e.subjectId === subj.id);
      perStudent[st.studentId] = entry ? [...entry.descriptorCodes] : [];
    }
    map[subj.id] = perStudent;
  }
  return map;
}

export default function ProfessorConselhoClient({
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
}: ProfessorConselhoClientProps) {
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [council, setCouncil] = useState<TeacherPortalCouncilContext | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [drafts, setDrafts] = useState<DraftMapBySubject>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<PortalFilterMode>("ALL");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
          `/api/conselho-classe/teacher-portal/${encodeURIComponent(token)}`,
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
          suggestedSubjectId?: string | null;
          council?: TeacherPortalCouncilContext;
        } = await res.json();

        if (!res.ok || !data.council || !data.verifiedEmail) {
          throw new Error(
            data.error || "Não foi possível validar sua conta @escola.pr.gov.br."
          );
        }

        setGoogleIdToken(credential);
        setVerifiedEmail(data.verifiedEmail);
        setVerifiedName(data.verifiedName || data.verifiedEmail);
        setCouncil(data.council);
        setDrafts(buildInitialDrafts(data.council));
        setSelectedSubjectId(
          data.suggestedSubjectId || data.council.subjects[0]?.id || ""
        );
      } catch (err: any) {
        setAuthError(err?.message || "Erro ao verificar conta institucional.");
        setGoogleIdToken(null);
        setVerifiedEmail(null);
        setVerifiedName(null);
        setCouncil(null);
      } finally {
        setAuthLoading(false);
      }
    },
    [token]
  );

  // Carrega Google Identity Services somente enquanto não houver docente autenticado
  useEffect(() => {
    if (!googleClientId || council) return;

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
  }, [googleClientId, council, authenticateWithCredential]);

  const selectedSubject = useMemo(() => {
    if (!council) return null;
    return council.subjects.find((s) => s.id === selectedSubjectId) || null;
  }, [council, selectedSubjectId]);

  const isClaimedByOtherTeacher = useMemo(() => {
    if (!selectedSubject?.teacherEmail || !verifiedEmail) return false;
    return (
      selectedSubject.teacherEmail.trim().toLowerCase() !==
      verifiedEmail.trim().toLowerCase()
    );
  }, [selectedSubject, verifiedEmail]);

  const currentDraftMap = useMemo(() => {
    if (!selectedSubjectId) return {};
    return drafts[selectedSubjectId] || {};
  }, [drafts, selectedSubjectId]);

  const activeStudents = useMemo(() => {
    if (!council) return [];
    const ativos = council.students.filter((s) => s.enrollmentStatus === "ATIVO");
    return ativos.length > 0 ? ativos : council.students;
  }, [council]);

  const evaluatedCount = useMemo(() => {
    return activeStudents.reduce((acc, st) => {
      const codes = currentDraftMap[st.studentId] || [];
      return codes.length > 0 ? acc + 1 : acc;
    }, 0);
  }, [activeStudents, currentDraftMap]);

  const filteredStudents = useMemo(() => {
    if (!council) return [];
    const q = searchTerm.trim().toLowerCase();
    return council.students.filter((st) => {
      if (q) {
        const matchName = st.name.toLowerCase().includes(q);
        const matchCgm = (st.cgm || "").toLowerCase().includes(q);
        if (!matchName && !matchCgm) return false;
      }

      if (filterMode === "PENDING") {
        return (currentDraftMap[st.studentId] || []).length === 0;
      }

      if (filterMode === "BELOW_AVG") {
        const entry = st.subjectEntries.find((e) => e.subjectId === selectedSubjectId);
        return isBelowAverageGradeUi(entry?.grade ?? null);
      }

      return true;
    });
  }, [council, searchTerm, filterMode, currentDraftMap, selectedSubjectId]);

  function handleToggleDescriptor(studentId: string, code: number) {
    if (!selectedSubjectId || isClaimedByOtherTeacher) return;
    setSubmitFeedback(null);
    setDrafts((prev) => {
      const subjectDrafts = { ...(prev[selectedSubjectId] || {}) };
      const current = subjectDrafts[studentId] || [];
      const exists = current.includes(code);
      const next = exists
        ? current.filter((c) => c !== code)
        : [...current, code].sort((a, b) => a - b);
      subjectDrafts[studentId] = next;
      return {
        ...prev,
        [selectedSubjectId]: subjectDrafts,
      };
    });
  }

  function handleFillEmptyWithAtende() {
    if (!council || !selectedSubjectId || isClaimedByOtherTeacher) return;
    setSubmitFeedback(null);
    setDrafts((prev) => {
      const subjectDrafts = { ...(prev[selectedSubjectId] || {}) };
      for (const st of council.students) {
        if (st.enrollmentStatus !== "ATIVO") continue;
        const current = subjectDrafts[st.studentId] || [];
        if (current.length === 0) {
          subjectDrafts[st.studentId] = [1];
        }
      }
      return {
        ...prev,
        [selectedSubjectId]: subjectDrafts,
      };
    });
  }

  async function handleSubmitComponent() {
    if (
      !council ||
      !googleIdToken ||
      !selectedSubjectId ||
      isClaimedByOtherTeacher ||
      council.students.length === 0
    ) {
      return;
    }

    setSubmitting(true);
    setSubmitFeedback(null);

    try {
      const entries = council.students.map((st) => ({
        studentId: st.studentId,
        descriptorCodes: currentDraftMap[st.studentId] || [],
      }));

      const res = await fetch(
        `/api/conselho-classe/teacher-portal/${encodeURIComponent(token)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken,
            subjectId: selectedSubjectId,
            entries,
          }),
        }
      );

      const data: {
        success?: boolean;
        error?: string;
        result?: {
          updatedCount: number;
          subjectId: string;
          subjectName: string;
        };
        council?: TeacherPortalCouncilContext;
      } = await res.json();

      if (!res.ok || !data.council || !data.result) {
        throw new Error(
          data.error || "Não foi possível enviar a avaliação do componente."
        );
      }

      setCouncil(data.council);
      setDrafts((prev) => {
        const refreshed = buildInitialDrafts(data.council!);
        return {
          ...prev,
          [data.result!.subjectId]: refreshed[data.result!.subjectId] || {},
        };
      });
      setSubmitFeedback({
        type: "success",
        message: `Avaliação de ${data.result.subjectName} enviada (${data.result.updatedCount} estudantes).`,
      });
    } catch (err: any) {
      setSubmitFeedback({
        type: "error",
        message: err?.message || "Falha de conexão ao enviar avaliação.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogoutTeacher() {
    setGoogleIdToken(null);
    setVerifiedEmail(null);
    setVerifiedName(null);
    setCouncil(null);
    setDrafts({});
    setSubmitFeedback(null);
    setAuthError(null);
  }

  // Etapa 1: Identificação Docente @escola.pr.gov.br
  if (!council) {
    return (
      <div className="min-h-screen bg-slate-50 py-8 px-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
          <div className="text-center space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {schoolName}
            </p>
            <h1 className="text-lg font-black text-slate-900">
              Conselho de Classe — Lançamento Docente
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
                <strong>@escola.pr.gov.br</strong> para preencher as tags do seu
                componente curricular.
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
                  htmlFor="dev-teacher-email"
                  className="block text-[11px] font-bold text-slate-700"
                >
                  Homologação local (@escola.pr.gov.br)
                </label>
                <div className="flex gap-2">
                  <input
                    id="dev-teacher-email"
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

  // Etapa 2: Lançamento vertical limpo por componente curricular
  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {council.schoolName}
            </p>
            <h1 className="text-base font-black text-slate-900">
              {council.classGroup.name} • {council.trimester}º Trimestre / {council.year}
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

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {/* Seleção de Componente + Legenda */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-2xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div className="space-y-1">
              <label
                htmlFor="teacher-portal-subject"
                className="block text-xs font-bold text-slate-700"
              >
                Componente Curricular
              </label>
              {council.lockedSubjectId ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-extrabold text-slate-900">
                  {selectedSubject?.name || lockedSubjectName}
                </div>
              ) : (
                <select
                  id="teacher-portal-subject"
                  aria-label="Selecionar componente curricular"
                  value={selectedSubjectId}
                  onChange={(e) => {
                    setSelectedSubjectId(e.target.value);
                    setSubmitFeedback(null);
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                >
                  {council.subjects.map((subj) => {
                    const claimedOther =
                      Boolean(subj.teacherEmail) &&
                      subj.teacherEmail!.trim().toLowerCase() !==
                        (verifiedEmail || "").trim().toLowerCase();
                    return (
                      <option key={subj.id} value={subj.id}>
                        {subj.name}
                        {subj.teacherName ? ` (${subj.teacherName})` : ""}
                        {claimedOther ? " — vinculado a outro docente" : ""}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-start md:justify-end gap-2">
              <button
                type="button"
                disabled={isClaimedByOtherTeacher || !selectedSubject}
                onClick={handleFillEmptyWithAtende}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 disabled:opacity-50 text-emerald-900 text-xs font-bold transition cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Preencher vazios: Atende</span>
              </button>
            </div>
          </div>

          {isClaimedByOtherTeacher && selectedSubject && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 font-semibold">
              Este componente curricular está vinculado a{" "}
              {selectedSubject.teacherName || selectedSubject.teacherEmail}. Selecione o seu
              componente ou solicite ajuste à coordenação pedagógica.
            </div>
          )}

          {/* Legenda das Tags */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            {COUNCIL_DESCRIPTORS.map((d) => (
              <span
                key={d.code}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold ${d.badgeClass}`}
              >
                <strong className="font-black">{d.shortLabel}</strong>
                {d.shortLabel !== d.fullLabel && <span>— {d.fullLabel}</span>}
              </span>
            ))}
          </div>

          {/* Busca e Filtro */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Buscar estudante na turma"
                placeholder="Buscar por estudante ou matrícula..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900"
              />
            </div>

            <select
              aria-label="Filtrar estudantes"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as PortalFilterMode)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
            >
              <option value="ALL">Todos ({council.students.length})</option>
              <option value="PENDING">Sem tag marcada</option>
              <option value="BELOW_AVG">Abaixo da média no componente</option>
            </select>
          </div>
        </section>

        {/* Lista Vertical de Estudantes */}
        <section aria-label="Lista de estudantes para avaliação" className="space-y-2.5">
          {filteredStudents.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">
              Nenhum estudante encontrado para o filtro selecionado.
            </div>
          ) : (
            filteredStudents.map((st) => {
              const entry = st.subjectEntries.find(
                (e) => e.subjectId === selectedSubjectId
              );
              const formattedGrade = formatCouncilGradePtBr(entry?.grade ?? null);
              const gradeIsBelow = isBelowAverageGradeUi(entry?.grade ?? null);
              const selectedCodes = currentDraftMap[st.studentId] || [];

              return (
                <article
                  key={st.studentId}
                  className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        aria-hidden="true"
                        className="w-8 h-8 rounded-xl bg-sky-100 text-sky-800 font-extrabold text-xs flex items-center justify-center shrink-0"
                      >
                        {getStudentInitials(st.name)}
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900 truncate">
                          {st.name}
                        </h2>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          {st.cgm && <span>CGM {st.cgm}</span>}
                          {st.enrollmentStatus !== "ATIVO" && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-bold">
                              {COUNCIL_ENROLLMENT_STATUS_LABELS[
                                st.enrollmentStatus as CouncilEnrollmentStatus
                              ] || st.enrollmentStatus}
                            </span>
                          )}
                          {st.attendancePercent !== null && (
                            <span
                              className={`px-1.5 py-0.5 rounded font-bold ${
                                st.attendancePercent < 75
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              Freq. {st.attendancePercent.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {formattedGrade !== null && (
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-bold self-start sm:self-auto ${
                          gradeIsBelow
                            ? "border-rose-300 bg-rose-50 text-rose-800"
                            : "border-slate-200 bg-slate-100 text-slate-700"
                        }`}
                      >
                        {gradeIsBelow
                          ? `Nota ${formattedGrade} • Abaixo da média`
                          : `Nota ${formattedGrade}`}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {COUNCIL_DESCRIPTORS.map((d) => {
                      const selected = selectedCodes.includes(d.code);
                      return (
                        <button
                          key={d.code}
                          type="button"
                          disabled={isClaimedByOtherTeacher}
                          aria-pressed={selected}
                          aria-label={`${st.name} — ${d.shortLabel}: ${d.fullLabel}`}
                          title={d.fullLabel}
                          onClick={() => handleToggleDescriptor(st.studentId, d.code)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                            selected
                              ? d.activeClass
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {d.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </main>

      {/* Barra Fixa de Envio */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-slate-800">
              {evaluatedCount}/{activeStudents.length} estudantes avaliados
            </p>
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
              submitting ||
              isClaimedByOtherTeacher ||
              !selectedSubject ||
              council.students.length === 0
            }
            onClick={() => void handleSubmitComponent()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-extrabold transition cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {submitting ? "Enviando..." : "Enviar avaliação do componente"}
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}
