import { describe, it, expect } from "vitest";
import {
  computeMessageContentHash,
  verifyMessageIntegrity,
  formatMessageSeal,
  computeDossierIntegritySeal,
} from "../messageCrypto";

describe("Arcabouço Jurídico & Criptografia de Mensagens (JUR-02 / JUR-01)", () => {
  const basePayload = {
    studentId: "student-123",
    schoolId: "school-leopoldina",
    phoneUsed: "42999998888",
    reasonTitle: "Alerta de 3 faltas consecutivas",
    messageContent: "Olá, informamos que o estudante faltou nos últimos 3 dias letivos.",
    sentByName: "Pedagoga Maria",
    sentAt: "2026-11-05T10:00:00.000Z",
  };

  it("calcula hash SHA-256 canônico determinístico", () => {
    const hash1 = computeMessageContentHash(basePayload);
    const hash2 = computeMessageContentHash({ ...basePayload });

    expect(hash1).toBeDefined();
    expect(hash1).toHaveLength(64); // 256 bits = 64 hex chars
    expect(hash1).toBe(hash2);
  });

  it("produz efeito avalanche se qualquer campo for adulterado", () => {
    const originalHash = computeMessageContentHash(basePayload);

    // Adulteração do texto
    const tamperedContentHash = computeMessageContentHash({
      ...basePayload,
      messageContent: "Olá, informamos que o estudante faltou nos últimos 4 dias letivos.",
    });
    expect(tamperedContentHash).not.toBe(originalHash);

    // Adulteração da data/hora
    const tamperedDateHash = computeMessageContentHash({
      ...basePayload,
      sentAt: "2026-11-05T10:00:01.000Z",
    });
    expect(tamperedDateHash).not.toBe(originalHash);

    // Adulteração do telefone
    const tamperedPhoneHash = computeMessageContentHash({
      ...basePayload,
      phoneUsed: "42999998889",
    });
    expect(tamperedPhoneHash).not.toBe(originalHash);

    // Adulteração de tenant (schoolId)
    const crossTenantTampered = computeMessageContentHash({
      ...basePayload,
      schoolId: "outra-escola-hacker",
    });
    expect(crossTenantTampered).not.toBe(originalHash);
  });

  it("normaliza espaços e formatação de telefone sem quebrar o hash legítimo", () => {
    const hashA = computeMessageContentHash({
      ...basePayload,
      phoneUsed: " (42) 99999-8888 ",
      sentByName: "  PEDAGOGA MARIA  ",
    });
    const hashB = computeMessageContentHash(basePayload);

    expect(hashA).toBe(hashB);
  });

  it("valida integridade com verifyMessageIntegrity", () => {
    const validHash = computeMessageContentHash(basePayload);

    const validCheck = verifyMessageIntegrity(validHash, basePayload);
    expect(validCheck.valid).toBe(true);
    expect(validCheck.calculatedHash).toBe(validHash);

    const tamperedCheck = verifyMessageIntegrity("hash-falso-adulterado", basePayload);
    expect(tamperedCheck.valid).toBe(false);

    const nullCheck = verifyMessageIntegrity(null, basePayload);
    expect(nullCheck.valid).toBe(false);
  });

  it("formata carimbo legível formatMessageSeal", () => {
    const hash = "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0";
    const seal = formatMessageSeal(hash);
    expect(seal).toBe("SHA-256: a1b2c3d4...9abcdef0");

    expect(formatMessageSeal(null)).toBe("NÃO CERTIFICADO");
    expect(formatMessageSeal("curto")).toBe("SHA-256: curto");
  });

  it("gera código pericial do dossiê com computeDossierIntegritySeal (JUR-01)", () => {
    const dossierSeal1 = computeDossierIntegritySeal({
      studentId: "student-123",
      studentName: "João da Silva",
      cgm: "123456",
      schoolId: "school-leopoldina",
      schoolInep: "41042730",
      totalMessages: 5,
      totalMinutes: 2,
      totalJustifications: 1,
      emittedAtIso: "2026-11-05T12:00:00.000Z",
      emittedByEmail: "pedagoga@escola.pr.gov.br",
    });

    expect(dossierSeal1).toMatch(/^DOSSIE-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/);

    const dossierSeal2 = computeDossierIntegritySeal({
      studentId: "student-123",
      studentName: "João da Silva",
      cgm: "123456",
      schoolId: "school-leopoldina",
      schoolInep: "41042730",
      totalMessages: 5,
      totalMinutes: 2,
      totalJustifications: 1,
      emittedAtIso: "2026-11-05T12:00:00.000Z",
      emittedByEmail: "pedagoga@escola.pr.gov.br",
    });
    expect(dossierSeal1).toBe(dossierSeal2);

    // Se qualquer dado mudar, o código pericial muda
    const modifiedSeal = computeDossierIntegritySeal({
      studentId: "student-123",
      studentName: "João da Silva",
      cgm: "123456",
      schoolId: "school-leopoldina",
      schoolInep: "41042730",
      totalMessages: 6, // 1 mensagem a mais
      totalMinutes: 2,
      totalJustifications: 1,
      emittedAtIso: "2026-11-05T12:00:00.000Z",
      emittedByEmail: "pedagoga@escola.pr.gov.br",
    });
    expect(modifiedSeal).not.toBe(dossierSeal1);
  });
});
