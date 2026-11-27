import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import SereImportModal, {
  buildInitialTurmaPreviewState,
  applyTurmaTargetSelection,
  reopenAmbiguousTurmasFrom409,
  isTurmaAmbiguousUnresolved,
} from "@/app/alunos/SereImportModal";
import { parseSereFiles, consolidateSelectedStudents } from "@/lib/sereParser";

vi.mock("@/components/ModalDialog", () => ({
  default: ({ children, open, title }: { children: React.ReactNode; open: boolean; title?: string }) =>
    open ? React.createElement("div", { "data-testid": "modal" }, title ? React.createElement("h2", null, title) : null, children) : null,
}));

describe("SereImportModal — Prévia, Ambiguidade e Seleção Explícita", () => {
  it("renderiza o modal sem erros em SSR", () => {
    const html = renderToString(
      React.createElement(SereImportModal, {
        open: true,
        onClose: () => {},
        existingClassGroups: [
          { id: "cg-1", name: "1º 2", segment: "NOTURNO", shift: "NOITE" },
        ],
        existingStudents: [],
        onImportComplete: () => {},
      })
    );
    expect(html).toContain("Importação em Lote de Alunos (SERE)");
  });

  it("1º 3 com único CGM em comum em 1º 2 (mesmo turno e série) exige escolha explícita, não preenche ID automático e rebloqueia se escolha for limpa", () => {
    const csv = [
      ",,GOVERNO DO ESTADO DO PARANÁ,,,,,,,,,,,,Data: 27/11/2026,,,,,",
      ',,"ESCOLA TESTE",,,,,,,,,,,,2026,,,,,',
      ",RELAÇÃO DE ALUNOS POR TURMA,,,,,,,,,,,,,,,,,,",
      ",,Curso: ENSINO MEDIO,,,,Seriação: 1ª Série,,,,,,,Turno: Noite,,,Turma: 3 ,,,",
      ",,1,9100000001,ALUNO UNICO EM COMUM,10/01/2009,,17,M,(41)99999-0001,,,,,Matriculado,,01/02/2026,,",
    ].join("\n");

    const parsed = parseSereFiles([{ fileName: "noite.csv", content: csv }]);
    expect(parsed.turmas[0].suggestedName).toBe("1º 3");

    const existingClassGroups = [
      { id: "cg-1-2-noite", name: "1º 2", segment: "NOTURNO", shift: "NOITE" },
    ];
    const existingStudentsByCgm = new Map([
      ["9100000001", { classGroupId: "cg-1-2-noite" }],
    ]);

    const initial = buildInitialTurmaPreviewState({
      parsed,
      existingClassGroups,
      existingStudentsByCgm,
    });
    const tempId = parsed.turmas[0].tempId;

    // Prévia mantém targetClassGroupId e confirmCreateNew sem definição e bloqueia envio
    expect(initial.ambiguousLineIds.has(tempId)).toBe(true);
    expect(initial.configs[tempId].targetClassGroupId).toBeUndefined();
    expect(initial.configs[tempId].confirmCreateNew).toBeUndefined();
    expect(isTurmaAmbiguousUnresolved(tempId, initial.configs[tempId], initial.ambiguousLineIds)).toBe(true);

    const payloadBeforeChoice = consolidateSelectedStudents(parsed, initial.configs, {
      includeSemFrequencia: true,
      includeConcluinte: true,
    });
    expect(payloadBeforeChoice.turmasToImport[0].targetClassGroupId).toBeUndefined();
    expect(payloadBeforeChoice.turmasToImport[0].confirmCreateNew).toBeUndefined();

    // Operador escolhe "Criar nova turma" -> desbloqueia e inclui confirmCreateNew: true
    const afterCreateNew = applyTurmaTargetSelection({
      prevConfigs: initial.configs,
      tempId,
      rawValue: "__CREATE_NEW__",
      existingClassGroups,
    });
    expect(isTurmaAmbiguousUnresolved(tempId, afterCreateNew[tempId], initial.ambiguousLineIds)).toBe(false);
    const payloadCreateNew = consolidateSelectedStudents(parsed, afterCreateNew, {
      includeSemFrequencia: true,
      includeConcluinte: true,
    });
    expect(payloadCreateNew.turmasToImport[0].confirmCreateNew).toBe(true);
    expect(payloadCreateNew.turmasToImport[0].targetClassGroupId).toBeUndefined();

    // Se operador limpar a escolha (""), volta a bloquear a linha ambígua
    const afterClear = applyTurmaTargetSelection({
      prevConfigs: afterCreateNew,
      tempId,
      rawValue: "",
      existingClassGroups,
    });
    expect(afterClear[tempId].targetClassGroupId).toBeUndefined();
    expect(afterClear[tempId].confirmCreateNew).toBeUndefined();
    expect(isTurmaAmbiguousUnresolved(tempId, afterClear[tempId], initial.ambiguousLineIds)).toBe(true);
  });

  it("nomes iguais com turnos diferentes (1º 1 MANHA vs NOITE) não usa fallback pelo nome e reabre decisão após 409 AMBIGUOUS_CLASS_GROUP", () => {
    const csv = [
      ",,GOVERNO DO ESTADO DO PARANÁ,,,,,,,,,,,,Data: 27/11/2026,,,,,",
      ',,"ESCOLA TESTE",,,,,,,,,,,,2026,,,,,',
      ",RELAÇÃO DE ALUNOS POR TURMA,,,,,,,,,,,,,,,,,,",
      ",,Curso: ENSINO MEDIO,,,,Seriação: 1ª Série,,,,,,,Turno: Noite,,,Turma: 1 ,,,",
      ",,1,9200000001,ALUNO TURNO DIVERGENTE,10/01/2009,,17,M,(41)99999-0002,,,,,Matriculado,,01/02/2026,,",
    ].join("\n");

    const parsed = parseSereFiles([{ fileName: "noite_1.csv", content: csv }]);
    const tempId = parsed.turmas[0].tempId;
    const existingClassGroups = [
      { id: "cg-1-1-manha", name: "1º 1", segment: "MEDIO", shift: "MANHA" },
    ];

    const initial = buildInitialTurmaPreviewState({
      parsed,
      existingClassGroups,
      existingStudentsByCgm: new Map(),
    });

    // Não deve preencher targetClassGroupId com a turma da manhã!
    expect(initial.ambiguousLineIds.has(tempId)).toBe(true);
    expect(initial.configs[tempId].targetClassGroupId).toBeUndefined();
    expect(initial.configs[tempId].confirmCreateNew).toBeUndefined();

    // Simula seleção desatualizada que recebe 409 AMBIGUOUS_CLASS_GROUP do servidor -> reabre e limpa
    const staleConfigs = applyTurmaTargetSelection({
      prevConfigs: initial.configs,
      tempId,
      rawValue: "cg-1-1-manha",
      existingClassGroups,
    });
    const reopened = reopenAmbiguousTurmasFrom409({
      prevConfigs: staleConfigs,
      prevAmbiguousIds: new Set(),
      ambiguousTurmas: [{ tempId }],
    });
    expect(reopened.ambiguousLineIds.has(tempId)).toBe(true);
    expect(reopened.configs[tempId].targetClassGroupId).toBeUndefined();
    expect(reopened.configs[tempId].confirmCreateNew).toBeUndefined();
    expect(isTurmaAmbiguousUnresolved(tempId, reopened.configs[tempId], reopened.ambiguousLineIds)).toBe(true);
  });
});
