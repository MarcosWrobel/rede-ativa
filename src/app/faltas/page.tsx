import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import FaltasClient from "./FaltasClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FaltasPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // 1. Optimized load of absence contacts
  const absenceKeywords = ["FALTOU", "FALTAS", "GAZEOU", "ATRASO", "ATRASOS"];

  const [absenceLogs, lowAttendance, classGroups] = await Promise.all([
    prisma.messageLog.findMany({
      where: {
        OR: absenceKeywords.map((kw) => ({
          reasonTitle: { contains: kw },
        })),
      },
      select: {
        studentId: true,
        sentAt: true,
        student: {
          select: {
            id: true,
            cgm: true,
            name: true,
            classGroupId: true,
            classGroup: {
              select: { id: true, name: true, segment: true, shift: true },
            },
          },
        },
      },
    }),
    prisma.lowAttendanceRecord.findMany({
      select: {
        id: true,
        attendancePercent: true,
        enrollmentDetail: true,
        actionsTaken: true,
        student: {
          select: {
            id: true,
            cgm: true,
            name: true,
            phone: true,
            guardianName: true,
            classGroupId: true,
            classGroup: {
              select: { id: true, name: true, segment: true, shift: true },
            },
          },
        },
      },
      orderBy: { attendancePercent: "asc" },
    }),
    prisma.classGroup.findMany({
      select: { id: true, name: true, segment: true, shift: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Aggregate counts per student in memory
  const studentCountMap: Record<string, { student: any; count: number; lastDate: Date }> = {};

  absenceLogs.forEach((log) => {
    const sId = log.studentId;
    if (!studentCountMap[sId]) {
      studentCountMap[sId] = {
        student: log.student,
        count: 0,
        lastDate: log.sentAt,
      };
    }
    studentCountMap[sId].count += 1;
    if (new Date(log.sentAt) > new Date(studentCountMap[sId].lastDate)) {
      studentCountMap[sId].lastDate = log.sentAt;
    }
  });

  const rankedAbsences = Object.values(studentCountMap).sort((a, b) => b.count - a.count);

  return (
    <FaltasClient
      rankedAbsences={rankedAbsences}
      lowAttendance={lowAttendance}
      classGroups={classGroups}
    />
  );
}
