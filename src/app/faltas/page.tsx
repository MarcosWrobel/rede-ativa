import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import FaltasClient from "./FaltasClient";
import { redirect } from "next/navigation";

export default async function FaltasPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // 1. Load students with absence counts
  const absenceKeywords = ["FALTOU", "FALTAS", "GAZEOU", "ATRASO", "ATRASOS"];

  // Find all absence logs
  const absenceLogs = await prisma.messageLog.findMany({
    where: {
      OR: absenceKeywords.map((kw) => ({
        reasonTitle: { contains: kw },
      })),
    },
    include: {
      student: {
        include: { classGroup: true },
      },
    },
  });

  // Aggregate counts per student
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

  // 2. Load Low Attendance Records
  const lowAttendance = await prisma.lowAttendanceRecord.findMany({
    include: {
      student: {
        include: { classGroup: true },
      },
    },
    orderBy: { attendancePercent: "asc" },
  });

  // 3. Class groups for filter
  const classGroups = await prisma.classGroup.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <FaltasClient
      rankedAbsences={rankedAbsences}
      lowAttendance={lowAttendance}
      classGroups={classGroups}
    />
  );
}
