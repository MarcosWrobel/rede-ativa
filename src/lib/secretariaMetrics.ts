import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { generatePredictiveRecommendations } from "@/lib/predictiveAnalytics";
import type { ServerUserAuthSnapshot } from "@/lib/serverAuthContext";

const SECRETARIA_TX_CONCURRENCY = 4;

export interface SecretariaNetworkScope {
  allowedNetworkIds: string[];
  allowedCities: string[];
}

export interface SecretariaSchoolSummary {
  id: string;
  name: string;
  shortName: string;
  inepCode: string;
  city: string;
  state: string;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  nre: string;
  district: string;
  studentsCount: number;
  classesCount: number;
  staffCount: number;
  minutesCount: number;
  criticalCount: number;
  averageAttendance: number;
  hasSyncToken: boolean;
  lastSyncAt: string | null;
  daysSinceSync: number | null;
  isSyncOutdated: boolean;
}

export interface SecretariaAggregatedResult {
  metrics: {
    totalSchools: number;
    totalStudents: number;
    totalClasses: number;
    criticalStudentsCount: number;
    networkAverageAttendance: number;
    messagesSentThisMonth: number;
  };
  predictiveAnalysis: {
    totalCategorizedReplies: number;
    criticalRate: number;
    causesBreakdown: Array<{
      category: string;
      count: number;
      percentage: number;
    }>;
    recommendations: ReturnType<typeof generatePredictiveRecommendations>;
  };
  schools: SecretariaSchoolSummary[];
}

/**
 * Normaliza parâmetros de filtro (`city`, `networkId`) recebidos via query string ou Next.js searchParams.
 * Preserva a semântica da API: usa apenas o primeiro valor, aplica trim e trata vazio como ausente.
 */
export function normalizeSecretariaFilterParam(
  value: string | string[] | null | undefined
): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return undefined;
  const trimmed = first.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve os networkIds e municípios autorizados para GESTAO_SECRETARIA a partir
 * de vínculos ativos e redes ativas revalidados no servidor (`snapshot`).
 * A ausência de vínculo válido no snapshot prevalece sobre dados antigos da sessão.
 */
export async function resolveSecretariaNetworkScope(params: {
  isSuper: boolean;
  userId?: string | null;
  snapshot?: ServerUserAuthSnapshot | null;
}): Promise<SecretariaNetworkScope> {
  const { isSuper, userId, snapshot } = params;
  if (isSuper) {
    return { allowedNetworkIds: [], allowedCities: [] };
  }

  const resolvedNetworks: Array<{ networkId: string; city: string }> = [];

  if (snapshot) {
    for (const net of snapshot.networks || []) {
      if (
        net.active !== false &&
        net.network?.active !== false &&
        (!net.role || net.role.toUpperCase() === "GESTAO_SECRETARIA") &&
        net.networkId
      ) {
        resolvedNetworks.push({
          networkId: net.networkId,
          city: (net.network?.city || "").trim(),
        });
      }
    }
  } else if (userId && typeof (prisma as any).userNetwork?.findMany === "function") {
    const dbNetworks = await prisma.userNetwork.findMany({
      where: { userId, active: true },
      include: { network: true },
    });
    for (const un of dbNetworks as any[]) {
      if (
        un?.active !== false &&
        un?.network?.active !== false &&
        (!un?.role || String(un.role).toUpperCase() === "GESTAO_SECRETARIA") &&
        un?.networkId
      ) {
        resolvedNetworks.push({
          networkId: String(un.networkId).trim(),
          city: String(un.network?.city || "").trim(),
        });
      }
    }
  }

  const allowedNetworkIds = Array.from(
    new Set(resolvedNetworks.map((n) => n.networkId).filter(Boolean))
  );
  const allowedCities = Array.from(
    new Set(resolvedNetworks.map((n) => n.city).filter(Boolean))
  );

  return { allowedNetworkIds, allowedCities };
}

/**
 * Enumera escolas municipais ativas dentro do escopo autorizado e executa as
 * leituras operacionais (Student, ClassGroup, MessageLog, UserSchool, PedagogicalMinute)
 * em transações independentes via `withTenantContext` com concorrência limitada.
 */
export async function aggregateSecretariaMetrics(params: {
  isSuper: boolean;
  allowedNetworkIds: string[];
  networkIdFilter?: string;
  cityFilter?: string;
}): Promise<SecretariaAggregatedResult> {
  const { isSuper, allowedNetworkIds, networkIdFilter, cityFilter } = params;

  const effectiveNetworkIds = !isSuper
    ? networkIdFilter && allowedNetworkIds.includes(networkIdFilter)
      ? [networkIdFilter]
      : allowedNetworkIds
    : networkIdFilter
      ? [networkIdFilter]
      : [];

  if (!isSuper && effectiveNetworkIds.length === 0) {
    return {
      metrics: {
        totalSchools: 0,
        totalStudents: 0,
        totalClasses: 0,
        criticalStudentsCount: 0,
        networkAverageAttendance: 100,
        messagesSentThisMonth: 0,
      },
      predictiveAnalysis: {
        totalCategorizedReplies: 0,
        criticalRate: 0,
        causesBreakdown: [],
        recommendations: [],
      },
      schools: [],
    };
  }

  // 1. Enumeração apenas das escolas municipais ativas autorizadas (sem relações protegidas)
  const municipalSchools = await prisma.school.findMany({
    where: {
      active: true,
      network: "MUNICIPAL",
      ...(effectiveNetworkIds.length > 0
        ? { networkId: { in: effectiveNetworkIds } }
        : {}),
      ...(cityFilter ? { city: { equals: cityFilter, mode: "insensitive" } } : {}),
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
      logoUrl: true,
      settingsJson: true,
      syncTokenHash: true,
      updatedAt: true,
    },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  interface PerSchoolAggregate {
    summary: SecretariaSchoolSummary;
    criticalCount: number;
    percentSum: number;
    studentsWithRecord: number;
    monthlyMessages: number;
    causeCounts: Array<{ category: string; count: number }>;
  }

  const perSchoolResults: PerSchoolAggregate[] = [];

  for (let i = 0; i < municipalSchools.length; i += SECRETARIA_TX_CONCURRENCY) {
    const chunk = municipalSchools.slice(i, i + SECRETARIA_TX_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (s) => {
        const tenantData = await withTenantContext(prisma, s.id, async (tx) => {
          const [
            studentsCount,
            classesCount,
            staffCount,
            minutesCount,
            activeStudents,
            monthlyMessages,
            repliedCauses,
          ] = await Promise.all([
            tx.student.count({
              where: {
                schoolId: s.id,
                classGroup: { schoolId: s.id },
              },
            }),
            tx.classGroup.count({ where: { schoolId: s.id } }),
            tx.userSchool.count({ where: { schoolId: s.id } }),
            tx.pedagogicalMinute.count({ where: { schoolId: s.id } }),
            tx.student.findMany({
              where: {
                schoolId: s.id,
                active: true,
                classGroup: { schoolId: s.id },
              },
              select: {
                id: true,
                updatedAt: true,
                lowAttendanceRecord: {
                  select: { attendancePercent: true },
                },
              },
            }),
            tx.messageLog.count({
              where: {
                OR: [{ schoolId: null }, { schoolId: s.id }],
                student: {
                  schoolId: s.id,
                  classGroup: { schoolId: s.id },
                },
                sentAt: { gte: monthStart },
              },
            }),
            tx.messageLog.groupBy({
              by: ["replyCategory"],
              where: {
                OR: [{ schoolId: null }, { schoolId: s.id }],
                student: {
                  schoolId: s.id,
                  classGroup: { schoolId: s.id },
                },
                guardianReplied: true,
                replyCategory: { not: null },
              },
              _count: { replyCategory: true },
            }),
          ]);

          return {
            studentsCount,
            classesCount,
            staffCount,
            minutesCount,
            activeStudents,
            monthlyMessages,
            repliedCauses,
          };
        });

        let schoolCritical = 0;
        let schoolPercentSum = 0;
        let schoolStudentsWithRecord = 0;
        let latestUpdate: Date | null = null;

        let settings: Record<string, any> = {};
        try {
          if (s.settingsJson) settings = JSON.parse(s.settingsJson);
        } catch {}

        for (const st of tenantData.activeStudents) {
          if (st.updatedAt && (!latestUpdate || st.updatedAt > latestUpdate)) {
            latestUpdate = st.updatedAt;
          }
          if (st.lowAttendanceRecord) {
            const pct = st.lowAttendanceRecord.attendancePercent;
            schoolPercentSum += pct;
            schoolStudentsWithRecord++;
            if (pct < 75) {
              schoolCritical++;
            }
          }
        }

        const avgAttendance =
          schoolStudentsWithRecord > 0
            ? Number((schoolPercentSum / schoolStudentsWithRecord).toFixed(1))
            : 100;

        const lastSyncAtIso = latestUpdate ? latestUpdate.toISOString() : null;
        const daysSinceSync = latestUpdate
          ? Math.max(0, Math.floor((now.getTime() - latestUpdate.getTime()) / (1000 * 60 * 60 * 24)))
          : null;
        const isSyncOutdated =
          tenantData.studentsCount === 0 || (daysSinceSync !== null && daysSinceSync > 7);

        const district = settings.district || settings.polo || s.nre || "Sede Urbana";

        const summary: SecretariaSchoolSummary = {
          id: s.id,
          name: s.name,
          shortName: s.name.replace(/^(Escola Municipal|E\.M\.)\s+/i, ""),
          inepCode: s.inepCode,
          city: s.city,
          state: s.state,
          phone: s.phone ?? null,
          email: s.email ?? null,
          logoUrl: resolveSchoolLogoProxyUrl({
            id: s.id,
            logoUrl: s.logoUrl,
            updatedAt: s.updatedAt,
          }),
          nre: s.nre,
          district,
          studentsCount: tenantData.studentsCount,
          classesCount: tenantData.classesCount,
          staffCount: tenantData.staffCount,
          minutesCount: tenantData.minutesCount,
          criticalCount: schoolCritical,
          averageAttendance: avgAttendance,
          hasSyncToken: Boolean(s.syncTokenHash),
          lastSyncAt: lastSyncAtIso,
          daysSinceSync,
          isSyncOutdated,
        };

        return {
          summary,
          criticalCount: schoolCritical,
          percentSum: schoolPercentSum,
          studentsWithRecord: schoolStudentsWithRecord,
          monthlyMessages: tenantData.monthlyMessages,
          causeCounts: (tenantData.repliedCauses || [])
            .filter((c) => Boolean(c.replyCategory))
            .map((c) => ({
              category: c.replyCategory as string,
              count: c._count.replyCategory,
            })),
        };
      })
    );
    perSchoolResults.push(...chunkResults);
  }

  let totalStudents = 0;
  let totalClasses = 0;
  let criticalStudentsCount = 0;
  let totalPercentSum = 0;
  let studentsWithRecord = 0;
  let messagesSentThisMonth = 0;
  const causesCountMap = new Map<string, number>();

  for (const r of perSchoolResults) {
    totalStudents += r.summary.studentsCount;
    totalClasses += r.summary.classesCount;
    criticalStudentsCount += r.criticalCount;
    totalPercentSum += r.percentSum;
    studentsWithRecord += r.studentsWithRecord;
    messagesSentThisMonth += r.monthlyMessages;
    for (const c of r.causeCounts) {
      causesCountMap.set(c.category, (causesCountMap.get(c.category) || 0) + c.count);
    }
  }

  const networkAverageAttendance =
    studentsWithRecord > 0
      ? Number((totalPercentSum / studentsWithRecord).toFixed(1))
      : 100;

  const totalCategorizedReplies = Array.from(causesCountMap.values()).reduce(
    (acc, count) => acc + count,
    0
  );

  const causesBreakdown = Array.from(causesCountMap.entries())
    .map(([category, count]) => ({
      category,
      count,
      percentage:
        totalCategorizedReplies > 0
          ? Number(((count / totalCategorizedReplies) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const criticalRate =
    totalStudents > 0 ? Number(((criticalStudentsCount / totalStudents) * 100).toFixed(1)) : 0;

  const recommendations = generatePredictiveRecommendations(causesBreakdown, criticalRate);

  return {
    metrics: {
      totalSchools: perSchoolResults.length,
      totalStudents,
      totalClasses,
      criticalStudentsCount,
      networkAverageAttendance,
      messagesSentThisMonth,
    },
    predictiveAnalysis: {
      totalCategorizedReplies,
      criticalRate,
      causesBreakdown,
      recommendations,
    },
    schools: perSchoolResults.map((r) => r.summary),
  };
}
