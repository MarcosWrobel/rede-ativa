import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canUseGovernmentScrapers, isPilotIntegrated } from "@/lib/platformEditions";
import { getCurrentBrasiliaYear } from "@/services/ataFinalizationService";
import {
  canMutateSchoolCouncil,
  listSchoolCouncilBoards,
  resolveAuthorizedSchoolForCouncil,
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
  if (!session?.user || session.user.active === false) {
    redirect("/login");
  }

  const sp = searchParams ? await searchParams : {};
  const parsedYear = sp?.year ? Number.parseInt(sp.year, 10) : getCurrentBrasiliaYear();
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2024 && parsedYear <= 2100
      ? parsedYear
      : getCurrentBrasiliaYear();

  const sessionSchoolId = (session.user as { schoolId?: string | null })?.schoolId;
  const currentSchool = await resolveAuthorizedSchoolForCouncil(session, sessionSchoolId);

  if (!currentSchool) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12">
        <section className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-6 text-center space-y-2">
          <h1 className="text-lg font-black text-slate-900 dark:text-white">
            Conselho de Classe — Nenhuma instituição vinculada
          </h1>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            Sua conta não possui uma instituição de ensino ativa vinculada para consultar turmas.
            Solicite a vinculação à gestão da escola ou da rede.
          </p>
        </section>
      </main>
    );
  }

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
