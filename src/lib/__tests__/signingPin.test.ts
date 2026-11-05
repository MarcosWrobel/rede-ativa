import { describe, it, expect } from "vitest";
import {
  validatePinFormat,
  hashPin,
  verifyPin,
  calculateBusinessDaysDiff,
} from "../signingPin";

describe("signingPin - Segurança de Fé Pública e Dias Úteis", () => {
  it("valida PIN de 4 a 6 dígitos numéricos corretamente", () => {
    expect(validatePinFormat("9482").valid).toBe(true);
    expect(validatePinFormat("839201").valid).toBe(true);

    // Inválidos
    expect(validatePinFormat("123").valid).toBe(false);
    expect(validatePinFormat("1234567").valid).toBe(false);
    expect(validatePinFormat("abcd").valid).toBe(false);
    expect(validatePinFormat("12a4").valid).toBe(false);
    expect(validatePinFormat("").valid).toBe(false);

    // Triviais rejeitados
    expect(validatePinFormat("1234").valid).toBe(false);
    expect(validatePinFormat("0000").valid).toBe(false);
    expect(validatePinFormat("123456").valid).toBe(false);
  });

  it("gera hash PBKDF2 e verifica com sucesso", async () => {
    const pin = "7492";
    const hashed = await hashPin(pin);
    expect(hashed).toContain(":");

    const ok = await verifyPin(pin, hashed);
    expect(ok).toBe(true);

    const wrong = await verifyPin("7493", hashed);
    expect(wrong).toBe(false);
  });

  it("calcula dias úteis ignorando sábados e domingos", () => {
    // Sexta-feira
    const friday = new Date("2026-11-06T10:00:00Z");
    // Próxima segunda-feira
    const monday = new Date("2026-11-09T10:00:00Z");
    expect(calculateBusinessDaysDiff(friday, monday)).toBe(1);

    // Sexta-feira para a próxima sexta (5 dias úteis)
    const nextFriday = new Date("2026-11-13T10:00:00Z");
    expect(calculateBusinessDaysDiff(friday, nextFriday)).toBe(5);

    // Mesmo dia
    expect(calculateBusinessDaysDiff(friday, friday)).toBe(0);
  });
});
