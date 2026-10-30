import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const records = await prisma.lowAttendanceRecord.findMany({
      include: {
        student: {
          include: { classGroup: true },
        },
      },
      orderBy: { attendancePercent: "asc" },
    });
    return NextResponse.json(records);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { studentId, attendancePercent, enrollmentDetail, actionsTaken } = await req.json();
    if (!studentId) {
      return NextResponse.json({ error: "Aluno obrigatório" }, { status: 400 });
    }

    const record = await prisma.lowAttendanceRecord.upsert({
      where: { studentId },
      update: {
        attendancePercent: parseFloat(attendancePercent) || 0,
        enrollmentDetail,
        actionsTaken,
      },
      create: {
        studentId,
        attendancePercent: parseFloat(attendancePercent) || 0,
        enrollmentDetail,
        actionsTaken,
      },
      include: { student: { include: { classGroup: true } } },
    });

    await logAudit({
      action: "UPDATE_LOW_ATTENDANCE",
      entityType: "LowAttendanceRecord",
      entityId: record.id,
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
