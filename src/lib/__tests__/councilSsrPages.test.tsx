import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

class NextRedirectError extends Error {
  constructor(public readonly destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
  }
}

class NextNotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

const hoisted = vi.hoisted(() => ({
  session: null as any,
  authorizedSchool: null as any,
  boardsData: { year: 2026, classGroups: [], boards: [] } as any,
  ownership: null as { id: string; schoolId: string; year: number } | null,
  boardDetail: null as any,
  prismaBoard: null as any,
  prismaSchool: null as any,
  prismaSubjects: [] as any[],
  prismaTrimesters: [] as any[],
  rateLimitResult: {
    success: true,
    limit: 60,
    remaining: 59,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new NextRedirectError(url);
  }),
  notFound: vi.fn(() => {
    throw new NextNotFoundError();
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.50" })),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("@/lib/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rateLimit")>("@/lib/rateLimit");
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => hoisted.rateLimitResult),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findUnique: vi.fn(async () => hoisted.prismaSchool),
    },
    classCouncilBoard: {
      findUnique: vi.fn(async () => hoisted.prismaBoard),
    },
    classCouncilSubject: {
      findMany: vi.fn(async () => hoisted.prismaSubjects),
    },
    classCouncilTrimester: {
      findMany: vi.fn(async () => hoisted.prismaTrimesters),
    },
  },
}));

const serviceMocks = vi.hoisted(() => ({
  resolveAuthorizedSchoolForCouncil: vi.fn(async () => hoisted.authorizedSchool),
  listSchoolCouncilBoards: vi.fn(async () => hoisted.boardsData),
  findCouncilBoardOwnershipRecord: vi.fn(async () => hoisted.ownership),
  getCouncilBoardDetail: vi.fn(async () => hoisted.boardDetail),
}));

vi.mock("@/services/classCouncilService", async () => {
  const actual = await vi.importActual<typeof import("@/services/classCouncilService")>(
    "@/services/classCouncilService"
  );
  return {
    ...actual,
    resolveAuthorizedSchoolForCouncil: serviceMocks.resolveAuthorizedSchoolForCouncil,
    listSchoolCouncilBoards: serviceMocks.listSchoolCouncilBoards,
    findCouncilBoardOwnershipRecord: serviceMocks.findCouncilBoardOwnershipRecord,
    getCouncilBoardDetail: serviceMocks.getCouncilBoardDetail,
  };
});

import ConselhoClassePage from "@/app/conselho-classe/page";
import ConselhoTurmaPage from "@/app/conselho-classe/[boardId]/page";
import ConselhoPrintPage from "@/app/conselho-classe/[boardId]/imprimir/page";
import ProfessorConselhoPage from "@/app/conselho-classe/professor/[token]/page";
import ProfessorPreConselhoPage from "@/app/conselho-classe/pre-conselho/[token]/page";
import {
  createCouncilTeacherToken,
  createPreCouncilTeacherToken,
} from "@/lib/councilTeacherToken";

function buildFullBoardDetail(schoolId = "school-a") {
  return {
    id: "board-1",
    schoolId,
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
    seatingMapLayoutJson: null,
    classGroup: {
      id: "cg-1",
      name: "6º Ano A",
      segment: "FUNDAMENTAL",
      shift: "MANHA",
      schoolId,
    },
    subjects: [
      {
        id: "subj-1",
        schoolId,
        boardId: "board-1",
        name: "Matemática",
        teacherName: "Prof. Marcos",
        teacherEmail: "prof@escola.pr.gov.br",
        displayOrder: 0,
        active: true,
      },
    ],
    trimesters: [
      {
        id: "tri-1",
        schoolId,
        boardId: "board-1",
        trimester: 1,
        status: "IN_PROGRESS",
        positivePoints: null,
        attentionPoints: null,
        plannedActions: null,
        preCouncilJson: null,
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
      },
    ],
    studentCards: [
      {
        id: "card-1",
        schoolId,
        boardId: "board-1",
        studentId: "stu-1",
        enrollmentStatus: "ATIVO",
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        tags: ["ALUNO_COM_LAUDO", "AEE", "LIDER_DE_TURMA"],
        hasSensitiveHealthTag: true,
        trimester1Opinion: "Apresenta boa interação com Pedro Henrique Lima nas atividades.",
        trimester2Opinion: null,
        trimester3Opinion: null,
        trimester1BelowAvgJson: null,
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        student: {
          id: "stu-1",
          name: "Ana Clara Souza",
          cgm: "1001",
          active: true,
          isSpecialNeeds: false,
          isExchangeStudent: false,
          age: 13,
          lowAttendanceRecord: null,
        },
        subjectEntries: [],
      },
      {
        id: "card-2",
        schoolId,
        boardId: "board-1",
        studentId: "stu-2",
        enrollmentStatus: "ATIVO",
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
          id: "stu-2",
          name: "Pedro Henrique Lima",
          cgm: "1002",
          active: true,
          isSpecialNeeds: false,
          isExchangeStudent: false,
          age: 13,
          lowAttendanceRecord: null,
        },
        subjectEntries: [],
      },
    ],
  };
}

describe("SSR das Páginas do Conselho de Classe e Portais Docentes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "ssr-council-secret-32-chars-minimum-ok");
    hoisted.session = {
      user: {
        id: "usr-1",
        name: "Pedagoga Alpha",
        email: "pedagoga@escola-a.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "school-a",
        active: true,
        schools: [{ schoolId: "school-a", role: "PEDAGOGA", active: true }],
      },
    };
    hoisted.authorizedSchool = {
      id: "school-a",
      name: "Escola Estadual Alpha",
      inepCode: "41000011",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
      edition: "INSTITUCIONAL_ESSENCIAL",
      logoUrl: "/api/schools/school-a/logo",
    };
    hoisted.boardsData = { year: 2026, classGroups: [], boards: [] };
    hoisted.ownership = { id: "board-1", schoolId: "school-a", year: 2026 };
    hoisted.boardDetail = buildFullBoardDetail("school-a");
    hoisted.prismaSchool = {
      id: "school-a",
      name: "Escola Estadual Alpha",
      inepCode: "41000011",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
      updatedAt: new Date("2026-11-20T10:00:00Z"),
    };
    hoisted.prismaBoard = {
      id: "board-1",
      schoolId: "school-a",
      year: 2026,
      school: { name: "Escola Estadual Alpha" },
      classGroup: { name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
    };
    hoisted.prismaSubjects = [{ id: "subj-1", name: "Matemática" }];
    hoisted.prismaTrimesters = [
      {
        trimester: 1,
        preCouncilJson: JSON.stringify({
          version: 1,
          periodLabel: "1º Trimestre",
          objectiveText: "Objetivo",
          responsiblePedagogueName: "Pedagoga",
          responsiblePedagogueRole: "Pedagoga",
          conversations: [
            {
              id: "conv-1",
              subjectId: "subj-1",
              subjectName: "Matemática",
              teacherName: "Prof. Marcos",
              teacherEmail: "prof@escola.pr.gov.br",
              monitoredStudentIds: [],
              monitoredStudentsNotes: "",
              agreements: "",
              conversationStatus: "PENDING",
              conversationDate: null,
              digitalAckEmail: null,
              digitalAckName: null,
              digitalAckAt: null,
            },
          ],
          synthesis: {
            mainDifficulties: "",
            priorityStudents: "",
            attendanceIssues: "",
            behaviorIssues: "",
            pedagogicalActions: "",
          },
        }),
      },
    ];
    hoisted.rateLimitResult = {
      success: true,
      limit: 60,
      remaining: 59,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("ConselhoClassePage (/conselho-classe)", () => {
    it("redireciona para /login quando não autenticado ou session.user.active === false", async () => {
      hoisted.session = null;
      await expect(ConselhoClassePage({})).rejects.toEqual(new NextRedirectError("/login"));

      hoisted.session = {
        user: { id: "usr-inativo", role: "PEDAGOGA", schoolId: "school-a", active: false },
      };
      await expect(ConselhoClassePage({})).rejects.toEqual(new NextRedirectError("/login"));
      expect(serviceMocks.resolveAuthorizedSchoolForCouncil).not.toHaveBeenCalled();
      expect(serviceMocks.listSchoolCouncilBoards).not.toHaveBeenCalled();
    });

    it("exibe estado seguro sem fallback para a Escola Piloto quando não há escola autorizada vinculada", async () => {
      hoisted.authorizedSchool = null;
      hoisted.session = {
        user: { id: "usr-orphan", role: "PEDAGOGA", schoolId: null, active: true, schools: [] },
      };

      const element = await ConselhoClassePage({
        searchParams: Promise.resolve({ year: "2026" }),
      });
      const html = renderToString(element);

      expect(serviceMocks.listSchoolCouncilBoards).not.toHaveBeenCalled();
      expect(html).toContain("Conselho de Classe — Nenhuma instituição vinculada");
      expect(html).not.toContain("Leopoldina");
      expect(html).not.toContain("41042730");
    });

    it("renderiza painel com canEdit e canUseBiScraper coerentes para a escola autorizada", async () => {
      const element = await ConselhoClassePage({
        searchParams: Promise.resolve({ year: "2026" }),
      });
      expect((element as React.ReactElement<Record<string, unknown>>).props.canEdit).toBe(true);
      expect((element as React.ReactElement<Record<string, unknown>>).props.canUseBiScraper).toBe(
        false
      );
      expect(renderToString(element)).toContain("Escola Estadual Alpha");
    });
  });

  describe("ConselhoTurmaPage (/conselho-classe/[boardId])", () => {
    it("redireciona para /login quando session.user.active === false", async () => {
      hoisted.session.user.active = false;
      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: "board-1" }) })
      ).rejects.toEqual(new NextRedirectError("/login"));
    });

    it("dispara notFound() em acesso cross-tenant e quando não há escola autorizada", async () => {
      hoisted.ownership = { id: "board-b1", schoolId: "school-b", year: 2026 };
      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: "board-b1" }) })
      ).rejects.toBeInstanceOf(NextNotFoundError);
      expect(serviceMocks.getCouncilBoardDetail).not.toHaveBeenCalled();

      hoisted.ownership = { id: "board-1", schoolId: "school-a", year: 2026 };
      hoisted.authorizedSchool = null;
      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: "board-1" }) })
      ).rejects.toBeInstanceOf(NextNotFoundError);
      expect(serviceMocks.getCouncilBoardDetail).not.toHaveBeenCalled();
    });
  });

  describe("ConselhoPrintPage (/conselho-classe/[boardId]/imprimir)", () => {
    it("redireciona inativo para /login e bloqueia cross-tenant ou estudante inexistente com notFound()", async () => {
      hoisted.session.user.active = false;
      await expect(
        ConselhoPrintPage({ params: Promise.resolve({ boardId: "board-1" }) })
      ).rejects.toEqual(new NextRedirectError("/login"));

      hoisted.session.user.active = true;
      hoisted.ownership = { id: "board-b1", schoolId: "school-b", year: 2026 };
      await expect(
        ConselhoPrintPage({ params: Promise.resolve({ boardId: "board-b1" }) })
      ).rejects.toBeInstanceOf(NextNotFoundError);

      hoisted.ownership = { id: "board-1", schoolId: "school-a", year: 2026 };
      await expect(
        ConselhoPrintPage({
          params: Promise.resolve({ boardId: "board-1" }),
          searchParams: Promise.resolve({ mode: "aluno", studentId: "stu-inexistente" }),
        })
      ).rejects.toBeInstanceOf(NextNotFoundError);
    });

    it("propaga ?hideHealthTags=1 via searchParams e aplica anonimização ECA entre colegas", async () => {
      const elHidden = (await ConselhoPrintPage({
        params: Promise.resolve({ boardId: "board-1" }),
        searchParams: Promise.resolve({
          mode: "aluno",
          studentId: "stu-1",
          hideHealthTags: "1",
        }),
      })) as React.ReactElement<Record<string, unknown>>;

      expect(elHidden.props.initialHideHealthTags).toBe(true);
      const anonMap = elHidden.props.anonymizedOpinionsByStudentId as Record<
        string,
        { t1: string }
      >;
      expect(anonMap["stu-1"].t1).not.toContain("Pedro Henrique Lima");

      const htmlHidden = renderToString(elHidden);
      expect(htmlHidden).not.toContain("Estudante com Laudo");
      expect(htmlHidden).not.toContain("AEE (Acompanhamento Pedagógico - Turno)");
      expect(htmlHidden).toContain("Líder de Turma");

      const elVisible = (await ConselhoPrintPage({
        params: Promise.resolve({ boardId: "board-1" }),
        searchParams: Promise.resolve({
          mode: "aluno",
          studentId: "stu-1",
        }),
      })) as React.ReactElement<Record<string, unknown>>;

      expect(elVisible.props.initialHideHealthTags).toBe(false);
      const htmlVisible = renderToString(elVisible);
      expect(htmlVisible).toContain("Estudante com Laudo");
      expect(htmlVisible).toContain("AEE (Acompanhamento Pedagógico - Turno)");
    });
  });

  describe("Portais Externos SSR (professor/[token] e pre-conselho/[token])", () => {
    it("bloqueia enableDevAuth em VERCEL_ENV='preview' e habilita em ambiente local explícito", async () => {
      const { token: teacherToken } = createCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-1",
        trimester: 1,
        subjectId: "subj-1",
      });
      const { token: preToken } = createPreCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-1",
        trimester: 1,
        conversationId: "conv-1",
      });

      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("ENABLE_DEV_AUTH", "true");

      const previewTeacherEl = (await ProfessorConselhoPage({
        params: Promise.resolve({ token: teacherToken }),
      })) as React.ReactElement<Record<string, unknown>>;
      expect(previewTeacherEl.props.enableDevAuth).toBe(false);
      expect(renderToString(previewTeacherEl)).not.toContain("Homologação local (@escola.pr.gov.br)");

      const previewPreEl = (await ProfessorPreConselhoPage({
        params: Promise.resolve({ token: preToken }),
      })) as React.ReactElement<Record<string, unknown>>;
      expect(previewPreEl.props.enableDevAuth).toBe(false);
      expect(renderToString(previewPreEl)).not.toContain("Homologação local (@escola.pr.gov.br)");

      vi.stubEnv("VERCEL_ENV", "development");

      const localTeacherEl = (await ProfessorConselhoPage({
        params: Promise.resolve({ token: teacherToken }),
      })) as React.ReactElement<Record<string, unknown>>;
      expect(localTeacherEl.props.enableDevAuth).toBe(true);
      expect(renderToString(localTeacherEl)).toContain("Homologação local (@escola.pr.gov.br)");

      const localPreEl = (await ProfessorPreConselhoPage({
        params: Promise.resolve({ token: preToken }),
      })) as React.ReactElement<Record<string, unknown>>;
      expect(localPreEl.props.enableDevAuth).toBe(true);
      expect(renderToString(localPreEl)).toContain("Homologação local (@escola.pr.gov.br)");
    });

    it("nega acesso cross-tenant e aplica limite de requisições no SSR dos portais", async () => {
      const { token: teacherToken } = createCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-1",
        trimester: 1,
        subjectId: "subj-1",
      });
      const { token: preToken } = createPreCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-1",
        trimester: 1,
        conversationId: "conv-1",
      });

      hoisted.prismaBoard = {
        ...hoisted.prismaBoard,
        schoolId: "school-b",
      };

      const mismatchTeacherHtml = renderToString(
        await ProfessorConselhoPage({ params: Promise.resolve({ token: teacherToken }) })
      );
      expect(mismatchTeacherHtml).toContain("Conselho não encontrado");

      const mismatchPreHtml = renderToString(
        await ProfessorPreConselhoPage({ params: Promise.resolve({ token: preToken }) })
      );
      expect(mismatchPreHtml).toContain("Conselho não encontrado");

      hoisted.rateLimitResult = {
        success: false,
        limit: 60,
        remaining: 0,
        resetAt: Date.now() + 42_000,
        retryAfterSeconds: 42,
      };

      const rlTeacherHtml = renderToString(
        await ProfessorConselhoPage({ params: Promise.resolve({ token: teacherToken }) })
      );
      expect(rlTeacherHtml).toContain("Limite de acessos excedido");
      expect(rlTeacherHtml).toContain("42 segundos");

      const rlPreHtml = renderToString(
        await ProfessorPreConselhoPage({ params: Promise.resolve({ token: preToken }) })
      );
      expect(rlPreHtml).toContain("Limite de acessos excedido");
      expect(rlPreHtml).toContain("42 segundos");
    });
  });
});
