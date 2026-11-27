import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
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

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const { attendedAt, guardianPresent, subject, summary, agreements } = parsed.data;
    const parsedDate =
      attendedAt.length === 10
        ? new Date(`${attendedAt}T12:00:00.000-03:00`)
        : new Date(attendedAt);

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, schoolId: currentSchool.id },
      });
      if (!student) {
        return null;
      }

      const created = await tx.inPersonAttendance.create({
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
      return { student, created };
    });

    if (!txResult) {
      return NextResponse.json({ error: "Aluno não encontrado nesta unidade escolar." }, { status: 404 });
    }
    const { student, created } = txResult;

    await logAudit({
      action: "CREATE_IN_PERSON_ATTENDANCE",
      entityType: "InPersonAttendance",
      entityId: created.id,
      schoolId: currentSchool.id,
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
    console.error("Erro ao registrar ata presencial:", error);
    return NextResponse.json(
      { error: "Erro ao registrar ata presencial." },
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

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const { id: studentId } = await context.params;
    const { searchParams } = new URL(req.url);
    const attendanceId = searchParams.get("attendanceId");
    if (!attendanceId) {
      return NextResponse.json({ error: "attendanceId é obrigatório." }, { status: 400 });
    }

    const existing = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const found = await tx.inPersonAttendance.findFirst({
        where: { id: attendanceId, studentId, student: { schoolId: currentSchool.id } },
        include: { student: { select: { name: true, schoolId: true } } },
      });
      if (!found) return null;

      await tx.inPersonAttendance.delete({ where: { id: attendanceId } });
      return found;
    });

    if (!existing) {
      return NextResponse.json({ error: "Registro presencial não encontrado nesta unidade escolar." }, { status: 404 });
    }

    await logAudit({
      action: "DELETE_IN_PERSON_ATTENDANCE",
      entityType: "InPersonAttendance",
      entityId: attendanceId,
      schoolId: currentSchool.id,
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
    console.error("Erro ao remover ata presencial:", error);
    return NextResponse.json(
      { error: "Erro ao remover ata presencial." },
      { status: 500 }
    );
  }
}
