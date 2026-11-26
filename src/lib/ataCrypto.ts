import crypto from "crypto";
import { isBootstrapAdminEmail } from "./roles";
import { assertTenantOwnership } from "./tenantGuard";

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

function normalizeStudentNameVariantKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ACCENTED_CHAR_MAP: Record<string, string> = {
  a: "[aáàâãä]",
  e: "[eéèêë]",
  i: "[iíìîï]",
  o: "[oóòôõö]",
  u: "[uúùûü]",
  c: "[cç]",
  n: "[nñ]",
};

function buildAccentInsensitiveRegexFragment(token: string): string {
  const base = token.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let out = "";
  for (const ch of base) {
    out += ACCENTED_CHAR_MAP[ch] ?? escapeRegexChars(ch);
  }
  return out;
}

export interface StudentMaskingInput {
  id: string;
  name: string;
  aliases?: ReadonlyArray<string | null | undefined> | null;
}

/**
 * Agrupa variantes conhecidas por `studentId` (snapshot atual, variantes anteriores retidas e nome cadastral),
 * garantindo contagem real de estudantes distintos mesmo após renomeações.
 */
export function buildStudentMaskingEntries(
  minuteStudents:
    | ReadonlyArray<{
        studentId: string;
        studentNameSnapshot?: string | null;
        previousNameSnapshots?: ReadonlyArray<string | null | undefined> | null;
        student?: { name?: string | null } | null;
      }>
    | null
    | undefined
): StudentMaskingInput[] {
  if (!Array.isArray(minuteStudents) || minuteStudents.length === 0) return [];

  const byStudent = new Map<string, { primary: string; variants: string[]; seenKeys: Set<string> }>();
  const registerVariant = (bucket: { primary: string; variants: string[]; seenKeys: Set<string> }, raw?: string | null) => {
    const cleaned = (raw || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const key = normalizeStudentNameVariantKey(cleaned);
    if (!key || bucket.seenKeys.has(key)) return;
    bucket.seenKeys.add(key);
    if (!bucket.primary) {
      bucket.primary = cleaned;
    } else {
      bucket.variants.push(cleaned);
    }
  };

  for (const row of minuteStudents) {
    const sid = typeof row?.studentId === "string" ? row.studentId.trim() : "";
    if (!sid) continue;

    let bucket = byStudent.get(sid);
    if (!bucket) {
      bucket = { primary: "", variants: [], seenKeys: new Set<string>() };
      byStudent.set(sid, bucket);
    }

    registerVariant(bucket, row.student?.name);
    registerVariant(bucket, row.studentNameSnapshot);
    if (Array.isArray(row.previousNameSnapshots)) {
      for (const alias of row.previousNameSnapshots) {
        registerVariant(bucket, alias);
      }
    }
  }

  const entries: StudentMaskingInput[] = [];
  for (const [id, bucket] of byStudent.entries()) {
    if (!bucket.primary) continue;
    entries.push({
      id,
      name: bucket.primary,
      aliases: bucket.variants,
    });
  }
  return entries;
}

/**
 * Verifica se alguma das variantes do nome de um estudante ainda aparece em um dos textos da ata.
 */
export function textMentionsStudentNameVariant(
  texts: ReadonlyArray<string | null | undefined>,
  candidateName: string
): boolean {
  const cleaned = candidateName.replace(/\s+/g, " ").trim();
  if (!cleaned) return false;

  const combined = texts
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n");
  if (!combined) return false;

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;

  const fullPattern = parts.map((p) => buildAccentInsensitiveRegexFragment(p)).join("\\s+");
  const fullRegex = new RegExp(`(?<![\\p{L}\\p{N}])${fullPattern}(?![\\p{L}\\p{N}])`, "iu");
  if (fullRegex.test(combined)) {
    return true;
  }

  if (parts.length > 1 && parts[0].length >= 3) {
    const firstPattern = buildAccentInsensitiveRegexFragment(parts[0]);
    const firstRegex = new RegExp(`(?<![\\p{L}\\p{N}])${firstPattern}(?![\\p{L}\\p{N}])`, "iu");
    if (firstRegex.test(combined)) {
      return true;
    }
  }

  return false;
}

/**
 * Retém estritamente as grafias anteriores distintas do nome atual que ainda aparecem no texto salvo da ata.
 */
export function retainNecessaryPreviousStudentNames(
  existingPrevious: ReadonlyArray<string | null | undefined> | null | undefined,
  existingSnapshot: string | null | undefined,
  nextCurrentName: string,
  minuteTexts: ReadonlyArray<string | null | undefined>
): string[] {
  const currentKey = normalizeStudentNameVariantKey(nextCurrentName || "");
  const seen = new Set<string>();
  const candidates: string[] = [];

  const pushCandidate = (raw?: string | null) => {
    const cleaned = (raw || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const key = normalizeStudentNameVariantKey(cleaned);
    if (!key || key === currentKey || seen.has(key)) return;
    seen.add(key);
    candidates.push(cleaned);
  };

  pushCandidate(existingSnapshot);
  if (Array.isArray(existingPrevious)) {
    for (const prev of existingPrevious) {
      pushCandidate(prev);
    }
  }

  return candidates
    .filter((name) => textMentionsStudentNameVariant(minuteTexts, name))
    .slice(0, 12);
}

/**
 * Remove metadados internos de histórico de grafias anteriores ao serializar vínculos para a interface autenticada.
 */
export function stripInternalStudentNameAliases<T extends Record<string, any>>(
  students: T[] | null | undefined
): Array<Omit<T, "previousNameSnapshots">> {
  if (!Array.isArray(students)) return [];
  return students.map((s) => {
    if (!s || typeof s !== "object") return s;
    const { previousNameSnapshots, ...rest } = s;
    void previousNameSnapshots;
    return rest as Omit<T, "previousNameSnapshots">;
  });
}

/**
 * Anonimiza menções a outros menores citados em atas conjuntas ao gerar o Dossiê Individual
 * ou ao exibir minuta em link móvel de assinatura para responsável de um único aluno.
 * Conforme Arts. 17, 18, 143 e 247 do ECA (preservação da imagem e sigilo perante terceiros).
 * Cobre múltiplas variantes por estudante (nome atual e grafias anteriores associadas ao studentId)
 * com tolerância a acentuação e fronteiras Unicode (\p{L}\p{N}).
 */
export function anonymizeOtherMinorsInText(
  text: string,
  targetStudentId: string | null | undefined,
  linkedStudents: StudentMaskingInput[]
): string {
  if (!text) return "";
  let result = text;

  const targetFirstNames = new Set<string>();
  if (targetStudentId) {
    for (const student of linkedStudents) {
      if (student.id !== targetStudentId) continue;
      const targetNames = [student.name, ...(Array.isArray(student.aliases) ? student.aliases : [])];
      for (const candidate of targetNames) {
        const cleaned = (candidate || "").trim();
        if (!cleaned) continue;
        const firstPart = cleaned.split(/\s+/).filter(Boolean)[0];
        if (firstPart) {
          targetFirstNames.add(normalizeStudentNameVariantKey(firstPart));
        }
      }
    }
  }

  const others = targetStudentId
    ? linkedStudents.filter((s) => s.id !== targetStudentId)
    : linkedStudents;

  const variants: Array<{
    rawName: string;
    parts: string[];
    fullRegex: RegExp;
    initials: string;
    firstRegex: RegExp | null;
    firstInitial: string;
  }> = [];
  const seenVariantKeys = new Set<string>();

  for (const other of others) {
    const rawNames = [other.name, ...(Array.isArray(other.aliases) ? other.aliases : [])];
    for (const candidate of rawNames) {
      const rawName: string = String(candidate || "").trim();
      if (!rawName) continue;
      const key = `${other.id}:${normalizeStudentNameVariantKey(rawName)}`;
      if (seenVariantKeys.has(key)) continue;
      seenVariantKeys.add(key);

      const parts: string[] = rawName.split(/\s+/).filter(Boolean);
      if (parts.length === 0) continue;

      const initials = parts.map((p: string) => `${p[0].toUpperCase()}.`).join(" ") + " (outro estudante)";
      const escapedFullPattern = parts
        .map((p: string) => buildAccentInsensitiveRegexFragment(p))
        .join("\\s+");
      const fullRegex = new RegExp(`(?<![\\p{L}\\p{N}])${escapedFullPattern}(?![\\p{L}\\p{N}])`, "giu");

      let firstRegex: RegExp | null = null;
      const firstPart = parts[0];
      const firstKey = normalizeStudentNameVariantKey(firstPart);
      if (parts.length > 1 && firstPart.length >= 3 && !targetFirstNames.has(firstKey)) {
        const escapedFirst = buildAccentInsensitiveRegexFragment(firstPart);
        firstRegex = new RegExp(`(?<![\\p{L}\\p{N}])${escapedFirst}(?![\\p{L}\\p{N}])`, "giu");
      }

      variants.push({
        rawName,
        parts,
        fullRegex,
        initials,
        firstRegex,
        firstInitial: `${firstPart[0].toUpperCase()}. (outro estudante)`,
      });
    }
  }

  // Ordena do mais específico (mais tokens / maior tamanho) para evitar mascaramento parcial prematuro
  variants.sort((a, b) => b.parts.length - a.parts.length || b.rawName.length - a.rawName.length);

  for (const variant of variants) {
    result = result.replace(variant.fullRegex, variant.initials);
  }
  for (const variant of variants) {
    if (variant.firstRegex) {
      result = result.replace(variant.firstRegex, variant.firstInitial);
    }
  }

  return result;
}

export const ANONYMIZED_OTHER_STUDENT_LABEL = "Outro estudante";

export interface DossierParticipantInput {
  role?: string | null;
  studentId?: string | null;
  name?: string | null;
}

/**
 * Prepara no servidor a lista de participantes exibida e impressa em "Presentes" no Dossiê,
 * preservando o estudante titular e substituindo demais estudantes (ou vínculos estudantis
 * legados sem identidade determinável) pela indicação genérica "Outro estudante".
 */
export function anonymizeParticipantsForDossier(
  participants: ReadonlyArray<DossierParticipantInput> | null | undefined,
  targetStudentId: string | null | undefined,
  linkedStudents: StudentMaskingInput[]
): string[] {
  if (!Array.isArray(participants) || participants.length === 0) return [];

  const targetId = typeof targetStudentId === "string" ? targetStudentId.trim() : "";
  const targetKeys = new Set<string>();
  const otherKeys = new Set<string>();
  const otherFullNameRegexes: Array<{ rawName: string; regex: RegExp }> = [];
  const seenOtherRegexKeys = new Set<string>();

  for (const student of linkedStudents || []) {
    const sid = typeof student?.id === "string" ? student.id.trim() : "";
    const variants = [student?.name, ...(Array.isArray(student?.aliases) ? student.aliases : [])];
    for (const raw of variants) {
      const cleaned = (raw || "").replace(/\s+/g, " ").trim();
      if (!cleaned) continue;
      const key = normalizeStudentNameVariantKey(cleaned);
      if (!key) continue;

      if (targetId && sid === targetId) {
        targetKeys.add(key);
        continue;
      }

      otherKeys.add(key);
      if (!seenOtherRegexKeys.has(key)) {
        seenOtherRegexKeys.add(key);
        const parts = cleaned.split(/\s+/).filter(Boolean);
        if (parts.length > 0) {
          const pattern = parts.map((p: string) => buildAccentInsensitiveRegexFragment(p)).join("\\s+");
          otherFullNameRegexes.push({
            rawName: cleaned,
            regex: new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"),
          });
        }
      }
    }
  }

  otherFullNameRegexes.sort((a, b) => b.rawName.length - a.rawName.length);

  const output: string[] = [];
  for (const participant of participants) {
    const cleanedName = (participant?.name || "").replace(/\s+/g, " ").trim();
    if (!cleanedName) continue;

    const role = (participant?.role || "").trim().toUpperCase();
    const pStudentId =
      typeof participant?.studentId === "string" ? participant.studentId.trim() : "";
    const pKey = normalizeStudentNameVariantKey(cleanedName);

    if (role === "ESTUDANTE") {
      if (pStudentId) {
        output.push(targetId && pStudentId === targetId ? cleanedName : ANONYMIZED_OTHER_STUDENT_LABEL);
        continue;
      }

      const matchesTargetUnambiguously = Boolean(
        targetId && pKey && targetKeys.has(pKey) && !otherKeys.has(pKey)
      );
      output.push(matchesTargetUnambiguously ? cleanedName : ANONYMIZED_OTHER_STUDENT_LABEL);
      continue;
    }

    if (pKey && otherKeys.has(pKey) && !targetKeys.has(pKey)) {
      output.push(ANONYMIZED_OTHER_STUDENT_LABEL);
      continue;
    }

    let maskedName = cleanedName;
    for (const entry of otherFullNameRegexes) {
      maskedName = maskedName.replace(entry.regex, ANONYMIZED_OTHER_STUDENT_LABEL);
    }
    output.push(maskedName);
  }

  return output;
}

export const PHYSICAL_PROOF_HISTORY_SELECT = {
  id: true,
  schoolId: true,
  contentRevision: true,
  originIsConfidential: true,
  originAuthorId: true,
  originAuthorEmail: true,
  scanProvider: true,
  scanMimeType: true,
  scanSizeBytes: true,
  scanSha256: true,
  uploadedAt: true,
  uploadedBy: true,
  govBrVerified: true,
  govBrProtocol: true,
  supersededAt: true,
  supersededByRevision: true,
  supersededByEmail: true,
} as const;

export interface PhysicalProofHistoryAccessItem {
  id: string;
  schoolId?: string | null;
  contentRevision?: number | null;
  originIsConfidential?: boolean | null;
  originAuthorId?: string | null;
  originAuthorEmail?: string | null;
  scanProvider?: string | null;
  scanMimeType?: string | null;
  scanSizeBytes?: number | null;
  scanSha256?: string | null;
  uploadedAt?: Date | string | null;
  uploadedBy?: string | null;
  govBrVerified?: boolean;
  govBrProtocol?: string | null;
  supersededAt: Date | string;
  supersededByRevision?: number | null;
  supersededByEmail?: string | null;
}

/**
 * Aplica as permissões atuais da sessão + isolamento multi-tenant + classificação/autoria
 * da revisão de origem a um anexo histórico superado.
 * Registros legados sem classificação (`originIsConfidential == null`) ou sem autoria de origem
 * comprovada falham fechado no regime restritivo (apenas Gestor Escolar ativo da unidade ou SuperAdmin).
 */
export function canAccessPhysicalProofHistoryItem(
  item:
    | {
        schoolId?: string | null;
        originIsConfidential?: boolean | null;
        originAuthorId?: string | null;
        originAuthorEmail?: string | null;
      }
    | null
    | undefined,
  minuteSchoolId: string | null | undefined,
  currentSchoolId: string | null | undefined,
  session: any
): boolean {
  if (!item || !session?.user || session.user.active === false) {
    return false;
  }

  const itemSchoolId = item.schoolId?.trim() || "";
  if (!itemSchoolId) {
    return false;
  }
  if (minuteSchoolId && itemSchoolId !== minuteSchoolId) {
    return false;
  }
  if (!assertTenantOwnership(itemSchoolId, currentSchoolId || "", session)) {
    return false;
  }

  const hasProvenOriginAuthor = Boolean(
    item.originAuthorId?.trim() || item.originAuthorEmail?.trim()
  );
  const isKnownNonConfidentialOrigin =
    item.originIsConfidential === false && hasProvenOriginAuthor;

  if (isKnownNonConfidentialOrigin) {
    return true;
  }

  return canAccessConfidentialMinute(
    {
      isConfidential: true,
      schoolId: itemSchoolId,
      authorId: item.originAuthorId ?? null,
      authorEmail: item.originAuthorEmail ?? null,
    },
    session
  );
}

/**
 * Filtra itens do histórico de vias físicas conforme sigilo de origem e omite campos internos de autoria.
 */
export function filterAccessiblePhysicalProofHistory<T extends PhysicalProofHistoryAccessItem>(
  items: ReadonlyArray<T> | null | undefined,
  minuteSchoolId: string | null | undefined,
  currentSchoolId: string | null | undefined,
  session: any
) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items
    .filter((item) =>
      canAccessPhysicalProofHistoryItem(item, minuteSchoolId, currentSchoolId, session)
    )
    .map(
      ({
        schoolId: _schoolId,
        originAuthorId: _originAuthorId,
        originAuthorEmail: _originAuthorEmail,
        ...safeRest
      }) => safeRest
    );
}

/**
 * Verifica se o usuário autenticado possui autorização legal para ler o teor integral
 * de uma ata classificada com Sigilo Reforçado ECA (`isConfidential: true`).
 * Acesso restrito a: SuperAdmin ativo, Gestor Escolar com vínculo ativo na escola da ata ou o próprio servidor autor.
 * Papel legado `ADMIN` local nunca recebe alcance global nem acesso sem vínculo ativo na escola da ata.
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
  if (!session?.user || session.user.active === false) return false;

  const user = session.user as any;
  const email = (user.email || "").toLowerCase().trim();
  const role = user.role;

  // Apenas SuperAdmin ativo possui alcance global entre escolas
  if (role === "SUPERADMIN" || isBootstrapAdminEmail(email)) {
    return true;
  }

  // O próprio servidor público que lavrou a ata mantém acesso
  if (minute.authorId && user.id && minute.authorId === user.id) {
    return true;
  }
  if (minute.authorEmail && email && minute.authorEmail.toLowerCase().trim() === email) {
    return true;
  }

  // Direção / Gestão Escolar com vínculo ativo especificamente na unidade escolar da ata
  const userSchools = Array.isArray(user.schools) ? user.schools : [];
  if (minute.schoolId && userSchools.length > 0) {
    return userSchools.some(
      (s: any) =>
        s.active !== false &&
        (s.schoolId === minute.schoolId || s.id === minute.schoolId) &&
        (s.role === "GESTOR_ESCOLAR" || s.role === "ADMIN")
    );
  }

  return false;
}

/**
 * Remove segredos de assinatura móvel (`mobileSignToken`, `mobileSignExpiresAt`, `mobileSignRevision`)
 * e aliases internos de estudantes (`previousNameSnapshots`) antes de serializar respostas JSON ou props SSR.
 */
export function stripParticipantSecrets<T>(minute: T): T {
  if (!minute || typeof minute !== "object") return minute;
  const record = minute as Record<string, any>;
  const hasParticipants = Array.isArray(record.participants) && record.participants.length > 0;
  const hasStudentAliases =
    Array.isArray(record.students) &&
    record.students.some(
      (s: any) => s && typeof s === "object" && Object.prototype.hasOwnProperty.call(s, "previousNameSnapshots")
    );

  if (!hasParticipants && !hasStudentAliases) {
    return minute;
  }

  return {
    ...record,
    ...(hasStudentAliases
      ? { students: stripInternalStudentNameAliases(record.students) }
      : {}),
    ...(hasParticipants
      ? {
          participants: record.participants.map((p: any) => {
            if (!p || typeof p !== "object") return p;
            const { mobileSignToken, mobileSignExpiresAt, mobileSignRevision, ...rest } = p;
            void mobileSignRevision;
            return {
              ...rest,
              hasSignature: Boolean(rest.hasSignature),
              hasActiveSignLink:
                typeof rest.hasActiveSignLink === "boolean"
                  ? rest.hasActiveSignLink
                  : Boolean(mobileSignToken),
            };
          }),
        }
      : {}),
  } as T;
}

/**
 * Constrói representação mínima estrita de ata com sigilo reforçado para operadores sem acesso integral,
 * omitindo estudantes, grafias anteriores, categoria, autoria, textos, anexos e metadados internos.
 */
export function buildRestrictedConfidentialMinuteSummary(
  minute: {
    id: string;
    schoolId?: string | null;
    year?: number | null;
    ataNumber?: number | null;
    status: string;
    attendedAt: Date | string;
  },
  options?: {
    subject?: string;
    summary?: string;
  }
) {
  return {
    id: minute.id,
    schoolId: minute.schoolId ?? null,
    year: minute.year ?? new Date().getFullYear(),
    ataNumber: minute.ataNumber ?? null,
    status: minute.status,
    isConfidential: true,
    restrictedConfidential: true,
    attendedAt: minute.attendedAt,
    subject: options?.subject || "Atendimento sob sigilo institucional",
    rawNotes: null,
    summary:
      options?.summary ||
      "[CONTEÚDO SOB SIGILO INSTITUCIONAL — ACESSO RESTRITO À DIREÇÃO ESCOLAR E AO SERVIDOR AUTOR]",
    agreementsSummary: null,
    students: [],
    participants: [],
    actionItems: [],
    addendums: [],
    physicalProofHistory: [],
    hasPhysicalScan: false,
    govBrVerified: false,
    govBrProtocol: null,
  };
}

/**
 * Valida estritamente imagem de assinatura em PNG (prefixo Data URL, limite de 512 KB
 * e assinatura binária PNG `\x89PNG\r\n\x1a\n`).
 */
export function validatePngSignatureDataUrl(
  rawDataUrl: string,
  maxBytes: number = 512 * 1024
): { ok: true; byteLength: number } | { ok: false; error: string } {
  const trimmed = rawDataUrl.trim();
  const match = trimmed.match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return {
      ok: false,
      error: "Formato de assinatura inválido. Envie apenas imagem PNG codificada em Base64 (data:image/png;base64,).",
    };
  }

  const base64Clean = match[1].replace(/\s+/g, "");
  if (!base64Clean) {
    return { ok: false, error: "Imagem de assinatura vazia ou corrompida." };
  }

  const buffer = Buffer.from(base64Clean, "base64");
  if (buffer.length < 8) {
    return { ok: false, error: "Conteúdo binário de assinatura PNG inválido ou truncado." };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, error: "Imagem de assinatura excede o tamanho máximo permitido (512KB)." };
  }

  const isPngMagic =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  if (!isPngMagic) {
    return {
      ok: false,
      error: "Conteúdo binário incompatível com PNG válido (MIME spoofing bloqueado).",
    };
  }

  return { ok: true, byteLength: buffer.length };
}
