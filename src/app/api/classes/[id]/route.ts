import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  readSafeJsonBody,
  resolveAuthorizedSchoolForCouncil,
  resolveCouncilHttpError,
} from "@/services/classCouncilService";

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
    const currentSchool = await resolveAuthorizedSchoolForCouncil(
      authCheck.session,
      authCheck.schoolId
    );
    if (!currentSchool) {
      return NextResponse.json(
        { error: "Nenhuma instituição escolar autorizada vinculada à sessão atual." },
        { status: 403 }
      );
    }

    const existing = await prisma.classGroup.findUnique({
      where: { id },
      select: { id: true, schoolId: true, name: true, segment: true, shift: true },
    });

    if (!existing || !assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json({ error: "Turma não encontrada." }, { status: 404 });
    }

    const targetSchoolId = existing.schoolId || currentSchool.id;
    if (!canMutateSchoolCouncil(authCheck.session, targetSchoolId)) {
      return NextResponse.json(
        { error: "Sem permissão para alterar o turno desta turma." },
        { status: 403 }
      );
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = updateClassShiftSchema.safeParse(rawBody);
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
      schoolId: targetSchoolId,
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
    const { status } = resolveCouncilHttpError(error);
    return NextResponse.json(
      { error: status === 400 ? "Corpo da requisição JSON inválido." : "Erro ao atualizar turno da turma." },
      { status }
    );
  }
}
