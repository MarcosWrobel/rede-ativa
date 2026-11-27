import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { logAudit } from "@/lib/audit";
import { formatZodError, justificationCreateSchema } from "@/lib/schemas";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id: studentId } = await context.params;
    const rawBody = await req.json();
    const parsed = justificationCreateSchema.safeParse(rawBody);
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
    const { type, startDate, endDate, cidCode, notes } = parsed.data;

    // Salva em horário civil de Brasília (-03:00) para evitar deslocamento de dia
    const startDt = new Date(`${startDate}T00:00:00.000-03:00`);
    const endDt = new Date(`${endDate}T23:59:59.999-03:00`);

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, schoolId: currentSchool.id },
      });
      if (!student) return null;

      const created = await tx.absenceJustification.create({
        data: {
          studentId,
          type,
          startDate: startDt,
          endDate: endDt,
          cidCode: cidCode || null,
          notes: notes || null,
          createdByName: authCheck.userName,
          createdByEmail: authCheck.email,
        },
      });
      return { student, created };
    });

    if (!txResult) {
      return NextResponse.json({ error: "Aluno não encontrado nesta unidade escolar." }, { status: 404 });
    }
    const { student, created } = txResult;

    await logAudit({
      action: "CREATE_JUSTIFICATION",
      entityType: "AbsenceJustification",
      entityId: created.id,
      schoolId: currentSchool.id,
      details: {
        studentId,
        studentName: student.name,
        type: created.type,
        startDate,
        endDate,
        notes: created.notes,
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
    console.error("Erro ao registrar atestado/justificativa:", error);
    return NextResponse.json(
      { error: "Erro ao registrar atestado/justificativa." },
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
    const justificationId = searchParams.get("justificationId");
    if (!justificationId) {
      return NextResponse.json({ error: "justificationId é obrigatório." }, { status: 400 });
    }

    const existing = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const found = await tx.absenceJustification.findFirst({
        where: { id: justificationId, studentId, student: { schoolId: currentSchool.id } },
        include: { student: { select: { name: true, schoolId: true } } },
      });
      if (!found) return null;

      await tx.absenceJustification.delete({ where: { id: justificationId } });
      return found;
    });

    if (!existing) {
      return NextResponse.json({ error: "Atestado não encontrado nesta unidade escolar." }, { status: 404 });
    }

    await logAudit({
      action: "DELETE_JUSTIFICATION",
      entityType: "AbsenceJustification",
      entityId: justificationId,
      schoolId: currentSchool.id,
      details: {
        studentId,
        studentName: existing.student.name,
        type: existing.type,
        startDate: existing.startDate,
        endDate: existing.endDate,
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
    console.error("Erro ao excluir atestado:", error);
    return NextResponse.json(
      { error: "Erro ao excluir atestado." },
      { status: 500 }
    );
  }
}
