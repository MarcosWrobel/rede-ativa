import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkIsAdmin } from "@/lib/roles";
import { safeQueryList } from "@/lib/safePhase3Queries";
import AlunosClient from "./AlunosClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AlunosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const [students, classGroups, recentJustifications, allContacts] = await Promise.all([
    prisma.student.findMany({
      where: { active: true },
      include: {
        classGroup: true,
        _count: { select: { messageLogs: true } },
      },
      orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.classGroup.findMany({
      orderBy: { name: "asc" },
    }),
    safeQueryList(() =>
      prisma.absenceJustification.findMany({
        where: { endDate: { gte: recentCutoff } },
        orderBy: { endDate: "desc" },
      })
    ),
    safeQueryList(() =>
      prisma.studentContact.findMany({
        select: { id: true, studentId: true, whatsappValid: true },
      })
    ),
  ]);

  const justMap = new Map<string, any[]>();
  recentJustifications.forEach((j: any) => {
    const arr = justMap.get(j.studentId) || [];
    arr.push(j);
    justMap.set(j.studentId, arr);
  });

  const contactsCountMap = new Map<string, number>();
  allContacts.forEach((c: any) => {
    contactsCountMap.set(c.studentId, (contactsCountMap.get(c.studentId) || 0) + 1);
  });

  const enrichedStudents = students.map((s) => ({
    ...s,
    justifications: justMap.get(s.id) || [],
    extraContactsCount: contactsCountMap.get(s.id) || 0,
  }));

  const isAdmin = checkIsAdmin(session);

  return (
    <AlunosClient
      initialStudents={enrichedStudents}
      classGroups={classGroups}
      isAdmin={isAdmin}
    />
  );
}
