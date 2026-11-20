"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  LogOut,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  COUNCIL_DESCRIPTORS,
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  formatCouncilGradePtBr,
  getStudentInitials,
  isBelowAverageGradeUi,
  type CouncilEnrollmentStatus,
  type CouncilTrimesterNumber,
  type PreCouncilSynthesis,
} from "@/components/conselho/types";
import {
  buildLiveAlertsFromDraft,
  clearTeacherPortalLocalDraft,
  DEFAULT_PRE_COUNCIL_ACK_STATEMENT,
  formatPreCouncilDatePtBr,
  formatPreCouncilDateTimePtBr,
  loadTeacherPortalLocalDraft,
  saveTeacherPortalLocalDraft,
} from "@/components/conselho/preCouncilUtils";

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

export interface TeacherPortalPreCouncilConversationSummary {
  id: string;
  subjectId: string | null;
  subjectName: string;
  teacherName: string;
  teacherEmail: string | null;
  monitoredStudentIds: string[];
  monitoredStudentsNotes: string;
  agreements: string;
  conversationStatus: "PENDING" | "COMPLETED";
  conversationDate: string | null;
  teacherSubmittedAt: string | null;
  digitalAckEmail: string | null;
  digitalAckName: string | null;
  digitalAckAt: string | null;
  canConfirmAck: boolean;
}

export interface TeacherPortalPreCouncilSummary {
  periodLabel: string;
  objectiveText: string;
  responsiblePedagogueName: string;
  responsiblePedagogueRole: string;
  synthesis: PreCouncilSynthesis;
  conversationsBySubjectId: Record<string, TeacherPortalPreCouncilConversationSummary>;
}

export interface TeacherPortalCouncilContext {
  boardId: string;
  year: number;
  trimester: 1 | 2 | 3;
  lockedSubjectId: string | null;
  lockedConversationId?: string | null;
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
  preCouncil?: TeacherPortalPreCouncilSummary;
}

export interface TeacherPortalPreloadedSession {
  googleIdToken: string;
  verifiedEmail: string;
  verifiedName: string;
  council: TeacherPortalCouncilContext;
  suggestedSubjectId?: string | null;
  onLogout?: () => void;
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
  portalApiBase?: string;
  preloadedSession?: TeacherPortalPreloadedSession;
}

declare global {
  interface Window {
    google?: any;
  }
}

type DraftMapBySubject = Record<string, Record<string, number[]>>;
type MonitoredIdsBySubject = Record<string, string[]>;
type MonitoredNotesBySubject = Record<string, string>;
type PortalFilterMode = "ALL" | "PENDING" | "BELOW_AVG";
type PortalStepKey = "matrix" | "pre-council" | "ack";

const SYNTHESIS_VIEW_FIELDS: Array<{ key: keyof PreCouncilSynthesis; label: string }> = [
  { key: "mainDifficulties", label: "Principais dificuldades observadas" },
  { key: "priorityStudents", label: "Estudantes prioritários" },
  { key: "attendanceIssues", label: "Questões de frequência" },
  { key: "behaviorIssues", label: "Postura e convivência" },
  { key: "pedagogicalActions", label: "Encaminhamentos pedagógicos" },
];

function resolveSuggestedSubjectId(
  council: TeacherPortalCouncilContext | null | undefined,
  suggestedSubjectId?: string | null
): string {
  if (!council) return "";
  return council.lockedSubjectId || suggestedSubjectId || council.subjects[0]?.id || "";
}

function buildSubjectBaselineDescriptors(
  council: TeacherPortalCouncilContext,
  subjectId: string
): Record<string, number[]> {
  const perStudent: Record<string, number[]> = {};
  for (const st of council.students) {
    const entry = st.subjectEntries.find((e) => e.subjectId === subjectId);
    perStudent[st.studentId] = entry ? [...entry.descriptorCodes].sort((a, b) => a - b) : [];
  }
  return perStudent;
}

function buildInitialDrafts(council: TeacherPortalCouncilContext): DraftMapBySubject {
  const map: DraftMapBySubject = {};
  for (const subj of council.subjects) {
    map[subj.id] = buildSubjectBaselineDescriptors(council, subj.id);
  }
  return map;
}

function buildInitialMonitoredIds(council: TeacherPortalCouncilContext): MonitoredIdsBySubject {
  const map: MonitoredIdsBySubject = {};
  const convMap = council.preCouncil?.conversationsBySubjectId || {};
  for (const subj of council.subjects) {
    map[subj.id] = Array.from(new Set(convMap[subj.id]?.monitoredStudentIds || []));
  }
  return map;
}

function buildInitialMonitoredNotes(council: TeacherPortalCouncilContext): MonitoredNotesBySubject {
  const map: MonitoredNotesBySubject = {};
  const convMap = council.preCouncil?.conversationsBySubjectId || {};
  for (const subj of council.subjects) {
    map[subj.id] = convMap[subj.id]?.monitoredStudentsNotes || "";
  }
  return map;
}

function areDescriptorMapsEqual(
  a: Record<string, number[]>,
  b: Record<string, number[]>,
  students: TeacherPortalStudentItem[]
): boolean {
  for (const st of students) {
    const codesA = [...(a[st.studentId] || [])].sort((x, y) => x - y);
    const codesB = [...(b[st.studentId] || [])].sort((x, y) => x - y);
    if (codesA.length !== codesB.length) return false;
    for (let i = 0; i < codesA.length; i++) {
      if (codesA[i] !== codesB[i]) return false;
    }
  }
  return true;
}

function areStringSetsEqual(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}

function isSubjectDraftDirty(params: {
  council: TeacherPortalCouncilContext;
  subjectId: string;
  draftMap: Record<string, number[]>;
  monitoredIds: string[];
  monitoredNotes: string;
}): boolean {
  const { council, subjectId, draftMap, monitoredIds, monitoredNotes } = params;
  const baselineDescriptors = buildSubjectBaselineDescriptors(council, subjectId);
  if (!areDescriptorMapsEqual(draftMap, baselineDescriptors, council.students)) {
    return true;
  }
  const conv = council.preCouncil?.conversationsBySubjectId?.[subjectId];
  const baselineMonitored = conv?.monitoredStudentIds || [];
  if (!areStringSetsEqual(monitoredIds, baselineMonitored)) {
    return true;
  }
  const baselineNotes = (conv?.monitoredStudentsNotes || "").trim();
  return monitoredNotes.trim() !== baselineNotes;
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
  portalApiBase = "/api/conselho-classe/teacher-portal",
  preloadedSession,
}: ProfessorConselhoClientProps) {
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(
    () => preloadedSession?.googleIdToken ?? null
  );
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(
    () => preloadedSession?.verifiedEmail ?? null
  );
  const [verifiedName, setVerifiedName] = useState<string | null>(
    () => preloadedSession?.verifiedName ?? null
  );
  const [council, setCouncil] = useState<TeacherPortalCouncilContext | null>(
    () => preloadedSession?.council ?? null
  );
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(() =>
    resolveSuggestedSubjectId(preloadedSession?.council, preloadedSession?.suggestedSubjectId)
  );
  const [drafts, setDrafts] = useState<DraftMapBySubject>(() =>
    preloadedSession?.council ? buildInitialDrafts(preloadedSession.council) : {}
  );
  const [monitoredIdsBySubject, setMonitoredIdsBySubject] = useState<MonitoredIdsBySubject>(() =>
    preloadedSession?.council ? buildInitialMonitoredIds(preloadedSession.council) : {}
  );
  const [monitoredNotesBySubject, setMonitoredNotesBySubject] = useState<MonitoredNotesBySubject>(
    () => (preloadedSession?.council ? buildInitialMonitoredNotes(preloadedSession.council) : {})
  );
  const [activeStep, setActiveStep] = useState<PortalStepKey>("matrix");
  const [searchTerm, setSearchTerm] = useState("");
  const [monitoredSearchTerm, setMonitoredSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<PortalFilterMode>("ALL");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingAckRelease, setCheckingAckRelease] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [restoredDraftInfo, setRestoredDraftInfo] = useState<{
    subjectId: string;
    savedAt: string;
  } | null>(null);
  const [devEmail, setDevEmail] = useState("docente.teste@escola.pr.gov.br");
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);
  const checkedDraftKeysRef = useRef<Set<string>>(new Set());

  const authenticateWithCredential = useCallback(
    async (credential: string) => {
      setAuthError(null);
      setAuthLoading(true);
      setSubmitFeedback(null);

      try {
        const res = await fetch(`${portalApiBase}/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: credential }),
        });
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

        checkedDraftKeysRef.current.clear();
        setRestoredDraftInfo(null);
        setGoogleIdToken(credential);
        setVerifiedEmail(data.verifiedEmail);
        setVerifiedName(data.verifiedName || data.verifiedEmail);
        setCouncil(data.council);
        setDrafts(buildInitialDrafts(data.council));
        setMonitoredIdsBySubject(buildInitialMonitoredIds(data.council));
        setMonitoredNotesBySubject(buildInitialMonitoredNotes(data.council));
        setSelectedSubjectId(resolveSuggestedSubjectId(data.council, data.suggestedSubjectId));
        setActiveStep("matrix");
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
    [portalApiBase, token]
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

  const selectedConv = useMemo<TeacherPortalPreCouncilConversationSummary | null>(() => {
    if (!council || !selectedSubjectId) return null;
    return council.preCouncil?.conversationsBySubjectId?.[selectedSubjectId] || null;
  }, [council, selectedSubjectId]);

  const currentDraftMap = useMemo(() => {
    if (!selectedSubjectId) return {};
    return drafts[selectedSubjectId] || {};
  }, [drafts, selectedSubjectId]);

  const currentMonitoredIds = useMemo(() => {
    if (!selectedSubjectId) return [];
    return monitoredIdsBySubject[selectedSubjectId] || [];
  }, [monitoredIdsBySubject, selectedSubjectId]);

  const currentMonitoredNotes = useMemo(() => {
    if (!selectedSubjectId) return "";
    return monitoredNotesBySubject[selectedSubjectId] || "";
  }, [monitoredNotesBySubject, selectedSubjectId]);

  const isCurrentSubjectDirty = useMemo(() => {
    if (!council || !selectedSubjectId || isClaimedByOtherTeacher) return false;
    return isSubjectDraftDirty({
      council,
      subjectId: selectedSubjectId,
      draftMap: currentDraftMap,
      monitoredIds: currentMonitoredIds,
      monitoredNotes: currentMonitoredNotes,
    });
  }, [
    council,
    selectedSubjectId,
    isClaimedByOtherTeacher,
    currentDraftMap,
    currentMonitoredIds,
    currentMonitoredNotes,
  ]);

  const hasAnyUnsavedChanges = useMemo(() => {
    if (!council || !verifiedEmail) return false;
    const cleanVerified = verifiedEmail.trim().toLowerCase();
    return council.subjects.some((subj) => {
      const subjEmail = (subj.teacherEmail || "").trim().toLowerCase();
      if (subjEmail && subjEmail !== cleanVerified) return false;
      return isSubjectDraftDirty({
        council,
        subjectId: subj.id,
        draftMap: drafts[subj.id] || {},
        monitoredIds: monitoredIdsBySubject[subj.id] || [],
        monitoredNotes: monitoredNotesBySubject[subj.id] || "",
      });
    });
  }, [council, verifiedEmail, drafts, monitoredIdsBySubject, monitoredNotesBySubject]);

  const currentDraftSessionKey = useMemo(() => {
    if (!council || !selectedSubjectId || !verifiedEmail) return "";
    return `${council.boardId}:${council.trimester}:${selectedSubjectId}:${verifiedEmail.trim().toLowerCase()}`;
  }, [council, selectedSubjectId, verifiedEmail]);

  // Restaura eventual rascunho local salvo no navegador (nunca salva credenciais)
  useEffect(() => {
    if (
      !council ||
      !selectedSubjectId ||
      !verifiedEmail ||
      !currentDraftSessionKey ||
      isClaimedByOtherTeacher
    ) {
      return;
    }
    if (checkedDraftKeysRef.current.has(currentDraftSessionKey)) return;
    checkedDraftKeysRef.current.add(currentDraftSessionKey);

    const saved = loadTeacherPortalLocalDraft(
      council.boardId,
      council.trimester,
      selectedSubjectId,
      verifiedEmail
    );
    if (!saved) return;

    const validStudentIds = new Set(council.students.map((st) => st.studentId));
    const baselineDescriptors = buildSubjectBaselineDescriptors(council, selectedSubjectId);
    const hydratedDescriptors: Record<string, number[]> = {};
    for (const st of council.students) {
      hydratedDescriptors[st.studentId] = saved.descriptorByStudentId[st.studentId]
        ? [...saved.descriptorByStudentId[st.studentId]]
        : [...(baselineDescriptors[st.studentId] || [])];
    }
    const hydratedMonitoredIds = saved.monitoredStudentIds.filter((id) => validStudentIds.has(id));
    const hydratedNotes = saved.monitoredStudentsNotes;

    const differsFromServer = isSubjectDraftDirty({
      council,
      subjectId: selectedSubjectId,
      draftMap: hydratedDescriptors,
      monitoredIds: hydratedMonitoredIds,
      monitoredNotes: hydratedNotes,
    });

    if (!differsFromServer) {
      clearTeacherPortalLocalDraft(
        council.boardId,
        council.trimester,
        selectedSubjectId,
        verifiedEmail
      );
      return;
    }

    setDrafts((prev) => ({
      ...prev,
      [selectedSubjectId]: hydratedDescriptors,
    }));
    setMonitoredIdsBySubject((prev) => ({
      ...prev,
      [selectedSubjectId]: hydratedMonitoredIds,
    }));
    setMonitoredNotesBySubject((prev) => ({
      ...prev,
      [selectedSubjectId]: hydratedNotes,
    }));
    setRestoredDraftInfo({
      subjectId: selectedSubjectId,
      savedAt: saved.savedAt,
    });
  }, [council, selectedSubjectId, verifiedEmail, currentDraftSessionKey, isClaimedByOtherTeacher]);

  // Persiste alterações não enviadas automaticamente em localStorage
  useEffect(() => {
    if (
      !council ||
      !selectedSubjectId ||
      !verifiedEmail ||
      !currentDraftSessionKey ||
      isClaimedByOtherTeacher
    ) {
      return;
    }
    if (!checkedDraftKeysRef.current.has(currentDraftSessionKey)) return;

    if (isCurrentSubjectDirty) {
      saveTeacherPortalLocalDraft(
        council.boardId,
        council.trimester,
        selectedSubjectId,
        verifiedEmail,
        {
          descriptorByStudentId: currentDraftMap,
          monitoredStudentIds: currentMonitoredIds,
          monitoredStudentsNotes: currentMonitoredNotes,
        }
      );
    } else {
      clearTeacherPortalLocalDraft(
        council.boardId,
        council.trimester,
        selectedSubjectId,
        verifiedEmail
      );
    }
  }, [
    council,
    selectedSubjectId,
    verifiedEmail,
    currentDraftSessionKey,
    isClaimedByOtherTeacher,
    isCurrentSubjectDirty,
    currentDraftMap,
    currentMonitoredIds,
    currentMonitoredNotes,
  ]);

  // Alerta o docente ao tentar fechar/sair com dados ainda não enviados ao conselho
  useEffect(() => {
    if (!hasAnyUnsavedChanges || typeof window === "undefined") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasAnyUnsavedChanges]);

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

  const liveAlerts = useMemo(() => {
    if (!council || !selectedSubjectId) return [];
    return buildLiveAlertsFromDraft({
      students: council.students.map((st) => {
        const entry = st.subjectEntries.find((e) => e.subjectId === selectedSubjectId);
        return {
          studentId: st.studentId,
          name: st.name,
          enrollmentStatus: st.enrollmentStatus,
          attendancePercent: st.attendancePercent,
          grade: entry?.grade ?? null,
        };
      }),
      descriptorCodesByStudentId: currentDraftMap,
    });
  }, [council, selectedSubjectId, currentDraftMap]);

  const monitoredSet = useMemo(() => new Set(currentMonitoredIds), [currentMonitoredIds]);

  const pendingAlertStudentIds = useMemo(
    () => liveAlerts.filter((a) => !monitoredSet.has(a.studentId)).map((a) => a.studentId),
    [liveAlerts, monitoredSet]
  );

  const filteredAllStudentsForMonitoring = useMemo(() => {
    if (!council) return [];
    const q = monitoredSearchTerm.trim().toLowerCase();
    return activeStudents.filter((st) => (!q ? true : st.name.toLowerCase().includes(q)));
  }, [council, activeStudents, monitoredSearchTerm]);

  const studentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const st of council?.students || []) {
      map.set(st.studentId, st.name);
    }
    return map;
  }, [council]);

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

  function handleToggleMonitoredStudent(studentId: string) {
    if (!selectedSubjectId || isClaimedByOtherTeacher) return;
    setSubmitFeedback(null);
    setMonitoredIdsBySubject((prev) => {
      const current = prev[selectedSubjectId] || [];
      const exists = current.includes(studentId);
      const next = exists
        ? current.filter((id) => id !== studentId)
        : [...current, studentId];
      return {
        ...prev,
        [selectedSubjectId]: next,
      };
    });
  }

  function handleIncludeAllLiveAlerts() {
    if (!selectedSubjectId || isClaimedByOtherTeacher || pendingAlertStudentIds.length === 0) {
      return;
    }
    setSubmitFeedback(null);
    setMonitoredIdsBySubject((prev) => {
      const current = prev[selectedSubjectId] || [];
      const merged = Array.from(new Set([...current, ...pendingAlertStudentIds]));
      return {
        ...prev,
        [selectedSubjectId]: merged,
      };
    });
  }

  function handleNotesChange(value: string) {
    if (!selectedSubjectId || isClaimedByOtherTeacher) return;
    setSubmitFeedback(null);
    setMonitoredNotesBySubject((prev) => ({
      ...prev,
      [selectedSubjectId]: value,
    }));
  }

  function handleDiscardLocalDraft() {
    if (!council || !selectedSubjectId || !verifiedEmail) return;
    clearTeacherPortalLocalDraft(
      council.boardId,
      council.trimester,
      selectedSubjectId,
      verifiedEmail
    );
    const baselineDescriptors = buildSubjectBaselineDescriptors(council, selectedSubjectId);
    const conv = council.preCouncil?.conversationsBySubjectId?.[selectedSubjectId];
    setDrafts((prev) => ({
      ...prev,
      [selectedSubjectId]: baselineDescriptors,
    }));
    setMonitoredIdsBySubject((prev) => ({
      ...prev,
      [selectedSubjectId]: Array.from(new Set(conv?.monitoredStudentIds || [])),
    }));
    setMonitoredNotesBySubject((prev) => ({
      ...prev,
      [selectedSubjectId]: conv?.monitoredStudentsNotes || "",
    }));
    setRestoredDraftInfo(null);
    setSubmitFeedback(null);
  }

  async function handleSubmitPortal(confirmAck: boolean) {
    if (
      !council ||
      !googleIdToken ||
      !selectedSubjectId ||
      isClaimedByOtherTeacher ||
      council.students.length === 0
    ) {
      return;
    }
    if (confirmAck && !selectedConv?.canConfirmAck) {
      return;
    }

    setSubmitting(true);
    setSubmitFeedback(null);

    try {
      const entries = council.students.map((st) => ({
        studentId: st.studentId,
        descriptorCodes: currentDraftMap[st.studentId] || [],
      }));

      const res = await fetch(`${portalApiBase}/${encodeURIComponent(token)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleIdToken,
          subjectId: selectedSubjectId,
          entries,
          preCouncil: {
            monitoredStudentIds: currentMonitoredIds,
            monitoredStudentsNotes: currentMonitoredNotes,
          },
          confirmAck,
        }),
      });

      const data: {
        success?: boolean;
        error?: string;
        result?: {
          updatedCount: number;
          subjectId: string;
          subjectName: string;
          ackConfirmed: boolean;
        };
        council?: TeacherPortalCouncilContext;
      } = await res.json();

      if (!res.ok || !data.council || !data.result) {
        throw new Error(
          data.error || "Não foi possível salvar os registros do componente."
        );
      }

      const savedSubjectId = data.result.subjectId;
      if (verifiedEmail) {
        clearTeacherPortalLocalDraft(
          data.council.boardId,
          data.council.trimester,
          savedSubjectId,
          verifiedEmail
        );
      }
      setRestoredDraftInfo((prev) => (prev?.subjectId === savedSubjectId ? null : prev));

      const refreshedDrafts = buildInitialDrafts(data.council);
      const refreshedMonitored = buildInitialMonitoredIds(data.council);
      const refreshedNotes = buildInitialMonitoredNotes(data.council);

      setCouncil(data.council);
      setDrafts((prev) => ({
        ...prev,
        [savedSubjectId]: refreshedDrafts[savedSubjectId] || {},
      }));
      setMonitoredIdsBySubject((prev) => ({
        ...prev,
        [savedSubjectId]: refreshedMonitored[savedSubjectId] || [],
      }));
      setMonitoredNotesBySubject((prev) => ({
        ...prev,
        [savedSubjectId]: refreshedNotes[savedSubjectId] || "",
      }));

      setSubmitFeedback({
        type: "success",
        message: data.result.ackConfirmed
          ? `Ciência e dados de ${data.result.subjectName} registrados.`
          : `Matriz e observações de ${data.result.subjectName} salvas (${data.result.updatedCount} estudantes).`,
      });
    } catch (err: any) {
      setSubmitFeedback({
        type: "error",
        message: err?.message || "Falha de conexão ao enviar registros.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const refreshAckReleaseStatus = useCallback(
    async (manual = false) => {
      if (!googleIdToken || !council) return;
      if (manual) {
        setCheckingAckRelease(true);
        setSubmitFeedback(null);
      }

      try {
        const res = await fetch(`${portalApiBase}/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken }),
        });
        const data: {
          success?: boolean;
          error?: string;
          council?: TeacherPortalCouncilContext;
        } = await res.json();

        if (!res.ok || !data.council) {
          if (manual) {
            setSubmitFeedback({
              type: "error",
              message:
                res.status === 401
                  ? "Sessão expirada. Entre novamente para atualizar."
                  : data.error || "Não foi possível verificar a liberação agora.",
            });
          }
          return;
        }

        setCouncil(data.council);
        if (manual) {
          const updatedConv = data.council.preCouncil?.conversationsBySubjectId?.[selectedSubjectId];
          if (updatedConv?.canConfirmAck) {
            setSubmitFeedback({
              type: "success",
              message: "Assinatura liberada pela equipe pedagógica.",
            });
          } else {
            setSubmitFeedback({
              type: "error",
              message: "Ainda aguardando o registro da conversa ou combinados pela equipe pedagógica.",
            });
          }
        }
      } catch {
        if (manual) {
          setSubmitFeedback({
            type: "error",
            message: "Falha de conexão ao verificar liberação.",
          });
        }
      } finally {
        if (manual) {
          setCheckingAckRelease(false);
        }
      }
    },
    [googleIdToken, council, portalApiBase, token, selectedSubjectId]
  );

  // Atualiza automaticamente a Etapa 3 enquanto aguarda liberação da equipe pedagógica
  useEffect(() => {
    if (
      activeStep !== "ack" ||
      !googleIdToken ||
      !council ||
      isClaimedByOtherTeacher ||
      selectedConv?.digitalAckEmail ||
      selectedConv?.canConfirmAck
    ) {
      return;
    }

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshAckReleaseStatus(false);
    }, 8000);

    return () => clearInterval(timer);
  }, [
    activeStep,
    googleIdToken,
    council,
    isClaimedByOtherTeacher,
    selectedConv?.digitalAckEmail,
    selectedConv?.canConfirmAck,
    refreshAckReleaseStatus,
  ]);

  function handleLogoutTeacher() {
    checkedDraftKeysRef.current.clear();
    setRestoredDraftInfo(null);
    setGoogleIdToken(null);
    setVerifiedEmail(null);
    setVerifiedName(null);
    setCouncil(null);
    setDrafts({});
    setMonitoredIdsBySubject({});
    setMonitoredNotesBySubject({});
    setSubmitFeedback(null);
    setAuthError(null);
    preloadedSession?.onLogout?.();
  }

  // Tela de Identificação Docente @escola.pr.gov.br
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
                <strong>@escola.pr.gov.br</strong> para preencher a matriz do seu
                componente curricular, indicar estudantes prioritários e confirmar
                a ciência do Pré-Conselho.
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

  const synthesis = council.preCouncil?.synthesis;
  const filledSynthesisFields = synthesis
    ? SYNTHESIS_VIEW_FIELDS.filter((f) => Boolean(synthesis[f.key]?.trim()))
    : [];

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
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
        {/* Banner de rascunho local restaurado */}
        {restoredDraftInfo && restoredDraftInfo.subjectId === selectedSubjectId && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-amber-950">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  Rascunho local restaurado neste dispositivo
                  {restoredDraftInfo.savedAt
                    ? ` (${formatPreCouncilDateTimePtBr(restoredDraftInfo.savedAt)})`
                    : ""}
                  .
                </p>
                <p className="text-[11px] text-amber-800">
                  Suas marcações anteriores ainda não enviadas ao conselho foram recuperadas.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDiscardLocalDraft}
              className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-400 bg-white hover:bg-amber-100 text-amber-950 font-bold transition cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Descartar rascunho local</span>
            </button>
          </div>
        )}

        {/* Seletor de Componente Curricular */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
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
              {selectedConv?.teacherSubmittedAt && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    Enviado em {formatPreCouncilDateTimePtBr(selectedConv.teacherSubmittedAt)}
                  </span>
                </span>
              )}
              {selectedConv?.digitalAckEmail ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-900 text-[11px] font-bold">
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  <span>Ciência confirmada</span>
                </span>
              ) : selectedConv?.canConfirmAck ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold">
                  <span>Ciência disponível na Etapa 3</span>
                </span>
              ) : null}
            </div>
          </div>

          {isClaimedByOtherTeacher && selectedSubject && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 font-semibold">
              Este componente curricular está vinculado a{" "}
              {selectedSubject.teacherName || selectedSubject.teacherEmail}. Selecione o seu
              componente ou solicite ajuste à equipe pedagógica.
            </div>
          )}

          {/* Navegação em 3 Etapas */}
          <div
            role="tablist"
            aria-label="Etapas do preenchimento docente"
            className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeStep === "matrix"}
              onClick={() => setActiveStep("matrix")}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left text-xs transition cursor-pointer ${
                activeStep === "matrix"
                  ? "border-sky-600 bg-sky-50 text-sky-950 font-extrabold"
                  : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold"
              }`}
            >
              <span>1. Matriz do Componente</span>
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10px]">
                {evaluatedCount}/{activeStudents.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeStep === "pre-council"}
              onClick={() => setActiveStep("pre-council")}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left text-xs transition cursor-pointer ${
                activeStep === "pre-council"
                  ? "border-sky-600 bg-sky-50 text-sky-950 font-extrabold"
                  : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold"
              }`}
            >
              <span>2. Pré-Conselho</span>
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10px]">
                {currentMonitoredIds.length} atenção
                {liveAlerts.length > 0 ? ` • ${liveAlerts.length} alertas` : ""}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeStep === "ack"}
              onClick={() => setActiveStep("ack")}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left text-xs transition cursor-pointer ${
                activeStep === "ack"
                  ? "border-sky-600 bg-sky-50 text-sky-950 font-extrabold"
                  : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold"
              }`}
            >
              <span>3. Envio e Ciência</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] ${
                  selectedConv?.digitalAckEmail
                    ? "bg-emerald-100 text-emerald-800"
                    : selectedConv?.canConfirmAck
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {selectedConv?.digitalAckEmail
                  ? "Registrada"
                  : selectedConv?.canConfirmAck
                  ? "Liberada"
                  : "Envio prévio"}
              </span>
            </button>
          </div>
        </section>

        {/* ETAPA 1: Matriz do Componente */}
        {activeStep === "matrix" && (
          <>
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
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

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActiveStep("pre-council")}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-900 text-xs font-bold transition cursor-pointer"
              >
                <span>Avançar para Pré-Conselho</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}

        {/* ETAPA 2: Pré-Conselho (Alertas ao Vivo, Estudantes em Atenção e Observações) */}
        {activeStep === "pre-council" && (
          <div className="space-y-4">
            {/* Sugestões automáticas calculadas da matriz atual + nota + frequência */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <h2 className="text-sm font-black text-slate-900">
                    Estudantes sinalizados automaticamente ({liveAlerts.length})
                  </h2>
                </div>

                <button
                  type="button"
                  disabled={
                    isClaimedByOtherTeacher || pendingAlertStudentIds.length === 0
                  }
                  onClick={handleIncludeAllLiveAlerts}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-amber-950 text-xs font-bold transition cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>
                    Incluir todos os alertas
                    {pendingAlertStudentIds.length > 0
                      ? ` (${pendingAlertStudentIds.length})`
                      : ""}
                  </span>
                </button>
              </div>

              {liveAlerts.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Nenhum estudante com alerta automático pela matriz atual, nota abaixo da média ou frequência inferior a 75%.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {liveAlerts.map((alert) => {
                    const included = monitoredSet.has(alert.studentId);
                    return (
                      <div
                        key={alert.studentId}
                        className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 ${
                          included
                            ? "border-sky-300 bg-sky-50/70"
                            : "border-slate-200 bg-slate-50/60"
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {alert.studentName}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {alert.reasons.map((reason) => (
                              <span
                                key={reason}
                                className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-semibold text-slate-700"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isClaimedByOtherTeacher}
                          aria-pressed={included}
                          onClick={() => handleToggleMonitoredStudent(alert.studentId)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer shrink-0 disabled:opacity-50 ${
                            included
                              ? "bg-sky-600 text-white hover:bg-sky-700"
                              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {included ? "Incluído" : "Incluir"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Seleção manual completa de estudantes em acompanhamento */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-600 shrink-0" />
                  <h2 className="text-sm font-black text-slate-900">
                    Estudantes em atenção ({currentMonitoredIds.length})
                  </h2>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    aria-label="Filtrar estudantes para acompanhamento"
                    placeholder="Filtrar estudante da turma..."
                    value={monitoredSearchTerm}
                    onChange={(e) => setMonitoredSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>
              </div>

              {currentMonitoredIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {currentMonitoredIds.map((studentId) => {
                    const label = studentNameMap.get(studentId) || "Estudante";
                    return (
                      <button
                        key={studentId}
                        type="button"
                        disabled={isClaimedByOtherTeacher}
                        onClick={() => handleToggleMonitoredStudent(studentId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-100 hover:bg-sky-200 text-sky-900 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        <span>{label}</span>
                        <span aria-hidden="true">×</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 border-t border-slate-100">
                {filteredAllStudentsForMonitoring.map((st) => {
                  const checked = monitoredSet.has(st.studentId);
                  return (
                    <label
                      key={st.studentId}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs cursor-pointer transition ${
                        checked
                          ? "border-sky-300 bg-sky-50 text-sky-950 font-bold"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isClaimedByOtherTeacher}
                        onChange={() => handleToggleMonitoredStudent(st.studentId)}
                        className="rounded border-slate-300 text-sky-600"
                      />
                      <span className="truncate">{st.name}</span>
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Observações prévias do docente */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="teacher-portal-pre-council-notes"
                  className="text-sm font-black text-slate-900"
                >
                  Observações e encaminhamentos prévios do docente
                </label>
                <span className="text-[11px] font-semibold text-slate-500">
                  {currentMonitoredNotes.length}/3000
                </span>
              </div>
              <textarea
                id="teacher-portal-pre-council-notes"
                rows={4}
                maxLength={3000}
                disabled={isClaimedByOtherTeacher}
                value={currentMonitoredNotes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Registre observações prévias sobre dificuldades, frequência, postura ou estratégias aplicadas no trimestre..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-900 disabled:bg-slate-50"
              />
            </section>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActiveStep("matrix")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar à Matriz</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveStep("ack")}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-900 text-xs font-bold transition cursor-pointer"
              >
                <span>Avançar para Envio e Ciência</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ETAPA 3: Envio e Ciência */}
        {activeStep === "ack" && (
          <div className="space-y-4">
            {/* Resumo da contribuição docente */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <h2 className="text-sm font-black text-slate-900">
                Resumo do lançamento de {selectedSubject?.name || "componente"}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Matriz avaliada</p>
                  <p className="text-sm font-black text-slate-900">
                    {evaluatedCount}/{activeStudents.length} estudantes
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold text-slate-500">
                    Estudantes sinalizados
                  </p>
                  <p className="text-sm font-black text-slate-900">
                    {currentMonitoredIds.length} estudante(s)
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Observações prévias</p>
                  <p className="text-sm font-black text-slate-900">
                    {currentMonitoredNotes.trim()
                      ? `${currentMonitoredNotes.trim().length} caracteres`
                      : "Nenhuma registrada"}
                  </p>
                </div>
              </div>
            </section>

            {/* Combinados da Equipe Pedagógica + Síntese da Turma (Somente leitura) */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-600 shrink-0" />
                  <h2 className="text-sm font-black text-slate-900">
                    Combinados e Síntese do Pré-Conselho
                  </h2>
                </div>
                {selectedConv && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      selectedConv.conversationStatus === "COMPLETED"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {selectedConv.conversationStatus === "COMPLETED"
                      ? `Conversa realizada${
                          selectedConv.conversationDate
                            ? ` em ${formatPreCouncilDatePtBr(selectedConv.conversationDate)}`
                            : ""
                        }`
                      : "Conversa pendente com a equipe pedagógica"}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-bold text-slate-600">
                  Combinados registrados para este componente
                </p>
                <p className="text-xs text-slate-800 whitespace-pre-line">
                  {selectedConv?.agreements?.trim()
                    ? selectedConv.agreements
                    : "Ainda não há combinados registrados pela equipe pedagógica para este componente."}
                </p>
              </div>

              {filledSynthesisFields.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Síntese consolidada da turma
                  </p>
                  <div className="space-y-2">
                    {filledSynthesisFields.map((field) => (
                      <div
                        key={field.key}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-0.5"
                      >
                        <p className="text-[11px] font-bold text-slate-700">{field.label}</p>
                        <p className="text-xs text-slate-800 whitespace-pre-line">
                          {synthesis?.[field.key]}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  A síntese consolidada da turma ainda está em elaboração pela equipe pedagógica.
                </p>
              )}
            </section>

            {/* Termo e Confirmação de Ciência */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-sky-600 shrink-0" />
                <h2 className="text-sm font-black text-slate-900">
                  Ciência docente no Pré-Conselho
                </h2>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed rounded-xl border border-slate-200 bg-slate-50 p-3">
                {DEFAULT_PRE_COUNCIL_ACK_STATEMENT}
              </p>

              {selectedConv?.digitalAckEmail ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-950 space-y-1">
                  <p className="font-black flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Ciência registrada</span>
                  </p>
                  <p>
                    Confirmada por <strong>{selectedConv.digitalAckName || verifiedName}</strong> (
                    {selectedConv.digitalAckEmail})
                    {selectedConv.digitalAckAt
                      ? ` em ${formatPreCouncilDateTimePtBr(selectedConv.digitalAckAt)}`
                      : ""}
                    .
                  </p>
                </div>
              ) : selectedConv?.canConfirmAck ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-sky-950 font-medium">
                    A conversa ou os combinados já estão registrados. Confira seus dados e confirme a ciência abaixo.
                  </p>
                  <button
                    type="button"
                    disabled={
                      submitting ||
                      isClaimedByOtherTeacher ||
                      !selectedSubject ||
                      council.students.length === 0
                    }
                    onClick={() => void handleSubmitPortal(true)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold transition cursor-pointer shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{submitting ? "Confirmando..." : "Confirmar ciência"}</span>
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
                  <span>
                    Você já pode clicar em <strong>Enviar matriz e observações</strong> no rodapé. A confirmação de ciência será liberada automaticamente assim que a equipe pedagógica registrar a conversa ou os combinados do componente.
                  </span>
                  <button
                    type="button"
                    disabled={checkingAckRelease}
                    onClick={() => void refreshAckReleaseStatus(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-white hover:bg-amber-100/70 disabled:opacity-60 text-amber-950 text-xs font-bold transition cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkingAckRelease ? "animate-spin" : ""}`} />
                    <span>{checkingAckRelease ? "Verificando..." : "Verificar liberação"}</span>
                  </button>
                </div>
              )}
            </section>

            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setActiveStep("pre-council")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar ao Pré-Conselho</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Barra Fixa de Envio */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-slate-800">
                {evaluatedCount}/{activeStudents.length} avaliados na matriz •{" "}
                {currentMonitoredIds.length} em atenção
              </p>
              {isCurrentSubjectDirty && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                  Rascunho local pendente de envio
                </span>
              )}
            </div>
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                submitting ||
                isClaimedByOtherTeacher ||
                !selectedSubject ||
                council.students.length === 0
              }
              onClick={() => void handleSubmitPortal(false)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-extrabold transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {submitting ? "Enviando..." : "Enviar matriz e observações"}
              </span>
            </button>

            {activeStep === "ack" &&
              selectedConv?.canConfirmAck &&
              !selectedConv.digitalAckEmail && (
                <button
                  type="button"
                  disabled={
                    submitting ||
                    isClaimedByOtherTeacher ||
                    !selectedSubject ||
                    council.students.length === 0
                  }
                  onClick={() => void handleSubmitPortal(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold transition cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Confirmar ciência</span>
                </button>
              )}
          </div>
        </div>
      </footer>
    </div>
  );
}
