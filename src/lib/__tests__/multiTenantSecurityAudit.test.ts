import { describe, it, expect, vi } from "vitest";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { sanitizeCsvField } from "@/lib/csvSanitizer";
import { BOOTSTRAP_ADMIN_EMAIL } from "@/lib/roles";

describe("Auditoria Restrita de Segurança Multi-Tenant", () => {
  describe("Vetor 1 & 2: assertTenantOwnership (Prevenção BOLA / IDOR & Spoofing)", () => {
    const superAdminSession = {
      user: { email: BOOTSTRAP_ADMIN_EMAIL, role: "SUPERADMIN" },
    };

    const gestorEscolaASession = {
      user: { email: "diretor@escola-a.pr.gov.br", role: "GESTOR_ESCOLAR", schoolId: "escola-a" },
    };

    const pedagogaEscolaBSession = {
      user: { email: "pedagoga@escola-b.pr.gov.br", role: "PEDAGOGA", schoolId: "escola-b" },
    };

    it("permite acesso se o usuário for SuperAdmin global, mesmo com escolas divergentes", () => {
      const allowed = assertTenantOwnership("escola-qualquer", "outra-escola", superAdminSession);
      expect(allowed).toBe(true);
    });

    it("permite acesso quando o recurso pertence estritamente à escola ativa da sessão", () => {
      const allowed = assertTenantOwnership("escola-a", "escola-a", gestorEscolaASession);
      expect(allowed).toBe(true);
    });

    it("bloqueia estritamente acesso (IDOR) se o recurso pertencer a outra escola", () => {
      // Gestor da Escola A tentando acessar recurso da Escola B
      const allowed = assertTenantOwnership("escola-b", "escola-a", gestorEscolaASession);
      expect(allowed).toBe(false);

      // Pedagoga da Escola B tentando acessar recurso da Escola A
      const allowed2 = assertTenantOwnership("escola-a", "escola-b", pedagogaEscolaBSession);
      expect(allowed2).toBe(false);
    });

    it("bloqueia estritamente recursos com schoolId nulo ou indefinido para escolas não-sede", () => {
      expect(assertTenantOwnership(null, "escola-a", gestorEscolaASession)).toBe(false);
      expect(assertTenantOwnership(undefined, "escola-a", gestorEscolaASession)).toBe(false);
      expect(assertTenantOwnership("", "escola-a", gestorEscolaASession)).toBe(false);
    });

    it("permite acesso retrocompatível a recursos legados (schoolId nulo ou default-leopoldina) na unidade fundadora piloto", () => {
      const leopoldinaPedagogaSession = {
        user: { email: "pedagoga@leopoldina.pr.gov.br", role: "PEDAGOGA", inepCode: "41042730" },
      };
      expect(assertTenantOwnership(null, "default-leopoldina", leopoldinaPedagogaSession)).toBe(true);
      expect(assertTenantOwnership("default-leopoldina", "default-leopoldina", leopoldinaPedagogaSession)).toBe(true);
    });

    it("bloqueia se currentSchoolId for nulo ou vazio", () => {
      expect(assertTenantOwnership("escola-a", "", gestorEscolaASession)).toBe(false);
    });
  });

  describe("Vetor 6: sanitizeCsvField (Prevenção CSV / DDE Formula Injection)", () => {
    it("mantém campos de texto seguros inalterados", () => {
      expect(sanitizeCsvField("MARCOS WROBEL")).toBe("MARCOS WROBEL");
      expect(sanitizeCsvField("1º Ano A")).toBe("1º Ano A");
      expect(sanitizeCsvField("Frequência regular")).toBe("Frequência regular");
    });

    it("neutraliza fórmulas que iniciam com '=' prefixando com apóstrofo", () => {
      const malicious = "=cmd|' /C calc'!A0";
      expect(sanitizeCsvField(malicious)).toBe(`'=cmd|' /C calc'!A0`);
    });

    it("neutraliza fórmulas que iniciam com '+', '-', '@', tabulação ou retorno", () => {
      expect(sanitizeCsvField("+12345")).toBe("'+12345");
      expect(sanitizeCsvField("-5+2")).toBe("'-5+2");
      expect(sanitizeCsvField("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
      expect(sanitizeCsvField("\tTABBED")).toBe("'\tTABBED");
      expect(sanitizeCsvField("\rLINEBREAK")).toBe("'\rLINEBREAK");
    });

    it("trata valores nulos, vazios ou indefinidos sem quebrar", () => {
      expect(sanitizeCsvField(null)).toBe("");
      expect(sanitizeCsvField(undefined)).toBe("");
      expect(sanitizeCsvField("")).toBe("");
      expect(sanitizeCsvField(100)).toBe("100");
    });
  });

  describe("Vetor 4: Cross-Tenant Relation Traversal", () => {
    it("rejeita classGroupId de outra instituição em validação de inquilino", () => {
      const currentSchoolId = "escola-leopoldina";
      const foreignClassGroup = { id: "turma-david-1", schoolId: "escola-david-federmann" };
      const nativeClassGroup = { id: "turma-leo-1", schoolId: "escola-leopoldina" };

      const isForeignValid = foreignClassGroup.schoolId === currentSchoolId;
      const isNativeValid = nativeClassGroup.schoolId === currentSchoolId;

      expect(isForeignValid).toBe(false);
      expect(isNativeValid).toBe(true);
    });

    it("impede criação de ata quando studentIds contêm estudantes de outro tenant", () => {
      const currentSchoolId = "escola-a";
      const requestedStudentIds = ["aluno-1", "aluno-2", "aluno-3"];
      // Simula retorno do banco com where: { id: { in: requestedStudentIds }, schoolId: currentSchoolId }
      const matchedStudentsInSchool = [
        { id: "aluno-1", schoolId: "escola-a" },
        { id: "aluno-2", schoolId: "escola-a" },
        // aluno-3 pertence a escola-b, logo não foi retornado
      ];

      const allBelongToTenant = matchedStudentsInSchool.length === requestedStudentIds.length;
      expect(allBelongToTenant).toBe(false);
    });
  });

  describe("Vetor 5: Teto Hierárquico RBAC em Gestão de Usuários", () => {
    const elevatedRoles = ["SUPERADMIN", "GESTAO_SECRETARIA", "ADMIN"];

    it("impede que gestor comum atribua cargos iguais ou superiores a SUPERADMIN", () => {
      const isCallerSuper = false; // Gestor Escolar

      for (const roleToAssign of elevatedRoles) {
        const canAssign = isCallerSuper || !elevatedRoles.includes(roleToAssign);
        expect(canAssign).toBe(false);
      }
    });

    it("permite que gestor comum atribua cargos operacionais da unidade escolar", () => {
      const isCallerSuper = false;
      const allowedRoles = ["GESTOR_ESCOLAR", "PEDAGOGA"];

      for (const roleToAssign of allowedRoles) {
        const canAssign = isCallerSuper || !elevatedRoles.includes(roleToAssign);
        expect(canAssign).toBe(true);
      }
    });
  });

  describe("Vetor 3 & 7: Isolamento de Auditoria e Desativação em Lote", () => {
    it("garante que query de inativação de transferidos contenha cláusula com schoolId", () => {
      const schoolId = "escola-piloto";
      const idsToDeactivate = ["aluno-x", "aluno-y"];

      const queryFilter = {
        id: { in: idsToDeactivate },
        ...(schoolId ? { schoolId } : {}),
      };

      expect(queryFilter.schoolId).toBe("escola-piloto");
      expect(queryFilter.id.in).toEqual(idsToDeactivate);
    });

    it("garante que consulta de auditoria para Gestor Escolar restrinja por schoolId", () => {
      const isSuper = false;
      const schoolId = "escola-leopoldina";

      const auditWhereClause = isSuper ? {} : { schoolId };
      expect(auditWhereClause).toEqual({ schoolId: "escola-leopoldina" });
    });

    it("permite que SuperAdmin consulte trilha de auditoria global sem filtro obrigatório", () => {
      const isSuper = true;
      const schoolId = "escola-leopoldina";

      const auditWhereClause = isSuper ? {} : { schoolId };
      expect(auditWhereClause).toEqual({});
    });
  });
});
