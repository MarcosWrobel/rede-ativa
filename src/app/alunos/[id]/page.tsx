import { auth } from "@/lib/auth";
import { checkIsAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import ProntuarioClient from "./ProntuarioClient";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

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

  const sanitizedMinutes = bundle.minutes.map((m: any) => {
    const cleanParticipants = Array.isArray(m.participants)
      ? m.participants.map(({ mobileSignToken, ...rest }: any) => rest)
      : [];
    if (!canAccessConfidentialMinute(m, session)) {
      return {
        ...m,
        rawNotes: null,
        summary: "[CONTEÚDO SOB SIGILO REFORÇADO ECA — ACESSO RESTRITO À DIREÇÃO E AO SERVIDOR AUTOR]",
        agreementsSummary: null,
        actionItems: [],
        participants: cleanParticipants,
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
      currentUser={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
      }}
      isAdmin={isAdmin}
    />
  );
}
