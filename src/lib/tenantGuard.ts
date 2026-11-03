import { checkIsSuperAdmin } from "./roles";

/**
 * Validador atômico de isolamento multi-tenant (Prevenção BOLA / IDOR).
 *
 * Retorna true se:
 * 1. O usuário for SuperAdmin global autenticado da plataforma SaaS (Nível 1); ou
 * 2. O recurso pertencer comprovadamente à instituição ativa da sessão (resourceSchoolId === currentSchoolId).
 *
 * Bloqueia estritamente registros nulos ou divergentes para qualquer outro papel (Gestores, Pedagogas, etc.).
 */
export function assertTenantOwnership(
  resourceSchoolId: string | null | undefined,
  currentSchoolId: string,
  session: any
): boolean {
  if (checkIsSuperAdmin(session)) {
    return true;
  }

  if (!resourceSchoolId || !currentSchoolId) {
    return false;
  }

  return resourceSchoolId === currentSchoolId;
}
