import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
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

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const cleanPhone = parsed.data.phone.replace(/\D/g, "");
    const { name, kinship, isPrimary, whatsappValid, notes } = parsed.data;

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, schoolId: currentSchool.id },
      });
      if (!student) return null;

      if (isPrimary) {
        await tx.studentContact.updateMany({
          where: { studentId },
          data: { isPrimary: false },
        });
        await tx.student.updateMany({
          where: { id: studentId, schoolId: currentSchool.id },
          data: {
            phone: cleanPhone,
            guardianName: name,
          },
        });
      }

      const created = await tx.studentContact.create({
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
      return { student, created };
    });

    if (!txResult) {
      return NextResponse.json({ error: "Aluno não encontrado nesta unidade escolar." }, { status: 404 });
    }
    const { student, created } = txResult;

    await logAudit({
      action: "CREATE_STUDENT_CONTACT",
      entityType: "StudentContact",
      entityId: created.id,
      schoolId: currentSchool.id,
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
    console.error("Erro ao cadastrar contato:", error);
    return NextResponse.json(
      { error: "Erro ao cadastrar contato." },
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

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const { contactId, name, kinship, phone, isPrimary, whatsappValid, notes } = parsed.data;

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const existing = await tx.studentContact.findFirst({
        where: { id: contactId, studentId, student: { schoolId: currentSchool.id } },
        include: { student: { select: { name: true, schoolId: true } } },
      });

      if (!existing) return null;

      const cleanPhone = phone ? phone.replace(/\D/g, "") : existing.phone;
      const nextName = name !== undefined ? name : existing.name;

      if (isPrimary === true) {
        await tx.studentContact.updateMany({
          where: { studentId, id: { not: contactId } },
          data: { isPrimary: false },
        });
        await tx.student.updateMany({
          where: { id: studentId, schoolId: currentSchool.id },
          data: {
            phone: cleanPhone,
            guardianName: nextName,
          },
        });
      }

      const updated = await tx.studentContact.update({
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
      return { existing, updated };
    });

    if (!txResult) {
      return NextResponse.json({ error: "Contato não encontrado nesta unidade escolar." }, { status: 404 });
    }
    const { existing, updated } = txResult;

    await logAudit({
      action: "UPDATE_STUDENT_CONTACT",
      entityType: "StudentContact",
      entityId: updated.id,
      schoolId: currentSchool.id,
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
    console.error("Erro ao atualizar contato:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar contato." },
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
    const contactId = searchParams.get("contactId");
    if (!contactId) {
      return NextResponse.json({ error: "contactId é obrigatório." }, { status: 400 });
    }

    const existing = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const found = await tx.studentContact.findFirst({
        where: { id: contactId, studentId, student: { schoolId: currentSchool.id } },
        include: { student: { select: { name: true, schoolId: true } } },
      });
      if (!found) return null;

      await tx.studentContact.delete({ where: { id: contactId } });
      return found;
    });

    if (!existing) {
      return NextResponse.json({ error: "Contato não encontrado nesta unidade escolar." }, { status: 404 });
    }

    await logAudit({
      action: "DELETE_STUDENT_CONTACT",
      entityType: "StudentContact",
      entityId: contactId,
      schoolId: currentSchool.id,
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
    console.error("Erro ao remover contato:", error);
    return NextResponse.json(
      { error: "Erro ao remover contato." },
      { status: 500 }
    );
  }
}
