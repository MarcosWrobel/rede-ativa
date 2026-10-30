import { describe, it, expect } from "vitest";
import { generateLocalAtaMinuta, formatAtaDateExtenso } from "../nreAtaFormatter";

describe("Formalização & Revisão de Atas com Diretrizes NRE/SEED-PR", () => {
  it("formata a data de atendimento por extenso com precisão e sem alucinação", () => {
    const d1 = formatAtaDateExtenso("2026-10-30T14:30:00.000-03:00");
    expect(d1.diaExtenso).toBe("trinta");
    expect(d1.mesExtenso).toBe("outubro");
    expect(d1.anoExtenso).toBe("dois mil e vinte e seis");
    expect(d1.dataExtensoCompleta).toBe("Aos trinta dias do mês de outubro do ano de dois mil e vinte e seis");

    const d2 = formatAtaDateExtenso("2026-05-01T09:00:00.000-03:00");
    expect(d2.diaExtenso).toBe("primeiro");
    expect(d2.mesExtenso).toBe("maio");
    expect(d2.dataExtensoCompleta).toBe("Ao primeiro dia do mês de maio do ano de dois mil e vinte e seis");
  });

  it("gera texto corrido contínuo no pretérito perfeito com cláusula de fechamento do NRE", () => {
    const res = generateLocalAtaMinuta({
      rawNotes: "Mãe compareceu para justificar ausências por motivo de saúde e trouxe atestado médico",
      category: "BUSCA_ATIVA_FALTAS",
      studentNames: ["Gabriel Silva"],
      guardianNames: ["Rosana Silva"],
      attendedAt: "2026-10-30T10:00:00.000-03:00",
    });

    expect(res.formalSubject).toContain("Atendimento Pedagógico");
    // Verifica abertura canônica com data real por extenso
    expect(res.formalSummary).toContain("Aos trinta dias do mês de outubro do ano de dois mil e vinte e seis");
    // Verifica ausência de quebras de linha duplas / entrelinhas
    expect(res.formalSummary).not.toContain("\n\n");
    // Verifica pretérito perfeito
    expect(res.formalSummary).toContain("realizou-se");
    expect(res.formalSummary).toContain("tomou ciência");
    // Verifica cláusula de encerramento e ciência do NRE
    expect(res.formalSummary).toContain("lida e conferida por todos os presentes");
    expect(res.formalSummary).toContain("apuseram sua ciência e assinatura");
  });

  it("revisa e preserva texto formal pré-existente da pedagoga aplicando as regras do NRE", () => {
    const existingSummary = "A mãe esteve presente na escola e combinou que o aluno trará as tarefas amanhã.";
    const res = generateLocalAtaMinuta({
      rawNotes: "",
      existingSummary,
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      studentNames: ["Gabriel Silva"],
      guardianNames: ["Rosana Silva"],
    });

    // Mantém o núcleo da edição manual da pedagoga
    expect(res.formalSummary).toContain("A mãe esteve presente na escola");
    expect(res.formalSummary).toContain("aluno trará as tarefas amanhã");
    // Acrescenta a cláusula de ciência requerida pelo NRE
    expect(res.formalSummary).toContain("lida e conferida");
  });
});
