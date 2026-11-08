import crypto from "crypto";

const SYNC_HASH_PREFIX = "sha256:";
const ENCRYPTION_ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret =
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    "rede-ativa-saas-sync-token-secret-fallback";
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Criptografa o token de sincronização com AES-256-GCM para permitir
 * recuperação segura e cópia pelo gestor autenticado em múltiplas máquinas.
 */
export function encryptSyncToken(rawToken: string): string {
  if (!rawToken || typeof rawToken !== "string") return "";
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  let encrypted = cipher.update(rawToken.trim(), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `aes256gcm:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Descriptografa o token de sincronização da escola previamente cifrado com AES-256-GCM.
 */
export function decryptSyncToken(cipherText?: string | null): string | null {
  if (!cipherText || !cipherText.startsWith("aes256gcm:")) return null;
  const parts = cipherText.split(":");
  if (parts.length !== 4) return null;
  const [, ivHex, authTagHex, encryptedHex] = parts;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Gera digest SHA-256 irreversível para armazenamento seguro de tokens de sincronização de escolas.
 */
export function hashSchoolSyncToken(rawToken: string): string {
  const digest = crypto.createHash("sha256").update(rawToken.trim(), "utf8").digest("hex");
  return `${SYNC_HASH_PREFIX}${digest}`;
}

/**
 * Compara duas strings em tempo constante contra ataques de temporização (timing attacks).
 * Aplica digest SHA-256 preliminar garantindo tamanho fixo (32 bytes) em ambos os buffers,
 * neutralizando vazamento de comprimento do segredo por retorno antecipado.
 */
export function safeCompareStrings(provided?: string | null, expected?: string | null): boolean {
  if (!provided || !expected) return false;
  const hashA = crypto.createHash("sha256").update(provided.trim(), "utf8").digest();
  const hashB = crypto.createHash("sha256").update(expected.trim(), "utf8").digest();
  return crypto.timingSafeEqual(hashA, hashB);
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
