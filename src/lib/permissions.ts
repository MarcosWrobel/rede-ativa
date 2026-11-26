import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "./auth";
import { prisma } from "./prisma";
import {
  BOOTSTRAP_ADMIN_EMAIL,
  checkIsAdmin,
  checkIsSuperAdmin,
  checkIsSecretariat,
  checkIsSchoolManager,
  isBootstrapAdminEmail,
  type RoleLevel,
} from "./roles";
import { getAuthorizedCurrentSchool } from "./currentSchool";
import {
  buildSessionFromSnapshot,
  isSnapshotSuperAdmin,
  resolveEffectiveRoleForSchool,
  resolveEffectiveSessionRoleWithoutSchool,
  resolveServerUserAuthSnapshot,
  type ServerUserAuthSnapshot,
} from "./serverAuthContext";

export {
  BOOTSTRAP_ADMIN_EMAIL,
  checkIsAdmin,
  checkIsSuperAdmin,
  checkIsSecretariat,
  checkIsSchoolManager,
  isBootstrapAdminEmail,
};

export type AuthCheckSuccess = {
  ok: true;
  session: Session;
  userId?: string;
  email: string;
  userName: string;
  role: RoleLevel | "ADMIN";
  schoolId?: string;
  networkId?: string;
  snapshot?: ServerUserAuthSnapshot;
};

export type AuthCheckFailure = {
  ok: false;
  response: NextResponse;
};

/**
 * Exige usuário institucional autenticado e ativo no servidor (fail-closed na requisição seguinte à revogação).
 */
export async function requireAuth(): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase().trim();

  if (!session?.user || !email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
    };
  }

  if (session.user.active === false) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Conta desativada. Contate a administração da escola." },
        { status: 403 }
      ),
    };
  }

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Conta desativada ou acesso revogado no servidor." },
        { status: 403 }
      ),
    };
  }

  const freshSession = buildSessionFromSnapshot(session, snapshot) as Session;
  const effectiveRole = resolveEffectiveSessionRoleWithoutSchool(snapshot) as RoleLevel | "ADMIN";
  const networkId = snapshot.networks[0]?.networkId || session.user.networkId || undefined;

  return {
    ok: true,
    session: freshSession,
    userId: snapshot.id,
    email: snapshot.email,
    userName: snapshot.name || snapshot.email.split("@")[0],
    role: effectiveRole,
    schoolId: freshSession.user?.schoolId || undefined,
    networkId,
    snapshot,
  };
}

/**
 * Exige perfil estrito de SuperAdmin da Plataforma SaaS (Nível 1).
 * Nunca concede privilégio global a "ADMIN".
 */
export async function requireSuperAdmin(): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  const isSuper = authCheck.snapshot
    ? isSnapshotSuperAdmin(authCheck.snapshot)
    : checkIsSuperAdmin(authCheck.session);

  if (!isSuper) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito a administradores gerais da plataforma." },
        { status: 403 }
      ),
    };
  }

  return authCheck;
}

/**
 * Exige perfil de Gestão da Secretaria de Educação (Nível 2) ou SuperAdmin.
 */
export async function requireSecretariat(targetNetworkId?: string | null): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  if (!checkIsSecretariat(authCheck.session, targetNetworkId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito à Gestão da Secretaria Municipal de Educação." },
        { status: 403 }
      ),
    };
  }

  return authCheck;
}

/**
 * Exige perfil administrativo ativo para operações sem alvo escolar único (ex.: provisionamento em /api/schools).
 * Para administração de uma escola específica, utilize `requireSchoolAdmin(targetSchoolId)`.
 */
export async function requireAdmin(): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  if (!checkIsAdmin(authCheck.session)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito a gestores e administradores do sistema." },
        { status: 403 }
      ),
    };
  }

  return authCheck;
}

/**
 * Exige perfil de Gestor na escola alvo efetiva (Nível 3), Secretaria com vínculo ativo
 * e independente na rede da escola alvo (Nível 2) ou SuperAdmin ativo (Nível 1).
 * Valida papel diretamente contra o vínculo da escola alvo no banco.
 */
export async function requireSchoolAdmin(targetSchoolId?: string | null): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  const snapshot = authCheck.snapshot ?? (await resolveServerUserAuthSnapshot(authCheck.session));
  if (!snapshot || snapshot.active === false) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Conta desativada ou acesso revogado." },
        { status: 403 }
      ),
    };
  }

  if (isSnapshotSuperAdmin(snapshot)) {
    return authCheck;
  }

  let effectiveSchoolId = targetSchoolId?.trim() || null;
  if (!effectiveSchoolId) {
    const activeSchool = await getAuthorizedCurrentSchool(authCheck.session, authCheck.schoolId, snapshot);
    effectiveSchoolId = activeSchool?.id || null;
  }

  if (!effectiveSchoolId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nenhuma instituição escolar autorizada vinculada à sessão atual." },
        { status: 403 }
      ),
    };
  }

  let targetSchoolMeta: {
    id: string;
    networkId?: string | null;
    network?: string | null;
    city?: string | null;
    active?: boolean;
  } | null = null;

  const schoolFindUnique = (prisma as unknown as { school?: { findUnique?: Function } })?.school?.findUnique;
  if (typeof schoolFindUnique === "function") {
    const dbSchool = await schoolFindUnique({
      where: { id: effectiveSchoolId },
      select: { id: true, networkId: true, network: true, city: true, active: true },
    });
    if (dbSchool === null) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Acesso restrito à Direção ou Gestão desta instituição escolar." },
          { status: 403 }
        ),
      };
    }
    if (dbSchool !== undefined) {
      targetSchoolMeta = dbSchool;
    }
  }

  if (targetSchoolMeta && targetSchoolMeta.active === false) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Instituição escolar inativa." },
        { status: 403 }
      ),
    };
  }

  const schoolDescriptor = targetSchoolMeta || { id: effectiveSchoolId };
  const effectiveRoleForTarget = resolveEffectiveRoleForSchool(snapshot, schoolDescriptor);
  const managerCheck = checkIsSchoolManager(authCheck.session, effectiveSchoolId, schoolDescriptor);

  const isAllowedManagerRole =
    effectiveRoleForTarget === "SUPERADMIN" ||
    effectiveRoleForTarget === "GESTOR_ESCOLAR" ||
    effectiveRoleForTarget === "GESTAO_SECRETARIA";

  if (!isAllowedManagerRole || !managerCheck) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito à Direção ou Gestão desta instituição escolar." },
        { status: 403 }
      ),
    };
  }

  return {
    ...authCheck,
    session: buildSessionFromSnapshot(authCheck.session, snapshot, schoolDescriptor) as Session,
    role: effectiveRoleForTarget as AuthCheckSuccess["role"],
    schoolId: effectiveSchoolId,
  };
}
