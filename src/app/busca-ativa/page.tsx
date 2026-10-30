import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeQueryList } from "@/lib/safePhase3Queries";
import BuscaAtivaClient from "./BuscaAtivaClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BuscaAtivaPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; phone?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const sp = await searchParams;
  const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const [classGroups, templates, rawStudents, recentJustifications, allContacts] =
    await Promise.all([
      prisma.classGroup.findMany({
        select: { id: true, name: true, segment: true, shift: true },
        orderBy: { name: "asc" },
      }),
      prisma.messageTemplate.findMany({
        where: { active: true },
        select: {
          id: true,
          title: true,
          segment: true,
          prefixText: true,
          suffixText: true,
          isAbsenceRelated: true,
        },
        orderBy: { title: "asc" },
      }),
      prisma.student.findMany({
        where: { active: true },
        select: {
          id: true,
          cgm: true,
          name: true,
          guardianName: true,
          phone: true,
          classGroupId: true,
          classGroup: {
            select: { id: true, name: true, segment: true, shift: true },
          },
          lowAttendanceRecord: {
            select: { attendancePercent: true, actionsTaken: true, enrollmentDetail: true },
          },
          messageLogs: {
            take: 3,
            orderBy: { sentAt: "desc" },
            select: {
              id: true,
              reasonTitle: true,
              sentByName: true,
              sentAt: true,
            },
          },
        },
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
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        })
      ),
    ]);

  const justMap = new Map<string, any[]>();
  recentJustifications.forEach((j: any) => {
    const arr = justMap.get(j.studentId) || [];
    arr.push(j);
    justMap.set(j.studentId, arr);
  });

  const contactsMap = new Map<string, any[]>();
  allContacts.forEach((c: any) => {
    const arr = contactsMap.get(c.studentId) || [];
    arr.push(c);
    contactsMap.set(c.studentId, arr);
  });

  const initialStudents = rawStudents.map((s) => ({
    ...s,
    justifications: justMap.get(s.id) || [],
    contacts: contactsMap.get(s.id) || [],
  }));

  return (
    <BuscaAtivaClient
      classGroups={classGroups}
      templates={templates}
      initialStudents={initialStudents}
      initialSelectedStudentId={sp.studentId || ""}
      initialCustomPhone={sp.phone || ""}
      currentUser={{
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
      }}
    />
  );
}
