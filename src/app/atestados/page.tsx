import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentSchool } from "@/lib/currentSchool";
import AtestadosClient from "./AtestadosClient";

export const dynamic = "force-dynamic";

export default async function AtestadosPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const school = await getCurrentSchool((session.user as any)?.schoolId);
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const startOfTodayBrasilia = new Date(`${todayStr}T00:00:00.000-03:00`);

  const schoolCondition = school?.id
    ? { OR: [{ schoolId: school.id }, { schoolId: null }] }
    : {};

  const [justifications, totalCount, activeCount, classes, students] = await Promise.all([
    prisma.absenceJustification.findMany({
      where: { student: { ...schoolCondition, active: true } },
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
    }),
    prisma.absenceJustification.count({ where: { student: { ...schoolCondition, active: true } } }),
    prisma.absenceJustification.count({
      where: {
        student: { ...schoolCondition, active: true },
        endDate: { gte: startOfTodayBrasilia },
      },
    }),
    prisma.classGroup.findMany({
      select: { id: true, name: true, shift: true },
      orderBy: { name: "asc" },
    }),
    prisma.student.findMany({
      where: { ...schoolCondition, active: true },
      select: {
        id: true,
        name: true,
        cgm: true,
        classGroupId: true,
        classGroup: { select: { id: true, name: true } },
      },
      orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

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
