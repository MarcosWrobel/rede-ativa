import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BuscaAtivaClient from "./BuscaAtivaClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BuscaAtivaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Optimized lightweight parallel fetch
  const [classGroups, templates, initialStudents] = await Promise.all([
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
        name: true,
        guardianName: true,
        phone: true,
        classGroupId: true,
        classGroup: {
          select: { id: true, name: true, segment: true, shift: true },
        },
        lowAttendanceRecord: {
          select: { attendancePercent: true, actionsTaken: true },
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
  ]);

  return (
    <BuscaAtivaClient
      classGroups={classGroups}
      templates={templates}
      initialStudents={initialStudents}
      currentUser={{
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
      }}
    />
  );
}
