import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkIsSuperAdmin, checkIsSecretariat, checkIsSchoolManager } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function RootDispatcherPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // 1. Super Admin (Global SaaS Platform) -> /admin
  if (checkIsSuperAdmin(session)) {
    redirect("/admin");
  }

  // 2. Gestão Secretaria Municipal (SEMEC / Municipal) -> /secretaria
  if (checkIsSecretariat(session)) {
    redirect("/secretaria");
  }

  // 3. Gestor da Escola (Direção / Coordenação da Unidade) -> /gestao
  if (checkIsSchoolManager(session)) {
    redirect("/gestao");
  }

  // 4. Equipe Pedagógica (Pedagogas / Professores) -> Rotina Diária de Busca Ativa
  redirect("/busca-ativa");
}
