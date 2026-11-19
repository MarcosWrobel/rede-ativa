import crypto from "crypto";
import { safeCompareStrings } from "./syncToken";

export interface CouncilTeacherTokenPayload {
  v: 1;
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  subjectId: string | null;
  exp: number; // Unix timestamp em ms
}

export type VerifyCouncilTeacherTokenResult =
  | { ok: true; payload: CouncilTeacherTokenPayload }
  | { ok: false; reason: "invalid" | "expired"; error: string };

const INVALID_TOKEN_ERROR =
  "Link de acesso inválido ou corrompido. Solicite um novo link à coordenação pedagógica.";
const EXPIRED_TOKEN_ERROR =
  "A validade deste link para professores expirou. Solicite um novo link à coordenação pedagógica.";

function getSigningKey(): Buffer {
  const secret = (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      throw new Error(
        "Configuração de criptografia ausente: defina NEXTAUTH_SECRET ou AUTH_SECRET em produção."
      );
    }
    return crypto
      .createHash("sha256")
      .update("rede-ativa-dev-ephemeral-council-teacher-key", "utf8")
      .digest();
  }
  return crypto
    .createHash("sha256")
    .update(`council-teacher-link:${secret}`, "utf8")
    .digest();
}

function signPayloadEncoded(payloadB64: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(payloadB64, "utf8").digest("base64url");
}

/**
 * Emite um token stateless assinado com HMAC-SHA256 para lançamento docente
 * no Conselho de Classe via conta institucional @escola.pr.gov.br.
 */
export function createCouncilTeacherToken(params: {
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  subjectId?: string | null;
  expiresInDays?: number;
  nowMs?: number;
}): { token: string; expiresAt: Date; payload: CouncilTeacherTokenPayload } {
  const schoolId = params.schoolId.trim();
  const boardId = params.boardId.trim();
  if (!schoolId || !boardId) {
    throw new Error("Identificadores de escola e conselho são obrigatórios para gerar o link.");
  }

  const days = Math.max(1, Math.min(30, Math.trunc(params.expiresInDays ?? 7)));
  const nowMs = params.nowMs ?? Date.now();
  const exp = nowMs + days * 24 * 60 * 60 * 1000;

  const payload: CouncilTeacherTokenPayload = {
    v: 1,
    schoolId,
    boardId,
    trimester: params.trimester,
    subjectId: params.subjectId?.trim() || null,
    exp,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigB64 = signPayloadEncoded(payloadB64, getSigningKey());

  return {
    token: `${payloadB64}.${sigB64}`,
    expiresAt: new Date(exp),
    payload,
  };
}

/**
 * Valida integridade criptográfica e prazo de expiração do token de acesso docente.
 */
export function verifyCouncilTeacherToken(
  token: string,
  nowMs: number = Date.now()
): VerifyCouncilTeacherTokenResult {
  const clean = typeof token === "string" ? token.trim() : "";
  if (!clean) {
    return { ok: false, reason: "invalid", error: INVALID_TOKEN_ERROR };
  }

  const dotParts = clean.split(".");
  if (dotParts.length !== 2 || !dotParts[0] || !dotParts[1]) {
    return { ok: false, reason: "invalid", error: INVALID_TOKEN_ERROR };
  }

  const [payloadB64, sigB64] = dotParts;

  try {
    const key = getSigningKey();
    const expectedSigB64 = signPayloadEncoded(payloadB64, key);

    if (!safeCompareStrings(sigB64, expectedSigB64)) {
      return { ok: false, reason: "invalid", error: INVALID_TOKEN_ERROR };
    }

    const decodedJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decodedJson);

    if (!parsed || typeof parsed !== "object") {
      return { ok: false, reason: "invalid", error: INVALID_TOKEN_ERROR };
    }

    const obj = parsed as Record<string, unknown>;
    const trimester = obj.trimester;
    if (
      obj.v !== 1 ||
      typeof obj.schoolId !== "string" ||
      !obj.schoolId.trim() ||
      typeof obj.boardId !== "string" ||
      !obj.boardId.trim() ||
      (trimester !== 1 && trimester !== 2 && trimester !== 3) ||
      (obj.subjectId !== null && (typeof obj.subjectId !== "string" || !obj.subjectId.trim())) ||
      typeof obj.exp !== "number" ||
      !Number.isFinite(obj.exp)
    ) {
      return { ok: false, reason: "invalid", error: INVALID_TOKEN_ERROR };
    }

    if (nowMs >= obj.exp) {
      return { ok: false, reason: "expired", error: EXPIRED_TOKEN_ERROR };
    }

    return {
      ok: true,
      payload: {
        v: 1,
        schoolId: obj.schoolId.trim(),
        boardId: obj.boardId.trim(),
        trimester,
        subjectId: obj.subjectId ? obj.subjectId.trim() : null,
        exp: obj.exp,
      },
    };
  } catch {
    return { ok: false, reason: "invalid", error: INVALID_TOKEN_ERROR };
  }
}
