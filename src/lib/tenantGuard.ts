import { checkIsSuperAdmin, type AuthSessionLike } from "./roles";

/**
 * Validador atômico de isolamento multi-tenant (Prevenção BOLA / IDOR).
 *
 * Retorna true se:
 * 1. O usuário for SuperAdmin global autenticado da plataforma SaaS (Nível 1); ou
 * 2. O recurso possuir schoolId definido e pertencer estritamente à instituição ativa da sessão (resourceSchoolId === currentSchoolId).
 *
 * Bloqueia estritamente recursos órfãos (schoolId nulo/vazio) e acessos cruzados entre escolas distintas para qualquer papel não-SuperAdmin.
 */
export function assertTenantOwnership(
  resourceSchoolId: string | null | undefined,
  currentSchoolId: string,
  session: AuthSessionLike | null | undefined
): boolean {
  if (checkIsSuperAdmin(session)) {
    return true;
  }

  if (!currentSchoolId || !resourceSchoolId) {
    return false;
  }

  return resourceSchoolId === currentSchoolId;
}
