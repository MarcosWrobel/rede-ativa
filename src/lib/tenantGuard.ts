import { checkIsSuperAdmin } from "./roles";

/**
 * Validador atômico de isolamento multi-tenant (Prevenção BOLA / IDOR).
 *
 * Retorna true se:
 * 1. O usuário for SuperAdmin global autenticado da plataforma SaaS (Nível 1); ou
 * 2. O recurso pertencer comprovadamente à instituição ativa da sessão (resourceSchoolId === currentSchoolId); ou
 * 3. O recurso for um registro legado (schoolId nulo ou "default-leopoldina") e a sessão estiver operando na unidade fundadora padrão.
 *
 * Bloqueia estritamente acessos cruzados entre escolas distintas para qualquer papel não-SuperAdmin.
 */
export function assertTenantOwnership(
  resourceSchoolId: string | null | undefined,
  currentSchoolId: string,
  session: any
): boolean {
  if (checkIsSuperAdmin(session)) {
    return true;
  }

  if (!currentSchoolId) {
    return false;
  }

  // Correspondência direta por ID
  if (resourceSchoolId === currentSchoolId) {
    return true;
  }

  // Retrocompatibilidade segura com dados legados da escola piloto fundadora:
  // Se o recurso não tem schoolId ou carrega o ID fixo legado "default-leopoldina",
  // e o contexto do usuário for a escola sede fundadora (ou sem schoolId específico na sessão),
  // permite o acesso para não travar a operação histórica da unidade piloto.
  const isDefaultSchoolContext =
    currentSchoolId === "default-leopoldina" ||
    (session?.user as any)?.inepCode === "41042730" ||
    !(session?.user as any)?.schoolId;

  if ((!resourceSchoolId || resourceSchoolId === "default-leopoldina") && isDefaultSchoolContext) {
    return true;
  }

  return false;
}
