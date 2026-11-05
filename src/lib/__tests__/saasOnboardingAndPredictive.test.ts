import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock do prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    educationNetwork: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    messageTemplate: {
      create: vi.fn(),
    },
    userSchool: {
      upsert: vi.fn(),
    },
    messageLog: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

// Mock de autenticação e permissões
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  requireSuperAdmin: vi.fn(),
  requireSecretariat: vi.fn(),
  requireSchoolAdmin: vi.fn(),
  checkIsAdmin: vi.fn(),
  checkIsSuperAdmin: vi.fn(),
  checkIsSecretariat: vi.fn(),
  checkIsSchoolManager: vi.fn(),
  isBootstrapAdminEmail: vi.fn(),
}));

// Mock do audit
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAuth, checkIsSuperAdmin, checkIsSecretariat } from "@/lib/permissions";
import { POST as createSchoolPost } from "@/app/api/schools/route";
import { GET as secretariaMetricsGet } from "@/app/api/secretaria/metrics/route";

describe("SAAS-06 & SAAS-07: Auto-Onboarding e Diagnóstico Preditivo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SAAS-06: Proteção da Escola Piloto Leopoldina & Criação de Escolas", () => {
    it("deve rejeitar categoricamente tentativa de criar escola com o INEP 41042730 da escola piloto", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce({
        ok: true,
        session: { user: { role: "SUPERADMIN" } },
        userId: "super-1",
        userName: "Super Admin",
        email: "admin@escola.pr.gov.br",
        role: "SUPERADMIN",
      } as any);

      const req = new Request("http://localhost/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inepCode: "41042730",
          name: "Tentativa de Substituição Leopoldina",
          network: "MUNICIPAL",
          city: "Tibagi",
        }),
      });

      const res = await createSchoolPost(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toContain("41042730 pertence à Unidade Piloto Fundadora");
      expect(prisma.school.create).not.toHaveBeenCalled();
    });

    it("deve permitir criar nova escola municipal com settingsJson e starter pack", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce({
        ok: true,
        session: { user: { role: "ADMIN" } },
        userId: "admin-1",
        userName: "Gestor Municipal",
        email: "gestor@tibagi.pr.gov.br",
        role: "ADMIN",
      } as any);

      vi.mocked(prisma.school.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.educationNetwork.upsert).mockResolvedValueOnce({
        id: "semec-tibagi",
        name: "SEMEC Tibagi",
      } as any);

      const fakeCreatedSchool = {
        id: "nova-escola-1",
        inepCode: "41049999",
        name: "Escola Municipal Professor David Federmann",
        city: "Tibagi",
        state: "PR",
        network: "MUNICIPAL",
        networkId: "semec-tibagi",
        settingsJson: JSON.stringify({ district: "Sede Urbana" }),
        active: true,
      };

      vi.mocked(prisma.school.create).mockResolvedValueOnce(fakeCreatedSchool as any);
      vi.mocked(prisma.messageTemplate.create).mockResolvedValue({} as any);
      vi.mocked(prisma.userSchool.upsert).mockResolvedValue({} as any);

      const req = new Request("http://localhost/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inepCode: "41049999",
          name: "Escola Municipal Professor David Federmann",
          network: "MUNICIPAL",
          city: "Tibagi",
          state: "PR",
          settings: { district: "Sede Urbana" },
        }),
      });

      const res = await createSchoolPost(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.school.id).toBe("nova-escola-1");
      expect(prisma.school.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inepCode: "41049999",
            settingsJson: JSON.stringify({ district: "Sede Urbana" }),
          }),
        })
      );
    });
  });

  describe("SAAS-07: Métricas Preditivas e Recomendações da SEMEC", () => {
    it("deve calcular indicadores preditivos e emitir recomendações na rota da secretaria", async () => {
      vi.mocked(requireAuth).mockResolvedValueOnce({
        ok: true,
        session: { user: { role: "GESTAO_SECRETARIA" } },
        userId: "sec-1",
        email: "secretario@tibagi.pr.gov.br",
        role: "GESTAO_SECRETARIA",
      } as any);

      vi.mocked(checkIsSuperAdmin).mockReturnValue(false);
      vi.mocked(checkIsSecretariat).mockReturnValue(true);

      // Simula escolas municipais
      vi.mocked(prisma.school.findMany).mockResolvedValueOnce([
        {
          id: "school-1",
          name: "Escola Municipal A",
          inepCode: "41040001",
          city: "Tibagi",
          state: "PR",
          nre: "SEMEC",
          syncTokenHash: "token-1",
          _count: { students: 100, classGroups: 4, userSchools: 3, pedagogicalMinutes: 2 },
          students: [
            { id: "st-1", updatedAt: new Date(), lowAttendanceRecord: { attendancePercent: 65 } },
            { id: "st-2", updatedAt: new Date(), lowAttendanceRecord: { attendancePercent: 90 } },
          ],
        },
      ] as any);

      vi.mocked(prisma.messageLog.count).mockResolvedValueOnce(45);

      // Simula respostas categorizadas (transporte em alta)
      vi.mocked(prisma.messageLog.groupBy).mockResolvedValueOnce([
        { replyCategory: "TRANSPORTE", _count: { replyCategory: 25 } },
        { replyCategory: "SAUDE", _count: { replyCategory: 5 } },
      ] as any);

      const req = new Request("http://localhost/api/secretaria/metrics?city=Tibagi");
      const res = await secretariaMetricsGet(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.predictiveAnalysis).toBeDefined();
      expect(data.predictiveAnalysis.totalCategorizedReplies).toBe(30);

      // Recomendações devem identificar o gargalo de transporte rural
      const recs = data.predictiveAnalysis.recommendations;
      expect(recs.some((r: any) => r.title.includes("Transporte Escolar"))).toBe(true);
    });
  });
});
