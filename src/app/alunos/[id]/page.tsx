import { getSchoolContextByVerifiedId, type SchoolContext } from "@/lib/currentSchool";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import { prisma } from "@/lib/prisma";
import { checkIsSuperAdmin } from "@/lib/roles";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  buildRestrictedConfidentialMinuteSummary,
  canAccessConfidentialMinute,
  stripInternalStudentNameAliases,
} from "@/lib/ataCrypto";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import ProntuarioClient from "./ProntuarioClient";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

async function resolveStudentSchool(
  studentSchoolId: string | null | undefined,
  fallbackSchool: SchoolContext
) {
  const targetId = studentSchoolId?.trim();
  if (!targetId || targetId === fallbackSchool.id) {
    return fallbackSchool;
  }

  return (await getSchoolContextByVerifiedId(targetId)) ?? fallbackSchool;
}

export default async function ProntuarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await resolveAuthorizedPageContext();
  const session = ctx.session;

  const { id } = await params;
  const currentSchool = ctx.school;
  let targetSchoolId = currentSchool.id;
  if (checkIsSuperAdmin(session) && typeof (prisma as any)?.student?.findUnique === "function") {
    const stuHeader = await prisma.student.findUnique({
      where: { id },
      select: { schoolId: true },
    });
    if (!stuHeader) notFound();
    targetSchoolId = stuHeader.schoolId;
  }

  const bundle = await loadStudent360Bundle(id, targetSchoolId);

  if (!bundle) {
    notFound();
  }

  if (!assertTenantOwnership(bundle.student.schoolId, currentSchool.id, session)) {
    notFound();
  }

  // Garante que ProntuarioClient receba a escola real do estudante mesmo com cookie active_school_id de SUPERADMIN
  const studentSchool = await resolveStudentSchool(bundle.student.schoolId, currentSchool);

  const sanitizedMinutes = bundle.minutes.map((m: any) => {
    if (!canAccessConfidentialMinute(m, session)) {
      return buildRestrictedConfidentialMinuteSummary(m, {
        subject: "Atendimento sob sigilo",
        summary: "[Conteúdo sob sigilo — acesso restrito à direção e ao servidor autor]",
      });
    }
    const cleanParticipants = Array.isArray(m.participants)
      ? m.participants.map(
          ({ mobileSignToken, mobileSignExpiresAt, mobileSignRevision, ...rest }: any) => rest
        )
      : [];
    return {
      ...m,
      students: stripInternalStudentNameAliases(m.students).map(
        ({ student: _student, ...studentRest }: any) => studentRest
      ),
      participants: cleanParticipants,
    };
  });

  const isAdmin = ctx.isSchoolManager;

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
