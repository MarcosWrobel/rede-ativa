import { describe, it, expect } from "vitest";
import {
  numberToPortugueseWords,
  formatFormalOpeningDate,
  formatFormalClosingDate,
} from "@/app/atas/livro/[ano]/LivroAnualClient";

describe("Atas Usability & Archival: Livro Anual & Filtros de Arquivo", () => {
  describe("numberToPortugueseWords (Concordância Feminina com 'Ata')", () => {
    it("converte corretamente números básicos e singulares", () => {
      expect(numberToPortugueseWords(0)).toBe("zero");
      expect(numberToPortugueseWords(1)).toBe("uma");
      expect(numberToPortugueseWords(2)).toBe("duas");
      expect(numberToPortugueseWords(3)).toBe("três");
      expect(numberToPortugueseWords(7)).toBe("sete");
      expect(numberToPortugueseWords(9)).toBe("nove");
    });

    it("converte dezenas e números de 10 a 19", () => {
      expect(numberToPortugueseWords(10)).toBe("dez");
      expect(numberToPortugueseWords(11)).toBe("onze");
      expect(numberToPortugueseWords(14)).toBe("quatorze");
      expect(numberToPortugueseWords(19)).toBe("dezenove");
      expect(numberToPortugueseWords(20)).toBe("vinte");
      expect(numberToPortugueseWords(30)).toBe("trinta");
      expect(numberToPortugueseWords(50)).toBe("cinquenta");
    });

    it("converte números compostos respeitando o gênero feminino", () => {
      expect(numberToPortugueseWords(21)).toBe("vinte e uma");
      expect(numberToPortugueseWords(22)).toBe("vinte e duas");
      expect(numberToPortugueseWords(35)).toBe("trinta e cinco");
      expect(numberToPortugueseWords(42)).toBe("quarenta e duas");
      expect(numberToPortugueseWords(99)).toBe("noventa e nove");
    });

    it("converte centenas respeitando o gênero feminino", () => {
      expect(numberToPortugueseWords(100)).toBe("cem");
      expect(numberToPortugueseWords(101)).toBe("cento e uma");
      expect(numberToPortugueseWords(102)).toBe("cento e duas");
      expect(numberToPortugueseWords(142)).toBe("cento e quarenta e duas");
      expect(numberToPortugueseWords(200)).toBe("duzentas");
      expect(numberToPortugueseWords(242)).toBe("duzentas e quarenta e duas");
      expect(numberToPortugueseWords(315)).toBe("trezentas e quinze");
      expect(numberToPortugueseWords(500)).toBe("quinhentas");
      expect(numberToPortugueseWords(999)).toBe("novecentas e noventa e nove");
    });
  });

  describe("Formatação Formal de Datas para Termos de Abertura e Encerramento", () => {
    it("formata a data de abertura por extenso canônico em português", () => {
      const formatted = formatFormalOpeningDate("2026-02-05", 2026);
      expect(formatted).toBe("Aos 05 dias do mês de fevereiro de 2026");
    });

    it("utiliza fallback seguro se a data de abertura for vazia", () => {
      const formatted = formatFormalOpeningDate("", 2026);
      expect(formatted).toBe("Aos 02 dias do mês de fevereiro de 2026");
    });

    it("formata a data de encerramento por extenso canônico em português", () => {
      const formatted = formatFormalClosingDate("2026-12-18", 2026);
      expect(formatted).toBe("Aos 18 dias do mês de dezembro de 2026");
    });

    it("utiliza fallback seguro se a data de encerramento for vazia", () => {
      const formatted = formatFormalClosingDate("", 2026);
      expect(formatted).toBe("Aos 22 dias do mês de dezembro de 2026");
    });
  });

  describe("Lógica do Filtro de Arquivamento Físico de Atas (AtasClient)", () => {
    const sampleMinutes = [
      {
        id: "ata-1",
        status: "FINALIZED",
        hasPhysicalScan: true,
        physicalSignedScanData: "data:image/png;base64,...",
        govBrVerified: false,
      },
      {
        id: "ata-2",
        status: "FINALIZED",
        hasPhysicalScan: false,
        physicalSignedScanData: null,
        govBrVerified: true,
        govBrProtocol: "ITI-12345",
      },
      {
        id: "ata-3",
        status: "FINALIZED",
        hasPhysicalScan: false,
        physicalSignedScanData: null,
        govBrVerified: false,
      },
      {
        id: "ata-4",
        status: "DRAFT",
        hasPhysicalScan: false,
        physicalSignedScanData: null,
        govBrVerified: false,
      },
    ];

    it("filtra atas com via física ou Gov.br (ATTACHED)", () => {
      const attached = sampleMinutes.filter(
        (m) => Boolean(m.hasPhysicalScan || m.physicalSignedScanData || m.govBrVerified)
      );
      expect(attached.length).toBe(2);
      expect(attached.map((m) => m.id)).toEqual(["ata-1", "ata-2"]);
    });

    it("filtra atas lavradas pendentes de anexo físico (PENDING)", () => {
      const pending = sampleMinutes.filter(
        (m) =>
          m.status === "FINALIZED" &&
          !m.hasPhysicalScan &&
          !m.physicalSignedScanData &&
          !m.govBrVerified
      );
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe("ata-3");
      // Ata-4 (DRAFT) não entra nas pendências de lavratura
    });

    it("retorna todas as atas quando filtro é ALL", () => {
      const all = sampleMinutes;
      expect(all.length).toBe(4);
    });
  });
});
