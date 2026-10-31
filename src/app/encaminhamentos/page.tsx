import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentSchool } from "@/lib/currentSchool";
import EncaminhamentosClient from "./EncaminhamentosClient";

export const dynamic = "force-dynamic";

export default async function EncaminhamentosPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const school = await getCurrentSchool((session.user as any)?.schoolId);

  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const startOfTodayBrasilia = new Date(`${todayStr}T00:00:00.000-03:00`);

  const in7Days = new Date(startOfTodayBrasilia);
  in7Days.setDate(in7Days.getDate() + 7);

  const [actionItems, allSchoolActions, classes] = await Promise.all([
    prisma.pedagogicalActionItem.findMany({
      where: {
        minute: {
          schoolId: school.id,
          status: { in: ["FINALIZED", "DRAFT"] },
        },
      },
      take: 150,
      orderBy: [
        { status: "asc" }, // PENDING primeiro
        { dueDate: "asc" }, // Urgentes primeiro
        { createdAt: "desc" },
      ],
      include: {
        minute: {
          select: {
            id: true,
            ataNumber: true,
            year: true,
            subject: true,
            attendedAt: true,
            finalizedAt: true,
            status: true,
            isConfidential: true,
            students: {
              select: {
                id: true,
                studentId: true,
                studentNameSnapshot: true,
                classNameSnapshot: true,
                cgmSnapshot: true,
                student: {
                  select: {
                    id: true,
                    name: true,
                    classGroup: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.pedagogicalActionItem.findMany({
      where: {
        minute: { schoolId: school.id, status: { in: ["FINALIZED", "DRAFT"] } },
      },
      select: {
        id: true,
        status: true,
        dueDate: true,
        responsible: true,
      },
    }),
    prisma.classGroup.findMany({
      where: { schoolId: school.id, active: true },
      select: { id: true, name: true, shift: true },
      orderBy: { name: "asc" },
    }),
  ]);

  let total = allSchoolActions.length;
  let completed = 0;
  let pending = 0;
  let overdue = 0;
  let dueSoon = 0;

  for (const a of allSchoolActions) {
    if (a.status === "COMPLETED") {
      completed++;
    } else {
      pending++;
      if (a.dueDate) {
        const due = new Date(a.dueDate);
        if (due < startOfTodayBrasilia) {
          overdue++;
        } else if (due <= in7Days) {
          dueSoon++;
        }
      }
    }
  }

  return (
    <EncaminhamentosClient
      initialActionItems={actionItems}
      initialMetrics={{
        total,
        completed,
        pending,
        overdue,
        dueSoon,
      }}
      classes={classes}
      todayStr={todayStr}
    />
  );
}
