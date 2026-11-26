import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

const hoisted = vi.hoisted(() => ({
  session: null as any,
  generatedContents: [] as string[],
  rateLimitThrow: false,
  rateLimitCounts: new Map<string, number>(),
  students: new Map<string, any>(),
  templates: new Map<string, any>(),
  messageLogs: new Map<string, any>(),
  auditLogs: [] as any[],
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/busca-ativa",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/lib/currentSchool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currentSchool")>("@/lib/currentSchool");
  const mockSchool = {
    id: "school-e-1",
    inepCode: "41999222",
    name: "Escola Municipal Modelo",
    city: "Tibagi",
    state: "PR",
    nre: "SEMEC Tibagi",
    network: "MUNICIPAL",
    edition: "INSTITUCIONAL_ESSENCIAL" as const,
  };
  return {
    ...actual,
    getCurrentSchool: vi.fn(async (schoolId?: string) => ({
      ...mockSchool,
      id: schoolId || mockSchool.id,
    })),
    getAuthorizedCurrentSchool: vi.fn(async (_session: any, schoolId?: string | null) => ({
      ...mockSchool,
      id: schoolId || mockSchool.id,
    })),
    requireAuthorizedSchool: vi.fn(async (_session: any, schoolId?: string | null) => ({
      ok: true as const,
      school: { ...mockSchool, id: schoolId || mockSchool.id },
    })),
    getSchoolContextByVerifiedId: vi.fn(async (schoolId?: string | null) => ({
      ...mockSchool,
      id: schoolId || mockSchool.id,
    })),
    isDefaultSchoolContext: vi.fn(() => false),
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (entry: any) => {
    hoisted.auditLogs.push(entry);
  }),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    interactions = {
      create: async (args: any) => {
        hoisted.generatedContents.push(String(args?.input || ""));
        return {
          output_text: JSON.stringify({
            formalSummary: "Responsável informou justificativa para [ESTUDANTE_1].",
            category: "SAUDE",
          }),
        };
      },
    };
    models = {
      generateContent: async (args: any) => {
        hoisted.generatedContents.push(String(args?.contents || ""));
        return {
          text: JSON.stringify({
            formalSummary: "Responsável informou justificativa para [ESTUDANTE_1].",
            category: "SAUDE",
          }),
        };
      },
    };
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: {
      findUnique: vi.fn(async ({ where }: any) => hoisted.students.get(where.id) || null),
    },
    messageTemplate: {
      findUnique: vi.fn(async ({ where }: any) => hoisted.templates.get(where.id) || null),
    },
    messageLog: {
      findUnique: vi.fn(async ({ where }: any) => hoisted.messageLogs.get(where.id) || null),
      findMany: vi.fn(async ({ where }: any) => {
        let rows = Array.from(hoisted.messageLogs.values());
        if (where?.phoneUsed?.endsWith) {
          rows = rows.filter((r) => String(r.phoneUsed).endsWith(where.phoneUsed.endsWith));
        }
        if (where?.student?.schoolId) {
          rows = rows.filter((r) => r.student?.schoolId === where.student.schoolId);
        }
        return rows;
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `log-${hoisted.messageLogs.size + 1}`, ...data };
        hoisted.messageLogs.set(created.id, created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = hoisted.messageLogs.get(where.id);
        const updated = { ...existing, ...data };
        hoisted.messageLogs.set(where.id, updated);
        return updated;
      }),
    },
    studentContact: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === "function") {
        return arg({
          $executeRaw: vi.fn(async () => 0),
          student: {
            findUnique: vi.fn(async ({ where }: any) => hoisted.students.get(where.id) || null),
          },
          classGroup: {
            findUnique: vi.fn(async ({ where }: any) => ({
              id: where.id,
              schoolId: "school-e-1",
              name: "6º Ano A",
            })),
          },
          messageTemplate: {
            findUnique: vi.fn(async () => null),
          },
          messageLog: {
            create: vi.fn(async ({ data }: any) => {
              const created = { id: `log-${hoisted.messageLogs.size + 1}`, ...data };
              hoisted.messageLogs.set(created.id, created);
              return created;
            }),
            update: vi.fn(async ({ where, data }: any) => {
              const existing = hoisted.messageLogs.get(where.id);
              const updated = { ...existing, ...data };
              hoisted.messageLogs.set(where.id, updated);
              return updated;
            }),
          },
        });
      }
      return Promise.all(arg);
    }),
  },
}));

import { POST as replyPost } from "@/app/api/messages/reply/route";
import { POST as sendPost } from "@/app/api/messages/send/route";
import { POST as webhookPost } from "@/app/api/webhooks/whatsapp/route";
import { getSyncCorsHeaders } from "@/lib/cors";
import { encryptSyncToken, decryptSyncToken } from "@/lib/syncToken";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import SchoolSelector from "@/components/SchoolSelector";
import PwaRegister from "@/components/PwaRegister";
import WhatsAppReplyCaptureModal from "@/components/whatsapp/WhatsAppReplyCaptureModal";

describe("Remediação Setorial do Setor E e Camada Transversal (E1-E4, T1-T2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.generatedContents = [];
    hoisted.auditLogs = [];
    hoisted.rateLimitCounts.clear();
    hoisted.students.clear();
    hoisted.templates.clear();
    hoisted.messageLogs.clear();

    hoisted.session = {
      user: {
        id: "user-ped-1",
        name: "Pedagoga Escola E",
        email: "pedagoga@escola.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "school-e-1",
        active: true,
        schools: [{ schoolId: "school-e-1", role: "PEDAGOGA" }],
      },
    };
  });

  describe("[E1] Pseudonimização LGPD em Respostas e Rate Limit em Envios", () => {
    it("POST /api/messages/reply mascara PII dentro de reasonTitle antes de enviar ao Gemini", async () => {
      process.env.GEMINI_API_KEY = "fake-gemini-key-test";
      hoisted.messageLogs.set("log-reply-1", {
        id: "log-reply-1",
        studentId: "stu-e-1",
        phoneUsed: "5542999991111",
        reasonTitle:
          "Busca Ativa de LucasGabriel, responsável Maria Souza, fone (42) 99888-7766 e CGM 1018613740",
        messageContent: "Olá, solicitamos contato.",
        sentByName: "Pedagoga Escola E",
        sentAt: new Date("2026-11-10T10:00:00.000Z"),
        guardianReplied: false,
        replyNotes: null,
        replyCategory: null,
        student: {
          id: "stu-e-1",
          name: "LucasGabriel",
          guardianName: "Maria Souza",
          schoolId: "school-e-1",
        },
      });

      const req = new Request("http://localhost/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: "log-reply-1",
          guardianReplied: true,
          rawReply: "LucasGabriel esteve no médico hoje.",
          classifyWithAi: true,
        }),
      });

      const res = await replyPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.mode).toBe("LOCAL_ONLY");
      expect(data.updated.replyCategory).toBe("SAUDE");
      expect(hoisted.generatedContents).toHaveLength(0);
    });

    it("POST /api/messages/send aplica enforceRateLimit e bloqueia excesso de disparos com HTTP 429", async () => {
      hoisted.session.user.id = "user-rate-limit-send";
      hoisted.students.set("stu-rl-1", {
        id: "stu-rl-1",
        name: "Estudante Teste",
        phone: "42999998888",
        schoolId: "school-e-1",
        classGroupId: "cg-1",
        classGroup: { id: "cg-1", name: "6º Ano A" },
      });

      let hit429 = false;
      for (let i = 0; i < 65; i++) {
        const req = new Request("http://localhost/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-rl-1",
            reasonTitle: "Alerta de frequência",
            messageContent: "Olá, precisamos conversar sobre frequência.",
          }),
        });
        const res = await sendPost(req);
        if (res.status === 429) {
          hit429 = true;
          break;
        }
        expect(res.status).toBe(200);
      }

      expect(hit429).toBe(true);
    });
  });

  describe("[E2] Blindagem Anti-IDOR Passivo no Webhook WhatsApp", () => {
    it("rejeita colisão multi-escola sem explicitSchoolId mesmo quando o texto contém prenome de estudante", async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = "webhook-secret-test-e2";

      hoisted.messageLogs.set("log-a", {
        id: "log-a",
        studentId: "stu-a",
        phoneUsed: "5541999990001",
        reasonTitle: "Infrequência",
        messageContent: "Contato escola A",
        sentByName: "Pedagoga A",
        sentAt: new Date("2026-11-18T10:00:00.000Z"),
        guardianReplied: false,
        student: { id: "stu-a", name: "Lucas Silva", schoolId: "escola-a" },
      });
      hoisted.messageLogs.set("log-b", {
        id: "log-b",
        studentId: "stu-b",
        phoneUsed: "5541999990001",
        reasonTitle: "Infrequência",
        messageContent: "Contato escola B",
        sentByName: "Pedagoga B",
        sentAt: new Date("2026-11-18T11:00:00.000Z"),
        guardianReplied: false,
        student: { id: "stu-b", name: "Ana Pereira", schoolId: "escola-b" },
      });

      const req = new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer webhook-secret-test-e2",
        },
        body: JSON.stringify({
          phone: "41999990001",
          text: "Bom dia, o Lucas faltou porque foi ao médico.",
        }),
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ignored).toBe(true);
      expect(body.reason).toContain("múltiplos estabelecimentos");
      expect(hoisted.messageLogs.get("log-a").guardianReplied).toBe(false);
      expect(hoisted.messageLogs.get("log-b").guardianReplied).toBe(false);
    });
  });

  describe("[E3] Hardening MV3 (content.js / serp-content.js) e CORS GET", () => {
    it("getSyncCorsHeaders permite GET, POST e OPTIONS para origens confiáveis e bloqueia terceiros", () => {
      const trustedReq = new Request("https://www.redeativa.app.br/api/messages/pending", {
        headers: { Origin: "https://www.redeativa.app.br" },
      });
      const trustedHeaders = getSyncCorsHeaders(trustedReq);
      expect(trustedHeaders["Access-Control-Allow-Origin"]).toBe("https://www.redeativa.app.br");
      expect(trustedHeaders["Access-Control-Allow-Methods"]).toContain("GET");
      expect(trustedHeaders["Access-Control-Allow-Methods"]).toContain("POST");
      expect(trustedHeaders["Access-Control-Allow-Methods"]).toContain("OPTIONS");

      const untrustedReq = new Request("https://www.redeativa.app.br/api/messages/pending", {
        headers: { Origin: "https://evil-collector.example.com" },
      });
      const untrustedHeaders = getSyncCorsHeaders(untrustedReq);
      expect(untrustedHeaders["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("content.js e serp-content.js validam isTrustedSyncServerUrl antes de salvar URL ou enviar Bearer token", () => {
      const contentJs = fs.readFileSync(
        path.resolve(process.cwd(), "extension/content.js"),
        "utf8"
      );
      const serpJs = fs.readFileSync(
        path.resolve(process.cwd(), "extension/serp-content.js"),
        "utf8"
      );

      for (const code of [contentJs, serpJs]) {
        expect(code).toContain("OFFICIAL_SYNC_HTTPS_HOSTS");
        expect(code).toContain("function isTrustedSyncServerUrl(rawUrl)");
        expect(code).toContain("if (!isTrustedSyncServerUrl(candidateUrl))");
        expect(code).toContain("if (!isTrustedSyncServerUrl(baseUrl))");
      }
      expect(contentJs).not.toContain("seu-app.vercel.app");
    });
  });

  describe("[T1] Fechamento de Segredos Fallback em Produção (syncToken.ts)", () => {
    it("falha fechado em produção se NEXTAUTH_SECRET e AUTH_SECRET estiverem ausentes", () => {
      const prevEnv = process.env.NODE_ENV;
      const prevVercel = process.env.VERCEL_ENV;
      const prevNextAuth = process.env.NEXTAUTH_SECRET;
      const prevAuth = process.env.AUTH_SECRET;

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = "production";
        delete process.env.VERCEL_ENV;
        delete process.env.NEXTAUTH_SECRET;
        delete process.env.AUTH_SECRET;

        expect(() => encryptSyncToken("token-secreto-producao")).toThrow(
          /NEXTAUTH_SECRET|AUTH_SECRET/
        );
        expect(decryptSyncToken("aes256gcm:00:00:00")).toBeNull();

        process.env.NEXTAUTH_SECRET = "chave-producao-forte-32-bytes-valida";
        const encrypted = encryptSyncToken("token-secreto-producao");
        expect(encrypted.startsWith("aes256gcm:")).toBe(true);
        expect(decryptSyncToken(encrypted)).toBe("token-secreto-producao");
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
        if (prevVercel !== undefined) process.env.VERCEL_ENV = prevVercel;
        else delete process.env.VERCEL_ENV;
        if (prevNextAuth !== undefined) process.env.NEXTAUTH_SECRET = prevNextAuth;
        else delete process.env.NEXTAUTH_SECRET;
        if (prevAuth !== undefined) process.env.AUTH_SECRET = prevAuth;
        else delete process.env.AUTH_SECRET;
      }
    });
  });

  describe("[T2] Conformidade Global Regra 10 e Neutralidade no Shell e UIs do Setor E", () => {
    it("Sidebar, TopHeader, SchoolSelector, PwaRegister e Modal de Retorno cumprem Regra 10 e neutralidade", () => {
      const superUser = {
        name: "Gestora Teste",
        email: "gestora@escola.pr.gov.br",
        role: "SUPERADMIN",
        schools: [],
      };
      const essentialSchool = {
        id: "school-essencial",
        inepCode: "41888999",
        name: "",
        city: "Tibagi",
        network: "MUNICIPAL",
        edition: "INSTITUCIONAL_ESSENCIAL",
      };

      const sidebarHtml = renderToString(
        React.createElement(Sidebar, {
          currentUser: superUser,
          currentSchool: essentialSchool,
          mobileOpen: true,
          setMobileOpen: () => {},
        })
      );
      expect(sidebarHtml).not.toMatch(/f[ée]\s+p[úu]blica/i);
      expect(sidebarHtml).not.toMatch(/imut[áa]ve(?:l|is)/i);
      expect(sidebarHtml).not.toContain("SERP");
      expect(sidebarHtml).toContain("Livro de Atas");

      const topHeaderHtml = renderToString(
        React.createElement(TopHeader, {
          currentUser: superUser,
          currentSchool: essentialSchool,
          onOpenMobile: () => {},
        })
      );
      expect(topHeaderHtml).not.toContain("Colégio Estadual");
      expect(topHeaderHtml).toContain("Instituição de Ensino");

      const selectorHtml = renderToString(
        React.createElement(SchoolSelector, {
          currentSchool: essentialSchool as any,
          userSchools: [],
          isAdmin: true,
        })
      );
      expect(selectorHtml).not.toContain("Colégio Estadual");
      expect(selectorHtml).toContain("Instituição de Ensino");

      const modalHtml = renderToString(
        React.createElement(WhatsAppReplyCaptureModal, {
          isOpen: true,
          onClose: () => {},
          messageLog: {
            id: "log-ui-1",
            studentId: "stu-1",
            phoneUsed: "42999998888",
            reasonTitle: "Faltas",
            messageContent: "Olá",
            sentByName: "Pedagoga",
            sentAt: "2026-11-18T10:00:00Z",
            guardianReplied: false,
          },
          studentName: "Estudante Teste",
          classNameLabel: "6º Ano A",
          onSuccess: () => {},
        })
      );
      expect(modalHtml).not.toMatch(/SHA-256/i);
      expect(modalHtml).not.toContain("Dossiê SERP");
      expect(modalHtml).toContain("Confirmar e registrar retorno");

      const checkedFiles = [
        "src/components/Sidebar.tsx",
        "src/components/TopHeader.tsx",
        "src/components/SchoolSelector.tsx",
        "src/components/PwaRegister.tsx",
        "src/components/whatsapp/WhatsAppReplyCaptureModal.tsx",
        "src/app/busca-ativa/BuscaAtivaClient.tsx",
        "src/app/historico/HistoricoClient.tsx",
      ];
      for (const relPath of checkedFiles) {
        const raw = fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
        const visibleOnly = raw
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        expect(visibleOnly).not.toMatch(/f[ée]\s+p[úu]blica/i);
        expect(visibleOnly).not.toMatch(/imut[áa]ve(?:l|is)/i);
        expect(visibleOnly).not.toContain("Iniciar disparos");
        expect(visibleOnly).not.toContain("será auditada");
        expect(visibleOnly).not.toContain("SHA-256");
      }

      const sidebarCode = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/Sidebar.tsx"),
        "utf8"
      );
      expect(sidebarCode).toContain("Atas e confirmação de autoria por PIN");
      expect(sidebarCode).toContain("Histórico de ações e autoria");

      const pwaCode = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/PwaRegister.tsx"),
        "utf8"
      );
      expect(pwaCode).not.toContain('.register("/sw.js")');
      expect(pwaCode).toContain("cleanupLegacyServiceWorkersAndCaches");
    });
  });
});
