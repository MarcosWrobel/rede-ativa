import { describe, it, expect, vi, beforeEach } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  auth: vi.fn(async () => null as any),
  handlersGet: vi.fn(),
  handlersPost: vi.fn(),
  enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("@/lib/auth", () => ({
  auth: hoistedMocks.auth,
  handlers: {
    GET: hoistedMocks.handlersGet,
    POST: hoistedMocks.handlersPost,
  },
}));

vi.mock("@/lib/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rateLimit")>("@/lib/rateLimit");
  return {
    ...actual,
    enforceRateLimit: hoistedMocks.enforceRateLimit,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    messageLog: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async ({ data }: any) => ({ id: "log-1", ...data })),
    },
    student: {
      findMany: vi.fn(async () => []),
    },
    attendanceSnapshot: {
      findMany: vi.fn(async () => []),
    },
  },
}));

import { safeCompareStrings } from "@/lib/syncToken";
import { BOOTSTRAP_ADMIN_EMAIL, isBootstrapAdminEmail } from "@/lib/roles";
import {
  messageSendSchema,
  initialDeliveryStatusEnum,
  sereBatchImportSchema,
} from "@/lib/schemas";
import {
  MAX_SERE_FILE_SIZE_BYTES,
  MAX_SERE_BATCH_TOTAL_BYTES,
  extractRowsFromFile,
  parseExcelBufferToRows,
  parseSereRawFiles,
} from "@/lib/sereParser";

describe("Auditoria Técnica e de Segurança V3 (Pré-Expansão)", () => {
  describe("H-06 & H-07: Comparação em Tempo Constante (safeCompareStrings)", () => {
    it("valida correspondência exata de tokens", () => {
      expect(safeCompareStrings("super-secret-token-123", "super-secret-token-123")).toBe(true);
    });

    it("rejeita tokens incorretos de mesmo tamanho", () => {
      expect(safeCompareStrings("super-secret-token-123", "super-secret-token-456")).toBe(false);
    });

    it("rejeita tokens de tamanhos diferentes sem vazar comprimento via early return", () => {
      expect(safeCompareStrings("curto", "um-token-bem-mais-longo-e-complexo")).toBe(false);
      expect(safeCompareStrings("um-token-bem-mais-longo-e-complexo", "curto")).toBe(false);
    });

    it("trata valores nulos, vazios ou indefinidos com segurança retornando false", () => {
      expect(safeCompareStrings("", "token")).toBe(false);
      expect(safeCompareStrings("token", "")).toBe(false);
      expect(safeCompareStrings(null, "token")).toBe(false);
      expect(safeCompareStrings("token", null)).toBe(false);
      expect(safeCompareStrings(undefined, undefined)).toBe(false);
    });
  });

  describe("H-10: Configuração Segura de Bootstrap Admin", () => {
    it("reconhece o email padrão ou de ambiente institucional", () => {
      expect(isBootstrapAdminEmail(BOOTSTRAP_ADMIN_EMAIL)).toBe(true);
      expect(isBootstrapAdminEmail("marcos.wrobel@escola.pr.gov.br")).toBe(true);
      expect(isBootstrapAdminEmail("outro.usuario@escola.pr.gov.br")).toBe(false);
      expect(isBootstrapAdminEmail("")).toBe(false);
      expect(isBootstrapAdminEmail(null)).toBe(false);
    });
  });

  describe("P-07 & P-08: Validação Zod de Status Inicial de Mensageria", () => {
    it("aceita status válidos de despacho inicial (LINK_OPENED, SENT, FAILED_NO_WHATSAPP)", () => {
      expect(initialDeliveryStatusEnum.safeParse("LINK_OPENED").success).toBe(true);
      expect(initialDeliveryStatusEnum.safeParse("SENT").success).toBe(true);
      expect(initialDeliveryStatusEnum.safeParse("FAILED_NO_WHATSAPP").success).toBe(true);
    });

    it("rejeita status de transição de recibos (READ, DELIVERED) na criação de envio", () => {
      const readAttempt = messageSendSchema.safeParse({
        studentId: "st-1",
        reasonTitle: "Aviso",
        messageContent: "Olá responsável",
        initialDeliveryStatus: "READ",
      });
      expect(readAttempt.success).toBe(false);

      const deliveredAttempt = messageSendSchema.safeParse({
        studentId: "st-1",
        reasonTitle: "Aviso",
        messageContent: "Olá responsável",
        initialDeliveryStatus: "DELIVERED",
      });
      expect(deliveredAttempt.success).toBe(false);
    });

    it("rejeita strings arbitrárias de status", () => {
      const invalidAttempt = messageSendSchema.safeParse({
        studentId: "st-1",
        reasonTitle: "Aviso",
        messageContent: "Olá responsável",
        initialDeliveryStatus: "HACKED_STATUS",
      });
      expect(invalidAttempt.success).toBe(false);
    });
  });

  describe("H-06: Endpoint Webhook WhatsApp (Assinatura e Pareamento)", () => {
    it("retorna 503 se WHATSAPP_WEBHOOK_SECRET não estiver configurado", async () => {
      const original = process.env.WHATSAPP_WEBHOOK_SECRET;
      delete process.env.WHATSAPP_WEBHOOK_SECRET;

      const { POST } = await import("@/app/api/webhooks/whatsapp/route");
      const req = new Request("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "41999998888", text: "ok" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(503);

      if (original) process.env.WHATSAPP_WEBHOOK_SECRET = original;
    });

    it("retorna 401 se a assinatura do webhook for inválida", async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = "segredo-oficial-123";

      const { POST } = await import("@/app/api/webhooks/whatsapp/route");
      const req = new Request("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer segredo-falso-999",
        },
        body: JSON.stringify({ phone: "41999998888", text: "ok" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejeita telefone inválido com 200 ignored", async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = "segredo-oficial-123";

      const { POST } = await import("@/app/api/webhooks/whatsapp/route");
      const req = new Request("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": "segredo-oficial-123",
        },
        body: JSON.stringify({ phone: "123", text: "ok" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ignored).toBe(true);
      expect(data.reason).toBe("Telefone ausente ou inválido");
    });
  });

  describe("H-07: Endpoint Cron Weekly Digest (Proteção de Perímetro)", () => {
    it("retorna 401 se chamado sem secret e sem sessão", async () => {
      process.env.CRON_SECRET = "cron-secret-abc";

      const { GET } = await import("@/app/api/cron/weekly-digest/route");
      const { NextRequest } = await import("next/server");
      const req = new NextRequest("http://localhost:3000/api/cron/weekly-digest");

      const res = await GET(req);
      expect(res.status).toBe(401);
    });
  });

  describe("AUD-04: Limites Defensivos SERE e Sanitização 500 Residual", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      hoistedMocks.auth.mockResolvedValue(null);
      hoistedMocks.enforceRateLimit.mockResolvedValue({ ok: true as const });
    });

    it("rejeita lotes SERE com mais de 500 turmas no sereBatchImportSchema", () => {
      const turmasExcedentes = Array.from({ length: 501 }, (_, idx) => ({
        tempId: `t-${idx}`,
        name: `Turma ${idx}`,
        segment: "FUNDAMENTAL" as const,
        shift: "MANHA" as const,
      }));

      const result = sereBatchImportSchema.safeParse({
        turmas: turmasExcedentes,
        students: [
          {
            cgm: "123456",
            name: "Estudante Teste",
            phone: "41999998888",
            turmaTempId: "t-0",
          },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("500 turmas");
      }
    });

    it("rejeita lotes SERE com mais de 5.000 estudantes ou transferidos no sereBatchImportSchema", () => {
      const studentsExcedentes = Array.from({ length: 5001 }, (_, idx) => ({
        cgm: String(1000000 + idx),
        name: `Estudante ${idx}`,
        phone: "41999998888",
        turmaTempId: "t-0",
      }));

      const resultStudents = sereBatchImportSchema.safeParse({
        turmas: [
          {
            tempId: "t-0",
            name: "6º Ano A",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
          },
        ],
        students: studentsExcedentes,
      });

      expect(resultStudents.success).toBe(false);
      if (!resultStudents.success) {
        expect(resultStudents.error.issues[0]?.message).toContain("5.000 estudantes");
      }

      const transferredExcedentes = Array.from({ length: 5001 }, (_, idx) => ({
        cgm: String(2000000 + idx),
        name: `Transferido ${idx}`,
      }));

      const resultTransferred = sereBatchImportSchema.safeParse({
        turmas: [
          {
            tempId: "t-0",
            name: "6º Ano A",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
          },
        ],
        students: [
          {
            cgm: "123456",
            name: "Estudante Válido",
            phone: "41999998888",
            turmaTempId: "t-0",
          },
        ],
        transferredStudents: transferredExcedentes,
      });

      expect(resultTransferred.success).toBe(false);
      if (!resultTransferred.success) {
        expect(resultTransferred.error.issues[0]?.message).toContain("5.000 transferidos");
      }
    });

    it("rejeita buffers acima de MAX_SERE_FILE_SIZE_BYTES (10 MB) e lotes acima de 25 MB no sereParser", async () => {
      expect(MAX_SERE_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
      expect(MAX_SERE_BATCH_TOTAL_BYTES).toBe(25 * 1024 * 1024);

      const oversizedBuffer = new ArrayBuffer(MAX_SERE_FILE_SIZE_BYTES + 1);

      expect(() => parseExcelBufferToRows(oversizedBuffer)).toThrow(/10 MB/);
      await expect(
        extractRowsFromFile({ fileName: "grande.xlsx", buffer: oversizedBuffer })
      ).rejects.toThrow(/10 MB/);

      const chunk9Mb = new ArrayBuffer(9 * 1024 * 1024);
      await expect(
        parseSereRawFiles([
          { fileName: "turno1.csv", buffer: chunk9Mb },
          { fileName: "turno2.csv", buffer: chunk9Mb },
          { fileName: "turno3.csv", buffer: chunk9Mb },
        ])
      ).rejects.toThrow(/25 MB/);
    });

    it("POST /api/ai/test-key não vaza error.message bruto no JSON HTTP 500", async () => {
      hoistedMocks.auth.mockResolvedValueOnce({
        user: { id: "usr-1", email: "pedagoga@escola.pr.gov.br", name: "Pedagoga", role: "PEDAGOGA", active: true },
      });
      hoistedMocks.enforceRateLimit.mockRejectedValueOnce(
        new Error("NEON_INTERNAL_CONNECTION_STRING_SECRET")
      );

      const { POST } = await import("@/app/api/ai/test-key/route");
      const req = new Request("http://localhost:3000/api/ai/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "AIzaFakeKey1234567890" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        success: false,
        error: "Erro interno ao testar conectividade da chave de IA.",
      });
      expect(JSON.stringify(body)).not.toContain("NEON_INTERNAL_CONNECTION_STRING_SECRET");
    });

    it("POST /api/ai/generate-template não vaza error.message bruto no JSON HTTP 500", async () => {
      hoistedMocks.auth.mockResolvedValueOnce({
        user: { id: "usr-1", email: "pedagoga@escola.pr.gov.br", name: "Pedagoga", role: "PEDAGOGA", active: true },
      });
      hoistedMocks.enforceRateLimit.mockRejectedValueOnce(
        new Error("SENSITIVE_STACK_TRACE_INTERNAL_DB")
      );

      const { POST } = await import("@/app/api/ai/generate-template/route");
      const req = new Request("http://localhost:3000/api/ai/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Aviso de reunião" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        error: "Erro interno ao processar modelo com IA.",
      });
      expect(JSON.stringify(body)).not.toContain("SENSITIVE_STACK_TRACE_INTERNAL_DB");
    });

    it("GET e POST /api/auth/[...nextauth] não vazam error.message nem errorDetails no JSON HTTP 500", async () => {
      const sensitiveError: any = new Error("AUTH_SECRET_PG_DSN_LEAK_TOKEN");
      sensitiveError.name = "OAuthCallbackError";
      sensitiveError.type = "CallbackRouteError";
      sensitiveError.cause = "postgres://admin:supersecret@db.internal:5432/prod";

      hoistedMocks.handlersGet.mockRejectedValueOnce(sensitiveError);
      hoistedMocks.handlersPost.mockRejectedValueOnce(new Error("AUTH_POST_SECRET_LEAK"));

      const { GET, POST } = await import("@/app/api/auth/[...nextauth]/route");
      const { NextRequest } = await import("next/server");

      const reqGet = new NextRequest("http://localhost:3000/api/auth/callback/google?code=secret", {
        headers: { accept: "application/json", host: "app.redeativa.com.br" },
      });
      const resGet = await GET(reqGet);
      expect(resGet.status).toBe(500);
      const bodyGet = await resGet.json();
      expect(bodyGet).toEqual({
        error: "Falha interna no processamento de autenticação.",
      });
      const serializedGet = JSON.stringify(bodyGet);
      expect(serializedGet).not.toContain("AUTH_SECRET_PG_DSN_LEAK_TOKEN");
      expect(serializedGet).not.toContain("postgres://");
      expect(serializedGet).not.toContain("detalhes");
      expect(serializedGet).not.toContain("cookiesPresent");
      expect(serializedGet).not.toContain("mensagem");
      expect(serializedGet).not.toContain("tipo");

      const reqPost = new NextRequest("http://localhost:3000/api/auth/signin/google", {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const resPost = await POST(reqPost);
      expect(resPost.status).toBe(500);
      const bodyPost = await resPost.json();
      expect(bodyPost).toEqual({
        error: "Falha interna no processamento de autenticação.",
      });
      expect(JSON.stringify(bodyPost)).not.toContain("AUTH_POST_SECRET_LEAK");
    });
  });
});
