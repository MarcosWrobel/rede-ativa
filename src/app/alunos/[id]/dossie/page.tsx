import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import { logAudit } from "@/lib/audit";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import DossieClient from "./DossieClient";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

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

  const school = bundle.student.schoolId
    ? await getCurrentSchool(bundle.student.schoolId)
    : currentSchool;

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
