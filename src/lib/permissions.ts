import { NextResponse } from "next/server";
import { auth } from "./auth";
import { BOOTSTRAP_ADMIN_EMAIL, checkIsAdmin, isBootstrapAdminEmail } from "./roles";

export { BOOTSTRAP_ADMIN_EMAIL, checkIsAdmin, isBootstrapAdminEmail };

export type AuthCheckSuccess = {
  ok: true;
  session: any;
  userId?: string;
  email: string;
  userName: string;
  role: "ADMIN" | "PEDAGOGA";
  schoolId?: string;
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

  if ((session.user as any).active === false) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Conta desativada. Contate a administração da escola." },
        { status: 403 }
      ),
    };
  }

  const isAdmin = checkIsAdmin(session);
  const schoolId = (session.user as any)?.schoolId || undefined;

  return {
    ok: true,
    session,
    userId: (session.user as any).id || undefined,
    email,
    userName: session.user.name || email.split("@")[0],
    role: isAdmin ? "ADMIN" : "PEDAGOGA",
    schoolId,
  };
}

/**
 * Exige perfil estrito de Administrador (ADMIN).
 */
export async function requireAdmin(): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  if (authCheck.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito a administradores do sistema." },
        { status: 403 }
      ),
    };
  }

  return authCheck;
}

/**
 * Exige perfil de Administrador na escola alvo (ou Administrador Geral da Rede).
 */
export async function requireSchoolAdmin(targetSchoolId?: string | null): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck;

  if (isBootstrapAdminEmail(authCheck.email)) {
    return authCheck;
  }

  const effectiveSchoolId = targetSchoolId || authCheck.schoolId;
  const userSchools = ((authCheck.session?.user as any)?.schools as any[]) || [];
  const schoolMembership = userSchools.find((s: any) => s.schoolId === effectiveSchoolId);

  const isAdminInSchool = (schoolMembership && schoolMembership.role === "ADMIN") || authCheck.role === "ADMIN";

  if (!isAdminInSchool) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito ao Administrador ou Direção desta instituição escolar." },
        { status: 403 }
      ),
    };
  }

  return authCheck;
}
