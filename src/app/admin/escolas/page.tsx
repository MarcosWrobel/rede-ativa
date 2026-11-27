import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAuthorizedCurrentSchool } from "@/lib/currentSchool";
import { buildSessionFromSnapshot, resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { checkIsSuperAdmin, checkIsSecretariat, checkIsSchoolManager } from "@/lib/roles";
import {
  getExternalFormalizeServerStatus,
  parseSchoolAiExternalFormalizeFlag,
} from "@/lib/aiPolicy";
import { sanitizePublicSchoolSettings } from "@/lib/schoolSettingsMutation";
import { prisma } from "@/lib/prisma";
import { readSchoolsScopedCountsBatch } from "@/lib/schoolReadMetrics";
import AdminEscolasClient from "./AdminEscolasClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gestão de Escolas & Redes de Ensino | Painel Administrativo",
};

export default async function AdminEscolasPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const freshSession = buildSessionFromSnapshot(session, snapshot);

  if (!checkIsSuperAdmin(freshSession)) {
    if (checkIsSecretariat(freshSession)) {
      redirect("/secretaria");
    }
    if (checkIsSchoolManager(freshSession)) {
      redirect("/gestao");
    }
    redirect("/busca-ativa");
  }

  const currentSchool = await getAuthorizedCurrentSchool(
    freshSession,
    freshSession?.user?.schoolId,
    snapshot
  );

  // Fetch all registered schools with aggregate counts and recent activity (sem logoUrl Base64)
  const schools = await prisma.school.findMany({
    orderBy: [{ network: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      inepCode: true,
      nre: true,
      network: true,
      city: true,
      state: true,
      phone: true,
      email: true,
      settingsJson: true,
      syncTokenHash: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          users: true,
          userSchools: true,
        },
      },
      userSchools: {
        where: { active: true },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        take: 6,
      },
    },
  });

  const scopedCounts = await readSchoolsScopedCountsBatch(
    schools.map((s) => s.id),
    {
      includeInactiveStudents: true,
      includeLastStudentUpdate: true,
    }
  );

  const formattedSchools = schools.map((s) => {
    const settings = sanitizePublicSchoolSettings(s.settingsJson);
    const aiPolicyFlag = parseSchoolAiExternalFormalizeFlag(s.settingsJson);
    const counts = scopedCounts.get(s.id);
    const lastSyncAt = counts?.lastStudentUpdatedAt
      ? counts.lastStudentUpdatedAt.toISOString()
      : null;

    return {
      id: s.id,
      name: s.name,
      shortName: s.name.replace(/^(Colégio Estadual|Escola Municipal|C\.E\.|E\.M\.)\s+/i, ""),
      inep: s.inepCode,
      nre: s.nre || null,
      network: (s.network || "ESTADUAL") as "ESTADUAL" | "MUNICIPAL" | "PRIVADA",
      municipality: s.city,
      state: s.state,
      phone: s.phone,
      email: s.email,
      logoUrl: resolveSchoolLogoProxyUrl({
        id: s.id,
        logoUrl: (s as { logoUrl?: string | null }).logoUrl,
        updatedAt: s.updatedAt,
      }),
      settings,
      aiExternalFormalizeEnabled: aiPolicyFlag.verified && aiPolicyFlag.enabled,
      legacyPolicyPendingTransition: aiPolicyFlag.legacyFlagPendingTransition,
      aiExternalFormalizeUpdatedAt:
        typeof settings.aiExternalFormalizeUpdatedAt === "string"
          ? settings.aiExternalFormalizeUpdatedAt
          : null,
      aiExternalFormalizeUpdatedBy:
        typeof settings.aiExternalFormalizeUpdatedBy === "string"
          ? settings.aiExternalFormalizeUpdatedBy
          : null,
      hasSyncToken: Boolean(s.syncTokenHash),
      lastSyncAt,
      studentsCount: counts?.students ?? 0,
      classesCount: counts?.classGroups ?? 0,
      staffCount: s._count.userSchools || s._count.users,
      staff: s.userSchools.map((us) => ({
        id: us.user.id,
        name: us.user.name,
        email: us.user.email,
        role: us.role || us.user.role,
      })),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  });

  const aiServerStatus = getExternalFormalizeServerStatus();

  return (
    <AdminEscolasClient
      schools={formattedSchools}
      activeSchoolId={currentSchool?.id || null}
      aiServerStatus={aiServerStatus}
    />
  );
}
