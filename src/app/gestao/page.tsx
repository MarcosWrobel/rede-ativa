import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
import GestaoClient from "./GestaoClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Painel da Direção Escolar | Gestão & Unidade",
};

export default async function GestaoPage() {
  const ctx = await resolveAuthorizedPageContext({ requireManager: true });
  const session = ctx.session;
  const currentSchool = ctx.school;
  const schoolId = currentSchool.id;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  let totalStudents = 0;
  let totalClasses = 0;
  let lowAttendanceCount = 0;
  let messagesThisMonth = 0;
  let totalMinutes = 0;
  let staffCount = 0;
  let averageAttendancePercent = 100;
  let classesSummary: any[] = [];
  let criticalStudents: any[] = [];

  try {
    const {
      studentsCount,
      classesCount,
      lowRecords,
      msgCount,
      minutesCount,
      usersCount,
      classGroupsList,
    } = await withTenantContext(prisma, schoolId, async (tx) => {
      const sCount = await tx.student.count({
        where: { schoolId, active: true, classGroup: { schoolId } },
      });
      const cCount = await tx.classGroup.count({ where: { schoolId } });
      const lRecords = await tx.lowAttendanceRecord.findMany({
        where: { student: { schoolId, active: true, classGroup: { schoolId } } },
        select: {
          attendancePercent: true,
          student: {
            select: {
              id: true,
              name: true,
              phone: true,
              classGroup: { select: { name: true } },
            },
          },
        },
        orderBy: { attendancePercent: "asc" },
        take: 50,
      });
      const mCount = await tx.messageLog.count({
        where: {
          OR: [{ schoolId: null }, { schoolId }],
          student: { schoolId, classGroup: { schoolId } },
          sentAt: { gte: startOfMonth },
        },
      });
      const minCount = await tx.pedagogicalMinute.count({
        where: { schoolId, status: "FINALIZED" },
      });
      const uCount = await tx.userSchool.count({
        where: { schoolId, active: true },
      });
      const cgList = await tx.classGroup.findMany({
        where: { schoolId },
        select: {
          id: true,
          name: true,
          segment: true,
          shift: true,
          _count: { select: { students: { where: { active: true, schoolId } } } },
        },
        orderBy: { name: "asc" },
      });
      return {
        studentsCount: sCount,
        classesCount: cCount,
        lowRecords: lRecords,
        msgCount: mCount,
        minutesCount: minCount,
        usersCount: uCount,
        classGroupsList: cgList,
      };
    });

    totalStudents = studentsCount;
    totalClasses = classesCount;
    lowAttendanceCount = lowRecords.filter((r) => r.attendancePercent < 75).length;
    messagesThisMonth = msgCount;
    totalMinutes = minutesCount;
    staffCount = usersCount;

    if (lowRecords.length > 0) {
      const sum = lowRecords.reduce((acc, r) => acc + r.attendancePercent, 0);
      averageAttendancePercent = Math.round((sum / lowRecords.length) * 10) / 10;
    } else {
      averageAttendancePercent = 100;
    }

    criticalStudents = lowRecords.slice(0, 5).map((r) => ({
      id: r.student?.id || "",
      name: r.student?.name || "Estudante",
      className: r.student?.classGroup?.name || "Sem Turma",
      attendancePercent: r.attendancePercent,
      phone: r.student?.phone || null,
    }));

    classesSummary = classGroupsList.map((cg) => ({
      id: cg.id,
      name: cg.name,
      segment: cg.segment,
      shift: cg.shift,
      studentsCount: cg._count.students,
    }));
  } catch (err) {
    console.error("[GestaoPage] Erro ao carregar métricas da escola:", err);
  }

  return (
    <GestaoClient
      school={currentSchool}
      metrics={{
        totalStudents,
        totalClasses,
        lowAttendanceCount,
        messagesThisMonth,
        totalMinutes,
        staffCount,
        averageAttendancePercent,
      }}
      classesSummary={classesSummary}
      criticalStudents={criticalStudents}
      currentUser={{
        name: session.user.name || "Gestor Escolar",
        email: session.user.email || "",
        role: ctx.effectiveRole || "GESTOR_ESCOLAR",
      }}
    />
  );
}
