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

  const initialSummary = await getReportsSummary({ segment: "TODOS" });

  return <RelatoriosClient initialSummary={initialSummary} />;
}
