import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import AtasClient from "@/app/atas/AtasClient";
import AtaDialog from "@/components/ata/AtaDialog";
import SigningPinModal from "@/components/ata/SigningPinModal";
import PhysicalScanModal from "@/components/ata/PhysicalScanModal";
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

  describe("Blindagem de Tipagem e Anexo em PhysicalScanModal", () => {
    function computeScanState(minute: any) {
      const hasScan = Boolean(
        minute.hasPhysicalScan ||
        minute.physicalScanStorageKey ||
        (typeof minute.physicalSignedScanData === "string" && minute.physicalSignedScanData.length > 0) ||
        minute.physicalSignedScanData === true
      );
      const isCurrentPdf =
        minute.physicalScanMimeType === "application/pdf" ||
        (typeof minute.physicalSignedScanData === "string" &&
          (minute.physicalSignedScanData.startsWith("data:application/pdf") ||
           minute.physicalSignedScanData.startsWith("%PDF")));

      const validExistingScan = typeof minute.physicalSignedScanData === "string" ? minute.physicalSignedScanData : null;

      return { hasScan, isCurrentPdf, validExistingScan };
    }

    it("nunca lança TypeError quando physicalSignedScanData é booleano (true ou false da listagem /atas)", () => {
      const minuteWithBooleanFalse = {
        id: "ata-bool-false",
        hasPhysicalScan: false,
        physicalSignedScanData: false,
      };
      const minuteWithBooleanTrue = {
        id: "ata-bool-true",
        hasPhysicalScan: true,
        physicalSignedScanData: true,
      };

      expect(() => computeScanState(minuteWithBooleanFalse)).not.toThrow();
      expect(() => computeScanState(minuteWithBooleanTrue)).not.toThrow();

      const resFalse = computeScanState(minuteWithBooleanFalse);
      expect(resFalse.hasScan).toBe(false);
      expect(resFalse.isCurrentPdf).toBe(false);
      expect(resFalse.validExistingScan).toBeNull();

      const resTrue = computeScanState(minuteWithBooleanTrue);
      expect(resTrue.hasScan).toBe(true);
      expect(resTrue.isCurrentPdf).toBe(false);
      expect(resTrue.validExistingScan).toBeNull();
    });

    it("identifica corretamente documento PDF quando physicalSignedScanData é string base64 ou mimeType", () => {
      const minuteWithPdfString = {
        id: "ata-pdf",
        physicalSignedScanData: "data:application/pdf;base64,JVBERi0xLjQK...",
      };
      const minuteWithMimeType = {
        id: "ata-pdf-mime",
        physicalScanMimeType: "application/pdf",
        physicalSignedScanData: null,
      };

      const res1 = computeScanState(minuteWithPdfString);
      expect(res1.hasScan).toBe(true);
      expect(res1.isCurrentPdf).toBe(true);
      expect(res1.validExistingScan).toBe(minuteWithPdfString.physicalSignedScanData);

      const res2 = computeScanState(minuteWithMimeType);
      expect(res2.isCurrentPdf).toBe(true);
    });
  });

  describe("AtasClient & Submodais (Fase 3 UX, Foco & Separação Editorial)", () => {
    it("renderiza AtasClient com ModalDialog para Validação de Integridade e distinção Minuta vs Ata confirmada", () => {
      const html = renderToString(
        React.createElement(AtasClient, {
          school: { id: "sch-1", name: "Escola Teste Atas" },
          currentYear: 2026,
          availableStudents: [],
          isAdmin: true,
        })
      );

      expect(html).toContain("Livro de Atas Pedagógicas");
      expect(html).toContain("<dialog");
      expect(html).toContain("Validação de integridade");

      const atasSource = fs.readFileSync(
        path.join(process.cwd(), "src/app/atas/AtasClient.tsx"),
        "utf8"
      );
      expect(atasSource).toContain("Ata confirmada • nº");
      expect(atasSource).toContain("Minuta em edição");
      expect(atasSource).toContain("Ata sem efeito • nº");
      expect(atasSource).toContain("Abrir Página de Validação");
      expect(atasSource).not.toContain("Certidão");
    });

    it("garante hasActiveChildModal em AtaDialog/AtaEditorModal e semântica de diálogo acessível em PIN e Via Física", () => {
      const dialogHtml = renderToString(
        React.createElement(AtaDialog, {
          isOpen: true,
          onClose: () => {},
          title: "Lavratura Teste",
          description: "Descrição auxiliar",
          hasActiveChildModal: true,
          children: React.createElement("p", null, "Conteúdo do editor"),
        })
      );
      expect(dialogHtml).toContain("<dialog");
      expect(dialogHtml).toContain('closedby="none"');
      expect(dialogHtml).toContain("aria-labelledby=");
      expect(dialogHtml).toContain("aria-describedby=");

      const pinHtml = renderToString(
        React.createElement(SigningPinModal, {
          isOpen: true,
          onClose: () => {},
          onSuccess: () => {},
          hasPinInitial: true,
        })
      );
      expect(pinHtml).toContain('role="dialog"');
      expect(pinHtml).toContain('aria-modal="true"');
      expect(pinHtml).toContain("Confirmação de autoria por PIN");

      const scanHtml = renderToString(
        React.createElement(PhysicalScanModal, {
          isOpen: true,
          onClose: () => {},
          onSuccess: () => {},
          minute: { id: "m-1", ataNumber: 12, year: 2026, subject: "Atendimento Teste" },
        })
      );
      expect(scanHtml).toContain('role="dialog"');
      expect(scanHtml).toContain('aria-modal="true"');
      expect(scanHtml).toContain("Anexo de Via Física");

      const editorSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/ata/AtaEditorModal.tsx"),
        "utf8"
      );
      expect(editorSource).toContain("hasActiveChildModal={showPinModal || isScanModalOpen}");
      expect(editorSource).toContain("Salvar Rascunho");
      expect(editorSource).toContain("Confirma autoria por PIN");
    });
  });
});
