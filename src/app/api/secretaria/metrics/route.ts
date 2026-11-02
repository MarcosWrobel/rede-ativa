import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSuperAdmin, checkIsSecretariat } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const isSuper = checkIsSuperAdmin(authCheck.session);
    const isSecretariat = checkIsSecretariat(authCheck.session);

    if (!isSuper && !isSecretariat) {
      return NextResponse.json(
        { error: "Acesso restrito à Gestão da Secretaria de Educação." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const requestedCity = searchParams.get("city")?.trim() || "Tibagi";

    // 1. Busca todas as escolas municipais da cidade
    const municipalSchools = await prisma.school.findMany({
      where: {
        active: true,
        network: "MUNICIPAL",
        ...(requestedCity ? { city: { equals: requestedCity, mode: "insensitive" } } : {}),
      },
      include: {
        _count: {
          select: {
            students: true,
            classGroups: true,
            userSchools: true,
            pedagogicalMinutes: true,
          },
        },
        students: {
          where: { active: true },
          select: {
            id: true,
            updatedAt: true,
            lowAttendanceRecord: {
              select: { attendancePercent: true, serpStatus: true },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    let totalStudents = 0;
    let totalClasses = 0;
    let criticalStudentsCount = 0;
    let totalPercentSum = 0;
    let studentsWithRecord = 0;

    const schoolsSummary = municipalSchools.map((s) => {
      let schoolCritical = 0;
      let schoolPercentSum = 0;
      let schoolStudentsWithRecord = 0;
      let latestUpdate: Date | null = null;

      let settings: any = {};
      try {
        if (s.settingsJson) settings = JSON.parse(s.settingsJson);
      } catch {}

      s.students.forEach((st) => {
        if (st.updatedAt) {
          if (!latestUpdate || st.updatedAt > latestUpdate) {
            latestUpdate = st.updatedAt;
          }
        }
        if (st.lowAttendanceRecord) {
          const pct = st.lowAttendanceRecord.attendancePercent;
          schoolPercentSum += pct;
          schoolStudentsWithRecord++;
          if (pct < 75) {
            schoolCritical++;
          }
        }
      });

      totalStudents += s._count.students;
      totalClasses += s._count.classGroups;
      criticalStudentsCount += schoolCritical;
      totalPercentSum += schoolPercentSum;
      studentsWithRecord += schoolStudentsWithRecord;

      const avgAttendance =
        schoolStudentsWithRecord > 0
          ? Number((schoolPercentSum / schoolStudentsWithRecord).toFixed(1))
          : 100;

      const lastSyncAtIso = latestUpdate ? (latestUpdate as Date).toISOString() : null;
      const daysSinceSync = latestUpdate
        ? Math.max(0, Math.floor((Date.now() - (latestUpdate as Date).getTime()) / (1000 * 60 * 60 * 24)))
        : null;
      const isSyncOutdated = s._count.students === 0 || (daysSinceSync !== null && daysSinceSync > 7);

      const district = settings.district || settings.polo || s.nre || "Sede Urbana";

      return {
        id: s.id,
        name: s.name,
        inepCode: s.inepCode,
        city: s.city,
        state: s.state,
        phone: s.phone,
        email: s.email,
        logoUrl: s.logoUrl,
        district,
        studentsCount: s._count.students,
        classesCount: s._count.classGroups,
        staffCount: s._count.userSchools,
        minutesCount: s._count.pedagogicalMinutes,
        criticalCount: schoolCritical,
        averageAttendance: avgAttendance,
        hasSyncToken: Boolean(s.syncTokenHash),
        lastSyncAt: lastSyncAtIso,
        daysSinceSync,
        isSyncOutdated,
      };
    });

    const networkAverageAttendance =
      studentsWithRecord > 0
        ? Number((totalPercentSum / studentsWithRecord).toFixed(1))
        : 100;

    // Busca total de mensagens de busca ativa disparadas pelas escolas municipais
    const schoolIds = municipalSchools.map((s) => s.id);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const totalLogsMonth = await prisma.messageLog.count({
      where: {
        student: { schoolId: { in: schoolIds } },
        sentAt: { gte: monthStart },
      },
    });

    return NextResponse.json({
      success: true,
      city: requestedCity,
      networkName: `SEMEC ${requestedCity}`,
      metrics: {
        totalSchools: municipalSchools.length,
        totalStudents,
        totalClasses,
        criticalStudentsCount,
        networkAverageAttendance,
        messagesSentThisMonth: totalLogsMonth,
      },
      schools: schoolsSummary,
    });
  } catch (error: any) {
    console.error("[GET /api/secretaria/metrics] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
