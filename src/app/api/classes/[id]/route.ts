import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { withTenantContext } from "@/lib/rlsTenantContext";
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

    const rawBody = await readSafeJsonBody(req);
    const parsed = updateClassShiftSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const nextShift = parsed.data.shift;

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const existing = await tx.classGroup.findUnique({
        where: { id },
        select: { id: true, schoolId: true, name: true, segment: true, shift: true },
      });

      if (!existing || !assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)) {
        return { errorStatus: 404 as const, error: "Turma não encontrada." };
      }

      const targetSchoolId = existing.schoolId || currentSchool.id;
      if (!canMutateSchoolCouncil(authCheck.session, targetSchoolId)) {
        return {
          errorStatus: 403 as const,
          error: "Sem permissão para alterar o turno desta turma.",
        };
      }

      if (existing.shift === nextShift) {
        return {
          unchanged: true as const,
          targetSchoolId,
          existing,
          classGroup: {
            id: existing.id,
            name: existing.name,
            segment: existing.segment,
            shift: existing.shift,
          },
        };
      }

      const updatedCount = await tx.classGroup.updateMany({
        where: { id: existing.id, schoolId: targetSchoolId },
        data: { shift: nextShift },
      });
      if (updatedCount.count === 0) {
        return { errorStatus: 404 as const, error: "Turma não encontrada." };
      }

      const updated = await tx.classGroup.findFirst({
        where: { id: existing.id, schoolId: targetSchoolId },
        select: { id: true, name: true, segment: true, shift: true },
      });
      if (!updated) {
        return { errorStatus: 404 as const, error: "Turma não encontrada." };
      }

      return {
        unchanged: false as const,
        targetSchoolId,
        existing,
        classGroup: updated,
      };
    });

    if ("error" in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.errorStatus });
    }

    if (txResult.unchanged) {
      return NextResponse.json({
        success: true,
        classGroup: txResult.classGroup,
      });
    }

    const updated = txResult.classGroup;

    await logAudit({
      action: "UPDATE_CLASS_GROUP_SHIFT",
      entityType: "ClassGroup",
      entityId: updated.id,
      schoolId: txResult.targetSchoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
      details: {
        previousShift: txResult.existing.shift,
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
