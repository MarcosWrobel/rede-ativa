import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import {
  formatZodError,
  studentContactCreateSchema,
  studentContactUpdateSchema,
} from "@/lib/schemas";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id: studentId } = await context.params;
    const rawBody = await req.json();
    const parsed = studentContactCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return NextResponse.json({ error: "Aluno não encontrado." }, { status: 404 });
    }

    const cleanPhone = parsed.data.phone.replace(/\D/g, "");
    const { name, kinship, isPrimary, whatsappValid, notes } = parsed.data;

    const created = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.studentContact.updateMany({
          where: { studentId },
          data: { isPrimary: false },
        });
        await tx.student.update({
          where: { id: studentId },
          data: {
            phone: cleanPhone,
            guardianName: name,
          },
        });
      }

      return tx.studentContact.create({
        data: {
          studentId,
          name,
          kinship,
          phone: cleanPhone,
          isPrimary,
          whatsappValid,
          notes: notes || null,
        },
      });
    });

    await logAudit({
      action: "CREATE_STUDENT_CONTACT",
      entityType: "StudentContact",
      entityId: created.id,
      details: {
        studentId,
        studentName: student.name,
        contactName: created.name,
        kinship: created.kinship,
        phone: created.phone,
        isPrimary: created.isPrimary,
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
      { error: error.message || "Erro ao cadastrar contato." },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id: studentId } = await context.params;
    const rawBody = await req.json();
    const parsed = studentContactUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { contactId, name, kinship, phone, isPrimary, whatsappValid, notes } = parsed.data;

    const existing = await prisma.studentContact.findFirst({
      where: { id: contactId, studentId },
      include: { student: { select: { name: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
    }

    const cleanPhone = phone ? phone.replace(/\D/g, "") : existing.phone;
    const nextName = name !== undefined ? name : existing.name;

    const updated = await prisma.$transaction(async (tx) => {
      if (isPrimary === true) {
        await tx.studentContact.updateMany({
          where: { studentId, id: { not: contactId } },
          data: { isPrimary: false },
        });
        await tx.student.update({
          where: { id: studentId },
          data: {
            phone: cleanPhone,
            guardianName: nextName,
          },
        });
      }

      return tx.studentContact.update({
        where: { id: contactId },
        data: {
          name: nextName,
          kinship: kinship !== undefined ? kinship : existing.kinship,
          phone: cleanPhone,
          isPrimary: isPrimary !== undefined ? isPrimary : existing.isPrimary,
          whatsappValid: whatsappValid !== undefined ? whatsappValid : existing.whatsappValid,
          notes: notes !== undefined ? notes || null : existing.notes,
        },
      });
    });

    await logAudit({
      action: "UPDATE_STUDENT_CONTACT",
      entityType: "StudentContact",
      entityId: updated.id,
      details: {
        studentId,
        studentName: existing.student.name,
        contactName: updated.name,
        phone: updated.phone,
        isPrimary: updated.isPrimary,
        whatsappValid: updated.whatsappValid,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Erro ao atualizar contato." },
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
    const contactId = searchParams.get("contactId");
    if (!contactId) {
      return NextResponse.json({ error: "contactId é obrigatório." }, { status: 400 });
    }

    const existing = await prisma.studentContact.findFirst({
      where: { id: contactId, studentId },
      include: { student: { select: { name: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
    }

    await prisma.studentContact.delete({ where: { id: contactId } });

    await logAudit({
      action: "DELETE_STUDENT_CONTACT",
      entityType: "StudentContact",
      entityId: contactId,
      details: {
        studentId,
        studentName: existing.student.name,
        removedContact: existing.name,
        phone: existing.phone,
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
      { error: error.message || "Erro ao remover contato." },
      { status: 500 }
    );
  }
}
