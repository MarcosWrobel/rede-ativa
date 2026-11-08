import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "../messages/reply/route";
import { computeMessageContentHash } from "@/lib/messageCrypto";

// ============================================================================
// MOCKS DE AUTENTICAÇÃO, PRISMA E GEMINI
// ============================================================================

const mockSessionState = {
  currentSession: {
    user: {
      id: "user-pedagoga-a",
      name: "Pedagoga Escola A",
      email: "pedagoga@escola-a.pr.gov.br",
      role: "PEDAGOGA",
      schoolId: "escola-a",
      active: true,
      schools: [{ schoolId: "escola-a", role: "PEDAGOGA", active: true }],
    },
  } as any,
};

const mockAuditLogs: any[] = [];
const mockMessageLogs: Record<string, any> = {};

const mockInteractionsCreate = vi.fn();
const mockGenerateContent = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => mockSessionState.currentSession),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async (schoolId?: string) => {
    const id = schoolId || mockSessionState.currentSession?.user?.schoolId || "escola-a";
    return {
      id,
      name: id === "escola-a" ? "Escola A" : "Escola B",
      inepCode: id === "escola-a" ? "41000001" : "41000002",
      edition: "PILOTO_INTEGRADA",
    };
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    messageLog: {
      findUnique: vi.fn(async ({ where }: any) => {
        return mockMessageLogs[where.id] || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const prev = mockMessageLogs[where.id];
        if (!prev) throw new Error("Not found");
        const updated = {
          ...prev,
          ...data,
          student: prev.student,
        };
        mockMessageLogs[where.id] = updated;
        return updated;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        mockAuditLogs.push(data);
        return { id: `audit-${mockAuditLogs.length}`, ...data };
      }),
    },
  },
}));

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      interactions = {
        create: mockInteractionsCreate,
      };
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

describe("Segurança Probatória e Multi-Tenant do Retorno WhatsApp (/api/messages/reply)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockAuditLogs.length = 0;

    // Reseta estado da sessão padrão: Operador da Escola A
    mockSessionState.currentSession = {
      user: {
        id: "user-pedagoga-a",
        name: "Pedagoga Escola A",
        email: "pedagoga@escola-a.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "escola-a",
        active: true,
        schools: [{ schoolId: "escola-a", role: "PEDAGOGA", active: true }],
      },
    };

    // Popula banco em memória com registros de duas escolas distintas
    mockMessageLogs["msg-escola-a"] = {
      id: "msg-escola-a",
      studentId: "student-a1",
      reasonTitle: "Faltas Consecutivas",
      messageContent: "Olá, o estudante faltou nos últimos dias.",
      phoneUsed: "41999990001",
      sentByName: "Pedagoga Maria",
      sentAt: new Date("2026-11-05T10:00:00.000Z"),
      guardianReplied: false,
      replyNotes: null,
      replyCategory: null,
      repliedAt: null,
      deliveryStatus: "SENT",
      contentHash: "hash-inicial-a",
      student: {
        id: "student-a1",
        name: "Lucas Gabriel Rocha da Silva",
        schoolId: "escola-a",
      },
    };

    mockMessageLogs["msg-escola-b"] = {
      id: "msg-escola-b",
      studentId: "student-b1",
      reasonTitle: "Busca Ativa Sigilosa",
      messageContent: "Mensagem restrita da Escola B.",
      phoneUsed: "41999990002",
      sentByName: "Pedagoga Josefa",
      sentAt: new Date("2026-11-05T11:00:00.000Z"),
      guardianReplied: false,
      replyNotes: null,
      replyCategory: null,
      repliedAt: null,
      deliveryStatus: "SENT",
      contentHash: "hash-inicial-b",
      student: {
        id: "student-b1",
        name: "Aluno Escola B Vítima",
        schoolId: "escola-b",
      },
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("1. [BLOQUEIO BOLA/IDOR] rejeita com 403 Forbidden quando operador da escola-a tenta registrar retorno em registro da escola-b", async () => {
    const req = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: "msg-escola-b",
        guardianReplied: true,
        replyNotes: "Tentativa de injeção IDOR multi-tenant",
        replyCategory: "SAUDE",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe("Acesso negado a registro de outra instituição de ensino.");

    // Garante que o registro da Escola B permaneceu intacto no banco
    expect(mockMessageLogs["msg-escola-b"].guardianReplied).toBe(false);
    expect(mockMessageLogs["msg-escola-b"].replyNotes).toBeNull();
  });

  it("2. [REJEIÇÃO ZOD] retorna 400 Bad Request para payloads inválidos ou incompletos", async () => {
    // 2.1 logId ausente
    const reqNoLogId = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guardianReplied: true,
      }),
    });
    const resNoLogId = await POST(reqNoLogId);
    expect(resNoLogId.status).toBe(400);

    // 2.2 guardianReplied não-booleano
    const reqInvalidBool = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: "msg-escola-a",
        guardianReplied: "sim",
      }),
    });
    const resInvalidBool = await POST(reqInvalidBool);
    expect(resInvalidBool.status).toBe(400);

    // 2.3 replyCategory inválida
    const reqInvalidCat = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: "msg-escola-a",
        guardianReplied: true,
        replyCategory: "CATEGORIA_INVENTADA",
      }),
    });
    const resInvalidCat = await POST(reqInvalidCat);
    expect(resInvalidCat.status).toBe(400);
  });

  it("3. [CRIPTOGRAFIA E AUDITORIA] atualiza contentHash deterministicamente e persiste schoolId e ipAddress no AuditLog", async () => {
    const repliedDate = new Date("2026-11-06T15:30:00.000Z");

    const req = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "187.55.120.45, 10.0.0.1",
      },
      body: JSON.stringify({
        logId: "msg-escola-a",
        guardianReplied: true,
        replyNotes: "Mãe confirmou que estudante retornará na segunda-feira.",
        replyCategory: "VIAGEM_FAMILIAR",
        extractedAt: repliedDate.toISOString(),
        sourceMethod: "EXTENSION_ASSISTED",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // Verifica persistência e promoção de status de entrega (SENT -> READ)
    const updated = mockMessageLogs["msg-escola-a"];
    expect(updated.guardianReplied).toBe(true);
    expect(updated.replyCategory).toBe("VIAGEM_FAMILIAR");
    expect(updated.replyNotes).toBe("Mãe confirmou que estudante retornará na segunda-feira.");
    expect(updated.deliveryStatus).toBe("READ");
    expect(updated.repliedByUserId).toBe("user-pedagoga-a");

    // Valida recálculo canônico do hash SHA-256
    const expectedHash = computeMessageContentHash({
      studentId: "student-a1",
      schoolId: "escola-a",
      phoneUsed: "41999990001",
      reasonTitle: "Faltas Consecutivas",
      messageContent: "Olá, o estudante faltou nos últimos dias.",
      sentByName: "Pedagoga Maria",
      sentAt: new Date("2026-11-05T10:00:00.000Z"),
      guardianReplied: true,
      replyNotes: "Mãe confirmou que estudante retornará na segunda-feira.",
      replyCategory: "VIAGEM_FAMILIAR",
      repliedAt: repliedDate,
    });
    expect(updated.contentHash).toBe(expectedHash);

    // Valida auditoria em conformidade com o Marco Civil da Internet (Art. 15)
    expect(mockAuditLogs.length).toBeGreaterThan(0);
    const audit = mockAuditLogs.find((a) => a.action === "MARK_REPLY" && a.entityId === "msg-escola-a");
    expect(audit).toBeDefined();
    expect(audit.schoolId).toBe("escola-a");
    expect(audit.ipAddress).toBe("187.55.120.45");

    const parsedDetails = JSON.parse(audit.details);
    expect(parsedDetails.sourceMethod).toBe("EXTENSION_ASSISTED");
    expect(parsedDetails.replyCategory).toBe("VIAGEM_FAMILIAR");
    expect(parsedDetails.contentHash).toBe(expectedHash);
  });

  it("4. [LGPD/ECA] mascara nome do estudante impedindo vazamento para IA e desmascara no retorno", async () => {
    process.env.GEMINI_API_KEY = "test-fake-gemini-key";

    // Resposta simulada do Gemini com o marcador de pseudo-anonimização
    mockInteractionsCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        formalSummary: "Responsável informou via WhatsApp que o estudante [ESTUDANTE_1] esteve internado com dengue.",
        category: "SAUDE",
      }),
    });

    const studentRealName = "Lucas Gabriel Rocha da Silva";
    const rawReplyMessage = `Bom dia, o ${studentRealName} estava com febre alta e foi diagnosticado com dengue ontem.`;

    const req = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: "msg-escola-a",
        guardianReplied: true,
        rawReply: rawReplyMessage,
        classifyWithAi: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verifica chamada ao Gemini
    expect(mockInteractionsCreate).toHaveBeenCalledTimes(1);
    const passedCall = mockInteractionsCreate.mock.calls[0][0];

    // O nome real do menor NÃO pode ter sido enviado à API do Gemini
    expect(passedCall.input).not.toContain(studentRealName);
    expect(passedCall.input).toContain("[ESTUDANTE_1]");

    // No entanto, o texto final gravado no prontuário deve ser restaurado via unmaskText
    const updated = mockMessageLogs["msg-escola-a"];
    expect(updated.replyCategory).toBe("SAUDE");
    expect(updated.replyNotes).toContain(studentRealName);
    expect(updated.replyNotes).not.toContain("[ESTUDANTE_1]");
  });
});
