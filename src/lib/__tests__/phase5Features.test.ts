import { describe, it, expect } from "vitest";
import { formatMessage } from "../messageFormatter";
import { DEFAULT_SCHOOL } from "../currentSchool";

describe("Fase 5: Escala & Expansão (PWA, Multi-Escola & Boletim)", () => {
  it("deve conter dados padrão válidos para o Colégio Leopoldina (INEP 41042730)", () => {
    expect(DEFAULT_SCHOOL.inepCode).toBe("41042730");
    expect(DEFAULT_SCHOOL.name).toContain("Leopoldina");
    expect(DEFAULT_SCHOOL.city).toBe("Ponta Grossa");
    expect(DEFAULT_SCHOOL.state).toBe("PR");
    expect(DEFAULT_SCHOOL.nre).toBe("Ponta Grossa");
  });

  it("deve interpolar {escola} e {nre} em modelos de mensagem institucionais", () => {
    const prefix = "Comunicado do {escola} ({nre}):";
    const suffix = "Atenciosamente, Direção.";
    const formatted = formatMessage(prefix, suffix, {
      student: {
        name: "Carlos Eduardo",
        classGroup: { name: "1º Ano A", segment: "MEDIO", shift: "MANHA" },
      },
      schoolName: "Colégio Estadual Leopoldina B. Pedroso",
      nre: "NRE Ponta Grossa",
    });

    expect(formatted).toContain("Colégio Estadual Leopoldina B. Pedroso");
    expect(formatted).toContain("NRE Ponta Grossa");
    expect(formatted).toContain("Carlos Eduardo");
  });

  it("deve usar o fallback de escola padrão caso não informado no contexto", () => {
    const prefix = "Aviso do {escola}:";
    const formatted = formatMessage(prefix, "", {
      student: {
        name: "Mariana Silva",
        classGroup: { name: "6º 1", segment: "FUNDAMENTAL", shift: "TARDE" },
      },
    });

    expect(formatted).toContain("Colégio Estadual Leopoldina B. Pedroso");
  });
});
