import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { parseAttendancePercent } from "@/lib/studentMatcher";

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);

    const records = await prisma.lowAttendanceRecord.findMany({
      where: {
        student: { schoolId: currentSchool.id },
      },
      include: {
        student: {
          include: { classGroup: true },
        },
      },
      orderBy: { attendancePercent: "asc" },
    });
    return NextResponse.json(records);
  } catch (error: any) {
    console.error("Erro ao consultar registros de infrequência:", error);
    return NextResponse.json({ error: "Erro ao consultar registros de infrequência." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const { studentId, attendancePercent, enrollmentDetail, actionsTaken } = await req.json();
    if (!studentId) {
      return NextResponse.json({ error: "Aluno obrigatório" }, { status: 400 });
    }

    const targetStudent = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, schoolId: true },
    });
    if (!targetStudent || !assertTenantOwnership(targetStudent.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json({ error: "Estudante não encontrado na instituição atual." }, { status: 404 });
    }

    const clampedPercent = parseAttendancePercent(attendancePercent) ?? 0;

    const record = await prisma.lowAttendanceRecord.upsert({
      where: { studentId },
      update: {
        attendancePercent: clampedPercent,
        enrollmentDetail,
        actionsTaken,
      },
      create: {
        studentId,
        attendancePercent: clampedPercent,
        enrollmentDetail,
        actionsTaken,
      },
      include: { student: { include: { classGroup: true } } },
    });

    await logAudit({
      action: "UPDATE_LOW_ATTENDANCE",
      entityType: "LowAttendanceRecord",
      entityId: record.id,
      schoolId: currentSchool.id,
      details: {
        studentName: record.student.name,
        attendancePercent: record.attendancePercent,
        actionsTaken: record.actionsTaken,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(record);
  } catch (error: any) {
    console.error("Erro ao registrar infrequência:", error);
    return NextResponse.json({ error: "Erro ao registrar infrequência." }, { status: 500 });
  }
}
