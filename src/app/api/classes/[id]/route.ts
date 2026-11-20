import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { formatZodError } from "@/lib/schemas";
import { canMutateSchoolCouncil } from "@/services/classCouncilService";

const updateClassShiftSchema = z.object({
  shift: z.enum(["MANHA", "TARDE", "NOITE", "INTEGRAL"]),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await context.params;
    const currentSchool = await getCurrentSchool(authCheck.schoolId);

    const existing = await prisma.classGroup.findUnique({
      where: { id },
      select: { id: true, schoolId: true, name: true, segment: true, shift: true },
    });

    if (!existing || !assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json({ error: "Turma não encontrada." }, { status: 404 });
    }

    if (!canMutateSchoolCouncil(authCheck.session, existing.schoolId)) {
      return NextResponse.json(
        { error: "Sem permissão para alterar o turno desta turma." },
        { status: 403 }
      );
    }

    const parsed = updateClassShiftSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const nextShift = parsed.data.shift;
    if (existing.shift === nextShift) {
      return NextResponse.json({
        success: true,
        classGroup: {
          id: existing.id,
          name: existing.name,
          segment: existing.segment,
          shift: existing.shift,
        },
      });
    }

    const updated = await prisma.classGroup.update({
      where: { id: existing.id },
      data: { shift: nextShift },
      select: { id: true, name: true, segment: true, shift: true },
    });

    await logAudit({
      action: "UPDATE_CLASS_GROUP_SHIFT",
      entityType: "ClassGroup",
      entityId: updated.id,
      schoolId: existing.schoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
      details: {
        previousShift: existing.shift,
        nextShift: updated.shift,
      },
    });

    return NextResponse.json({
      success: true,
      classGroup: updated,
    });
  } catch (error) {
    console.error("Erro ao atualizar turno da turma:", error);
    return NextResponse.json({ error: "Erro ao atualizar turno da turma." }, { status: 500 });
  }
}
