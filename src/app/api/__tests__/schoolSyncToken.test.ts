import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "../schools/[id]/sync-token/route";

const mockSchool = {
  id: "school-123",
  name: "Escola de Teste",
  syncTokenHash: "hash-existente-123",
  updatedAt: new Date("2026-11-06T10:00:00.000Z"),
};

let mockAuthCheckResult: any = {
  ok: true,
  userId: "admin-1",
  userName: "Gestor Escolar",
  email: "gestor@teste.pr.gov.br",
  role: "GESTOR_ESCOLAR",
  schoolId: "school-123",
};

vi.mock("@/lib/permissions", () => ({
  requireSchoolAdmin: vi.fn(async (_schoolId: string) => mockAuthCheckResult),
}));

const mockAuditLogs: any[] = [];
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (payload: any) => {
    mockAuditLogs.push(payload);
  }),
}));

let lastUpdateData: any = null;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id === mockSchool.id) return mockSchool;
        return null;
      }),
      update: vi.fn(async ({ where, data, select }: any) => {
        lastUpdateData = data;
        return {
          id: where.id,
          updatedAt: new Date("2026-11-08T14:30:00.000Z"),
        };
      }),
    },
  },
}));

describe("API /api/schools/[id]/sync-token (Geração e Consulta de Token de Extensão)", () => {
  beforeEach(() => {
    mockAuditLogs.length = 0;
    lastUpdateData = null;
    mockAuthCheckResult = {
      ok: true,
      userId: "admin-1",
      userName: "Gestor Escolar",
      email: "gestor@teste.pr.gov.br",
      role: "GESTOR_ESCOLAR",
      schoolId: "school-123",
    };
  });

  it("rejeita acesso caso o usuário não possua permissão de gestor da escola", async () => {
    mockAuthCheckResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: "Acesso não autorizado" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };

    const req = new Request("http://localhost/api/schools/school-123/sync-token", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "school-123" }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Acesso não autorizado");
  });

  it("GET retorna status de chave configurada e data de criação", async () => {
    const req = new Request("http://localhost/api/schools/school-123/sync-token", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: "school-123" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.schoolId).toBe("school-123");
    expect(body.schoolName).toBe("Escola de Teste");
    expect(body.syncTokenCreatedAt).toBe("2026-11-06T10:00:00.000Z");
  });

  it("POST gera novo token e retorna contrato compatível com syncToken, rawToken e school.syncTokenCreatedAt", async () => {
    const req = new Request("http://localhost/api/schools/school-123/sync-token", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "school-123" }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(typeof body.syncToken).toBe("string");
    expect(body.syncToken.length).toBe(64); // 32 bytes hex = 64 chars
    expect(body.rawToken).toBe(body.syncToken); // Compatibilidade dual
    expect(body.school).toBeDefined();
    expect(body.school.syncTokenCreatedAt).toBe("2026-11-08T14:30:00.000Z");
    expect(body.syncTokenCreatedAt).toBe("2026-11-08T14:30:00.000Z");

    // Verifica que o hash persistido no banco não é o token em texto plano
    expect(lastUpdateData.syncTokenHash).toBeDefined();
    expect(lastUpdateData.syncTokenHash).not.toBe(body.syncToken);

    // Verifica registro em auditoria com schoolId raiz
    expect(mockAuditLogs.length).toBe(1);
    expect(mockAuditLogs[0].schoolId).toBe("school-123");
    expect(mockAuditLogs[0].entityType).toBe("SchoolSyncToken");
    expect(mockAuditLogs[0].details.action).toBe("ROTATE_SYNC_TOKEN");
  });
});
