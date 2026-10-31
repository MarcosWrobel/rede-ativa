import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { checkIsSchoolManager, checkIsAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import GestaoClient from "./GestaoClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Painel da Direção Escolar | Gestão & Unidade",
};

export default async function GestaoPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const sessionUser = session.user as any;
  const currentSchool = await getCurrentSchool(sessionUser?.schoolId);
  const schoolId = currentSchool.id;

  const isAuthorized =
    checkIsAdmin(session) || checkIsSchoolManager(session, schoolId);

  if (!isAuthorized) {
    redirect("/busca-ativa");
  }

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
    const [
      studentsCount,
      classesCount,
      lowRecords,
      msgCount,
      minutesCount,
      usersCount,
      classGroupsList,
    ] = await Promise.all([
      prisma.student.count({ where: { schoolId, active: true } }),
      prisma.classGroup.count({ where: { schoolId } }),
      prisma.lowAttendanceRecord.findMany({
        where: { student: { schoolId, active: true } },
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
      }),
      prisma.messageLog.count({
        where: { student: { schoolId }, sentAt: { gte: startOfMonth } },
      }),
      prisma.pedagogicalMinute.count({
        where: { schoolId, status: "FINALIZED" },
      }),
      prisma.userSchool.count({
        where: { schoolId, active: true },
      }),
      prisma.classGroup.findMany({
        where: { schoolId },
        select: {
          id: true,
          name: true,
          segment: true,
          shift: true,
          _count: { select: { students: { where: { active: true } } } },
        },
        orderBy: { name: "asc" },
      }),
    ]);

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
        role: sessionUser?.role || "GESTOR_ESCOLAR",
      }}
    />
  );
}
