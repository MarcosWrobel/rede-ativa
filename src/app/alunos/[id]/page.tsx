import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import ProntuarioClient from "./ProntuarioClient";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function resolveStudentSchool(
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
    console.warn("[ProntuarioPage] Aviso ao resolver escola do estudante:", err);
  }

  return getCurrentSchool(targetId);
}

export default async function ProntuarioPage({
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

  // Garante que ProntuarioClient receba a escola real do estudante mesmo com cookie active_school_id de SUPERADMIN
  const studentSchool = await resolveStudentSchool(bundle.student.schoolId, currentSchool);

  const sanitizedMinutes = bundle.minutes.map((m: any) => {
    const cleanParticipants = Array.isArray(m.participants)
      ? m.participants.map(({ mobileSignToken, ...rest }: any) => rest)
      : [];
    if (!canAccessConfidentialMinute(m, session)) {
      return {
        ...m,
        subject: "Atendimento sob sigilo",
        rawNotes: null,
        summary: "[Conteúdo sob sigilo — acesso restrito à direção e ao servidor autor]",
        agreementsSummary: null,
        actionItems: [],
        addendums: [],
        participants: [],
      };
    }
    return { ...m, participants: cleanParticipants };
  });

  const isAdmin = checkIsAdmin(session);

  return (
    <ProntuarioClient
      initialStudent={bundle.student}
      initialContacts={bundle.contacts}
      initialJustifications={bundle.justifications}
      initialAttendances={bundle.attendances}
      initialSnapshots={bundle.snapshots}
      initialMinutes={sanitizedMinutes}
      initialCouncilCards={bundle.councilCards || []}
      currentSchool={studentSchool}
      currentUser={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
      }}
      isAdmin={isAdmin}
    />
  );
}
