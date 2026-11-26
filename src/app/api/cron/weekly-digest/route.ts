import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool, getSchoolContextByVerifiedId } from "@/lib/currentSchool";
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
      const schoolRes = await requireAuthorizedSchool(
        authCheck.session,
        authCheck.schoolId,
        authCheck.snapshot
      );
      if (!schoolRes.ok) {
        return schoolRes.response;
      }
      sessionSchoolId = schoolRes.school.id;
      authUser = {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      };
    }

    const urlSchoolId = req.nextUrl.searchParams.get("schoolId")?.trim() || undefined;

    if (isCronAuthorized && !urlSchoolId) {
      const activeSchools = await prisma.school.findMany({
        where: { active: true },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });

      if (activeSchools.length === 0) {
        return NextResponse.json(
          { error: "Nenhuma instituição de ensino ativa disponível para processar boletim." },
          { status: 400 }
        );
      }

      const digests = [];
      for (const s of activeSchools) {
        const payload = await compileWeeklyDigest(s.id);
        await logAudit({
          action: "GENERATE_WEEKLY_DIGEST",
          entityType: "LowAttendance",
          schoolId: s.id,
          details: {
            totalStudents: payload.kpis.totalStudents,
            criticalCount: payload.kpis.criticalCount,
            criticalOverdue: payload.kpis.criticalWithoutRecentContactCount,
            sentLast7Days: payload.kpis.sentLast7Days,
            source: "CRON_JOB",
          },
          user: authUser,
          req,
        });
        digests.push(payload);
      }

      if (digests.length === 1) {
        return NextResponse.json(digests[0], { status: 200 });
      }
      return NextResponse.json(
        { ...digests[0], totalSchools: digests.length, digests },
        { status: 200 }
      );
    }

    const targetSchoolId = isCronAuthorized ? urlSchoolId! : sessionSchoolId!;
    if (isCronAuthorized) {
      const verifiedSchool = await getSchoolContextByVerifiedId(targetSchoolId);
      if (!verifiedSchool) {
        return NextResponse.json(
          { error: "Instituição de ensino não encontrada ou inativa." },
          { status: 404 }
        );
      }
    }

    const payload = await compileWeeklyDigest(targetSchoolId);

    await logAudit({
      action: "GENERATE_WEEKLY_DIGEST",
      entityType: "LowAttendance",
      schoolId: targetSchoolId,
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
