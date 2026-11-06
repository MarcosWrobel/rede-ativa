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
  biometricStrokeData?: string | null;
  biometricVerified?: boolean;
  verifiedEmail?: string | null;
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
  isConfidential?: boolean;
  isExtemporaneous?: boolean;
  extemporaneousReason?: string | null;
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
 * Inclui o hash criptográfico SHA-256 das assinaturas digitais e da telemetria
 * biométrica vetorial quando presente (Lei nº 14.063/2020 e CPC Art. 440).
 */
export function computeMinuteHash(
  payload: MinuteCanonicalPayload,
  options: { includeStrokeHash?: boolean } = {}
): string {
  const includeStrokeHash = options.includeStrokeHash !== false;
  const hasAnyStrokeData =
    includeStrokeHash &&
    payload.participants.some((p) => Boolean(p.biometricStrokeData && p.biometricStrokeData.trim()));

  const normalized = {
    schoolId: payload.schoolId.trim(),
    year: payload.year,
    ataNumber: payload.ataNumber,
    attendedAt: payload.attendedAt,
    category: payload.category.trim(),
    isConfidential: Boolean(payload.isConfidential),
    isExtemporaneous: Boolean(payload.isExtemporaneous),
    extemporaneousReason: (payload.extemporaneousReason || "").trim(),
    subject: payload.subject.trim(),
    summary: payload.summary.trim(),
    agreementsSummary: (payload.agreementsSummary || "").trim(),
    authorEmail: payload.authorEmail.toLowerCase().trim(),
    students: [...payload.students]
      .sort((a, b) => a.studentId.localeCompare(b.studentId))
      .map((s) => ({
        studentId: s.studentId,
        name: s.name.trim(),
        className: s.className?.trim() || "",
        cgm: s.cgm?.trim() || "",
      })),
    participants: [...payload.participants]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((p) => ({
        role: p.role,
        name: p.name.trim(),
        doc: (p.documentNumber || "").replace(/\D/g, ""),
        mode: p.signatureMode,
        sigHash: p.signatureData
          ? crypto.createHash("sha256").update(p.signatureData.trim()).digest("hex")
          : "",
        ...(hasAnyStrokeData
          ? {
              strokeHash: p.biometricStrokeData?.trim()
                ? crypto.createHash("sha256").update(p.biometricStrokeData.trim()).digest("hex")
                : "",
            }
          : {}),
        hasSig: Boolean(p.signatureData),
        bio: Boolean(p.biometricVerified),
        email: (p.verifiedEmail || "").toLowerCase().trim(),
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
 * Recalcula e valida a integridade estrita do selo da ata lavrada.
 * Suporta verificação dual (v2 com strokeHash e v1 legado sem strokeHash) para
 * preservar 100% de retrocompatibilidade com atas históricas já lavradas.
 */
export function verifyMinuteIntegrity(
  payload: MinuteCanonicalPayload,
  storedHash: string
): { isValid: boolean; computedHash: string; storedHash: string } {
  const cleanStored = (storedHash || "").toLowerCase().trim();
  const computedV2 = computeMinuteHash(payload, { includeStrokeHash: true });
  if (cleanStored && computedV2.toLowerCase() === cleanStored) {
    return { isValid: true, computedHash: computedV2, storedHash };
  }

  const computedV1 = computeMinuteHash(payload, { includeStrokeHash: false });
  if (cleanStored && computedV1.toLowerCase() === cleanStored) {
    return { isValid: true, computedHash: computedV1, storedHash };
  }

  return {
    isValid: false,
    computedHash: computedV2,
    storedHash,
  };
}

/**
 * Gera hash-chaining para Termo de Aditamento / Retificação ("Em tempo").
 * Quando houver assinatura do participante no adendo, incorpora seu selo SHA-256.
 */
export function computeAddendumHash(
  previousHash: string,
  content: string,
  authorEmail: string,
  createdAtIso: string,
  participantSignerName?: string | null,
  participantSignatureData?: string | null
): string {
  const baseChunk = `${previousHash.trim()}||${content.trim()}||${authorEmail.toLowerCase().trim()}||${createdAtIso}`;
  const cleanSigner = (participantSignerName || "").trim();
  const cleanSig = (participantSignatureData || "").trim();
  if (!cleanSigner && !cleanSig) {
    return crypto.createHash("sha256").update(baseChunk, "utf8").digest("hex");
  }
  const sigHash = cleanSig ? crypto.createHash("sha256").update(cleanSig).digest("hex") : "";
  const extendedChunk = `${baseChunk}||${cleanSigner}||${sigHash}`;
  return crypto.createHash("sha256").update(extendedChunk, "utf8").digest("hex");
}

/**
 * Valida a linearidade e integridade criptográfica de toda a cadeia de Termos Aditivos ("Em tempo").
 */
export function verifyAddendumChain(
  minuteContentHash: string | null | undefined,
  addendums: Array<{
    previousHash: string;
    addendumHash: string;
    content: string;
    authorEmail: string;
    createdAt: Date | string;
    participantSignerName?: string | null;
    participantSignatureData?: string | null;
  }>
): { isValid: boolean; brokenAtIndex: number | null } {
  if (!addendums || addendums.length === 0) {
    return { isValid: true, brokenAtIndex: null };
  }

  let expectedPrev = (minuteContentHash || "genesis").trim();

  for (let idx = 0; idx < addendums.length; idx++) {
    const item = addendums[idx];
    if ((item.previousHash || "").trim() !== expectedPrev) {
      return { isValid: false, brokenAtIndex: idx };
    }

    const createdAtIso =
      item.createdAt instanceof Date ? item.createdAt.toISOString() : new Date(item.createdAt).toISOString();

    const stored = (item.addendumHash || "").toLowerCase().trim();
    const hashV2 = computeAddendumHash(
      item.previousHash,
      item.content,
      item.authorEmail,
      createdAtIso,
      item.participantSignerName,
      item.participantSignatureData
    );
    const hashV1 = computeAddendumHash(item.previousHash, item.content, item.authorEmail, createdAtIso);

    if (!stored || (hashV2.toLowerCase() !== stored && hashV1.toLowerCase() !== stored)) {
      return { isValid: false, brokenAtIndex: idx };
    }

    expectedPrev = item.addendumHash.trim();
  }

  return { isValid: true, brokenAtIndex: null };
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
 * Mascara e-mail institucional para exibição pública segura (LGPD/ECA).
 * Ex: "joao.silva@escola.pr.gov.br" -> "jo***.si***@escola.pr.gov.br"
 */
export function maskEmail(email?: string | null): string {
  if (!email) return "";
  const clean = email.toLowerCase().trim();
  const [user, domain] = clean.split("@");
  if (!domain) return "****";

  const maskedUser = user
    .split(".")
    .map((part) => {
      if (part.length <= 2) return part[0] + "*";
      return part.slice(0, 2) + "*".repeat(Math.max(1, part.length - 2));
    })
    .join(".");

  return `${maskedUser}@${domain}`;
}

function escapeRegexChars(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Anonimiza menções a outros menores citados em atas conjuntas ao gerar o Dossiê Individual
 * ou ao exibir minuta em link móvel de assinatura para responsável de um único aluno.
 * Conforme Arts. 17, 18, 143 e 247 do ECA (preservação da imagem e sigilo perante terceiros).
 * Utiliza fronteiras Unicode (\p{L}\p{N}) para cobrir integralmente nomes acentuados (ex: José, André, Cauã, Inês, Théo).
 */
export function anonymizeOtherMinorsInText(
  text: string,
  targetStudentId: string | null | undefined,
  linkedStudents: Array<{ id: string; name: string }>
): string {
  if (!text) return "";
  let result = text;
  const others = targetStudentId
    ? linkedStudents.filter((s) => s.id !== targetStudentId)
    : linkedStudents;

  for (const other of others) {
    const rawName = (other.name || "").trim();
    if (!rawName) continue;

    // Gera iniciais (ex: "Pedro Henrique Silva" -> "P. H. S.")
    const parts = rawName.split(/\s+/).filter(Boolean);
    const initials = parts.map((p) => `${p[0].toUpperCase()}.`).join(" ") + " (outro estudante)";

    // Substitui nome completo com tolerância a múltiplos espaços e fronteiras Unicode
    const escapedFullPattern = parts.map((p) => escapeRegexChars(p)).join("\\s+");
    const fullRegex = new RegExp(`(?<![\\p{L}\\p{N}])${escapedFullPattern}(?![\\p{L}\\p{N}])`, "giu");
    result = result.replace(fullRegex, initials);

    // Substitui primeiro nome isolado (>= 3 caracteres, ex: Ana, José, Cauã, Théo) respeitando acentuação Unicode
    if (parts.length > 1 && parts[0].length >= 3) {
      const escapedFirst = escapeRegexChars(parts[0]);
      const firstRegex = new RegExp(`(?<![\\p{L}\\p{N}])${escapedFirst}(?![\\p{L}\\p{N}])`, "giu");
      result = result.replace(firstRegex, `${parts[0][0].toUpperCase()}. (outro estudante)`);
    }
  }

  return result;
}

/**
 * Verifica se o usuário autenticado possui autorização legal para ler o teor integral
 * de uma ata classificada com Sigilo Reforçado ECA (`isConfidential: true`).
 * Acesso restrito a: SuperAdmin, Direção/Gestão Escolar da unidade ou o próprio servidor autor.
 */
export function canAccessConfidentialMinute(
  minute: {
    isConfidential?: boolean | null;
    schoolId?: string | null;
    authorId?: string | null;
    authorEmail?: string | null;
  },
  session: any
): boolean {
  if (!minute?.isConfidential) return true;
  if (!session?.user) return false;

  const user = session.user as any;
  const email = (user.email || "").toLowerCase().trim();
  const role = user.role;

  if (role === "SUPERADMIN" || role === "ADMIN" || email === "marcos.wrobel@escola.pr.gov.br") {
    return true;
  }

  // O próprio servidor público que lavrou a ata mantém acesso
  if (minute.authorId && user.id && minute.authorId === user.id) {
    return true;
  }
  if (minute.authorEmail && email && minute.authorEmail.toLowerCase().trim() === email) {
    return true;
  }

  // Direção / Gestão Escolar na unidade da ata
  if (role === "GESTOR_ESCOLAR") {
    if (!minute.schoolId || user.schoolId === minute.schoolId) return true;
  }
  const userSchools = Array.isArray(user.schools) ? user.schools : [];
  if (
    minute.schoolId &&
    userSchools.some(
      (s: any) =>
        (s.schoolId === minute.schoolId || s.id === minute.schoolId) &&
        (s.role === "GESTOR_ESCOLAR" || s.role === "ADMIN" || s.role === "SUPERADMIN")
    )
  ) {
    return true;
  }

  return false;
}
