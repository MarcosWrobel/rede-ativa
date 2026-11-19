import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { canUseGovernmentScrapers, isPilotIntegrated } from "@/lib/platformEditions";
import { getCurrentBrasiliaYear } from "@/services/ataFinalizationService";
import {
  canMutateSchoolCouncil,
  listSchoolCouncilBoards,
} from "@/services/classCouncilService";
import ConselhoIndexClient from "./ConselhoIndexClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Conselho de Classe | Rede Ativa SaaS",
};

export default async function ConselhoClassePage({
  searchParams,
}: {
  searchParams?: Promise<{ year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const sp = searchParams ? await searchParams : {};
  const parsedYear = sp?.year ? Number.parseInt(sp.year, 10) : getCurrentBrasiliaYear();
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2024 && parsedYear <= 2100
      ? parsedYear
      : getCurrentBrasiliaYear();

  const sessionSchoolId = (session.user as { schoolId?: string | null })?.schoolId;
  const currentSchool = await getCurrentSchool(sessionSchoolId);

  const data = await listSchoolCouncilBoards(currentSchool.id, year);
  const canEdit = canMutateSchoolCouncil(session, currentSchool.id);
  const canUseBiScraper =
    isPilotIntegrated(currentSchool.edition) || canUseGovernmentScrapers(currentSchool);

  return (
    <ConselhoIndexClient
      initialYear={data.year}
      initialClassGroups={data.classGroups}
      initialBoards={data.boards}
      schoolName={currentSchool.name}
      canEdit={canEdit}
      canUseBiScraper={canUseBiScraper}
    />
  );
}
