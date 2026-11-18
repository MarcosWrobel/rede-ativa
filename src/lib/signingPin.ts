import crypto from "crypto";

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

const TRIVIAL_PINS = new Set([
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "1234",
  "4321",
  "12345",
  "54321",
  "00000",
  "11111",
  "123456",
  "654321",
  "000000",
  "111111",
]);

/**
 * Valida o formato e a complexidade básica do PIN de fé pública (4 a 6 dígitos numéricos).
 */
export function validatePinFormat(pin: string): { valid: boolean; error?: string } {
  if (!pin || typeof pin !== "string") {
    return { valid: false, error: "O PIN é obrigatório." };
  }

  const cleanPin = pin.trim();

  if (!/^\d{4,6}$/.test(cleanPin)) {
    return { valid: false, error: "O PIN deve conter entre 4 e 6 dígitos numéricos (apenas números)." };
  }

  if (TRIVIAL_PINS.has(cleanPin)) {
    return { valid: false, error: "O PIN escolhido é muito simples. Evite sequências óbvias ou dígitos repetidos." };
  }

  return { valid: true };
}

/**
 * Gera hash criptográfico seguro (PBKDF2-SHA512) para o PIN com salt aleatório.
 */
export async function hashPin(pin: string): Promise<string> {
  const validation = validatePinFormat(pin);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin.trim(), salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Verifica se o PIN informado corresponde ao hash armazenado no banco de dados.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  if (!pin || !storedHash) return false;

  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;

  const [salt, originalHashHex] = parts;
  const originalBuffer = Buffer.from(originalHashHex, "hex");

  return new Promise((resolve) => {
    crypto.pbkdf2(pin.trim(), salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const matches = crypto.timingSafeEqual(originalBuffer, derivedKey);
        resolve(matches);
      } catch {
        resolve(false);
      }
    });
  });
}

export { calculateBusinessDaysDiff } from "@/services/ataFinalizationService";

export interface ServerPinCheckResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Valida o PIN Pessoal de confirmação do servidor antes de lavrar, aditar ou anular
 * atas (autoria pessoal intransferível).
 *
 * - Opera em fail-closed: se `userId`, `prismaClient.user.findUnique`, `userDb` ou `signingPinHash`
 *   estiverem ausentes, rejeita com 401 (`PIN_REQUIRED`).
 * - Aplica trava progressiva temporária (5 minutos) após 3 tentativas incorretas consecutivas.
 */
export async function verifyServerSigningPin(
  prismaClient: any,
  userId: string | undefined,
  rawProvidedPin?: unknown
): Promise<ServerPinCheckResult> {
  if (!userId || !prismaClient?.user?.findUnique) {
    return {
      ok: false,
      status: 401,
      error: "PIN_REQUIRED: Confirmação de autoria por PIN obrigatória.",
    };
  }

  const userDb = await prismaClient.user.findUnique({
    where: { id: userId },
    select: { id: true, signingPinHash: true, pinAttempts: true, pinLockedUntil: true },
  });

  if (!userDb) {
    return {
      ok: false,
      status: 401,
      error: "PIN_REQUIRED: Confirmação de autoria por PIN obrigatória.",
    };
  }

  if (!userDb.signingPinHash) {
    return {
      ok: false,
      status: 401,
      error:
        "PIN_REQUIRED:Cadastre seu PIN de confirmação antes de assinar ou confirmar atos.",
    };
  }

  const now = new Date();
  if (userDb.pinLockedUntil && userDb.pinLockedUntil > now) {
    const minsLeft = Math.ceil((userDb.pinLockedUntil.getTime() - now.getTime()) / 60000);
    return {
      ok: false,
      status: 403,
      error: `PIN de confirmação temporariamente bloqueado. Aguarde ${minsLeft} minuto(s) para tentar novamente.`,
    };
  }

  const providedPin = rawProvidedPin ? String(rawProvidedPin).trim() : "";
  if (!providedPin) {
    return {
      ok: false,
      status: 401,
      error: "PIN_REQUIRED:Informe seu PIN de confirmação para assinar este registro.",
    };
  }

  const isValidPin = await verifyPin(providedPin, userDb.signingPinHash);
  if (!isValidPin) {
    const nextAttempts = (userDb.pinAttempts || 0) + 1;
    const shouldLock = nextAttempts >= 3;
    const lockUntil = shouldLock ? new Date(now.getTime() + 5 * 60000) : null;

    if (prismaClient.user?.update) {
      await prismaClient.user.update({
        where: { id: userDb.id },
        data: {
          pinAttempts: shouldLock ? 0 : nextAttempts,
          pinLockedUntil: lockUntil,
        },
      });
    }

    return {
      ok: false,
      status: 401,
      error: shouldLock
        ? "PIN de confirmação incorreto. Limite de 3 tentativas excedido. Bloqueado por 5 minutos."
        : `PIN de confirmação incorreto. Tentativas restantes: ${3 - nextAttempts}.`,
    };
  }

  if ((userDb.pinAttempts || 0) > 0 && prismaClient.user?.update) {
    await prismaClient.user.update({
      where: { id: userDb.id },
      data: { pinAttempts: 0, pinLockedUntil: null },
    });
  }

  return { ok: true };
}
