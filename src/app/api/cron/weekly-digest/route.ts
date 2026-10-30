import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
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
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    const isCronAuthorized = cronSecret && authHeader === `Bearer ${cronSecret}`;

    const session = await auth();
    const isSessionAuthorized = !!session?.user;

    if (!isCronAuthorized && !isSessionAuthorized) {
      return NextResponse.json(
        { error: "Não autorizado. Forneça Bearer CRON_SECRET ou inicie sessão." },
        { status: 401 }
      );
    }

    const payload = await compileWeeklyDigest();

    if (isSessionAuthorized && session?.user) {
      await logAudit({
        action: "GENERATE_WEEKLY_DIGEST",
        entityType: "LowAttendance",
        details: {
          totalStudents: payload.kpis.totalStudents,
          criticalCount: payload.kpis.criticalCount,
          criticalOverdue: payload.kpis.criticalWithoutRecentContactCount,
          sentLast7Days: payload.kpis.sentLast7Days,
          source: isCronAuthorized ? "CRON_JOB" : "MANUAL_UI",
        },
        user: {
          id: (session.user as any).id,
          name: session.user.name || "Cron / Sistema",
          email: session.user.email || "cron@sistema",
        },
      });
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (error: any) {
    console.error("[WeeklyDigest] Erro ao compilar boletim:", error);
    return NextResponse.json(
      { error: "Erro interno ao processar boletim semanal", details: error.message },
      { status: 500 }
    );
  }
}
