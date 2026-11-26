import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { getAuthorizedCurrentSchool, type SchoolContext } from "@/lib/currentSchool";
import {
  buildSessionFromSnapshot,
  isSnapshotSuperAdmin,
  resolveEffectiveRoleForSchool,
  resolveEffectiveSessionRoleWithoutSchool,
  resolveServerUserAuthSnapshot,
  type ServerUserAuthSnapshot,
} from "@/lib/serverAuthContext";

export interface AuthorizedPageContext {
  session: Session;
  snapshot: ServerUserAuthSnapshot | null;
  school: SchoolContext;
  effectiveRole: string;
  isSuperAdmin: boolean;
  isSchoolManager: boolean;
}

/**
 * Resolve sessão autenticada, valida revogação no banco em tempo real
 * e resolve a escola ativa autorizada sem fallback para a primeira escola ativa.
 * Redireciona para `/login` se não autenticado/revogado ou `/sem-escola` sem vínculo ativo.
 */
export async function resolveAuthorizedPageContext(options?: {
  explicitSchoolId?: string | null;
  requireManager?: boolean;
}): Promise<AuthorizedPageContext> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase().trim();

  if (!session?.user || !email) {
    redirect("/login");
  }

  if (session.user.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const freshSession = buildSessionFromSnapshot(session, snapshot) as Session;
  const school = await getAuthorizedCurrentSchool(
    freshSession,
    options?.explicitSchoolId ?? freshSession.user?.schoolId,
    snapshot
  );

  if (!school) {
    redirect("/sem-escola");
  }

  const isSuperAdmin = isSnapshotSuperAdmin(snapshot);
  const effectiveRole =
    resolveEffectiveRoleForSchool(snapshot, school) ||
    resolveEffectiveSessionRoleWithoutSchool(snapshot);
  const isSchoolManager =
    isSuperAdmin ||
    effectiveRole === "GESTOR_ESCOLAR" ||
    effectiveRole === "GESTAO_SECRETARIA";

  if (options?.requireManager && !isSchoolManager) {
    redirect("/busca-ativa");
  }

  return {
    session: buildSessionFromSnapshot(freshSession, snapshot, school) as Session,
    snapshot,
    school,
    effectiveRole,
    isSuperAdmin,
    isSchoolManager,
  };
}
