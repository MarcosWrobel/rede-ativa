export const BOOTSTRAP_ADMIN_EMAIL =
  (typeof process !== "undefined" && process.env?.ADMIN_EMAIL?.trim().toLowerCase()) ||
  "marcos.wrobel@escola.pr.gov.br";

export type RoleLevel =
  | "SUPERADMIN"          // Nível 1: Plataforma SaaS global (Marcos Wrobel)
  | "GESTAO_SECRETARIA"   // Nível 2: Secretaria Municipal de Educação (SEMEC / NRE)
  | "GESTOR_ESCOLAR"      // Nível 3: Diretor(a) / Secretaria da Unidade Escolar
  | "PEDAGOGA";           // Nível 4: Equipe pedagógica operacional

export interface RoleOption {
  value: RoleLevel;
  label: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "SUPERADMIN",
    label: "Admin (Meu acesso)",
    shortLabel: "Admin",
    description: "Administrador Global da Plataforma SaaS",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-indigo-200",
  },
  {
    value: "GESTAO_SECRETARIA",
    label: "Gestor (Acesso Gestor SEMEC)",
    shortLabel: "Gestor SEMEC",
    description: "Gestão da Secretaria Municipal de Educação / Mantenedora",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200",
  },
  {
    value: "GESTOR_ESCOLAR",
    label: "Direção (Gestor da escola)",
    shortLabel: "Direção",
    description: "Diretor(a) / Gestor da Unidade Escolar",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300 border-sky-200",
  },
  {
    value: "PEDAGOGA",
    label: "Pedagógico (Equipe pedagógica)",
    shortLabel: "Pedagógico",
    description: "Equipe Pedagógica / Operacional da Escola",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200",
  },
];

export function getRoleOption(role?: string | null): RoleOption {
  const norm = (role || "").toUpperCase();
  if (norm === "SUPERADMIN" || norm === "ADMIN") return ROLE_OPTIONS[0];
  if (norm === "GESTAO_SECRETARIA") return ROLE_OPTIONS[1];
  if (norm === "GESTOR_ESCOLAR") return ROLE_OPTIONS[2];
  return ROLE_OPTIONS[3]; // PEDAGOGA / PEDAGOGICO default
}

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
    normalized === BOOTSTRAP_ADMIN_EMAIL.toLowerCase().trim() ||
    (Boolean(envAdmin) && normalized === envAdmin) ||
    normalized === "marcos.wrobel@escola.pr.gov.br"
  );
}

/**
 * Resolve deterministicamente o papel efetivo do token/sessão em todos os ciclos de autenticação
 * (signIn, jwt 1º login, jwt refresh e session), garantindo que o SuperAdmin raiz receba sempre
 * "SUPERADMIN" desde a primeira sessão.
 */
export function resolveTokenRole(params: {
  isRootAdmin: boolean;
  activeSchoolRole?: string | null;
  dbRole?: string | null;
  fallbackRole?: RoleLevel;
}): string {
  if (params.isRootAdmin) {
    return "SUPERADMIN";
  }
  return params.activeSchoolRole || params.dbRole || params.fallbackRole || "PEDAGOGA";
}

/**
 * Guard de boot: aborta imediatamente caso ENABLE_DEV_AUTH esteja ativo em ambiente de produção.
 */
export function assertNoDevAuthInProduction(
  env: Record<string, string | undefined> = process.env
): void {
  const isProd = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  if (isProd && env.ENABLE_DEV_AUTH === "true") {
    throw new Error(
      "[CRITICAL SECURITY] ENABLE_DEV_AUTH=true detectado em ambiente de produção. Abortando inicialização de autenticação."
    );
  }
}

export interface AuthSessionLike {
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    role?: string | null;
    active?: boolean;
    schoolId?: string | null;
    networkId?: string | null;
    inepCode?: string | null;
    schools?: Array<{
      id?: string;
      schoolId?: string;
      role?: string;
      active?: boolean;
    }>;
    networks?: Array<{
      id?: string;
      networkId?: string;
      city?: string;
      network?: { city?: string };
    }>;
  } | null;
}

/**
 * Valida se uma sessão pertence ao SuperAdmin da plataforma (Nível 1).
 */
export function checkIsSuperAdmin(session: AuthSessionLike | null | undefined): boolean {
  if (!session?.user?.email) return false;
  if (session.user.active === false) return false;
  const role = session.user.role;
  return isBootstrapAdminEmail(session.user.email) || role === "SUPERADMIN";
}

/**
 * Valida se uma sessão pertence a um perfil ADMIN ativo (Retrocompatibilidade).
 * Retorna true para SuperAdmin ou Gestor Escolar.
 */
export function checkIsAdmin(session: AuthSessionLike | null | undefined): boolean {
  if (!session?.user?.email) return false;
  if (session.user.active === false) return false;
  const role = session.user.role;
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
export function checkIsSecretariat(
  session: AuthSessionLike | null | undefined,
  networkId?: string | null
): boolean {
  if (checkIsSuperAdmin(session)) return true;
  if (!session?.user?.email || session.user.active === false) return false;
  const role = session.user.role;
  if (role !== "GESTAO_SECRETARIA") return false;

  if (networkId) {
    const userNetworks = session.user.networks || [];
    return userNetworks.some((n) => n.networkId === networkId || n.id === networkId);
  }
  return true;
}

/**
 * Valida se o usuário tem privilégio de Gestor na escola (Nível 3 ou superior).
 */
export function checkIsSchoolManager(
  session: AuthSessionLike | null | undefined,
  schoolId?: string | null
): boolean {
  if (checkIsSuperAdmin(session)) return true;
  if (!session?.user?.email || session.user.active === false) return false;

  const role = session.user.role;
  if (role === "GESTAO_SECRETARIA") return true;

  // Se nenhum schoolId foi especificado, verifica se o usuário possui cargo de gestor
  if (!schoolId) {
    return role === "ADMIN" || role === "GESTOR_ESCOLAR";
  }

  // Se schoolId foi especificado, valida se o usuário possui vínculo de gestão com esta escola específica
  const userSchools = session.user.schools || [];
  const schoolLink = userSchools.find((s) => s.schoolId === schoolId);
  if (schoolLink) {
    return (
      schoolLink.role === "ADMIN" ||
      schoolLink.role === "GESTOR_ESCOLAR" ||
      schoolLink.role === "GESTAO_SECRETARIA"
    );
  }

  // Vínculo pelo schoolId primário do usuário
  if (session.user.schoolId === schoolId && (role === "ADMIN" || role === "GESTOR_ESCOLAR")) {
    return true;
  }

  return false;
}
