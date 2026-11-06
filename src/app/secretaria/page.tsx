import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin, checkIsSecretariat, checkIsSuperAdmin } from "@/lib/roles";
import { generatePredictiveRecommendations } from "@/lib/predictiveAnalytics";
import SecretariaClient from "./SecretariaClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Painel da Secretaria Municipal de Educação | Gestão da Rede SEMEC",
};

interface Props {
  searchParams?: Promise<{ city?: string }>;
}

export default async function SecretariaPage({ searchParams }: Props) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const isSuper = checkIsSuperAdmin(session);
  const isSec = checkIsSecretariat(session);

  if (!isSuper && !isSec) {
    redirect("/");
  }

  const userNetworks = ((session.user as any)?.networks as any[]) || [];
  const allowedCities = userNetworks
    .map((n: any) => (n.city || n.network?.city || "").trim())
    .filter(Boolean);

  const requestedCity = resolvedSearchParams.city?.trim();
  let defaultCity = requestedCity || allowedCities[0] || "Tibagi";

  if (!isSuper) {
    const effectiveAllowed = allowedCities.length > 0 ? allowedCities : ["Tibagi"];
    const matchesAllowed = effectiveAllowed.some(
      (c) => c.toLowerCase() === defaultCity.toLowerCase()
    );
    if (!matchesAllowed) {
      defaultCity = effectiveAllowed[0];
    }
  }

  // Buscar cidades disponíveis na rede municipal (restrito às redes autorizadas se não for SuperAdmin)
  const availableMunicipalCities = await prisma.school.findMany({
    where: {
      active: true,
      network: "MUNICIPAL",
      ...(!isSuper && allowedCities.length > 0
        ? { OR: allowedCities.map((c) => ({ city: { equals: c, mode: "insensitive" as const } })) }
        : !isSuper
          ? { city: { equals: defaultCity, mode: "insensitive" as const } }
          : {}),
    },
    select: { city: true },
    distinct: ["city"],
  });
  const availableCities = Array.from(new Set(availableMunicipalCities.map((c) => c.city).filter(Boolean)));
  if (!availableCities.includes(defaultCity)) {
    availableCities.unshift(defaultCity);
  }

  const municipalSchools = await prisma.school.findMany({
    where: {
      active: true,
      network: "MUNICIPAL",
      ...(defaultCity ? { city: { equals: defaultCity, mode: "insensitive" } } : {}),
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
            select: { attendancePercent: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  let totalStudents = 0;
  let totalClasses = 0;
  let criticalCount = 0;
  let totalPercentSum = 0;
  let studentsWithRecord = 0;

  const formattedSchools = municipalSchools.map((s) => {
    let schoolCritical = 0;
    let schoolSum = 0;
    let schoolRecorded = 0;
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
        schoolSum += pct;
        schoolRecorded++;
        if (pct < 75) {
          schoolCritical++;
        }
      }
    });

    totalStudents += s._count.students;
    totalClasses += s._count.classGroups;
    criticalCount += schoolCritical;
    totalPercentSum += schoolSum;
    studentsWithRecord += schoolRecorded;

    const avgAttendance =
      schoolRecorded > 0 ? Number((schoolSum / schoolRecorded).toFixed(1)) : 100;

    const lastSyncAtIso = latestUpdate ? (latestUpdate as Date).toISOString() : null;
    const daysSinceSync = latestUpdate
      ? Math.max(0, Math.floor((Date.now() - (latestUpdate as Date).getTime()) / (1000 * 60 * 60 * 24)))
      : null;
    const isSyncOutdated = s._count.students === 0 || (daysSinceSync !== null && daysSinceSync > 7);

    const district = settings.district || settings.polo || s.nre || "Sede Urbana";

    return {
      id: s.id,
      name: s.name,
      shortName: s.name.replace(/^(Escola Municipal|E\.M\.)\s+/i, ""),
      inepCode: s.inepCode,
      city: s.city,
      state: s.state,
      phone: s.phone,
      email: s.email,
      logoUrl: s.logoUrl,
      nre: s.nre,
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

  const networkAvg =
    studentsWithRecord > 0 ? Number((totalPercentSum / studentsWithRecord).toFixed(1)) : 100;

  const schoolIds = municipalSchools.map((s) => s.id);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthlyMessages = await prisma.messageLog.count({
    where: {
      student: { schoolId: { in: schoolIds } },
      sentAt: { gte: monthStart },
    },
  });

  // Agrupamento de Causas para Relatórios Preditivos (SAAS-07)
  const repliedLogs = await prisma.messageLog.groupBy({
    by: ["replyCategory"],
    where: {
      student: { schoolId: { in: schoolIds } },
      guardianReplied: true,
      replyCategory: { not: null },
    },
    _count: { replyCategory: true },
  });

  const totalCategorized = repliedLogs.reduce((acc, curr) => acc + curr._count.replyCategory, 0);

  const causesBreakdown = repliedLogs
    .map((item) => ({
      category: item.replyCategory as string,
      count: item._count.replyCategory,
      percentage:
        totalCategorized > 0
          ? Number(((item._count.replyCategory / totalCategorized) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const criticalRate =
    totalStudents > 0 ? Number(((criticalCount / totalStudents) * 100).toFixed(1)) : 0;

  const recommendations = generatePredictiveRecommendations(causesBreakdown, criticalRate);

  return (
    <SecretariaClient
      city={defaultCity}
      availableCities={availableCities}
      metrics={{
        totalSchools: municipalSchools.length,
        totalStudents,
        totalClasses,
        criticalStudentsCount: criticalCount,
        networkAverageAttendance: networkAvg,
        messagesSentThisMonth: monthlyMessages,
      }}
      initialSchools={formattedSchools}
      predictiveData={{
        totalCategorizedReplies: totalCategorized,
        criticalRate,
        causesBreakdown,
        recommendations,
      }}
      isSuperAdmin={isSuper}
      currentUser={{
        name: session.user.name || "Gestor SEMEC",
        email: session.user.email || "",
      }}
    />
  );
}
