import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { formatZodError, inPersonAttendanceCreateSchema } from "@/lib/schemas";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id: studentId } = await context.params;
    const rawBody = await req.json();
    const parsed = inPersonAttendanceCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return NextResponse.json({ error: "Aluno não encontrado." }, { status: 404 });
    }

    const { attendedAt, guardianPresent, subject, summary, agreements } = parsed.data;
    const parsedDate =
      attendedAt.length === 10
        ? new Date(`${attendedAt}T12:00:00.000-03:00`)
        : new Date(attendedAt);

    const created = await prisma.inPersonAttendance.create({
      data: {
        studentId,
        attendedAt: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        guardianPresent,
        subject,
        summary,
        agreements: agreements || null,
        recordedByName: authCheck.userName,
        recordedByEmail: authCheck.email,
      },
    });

    await logAudit({
      action: "CREATE_IN_PERSON_ATTENDANCE",
      entityType: "InPersonAttendance",
      entityId: created.id,
      details: {
        studentId,
        studentName: student.name,
        guardianPresent: created.guardianPresent,
        subject: created.subject,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Erro ao registrar ata presencial." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id: studentId } = await context.params;
    const { searchParams } = new URL(req.url);
    const attendanceId = searchParams.get("attendanceId");
    if (!attendanceId) {
      return NextResponse.json({ error: "attendanceId é obrigatório." }, { status: 400 });
    }

    const existing = await prisma.inPersonAttendance.findFirst({
      where: { id: attendanceId, studentId },
      include: { student: { select: { name: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Registro presencial não encontrado." }, { status: 404 });
    }

    await prisma.inPersonAttendance.delete({ where: { id: attendanceId } });

    await logAudit({
      action: "DELETE_IN_PERSON_ATTENDANCE",
      entityType: "InPersonAttendance",
      entityId: attendanceId,
      details: {
        studentId,
        studentName: existing.student.name,
        subject: existing.subject,
        guardianPresent: existing.guardianPresent,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Erro ao remover ata presencial." },
      { status: 500 }
    );
  }
}
