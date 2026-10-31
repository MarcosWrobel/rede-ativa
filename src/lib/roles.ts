export const BOOTSTRAP_ADMIN_EMAIL = "marcos.wrobel@escola.pr.gov.br";

export type RoleLevel =
  | "SUPERADMIN"          // Nível 1: Plataforma SaaS global (Marcos Wrobel)
  | "GESTAO_SECRETARIA"   // Nível 2: Secretaria Municipal de Educação (SEMEC / NRE)
  | "GESTOR_ESCOLAR"      // Nível 3: Diretor(a) / Secretaria da Unidade Escolar
  | "PEDAGOGA";           // Nível 4: Equipe pedagógica operacional

/**
 * Verifica se o e-mail é o administrador raiz institucional da plataforma SaaS.
 * Usa correspondência exata (nunca substring parcial).
 */
export function isBootstrapAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  const envAdmin =
    typeof process !== "undefined" && process.env?.ADMIN_EMAIL
      ? process.env.ADMIN_EMAIL.toLowerCase().trim()
      : "";
  return (
    normalized === BOOTSTRAP_ADMIN_EMAIL ||
    (Boolean(envAdmin) && normalized === envAdmin)
  );
}

/**
 * Valida se uma sessão pertence ao SuperAdmin da plataforma (Nível 1).
 */
export function checkIsSuperAdmin(session: any): boolean {
  if (!session?.user?.email) return false;
  if ((session.user as any).active === false) return false;
  const role = (session.user as any).role;
  return isBootstrapAdminEmail(session.user.email) || role === "SUPERADMIN";
}

/**
 * Valida se uma sessão pertence a um perfil ADMIN ativo (Retrocompatibilidade).
 * Retorna true para SuperAdmin ou Gestor Escolar.
 */
export function checkIsAdmin(session: any): boolean {
  if (!session?.user?.email) return false;
  if ((session.user as any).active === false) return false;
  const role = (session.user as any).role;
  return (
    role === "ADMIN" ||
    role === "SUPERADMIN" ||
    role === "GESTAO_SECRETARIA" ||
    role === "GESTOR_ESCOLAR" ||
    isBootstrapAdminEmail(session.user.email)
  );
}

/**
 * Valida se uma sessão pertence à Gestão da Secretaria de Educação (Nível 2).
 */
export function checkIsSecretariat(session: any, networkId?: string | null): boolean {
  if (checkIsSuperAdmin(session)) return true;
  if (!session?.user?.email || (session.user as any).active === false) return false;
  const role = (session.user as any).role;
  if (role !== "GESTAO_SECRETARIA") return false;

  if (networkId) {
    const userNetworks = ((session.user as any)?.networks as any[]) || [];
    return userNetworks.some((n: any) => n.networkId === networkId || n.id === networkId);
  }
  return true;
}

/**
 * Valida se o usuário tem privilégio de Gestor na escola (Nível 3 ou superior).
 */
export function checkIsSchoolManager(session: any, schoolId?: string | null): boolean {
  if (checkIsSuperAdmin(session)) return true;
  if (!session?.user?.email || (session.user as any).active === false) return false;

  const role = (session.user as any).role;
  if (role === "GESTAO_SECRETARIA") return true;

  // Se nenhum schoolId foi especificado, verifica se o usuário possui cargo de gestor
  if (!schoolId) {
    return role === "ADMIN" || role === "GESTOR_ESCOLAR";
  }

  // Se schoolId foi especificado, valida se o usuário possui vínculo de gestão com esta escola específica
  const userSchools = ((session.user as any)?.schools as any[]) || [];
  const schoolLink = userSchools.find((s: any) => s.schoolId === schoolId);
  if (schoolLink) {
    return (
      schoolLink.role === "ADMIN" ||
      schoolLink.role === "GESTOR_ESCOLAR" ||
      schoolLink.role === "GESTAO_SECRETARIA"
    );
  }

  // Vínculo pelo schoolId primário do usuário
  if ((session.user as any).schoolId === schoolId && (role === "ADMIN" || role === "GESTOR_ESCOLAR")) {
    return true;
  }

  return false;
}
