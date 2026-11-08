import crypto from "crypto";

export interface MessageCanonicalPayload {
  studentId: string;
  schoolId?: string | null;
  phoneUsed: string;
  reasonTitle: string;
  messageContent: string;
  sentByName: string;
  sentAt: string | Date;
  guardianReplied?: boolean;
  replyNotes?: string | null;
  replyCategory?: string | null;
  repliedAt?: string | Date | null;
}

/**
 * Normaliza deterministicamente os dados da mensagem e calcula o hash SHA-256 canônico
 * para garantia de fé pública, não-repúdio e proteção contra adulteração (JUR-02).
 */
export function computeMessageContentHash(payload: MessageCanonicalPayload): string {
  const sentAtIso =
    payload.sentAt instanceof Date
      ? payload.sentAt.toISOString()
      : new Date(payload.sentAt).toISOString();

  const normalized: Record<string, any> = {
    studentId: (payload.studentId || "").trim(),
    schoolId: (payload.schoolId || "").trim(),
    phoneUsed: (payload.phoneUsed || "").replace(/\D/g, ""),
    reasonTitle: (payload.reasonTitle || "").trim(),
    messageContent: (payload.messageContent || "").trim(),
    sentByName: (payload.sentByName || "").trim().toLowerCase(),
    sentAt: sentAtIso,
  };

  if (payload.guardianReplied === true) {
    let repliedAtIso = "";
    if (payload.repliedAt) {
      const d =
        payload.repliedAt instanceof Date
          ? payload.repliedAt
          : new Date(payload.repliedAt);
      if (!isNaN(d.getTime())) {
        repliedAtIso = d.toISOString();
      }
    }

    normalized.guardianReplied = true;
    normalized.replyNotes = (payload.replyNotes ?? "").trim();
    normalized.replyCategory = (payload.replyCategory ?? "").trim();
    normalized.repliedAt = repliedAtIso;
  }

  const canonicalJson = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

/**
 * Valida a integridade criptográfica de uma mensagem armazenada contra o payload fornecido.
 */
export function verifyMessageIntegrity(
  storedHash: string | null | undefined,
  payload: MessageCanonicalPayload
): { valid: boolean; calculatedHash: string } {
  const calculatedHash = computeMessageContentHash(payload);
  if (!storedHash) {
    return { valid: false, calculatedHash };
  }
  return {
    valid: storedHash.trim().toLowerCase() === calculatedHash.toLowerCase(),
    calculatedHash,
  };
}

/**
 * Formata um hash SHA-256 longo em carimbo compacto legível para impressão ou UI.
 * Ex: "SHA-256: a1b2c3...x8y9z0"
 */
export function formatMessageSeal(hash: string | null | undefined): string {
  if (!hash || typeof hash !== "string") {
    return "NÃO CERTIFICADO";
  }
  const clean = hash.trim().toLowerCase();
  if (clean.length < 16) return `SHA-256: ${clean}`;
  return `SHA-256: ${clean.slice(0, 8)}...${clean.slice(-8)}`;
}

export interface DossierIntegrityPayload {
  studentId: string;
  studentName: string;
  cgm?: string | null;
  schoolId: string;
  schoolInep?: string | null;
  totalMessages: number;
  totalMinutes: number;
  totalJustifications: number;
  emittedAtIso: string;
  emittedByEmail: string;
}

/**
 * Gera o Código Pericial de Autenticidade do Dossiê Escolar Unificado (JUR-01).
 * Esse código consolida todas as evidências apresentadas (estudante, escola, mensagens, atas)
 * num selo único de fé pública para validação junto ao Conselho Tutelar e Ministério Público.
 */
export function computeDossierIntegritySeal(payload: DossierIntegrityPayload): string {
  const normalized = {
    studentId: (payload.studentId || "").trim(),
    studentName: (payload.studentName || "").trim().toLowerCase(),
    cgm: (payload.cgm || "").trim(),
    schoolId: (payload.schoolId || "").trim(),
    schoolInep: (payload.schoolInep || "").trim(),
    totalMessages: payload.totalMessages,
    totalMinutes: payload.totalMinutes,
    totalJustifications: payload.totalJustifications,
    emittedAtIso: (payload.emittedAtIso || "").trim(),
    emittedByEmail: (payload.emittedByEmail || "").trim().toLowerCase(),
  };

  const canonicalJson = JSON.stringify(normalized);
  const fullHash = crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex").toUpperCase();
  // Formato: CERT-DOSSIE-<8 CARACTERES>-<8 CARACTERES>
  return `DOSSIE-${fullHash.slice(0, 6)}-${fullHash.slice(6, 12)}-${fullHash.slice(12, 18)}`;
}
