import crypto from "crypto";
import { safeCompareStrings } from "./syncToken";

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Sem 0/O/1/I para evitar erro de digitação
const DEFAULT_EXPIRY_DAYS = 15;

export interface SchoolTeacherInviteState {
  codeHash: string | null;
  nonce: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export interface TeacherInviteTokenPayload {
  v: 1;
  schoolId: string;
  nonce: string;
  exp: number;
}

function getInviteSigningKey(): Buffer {
  const secret = (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      throw new Error(
        "Configuração de criptografia ausente: defina NEXTAUTH_SECRET ou AUTH_SECRET em produção."
      );
    }
    return crypto
      .createHash("sha256")
      .update("rede-ativa-dev-ephemeral-teacher-invite-key", "utf8")
      .digest();
  }
  return crypto
    .createHash("sha256")
    .update(`school-teacher-invite:${secret}`, "utf8")
    .digest();
}

export function normalizeTeacherInviteCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().trim();
}

export function formatTeacherInviteCode(normalized: string): string {
  const clean = normalizeTeacherInviteCode(normalized);
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  }
  return clean;
}

export function generateSchoolTeacherInviteCode(): string {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length];
  }
  return code;
}

export function hashTeacherInviteCode(code: string, schoolId: string): string {
  const clean = normalizeTeacherInviteCode(code);
  const key = getInviteSigningKey();
  return crypto
    .createHmac("sha256", key)
    .update(`${schoolId}:${clean}`, "utf8")
    .digest("hex");
}

export function createTeacherInviteRecord(params: {
  schoolId: string;
  expiresInDays?: number;
  updatedByEmail: string;
  nowMs?: number;
}): {
  plainCode: string;
  formattedCode: string;
  nonce: string;
  state: SchoolTeacherInviteState;
} {
  const nowMs = params.nowMs ?? Date.now();
  const days = Math.min(90, Math.max(1, Math.floor(params.expiresInDays ?? DEFAULT_EXPIRY_DAYS)));
  const plainCode = generateSchoolTeacherInviteCode();
  const nonce = crypto.randomBytes(12).toString("base64url");
  const expiresAt = new Date(nowMs + days * 86_400_000).toISOString();

  return {
    plainCode,
    formattedCode: formatTeacherInviteCode(plainCode),
    nonce,
    state: {
      codeHash: hashTeacherInviteCode(plainCode, params.schoolId),
      nonce,
      expiresAt,
      updatedAt: new Date(nowMs).toISOString(),
      updatedByEmail: params.updatedByEmail.trim().toLowerCase(),
    },
  };
}

export function parseSchoolTeacherInviteSettings(
  settingsJson: string | null | undefined
): SchoolTeacherInviteState | null {
  if (!settingsJson || !settingsJson.trim()) return null;
  try {
    const parsed = JSON.parse(settingsJson) as Record<string, unknown>;
    const raw = parsed?.teacherInvite;
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const codeHash = typeof obj.codeHash === "string" && obj.codeHash.trim() ? obj.codeHash.trim() : null;
    const nonce = typeof obj.nonce === "string" && obj.nonce.trim() ? obj.nonce.trim() : null;
    const expiresAt = typeof obj.expiresAt === "string" && obj.expiresAt.trim() ? obj.expiresAt.trim() : null;
    const updatedAt = typeof obj.updatedAt === "string" && obj.updatedAt.trim() ? obj.updatedAt.trim() : null;
    const updatedByEmail =
      typeof obj.updatedByEmail === "string" && obj.updatedByEmail.trim()
        ? obj.updatedByEmail.trim().toLowerCase()
        : null;

    if (!codeHash || !nonce || !expiresAt) return null;
    return { codeHash, nonce, expiresAt, updatedAt, updatedByEmail };
  } catch {
    return null;
  }
}

export function mergeSchoolTeacherInviteSettings(
  settingsJson: string | null | undefined,
  nextInvite: SchoolTeacherInviteState | null
): string {
  let base: Record<string, unknown> = {};
  if (settingsJson && settingsJson.trim()) {
    try {
      const parsed = JSON.parse(settingsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  if (nextInvite === null) {
    delete base.teacherInvite;
  } else {
    base.teacherInvite = nextInvite;
  }
  return JSON.stringify(base);
}

export function isSchoolTeacherInviteActive(
  state: SchoolTeacherInviteState | null | undefined,
  nowMs: number = Date.now()
): state is SchoolTeacherInviteState {
  if (!state?.codeHash || !state.nonce || !state.expiresAt) return false;
  const expMs = Date.parse(state.expiresAt);
  return Number.isFinite(expMs) && expMs > nowMs;
}

export function verifySchoolTeacherInviteCode(params: {
  providedCode: string;
  schoolId: string;
  state: SchoolTeacherInviteState | null | undefined;
  nowMs?: number;
}): boolean {
  const clean = normalizeTeacherInviteCode(params.providedCode);
  if (clean.length < 6) return false;
  if (!isSchoolTeacherInviteActive(params.state, params.nowMs)) return false;
  const candidateHash = hashTeacherInviteCode(clean, params.schoolId);
  return safeCompareStrings(candidateHash, params.state.codeHash);
}

export function createSchoolTeacherInviteToken(params: {
  schoolId: string;
  nonce: string;
  expiresAt: string;
}): string {
  const expMs = Date.parse(params.expiresAt);
  const payload: TeacherInviteTokenPayload = {
    v: 1,
    schoolId: params.schoolId,
    nonce: params.nonce,
    exp: Number.isFinite(expMs) ? expMs : Date.now() + 7 * 86_400_000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", getInviteSigningKey())
    .update(payloadB64, "utf8")
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function verifySchoolTeacherInviteToken(
  token: string,
  nowMs: number = Date.now()
):
  | { ok: true; payload: TeacherInviteTokenPayload }
  | { ok: false; error: string } {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: "Link de vínculo inválido." };
  }
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac("sha256", getInviteSigningKey())
    .update(payloadB64, "utf8")
    .digest("base64url");
  if (!safeCompareStrings(sigB64, expectedSig)) {
    return { ok: false, error: "Assinatura do link de vínculo inválida." };
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as TeacherInviteTokenPayload;
    if (
      parsed.v !== 1 ||
      typeof parsed.schoolId !== "string" ||
      !parsed.schoolId ||
      typeof parsed.nonce !== "string" ||
      !parsed.nonce ||
      typeof parsed.exp !== "number"
    ) {
      return { ok: false, error: "Link de vínculo malformado." };
    }
    if (nowMs >= parsed.exp) {
      return { ok: false, error: "A validade deste link de vínculo expirou." };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, error: "Link de vínculo corrompido." };
  }
}
