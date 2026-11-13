import {
  hasProtectedParticipantIdentityChanged,
  sanitizeKinshipForRole,
} from "@/lib/participantKinship";

export interface IncomingMinuteParticipant {
  id?: string;
  role?: string;
  studentId?: string | null;
  name?: string;
  kinship?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  documentVerifiedByStaff?: boolean;
  phone?: string | null;
  signatureMode?: string;
  signatureData?: string | null;
  signedAt?: string | Date | null;
  clearSignature?: boolean;
  hasSignature?: boolean;
  signerUserAgent?: string | null;
  biometricStrokeData?: string | null;
  clientTimestampIso?: string | null;
  expectedEmail?: string | null;
  verifiedEmail?: string | null;
  biometricVerified?: boolean;
  refusalReason?: string | null;
  witnessName?: string | null;
}

export interface ExistingMinuteParticipant {
  id: string;
  role?: string;
  studentId?: string | null;
  name: string;
  kinship?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  signatureMode?: string;
  signatureData?: string | null;
  signedAt?: Date | string | null;
  hasSignature?: boolean;
  signerIp?: string | null;
  signerUserAgent?: string | null;
  biometricStrokeData?: string | null;
  clientTimestampIso?: string | null;
  mobileSignToken?: string | null;
  mobileSignExpiresAt?: Date | string | null;
  hasActiveSignLink?: boolean;
  biometricVerified?: boolean;
  biometricDeviceType?: string | null;
  biometricAuthTime?: Date | string | null;
  expectedEmail?: string | null;
  verifiedEmail?: string | null;
  verifiedGoogleSub?: string | null;
  refusalReason?: string | null;
  witnessName?: string | null;
  verifiedGoogleName?: string | null;
  emailVerifiedAt?: Date | string | null;
}

export interface MergedMinuteParticipantRecord {
  id?: string;
  minuteId?: string;
  role: string;
  studentId: string | null;
  name: string;
  kinship: string | null;
  documentType: string | null;
  documentNumber: string | null;
  documentVerifiedByStaff: boolean;
  phone: string | null;
  signatureMode: string;
  signatureData: string | null;
  signedAt: Date | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  biometricStrokeData: string | null;
  clientTimestampIso: string | null;
  mobileSignToken: string | null;
  mobileSignExpiresAt: Date | null;
  hasSignature: boolean;
  hasActiveSignLink: boolean;
  biometricVerified: boolean;
  biometricDeviceType: string | null;
  biometricAuthTime: Date | null;
  expectedEmail: string | null;
  verifiedEmail: string | null;
  verifiedGoogleSub: string | null;
  verifiedGoogleName: string | null;
  emailVerifiedAt: Date | null;
  refusalReason: string | null;
  witnessName: string | null;
}

export interface MergeParticipantOptions {
  clearMobileTokens: boolean;
  minuteId?: string;
}

function toNullableDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Higieniza e normaliza payloads de criação ou atualização de rascunho de ata
 * antes da validação estrutural via Zod.
 */
export function sanitizeMinutePayload<T>(rawBody: T, mode: "CREATE" | "UPDATE"): T {
  if (!rawBody || typeof rawBody !== "object") return rawBody;
  const cleaned: Record<string, any> = { ...rawBody };

  if (typeof cleaned.subject === "string") {
    cleaned.subject = cleaned.subject.trim() || "Atendimento Pedagógico";
    if (cleaned.subject.length < 2) cleaned.subject = "Atendimento Pedagógico";
  }

  if (Array.isArray(cleaned.participants)) {
    cleaned.participants = cleaned.participants
      .filter(
        (p: any) =>
          p &&
          (p.name?.trim() ||
            p.signatureData ||
            p.signatureMode === "REFUSED" ||
            (mode === "UPDATE" && Boolean(p.id)))
      )
      .map((p: any) => {
        const trimmedName = (p.name || "").trim();
        const isSigned = Boolean(
          p.signatureData || p.hasSignature || p.verifiedEmail || p.biometricVerified
        );
        return {
          ...p,
          name: trimmedName.length >= 2 ? trimmedName : "Responsável Presente",
          kinship: sanitizeKinshipForRole(p.role, p.kinship, { isSigned }),
        };
      });
  }

  if (Array.isArray(cleaned.actionItems)) {
    cleaned.actionItems = cleaned.actionItems
      .filter((a: any) => a && typeof a.description === "string" && a.description.trim().length >= 2)
      .map((a: any) => ({
        ...a,
        description: a.description.trim(),
        dueDate: a.dueDate && String(a.dueDate).trim() !== "" ? a.dueDate : null,
      }));
  }

  return cleaned as T;
}

/**
 * Unifica o pareamento de signatários e a preservação anti-adulteração de provas
 * biométricas, OIDC (@escola.pr.gov.br) e assinaturas remotas/presenciais
 * tanto durante o autosave de rascunho (PATCH) quanto na lavratura oficial (finalize).
 */
export function mergeParticipantSignatures(
  incomingParticipants: IncomingMinuteParticipant[],
  existingParticipants: ExistingMinuteParticipant[],
  options: MergeParticipantOptions & { minuteId: string }
): Array<MergedMinuteParticipantRecord & { minuteId: string }>;
export function mergeParticipantSignatures(
  incomingParticipants: IncomingMinuteParticipant[],
  existingParticipants: ExistingMinuteParticipant[],
  options: MergeParticipantOptions
): MergedMinuteParticipantRecord[];
export function mergeParticipantSignatures(
  incomingParticipants: IncomingMinuteParticipant[],
  existingParticipants: ExistingMinuteParticipant[],
  options: MergeParticipantOptions
): MergedMinuteParticipantRecord[] {
  const validParticipants = (incomingParticipants || []).filter(
    (p) => p && (p.name?.trim() || p.signatureData || p.signatureMode === "REFUSED" || p.id)
  );

  const usedIds = new Set<string>();

  return validParticipants.map((p) => {
    const trimmedName = (p.name || "").trim();
    const finalName = trimmedName.length >= 2 ? trimmedName : "Responsável Presente";
    const normalizedName = finalName.toLowerCase();

    const match =
      (p.id && existingParticipants.find((ep) => ep.id === p.id && !usedIds.has(ep.id))) ||
      existingParticipants.find(
        (ep) => !usedIds.has(ep.id) && ep.name.trim().toLowerCase() === normalizedName
      ) ||
      (existingParticipants.length === 1 &&
      validParticipants.length === 1 &&
      !usedIds.has(existingParticipants[0].id)
        ? existingParticipants[0]
        : undefined);

    if (match?.id) {
      usedIds.add(match.id);
    }

    const shouldClear = Boolean(p.clearSignature);
    const isRefused = p.signatureMode === "REFUSED";
    const matchHasSigned = Boolean(
      match &&
        (match.hasSignature ||
          match.signatureData ||
          match.verifiedEmail ||
          match.biometricVerified)
    );

    const effectiveRole = p.role || "RESPONSAVEL";
    const resolvedStudentId =
      p.studentId !== undefined ? p.studentId || null : (match?.studentId ?? null);
    const resolvedDocumentType =
      p.documentType !== undefined ? p.documentType || null : (match?.documentType ?? null);
    const resolvedDocumentNumber =
      p.documentNumber !== undefined ? p.documentNumber || null : (match?.documentNumber ?? null);
    const resolvedExpectedEmail =
      p.expectedEmail !== undefined ? p.expectedEmail || null : (match?.expectedEmail ?? null);
    const resolvedRawKinship = p.kinship !== undefined ? p.kinship : match?.kinship;

    const sanitizedIncomingKinship = sanitizeKinshipForRole(
      effectiveRole,
      resolvedRawKinship,
      { isSigned: matchHasSigned && !shouldClear && !isRefused }
    );

    const identityChanged = Boolean(
      match &&
        hasProtectedParticipantIdentityChanged(match, {
          role: effectiveRole,
          name: finalName,
          studentId: resolvedStudentId,
          documentType: resolvedDocumentType,
          documentNumber: resolvedDocumentNumber,
          expectedEmail: resolvedExpectedEmail,
          kinship: sanitizedIncomingKinship,
        })
    );

    if (matchHasSigned && identityChanged && !shouldClear && !isRefused) {
      throw new Error(
        "CONFLICT:Este participante já possui assinatura ou verificação registrada no servidor. Refaça a assinatura antes de alterar identidade ou função."
      );
    }

    const sigData = shouldClear || isRefused ? null : (p.signatureData || match?.signatureData || null);
    const sigMode = isRefused
      ? "REFUSED"
      : sigData
        ? p.signatureMode && p.signatureMode !== "PENDING"
          ? p.signatureMode
          : match?.signatureMode || "SCREEN_CANVAS"
        : "PENDING";
    const signedAt = sigData
      ? p.signedAt
        ? new Date(p.signedAt)
        : toNullableDate(match?.signedAt) || new Date()
      : null;

    // Provas de biometria WebAuthn e OIDC Google nunca podem ser forjadas pelo cliente:
    // preservam estritamente os valores verificados no banco via sign-token.
    const bioVerified = shouldClear || isRefused ? false : Boolean(match?.biometricVerified ?? false);
    const bioDevice = shouldClear || isRefused ? null : (match?.biometricDeviceType || null);
    const bioTime = bioVerified ? toNullableDate(match?.biometricAuthTime) : null;

    const verifiedEmail = shouldClear || isRefused ? null : (match?.verifiedEmail || null);
    const verifiedGoogleName = shouldClear || isRefused ? null : (match?.verifiedGoogleName || null);
    const verifiedGoogleSub = shouldClear || isRefused ? null : (match?.verifiedGoogleSub || null);
    const emailVerifiedAt = verifiedEmail ? toNullableDate(match?.emailVerifiedAt) : null;

    const effectiveSigMode = isRefused
      ? "REFUSED"
      : verifiedEmail
        ? "ESCOLA_OAUTH"
        : sigMode;

    const shouldBurnToken =
      options.clearMobileTokens ||
      Boolean(sigData || verifiedEmail || shouldClear || isRefused || identityChanged);
    const finalMobileSignToken = shouldBurnToken ? null : (match?.mobileSignToken || null);
    const finalMobileSignExpiresAt = shouldBurnToken ? null : toNullableDate(match?.mobileSignExpiresAt);

    return {
      ...(match?.id ? { id: match.id } : {}),
      ...(options.minuteId ? { minuteId: options.minuteId } : {}),
      role: effectiveRole,
      studentId: resolvedStudentId,
      name: finalName,
      kinship: sanitizedIncomingKinship,
      documentType: resolvedDocumentType,
      documentNumber: resolvedDocumentNumber,
      documentVerifiedByStaff: Boolean(p.documentVerifiedByStaff),
      phone: p.phone || null,
      signatureMode: effectiveSigMode,
      signatureData: sigData,
      signedAt: sigData || verifiedEmail ? (signedAt || new Date()) : null,
      signerIp: shouldClear || isRefused ? null : (match?.signerIp || null),
      signerUserAgent:
        shouldClear || isRefused ? null : (match?.signerUserAgent || p.signerUserAgent || null),
      biometricStrokeData:
        shouldClear || isRefused ? null : (match?.biometricStrokeData || p.biometricStrokeData || null),
      clientTimestampIso:
        shouldClear || isRefused ? null : (match?.clientTimestampIso || p.clientTimestampIso || null),
      mobileSignToken: finalMobileSignToken,
      mobileSignExpiresAt: finalMobileSignExpiresAt,
      hasSignature: Boolean(sigData || verifiedEmail),
      hasActiveSignLink: Boolean(finalMobileSignToken),
      biometricVerified: bioVerified,
      biometricDeviceType: bioDevice,
      biometricAuthTime: bioTime,
      expectedEmail: resolvedExpectedEmail,
      verifiedEmail,
      verifiedGoogleSub,
      verifiedGoogleName,
      emailVerifiedAt,
      refusalReason: isRefused
        ? p.refusalReason !== undefined
          ? p.refusalReason || null
          : match?.refusalReason || null
        : null,
      witnessName: isRefused
        ? p.witnessName !== undefined
          ? p.witnessName || null
          : match?.witnessName || null
        : null,
    };
  });
}
