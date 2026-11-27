import { headers } from "next/headers";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import { logAudit } from "@/lib/audit";
import { getSchoolContextByVerifiedId, type SchoolContext } from "@/lib/currentSchool";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import { prisma } from "@/lib/prisma";
import { checkIsSuperAdmin } from "@/lib/roles";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  anonymizeOtherMinorsInText,
  anonymizeParticipantsForDossier,
  buildStudentMaskingEntries,
  canAccessConfidentialMinute,
  stripInternalStudentNameAliases,
} from "@/lib/ataCrypto";
import DossieClient from "./DossieClient";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

async function resolveDossierSchool(
  studentSchoolId: string | null | undefined,
  fallbackSchool: SchoolContext
) {
  const targetId = studentSchoolId?.trim();
  if (!targetId || targetId === fallbackSchool.id) {
    return fallbackSchool;
  }

  return (await getSchoolContextByVerifiedId(targetId)) ?? fallbackSchool;
}

export default async function DossiePage({
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
    .map((m: any) => {
      const linkedStudents = buildStudentMaskingEntries([
        ...(m.students || []),
        {
          studentId: bundle.student.id,
          studentNameSnapshot: bundle.student.name,
          student: { name: bundle.student.name },
        },
      ]);
      const maskedSubject = anonymizeOtherMinorsInText(
        m.subject || "",
        bundle.student.id,
        linkedStudents
      );
      const maskedSummary = anonymizeOtherMinorsInText(
        m.summary || "",
        bundle.student.id,
        linkedStudents
      );
      const maskedAgreementsSummary = m.agreementsSummary
        ? anonymizeOtherMinorsInText(m.agreementsSummary, bundle.student.id, linkedStudents)
        : null;
      const maskedParticipantNames = anonymizeParticipantsForDossier(
        m.participants || [],
        bundle.student.id,
        linkedStudents
      );

      return {
        ...m,
        students: stripInternalStudentNameAliases(m.students).map(
          ({ student: _student, ...studentRest }: any) => studentRest
        ),
        maskedSubject,
        maskedSummary,
        maskedAgreementsSummary,
        maskedParticipantNames,
        participants: Array.isArray(m.participants)
          ? m.participants.map(
              ({ mobileSignToken, mobileSignExpiresAt, mobileSignRevision, ...rest }: any) => rest
            )
          : [],
      };
    });

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
