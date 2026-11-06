import crypto from "crypto";

const SYNC_HASH_PREFIX = "sha256:";

/**
 * Gera digest SHA-256 irreversível para armazenamento seguro de tokens de sincronização de escolas.
 */
export function hashSchoolSyncToken(rawToken: string): string {
  const digest = crypto.createHash("sha256").update(rawToken.trim(), "utf8").digest("hex");
  return `${SYNC_HASH_PREFIX}${digest}`;
}

/**
 * Compara duas strings em tempo constante contra ataques de temporização (timing attacks).
 */
export function safeCompareStrings(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve uma escola ativa a partir do token de sincronização fornecido pela Extensão Chrome:
 * 1. Verifica prioritariamente pelo hash SHA-256 (`sha256:<hex>`).
 * 2. Fallback retrocompatível para tokens legados pré-auditoria gravados sem prefixo.
 */
export async function findSchoolBySyncToken(
  prismaClient: any,
  providedToken: string
): Promise<{ id: string; name: string } | null> {
  const clean = providedToken.trim();
  if (!clean) return null;

  const hashedCandidate = hashSchoolSyncToken(clean);

  const byHash = await prismaClient.school.findFirst({
    where: { syncTokenHash: hashedCandidate, active: true },
    select: { id: true, name: true },
  });
  if (byHash) return byHash;

  const byLegacy = await prismaClient.school.findFirst({
    where: { syncTokenHash: clean, active: true },
    select: { id: true, name: true },
  });
  return byLegacy || null;
}
