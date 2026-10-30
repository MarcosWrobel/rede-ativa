import { prisma } from "./prisma";

/**
 * Executa consultas das tabelas pedagógicas da Fase 3 com fallback resiliente
 * caso o ambiente local ainda não tenha aplicado `prisma db push` (que roda automaticamente na Vercel).
 */
export async function safeQueryList<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.code === "P2021" || String(err?.message || "").includes("does not exist")) {
      return [];
    }
    throw err;
  }
}

export async function loadStudent360Bundle(studentId: string) {
  const [student, contacts, justifications, attendances, snapshots, minutes] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      include: {
        classGroup: true,
        lowAttendanceRecord: true,
        messageLogs: {
          orderBy: { sentAt: "desc" },
        },
      },
    }),
    safeQueryList(() =>
      prisma.studentContact.findMany({
        where: { studentId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      })
    ),
    safeQueryList(() =>
      prisma.absenceJustification.findMany({
        where: { studentId },
        orderBy: { endDate: "desc" },
      })
    ),
    safeQueryList(() =>
      prisma.inPersonAttendance.findMany({
        where: { studentId },
        orderBy: { attendedAt: "desc" },
      })
    ),
    safeQueryList(() =>
      prisma.attendanceSnapshot.findMany({
        where: { studentId },
        orderBy: { recordedAt: "desc" },
        take: 24,
      })
    ),
    safeQueryList(() =>
      prisma.pedagogicalMinute.findMany({
        where: {
          students: { some: { studentId } },
        },
        include: {
          students: true,
          participants: true,
          addendums: { orderBy: { createdAt: "asc" } },
          actionItems: { orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ ataNumber: "desc" }, { attendedAt: "desc" }],
      })
    ),
  ]);

  if (!student) return null;

  return {
    student,
    contacts,
    justifications,
    attendances,
    snapshots,
    minutes,
  };
}
