import { getReportsSummary } from "@/lib/reportsAggregator";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import RelatoriosClient from "./RelatoriosClient";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const ctx = await resolveAuthorizedPageContext();

  let initialSummary: any = null;
  try {
    initialSummary = await getReportsSummary({
      segment: "TODOS",
      schoolId: ctx.school.id,
    });
  } catch (err) {
    console.error("[RelatoriosPage] Erro ao carregar resumo de relatórios:", err);
  }

  return <RelatoriosClient initialSummary={initialSummary} />;
}
