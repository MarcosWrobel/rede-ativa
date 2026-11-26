import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAuthorizedCurrentSchool } from "@/lib/currentSchool";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import { buildSessionFromSnapshot, isSnapshotSuperAdmin, resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";
import TreinamentoClient from "./TreinamentoClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orientação e Guias — Rede Ativa",
  description:
    "Simulação demonstrativa e guias práticos para a rotina de busca ativa, atendimento às famílias e atas pedagógicas.",
};

export default async function TreinamentoPage() {
  const session = await auth();
  if (!session?.user || (session.user as { active?: boolean }).active === false) {
    redirect("/login");
  }

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const freshSession = buildSessionFromSnapshot(session, snapshot);
  const currentSchool = await getAuthorizedCurrentSchool(
    freshSession,
    freshSession?.user?.schoolId,
    snapshot
  );
  const schoolEdition = currentSchool
    ? currentSchool.edition ?? resolveSchoolEdition(currentSchool)
    : "INSTITUCIONAL_ESSENCIAL";
  const isSuperAdmin = isSnapshotSuperAdmin(snapshot);

  return (
    <TreinamentoClient
      schoolEdition={schoolEdition}
      isSuperAdmin={isSuperAdmin}
      schoolName={currentSchool?.name || "Rede Ativa"}
    />
  );
}
