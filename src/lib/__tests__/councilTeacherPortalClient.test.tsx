import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ProfessorConselhoClient, {
  type TeacherPortalCouncilContext,
  type TeacherPortalPreloadedSession,
} from "@/app/conselho-classe/professor/[token]/ProfessorConselhoClient";
import ProfessorPreConselhoClient from "@/app/conselho-classe/pre-conselho/[token]/ProfessorPreConselhoClient";
import { loadTeacherPortalLocalDraft } from "@/components/conselho/preCouncilUtils";
import {
  installBrowserShims,
  mountReactComponent,
  type BrowserShimHandle,
} from "./helpers/reactNodeHarness";

function buildCouncilContext(overrides: { canConfirmAck?: boolean } = {}): TeacherPortalCouncilContext {
  return {
    boardId: "board-portal-1",
    year: 2026,
    trimester: 1,
    lockedSubjectId: "subj-mat",
    schoolName: "Escola Estadual Modelo",
    classGroup: {
      id: "cg-1",
      name: "6º Ano A",
      segment: "FUNDAMENTAL",
      shift: "MANHA",
    },
    trimesterStatus: "IN_PROGRESS",
    subjects: [
      {
        id: "subj-mat",
        name: "Matemática",
        teacherName: "Prof. Marcos",
        teacherEmail: "prof@escola.pr.gov.br",
        displayOrder: 0,
      },
    ],
    students: [
      {
        studentId: "stu-1",
        name: "Ana Clara Souza",
        cgm: null,
        enrollmentStatus: "ATIVO",
        attendancePercent: 92,
        subjectEntries: [
          {
            subjectId: "subj-mat",
            descriptorCodes: [],
            grade: null,
            updatedByEmail: null,
          },
        ],
      },
    ],
    preCouncil: {
      periodLabel: "1º Trimestre",
      objectiveText: "Alinhamento pedagógico trimestral.",
      responsiblePedagogueName: "Pedagoga Ana",
      responsiblePedagogueRole: "Pedagoga",
      synthesis: {
        mainDifficulties: "",
        priorityStudents: "",
        attendanceIssues: "",
        behaviorIssues: "",
        pedagogicalActions: "",
      },
      conversationsBySubjectId: {
        "subj-mat": {
          id: "conv-mat",
          subjectId: "subj-mat",
          subjectName: "Matemática",
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
          canConfirmAck: overrides.canConfirmAck ?? false,
        },
      },
    },
  };
}

function buildPreCouncilPayload(overrides: { canConfirm?: boolean } = {}) {
  return {
    boardId: "board-portal-1",
    year: 2026,
    trimester: 1 as const,
    lockedConversationId: "conv-mat",
    schoolName: "Escola Estadual Modelo",
    classGroup: {
      id: "cg-1",
      name: "6º Ano A",
      segment: "FUNDAMENTAL",
      shift: "MANHA",
    },
    periodLabel: "1º Trimestre",
    objectiveText: "Consulta de ciência docente.",
    responsiblePedagogueName: "Pedagoga Ana",
    responsiblePedagogueRole: "Pedagoga",
    conversations: [
      {
        id: "conv-mat",
        subjectId: "subj-mat",
        subjectName: "Matemática",
        teacherName: "Prof. Marcos",
        teacherEmail: "prof@escola.pr.gov.br",
        monitoredStudents: [],
        monitoredStudentsNotes: "",
        agreements: overrides.canConfirm ? "Retomada de conteúdos." : "",
        conversationStatus: overrides.canConfirm ? ("COMPLETED" as const) : ("PENDING" as const),
        conversationDate: overrides.canConfirm ? "2026-05-10" : null,
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
  };
}

describe("Portal Docente no Cliente — Polling, Backoff, 401, AbortController e Rascunho", () => {
  let shims: BrowserShimHandle;
  let originalFetch: typeof globalThis.fetch;
  const activeUnmounts: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    shims = installBrowserShims();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    while (activeUnmounts.length > 0) {
      activeUnmounts.pop()?.();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    shims.restore();
  });

  it("ProfessorConselhoClient: interrompe polling ao receber 401, exibe reautenticação e retorna ao login em Entrar novamente", async () => {
    const onLogout = vi.fn();
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Token Google expirado." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const preloadedSession: TeacherPortalPreloadedSession = {
      googleIdToken: "id-token-valido",
      verifiedEmail: "prof@escola.pr.gov.br",
      verifiedName: "Prof. Marcos",
      council: buildCouncilContext({ canConfirmAck: false }),
      suggestedSubjectId: "subj-mat",
      onLogout,
    };

    const app = mountReactComponent(ProfessorConselhoClient, {
      token: "token-teste-401",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      preloadedSession,
    });
    activeUnmounts.push(app.unmount);

    // Ativa Etapa 3 ("3. Envio e Ciência") para iniciar o polling automático
    (app.findButton("3. Envio e Ciência").props.onClick as () => void)();
    await app.flush();

    expect(fetchMock).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(15_000);
    await app.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(app.getText()).toContain("Sua validação Google expirou");
    expect(app.getText()).toContain("Sessão Google expirada");

    const reauthBtn = app.findButton("Entrar novamente");
    expect(reauthBtn).toBeDefined();

    // Avança tempo longo adicional garantindo que polling parou após 401
    await vi.advanceTimersByTimeAsync(120_000);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    (reauthBtn.props.onClick as () => void)();
    await app.flush();

    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(app.getText()).toContain("Conselho de Classe — Lançamento Docente");
  });

  it("ProfessorConselhoClient: respeita Retry-After em 429, aplica backoff exponencial, reseta em 200 e pausa em document.hidden", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify({ error: "Muitas requisições" }), {
          status: 429,
          headers: { "Retry-After": "45" },
        });
      }
      if (callIndex === 2) {
        return new Response(JSON.stringify({ error: "Muitas requisições" }), {
          status: 429,
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
          council: buildCouncilContext({ canConfirmAck: false }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const app = mountReactComponent(ProfessorConselhoClient, {
      token: "token-teste-429",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      preloadedSession: {
        googleIdToken: "id-token-valido",
        verifiedEmail: "prof@escola.pr.gov.br",
        verifiedName: "Prof. Marcos",
        council: buildCouncilContext({ canConfirmAck: false }),
        suggestedSubjectId: "subj-mat",
      },
    });
    activeUnmounts.push(app.unmount);

    (app.findButton("3. Envio e Ciência").props.onClick as () => void)();
    await app.flush();

    // Poll 1: base 15s -> 429 com Retry-After: 45
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Poll 2: deve aguardar 45_000ms (Retry-After: 45) -> recebe 429 sem Retry-After -> dobra para 90s
    await vi.advanceTimersByTimeAsync(44_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Poll 3: deve aguardar 90_000ms (45s * 2) -> recebe 200 OK -> reseta para 15s
    await vi.advanceTimersByTimeAsync(89_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Aba em segundo plano (document.hidden = true): não dispara fetch em 15s
    shims.documentState.hidden = true;
    await vi.advanceTimersByTimeAsync(15_000);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Retorna para primeiro plano: retoma polling no próximo ciclo de 15s
    shims.documentState.hidden = false;
    await vi.advanceTimersByTimeAsync(15_000);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("ProfessorConselhoClient: aborta polling via AbortController ao trocar etapa/desmontar e limpa rascunho local em handleLogoutTeacher", async () => {
    const signals: AbortSignal[] = [];
    const onLogout = vi.fn();

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) {
        signals.push(init.signal);
      }
      return new Promise<Response>(() => {
        // Permanece pendente para validar cancelamento via AbortController
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const app = mountReactComponent(ProfessorConselhoClient, {
      token: "token-teste-abort",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      preloadedSession: {
        googleIdToken: "id-token-valido",
        verifiedEmail: "prof@escola.pr.gov.br",
        verifiedName: "Prof. Marcos",
        council: buildCouncilContext({ canConfirmAck: false }),
        suggestedSubjectId: "subj-mat",
        onLogout,
      },
    });
    activeUnmounts.push(app.unmount);

    // 1. Preenche descritivo na Etapa 1 e confirma persistência de rascunho local
    (app.findButton("Preencher vazios: Atende").props.onClick as () => void)();
    await app.flush();

    const savedDraft = loadTeacherPortalLocalDraft(
      "board-portal-1",
      1,
      "subj-mat",
      "prof@escola.pr.gov.br"
    );
    expect(savedDraft).not.toBeNull();
    expect(savedDraft?.descriptorByStudentId["stu-1"]).toEqual([1]);
    expect(app.getText()).toContain("Rascunho local pendente de envio");

    // 2. Vai à Etapa 3, dispara poll pendente e troca de volta para Etapa 1 -> signal[0] abortado
    (app.findButton("3. Envio e Ciência").props.onClick as () => void)();
    await app.flush();
    await vi.advanceTimersByTimeAsync(15_000);
    await app.flush();

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    (app.findButton("1. Matriz do Componente").props.onClick as () => void)();
    await app.flush();
    expect(signals[0].aborted).toBe(true);

    // 3. Logout (handleLogoutTeacher) apaga rascunho local e retorna à tela inicial
    (app.findButton("Trocar conta").props.onClick as () => void)();
    await app.flush();

    expect(
      loadTeacherPortalLocalDraft("board-portal-1", 1, "subj-mat", "prof@escola.pr.gov.br")
    ).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(app.getText()).toContain("Conselho de Classe — Lançamento Docente");

    // 4. Novo mount: verifica AbortController ao desmontar componente durante poll em andamento
    const app2 = mountReactComponent(ProfessorConselhoClient, {
      token: "token-teste-unmount",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      preloadedSession: {
        googleIdToken: "id-token-valido",
        verifiedEmail: "prof@escola.pr.gov.br",
        verifiedName: "Prof. Marcos",
        council: buildCouncilContext({ canConfirmAck: false }),
        suggestedSubjectId: "subj-mat",
      },
    });
    activeUnmounts.push(app2.unmount);

    (app2.findButton("3. Envio e Ciência").props.onClick as () => void)();
    await app2.flush();
    await vi.advanceTimersByTimeAsync(15_000);
    await app2.flush();

    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);

    app2.unmount();
    expect(signals[1].aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ProfessorPreConselhoClient: aplica Retry-After/backoff em 429, para em 401 e aborta requisições no logout e desmontagem", async () => {
    let callStep = 0;
    const pendingSignals: AbortSignal[] = [];

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      callStep++;
      if (callStep === 1) {
        return new Response(
          JSON.stringify({
            success: true,
            verifiedEmail: "prof@escola.pr.gov.br",
            verifiedName: "Prof. Marcos",
            suggestedConversationId: "conv-mat",
            preCouncil: buildPreCouncilPayload({ canConfirm: false }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (callStep === 2) {
        return new Response(JSON.stringify({ error: "Rate limit" }), {
          status: 429,
          headers: { "Retry-After": "30" },
        });
      }
      if (callStep === 3) {
        return new Response(JSON.stringify({ error: "Rate limit" }), {
          status: 429,
        });
      }
      if (callStep === 4) {
        return new Response(JSON.stringify({ error: "Token inválido" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (callStep === 5 || callStep === 7) {
        return new Response(
          JSON.stringify({
            success: true,
            verifiedEmail: "prof@escola.pr.gov.br",
            verifiedName: "Prof. Marcos",
            suggestedConversationId: "conv-mat",
            preCouncil: buildPreCouncilPayload({ canConfirm: false }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (init?.signal) {
        pendingSignals.push(init.signal);
      }
      return new Promise<Response>(() => {});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const app = mountReactComponent(ProfessorPreConselhoClient, {
      token: "pre-council-token-1",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      enableDevAuth: true,
    });
    activeUnmounts.push(app.unmount);

    // Login local dev-auth (callStep = 1)
    (app.findButton("Entrar").props.onClick as () => void)();
    await app.flush();
    expect(app.getText()).toContain("Pré-Conselho • 6º Ano A");

    // Poll 1 (15s) -> 429 com Retry-After: 30
    await vi.advanceTimersByTimeAsync(15_000);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Poll 2 (+30s) -> 429 sem header -> dobra para 60s
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Poll 3 (+60s) -> 401 -> exibe reautenticação, desabilita confirmação e encerra polling
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    expect(app.getText()).toContain("Sua validação Google expirou");
    expect(app.getText()).toContain("Sessão Google expirada");
    expect(app.findButton("Entrar novamente")).toBeDefined();
    expect(app.findButton("Confirmar ciência").props.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Reentra via "Entrar novamente", abre poll pendente e testa AbortController no "Trocar conta"
    (app.findButton("Entrar novamente").props.onClick as () => void)();
    await app.flush();
    (app.findButton("Entrar").props.onClick as () => void)(); // callStep = 5
    await app.flush();

    await vi.advanceTimersByTimeAsync(15_000); // callStep = 6 (pendente)
    await app.flush();
    expect(pendingSignals).toHaveLength(1);
    expect(pendingSignals[0].aborted).toBe(false);

    (app.findButton("Trocar conta").props.onClick as () => void)();
    await app.flush();
    expect(pendingSignals[0].aborted).toBe(true);

    // Reentra novamente, abre poll pendente e testa AbortController no unmount
    (app.findButton("Entrar").props.onClick as () => void)(); // callStep = 7
    await app.flush();

    await vi.advanceTimersByTimeAsync(15_000); // callStep = 8 (pendente)
    await app.flush();
    expect(pendingSignals).toHaveLength(2);
    expect(pendingSignals[1].aborted).toBe(false);

    app.unmount();
    expect(pendingSignals[1].aborted).toBe(true);
  });

  it("ProfessorConselhoClient: verifica liberação imediatamente ao retornar à aba (visibilitychange) respeitando backoff 429", async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async () => {
      pollCount++;
      if (pollCount === 1) {
        return new Response(JSON.stringify({ error: "Muitas requisições" }), {
          status: 429,
          headers: { "Retry-After": "30" },
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
          council: buildCouncilContext({ canConfirmAck: true }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const app = mountReactComponent(ProfessorConselhoClient, {
      token: "token-teste-visibility",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      preloadedSession: {
        googleIdToken: "id-token-valido",
        verifiedEmail: "prof@escola.pr.gov.br",
        verifiedName: "Prof. Marcos",
        council: buildCouncilContext({ canConfirmAck: false }),
        suggestedSubjectId: "subj-mat",
      },
    });
    activeUnmounts.push(app.unmount);

    const emitVisibilityChange = () => {
      for (const listener of shims.documentListeners.get("visibilitychange") || []) {
        if (typeof listener === "function") listener(new Event("visibilitychange"));
        else listener.handleEvent(new Event("visibilitychange"));
      }
    };

    (app.findButton("3. Envio e Ciência").props.onClick as () => void)();
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // 1. Retorno imediato à aba (hidden -> false) dispara verificação sem aguardar 15s -> recebe 429 (Retry-After: 30)
    shims.documentState.hidden = false;
    emitVisibilityChange();
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2. Durante os 30s de backoff, novo evento visibilitychange NÃO dispara fetch antecipado
    await vi.advanceTimersByTimeAsync(10_000);
    emitVisibilityChange();
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 3. Após expirar os 30s de backoff (+20s), visibilitychange dispara imediatamente e libera Confirmar ciência
    await vi.advanceTimersByTimeAsync(20_000);
    emitVisibilityChange();
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(app.findButton("Confirmar ciência")).toBeDefined();
  });

  it("ProfessorConselhoClient: alerta vínculo com outro docente quando preCouncil.teacherEmail diverge mesmo com subject.teacherEmail nulo", async () => {
    const ctx = buildCouncilContext({ canConfirmAck: false });
    ctx.subjects[0].teacherEmail = null;
    ctx.subjects[0].teacherName = null;
    ctx.preCouncil!.conversationsBySubjectId["subj-mat"].teacherEmail = "outro.docente@escola.pr.gov.br";
    ctx.preCouncil!.conversationsBySubjectId["subj-mat"].teacherName = "Prof. Helena";

    const app = mountReactComponent(ProfessorConselhoClient, {
      token: "token-teste-owner",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      preloadedSession: {
        googleIdToken: "id-token-valido",
        verifiedEmail: "prof@escola.pr.gov.br",
        verifiedName: "Prof. Marcos",
        council: ctx,
        suggestedSubjectId: "subj-mat",
      },
    });
    activeUnmounts.push(app.unmount);

    expect(app.getText()).toContain("Este componente curricular está vinculado a Prof. Helena");
    expect(app.findButton("Enviar matriz e observações").props.disabled).toBe(true);
  });

  it("ProfessorPreConselhoClient: exibe feedback no clique manual de Verificar liberação e libera via visibilitychange", async () => {
    let callStep = 0;
    const fetchMock = vi.fn(async () => {
      callStep++;
      if (callStep === 1 || callStep === 2) {
        return new Response(
          JSON.stringify({
            success: true,
            verifiedEmail: "prof@escola.pr.gov.br",
            verifiedName: "Prof. Marcos",
            suggestedConversationId: "conv-mat",
            preCouncil: buildPreCouncilPayload({ canConfirm: false }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          verifiedEmail: "prof@escola.pr.gov.br",
          verifiedName: "Prof. Marcos",
          suggestedConversationId: "conv-mat",
          preCouncil: buildPreCouncilPayload({ canConfirm: true }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const app = mountReactComponent(ProfessorPreConselhoClient, {
      token: "pre-council-token-vis",
      schoolName: "Escola Estadual Modelo",
      classNameLabel: "6º Ano A",
      segmentLabel: "Ensino Fundamental",
      shiftLabel: "Manhã",
      year: 2026,
      trimester: 1,
      lockedSubjectName: "Matemática",
      googleClientId: "",
      enableDevAuth: true,
    });
    activeUnmounts.push(app.unmount);

    (app.findButton("Entrar").props.onClick as () => void)();
    await app.flush();
    expect(app.findButton("Confirmar ciência").props.disabled).toBe(true);

    // 1. Clique manual enquanto pendente mostra feedback explícito
    (app.findButton("Verificar liberação").props.onClick as () => void)();
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(app.getText()).toContain("Ainda aguardando o registro da conversa ou combinados");

    // 2. Passado o cooldown de 3s, retorno à aba via visibilitychange libera Confirmar ciência imediatamente
    await vi.advanceTimersByTimeAsync(3_500);
    shims.documentState.hidden = false;
    for (const listener of shims.documentListeners.get("visibilitychange") || []) {
      if (typeof listener === "function") listener(new Event("visibilitychange"));
      else listener.handleEvent(new Event("visibilitychange"));
    }
    await app.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(app.findButton("Confirmar ciência").props.disabled).toBe(false);
    expect(app.getText()).toContain("Assinatura liberada pela equipe pedagógica.");
  });
});
