import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsSecretariat, checkIsSuperAdmin } from "@/lib/roles";
import { buildSessionFromSnapshot, resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";
import { generatePredictiveRecommendations } from "@/lib/predictiveAnalytics";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
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

  const snapshot = await resolveServerUserAuthSnapshot(session);
  if (!snapshot || snapshot.active === false) {
    redirect("/login?error=AccountInactive");
  }

  const freshSession = buildSessionFromSnapshot(session, snapshot);
  const isSuper = checkIsSuperAdmin(freshSession);
  const isSec = checkIsSecretariat(freshSession);

  if (!isSuper && !isSec) {
    redirect("/");
  }

  const activeSnapshotNetworks = snapshot.networks.filter(
    (n) =>
      n.active !== false &&
      n.network?.active !== false &&
      (!n.role || n.role.toUpperCase() === "GESTAO_SECRETARIA")
  );
  let resolvedNetworks = activeSnapshotNetworks.map((n) => ({
    networkId: n.networkId,
    city: (n.network?.city || "").trim(),
  }));

  if (!isSuper && resolvedNetworks.length === 0 && snapshot.id) {
    const dbNetworks = await prisma.userNetwork.findMany({
      where: { userId: snapshot.id, active: true },
      include: { network: true },
    });
    resolvedNetworks = dbNetworks
      .filter(
        (un: any) =>
          un.active !== false &&
          un.network?.active !== false &&
          (!un.role || String(un.role).toUpperCase() === "GESTAO_SECRETARIA")
      )
      .map((un: any) => ({
        networkId: String(un.networkId).trim(),
        city: String(un.network?.city || "").trim(),
      }));
  }

  const allowedNetworkIds = Array.from(
    new Set(resolvedNetworks.map((n) => n.networkId).filter(Boolean))
  );
  const allowedCities = Array.from(
    new Set(resolvedNetworks.map((n) => n.city).filter(Boolean))
  );

  // Sem rede municipal vinculada por networkId ativo: renderiza estado vazio seguro sem fallback
  if (!isSuper && allowedNetworkIds.length === 0) {
    return (
      <SecretariaClient
        city="Nenhuma rede vinculada"
        availableCities={[]}
        metrics={{
          totalSchools: 0,
          totalStudents: 0,
          totalClasses: 0,
          criticalStudentsCount: 0,
          networkAverageAttendance: 100,
          messagesSentThisMonth: 0,
        }}
        initialSchools={[]}
        predictiveData={{
          totalCategorizedReplies: 0,
          criticalRate: 0,
          causesBreakdown: [],
          recommendations: [],
        }}
        isSuperAdmin={false}
        currentUser={{
          name: session.user.name || "Gestor SEMEC",
          email: session.user.email || "",
        }}
      />
    );
  }

  const requestedCity = resolvedSearchParams.city?.trim();

  // Buscar cidades disponíveis na rede municipal (restrito estritamente aos networkIds autorizados para não-SuperAdmin)
  const availableMunicipalCities = await prisma.school.findMany({
    where: {
      active: true,
      network: "MUNICIPAL",
      ...(!isSuper ? { networkId: { in: allowedNetworkIds } } : {}),
    },
    select: { city: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  const availableCities = Array.from(new Set(availableMunicipalCities.map((c) => c.city).filter(Boolean)));

  let defaultCity = requestedCity || allowedCities[0] || availableCities[0] || "";
  if (!isSuper && availableCities.length > 0) {
    const matchesAllowed = availableCities.some(
      (c) => c.toLowerCase() === defaultCity.toLowerCase()
    );
    if (!matchesAllowed) {
      defaultCity = availableCities[0];
    }
  } else if (!isSuper && allowedCities.length > 0) {
    const matchesAllowed = allowedCities.some(
      (c) => c.toLowerCase() === defaultCity.toLowerCase()
    );
    if (!matchesAllowed) {
      defaultCity = allowedCities[0];
    }
  }

  if (defaultCity && !availableCities.includes(defaultCity)) {
    availableCities.unshift(defaultCity);
  }

  if (!defaultCity && isSuper) {
    return (
      <SecretariaClient
        city="Nenhuma rede cadastrada"
        availableCities={[]}
        metrics={{
          totalSchools: 0,
          totalStudents: 0,
          totalClasses: 0,
          criticalStudentsCount: 0,
          networkAverageAttendance: 100,
          messagesSentThisMonth: 0,
        }}
        initialSchools={[]}
        predictiveData={{
          totalCategorizedReplies: 0,
          criticalRate: 0,
          causesBreakdown: [],
          recommendations: [],
        }}
        isSuperAdmin={isSuper}
        currentUser={{
          name: session.user.name || "Gestor SEMEC",
          email: session.user.email || "",
        }}
      />
    );
  }

  const municipalSchools = await prisma.school.findMany({
    where: {
      active: true,
      network: "MUNICIPAL",
      ...(!isSuper ? { networkId: { in: allowedNetworkIds } } : {}),
      ...(defaultCity ? { city: { equals: defaultCity, mode: "insensitive" } } : {}),
    },
    select: {
      id: true,
      name: true,
      inepCode: true,
      city: true,
      state: true,
      nre: true,
      phone: true,
      email: true,
      settingsJson: true,
      syncTokenHash: true,
      updatedAt: true,
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
      logoUrl: resolveSchoolLogoProxyUrl({
        id: s.id,
        logoUrl: (s as { logoUrl?: string | null }).logoUrl,
        updatedAt: s.updatedAt,
      }),
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
