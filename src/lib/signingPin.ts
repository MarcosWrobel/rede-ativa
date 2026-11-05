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

/**
 * Calcula a quantidade de dias úteis entre duas datas (ignorando finais de semana).
 */
export function calculateBusinessDaysDiff(startDate: Date, endDate: Date = new Date()): number {
  let count = 0;
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);

  const target = new Date(endDate);
  target.setHours(0, 0, 0, 0);

  if (cur >= target) return 0;

  while (cur < target) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      // Dia útil (segunda a sexta)
      count++;
    }
  }

  return count;
}
