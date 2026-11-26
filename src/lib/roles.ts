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
    dbId?: string;
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
      networkId?: string | null;
      network?: string | null;
      city?: string | null;
    }>;
    networks?: Array<{
      id?: string;
      networkId?: string;
      role?: string;
      active?: boolean;
      city?: string;
      type?: string;
      network?: { city?: string; type?: string; active?: boolean };
    }>;
  } | null;
}

export interface TargetSchoolLike {
  id?: string | null;
  networkId?: string | null;
  network?: string | null;
  city?: string | null;
  active?: boolean;
}

/**
 * Valida se uma sessão pertence ao SuperAdmin da plataforma (Nível 1).
 * Nunca concede alcance global ao papel legado "ADMIN".
 */
export function checkIsSuperAdmin(session: AuthSessionLike | null | undefined): boolean {
  if (!session?.user?.email) return false;
  if (session.user.active === false) return false;
  const role = session.user.role;
  return isBootstrapAdminEmail(session.user.email) || role === "SUPERADMIN";
}

/**
 * Valida se uma sessão pertence a um perfil administrativo para fins de navegação/UI.
 * Operações escolares críticas devem sempre chamar `requireSchoolAdmin(schoolId)`.
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
  const userNetworks = (session.user.networks || []).filter((n) => n.active !== false);
  const hasSecretariatAuthority =
    role === "GESTAO_SECRETARIA" ||
    userNetworks.some((n) => (n.role || "").toUpperCase() === "GESTAO_SECRETARIA");
  if (!hasSecretariatAuthority) return false;

  if (networkId) {
    return userNetworks.some((n) => n.networkId === networkId || n.id === networkId);
  }
  return true;
}

/**
 * Valida se o usuário tem privilégio de Gestor na escola alvo (Nível 3 ou superior).
 * Ordem estrita:
 * 1. SuperAdmin ativo -> true
 * 2. Conta ausente ou inativa -> false
 * 3. Sem `schoolId`: verifica vínculo de gestão apenas para roteamento UI
 * 4. Vínculo local ativo de gestão na escola -> true (sem encerrar antes de avaliar rede se for PEDAGOGA/inativo)
 * 5. Vínculo ativo e independente de secretaria com a rede da escola alvo -> true
 * 6. Sem fallback legado por `session.user.schoolId` -> false
 */
export function checkIsSchoolManager(
  session: AuthSessionLike | null | undefined,
  schoolId?: string | null,
  targetSchool?: TargetSchoolLike | null
): boolean {
  if (checkIsSuperAdmin(session)) return true;
  if (!session?.user?.email || session.user.active === false) return false;

  const role = session.user.role;
  const userSchools = session.user.schools || [];

  // Rota/UI sem schoolId específico: exige cargo gestor em vínculo ativo (ou role se lista omitida no router)
  if (!schoolId) {
    if (userSchools.length > 0) {
      return userSchools.some(
        (s) => s.active !== false && (s.role === "GESTOR_ESCOLAR" || s.role === "ADMIN")
      );
    }
    return role === "ADMIN" || role === "GESTOR_ESCOLAR";
  }

  if (targetSchool && targetSchool.active === false) {
    return false;
  }

  // 4. Verifica vínculo direto e ativo de gestão com a escola específica
  const activeSchoolLink = userSchools.find(
    (s) => (s.schoolId === schoolId || s.id === schoolId) && s.active !== false
  );
  if (
    activeSchoolLink &&
    (activeSchoolLink.role === "ADMIN" ||
      activeSchoolLink.role === "GESTOR_ESCOLAR" ||
      activeSchoolLink.role === "GESTAO_SECRETARIA")
  ) {
    return true;
  }

  // 5. Avalia vínculo ativo e independente de secretaria com a rede da escola (mesmo com UserSchool PEDAGOGA/inativo)
  const activeNetworks = (session.user.networks || []).filter(
    (n) => n.active !== false && n.network?.active !== false
  );
  const hasSecretariatScope =
    activeNetworks.length > 0 &&
    (role === "GESTAO_SECRETARIA" ||
      activeNetworks.some((n) => (n.role || "").toUpperCase() === "GESTAO_SECRETARIA"));

  if (hasSecretariatScope) {
    const allowedNetworkIds = activeNetworks
      .map((n) => n.networkId || n.id)
      .filter((id): id is string => Boolean(id));

    const candidate = targetSchool || activeSchoolLink;
    if (!candidate || candidate.active === false || !candidate.networkId) return false;

    return allowedNetworkIds.includes(candidate.networkId);
  }

  // 6. Sem fallback legado por session.user.schoolId
  return false;
}
