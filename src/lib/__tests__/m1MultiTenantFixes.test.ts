import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { getCurrentSchool } from "@/lib/currentSchool";
import AtaPrintPage from "@/app/atas/[id]/imprimir/page";
import LivroAnualPage from "@/app/atas/livro/[ano]/page";
import { POST as postStudentsImport } from "@/app/api/students/import/route";
import { POST as postStudent, PUT as putStudent } from "@/app/api/students/route";

const mockState = {
  session: null as any,
  cookies: {} as Record<string, string>,
  db: {
    schools: [] as any[],
    classGroups: [] as any[],
    students: [] as any[],
    minutes: [] as any[],
  },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => mockState.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (key: string) =>
      mockState.cookies[key] !== undefined
        ? { name: key, value: mockState.cookies[key] }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

const mockNotFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        return mockState.db.schools.find((s) => s.id === where.id) || null;
      }),
      findFirst: vi.fn(async () => mockState.db.schools[0] || null),
      update: vi.fn(async ({ where, data }: any) => {
        const found = mockState.db.schools.find((s) => s.id === where.id);
        if (found) Object.assign(found, data);
        return found;
      }),
    },
    classGroup: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          mockState.db.classGroups.find((cg) => {
            if (where.id && cg.id !== where.id) return false;
            if (where.schoolId !== undefined && cg.schoolId !== where.schoolId) return false;
            if (where.OR) {
              const matchesOr = where.OR.some((orCond: any) => {
                if (orCond.schoolId === null) return cg.schoolId === null;
                return cg.schoolId === orCond.schoolId;
              });
              if (!matchesOr) return false;
            }
            return true;
          }) || null
        );
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return mockState.db.classGroups.filter((cg) => {
          if (!where) return true;
          if (where.schoolId !== undefined && cg.schoolId !== where.schoolId) return false;
          if (where.OR) {
            return where.OR.some((orCond: any) => {
              if (orCond.schoolId === null) return cg.schoolId === null;
              return cg.schoolId === orCond.schoolId;
            });
          }
          return true;
        });
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `cg-${Date.now()}`, ...data };
        mockState.db.classGroups.push(item);
        return item;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = mockState.db.classGroups.find((cg) => cg.id === where.id);
        if (found) Object.assign(found, data);
        return found;
      }),
    },
    student: {
      findMany: vi.fn(async ({ where }: any) => {
        return mockState.db.students.filter((st) => {
          if (where?.active !== undefined && st.active !== where.active) return false;
          if (where?.schoolId !== undefined && st.schoolId !== where.schoolId) return false;
          if (where?.OR) {
            return where.OR.some((orCond: any) => {
              if (orCond.schoolId === null) return st.schoolId === null;
              return st.schoolId === orCond.schoolId;
            });
          }
          return true;
        });
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `st-${Date.now()}`, ...data, classGroup: { name: "Turma Teste" } };
        mockState.db.students.push(item);
        return item;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const arr = Array.isArray(data) ? data : [data];
        for (const item of arr) {
          mockState.db.students.push({ id: `st-${Date.now()}-${Math.random()}`, ...item });
        }
        return { count: arr.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = mockState.db.students.find((st) => st.id === where.id);
        if (found) Object.assign(found, data);
        return found;
      }),
    },
    pedagogicalMinute: {
      findUnique: vi.fn(async ({ where }: any) => {
        return mockState.db.minutes.find((m) => m.id === where.id) || null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return mockState.db.minutes.filter((m) => {
          if (where?.schoolId !== undefined && m.schoolId !== where.schoolId) return false;
          if (where?.OR) {
            return where.OR.some((orCond: any) => m.schoolId === orCond.schoolId);
          }
          return true;
        });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = mockState.db.minutes.find((m) => m.id === where.id);
        if (found) Object.assign(found, data);
        return found;
      }),
    },
    absenceJustification: { findMany: vi.fn(async () => []) },
    studentContact: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

describe("Milestone M1: Multi-Tenant Core & Inviolability Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.session = null;
    mockState.cookies = {};
    mockState.db = {
      schools: [
        {
          id: "escola-a",
          inepCode: "41000001",
          name: "Colégio Estadual Alpha",
          city: "Ponta Grossa",
          state: "PR",
          nre: "Ponta Grossa",
          network: "ESTADUAL",
          active: true,
        },
        {
          id: "escola-b",
          inepCode: "41000002",
          name: "Escola Municipal Beta",
          city: "Tibagi",
          state: "PR",
          nre: "SEMEC Tibagi",
          network: "MUNICIPAL",
          active: true,
        },
        {
          id: "default-leopoldina",
          inepCode: "41042730",
          name: "Colégio Estadual Leopoldina B. Pedroso",
          city: "Ponta Grossa",
          state: "PR",
          nre: "Ponta Grossa",
          network: "ESTADUAL",
          active: true,
        },
      ],
      classGroups: [
        { id: "turma-a", name: "6º Ano A", schoolId: "escola-a", segment: "FUNDAMENTAL", shift: "MANHA" },
        { id: "turma-b", name: "7º Ano B", schoolId: "escola-b", segment: "FUNDAMENTAL", shift: "TARDE" },
        { id: "turma-legada-null", name: "1º Ano Legado", schoolId: null, segment: "MEDIO", shift: "MANHA" },
      ],
      students: [
        { id: "aluno-a", name: "ALUNO A", cgm: "11111", schoolId: "escola-a", active: true },
        { id: "aluno-b", name: "ALUNO B", cgm: "22222", schoolId: "escola-b", active: true },
        { id: "aluno-leopoldina", name: "ALUNO LEOPOLDINA", cgm: "33333", schoolId: "default-leopoldina", active: true },
      ],
      minutes: [
        {
          id: "ata-escola-a",
          schoolId: "escola-a",
          status: "FINALIZED",
          verificationCode: "CERT-AAAA",
        },
        {
          id: "ata-escola-b",
          schoolId: "escola-b",
          status: "FINALIZED",
          verificationCode: null, // Test auto-healing
        },
      ],
    };
  });

  // =========================================================================
  // Ponto 1: Cookie Spoofing em getCurrentSchool
  // =========================================================================
  describe("Ponto 1: Cookie Spoofing em getCurrentSchool", () => {
    it("descarta cookie active_school_id='escola-b' quando usuário pertence à escola-a", async () => {
      mockState.session = {
        user: {
          id: "usr-gestor-a",
          email: "gestor@escola-a.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "escola-a",
          schools: [{ schoolId: "escola-a", role: "GESTOR_ESCOLAR" }],
        },
      };
      mockState.cookies = { active_school_id: "escola-b" };

      const school = await getCurrentSchool("escola-a");
      // Cookie forjado foi descartado; resolveu escola-a
      expect(school.id).toBe("escola-a");
      expect(school.name).toBe("Colégio Estadual Alpha");
    });

    it("aceita cookie active_school_id quando usuário é SUPERADMIN", async () => {
      mockState.session = {
        user: {
          id: "usr-superadmin",
          email: "marcos.wrobel@escola.pr.gov.br",
          role: "SUPERADMIN",
          schoolId: "default-leopoldina",
        },
      };
      mockState.cookies = { active_school_id: "escola-b" };

      const school = await getCurrentSchool(null);
      expect(school.id).toBe("escola-b");
      expect(school.name).toBe("Escola Municipal Beta");
    });

    it("aceita cookie active_school_id quando GESTAO_SECRETARIA alterna dentro de sua rede municipal autorizada e rejeita outra cidade", async () => {
      mockState.session = {
        user: {
          id: "usr-secretaria",
          email: "gestor.semec@tibagi.pr.gov.br",
          role: "GESTAO_SECRETARIA",
          schoolId: "default-leopoldina",
          networks: [{ networkId: "semec-tibagi", city: "Tibagi" }],
        },
      };

      // 1. Aceita escola municipal de Tibagi (escola-b)
      mockState.cookies = { active_school_id: "escola-b" };
      const allowedSchool = await getCurrentSchool(null);
      expect(allowedSchool.id).toBe("escola-b");

      // 2. Rejeita tentativa de escalar para escola estadual de Ponta Grossa (escola-a)
      mockState.cookies = { active_school_id: "escola-a" };
      const blockedSchool = await getCurrentSchool("escola-b");
      expect(blockedSchool.id).toBe("escola-b");
    });

    it("aceita cookie quando usuário possui vínculo explícito na lista user.schools", async () => {
      mockState.session = {
        user: {
          id: "usr-itinerante",
          email: "itinerante@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "escola-a",
          schools: [
            { schoolId: "escola-a", role: "PEDAGOGA" },
            { schoolId: "escola-b", role: "PEDAGOGA" },
          ],
        },
      };
      mockState.cookies = { active_school_id: "escola-b" };

      const school = await getCurrentSchool(null);
      expect(school.id).toBe("escola-b");
    });
  });

  // =========================================================================
  // Ponto 2: Isolamento de Impressão SSR de Atas e Livro Anual
  // =========================================================================
  describe("Ponto 2: Isolamento de Impressão SSR de Atas", () => {
    it("redireciona para /login se requisição em /atas/[id]/imprimir for anônima", async () => {
      mockState.session = null;
      await expect(AtaPrintPage({ params: Promise.resolve({ id: "ata-escola-a" }) })).rejects.toThrow(
        "NEXT_REDIRECT:/login"
      );
    });

    it("chama notFound se usuário da escola-a tentar imprimir ata da escola-b", async () => {
      mockState.session = {
        user: {
          id: "usr-gestor-a",
          email: "gestor@escola-a.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "escola-a",
        },
      };

      await expect(AtaPrintPage({ params: Promise.resolve({ id: "ata-escola-b" }) })).rejects.toThrow(
        "NEXT_NOT_FOUND"
      );

      // Garante que o auto-healing de verificationCode NÃO foi executado na ata da escola-b
      const ataB = mockState.db.minutes.find((m) => m.id === "ata-escola-b");
      expect(ataB.verificationCode).toBeNull();
    });

    it("executa auto-healing de verificationCode apenas após validação de tenant autorizada", async () => {
      mockState.session = {
        user: {
          id: "usr-gestor-b",
          email: "gestor@escola-b.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "escola-b",
        },
      };

      const result = await AtaPrintPage({ params: Promise.resolve({ id: "ata-escola-b" }) });
      expect(result).toBeDefined();

      const ataB = mockState.db.minutes.find((m) => m.id === "ata-escola-b");
      expect(ataB.verificationCode).toBeTruthy();
    });

    it("redireciona para /login em /atas/livro/[ano] se não autenticado", async () => {
      mockState.session = null;
      await expect(LivroAnualPage({ params: Promise.resolve({ ano: "2026" }) })).rejects.toThrow(
        "NEXT_REDIRECT:/login"
      );
    });
  });

  // =========================================================================
  // Ponto 3: Proteção da Escola Piloto e assertTenantOwnership
  // =========================================================================
  describe("Ponto 3: Proteção da Escola Piloto e assertTenantOwnership", () => {
    it("não concede contexto da sede se session.user.schoolId estiver ausente sem INEP 41042730", () => {
      const anonymousSession = {
        user: {
          email: "sem-escola@externo.com",
          role: "PEDAGOGA",
          // sem schoolId e sem inepCode
        },
      };

      // Usuário em contexto de escola-a tentando acessar recurso legado
      const allowed = assertTenantOwnership(null, "escola-a", anonymousSession);
      expect(allowed).toBe(false);

      const allowed2 = assertTenantOwnership("default-leopoldina", "escola-a", anonymousSession);
      expect(allowed2).toBe(false);
    });

    it("P1: exige correspondência estrita resourceSchoolId === currentSchoolId e bloqueia recursos órfãos (schoolId: null) mesmo para sessão da escola piloto", () => {
      const pilotSession = {
        user: {
          email: "pedagoga@leopoldina.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "default-leopoldina",
          inepCode: "41042730",
        },
      };

      expect(assertTenantOwnership(null, "default-leopoldina", pilotSession)).toBe(false);
      expect(assertTenantOwnership(undefined, "default-leopoldina", pilotSession)).toBe(false);
      expect(assertTenantOwnership("default-leopoldina", "escola-outro-id", pilotSession)).toBe(false);
      expect(assertTenantOwnership("default-leopoldina", "default-leopoldina", pilotSession)).toBe(true);
    });

    it("POST /api/students: bloqueia associação de turma legada (schoolId: null) para escola-a", async () => {
      mockState.session = {
        user: {
          id: "usr-gestor-a",
          email: "gestor@escola-a.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "escola-a",
        },
      };

      const res = await postStudent(
        new Request("http://localhost:3000/api/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Novo Aluno Alpha",
            phone: "41999991234",
            classGroupId: "turma-legada-null",
          }),
        })
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("A turma selecionada não foi encontrada nesta instituição escolar.");

      // Turma legada não pode ter sido modificada
      const nullClass = mockState.db.classGroups.find((cg) => cg.id === "turma-legada-null");
      expect(nullClass.schoolId).toBeNull();
    });
  });

  // =========================================================================
  // Ponto 5: Contrato RBAC em Importação de Estudantes
  // =========================================================================
  describe("Ponto 5: Contrato RBAC em Importação de Estudantes", () => {
    it("rejeita com 403 Forbidden quando usuário GESTOR_ESCOLAR tenta updateSchoolInfo", async () => {
      mockState.session = {
        user: {
          id: "usr-gestor-a",
          email: "gestor@escola-a.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "escola-a",
        },
      };

      const res = await postStudentsImport(
        new Request("http://localhost:3000/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turmas: [{ tempId: "t1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }],
            students: [{ turmaTempId: "t1", name: "ALUNO TESTE", phone: "41999991111" }],
            options: {
              updateSchoolInfo: true,
              schoolInfo: { name: "Nome Alterado" },
            },
          }),
        })
      );

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Apenas administradores globais podem atualizar dados cadastrais da instituição escolar.");
    });

    it("permite importação sem updateSchoolInfo para GESTOR_ESCOLAR e não vaza default-leopoldina", async () => {
      mockState.session = {
        user: {
          id: "usr-gestor-a",
          email: "gestor@escola-a.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          schoolId: "escola-a",
        },
      };

      const res = await postStudentsImport(
        new Request("http://localhost:3000/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turmas: [{ tempId: "t1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }],
            students: [{ turmaTempId: "t1", name: "ALUNO TESTE", phone: "41999991111" }],
            options: {
              updateSchoolInfo: false,
            },
          }),
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      // Não deve conter alunos da escola Leopoldina no retorno
      expect(data.students.some((s: any) => s.schoolId === "default-leopoldina")).toBe(false);
    });
  });
});
