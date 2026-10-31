import { auth } from "@/lib/auth";
import { getReportsSummary } from "@/lib/reportsAggregator";
import RelatoriosClient from "./RelatoriosClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  let initialSummary: any = null;
  try {
    initialSummary = await getReportsSummary({
      segment: "TODOS",
      schoolId: (session.user as any)?.schoolId,
    });
  } catch (err) {
    console.error("[RelatoriosPage] Erro ao carregar resumo de relatórios:", err);
  }

  return <RelatoriosClient initialSummary={initialSummary} />;
}
