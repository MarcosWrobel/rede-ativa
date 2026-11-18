import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { NextRequest } from "next/server";

const hoisted = vi.hoisted(() => ({
  session: null as any,
  cookieSchool: {
    id: "school-cookie-a",
    inepCode: "41000001",
    name: "Escola Cookie A",
    city: "Curitiba",
    state: "PR",
    nre: "NRE Curitiba",
    network: "ESTADUAL",
    phone: null,
    email: null,
    logoUrl: "/api/schools/school-cookie-a/logo?v=1",
    edition: "PILOTO_INTEGRADA" as const,
  },
  targetSchoolRecord: {
    id: "school-target-b",
    inepCode: "41000002",
    name: "Escola Real do Estudante B",
    city: "Tibagi",
    state: "PR",
    nre: "SEMEC Tibagi",
    network: "MUNICIPAL",
    phone: null,
    email: null,
    settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
    networkId: "net-tibagi",
    educationNetwork: { schools: [] },
    updatedAt: new Date("2026-11-18T10:00:00.000Z"),
  },
  bundle: null as any,
  auditLogs: [] as any[],
}));

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    auth: vi.fn(async () => null),
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("@/lib/auth.config", () => ({
  authConfig: {},
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "active_school_id" ? { name, value: "school-cookie-a" } : undefined,
  })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  usePathname: () => "/alunos/stu-b-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/ata/AtaEditorModal", () => ({
  default: () => null,
}));

vi.mock("@/components/ata/PhysicalScanModal", () => ({
  default: () => null,
}));

vi.mock("@/components/whatsapp/WhatsAppReplyCaptureModal", () => ({
  default: () => null,
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async () => hoisted.cookieSchool),
}));

vi.mock("@/lib/safePhase3Queries", () => ({
  loadStudent360Bundle: vi.fn(async () => hoisted.bundle),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (entry: any) => {
    hoisted.auditLogs.push(entry);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id === "school-target-b") {
          return hoisted.targetSchoolRecord;
        }
        return null;
      }),
    },
  },
}));

import { SELF_AUTH_API_PREFIXES } from "@/lib/proxyConstants";
import { proxy } from "@/proxy";
import { computeMessageContentHash } from "@/lib/messageCrypto";
import DossiePage from "@/app/alunos/[id]/dossie/page";
import ProntuarioPage from "@/app/alunos/[id]/page";
import DossieClient from "@/app/alunos/[id]/dossie/DossieClient";
import ProntuarioClient from "@/app/alunos/[id]/ProntuarioClient";

describe("Remediação de Integração Sistêmica (Int-1, E3, Int-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auditLogs = [];
    hoisted.session = {
      user: {
        id: "super-1",
        name: "SuperAdmin Global",
        email: "super@redeativa.app.br",
        role: "SUPERADMIN",
        schoolId: null,
        active: true,
      },
    };
    hoisted.bundle = {
      student: {
        id: "stu-b-1",
        name: "Estudante Escola B",
        cgm: "1018613740",
        phone: "42999998888",
        schoolId: "school-target-b",
        classGroup: { name: "7º Ano B", segment: "FUNDAMENTAL", shift: "TARDE" },
        messageLogs: [],
      },
      contacts: [],
      justifications: [],
      attendances: [],
      snapshots: [],
      minutes: [],
    };
  });

  describe("[Int-1] Precisão Forense Cross-Tenant para SUPERADMIN em SSR", () => {
    it("DossiePage ignora override do cookie active_school_id e resolve escola real do estudante em school e AuditLog", async () => {
      const element: any = await DossiePage({
        params: Promise.resolve({ id: "stu-b-1" }),
      });

      expect(element.props.school.id).toBe("school-target-b");
      expect(element.props.school.name).toBe("Escola Real do Estudante B");
      expect(element.props.school.edition).toBe("INSTITUCIONAL_ESSENCIAL");

      expect(hoisted.auditLogs).toHaveLength(1);
      expect(hoisted.auditLogs[0].action).toBe("GENERATE_DOSSIER");
      expect(hoisted.auditLogs[0].schoolId).toBe("school-target-b");
      expect(hoisted.auditLogs[0].details.schoolName).toBe("Escola Real do Estudante B");
    });

    it("ProntuarioPage ignora override do cookie active_school_id e entrega escola real do estudante ao ProntuarioClient", async () => {
      const element: any = await ProntuarioPage({
        params: Promise.resolve({ id: "stu-b-1" }),
      });

      expect(element.props.currentSchool.id).toBe("school-target-b");
      expect(element.props.currentSchool.name).toBe("Escola Real do Estudante B");
      expect(element.props.currentSchool.edition).toBe("INSTITUCIONAL_ESSENCIAL");
    });
  });

  describe("[E3 / Int-1] Liberação de /api/messages/pending no Proxy de Borda", () => {
    it("inclui /api/messages/pending em SELF_AUTH_API_PREFIXES e permite passagem sem sessão para Bearer token", async () => {
      expect(SELF_AUTH_API_PREFIXES).toContain("/api/messages/pending");

      const pendingReq = new NextRequest("http://localhost:3000/api/messages/pending", {
        method: "GET",
        headers: { Authorization: "Bearer ext-sync-token-123" },
      });
      const pendingRes = await proxy(pendingReq);
      expect(pendingRes.status).toBe(200);

      const protectedReq = new NextRequest("http://localhost:3000/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const protectedRes = await proxy(protectedReq);
      expect(protectedRes.status).toBe(401);
    });
  });

  describe("[Int-3] Verificação Ativa de Integridade em DossieClient e ProntuarioClient", () => {
    it("exibe indicador Verificado para hash íntegro e Divergência para registro adulterado cumprindo Regra 10", () => {
      const sentAt = "2026-11-18T12:00:00.000Z";
      const validHash = computeMessageContentHash({
        studentId: "stu-b-1",
        schoolId: "school-target-b",
        phoneUsed: "5542999998888",
        reasonTitle: "Alerta de frequência",
        messageContent: "Olá, solicitamos retorno sobre faltas.",
        sentByName: "Pedagoga Escola B",
        sentAt,
        guardianReplied: false,
      });

      const validLog = {
        id: "log-valid-1",
        studentId: "stu-b-1",
        phoneUsed: "5542999998888",
        reasonTitle: "Alerta de frequência",
        messageContent: "Olá, solicitamos retorno sobre faltas.",
        sentByName: "Pedagoga Escola B",
        sentAt,
        deliveryStatus: "SENT",
        guardianReplied: false,
        replyNotes: null,
        replyCategory: null,
        repliedAt: null,
        contentHash: validHash,
      };

      const tamperedLog = {
        ...validLog,
        id: "log-tampered-1",
        reasonTitle: "Motivo alterado fora da aplicação",
        contentHash: "deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      };

      const dossieHtml = renderToString(
        React.createElement(DossieClient, {
          student: {
            id: "stu-b-1",
            name: "Estudante Escola B",
            cgm: "1018613740",
            phone: "42999998888",
            schoolId: "school-target-b",
            classGroup: { name: "7º Ano B", segment: "FUNDAMENTAL", shift: "TARDE" },
            messageLogs: [validLog, tamperedLog],
          },
          contacts: [],
          justifications: [],
          attendances: [],
          snapshots: [],
          minutes: [],
          school: {
            id: "school-target-b",
            name: "Escola Real do Estudante B",
            city: "Tibagi",
            nre: "SEMEC Tibagi",
            network: "MUNICIPAL",
            inepCode: "41000002",
            edition: "INSTITUCIONAL_ESSENCIAL",
          },
          emittedBy: { name: "SuperAdmin", email: "super@redeativa.app.br" },
          emittedAtIso: "2026-11-18T14:00:00.000Z",
        })
      );

      const normalizedDossieHtml = dossieHtml.replace(/<!-- -->/g, "");
      expect(normalizedDossieHtml).toContain(
        `Cód. ${validHash.slice(0, 10).toUpperCase()} • Verificado`
      );
      expect(normalizedDossieHtml).toContain("Cód. DEADBEEF12 • Divergência");
      expect(normalizedDossieHtml).not.toMatch(/SHA-256|f[ée]\s+p[úu]blica|imut[áa]ve(?:l|is)/i);

      const prontuarioHtml = renderToString(
        React.createElement(ProntuarioClient, {
          initialStudent: {
            id: "stu-b-1",
            name: "Estudante Escola B",
            schoolId: "school-target-b",
            classGroup: { name: "7º Ano B", segment: "FUNDAMENTAL", shift: "TARDE" },
            messageLogs: [validLog, tamperedLog],
          },
          initialContacts: [],
          initialJustifications: [],
          initialAttendances: [],
          initialSnapshots: [],
          initialMinutes: [],
          initialTab: "timeline",
          currentSchool: {
            id: "school-target-b",
            name: "Escola Real do Estudante B",
            edition: "INSTITUCIONAL_ESSENCIAL",
          },
        })
      );

      const normalizedProntuarioHtml = prontuarioHtml.replace(/<!-- -->/g, "");
      expect(normalizedProntuarioHtml).toContain(`Cód. ${validHash.slice(0, 8)} • Verificado`);
      expect(normalizedProntuarioHtml).toContain("Cód. deadbeef • Divergência");
      expect(normalizedProntuarioHtml).not.toMatch(/SHA-256|f[ée]\s+p[úu]blica|imut[áa]ve(?:l|is)/i);
    });
  });
});
