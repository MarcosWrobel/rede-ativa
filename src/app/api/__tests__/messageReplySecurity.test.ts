import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "../messages/reply/route";
import { POST as classifyPost } from "../ai/classify-reply/route";
import { PATCH as statusPatch } from "../messages/status/route";
import { PUT as managePut, DELETE as manageDelete } from "../messages/manage/route";
import { POST as webhookPost } from "../webhooks/whatsapp/route";
import { computeMessageContentHash, verifyMessageIntegrity } from "@/lib/messageCrypto";

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
const mockStudentContacts: any[] = [];

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
      name: id === "escola-a" ? "Escola A" : "Escola Municipal B",
      inepCode: id === "escola-a" ? "41000001" : "41000002",
      edition: id === "escola-b" ? "INSTITUCIONAL_ESSENCIAL" : "PILOTO_INTEGRADA",
    };
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    messageLog: {
      findUnique: vi.fn(async ({ where }: any) => {
        return mockMessageLogs[where.id] || null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        let list = Object.values(mockMessageLogs);
        if (where?.phoneUsed?.endsWith) {
          list = list.filter((l) => (l.phoneUsed || "").endsWith(where.phoneUsed.endsWith));
        }
        if (where?.student?.schoolId) {
          list = list.filter((l) => l.student?.schoolId === where.student.schoolId);
        }
        return list;
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
      delete: vi.fn(async ({ where }: any) => {
        const prev = mockMessageLogs[where.id];
        delete mockMessageLogs[where.id];
        return prev;
      }),
    },
    studentContact: {
      findMany: vi.fn(async ({ where }: any) => {
        return mockStudentContacts.filter((c) => {
          if (where.studentId && c.studentId !== where.studentId) return false;
          if (where.whatsappValid !== undefined && c.whatsappValid !== where.whatsappValid) return false;
          return true;
        });
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const c of mockStudentContacts) {
          if (where.id?.in?.includes(c.id)) {
            Object.assign(c, data);
            count++;
          }
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `contact-${mockStudentContacts.length + 1}`, ...data };
        mockStudentContacts.push(item);
        return item;
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
    mockStudentContacts.length = 0;

    mockStudentContacts.push({
      id: "contact-1",
      studentId: "student-a1",
      name: "Sônia Regina Rocha",
      phone: "41999990001",
      whatsappValid: false,
    });

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
        guardianName: "Sônia Regina Rocha",
        schoolId: "escola-a",
        classGroup: { name: "9º Ano A" },
        contacts: [
          {
            id: "contact-1",
            name: "Sônia Regina Rocha",
            phone: "41999990001",
            whatsappValid: false,
          },
        ],
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
        classGroup: { name: "1º Ano B" },
        contacts: [
          {
            id: "contact-2",
            name: "Mãe Escola B",
            phone: "41999990002",
            whatsappValid: true,
          },
        ],
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
    const guardianRealName = "Sônia Regina Rocha";
    const rawReplyMessage = `Bom dia, sou a ${guardianRealName}. O ${studentRealName} estava com febre alta e foi diagnosticado com dengue ontem.`;

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

    // O nome real do menor e da responsável NÃO podem ter sido enviados à API do Gemini
    expect(passedCall.input).not.toContain(studentRealName);
    expect(passedCall.input).not.toContain(guardianRealName);
    expect(passedCall.input).toContain("[ESTUDANTE_1]");
    expect(passedCall.input).toContain("[RESPONSAVEL_1]");

    // No entanto, o texto final gravado no prontuário deve ser restaurado via unmaskText
    const updated = mockMessageLogs["msg-escola-a"];
    expect(updated.replyCategory).toBe("SAUDE");
    expect(updated.replyNotes).toContain(studentRealName);
    expect(updated.replyNotes).not.toContain("[ESTUDANTE_1]");
  });

  it("5. [OCR MULTIMODAL] /api/ai/classify-reply aceita screenshotDataUrl sem rawReply e extrai texto + sintese via Gemini Vision", async () => {
    process.env.GEMINI_API_KEY = "test-fake-gemini-key";

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        extractedRawReply: "Bom dia! Ele perdeu o ônibus escolar hoje devido à chuva forte.",
        formalSummary: "Responsável informou que o estudante [ESTUDANTE_1] ausentou-se por falha no transporte escolar devido a chuva intensa.",
        category: "TRANSPORTE",
        requiresMedicalCertificate: false,
        suggestedFollowUp: "Registrar ocorrência de transporte e acompanhar frequência.",
      }),
    });

    const req = new Request("http://localhost:3000/api/ai/classify-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawReply: "",
        screenshotDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/",
        studentName: "Lucas Gabriel Rocha da Silva",
        reasonTitle: "Faltas Consecutivas",
      }),
    });

    const res = await classifyPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.usedOcr).toBe(true);
    expect(body.classification.extractedRawReply).toBe(
      "Bom dia! Ele perdeu o ônibus escolar hoje devido à chuva forte."
    );
    expect(body.classification.category).toBe("TRANSPORTE");
    expect(body.classification.formalSummary).toContain("Lucas Gabriel Rocha da Silva");
  });

  it("6. [IDOR EM STATUS E MANAGE] bloqueia com 403 Forbidden tentativas de atualizar status ou retificar registro de outra escola", async () => {
    // 6.1 Status: Usuário da Escola A tentando mudar status em mensagem da Escola B
    const statusReq = new Request("http://localhost:3000/api/messages/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: "msg-escola-b",
        deliveryStatus: "FAILED_NO_WHATSAPP",
      }),
    });
    const statusRes = await statusPatch(statusReq);
    expect(statusRes.status).toBe(403);
    const statusBody = await statusRes.json();
    expect(statusBody.error).toBe("Acesso negado a registro de outra instituição de ensino.");

    // 6.2 Manage PUT: Operador com role ADMIN da Escola A tentando retificar mensagem da Escola B
    mockSessionState.currentSession.user.role = "ADMIN";
    const putReq = new Request("http://localhost:3000/api/messages/manage", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "msg-escola-b",
        reasonTitle: "Tentativa de Edição Clandestina",
      }),
    });
    const putRes = await managePut(putReq);
    expect(putRes.status).toBe(403);

    // 6.3 Manage DELETE: Operador com role ADMIN da Escola A tentando excluir mensagem da Escola B
    const delReq = new Request("http://localhost:3000/api/messages/manage?id=msg-escola-b", {
      method: "DELETE",
    });
    const delRes = await manageDelete(delReq);
    expect(delRes.status).toBe(403);
    expect(mockMessageLogs["msg-escola-b"]).toBeDefined();
  });

  it("7. [INSTITUCIONAL_ESSENCIAL] registro de retorno e classificação por IA/fallback operam perfeitamente na escola-b", async () => {
    // Alterna sessão para usuária pedagoga da Escola B (edição INSTITUCIONAL_ESSENCIAL)
    mockSessionState.currentSession = {
      user: {
        id: "user-pedagoga-b",
        name: "Pedagoga Escola B",
        email: "pedagoga@escola-b.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "escola-b",
        active: true,
        schools: [{ schoolId: "escola-b", role: "PEDAGOGA", active: true }],
      },
    };

    // Sem chave Gemini: deve operar 100% via fallback heurístico determinístico
    process.env.GEMINI_API_KEY = "";

    const req = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: "msg-escola-b",
        guardianReplied: true,
        rawReply: "Boa tarde, o estudante foi ao médico no postinho de saúde para consulta.",
        sourceMethod: "MANUAL",
        classifyWithAi: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    const updated = mockMessageLogs["msg-escola-b"];
    expect(updated.guardianReplied).toBe(true);
    expect(updated.replyCategory).toBe("SAUDE");
    expect(updated.replyNotes).toContain("saúde/atendimento médico");
    expect(updated.deliveryStatus).toBe("READ");

    // Valida integridade criptográfica bipartida calculada para a Escola B
    const integrityCheck = verifyMessageIntegrity(updated.contentHash, {
      studentId: "student-b1",
      schoolId: "escola-b",
      phoneUsed: "41999990002",
      reasonTitle: "Busca Ativa Sigilosa",
      messageContent: "Mensagem restrita da Escola B.",
      sentByName: "Pedagoga Josefa",
      sentAt: new Date("2026-11-05T11:00:00.000Z"),
      guardianReplied: true,
      replyNotes: updated.replyNotes,
      replyCategory: updated.replyCategory,
      repliedAt: updated.repliedAt,
    });
    expect(integrityCheck.valid).toBe(true);
  });

  it("8. [HASH SHA-256 EM MANAGE] PUT /api/messages/manage preserva os campos de retorno e recalcula hash compatível com verifyMessageIntegrity", async () => {
    mockSessionState.currentSession = {
      user: {
        id: "admin-escola-a",
        name: "Admin Escola A",
        email: "admin@escola-a.pr.gov.br",
        role: "ADMIN",
        schoolId: "escola-a",
        active: true,
        schools: [{ schoolId: "escola-a", role: "ADMIN", active: true }],
      },
    };

    // Mensagem com retorno prévio
    mockMessageLogs["msg-escola-a"].guardianReplied = true;
    mockMessageLogs["msg-escola-a"].replyNotes = "Retorno inicial registrado.";
    mockMessageLogs["msg-escola-a"].replyCategory = "TRANSPORTE";
    mockMessageLogs["msg-escola-a"].repliedAt = new Date("2026-11-06T14:00:00.000Z");

    const req = new Request("http://localhost:3000/api/messages/manage", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "msg-escola-a",
        reasonTitle: "Faltas Justificadas com Atestado",
        replyNotes: "Retificação formal com entrega de atestado na secretaria.",
        replyCategory: "SAUDE",
      }),
    });

    const res = await managePut(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    const updated = mockMessageLogs["msg-escola-a"];
    expect(updated.reasonTitle).toBe("Faltas Justificadas com Atestado");
    expect(updated.replyNotes).toBe("Retificação formal com entrega de atestado na secretaria.");
    expect(updated.replyCategory).toBe("SAUDE");

    // Verifica que o hash recalculado inclui as 4 chaves de retorno
    const integrityCheck = verifyMessageIntegrity(updated.contentHash, {
      studentId: "student-a1",
      schoolId: "escola-a",
      phoneUsed: "41999990001",
      reasonTitle: "Faltas Justificadas com Atestado",
      messageContent: "Olá, o estudante faltou nos últimos dias.",
      sentByName: "Pedagoga Maria",
      sentAt: new Date("2026-11-05T10:00:00.000Z"),
      guardianReplied: true,
      replyNotes: "Retificação formal com entrega de atestado na secretaria.",
      replyCategory: "SAUDE",
      repliedAt: updated.repliedAt,
    });
    expect(integrityCheck.valid).toBe(true);
  });

  it("9. [WEBHOOK MULTI-TENANT E CONTENT HASH] impede colisão de mesmo telefone entre escolas e calcula contentHash", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "secret-webhook-key-123";

    // Adiciona uma mensagem na Escola B com o MESMO telefone da Escola A
    mockMessageLogs["msg-escola-b-colisao"] = {
      id: "msg-escola-b-colisao",
      studentId: "student-b2",
      reasonTitle: "Busca Ativa",
      messageContent: "Mensagem Escola B",
      phoneUsed: "41999990001", // Telefone idêntico ao da Escola A
      sentByName: "Pedagoga B",
      sentAt: new Date("2026-11-07T09:00:00.000Z"),
      guardianReplied: false,
      replyNotes: null,
      replyCategory: null,
      repliedAt: null,
      deliveryStatus: "SENT",
      contentHash: "hash-pre-webhook",
      student: {
        id: "student-b2",
        name: "Irmão na Escola B",
        schoolId: "escola-b",
      },
    };

    // 9.1 Sem identificador explícito de escola e sem menção ao nome do estudante:
    // O sistema DEVE ignorar para evitar colisão entre escolas
    const ambiguousReq = new Request("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-webhook-key-123",
      },
      body: JSON.stringify({
        phone: "41999990001",
        text: "Bom dia, ele não foi hoje por motivo de chuva.",
      }),
    });

    const ambiguousRes = await webhookPost(ambiguousReq);
    expect(ambiguousRes.status).toBe(200);
    const ambiguousBody = await ambiguousRes.json();
    expect(ambiguousBody.ignored).toBe(true);
    expect(ambiguousBody.reason).toContain("múltiplos estabelecimentos de ensino");

    // 9.2 Com explicitSchoolId ("escola-a"), direciona unívoco e atualiza contentHash
    const scopedReq = new Request("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-webhook-key-123",
      },
      body: JSON.stringify({
        phone: "41999990001",
        schoolId: "escola-a",
        text: "Bom dia, o Lucas teve febre alta e foi ao médico.",
      }),
    });

    const scopedRes = await webhookPost(scopedReq);
    expect(scopedRes.status).toBe(200);
    const scopedBody = await scopedRes.json();
    expect(scopedBody.success).toBe(true);

    const updatedA = mockMessageLogs["msg-escola-a"];
    expect(updatedA.guardianReplied).toBe(true);
    expect(updatedA.replyCategory).toBe("SAUDE");
    expect(updatedA.contentHash).not.toBe("hash-inicial-a");

    const integrityCheck = verifyMessageIntegrity(updatedA.contentHash, {
      studentId: "student-a1",
      schoolId: "escola-a",
      phoneUsed: "41999990001",
      reasonTitle: "Faltas Consecutivas",
      messageContent: "Olá, o estudante faltou nos últimos dias.",
      sentByName: "Pedagoga Maria",
      sentAt: new Date("2026-11-05T10:00:00.000Z"),
      guardianReplied: true,
      replyNotes: updatedA.replyNotes,
      replyCategory: updatedA.replyCategory,
      repliedAt: updatedA.repliedAt,
    });
    expect(integrityCheck.valid).toBe(true);
  });

  it("10. [SANITIZAÇÃO 500 EM IA] não vaza error.message bruto para o cliente HTTP", async () => {
    // Força uma falha crítica que caia no catch externo de /api/ai/classify-reply
    const req = new Request("http://localhost:3000/api/ai/classify-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "INVALID_JSON_CORRUPTED{{{",
    });

    const res = await classifyPost(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe("Erro interno ao classificar retorno pedagógico.");
    expect(body.error).not.toContain("SyntaxError");
    expect(body.error).not.toContain("JSON");
  });

  it("11. [REVALIDAÇÃO DE CONTATO NO RETORNO] restaura whatsappValid: true na agenda familiar", async () => {
    // O contato estava marcado com whatsappValid: false
    expect(mockStudentContacts[0].whatsappValid).toBe(false);

    const req = new Request("http://localhost:3000/api/messages/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: "msg-escola-a",
        guardianReplied: true,
        replyNotes: "Pai respondeu confirmando presença amanhã.",
        replyCategory: "SEM_JUSTIFICATIVA",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // O contato familiar agora deve estar marcado como whatsappValid: true
    expect(mockStudentContacts[0].whatsappValid).toBe(true);
  });
});
