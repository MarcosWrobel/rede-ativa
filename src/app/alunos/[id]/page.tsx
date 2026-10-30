import { auth } from "@/lib/auth";
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

  return (
    <ProntuarioClient
      initialStudent={bundle.student}
      initialContacts={bundle.contacts}
      initialJustifications={bundle.justifications}
      initialAttendances={bundle.attendances}
      initialSnapshots={bundle.snapshots}
      initialMinutes={bundle.minutes}
      currentUser={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
      }}
    />
  );
}
