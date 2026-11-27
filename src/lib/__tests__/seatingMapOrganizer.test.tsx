import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";

const hoisted = vi.hoisted(() => {
  const db = {
    boards: [] as any[],
    classGroups: [] as any[],
    students: [] as any[],
    subjects: [] as any[],
    trimesters: [] as any[],
    cards: [] as any[],
  };

  return {
    session: null as any,
    currentSchool: {
      id: "school-a",
      inepCode: "41000011",
      name: "Escola Estadual Alpha",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
      edition: "INSTITUCIONAL_ESSENCIAL" as const,
    },
    db,
    auditCalls: [] as any[],
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("@/lib/currentSchool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currentSchool")>("@/lib/currentSchool");
  return {
    ...actual,
    getCurrentSchool: vi.fn(async () => hoisted.currentSchool),
    getAuthorizedCurrentSchool: vi.fn(async (session?: {
      user?: {
        role?: string;
        active?: boolean;
        schoolId?: string | null;
        schools?: Array<{ schoolId?: string | null; active?: boolean }>;
        networks?: string[];
      };
    } | null, explicitSchoolId?: string | null) => {
      const user = session?.user;
      const school = hoisted.currentSchool as (typeof hoisted.currentSchool & { networkId?: string | null }) | null;
      if (!user || user.active === false || !school) return null;
      if (explicitSchoolId && explicitSchoolId !== school.id && user.role !== "SUPERADMIN") {
        // Defer cross-school explicit checks to callers unless school itself matches
        const inSchools = Array.isArray(user.schools)
          ? user.schools.some((s) => s?.schoolId === explicitSchoolId && s?.active !== false)
          : false;
        if (!inSchools && user.schoolId !== explicitSchoolId) return null;
      }
      if (user.role === "SUPERADMIN") return school;
      if (user.schoolId && user.schoolId === school.id) return school;
      if (Array.isArray(user.schools) && user.schools.some((s) => s?.schoolId === school.id && s?.active !== false)) {
        return school;
      }
      if (
        user.role === "GESTAO_SECRETARIA" &&
        Array.isArray(user.networks) &&
        user.networks.length > 0 &&
        (!school.networkId || user.networks.includes(school.networkId))
      ) {
        return school;
      }
      return null;
    }),
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (entry: any) => {
    hoisted.auditCalls.push(entry);
  }),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/prisma", () => {
  const hydrateBoard = (b: any) => {
    const cg = hoisted.db.classGroups.find((c) => c.id === b.classGroupId) || null;
    const subjects = hoisted.db.subjects.filter((s) => s.boardId === b.id);
    const trimesters = hoisted.db.trimesters.filter((t) => t.boardId === b.id);
    const studentCards = hoisted.db.cards
      .filter((c) => c.boardId === b.id)
      .map((c) => {
        const st = hoisted.db.students.find((s) => s.id === c.studentId) || null;
        return {
          ...c,
          student: st
            ? {
                id: st.id,
                name: st.name,
                cgm: st.cgm ?? null,
                active: st.active ?? true,
                isSpecialNeeds: false,
                isExchangeStudent: false,
                age: 14,
                lowAttendanceRecord: st.lowAttendanceRecord ?? null,
              }
            : null,
          subjectEntries: [],
        };
      });

    return {
      ...b,
      classGroup: cg,
      subjects,
      trimesters,
      studentCards,
    };
  };

  const client: any = {
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (arg: any) => (typeof arg === "function" ? arg(client) : Promise.all(arg))),
    classCouncilBoard: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const found = hoisted.db.boards.find((b) => b.id === where?.id) || null;
        if (!found) return null;
        return include ? hydrateBoard(found) : found;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = hoisted.db.boards.find((b) => b.id === where?.id);
        if (!found) return null;
        Object.assign(found, data);
        return found;
      }),
    },
    classCouncilTrimester: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.db.trimesters.filter((t) => t.boardId === where?.boardId)
      ),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    student: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.db.students.filter(
          (s) =>
            (!where?.schoolId || s.schoolId === where.schoolId) &&
            (!where?.classGroupId || s.classGroupId === where.classGroupId) &&
            (where?.active === undefined || s.active === where.active)
        )
      ),
    },
    studentCouncilCard: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.db.cards.filter((c) => {
          if (where?.boardId && c.boardId !== where.boardId) return false;
          if (where?.schoolId && c.schoolId !== where.schoolId) return false;
          if (where?.studentId?.in && !where.studentId.in.includes(c.studentId)) return false;
          return true;
        })
      ),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  return { prisma: client };
});

import { PATCH as patchBoardRoute } from "@/app/api/conselho-classe/[boardId]/route";
import CouncilSeatingMapTab from "@/components/conselho/CouncilSeatingMapTab";
import ConselhoPrintClient from "@/app/conselho-classe/[boardId]/imprimir/ConselhoPrintClient";
import {
  assignStudentToSeat,
  calculateRecommendedRows,
  createSeatingMapVersion,
  duplicateMapVersion,
  fillSeatsAlphabetically,
  getDisplayGridForPerspective,
  getEffectiveDoorSideForPerspective,
  getEffectiveTeacherDeskForPerspective,
  parseSeatingMapStore,
  resizeSeatingMapGrid,
  rotateSeatingMapColumns,
  swapOrMoveSeats,
  toggleSeatBlocked,
} from "@/components/conselho/seatingMapUtils";
import type { CouncilBoardDetailRecord, SchoolPrintMeta } from "@/components/conselho/types";

function buildBoardFixture(): CouncilBoardDetailRecord {
  return {
    id: "board-8b",
    schoolId: "school-a",
    classGroupId: "cg-8b",
    year: 2026,
    peerLeaderStudentId: null,
    peerLeaderName: null,
    teacherLeaderStudentId: null,
    teacherLeaderName: null,
    externalEvalEd1Percent: null,
    externalEvalEd2Percent: null,
    externalEvalEd3Percent: null,
    seatingMapMode: "REVEZAMENTO_MENSAL",
    seatingMapNotes: "Alternar filas da frente a cada 30 dias.",
    seatingMapLayoutJson: null,
    classGroup: {
      id: "cg-8b",
      name: "8º Ano B",
      segment: "FUNDAMENTAL",
      shift: "MANHA",
    },
    subjects: [
      {
        id: "sub-mat",
        schoolId: "school-a",
        boardId: "board-8b",
        name: "Matemática",
        teacherName: "Prof. Marcos",
        teacherEmail: null,
        displayOrder: 1,
        active: true,
      },
    ],
    trimesters: [
      {
        id: "tri-1",
        schoolId: "school-a",
        boardId: "board-8b",
        trimester: 1,
        status: "OPEN",
        positivePoints: null,
        attentionPoints: null,
        plannedActions: null,
        postCouncilHeldAt: null,
        postCouncilAdvances: null,
        postCouncilWhatWorked: null,
        postCouncilRecognizedAttitudes: null,
        postCouncilCriticalSubjects: null,
        postCouncilPerformanceFactors: null,
        postCouncilBehaviorAttendance: null,
        postCouncilWhatToImprove: null,
        postCouncilHowTeachersCanHelp: null,
        postCouncilCommitments: null,
        postCouncilActionItemsJson: null,
        linkedMinuteId: null,
        updatedByName: null,
        updatedByEmail: null,
        updatedAt: "2026-04-01T10:00:00.000Z",
      },
    ],
    studentCards: [
      {
        id: "card-1",
        schoolId: "school-a",
        boardId: "board-8b",
        studentId: "st-ana",
        enrollmentStatus: "ATIVO",
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        tags: ["ALUNO_COM_LAUDO", "AEE"],
        hasSensitiveHealthTag: true,
        trimester1Opinion: "Acompanhamento individual.",
        trimester2Opinion: null,
        trimester3Opinion: null,
        trimester1BelowAvgJson: null,
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        student: {
          id: "st-ana",
          name: "Ana Beatriz Silva",
          cgm: "2001",
          active: true,
          isSpecialNeeds: true,
          isExchangeStudent: false,
          age: 13,
          lowAttendanceRecord: { attendancePercent: 69.0 },
        },
        subjectEntries: [
          {
            id: "ent-1",
            schoolId: "school-a",
            cardId: "card-1",
            subjectId: "sub-mat",
            trimester: 1,
            descriptorCodes: [2, 3],
            grade: 4.5,
          },
        ],
      },
      {
        id: "card-2",
        schoolId: "school-a",
        boardId: "board-8b",
        studentId: "st-bruno",
        enrollmentStatus: "ATIVO",
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        tags: ["LIDER_DE_TURMA"],
        hasSensitiveHealthTag: false,
        trimester1Opinion: null,
        trimester2Opinion: null,
        trimester3Opinion: null,
        trimester1BelowAvgJson: null,
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        student: {
          id: "st-bruno",
          name: "Bruno Costa",
          cgm: "2002",
          active: true,
          isSpecialNeeds: false,
          isExchangeStudent: false,
          age: 13,
          lowAttendanceRecord: { attendancePercent: 95.0 },
        },
        subjectEntries: [
          {
            id: "ent-2",
            schoolId: "school-a",
            cardId: "card-2",
            subjectId: "sub-mat",
            trimester: 1,
            descriptorCodes: [1],
            grade: 8.5,
          },
        ],
      },
      {
        id: "card-3",
        schoolId: "school-a",
        boardId: "board-8b",
        studentId: "st-carlos",
        enrollmentStatus: "TRANSFERIDO",
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        tags: [],
        hasSensitiveHealthTag: false,
        trimester1Opinion: null,
        trimester2Opinion: null,
        trimester3Opinion: null,
        trimester1BelowAvgJson: null,
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        student: {
          id: "st-carlos",
          name: "Carlos Transferido",
          cgm: "2003",
          active: false,
          isSpecialNeeds: false,
          isExchangeStudent: false,
          age: 14,
          lowAttendanceRecord: null,
        },
        subjectEntries: [],
      },
    ],
  };
}

describe("Organizador e Mapa de Sala do Conselho de Classe", () => {
  beforeEach(() => {
    hoisted.db.boards = [
      {
        id: "board-8b",
        schoolId: "school-a",
        classGroupId: "cg-8b",
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
        seatingMapLayoutJson: null,
      },
    ];
    hoisted.db.classGroups = [
      { id: "cg-8b", schoolId: "school-a", name: "8º Ano B", segment: "FUNDAMENTAL", shift: "MANHA" },
    ];
    hoisted.db.students = [
      { id: "st-ana", schoolId: "school-a", classGroupId: "cg-8b", name: "Ana Beatriz Silva", cgm: "2001", active: true },
      { id: "st-bruno", schoolId: "school-a", classGroupId: "cg-8b", name: "Bruno Costa", cgm: "2002", active: true },
      { id: "st-carlos", schoolId: "school-a", classGroupId: "cg-8b", name: "Carlos Transferido", cgm: "2003", active: false },
      { id: "st-outro", schoolId: "school-b", classGroupId: "cg-other", name: "Estudante Escola B", cgm: "9999", active: true },
    ];
    hoisted.db.subjects = [];
    hoisted.db.trimesters = [
      { id: "tri-1", schoolId: "school-a", boardId: "board-8b", trimester: 1, status: "OPEN", updatedAt: new Date() },
      { id: "tri-2", schoolId: "school-a", boardId: "board-8b", trimester: 2, status: "OPEN", updatedAt: new Date() },
      { id: "tri-3", schoolId: "school-a", boardId: "board-8b", trimester: 3, status: "OPEN", updatedAt: new Date() },
    ];
    hoisted.db.cards = [
      { id: "card-1", schoolId: "school-a", boardId: "board-8b", studentId: "st-ana", enrollmentStatus: "ATIVO", tags: [] },
      { id: "card-2", schoolId: "school-a", boardId: "board-8b", studentId: "st-bruno", enrollmentStatus: "ATIVO", tags: [] },
      { id: "card-3", schoolId: "school-a", boardId: "board-8b", studentId: "st-carlos", enrollmentStatus: "TRANSFERIDO", tags: [] },
      { id: "card-other", schoolId: "school-b", boardId: "board-other", studentId: "st-outro", enrollmentStatus: "ATIVO", tags: [] },
    ];
    hoisted.auditCalls = [];
    hoisted.session = {
      user: {
        id: "user-ped",
        name: "Pedagoga Alpha",
        email: "pedagoga@escola.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "school-a",
        active: true,
        schools: [{ schoolId: "school-a", role: "PEDAGOGA", active: true }],
      },
    };
  });

  it("executa corretamente cálculo de filas, redimensionamento, unicidade, troca, rotação e perspectiva espelhada", () => {
    expect(calculateRecommendedRows(31, 5)).toBe(7);
    expect(calculateRecommendedRows(30, 5)).toBe(6);

    let map = createSeatingMapVersion({
      id: "m1",
      name: "Março / 2026",
      effectiveDate: "2026-03-01",
      columns: 3,
      rows: 2,
      teacherDeskPosition: "LEFT",
      doorSide: "LEFT",
    });

    // Posiciona Ana em (0, 0) e tenta duplicar em (2, 1) -> remove da posição anterior
    map = assignStudentToSeat(map, 0, 0, "st-ana");
    map = assignStudentToSeat(map, 2, 1, "st-ana");
    expect(map.seats.filter((s) => s.studentId === "st-ana")).toHaveLength(1);
    expect(map.seats.find((s) => s.col === 0 && s.row === 0)?.studentId).toBeNull();

    // Posiciona Bruno em (0, 0) e troca com Ana em (2, 1)
    map = assignStudentToSeat(map, 0, 0, "st-bruno");
    map = swapOrMoveSeats(map, { col: 0, row: 0 }, { col: 2, row: 1 });
    expect(map.seats.find((s) => s.col === 0 && s.row === 0)?.studentId).toBe("st-ana");
    expect(map.seats.find((s) => s.col === 2 && s.row === 1)?.studentId).toBe("st-bruno");

    // Bloqueia carteira (1, 0) e preenche alfabeticamente um 3º estudante nas livres
    map = toggleSeatBlocked(map, 1, 0);
    expect(map.seats.find((s) => s.col === 1 && s.row === 0)?.blocked).toBe(true);
    map = fillSeatsAlphabetically(map, [
      { studentId: "st-ana", name: "Ana", enrollmentStatus: "ATIVO" },
      { studentId: "st-bruno", name: "Bruno", enrollmentStatus: "ATIVO" },
      { studentId: "st-diana", name: "Diana", enrollmentStatus: "ATIVO" },
    ]);
    expect(map.seats.find((s) => s.col === 2 && s.row === 0)?.studentId).toBe("st-diana");

    // Redimensiona de 3x2 para 2x3 preservando Ana, Bruno e Diana sem perder ninguém
    const resized = resizeSeatingMapGrid(map, 2, 3);
    expect(resized.displacedStudentIds).toHaveLength(0);
    expect(resized.map.seats.filter((s) => s.studentId !== null)).toHaveLength(3);

    // Rotaciona filas para a direita: col 0 -> col 1
    const rotated = rotateSeatingMapColumns(map, "RIGHT");
    expect(rotated.seats.find((s) => s.col === 1 && s.row === 0)?.studentId).toBe("st-ana");

    // Visão do professor espelha linhas, colunas, mesa e porta
    const teacherGrid = getDisplayGridForPerspective(map, "TEACHER");
    expect(teacherGrid.colIndices).toEqual([2, 1, 0]);
    expect(teacherGrid.rowIndices).toEqual([1, 0]);
    expect(getEffectiveTeacherDeskForPerspective("LEFT", "TEACHER")).toBe("RIGHT");
    expect(getEffectiveDoorSideForPerspective("LEFT", "TEACHER")).toBe("RIGHT");

    // Duplicação com rotação cria nova versão independente
    const nextCycle = duplicateMapVersion(map, {
      id: "m2",
      name: "Abril / 2026",
      rotateDirection: "RIGHT",
    });
    expect(nextCycle.id).toBe("m2");
    expect(nextCycle.seats.find((s) => s.col === 1 && s.row === 0)?.studentId).toBe("st-ana");
  });

  it("persiste versões do mapa na API PATCH e bloqueia FK traversal cross-tenant, duplicidade e perfil somente leitura", async () => {
    const validLayout = {
      version: 1 as const,
      activeMapId: "m-marco",
      maps: [
        {
          id: "m-marco",
          name: "Março / 2026",
          effectiveDate: "2026-03-01",
          columns: 3,
          rows: 2,
          teacherDeskPosition: "CENTER" as const,
          doorSide: "LEFT" as const,
          notes: "Mapa inicial",
          seats: [
            { col: 0, row: 0, studentId: "st-ana" },
            { col: 1, row: 0, studentId: "st-carlos" }, // histórico transferido permitido pois pertence ao board
          ],
          createdAt: "2026-03-01T10:00:00.000Z",
          updatedAt: "2026-03-01T10:00:00.000Z",
        },
      ],
    };

    const okRes = await patchBoardRoute(
      new Request("http://localhost/api/conselho-classe/board-8b", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatingMapMode: "REVEZAMENTO_MENSAL",
          seatingMapLayout: validLayout,
        }),
      }),
      { params: Promise.resolve({ boardId: "board-8b" }) }
    );
    expect(okRes.status).toBe(200);
    const parsedSaved = parseSeatingMapStore(hoisted.db.boards[0].seatingMapLayoutJson);
    expect(parsedSaved.activeMapId).toBe("m-marco");
    expect(parsedSaved.maps[0].seats.find((s) => s.col === 1 && s.row === 0)?.studentId).toBe("st-carlos");

    // Cross-tenant FK traversal: aluno de school-b deve retornar 400
    const crossTenantRes = await patchBoardRoute(
      new Request("http://localhost/api/conselho-classe/board-8b", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatingMapLayout: {
            ...validLayout,
            maps: [
              {
                ...validLayout.maps[0],
                seats: [{ col: 0, row: 0, studentId: "st-outro" }],
              },
            ],
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-8b" }) }
    );
    expect(crossTenantRes.status).toBe(400);

    // Duplicidade de estudante na mesma versão de mapa deve retornar 400
    const dupRes = await patchBoardRoute(
      new Request("http://localhost/api/conselho-classe/board-8b", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatingMapLayout: {
            ...validLayout,
            maps: [
              {
                ...validLayout.maps[0],
                seats: [
                  { col: 0, row: 0, studentId: "st-ana" },
                  { col: 1, row: 0, studentId: "st-ana" },
                ],
              },
            ],
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-8b" }) }
    );
    expect(dupRes.status).toBe(400);

    // Perfil GESTAO_SECRETARIA recebe 403 Forbidden
    hoisted.session.user.role = "GESTAO_SECRETARIA";
    hoisted.session.user.schools = [];
    hoisted.session.user.networks = [{ networkId: "net-a", active: true }];
    const readOnlyRes = await patchBoardRoute(
      new Request("http://localhost/api/conselho-classe/board-8b", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatingMapLayout: validLayout }),
      }),
      { params: Promise.resolve({ boardId: "board-8b" }) }
    );
    expect(readOnlyRes.status).toBe(403);
  });

  it("renderiza CouncilSeatingMapTab e versão impressa A4 paisagem limpa (Visão da sala e Visão do professor)", () => {
    const board = buildBoardFixture();
    let map = createSeatingMapVersion({
      id: "m-abril",
      name: "Abril / 2026",
      effectiveDate: "2026-04-01",
      columns: 4,
      rows: 2,
      teacherDeskPosition: "CENTER",
      doorSide: "LEFT",
      notes: "Manter primeira carteira livre próximo à porta.",
    });
    map = assignStudentToSeat(map, 0, 0, "st-ana");
    map = assignStudentToSeat(map, 1, 0, "st-carlos");
    board.seatingMapLayoutJson = JSON.stringify({
      version: 1,
      activeMapId: "m-abril",
      maps: [map],
    });

    const tabHtmlReadOnly = renderToString(
      React.createElement(CouncilSeatingMapTab, {
        board,
        activeTrimester: 1,
        hideSensitiveTags: true,
        onBoardUpdated: vi.fn(),
        onNotify: vi.fn(),
        readOnly: true,
      })
    ).replace(/<!--\s*-->/g, "");

    expect(tabHtmlReadOnly).toContain("Abril / 2026");
    expect(tabHtmlReadOnly).toContain("Mapa vigente");
    expect(tabHtmlReadOnly).toContain("Ana Silva");
    expect(tabHtmlReadOnly).toContain("Carlos Transferido");
    expect(tabHtmlReadOnly).toContain("Transferido");
    expect(tabHtmlReadOnly).not.toContain("Com Laudo");
    expect(tabHtmlReadOnly).not.toContain(">AEE<");
    expect(tabHtmlReadOnly).not.toContain("Salvar mapa");

    const school: SchoolPrintMeta = {
      id: "school-a",
      name: "Escola Estadual Alpha",
      inepCode: "41000011",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
    };

    const printRoomHtml = renderToString(
      React.createElement(ConselhoPrintClient, {
        board,
        school,
        initialMode: "mapa-sala",
        initialTrimester: 1,
        initialStudentId: null,
        initialHideHealthTags: false,
        anonymizedOpinionsByStudentId: {},
        initialMapId: "m-abril",
        initialPerspective: "ROOM",
      })
    ).replace(/<!--\s*-->/g, "");

    expect(printRoomHtml).toContain("size: A4 landscape");
    expect(printRoomHtml).toContain("Visão da sala (quadro no topo)");
    expect(printRoomHtml).toContain("Quadro / Frente da sala");
    expect(printRoomHtml).toContain("Ana Silva");
    expect(printRoomHtml).toContain("Estudantes sem carteira associada (1):</strong> Bruno Costa");
    // Folha impressa do mapa de sala NUNCA expõe alertas pedagógicos, notas ou dados sensíveis
    expect(printRoomHtml).not.toContain("Com Laudo");
    expect(printRoomHtml).not.toContain("AEE");
    expect(printRoomHtml).not.toContain("Conduta indisciplinar");
    expect(printRoomHtml).not.toContain("4,5");

    const printTeacherHtml = renderToString(
      React.createElement(ConselhoPrintClient, {
        board,
        school,
        initialMode: "mapa-sala",
        initialTrimester: 1,
        initialStudentId: null,
        initialHideHealthTags: false,
        anonymizedOpinionsByStudentId: {},
        initialMapId: "m-abril",
        initialPerspective: "TEACHER",
      })
    ).replace(/<!--\s*-->/g, "");

    expect(printTeacherHtml).toContain("Visão do professor (quadro na base)");
    // Na visão do professor, a última fila (Fila 4) vem antes da Fila 1 no DOM espelhado
    expect(printTeacherHtml.indexOf("Fila 4")).toBeLessThan(printTeacherHtml.indexOf("Fila 1"));
  });

  it("cumpre as diretrizes de UX Writing da Seção 10 de GEMINI.md nos novos arquivos", () => {
    const filesToCheck = [
      "src/components/conselho/seatingMapUtils.ts",
      "src/components/conselho/CouncilSeatingMapTab.tsx",
      "src/app/conselho-classe/[boardId]/imprimir/ConselhoPrintClient.tsx",
    ];
    const forbidden = [
      /f[ée]\s+p[úu]blica/i,
      /imut[áa]vel/i,
      /inviol[áa]vel/i,
      /SHA-256/i,
      /PBKDF2/i,
      /PDF\/A/i,
      /Conselho Tutelar/i,
      /Minist[ée]rio P[úu]blico/i,
      /\b14\.063\b/,
      /workflow|insights|otimizar|ecossistema|jornada/i,
    ];

    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      for (const pat of forbidden) {
        expect(content, `${rel} violou padrão ${pat}`).not.toMatch(pat);
      }
    }
  });
});
