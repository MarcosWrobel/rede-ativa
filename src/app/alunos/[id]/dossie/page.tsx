import { auth } from "@/lib/auth";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import { logAudit } from "@/lib/audit";
import { getCurrentSchool } from "@/lib/currentSchool";
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

  const school = await getCurrentSchool(bundle.student.schoolId);

  await logAudit({
    action: "GENERATE_DOSSIER",
    entityType: "Student",
    entityId: bundle.student.id,
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
  });

  return (
    <DossieClient
      student={bundle.student}
      contacts={bundle.contacts}
      justifications={bundle.justifications}
      attendances={bundle.attendances}
      snapshots={bundle.snapshots}
      minutes={bundle.minutes}
      school={school}
      emittedBy={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
      }}
      emittedAtIso={new Date().toISOString()}
    />
  );
}
