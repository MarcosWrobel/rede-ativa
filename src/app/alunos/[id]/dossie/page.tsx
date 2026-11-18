import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import { logAudit } from "@/lib/audit";
import { getCurrentSchool } from "@/lib/currentSchool";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import DossieClient from "./DossieClient";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function resolveDossierSchool(
  studentSchoolId: string | null | undefined,
  fallbackSchool: Awaited<ReturnType<typeof getCurrentSchool>>
) {
  const targetId = studentSchoolId?.trim();
  if (!targetId || targetId === fallbackSchool.id) {
    return fallbackSchool;
  }

  try {
    if (typeof (prisma as any)?.school?.findUnique === "function") {
      const record = await prisma.school.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          inepCode: true,
          name: true,
          city: true,
          state: true,
          nre: true,
          network: true,
          phone: true,
          email: true,
          settingsJson: true,
          networkId: true,
          educationNetwork: {
            select: {
              schools: {
                where: { active: true, settingsJson: { not: null } },
                orderBy: { createdAt: "asc" },
                take: 1,
                select: { settingsJson: true },
              },
            },
          },
          updatedAt: true,
        },
      });

      if (record) {
        const networkSettingsJson = record.educationNetwork?.schools?.[0]?.settingsJson ?? null;
        return {
          id: record.id,
          inepCode: record.inepCode,
          name: record.name,
          city: record.city,
          state: record.state,
          nre: record.nre,
          network: record.network || "ESTADUAL",
          phone: record.phone,
          email: record.email,
          logoUrl: resolveSchoolLogoProxyUrl(record),
          edition: resolveSchoolEdition(record, networkSettingsJson),
        };
      }
    }
  } catch (err) {
    console.warn("[DossiePage] Aviso ao resolver escola do estudante:", err);
  }

  return getCurrentSchool(targetId);
}

export default async function DossiePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  const bundle = await loadStudent360Bundle(id);

  if (!bundle) {
    notFound();
  }

  const currentSchool = await getCurrentSchool((session.user as any)?.schoolId);
  if (!assertTenantOwnership(bundle.student.schoolId, currentSchool.id, session)) {
    notFound();
  }

  // Garante precisão forense quando SUPERADMIN emite relatório de outra unidade (ignora override de cookie active_school_id)
  const school = await resolveDossierSchool(bundle.student.schoolId, currentSchool);

  const reqHeaders = await headers();

  await logAudit({
    action: "GENERATE_DOSSIER",
    entityType: "Student",
    entityId: bundle.student.id,
    schoolId: school.id,
    details: {
      studentName: bundle.student.name,
      cgm: bundle.student.cgm,
      schoolName: school.name,
      totalMessages: bundle.student.messageLogs?.length || 0,
    },
    user: {
      id: (session.user as any).id,
      name: session.user.name || "Equipe Pedagógica",
      email: session.user.email || "",
    },
    req: reqHeaders,
  });

  const authorizedMinutes = bundle.minutes
    .filter((m: any) => canAccessConfidentialMinute(m, session))
    .map((m: any) => ({
      ...m,
      participants: Array.isArray(m.participants)
        ? m.participants.map(({ mobileSignToken, ...rest }: any) => rest)
        : [],
    }));

  return (
    <DossieClient
      student={bundle.student}
      contacts={bundle.contacts}
      justifications={bundle.justifications}
      attendances={bundle.attendances}
      snapshots={bundle.snapshots}
      minutes={authorizedMinutes}
      school={school}
      emittedBy={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
      }}
      emittedAtIso={new Date().toISOString()}
    />
  );
}
