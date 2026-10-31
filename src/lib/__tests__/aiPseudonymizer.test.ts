import { describe, it, expect } from "vitest";
import { createAiPseudonymizer } from "../aiPseudonymizer";

describe("createAiPseudonymizer (LGPD & ECA)", () => {
  it("mascara e desmascara nomes de estudantes e responsáveis corretamente", () => {
    const studentNames = ["Lucas Gabriel da Silva", "Ana Clara"];
    const guardianNames = ["Maria Aparecida da Silva"];

    const pseudonymizer = createAiPseudonymizer(studentNames, guardianNames);

    expect(pseudonymizer.maskedStudentNames).toEqual(["[ESTUDANTE_1]", "[ESTUDANTE_2]"]);
    expect(pseudonymizer.maskedGuardianNames).toEqual(["[RESPONSAVEL_1]"]);

    const rawText = "Compareceu a mãe Maria Aparecida da Silva para tratar do aluno Lucas Gabriel da Silva e Ana Clara.";
    const masked = pseudonymizer.maskText(rawText);

    expect(masked).not.toContain("Lucas Gabriel da Silva");
    expect(masked).not.toContain("Maria Aparecida da Silva");
    expect(masked).toContain("[ESTUDANTE_1]");
    expect(masked).toContain("[RESPONSAVEL_1]");
    expect(masked).toContain("[ESTUDANTE_2]");

    const restored = pseudonymizer.unmaskText(masked);
    expect(restored).toBe(rawText);
  });

  it("mascara documentos, telefones e e-mails sensíveis para proteção LGPD", () => {
    const pseudonymizer = createAiPseudonymizer(["Pedro Santos"], []);
    const input = "O estudante Pedro Santos, CPF 123.456.789-00, telefone (42) 99888-7766, email responsavel@gmail.com compareceu.";
    const masked = pseudonymizer.maskText(input);

    expect(masked).not.toContain("Pedro Santos");
    expect(masked).not.toContain("123.456.789-00");
    expect(masked).not.toContain("99888-7766");
    expect(masked).not.toContain("responsavel@gmail.com");

    expect(masked).toContain("[ESTUDANTE_1]");
    expect(masked).toContain("[DOCUMENTO_SIGILOSO]");
    expect(masked).toContain("[TELEFONE_SIGILOSO]");
    expect(masked).toContain("[EMAIL_SIGILOSO]");

    const unmasked = pseudonymizer.unmaskText(masked);
    expect(unmasked).toContain("Pedro Santos");
  });

  it("lida com listas vazias e strings nulas sem falhar", () => {
    const pseudonymizer = createAiPseudonymizer([], []);
    expect(pseudonymizer.maskText("Texto normal sem nomes")).toBe("Texto normal sem nomes");
    expect(pseudonymizer.unmaskText("Outro texto")).toBe("Outro texto");
  });
});
