import crypto from "crypto";

export interface MinuteStudentPayload {
  studentId: string;
  name: string;
  className?: string | null;
  cgm?: string | null;
}

export interface MinuteParticipantPayload {
  role: string;
  name: string;
  documentType?: string | null;
  documentNumber?: string | null;
  signatureMode: string;
  signatureData?: string | null;
  refusalReason?: string | null;
}

export interface MinuteActionItemPayload {
  description: string;
  responsible: string;
  dueDate?: string | null;
}

export interface MinuteCanonicalPayload {
  schoolId: string;
  year: number;
  ataNumber: number;
  attendedAt: string; // ISO
  category: string;
  subject: string;
  summary: string;
  agreementsSummary?: string | null;
  authorEmail: string;
  students: MinuteStudentPayload[];
  participants: MinuteParticipantPayload[];
  actionItems?: MinuteActionItemPayload[];
}

/**
 * Normaliza e gera Hash SHA-256 canônico determinístico da ata.
 */
export function computeMinuteHash(payload: MinuteCanonicalPayload): string {
  const normalized = {
    schoolId: payload.schoolId.trim(),
    year: payload.year,
    ataNumber: payload.ataNumber,
    attendedAt: payload.attendedAt,
    category: payload.category.trim(),
    subject: payload.subject.trim(),
    summary: payload.summary.trim(),
    agreementsSummary: (payload.agreementsSummary || "").trim(),
    authorEmail: payload.authorEmail.toLowerCase().trim(),
    students: [...payload.students]
      .sort((a, b) => a.studentId.localeCompare(b.studentId))
      .map((s) => ({
        studentId: s.studentId,
        name: s.name.trim(),
        cgm: s.cgm?.trim() || "",
      })),
    participants: [...payload.participants]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        role: p.role,
        name: p.name.trim(),
        doc: (p.documentNumber || "").replace(/\D/g, ""),
        mode: p.signatureMode,
        hasSig: Boolean(p.signatureData),
        refusal: p.refusalReason?.trim() || "",
      })),
    actionItems: [...(payload.actionItems || [])]
      .sort((a, b) => a.description.localeCompare(b.description))
      .map((i) => ({
        desc: i.description.trim(),
        resp: i.responsible,
        due: i.dueDate || "",
      })),
  };

  const canonicalJson = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

/**
 * Gera hash-chaining para Termo de Aditamento / Retificação ("Em tempo").
 */
export function computeAddendumHash(previousHash: string, content: string, authorEmail: string, createdAtIso: string): string {
  const chunk = `${previousHash.trim()}||${content.trim()}||${authorEmail.toLowerCase().trim()}||${createdAtIso}`;
  return crypto.createHash("sha256").update(chunk, "utf8").digest("hex");
}

/**
 * Gera código de verificação curto, amigável e não enumerável (ex: "ATA-7K9P-4X2M").
 */
export function generateVerificationCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem 0/O, 1/I para evitar confusão visual
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return `ATA-${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

/**
 * Mascara nomes e documentos para exibição pública e cega de autenticidade (LGPD-safe).
 * Ex: "Maria Aparecida da Silva" -> "M**** A******** d* S****"
 */
export function maskName(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  return parts
    .map((p) => {
      if (p.length <= 1) return p;
      if (p.length === 2) return p[0] + "*";
      return p[0] + "*".repeat(p.length - 1);
    })
    .join(" ");
}

export function maskDocument(docNumber?: string | null): string {
  if (!docNumber) return "Não informado";
  const clean = docNumber.trim();
  if (clean.length <= 4) return "****";
  return clean.slice(0, 2) + "*".repeat(Math.max(2, clean.length - 4)) + clean.slice(-2);
}

/**
 * Anonimiza menções a outros menores citados em atas conjuntas ao gerar o Dossiê Individual.
 * Conforme Art. 17 e 143 do ECA (preservação da imagem e sigilo perante terceiros).
 */
export function anonymizeOtherMinorsInText(
  text: string,
  targetStudentId: string,
  linkedStudents: Array<{ id: string; name: string }>
): string {
  let result = text;
  const others = linkedStudents.filter((s) => s.id !== targetStudentId);

  for (const other of others) {
    const rawName = other.name.trim();
    if (!rawName) continue;

    // Gera iniciais (ex: "Pedro Henrique Silva" -> "P. H. S.")
    const parts = rawName.split(/\s+/).filter(Boolean);
    const initials = parts.map((p) => `${p[0].toUpperCase()}.`).join(" ") + " (outro estudante)";

    // Substitui nome completo (case-insensitive)
    const escapedFull = rawName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const fullRegex = new RegExp(escapedFull, "gi");
    result = result.replace(fullRegex, initials);

    // Substitui primeiro nome quando isolado se tiver mais de 3 letras
    if (parts.length > 1 && parts[0].length > 3) {
      const firstRegex = new RegExp(`\\b${parts[0]}\\b`, "gi");
      result = result.replace(firstRegex, `${parts[0][0].toUpperCase()}. (outro estudante)`);
    }
  }

  return result;
}
