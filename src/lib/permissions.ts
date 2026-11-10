import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "./auth";
import {
  BOOTSTRAP_ADMIN_EMAIL,
  checkIsAdmin,
  checkIsSuperAdmin,
  checkIsSecretariat,
  checkIsSchoolManager,
  isBootstrapAdminEmail,
  type RoleLevel,
} from "./roles";

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
};

export type AuthCheckFailure = {
  ok: false;
  response: NextResponse;
};

/**
 * Exige usuário institucional autenticado e ativo na equipe da escola.
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

  const role =
    (session.user.role as RoleLevel | "ADMIN" | undefined) ||
    (isBootstrapAdminEmail(email) ? "SUPERADMIN" : "PEDAGOGA");
  const schoolId = session.user.schoolId || undefined;
  const networkId = session.user.networkId || undefined;

  return {
    ok: true,
    session,
    userId: session.user.id || undefined,
    email,
    userName: session.user.name || email.split("@")[0],
    role,
    schoolId,
    networkId,
  };
}

/**
 * Exige perfil estrito de SuperAdmin da Plataforma SaaS (Nível 1).
 */
export async function requireSuperAdmin(): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  if (!checkIsSuperAdmin(authCheck.session)) {
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
 * Exige perfil de Administrador Geral (Retrocompatibilidade).
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
 * Exige perfil de Gestor na escola alvo (Nível 3), Secretaria da Rede (Nível 2) ou SuperAdmin (Nível 1).
 */
export async function requireSchoolAdmin(targetSchoolId?: string | null): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  if (checkIsSuperAdmin(authCheck.session)) {
    return authCheck;
  }

  const effectiveSchoolId = targetSchoolId || authCheck.schoolId;
  const isManager = checkIsSchoolManager(authCheck.session, effectiveSchoolId);

  if (!isManager) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito à Direção ou Gestão desta instituição escolar." },
        { status: 403 }
      ),
    };
  }

  return authCheck;
}
