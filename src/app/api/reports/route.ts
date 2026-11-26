import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { getReportsSummary } from "@/lib/reportsAggregator";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;

    const { searchParams } = new URL(req.url);
    const segment = searchParams.get("segment") || "TODOS";
    const dateFrom = (searchParams.get("dateFrom") || "").trim();
    const dateTo = (searchParams.get("dateTo") || "").trim();

    const summary = await getReportsSummary({
      segment,
      dateFrom,
      dateTo,
      schoolId: schoolRes.school.id,
    });
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Erro ao agregar relatórios:", error);
    return NextResponse.json(
      { error: "Erro ao calcular indicadores." },
      { status: 500 }
    );
  }
}
