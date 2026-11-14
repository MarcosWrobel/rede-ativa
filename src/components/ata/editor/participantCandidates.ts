import type {
  AtaParticipantDraft,
  AtaStaffCandidateOption,
  AtaStudentOption,
  ParticipantRowOriginState,
  ParticipantSourceSnapshot,
} from "./types";
import { sanitizeKinshipForRole } from "@/lib/participantKinship";
import {
  isParticipantQrActive,
  isParticipantSignatureLocked,
} from "./participantIdentity";

export type ParticipantCandidateGroup =
  | "ESTUDANTE"
  | "RESPONSAVEL_LEGAL"
  | "FAMILIAR_CONTATO"
  | "RECADO"
  | "PROFESSOR_PAUTA"
  | "STAFF"
  | "STAFF_MANUAL_TEACHER";

export interface ParticipantCandidatePayload {
  role: string;
  studentId: string | null;
  name: string;
  kinship: string;
  documentType: string;
  documentNumber: string;
  phone: string;
  expectedEmail: string | null;
}

export interface ParticipantCandidate {
  key: string;
  group: ParticipantCandidateGroup;
  targetRole: string;
  label: string;
  autoFillEligible: boolean;
  requiresExplicitSelection: boolean;
  originStudentId: string | null;
  nonLegalContactNotice: string | null;
  payload: ParticipantCandidatePayload;
}

export interface BuiltParticipantCandidates {
  studentCandidates: ParticipantCandidate[];
  familyAndGuardianCandidates: ParticipantCandidate[];
  staffCandidates: ParticipantCandidate[];
  teacherCandidates: ParticipantCandidate[];
  byKey: Record<string, ParticipantCandidate>;
}

const CONTACT_KINSHIP_DISPLAY: Record<string, string> = {
  MAE: "Mãe",
  PAI: "Pai",
  AVOS: "Avô / Avó",
  TIOS: "Tio / Tia",
  IRMAOS: "Irmão / Irmã",
  RECADO: "Contato de recado",
  RESPONSAVEL: "Responsável cadastrado",
};

const EXPLICIT_NON_LEGAL_NOTICE =
  "Registrado como Familiar / Contato (não atesta representação legal automática).";
const RECADO_NOTICE =
  "Contato de recado registrado como Familiar / Contato (não comprova guarda ou representação legal).";

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizePhoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeRoleUpper(role: string | null | undefined): string {
  return (role || "RESPONSAVEL").trim().toUpperCase();
}

export function generateParticipantClientKey(prefix = "p"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ensureParticipantClientKey(
  participant: AtaParticipantDraft,
  fallbackIndex?: number
): AtaParticipantDraft {
  if (participant.clientKey) return participant;
  return {
    ...participant,
    clientKey: participant.id
      ? `db-${participant.id}`
      : `local-${fallbackIndex ?? "x"}-${generateParticipantClientKey("row")}`,
  };
}

/**
 * Remove campos exclusivos de estado da UI antes de enviar participantes para a API.
 */
export function stripClientParticipantMeta(
  participant: AtaParticipantDraft
): Omit<
  AtaParticipantDraft,
  | "clientKey"
  | "originState"
  | "autoFilledCandidateKey"
  | "autoOriginStudentId"
  | "sourceSnapshot"
  | "nonLegalContactNotice"
> {
  const {
    clientKey: _clientKey,
    originState: _originState,
    autoFilledCandidateKey: _autoKey,
    autoOriginStudentId: _originStu,
    sourceSnapshot: _snap,
    nonLegalContactNotice: _notice,
    ...apiFields
  } = participant;
  return apiFields;
}

/**
 * Constrói listas de candidatos por papel usando IDs estáveis, zero deduplicação
 * global por nome e regras estritas de elegibilidade e proveniência.
 */
export function buildParticipantCandidates(params: {
  students: AtaStudentOption[];
  staff: AtaStaffCandidateOption[];
  teacherDraftParticipants?: AtaParticipantDraft[];
}): BuiltParticipantCandidates {
  const { students, staff, teacherDraftParticipants = [] } = params;
  const studentCandidates: ParticipantCandidate[] = [];
  const familyAndGuardianCandidates: ParticipantCandidate[] = [];
  const staffCandidates: ParticipantCandidate[] = [];
  const teacherCandidates: ParticipantCandidate[] = [];
  const byKey: Record<string, ParticipantCandidate> = {};

  const register = (list: ParticipantCandidate[], candidate: ParticipantCandidate) => {
    list.push(candidate);
    byKey[candidate.key] = candidate;
  };

  for (const stu of students) {
    const classTag = stu.classGroupName ? ` (${stu.classGroupName})` : "";
    const inactiveTag = stu.isInactiveRecord ? " • Matrícula inativa" : "";

    register(studentCandidates, {
      key: `student:${stu.id}`,
      group: "ESTUDANTE",
      targetRole: "ESTUDANTE",
      label: `${stu.name}${classTag}${stu.cgm ? ` • CGM ${stu.cgm}` : ""}${inactiveTag}`,
      autoFillEligible: true,
      requiresExplicitSelection: false,
      originStudentId: stu.id,
      nonLegalContactNotice: null,
      payload: {
        role: "ESTUDANTE",
        studentId: stu.id,
        name: stu.name,
        kinship: "",
        documentType: "CGM",
        documentNumber: stu.cgm || "",
        phone: stu.phone || "",
        expectedEmail: stu.email || null,
      },
    });

    const contacts = Array.isArray(stu.contacts) ? stu.contacts : [];
    const stuGuardianNorm = normalizeName(stu.guardianName);
    const stuPhoneDigits = normalizePhoneDigits(stu.phone);
    let legacyRedundantWithSameStudentContact = false;

    for (const contact of contacts) {
      const kinshipCode = (contact.kinship || "RESPONSAVEL").trim().toUpperCase();

      // Próprio aluno jamais deve ser sugerido como responsável legal
      if (kinshipCode === "PROPRIO_ALUNO") {
        continue;
      }

      const contactNameNorm = normalizeName(contact.name);
      const contactPhoneDigits = normalizePhoneDigits(contact.phone);
      if (
        stuGuardianNorm &&
        contactNameNorm === stuGuardianNorm &&
        (contact.isPrimary ||
          !stuPhoneDigits ||
          !contactPhoneDigits ||
          contactPhoneDigits === stuPhoneDigits)
      ) {
        legacyRedundantWithSameStudentContact = true;
      }

      if (kinshipCode === "RECADO") {
        register(familyAndGuardianCandidates, {
          key: `contact:${contact.id}`,
          group: "RECADO",
          targetRole: "FAMILIAR_CONTATO",
          label: `${contact.name} — Contato de recado de ${stu.name}${classTag}`,
          autoFillEligible: false,
          requiresExplicitSelection: true,
          originStudentId: stu.id,
          nonLegalContactNotice: RECADO_NOTICE,
          payload: {
            role: "FAMILIAR_CONTATO",
            studentId: null,
            name: contact.name,
            kinship: "Contato de recado",
            documentType: "CPF",
            documentNumber: "",
            phone: contact.phone || "",
            expectedEmail: null,
          },
        });
        continue;
      }

      if (kinshipCode === "AVOS" || kinshipCode === "TIOS" || kinshipCode === "IRMAOS") {
        const kinshipText = CONTACT_KINSHIP_DISPLAY[kinshipCode] || "";
        register(familyAndGuardianCandidates, {
          key: `contact:${contact.id}`,
          group: "FAMILIAR_CONTATO",
          targetRole: "FAMILIAR_CONTATO",
          label: `${contact.name} — ${kinshipText} de ${stu.name}${classTag} (seleção como Familiar / Contato)`,
          autoFillEligible: false,
          requiresExplicitSelection: true,
          originStudentId: stu.id,
          nonLegalContactNotice: EXPLICIT_NON_LEGAL_NOTICE,
          payload: {
            role: "FAMILIAR_CONTATO",
            studentId: null,
            name: contact.name,
            kinship: kinshipText,
            documentType: "CPF",
            documentNumber: "",
            phone: contact.phone || "",
            expectedEmail: null,
          },
        });
        continue;
      }

      const isMotherOrFather = kinshipCode === "MAE" || kinshipCode === "PAI";
      const kinshipField = isMotherOrFather ? CONTACT_KINSHIP_DISPLAY[kinshipCode] : "";
      const roleContextLabel = isMotherOrFather
        ? CONTACT_KINSHIP_DISPLAY[kinshipCode]
        : "Responsável cadastrado";

      register(familyAndGuardianCandidates, {
        key: `contact:${contact.id}`,
        group: "RESPONSAVEL_LEGAL",
        targetRole: "RESPONSAVEL",
        label: `${contact.name} — ${roleContextLabel} de ${stu.name}${classTag}`,
        autoFillEligible: true,
        requiresExplicitSelection: false,
        originStudentId: stu.id,
        nonLegalContactNotice: null,
        payload: {
          role: "RESPONSAVEL",
          studentId: null,
          name: contact.name,
          kinship: kinshipField,
          documentType: "CPF",
          documentNumber: "",
          phone: contact.phone || "",
          expectedEmail: null,
        },
      });
    }

    if (stu.guardianName && stu.guardianName.trim() && !legacyRedundantWithSameStudentContact) {
      register(familyAndGuardianCandidates, {
        key: `guardian-legacy:${stu.id}`,
        group: "RESPONSAVEL_LEGAL",
        targetRole: "RESPONSAVEL",
        label: `${stu.guardianName.trim()} — Responsável na matrícula de ${stu.name}${classTag}`,
        autoFillEligible: true,
        requiresExplicitSelection: false,
        originStudentId: stu.id,
        nonLegalContactNotice: null,
        payload: {
          role: "RESPONSAVEL",
          studentId: null,
          name: stu.guardianName.trim(),
          kinship: "",
          documentType: "CPF",
          documentNumber: "",
          phone: stu.phone || "",
          expectedEmail: null,
        },
      });
    }
  }

  for (let i = 0; i < teacherDraftParticipants.length; i++) {
    const p = teacherDraftParticipants[i];
    if (normalizeRoleUpper(p.role) !== "PROFESSOR" || !p.name?.trim()) continue;
    const stableId = p.id || p.clientKey || String(i);
    register(teacherCandidates, {
      key: `teacher-pauta:${stableId}`,
      group: "PROFESSOR_PAUTA",
      targetRole: "PROFESSOR",
      label: p.kinship ? `${p.name.trim()} — ${p.kinship}` : p.name.trim(),
      autoFillEligible: true,
      requiresExplicitSelection: false,
      originStudentId: null,
      nonLegalContactNotice: null,
      payload: {
        role: "PROFESSOR",
        studentId: null,
        name: p.name.trim(),
        kinship: p.kinship || "",
        documentType: p.documentType || "OUTRO",
        documentNumber: p.documentNumber || "",
        phone: p.phone || "",
        expectedEmail: p.expectedEmail || null,
      },
    });
  }

  for (const member of staff) {
    const emailTag = member.email ? ` (${member.email})` : "";
    register(staffCandidates, {
      key: `staff:${member.id}`,
      group: "STAFF",
      targetRole: "EQUIPE_ESCOLAR",
      label: `${member.name}${emailTag}`,
      autoFillEligible: true,
      requiresExplicitSelection: false,
      originStudentId: null,
      nonLegalContactNotice: null,
      payload: {
        role: "EQUIPE_ESCOLAR",
        studentId: null,
        name: member.name,
        kinship: "",
        documentType: "CPF",
        documentNumber: "",
        phone: "",
        expectedEmail: member.email || null,
      },
    });

    // Em PROFESSOR, servidores aparecem apenas para seleção explícita, sem inferir docência
    register(teacherCandidates, {
      key: `staff-teacher:${member.id}`,
      group: "STAFF_MANUAL_TEACHER",
      targetRole: "PROFESSOR",
      label: `${member.name}${emailTag}`,
      autoFillEligible: false,
      requiresExplicitSelection: true,
      originStudentId: null,
      nonLegalContactNotice: null,
      payload: {
        role: "PROFESSOR",
        studentId: null,
        name: member.name,
        kinship: "",
        documentType: "OUTRO",
        documentNumber: "",
        phone: "",
        expectedEmail: member.email || null,
      },
    });
  }

  return {
    studentCandidates,
    familyAndGuardianCandidates,
    staffCandidates,
    teacherCandidates,
    byKey,
  };
}

export function getCandidatesForRowRole(
  bundle: BuiltParticipantCandidates,
  role: string
): ParticipantCandidate[] {
  const normalized = normalizeRoleUpper(role);
  if (normalized === "ESTUDANTE") return bundle.studentCandidates;
  if (normalized === "RESPONSAVEL" || normalized === "FAMILIAR_CONTATO") {
    return bundle.familyAndGuardianCandidates;
  }
  if (normalized === "EQUIPE_ESCOLAR") return bundle.staffCandidates;
  if (normalized === "PROFESSOR") return bundle.teacherCandidates;
  return [];
}

/**
 * Regra estrita de preenchimento automático: só retorna candidato quando o conjunto
 * completo tiver exatamente 1 alternativa e essa alternativa for elegível.
 */
export function resolveSingleAutoFillCandidate(
  candidates: ParticipantCandidate[]
): ParticipantCandidate | null {
  if (candidates.length !== 1) return null;
  const sole = candidates[0];
  if (!sole.autoFillEligible || sole.requiresExplicitSelection) return null;
  return sole;
}

function buildSourceSnapshot(candidate: ParticipantCandidate): ParticipantSourceSnapshot {
  return {
    candidateKey: candidate.key,
    sourceRole: candidate.targetRole,
    name: candidate.payload.name,
    phone: candidate.payload.phone,
    documentType: candidate.payload.documentType,
    documentNumber: candidate.payload.documentNumber,
    expectedEmail: candidate.payload.expectedEmail,
    kinship: candidate.payload.kinship,
  };
}

export function applyCandidateToParticipantRow(
  participant: AtaParticipantDraft,
  candidate: ParticipantCandidate,
  mode: "AUTO_SUGGESTED" | "EXPLICIT_CANDIDATE"
): AtaParticipantDraft {
  if (isParticipantSignatureLocked(participant) || isParticipantQrActive(participant)) {
    return participant;
  }

  const sanitizedKinship =
    sanitizeKinshipForRole(candidate.targetRole, candidate.payload.kinship, {
      isSigned: false,
    }) ?? "";

  return {
    ...participant,
    role: candidate.targetRole,
    studentId: candidate.targetRole === "ESTUDANTE" ? candidate.payload.studentId : null,
    name: candidate.payload.name,
    kinship: sanitizedKinship,
    documentType: candidate.payload.documentType,
    documentNumber: candidate.payload.documentNumber,
    phone: candidate.payload.phone,
    expectedEmail: candidate.payload.expectedEmail,
    originState: mode,
    autoFilledCandidateKey: candidate.key,
    autoOriginStudentId: mode === "AUTO_SUGGESTED" ? candidate.originStudentId : null,
    sourceSnapshot: buildSourceSnapshot(candidate),
    nonLegalContactNotice: candidate.nonLegalContactNotice,
  };
}

function clearIncompatibleSourceFieldsOnRoleSwitch(
  participant: AtaParticipantDraft,
  nextRole: string
): AtaParticipantDraft {
  const prevRole = normalizeRoleUpper(participant.role);
  const targetRole = normalizeRoleUpper(nextRole);
  const snap = participant.sourceSnapshot;

  const isFamilyPair =
    (prevRole === "RESPONSAVEL" && targetRole === "FAMILIAR_CONTATO") ||
    (prevRole === "FAMILIAR_CONTATO" && targetRole === "RESPONSAVEL");
  const isStaffTeacherPair =
    (prevRole === "EQUIPE_ESCOLAR" && targetRole === "PROFESSOR") ||
    (prevRole === "PROFESSOR" && targetRole === "EQUIPE_ESCOLAR");

  const nextDocType =
    targetRole === "ESTUDANTE"
      ? "CGM"
      : targetRole === "PROFESSOR"
        ? participant.documentType === "OUTRO"
          ? "OUTRO"
          : "CPF"
        : "CPF";

  // Mesmo papel familiar/servidor ou linha 100% digitada manualmente sem origem de outra pessoa
  if (!snap && prevRole !== "ESTUDANTE" && prevRole !== "EQUIPE_ESCOLAR" && prevRole !== "PROFESSOR") {
    return {
      ...participant,
      role: targetRole,
      studentId: targetRole === "ESTUDANTE" ? participant.studentId ?? null : null,
      documentType: nextDocType,
      kinship: sanitizeKinshipForRole(targetRole, participant.kinship, { isSigned: false }) ?? "",
      nonLegalContactNotice: targetRole === "FAMILIAR_CONTATO" ? participant.nonLegalContactNotice ?? null : null,
    };
  }

  if (isFamilyPair || isStaffTeacherPair) {
    return {
      ...participant,
      role: targetRole,
      studentId: null,
      documentType: nextDocType,
      kinship: sanitizeKinshipForRole(targetRole, participant.kinship, { isSigned: false }) ?? "",
      nonLegalContactNotice:
        targetRole === "FAMILIAR_CONTATO" ? participant.nonLegalContactNotice ?? null : null,
    };
  }

  // Mudou para papel incompatível com a identidade carregada (ex.: ESTUDANTE -> RESPONSAVEL)
  const cameFromOtherPerson = Boolean(snap) || prevRole === "ESTUDANTE";
  const sameAsSnap = (cur: string | null | undefined, orig: string | null | undefined) =>
    (cur ?? "").trim() === (orig ?? "").trim();

  const shouldClearName = cameFromOtherPerson && (!snap || sameAsSnap(participant.name, snap.name));
  const shouldClearPhone = cameFromOtherPerson && (!snap || sameAsSnap(participant.phone, snap.phone));
  const shouldClearDoc =
    cameFromOtherPerson ||
    (participant.documentType || "").toUpperCase() === "CGM" ||
    Boolean(snap && sameAsSnap(participant.documentNumber, snap.documentNumber));
  const shouldClearEmail =
    cameFromOtherPerson ||
    prevRole === "ESTUDANTE" ||
    prevRole === "EQUIPE_ESCOLAR" ||
    prevRole === "PROFESSOR" ||
    Boolean(snap && sameAsSnap(participant.expectedEmail, snap.expectedEmail));

  return {
    ...participant,
    role: targetRole,
    studentId: null,
    name: shouldClearName ? "" : participant.name,
    phone: shouldClearPhone ? "" : participant.phone,
    documentType: nextDocType,
    documentNumber: shouldClearDoc ? "" : participant.documentNumber,
    expectedEmail: shouldClearEmail ? null : participant.expectedEmail,
    kinship: "",
    autoFilledCandidateKey: null,
    autoOriginStudentId: null,
    sourceSnapshot: null,
    nonLegalContactNotice: null,
  };
}

/**
 * Executa troca de papel preservando participantes protegidos e evitando vazar
 * documentos/contatos de uma identidade anterior para outro papel.
 */
export function resolveRoleChangeWithCandidates(
  participant: AtaParticipantDraft,
  nextRole: string,
  bundle: BuiltParticipantCandidates
): AtaParticipantDraft {
  if (isParticipantSignatureLocked(participant) || isParticipantQrActive(participant)) {
    return participant;
  }

  const normalizedNextRole = normalizeRoleUpper(nextRole);
  const originState: ParticipantRowOriginState = participant.originState || "MANUAL_EDIT";

  if (originState === "AUTO_SUGGESTED") {
    const baseCleared: AtaParticipantDraft = {
      ...participant,
      role: normalizedNextRole,
      studentId: null,
      name: "",
      kinship: "",
      documentType: normalizedNextRole === "ESTUDANTE" ? "CGM" : "CPF",
      documentNumber: "",
      phone: "",
      expectedEmail: null,
      autoFilledCandidateKey: null,
      autoOriginStudentId: null,
      sourceSnapshot: null,
      nonLegalContactNotice: null,
    };

    const nextCandidates = getCandidatesForRowRole(bundle, normalizedNextRole);
    const autoCandidate = resolveSingleAutoFillCandidate(nextCandidates);
    if (autoCandidate) {
      return applyCandidateToParticipantRow(baseCleared, autoCandidate, "AUTO_SUGGESTED");
    }
    return baseCleared;
  }

  return clearIncompatibleSourceFieldsOnRoleSwitch(participant, normalizedNextRole);
}

/**
 * Marca edição manual na linha e ajusta o estado para MANUAL_EDIT (nunca regride PERSISTED
 * ao ponto de torná-la descartável; impede remoção automática).
 */
export function applyManualParticipantFieldEdit(
  participant: AtaParticipantDraft,
  patch: Partial<AtaParticipantDraft>
): AtaParticipantDraft {
  const nextState: ParticipantRowOriginState =
    participant.originState === "PERSISTED" ? "PERSISTED" : "MANUAL_EDIT";

  return {
    ...participant,
    ...patch,
    originState: nextState,
    autoOriginStudentId: null,
  };
}

/**
 * Remove apenas linhas AUTO_SUGGESTED 100% intocadas vinculadas exclusivamente a um
 * estudante desmarcado. Preserva EXPLICIT_CANDIDATE, MANUAL_EDIT, PERSISTED e travados.
 */
export function pruneUntouchedSuggestionsForRemovedStudents(
  participants: AtaParticipantDraft[],
  nextSelectedStudentIds: string[]
): AtaParticipantDraft[] {
  const selectedSet = new Set(nextSelectedStudentIds);
  return participants.filter((p) => {
    if (isParticipantSignatureLocked(p) || isParticipantQrActive(p)) return true;
    const originState: ParticipantRowOriginState = p.originState || "MANUAL_EDIT";
    if (originState !== "AUTO_SUGGESTED") return true;
    if (!p.autoOriginStudentId) return true;
    return selectedSet.has(p.autoOriginStudentId);
  });
}

/**
 * Reconcilia os participantes retornados após POST/PATCH bem-sucedido, preservando
 * clientKey estável e promovendo registros gravados no banco para originState = "PERSISTED".
 */
export function reconcileSavedParticipantsWithPersistedState(
  localParticipants: AtaParticipantDraft[],
  savedParticipants: AtaParticipantDraft[] | null | undefined
): AtaParticipantDraft[] {
  if (!Array.isArray(savedParticipants)) {
    return localParticipants;
  }

  const usedLocalIndices = new Set<number>();

  return savedParticipants.map((saved, savedIdx) => {
    let matchedLocalIdx = -1;

    if (saved.id) {
      matchedLocalIdx = localParticipants.findIndex(
        (lp, idx) => !usedLocalIndices.has(idx) && lp.id === saved.id
      );
    }

    if (matchedLocalIdx < 0) {
      const savedNameNorm = normalizeName(saved.name);
      const savedRoleNorm = normalizeRoleUpper(saved.role);
      matchedLocalIdx = localParticipants.findIndex(
        (lp, idx) =>
          !usedLocalIndices.has(idx) &&
          normalizeRoleUpper(lp.role) === savedRoleNorm &&
          normalizeName(lp.name) === savedNameNorm
      );
    }

    const matchedLocal =
      matchedLocalIdx >= 0
        ? (usedLocalIndices.add(matchedLocalIdx), localParticipants[matchedLocalIdx])
        : undefined;

    return {
      ...saved,
      clientKey: matchedLocal?.clientKey || (saved.id ? `db-${saved.id}` : `saved-${savedIdx}`),
      originState: "PERSISTED" as const,
      autoFilledCandidateKey: matchedLocal?.autoFilledCandidateKey ?? null,
      autoOriginStudentId: null,
      sourceSnapshot: matchedLocal?.sourceSnapshot ?? null,
      nonLegalContactNotice:
        normalizeRoleUpper(saved.role) === "FAMILIAR_CONTATO"
          ? matchedLocal?.nonLegalContactNotice ?? null
          : null,
    };
  });
}

export interface CandidatesCacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache em memória com ciclo de vida explícito por escola ativa e TTL curto.
 */
export class ScopedCandidateCache<T> {
  private readonly ttlMs: number;
  private store = new Map<string, CandidatesCacheEntry<T>>();

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  get(schoolId: string | null | undefined, subKey: string, now = Date.now()): T | null {
    const cleanSchool = (schoolId || "").trim();
    if (!cleanSchool) return null;
    const fullKey = `${cleanSchool}::${subKey}`;
    const entry = this.store.get(fullKey);
    if (!entry) return null;
    if (now >= entry.expiresAt) {
      this.store.delete(fullKey);
      return null;
    }
    return entry.value;
  }

  set(schoolId: string | null | undefined, subKey: string, value: T, now = Date.now()): void {
    const cleanSchool = (schoolId || "").trim();
    if (!cleanSchool) return;
    const fullKey = `${cleanSchool}::${subKey}`;
    this.store.set(fullKey, {
      value,
      expiresAt: now + this.ttlMs,
    });
  }

  clearAll(): void {
    this.store.clear();
  }

  clearSchool(schoolId: string | null | undefined): void {
    const cleanSchool = (schoolId || "").trim();
    if (!cleanSchool) {
      this.store.clear();
      return;
    }
    const prefix = `${cleanSchool}::`;
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
