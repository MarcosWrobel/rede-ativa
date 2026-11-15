import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import { checkIsSuperAdmin } from "@/lib/roles";
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

  const currentSchool = await getCurrentSchool();
  const schoolEdition = currentSchool.edition ?? resolveSchoolEdition(currentSchool);
  const isSuperAdmin = checkIsSuperAdmin(session);

  return (
    <TreinamentoClient
      schoolEdition={schoolEdition}
      isSuperAdmin={isSuperAdmin}
      schoolName={currentSchool.name}
    />
  );
}
