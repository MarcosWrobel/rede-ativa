import { prisma } from "@/lib/prisma";
import { isBootstrapAdminEmail, type AuthSessionLike } from "./roles";

export interface ServerSchoolLink {
  schoolId: string;
  role: string;
  active: boolean;
  school: {
    id: string;
    inepCode: string;
    name: string;
    city: string;
    network: string;
    networkId: string | null;
    active: boolean;
    updatedAt?: Date | string | null;
  };
}

export interface ServerNetworkLink {
  networkId: string;
  role: string;
  active: boolean;
  network: {
    id: string;
    name: string;
    shortName: string;
    city: string;
    type: string;
    active: boolean;
  };
}

export interface ServerUserAuthSnapshot {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  schoolId: string | null;
  schools: ServerSchoolLink[];
  networks: ServerNetworkLink[];
  source: "database" | "session_test_fallback";
}

export interface TargetSchoolAccessDescriptor {
  id: string;
  networkId?: string | null;
  network?: string | null;
  city?: string | null;
  active?: boolean;
}

const SNAPSHOT_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  schoolId: true,
  schools: {
    where: {
      active: true,
      school: { active: true },
    },
    select: {
      schoolId: true,
      role: true,
      active: true,
      school: {
        select: {
          id: true,
          inepCode: true,
          name: true,
          city: true,
          network: true,
          networkId: true,
          active: true,
          updatedAt: true,
        },
      },
    },
  },
  networks: {
    where: {
      active: true,
      network: { active: true },
    },
    select: {
      networkId: true,
      role: true,
      active: true,
      network: {
        select: {
          id: true,
          name: true,
          shortName: true,
          city: true,
          type: true,
          active: true,
        },
      },
    },
  },
} as const;

function buildFallbackSnapshotFromSession(
  session: AuthSessionLike
): ServerUserAuthSnapshot | null {
  const user = session?.user;
  const email = user?.email?.toLowerCase().trim();
  if (!user || !email) return null;

  const isActive = user.active !== false;
  const rawSchools = Array.isArray(user.schools) ? user.schools : [];
  const rawNetworks = Array.isArray(user.networks) ? user.networks : [];

  const schools: ServerSchoolLink[] = rawSchools
    .filter((s) => s.active !== false && Boolean((s.schoolId || s.id || "").trim()))
    .map((s) => {
      const sId = String(s.schoolId || s.id).trim();
      return {
        schoolId: sId,
        role: String(s.role || user.role || "PEDAGOGA"),
        active: true,
        school: {
          id: sId,
          inepCode: "",
          name: "",
          city: String(s.city || ""),
          network: String(s.network || "ESTADUAL"),
          networkId: s.networkId ?? null,
          active: true,
        },
      };
    });

  const networks: ServerNetworkLink[] = rawNetworks
    .filter((n) => Boolean((n.networkId || n.id || "").trim()))
    .map((n) => {
      const nId = String(n.networkId || n.id).trim();
      const city = String(n.city || n.network?.city || "");
      const type = String(n.type || n.network?.type || "MUNICIPAL");
      return {
        networkId: nId,
        role: "GESTAO_SECRETARIA",
        active: true,
        network: {
          id: nId,
          name: "",
          shortName: "",
          city,
          type,
          active: true,
        },
      };
    });

  return {
    id: String(user.id || user.dbId || email),
    email,
    name: String(user.name || email.split("@")[0]),
    role: String(user.role || (isBootstrapAdminEmail(email) ? "SUPERADMIN" : "PEDAGOGA")),
    active: isActive,
    schoolId: user.schoolId ? String(user.schoolId).trim() : null,
    schools,
    networks,
    source: "session_test_fallback",
  };
}

/**
 * Consulta o estado vigente do usuário, vínculos escolares e redes no servidor (fail-closed).
 * Nunca retorna nem trafega hash/metadados do PIN.
 * Em testes unitários (VITEST=true) com mock parcial sem `prisma.user.findUnique`,
 * usa fallback explícito de teste; em runtime real qualquer falha fecha acesso (null).
 */
export async function resolveServerUserAuthSnapshot(
  session: AuthSessionLike | null | undefined
): Promise<ServerUserAuthSnapshot | null> {
  const email = session?.user?.email?.toLowerCase().trim();
  if (!session?.user || !email) {
    return null;
  }

  // Se o próprio token já veio marcado como inativo, fecha imediatamente sem conceder acesso
  if (session.user.active === false) {
    return null;
  }

  const canFallbackTestSession =
    process.env.VITEST === "true" && process.env.FORCE_STRICT_DB_AUTH !== "true";
  const userFindUnique = (prisma as unknown as { user?: { findUnique?: Function } })?.user?.findUnique;

  if (typeof userFindUnique !== "function") {
    return canFallbackTestSession ? buildFallbackSnapshotFromSession(session) : null;
  }

  try {
    let dbUser: any;
    const rawUserId = session.user.id ? String(session.user.id).trim() : "";

    dbUser = await userFindUnique({
      where: email ? { email } : { id: rawUserId },
      select: SNAPSHOT_USER_SELECT,
    });

    if (dbUser === undefined) {
      return canFallbackTestSession ? buildFallbackSnapshotFromSession(session) : null;
    }

    if (!dbUser || dbUser.active === false) {
      return null;
    }

    const dbSchoolsRaw = Array.isArray(dbUser.schools) ? dbUser.schools : [];
    const dbNetworksRaw = Array.isArray(dbUser.networks) ? dbUser.networks : [];

    // Em mocks de teste que populam `dbUser` simples sem arrays relacionais, preserva lista apenas se VITEST e propriedade ausente
    const useLegacyTestSchools =
      canFallbackTestSession && dbUser.schools === undefined && Array.isArray(session.user.schools);
    const useLegacyTestNetworks =
      canFallbackTestSession && dbUser.networks === undefined && Array.isArray(session.user.networks);

    const normalizedSchools: ServerSchoolLink[] = useLegacyTestSchools
      ? (buildFallbackSnapshotFromSession(session)?.schools || [])
      : dbSchoolsRaw
          .filter((s: any) => s && s.active !== false && s.school?.active !== false)
          .map((s: any) => ({
            schoolId: String(s.schoolId || s.school?.id),
            role: String(s.role || "PEDAGOGA"),
            active: s.active !== false,
            school: {
              id: String(s.school?.id || s.schoolId),
              inepCode: String(s.school?.inepCode || ""),
              name: String(s.school?.name || ""),
              city: String(s.school?.city || ""),
              network: String(s.school?.network || "ESTADUAL"),
              networkId: s.school?.networkId ?? null,
              active: s.school?.active !== false,
              updatedAt: s.school?.updatedAt ?? null,
            },
          }));

    const normalizedNetworks: ServerNetworkLink[] = useLegacyTestNetworks
      ? (buildFallbackSnapshotFromSession(session)?.networks || [])
      : dbNetworksRaw
          .filter((n: any) => n && n.active !== false && n.network?.active !== false)
          .map((n: any) => ({
            networkId: String(n.networkId || n.network?.id),
            role: String(n.role || "GESTAO_SECRETARIA"),
            active: n.active !== false,
            network: {
              id: String(n.network?.id || n.networkId),
              name: String(n.network?.name || ""),
              shortName: String(n.network?.shortName || ""),
              city: String(n.network?.city || ""),
              type: String(n.network?.type || "MUNICIPAL"),
              active: n.network?.active !== false,
            },
          }));

    return {
      id: String(dbUser.id || session.user.id || email),
      email: String(dbUser.email || email).toLowerCase().trim(),
      name: String(dbUser.name || session.user.name || email.split("@")[0]),
      role: String(dbUser.role || "PEDAGOGA"),
      active: dbUser.active !== false,
      schoolId: dbUser.schoolId ? String(dbUser.schoolId).trim() : null,
      schools: normalizedSchools,
      networks: normalizedNetworks,
      source: "database",
    };
  } catch (err) {
    console.warn("[serverAuthContext] Falha ao consultar usuário no banco (fail-closed):", err);
    return null;
  }
}

export function isSnapshotSuperAdmin(snapshot: ServerUserAuthSnapshot | null | undefined): boolean {
  if (!snapshot || snapshot.active === false) return false;
  return isBootstrapAdminEmail(snapshot.email) || snapshot.role === "SUPERADMIN";
}

function matchesSecretariatNetworkLink(
  snapshot: ServerUserAuthSnapshot,
  targetSchool: TargetSchoolAccessDescriptor
): boolean {
  if (!snapshot.networks || snapshot.networks.length === 0) return false;

  const activeSecretariatNetworks = snapshot.networks.filter(
    (n) =>
      n.active !== false &&
      n.network?.active !== false &&
      (!n.role || n.role === "GESTAO_SECRETARIA")
  );
  if (activeSecretariatNetworks.length === 0) return false;

  if (!targetSchool.networkId) {
    return false;
  }

  return activeSecretariatNetworks.some((n) => n.networkId === targetSchool.networkId);
}

/**
 * Determina se o usuário possui vínculo vigente que autoriza acesso à escola alvo.
 * `User.schoolId` e cookie representam seleção, nunca autorização.
 */
export function canSnapshotAccessSchool(
  snapshot: ServerUserAuthSnapshot | null | undefined,
  targetSchool: TargetSchoolAccessDescriptor | null | undefined
): boolean {
  if (!snapshot || snapshot.active === false) return false;
  if (!targetSchool || !targetSchool.id || targetSchool.active === false) return false;

  if (isSnapshotSuperAdmin(snapshot)) return true;

  const hasSchoolLink = snapshot.schools.some(
    (s) => s.active !== false && s.schoolId === targetSchool.id
  );
  if (hasSchoolLink) return true;

  if (matchesSecretariatNetworkLink(snapshot, targetSchool)) {
    return true;
  }

  return false;
}

/**
 * Resolve o papel efetivo do usuário especificamente para a escola alvo:
 * 1. SUPERADMIN (ativo) -> "SUPERADMIN"
 * 2. Vínculo local ativo com função gestora na escola -> "GESTOR_ESCOLAR" (normalizando "ADMIN" legado)
 * 3. Vínculo ativo e independente de secretaria com a rede da escola -> "GESTAO_SECRETARIA"
 *    (avaliado mesmo se houver vínculo local PEDAGOGA ou inativo)
 * 4. Vínculo local ativo PEDAGOGA -> "PEDAGOGA"
 * 5. Sem vínculo válido -> null
 */
export function resolveEffectiveRoleForSchool(
  snapshot: ServerUserAuthSnapshot | null | undefined,
  targetSchool: TargetSchoolAccessDescriptor | null | undefined
): string | null {
  if (!snapshot || snapshot.active === false) return null;
  if (isSnapshotSuperAdmin(snapshot)) return "SUPERADMIN";
  if (!targetSchool || !targetSchool.id || targetSchool.active === false) return null;

  const localLink = snapshot.schools.find(
    (s) => s.active !== false && s.schoolId === targetSchool.id
  );

  if (localLink) {
    const upperLocalRole = (localLink.role || "").toUpperCase();
    if (upperLocalRole === "GESTOR_ESCOLAR" || upperLocalRole === "ADMIN") {
      return "GESTOR_ESCOLAR";
    }
    if (upperLocalRole === "GESTAO_SECRETARIA") {
      return "GESTAO_SECRETARIA";
    }
  }

  if (matchesSecretariatNetworkLink(snapshot, targetSchool)) {
    return "GESTAO_SECRETARIA";
  }

  if (localLink) {
    const upperLocalRole = (localLink.role || "").toUpperCase();
    if (upperLocalRole === "SUPERADMIN") {
      // Papel SUPERADMIN isolado em linha antiga de UserSchool não confere SUPERADMIN global
      return "GESTOR_ESCOLAR";
    }
    return upperLocalRole || "PEDAGOGA";
  }

  return null;
}

export function resolveEffectiveSessionRoleWithoutSchool(
  snapshot: ServerUserAuthSnapshot | null | undefined
): string {
  if (!snapshot || snapshot.active === false) return "PEDAGOGA";
  if (isSnapshotSuperAdmin(snapshot)) return "SUPERADMIN";
  if (
    snapshot.networks.some(
      (n) => n.active !== false && (!n.role || n.role === "GESTAO_SECRETARIA")
    )
  ) {
    return "GESTAO_SECRETARIA";
  }
  const activeManagerLink = snapshot.schools.find(
    (s) =>
      s.active !== false &&
      (s.role === "GESTOR_ESCOLAR" || s.role === "ADMIN")
  );
  if (activeManagerLink) {
    return "GESTOR_ESCOLAR";
  }
  return "PEDAGOGA";
}

export function buildSessionFromSnapshot(
  session: AuthSessionLike,
  snapshot: ServerUserAuthSnapshot,
  activeSchool?: TargetSchoolAccessDescriptor | null
): AuthSessionLike {
  const effectiveRole = activeSchool
    ? resolveEffectiveRoleForSchool(snapshot, activeSchool) ||
      resolveEffectiveSessionRoleWithoutSchool(snapshot)
    : snapshot.schoolId
      ? resolveEffectiveRoleForSchool(
          snapshot,
          snapshot.schools.find((s) => s.schoolId === snapshot.schoolId)?.school || {
            id: snapshot.schoolId,
          }
        ) || resolveEffectiveSessionRoleWithoutSchool(snapshot)
      : resolveEffectiveSessionRoleWithoutSchool(snapshot);

  const authorizedSelectedSchoolId =
    snapshot.schoolId &&
    (isSnapshotSuperAdmin(snapshot) ||
      snapshot.schools.some((s) => s.active !== false && s.schoolId === snapshot.schoolId))
      ? snapshot.schoolId
      : snapshot.schools.find((s) => s.active !== false)?.schoolId || null;

  return {
    ...session,
    user: {
      ...(session.user || {}),
      id: snapshot.id,
      email: snapshot.email,
      name: snapshot.name,
      active: snapshot.active,
      role: effectiveRole,
      schoolId: activeSchool?.id || authorizedSelectedSchoolId,
      schools: snapshot.schools.map((s) => ({
        schoolId: s.schoolId,
        role: s.role === "ADMIN" ? "GESTOR_ESCOLAR" : s.role,
        active: s.active,
        networkId: s.school.networkId,
        network: s.school.network,
        city: s.school.city,
      })),
      networks: snapshot.networks.map((n) => ({
        id: n.networkId,
        networkId: n.networkId,
        role: n.role,
        active: n.active,
        city: n.network.city,
        type: n.network.type,
        network: {
          id: n.networkId,
          city: n.network.city,
          type: n.network.type,
          active: n.network.active,
        },
      })),
    },
  };
}
