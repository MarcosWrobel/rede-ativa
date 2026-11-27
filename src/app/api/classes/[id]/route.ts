import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { formatZodError } from "@/lib/schemas";
import {
  acquireClassGroupSchoolLock,
  isPrismaUniqueConstraintError,
  normalizeClassGroupDisplayName,
  normalizeClassGroupKey,
} from "@/lib/classGroupName";
import {
  canMutateSchoolCouncil,
  readSafeJsonBody,
  resolveCouncilHttpError,
  resolveExplicitSelectedSchoolForCouncil,
} from "@/services/classCouncilService";

const updateClassSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Nome da turma deve ter pelo menos 2 caracteres")
      .max(80, "Nome da turma deve ter no máximo 80 caracteres")
      .optional(),
    segment: z
      .enum(["FUNDAMENTAL", "MEDIO", "NOTURNO", "INFANTIL", "EJA"])
      .optional(),
    shift: z.enum(["MANHA", "TARDE", "NOITE", "INTEGRAL"]).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.segment !== undefined ||
      data.shift !== undefined,
    { message: "Informe ao menos um campo para atualizar." }
  );

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await context.params;
    const currentSchool = await resolveExplicitSelectedSchoolForCouncil(
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
    const parsed = updateClassSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const normalizedInputName =
      parsed.data.name !== undefined
        ? normalizeClassGroupDisplayName(parsed.data.name)
        : undefined;
    if (normalizedInputName !== undefined && normalizedInputName.length < 2) {
      return NextResponse.json(
        { error: "Nome da turma deve ter pelo menos 2 caracteres." },
        { status: 400 }
      );
    }

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const existing = await tx.classGroup.findFirst({
        where: { id, schoolId: currentSchool.id },
        select: { id: true, schoolId: true, name: true, segment: true, shift: true },
      });

      if (
        !existing ||
        existing.schoolId !== currentSchool.id ||
        !assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)
      ) {
        return { errorStatus: 404 as const, error: "Turma não encontrada." };
      }

      const targetSchoolId = existing.schoolId;
      if (!canMutateSchoolCouncil(authCheck.session, targetSchoolId)) {
        return {
          errorStatus: 403 as const,
          error: "Sem permissão para alterar esta turma.",
        };
      }

      const nextName = normalizedInputName ?? existing.name;
      const nextSegment = parsed.data.segment ?? existing.segment;
      const nextShift = parsed.data.shift ?? existing.shift;

      const nameChanged = nextName !== existing.name;
      const segmentChanged = nextSegment !== existing.segment;
      const shiftChanged = nextShift !== existing.shift;

      if (!nameChanged && !segmentChanged && !shiftChanged) {
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

      if (nameChanged) {
        await acquireClassGroupSchoolLock(tx, targetSchoolId);

        if (typeof tx.classGroup?.findMany === "function") {
          const canonicalKey = normalizeClassGroupKey(nextName);
          const schoolClasses = await tx.classGroup.findMany({
            where: { schoolId: targetSchoolId },
            select: { id: true, name: true },
          });
          const duplicate = schoolClasses.find(
            (c) => c.id !== existing.id && normalizeClassGroupKey(c.name) === canonicalKey
          );
          if (duplicate) {
            return {
              errorStatus: 409 as const,
              error: `Já existe uma turma com o nome "${nextName}" nesta escola.`,
            };
          }
        }
      }

      const updateData: { name?: string; segment?: string; shift?: string } = {};
      if (nameChanged) updateData.name = nextName;
      if (segmentChanged) updateData.segment = nextSegment;
      if (shiftChanged) updateData.shift = nextShift;

      const updatedCount = await tx.classGroup.updateMany({
        where: { id: existing.id, schoolId: targetSchoolId },
        data: updateData,
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
        nameChanged,
        segmentChanged,
        shiftChanged,
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
    const onlyShiftChanged =
      txResult.shiftChanged && !txResult.nameChanged && !txResult.segmentChanged;

    await logAudit({
      action: onlyShiftChanged ? "UPDATE_CLASS_GROUP_SHIFT" : "UPDATE_CLASS_GROUP",
      entityType: "ClassGroup",
      entityId: updated.id,
      schoolId: txResult.targetSchoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
      details: onlyShiftChanged
        ? {
            previousShift: txResult.existing.shift,
            nextShift: updated.shift,
          }
        : {
            previousName: txResult.existing.name,
            nextName: updated.name,
            previousSegment: txResult.existing.segment,
            nextSegment: updated.segment,
            previousShift: txResult.existing.shift,
            nextShift: updated.shift,
          },
    });

    return NextResponse.json({
      success: true,
      classGroup: updated,
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "Já existe uma turma com este nome nesta escola." },
        { status: 409 }
      );
    }
    console.error("Erro ao atualizar turma:", error);
    const { status } = resolveCouncilHttpError(error);
    return NextResponse.json(
      { error: status === 400 ? "Corpo da requisição JSON inválido." : "Erro ao atualizar turma." },
      { status }
    );
  }
}
