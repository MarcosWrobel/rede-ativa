import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SCHOOL, getCurrentSchool } from "../currentSchool";
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

  describe("getCurrentSchool() resolution", () => {
    it("returns default Leopoldina school when no school is in database or schoolId is null", async () => {
      (prisma.school.findFirst as any).mockResolvedValue(null);

      const school = await getCurrentSchool(null);
      expect(school.name).toBe("Colégio Estadual Leopoldina B. Pedroso");
      expect(school.inepCode).toBe("41042730");
      expect(school.network).toBe("ESTADUAL");
    });

    it("returns specific school when schoolId is provided and exists", async () => {
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
        logoUrl: "/brasao-tibagi.png",
      };

      (prisma.school.findUnique as any).mockResolvedValue(mockSchool);

      const school = await getCurrentSchool("school-tibagi-01");
      expect(school.id).toBe("school-tibagi-01");
      expect(school.name).toBe("Escola Municipal Professor David Federmann");
      expect(school.network).toBe("MUNICIPAL");
      expect(school.city).toBe("Tibagi");
    });

    it("falls back to default Leopoldina school if provided schoolId is not found", async () => {
      (prisma.school.findUnique as any).mockResolvedValue(null);

      const school = await getCurrentSchool("non-existent-id");
      expect(school.id).toBe(DEFAULT_SCHOOL.id);
      expect(school.name).toBe(DEFAULT_SCHOOL.name);
      expect(school.network).toBe("ESTADUAL");
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

    it("grants access to system admin (marcos.wrobel@escola.pr.gov.br) across all schools", async () => {
      (auth as any).mockResolvedValue({
        user: {
          id: "usr-admin",
          name: "Marcos Wrobel",
          email: "marcos.wrobel@escola.pr.gov.br",
          role: "ADMIN",
        },
      });

      const result = await requireSchoolAdmin("any-school-id");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.role).toBe("ADMIN");
        expect(result.email).toBe("marcos.wrobel@escola.pr.gov.br");
      }
    });

    it("denies access if user is not ADMIN in the targeted school", async () => {
      (auth as any).mockResolvedValue({
        user: {
          id: "usr-pedagoga",
          name: "Pedagoga Teste",
          email: "pedagoga@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "school-1",
          schools: [{ schoolId: "school-1", role: "PEDAGOGA" }],
        },
      });

      const result = await requireSchoolAdmin("school-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
      }
    });

    it("grants access if user has ADMIN role in UserSchool for the targeted school", async () => {
      (auth as any).mockResolvedValue({
        user: {
          id: "usr-diretor-tibagi",
          name: "Diretor Municipal Tibagi",
          email: "diretor@tibagi.pr.gov.br",
          role: "PEDAGOGA", // global default role might be pedagoga in another school
          schoolId: "school-tibagi",
          schools: [
            { schoolId: "school-tibagi", role: "ADMIN", name: "E.M. David Federmann" },
            { schoolId: "school-leopoldina", role: "PEDAGOGA", name: "C.E. Leopoldina" },
          ],
        },
      });

      const result = await requireSchoolAdmin("school-tibagi");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.schoolId).toBe("school-tibagi");
      }
    });
  });
});
