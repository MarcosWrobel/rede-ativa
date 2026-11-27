import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import AtestadosClient from "./AtestadosClient";

export const dynamic = "force-dynamic";

export default async function AtestadosPage() {
  const ctx = await resolveAuthorizedPageContext();
  const school = ctx.school;
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const startOfTodayBrasilia = new Date(`${todayStr}T00:00:00.000-03:00`);

  const schoolCondition = school?.id
    ? { schoolId: school.id }
    : {};

  let justifications: any[] = [];
  let totalCount = 0;
  let activeCount = 0;
  let classes: any[] = [];
  let students: any[] = [];

  try {
    await withTenantContext(prisma, school.id, async (tx) => {
      justifications =
        (await tx.absenceJustification.findMany({
          where: { student: { ...schoolCondition, active: true, classGroup: { schoolId: school.id } } },
          take: 100,
          orderBy: [{ endDate: "desc" }, { createdAt: "desc" }],
          include: {
            student: {
              select: {
                id: true,
                name: true,
                cgm: true,
                phone: true,
                guardianName: true,
                classGroup: { select: { id: true, name: true, shift: true } },
              },
            },
          },
        })) || [];
      totalCount =
        (await tx.absenceJustification.count({
          where: { student: { ...schoolCondition, active: true, classGroup: { schoolId: school.id } } },
        })) || 0;
      activeCount =
        (await tx.absenceJustification.count({
          where: {
            student: { ...schoolCondition, active: true, classGroup: { schoolId: school.id } },
            endDate: { gte: startOfTodayBrasilia },
          },
        })) || 0;
      classes =
        (await tx.classGroup.findMany({
          where: { schoolId: school.id },
          select: { id: true, name: true, shift: true },
          orderBy: { name: "asc" },
        })) || [];
      students =
        (await tx.student.findMany({
          where: { ...schoolCondition, active: true, classGroup: { schoolId: school.id } },
          select: {
            id: true,
            name: true,
            cgm: true,
            classGroupId: true,
            classGroup: { select: { id: true, name: true } },
          },
          orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
        })) || [];
    });
  } catch (err) {
    console.error("[AtestadosPage] Erro ao carregar dados:", err);
  }

  return (
    <AtestadosClient
      initialJustifications={justifications}
      initialMetrics={{
        total: totalCount,
        active: activeCount,
        expired: Math.max(0, totalCount - activeCount),
      }}
      classes={classes}
      students={students}
      todayStr={todayStr}
    />
  );
}
