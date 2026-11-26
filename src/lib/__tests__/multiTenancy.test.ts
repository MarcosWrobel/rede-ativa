import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentSchool, getSchoolContextByVerifiedId, UnauthorizedSchoolError } from "../currentSchool";
import { requireSchoolAdmin } from "../permissions";
import { prisma } from "../prisma";

// Mock prisma and auth
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    userSchool: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/lib/auth";

describe("Multi-Tenancy & School Expansion Architecture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCurrentSchool() / getSchoolContextByVerifiedId() resolution (fail-closed)", () => {
    it("throws UnauthorizedSchoolError when no schoolId is provided (no implicit fallback to Leopoldina)", async () => {
      (prisma.school.findFirst as any).mockResolvedValue(null);

      await expect(getCurrentSchool(null)).rejects.toThrow(UnauthorizedSchoolError);
    });

    it("returns specific school when verified schoolId is provided and active", async () => {
      const mockSchool = {
        id: "school-tibagi-01",
        inepCode: "41999999",
        name: "Escola Municipal Professor David Federmann",
        city: "Tibagi",
        state: "PR",
        nre: "SEMEC Tibagi",
        network: "MUNICIPAL",
        phone: "(42) 3275-1000",
        email: "federmann@tibagi.pr.gov.br",
        active: true,
        updatedAt: new Date("2026-11-10T10:00:00Z"),
      };

      (prisma.school.findUnique as any).mockResolvedValue(mockSchool);

      const school = await getSchoolContextByVerifiedId("school-tibagi-01");
      expect(school?.id).toBe("school-tibagi-01");
      expect(school?.name).toBe("Escola Municipal Professor David Federmann");
      expect(school?.network).toBe("MUNICIPAL");
      expect(school?.city).toBe("Tibagi");
    });

    it("throws UnauthorizedSchoolError if provided schoolId is not found", async () => {
      (prisma.school.findUnique as any).mockResolvedValue(null);

      await expect(getCurrentSchool("non-existent-id")).rejects.toThrow(UnauthorizedSchoolError);
    });
  });

  describe("requireSchoolAdmin() permissions", () => {
    it("denies access if user is not authenticated", async () => {
      (auth as any).mockResolvedValue(null);

      const result = await requireSchoolAdmin("school-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("grants access to bootstrap SUPERADMIN across active schools", async () => {
      (auth as any).mockResolvedValue({
        user: {
          id: "usr-admin",
          name: "Marcos Wrobel",
          email: "marcos.wrobel@escola.pr.gov.br",
          role: "SUPERADMIN",
        },
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "usr-admin",
        name: "Marcos Wrobel",
        email: "marcos.wrobel@escola.pr.gov.br",
        role: "SUPERADMIN",
        active: true,
        schoolId: null,
        schools: [],
        networks: [],
      });

      const result = await requireSchoolAdmin("any-school-id");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.role).toBe("SUPERADMIN");
        expect(result.email).toBe("marcos.wrobel@escola.pr.gov.br");
      }
    });

    it("denies access if user is PEDAGOGA in the targeted school", async () => {
      (auth as any).mockResolvedValue({
        user: {
          id: "usr-pedagoga",
          name: "Pedagoga Teste",
          email: "pedagoga@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "school-1",
          schools: [{ schoolId: "school-1", role: "PEDAGOGA", active: true }],
        },
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "usr-pedagoga",
        name: "Pedagoga Teste",
        email: "pedagoga@escola.pr.gov.br",
        role: "PEDAGOGA",
        active: true,
        schoolId: "school-1",
        schools: [{ schoolId: "school-1", role: "PEDAGOGA", active: true, school: { id: "school-1", active: true } }],
        networks: [],
      });
      (prisma.school.findUnique as any).mockResolvedValue({
        id: "school-1",
        active: true,
        network: "ESTADUAL",
        city: "Tibagi",
      });

      const result = await requireSchoolAdmin("school-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
      }
    });

    it("grants access if user has active manager role in UserSchool for the targeted school", async () => {
      (auth as any).mockResolvedValue({
        user: {
          id: "usr-diretor-tibagi",
          name: "Diretor Municipal Tibagi",
          email: "diretor@tibagi.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "school-tibagi",
          schools: [
            { schoolId: "school-tibagi", role: "GESTOR_ESCOLAR", active: true, name: "E.M. David Federmann" },
            { schoolId: "school-leopoldina", role: "PEDAGOGA", active: true, name: "C.E. Leopoldina" },
          ],
        },
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "usr-diretor-tibagi",
        name: "Diretor Municipal Tibagi",
        email: "diretor@tibagi.pr.gov.br",
        role: "PEDAGOGA",
        active: true,
        schoolId: "school-tibagi",
        schools: [
          { schoolId: "school-tibagi", role: "GESTOR_ESCOLAR", active: true, school: { id: "school-tibagi", active: true } },
          { schoolId: "school-leopoldina", role: "PEDAGOGA", active: true, school: { id: "school-leopoldina", active: true } },
        ],
        networks: [],
      });
      (prisma.school.findUnique as any).mockResolvedValue({
        id: "school-tibagi",
        active: true,
        network: "MUNICIPAL",
        city: "Tibagi",
      });

      const result = await requireSchoolAdmin("school-tibagi");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.schoolId).toBe("school-tibagi");
      }
    });
  });
});
