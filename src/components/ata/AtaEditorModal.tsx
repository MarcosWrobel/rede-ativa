"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import AtaDialog from "./AtaDialog";
import SignatureCanvas from "./SignatureCanvas";
import AtaQrCode from "./AtaQrCode";
import SigningPinModal from "./SigningPinModal";
import PhysicalScanModal from "./PhysicalScanModal";
import { calculateBusinessDaysDiff } from "@/lib/signingPin";
import { formatParticipantRoleLabel } from "@/lib/participantKinship";
import {
  evaluateEffectivePhysicalProof,
  evaluateMinuteRevisionLock,
  getOfficialSummaryRemainingChars,
  hasMinimumOfficialSummary,
  OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR,
} from "@/lib/ataRevision";
import { buildWhatsAppDispatchUrl } from "@/lib/whatsappProvider";
import { dispatchWhatsAppToBrowser } from "@/lib/clientDispatcher";
import {
  Sparkles,
  Mic,
  MicOff,
  UserPlus,
  Trash2,
  QrCode,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
  Lock,
  Printer,
  Share2,
  Users,
  Search,
  ArrowRight,
  ArrowLeft,
  X,
  Check,
  ShieldCheck,
  Ban,
  RotateCcw,
  ExternalLink,
  Copy,
  Send,
  Clock,
  Download,
  GraduationCap,
  Camera,
} from "lucide-react";
import AtaExtemporaneousBanner from "./editor/AtaExtemporaneousBanner";
import AtaAddendumsSection from "./editor/AtaAddendumsSection";
import AtaActionItemsSection from "./editor/AtaActionItemsSection";
import AtaQrPollStatusBanner from "./editor/AtaQrPollStatusBanner";
import { useQrSignaturePolling } from "./editor/useQrSignaturePolling";
import { getParticipantSignatureSummary } from "./editor/signatureState";
import { formatSignLinkValidity } from "./editor/signLinkValidity";
import {
  applyPendingAiActionItemsDecision,
  isParticipantQrActive,
  isParticipantSignatureLocked,
  resetParticipantSignatureWithServer,
} from "./editor/participantIdentity";
import {
  applyCandidateToParticipantRow,
  applyManualParticipantFieldEdit,
  buildParticipantCandidates,
  ensureParticipantClientKey,
  getCandidatesForRowRole,
  pruneUntouchedSuggestionsForRemovedStudents,
  reconcileSavedParticipantsWithPersistedState,
  resolveRoleChangeWithCandidates,
  resolveSingleAutoFillCandidate,
  ScopedCandidateCache,
  stripClientParticipantMeta,
} from "./editor/participantCandidates";
import type {
  AtaStudentOption,
  AtaStaffCandidateOption,
  AtaParticipantDraft,
  AtaActionItemDraft,
  AtaActionItemRecord,
  AtaAddendumRecord,
  AtaMinuteRecord,
  SchoolHeaderConfig,
  SpeechRecognitionWindow,
  SpeechRecognitionResultEvent,
  FormalizeAtaApiResponse,
  AtaEditorModalProps,
} from "./editor/types";

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatIsoToDatetimeLocal(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(value: string): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

type PersistedMinuteSnapshot = {
  contentRevision: number;
  subject: string;
  category: string;
  isConfidential: boolean;
  attendedAt: string;
  rawNotes: string;
  summary: string;
  agreementsSummary: string;
  studentNames: string[];
  participantsCount: number;
  actionItemsCount: number;
};

function extractPersistedMinuteSnapshot(minute: AtaMinuteRecord): PersistedMinuteSnapshot {
  return {
    contentRevision:
      typeof minute.contentRevision === "number" && minute.contentRevision >= 1
        ? minute.contentRevision
        : 1,
    subject: minute.subject || "",
    category: minute.category || "ACOMPANHAMENTO_PEDAGOGICO",
    isConfidential: Boolean(minute.isConfidential),
    attendedAt: minute.attendedAt
      ? typeof minute.attendedAt === "string"
        ? minute.attendedAt
        : new Date(minute.attendedAt).toISOString()
      : "",
    rawNotes: minute.rawNotes || "",
    summary: minute.summary || "",
    agreementsSummary: minute.agreementsSummary || "",
    studentNames: (minute.students || [])
      .map((s) => s.studentNameSnapshot)
      .filter((name): name is string => Boolean(name)),
    participantsCount: Array.isArray(minute.participants) ? minute.participants.length : 0,
    actionItemsCount: Array.isArray(minute.actionItems) ? minute.actionItems.length : 0,
  };
}

function buildPollFingerprint(minute: {
  status?: string | null;
  contentRevision?: number | null;
  updatedAt?: string | Date | null;
  hasPhysicalScan?: boolean | null;
  govBrVerified?: boolean | null;
  participants?: Array<{
    id?: string | null;
    participantId?: string | null;
    signatureMode?: string | null;
    hasSignature?: boolean | null;
    hasActiveSignLink?: boolean | null;
    signedRevision?: number | null;
  }> | null;
}): string {
  const parts = (minute.participants || []).map((p) =>
    [
      p.participantId || p.id || "",
      p.signatureMode || "",
      p.hasSignature ? "1" : "0",
      p.hasActiveSignLink ? "1" : "0",
      p.signedRevision ?? "",
    ].join(":")
  );
  return [
    minute.status || "DRAFT",
    minute.contentRevision ?? 1,
    minute.updatedAt ? new Date(minute.updatedAt).toISOString() : "",
    minute.hasPhysicalScan ? "1" : "0",
    minute.govBrVerified ? "1" : "0",
    parts.join("|"),
  ].join("#");
}

const CATEGORIES = [
  { id: "ORIENTACAO_DOCENTE", label: "Orientação Pedagógica / Docente" },
  { id: "ACOMPANHAMENTO_PEDAGOGICO", label: "Acompanhamento Pedagógico / Rendimento" },
  { id: "BUSCA_ATIVA_FALTAS", label: "Busca Ativa / Frequência Escolar" },
  { id: "CONVIVENCIA_INDISCIPLINA", label: "Convivência e Mediação de Conflitos" },
  { id: "SAUDE_VULNERABILIDADE", label: "Saúde / Vulnerabilidade Social" },
  { id: "REDE_PROTECAO_CT", label: "Rede de Proteção / Conselho Tutelar" },
  { id: "ORIENTACAO_ROTINA", label: "Orientação de Rotina Escolar" },
];

export default function AtaEditorModal({
  isOpen,
  onClose,
  onSaved,
  availableStudents,
  preSelectedStudentId,
  existingMinute,
  isAdmin = false,
  activeSchoolId = null,
}: AtaEditorModalProps) {
  const isDocentInitial = existingMinute
    ? existingMinute.category === "ORIENTACAO_DOCENTE" ||
      (!existingMinute.students?.length &&
        Boolean(existingMinute.participants?.some((p) => p.role === "PROFESSOR")))
    : false;

  const [step, setStep] = useState<1 | 2>(() => {
    if (existingMinute) {
      return (existingMinute.students?.length ?? 0) > 0 || isDocentInitial ? 2 : 1;
    }
    return preSelectedStudentId ? 2 : 1;
  });

  // Filtros de Pesquisa de Alunos (Passo 1)
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedTurmaFilter, setSelectedTurmaFilter] = useState("TODAS");
  const [step1Error, setStep1Error] = useState<string | null>(null);

  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(() => {
    if (existingMinute?.students) {
      return existingMinute.students.map((s) => s.studentId);
    }
    return preSelectedStudentId ? [preSelectedStudentId] : [];
  });
  const [attendedAt, setAttendedAt] = useState<string>(() => {
    if (existingMinute?.attendedAt) {
      return typeof existingMinute.attendedAt === "string"
        ? existingMinute.attendedAt
        : new Date(existingMinute.attendedAt).toISOString();
    }
    return new Date().toISOString();
  });
  const [category, setCategory] = useState(() => existingMinute?.category || "ACOMPANHAMENTO_PEDAGOGICO");
  const [ataScope, setAtaScope] = useState<"STUDENTS" | "TEACHERS">(() =>
    isDocentInitial ? "TEACHERS" : "STUDENTS"
  );
  const [newTeacherName, setNewTeacherName] = useState("");
  const [newTeacherEmail, setNewTeacherEmail] = useState("");
  const [newTeacherSubject, setNewTeacherSubject] = useState("");
  const [staffCandidates, setStaffCandidates] = useState<AtaStaffCandidateOption[]>([]);
  const [staffTruncated, setStaffTruncated] = useState(false);
  const [loadedStudentsWithContacts, setLoadedStudentsWithContacts] = useState<AtaStudentOption[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const staffCacheRef = useRef(
    new ScopedCandidateCache<{ staff: AtaStaffCandidateOption[]; staffTruncated: boolean }>(60_000)
  );
  const contactsCacheRef = useRef(new ScopedCandidateCache<AtaStudentOption[]>(60_000));
  const staffReqSeqRef = useRef(0);
  const contactsReqSeqRef = useRef(0);
  const activeSchoolIdRef = useRef<string | null>(activeSchoolId ?? null);
  const activeContactsKeyRef = useRef<string>("");
  const autoSuggestInitializedRef = useRef(false);
  const [isConfidential, setIsConfidential] = useState(Boolean(existingMinute?.isConfidential));
  const [nonConfidentialConfirmed, setNonConfidentialConfirmed] = useState(false);
  const [subject, setSubject] = useState(
    existingMinute?.subject || "Atendimento Pedagógico e Alinhamento de Frequência"
  );
  const [rawNotes, setRawNotes] = useState(existingMinute?.rawNotes || "");
  const [summary, setSummary] = useState(existingMinute?.summary || "");
  const [agreementsSummary, setAgreementsSummary] = useState(existingMinute?.agreementsSummary || "");
  const [participants, setParticipants] = useState<AtaParticipantDraft[]>(() =>
    existingMinute?.participants
      ? existingMinute.participants.map((p, i) =>
          ensureParticipantClientKey({ ...p, originState: "PERSISTED" }, i)
        )
      : []
  );
  const [actionItems, setActionItems] = useState<AtaActionItemDraft[]>(() =>
    existingMinute?.actionItems
      ? existingMinute.actionItems.map((a) => ({
          id: a.id,
          description: a.description,
          responsible: a.responsible,
          dueDate: a.dueDate ? String(a.dueDate).slice(0, 10) : "",
          status: a.status || "PENDING",
        }))
      : []
  );
  const [contentRevision, setContentRevision] = useState<number>(
    typeof existingMinute?.contentRevision === "number" && existingMinute.contentRevision >= 1
      ? existingMinute.contentRevision
      : 1
  );
  const [physicalProofMeta, setPhysicalProofMeta] = useState<{
    physicalScanRevision?: number | null;
    physicalScanSupersededAt?: string | Date | null;
    hasPhysicalScan?: boolean;
    physicalSignedScanData?: string | null;
    physicalScanStorageKey?: string | null;
    govBrVerified?: boolean;
    govBrProtocol?: string | null;
  }>(() => ({
    physicalScanRevision: existingMinute?.physicalScanRevision ?? null,
    physicalScanSupersededAt: existingMinute?.physicalScanSupersededAt ?? null,
    hasPhysicalScan: Boolean(existingMinute?.hasPhysicalScan),
    physicalSignedScanData: existingMinute?.physicalSignedScanData ?? null,
    physicalScanStorageKey: existingMinute?.physicalScanStorageKey ?? null,
    govBrVerified: Boolean(existingMinute?.govBrVerified),
    govBrProtocol: existingMinute?.govBrProtocol ?? null,
  }));
  const [physicalProofHistory, setPhysicalProofHistory] = useState<
    AtaMinuteRecord["physicalProofHistory"]
  >(() => existingMinute?.physicalProofHistory || []);
  const [persistedSnapshot, setPersistedSnapshot] = useState<PersistedMinuteSnapshot | null>(() =>
    existingMinute ? extractPersistedMinuteSnapshot(existingMinute) : null
  );
  const [reviewedRevision, setReviewedRevision] = useState<number | null>(null);
  const [hasPendingLocalEdit, setHasPendingLocalEdit] = useState(false);
  const [savingScreenSigIndex, setSavingScreenSigIndex] = useState<number | null>(null);
  const [reopenConfirmRevision, setReopenConfirmRevision] = useState<number | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [reopenFeedbackMsg, setReopenFeedbackMsg] = useState<string | null>(null);
  const actionItemsRef = useRef<AtaActionItemDraft[]>(actionItems);
  actionItemsRef.current = actionItems;
  const [pendingSuggestedActions, setPendingSuggestedActions] = useState<AtaActionItemDraft[] | null>(null);
  const [cancelingQrIndex, setCancelingQrIndex] = useState<number | null>(null);
  const [resettingSigIndex, setResettingSigIndex] = useState<number | null>(null);
  const [signatureResetNotices, setSignatureResetNotices] = useState<Record<number, string>>({});
  const [signatureResetErrors, setSignatureResetErrors] = useState<Record<number, string>>({});

  // Estados de IA, Gravação e Salvamento
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccessMsg, setAiSuccessMsg] = useState<{ type: "success" | "warning"; text: string } | null>(null);
  const [hasServerKey, setHasServerKey] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingFinal, setSavingFinal] = useState(false);
  const [draftSavedMsg, setDraftSavedMsg] = useState<string | null>(null);
  const [activeSignTarget, setActiveSignTarget] = useState<{
    index: number;
    participantId: string;
    revision: number;
  } | null>(null);
  const screenSigInFlightRef = useRef(false);
  const [activeRefusalIndex, setActiveRefusalIndex] = useState<number | null>(null);
  const [refusalDraftReason, setRefusalDraftReason] = useState("");
  const [refusalDraftWitness, setRefusalDraftWitness] = useState("Equipe Pedagógica");
  const [qrModalInfo, setQrModalInfo] = useState<{
    participantId: string;
    url: string;
    name: string;
    expiresInMinutes: number;
    expiresAt?: string | null;
    participantRole: string;
    openId: string;
  } | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [validityNowMs, setValidityNowMs] = useState<number>(() => Date.now());
  const [isHydratingMinute, setIsHydratingMinute] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydrationRetryKey, setHydrationRetryKey] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [signDurationOption, setSignDurationOption] = useState<number>(20); // 20 min ou 1440 (24h)
  const [finalizedAta, setFinalizedAta] = useState<AtaMinuteRecord | null>(null);
  const [minuteId, setMinuteId] = useState<string | null>(existingMinute?.id || null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const editorOpenIdRef = useRef(0);
  const localRevisionRef = useRef(0);
  const qrGenerationInFlightRef = useRef(false);
  const qrRequestSeqRef = useRef(0);
  const qrPanelContextRef = useRef<{ isOpen: boolean; participantId: string | null }>({
    isOpen: false,
    participantId: null,
  });
  const syncInFlightRef = useRef(false);
  const lastPollFingerprintRef = useRef<string>(
    existingMinute ? buildPollFingerprint(existingMinute as any) : ""
  );
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const hasPendingLocalEditRef = useRef(hasPendingLocalEdit);
  hasPendingLocalEditRef.current = hasPendingLocalEdit;
  const contentRevisionRef = useRef(contentRevision);
  contentRevisionRef.current = contentRevision;
  const reopenConfirmRevisionRef = useRef<number | null>(reopenConfirmRevision);
  reopenConfirmRevisionRef.current = reopenConfirmRevision;

  const revisionLockState = useMemo(
    () =>
      evaluateMinuteRevisionLock({
        status: existingMinute?.status === "FINALIZED" || existingMinute?.status === "VOIDED" ? existingMinute.status : "DRAFT",
        contentRevision,
        participants,
        ...physicalProofMeta,
      }),
    [existingMinute?.status, contentRevision, participants, physicalProofMeta]
  );

  const isContentLocked = revisionLockState.isLockedBySignature;
  const activePersistedId = minuteId || existingMinute?.id || null;
  const displayedReviewRevision = persistedSnapshot?.contentRevision ?? null;
  const persistedHasMinimumSummary = hasMinimumOfficialSummary(persistedSnapshot?.summary);
  const localHasMinimumSummary = hasMinimumOfficialSummary(summary);
  const hasActiveLinkOnIncompleteSummary = Boolean(
    activePersistedId && !persistedHasMinimumSummary && revisionLockState.activeLinksCount > 0
  );
  const remainingSummaryChars = getOfficialSummaryRemainingChars(
    hasPendingLocalEdit ? summary : persistedSnapshot?.summary
  );
  const isCurrentRevisionConfirmed = Boolean(
    activePersistedId &&
      persistedSnapshot &&
      displayedReviewRevision === contentRevision &&
      persistedHasMinimumSummary &&
      !hasPendingLocalEdit &&
      !isHydratingMinute &&
      !hydrationError &&
      !revisionLockState.hasLegacyUnprovableProof &&
      (reviewedRevision === displayedReviewRevision ||
        (isContentLocked && revisionLockState.validSignedCount > 0))
  );

  const broadcastMinuteSync = useCallback((targetId: string | null | undefined, reason: string) => {
    if (!targetId || typeof BroadcastChannel === "undefined") return;
    try {
      const ch = syncChannelRef.current || new BroadcastChannel("redeativa-ata-sync");
      syncChannelRef.current = ch;
      ch.postMessage({ minuteId: targetId, reason, ts: Date.now() });
    } catch {
      // Sem impacto em ambientes sem suporte a BroadcastChannel
    }
  }, []);

  const markLocalEdit = () => {
    localRevisionRef.current += 1;
    setHasPendingLocalEdit(true);
    setReviewedRevision(null);
    setActiveSignTarget(null);
    setDraftSavedMsg(null);
    setReopenFeedbackMsg(null);
  };

  // Estados de Conformidade Jurídica (PIN de Fé Pública e Lavratura Extemporânea)
  const [extemporaneousReason, setExtemporaneousReason] = useState(
    existingMinute?.extemporaneousReason || ""
  );
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState<"finalize" | "addendum" | "void">("finalize");
  const [hasSigningPin, setHasSigningPin] = useState<boolean | undefined>(undefined);

  // Estados exclusivos para visualização de Ata já Lavrada (Adendo / Cancelamento / Ações)
  const [viewMinuteData, setViewMinuteData] = useState<AtaMinuteRecord | null>(null);
  const [addendumText, setAddendumText] = useState("");
  const [savingAddendum, setSavingAddendum] = useState(false);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [savingVoid, setSavingVoid] = useState(false);
  const [showAdminDeleteConfirm, setShowAdminDeleteConfirm] = useState(false);
  const [isDeletingAdmin, setIsDeletingAdmin] = useState(false);
  const [postFinalizeMsg, setPostFinalizeMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);

  // Consulta elegibilidade institucional de assistência na formalização no servidor
  useEffect(() => {
    fetch("/api/ai/test-key")
      .then((res) => res.json())
      .then((data) => {
        setHasServerKey(Boolean(data?.schoolAuthorized ?? data?.hasServerKey));
      })
      .catch(() => {});
  }, []);

  const applyHydratedDraftMinute = useCallback(
    (
      hydrated: AtaMinuteRecord,
      options: { preserveLocalEdits?: boolean; preserveReviewedRevision?: boolean } = {}
    ) => {
      if (hydrated.status === "FINALIZED" || hydrated.status === "VOIDED") {
        setQrModalInfo(null);
        setActiveSignTarget(null);
        setActiveRefusalIndex(null);
        setReopenConfirmRevision(null);
        setReviewedRevision(null);
        setViewMinuteData(hydrated);
        setMinuteId(hydrated.id);
        setPhysicalProofHistory(hydrated.physicalProofHistory || []);
        lastPollFingerprintRef.current = buildPollFingerprint(hydrated as any);
        return;
      }

      const nextRev =
        typeof hydrated.contentRevision === "number" && hydrated.contentRevision >= 1
          ? hydrated.contentRevision
          : 1;
      const revChanged = nextRev !== contentRevisionRef.current;

      setMinuteId(hydrated.id);
      setContentRevision(nextRev);
      setPhysicalProofMeta({
        physicalScanRevision: hydrated.physicalScanRevision ?? null,
        physicalScanSupersededAt: hydrated.physicalScanSupersededAt ?? null,
        hasPhysicalScan: Boolean(hydrated.hasPhysicalScan),
        physicalSignedScanData: hydrated.physicalSignedScanData ?? null,
        physicalScanStorageKey: hydrated.physicalScanStorageKey ?? null,
        govBrVerified: Boolean(hydrated.govBrVerified),
        govBrProtocol: hydrated.govBrProtocol ?? null,
      });
      if (Array.isArray(hydrated.physicalProofHistory)) {
        setPhysicalProofHistory(hydrated.physicalProofHistory);
      }
      setPersistedSnapshot(extractPersistedMinuteSnapshot(hydrated));
      lastPollFingerprintRef.current = buildPollFingerprint(hydrated as any);

      const syncedLock = evaluateMinuteRevisionLock(hydrated);
      if (syncedLock.isLockedBySignature) {
        setActiveRefusalIndex(null);
      }

      if (revChanged) {
        setQrModalInfo(null);
        qrPanelContextRef.current = { isOpen: false, participantId: null };
        setReopenConfirmRevision(null);
        setActiveSignTarget(null);
        setActiveRefusalIndex(null);
      } else if (hydrated.participants) {
        setActiveSignTarget((currentTarget) => {
          if (!currentTarget) return null;
          const syncedPart = hydrated.participants?.find(
            (p) => p.id && p.id === currentTarget.participantId
          );
          if (syncedPart && getParticipantSignatureSummary(syncedPart).hasPersistedSignature) {
            return null;
          }
          return currentTarget;
        });
      }

      if (!options.preserveReviewedRevision || revChanged) {
        setReviewedRevision(null);
      }

      if (!options.preserveLocalEdits) {
        setAttendedAt(
          hydrated.attendedAt
            ? typeof hydrated.attendedAt === "string"
              ? hydrated.attendedAt
              : new Date(hydrated.attendedAt).toISOString()
            : new Date().toISOString()
        );
        setHasPendingLocalEdit(false);
        setSelectedStudentIds(hydrated.students ? hydrated.students.map((s) => s.studentId) : []);
        setCategory(hydrated.category || "ACOMPANHAMENTO_PEDAGOGICO");
        setIsConfidential(Boolean(hydrated.isConfidential));
        setSubject(hydrated.subject || "Atendimento Pedagógico e Alinhamento de Frequência");
        setRawNotes(hydrated.rawNotes || "");
        setSummary(hydrated.summary || "");
        setAgreementsSummary(hydrated.agreementsSummary || "");
        setExtemporaneousReason(hydrated.extemporaneousReason || "");
        setActionItems(
          hydrated.actionItems
            ? hydrated.actionItems.map((a) => ({
                id: a.id,
                description: a.description,
                responsible: a.responsible,
                dueDate: a.dueDate ? String(a.dueDate).slice(0, 10) : "",
                status: a.status || "PENDING",
              }))
            : []
        );
      }

      if (hydrated.participants) {
        setParticipants((prev) =>
          prev.length > 0
            ? reconcileSavedParticipantsWithPersistedState(prev, hydrated.participants)
            : (hydrated.participants || []).map((p, i) =>
                ensureParticipantClientKey({ ...p, originState: "PERSISTED" }, i)
              )
        );
      }
      autoSuggestInitializedRef.current = true;
    },
    []
  );

  const syncMinuteFromServer = useCallback(
    async (
      targetId: string | null | undefined,
      options: { forceFull?: boolean; notice?: string } = {}
    ) => {
      if (!targetId || syncInFlightRef.current || !isOpen) return;
      const openIdAtStart = editorOpenIdRef.current;
      syncInFlightRef.current = true;
      try {
        let shouldFetchFull = Boolean(options.forceFull);

        if (!shouldFetchFull) {
          const pollRes = await fetch(`/api/atas/${targetId}?poll=1`, { cache: "no-store" });
          if (!pollRes.ok || openIdAtStart !== editorOpenIdRef.current) return;
          const pollData = (await pollRes.json().catch(() => null)) as {
            status?: string;
            contentRevision?: number;
            updatedAt?: string | null;
            hasPhysicalScan?: boolean;
            govBrVerified?: boolean;
            participants?: Array<{
              participantId: string;
              signatureMode?: string;
              hasSignature?: boolean;
              hasActiveSignLink?: boolean;
              signedRevision?: number | null;
            }>;
          } | null;
          if (!pollData) return;

          const fingerprint = buildPollFingerprint(pollData as any);
          if (fingerprint === lastPollFingerprintRef.current) {
            return;
          }
          shouldFetchFull = true;
        }

        if (!shouldFetchFull) return;

        const fullRes = await fetch(`/api/atas/${targetId}`, { cache: "no-store" });
        if (!fullRes.ok || openIdAtStart !== editorOpenIdRef.current) return;
        const fullData = (await fullRes.json().catch(() => null)) as {
          minute?: AtaMinuteRecord;
        } | null;
        if (!fullData?.minute || openIdAtStart !== editorOpenIdRef.current) return;

        const hydrated = fullData.minute;
        const remoteLockState = evaluateMinuteRevisionLock(hydrated);
        const remoteRev =
          typeof hydrated.contentRevision === "number" && hydrated.contentRevision >= 1
            ? hydrated.contentRevision
            : 1;
        const revOrStatusChanged =
          remoteRev !== contentRevisionRef.current ||
          hydrated.status === "FINALIZED" ||
          hydrated.status === "VOIDED" ||
          remoteLockState.isLockedBySignature;

        const preserveLocalEdits = hasPendingLocalEditRef.current && !revOrStatusChanged;
        applyHydratedDraftMinute(hydrated, {
          preserveLocalEdits,
          preserveReviewedRevision: !revOrStatusChanged && !hasPendingLocalEditRef.current,
        });

        if (options.notice) {
          setFinalizeError(options.notice);
        } else if (remoteLockState.isLockedBySignature) {
          setDraftSavedMsg(
            "Ata sincronizada com assinatura registrada na revisão vigente. Edição bloqueada."
          );
        }

        if (revOrStatusChanged) {
          onSaved();
        }
      } catch {
        // Ignora falha transitória de rede durante sincronização em segundo plano
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [applyHydratedDraftMinute, isOpen, onSaved]
  );

  // Inicializa / reseta o modal sempre que abrir ou trocar de ata
  useEffect(() => {
    if (!isOpen) {
      qrRequestSeqRef.current += 1;
      qrGenerationInFlightRef.current = false;
      qrPanelContextRef.current = { isOpen: false, participantId: null };
      setIsGeneratingQr(false);
      setIsHydratingMinute(false);
      setHydrationError(null);
      return;
    }

    editorOpenIdRef.current += 1;
    localRevisionRef.current = 0;
    qrRequestSeqRef.current += 1;
    qrGenerationInFlightRef.current = false;
    qrPanelContextRef.current = { isOpen: false, participantId: null };
    setIsGeneratingQr(false);

    setFinalizeError(null);
    setStep1Error(null);
    setAiError(null);
    setAiSuccessMsg(null);
    setDraftSavedMsg(null);
    setHydrationError(null);
    setQrModalInfo(null);
    setActiveSignTarget(null);
    setActiveRefusalIndex(null);
    setFinalizedAta(null);
    setAddendumText("");
    setShowVoidForm(false);
    setVoidReason("");
    setPostFinalizeMsg(null);
    setNonConfidentialConfirmed(false);
    setHasPendingLocalEdit(false);
    setReviewedRevision(null);
    setReopenConfirmRevision(null);
    setReopenFeedbackMsg(null);

    if (existingMinute) {
      if (existingMinute.status === "FINALIZED" || existingMinute.status === "VOIDED") {
        setViewMinuteData(existingMinute);
        setMinuteId(existingMinute.id);
        setPhysicalProofHistory(existingMinute.physicalProofHistory || []);
        setPersistedSnapshot(extractPersistedMinuteSnapshot(existingMinute));
        lastPollFingerprintRef.current = buildPollFingerprint(existingMinute as any);
        return;
      }

      setViewMinuteData(null);
      setMinuteId(existingMinute.id || null);
      setContentRevision(
        typeof existingMinute.contentRevision === "number" && existingMinute.contentRevision >= 1
          ? existingMinute.contentRevision
          : 1
      );
      setPhysicalProofMeta({
        physicalScanRevision: existingMinute.physicalScanRevision ?? null,
        physicalScanSupersededAt: existingMinute.physicalScanSupersededAt ?? null,
        hasPhysicalScan: Boolean(existingMinute.hasPhysicalScan),
        physicalSignedScanData: existingMinute.physicalSignedScanData ?? null,
        physicalScanStorageKey: existingMinute.physicalScanStorageKey ?? null,
        govBrVerified: Boolean(existingMinute.govBrVerified),
        govBrProtocol: existingMinute.govBrProtocol ?? null,
      });
      setPhysicalProofHistory(existingMinute.physicalProofHistory || []);
      setPersistedSnapshot(extractPersistedMinuteSnapshot(existingMinute));
      lastPollFingerprintRef.current = buildPollFingerprint(existingMinute as any);
      setAttendedAt(
        existingMinute.attendedAt
          ? typeof existingMinute.attendedAt === "string"
            ? existingMinute.attendedAt
            : new Date(existingMinute.attendedAt).toISOString()
          : new Date().toISOString()
      );
      setSelectedStudentIds(
        existingMinute.students ? existingMinute.students.map((s) => s.studentId) : []
      );
      setCategory(existingMinute.category || "ACOMPANHAMENTO_PEDAGOGICO");
      setIsConfidential(Boolean(existingMinute.isConfidential));
      setSubject(existingMinute.subject || "Atendimento Pedagógico e Alinhamento de Frequência");
      setRawNotes(existingMinute.rawNotes || "");
      setSummary(existingMinute.summary || "");
      setAgreementsSummary(existingMinute.agreementsSummary || "");
      setParticipants(
        (existingMinute.participants || []).map((p, i) =>
          ensureParticipantClientKey({ ...p, originState: "PERSISTED" }, i)
        )
      );
      autoSuggestInitializedRef.current = true;
      setPendingSuggestedActions(null);
      setSignatureResetNotices({});
      setCancelingQrIndex(null);
      setActionItems(
        existingMinute.actionItems
          ? existingMinute.actionItems.map((a) => ({
              id: a.id,
              description: a.description,
              responsible: a.responsible,
              dueDate: a.dueDate ? String(a.dueDate).slice(0, 10) : "",
              status: a.status || "PENDING",
            }))
          : []
      );
      const isDocentExisting =
        existingMinute.category === "ORIENTACAO_DOCENTE" ||
        (!existingMinute.students?.length && existingMinute.participants?.some((p) => p.role === "PROFESSOR"));
      setAtaScope(isDocentExisting ? "TEACHERS" : "STUDENTS");
      setStep(((existingMinute.students?.length ?? 0) > 0 || isDocentExisting) ? 2 : 1);
    } else {
      setViewMinuteData(null);
      setMinuteId(null);
      setContentRevision(1);
      setPhysicalProofMeta({});
      setPhysicalProofHistory([]);
      setPersistedSnapshot(null);
      setReviewedRevision(null);
      lastPollFingerprintRef.current = "";
      setAttendedAt(new Date().toISOString());
      setAtaScope("STUDENTS");
      setNewTeacherName("");
      setNewTeacherEmail("");
      setNewTeacherSubject("");
      setCategory("ACOMPANHAMENTO_PEDAGOGICO");
      setIsConfidential(false);
      setNonConfidentialConfirmed(false);
      setSubject("Atendimento Pedagógico e Alinhamento de Frequência");
      setRawNotes("");
      setSummary("");
      setAgreementsSummary("");
      setPendingSuggestedActions(null);
      setSignatureResetNotices({});
      setCancelingQrIndex(null);
      setActionItems([]);
      autoSuggestInitializedRef.current = false;

      if (preSelectedStudentId) {
        setSelectedStudentIds([preSelectedStudentId]);
        setParticipants([]);
        setStep(2);
      } else {
        setSelectedStudentIds([]);
        setParticipants([]);
        setStep(1);
      }
    }
  }, [isOpen, existingMinute, preSelectedStudentId, availableStudents]);

  // Hidratação completa ao abrir ata existente (listagem GET /api/atas omite signatureData e itens detalhados)
  useEffect(() => {
    if (!isOpen || !existingMinute?.id) {
      setIsHydratingMinute(false);
      setHydrationError(null);
      return;
    }

    const openIdAtStart = editorOpenIdRef.current;
    const revisionAtStart = localRevisionRef.current;
    const controller = new AbortController();
    let active = true;

    setIsHydratingMinute(true);
    setHydrationError(null);

    fetch(`/api/atas/${existingMinute.id}`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          minute?: AtaMinuteRecord;
        };
        if (!active || controller.signal.aborted || openIdAtStart !== editorOpenIdRef.current) {
          return;
        }
        if (!res.ok || !data.minute) {
          setHydrationError(data.error || "Não foi possível carregar os detalhes completos da ata.");
          return;
        }
        if (localRevisionRef.current !== revisionAtStart) {
          return;
        }

        const hydrated = data.minute;
        applyHydratedDraftMinute(hydrated);
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted || openIdAtStart !== editorOpenIdRef.current) {
          return;
        }
        if ((err as { name?: string })?.name === "AbortError") return;
        setHydrationError("Falha de conexão ao carregar os detalhes completos da ata.");
      })
      .finally(() => {
        if (active && !controller.signal.aborted && openIdAtStart === editorOpenIdRef.current) {
          setIsHydratingMinute(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, existingMinute?.id, hydrationRetryKey, applyHydratedDraftMinute]);

  // Sincronização multi-aba contínua quando o modal está aberto em rascunho persistido (mesmo com QR fechado)
  const isQrPanelOpen = Boolean(qrModalInfo);
  useEffect(() => {
    const syncTargetId = minuteId || existingMinute?.id || null;
    if (!isOpen || !syncTargetId || viewMinuteData || finalizedAta) {
      return;
    }

    const handleVisibilityOrFocus = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void syncMinuteFromServer(syncTargetId);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleVisibilityOrFocus);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    }

    let channel: BroadcastChannel | null = null;
    const handleBroadcast = (event: MessageEvent) => {
      const payload = event?.data as { minuteId?: string } | null;
      if (payload?.minuteId === syncTargetId) {
        void syncMinuteFromServer(syncTargetId, { forceFull: true });
      }
    };
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel("redeativa-ata-sync");
        syncChannelRef.current = channel;
        channel.addEventListener("message", handleBroadcast);
      } catch {
        channel = null;
      }
    }

    const intervalId =
      !isQrPanelOpen && typeof window !== "undefined"
        ? window.setInterval(() => {
            if (typeof document !== "undefined" && document.hidden) return;
            void syncMinuteFromServer(syncTargetId);
          }, 3000)
        : null;

    return () => {
      if (intervalId !== null && typeof window !== "undefined") {
        window.clearInterval(intervalId);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleVisibilityOrFocus);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      }
      if (channel) {
        channel.removeEventListener("message", handleBroadcast);
        try {
          channel.close();
        } catch {
          // ignore
        }
        if (syncChannelRef.current === channel) {
          syncChannelRef.current = null;
        }
      }
    };
  }, [
    isOpen,
    minuteId,
    existingMinute?.id,
    viewMinuteData,
    finalizedAta,
    isQrPanelOpen,
    syncMinuteFromServer,
  ]);

  // Atualiza referência síncrona do painel QR e contador informativo de validade
  useEffect(() => {
    qrPanelContextRef.current = {
      isOpen: Boolean(isOpen && qrModalInfo),
      participantId: qrModalInfo?.participantId || null,
    };

    if (!isOpen || !qrModalInfo?.expiresAt) {
      return;
    }

    setValidityNowMs(Date.now());
    const interval = setInterval(() => {
      setValidityNowMs(Date.now());
    }, 15_000);

    return () => {
      clearInterval(interval);
    };
  }, [isOpen, qrModalInfo?.openId, qrModalInfo?.participantId, qrModalInfo?.expiresAt]);

  // Ciclo de vida do cache e limpeza ao fechar modal ou trocar escola ativa
  useEffect(() => {
    const cleanSchoolId = (activeSchoolId || "").trim() || null;
    if (!isOpen || !cleanSchoolId || activeSchoolIdRef.current !== cleanSchoolId) {
      staffReqSeqRef.current += 1;
      contactsReqSeqRef.current += 1;
      activeContactsKeyRef.current = "";
      staffCacheRef.current.clearAll();
      contactsCacheRef.current.clearAll();
      setStaffCandidates([]);
      setStaffTruncated(false);
      setLoadedStudentsWithContacts([]);
      setIsLoadingContacts(false);
      activeSchoolIdRef.current = cleanSchoolId;
    }
  }, [isOpen, activeSchoolId]);

  // Carga separada da equipe escolar (ordenada e limitada), apenas quando activeSchoolId está definido
  useEffect(() => {
    const cleanSchoolId = (activeSchoolId || "").trim();
    if (!isOpen || !cleanSchoolId || viewMinuteData) return;

    const targetMinuteId = minuteId || existingMinute?.id || "";
    const staffSubKey = targetMinuteId ? `staff::${targetMinuteId}` : "staff";
    const cachedStaff = staffCacheRef.current.get(cleanSchoolId, staffSubKey);
    if (cachedStaff) {
      setStaffCandidates(cachedStaff.staff);
      setStaffTruncated(cachedStaff.staffTruncated);
      return;
    }

    const controller = new AbortController();
    const seq = ++staffReqSeqRef.current;
    const params = new URLSearchParams({
      part: "staff",
      schoolId: cleanSchoolId,
    });
    if (targetMinuteId) params.set("minuteId", targetMinuteId);

    fetch(`/api/atas/participant-candidates?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { schoolId?: string; staff?: AtaStaffCandidateOption[]; staffTruncated?: boolean } | null) => {
        if (
          !data ||
          controller.signal.aborted ||
          seq !== staffReqSeqRef.current ||
          activeSchoolIdRef.current !== cleanSchoolId ||
          (data.schoolId && data.schoolId !== cleanSchoolId)
        ) {
          return;
        }
        const safeStaff = Array.isArray(data.staff) ? data.staff : [];
        const isTruncated = Boolean(data.staffTruncated);
        staffCacheRef.current.set(cleanSchoolId, staffSubKey, {
          staff: safeStaff,
          staffTruncated: isTruncated,
        });
        setStaffCandidates(safeStaff);
        setStaffTruncated(isTruncated);
      })
      .catch(() => {});

    return () => {
      controller.abort();
    };
  }, [isOpen, activeSchoolId, viewMinuteData, minuteId, existingMinute?.id]);

  // Carga sob demanda dos contatos dos estudantes selecionados (com AbortController + requestId)
  const selectedStudentIdsKey = useMemo(
    () => [...selectedStudentIds].sort().join(","),
    [selectedStudentIds]
  );

  useEffect(() => {
    const cleanSchoolId = (activeSchoolId || "").trim();
    if (!isOpen || !cleanSchoolId || viewMinuteData || ataScope !== "STUDENTS" || !selectedStudentIdsKey) {
      contactsReqSeqRef.current += 1;
      activeContactsKeyRef.current = "";
      setLoadedStudentsWithContacts([]);
      setIsLoadingContacts(false);
      return;
    }

    const targetMinuteId = minuteId || existingMinute?.id || "";
    const cacheKey = `${targetMinuteId || "new"}::${selectedStudentIdsKey}`;

    const applyLoadedStudents = (loaded: AtaStudentOption[]) => {
      setLoadedStudentsWithContacts(loaded);
      if (
        !targetMinuteId &&
        !autoSuggestInitializedRef.current &&
        loaded.length === 1
      ) {
        const localBundle = buildParticipantCandidates({
          students: loaded,
          staff: [],
        });
        const soleAuto = resolveSingleAutoFillCandidate(localBundle.familyAndGuardianCandidates);
        autoSuggestInitializedRef.current = true;
        setParticipants((prev) => {
          if (prev.length > 0) return prev;
          if (soleAuto) {
            return [
              applyCandidateToParticipantRow(
                ensureParticipantClientKey(
                  {
                    role: soleAuto.targetRole,
                    name: "",
                    kinship: "",
                    documentType: "CPF",
                    documentNumber: "",
                    documentVerifiedByStaff: true,
                    phone: "",
                    signatureMode: "PENDING",
                    signatureData: null,
                    refusalReason: "",
                    witnessName: "",
                  },
                  0
                ),
                soleAuto,
                "AUTO_SUGGESTED"
              ),
            ];
          }
          if (preSelectedStudentId) {
            return [
              ensureParticipantClientKey(
                {
                  role: "RESPONSAVEL",
                  name: "",
                  kinship: "",
                  documentType: "CPF",
                  documentNumber: "",
                  documentVerifiedByStaff: true,
                  phone: "",
                  signatureMode: "PENDING",
                  signatureData: null,
                  refusalReason: "",
                  witnessName: "",
                  originState: "AUTO_SUGGESTED",
                  autoOriginStudentId: loaded[0].id,
                },
                0
              ),
            ];
          }
          return prev;
        });
      }
    };

    const cachedStudents = contactsCacheRef.current.get(cleanSchoolId, cacheKey);
    if (cachedStudents) {
      activeContactsKeyRef.current = cacheKey;
      setIsLoadingContacts(false);
      applyLoadedStudents(cachedStudents);
      return;
    }

    // Limpa sugestões anteriores imediatamente enquanto busca a seleção atual
    setLoadedStudentsWithContacts([]);
    setIsLoadingContacts(true);
    const controller = new AbortController();
    const seq = ++contactsReqSeqRef.current;
    activeContactsKeyRef.current = cacheKey;

    const params = new URLSearchParams({
      part: "contacts",
      schoolId: cleanSchoolId,
    });
    if (targetMinuteId) params.set("minuteId", targetMinuteId);
    for (const sid of selectedStudentIdsKey.split(",")) {
      if (sid) params.append("studentIds", sid);
    }

    fetch(`/api/atas/participant-candidates?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { schoolId?: string; students?: AtaStudentOption[] } | null) => {
        if (
          !data ||
          controller.signal.aborted ||
          seq !== contactsReqSeqRef.current ||
          activeContactsKeyRef.current !== cacheKey ||
          activeSchoolIdRef.current !== cleanSchoolId ||
          (data.schoolId && data.schoolId !== cleanSchoolId)
        ) {
          return;
        }
        const safeStudents = Array.isArray(data.students) ? data.students : [];
        contactsCacheRef.current.set(cleanSchoolId, cacheKey, safeStudents);
        applyLoadedStudents(safeStudents);
      })
      .catch(() => {})
      .finally(() => {
        if (
          !controller.signal.aborted &&
          seq === contactsReqSeqRef.current &&
          activeContactsKeyRef.current === cacheKey
        ) {
          setIsLoadingContacts(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [isOpen, activeSchoolId, viewMinuteData, ataScope, selectedStudentIdsKey, minuteId, existingMinute?.id, preSelectedStudentId]);

  const candidateBundle = useMemo(() => {
    const cleanSchoolId = (activeSchoolId || "").trim();
    if (!cleanSchoolId) {
      return buildParticipantCandidates({
        students: [],
        staff: [],
        teacherDraftParticipants: participants,
      });
    }
    const studentsForCandidates =
      ataScope === "STUDENTS"
        ? loadedStudentsWithContacts.filter((s) => selectedStudentIds.includes(s.id))
        : [];
    return buildParticipantCandidates({
      students: studentsForCandidates,
      staff: staffCandidates,
      teacherDraftParticipants: participants,
    });
  }, [activeSchoolId, ataScope, loadedStudentsWithContacts, selectedStudentIds, staffCandidates, participants]);

  // Lista única de turmas para filtro
  const turmasList = useMemo(() => {
    const set = new Set<string>();
    availableStudents.forEach((s) => {
      if (s.classGroupName) set.add(s.classGroupName);
    });
    return Array.from(set).sort();
  }, [availableStudents]);

  // Alunos filtrados no passo 1
  const filteredStudents = useMemo(() => {
    const query = studentSearch.toLowerCase().trim();
    return availableStudents.filter((s) => {
      const matchTurma =
        selectedTurmaFilter === "TODAS" || s.classGroupName === selectedTurmaFilter;
      if (!matchTurma) return false;

      if (!query) return true;
      const matchName = s.name.toLowerCase().includes(query);
      const matchCgm = s.cgm?.toLowerCase().includes(query);
      const matchGuardian = s.guardianName?.toLowerCase().includes(query);
      return matchName || matchCgm || matchGuardian;
    });
  }, [availableStudents, studentSearch, selectedTurmaFilter]);

  // Toggle de seleção do aluno (remove apenas sugestões intocadas do aluno desmarcado)
  const handleToggleStudent = (student: AtaStudentOption) => {
    if (isContentLocked) return;
    markLocalEdit();
    setStep1Error(null);
    const isSelected = selectedStudentIds.includes(student.id);
    const nextIds = isSelected
      ? selectedStudentIds.filter((id) => id !== student.id)
      : [...selectedStudentIds, student.id];

    if (isSelected) {
      setParticipants((prev) => pruneUntouchedSuggestionsForRemovedStudents(prev, nextIds));
    }
    setSelectedStudentIds(nextIds);
  };

  // Adição inline de professor orientado (Etapa 1)
  const handleAddTeacherParticipant = () => {
    if (isContentLocked) return;
    const cleanName = newTeacherName.trim();
    if (!cleanName) {
      setStep1Error("Informe o nome completo do(a) professor(a).");
      return;
    }
    markLocalEdit();
    setStep1Error(null);
    const cleanEmail = newTeacherEmail.trim().toLowerCase();
    const cleanSubject = newTeacherSubject.trim();

    setParticipants((prev) => [
      ...prev,
      ensureParticipantClientKey(
        {
          role: "PROFESSOR",
          name: cleanName,
          kinship: cleanSubject ? `Docente — ${cleanSubject}` : "Professor(a)",
          documentType: "OUTRO",
          documentNumber: "",
          documentVerifiedByStaff: true,
          phone: "",
          expectedEmail: cleanEmail || null,
          signatureMode: "PENDING",
          signatureData: null,
          refusalReason: "",
          witnessName: "",
          originState: "EXPLICIT_CANDIDATE",
        },
        prev.length
      ),
    ]);
    setNewTeacherName("");
    setNewTeacherEmail("");
    setNewTeacherSubject("");
  };

  const handleRemoveTeacherParticipant = (indexToRemove: number) => {
    if (isContentLocked) return;
    markLocalEdit();
    setParticipants((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const closeQrPanel = () => {
    qrRequestSeqRef.current += 1;
    qrGenerationInFlightRef.current = false;
    qrPanelContextRef.current = { isOpen: false, participantId: null };
    setIsGeneratingQr(false);
    setQrModalInfo(null);
  };

  // Hook resiliente de polling para detecção de assinatura via QR Code
  const {
    uiState: qrUiState,
    handleRetryAction: handleQrRetryAction,
    refreshMinute: refreshQrMinute,
  } = useQrSignaturePolling({
    minuteId,
    qrModalInfo,
    onParticipantsSynced: (newParts) => {
      setParticipants((prev) => reconcileSavedParticipantsWithPersistedState(prev, newParts));
    },
    onMinuteSynced: (syncedMinute) => {
      if (syncedMinute.status === "FINALIZED" || syncedMinute.status === "VOIDED") {
        applyHydratedDraftMinute(syncedMinute);
        broadcastMinuteSync(syncedMinute.id, "qr-finalized");
        return;
      }
      if (typeof syncedMinute.contentRevision === "number" && syncedMinute.contentRevision >= 1) {
        setContentRevision(syncedMinute.contentRevision);
      }
      setPhysicalProofMeta({
        physicalScanRevision: syncedMinute.physicalScanRevision ?? null,
        physicalScanSupersededAt: syncedMinute.physicalScanSupersededAt ?? null,
        hasPhysicalScan: Boolean(syncedMinute.hasPhysicalScan),
        physicalSignedScanData: syncedMinute.physicalSignedScanData ?? null,
        physicalScanStorageKey: syncedMinute.physicalScanStorageKey ?? null,
        govBrVerified: Boolean(syncedMinute.govBrVerified),
        govBrProtocol: syncedMinute.govBrProtocol ?? null,
      });
      if (Array.isArray(syncedMinute.physicalProofHistory)) {
        setPhysicalProofHistory(syncedMinute.physicalProofHistory);
      }
      if (syncedMinute.subject !== undefined) {
        setPersistedSnapshot(extractPersistedMinuteSnapshot(syncedMinute));
      }
      lastPollFingerprintRef.current = buildPollFingerprint(syncedMinute as any);
      setHasPendingLocalEdit(false);
      broadcastMinuteSync(syncedMinute.id, "qr-synced");
    },
    onCompletedClose: () => {
      closeQrPanel();
    },
    onSaved,
  });

  // Ditado por voz nativo pt-BR
  const toggleSpeechRecognition = () => {
    if (isContentLocked) return;
    setAiError(null);
    if (isListening) {
      setIsListening(false);
      return;
    }

    const speechWin = window as unknown as SpeechRecognitionWindow;
    const SpeechRecognition =
      speechWin.SpeechRecognition || speechWin.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setAiError("Seu navegador não possui suporte para reconhecimento de voz nativo.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "pt-BR";
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event: SpeechRecognitionResultEvent) => {
        if (isContentLocked) return;
        markLocalEdit();
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript + " ";
        }
        setRawNotes((prev: string) => (prev ? `${prev}\n${transcript.trim()}` : transcript.trim()));
      };

      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  // Formalização e Revisão com Diretrizes NRE/SEED-PR
  const handleFormalizeWithAi = async () => {
    if (isContentLocked) {
      setAiError(
        "Esta ata já possui assinatura registrada na revisão atual. Utilize 'Reabrir para edição' se precisar alterar o conteúdo."
      );
      return;
    }
    setAiError(null);
    setAiSuccessMsg(null);
    const hasNotes = Boolean(rawNotes && rawNotes.trim().length >= 3);
    const hasExistingSummary = Boolean(summary && summary.trim().length >= 5);

    if (!hasNotes && !hasExistingSummary) {
      setAiError("Digite anotações no quadro acima ou insira um texto para revisão.");
      return;
    }

    setIsAiLoading(true);
    try {
      const studentNames = availableStudents
        .filter((s) => selectedStudentIds.includes(s.id))
        .map((s) => s.name);
      const guardianNames = participants
        .filter((p) => p.role !== "PROFESSOR" && p.role !== "EQUIPE_ESCOLAR")
        .map((p) => p.name)
        .filter(Boolean);
      const teacherNames = participants
        .filter((p) => p.role === "PROFESSOR" || p.role === "EQUIPE_ESCOLAR")
        .map((p) => p.name)
        .filter(Boolean);

      const headers: Record<string, string> = { "Content-Type": "application/json" };

      const res = await fetch("/api/ai/formalize-ata", {
        method: "POST",
        headers,
        body: JSON.stringify({
          minuteId: minuteId || existingMinute?.id || undefined,
          isConfidential,
          nonConfidentialConfirmed,
          ataScope,
          studentIds: selectedStudentIds,
          subject: subject.trim() || undefined,
          rawNotes: rawNotes.trim(),
          existingSummary: summary.trim(),
          category,
          studentNames,
          guardianNames,
          teacherNames,
          attendedAt: attendedAt || new Date().toISOString(),
        }),
      });

      const rawText = await res.text();
      let data: FormalizeAtaApiResponse | null = null;
      try {
        data = JSON.parse(rawText) as FormalizeAtaApiResponse;
      } catch {
        throw new Error(
          `Servidor retornou resposta inválida (HTTP ${res.status}). Verifique a conexão com a IA.`
        );
      }

      if (!res.ok) throw new Error(data?.error || "Erro ao revisar minuta");

      if (data.result) {
        if (isContentLocked) return;
        markLocalEdit();
        if (data.result.formalSubject) setSubject(data.result.formalSubject);
        if (data.result.formalSummary) setSummary(data.result.formalSummary);
        if (data.result.agreementsSummary) setAgreementsSummary(data.result.agreementsSummary);

        if (data.result.actionItems && Array.isArray(data.result.actionItems) && data.result.actionItems.length > 0) {
          const suggested: AtaActionItemDraft[] = data.result.actionItems
            .map((a) => {
              const desc =
                typeof a === "string"
                  ? a
                  : a.description ||
                    a.descricao ||
                    a.acao ||
                    a.item ||
                    a.task ||
                    a.texto ||
                    "";
              const resp =
                typeof a === "object" && a !== null
                  ? a.responsible || a.responsavel || "FAMILIA"
                  : "FAMILIA";
              return {
                description: String(desc || "").trim(),
                responsible: resp,
                dueDate: "",
              };
            })
            .filter((item) => item.description.length > 0);

          if (suggested.length > 0) {
            const decision = applyPendingAiActionItemsDecision(
              actionItemsRef.current,
              suggested
            );
            if (decision.pendingSuggestions) {
              setPendingSuggestedActions(decision.pendingSuggestions);
            } else {
              setActionItems(decision.nextItems);
              setPendingSuggestedActions(null);
            }
          }
        }

        if (data.usedFallback) {
          const guidance =
            data.fallbackReason ||
            "Minuta gerada localmente para revisão da equipe antes da confirmação.";

          setAiSuccessMsg({
            type: "warning",
            text: guidance,
          });
        } else {
          setAiSuccessMsg({
            type: "success",
            text: "Minuta revisada e estruturada. Confira os dados e o texto antes de confirmar a ata.",
          });
          setTimeout(() => setAiSuccessMsg(null), 5000);
        }
      }
    } catch (err: unknown) {
      setAiError(getErrorMessage(err, "Erro ao formalizar e revisar minuta."));
    } finally {
      setIsAiLoading(false);
    }
  };

  // Monta payload limpo e higienizado para envio à API
  const buildSanitizedPayload = (overrideParticipants?: AtaParticipantDraft[]) => {
    const cleanSubject = subject.trim().length >= 2 ? subject.trim() : "Atendimento Pedagógico";
    const sourceParticipants = overrideParticipants ?? participants;

    const cleanParticipants = sourceParticipants
      .filter((p) => {
        if (!p) return false;
        const sig = getParticipantSignatureSummary(p);
        return Boolean(p.name?.trim() || sig.hasPersistedSignature || sig.isRefused || p.id);
      })
      .map((p) => {
        const trimmedName = (p.name || "").trim();
        return stripClientParticipantMeta({
          ...p,
          name: trimmedName.length >= 2 ? trimmedName : "Responsável Presente",
        });
      });

    const cleanActions = actionItems
      .filter((a) => a && typeof a.description === "string" && a.description.trim().length >= 2)
      .map((a) => ({
        ...a,
        description: a.description.trim(),
        dueDate: a.dueDate && String(a.dueDate).trim() !== "" ? a.dueDate : null,
      }));

    return {
      expectedRevision: contentRevision,
      category,
      isConfidential,
      attendedAt: attendedAt || new Date().toISOString(),
      subject: cleanSubject,
      rawNotes: rawNotes.length > 0 ? rawNotes : null,
      summary,
      agreementsSummary: agreementsSummary.length > 0 ? agreementsSummary : null,
      studentIds: selectedStudentIds,
      participants: cleanParticipants,
      actionItems: cleanActions,
      extemporaneousReason: extemporaneousReason.trim() || null,
    };
  };

  // Função interna de persistência de rascunho (sem interferir em estados de loading externos)
  const saveDraftInternal = async () => {
    const payload = buildSanitizedPayload();
    const targetId = minuteId || existingMinute?.id;
    const url = targetId ? `/api/atas/${targetId}` : "/api/atas";
    const method = targetId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { error?: string; minute?: AtaMinuteRecord };
    if (!res.ok) {
      if (res.status === 409 && targetId) {
        void syncMinuteFromServer(targetId, { forceFull: true, notice: data.error });
      }
      throw new Error(data.error || "Erro ao salvar rascunho da ata.");
    }

    if (data.minute?.id) {
      setMinuteId(data.minute.id);
      if (typeof data.minute.contentRevision === "number" && data.minute.contentRevision >= 1) {
        setContentRevision(data.minute.contentRevision);
      }
      setPhysicalProofMeta({
        physicalScanRevision: data.minute.physicalScanRevision ?? null,
        physicalScanSupersededAt: data.minute.physicalScanSupersededAt ?? null,
        hasPhysicalScan: Boolean(data.minute.hasPhysicalScan),
        physicalSignedScanData: data.minute.physicalSignedScanData ?? null,
        physicalScanStorageKey: data.minute.physicalScanStorageKey ?? null,
        govBrVerified: Boolean(data.minute.govBrVerified),
        govBrProtocol: data.minute.govBrProtocol ?? null,
      });
      if (Array.isArray(data.minute.physicalProofHistory)) {
        setPhysicalProofHistory(data.minute.physicalProofHistory);
      }
      setPersistedSnapshot(extractPersistedMinuteSnapshot(data.minute));
      lastPollFingerprintRef.current = buildPollFingerprint(data.minute as any);
      setHasPendingLocalEdit(false);
      setReviewedRevision(null);
      if (data.minute.participants) {
        setParticipants((prev) =>
          reconcileSavedParticipantsWithPersistedState(prev, data.minute!.participants)
        );
      }
      broadcastMinuteSync(data.minute.id, "draft-saved");
    }

    return data.minute;
  };

  // Botão "Salvar Rascunho"
  const handleSaveDraft = async () => {
    if (isHydratingMinute || hydrationError || isContentLocked) return null;
    const hasPart = participants.length > 0;
    if (selectedStudentIds.length === 0 && !hasPart) {
      setStep(1);
      setStep1Error("Selecione pelo menos um estudante ou adicione um(a) professor(a)/participante para vincular a esta ata.");
      return null;
    }

    setSaving(true);
    setFinalizeError(null);
    setDraftSavedMsg(null);
    try {
      const saved = await saveDraftInternal();
      setDraftSavedMsg(
        `Rascunho salvo na revisão ${saved?.contentRevision ?? contentRevision}. Confira os dados persistidos antes de coletar assinaturas.`
      );
      onSaved();
      setTimeout(() => setDraftSavedMsg(null), 5000);
      return saved;
    } catch (err: unknown) {
      setFinalizeError(getErrorMessage(err, "Erro ao salvar rascunho."));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const isExtemporaneousMeeting = useMemo(() => {
    const dateStr = attendedAt || existingMinute?.attendedAt;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return calculateBusinessDaysDiff(d, new Date()) > 5;
  }, [attendedAt, existingMinute]);

  // Botão "Lavrar Ata" — envia apenas confirmação por PIN e justificativa extemporânea quando já houver assinatura
  const handleFinalize = async (overridePin?: string) => {
    if (isHydratingMinute || hydrationError) return;
    if (revisionLockState.hasLegacyUnprovableProof) {
      setFinalizeError(
        "Esta ata possui assinatura anterior sem comprovação de revisão. Utilize 'Reabrir para edição' e faça a recoleta antes de lavrar."
      );
      return;
    }
    setFinalizeError(null);
    setDraftSavedMsg(null);

    const hasPart = participants.length > 0;
    if (selectedStudentIds.length === 0 && !hasPart) {
      setStep(1);
      setStep1Error("Selecione pelo menos um estudante ou adicione um(a) professor(a)/participante antes de lavrar a ata.");
      return;
    }

    if (!hasMinimumOfficialSummary(summary)) {
      if (rawNotes && rawNotes.trim().length >= 10) {
        setFinalizeError(
          'O campo "Texto Oficial da Ata" está vazio. Clique em "Formalizar & Revisar" acima para estruturar a minuta a partir das anotações, ou redija o texto diretamente.'
        );
      } else {
        setFinalizeError(
          "É necessário preencher o Texto Oficial da Ata (mínimo de 10 caracteres) antes de lavrar."
        );
      }
      return;
    }

    // Validação de lavratura extemporânea (> 5 dias úteis)
    if (isExtemporaneousMeeting && (!extemporaneousReason || extemporaneousReason.trim().length < 5)) {
      setFinalizeError(
        "Este atendimento ocorreu há mais de 5 dias úteis. Preencha a justificativa de registro extemporâneo antes de lavrar."
      );
      return;
    }

    if (!overridePin) {
      setShowPinModal(true);
      return;
    }

    setSavingFinal(true);
    try {
      let targetId = minuteId || existingMinute?.id;
      let targetRevision = contentRevision;

      // Quando não há assinatura travando o rascunho e ainda não existe ID, cria o rascunho inicial primeiro
      if (!targetId) {
        const created = await saveDraftInternal();
        if (!created?.id) {
          throw new Error("Não foi possível registrar os dados iniciais da ata.");
        }
        targetId = created.id;
        if (typeof created.contentRevision === "number") {
          targetRevision = created.contentRevision;
        }
      }

      // Quando já houver assinatura válida na revisão, não reenvia nem altera o conteúdo assinado
      const payload = isContentLocked
        ? {
            signingPin: overridePin,
            expectedRevision: targetRevision,
            extemporaneousReason: extemporaneousReason.trim() || undefined,
          }
        : {
            ...buildSanitizedPayload(),
            expectedRevision: targetRevision,
            signingPin: overridePin,
            extemporaneousReason: extemporaneousReason.trim() || undefined,
          };
      const res = await fetch(`/api/atas/${targetId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { error?: string; minute?: AtaMinuteRecord };
      if (!res.ok) {
        if (data.error && data.error.includes("PIN_REQUIRED")) {
          setPendingPinAction("finalize");
          setShowPinModal(true);
          return;
        }
        if (res.status === 409 && targetId) {
          void syncMinuteFromServer(targetId, { forceFull: true, notice: data.error });
        }
        throw new Error(data.error || "Erro ao confirmar ata no servidor.");
      }

      if (!data.minute) {
        throw new Error("Resposta inválida do servidor ao confirmar ata.");
      }

      const finalizedWithHistory: AtaMinuteRecord = {
        ...data.minute,
        physicalProofHistory: data.minute.physicalProofHistory ?? physicalProofHistory,
      };
      lastPollFingerprintRef.current = buildPollFingerprint(finalizedWithHistory as any);
      setActiveSignTarget(null);
      broadcastMinuteSync(targetId, "finalize");
      setFinalizedAta(finalizedWithHistory);
      onSaved();
    } catch (err: unknown) {
      console.error("[handleFinalize] Erro:", err);
      setFinalizeError(getErrorMessage(err, "Erro inesperado ao confirmar ata."));
    } finally {
      setSavingFinal(false);
    }
  };

  // Gerar QR Code ou Link remoto para participante assinar na revisão conferida
  const handleGenerateMobileSign = async (
    index: number,
    durationMinutes = signDurationOption,
    expectedOpenParticipantId?: string
  ) => {
    if (isHydratingMinute || hydrationError || qrGenerationInFlightRef.current) return;
    if (revisionLockState.hasLegacyUnprovableProof) {
      setFinalizeError(
        "Esta ata possui assinatura anterior sem comprovação de revisão. Utilize 'Reabrir para edição' antes de emitir novos links."
      );
      return;
    }

    setFinalizeError(null);
    const currentLocal = participants[index];
    if (!currentLocal?.name?.trim()) {
      setFinalizeError("Informe o nome do participante antes de gerar o link de assinatura.");
      return;
    }

    const hasParticipant = participants.some((p) => p && p.name && p.name.trim().length > 0);
    if (selectedStudentIds.length === 0 && !hasParticipant) {
      setFinalizeError("Vincule pelo menos um estudante ou adicione um(a) professor(a)/participante antes de gerar o link de assinatura.");
      return;
    }

    if (!persistedHasMinimumSummary) {
      setFinalizeError(OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR);
      return;
    }

    if (!isCurrentRevisionConfirmed) {
      setFinalizeError(
        hasPendingLocalEdit || !(minuteId || existingMinute?.id)
          ? "Salve o rascunho e confirme a conferência da revisão antes de emitir o link de assinatura."
          : `Confirme a conferência da Revisão ${contentRevision} antes de emitir o link de assinatura.`
      );
      return;
    }

    qrGenerationInFlightRef.current = true;
    const reqSeq = ++qrRequestSeqRef.current;
    const openIdAtStart = editorOpenIdRef.current;
    const isRenewal = Boolean(expectedOpenParticipantId);

    setIsGeneratingQr(true);
    try {
      const targetMinuteId = minuteId || existingMinute?.id || null;
      const targetPartId = currentLocal.id || null;
      const targetPartName = currentLocal.name;
      const expectedRevision = contentRevision;

      if (
        isRenewal &&
        (!qrPanelContextRef.current.isOpen ||
          qrPanelContextRef.current.participantId !== expectedOpenParticipantId)
      ) {
        return;
      }

      if (!targetMinuteId || !targetPartId) {
        throw new Error("Salve o rascunho e confirme a conferência da revisão antes de emitir o link.");
      }

      const res = await fetch(`/api/atas/${targetMinuteId}/sign-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: targetPartId,
          expiresInMinutes: durationMinutes,
          expectedRevision,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        signUrl: string;
        expiresAt?: string;
        expiresInMinutes?: number;
        contentRevision?: number;
        participantName?: string;
      };
      if (!res.ok) {
        if (res.status === 409) {
          void syncMinuteFromServer(targetMinuteId, { forceFull: true, notice: data.error });
        }
        throw new Error(data.error || "Falha ao gerar link de assinatura");
      }

      if (reqSeq !== qrRequestSeqRef.current || openIdAtStart !== editorOpenIdRef.current) {
        return;
      }
      if (
        isRenewal &&
        (!qrPanelContextRef.current.isOpen ||
          qrPanelContextRef.current.participantId !== expectedOpenParticipantId)
      ) {
        return;
      }

      setMinuteId(targetMinuteId);
      if (typeof data.contentRevision === "number" && data.contentRevision >= 1) {
        setContentRevision(data.contentRevision);
      }
      setParticipants((prev) =>
        prev.map((item) =>
          item.id === targetPartId ? { ...item, hasActiveSignLink: true } : item
        )
      );
      broadcastMinuteSync(targetMinuteId, "sign-token");
      const nextInfo = {
        participantId: targetPartId,
        url: data.signUrl,
        name: data.participantName || targetPartName,
        expiresInMinutes: data.expiresInMinutes || durationMinutes,
        expiresAt: data.expiresAt || null,
        participantRole: currentLocal?.role || "PARTICIPANTE",
        openId:
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `open-${Date.now()}-${Math.random()}`,
      };
      qrPanelContextRef.current = { isOpen: true, participantId: nextInfo.participantId };
      setQrModalInfo(nextInfo);
      onSaved();
    } catch (err: unknown) {
      if (reqSeq === qrRequestSeqRef.current && openIdAtStart === editorOpenIdRef.current) {
        setFinalizeError(getErrorMessage(err, "Erro ao gerar link de assinatura móvel."));
      }
    } finally {
      if (reqSeq === qrRequestSeqRef.current) {
        qrGenerationInFlightRef.current = false;
        setIsGeneratingQr(false);
      }
    }
  };

  // Assinatura em tela com persistência imediata vinculada à revisão conferida
  const handleScreenSignatureConfirm = async (
    index: number,
    dataUrl: string,
    strokeData?: string,
    capturedRevision?: number,
    capturedParticipantId?: string
  ) => {
    if (
      isHydratingMinute ||
      hydrationError ||
      savingScreenSigIndex !== null ||
      screenSigInFlightRef.current
    ) {
      return;
    }
    if (revisionLockState.hasLegacyUnprovableProof) {
      setFinalizeError(
        "Esta ata possui assinatura anterior sem comprovação de revisão. Utilize 'Reabrir para edição' antes de coletar novas assinaturas."
      );
      return;
    }

    const currentLocal = participants[index];
    if (!currentLocal?.name?.trim()) {
      setFinalizeError("Informe o nome do participante antes de confirmar a assinatura.");
      return;
    }

    const expectedRevision = capturedRevision ?? activeSignTarget?.revision ?? contentRevision;
    const expectedParticipantId = capturedParticipantId ?? activeSignTarget?.participantId ?? currentLocal.id;

    if (
      !persistedHasMinimumSummary ||
      !isCurrentRevisionConfirmed ||
      hasPendingLocalEdit ||
      !persistedSnapshot ||
      persistedSnapshot.contentRevision !== expectedRevision ||
      expectedRevision !== contentRevision ||
      currentLocal.id !== expectedParticipantId
    ) {
      setActiveSignTarget(null);
      setFinalizeError(
        !persistedHasMinimumSummary
          ? OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR
          : hasPendingLocalEdit || !(minuteId || existingMinute?.id)
            ? "Salve o rascunho e confirme a conferência da revisão antes de registrar a assinatura em tela."
            : `Confirme a conferência da Revisão ${contentRevision} antes de coletar a assinatura em tela.`
      );
      return;
    }

    screenSigInFlightRef.current = true;
    setFinalizeError(null);
    setSavingScreenSigIndex(index);
    try {
      const targetMinuteId = minuteId || existingMinute?.id || null;
      const targetPartId = expectedParticipantId || null;

      if (!targetMinuteId || !targetPartId) {
        throw new Error("Salve o rascunho e confirme a conferência da revisão antes de assinar em tela.");
      }

      const res = await fetch(`/api/atas/${targetMinuteId}/sign-screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: targetPartId,
          expectedRevision,
          signatureData: dataUrl,
          biometricStrokeData: strokeData || null,
          clientTimestampIso: new Date().toISOString(),
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        contentRevision?: number;
        minute?: AtaMinuteRecord;
      };
      if (!res.ok || !data.minute) {
        if (res.status === 409) {
          void syncMinuteFromServer(targetMinuteId, { forceFull: true, notice: data.error });
        }
        throw new Error(data.error || "Não foi possível gravar a assinatura em tela.");
      }

      const updatedMinute: AtaMinuteRecord = {
        ...data.minute,
        physicalProofHistory: data.minute.physicalProofHistory ?? physicalProofHistory,
      };
      applyHydratedDraftMinute(updatedMinute, { preserveReviewedRevision: true });
      setActiveSignTarget(null);
      setDraftSavedMsg("Assinatura em tela registrada na revisão vigente. O conteúdo da ata foi travado para edição.");
      broadcastMinuteSync(targetMinuteId, "sign-screen");
      onSaved();
    } catch (err: unknown) {
      setFinalizeError(getErrorMessage(err, "Erro ao registrar assinatura em tela."));
    } finally {
      screenSigInFlightRef.current = false;
      setSavingScreenSigIndex(null);
    }
  };

  // Reabertura explícita autorizada: invalida todas as assinaturas/links e avança revisão no servidor
  const handleReopenForEditing = async () => {
    const targetId = minuteId || existingMinute?.id;
    const confirmedRevision = reopenConfirmRevisionRef.current;
    if (!targetId || isReopening || confirmedRevision === null) return;

    setIsReopening(true);
    setFinalizeError(null);
    setReopenFeedbackMsg(null);
    try {
      const res = await fetch(`/api/atas/${targetId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmReopen: true,
          expectedRevision: confirmedRevision,
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        invalidatedRevision?: number;
        contentRevision?: number;
        minute?: AtaMinuteRecord;
      };

      if (!res.ok || !data.minute) {
        if (res.status === 409) {
          setReopenConfirmRevision(null);
          await syncMinuteFromServer(targetId, { forceFull: true });
        }
        throw new Error(data.error || "Não foi possível reabrir a ata para edição.");
      }

      closeQrPanel();
      setActiveSignTarget(null);
      setActiveRefusalIndex(null);
      setSignatureResetNotices({});
      setSignatureResetErrors({});
      setReopenConfirmRevision(null);
      setReviewedRevision(null);

      applyHydratedDraftMinute(data.minute);
      const nextRev =
        typeof data.contentRevision === "number" && data.contentRevision >= 1
          ? data.contentRevision
          : typeof data.minute.contentRevision === "number"
            ? data.minute.contentRevision
            : confirmedRevision + 1;
      setReopenFeedbackMsg(
        `Edição liberada na revisão ${nextRev}. Todas as assinaturas e links da revisão anterior (${data.invalidatedRevision ?? confirmedRevision}) foram invalidados.`
      );
      broadcastMinuteSync(data.minute.id, "reopen");
      onSaved();
    } catch (err: unknown) {
      setFinalizeError(getErrorMessage(err, "Erro ao reabrir a ata para edição."));
    } finally {
      setIsReopening(false);
    }
  };

  // Cancelamento direcionado de link QR pendente (antes da assinatura) com sincronização imediata no servidor
  const handleCancelParticipantQr = async (index: number, nextRoleAfterCancel?: string) => {
    const target = participants[index];
    if (!target || cancelingQrIndex !== null) return;

    const activeMinuteId = minuteId || existingMinute?.id;
    closeQrPanel();

    if (!target.id || !activeMinuteId) {
      markLocalEdit();
      setParticipants((prev) =>
        prev.map((item, i) => {
          if (i !== index) return item;
          const cleared = { ...item, hasActiveSignLink: false };
          return nextRoleAfterCancel
            ? resolveRoleChangeWithCandidates(cleared, nextRoleAfterCancel, candidateBundle)
            : cleared;
        })
      );
      return;
    }

    setCancelingQrIndex(index);
    setFinalizeError(null);
    try {
      const res = await fetch(`/api/atas/${activeMinuteId}/sign-token`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: target.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (res.status === 409) {
        setFinalizeError(
          data.error ||
            "Este participante já concluiu a assinatura no celular. A alteração não foi aplicada."
        );
        try {
          const freshRes = await fetch(`/api/atas/${activeMinuteId}`, { cache: "no-store" });
          if (freshRes.ok) {
            const freshData = (await freshRes.json()) as { minute?: AtaMinuteRecord };
            if (freshData.minute?.participants) {
              setParticipants((prev) =>
                reconcileSavedParticipantsWithPersistedState(prev, freshData.minute!.participants)
              );
            }
          }
        } catch {
          // Mantém erro visível mesmo se recarga auxiliar falhar
        }
        return;
      }

      if (!res.ok) {
        setFinalizeError(
          data.error ||
            "Não foi possível cancelar o link QR no servidor. A alteração não foi aplicada."
        );
        return;
      }

      markLocalEdit();
      setParticipants((prev) =>
        prev.map((item, i) => {
          if (i !== index) return item;
          const cleared = { ...item, hasActiveSignLink: false };
          return nextRoleAfterCancel
            ? resolveRoleChangeWithCandidates(cleared, nextRoleAfterCancel, candidateBundle)
            : cleared;
        })
      );
      broadcastMinuteSync(activeMinuteId, "cancel-qr");
      onSaved();
    } catch {
      setFinalizeError(
        "Falha de conexão ao cancelar o link QR no servidor. A alteração não foi aplicada."
      );
    } finally {
      setCancelingQrIndex(null);
    }
  };

  // Remoção explícita de assinatura/recusa com confirmação obrigatória no servidor antes de liberar identidade
  const handleResetParticipantSignature = async (index: number) => {
    if (isContentLocked || resettingSigIndex !== null || cancelingQrIndex !== null) return;
    const target = participants[index];
    if (!target) return;

    const sigSummary = getParticipantSignatureSummary(target);
    const activeMinuteId = minuteId || existingMinute?.id;
    setResettingSigIndex(index);
    setFinalizeError(null);
    setSignatureResetErrors((prev) => {
      if (!(index in prev)) return prev;
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });

    try {
      const result = await resetParticipantSignatureWithServer({
        minuteId: activeMinuteId,
        participantIndex: index,
        participants,
        buildPayload: (nextParts) => buildSanitizedPayload(nextParts),
      });

      if (!result.ok) {
        const errMsg =
          result.error ||
          (sigSummary.isRefused
            ? "Não foi possível cancelar a recusa no servidor. O registro anterior foi mantido."
            : "Não foi possível remover a assinatura no servidor. A assinatura anterior foi mantida.");
        setFinalizeError(errMsg);
        setSignatureResetErrors((prev) => ({
          ...prev,
          [index]: errMsg,
        }));
        return;
      }

      markLocalEdit();
      if (target.id && qrModalInfo?.participantId === target.id) {
        closeQrPanel();
      }
      if (activeSignTarget?.index === index) {
        setActiveSignTarget(null);
      }
      setParticipants((prev) => reconcileSavedParticipantsWithPersistedState(prev, result.participants));

      if (sigSummary.hasPersistedSignature) {
        setSignatureResetNotices((prev) => ({
          ...prev,
          [index]:
            "Assinatura anterior removida. Os campos foram liberados e será necessária uma nova assinatura.",
        }));
      } else if (sigSummary.isRefused) {
        setSignatureResetNotices((prev) => ({
          ...prev,
          [index]: "Registro de recusa cancelado. Os campos foram liberados.",
        }));
      }

      if (result.persistedOnServer) {
        onSaved();
      }
    } finally {
      setResettingSigIndex(null);
    }
  };

  // Atalho de 1 clique: Incluir Estudante(s) selecionados como participante(s) da ata
  const handleAddSelectedStudentsAsParticipants = () => {
    if (isContentLocked) return;
    markLocalEdit();
    const loadedMap = new Map(loadedStudentsWithContacts.map((s) => [s.id, s]));
    const selected = availableStudents
      .filter((s) => selectedStudentIds.includes(s.id))
      .map((s) => loadedMap.get(s.id) || s);
    if (selected.length === 0) return;

    setParticipants((prev) => {
      const copy = [...prev];
      selected.forEach((stu) => {
        const alreadyExists = copy.some(
          (p) => p.studentId === stu.id && (p.role || "").toUpperCase() === "ESTUDANTE"
        );
        if (!alreadyExists) {
          const studentCandidate = candidateBundle.byKey[`student:${stu.id}`];
          if (studentCandidate) {
            copy.push(
              applyCandidateToParticipantRow(
                ensureParticipantClientKey(
                  {
                    role: "ESTUDANTE",
                    studentId: stu.id,
                    name: stu.name,
                    kinship: null,
                    documentType: "CGM",
                    documentNumber: stu.cgm || "",
                    documentVerifiedByStaff: true,
                    phone: stu.phone || "",
                    expectedEmail: stu.email || null,
                    signatureMode: "PENDING",
                    signatureData: null,
                    refusalReason: "",
                    witnessName: "",
                  },
                  copy.length
                ),
                studentCandidate,
                "EXPLICIT_CANDIDATE"
              )
            );
          } else {
            copy.push(
              ensureParticipantClientKey(
                {
                  role: "ESTUDANTE",
                  studentId: stu.id,
                  name: stu.name,
                  kinship: null,
                  documentType: "CGM",
                  documentNumber: stu.cgm || "",
                  documentVerifiedByStaff: true,
                  phone: stu.phone || "",
                  expectedEmail: stu.email || null,
                  signatureMode: "PENDING",
                  signatureData: null,
                  refusalReason: "",
                  witnessName: "",
                  originState: "EXPLICIT_CANDIDATE",
                },
                copy.length
              )
            );
          }
        }
      });
      return copy;
    });
  };

  // Handlers de Ata Já Lavrada (Adendo, Status de Ação, Tornar Sem Efeito)
  const handleAddAddendum = async (overridePin?: string) => {
    if (!viewMinuteData?.id) return;
    if (addendumText.trim().length < 5) {
      setPostFinalizeMsg({ type: "err", text: "O texto do aditamento deve ter pelo menos 5 caracteres." });
      return;
    }

    setSavingAddendum(true);
    setPostFinalizeMsg(null);
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}/addendums`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: addendumText.trim(), signingPin: overridePin }),
      });
      const data = (await res.json()) as { error?: string; addendum: AtaAddendumRecord };
      if (!res.ok) {
        if (data.error && data.error.includes("PIN_REQUIRED")) {
          setPendingPinAction("addendum");
          setShowPinModal(true);
          return;
        }
        throw new Error(data.error || "Erro ao registrar aditamento");
      }

      setViewMinuteData((prev) =>
        prev
          ? {
              ...prev,
              addendums: [...(prev.addendums || []), data.addendum],
            }
          : prev
      );
      setAddendumText("");
      setPostFinalizeMsg({ type: "ok", text: 'Termo de aditamento ("Em tempo") registrado e selado com sucesso!' });
      onSaved();
    } catch (err: unknown) {
      setPostFinalizeMsg({ type: "err", text: getErrorMessage(err, "Erro ao salvar adendo.") });
    } finally {
      setSavingAddendum(false);
    }
  };

  const handleToggleActionStatus = async (actionItem: AtaActionItemRecord) => {
    if (!viewMinuteData?.id || !actionItem?.id) return;
    const nextStatus = actionItem.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}/actions/${actionItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = (await res.json()) as { error?: string; actionItem: AtaActionItemRecord };
      if (!res.ok) throw new Error(data.error);

      setViewMinuteData((prev) =>
        prev
          ? {
              ...prev,
              actionItems: (prev.actionItems || []).map((a) =>
                a.id === actionItem.id ? data.actionItem : a
              ),
            }
          : prev
      );
      onSaved();
    } catch (err: unknown) {
      setPostFinalizeMsg({ type: "err", text: getErrorMessage(err, "Erro ao atualizar encaminhamento.") });
    }
  };

  const handleVoidMinute = async (overridePin?: string) => {
    if (!viewMinuteData?.id) return;
    setVoidError(null);

    if (voidReason.trim().length < 10) {
      setVoidError("A justificativa para tornar a ata sem efeito deve ter no mínimo 10 caracteres.");
      setPostFinalizeMsg({
        type: "err",
        text: "A justificativa para tornar a ata sem efeito deve ter no mínimo 10 caracteres.",
      });
      return;
    }

    // Se o PIN ainda não foi informado nesta submissão, abre o modal de validação de fé pública
    if (!overridePin) {
      setPendingPinAction("void");
      setShowPinModal(true);
      return;
    }

    setSavingVoid(true);
    setPostFinalizeMsg(null);
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim(), signingPin: overridePin }),
      });
      const data = (await res.json()) as {
        error?: string;
        minute: { voidedAt?: string | Date; voidedByName?: string | null };
      };
      if (!res.ok) {
        if (data.error && data.error.includes("PIN_REQUIRED")) {
          setPendingPinAction("void");
          setShowPinModal(true);
          return;
        }
        throw new Error(data.error || "Erro ao tornar ata sem efeito");
      }

      setViewMinuteData((prev) =>
        prev
          ? {
              ...prev,
              status: "VOIDED",
              voidReason: voidReason.trim(),
              voidedAt: data.minute.voidedAt,
              voidedByName: data.minute.voidedByName,
            }
          : prev
      );
      setShowVoidForm(false);
      setPostFinalizeMsg({ type: "ok", text: "Averbação de cancelamento registrada no Livro Oficial." });
      onSaved();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Erro ao cancelar ata.");
      setVoidError(msg);
      setPostFinalizeMsg({ type: "err", text: msg });
    } finally {
      setSavingVoid(false);
    }
  };

  const handleAdminDelete = async () => {
    if (!viewMinuteData?.id) return;
    setIsDeletingAdmin(true);
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Erro ao excluir ata");
      setShowAdminDeleteConfirm(false);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setPostFinalizeMsg({
        type: "err",
        text: getErrorMessage(err, "Erro ao excluir ata pelo Administrador."),
      });
    } finally {
      setIsDeletingAdmin(false);
    }
  };

  // ============================================================================
  // TELA A: CELEBRAÇÃO DE ATA RECÉM-LAVRADA COM SUCESSO
  // ============================================================================
  if (finalizedAta) {
    const cleanNum = String(finalizedAta.ataNumber).padStart(3, "0");
    const cleanYear = finalizedAta.year;

    return (
      <AtaDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Ata Pedagógica Lavrada com Sucesso"
        maxWidthClass="max-w-3xl"
      >
        <div className="text-center py-6 space-y-5">
          <div className="flex items-center justify-center space-x-3 mx-auto">
            <div className="w-14 h-14 shrink-0 flex items-center justify-center">
              <img
                src="/logo.svg"
                alt="Brasão do Colégio"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
              <FileCheck2 className="w-7 h-7" />
            </div>
          </div>

          <div>
            <span className="inline-block px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-extrabold border border-emerald-200 uppercase tracking-wide">
              Documento Oficial Registrado no Livro {cleanYear}
            </span>
            <h3 className="text-3xl font-black text-slate-900 mt-2">
              Ata Pedagógica nº {cleanNum}/{cleanYear}
            </h3>
            {finalizedAta.finalizedAt && (
              <p className="text-xs font-extrabold text-emerald-800 mt-1">
                Lavrada em {new Date(finalizedAta.finalizedAt).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} às {new Date(finalizedAta.finalizedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            )}
            <p className="text-xs text-slate-500 font-mono mt-1">
              Código Público de Validação: <strong>{finalizedAta.verificationCode}</strong>
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left text-xs space-y-2 max-w-2xl mx-auto">
            <p className="font-bold text-slate-700 flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Código de verificação de integridade:</span>
            </p>
            <p className="font-mono text-[11px] text-slate-700 break-all bg-white p-3 rounded-xl border border-slate-200">
              {finalizedAta.contentHash}
            </p>
            <p className="text-xs text-slate-500">
              Confirmado por <strong>{finalizedAta.authorName}</strong> em{" "}
              {finalizedAta.finalizedAt
                ? new Date(finalizedAta.finalizedAt).toLocaleString("pt-BR")
                : new Date(finalizedAta.attendedAt).toLocaleString("pt-BR")}
              .
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href={`/atas/${finalizedAta.id}/imprimir`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition shadow-sm"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span>Imprimir / Salvar PDF Oficial A4</span>
            </a>

            <a
              href={`/api/atas/${finalizedAta.id}/pdfa?download=1`}
              className="inline-flex items-center space-x-2 px-5 py-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-extrabold transition shadow-xs"
              title="Baixar arquivo PDF para preservação"
            >
              <Download className="w-4 h-4 text-sky-600" />
              <span>Baixar PDF</span>
            </a>

            {finalizedAta.agreementsSummary && (() => {
              const schoolConfig: SchoolHeaderConfig | null | undefined =
                finalizedAta.school ?? existingMinute?.school;
              const schoolHeader = schoolConfig?.name || "Rede Ativa";
              const waUrl = buildWhatsAppDispatchUrl(
                "",
                `*${schoolHeader}*\n*Comprovante de Atendimento Pedagógico — Ata nº ${cleanNum}/${cleanYear}*\n\nPrezada família, confirmamos o atendimento realizado nesta data. Seguem os combinados firmados:\n\n${finalizedAta.agreementsSummary}\n\nPara verificar a autenticidade deste documento oficial, acesse: ${typeof window !== "undefined" ? window.location.origin : ""}/validar/ata/${finalizedAta.verificationCode}`
              );
              return (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    dispatchWhatsAppToBrowser(waUrl);
                  }}
                  className="inline-flex items-center space-x-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-sm cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Enviar Combinados via WhatsApp</span>
                </a>
              );
            })()}

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-extrabold transition cursor-pointer"
            >
              Concluir e Fechar
            </button>
          </div>
        </div>
      </AtaDialog>
    );
  }

  // ============================================================================
  // TELA B: CONSULTA DE ATA JÁ LAVRADA (IMUTÁVEL) + ADENDOS ("EM TEMPO")
  // ============================================================================
  if (viewMinuteData) {
    const cleanNum = String(viewMinuteData.ataNumber || 0).padStart(3, "0");
    const isVoid = viewMinuteData.status === "VOIDED";

    return (
      <AtaDialog
        isOpen={isOpen}
        onClose={onClose}
        hasActiveChildModal={showPinModal || isScanModalOpen}
        title={
          isVoid
            ? `Ata Pedagógica nº ${cleanNum}/${viewMinuteData.year} (Tornada Sem Efeito)`
            : `Ata Pedagógica nº ${cleanNum}/${viewMinuteData.year} — Documento Oficial Confirmado`
        }
        description="Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico."
      >
        <div className="space-y-5 text-xs">
          {isVoid && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 space-y-1">
              <p className="font-black text-sm flex items-center space-x-1.5">
                <Ban className="w-4 h-4 text-rose-600" />
                <span>ATA TORNADA SEM EFEITO POR AVERBAÇÃO OFICIAL</span>
              </p>
              <p>
                <strong>Motivo:</strong> {viewMinuteData.voidReason}
              </p>
              {viewMinuteData.voidedByName && (
                <p className="text-[11px] text-rose-600">
                  Averbado por {viewMinuteData.voidedByName} em{" "}
                  {viewMinuteData.voidedAt ? new Date(viewMinuteData.voidedAt).toLocaleString("pt-BR") : ""}
                </p>
              )}
            </div>
          )}

          {postFinalizeMsg && (
            <div
              className={`p-3.5 rounded-2xl border flex items-center space-x-2 ${
                postFinalizeMsg.type === "ok"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              {postFinalizeMsg.type === "ok" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="font-bold">{postFinalizeMsg.text}</span>
            </div>
          )}

          <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
            {/* Coluna Esquerda: Texto Oficial + Adendos */}
            <div className="lg:col-span-7 space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block">Assunto / Pauta</span>
                    <h3 className="text-base font-black text-slate-900 dark:text-white">{viewMinuteData.subject}</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {viewMinuteData.verificationCode}
                  </span>
                </div>

                <div className="p-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-serif text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                  {viewMinuteData.summary}
                </div>

                {viewMinuteData.agreementsSummary && (
                  <div className="p-3.5 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/70 rounded-xl">
                    <span className="font-extrabold text-sky-900 dark:text-sky-300 block mb-1">Síntese dos Combinados:</span>
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed">{viewMinuteData.agreementsSummary}</p>
                  </div>
                )}

                <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-between gap-2">
                  <span>
                    Lavrada por: <strong className="text-slate-700 dark:text-slate-300">{viewMinuteData.authorName}</strong> ({viewMinuteData.authorEmail})
                  </span>
                  <span>
                    Lavratura:{" "}
                    <strong className="text-slate-700 dark:text-slate-300">
                      {viewMinuteData.finalizedAt
                        ? `${new Date(viewMinuteData.finalizedAt).toLocaleDateString("pt-BR")} às ${new Date(viewMinuteData.finalizedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                        : `${new Date(viewMinuteData.attendedAt).toLocaleDateString("pt-BR")} às ${new Date(viewMinuteData.attendedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Termos de Aditamento ("Em tempo") */}
              <AtaAddendumsSection
                addendums={viewMinuteData.addendums || []}
                isVoid={isVoid}
                addendumText={addendumText}
                savingAddendum={savingAddendum}
                onAddendumTextChange={setAddendumText}
                onSubmitAddendum={() => handleAddAddendum()}
              />
            </div>

            {/* Coluna Direita: Alunos, Assinaturas, Encaminhamentos e Ações */}
            <div className="lg:col-span-5 space-y-4 mt-4 lg:mt-0">
              <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
                <h4 className="font-extrabold text-slate-900 dark:text-white text-sm">Estudante(s) & Presentes</h4>
                <div className="flex flex-wrap gap-1.5">
                  {viewMinuteData.students?.map((s) => (
                    <span
                      key={s.studentId}
                      className="px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-300 border border-transparent dark:border-sky-800 font-bold text-xs"
                    >
                      {s.studentNameSnapshot} {s.classNameSnapshot ? `(${s.classNameSnapshot})` : ""}
                    </span>
                  ))}
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  {viewMinuteData.participants?.map((p, i) => (
                    <div
                      key={p.id || i}
                      className="p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-2"
                    >
                      <div>
                        <p className="font-bold text-slate-900 dark:text-slate-100">{p.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatParticipantRoleLabel(p.role)}
                          {p.kinship ? ` • ${p.kinship}` : ""}
                          {p.documentNumber ? ` • Doc: ${p.documentNumber}` : ""}
                          {p.verifiedEmail ? ` • ${p.verifiedEmail}` : ""}
                        </p>
                      </div>
                      {(() => {
                        const sig = getParticipantSignatureSummary(p);
                        if (sig.isInstitutionalVerified && sig.hasPersistedSignature) {
                          return (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-bold text-[11px]">
                              ✓ @escola.pr.gov.br
                            </span>
                          );
                        }
                        if (sig.hasPersistedSignature) {
                          return (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                              {p.biometricVerified ? "✓ Biometria" : "✓ Assinado"}
                            </span>
                          );
                        }
                        if (sig.isRefused) {
                          return (
                            <span className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold text-[11px]">
                              Recusa registrada
                            </span>
                          );
                        }
                        return (
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold text-[11px]">
                            Presença atestada
                          </span>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>

              {/* Encaminhamentos */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2.5">
                <h4 className="font-extrabold text-slate-900 dark:text-white text-sm">Encaminhamentos & Prazos</h4>
                {(viewMinuteData.actionItems?.length ?? 0) > 0 ? (
                  (viewMinuteData.actionItems || []).map((act) => {
                    const done = act.status === "COMPLETED";
                    return (
                      <div
                        key={act.id}
                        className="p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-2"
                      >
                        <div>
                          <p className={`font-bold ${done ? "line-through text-slate-400 dark:text-slate-600" : "text-slate-800 dark:text-slate-200"}`}>
                            {act.description}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Resp: {act.responsible}
                            {act.dueDate ? ` • Prazo: ${new Date(act.dueDate).toLocaleDateString("pt-BR")}` : ""}
                          </p>
                        </div>
                        {!isVoid && (
                          <button
                            type="button"
                            onClick={() => handleToggleActionStatus(act)}
                            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition ${
                              done
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                : "bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700"
                            }`}
                          >
                            {done ? "✓ Concluído" : "Concluir"}
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-slate-400 dark:text-slate-500 italic">Sem encaminhamentos pendentes.</p>
                )}
              </div>

              {/* Código de Verificação e Averbação de Cancelamento */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
                <span className="font-bold text-slate-700 dark:text-slate-300 block">Código de verificação original:</span>
                <p className="font-mono text-[10px] text-slate-600 dark:text-slate-400 break-all bg-white dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                  {viewMinuteData.contentHash}
                </p>

                {!isVoid && (
                  <div className="pt-2">
                    {!showVoidForm ? (
                      <button
                        type="button"
                        onClick={() => setShowVoidForm(true)}
                        className="text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 font-bold text-[11px] flex items-center space-x-1 cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Tornar esta Ata Sem Efeito (Averbação de Cancelamento)</span>
                      </button>
                    ) : (
                      <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl space-y-2 mt-1">
                        <label className="font-bold text-rose-900 dark:text-rose-300 block">
                          Justificativa oficial para tornar a ata sem efeito (mín. 10 caracteres):
                        </label>
                        <textarea
                          rows={2}
                          value={voidReason}
                          onChange={(e) => {
                            setVoidReason(e.target.value);
                            if (voidError) setVoidError(null);
                          }}
                          placeholder="Informe o motivo administrativo/pedagógico..."
                          className="w-full p-2 border border-rose-300 dark:border-rose-800 rounded-lg bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
                        />
                        {voidError && (
                          <div className="p-2.5 bg-rose-100 border border-rose-300 rounded-xl text-rose-800 text-[11px] font-bold flex items-center space-x-1.5 animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                            <span>{voidError}</span>
                          </div>
                        )}
                        <div className="flex justify-end space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowVoidForm(false);
                              setVoidError(null);
                            }}
                            className="px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleVoidMinute()}
                            disabled={savingVoid}
                            className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50"
                          >
                            {savingVoid ? "Averbando..." : "Confirmar Cancelamento"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isAdmin && (
                  <div className="pt-2 border-t border-slate-200 mt-2">
                    {!showAdminDeleteConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowAdminDeleteConfirm(true)}
                        className="text-rose-600 hover:text-rose-700 font-bold text-[11px] flex items-center space-x-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir permanentemente do livro de registros (Administrador Geral)</span>
                      </button>
                    ) : (
                      <div className="p-3 bg-rose-100 border border-rose-300 rounded-xl space-y-2 mt-1">
                        <p className="text-xs font-bold text-rose-900">
                          ⚠️ Exclusão Permanente de Registro (Administrador Geral):
                        </p>
                        <p className="text-xs text-rose-800">
                          Esta ata ({viewMinuteData.ataNumber ? `Nº ${String(viewMinuteData.ataNumber).padStart(3, "0")}/${viewMinuteData.year}` : "Rascunho"}) e todos os seus participantes e assinaturas serão apagados em definitivo do banco de dados. Use esta ação para expurgar registros gerados em teste.
                        </p>
                        <div className="flex justify-end space-x-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setShowAdminDeleteConfirm(false)}
                            className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold cursor-pointer text-xs"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleAdminDelete}
                            disabled={isDeletingAdmin}
                            className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer disabled:opacity-50 text-xs"
                          >
                            {isDeletingAdmin ? "Excluindo..." : "Confirmar Exclusão Definitiva"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/atas/${viewMinuteData.id}/imprimir`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold transition"
              >
                <Printer className="w-4 h-4 text-amber-400" />
                <span>Imprimir / PDF Oficial A4</span>
              </a>
              <a
                href={`/api/atas/${viewMinuteData.id}/pdfa?download=1`}
                className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold transition"
                title="Baixar arquivo PDF para preservação"
              >
                <Download className="w-4 h-4 text-emerald-600" />
                <span>Baixar PDF</span>
              </a>
              {(() => {
                const viewProof = evaluateEffectivePhysicalProof(viewMinuteData);
                const hasCurrentViewScan =
                  viewProof.hasValidPhysicalProof && viewProof.hasPhysicalArtifact;
                return (
                  <button
                    type="button"
                    onClick={() => setIsScanModalOpen(true)}
                    className={`inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl border font-bold transition cursor-pointer ${
                      hasCurrentViewScan
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        : "border-slate-300 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700"
                    }`}
                    title="Anexar ou visualizar foto da via física assinada ou documento Gov.br"
                  >
                    <Camera className="w-4 h-4 text-indigo-600" />
                    <span>
                      {hasCurrentViewScan
                        ? "Via Física Anexa"
                        : viewProof.historicalCount > 0
                        ? `Digitalizar Folha (${viewProof.historicalCount} histórico)`
                        : "Digitalizar Folha"}
                    </span>
                  </button>
                );
              })()}
              {viewMinuteData.verificationCode && (
                <a
                  href={`/validar/ata/${viewMinuteData.verificationCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold transition"
                >
                  <ExternalLink className="w-4 h-4 text-sky-600" />
                  <span>Página de Validação Pública</span>
                </a>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-800 font-extrabold transition cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>

        {/* Modal de PIN de Fé Pública do Servidor */}
        <SigningPinModal
          isOpen={showPinModal}
          onClose={() => setShowPinModal(false)}
          onSuccess={(pin) => {
            setShowPinModal(false);
            if (pendingPinAction === "addendum") {
              handleAddAddendum(pin);
            } else if (pendingPinAction === "void") {
              handleVoidMinute(pin);
            } else {
              handleFinalize(pin);
            }
          }}
          hasPinInitial={hasSigningPin}
        />

        {/* Modal de Captura de Via Física e Assinatura Gov.br (JUR-04) */}
        {isScanModalOpen && viewMinuteData && (
          <PhysicalScanModal
            isOpen={isScanModalOpen}
            minute={viewMinuteData}
            onClose={() => setIsScanModalOpen(false)}
            onSuccess={(updated: AtaMinuteRecord) => {
              setViewMinuteData((prev) => {
                if (!prev) return prev;
                const merged = {
                  ...prev,
                  ...updated,
                  physicalProofHistory: updated.physicalProofHistory ?? prev.physicalProofHistory,
                };
                const proof = evaluateEffectivePhysicalProof(merged);
                return {
                  ...merged,
                  hasPhysicalScan: proof.hasValidPhysicalProof && proof.hasPhysicalArtifact,
                  govBrVerified: proof.isValidGovBrVerified,
                  govBrProtocol: proof.effectiveGovBrProtocol,
                };
              });
              broadcastMinuteSync(viewMinuteData.id, "physical-scan");
              setIsScanModalOpen(false);
            }}
          />
        )}
      </AtaDialog>
    );
  }

  // ============================================================================
  // TELA C: EDITOR BIMODAL DE NOVA ATA OU RASCUNHO EM ABERTO
  // ============================================================================
  return (
    <AtaDialog
      isOpen={isOpen}
      onClose={onClose}
      hasActiveChildModal={showPinModal || isScanModalOpen}
      title="Lavratura de Ata do Atendimento Pedagógico"
      description="Registra atendimentos, participantes e combinados vinculados ao histórico do estudante."
      maxWidthClass="max-w-[98vw] 2xl:max-w-[1560px]"
    >
      <div className="space-y-5 text-xs">
        {/* WIZARD BIMODAL: NAVEGAÇÃO DE PASSOS */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                step === 1
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">
                1
              </span>
              <span>
                {ataScope === "TEACHERS"
                  ? `Docentes & Pauta (${participants.filter((p) => p.role === "PROFESSOR").length} docente${participants.filter((p) => p.role === "PROFESSOR").length !== 1 ? "s" : ""})`
                  : `Alunos & Pauta (${selectedStudentIds.length} selecionado${selectedStudentIds.length !== 1 ? "s" : ""})`}
              </span>
            </button>

            <ArrowRight className="w-4 h-4 text-slate-300" />

            <button
              type="button"
              onClick={() => {
                const canAdvance =
                  selectedStudentIds.length > 0 ||
                  (ataScope === "TEACHERS" && participants.some((p) => p.role === "PROFESSOR" && p.name.trim().length > 0));
                if (!canAdvance) {
                  setStep1Error(
                    ataScope === "TEACHERS"
                      ? "Adicione pelo menos um(a) professor(a) orientado(a) ou estudante antes de avançar."
                      : "Selecione pelo menos um estudante no catálogo antes de avançar para a redação."
                  );
                  return;
                }
                setStep1Error(null);
                setStep(2);
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                step === 2
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">
                2
              </span>
              <span>Redação Oficial & Assinaturas</span>
            </button>
          </div>

          <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
            Etapa {step} de 2
          </span>
        </div>

        {isHydratingMinute && (
          <div
            role="status"
            className="p-3 rounded-2xl bg-sky-50 border border-sky-200 text-sky-800 text-xs font-semibold flex items-center space-x-2"
          >
            <Clock className="w-4 h-4 text-sky-600 shrink-0 animate-spin" />
            <span>Carregando dados completos da ata...</span>
          </div>
        )}

        {hydrationError && (
          <div
            role="alert"
            className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex flex-wrap items-center justify-between gap-2"
          >
            <span className="font-semibold">{hydrationError}</span>
            <button
              type="button"
              onClick={() => setHydrationRetryKey((k) => k + 1)}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Faixa de Revisão, Trava após Primeira Assinatura e Reabertura Autorizada */}
        {!isHydratingMinute && !hydrationError && (
          <div
            className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
              revisionLockState.hasLegacyUnprovableProof
                ? "bg-amber-50 border-amber-300 text-amber-950"
                : isContentLocked
                  ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                  : "bg-slate-50 border-slate-200 text-slate-700"
            }`}
          >
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 font-extrabold">
                {isContentLocked ? (
                  <Lock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                ) : (
                  <FileCheck2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                )}
                <span>Revisão {contentRevision}</span>
                {revisionLockState.hasLegacyUnprovableProof ? (
                  <span className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-950 text-[10px] font-bold">
                    Assinatura anterior sem vínculo de revisão
                  </span>
                ) : isContentLocked ? (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-200 text-emerald-950 text-[10px] font-bold">
                    Conteúdo travado após assinatura
                  </span>
                ) : hasPendingLocalEdit ? (
                  <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-900 text-[10px] font-bold">
                    Alterações pendentes — salve e confira antes de coletar
                  </span>
                ) : activePersistedId && !persistedHasMinimumSummary ? (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold">
                    Texto oficial pendente (mínimo 10 caracteres)
                  </span>
                ) : isCurrentRevisionConfirmed ? (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-bold">
                    Revisão {contentRevision} conferida para coleta
                  </span>
                ) : activePersistedId ? (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold">
                    Aguardando conferência da revisão {contentRevision}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-[10px] font-bold">
                    Novo rascunho não salvo
                  </span>
                )}
              </div>
              <p className="text-[11px] opacity-90">
                {revisionLockState.hasLegacyUnprovableProof
                  ? "Este rascunho contém assinatura anterior sem registro de revisão. Reabra para edição para invalidar as coletas antigas e coletar novamente antes de lavrar."
                  : isContentLocked
                    ? "Os campos da ata estão bloqueados enquanto houver assinatura ou documento vinculado nesta revisão. Os demais participantes podem receber links para assinar esta mesma revisão."
                    : hasPendingLocalEdit || !activePersistedId
                      ? localHasMinimumSummary
                        ? "Salve o rascunho para persistir a revisão e, em seguida, confirme a conferência antes de coletar assinaturas."
                        : `Faltam ${remainingSummaryChars} caractere(s) no Texto Oficial da Ata (mínimo de 10 após espaços). Você pode salvar o rascunho mesmo incompleto e completar antes da coleta.`
                      : !persistedHasMinimumSummary
                        ? `Faltam ${remainingSummaryChars} caractere(s) no Texto Oficial da Ata salvo para liberar conferência e coleta de assinaturas.`
                        : isCurrentRevisionConfirmed
                          ? `Revisão ${contentRevision} conferida. A coleta de assinaturas em tela ou via link está liberada.`
                          : "Confira os dados persistidos abaixo e clique em Confirmar conferência para liberar assinaturas."}
              </p>
            </div>

            {isContentLocked && (minuteId || existingMinute?.id) && (
              <button
                type="button"
                disabled={isReopening || savingFinal}
                onClick={() => setReopenConfirmRevision(contentRevision)}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-amber-50 border border-amber-300 text-amber-900 font-extrabold text-xs transition flex items-center space-x-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reabrir para edição</span>
              </button>
            )}
          </div>
        )}

        {reopenFeedbackMsg && (
          <div
            role="status"
            aria-live="polite"
            className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-semibold flex items-center space-x-2"
          >
            <RotateCcw className="w-4 h-4 text-amber-700 shrink-0" />
            <span>{reopenFeedbackMsg}</span>
          </div>
        )}

        {reopenConfirmRevision !== null && (
          <div
            role="dialog"
            aria-label="Confirmar reabertura da ata para edição"
            className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-950 space-y-3 shadow-sm"
          >
            <div className="space-y-1">
              <p className="font-black text-sm">
                Reabrir ata para edição na próxima revisão?
              </p>
              <p className="text-xs leading-relaxed text-amber-900">
                Ao confirmar, todas as assinaturas coletadas e links ativos da revisão {reopenConfirmRevision} serão invalidados, o registro passará para a revisão {reopenConfirmRevision + 1} com registro em auditoria, e eventuais arquivos de via física já anexados serão mantidos em guarda histórica separada.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={isReopening}
                onClick={() => setReopenConfirmRevision(null)}
                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isReopening}
                onClick={() => void handleReopenForEditing()}
                className="px-4 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50"
              >
                {isReopening ? "Reabrindo..." : "Confirmar reabertura"}
              </button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ETAPA 1: SELEÇÃO AMPLA E BUSCA DE ALUNOS + PAUTA E CATEGORIA   */}
        {/* ============================================================== */}
        {step === 1 && (
          <div className="space-y-4">
            {step1Error && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center space-x-2 font-bold">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{step1Error}</span>
              </div>
            )}

            {/* Seletor de Escopo da Ata: Estudantes vs Orientação Docente */}
            <div className="bg-slate-100 p-1 rounded-2xl flex items-center border border-slate-200">
              <button
                type="button"
                disabled={isContentLocked}
                onClick={() => {
                  if (isContentLocked) return;
                  markLocalEdit();
                  setAtaScope("STUDENTS");
                  if (category === "ORIENTACAO_DOCENTE") {
                    setCategory("ACOMPANHAMENTO_PEDAGOGICO");
                    setSubject("Atendimento Pedagógico e Alinhamento de Frequência");
                  }
                }}
                className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  ataScope === "STUDENTS"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Users className="w-3.5 h-3.5 text-sky-600" />
                <span>Estudantes / Família</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {selectedStudentIds.length}
                </span>
              </button>

              <button
                type="button"
                disabled={isContentLocked}
                onClick={() => {
                  if (isContentLocked) return;
                  markLocalEdit();
                  setAtaScope("TEACHERS");
                  setCategory("ORIENTACAO_DOCENTE");
                  if (subject === "Atendimento Pedagógico e Alinhamento de Frequência") {
                    setSubject("Orientação Pedagógica / Alinhamento Docente");
                  }
                }}
                className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  ataScope === "TEACHERS"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <GraduationCap className="w-3.5 h-3.5" />
                <span>Orientação Docente / Professores</span>
                {participants.filter((p) => p.role === "PROFESSOR").length > 0 && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      ataScope === "TEACHERS" ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-800"
                    }`}
                  >
                    {participants.filter((p) => p.role === "PROFESSOR").length}
                  </span>
                )}
              </button>
            </div>

            <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
              {/* COLUNA ESQUERDA: DADOS DA PAUTA + ESTUDANTES VINCULADOS (5 colunas) */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <div className="space-y-1">
                    <label className="font-extrabold text-slate-900 block text-sm">
                      Assunto / Pauta do Atendimento:
                    </label>
                    <input
                      type="text"
                      value={subject}
                      disabled={isContentLocked}
                      onChange={(e) => {
                        markLocalEdit();
                        setSubject(e.target.value);
                      }}
                      placeholder="Ex.: Comparecimento da família para alinhamento pedagógico e faltas"
                      className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800 text-sm focus:outline-sky-500 shadow-2xs disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="ata-editor-attended-at" className="font-bold text-slate-700 block text-xs">
                      Data e Horário do Atendimento:
                    </label>
                    <input
                      id="ata-editor-attended-at"
                      type="datetime-local"
                      value={formatIsoToDatetimeLocal(attendedAt)}
                      disabled={isContentLocked}
                      onChange={(e) => {
                        markLocalEdit();
                        setAttendedAt(datetimeLocalToIso(e.target.value));
                      }}
                      className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800 text-sm shadow-2xs disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700 block text-xs">
                      Natureza / Categoria da Ata:
                    </label>
                    <select
                      value={category}
                      disabled={isContentLocked}
                      onChange={(e) => {
                        markLocalEdit();
                        setCategory(e.target.value);
                      }}
                      className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800 text-sm shadow-2xs disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-1">
                    <label className="flex items-center space-x-2.5 cursor-pointer p-2.5 rounded-xl bg-rose-50/70 border border-rose-200">
                      <input
                        type="checkbox"
                        checked={isConfidential}
                        disabled={isContentLocked}
                        onChange={(e) => {
                          if (isContentLocked) return;
                          markLocalEdit();
                          const checked = e.target.checked;
                          setIsConfidential(checked);
                          if (checked) {
                            setNonConfidentialConfirmed(false);
                          }
                        }}
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="font-bold text-rose-800 text-xs flex items-center space-x-1.5">
                        <Lock className="w-3.5 h-3.5 text-rose-600" />
                        <span>Sigilo Reforçado (ECA / Proteção à Intimidade)</span>
                      </span>
                    </label>
                  </div>
                </div>

                {/* Card de Estudantes ou Docentes Vinculados */}
                {ataScope === "TEACHERS" ? (
                  <div className="bg-white p-4 rounded-2xl border border-indigo-200 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-slate-900 text-sm flex items-center space-x-1.5">
                        <GraduationCap className="w-4 h-4 text-indigo-600" />
                        <span>Docente(s) Orientado(s)</span>
                      </span>
                      <span className="text-xs font-black px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                        {participants.filter((p) => p.role === "PROFESSOR").length} vinculado(s)
                      </span>
                    </div>

                    {/* Lista de professores já adicionados */}
                    {participants.filter((p) => p.role === "PROFESSOR").length === 0 ? (
                      <div className="p-4 text-center border-2 border-dashed border-indigo-200 rounded-xl text-slate-400 text-xs">
                        Nenhum docente adicionado ainda.
                        <br />
                        Preencha o formulário abaixo ou selecione da equipe escolar.
                      </div>
                    ) : (
                      <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                        {participants.map((p, idx) => {
                          if (p.role !== "PROFESSOR") return null;
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-2.5 bg-indigo-50/60 border border-indigo-200 rounded-xl"
                            >
                              <div>
                                <p className="font-extrabold text-indigo-950 text-xs">{p.name}</p>
                                <p className="text-[11px] text-indigo-700">
                                  {p.kinship || "Professor(a)"}
                                  {p.expectedEmail ? ` • ${p.expectedEmail}` : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={isContentLocked}
                                onClick={() => handleRemoveTeacherParticipant(idx)}
                                className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Remover docente"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Formulário rápido para adicionar docente */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <p className="font-extrabold text-slate-800 text-[11px]">Adicionar Docente:</p>

                      {staffCandidates.length > 0 && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-slate-500 block">
                            Servidores cadastrados na unidade:
                          </label>
                          <select
                            aria-label="Selecionar servidor cadastrado na unidade"
                            disabled={isContentLocked}
                            onChange={(e) => {
                              const found = staffCandidates.find((t) => t.id === e.target.value);
                              if (found) {
                                setNewTeacherName(found.name);
                                if (found.email) setNewTeacherEmail(found.email);
                              }
                            }}
                            defaultValue=""
                            className="w-full p-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
                          >
                            <option value="" disabled>Selecionar servidor da equipe...</option>
                            {staffCandidates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} {t.email ? `(${t.email})` : ""}
                              </option>
                            ))}
                          </select>
                          {staffTruncated && (
                            <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                              Exibindo os primeiros 200 servidores em ordem alfabética. Caso não encontre, preencha os campos abaixo.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <input
                          type="text"
                          disabled={isContentLocked}
                          placeholder="Nome completo do docente..."
                          value={newTeacherName}
                          onChange={(e) => setNewTeacherName(e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-xs font-semibold text-slate-800 disabled:bg-slate-100 disabled:cursor-not-allowed"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          <input
                            type="email"
                            disabled={isContentLocked}
                            placeholder="Email @escola.pr.gov.br"
                            value={newTeacherEmail}
                            onChange={(e) => setNewTeacherEmail(e.target.value)}
                            className="w-full p-2 border border-slate-300 rounded-lg bg-white text-xs text-slate-800 disabled:bg-slate-100 disabled:cursor-not-allowed"
                          />
                          <input
                            type="text"
                            disabled={isContentLocked}
                            placeholder="Disciplina / Função (opcional)"
                            value={newTeacherSubject}
                            onChange={(e) => setNewTeacherSubject(e.target.value)}
                            className="w-full p-2 border border-slate-300 rounded-lg bg-white text-xs text-slate-800 disabled:bg-slate-100 disabled:cursor-not-allowed"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={isContentLocked}
                          onClick={handleAddTeacherParticipant}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs transition cursor-pointer flex items-center justify-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Inserir Docente</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-[11px] text-indigo-900 leading-snug">
                      <p className="font-bold flex items-center space-x-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-700 shrink-0 inline mr-1" />
                        <span>Assinatura com conta institucional</span>
                      </p>
                      Professores com e-mail <strong>@escola.pr.gov.br</strong> poderão assinar com 1 clique via Google Workspace SEED-PR, QR Code no celular ou assinatura na tela.
                    </div>

                    {/* Alunos vinculados opcionalmente nesta ata docente */}
                    {selectedStudentIds.length > 0 && (
                      <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-xs space-y-1">
                        <span className="font-bold text-sky-900">
                          {selectedStudentIds.length} estudante(s) associado(s) opcionalmente:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {selectedStudentIds.map((id) => {
                            const st = availableStudents.find((s) => s.id === id);
                            if (!st) return null;
                            return (
                              <span key={id} className="px-2 py-0.5 bg-white border border-sky-300 rounded text-[10px] font-bold text-sky-900">
                                {st.name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const canAdvance =
                          participants.some((p) => p.role === "PROFESSOR" && p.name.trim().length > 0) ||
                          selectedStudentIds.length > 0;
                        if (!canAdvance) {
                          setStep1Error("Adicione pelo menos um(a) professor(a) orientado(a) ou estudante antes de avançar.");
                          return;
                        }
                        setStep1Error(null);
                        setStep(2);
                      }}
                      disabled={
                        !participants.some((p) => p.role === "PROFESSOR" && p.name.trim().length > 0) &&
                        selectedStudentIds.length === 0
                      }
                      className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white font-extrabold text-xs transition shadow-2xs flex items-center justify-center space-x-2 cursor-pointer mt-2"
                    >
                      <span>Avançar para Redação</span>
                      <ArrowRight className="w-4 h-4 text-sky-400" />
                    </button>
                  </div>
                ) : (
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-slate-900 text-sm flex items-center space-x-1.5">
                        <Users className="w-4 h-4 text-sky-600" />
                        <span>Alunos Vinculados nesta Ata</span>
                      </span>
                      <span className="text-xs font-black px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800">
                        {selectedStudentIds.length} selecionado{selectedStudentIds.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {selectedStudentIds.length === 0 ? (
                      <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                        Nenhum estudante selecionado ainda.
                        <br />
                        Pesquise e clique nos estudantes no catálogo ao lado para vinculá-los.
                      </div>
                    ) : (
                      <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                        {selectedStudentIds.map((id) => {
                          const s = availableStudents.find((item) => item.id === id);
                          if (!s) return null;
                          return (
                            <div
                              key={id}
                              className="flex items-center justify-between p-2.5 bg-sky-50/60 border border-sky-200 rounded-xl"
                            >
                              <div>
                                <p className="font-extrabold text-sky-950 text-xs">{s.name}</p>
                                <p className="text-[11px] text-sky-700">
                                  Turma: {s.classGroupName || "Sem Turma"} {s.cgm ? `• CGM: ${s.cgm}` : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={isContentLocked}
                                onClick={() => handleToggleStudent(s)}
                                className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Remover estudante"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (selectedStudentIds.length === 0) {
                          setStep1Error("Selecione pelo menos um estudante antes de avançar.");
                          return;
                        }
                        setStep1Error(null);
                        setStep(2);
                      }}
                      disabled={selectedStudentIds.length === 0}
                      className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white font-extrabold text-xs transition shadow-2xs flex items-center justify-center space-x-2 cursor-pointer mt-2"
                    >
                      <span>Avançar</span>
                      <ArrowRight className="w-4 h-4 text-sky-400" />
                    </button>
                  </div>
                )}
              </div>

              {/* COLUNA DIREITA: CATÁLOGO DE BUSCA E SELEÇÃO DE ALUNOS (7 colunas) */}
              <div className="lg:col-span-7 space-y-3 mt-4 lg:mt-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-sm">
                      {ataScope === "TEACHERS" ? "Vincular Estudantes (Opcional)" : "Estudantes"}
                    </h3>
                    {ataScope === "TEACHERS" && (
                      <p className="text-[11px] text-slate-500">
                        Opcional: vincule caso este alinhamento envolva acompanhamento de estudantes específicos.
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-600 font-medium">
                    Exibindo <strong>{filteredStudents.length}</strong> de {availableStudents.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-8 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      placeholder="Buscar por estudante, CGM ou responsável..."
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="w-full pl-9 pr-8 py-2.5 border border-slate-300 rounded-xl bg-white font-medium text-slate-800 focus:outline-sky-500 text-sm shadow-2xs"
                    />
                    {studentSearch && (
                      <button
                        type="button"
                        onClick={() => setStudentSearch("")}
                        className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="sm:col-span-4">
                    <select
                      value={selectedTurmaFilter}
                      onChange={(e) => setSelectedTurmaFilter(e.target.value)}
                      className="w-full py-2.5 px-3 border border-slate-300 rounded-xl bg-white font-semibold text-slate-700 text-sm shadow-2xs"
                    >
                      <option value="TODAS">Todas as Turmas ({availableStudents.length})</option>
                      {turmasList.map((t) => (
                        <option key={t} value={t}>
                          Turma: {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white h-[460px] overflow-y-auto divide-y divide-slate-100 shadow-2xs">
                  {filteredStudents.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 text-sm">
                      Nenhum estudante encontrado para os termos pesquisados.
                    </div>
                  ) : (
                    filteredStudents.map((s) => {
                      const isSelected = selectedStudentIds.includes(s.id);
                      return (
                        <div
                          key={s.id}
                          onClick={() => {
                            if (!isContentLocked) handleToggleStudent(s);
                          }}
                          className={`p-3.5 flex items-center justify-between transition select-none ${
                            isContentLocked ? "opacity-60 cursor-not-allowed " : "cursor-pointer "
                          }${
                            isSelected
                              ? "bg-sky-50/90 border-l-4 border-l-sky-600"
                              : "hover:bg-slate-50/80 text-slate-700"
                          }`}
                        >
                          <div className="flex items-center space-x-3.5">
                            <div
                              className={`w-5 h-5 rounded-md border flex items-center justify-center transition shrink-0 ${
                                isSelected
                                  ? "bg-sky-600 border-sky-600 text-white"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>

                            <div>
                              <div className="flex items-center space-x-2">
                                <p className="text-sm font-extrabold text-slate-900">{s.name}</p>
                                {s.classGroupName && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold">
                                    {s.classGroupName}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {s.cgm ? <span className="font-mono mr-2">CGM: {s.cgm}</span> : null}
                                {s.guardianName ? (
                                  <span>
                                    Resp: <strong className="text-slate-600">{s.guardianName}</strong>
                                  </span>
                                ) : null}
                              </p>
                            </div>
                          </div>

                          {isSelected ? (
                            <span className="text-xs font-black uppercase px-2.5 py-1 rounded-lg bg-sky-100 text-sky-800">
                              Vinculado
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 hover:text-sky-600 font-medium">
                              + Vincular
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 text-xs transition cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => {
                  const canAdvance =
                    selectedStudentIds.length > 0 ||
                    (ataScope === "TEACHERS" && participants.some((p) => p.role === "PROFESSOR" && p.name.trim().length > 0));
                  if (!canAdvance) {
                    setStep1Error(
                      ataScope === "TEACHERS"
                        ? "Adicione pelo menos um(a) professor(a) orientado(a) ou estudante antes de avançar."
                        : "Selecione pelo menos um estudante antes de avançar."
                    );
                    return;
                  }
                  setStep1Error(null);
                  setStep(2);
                }}
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs transition shadow-sm flex items-center space-x-2 cursor-pointer"
              >
                <span>Avançar para Redação & Assinatura</span>
                <ArrowRight className="w-4 h-4 text-sky-400" />
              </button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ETAPA 2: REDAÇÃO OFICIAL, IA, ENCAMINHAMENTOS E ASSINATURAS    */}
        {/* ============================================================== */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Barra de Resumo Topo */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                    {ataScope === "TEACHERS" ? "Docente(s) e Pauta:" : "Estudante(s) e Pauta:"}
                  </span>
                  <p className="font-extrabold text-sm text-slate-900">
                    {subject || "Sem assunto"}
                    {selectedStudentIds.length > 0 ? (
                      <>
                        {" "}•{" "}
                        <span className="text-sky-700 font-semibold">
                          {availableStudents
                            .filter((s) => selectedStudentIds.includes(s.id))
                            .map((s) => s.name)
                            .join(", ")}
                        </span>
                      </>
                    ) : participants.filter((p) => p.role === "PROFESSOR").length > 0 ? (
                      <>
                        {" "}•{" "}
                        <span className="text-sky-700 font-semibold">
                          {participants
                            .filter((p) => p.role === "PROFESSOR")
                            .map((p) => p.name)
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-sky-600 font-bold text-xs flex items-center space-x-1.5 cursor-pointer shadow-2xs"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Alterar</span>
              </button>
            </div>

            {/* Aviso e Justificativa de Lavratura Extemporânea (> 5 dias úteis) */}
            {isExtemporaneousMeeting && (
              <AtaExtemporaneousBanner
                value={extemporaneousReason}
                onChange={setExtemporaneousReason}
              />
            )}

            <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
              {/* COLUNA ESQUERDA: IA, TEXTO FORMAL E COMBINADOS (6 colunas) */}
              <div className="lg:col-span-6 space-y-4">
                <div className="border border-sky-100 bg-sky-50/50 p-4 rounded-2xl space-y-2.5 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-extrabold text-sky-900 text-xs">
                      Fatos Observados
                    </span>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        disabled={isContentLocked}
                        onClick={toggleSpeechRecognition}
                        className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition shadow-2xs cursor-pointer text-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                          isListening
                            ? "bg-rose-600 text-white animate-pulse"
                            : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {isListening ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5 text-sky-600" />
                        )}
                        <span>{isListening ? "Gravando voz..." : "Ditado por Voz"}</span>
                      </button>

                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold ${
                          hasServerKey
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : "bg-slate-50 border-slate-200 text-slate-600"
                        }`}
                        title="Política de processamento da instituição"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>
                          {hasServerKey ? "Revisão assistida ativa" : "Gerador local"}
                        </span>
                      </span>

                      <button
                        type="button"
                        onClick={handleFormalizeWithAi}
                        disabled={isAiLoading || isContentLocked}
                        className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-xs"
                      >
                        <span>{isAiLoading ? "Revisando..." : "Formalizar & Revisar"}</span>
                      </button>
                    </div>
                  </div>

                  {aiSuccessMsg && (
                    <div
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                        aiSuccessMsg.type === "warning"
                          ? "bg-amber-50 border-amber-200 text-amber-900"
                          : "bg-emerald-50 border-emerald-200 text-emerald-800"
                      }`}
                    >
                      <div className="flex items-center space-x-1.5">
                        {aiSuccessMsg.type === "warning" ? (
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        )}
                        <span className="font-semibold">{aiSuccessMsg.text}</span>
                      </div>
                    </div>
                  )}

                  {aiError && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold text-xs flex items-center space-x-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{aiError}</span>
                    </div>
                  )}

                  {hasServerKey && !minuteId && !existingMinute?.id && !isConfidential && (
                    <label className="flex items-start gap-2 p-2.5 rounded-xl bg-white/90 border border-sky-200 text-[11px] text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={nonConfidentialConfirmed}
                        onChange={(e) => setNonConfidentialConfirmed(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span>
                        Confirmo que esta minuta nova não contém conteúdo sigiloso (necessário para revisão externa; sem marcar, usa o gerador local).
                      </span>
                    </label>
                  )}

                  <textarea
                    rows={3}
                    value={rawNotes}
                    disabled={isContentLocked}
                    onChange={(e) => {
                      markLocalEdit();
                      setRawNotes(e.target.value);
                    }}
                    placeholder="Anotações dos fatos para redação da ata..."
                    className="w-full p-2.5 border border-sky-200 rounded-xl bg-white text-slate-700 placeholder:text-slate-400 focus:outline-sky-500 text-xs shadow-2xs disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Texto Formal da Ata */}
                <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="ata-editor-summary" className="font-extrabold text-slate-900 block text-xs">
                      Texto Oficial da Ata: <span className="text-rose-600">*</span>
                    </label>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Etapa de redação • Salve como minuta ou avance para confirmação por PIN
                    </span>
                  </div>
                  <textarea
                    id="ata-editor-summary"
                    rows={9}
                    value={summary}
                    disabled={isContentLocked}
                    aria-invalid={Boolean(finalizeError && summary.trim().length < 10)}
                    onChange={(e) => {
                      markLocalEdit();
                      setSummary(e.target.value);
                      if (finalizeError) setFinalizeError(null);
                    }}
                    placeholder="Redija o texto oficial da ata ou formalize a partir das anotações..."
                    className={`w-full p-3.5 border rounded-2xl bg-white text-slate-800 leading-relaxed font-serif text-sm focus:outline-slate-900 shadow-2xs disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed ${
                      finalizeError && summary.trim().length < 10
                        ? "border-rose-400"
                        : "border-slate-300"
                    }`}
                  />
                </div>

                {/* Síntese dos Combinados */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 block text-xs">
                    Síntese dos Encaminhamentos:
                  </label>
                  <input
                    type="text"
                    value={agreementsSummary}
                    disabled={isContentLocked}
                    onChange={(e) => {
                      markLocalEdit();
                      setAgreementsSummary(e.target.value);
                    }}
                    placeholder="Ex.: Responsável apresentará atestado e estudante realizará compensação pedagógica."
                    className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-medium text-slate-800 text-xs shadow-2xs disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* COLUNA DIREITA: ENCAMINHAMENTOS E PARTICIPANTES/ASSINATURAS (6 colunas) */}
              <div className="lg:col-span-6 space-y-4 mt-4 lg:mt-0">
                <AtaActionItemsSection
                  actionItems={actionItems}
                  disabled={isContentLocked}
                  pendingSuggestions={pendingSuggestedActions}
                  onAcceptPendingSuggestions={() => {
                    if (isContentLocked || !pendingSuggestedActions) return;
                    markLocalEdit();
                    setActionItems(pendingSuggestedActions);
                    setPendingSuggestedActions(null);
                  }}
                  onDiscardPendingSuggestions={() => {
                    setPendingSuggestedActions(null);
                  }}
                  onAdd={() => {
                    if (isContentLocked) return;
                    markLocalEdit();
                    setActionItems((prev) => [
                      ...prev,
                      { description: "", responsible: "FAMILIA", dueDate: "" },
                    ]);
                  }}
                  onUpdate={(index, patch) => {
                    if (isContentLocked) return;
                    markLocalEdit();
                    setActionItems((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
                    );
                  }}
                  onRemove={(index) => {
                    if (isContentLocked) return;
                    markLocalEdit();
                    setActionItems((prev) => prev.filter((_, i) => i !== index));
                  }}
                />

                {/* Conferência Explícita da Revisão Persistida */}
                <div
                  className={`p-3.5 rounded-2xl border space-y-2.5 text-xs ${
                    isContentLocked
                      ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                      : isCurrentRevisionConfirmed
                        ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                        : "bg-amber-50/70 border-amber-200 text-amber-950"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2 font-extrabold">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>Conferência da Revisão {contentRevision}</span>
                    </div>
                    {isContentLocked ? (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-bold">
                        Travada após assinatura
                      </span>
                    ) : isCurrentRevisionConfirmed ? (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-bold">
                        Revisão {contentRevision} conferida
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold">
                        Coleta bloqueada até conferir
                      </span>
                    )}
                  </div>

                  {persistedSnapshot ? (
                    <div
                      className="p-3 rounded-xl bg-white/95 border border-slate-200/80 space-y-2 text-[11px] text-slate-700"
                      data-testid="review-persisted-snapshot"
                    >
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block">
                          Assunto da revisão {persistedSnapshot.contentRevision}
                        </span>
                        <p
                          className="font-bold text-slate-900 whitespace-pre-wrap break-words"
                          data-testid="review-persisted-subject"
                        >
                          {persistedSnapshot.subject || "Sem assunto"}
                        </p>
                      </div>

                      {persistedSnapshot.studentNames.length > 0 && (
                        <p className="text-slate-700 whitespace-pre-wrap break-words">
                          <strong>Estudantes gravados:</strong>{" "}
                          {persistedSnapshot.studentNames.join(", ")}
                        </p>
                      )}

                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block">
                          Texto oficial completo desta revisão
                        </span>
                        <div
                          data-testid="review-persisted-summary"
                          className="max-h-56 overflow-y-auto p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-slate-800 whitespace-pre-wrap break-words leading-relaxed"
                        >
                          {persistedSnapshot.summary && persistedSnapshot.summary.trim().length > 0
                            ? persistedSnapshot.summary
                            : "Nenhum texto oficial salvo ainda nesta revisão."}
                        </div>
                      </div>

                      {persistedSnapshot.rawNotes && persistedSnapshot.rawNotes.trim().length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-sky-700 block">
                            Notas brutas (apoio interno — não substituem o texto oficial)
                          </span>
                          <div
                            data-testid="review-persisted-raw-notes"
                            className="max-h-36 overflow-y-auto p-2.5 rounded-lg bg-sky-50/70 border border-sky-200/80 text-slate-700 whitespace-pre-wrap break-words leading-relaxed"
                          >
                            {persistedSnapshot.rawNotes}
                          </div>
                        </div>
                      )}

                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block">
                          Combinados e prazos desta revisão
                        </span>
                        <div
                          data-testid="review-persisted-agreements"
                          className="max-h-40 overflow-y-auto p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-slate-800 whitespace-pre-wrap break-words leading-relaxed"
                        >
                          {persistedSnapshot.agreementsSummary
                            ? persistedSnapshot.agreementsSummary
                            : "Nenhum combinado registrado nesta revisão."}
                        </div>
                      </div>

                      <p className="text-[10px] text-slate-500">
                        Revisão salva: {persistedSnapshot.contentRevision} •{" "}
                        {persistedSnapshot.participantsCount} participante(s) •{" "}
                        {persistedSnapshot.actionItemsCount} encaminhamento(s)
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px]">
                      Nenhuma revisão salva no banco ainda. Salve o rascunho antes de conferir.
                    </p>
                  )}

                  {hasActiveLinkOnIncompleteSummary && (
                    <div
                      role="alert"
                      data-testid="incomplete-summary-active-link-warning"
                      className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-[11px] font-semibold"
                    >
                      Há link de assinatura emitido para esta revisão sem Texto Oficial suficiente (mínimo de 10 caracteres). Complete o Texto Oficial, salve o rascunho, confirme a conferência da nova revisão e emita um novo link antes de coletar a assinatura.
                    </div>
                  )}

                  {isContentLocked ? (
                    <p className="text-[11px]">
                      Esta revisão já recebeu assinatura registrada e está travada para edições. Participantes restantes podem assinar esta mesma revisão.
                    </p>
                  ) : hasPendingLocalEdit || !activePersistedId ? (
                    <p className="text-[11px] font-semibold">
                      {localHasMinimumSummary
                        ? 'Existem alterações ainda não salvas. Clique em "Salvar Rascunho" para gravar uma nova revisão e depois confirme a conferência.'
                        : `Para liberar a coleta, preencha o Texto Oficial da Ata com pelo menos 10 caracteres (faltam ${remainingSummaryChars} caractere(s)) e clique em "Salvar Rascunho".`}
                    </p>
                  ) : !persistedHasMinimumSummary ? (
                    <p className="text-[11px] font-semibold text-amber-900">
                      Faltam {remainingSummaryChars} caractere(s) no Texto Oficial da Ata salvo (mínimo de 10 caracteres sem espaços nas extremidades) para liberar a conferência e a coleta de assinaturas.
                      {persistedSnapshot?.rawNotes?.trim()
                        ? ' As notas brutas servem apenas como apoio: clique em "Formalizar & Revisar" ou redija o Texto Oficial e salve o rascunho.'
                        : ""}
                    </p>
                  ) : !isCurrentRevisionConfirmed ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <p className="text-[11px]">
                        Confirme que a íntegra acima (assunto, texto oficial e combinados) corresponde ao que será apresentado ao signatário antes de liberar QR ou assinatura em tela.
                      </p>
                      <button
                        type="button"
                        disabled={
                          saving ||
                          isHydratingMinute ||
                          Boolean(hydrationError) ||
                          !persistedHasMinimumSummary ||
                          displayedReviewRevision === null ||
                          displayedReviewRevision !== contentRevision
                        }
                        onClick={() => {
                          if (displayedReviewRevision === null || !persistedHasMinimumSummary) return;
                          setFinalizeError(null);
                          setReviewedRevision(displayedReviewRevision);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        Confirmar conferência da Revisão {displayedReviewRevision ?? contentRevision}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] font-semibold text-emerald-800">
                      Conferência confirmada para a Revisão {contentRevision}. Escolha o participante abaixo para assinar na tela ou emitir QR Celular.
                    </p>
                  )}

                  {physicalProofHistory && physicalProofHistory.length > 0 && (
                    <p className="text-[10.5px] font-semibold text-amber-900 bg-amber-100/70 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      Esta ata possui {physicalProofHistory.length} via(s) física(s) anterior(es) preservada(s) em histórico (sem validade nesta revisão).
                    </p>
                  )}
                </div>

                {/* Participantes & Coleta de Assinatura */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="font-extrabold text-slate-800 block text-xs">
                        Presentes e Assinaturas:
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      {selectedStudentIds.length > 0 && (
                        <button
                          type="button"
                          disabled={isContentLocked}
                          onClick={handleAddSelectedStudentsAsParticipants}
                          className="text-emerald-700 hover:text-emerald-800 font-bold flex items-center space-x-1 cursor-pointer text-xs px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-lg shadow-2xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Adiciona automaticamente os estudantes selecionados para assinarem a ata"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>+ Estudantes da Pauta</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isContentLocked}
                        onClick={() => {
                          if (isContentLocked) return;
                          markLocalEdit();
                          setParticipants((prev) => {
                            const blankRow = ensureParticipantClientKey(
                              {
                                role: "RESPONSAVEL",
                                name: "",
                                kinship: "",
                                documentType: "CPF",
                                documentNumber: "",
                                documentVerifiedByStaff: true,
                                phone: "",
                                signatureMode: "PENDING",
                                signatureData: null,
                                refusalReason: "",
                                witnessName: "",
                                originState: "AUTO_SUGGESTED",
                              },
                              prev.length
                            );
                            const familyCandidates = getCandidatesForRowRole(
                              candidateBundle,
                              "RESPONSAVEL"
                            );
                            const autoCandidate = resolveSingleAutoFillCandidate(familyCandidates);
                            return [
                              ...prev,
                              autoCandidate
                                ? applyCandidateToParticipantRow(blankRow, autoCandidate, "AUTO_SUGGESTED")
                                : blankRow,
                            ];
                          });
                        }}
                        className="text-sky-600 hover:text-sky-700 font-bold flex items-center space-x-1 cursor-pointer text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-2xs"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Novo Presente</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {participants.map((p, idx) => {
                      const isLockedBySignature = isParticipantSignatureLocked(p);
                      const isQrActive = isParticipantQrActive(p, qrModalInfo?.participantId);
                      const isIdentityDisabled =
                        isContentLocked ||
                        isLockedBySignature ||
                        isQrActive ||
                        cancelingQrIndex === idx ||
                        resettingSigIndex === idx;
                      const kinshipPlaceholder =
                        p.role === "RESPONSAVEL" || p.role === "FAMILIAR_CONTATO"
                          ? "Parentesco / vínculo (opcional, ex.: Mãe, Avó)"
                          : p.role === "PROFESSOR" || p.role === "EQUIPE_ESCOLAR"
                          ? "Função / Disciplina (opcional)"
                          : "Vínculo / Órgão (opcional)";
                      const rowCandidates = getCandidatesForRowRole(candidateBundle, p.role);
                      const legalGuardianOpts = rowCandidates.filter(
                        (c) => c.group === "RESPONSAVEL_LEGAL"
                      );
                      const explicitContactOpts = rowCandidates.filter(
                        (c) => c.group === "FAMILIAR_CONTATO" || c.group === "RECADO"
                      );
                      const pautaTeacherOpts = rowCandidates.filter(
                        (c) => c.group === "PROFESSOR_PAUTA"
                      );
                      const staffTeacherOpts = rowCandidates.filter(
                        (c) => c.group === "STAFF_MANUAL_TEACHER"
                      );
                      const showStaffTruncatedNotice =
                        staffTruncated &&
                        (p.role === "EQUIPE_ESCOLAR" || p.role === "PROFESSOR");

                      return (
                      <div
                        key={p.clientKey || p.id || idx}
                        className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5 shadow-2xs"
                      >
                        {!isIdentityDisabled &&
                          (rowCandidates.length > 0 ||
                            (isLoadingContacts &&
                              (p.role === "RESPONSAVEL" ||
                                p.role === "FAMILIAR_CONTATO" ||
                                p.role === "ESTUDANTE"))) && (
                            <div className="space-y-1">
                              {isLoadingContacts &&
                              (p.role === "RESPONSAVEL" ||
                                p.role === "FAMILIAR_CONTATO" ||
                                p.role === "ESTUDANTE") ? (
                                <p className="text-[11px] text-slate-500">
                                  Carregando contatos dos estudantes da pauta...
                                </p>
                              ) : (
                                <>
                                  <select
                                    aria-label={`Selecionar cadastro para o participante ${idx + 1}`}
                                    value={p.autoFilledCandidateKey || ""}
                                    onChange={(e) => {
                                      const selectedKey = e.target.value;
                                      markLocalEdit();
                                      if (!selectedKey) {
                                        setParticipants((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? applyManualParticipantFieldEdit(item, {
                                                  autoFilledCandidateKey: null,
                                                  sourceSnapshot: null,
                                                })
                                              : item
                                          )
                                        );
                                        return;
                                      }
                                      const chosen = candidateBundle.byKey[selectedKey];
                                      if (!chosen) return;
                                      setParticipants((prev) =>
                                        prev.map((item, i) =>
                                          i === idx
                                            ? applyCandidateToParticipantRow(
                                                item,
                                                chosen,
                                                "EXPLICIT_CANDIDATE"
                                              )
                                            : item
                                        )
                                      );
                                    }}
                                    className="w-full p-1.5 border border-sky-200 rounded-lg bg-sky-50/50 text-xs font-medium text-slate-700"
                                  >
                                    <option value="">
                                      Selecionar cadastro sugerido (ou digitar manualmente)...
                                    </option>
                                    {p.role === "RESPONSAVEL" || p.role === "FAMILIAR_CONTATO" ? (
                                      <>
                                        {legalGuardianOpts.length > 0 && (
                                          <optgroup label="Responsáveis cadastrados">
                                            {legalGuardianOpts.map((c) => (
                                              <option key={c.key} value={c.key}>
                                                {c.label}
                                              </option>
                                            ))}
                                          </optgroup>
                                        )}
                                        {explicitContactOpts.length > 0 && (
                                          <optgroup label="Outros familiares / recado (registra como Familiar / Contato)">
                                            {explicitContactOpts.map((c) => (
                                              <option key={c.key} value={c.key}>
                                                {c.label}
                                              </option>
                                            ))}
                                          </optgroup>
                                        )}
                                      </>
                                    ) : p.role === "PROFESSOR" ? (
                                      <>
                                        {pautaTeacherOpts.length > 0 && (
                                          <optgroup label="Docentes informados na pauta">
                                            {pautaTeacherOpts.map((c) => (
                                              <option key={c.key} value={c.key}>
                                                {c.label}
                                              </option>
                                            ))}
                                          </optgroup>
                                        )}
                                        {staffTeacherOpts.length > 0 && (
                                          <optgroup label="Servidores cadastrados na escola">
                                            {staffTeacherOpts.map((c) => (
                                              <option key={c.key} value={c.key}>
                                                {c.label}
                                              </option>
                                            ))}
                                          </optgroup>
                                        )}
                                      </>
                                    ) : (
                                      rowCandidates.map((c) => (
                                        <option key={c.key} value={c.key}>
                                          {c.label}
                                        </option>
                                      ))
                                    )}
                                  </select>
                                  {showStaffTruncatedNotice && (
                                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                                      Exibindo os primeiros 200 servidores em ordem alfabética. Se necessário, digite os dados abaixo.
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          )}

                        {p.nonLegalContactNotice && p.role === "FAMILIAR_CONTATO" && (
                          <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                            {p.nonLegalContactNotice}
                          </p>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                          <div className="md:col-span-4">
                            <select
                              aria-label={`Papel do participante ${idx + 1}`}
                              value={p.role}
                              disabled={
                                isContentLocked ||
                                isLockedBySignature ||
                                cancelingQrIndex === idx ||
                                resettingSigIndex === idx
                              }
                              onChange={(e) => {
                                const nextRole = e.target.value;
                                if (isQrActive) {
                                  void handleCancelParticipantQr(idx, nextRole);
                                  return;
                                }
                                markLocalEdit();
                                setParticipants((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? resolveRoleChangeWithCandidates(
                                          item,
                                          nextRole,
                                          candidateBundle
                                        )
                                      : item
                                  )
                                );
                              }}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white font-semibold text-xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                            >
                              <option value="RESPONSAVEL">Responsável Legal</option>
                              <option value="FAMILIAR_CONTATO">Familiar / Contato</option>
                              <option value="ESTUDANTE">Estudante</option>
                              <option value="PROFESSOR">Professor(a)</option>
                              <option value="EQUIPE_ESCOLAR">Equipe Escolar</option>
                              <option value="REDE_EXTERNA">Rede de Proteção / CT</option>
                              <option value="TESTEMUNHA">Testemunha Presencial</option>
                            </select>
                          </div>

                          <div className="md:col-span-4">
                            <input
                              type="text"
                              aria-label={`Nome completo do participante ${idx + 1}`}
                              placeholder="Nome completo..."
                              value={p.name}
                              disabled={isIdentityDisabled}
                              onChange={(e) => {
                                markLocalEdit();
                                const nextName = e.target.value;
                                setParticipants((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? applyManualParticipantFieldEdit(item, { name: nextName })
                                      : item
                                  )
                                );
                              }}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white font-medium text-xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                            />
                          </div>

                          <div className="md:col-span-3">
                            <input
                              type="text"
                              aria-label={`Documento do participante ${idx + 1}`}
                              placeholder="Nº Doc (CPF / RG)..."
                              value={p.documentNumber || ""}
                              disabled={isIdentityDisabled}
                              onChange={(e) => {
                                markLocalEdit();
                                const nextDoc = e.target.value;
                                setParticipants((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? applyManualParticipantFieldEdit(item, {
                                          documentNumber: nextDoc,
                                        })
                                      : item
                                  )
                                );
                              }}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white font-medium text-xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                            />
                          </div>

                          <div className="md:col-span-1 flex items-center justify-end">
                            <button
                              type="button"
                              disabled={isIdentityDisabled}
                              onClick={() => {
                                markLocalEdit();
                                setParticipants((prev) => prev.filter((_, i) => i !== idx));
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title={
                                isLockedBySignature
                                  ? "Refaça a assinatura antes de remover"
                                  : isQrActive
                                  ? "Cancele o link QR antes de remover"
                                  : "Remover participante"
                              }
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                          {p.role !== "ESTUDANTE" && (
                            <div className="md:col-span-6">
                              <input
                                type="text"
                                aria-label={`Vínculo ou função do participante ${idx + 1}`}
                                placeholder={kinshipPlaceholder}
                                value={p.kinship || ""}
                                disabled={isIdentityDisabled}
                                onChange={(e) => {
                                  markLocalEdit();
                                  const nextKinship = e.target.value;
                                  setParticipants((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? applyManualParticipantFieldEdit(item, {
                                            kinship: nextKinship,
                                          })
                                        : item
                                    )
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg bg-slate-50/70 text-xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                              />
                            </div>
                          )}
                          <div className={p.role !== "ESTUDANTE" ? "md:col-span-6" : "md:col-span-12"}>
                            <input
                              type="text"
                              aria-label={`Telefone de contato do participante ${idx + 1}`}
                              placeholder="Telefone de contato (opcional)"
                              value={p.phone || ""}
                              disabled={isContentLocked}
                              onChange={(e) => {
                                if (isContentLocked) return;
                                markLocalEdit();
                                const nextPhone = e.target.value;
                                setParticipants((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? applyManualParticipantFieldEdit(item, { phone: nextPhone })
                                      : item
                                  )
                                );
                              }}
                              className="w-full p-1.5 border border-slate-200 rounded-lg bg-slate-50/70 text-xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                            />
                          </div>
                        </div>

                        {isLockedBySignature && (
                          <p
                            className={`text-[11px] rounded-lg px-2.5 py-1.5 border ${
                              p.signatureMode === "REFUSED"
                                ? "text-rose-900 bg-rose-50 border-rose-200"
                                : "text-emerald-800 bg-emerald-50 border-emerald-200"
                            }`}
                          >
                            {p.signatureMode === "REFUSED"
                              ? 'Identidade e função bloqueadas após registro de recusa.'
                              : 'Assinatura vinculada a esta revisão. Para editar a ata ou refazer coletas, utilize "Reabrir para edição".'}
                          </p>
                        )}

                        {signatureResetErrors[idx] && (
                          <p
                            role="alert"
                            className="text-[11px] text-rose-900 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 font-medium"
                          >
                            {signatureResetErrors[idx]}
                          </p>
                        )}

                        {isQrActive && (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5">
                            <span className="font-semibold">
                              Link QR ativo aguardando assinatura. Cancele o link antes de alterar nome, documento ou função.
                            </span>
                            <button
                              type="button"
                              disabled={cancelingQrIndex !== null}
                              onClick={() => void handleCancelParticipantQr(idx)}
                              className="px-2 py-0.5 rounded bg-white border border-sky-300 text-sky-800 font-bold hover:bg-sky-100 transition cursor-pointer disabled:opacity-50"
                            >
                              {cancelingQrIndex === idx ? "Cancelando..." : "Cancelar link QR e editar"}
                            </button>
                          </div>
                        )}

                        {signatureResetNotices[idx] && (
                          <p
                            role="status"
                            className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5"
                          >
                            {signatureResetNotices[idx]}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          <div className="flex items-center space-x-2">
                            <label className="flex items-center space-x-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(p.documentVerifiedByStaff)}
                                disabled={isIdentityDisabled}
                                onChange={(e) => {
                                  markLocalEdit();
                                  const checked = e.target.checked;
                                  setParticipants((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? { ...item, documentVerifiedByStaff: checked }
                                        : item
                                    )
                                  );
                                }}
                                className="rounded border-slate-300 text-sky-600"
                              />
                              <span className="text-[11px] text-slate-600 font-medium">
                                Documento conferido presencialmente
                              </span>
                            </label>
                          </div>

                          <div className="flex items-center space-x-1.5">
                            {(() => {
                              const sig = getParticipantSignatureSummary(p);
                              if (sig.hasPersistedSignature) {
                                return (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="inline-flex items-center space-x-1 text-emerald-700 font-bold text-xs bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>
                                        {sig.isInstitutionalVerified
                                          ? `✓ @escola (${p.verifiedEmail})`
                                          : p.biometricVerified
                                          ? "✓ Assinado com Biometria"
                                          : typeof p.signedRevision === "number"
                                          ? `✓ Assinado (Rev. ${p.signedRevision})`
                                          : "✓ Assinado sem vínculo de revisão"}
                                      </span>
                                    </span>
                                  </div>
                                );
                              }
                              if (sig.isRefused) {
                                return (
                                  <div className="flex items-center space-x-1.5">
                                    <span className="inline-flex items-center space-x-1 text-rose-600 font-bold text-xs bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
                                      <AlertCircle className="w-3.5 h-3.5" />
                                      <span>Recusou-se a assinar</span>
                                    </span>
                                    {!isContentLocked && (
                                      <button
                                        type="button"
                                        disabled={resettingSigIndex !== null || cancelingQrIndex !== null}
                                        onClick={() => void handleResetParticipantSignature(idx)}
                                        className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer flex items-center space-x-1 text-[11px] font-semibold disabled:opacity-50"
                                        title="Cancelar recusa"
                                        aria-label="Cancelar recusa"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        <span>
                                          {resettingSigIndex === idx ? "Cancelando..." : "Cancelar recusa"}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                );
                              }
                              return (
                              <>
                                <button
                                  type="button"
                                  disabled={
                                    saving ||
                                    isHydratingMinute ||
                                    savingScreenSigIndex !== null ||
                                    revisionLockState.hasLegacyUnprovableProof ||
                                    !isCurrentRevisionConfirmed ||
                                    !p.id
                                  }
                                  title={
                                    !persistedHasMinimumSummary
                                      ? OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR
                                      : !isCurrentRevisionConfirmed
                                        ? "Salve o rascunho e confirme a conferência da revisão antes de assinar na tela"
                                        : "Assinar presencialmente na tela do dispositivo"
                                  }
                                  onClick={() => {
                                    if (!isCurrentRevisionConfirmed || !p.id || !persistedSnapshot) return;
                                    setActiveRefusalIndex(null);
                                    setFinalizeError(null);
                                    const participantId = p.id;
                                    const targetRev = persistedSnapshot.contentRevision;
                                    setActiveSignTarget((prev) =>
                                      prev?.index === idx && prev.participantId === participantId
                                        ? null
                                        : { index: idx, participantId, revision: targetRev }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-2xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {savingScreenSigIndex === idx ? "Salvando..." : "Assinar na Tela"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleGenerateMobileSign(idx)}
                                  disabled={
                                    saving ||
                                    isGeneratingQr ||
                                    isHydratingMinute ||
                                    cancelingQrIndex !== null ||
                                    resettingSigIndex !== null ||
                                    revisionLockState.hasLegacyUnprovableProof ||
                                    !isCurrentRevisionConfirmed ||
                                    !p.id
                                  }
                                  title={
                                    !persistedHasMinimumSummary
                                      ? OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR
                                      : !isCurrentRevisionConfirmed
                                        ? "Salve o rascunho e confirme a conferência da revisão antes de emitir QR Celular"
                                        : "Gerar link e QR Code para assinatura no celular"
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-xs transition flex items-center space-x-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                  <span>QR Celular (Biometria)</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isContentLocked}
                                  onClick={() => {
                                    if (isContentLocked) return;
                                    setActiveSignTarget(null);
                                    setRefusalDraftReason(p.refusalReason || "");
                                    setRefusalDraftWitness(p.witnessName || "Equipe Pedagógica");
                                    setActiveRefusalIndex(activeRefusalIndex === idx ? null : idx);
                                  }}
                                  className="px-2 py-1 rounded-lg border border-rose-300 hover:bg-rose-50 text-rose-700 font-bold text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Recusa
                                </button>
                              </>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Formulário inline de Recusa (sem window.prompt!) */}
                        {activeRefusalIndex === idx && (
                          <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl space-y-2 mt-2">
                            <p className="font-bold text-rose-900 text-xs">
                              Registro de Recusa de Assinatura:
                            </p>
                            <input
                              type="text"
                              value={refusalDraftReason}
                              onChange={(e) => setRefusalDraftReason(e.target.value)}
                              placeholder="Motivo alegado para a recusa..."
                              className="w-full p-2 border border-rose-300 rounded-lg bg-white text-xs"
                            />
                            <input
                              type="text"
                              value={refusalDraftWitness}
                              onChange={(e) => setRefusalDraftWitness(e.target.value)}
                              placeholder="Nome da testemunha escolar presente..."
                              className="w-full p-2 border border-rose-300 rounded-lg bg-white text-xs"
                            />
                            <div className="flex justify-end space-x-2">
                              <button
                                type="button"
                                onClick={() => setActiveRefusalIndex(null)}
                                className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold text-xs cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  markLocalEdit();
                                  const targetParticipant = participants[idx];
                                  if (targetParticipant?.id && qrModalInfo?.participantId === targetParticipant.id) {
                                    closeQrPanel();
                                  }
                                  setSignatureResetNotices((prev) => {
                                    if (!(idx in prev)) return prev;
                                    const next = { ...prev };
                                    delete next[idx];
                                    return next;
                                  });
                                  setSignatureResetErrors((prev) => {
                                    if (!(idx in prev)) return prev;
                                    const next = { ...prev };
                                    delete next[idx];
                                    return next;
                                  });
                                  const copy = [...participants];
                                  copy[idx] = {
                                    ...copy[idx],
                                    signatureMode: "REFUSED",
                                    signatureData: null,
                                    hasActiveSignLink: false,
                                    refusalReason: refusalDraftReason.trim() || "Recusou-se a assinar presencialmente",
                                    witnessName: refusalDraftWitness.trim() || "Equipe Pedagógica",
                                  };
                                  setParticipants(copy);
                                  setActiveRefusalIndex(null);
                                }}
                                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer"
                              >
                                Confirmar Termo de Recusa
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Canvas de Assinatura em tela vinculado à revisão conferida */}
                        {activeSignTarget?.index === idx &&
                          Boolean(p.id && activeSignTarget.participantId === p.id) &&
                          activeSignTarget.revision === contentRevision &&
                          isCurrentRevisionConfirmed &&
                          !getParticipantSignatureSummary(p).hasPersistedSignature && (
                          <div className="pt-2">
                            <SignatureCanvas
                              key={`${p.id}-rev-${activeSignTarget.revision}`}
                              signerName={p.name || "Participante"}
                              revisionLabel={`Revisão ${activeSignTarget.revision}`}
                              isSubmitting={savingScreenSigIndex === idx}
                              onCancel={() => {
                                setActiveSignTarget(null);
                                setFinalizeError(null);
                              }}
                              onSave={(dataUrl, strokeData) =>
                                handleScreenSignatureConfirm(
                                  idx,
                                  dataUrl,
                                  strokeData,
                                  activeSignTarget.revision,
                                  activeSignTarget.participantId
                                )
                              }
                              onClear={() => {
                                setFinalizeError(null);
                              }}
                            />
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>

                {/* Painel de Assinatura Móvel: QR Code, Link Direto e WhatsApp */}
                {qrModalInfo && (
                  <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl space-y-3 shadow-sm">
                    {/* Banner de Status, Alertas e Recuperação */}
                    <AtaQrPollStatusBanner
                      state={qrUiState}
                      onRetry={() => void handleQrRetryAction()}
                      onClose={() => closeQrPanel()}
                      onRenewLink={() => {
                        const pIdx = participants.findIndex((p) => p.id === qrModalInfo.participantId);
                        if (pIdx >= 0) {
                          void handleGenerateMobileSign(
                            pIdx,
                            qrModalInfo.expiresInMinutes || 20,
                            qrModalInfo.participantId
                          );
                        } else {
                          void refreshQrMinute();
                        }
                      }}
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200/80 pb-2">
                      <div>
                        <h4 className="font-extrabold text-sky-950 text-sm">
                          Assinatura Digital de {qrModalInfo.name}
                        </h4>
                        <p className="text-[11px] text-sky-700">
                          {qrModalInfo.participantRole === "ESTUDANTE"
                            ? "O estudante pode assinar em 1 clique conectando sua conta @escola.pr.gov.br ou na tela do celular."
                            : qrModalInfo.participantRole === "PROFESSOR"
                            ? "O(A) docente pode assinar em 1 clique conectando sua conta institucional @escola.pr.gov.br ou na tela do celular."
                            : "Aguardando assinatura em tempo real..."}
                        </p>
                        {(() => {
                          const validity = formatSignLinkValidity(qrModalInfo.expiresAt, validityNowMs);
                          if (!validity) return null;
                          return (
                            <p
                              className={`text-[11px] font-semibold mt-1 flex items-center space-x-1 ${
                                validity.isLocallyElapsed ? "text-amber-700" : "text-sky-900"
                              }`}
                            >
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>{validity.label}</span>
                            </p>
                          );
                        })()}
                      </div>

                      {/* Seletor de Validade do Token */}
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-sky-200 text-xs">
                          <span className="text-[10px] text-slate-400 font-bold px-1.5 flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-sky-600" />
                            <span>{isGeneratingQr ? "Atualizando..." : "Validade:"}</span>
                          </span>
                          <button
                            type="button"
                            disabled={saving || isGeneratingQr || isHydratingMinute}
                            onClick={() => {
                              setSignDurationOption(20);
                              const pIdx = participants.findIndex((p) => p.id === qrModalInfo.participantId);
                              if (pIdx >= 0) {
                                void handleGenerateMobileSign(pIdx, 20, qrModalInfo.participantId);
                              } else {
                                void refreshQrMinute();
                              }
                            }}
                            className={`px-2 py-0.5 rounded-lg font-bold text-[11px] cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed ${
                              qrModalInfo.expiresInMinutes === 20
                                ? "bg-sky-600 text-white"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            20 min (Presencial)
                          </button>
                          <button
                            type="button"
                            disabled={saving || isGeneratingQr || isHydratingMinute}
                            onClick={() => {
                              setSignDurationOption(1440);
                              const pIdx = participants.findIndex((p) => p.id === qrModalInfo.participantId);
                              if (pIdx >= 0) {
                                void handleGenerateMobileSign(pIdx, 1440, qrModalInfo.participantId);
                              } else {
                                void refreshQrMinute();
                              }
                            }}
                            className={`px-2 py-0.5 rounded-lg font-bold text-[11px] cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed ${
                              qrModalInfo.expiresInMinutes === 1440
                                ? "bg-sky-600 text-white"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            24 horas (Remoto)
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          Alterar a validade gera um novo QR Code e invalida o link anterior.
                        </span>
                      </div>
                    </div>

                    {(qrUiState.status === "waiting" ||
                      (qrUiState.status === "sync_error" &&
                        qrUiState.pendingRecoveryAction === "resumePolling")) && (
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      <div className="md:col-span-4 flex justify-center">
                        <div className="p-2 bg-white rounded-xl border border-sky-200 shadow-2xs flex items-center justify-center">
                          <AtaQrCode
                            value={qrModalInfo.url}
                            size={128}
                            className="w-32 h-32"
                            alt="QR Code Assinatura"
                          />
                        </div>
                      </div>

                      <div className="md:col-span-8 space-y-2.5">
                        <p className="text-xs text-slate-700 leading-relaxed">
                          Aponte a câmera do celular para o QR Code ao lado ou utilize os botões rápidos para compartilhar o link direto com o signatário:
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(qrModalInfo.url);
                              setCopyFeedback(true);
                              setTimeout(() => setCopyFeedback(false), 2500);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold text-xs shadow-2xs transition flex items-center space-x-1.5 cursor-pointer"
                          >
                            {copyFeedback ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700">Link Copiado!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-slate-500" />
                                <span>Copiar Link de Assinatura</span>
                              </>
                            )}
                          </button>

                          {(() => {
                            const waUrl = buildWhatsAppDispatchUrl(
                              "",
                              `Olá, ${qrModalInfo.name}! Segue o link oficial para ciência e assinatura digital do atendimento pedagógico: ${qrModalInfo.url}`
                            );
                            return (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.preventDefault();
                                  dispatchWhatsAppToBrowser(waUrl);
                                }}
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-2xs transition flex items-center space-x-1.5 cursor-pointer"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Enviar via WhatsApp</span>
                              </a>
                            );
                          })()}

                          <a
                            href={qrModalInfo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-2xs transition flex items-center space-x-1.5 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Abrir em Nova Aba</span>
                          </a>
                        </div>

                        <p className="text-[10px] text-slate-500 font-mono break-all bg-white p-2 rounded-lg border border-sky-100">
                          {qrModalInfo.url}
                        </p>
                      </div>
                    </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => closeQrPanel()}
                        className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer transition"
                      >
                        Fechar Painel de Assinatura
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Feedback de Rascunho Salvo */}
            {draftSavedMsg && (
              <div
                role="status"
                aria-live="polite"
                className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center space-x-2 font-bold"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{draftSavedMsg}</span>
              </div>
            )}

            {/* Aviso de Erro Visual na Lavratura ou Salvamento de Minuta */}
            {finalizeError && (
              <div
                role="alert"
                className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start space-x-2.5"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="font-bold text-xs">Não foi possível concluir a operação:</strong>
                  <p className="text-xs leading-relaxed">{finalizeError}</p>
                </div>
              </div>
            )}

            {/* Barra de Ações Inferior da Etapa 2 — Separação entre Navegação, Minuta e Confirmação Final */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 text-xs transition flex items-center space-x-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{ataScope === "TEACHERS" ? "Voltar aos Docentes & Pauta" : "Voltar aos Estudantes"}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:text-slate-900 font-medium text-xs transition cursor-pointer"
                >
                  Fechar
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {!isContentLocked ? (
                  <div className="flex items-center gap-2 p-1.5 rounded-2xl border border-slate-200 bg-slate-50">
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={saving || savingFinal || isHydratingMinute || Boolean(hydrationError)}
                      className="px-4 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold text-xs transition disabled:opacity-50 cursor-pointer shadow-2xs"
                    >
                      {saving ? "Salvando minuta..." : "Salvar Rascunho"}
                    </button>
                  </div>
                ) : (minuteId || existingMinute?.id) ? (
                  <button
                    type="button"
                    disabled={isReopening || savingFinal}
                    onClick={() => setReopenConfirmRevision(contentRevision)}
                    className="px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-bold text-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reabrir para edição</span>
                  </button>
                ) : null}

                <div className="flex items-center gap-2 p-1.5 rounded-2xl border border-emerald-200 bg-emerald-50/60">
                  <button
                    type="button"
                    onClick={() => handleFinalize()}
                    disabled={
                      saving ||
                      savingFinal ||
                      isHydratingMinute ||
                      Boolean(hydrationError) ||
                      revisionLockState.hasLegacyUnprovableProof
                    }
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 cursor-pointer"
                  >
                    <FileCheck2 className="w-4 h-4 text-emerald-100" />
                    <span>{savingFinal ? "Confirmando..." : "Lavrar Ata"}</span>
                  </button>
                  <span className="text-[10px] font-semibold text-emerald-900 pr-2 hidden sm:inline">
                    Confirma autoria por PIN
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de PIN de Fé Pública do Servidor */}
      <SigningPinModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={(pin) => {
          setShowPinModal(false);
          if (pendingPinAction === "addendum") {
            handleAddAddendum(pin);
          } else if (pendingPinAction === "void") {
            handleVoidMinute(pin);
          } else {
            handleFinalize(pin);
          }
        }}
        hasPinInitial={hasSigningPin}
      />
    </AtaDialog>
  );
}
