import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
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

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return NextResponse.json({ error: "Aluno não encontrado." }, { status: 404 });
    }

    const { type, startDate, endDate, cidCode, notes } = parsed.data;

    // Salva em horário civil de Brasília (-03:00) para evitar deslocamento de dia
    const startDt = new Date(`${startDate}T00:00:00.000-03:00`);
    const endDt = new Date(`${endDate}T23:59:59.999-03:00`);

    const created = await prisma.absenceJustification.create({
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

    await logAudit({
      action: "CREATE_JUSTIFICATION",
      entityType: "AbsenceJustification",
      entityId: created.id,
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
    return NextResponse.json(
      { error: error.message || "Erro ao registrar atestado/justificativa." },
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
    const justificationId = searchParams.get("justificationId");
    if (!justificationId) {
      return NextResponse.json({ error: "justificationId é obrigatório." }, { status: 400 });
    }

    const existing = await prisma.absenceJustification.findFirst({
      where: { id: justificationId, studentId },
      include: { student: { select: { name: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Atestado não encontrado." }, { status: 404 });
    }

    await prisma.absenceJustification.delete({ where: { id: justificationId } });

    await logAudit({
      action: "DELETE_JUSTIFICATION",
      entityType: "AbsenceJustification",
      entityId: justificationId,
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
    return NextResponse.json(
      { error: error.message || "Erro ao excluir atestado." },
      { status: 500 }
    );
  }
}
