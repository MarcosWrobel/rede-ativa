import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH as patchAtaDraft } from "@/app/api/atas/[id]/route";
import { POST as finalizeAta } from "@/app/api/atas/[id]/finalize/route";
import { POST as postClass } from "@/app/api/classes/route";
import AuditoriaPage from "@/app/auditoria/page";
import { sanitizeCsvField } from "@/lib/csvSanitizer";

// Mock State
const mockState = {
  session: null as any,
  cookies: {} as Record<string, string>,
  db: {
    schools: [] as any[],
    classGroups: [] as any[],
    students: [] as any[],
    minutes: [] as any[],
    minuteStudents: [] as any[],
    minuteParticipants: [] as any[],
    actionItems: [] as any[],
    auditLogs: [] as any[],
  },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => mockState.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (key: string) =>
      mockState.cookies[key] !== undefined
        ? { name: key, value: mockState.cookies[key] }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// Mock AuditoriaClient component to return props for assertion in test
vi.mock("@/app/auditoria/AuditoriaClient", () => ({
  default: vi.fn((props: any) => ({
    type: "AuditoriaClient",
    props,
  })),
}));

vi.mock("@/lib/prisma", () => {
  const getPrismaClient = () => ({
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        return mockState.db.schools.find((s) => s.id === where.id) || null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        if (!where) return mockState.db.schools[0] || null;
        return (
          mockState.db.schools.find((s) => {
            if (where.id && s.id !== where.id) return false;
            if (where.inepCode && s.inepCode !== where.inepCode) return false;
            return true;
          }) || null
        );
      }),
    },
    student: {
      findMany: vi.fn(async ({ where }: any) => {
        return mockState.db.students.filter((st) => {
          if (where?.id?.in && !where.id.in.includes(st.id)) return false;
          if (where?.schoolId !== undefined && st.schoolId !== where.schoolId) return false;
          return true;
        });
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return mockState.db.students.find((st) => st.id === where.id) || null;
      }),
    },
    classGroup: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          mockState.db.classGroups.find((cg) => {
            if (where.schoolId && cg.schoolId !== where.schoolId) return false;
            if (where.name?.equals && cg.name.toLowerCase() !== where.name.equals.toLowerCase()) return false;
            return true;
          }) || null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `cg-${Date.now()}`, ...data };
        mockState.db.classGroups.push(item);
        return item;
      }),
    },
    pedagogicalMinute: {
      findUnique: vi.fn(async ({ where }: any) => {
        const found = mockState.db.minutes.find((m) => m.id === where.id);
        if (!found) return null;
        return {
          ...found,
          students: mockState.db.minuteStudents.filter((ms) => ms.minuteId === found.id),
          participants: mockState.db.minuteParticipants.filter((mp) => mp.minuteId === found.id),
          actionItems: mockState.db.actionItems.filter((ai) => ai.minuteId === found.id),
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = mockState.db.minutes.find((m) => m.id === where.id);
        if (found) {
          Object.assign(found, data);
        }
        return {
          ...found,
          students: mockState.db.minuteStudents.filter((ms) => ms.minuteId === where.id),
          participants: mockState.db.minuteParticipants.filter((mp) => mp.minuteId === where.id),
          actionItems: mockState.db.actionItems.filter((ai) => ai.minuteId === where.id),
        };
      }),
    },
    pedagogicalMinuteStudent: {
      deleteMany: vi.fn(async ({ where }: any) => {
        mockState.db.minuteStudents = mockState.db.minuteStudents.filter(
          (ms) => ms.minuteId !== where.minuteId
        );
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const items = Array.isArray(data) ? data : [data];
        mockState.db.minuteStudents.push(...items);
        return { count: items.length };
      }),
    },
    pedagogicalMinuteParticipant: {
      findMany: vi.fn(async ({ where }: any) => {
        return mockState.db.minuteParticipants.filter((mp) => mp.minuteId === where.minuteId);
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        mockState.db.minuteParticipants = mockState.db.minuteParticipants.filter(
          (mp) => mp.minuteId !== where.minuteId
        );
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const items = Array.isArray(data) ? data : [data];
        mockState.db.minuteParticipants.push(...items);
        return { count: items.length };
      }),
    },
    pedagogicalActionItem: {
      deleteMany: vi.fn(async ({ where }: any) => {
        mockState.db.actionItems = mockState.db.actionItems.filter(
          (ai) => ai.minuteId !== where.minuteId
        );
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const items = Array.isArray(data) ? data : [data];
        mockState.db.actionItems.push(...items);
        return { count: items.length };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `log-${Date.now()}-${Math.random()}`, createdAt: new Date(), ...data };
        mockState.db.auditLogs.push(item);
        return item;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return mockState.db.auditLogs.filter((log) => {
          if (!where || Object.keys(where).length === 0) return true;
          if (where.schoolId !== undefined && log.schoolId !== where.schoolId) return false;
          if (where.OR) {
            return where.OR.some((cond: any) => {
              if (cond.schoolId === null) return log.schoolId === null;
              return log.schoolId === cond.schoolId;
            });
          }
          return true;
        });
      }),
    },
    $transaction: vi.fn(async (callback: any) => {
      return callback(getPrismaClient());
    }),
    $executeRaw: vi.fn(async () => 1),
  });

  return { prisma: getPrismaClient() };
});

describe("Milestone M2: Data Integrity, RBAC & Audit Isolation Test Suite", () => {
  beforeEach(() => {
    mockState.cookies = {};
    mockState.session = {
      user: {
        id: "usr-gestor-a",
        name: "Gestor Escola A",
        email: "gestor@escola-a.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "escola-a",
        active: true,
        schools: [{ schoolId: "escola-a", role: "GESTOR_ESCOLAR", active: true }],
      },
    };

    mockState.db = {
      schools: [
        {
          id: "default-leopoldina",
          name: "Colégio Estadual Leopoldina B. Pedroso",
          inepCode: "41042730",
          active: true,
        },
        {
          id: "escola-a",
          name: "Escola Municipal Pioneira A",
          inepCode: "41000001",
          active: true,
        },
        {
          id: "escola-b",
          name: "Escola Municipal Secundária B",
          inepCode: "41000002",
          active: true,
        },
      ],
      classGroups: [
        { id: "cg-a1", name: "6º Ano A", schoolId: "escola-a", segment: "FUNDAMENTAL", shift: "MANHA" },
        { id: "cg-b1", name: "7º Ano B", schoolId: "escola-b", segment: "FUNDAMENTAL", shift: "TARDE" },
      ],
      students: [
        { id: "aluno-a1", name: "Carlos da Silva A", schoolId: "escola-a", cgm: "CGM1001", classGroup: { name: "6º Ano A" } },
        { id: "aluno-a2", name: "Ana Beatriz A", schoolId: "escola-a", cgm: "CGM1002", classGroup: { name: "6º Ano A" } },
        { id: "aluno-b1", name: "Bruno Souza B", schoolId: "escola-b", cgm: "CGM2001", classGroup: { name: "7º Ano B" } },
      ],
      minutes: [
        {
          id: "minute-draft-a",
          schoolId: "escola-a",
          status: "DRAFT",
          subject: "Atendimento de Infrequência Escolar",
          year: 2026,
          contentHash: "hash-initial",
          category: "ATTENDANCE",
          attendedAt: new Date(),
        },
      ],
      minuteStudents: [],
      minuteParticipants: [{ id: "part-1", minuteId: "minute-draft-a", name: "Gestor Escola A", role: "GESTOR_ESCOLAR" }],
      actionItems: [],
      auditLogs: [],
    };
  });

  // ==========================================================================
  // PONTO 4: Prevenção de Cross-Tenant FK Traversal em Atas
  // ==========================================================================
  describe("Ponto 4: Prevenção de Cross-Tenant FK Traversal em Atas", () => {
    it("PATCH /api/atas/[id] permite vincular estudantes que pertencem à mesma instituição escolar", async () => {
      const res = await patchAtaDraft(
        new Request("http://localhost:3000/api/atas/minute-draft-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentIds: ["aluno-a1", "aluno-a2"],
          }),
        }),
        { params: Promise.resolve({ id: "minute-draft-a" }) }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockState.db.minuteStudents).toHaveLength(2);
      expect(mockState.db.minuteStudents.map((s) => s.studentId)).toEqual(["aluno-a1", "aluno-a2"]);
    });

    it("PATCH /api/atas/[id] bloqueia com 400 tentativa de vincular estudante pertencente a outra escola (cross-tenant)", async () => {
      const res = await patchAtaDraft(
        new Request("http://localhost:3000/api/atas/minute-draft-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentIds: ["aluno-a1", "aluno-b1"], // aluno-b1 é da escola-b!
          }),
        }),
        { params: Promise.resolve({ id: "minute-draft-a" }) }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(
        "Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
      );
      // Nenhum aluno deve ter sido vinculado
      expect(mockState.db.minuteStudents).toHaveLength(0);
    });

    it("PATCH /api/atas/[id] bloqueia com 400 quando studentId inexistente for informado", async () => {
      const res = await patchAtaDraft(
        new Request("http://localhost:3000/api/atas/minute-draft-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentIds: ["aluno-inexistente-999"],
          }),
        }),
        { params: Promise.resolve({ id: "minute-draft-a" }) }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(
        "Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
      );
    });

    it("POST /api/atas/[id]/finalize bloqueia com 400 se rawBody.studentIds contiver aluno de outra escola", async () => {
      const res = await finalizeAta(
        new Request("http://localhost:3000/api/atas/minute-draft-a/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: "Texto formal detalhado com mais de dez caracteres obrigatórios para lavratura.",
            studentIds: ["aluno-a1", "aluno-b1"], // Cross-tenant!
          }),
        }),
        { params: Promise.resolve({ id: "minute-draft-a" }) }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(
        "Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
      );
    });

    it("POST /api/atas/[id]/finalize bloqueia com 400 se rawBody.studentIds contiver ID inexistente", async () => {
      const res = await finalizeAta(
        new Request("http://localhost:3000/api/atas/minute-draft-a/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: "Texto formal detalhado com mais de dez caracteres obrigatórios para lavratura.",
            studentIds: ["aluno-fantasma"],
          }),
        }),
        { params: Promise.resolve({ id: "minute-draft-a" }) }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(
        "Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
      );
    });
  });

  // ==========================================================================
  // PONTO 6: Tenant-Blind Logging e Vazamento no Painel de Auditoria
  // ==========================================================================
  describe("Ponto 6: Tenant-Blind Logging e Vazamento no Painel de Auditoria", () => {
    it("POST /api/classes registra CREATE_CLASS_GROUP com schoolId no nível raiz de logAudit", async () => {
      const res = await postClass(
        new Request("http://localhost:3000/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "9º Ano Especial",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
          }),
        })
      );

      expect(res.status).toBe(201);
      const classLog = mockState.db.auditLogs.find((l) => l.action === "CREATE_CLASS_GROUP");
      expect(classLog).toBeDefined();
      expect(classLog.schoolId).toBe("escola-a");
      // Detalhes não devem duplicar schoolId desnecessariamente no nível de atributos
      const parsedDetails = JSON.parse(classLog.details);
      expect(parsedDetails.name).toBe("9º Ano Especial");
    });

    it("PATCH /api/atas/[id] registra UPDATE_ATA_DRAFT com schoolId no nível raiz de logAudit", async () => {
      const res = await patchAtaDraft(
        new Request("http://localhost:3000/api/atas/minute-draft-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: "Assunto Atualizado com Sucesso",
          }),
        }),
        { params: Promise.resolve({ id: "minute-draft-a" }) }
      );

      expect(res.status).toBe(200);
      const ataLog = mockState.db.auditLogs.find((l) => l.action === "UPDATE_ATA_DRAFT");
      expect(ataLog).toBeDefined();
      expect(ataLog.schoolId).toBe("escola-a");
    });

    it("AuditoriaPage não vaza logs órfãos (schoolId: null) para o painel da Escola Sede (Leopoldina)", async () => {
      // Cria logs em diferentes cenários
      mockState.db.auditLogs.push(
        {
          id: "log-sede-1",
          action: "UPDATE_STUDENT",
          schoolId: "default-leopoldina",
          details: "Estudante da Escola Sede",
          createdAt: new Date(),
        },
        {
          id: "log-escola-a",
          action: "CREATE_CLASS_GROUP",
          schoolId: "escola-a",
          details: "Turma da Escola A",
          createdAt: new Date(),
        },
        {
          id: "log-orfa-sem-tenant",
          action: "LEGACY_EVENT",
          schoolId: null, // Log órfão sem escola!
          details: "Evento do sistema legado sem escola associada",
          createdAt: new Date(),
        }
      );

      // Usuário autenticado como Gestor da Escola Sede Leopoldina
      mockState.session = {
        user: {
          id: "usr-gestor-leopoldina",
          name: "Gestor Leopoldina",
          email: "gestor@leopoldina.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "default-leopoldina",
          inepCode: "41042730",
          active: true,
          schools: [{ schoolId: "default-leopoldina", role: "GESTOR_ESCOLAR", active: true }],
        },
      };

      const result: any = await AuditoriaPage();
      const logsExibidos = result.props.initialLogs;

      // Deve conter o log legítimo da Escola Sede
      expect(logsExibidos.some((l: any) => l.id === "log-sede-1")).toBe(true);

      // NÃO deve conter o log de outra escola (escola-a)
      expect(logsExibidos.some((l: any) => l.id === "log-escola-a")).toBe(false);

      // CORREÇÃO AUDITORIA: NÃO deve conter o log órfão (schoolId: null)
      expect(logsExibidos.some((l: any) => l.id === "log-orfa-sem-tenant")).toBe(false);
      expect(logsExibidos.every((l: any) => l.schoolId === "default-leopoldina")).toBe(true);
    });

    it("AuditoriaPage para Escola A exibe estritamente os logs da Escola A", async () => {
      mockState.db.auditLogs.push(
        {
          id: "log-escola-a-1",
          action: "CREATE_STUDENT",
          schoolId: "escola-a",
          details: "Aluno Novo Escola A",
          createdAt: new Date(),
        },
        {
          id: "log-escola-b-1",
          action: "CREATE_STUDENT",
          schoolId: "escola-b",
          details: "Aluno Novo Escola B",
          createdAt: new Date(),
        }
      );

      mockState.session = {
        user: {
          id: "usr-gestor-a",
          name: "Gestor Escola A",
          email: "gestor@escola-a.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "escola-a",
          active: true,
          schools: [{ schoolId: "escola-a", role: "GESTOR_ESCOLAR", active: true }],
        },
      };

      const result: any = await AuditoriaPage();
      const logsExibidos = result.props.initialLogs;

      expect(logsExibidos.some((l: any) => l.id === "log-escola-a-1")).toBe(true);
      expect(logsExibidos.some((l: any) => l.id === "log-escola-b-1")).toBe(false);
      expect(logsExibidos.every((l: any) => l.schoolId === "escola-a")).toBe(true);
    });
  });

  // ==========================================================================
  // PONTO 7: Escape Seguro de Aspas Duplas em CSV (RFC 4180)
  // ==========================================================================
  describe("Ponto 7: Escape Seguro de Aspas Duplas em CSV (RFC 4180)", () => {
    const escapeCsv = (val: any) => `"${sanitizeCsvField(val ?? "").replace(/"/g, '""')}"`;

    it("duplica aspas duplas internas de campos de texto conforme RFC 4180", () => {
      // Turma com aspas no nome: 6º "A"
      const className = '6º "A"';
      expect(escapeCsv(className)).toBe('"6º ""A"""');

      // Nome com apelido: José "Zezinho" da Silva
      const studentName = 'José "Zezinho" da Silva';
      expect(escapeCsv(studentName)).toBe('"José ""Zezinho"" da Silva"');

      // Medidas adotadas com citações
      const actions = 'Contato telefônico com mãe: "Retornará amanhã"';
      expect(escapeCsv(actions)).toBe('"Contato telefônico com mãe: ""Retornará amanhã"""');
    });

    it("combina proteção contra CSV Injection com escape de aspas", () => {
      // Injeção de fórmula iniciada por '=' contendo aspas
      const malicious = '=cmd|"/c calc"!A0';
      const escaped = escapeCsv(malicious);

      // Deve iniciar com ' (prefixado por sanitizeCsvField) e aspas duplas duplicadas
      expect(escaped).toBe('"\'=cmd|""/c calc""!A0"');
    });

    it("trata valores nulos e vazios com aspas vazias seguras", () => {
      expect(escapeCsv(null)).toBe('""');
      expect(escapeCsv(undefined)).toBe('""');
      expect(escapeCsv("")).toBe('""');
    });

    it("gera linha CSV com todos os campos de texto devidamente protegidos", () => {
      const mockRec = {
        cgm: 'CGM "123"',
        name: 'Mariana "Mari" Souza',
        classGroup: { name: '8º "B"', shift: 'Manhã "Integral"' },
        attendancePercent: 72.5,
        semanaAtual: 'Semana "1"',
        semanaAnterior: 'Semana "0"',
        variacao: -5,
        actionsTaken: 'Acionado Conselho Tutelar: "Em andamento"',
      };

      const row = [
        escapeCsv(mockRec.cgm),
        escapeCsv(mockRec.name),
        escapeCsv(mockRec.classGroup.name),
        escapeCsv(mockRec.classGroup.shift),
        `"${mockRec.attendancePercent.toFixed(1)}%"`,
        escapeCsv(mockRec.semanaAtual),
        escapeCsv(mockRec.semanaAnterior),
        `"${mockRec.variacao !== null ? (mockRec.variacao > 0 ? "+" : "") + mockRec.variacao + "%" : ""}"`,
        escapeCsv(mockRec.actionsTaken),
      ].join(";");

      expect(row).toBe(
        '"CGM ""123""";"Mariana ""Mari"" Souza";"8º ""B""";"Manhã ""Integral""";"72.5%";"Semana ""1""";"Semana ""0""";"-5%";"Acionado Conselho Tutelar: ""Em andamento"""'
      );
    });
  });
});
