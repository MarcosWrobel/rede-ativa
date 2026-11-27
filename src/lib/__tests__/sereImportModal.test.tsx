import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  mountReactComponent,
  findElements,
  extractNodeText,
} from "./helpers/reactNodeHarness";
import SereImportModal from "@/app/alunos/SereImportModal";

vi.mock("@/components/ModalDialog", () => ({
  default: ({
    children,
    open,
    title,
  }: {
    children: React.ReactNode;
    open: boolean;
    title?: string;
  }) =>
    open
      ? React.createElement(
          "div",
          { "data-testid": "modal" },
          title ? React.createElement("h2", null, title) : null,
          children
        )
      : null,
}));

function makeSereCsvFile(csvText: string, fileName = "noite.csv"): File {
  const bytes = new TextEncoder().encode(csvText);
  return {
    name: fileName,
    size: bytes.byteLength,
    type: "text/csv",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

const NIGHT_SERE_CSV = [
  ",,GOVERNO DO ESTADO DO PARANÁ,,,,,,,,,,,,Data: 27/11/2026,,,,,",
  ',,"ESCOLA TESTE",,,,,,,,,,,,2026,,,,,',
  ",RELAÇÃO DE ALUNOS POR TURMA,,,,,,,,,,,,,,,,,,",
  ",,Curso: ENSINO MEDIO,,,,Seriação: 1ª Série,,,,,,,Turno: Noite,,,Turma: 3 ,,,",
  ",,1,9100000001,ALUNO UNICO EM COMUM,10/01/2009,,17,M,(41)99999-0001,,,,,Matriculado,,01/02/2026,,",
].join("\n");

describe("SereImportModal (Montado) — Rascunho de Criação, Limpeza e 409", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const existingClassGroups = [
    { id: "cg-1-1-manha", name: "1º 1", segment: "MEDIO", shift: "MANHA" },
    { id: "cg-1-2-noite", name: "1º 2", segment: "NOTURNO", shift: "NOITE" },
  ];
  const existingStudents = [
    { cgm: "9100000001", classGroupId: "cg-1-2-noite" },
  ];

  async function uploadCsvIntoMounted(
    mounted: ReturnType<typeof mountReactComponent<React.ComponentProps<typeof SereImportModal>>>
  ) {
    const fileInput = findElements(
      mounted.getTree(),
      (el) => el.type === "input" && el.props.id === "sere-csv-upload"
    )[0];
    expect(fileInput).toBeDefined();

    const file = makeSereCsvFile(NIGHT_SERE_CSV);
    await (fileInput.props.onChange as (e: unknown) => Promise<void>)({
      target: { files: [file], value: "noite.csv" },
    });
    await mounted.flush();
  }

  function findSubmitButton(
    mounted: ReturnType<typeof mountReactComponent<React.ComponentProps<typeof SereImportModal>>>
  ) {
    return findElements(
      mounted.getTree(),
      (el) =>
        el.type === "button" &&
        extractNodeText(el).includes("Confirmar Importação")
    )[0];
  }

  function findTargetSelect(
    mounted: ReturnType<typeof mountReactComponent<React.ComponentProps<typeof SereImportModal>>>
  ) {
    return findElements(
      mounted.getTree(),
      (el) =>
        el.type === "select" &&
        typeof el.props["aria-label"] === "string" &&
        (el.props["aria-label"] as string).startsWith("Vincular turma existente para")
    )[0];
  }

  function findTurmaNameInput(
    mounted: ReturnType<typeof mountReactComponent<React.ComponentProps<typeof SereImportModal>>>
  ) {
    return findElements(
      mounted.getTree(),
      (el) =>
        el.type === "input" &&
        el.props.type === "text" &&
        typeof el.props["aria-label"] === "string" &&
        (el.props["aria-label"] as string).startsWith("Nome da turma para")
    )[0];
  }

  it("selecionar turma diurna -> limpar -> criar nova preserva rascunho noturno e envia confirmCreateNew: true sem targetClassGroupId", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        summary: {
          turmasCreated: 1,
          turmasUpdated: 0,
          createdCount: 0,
          updatedCount: 1,
          movedTurmaCount: 1,
          reactivatedCount: 0,
          cgmsBound: 0,
          skippedExistingCount: 0,
          deactivatedTransferredCount: 0,
          missingPhoneImportedCount: 0,
        },
        students: [],
        classGroups: existingClassGroups,
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mounted = mountReactComponent(SereImportModal, {
      open: true,
      onClose: () => {},
      existingClassGroups,
      existingStudents,
      onImportComplete: () => {},
    });

    await uploadCsvIntoMounted(mounted);

    // Linha ambígua inicia bloqueada
    expect(findSubmitButton(mounted).props.disabled).toBe(true);

    // Operador personaliza o rascunho de criação antes de selecionar destino
    const nameInputBefore = findTurmaNameInput(mounted);
    expect(nameInputBefore.props.value).toBe("1º 3");
    (nameInputBefore.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "1º 3 Noturno Especial" },
    });
    await mounted.flush();

    // Seleciona turma existente diurna (1º 1 MANHA)
    (findTargetSelect(mounted).props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "cg-1-1-manha" },
    });
    await mounted.flush();
    expect(findTurmaNameInput(mounted).props.value).toBe("1º 1");

    // Limpa a escolha ("") -> volta a bloquear e restaura rascunho noturno
    (findTargetSelect(mounted).props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "" },
    });
    await mounted.flush();
    expect(findSubmitButton(mounted).props.disabled).toBe(true);
    expect(findTurmaNameInput(mounted).props.value).toBe("1º 3 Noturno Especial");

    // Escolhe "Criar nova turma" -> desbloqueia e envia payload com rascunho noturno
    (findTargetSelect(mounted).props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "__CREATE_NEW__" },
    });
    await mounted.flush();
    expect(findSubmitButton(mounted).props.disabled).toBe(false);

    await (findSubmitButton(mounted).props.onClick as () => Promise<void>)();
    await mounted.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bodySent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(bodySent.turmas).toHaveLength(1);
    expect(bodySent.turmas[0]).toMatchObject({
      name: "1º 3 Noturno Especial",
      segment: "NOTURNO",
      shift: "NOITE",
      confirmCreateNew: true,
    });
    expect(bodySent.turmas[0].targetClassGroupId).toBeUndefined();

    mounted.unmount();
  });

  it("selecionar turma diurna -> receber 409 AMBIGUOUS_CLASS_GROUP -> criar nova limpa destino herdado, rebloqueia e envia rascunho noturno", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Existem turmas com correspondência ambígua na escola.",
          code: "AMBIGUOUS_CLASS_GROUP",
          ambiguousTurmas: [{ tempId: "sere-turma-1" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          summary: {
            turmasCreated: 1,
            turmasUpdated: 0,
            createdCount: 0,
            updatedCount: 1,
            movedTurmaCount: 1,
            reactivatedCount: 0,
            cgmsBound: 0,
            skippedExistingCount: 0,
            deactivatedTransferredCount: 0,
            missingPhoneImportedCount: 0,
          },
          students: [],
          classGroups: existingClassGroups,
        }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mounted = mountReactComponent(SereImportModal, {
      open: true,
      onClose: () => {},
      existingClassGroups,
      existingStudents,
      onImportComplete: () => {},
    });

    await uploadCsvIntoMounted(mounted);

    // Seleciona destino diurno e submete -> recebe 409
    (findTargetSelect(mounted).props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "cg-1-1-manha" },
    });
    await mounted.flush();
    await (findSubmitButton(mounted).props.onClick as () => Promise<void>)();
    await mounted.flush();

    // Após 409: decisão reaberta, botão bloqueado e rascunho noturno restaurado (não "1º 1" MANHA)
    expect(findSubmitButton(mounted).props.disabled).toBe(true);
    expect(findTurmaNameInput(mounted).props.value).toBe("1º 3");
    expect(findTargetSelect(mounted).props.value).toBe("");

    // Escolhe "Criar nova turma" e reenvia
    (findTargetSelect(mounted).props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "__CREATE_NEW__" },
    });
    await mounted.flush();
    expect(findSubmitButton(mounted).props.disabled).toBe(false);

    await (findSubmitButton(mounted).props.onClick as () => Promise<void>)();
    await mounted.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.turmas[0]).toMatchObject({
      name: "1º 3",
      segment: "NOTURNO",
      shift: "NOITE",
      confirmCreateNew: true,
    });
    expect(secondBody.turmas[0].targetClassGroupId).toBeUndefined();

    mounted.unmount();
  });
});
