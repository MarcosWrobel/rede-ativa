export interface RevisionParticipantLike {
  id?: string | null;
  role?: string | null;
  studentId?: string | null;
  name?: string | null;
  kinship?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  documentVerifiedByStaff?: boolean | null;
  phone?: string | null;
  expectedEmail?: string | null;
  signatureMode?: string | null;
  signatureData?: string | null;
  verifiedEmail?: string | null;
  signedAt?: string | Date | null;
  biometricVerified?: boolean | null;
  hasSignature?: boolean | null;
  hasActiveSignLink?: boolean | null;
  mobileSignToken?: string | null;
  mobileSignRevision?: number | null;
  signedRevision?: number | null;
  refusalReason?: string | null;
  witnessName?: string | null;
  clearSignature?: boolean | null;
}

export interface RevisionStudentSnapshotLike {
  studentId: string;
  studentNameSnapshot?: string | null;
  classNameSnapshot?: string | null;
  cgmSnapshot?: string | null;
}

export interface RevisionMinuteLike {
  status?: string | null;
  contentRevision?: number | null;
  physicalScanRevision?: number | null;
  physicalScanSupersededAt?: string | Date | null;
  hasPhysicalScan?: boolean | null;
  physicalSignedScanData?: string | null;
  physicalScanStorageKey?: string | null;
  govBrVerified?: boolean | null;
  govBrProtocol?: string | null;
  physicalProofHistory?: Array<unknown> | null;
  category?: string | null;
  isConfidential?: boolean | null;
  attendedAt?: string | Date | null;
  subject?: string | null;
  rawNotes?: string | null;
  summary?: string | null;
  agreementsSummary?: string | null;
  students?: RevisionStudentSnapshotLike[] | null;
  participants?: RevisionParticipantLike[] | null;
  actionItems?: Array<{
    description?: string | null;
    responsible?: string | null;
    dueDate?: string | Date | null;
    status?: string | null;
  }> | null;
}

export interface EffectivePhysicalProofState {
  currentRevision: number;
  hasPhysicalArtifact: boolean;
  isCurrentRevisionPhysicalProof: boolean;
  isLegacyPreVersioningFinalizedProof: boolean;
  hasValidPhysicalProof: boolean;
  isValidGovBrVerified: boolean;
  effectiveGovBrProtocol: string | null;
  isSuperseded: boolean;
  historicalCount: number;
}

export interface MinuteRevisionLockState {
  currentRevision: number;
  signedCount: number;
  validSignedCount: number;
  legacySignedCount: number;
  hasActivePhysicalProof: boolean;
  isPhysicalProofValid: boolean;
  isPhysicalProofLegacy: boolean;
  hasLegacyUnprovableProof: boolean;
  hasValidSignatureOrProof: boolean;
  isLockedBySignature: boolean;
  canCollectRemainingSignatures: boolean;
  canFinalize: boolean;
  activeLinksCount: number;
}

export const MIN_OFFICIAL_SUMMARY_LENGTH = 10;

export const OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR =
  "Preencha e salve o Texto Oficial da Ata com pelo menos 10 caracteres antes de conferir ou coletar assinaturas.";

export const OFFICIAL_SUMMARY_REQUIRED_FOR_FINALIZATION_ERROR =
  "O texto formal da ata deve ser preenchido (mínimo de 10 caracteres) antes da lavratura oficial.";

export const OFFICIAL_SUMMARY_REQUIRED_FOR_LINK_SIGN_ERROR =
  "O texto oficial desta revisão ainda não possui o mínimo de 10 caracteres. Peça à equipe escolar para completar, salvar e conferir o rascunho antes de emitir um novo link para coletar a assinatura.";

/**
 * Regra canônica de completude do texto oficial: mínimo de 10 caracteres após remover espaços nas extremidades.
 */
export function hasMinimumOfficialSummary(summary: string | null | undefined): boolean {
  return typeof summary === "string" && summary.trim().length >= MIN_OFFICIAL_SUMMARY_LENGTH;
}

/**
 * Calcula quantos caracteres ainda faltam no texto oficial após `.trim()`.
 */
export function getOfficialSummaryRemainingChars(summary: string | null | undefined): number {
  const len = typeof summary === "string" ? summary.trim().length : 0;
  return Math.max(0, MIN_OFFICIAL_SUMMARY_LENGTH - len);
}

export function normalizeRevisionNumber(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/**
 * Indica se o participante possui assinatura/ciência efetivamente coletada
 * (exclui registros pendentes ou marcados como RECUSA).
 */
export function hasParticipantCollectedSignature(
  p: RevisionParticipantLike | null | undefined
): boolean {
  if (!p || p.signatureMode === "REFUSED") return false;
  return Boolean(
    p.hasSignature ||
      p.signatureData ||
      p.verifiedEmail ||
      p.signedAt ||
      p.biometricVerified
  );
}

/**
 * Indica se existe prova física digitalizada ou registro Gov.br vinculada ao rascunho atual
 * (não substituída por reabertura).
 */
export function hasDraftPhysicalProof(
  minute: RevisionMinuteLike | null | undefined
): boolean {
  if (!minute) return false;
  if (minute.status && minute.status !== "DRAFT") return false;
  if (minute.physicalScanSupersededAt) return false;
  return Boolean(
    minute.hasPhysicalScan ||
      minute.physicalSignedScanData ||
      minute.physicalScanStorageKey ||
      minute.govBrVerified
  );
}

/**
 * Avalia se a via física e o selo Gov.br pertencem efetivamente à revisão vigente
 * (ou a uma ata já lavrada antes do versionamento sem sinalização de reabertura).
 * Impede que provas superadas em reaberturas anteriores apareçam como válidas na revisão atual.
 */
export function evaluateEffectivePhysicalProof(
  minute: RevisionMinuteLike | null | undefined
): EffectivePhysicalProofState {
  const currentRevision = normalizeRevisionNumber(minute?.contentRevision);
  const hasPhysicalArtifact = Boolean(
    minute?.hasPhysicalScan ||
      (typeof minute?.physicalSignedScanData === "string" &&
        minute.physicalSignedScanData.length > 0) ||
      minute?.physicalScanStorageKey
  );
  const hasAnyPhysicalOrGovBrSignal = hasPhysicalArtifact || Boolean(minute?.govBrVerified);
  const isOfficialFinalOrVoid =
    minute?.status === "FINALIZED" || minute?.status === "VOIDED";

  const isCurrentRevisionPhysicalProof =
    Boolean(minute) &&
    !minute?.physicalScanSupersededAt &&
    hasAnyPhysicalOrGovBrSignal &&
    typeof minute?.physicalScanRevision === "number" &&
    minute.physicalScanRevision === currentRevision;

  const isLegacyPreVersioningFinalizedProof =
    Boolean(minute) &&
    isOfficialFinalOrVoid &&
    !minute?.physicalScanSupersededAt &&
    (minute?.physicalScanRevision === null || minute?.physicalScanRevision === undefined) &&
    currentRevision === 1 &&
    hasAnyPhysicalOrGovBrSignal;

  const hasValidPhysicalProof =
    isCurrentRevisionPhysicalProof || isLegacyPreVersioningFinalizedProof;
  const isValidGovBrVerified = hasValidPhysicalProof && Boolean(minute?.govBrVerified);
  const effectiveGovBrProtocol = isValidGovBrVerified
    ? minute?.govBrProtocol || null
    : null;
  const isSuperseded =
    Boolean(minute?.physicalScanSupersededAt) ||
    (hasAnyPhysicalOrGovBrSignal && !hasValidPhysicalProof && isOfficialFinalOrVoid);
  const historicalCount = Array.isArray(minute?.physicalProofHistory)
    ? minute.physicalProofHistory.length
    : 0;

  return {
    currentRevision,
    hasPhysicalArtifact,
    isCurrentRevisionPhysicalProof,
    isLegacyPreVersioningFinalizedProof,
    hasValidPhysicalProof,
    isValidGovBrVerified,
    effectiveGovBrProtocol,
    isSuperseded,
    historicalCount,
  };
}

/**
 * Avalia o estado consolidado de trava por assinatura / prova física / legado na revisão atual da ata.
 */
export function evaluateMinuteRevisionLock(
  minute: RevisionMinuteLike | null | undefined
): MinuteRevisionLockState {
  const currentRevision = normalizeRevisionNumber(minute?.contentRevision);
  const participants = Array.isArray(minute?.participants) ? minute.participants : [];

  let signedCount = 0;
  let validSignedCount = 0;
  let legacySignedCount = 0;
  let activeLinksCount = 0;

  for (const p of participants) {
    if (p?.hasActiveSignLink || p?.mobileSignToken) {
      activeLinksCount += 1;
    }
    if (!hasParticipantCollectedSignature(p)) continue;
    signedCount += 1;
    if (typeof p?.signedRevision === "number" && p.signedRevision === currentRevision) {
      validSignedCount += 1;
    } else {
      legacySignedCount += 1;
    }
  }

  const hasActivePhysicalProof = hasDraftPhysicalProof(minute);
  const isPhysicalProofValid =
    hasActivePhysicalProof &&
    typeof minute?.physicalScanRevision === "number" &&
    minute.physicalScanRevision === currentRevision;
  const isPhysicalProofLegacy = hasActivePhysicalProof && !isPhysicalProofValid;

  const hasLegacyUnprovableProof = legacySignedCount > 0 || isPhysicalProofLegacy;
  const hasValidSignatureOrProof = validSignedCount > 0 || isPhysicalProofValid;
  const isDraft = !minute?.status || minute.status === "DRAFT";

  return {
    currentRevision,
    signedCount,
    validSignedCount,
    legacySignedCount,
    hasActivePhysicalProof,
    isPhysicalProofValid,
    isPhysicalProofLegacy,
    hasLegacyUnprovableProof,
    hasValidSignatureOrProof,
    isLockedBySignature: isDraft && (hasValidSignatureOrProof || hasLegacyUnprovableProof),
    canCollectRemainingSignatures: isDraft && !hasLegacyUnprovableProof,
    canFinalize: isDraft && !hasLegacyUnprovableProof,
    activeLinksCount,
  };
}

function normalizeText(val: unknown): string {
  return typeof val === "string" ? val.trim() : "";
}

function normalizeNullableText(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = String(val).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function exactString(val: unknown): string {
  return typeof val === "string" ? val : "";
}

function exactNullableString(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  return String(val);
}

function exactNullableOrEmptyAsNull(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  const str = String(val);
  return str.length > 0 ? str : null;
}

function toTimestampMs(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const ms = val instanceof Date ? val.getTime() : new Date(String(val)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeStudentIdSet(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const ids = new Set<string>();
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      ids.add(item.trim());
    } else if (item && typeof item === "object" && typeof (item as any).studentId === "string") {
      const sid = String((item as any).studentId).trim();
      if (sid) ids.add(sid);
    }
  }
  return Array.from(ids).sort();
}

function normalizeStudentSnapshotTuples(
  list: RevisionStudentSnapshotLike[] | null | undefined
) {
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => ({
      studentId: exactString(s.studentId),
      studentNameSnapshot: exactNullableString(s.studentNameSnapshot),
      classNameSnapshot: exactNullableOrEmptyAsNull(s.classNameSnapshot),
      cgmSnapshot: exactNullableOrEmptyAsNull(s.cgmSnapshot),
    }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}

function normalizeActionItems(
  list:
    | Array<{
        description?: unknown;
        responsible?: unknown;
        dueDate?: unknown;
        status?: unknown;
      }>
    | null
    | undefined
) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    description: exactString(a.description),
    responsible: exactString(a.responsible),
    dueDateMs: toTimestampMs(a.dueDate),
    status: exactString(a.status) || "PENDING",
  }));
}

function normalizeParticipantForDiff(
  p: RevisionParticipantLike,
  options: {
    ignoreSignatureModeWhenPending?: boolean;
    existingParticipant?: RevisionParticipantLike | null;
    preserveRawStudentId?: boolean;
  } = {}
) {
  const role = exactString(p.role) || "RESPONSAVEL";
  const normalizedRoleUpper = role.trim().toUpperCase();
  const rawStudentId = exactNullableOrEmptyAsNull(p.studentId);
  const studentId = options.preserveRawStudentId
    ? rawStudentId
    : normalizedRoleUpper === "ESTUDANTE"
      ? rawStudentId
      : null;
  const effectiveMode =
    options.ignoreSignatureModeWhenPending &&
    (!p.signatureMode || p.signatureMode === "PENDING") &&
    options.existingParticipant
      ? exactString(options.existingParticipant.signatureMode) || "PENDING"
      : exactString(p.signatureMode) || "PENDING";

  return {
    id: exactNullableOrEmptyAsNull(p.id),
    role,
    studentId,
    name: exactString(p.name) || "Responsável Presente",
    kinship: exactNullableOrEmptyAsNull(p.kinship),
    documentType: exactNullableOrEmptyAsNull(p.documentType),
    documentNumber: exactNullableOrEmptyAsNull(p.documentNumber),
    documentVerifiedByStaff: Boolean(p.documentVerifiedByStaff),
    phone: exactNullableOrEmptyAsNull(p.phone),
    expectedEmail: exactNullableOrEmptyAsNull(p.expectedEmail),
    signatureMode: effectiveMode,
    refusalReason: effectiveMode === "REFUSED" ? exactNullableOrEmptyAsNull(p.refusalReason) : null,
    witnessName: effectiveMode === "REFUSED" ? exactNullableOrEmptyAsNull(p.witnessName) : null,
  };
}

/**
 * Determina se um PATCH de rascunho trouxe alteração efetiva no conteúdo, snapshots de vínculos ou signatários
 * efetivamente persistidos. Usado antes da primeira assinatura para avançar `contentRevision` e revogar links antigos
 * exatamente quando o registro persistido ou apresentado ao signatário mudar.
 */
export function hasEffectiveMinuteDraftChanges(
  existing: RevisionMinuteLike,
  incoming: {
    category?: string;
    isConfidential?: boolean;
    attendedAt?: string | Date;
    subject?: string;
    rawNotes?: string | null;
    summary?: string;
    agreementsSummary?: string | null;
    studentIds?: string[];
    nextStudentSnapshots?: RevisionStudentSnapshotLike[];
    participants?: RevisionParticipantLike[];
    nextMergedParticipants?: RevisionParticipantLike[];
    actionItems?: Array<{
      description?: string;
      responsible?: string;
      dueDate?: string | null;
      status?: string;
    }>;
    nextActionItems?: Array<{
      description?: string;
      responsible?: string;
      dueDate?: string | Date | null;
      status?: string;
    }>;
  }
): boolean {
  if (
    incoming.category !== undefined &&
    exactString(incoming.category) !== exactString(existing.category)
  ) {
    return true;
  }
  if (
    incoming.isConfidential !== undefined &&
    Boolean(incoming.isConfidential) !== Boolean(existing.isConfidential)
  ) {
    return true;
  }
  if (incoming.attendedAt !== undefined) {
    const existingMs = toTimestampMs(existing.attendedAt);
    const incomingMs = toTimestampMs(incoming.attendedAt);
    if (existingMs !== incomingMs) {
      return true;
    }
  }
  if (
    incoming.subject !== undefined &&
    exactString(incoming.subject) !== exactString(existing.subject)
  ) {
    return true;
  }
  if (
    incoming.rawNotes !== undefined &&
    exactNullableString(incoming.rawNotes) !== exactNullableString(existing.rawNotes)
  ) {
    return true;
  }
  if (
    incoming.summary !== undefined &&
    exactString(incoming.summary) !== exactString(existing.summary)
  ) {
    return true;
  }
  if (
    incoming.agreementsSummary !== undefined &&
    exactNullableString(incoming.agreementsSummary) !== exactNullableString(existing.agreementsSummary)
  ) {
    return true;
  }

  if (incoming.nextStudentSnapshots !== undefined) {
    const existingSnapshots = normalizeStudentSnapshotTuples(existing.students);
    const nextSnapshots = normalizeStudentSnapshotTuples(incoming.nextStudentSnapshots);
    if (JSON.stringify(existingSnapshots) !== JSON.stringify(nextSnapshots)) {
      return true;
    }
  } else if (incoming.studentIds !== undefined) {
    const existingIds = normalizeStudentIdSet(existing.students);
    const nextIds = normalizeStudentIdSet(incoming.studentIds);
    if (JSON.stringify(existingIds) !== JSON.stringify(nextIds)) {
      return true;
    }
  }

  const candidateActionItems =
    incoming.nextActionItems !== undefined ? incoming.nextActionItems : incoming.actionItems;
  if (candidateActionItems !== undefined) {
    const existingActions = normalizeActionItems(existing.actionItems);
    const nextActions = normalizeActionItems(candidateActionItems);
    if (JSON.stringify(existingActions) !== JSON.stringify(nextActions)) {
      return true;
    }
  }

  const useRawStudentId = incoming.nextMergedParticipants !== undefined;
  const candidateParticipants = useRawStudentId
    ? incoming.nextMergedParticipants
    : incoming.participants;
  if (candidateParticipants !== undefined) {
    const existingList = (existing.participants || []).map((ep) =>
      normalizeParticipantForDiff(ep, { preserveRawStudentId: useRawStudentId })
    );
    const nextList = (candidateParticipants || []).map((ip) =>
      normalizeParticipantForDiff(ip, { preserveRawStudentId: useRawStudentId })
    );
    if (existingList.length !== nextList.length) {
      return true;
    }
    for (let i = 0; i < nextList.length; i++) {
      if ((incoming.participants || [])[i]?.clearSignature) {
        return true;
      }
      if (JSON.stringify(existingList[i]) !== JSON.stringify(nextList[i])) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Verifica se um payload de lavratura (/finalize) tenta alterar qualquer dado de conteúdo,
 * estudantes, participantes ou encaminhamentos de uma ata já assinada/travada.
 */
export function hasFinalizationContentConflicts(
  minute: RevisionMinuteLike,
  rawBody: Record<string, any> | null | undefined
): boolean {
  if (!rawBody || typeof rawBody !== "object") return false;

  if (
    rawBody.category !== undefined &&
    normalizeText(rawBody.category) !== normalizeText(minute.category)
  ) {
    return true;
  }
  if (
    rawBody.isConfidential !== undefined &&
    Boolean(rawBody.isConfidential) !== Boolean(minute.isConfidential)
  ) {
    return true;
  }
  if (rawBody.attendedAt !== undefined) {
    const existingMs = toTimestampMs(minute.attendedAt);
    const incomingMs = toTimestampMs(rawBody.attendedAt);
    if (existingMs !== null && incomingMs !== null && existingMs !== incomingMs) {
      return true;
    }
  }
  if (
    rawBody.subject !== undefined &&
    normalizeText(rawBody.subject) !== normalizeText(minute.subject)
  ) {
    return true;
  }
  if (
    rawBody.rawNotes !== undefined &&
    normalizeNullableText(rawBody.rawNotes) !== normalizeNullableText(minute.rawNotes)
  ) {
    return true;
  }
  if (
    rawBody.summary !== undefined &&
    normalizeText(rawBody.summary) !== normalizeText(minute.summary)
  ) {
    return true;
  }
  if (
    rawBody.agreementsSummary !== undefined &&
    normalizeNullableText(rawBody.agreementsSummary) !== normalizeNullableText(minute.agreementsSummary)
  ) {
    return true;
  }

  if (rawBody.studentIds !== undefined) {
    const existingIds = normalizeStudentIdSet(minute.students);
    const nextIds = normalizeStudentIdSet(rawBody.studentIds);
    if (JSON.stringify(existingIds) !== JSON.stringify(nextIds)) {
      return true;
    }
  }

  if (rawBody.actionItems !== undefined) {
    const existingActions = normalizeActionItems(minute.actionItems);
    const nextActions = normalizeActionItems(rawBody.actionItems);
    if (JSON.stringify(existingActions) !== JSON.stringify(nextActions)) {
      return true;
    }
  }

  if (Array.isArray(rawBody.participants)) {
    const existingParticipants = minute.participants || [];
    if (rawBody.participants.length !== existingParticipants.length) {
      return true;
    }
    for (let i = 0; i < rawBody.participants.length; i++) {
      const inc = rawBody.participants[i] || {};
      if (inc.clearSignature) return true;

      const matched =
        (inc.id && existingParticipants.find((ep) => ep.id === inc.id)) ||
        existingParticipants[i] ||
        null;
      if (!matched) return true;

      // Bloqueia tentativa de forçar recusa sobre participante já assinado na revisão vigente
      if (
        inc.signatureMode === "REFUSED" &&
        hasParticipantCollectedSignature(matched)
      ) {
        return true;
      }

      const normExisting = normalizeParticipantForDiff(matched);
      const normIncoming = normalizeParticipantForDiff(inc, {
        ignoreSignatureModeWhenPending: true,
        existingParticipant: matched,
      });

      if (JSON.stringify(normExisting) !== JSON.stringify(normIncoming)) {
        return true;
      }
    }
  }

  return false;
}
