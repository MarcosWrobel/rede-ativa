import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockRequireAuth = vi.fn();
const mockGetCurrentSchool = vi.fn();
const mockLogAudit = vi.fn();
const mockClassGroupFindUnique = vi.fn();
const mockClassGroupUpdate = vi.fn();

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: (...args: unknown[]) => mockGetCurrentSchool(...args),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

vi.mock("@/lib/prisma", () => {
  let lastUpdatedClassGroup: unknown = null;
  const prismaObj: any = {
    $executeRaw: vi.fn(async () => 0),
    classGroup: {
      findUnique: (...args: unknown[]) => {
        lastUpdatedClassGroup = null;
        return mockClassGroupFindUnique(...args);
      },
      findFirst: (...args: unknown[]) =>
        lastUpdatedClassGroup ?? mockClassGroupFindUnique(...args),
      update: (...args: unknown[]) => mockClassGroupUpdate(...args),
      updateMany: async ({ where, data }: any) => {
        lastUpdatedClassGroup = await mockClassGroupUpdate({ where, data });
        return { count: 1 };
      },
    },
    $transaction: async (arg: any) => (typeof arg === "function" ? arg(prismaObj) : Promise.all(arg)),
  };
  return { prisma: prismaObj };
});

vi.mock("@/components/conselho/CouncilSerePdfImportModal", () => ({
  default: () => null,
}));

vi.mock("@/components/conselho/CouncilHeaderMetadataCard", () => ({
  default: () => React.createElement("div", { "data-testid": "header-metadata-card" }),
}));
vi.mock("@/components/conselho/CouncilSubjectsManagerModal", () => ({
  default: () => null,
}));
vi.mock("@/components/conselho/CouncilAnalysisPanel", () => ({
  default: () => React.createElement("div", { "data-testid": "analysis-panel" }),
}));
vi.mock("@/components/conselho/CouncilPreCouncilTab", () => ({
  default: () => null,
}));
vi.mock("@/components/conselho/CouncilSeatingMapTab", () => ({
  default: () => null,
}));
vi.mock("@/components/conselho/CouncilTrimesterOverviewTab", () => ({
  default: () => null,
}));
vi.mock("@/components/conselho/CouncilPostMeetingTab", () => ({
  default: () => null,
}));
vi.mock("@/components/conselho/CouncilStudentFichaModal", () => ({
  default: () => null,
}));

import { PATCH as patchClassShift } from "@/app/api/classes/[id]/route";
import ConselhoIndexClient from "@/app/conselho-classe/ConselhoIndexClient";
import ConselhoTurmaClient from "@/app/conselho-classe/[boardId]/ConselhoTurmaClient";
import CouncilPreCouncilConversationsView from "@/components/conselho/CouncilPreCouncilConversationsView";
import type { CouncilBoardDetailRecord } from "@/components/conselho/types";

describe("Redesenho do Conselho de Classe (Etapa 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentSchool.mockResolvedValue({ id: "school-a", name: "Escola Teste" });
    mockRequireAuth.mockResolvedValue({
      ok: true,
      schoolId: "school-a",
      user: { id: "u-1", email: "pedagoga@escola.pr.gov.br", role: "PEDAGOGA" },
      session: {
        user: {
          id: "u-1",
          role: "PEDAGOGA",
          schoolId: "school-a",
          schools: [{ schoolId: "school-a", role: "PEDAGOGA" }],
        },
      },
    });
  });

  describe("PATCH /api/classes/[id]", () => {
    it("bloqueia alteração cross-tenant (404) e perfil somente leitura (403)", async () => {
      mockClassGroupFindUnique.mockResolvedValueOnce({
        id: "cg-b",
        schoolId: "school-b",
        name: "1º 2",
        segment: "MEDIO",
        shift: "MANHA",
      });

      const resOther = await patchClassShift(
        new Request("http://localhost/api/classes/cg-b", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shift: "TARDE" }),
        }),
        { params: Promise.resolve({ id: "cg-b" }) }
      );
      expect(resOther.status).toBe(404);

      mockRequireAuth.mockResolvedValueOnce({
        ok: true,
        schoolId: "school-a",
        user: { id: "u-2", role: "GESTAO_SECRETARIA" },
        session: {
          user: {
            id: "u-2",
            role: "GESTAO_SECRETARIA",
            schoolId: "school-a",
          },
        },
      });
      mockClassGroupFindUnique.mockResolvedValueOnce({
        id: "cg-a",
        schoolId: "school-a",
        name: "1º 2",
        segment: "MEDIO",
        shift: "MANHA",
      });

      const resForbidden = await patchClassShift(
        new Request("http://localhost/api/classes/cg-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shift: "TARDE" }),
        }),
        { params: Promise.resolve({ id: "cg-a" }) }
      );
      expect(resForbidden.status).toBe(403);
    });

    it("atualiza o turno da turma e registra auditoria com schoolId na raiz", async () => {
      mockClassGroupFindUnique.mockResolvedValueOnce({
        id: "cg-a",
        schoolId: "school-a",
        name: "1º 2",
        segment: "MEDIO",
        shift: "MANHA",
      });
      mockClassGroupUpdate.mockResolvedValueOnce({
        id: "cg-a",
        name: "1º 2",
        segment: "MEDIO",
        shift: "TARDE",
      });

      const res = await patchClassShift(
        new Request("http://localhost/api/classes/cg-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shift: "TARDE" }),
        }),
        { params: Promise.resolve({ id: "cg-a" }) }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.classGroup.shift).toBe("TARDE");
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE_CLASS_GROUP_SHIFT",
          entityId: "cg-a",
          schoolId: "school-a",
        })
      );
    });

    it("[B-01 & C-01] retorna 400 para JSON malformado e 403 para PEDAGOGA sem escola vinculada", async () => {
      mockClassGroupFindUnique.mockResolvedValueOnce({
        id: "cg-a",
        schoolId: "school-a",
        name: "9º Ano A",
        shift: "MANHA",
      });
      const malformedRes = await patchClassShift(
        new Request("http://localhost/api/classes/cg-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "{ invalid-json",
        }),
        { params: Promise.resolve({ id: "cg-a" }) }
      );
      expect(malformedRes.status).toBe(400);

      mockRequireAuth.mockResolvedValueOnce({
        ok: true,
        schoolId: null,
        user: { id: "u-orphan", email: "orphan@escola.pr.gov.br", role: "PEDAGOGA" },
        session: {
          user: {
            id: "u-orphan",
            email: "orphan@escola.pr.gov.br",
            role: "PEDAGOGA",
            schoolId: null,
            schools: [],
          },
        },
      });
      const orphanRes = await patchClassShift(
        new Request("http://localhost/api/classes/cg-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shift: "NOITE" }),
        }),
        { params: Promise.resolve({ id: "cg-a" }) }
      );
      expect(orphanRes.status).toBe(403);
      expect(mockClassGroupUpdate).not.toHaveBeenCalled();
    });
  });

  describe("ConselhoIndexClient", () => {
    const classGroups = [
      {
        id: "cg-1",
        name: "1º 2",
        segment: "MEDIO",
        shift: "MANHA",
        _count: { students: 32 },
      },
      {
        id: "cg-2",
        name: "6º 3",
        segment: "FUNDAMENTAL",
        shift: "TARDE",
        _count: { students: 28 },
      },
    ];
    const boards = [
      {
        id: "board-1",
        schoolId: "school-a",
        classGroupId: "cg-1",
        year: 2026,
        peerLeaderName: null,
        teacherLeaderName: null,
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        classGroup: classGroups[0],
        trimesters: [
          {
            id: "t-1",
            trimester: 1,
            status: "CONSOLIDATED",
            linkedMinuteId: null,
            postCouncilHeldAt: null,
            updatedAt: "2026-11-19T00:00:00.000Z",
          },
        ],
        _count: { subjects: 13, studentCards: 32 },
      },
    ];

    it("renderiza lista compacta com seleção direta por trimestre, seletor de turno e botão Importar SERE", () => {
      const html = renderToString(
        React.createElement(ConselhoIndexClient, {
          initialYear: 2026,
          initialClassGroups: classGroups,
          initialBoards: boards,
          schoolName: "Escola Teste",
          canEdit: true,
        })
      ).replace(/<!-- -->/g, "");

      expect(html).not.toContain("Abrir conselho");
      expect(html).not.toContain("Iniciar conselho");
      expect(html).toContain("1º Trim.");
      expect(html).toContain("2º Trim.");
      expect(html).toContain("3º Trim.");
      expect(html).toContain("Importar SERE");
      expect(html).toContain("Turno da turma 1º 2");
      expect(html).toContain("Turno da turma 6º 3");
    });
  });

  describe("ConselhoTurmaClient", () => {
    const sampleBoard: CouncilBoardDetailRecord = {
      id: "board-1",
      schoolId: "school-a",
      classGroupId: "cg-1",
      year: 2026,
      peerLeaderStudentId: null,
      peerLeaderName: null,
      teacherLeaderStudentId: null,
      teacherLeaderName: null,
      externalEvalEd1Percent: null,
      externalEvalEd2Percent: null,
      externalEvalEd3Percent: null,
      seatingMapMode: "REVEZAMENTO_MENSAL",
      seatingMapNotes: null,
      classGroup: { id: "cg-1", name: "1º 2", segment: "MEDIO", shift: "TARDE" },
      subjects: [],
      trimesters: [
        {
          id: "t-1",
          trimester: 1,
          status: "OPEN",
        },
        {
          id: "t-2",
          trimester: 2,
          status: "OPEN",
        },
      ] as unknown as CouncilBoardDetailRecord["trimesters"],
      studentCards: [],
    };

    it("inicializa no trimestre acessado e exibe marcador de acesso", () => {
      const html = renderToString(
        React.createElement(ConselhoTurmaClient, {
          initialBoard: sampleBoard,
          availableSourceBoards: [],
          canEdit: true,
          initialTrimester: 2,
        })
      ).replace(/<!-- -->/g, "");

      expect(html).toContain("2º Trimestre");
      expect(html).toContain("Acesso");
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain("Painel de Análise");
      expect(html).toContain("Pré-Conselho");
      expect(html).toContain("Mapa de Sala");
      expect(html).toContain("Fichas dos Estudantes");
      expect(html).toContain("Observações da Turma");
      expect(html).toContain("Reunião de Pós-Conselho");
      expect(html).not.toContain('data-testid="analysis-panel"');
    });

    it("habilita controle de ocultar selos de saúde também nas abas students, seating-map e pre-council", async () => {
      const fsMod = await import("node:fs");
      const pathMod = await import("node:path");
      const { default: CouncilHeaderMetadataCard } = await vi.importActual<
        typeof import("@/components/conselho/CouncilHeaderMetadataCard")
      >("@/components/conselho/CouncilHeaderMetadataCard");

      const turmaSource = fsMod.readFileSync(
        pathMod.resolve(
          process.cwd(),
          "src/app/conselho-classe/[boardId]/ConselhoTurmaClient.tsx"
        ),
        "utf8"
      );
      expect(turmaSource).toContain('activeTab === "students"');
      expect(turmaSource).toContain('activeTab === "seating-map"');
      expect(turmaSource).toContain('activeTab === "pre-council"');

      const headerHtml = renderToString(
        React.createElement(CouncilHeaderMetadataCard, {
          board: sampleBoard,
          activeTrimester: 1,
          hideSensitiveTags: false,
          onToggleHideSensitiveTags: vi.fn(),
          onOpenSubjectsModal: vi.fn(),
          showConfigMenu: false,
          showPrintButton: false,
          showSensitiveToggleButton: true,
          onBoardUpdated: vi.fn(),
          onNotify: vi.fn(),
        })
      );
      expect(headerHtml).toContain("Ocultar laudo e AEE");
    });
  });

  describe("CouncilPreCouncilConversationsView", () => {
    it("remove faixa de período/objetivo e coloca ícones de sincronizar/adicionar na linha de filtros", () => {
      const html = renderToString(
        React.createElement(CouncilPreCouncilConversationsView, {
          board: {
            id: "board-1",
            schoolId: "school-a",
            classGroupId: "cg-1",
            year: 2026,
            peerLeaderStudentId: null,
            peerLeaderName: null,
            teacherLeaderStudentId: null,
            teacherLeaderName: null,
            externalEvalEd1Percent: null,
            externalEvalEd2Percent: null,
            externalEvalEd3Percent: null,
            seatingMapMode: "REVEZAMENTO_MENSAL",
            seatingMapNotes: null,
            classGroup: { id: "cg-1", name: "1º 2", segment: "MEDIO", shift: "TARDE" },
            subjects: [],
            trimesters: [],
            studentCards: [],
          },
          activeTrimester: 3,
          draft: {
            version: 1,
            periodLabel: "3º Trimestre",
            objectiveText: "",
            responsiblePedagogueName: "",
            responsiblePedagogueRole: "",
            conversations: [],
            synthesis: {
              mainDifficulties: "",
              priorityStudents: "",
              attendanceIssues: "",
              behaviorIssues: "",
              pedagogicalActions: "",
            },
          },
          selectedConvId: "",
          onSelectConvId: vi.fn(),
          onUpdateDraft: vi.fn(),
          onSyncSubjects: vi.fn(),
          onAddCustomRow: vi.fn(),
          onRemoveConversation: vi.fn(),
          onOpenUnifiedTeacherLink: vi.fn(),
          onMatrixSaved: vi.fn(async () => {}),
          onNotify: vi.fn(),
          alertsBundle: { bySubjectId: {}, lowAttendanceStudents: [] },
          matrixStatsBySubjectId: {},
          hideSensitiveTags: false,
          readOnly: false,
        })
      ).replace(/<!-- -->/g, "");

      expect(html).not.toContain("Período no documento");
      expect(html).not.toContain("Objetivo do documento");
      expect(html).toContain('aria-label="Sincronizar componentes da turma"');
      expect(html).toContain('aria-label="Adicionar componente manual"');
    });
  });
});
