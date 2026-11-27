import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";

const ADMIN_TX_CONCURRENCY = 4;

export interface AdminDashboardMetrics {
  totalNetworks: number;
  totalSchools: number;
  totalStudents: number;
  totalMessages: number;
}

export interface AdminNetworkSummary {
  id: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  type: string;
  schoolsCount: number;
  managersCount: number;
  edition: ReturnType<typeof resolveSchoolEdition>;
}

export interface AdminSchoolSummary {
  id: string;
  name: string;
  inepCode: string;
  city: string;
  network: string;
  networkName: string | null;
  studentsCount: number;
  classesCount: number;
  logoUrl: string | null;
  edition: ReturnType<typeof resolveSchoolEdition>;
}

export interface AdminAuditSummary {
  id: string;
  action: string;
  userName: string;
  createdAt: string;
  details: string | null;
}

export interface AdminAggregatedData {
  metrics: AdminDashboardMetrics;
  networks: AdminNetworkSummary[];
  schools: AdminSchoolSummary[];
  auditLogs: AdminAuditSummary[];
}

/**
 * Consolida métricas e listagens da Administração Global executando leituras
 * protegidas (`Student`, `ClassGroup`, `MessageLog`) dentro de `withTenantContext`
 * por escola com concorrência limitada.
 *
 * Denominadores preservados:
 * - `totalSchools` e `schools`: apenas escolas ativas (`active: true`).
 * - `totalStudents`: estudantes ativos (`active: true`) de qualquer escola (ativa ou inativa),
 *   excluindo vínculos de turma de outra escola (`classGroup: { schoolId }`).
 * - `totalMessages`: histórico de mensagens de qualquer escola (ativa ou inativa), aceitando
 *   `MessageLog.schoolId: null` apenas quando o estudante pertence à escola da transação e
 *   excluindo logs com `schoolId` divergente ou turma de outra escola.
 */
export async function aggregateAdminMetrics(): Promise<AdminAggregatedData> {
  const [networksList, allSchools, recentAudit] = await Promise.all([
    prisma.educationNetwork.findMany({
      where: { active: true },
      include: {
        _count: { select: { schools: true, managers: true } },
        schools: { select: { inepCode: true, settingsJson: true }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.school.findMany({
      select: {
        id: true,
        active: true,
        name: true,
        inepCode: true,
        city: true,
        network: true,
        settingsJson: true,
        updatedAt: true,
        educationNetwork: { select: { name: true } },
      },
      orderBy: [{ network: "asc" }, { name: "asc" }],
    }),
    prisma.auditLog.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        userName: true,
        createdAt: true,
        details: true,
      },
    }),
  ]);

  const perSchoolCounts = new Map<
    string,
    { studentsCount: number; classesCount: number; messagesCount: number }
  >();

  let nextIdx = 0;
  const workerCount = Math.min(ADMIN_TX_CONCURRENCY, allSchools.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= allSchools.length) break;
      const school = allSchools[idx];

      const counts = await withTenantContext(prisma, school.id, async (tx) => {
        const studentsCount = await tx.student.count({
          where: {
            schoolId: school.id,
            active: true,
            classGroup: { schoolId: school.id },
          },
        });
        const classesCount = school.active
          ? await tx.classGroup.count({
              where: { schoolId: school.id },
            })
          : 0;
        const messagesCount = await tx.messageLog.count({
          where: {
            OR: [{ schoolId: null }, { schoolId: school.id }],
            student: {
              schoolId: school.id,
              classGroup: { schoolId: school.id },
            },
          },
        });

        return { studentsCount, classesCount, messagesCount };
      });

      perSchoolCounts.set(school.id, counts);
    }
  });

  await Promise.all(workers);

  let totalStudents = 0;
  let totalMessages = 0;
  const activeSchools: AdminSchoolSummary[] = [];

  for (const school of allSchools) {
    const counts = perSchoolCounts.get(school.id) || {
      studentsCount: 0,
      classesCount: 0,
      messagesCount: 0,
    };
    totalStudents += counts.studentsCount;
    totalMessages += counts.messagesCount;

    if (school.active) {
      activeSchools.push({
        id: school.id,
        name: school.name,
        inepCode: school.inepCode,
        city: school.city,
        network: school.network,
        networkName: school.educationNetwork?.name || null,
        studentsCount: counts.studentsCount,
        classesCount: counts.classesCount,
        logoUrl: resolveSchoolLogoProxyUrl({
          id: school.id,
          logoUrl: (school as { logoUrl?: string | null }).logoUrl,
          updatedAt: school.updatedAt,
        }),
        edition: resolveSchoolEdition(school),
      });
    }
  }

  const networks: AdminNetworkSummary[] = networksList.map((n) => ({
    id: n.id,
    name: n.name,
    shortName: n.shortName,
    city: n.city,
    state: n.state,
    type: n.type,
    schoolsCount: n._count.schools,
    managersCount: n._count.managers,
    edition: n.schools[0]
      ? resolveSchoolEdition(n.schools[0])
      : "INSTITUCIONAL_ESSENCIAL",
  }));

  const auditLogs: AdminAuditSummary[] = recentAudit.map((a) => ({
    id: a.id,
    action: a.action,
    userName: a.userName,
    createdAt: a.createdAt.toISOString(),
    details: a.details,
  }));

  return {
    metrics: {
      totalNetworks: networksList.length,
      totalSchools: activeSchools.length,
      totalStudents,
      totalMessages,
    },
    networks,
    schools: activeSchools,
    auditLogs,
  };
}
