import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockGetCurrentSchool = vi.fn();
const mockAuthenticateExtensionSyncToken = vi.fn();
const mockExecuteRaw = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: (...args: any[]) => mockAuth(...args),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: (...args: any[]) => mockGetCurrentSchool(...args),
}));

vi.mock("@/lib/extensionSyncAuth", () => ({
  authenticateExtensionSyncToken: (...args: any[]) =>
    mockAuthenticateExtensionSyncToken(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: (...args: any[]) => mockExecuteRaw(...args),
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
  },
}));

import { GET as getPendingMessages } from "@/app/api/messages/pending/route";
import { claimPendingQueuedMessages } from "@/services/messageDispatchService";

describe("P7: Fila Companion WhatsApp (/api/messages/pending & claimPendingQueuedMessages)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentSchool.mockResolvedValue({
      id: "escola-alpha",
      name: "Colégio Alpha",
      edition: "PILOTO_INTEGRADA",
    });
    mockExecuteRaw.mockResolvedValue(0);
    mockQueryRaw.mockResolvedValue([]);
  });

  it("rejeita requisição não autenticada quando nem sessão nem token são válidos", async () => {
    mockAuth.mockResolvedValue(null);
    mockAuthenticateExtensionSyncToken.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Não autorizado." }), { status: 401 }),
    });

    const req = new Request("http://localhost:3000/api/messages/pending?limit=5");
    const res = await getPendingMessages(req);
    expect(res.status).toBe(401);
  });

  it("executa claim atômico via FOR UPDATE OF ml SKIP LOCKED isolado pelo schoolId do token", async () => {
    mockAuth.mockResolvedValue(null);
    mockAuthenticateExtensionSyncToken.mockResolvedValue({
      ok: true,
      targetSchoolId: "escola-alpha",
      userName: "Companion WhatsApp (Colégio Alpha)",
    });

    const fakeClaimed = [
      {
        id: "msg-1",
        studentId: "stu-1",
        phoneUsed: "5542999990001",
        reasonTitle: "Faltas Consecutivas",
        messageContent: "Olá família",
        sentByName: "Pedagoga Maria",
        sentAt: new Date("2026-11-10T12:00:00Z"),
        contentHash: "hash-abc",
        deliveryStatus: "DISPATCHING",
        deliveryUpdatedAt: new Date("2026-11-10T12:01:00Z"),
      },
    ];
    mockQueryRaw.mockResolvedValueOnce(fakeClaimed);

    const req = new Request("http://localhost:3000/api/messages/pending?limit=5", {
      headers: { "x-sync-token": "token-valido" },
    });
    const res = await getPendingMessages(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.schoolId).toBe("escola-alpha");
    expect(body.count).toBe(1);
    expect(body.messages[0].id).toBe("msg-1");
    expect(body.messages[0].deliveryStatus).toBe("DISPATCHING");

    // Verifica recuperação de DISPATCHING órfãos + query FOR UPDATE OF ml SKIP LOCKED
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const sqlStrings = (mockQueryRaw.mock.calls[0][0] as TemplateStringsArray).join(" ");
    expect(sqlStrings).toContain("FOR UPDATE OF ml SKIP LOCKED");
    expect(sqlStrings).toContain("SET \"deliveryStatus\" = 'DISPATCHING'");
  });

  it("limita o parâmetro limit entre 1 e 50 em claimPendingQueuedMessages", async () => {
    await claimPendingQueuedMessages({ schoolId: "escola-alpha", limit: 999 });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    // O segundo parâmetro interpolado na query é safeLimit (50)
    expect(mockQueryRaw.mock.calls[0][2]).toBe(50);
  });
});
