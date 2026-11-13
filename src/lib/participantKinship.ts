/**
 * Regras compartilhadas (cliente + servidor) para normalização de vínculo/função (`kinship`)
 * e comparação uniforme de identidade e informações documentais de participantes da ata.
 */

export interface ParticipantIdentityFields {
  role?: string | null;
  name?: string | null;
  studentId?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  expectedEmail?: string | null;
  kinship?: string | null;
}

export const PARENTAL_KINSHIP_TERMS = new Set<string>([
  "mae/pai",
  "pai/mae",
  "mae",
  "pai",
  "responsavel",
  "responsavel legal",
]);

/**
 * Normaliza texto de vínculo removendo acentos, padronizando barras, espaços e caixa
 * para comparação uniforme entre cliente e servidor.
 */
export function normalizeKinshipCompare(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Sanitiza termos parentais legados (`Mãe/Pai`, etc.) quando o papel não é `RESPONSAVEL`.
 * Participantes já assinados (`isSigned: true`) nunca sofrem sanitização silenciosa.
 */
export function sanitizeKinshipForRole(
  role: string | null | undefined,
  kinship: string | null | undefined,
  options?: { isSigned?: boolean }
): string | null {
  if (kinship === undefined || kinship === null) return null;
  const trimmed = kinship.trim();
  if (!trimmed) return null;

  if (options?.isSigned) {
    return trimmed;
  }

  const normalizedRole = (role || "RESPONSAVEL").trim().toUpperCase();
  if (normalizedRole !== "RESPONSAVEL") {
    const comparable = normalizeKinshipCompare(trimmed);
    if (PARENTAL_KINSHIP_TERMS.has(comparable)) {
      return null;
    }
  }

  return trimmed;
}

function normalizeUpper(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeEmailCompare(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeTextCompare(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Detecta alteração em campos protegidos:
 * - Identidade: `role`, `name`, `studentId`, `documentType`, `documentNumber`, `expectedEmail`
 * - Informação documental: `kinship`
 *
 * `phone` (contato) fica explicitamente fora da trava de assinatura/QR.
 * `documentNumber` preserva caracteres e pontuação (apenas trim/uppercase) para não ocultar diferenças reais.
 */
export function hasProtectedParticipantIdentityChanged(
  prev: ParticipantIdentityFields,
  next: ParticipantIdentityFields
): boolean {
  if (normalizeUpper(prev.role || "RESPONSAVEL") !== normalizeUpper(next.role || "RESPONSAVEL")) {
    return true;
  }
  if (normalizeTextCompare(prev.name) !== normalizeTextCompare(next.name)) {
    return true;
  }
  if ((prev.studentId || null) !== (next.studentId || null)) {
    return true;
  }
  if (normalizeUpper(prev.documentType) !== normalizeUpper(next.documentType)) {
    return true;
  }
  if (normalizeUpper(prev.documentNumber) !== normalizeUpper(next.documentNumber)) {
    return true;
  }
  if (normalizeEmailCompare(prev.expectedEmail) !== normalizeEmailCompare(next.expectedEmail)) {
    return true;
  }
  if (normalizeTextCompare(prev.kinship) !== normalizeTextCompare(next.kinship)) {
    return true;
  }
  return false;
}
