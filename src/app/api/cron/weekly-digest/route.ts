import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { safeCompareStrings } from "@/lib/syncToken";
import { compileWeeklyDigest } from "@/lib/weeklyDigest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleDigest(req);
}

export async function POST(req: NextRequest) {
  return handleDigest(req);
}

async function handleDigest(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const cronSecret = process.env.CRON_SECRET?.trim() || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const isCronAuthorized = Boolean(cronSecret) && safeCompareStrings(bearerToken, cronSecret);

    let sessionSchoolId: string | undefined = undefined;
    let authUser: { id?: string; name: string; email: string } = {
      name: "Cron / Sistema",
      email: "cron@sistema",
    };

    if (!isCronAuthorized) {
      const authCheck = await requireAuth();
      if (!authCheck.ok) {
        return authCheck.response;
      }
      sessionSchoolId = authCheck.schoolId;
      authUser = {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      };
    }

    // Suporte a targetSchoolId via query param (apenas se CRON autorizado) ou schoolId da sessão (H-07)
    const urlSchoolId = req.nextUrl.searchParams.get("schoolId") || undefined;
    const targetSchoolId = isCronAuthorized ? (urlSchoolId || undefined) : sessionSchoolId;

    const payload = await compileWeeklyDigest(targetSchoolId);

    await logAudit({
      action: "GENERATE_WEEKLY_DIGEST",
      entityType: "LowAttendance",
      schoolId: targetSchoolId || null,
      details: {
        totalStudents: payload.kpis.totalStudents,
        criticalCount: payload.kpis.criticalCount,
        criticalOverdue: payload.kpis.criticalWithoutRecentContactCount,
        sentLast7Days: payload.kpis.sentLast7Days,
        source: isCronAuthorized ? "CRON_JOB" : "MANUAL_UI",
      },
      user: authUser,
      req,
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error: any) {
    console.error("[WeeklyDigest] Erro ao compilar boletim:", error);
    return NextResponse.json(
      { error: "Erro interno ao processar boletim semanal" },
      { status: 500 }
    );
  }
}
