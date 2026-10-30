import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { getReportsSummary } from "@/lib/reportsAggregator";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const segment = searchParams.get("segment") || "TODOS";
    const dateFrom = (searchParams.get("dateFrom") || "").trim();
    const dateTo = (searchParams.get("dateTo") || "").trim();

    const summary = await getReportsSummary({ segment, dateFrom, dateTo });
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Erro ao agregar relatórios:", error);
    return NextResponse.json(
      { error: error.message || "Erro ao calcular indicadores." },
      { status: 500 }
    );
  }
}
