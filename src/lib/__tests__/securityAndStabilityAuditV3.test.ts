import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => null),
}));

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
import { messageSendSchema, initialDeliveryStatusEnum } from "@/lib/schemas";

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
});
