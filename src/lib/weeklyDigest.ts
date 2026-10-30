import { prisma } from "@/lib/prisma";
import { getCurrentSchool } from "@/lib/currentSchool";

export interface WeeklyDigestData {
  generatedAt: string;
  school: {
    name: string;
    nre: string;
    city: string;
    inepCode: string;
  };
  kpis: {
    totalStudents: number;
    criticalCount: number;
    criticalWithoutRecentContactCount: number;
    serpActiveCount: number;
    sentLast7Days: number;
    repliedLast7Days: number;
    replyRatePercent: number;
    abruptDropCount: number;
  };
  shiftBreakdown: Record<string, number>;
  topRiskClasses: Array<{
    className: string;
    shift: string;
    criticalCount: number;
  }>;
  abruptDrops: Array<{
    studentId: string;
    studentName: string;
    className: string;
    previousPercent: number | null;
    currentPercent: number | null;
    drop: number;
  }>;
  actionQueue: Array<{
    id: string;
    cgm: string | null;
    name: string;
    phone: string;
    className: string;
    shift: string;
    attendancePercent: number;
    lastContactAt: string | null;
    daysWithoutContact: number | null;
    serpStatus: string | null;
    serpProtocol: string | null;
  }>;
}

export async function compileWeeklyDigest(): Promise<WeeklyDigestData> {
  const school = await getCurrentSchool();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 1. Alunos ativos e registros de baixa frequência
  const studentsWithLowAtt = await prisma.student.findMany({
    where: { active: true },
    include: {
      classGroup: true,
      lowAttendanceRecord: true,
      messageLogs: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { sentAt: true, guardianReplied: true, deliveryStatus: true },
      },
    },
  });

  const totalStudents = studentsWithLowAtt.length;
  let criticalCount = 0;
  let serpActiveCount = 0;
  const criticalWithoutRecentContact: WeeklyDigestData["actionQueue"] = [];

  const shiftCounts: Record<string, number> = {
    MANHA: 0,
    TARDE: 0,
    NOITE: 0,
  };

  const classCriticalCounts: Record<string, { count: number; shift: string }> = {};

  for (const st of studentsWithLowAtt) {
    const att = st.lowAttendanceRecord;
    const percent = att?.attendancePercent ?? 100;

    if (att?.serpStatus && att.serpStatus !== "ARQUIVADO") {
      serpActiveCount++;
    }

    if (percent < 75) {
      criticalCount++;

      const shift = st.classGroup?.shift || "MANHA";
      shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;

      const className = st.classGroup?.name || "Sem Turma";
      if (!classCriticalCounts[className]) {
        classCriticalCounts[className] = { count: 0, shift };
      }
      classCriticalCounts[className].count++;

      // Checar último contato
      const lastLog = st.messageLogs[0];
      let daysWithout: number | null = null;
      let isOverdue = false;

      if (!lastLog) {
        isOverdue = true;
        daysWithout = 999;
      } else {
        const diffMs = now.getTime() - new Date(lastLog.sentAt).getTime();
        daysWithout = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (daysWithout >= 7) {
          isOverdue = true;
        }
      }

      if (isOverdue) {
        criticalWithoutRecentContact.push({
          id: st.id,
          cgm: st.cgm,
          name: st.name,
          phone: st.phone,
          className,
          shift,
          attendancePercent: Number(percent.toFixed(1)),
          lastContactAt: lastLog ? lastLog.sentAt.toISOString() : null,
          daysWithoutContact: daysWithout === 999 ? null : daysWithout,
          serpStatus: att?.serpStatus || null,
          serpProtocol: att?.serpProtocol || null,
        });
      }
    }
  }

  // Ordenar alunos críticos: primeiro os que nunca tiveram contato ou têm mais dias sem contato, e menor frequência
  criticalWithoutRecentContact.sort((a, b) => {
    const daysA = a.daysWithoutContact ?? 999;
    const daysB = b.daysWithoutContact ?? 999;
    if (daysB !== daysA) return daysB - daysA;
    return a.attendancePercent - b.attendancePercent;
  });

  // 2. Disparos e respostas nos últimos 7 dias
  const logsLast7Days = await prisma.messageLog.findMany({
    where: {
      sentAt: { gte: sevenDaysAgo },
    },
    select: {
      id: true,
      guardianReplied: true,
      deliveryStatus: true,
      sentAt: true,
    },
  });

  const sentLast7Days = logsLast7Days.length;
  const repliedLast7Days = logsLast7Days.filter((l) => l.guardianReplied).length;
  const replyRatePercent =
    sentLast7Days > 0 ? Number(((repliedLast7Days / sentLast7Days) * 100).toFixed(1)) : 0;

  // 3. Top Turmas com maior risco
  const topRiskClasses = Object.entries(classCriticalCounts)
    .map(([className, data]) => ({
      className,
      shift: data.shift,
      criticalCount: data.count,
    }))
    .sort((a, b) => b.criticalCount - a.criticalCount)
    .slice(0, 6);

  // 4. Quedas abruptas recentes a partir de snapshots
  const recentSnapshots = await prisma.attendanceSnapshot.findMany({
    where: {
      recordedAt: { gte: sevenDaysAgo },
      weeklyPercent: { not: null },
      previousWeeklyPercent: { not: null },
    },
    include: {
      student: {
        include: { classGroup: true },
      },
    },
    orderBy: { recordedAt: "desc" },
    take: 20,
  });

  const abruptDrops = recentSnapshots
    .filter((s) => (s.previousWeeklyPercent || 0) - (s.weeklyPercent || 0) >= 15)
    .map((s) => ({
      studentId: s.studentId,
      studentName: s.student.name,
      className: s.student.classGroup.name,
      previousPercent: s.previousWeeklyPercent,
      currentPercent: s.weeklyPercent,
      drop: Number(((s.previousWeeklyPercent || 0) - (s.weeklyPercent || 0)).toFixed(1)),
    }));

  return {
    generatedAt: now.toISOString(),
    school: {
      name: school.name,
      nre: school.nre,
      city: school.city,
      inepCode: school.inepCode,
    },
    kpis: {
      totalStudents,
      criticalCount,
      criticalWithoutRecentContactCount: criticalWithoutRecentContact.length,
      serpActiveCount,
      sentLast7Days,
      repliedLast7Days,
      replyRatePercent,
      abruptDropCount: abruptDrops.length,
    },
    shiftBreakdown: shiftCounts,
    topRiskClasses,
    abruptDrops,
    actionQueue: criticalWithoutRecentContact.slice(0, 30),
  };
}
