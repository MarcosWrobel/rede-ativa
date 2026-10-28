import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export async function GET() {
  try {
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
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

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

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
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
        id: user?.id,
        name: user?.name || session.user.name || "Pedagoga",
        email: session.user.email,
      },
    });

    return NextResponse.json(record);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
