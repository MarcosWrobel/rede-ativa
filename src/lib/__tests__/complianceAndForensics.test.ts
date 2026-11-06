import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getSigningPin, POST as postSigningPin } from "@/app/api/user/signing-pin/route";
import { POST as finalizeAta } from "@/app/api/atas/[id]/finalize/route";
import { hashPin } from "@/lib/signingPin";

const mockState = {
  session: null as any,
  db: {
    users: [] as any[],
    schools: [] as any[],
    minutes: [] as any[],
    minuteStudents: [] as any[],
    minuteParticipants: [] as any[],
    actionItems: [] as any[],
    students: [] as any[],
  },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => mockState.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async () => ({ id: "school-1", inep: "12345678", name: "Escola 1" })),
}));

vi.mock("@/lib/tenantGuard", () => ({
  assertTenantOwnership: vi.fn(() => true),
}));

vi.mock("@/lib/prisma", () => {
  const client: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        return mockState.db.users.find((u) => u.id === where.id || u.email === where.email) || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = mockState.db.users.findIndex((u) => u.id === where.id);
        if (idx !== -1) {
          mockState.db.users[idx] = { ...mockState.db.users[idx], ...data };
          return mockState.db.users[idx];
        }
        return null;
      }),
    },
    pedagogicalMinute: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const m = mockState.db.minutes.find((item) => item.id === where.id);
        if (!m) return null;
        return {
          ...m,
          students: mockState.db.minuteStudents.filter((ms) => ms.minuteId === m.id),
          participants: mockState.db.minuteParticipants.filter((mp) => mp.minuteId === m.id),
          actionItems: mockState.db.actionItems.filter((ma) => ma.minuteId === m.id),
          addendums: [],
        };
      }),
      findFirst: vi.fn(async () => ({ ataNumber: 10 })),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = mockState.db.minutes.findIndex((item) => item.id === where.id);
        if (idx !== -1) {
          mockState.db.minutes[idx] = { ...mockState.db.minutes[idx], ...data };
          return {
            ...mockState.db.minutes[idx],
            students: mockState.db.minuteStudents.filter((ms) => ms.minuteId === where.id),
            participants: mockState.db.minuteParticipants.filter((mp) => mp.minuteId === where.id),
            actionItems: mockState.db.actionItems.filter((ma) => ma.minuteId === where.id),
            addendums: [],
          };
        }
        return null;
      }),
    },
    student: {
      findMany: vi.fn(async () => mockState.db.students),
    },
    pedagogicalMinuteStudent: {
      deleteMany: vi.fn(async () => {}),
      createMany: vi.fn(async () => {}),
    },
    pedagogicalMinuteParticipant: {
      deleteMany: vi.fn(async () => {}),
      createMany: vi.fn(async () => {}),
    },
    pedagogicalActionItem: {
      deleteMany: vi.fn(async () => {}),
      createMany: vi.fn(async () => {}),
    },
    $executeRaw: vi.fn(async () => {}),
    $transaction: vi.fn(async (cb: any) => cb(client)),
  };
  return { prisma: client };
});

describe("Compliance & Forensics - Épicos 1, 2 e 3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.session = {
      user: {
        id: "user-pedagoga",
        email: "pedagoga@escola.pr.gov.br",
        name: "Maria Pedagoga",
        role: "PEDAGOGA",
        schoolId: "school-1",
      },
    };

    mockState.db.users = [
      {
        id: "user-pedagoga",
        email: "pedagoga@escola.pr.gov.br",
        name: "Maria Pedagoga",
        role: "PEDAGOGA",
        schoolId: "school-1",
        signingPinHash: null,
        pinAttempts: 0,
        pinLockedUntil: null,
      },
    ];

    mockState.db.students = [
      { id: "student-1", name: "João Silva", schoolId: "school-1" },
    ];

    mockState.db.minutes = [
      {
        id: "minute-1",
        schoolId: "school-1",
        year: 2026,
        status: "DRAFT",
        attendedAt: new Date(),
        subject: "Atendimento de Busca Ativa",
        summary: "Aos cinco dias do mês de novembro, realizou-se atendimento com a família.",
        category: "BUSCA_ATIVA_FALTAS",
        isConfidential: false,
        authorName: "Maria Pedagoga",
        authorEmail: "pedagoga@escola.pr.gov.br",
      },
    ];

    mockState.db.minuteStudents = [
      { id: "ms-1", minuteId: "minute-1", studentId: "student-1", studentNameSnapshot: "João Silva" },
    ];

    mockState.db.minuteParticipants = [
      { id: "mp-1", minuteId: "minute-1", role: "RESPONSAVEL", name: "Pai do João" },
    ];
  });

  it("permite cadastrar PIN inicial via rota /api/user/signing-pin e rejeita repetição trivial", async () => {
    // 1. Trivial deve ser rejeitado
    const trivialReq = new Request("http://localhost:3000/api/user/signing-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setup", pin: "1234" }),
    });
    const trivialRes = await postSigningPin(trivialReq);
    expect(trivialRes.status).toBe(400);

    // 2. PIN forte aceito
    const validReq = new Request("http://localhost:3000/api/user/signing-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setup", pin: "9482" }),
    });
    const validRes = await postSigningPin(validReq);
    expect(validRes.status).toBe(200);

    const user = mockState.db.users[0];
    expect(user.signingPinHash).not.toBeNull();
  });

  it("exige PIN na lavratura quando o servidor possui PIN cadastrado", async () => {
    // Cadastra o PIN 8391 no usuário
    mockState.db.users[0].signingPinHash = await hashPin("8391");

    // Tentativa 1: Sem enviar o PIN -> Deve retornar 401 PIN_REQUIRED
    const reqSemPin = new Request("http://localhost:3000/api/atas/minute-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const resSemPin = await finalizeAta(reqSemPin, { params: Promise.resolve({ id: "minute-1" }) });
    expect(resSemPin.status).toBe(401);
    const semPinData = await resSemPin.json();
    expect(semPinData.error).toContain("PIN_REQUIRED");

    // Tentativa 2: PIN errado -> Deve retornar 401
    const reqPinErrado = new Request("http://localhost:3000/api/atas/minute-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signingPin: "1112" }),
    });
    const resPinErrado = await finalizeAta(reqPinErrado, { params: Promise.resolve({ id: "minute-1" }) });
    expect(resPinErrado.status).toBe(401);
    expect(mockState.db.users[0].pinAttempts).toBe(1);

    // Tentativa 3: PIN correto -> Deve finalizar com sucesso (200 OK)
    const reqPinCorreto = new Request("http://localhost:3000/api/atas/minute-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signingPin: "8391" }),
    });
    const resPinCorreto = await finalizeAta(reqPinCorreto, { params: Promise.resolve({ id: "minute-1" }) });
    expect(resPinCorreto.status).toBe(200);
    const minute = mockState.db.minutes[0];
    expect(minute.status).toBe("FINALIZED");
    expect(minute.contentHash).toBeDefined();
  });

  it("exige justificativa de lavratura extemporânea se o atendimento ocorreu há mais de 5 dias úteis", async () => {
    mockState.db.users[0].signingPinHash = await hashPin("8391");

    // Reunião realizada há 15 dias corridos (cerca de 10 dias úteis)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 15);
    mockState.db.minutes[0].attendedAt = oldDate;

    // Tentativa de lavrar sem justificativa -> Deve retornar 400 ou lançar validação
    const reqSemJust = new Request("http://localhost:3000/api/atas/minute-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signingPin: "8391" }),
    });

    try {
      const res = await finalizeAta(reqSemJust, { params: Promise.resolve({ id: "minute-1" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("extemporânea");
    } catch (err: any) {
      expect(err.message).toContain("extemporânea");
    }

    // Com justificativa preenchida -> Sucesso
    const reqComJust = new Request("http://localhost:3000/api/atas/minute-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signingPin: "8391",
        extemporaneousReason: "Aguardando comparecimento presencial do responsável para assinatura.",
      }),
    });

    const resComJust = await finalizeAta(reqComJust, { params: Promise.resolve({ id: "minute-1" }) });
    expect(resComJust.status).toBe(200);
    const minute = mockState.db.minutes[0];
    expect(minute.isExtemporaneous).toBe(true);
    expect(minute.extemporaneousReason).toContain("Aguardando comparecimento presencial");
  });
});
