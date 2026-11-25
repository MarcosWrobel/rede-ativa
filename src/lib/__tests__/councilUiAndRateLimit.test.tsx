import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type React from "react";

const hoisted = vi.hoisted(() => ({
  rateLimitCount: 61,
  rateLimitResetMs: 37_000,
  verifyEscolaGoogleIdToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [
      {
        count: hoisted.rateLimitCount,
        expiresAt: new Date(Date.now() + hoisted.rateLimitResetMs),
      },
    ]),
    rateLimitBucket: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

vi.mock("@/lib/escolaGoogleVerify", () => ({
  verifyEscolaGoogleIdToken: hoisted.verifyEscolaGoogleIdToken,
}));

import {
  POST as postTeacherPortal,
  PUT as putTeacherPortal,
} from "@/app/api/conselho-classe/teacher-portal/[token]/route";
import {
  POST as postPreCouncilPortal,
  PUT as putPreCouncilPortal,
} from "@/app/api/conselho-classe/pre-council-portal/[token]/route";
import {
  createCouncilTeacherToken,
  createPreCouncilTeacherToken,
} from "@/lib/councilTeacherToken";
import CouncilPostMeetingTab from "@/components/conselho/CouncilPostMeetingTab";
import CouncilPreCouncilConversationsView from "@/components/conselho/CouncilPreCouncilConversationsView";
import CouncilPreCouncilTab from "@/components/conselho/CouncilPreCouncilTab";
import CouncilStudentFichaModal from "@/components/conselho/CouncilStudentFichaModal";
import {
  buildPreCouncilStudentAlertsBySubject,
  getMatrixFillStatsBySubject,
  parsePreCouncilData,
} from "@/components/conselho/preCouncilUtils";
import CouncilSerePdfImportModal from "@/components/conselho/CouncilSerePdfImportModal";
import type {
  CouncilBoardDetailRecord,
  CouncilStudentCardRecord,
  CouncilTrimesterRecord,
} from "@/components/conselho/types";
import type { CouncilSerePdfPreviewResult } from "@/services/classCouncilSerePdfService";
import {
  extractNodeText,
  installBrowserShims,
  mountReactComponent,
  type BrowserShimHandle,
} from "./helpers/reactNodeHarness";

function buildBoardStub(): CouncilBoardDetailRecord {
  return {
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
    seatingMapLayoutJson: null,
    classGroup: {
      id: "cg-1",
      name: "6º Ano A",
      segment: "FUNDAMENTAL",
      shift: "NOITE",
    },
    subjects: [
      {
        id: "subj-mat",
        schoolId: "school-a",
        boardId: "board-1",
        name: "Matemática",
        teacherName: "Prof. Marcos",
        teacherEmail: "prof@escola.pr.gov.br",
        displayOrder: 0,
        active: true,
      },
    ],
    trimesters: [],
    studentCards: [],
  };
}

function buildStudentCardStub(): CouncilStudentCardRecord {
  return {
    id: "card-1",
    schoolId: "school-a",
    boardId: "board-1",
    studentId: "stu-1",
    enrollmentStatus: "ATIVO",
    externalEvalEd1Percent: null,
    externalEvalEd2Percent: null,
    externalEvalEd3Percent: null,
    tags: [],
    hasSensitiveHealthTag: false,
    trimester1Opinion: "Acompanhar evolução.",
    trimester2Opinion: null,
    trimester3Opinion: null,
    trimester1BelowAvgJson: JSON.stringify([
      { subjectId: null, subjectName: "Reforço Escolar", grade: 4.5 },
      { subjectId: "subj-mat", subjectName: "Matemática", grade: 5.0 },
    ]),
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
  };
}

function buildSerePreviewStub(): CouncilSerePdfPreviewResult {
  return {
    boardId: "board-1",
    classGroupName: "6º Ano A",
    classGroupShift: "NOITE",
    detectedShift: "TARDE",
    year: 2026,
    files: [
      {
        fileName: "fgb.pdf",
        schoolName: "Escola Estadual Modelo",
        pageCount: 1,
        course: "ENSINO MEDIO FGB",
        grade: "3ª Série",
        shift: "Tarde",
        classCode: "2",
        year: 2026,
        reportDate: "18/11/2026",
      },
    ],
    subjects: [
      {
        rawHeader: "MATEMATICA",
        name: "Matemática",
        matchKey: "MATEMATICA",
        status: "existing",
        existingSubjectId: "subj-mat",
        sourceFiles: ["fgb.pdf"],
      },
      {
        rawHeader: "FISICA",
        name: "Física",
        matchKey: "FISICA",
        status: "new",
        existingSubjectId: null,
        sourceFiles: ["fgb.pdf"],
      },
    ],
    students: [
      {
        rowNumber: 1,
        pdfName: "ANA CLARA SOUZA",
        matchedStudentId: "stu-1",
        matchedStudentName: "Ana Clara Souza",
        gradesCount: 3,
        belowAverageCount: 1,
        hasAnyGrade: true,
        status: "matched",
      },
      {
        rowNumber: 2,
        pdfName: "JOAO SILVA",
        matchedStudentId: null,
        matchedStudentName: null,
        gradesCount: 0,
        belowAverageCount: 0,
        hasAnyGrade: false,
        status: "ambiguous",
      },
    ],
    trimestersTouched: [1],
    summary: {
      filesCount: 1,
      subjectsTotal: 2,
      subjectsMatched: 1,
      subjectsToCreate: 1,
      studentsInPdf: 2,
      studentsMatched: 1,
      studentsUnmatched: 1,
      studentsWithoutGrades: 0,
      gradesToImport: 3,
      belowAverageGrades: 1,
    },
    warnings: [
      'fgb.pdf: nome duplicado no PDF ("JOAO SILVA") tratado como homônimo e ignorado para evitar mistura de notas.',
    ],
  };
}

describe("Conselho de Classe — Rate Limit 429 dos Portais e Interações de UI", () => {
  let shims: BrowserShimHandle;
  let originalFetch: typeof globalThis.fetch;
  const unmounts: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    shims = installBrowserShims();
    originalFetch = globalThis.fetch;
    vi.stubEnv("AUTH_SECRET", "ui-rate-limit-secret-32-chars-minimum");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    hoisted.rateLimitCount = 61;
    hoisted.rateLimitResetMs = 37_000;
  });

  afterEach(() => {
    while (unmounts.length > 0) {
      unmounts.pop()?.();
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    shims.restore();
  });

  it("retorna HTTP 429 com Retry-After em POST/PUT de teacher-portal e pre-council-portal quando o limite é excedido", async () => {
    const { token: teacherToken } = createCouncilTeacherToken({
      schoolId: "school-a",
      boardId: "board-1",
      trimester: 1,
      subjectId: "subj-mat",
    });
    const { token: preToken } = createPreCouncilTeacherToken({
      schoolId: "school-a",
      boardId: "board-1",
      trimester: 1,
      conversationId: "conv-1",
    });

    const reqInit = (method: "POST" | "PUT") => ({
      method,
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.77",
      },
      body: JSON.stringify({ googleIdToken: "id-token-qualquer" }),
    });

    const responses = await Promise.all([
      postTeacherPortal(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherToken}`, reqInit("POST")),
        { params: Promise.resolve({ token: teacherToken }) }
      ),
      putTeacherPortal(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherToken}`, reqInit("PUT")),
        { params: Promise.resolve({ token: teacherToken }) }
      ),
      postPreCouncilPortal(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken}`, reqInit("POST")),
        { params: Promise.resolve({ token: preToken }) }
      ),
      putPreCouncilPortal(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken}`, reqInit("PUT")),
        { params: Promise.resolve({ token: preToken }) }
      ),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(429);
      const retryHeader = Number.parseInt(res.headers.get("retry-after") || "0", 10);
      expect(retryHeader).toBeGreaterThanOrEqual(36);
      expect(retryHeader).toBeLessThanOrEqual(38);
      expect(res.headers.get("x-ratelimit-remaining")).toBe("0");

      const body = (await res.json()) as { error?: string; retryAfter?: number };
      expect(body.retryAfter).toBeGreaterThanOrEqual(36);
      expect(body.error).toContain("aguarde");
    }

    expect(hoisted.verifyEscolaGoogleIdToken).not.toHaveBeenCalled();
  });

  it("CouncilPostMeetingTab: preserva datas YYYY-MM-DD sem deslocamento e propaga linkedMinuteId após gerar minuta", async () => {
    const initialTrimester: CouncilTrimesterRecord = {
      id: "tri-1",
      schoolId: "school-a",
      boardId: "board-1",
      trimester: 1,
      status: "IN_PROGRESS",
      positivePoints: null,
      attentionPoints: null,
      plannedActions: null,
      preCouncilJson: null,
      postCouncilHeldAt: "2026-05-10T00:00:00.000Z",
      postCouncilAdvances: "Participação em equipe",
      postCouncilWhatWorked: "Atividades práticas",
      postCouncilRecognizedAttitudes: null,
      postCouncilCriticalSubjects: null,
      postCouncilPerformanceFactors: null,
      postCouncilBehaviorAttendance: null,
      postCouncilWhatToImprove: null,
      postCouncilHowTeachersCanHelp: null,
      postCouncilCommitments: null,
      postCouncilActionItemsJson: JSON.stringify([
        {
          number: 1,
          description: "Reforço semanal",
          responsible: "ESCOLA",
          dueDate: "2026-05-15",
        },
      ]),
      linkedMinuteId: null,
      updatedByName: null,
      updatedByEmail: null,
      updatedAt: "2026-11-20T10:00:00Z",
    };

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/trimesters") && init?.method === "PATCH") {
        const sent = JSON.parse(String(init.body));
        expect(sent.postCouncilHeldAt).toBe("2026-05-10");
        expect(sent.postCouncilActionItems[0].dueDate).toBe("2026-05-15");
        return new Response(
          JSON.stringify({
            success: true,
            trimesterRecord: {
              ...initialTrimester,
              postCouncilHeldAt: "2026-05-10T03:00:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/generate-minute") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            success: true,
            minute: { id: "min-post-99" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const onTrimesterUpdated = vi.fn();
    const onNotify = vi.fn();

    const app = mountReactComponent(CouncilPostMeetingTab, {
      boardId: "board-1",
      activeTrimester: 1,
      trimesterRecord: initialTrimester,
      onTrimesterUpdated,
      onNotify,
    });
    unmounts.push(app.unmount);

    const heldAtInput = app.findById("post-council-date");
    const dueDateInput = app.findByAriaLabel("Prazo do encaminhamento 1");
    expect(heldAtInput.props.value).toBe("2026-05-10");
    expect(dueDateInput.props.value).toBe("2026-05-15");

    (app.findButton("Gerar minuta").props.onClick as () => void)();
    await app.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTrimesterUpdated).toHaveBeenCalledTimes(2);
    expect(onTrimesterUpdated.mock.calls[1][0].linkedMinuteId).toBe("min-post-99");
    expect(onNotify).toHaveBeenCalledWith("Minuta gerada no Livro de Atas.", "success");
    expect(app.getText()).toContain("Minuta vinculada ao Livro de Atas deste trimestre.");
  });

  it("CouncilStudentFichaModal: aplica escala 0..10 e preserva itens manuais (subjectId: null) em Componentes abaixo da média", async () => {
    const initialCard = buildStudentCardStub();
    let submittedPayload: any = null;

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      submittedPayload = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          success: true,
          card: {
            ...initialCard,
            trimester1BelowAvgJson: JSON.stringify(submittedPayload.belowAverageSubjects),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const onCardUpdated = vi.fn();
    const onNotify = vi.fn();

    const app = mountReactComponent(CouncilStudentFichaModal, {
      open: true,
      onClose: vi.fn(),
      board: buildBoardStub(),
      card: initialCard,
      activeTrimester: 1,
      hideSensitiveTags: false,
      onCardUpdated,
      onNotify,
    });
    unmounts.push(app.unmount);
    await app.flush();

    const existingGradeInput = app.findByAriaLabel("Nota em Reforço Escolar");
    expect(existingGradeInput.props.min).toBe(0);
    expect(existingGradeInput.props.max).toBe(10);
    expect(existingGradeInput.props.placeholder).toBe("0,0 a 10,0");

    // Adiciona duas linhas manuais (subjectId: null) e testa clamp 0..10 no envio
    (app.findButton("Adicionar componente").props.onClick as () => void)();
    await app.flush();
    (app.findButton("Adicionar componente").props.onClick as () => void)();
    await app.flush();

    (app.findByAriaLabel("Nome do componente 3").props.onChange as (e: unknown) => void)({
      target: { value: "Oficina de Redação" },
    });
    await app.flush();
    (app.findByAriaLabel("Nome do componente 4").props.onChange as (e: unknown) => void)({
      target: { value: "Clube de Leitura" },
    });
    await app.flush();

    (app.findByAriaLabel("Nota em Oficina de Redação").props.onChange as (e: unknown) => void)({
      target: { value: "15.7" },
    });
    (app.findByAriaLabel("Nota em Clube de Leitura").props.onChange as (e: unknown) => void)({
      target: { value: "-2.5" },
    });
    await app.flush();

    const form = app.findByTag("form")[0];
    (form.props.onSubmit as (e: { preventDefault: () => void }) => void)({
      preventDefault: () => {},
    });
    await app.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submittedPayload.belowAverageSubjects).toEqual([
      { subjectId: null, subjectName: "Reforço Escolar", grade: 4.5 },
      { subjectId: "subj-mat", subjectName: "Matemática", grade: 5 },
      { subjectId: null, subjectName: "Oficina de Redação", grade: 10 },
      { subjectId: null, subjectName: "Clube de Leitura", grade: 0 },
    ]);
    expect(onCardUpdated).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith("Ficha registrada.", "success");
  });

  it("CouncilSerePdfImportModal: exibe Homônimo na prévia e exige checkbox explícito para enviar updateClassShift='true'", async () => {
    const previewStub = buildSerePreviewStub();
    const applyForms: Array<{ mode: FormDataEntryValue | null; updateClassShift: FormDataEntryValue | null }> = [];

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const fd = init?.body as FormData;
      const mode = fd.get("mode");
      if (mode === "preview") {
        return new Response(JSON.stringify({ success: true, preview: previewStub }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      applyForms.push({
        mode,
        updateClassShift: fd.get("updateClassShift"),
      });
      return new Response(
        JSON.stringify({
          success: true,
          board: buildBoardStub(),
          summary: { evaluationsUpserted: 3, studentsMatched: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const syntheticPdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "fgb.pdf", {
      type: "application/pdf",
    });

    // Montagem 1: confirma SEM marcar checkbox de turno -> updateClassShift ausente no FormData
    const app1 = mountReactComponent(CouncilSerePdfImportModal, {
      open: true,
      onClose: vi.fn(),
      boardId: "board-1",
      classNameLabel: "6º Ano A",
      onBoardUpdated: vi.fn(),
      onNotify: vi.fn(),
    });
    unmounts.push(app1.unmount);

    (app1.findById("sere-council-pdf-input").props.onChange as (e: unknown) => void)({
      target: { files: [syntheticPdf] },
    });
    await app1.flush();

    (app1.findButton("Analisar PDF").props.onClick as () => void)();
    await app1.flush();

    expect(app1.getText()).toContain("Homônimo");
    expect(app1.getText()).toContain("Atualizar turno da turma");

    const shiftCheckbox1 = app1.findAll(
      (el) => el.type === "input" && el.props.type === "checkbox"
    )[0];
    expect(shiftCheckbox1.props.checked).toBe(false);

    (app1.findButton("Confirmar importação").props.onClick as () => void)();
    await app1.flush();

    expect(applyForms[0]).toEqual({ mode: "apply", updateClassShift: null });

    // Montagem 2: marca checkbox explicitamente -> updateClassShift="true"
    const app2 = mountReactComponent(CouncilSerePdfImportModal, {
      open: true,
      onClose: vi.fn(),
      boardId: "board-1",
      classNameLabel: "6º Ano A",
      onBoardUpdated: vi.fn(),
      onNotify: vi.fn(),
    });
    unmounts.push(app2.unmount);

    (app2.findById("sere-council-pdf-input").props.onChange as (e: unknown) => void)({
      target: { files: [syntheticPdf] },
    });
    await app2.flush();

    (app2.findButton("Analisar PDF").props.onClick as () => void)();
    await app2.flush();

    const shiftCheckbox2 = app2.findAll(
      (el) => el.type === "input" && el.props.type === "checkbox"
    )[0];
    (shiftCheckbox2.props.onChange as (e: unknown) => void)({
      target: { checked: true },
    });
    await app2.flush();

    const shiftLabelNode = app2.findAll(
      (el) => el.type === "label" && extractNodeText(el).includes("Atualizar turno")
    )[0];
    expect(shiftLabelNode).toBeDefined();

    (app2.findButton("Confirmar importação").props.onClick as () => void)();
    await app2.flush();

    expect(applyForms[1]).toEqual({ mode: "apply", updateClassShift: "true" });
  });

  it("CouncilPreCouncilTab: sanitiza studentIds órfãos no payload/UI e sinaliza necessidade de salvar para liberar ciência docente", async () => {
    const board = buildBoardStub();
    board.subjects = [
      {
        id: "subj-arte",
        schoolId: "school-a",
        boardId: "board-1",
        name: "Arte",
        teacherName: "Prof. Marcos",
        teacherEmail: "prof@escola.pr.gov.br",
        displayOrder: 0,
        active: true,
      },
      {
        id: "subj-mat",
        schoolId: "school-a",
        boardId: "board-1",
        name: "Matemática",
        teacherName: "Prof. Helena",
        teacherEmail: "helena@escola.pr.gov.br",
        displayOrder: 1,
        active: true,
      },
    ];
    board.studentCards = [buildStudentCardStub()];

    const initialPreJson = JSON.stringify({
      version: 1,
      periodLabel: "1º Trimestre",
      objectiveText: "Objetivo",
      responsiblePedagogueName: "Pedagoga Ana",
      responsiblePedagogueRole: "Pedagoga Responsável",
      conversations: [
        {
          id: "subj-arte",
          subjectId: "subj-arte",
          subjectName: "Arte",
          teacherName: "Prof. Marcos",
          teacherEmail: "prof@escola.pr.gov.br",
          monitoredStudentIds: [],
          monitoredStudentsNotes: "",
          agreements: "",
          conversationStatus: "PENDING",
          conversationDate: null,
          teacherSubmittedAt: null,
          digitalAckEmail: null,
          digitalAckName: null,
          digitalAckAt: null,
        },
        {
          id: "subj-mat",
          subjectId: "subj-mat",
          subjectName: "Matemática",
          teacherName: "Prof. Helena",
          teacherEmail: "helena@escola.pr.gov.br",
          monitoredStudentIds: ["stu-orphan-ghost", "stu-1"],
          monitoredStudentsNotes: "",
          agreements: "",
          conversationStatus: "PENDING",
          conversationDate: null,
          teacherSubmittedAt: null,
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
    });

    const initialTrimester: CouncilTrimesterRecord = {
      id: "tri-1",
      schoolId: "school-a",
      boardId: "board-1",
      trimester: 1,
      status: "IN_PROGRESS",
      positivePoints: null,
      attentionPoints: null,
      plannedActions: null,
      preCouncilJson: initialPreJson,
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
      updatedAt: "2026-11-24T20:00:00Z",
    };

    let sentPreCouncilPayload: any = null;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sentPreCouncilPayload = body.preCouncil;
      const savedJson = JSON.stringify({
        ...body.preCouncil,
        conversations: body.preCouncil.conversations.map((c: any) => ({
          ...c,
          digitalAckEmail: null,
          digitalAckName: null,
          digitalAckAt: null,
        })),
      });
      return new Response(
        JSON.stringify({
          success: true,
          trimesterRecord: {
            ...initialTrimester,
            preCouncilJson: savedJson,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const onNotify = vi.fn();
    let currentTrimester = initialTrimester;

    const app = mountReactComponent(CouncilPreCouncilTab, {
      board,
      activeTrimester: 1,
      trimesterRecord: currentTrimester,
      currentUserName: "Pedagoga Ana",
      hideSensitiveTags: false,
      onOpenStudentModal: vi.fn(),
      onOpenSubjectsModal: vi.fn(),
      onTrimesterUpdated: (updated) => {
        currentTrimester = updated;
      },
      onMatrixSaved: async () => {},
      onNotify,
    });
    unmounts.push(app.unmount);
    await app.flush();

    // 1. CouncilPreCouncilTab sanitiza studentIds órfãos já na hidratação passada à view filha
    const convViewEl = app.findAll((el) => el.type === CouncilPreCouncilConversationsView)[0];
    expect(convViewEl).toBeDefined();
    const initialChildDraft = convViewEl.props.draft as ReturnType<typeof parsePreCouncilData>;
    expect(initialChildDraft?.conversations[1].monitoredStudentIds).toEqual(["stu-1"]);

    // 2. Simula marcar "Realizada" em Arte e salvar em CouncilPreCouncilTab
    const onUpdateDraftFromChild = convViewEl.props.onUpdateDraft as (
      updater: (prev: NonNullable<ReturnType<typeof parsePreCouncilData>>) => NonNullable<ReturnType<typeof parsePreCouncilData>>
    ) => void;
    onUpdateDraftFromChild((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c, idx) =>
        idx === 0 ? { ...c, conversationStatus: "COMPLETED", conversationDate: "2026-11-24" } : c
      ),
    }));
    await app.flush();

    (app.findButton("Salvar pré-conselho").props.onClick as () => void)();
    await app.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentPreCouncilPayload.conversations[1].monitoredStudentIds).toEqual(["stu-1"]);
    expect(onNotify).toHaveBeenCalledWith("Pré-Conselho salvo.", "success");

    // 3. CouncilPreCouncilConversationsView oculta contagens órfãs e sinaliza necessidade de salvar
    const rawPreBeforeSave = parsePreCouncilData(initialPreJson)!;
    const savedMapBeforeSave = new Map(rawPreBeforeSave.conversations.map((c) => [c.id, c]));
    let viewDraft = parsePreCouncilData(initialPreJson)!;

    const alertsBundle = buildPreCouncilStudentAlertsBySubject(board, 1);
    const matrixStats = getMatrixFillStatsBySubject(board, 1);

    const viewApp = mountReactComponent(CouncilPreCouncilConversationsView, {
      board,
      activeTrimester: 1,
      draft: viewDraft,
      selectedConvId: "subj-arte",
      onSelectConvId: vi.fn(),
      onUpdateDraft: (updater) => {
        viewDraft = updater(viewDraft);
      },
      onSyncSubjects: vi.fn(),
      onAddCustomRow: vi.fn(),
      onRemoveConversation: vi.fn(),
      onOpenUnifiedTeacherLink: vi.fn(),
      onMatrixSaved: async () => {},
      onNotify: vi.fn(),
      alertsBundle,
      matrixStatsBySubjectId: matrixStats,
      savedConversationsById: savedMapBeforeSave,
      hideSensitiveTags: false,
    });
    unmounts.push(viewApp.unmount);

    // Matemática tinha ["stu-orphan-ghost", "stu-1"], mas exibição filtrada mostra apenas 1 em acomp.
    expect(viewApp.getText()).toContain("• 1 em acomp.");
    expect(viewApp.getText()).not.toContain("• 2 em acomp.");

    // Clicar em "Realizada" em Arte (sem salvar ainda) exibe aviso âmbar
    const markCompletedBtn = viewApp.findAll(
      (el) => el.type === "button" && extractNodeText(el) === "Realizada"
    )[0];
    expect(markCompletedBtn).toBeDefined();
    (markCompletedBtn.props.onClick as () => void)();
    await viewApp.updateProps({
      board,
      activeTrimester: 1,
      draft: viewDraft,
      selectedConvId: "subj-arte",
      onSelectConvId: vi.fn(),
      onUpdateDraft: (updater) => {
        viewDraft = updater(viewDraft);
      },
      onSyncSubjects: vi.fn(),
      onAddCustomRow: vi.fn(),
      onRemoveConversation: vi.fn(),
      onOpenUnifiedTeacherLink: vi.fn(),
      onMatrixSaved: async () => {},
      onNotify: vi.fn(),
      alertsBundle,
      matrixStatsBySubjectId: matrixStats,
      savedConversationsById: savedMapBeforeSave,
      hideSensitiveTags: false,
    });
    expect(viewApp.getText()).toContain("Salve o pré-conselho para liberar a ciência docente.");

    // Após salvar no servidor (savedConversationsById atualizado), exibe liberação confirmada
    const savedMapAfterSave = new Map(viewDraft.conversations.map((c) => [c.id, c]));
    await viewApp.updateProps({
      board,
      activeTrimester: 1,
      draft: viewDraft,
      selectedConvId: "subj-arte",
      onSelectConvId: vi.fn(),
      onUpdateDraft: (updater) => {
        viewDraft = updater(viewDraft);
      },
      onSyncSubjects: vi.fn(),
      onAddCustomRow: vi.fn(),
      onRemoveConversation: vi.fn(),
      onOpenUnifiedTeacherLink: vi.fn(),
      onMatrixSaved: async () => {},
      onNotify: vi.fn(),
      alertsBundle,
      matrixStatsBySubjectId: matrixStats,
      savedConversationsById: savedMapAfterSave,
      hideSensitiveTags: false,
    });
    expect(viewApp.getText()).toContain("Ciência docente liberada no link do professor.");
    expect(viewApp.getText()).not.toContain("Salve o pré-conselho para liberar a ciência docente.");
  });
});
