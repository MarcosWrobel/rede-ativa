import { describe, it, expect } from "vitest";
import { generateLocalAtaMinuta } from "../nreAtaFormatter";

describe("Formalização & Revisão de Atas com Diretrizes NRE/SEED-PR", () => {
  it("gera texto corrido contínuo no pretérito perfeito com cláusula de fechamento do NRE", () => {
    const res = generateLocalAtaMinuta({
      rawNotes: "Mãe compareceu para justificar ausências por motivo de saúde e trouxe atestado médico",
      category: "BUSCA_ATIVA_FALTAS",
      studentNames: ["Gabriel Silva"],
      guardianNames: ["Rosana Silva"],
    });

    expect(res.formalSubject).toContain("Atendimento Pedagógico");
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
