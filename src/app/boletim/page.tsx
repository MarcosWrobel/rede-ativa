import { compileWeeklyDigest } from "@/lib/weeklyDigest";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import BoletimClient from "./BoletimClient";

export const dynamic = "force-dynamic";

export default async function BoletimPage() {
  const ctx = await resolveAuthorizedPageContext();
  const session = ctx.session;
  const currentSchool = ctx.school;

  let initialDigest: any = null;
  try {
    initialDigest = await compileWeeklyDigest(currentSchool.id);
  } catch (err) {
    console.error("[BoletimPage] Erro ao compilar resumo semanal:", err);
  }

  return (
    <BoletimClient
      initialData={initialDigest}
      schoolEdition={currentSchool.edition}
      schoolNetwork={currentSchool.network}
      currentUser={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
        role: ctx.effectiveRole || "PEDAGOGA",
      }}
    />
  );
}
