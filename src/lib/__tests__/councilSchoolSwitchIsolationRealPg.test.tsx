import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { prisma } from "@/lib/prisma";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import {
  createCouncilTeacherToken,
  createPreCouncilTeacherToken,
} from "@/lib/councilTeacherToken";
import {
  installBrowserShims,
  mountReactComponent,
  type BrowserShimHandle,
} from "./helpers/reactNodeHarness";

const hoisted = vi.hoisted(() => ({
  authSession: null as any,
  cookiesMap: new Map<string, string>(),
  escolaVerifyResult: {
    ok: true as const,
    tokenInfo: {
      email: "docente.portal@escola.pr.gov.br",
      name: "Docente Portal",
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (key: string) =>
      hoisted.cookiesMap.has(key)
        ? { name: key, value: hoisted.cookiesMap.get(key)! }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.authSession),
}));

vi.mock("@/lib/escolaGoogleVerify", () => ({
  verifyEscolaGoogleIdToken: vi.fn(async () => hoisted.escolaVerifyResult),
}));

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return {
    ...actual,
    enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
    checkRateLimit: vi.fn(async () => ({ success: true, retryAfterSeconds: 60 })),
    resetRateLimit: vi.fn(async () => {}),
  };
});

import SchoolSelector, {
  SCHOOL_SWITCHED_EVENT,
  resolvePostSchoolSwitchPath,
} from "@/components/SchoolSelector";
import ConselhoTurmaClient from "@/app/conselho-classe/[boardId]/ConselhoTurmaClient";
import CouncilPreCouncilTab from "@/components/conselho/CouncilPreCouncilTab";
import type { CouncilBoardDetailRecord } from "@/components/conselho/types";

import ConselhoClassePage from "@/app/conselho-classe/page";
import ConselhoTurmaPage from "@/app/conselho-classe/[boardId]/page";
import ConselhoPrintPage from "@/app/conselho-classe/[boardId]/imprimir/page";
import { GET as getBoardRoute, PATCH as patchBoardRoute } from "@/app/api/conselho-classe/[boardId]/route";
import { PATCH as patchTrimesterRoute } from "@/app/api/conselho-classe/[boardId]/trimesters/route";
import { PUT as putMatrixRoute } from "@/app/api/conselho-classe/[boardId]/matrix/route";
import { PUT as putSubjectsRoute } from "@/app/api/conselho-classe/[boardId]/subjects/route";
import { PATCH as patchStudentCardRoute } from "@/app/api/conselho-classe/[boardId]/students/[studentId]/route";
import { POST as postImportPdfRoute } from "@/app/api/conselho-classe/[boardId]/import-pdf/route";
import { POST as postGenerateMinuteRoute } from "@/app/api/conselho-classe/[boardId]/generate-minute/route";
import { POST as postTeacherLinkRoute } from "@/app/api/conselho-classe/[boardId]/teacher-link/route";
import { POST as postPreCouncilLinkRoute } from "@/app/api/conselho-classe/[boardId]/pre-council-link/route";
import {
  POST as postTeacherPortalRoute,
  PUT as putTeacherPortalRoute,
} from "@/app/api/conselho-classe/teacher-portal/[token]/route";
import {
  POST as postPreCouncilPortalRoute,
  PUT as putPreCouncilPortalRoute,
} from "@/app/api/conselho-classe/pre-council-portal/[token]/route";
import ProfessorConselhoPage from "@/app/conselho-classe/professor/[token]/page";
import ProfessorPreConselhoPage from "@/app/conselho-classe/pre-conselho/[token]/page";

function makeSyntheticBoard(schoolId: string, boardId: string, schoolName: string): CouncilBoardDetailRecord {
  return {
    id: boardId,
    schoolId,
    classGroupId: `cg-${schoolId}`,
    year: 2026,
    peerLeaderStudentId: null,
    peerLeaderName: null,
    teacherLeaderStudentId: null,
    teacherLeaderName: null,
    externalEvalEd1Percent: null,
    externalEvalEd2Percent: null,
    externalEvalEd3Percent: null,
    seatingMapMode: "FIXO",
    seatingMapNotes: null,
    seatingMapLayoutJson: null,
    classGroup: {
      id: `cg-${schoolId}`,
      name: "6º Ano A",
      segment: "FUNDAMENTAL",
      shift: "MANHA",
    },
    subjects: [
      {
        id: `subj-${schoolId}`,
        boardId,
        schoolId,
        name: "Matemática",
        teacherName: "Prof. Ana",
        teacherEmail: "ana@escola.pr.gov.br",
        displayOrder: 0,
        active: true,
      },
    ],
    trimesters: [
      {
        id: `tri-${schoolId}-1`,
        boardId,
        schoolId,
        trimester: 1,
        status: "IN_PROGRESS",
        positivePoints: `Pontos positivos ${schoolName}`,
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
        updatedAt: "2026-11-26T12:00:00.000Z",
        preCouncilJson: JSON.stringify({
          version: 1,
          periodLabel: "1º Trimestre",
          objectiveText: `Objetivo ${schoolName}`,
          responsiblePedagogueName: "Pedagoga",
          responsiblePedagogueRole: "Pedagoga",
          conversations: [
            {
              id: `conv-${schoolId}-1`,
              subjectId: `subj-${schoolId}`,
              subjectName: "Matemática",
              teacherName: "Prof. Ana",
              teacherEmail: "ana@escola.pr.gov.br",
              monitoredStudentIds: [],
              monitoredStudentsNotes: `Observação exclusiva de ${schoolName}`,
              agreements: "",
              conversationStatus: "PENDING",
              conversationDate: null,
              teacherSubmittedAt: null,
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
    ],
    studentCards: [
      {
        id: `card-${schoolId}-1`,
        boardId,
        schoolId,
        studentId: `stu-${schoolId}-1`,
        enrollmentStatus: "MATRICULADO",
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
          id: `stu-${schoolId}-1`,
          name: `Estudante ${schoolName}`,
          cgm: schoolId === "school-a" ? "111001" : "222001",
          active: true,
          isSpecialNeeds: false,
          isExchangeStudent: false,
          age: 12,
          lowAttendanceRecord: null,
        },
        subjectEntries: [],
      },
    ],
  };
}

describe("Conselho de Classe — Troca de Instituição no Cabeçalho, Descarte de Estado e Resposta Atrasada", () => {
  let shim: BrowserShimHandle;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    shim = installBrowserShims();
    (globalThis as unknown as { alert: (msg: string) => void }).alert = vi.fn();
    const listeners = new Map<string, Set<EventListener>>();
    (window as unknown as Record<string, unknown>).addEventListener = (
      type: string,
      fn: EventListener
    ) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    };
    (window as unknown as Record<string, unknown>).removeEventListener = (
      type: string,
      fn: EventListener
    ) => {
      listeners.get(type)?.delete(fn);
    };
    (window as unknown as Record<string, unknown>).dispatchEvent = (event: Event) => {
      for (const fn of listeners.get(event.type) ?? []) {
        fn(event);
      }
      return true;
    };
    const doc = (globalThis as unknown as Record<string, Record<string, unknown>>).document || {};
    doc.addEventListener = vi.fn();
    doc.removeEventListener = vi.fn();
    (globalThis as unknown as Record<string, unknown>).document = doc;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    shim.restore();
    vi.restoreAllMocks();
  });

  it("resolvePostSchoolSwitchPath identifica detalhes/impressão de conselho e preserva índice e portais por token", () => {
    expect(resolvePostSchoolSwitchPath("/conselho-classe/board-a-1")).toBe("/conselho-classe");
    expect(resolvePostSchoolSwitchPath("/conselho-classe/board-a-1/imprimir")).toBe("/conselho-classe");
    expect(resolvePostSchoolSwitchPath("/conselho-classe")).toBeNull();
    expect(resolvePostSchoolSwitchPath("/conselho-classe/professor/tok-123")).toBeNull();
    expect(resolvePostSchoolSwitchPath("/conselho-classe/pre-conselho/tok-123")).toBeNull();
    expect(resolvePostSchoolSwitchPath("/busca-ativa")).toBeNull();
  });

  it("SchoolSelector: troca A -> B bem-sucedida em detalhe navega para /conselho-classe e dispara evento; falha preserva tela atual", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/conselho-classe/board-a-1", assign: vi.fn(), reload: vi.fn() },
      configurable: true,
      writable: true,
    });

    const switchedEvents: string[] = [];
    const listener = (e: Event) => {
      switchedEvents.push((e as CustomEvent<{ schoolId: string }>).detail.schoolId);
    };
    window.addEventListener(SCHOOL_SWITCHED_EVENT, listener);

    const onNavigate = vi.fn();
    const onReload = vi.fn();

    // 1. Falha na troca (HTTP 403) preserva a tela atual
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Acesso negado" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;

    const mountedFail = mountReactComponent(SchoolSelector, {
      currentSchool: { id: "school-a", name: "Escola A", inepCode: "11111111" },
      userSchools: [
        { schoolId: "school-a", name: "Escola A", inepCode: "11111111" },
        { schoolId: "school-b", name: "Escola B", inepCode: "22222222" },
      ],
      onNavigate,
      onReload,
    });

    const toggleBtn = mountedFail.findByTag("button")[0];
    (toggleBtn.props.onClick as (() => void) | undefined)?.();
    await mountedFail.flush();

    const schoolBBtn = mountedFail.findButton("Escola B");
    await (schoolBBtn.props.onClick as (() => Promise<void>) | undefined)?.();
    await mountedFail.flush();

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();
    expect(switchedEvents).toHaveLength(0);
    mountedFail.unmount();

    // 2. Troca bem-sucedida (HTTP 200) navega para /conselho-classe e dispara evento
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;

    const mountedOk = mountReactComponent(SchoolSelector, {
      currentSchool: { id: "school-a", name: "Escola A", inepCode: "11111111" },
      userSchools: [
        { schoolId: "school-a", name: "Escola A", inepCode: "11111111" },
        { schoolId: "school-b", name: "Escola B", inepCode: "22222222" },
      ],
      onNavigate,
      onReload,
    });

    const toggleBtnOk = mountedOk.findByTag("button")[0];
    (toggleBtnOk.props.onClick as (() => void) | undefined)?.();
    await mountedOk.flush();

    const schoolBBtnOk = mountedOk.findButton("Escola B");
    await (schoolBBtnOk.props.onClick as (() => Promise<void>) | undefined)?.();
    await mountedOk.flush();

    expect(switchedEvents).toEqual(["school-b"]);
    expect(onNavigate).toHaveBeenCalledWith("/conselho-classe");
    expect(onReload).not.toHaveBeenCalled();

    window.removeEventListener(SCHOOL_SWITCHED_EVENT, listener);
    mountedOk.unmount();
  });

  it("ConselhoTurmaClient + CouncilPreCouncilTab: desmonta tela de A na troca A -> B e ignora resposta atrasada de A", async () => {
    const boardA = makeSyntheticBoard("school-a", "board-a", "Escola Sintética A");

    // 1. ConselhoTurmaClient desmonta imediatamente ao receber SCHOOL_SWITCHED_EVENT
    const mountedTurma = mountReactComponent(ConselhoTurmaClient, {
      initialBoard: boardA,
      availableSourceBoards: [],
      canEdit: true,
      currentUserName: "Pedagoga A",
      initialTrimester: 1,
    });
    expect(mountedTurma.getText()).toContain("Todas as turmas");
    expect(mountedTurma.getText()).toContain("Pré-Conselho");

    window.dispatchEvent(
      new CustomEvent(SCHOOL_SWITCHED_EVENT, { detail: { schoolId: "school-b" } })
    );
    await mountedTurma.flush();
    expect(mountedTurma.getText()).toContain("Alternando instituição...");
    expect(mountedTurma.getText()).not.toContain("Todas as turmas");
    mountedTurma.unmount();

    // 2. Resposta atrasada do Pré-Conselho de A após troca para B é abortada e descartada
    let resolveDelayedFetch!: (res: Response) => void;
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveDelayedFetch = resolve;
      });
    }) as unknown as typeof fetch;

    const onTrimesterUpdated = vi.fn();
    const onNotify = vi.fn();

    const mountedPre = mountReactComponent(CouncilPreCouncilTab, {
      board: boardA,
      activeTrimester: 1,
      trimesterRecord: boardA.trimesters[0],
      currentUserName: "Pedagoga A",
      readOnly: false,
      hideSensitiveTags: false,
      onOpenStudentModal: vi.fn(),
      onOpenSubjectsModal: vi.fn(),
      onTrimesterUpdated,
      onMatrixSaved: vi.fn(async () => {}),
      onNotify,
    });

    const saveBtn = mountedPre.findButton("Salvar pré-conselho");
    expect(saveBtn).toBeDefined();

    const savePromise = (saveBtn.props.onClick as (() => Promise<void>) | undefined)?.();
    expect(capturedSignal?.aborted).toBe(false);

    // Troca A -> B enquanto a resposta de A ainda está em voo
    window.dispatchEvent(
      new CustomEvent(SCHOOL_SWITCHED_EVENT, { detail: { schoolId: "school-b" } })
    );
    expect(capturedSignal?.aborted).toBe(true);

    // Resposta atrasada de A chega depois da troca
    resolveDelayedFetch(
      new Response(
        JSON.stringify({
          success: true,
          trimesterRecord: boardA.trimesters[0],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    await savePromise;

    expect(onTrimesterUpdated).not.toHaveBeenCalled();
    expect(onNotify).not.toHaveBeenCalled();
    mountedPre.unmount();
  });

  it("Limpeza de cache pendente após confirmação da API já encontra tela de A invalidada e descarta resposta atrasada de A", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/conselho-classe/board-a-1", assign: vi.fn(), reload: vi.fn() },
      configurable: true,
      writable: true,
    });

    let resolveCacheClear!: (keys: string[]) => void;
    const mockCaches = {
      keys: vi.fn(
        () =>
          new Promise<string[]>((resolve) => {
            resolveCacheClear = resolve;
          })
      ),
      delete: vi.fn(async () => true),
    };
    (globalThis as unknown as Record<string, unknown>).caches = mockCaches;
    (window as unknown as Record<string, unknown>).caches = mockCaches;

    const boardA = makeSyntheticBoard("school-a", "board-a-1", "Escola Sintética A");
    let resolveDelayedPreSave!: (res: Response) => void;
    let preSaveSignal: AbortSignal | undefined;

    globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/auth/switch-school")) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      preSaveSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveDelayedPreSave = resolve;
      });
    }) as unknown as typeof fetch;

    const onNavigate = vi.fn();
    const onTrimesterUpdated = vi.fn();
    const onNotify = vi.fn();

    const mountedTurma = mountReactComponent(ConselhoTurmaClient, {
      initialBoard: boardA,
      availableSourceBoards: [],
      canEdit: true,
      currentUserName: "Pedagoga A",
      initialTrimester: 1,
    });
    const mountedPre = mountReactComponent(CouncilPreCouncilTab, {
      board: boardA,
      activeTrimester: 1,
      trimesterRecord: boardA.trimesters[0],
      currentUserName: "Pedagoga A",
      readOnly: false,
      hideSensitiveTags: false,
      onOpenStudentModal: vi.fn(),
      onOpenSubjectsModal: vi.fn(),
      onTrimesterUpdated,
      onMatrixSaved: vi.fn(async () => {}),
      onNotify,
    });
    const mountedSelector = mountReactComponent(SchoolSelector, {
      currentSchool: { id: "school-a", name: "Escola A", inepCode: "11111111" },
      userSchools: [
        { schoolId: "school-a", name: "Escola A", inepCode: "11111111" },
        { schoolId: "school-b", name: "Escola B", inepCode: "22222222" },
      ],
      onNavigate,
    });

    // Inicia salvamento no pré-conselho de A
    const savePromise = (mountedPre.findButton("Salvar pré-conselho").props.onClick as () => Promise<void>)();
    expect(preSaveSignal?.aborted).toBe(false);

    // Inicia troca A -> B: API retorna 200, mas caches.keys() permanece pendente
    (mountedSelector.findByTag("button")[0].props.onClick as () => void)();
    await mountedSelector.flush();
    const switchPromise = (mountedSelector.findButton("Escola B").props.onClick as () => Promise<void>)();

    // Aguarda microtasks até a API switch-school resolver e travar na limpeza de cache
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await mountedTurma.flush();

    expect(preSaveSignal?.aborted).toBe(true);
    expect(mountedTurma.getText()).toContain("Alternando instituição...");
    expect(onNavigate).not.toHaveBeenCalled();

    // Resposta atrasada de A chega enquanto limpeza de cache ainda está pendente
    resolveDelayedPreSave(
      new Response(JSON.stringify({ success: true, trimesterRecord: boardA.trimesters[0] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await savePromise;
    expect(onTrimesterUpdated).not.toHaveBeenCalled();
    expect(onNotify).not.toHaveBeenCalled();

    // Limpeza de cache conclui e navegação para /conselho-classe é executada
    resolveCacheClear([]);
    await switchPromise;
    await new Promise((r) => setTimeout(r, 10));
    expect(onNavigate).toHaveBeenCalledWith("/conselho-classe");

    delete (globalThis as unknown as Record<string, unknown>).caches;
    delete (window as unknown as Record<string, unknown>).caches;
    mountedSelector.unmount();
    mountedPre.unmount();
    mountedTurma.unmount();
  });
});

// ============================================================================
// PARTE 2: Integração Real em PostgreSQL 16 Sintético (/redeativa_phase01_synthetic)
// ============================================================================
const hasIsolatedDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return (
      process.env.REDEATIVA_TEST_ISOLATED_DB === "1" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/redeativa_phase01_synthetic"
    );
  } catch {
    return false;
  }
})();

const NET_ID = "syn-net-cc-iso";
const SCHOOL_A_ID = "syn-cc-iso-school-a";
const SCHOOL_B_ID = "syn-cc-iso-school-b";
const CG_A_ID = "syn-cc-iso-cg-a";
const CG_B_ID = "syn-cc-iso-cg-b";
const STU_A_ID = "syn-cc-iso-stu-a";
const STU_B_ID = "syn-cc-iso-stu-b";
const BOARD_A_ID = "syn-cc-iso-board-a";
const BOARD_B_ID = "syn-cc-iso-board-b";
const SUBJ_A_ID = "syn-cc-iso-subj-a";
const SUBJ_B_ID = "syn-cc-iso-subj-b";

const SUPER_USER_ID = "syn-cc-iso-super";
const GESTOR_USER_ID = "syn-cc-iso-gestor";
const SEMEC_USER_ID = "syn-cc-iso-semec";
const ALL_USER_IDS = [SUPER_USER_ID, GESTOR_USER_ID, SEMEC_USER_ID];
const ALL_SCHOOL_IDS = [SCHOOL_A_ID, SCHOOL_B_ID];

function setActorSession(params: {
  userId: string;
  email: string;
  name: string;
  role: string;
  activeSchoolId: string;
  schools?: Array<{ schoolId: string; role: string; active: boolean }>;
  networks?: Array<{ networkId: string; role: string; active: boolean }>;
}) {
  hoisted.authSession = {
    user: {
      id: params.userId,
      email: params.email,
      name: params.name,
      role: params.role,
      active: true,
      schoolId: params.activeSchoolId,
      schools: params.schools ?? [],
      networks: params.networks ?? [],
    },
  };
  hoisted.cookiesMap.set("active_school_id", params.activeSchoolId);
}

async function cleanupFixtures() {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ schoolId: { in: ALL_SCHOOL_IDS } }, { userId: { in: ALL_USER_IDS } }],
    },
  });
  await prisma.pedagogicalMinute.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.studentCouncilSubjectEntry.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.studentCouncilCard.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.classCouncilTrimester.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.classCouncilSubject.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.classCouncilBoard.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.student.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.classGroup.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.userNetwork.deleteMany({
    where: { OR: [{ networkId: NET_ID }, { userId: { in: ALL_USER_IDS } }] },
  });
  await prisma.userSchool.deleteMany({
    where: {
      OR: [{ schoolId: { in: ALL_SCHOOL_IDS } }, { userId: { in: ALL_USER_IDS } }],
    },
  });
  await prisma.user.deleteMany({
    where: { id: { in: ALL_USER_IDS } },
  });
  await prisma.school.deleteMany({
    where: { id: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.educationNetwork.deleteMany({
    where: { id: NET_ID },
  });
  for (const sid of ALL_SCHOOL_IDS) {
    invalidateSchoolCache(sid);
  }
}

describe.skipIf(!hasIsolatedDb)(
  "Conselho de Classe — Isolamento Estrito por Escola Ativa em PostgreSQL 16 Real",
  () => {
    beforeAll(async () => {
      await cleanupFixtures();

      await prisma.educationNetwork.create({
        data: {
          id: NET_ID,
          name: "Rede Municipal Sintética Isolamento",
          shortName: "SEMEC-ISO",
          city: "Ponta Grossa",
          state: "PR",
          active: true,
        },
      });

      await prisma.school.createMany({
        data: [
          {
            id: SCHOOL_A_ID,
            name: "Colégio Sintético Alpha",
            inepCode: "99881001",
            city: "Ponta Grossa",
            state: "PR",
            network: "MUNICIPAL",
            networkId: NET_ID,
            active: true,
            settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
          },
          {
            id: SCHOOL_B_ID,
            name: "Colégio Sintético Beta",
            inepCode: "99881002",
            city: "Ponta Grossa",
            state: "PR",
            network: "MUNICIPAL",
            networkId: NET_ID,
            active: true,
            settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
          },
        ],
      });

      await prisma.classGroup.createMany({
        data: [
          { id: CG_A_ID, schoolId: SCHOOL_A_ID, name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
          { id: CG_B_ID, schoolId: SCHOOL_B_ID, name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
        ],
      });

      await prisma.student.createMany({
        data: [
          { id: STU_A_ID, schoolId: SCHOOL_A_ID, classGroupId: CG_A_ID, name: "Estudante Exclusivo Alpha", cgm: "998810001", phone: "42900000001", active: true },
          { id: STU_B_ID, schoolId: SCHOOL_B_ID, classGroupId: CG_B_ID, name: "Estudante Exclusivo Beta", cgm: "998820001", phone: "42900000002", active: true },
        ],
      });

      await prisma.classCouncilBoard.createMany({
        data: [
          {
            id: BOARD_A_ID,
            schoolId: SCHOOL_A_ID,
            classGroupId: CG_A_ID,
            year: 2026,
          },
          {
            id: BOARD_B_ID,
            schoolId: SCHOOL_B_ID,
            classGroupId: CG_B_ID,
            year: 2026,
          },
        ],
      });

      await prisma.classCouncilSubject.createMany({
        data: [
          { id: SUBJ_A_ID, boardId: BOARD_A_ID, schoolId: SCHOOL_A_ID, name: "Matemática Alpha", displayOrder: 0, active: true },
          { id: SUBJ_B_ID, boardId: BOARD_B_ID, schoolId: SCHOOL_B_ID, name: "Matemática Beta", displayOrder: 0, active: true },
        ],
      });

      await prisma.classCouncilTrimester.createMany({
        data: [
          {
            id: "syn-cc-iso-tri-a-1",
            boardId: BOARD_A_ID,
            schoolId: SCHOOL_A_ID,
            trimester: 1,
            status: "IN_PROGRESS",
            positivePoints: "Dado íntegro Alpha",
            preCouncilJson: JSON.stringify({
              version: 1,
              periodLabel: "1º Trimestre",
              objectiveText: "Objetivo Alpha",
              responsiblePedagogueName: "Pedagoga Alpha",
              responsiblePedagogueRole: "Pedagoga",
              conversations: [
                {
                  id: "conv-iso-a-1",
                  subjectId: SUBJ_A_ID,
                  subjectName: "Matemática Alpha",
                  teacherName: "Docente Portal",
                  teacherEmail: "docente.portal@escola.pr.gov.br",
                  monitoredStudentIds: [],
                  monitoredStudentsNotes: "Acompanhamento Alpha",
                  agreements: "Combinado Alpha",
                  conversationStatus: "PENDING",
                  conversationDate: null,
                  teacherSubmittedAt: null,
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
          {
            id: "syn-cc-iso-tri-b-1",
            boardId: BOARD_B_ID,
            schoolId: SCHOOL_B_ID,
            trimester: 1,
            status: "IN_PROGRESS",
            positivePoints: "Dado inicial Beta",
          },
        ],
      });

      await prisma.studentCouncilCard.createMany({
        data: [
          { id: "syn-cc-iso-card-a", boardId: BOARD_A_ID, schoolId: SCHOOL_A_ID, studentId: STU_A_ID, enrollmentStatus: "MATRICULADO", tags: [] },
          { id: "syn-cc-iso-card-b", boardId: BOARD_B_ID, schoolId: SCHOOL_B_ID, studentId: STU_B_ID, enrollmentStatus: "MATRICULADO", tags: [] },
        ],
      });

      await prisma.user.createMany({
        data: [
          { id: SUPER_USER_ID, email: "super.cc.iso@example.invalid", name: "SuperAdmin Sintético", role: "SUPERADMIN", active: true, schoolId: SCHOOL_A_ID },
          { id: GESTOR_USER_ID, email: "gestor.cc.iso@example.invalid", name: "Gestor Sintético", role: "GESTOR_ESCOLAR", active: true, schoolId: SCHOOL_A_ID },
          { id: SEMEC_USER_ID, email: "semec.cc.iso@example.invalid", name: "Semec ReadOnly", role: "GESTAO_SECRETARIA", active: true, schoolId: null },
        ],
      });

      await prisma.userSchool.createMany({
        data: [
          { userId: GESTOR_USER_ID, schoolId: SCHOOL_A_ID, role: "GESTOR_ESCOLAR", active: true },
          { userId: GESTOR_USER_ID, schoolId: SCHOOL_B_ID, role: "GESTOR_ESCOLAR", active: true },
        ],
      });

      await prisma.userNetwork.create({
        data: { userId: SEMEC_USER_ID, networkId: NET_ID, role: "GESTAO_SECRETARIA", active: true },
      });
    });

    afterAll(async () => {
      await cleanupFixtures();
    });

    it("SUPERADMIN no contexto da Escola B não acessa detalhe, impressão ou APIs de A (e A permanece intacta), mas opera normalmente em B", async () => {
      setActorSession({
        userId: SUPER_USER_ID,
        email: "super.cc.iso@example.invalid",
        name: "SuperAdmin Sintético",
        role: "SUPERADMIN",
        activeSchoolId: SCHOOL_B_ID,
      });

      // Reabertura da URL antiga de A no contexto de B falha em detalhe e impressão
      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: BOARD_A_ID }) })
      ).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(
        ConselhoPrintPage({ params: Promise.resolve({ boardId: BOARD_A_ID }) })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      // Índice lista apenas boardB
      const indexElement: any = await ConselhoClassePage({});
      expect(indexElement.props.schoolName).toBe("Colégio Sintético Beta");
      expect(indexElement.props.initialBoards.map((b: any) => b.id)).toEqual([BOARD_B_ID]);

      // Todas as APIs autenticadas por boardId recusam leitura/escrita de A com 403
      const boardParamsA = { params: Promise.resolve({ boardId: BOARD_A_ID }) };

      expect((await getBoardRoute(new Request("http://localhost/api/conselho-classe/a"), boardParamsA)).status).toBe(403);
      expect(
        (
          await patchBoardRoute(
            new Request("http://localhost/api/conselho-classe/a", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ councilTitle: "Tentativa Cruzada" }),
            }),
            boardParamsA
          )
        ).status
      ).toBe(403);
      expect(
        (
          await patchTrimesterRoute(
            new Request("http://localhost/api/conselho-classe/a/trimesters", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, positivePoints: "Sobrescrita Indevida" }),
            }),
            boardParamsA
          )
        ).status
      ).toBe(403);
      expect(
        (
          await putMatrixRoute(
            new Request("http://localhost/api/conselho-classe/a/matrix", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, entries: [] }),
            }),
            boardParamsA
          )
        ).status
      ).toBe(403);
      expect(
        (
          await putSubjectsRoute(
            new Request("http://localhost/api/conselho-classe/a/subjects", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ subjects: [{ name: "História", displayOrder: 1, active: true }] }),
            }),
            boardParamsA
          )
        ).status
      ).toBe(403);
      expect(
        (
          await patchStudentCardRoute(
            new Request("http://localhost/api/conselho-classe/a/students/x", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, enrollmentStatus: "MATRICULADO" }),
            }),
            { params: Promise.resolve({ boardId: BOARD_A_ID, studentId: STU_A_ID }) }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await postImportPdfRoute(
            new Request("http://localhost/api/conselho-classe/a/import-pdf", { method: "POST" }),
            boardParamsA
          )
        ).status
      ).toBe(403);
      expect(
        (
          await postGenerateMinuteRoute(
            new Request("http://localhost/api/conselho-classe/a/generate-minute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source: "PRE_COUNCIL", trimester: 1 }),
            }),
            boardParamsA
          )
        ).status
      ).toBe(403);
      expect(
        (
          await postTeacherLinkRoute(
            new Request("http://localhost/api/conselho-classe/a/teacher-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, expiresInDays: 7 }),
            }),
            boardParamsA
          )
        ).status
      ).toBe(403);
      expect(
        (
          await postPreCouncilLinkRoute(
            new Request("http://localhost/api/conselho-classe/a/pre-council-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, expiresInDays: 7 }),
            }),
            boardParamsA
          )
        ).status
      ).toBe(403);

      // Operações legítimas em B funcionam e mantêm A intacto
      const detailB: any = await ConselhoTurmaPage({
        params: Promise.resolve({ boardId: BOARD_B_ID }),
      });
      expect(detailB.props.initialBoard.schoolId).toBe(SCHOOL_B_ID);
      expect(detailB.props.initialBoard.studentCards[0].student.name).toBe("Estudante Exclusivo Beta");

      const printB: any = await ConselhoPrintPage({
        params: Promise.resolve({ boardId: BOARD_B_ID }),
      });
      expect(printB.props.school.id).toBe(SCHOOL_B_ID);
      expect(printB.props.board.id).toBe(BOARD_B_ID);

      const patchTriBRes = await patchTrimesterRoute(
        new Request("http://localhost/api/conselho-classe/b/trimesters", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: 1,
            positivePoints: "Atualização legítima Beta",
          }),
        }),
        { params: Promise.resolve({ boardId: BOARD_B_ID }) }
      );
      expect(patchTriBRes.status).toBe(200);

      const [triA, triB] = await Promise.all([
        prisma.classCouncilTrimester.findUniqueOrThrow({ where: { id: "syn-cc-iso-tri-a-1" } }),
        prisma.classCouncilTrimester.findUniqueOrThrow({ where: { id: "syn-cc-iso-tri-b-1" } }),
      ]);
      expect(triA.positivePoints).toBe("Dado íntegro Alpha");
      expect(triB.positivePoints).toBe("Atualização legítima Beta");
    });

    it("GESTOR_ESCOLAR com vínculo em A e B e papel somente leitura (GESTAO_SECRETARIA) respeitam isolamento e permissões", async () => {
      // 1. GESTOR_ESCOLAR no contexto de B não acessa A
      setActorSession({
        userId: GESTOR_USER_ID,
        email: "gestor.cc.iso@example.invalid",
        name: "Gestor Sintético",
        role: "GESTOR_ESCOLAR",
        activeSchoolId: SCHOOL_B_ID,
        schools: [
          { schoolId: SCHOOL_A_ID, role: "GESTOR_ESCOLAR", active: true },
          { schoolId: SCHOOL_B_ID, role: "GESTOR_ESCOLAR", active: true },
        ],
      });

      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: BOARD_A_ID }) })
      ).rejects.toThrow("NEXT_NOT_FOUND");
      expect(
        (
          await getBoardRoute(new Request("http://localhost/api/conselho-classe/a"), {
            params: Promise.resolve({ boardId: BOARD_A_ID }),
          })
        ).status
      ).toBe(403);
      expect(
        (
          await getBoardRoute(new Request("http://localhost/api/conselho-classe/b"), {
            params: Promise.resolve({ boardId: BOARD_B_ID }),
          })
        ).status
      ).toBe(200);

      // 2. GESTAO_SECRETARIA (somente leitura na rede) lê B, não escreve em B e não acessa A
      setActorSession({
        userId: SEMEC_USER_ID,
        email: "semec.cc.iso@example.invalid",
        name: "Semec ReadOnly",
        role: "GESTAO_SECRETARIA",
        activeSchoolId: SCHOOL_B_ID,
        networks: [{ networkId: NET_ID, role: "GESTAO_SECRETARIA", active: true }],
      });

      const detailSemecB: any = await ConselhoTurmaPage({
        params: Promise.resolve({ boardId: BOARD_B_ID }),
      });
      expect(detailSemecB.props.canEdit).toBe(false);
      expect(detailSemecB.props.initialBoard.id).toBe(BOARD_B_ID);

      expect(
        (
          await getBoardRoute(new Request("http://localhost/api/conselho-classe/b"), {
            params: Promise.resolve({ boardId: BOARD_B_ID }),
          })
        ).status
      ).toBe(200);

      expect(
        (
          await patchTrimesterRoute(
            new Request("http://localhost/api/conselho-classe/b/trimesters", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, positivePoints: "Bloqueado ReadOnly" }),
            }),
            { params: Promise.resolve({ boardId: BOARD_B_ID }) }
          )
        ).status
      ).toBe(403);

      expect(
        (
          await getBoardRoute(new Request("http://localhost/api/conselho-classe/a"), {
            params: Promise.resolve({ boardId: BOARD_A_ID }),
          })
        ).status
      ).toBe(403);
      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: BOARD_A_ID }) })
      ).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("Portais docentes por token (SSR, POST e PUT) resolvem escola e conselho exclusivamente a partir da credencial HMAC validada", async () => {
      // Mesmo com cookie active_school_id = SCHOOL_B_ID na sessão, o token de A resolve A
      hoisted.cookiesMap.set("active_school_id", SCHOOL_B_ID);

      const teacherTokA = createCouncilTeacherToken({
        schoolId: SCHOOL_A_ID,
        boardId: BOARD_A_ID,
        trimester: 1,
        subjectId: SUBJ_A_ID,
        expiresInDays: 7,
      });

      const teacherSsr: any = await ProfessorConselhoPage({
        params: Promise.resolve({ token: teacherTokA.token }),
      });
      expect(teacherSsr.props.schoolName).toBe("Colégio Sintético Alpha");
      expect(teacherSsr.props.lockedSubjectName).toBe("Matemática Alpha");

      const teacherRes = await postTeacherPortalRoute(
        new Request("http://localhost/api/conselho-classe/teacher-portal/tok", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-synthetic-google-token" }),
        }),
        { params: Promise.resolve({ token: teacherTokA.token }) }
      );
      expect(teacherRes.status).toBe(200);
      const teacherJson = await teacherRes.json();
      expect(teacherJson.council.boardId).toBe(BOARD_A_ID);
      expect(teacherJson.council.schoolName).toBe("Colégio Sintético Alpha");

      const teacherPutRes = await putTeacherPortalRoute(
        new Request("http://localhost/api/conselho-classe/teacher-portal/tok", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "valid-synthetic-google-token",
            subjectId: SUBJ_A_ID,
            entries: [
              {
                studentId: STU_A_ID,
                descriptorCodes: [1],
              },
            ],
          }),
        }),
        { params: Promise.resolve({ token: teacherTokA.token }) }
      );
      expect(teacherPutRes.status).toBe(200);

      const preTokA = createPreCouncilTeacherToken({
        schoolId: SCHOOL_A_ID,
        boardId: BOARD_A_ID,
        trimester: 1,
        conversationId: null,
        expiresInDays: 7,
      });

      const preSsr: any = await ProfessorPreConselhoPage({
        params: Promise.resolve({ token: preTokA.token }),
      });
      expect(preSsr.props.schoolName).toBe("Colégio Sintético Alpha");
      expect(preSsr.props.classNameLabel).toBe("6º Ano A");

      const preRes = await postPreCouncilPortalRoute(
        new Request("http://localhost/api/conselho-classe/pre-council-portal/tok", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-synthetic-google-token" }),
        }),
        { params: Promise.resolve({ token: preTokA.token }) }
      );
      expect(preRes.status).toBe(200);
      const preJson = await preRes.json();
      expect(preJson.preCouncil.boardId).toBe(BOARD_A_ID);
      expect(preJson.preCouncil.schoolName).toBe("Colégio Sintético Alpha");

      const prePutRes = await putPreCouncilPortalRoute(
        new Request("http://localhost/api/conselho-classe/pre-council-portal/tok", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "valid-synthetic-google-token",
            conversationId: "conv-iso-a-1",
            teacherComment: "Ciência docente em Alpha",
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token: preTokA.token }) }
      );
      expect(prePutRes.status).toBe(200);

      const [entriesA, entriesB] = await Promise.all([
        prisma.studentCouncilSubjectEntry.count({ where: { schoolId: SCHOOL_A_ID } }),
        prisma.studentCouncilSubjectEntry.count({ where: { schoolId: SCHOOL_B_ID } }),
      ]);
      expect(entriesA).toBe(1);
      expect(entriesB).toBe(0);
    });
  }
);
