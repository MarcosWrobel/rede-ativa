import { describe, it, expect } from "vitest";
import {
  checkIsAdmin,
  checkIsSuperAdmin,
  checkIsSecretariat,
  checkIsSchoolManager,
  isBootstrapAdminEmail,
  BOOTSTRAP_ADMIN_EMAIL,
  ROLE_OPTIONS,
  getRoleOption,
} from "@/lib/roles";
import { SELF_AUTH_API_PREFIXES } from "@/lib/proxyConstants";

describe("Segurança Perimetral e RBAC (Auditoria SEC-01 a SEC-04)", () => {
  it("reconhece o e-mail bootstrap admin institucional oficial", () => {
    expect(isBootstrapAdminEmail(BOOTSTRAP_ADMIN_EMAIL)).toBe(true);
    expect(isBootstrapAdminEmail("outro.usuario@escola.pr.gov.br")).toBe(false);
    expect(isBootstrapAdminEmail("")).toBe(false);
    expect(isBootstrapAdminEmail(null)).toBe(false);
  });

  it("rejeita permissão de administrador para contas pedagoga ou desativadas", () => {
    const activePedagogaSession = {
      user: {
        email: "pedagoga@escola.pr.gov.br",
        role: "PEDAGOGA",
        active: true,
      },
    };
    expect(checkIsAdmin(activePedagogaSession)).toBe(false);

    const inactiveAdminSession = {
      user: {
        email: "antigo.admin@escola.pr.gov.br",
        role: "ADMIN",
        active: false,
      },
    };
    expect(checkIsAdmin(inactiveAdminSession)).toBe(false);

    const activeAdminSession = {
      user: {
        email: "admin.escola@escola.pr.gov.br",
        role: "ADMIN",
        active: true,
      },
    };
    expect(checkIsAdmin(activeAdminSession)).toBe(true);
  });

  it("garante que o bootstrap admin sempre retorne true mesmo se role não estiver explicitado", () => {
    const bootstrapSession = {
      user: {
        email: BOOTSTRAP_ADMIN_EMAIL,
        active: true,
      },
    };
    expect(checkIsAdmin(bootstrapSession)).toBe(true);
  });
});

describe("Isolamento de Endpoints Públicos e Webhooks (Middleware)", () => {
  it("libera rotas de cron, webhooks e sincronização com credenciais próprias", () => {
    const testPaths = [
      "/api/cron/weekly-digest",
      "/api/webhooks/whatsapp",
      "/api/frequencia/sync",
      "/api/serp/sync",
      "/api/atas/public/CERT-1234",
      "/api/atas/sign-token/abc-token",
    ];

    for (const path of testPaths) {
      const isAllowed = SELF_AUTH_API_PREFIXES.some((prefix) => path.startsWith(prefix));
      expect(isAllowed).toBe(true);
    }
  });

  it("garante que /api/sync-config NÃO esteja liberada sem autenticação no proxy", () => {
    const isAllowed = SELF_AUTH_API_PREFIXES.some((prefix) => "/api/sync-config".startsWith(prefix));
    expect(isAllowed).toBe(false);
  });

  it("bloqueia e exige autenticação em rotas sensíveis não públicas", () => {
    const protectedPaths = [
      "/api/students",
      "/api/atas",
      "/api/users",
      "/api/messages",
      "/api/reports",
      "/api/low-attendance",
    ];

    for (const path of protectedPaths) {
      const isAllowed = SELF_AUTH_API_PREFIXES.some((prefix) => path.startsWith(prefix));
      expect(isAllowed).toBe(false);
    }
  });

  it("protege integridade de mutações contra IDOR multi-escola", () => {
    // Simula verificação de pertinência de escola
    const checkSchoolAccess = (recordSchoolId: string, userSchoolId: string, role: string) => {
      if (role === "ADMIN") return true;
      return recordSchoolId === userSchoolId;
    };

    expect(checkSchoolAccess("escola-1", "escola-1", "PEDAGOGA")).toBe(true);
    expect(checkSchoolAccess("escola-2", "escola-1", "PEDAGOGA")).toBe(false);
    expect(checkSchoolAccess("escola-2", "escola-1", "ADMIN")).toBe(true);
  });

  describe("Hierarquia de 4 Camadas SaaS (SuperAdmin, SEMEC, Gestor, Pedagoga)", () => {
    const superAdminSession = {
      user: { email: BOOTSTRAP_ADMIN_EMAIL, role: "SUPERADMIN", active: true },
    };
    const semecSession = {
      user: {
        email: "secretario@tibagi.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [{ networkId: "semec-tibagi", city: "Tibagi" }],
      },
    };
    const gestorSession = {
      user: {
        email: "diretor@tibagi.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        active: true,
        schoolId: "escola-david-federmann",
        schools: [{ schoolId: "escola-david-federmann", role: "GESTOR_ESCOLAR" }],
      },
    };
    const pedagogaSession = {
      user: {
        email: "pedagoga@escola.pr.gov.br",
        role: "PEDAGOGA",
        active: true,
        schoolId: "escola-leopoldina",
      },
    };

    it("Nível 1 - SuperAdmin tem acesso global a tudo", () => {
      expect(checkIsSuperAdmin(superAdminSession)).toBe(true);
      expect(checkIsSecretariat(superAdminSession, "semec-tibagi")).toBe(true);
      expect(checkIsSchoolManager(superAdminSession, "qualquer-escola")).toBe(true);
      expect(checkIsAdmin(superAdminSession)).toBe(true);
    });

    it("Nível 2 - Gestão Secretaria (SEMEC) tem acesso à sua rede e escolas vinculadas", () => {
      expect(checkIsSuperAdmin(semecSession)).toBe(false);
      expect(checkIsSecretariat(semecSession, "semec-tibagi")).toBe(true);
      expect(checkIsSecretariat(semecSession, "semec-outro-municipio")).toBe(false);
      expect(checkIsSchoolManager(semecSession, "escola-david-federmann")).toBe(true);
    });

    it("Nível 3 - Gestor Escolar tem acesso de gestão à sua escola mas não à secretaria", () => {
      expect(checkIsSuperAdmin(gestorSession)).toBe(false);
      expect(checkIsSecretariat(gestorSession)).toBe(false);
      expect(checkIsSchoolManager(gestorSession, "escola-david-federmann")).toBe(true);
      expect(checkIsSchoolManager(gestorSession, "outra-escola")).toBe(false);
    });

    it("Nível 4 - Pedagoga não tem permissão de gestão de escola nem de secretaria", () => {
      expect(checkIsSuperAdmin(pedagogaSession)).toBe(false);
      expect(checkIsSecretariat(pedagogaSession)).toBe(false);
      expect(checkIsSchoolManager(pedagogaSession, "escola-leopoldina")).toBe(false);
      expect(checkIsAdmin(pedagogaSession)).toBe(false);
    });

    it("Roteamento Inteligente: determina corretamente o destino de aterrissagem de cada perfil", () => {
      function getLandingRoute(session: any) {
        if (!session?.user) return "/login";
        if (checkIsSuperAdmin(session)) return "/admin";
        if (checkIsSecretariat(session)) return "/secretaria";
        if (checkIsSchoolManager(session)) return "/gestao";
        return "/busca-ativa";
      }

      expect(getLandingRoute(superAdminSession)).toBe("/admin");
      expect(getLandingRoute(semecSession)).toBe("/secretaria");
      expect(getLandingRoute(gestorSession)).toBe("/gestao");
      expect(getLandingRoute(pedagogaSession)).toBe("/busca-ativa");
      expect(getLandingRoute(null)).toBe("/login");
    });

    it("Catálogo e mapeamento de papéis (Admin, Gestor SEMEC, Direção e Pedagógico)", () => {
      expect(ROLE_OPTIONS).toHaveLength(4);
      expect(ROLE_OPTIONS.map((r) => r.value)).toEqual([
        "SUPERADMIN",
        "GESTAO_SECRETARIA",
        "GESTOR_ESCOLAR",
        "PEDAGOGA",
      ]);

      expect(getRoleOption("SUPERADMIN").label).toBe("Admin (Meu acesso)");
      expect(getRoleOption("ADMIN").label).toBe("Admin (Meu acesso)");
      expect(getRoleOption("GESTAO_SECRETARIA").label).toBe("Gestor (Acesso Gestor SEMEC)");
      expect(getRoleOption("GESTOR_ESCOLAR").label).toBe("Direção (Gestor da escola)");
      expect(getRoleOption("PEDAGOGA").label).toBe("Pedagógico (Equipe pedagógica)");
      expect(getRoleOption(null).label).toBe("Pedagógico (Equipe pedagógica)");
    });

    it("Proteção da Escola Sede e Higienização de Banco", () => {
      // Invariante de proteção da escola base (Leopoldina - INEP 41042730)
      const LEOPOLDINA_INEP = "41042730";
      const isProtectedSchool = (inep: string, name: string) =>
        inep === LEOPOLDINA_INEP || name.toLowerCase().includes("leopoldina");

      expect(isProtectedSchool("41042730", "Colégio Estadual Leopoldina B. Pedroso")).toBe(true);
      expect(isProtectedSchool("99999999", "Escola Municipal Teste")).toBe(false);

      // Apenas SuperAdmin tem autorização para disparar exclusão ou sanitização
      expect(checkIsSuperAdmin(superAdminSession)).toBe(true);
      expect(checkIsSuperAdmin(semecSession)).toBe(false);
      expect(checkIsSuperAdmin(gestorSession)).toBe(false);
      expect(checkIsSuperAdmin(pedagogaSession)).toBe(false);
    });
  });
});
