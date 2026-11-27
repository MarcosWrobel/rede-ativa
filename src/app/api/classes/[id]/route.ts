import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { formatZodError } from "@/lib/schemas";
import {
  normalizeClassGroupDisplayName,
  normalizeClassGroupKey,
} from "@/lib/classGroupName";
import {
  canMutateSchoolCouncil,
  readSafeJsonBody,
  resolveAuthorizedSchoolForCouncil,
  resolveCouncilHttpError,
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
        { error: "Sem permissão para alterar esta turma." },
        { status: 403 }
      );
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = updateClassSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const nextName =
      parsed.data.name !== undefined
        ? normalizeClassGroupDisplayName(parsed.data.name)
        : existing.name;
    if (nextName.length < 2) {
      return NextResponse.json(
        { error: "Nome da turma deve ter pelo menos 2 caracteres." },
        { status: 400 }
      );
    }

    const nextSegment = parsed.data.segment ?? existing.segment;
    const nextShift = parsed.data.shift ?? existing.shift;

    const nameChanged = nextName !== existing.name;
    const segmentChanged = nextSegment !== existing.segment;
    const shiftChanged = nextShift !== existing.shift;

    if (!nameChanged && !segmentChanged && !shiftChanged) {
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

    if (nameChanged && typeof prisma.classGroup.findMany === "function") {
      const canonicalKey = normalizeClassGroupKey(nextName);
      const schoolClasses = await prisma.classGroup.findMany({
        where: { schoolId: targetSchoolId },
        select: { id: true, name: true },
      });
      const duplicate = schoolClasses.find(
        (c) => c.id !== existing.id && normalizeClassGroupKey(c.name) === canonicalKey
      );
      if (duplicate) {
        return NextResponse.json(
          { error: `Já existe uma turma com o nome "${nextName}" nesta escola.` },
          { status: 409 }
        );
      }
    }

    const updateData: { name?: string; segment?: string; shift?: string } = {};
    if (nameChanged) updateData.name = nextName;
    if (segmentChanged) updateData.segment = nextSegment;
    if (shiftChanged) updateData.shift = nextShift;

    const updated = await prisma.classGroup.update({
      where: { id: existing.id },
      data: updateData,
      select: { id: true, name: true, segment: true, shift: true },
    });

    const onlyShiftChanged = shiftChanged && !nameChanged && !segmentChanged;
    await logAudit({
      action: onlyShiftChanged ? "UPDATE_CLASS_GROUP_SHIFT" : "UPDATE_CLASS_GROUP",
      entityType: "ClassGroup",
      entityId: updated.id,
      schoolId: targetSchoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
      details: onlyShiftChanged
        ? {
            previousShift: existing.shift,
            nextShift: updated.shift,
          }
        : {
            previousName: existing.name,
            nextName: updated.name,
            previousSegment: existing.segment,
            nextSegment: updated.segment,
            previousShift: existing.shift,
            nextShift: updated.shift,
          },
    });

    return NextResponse.json({
      success: true,
      classGroup: updated,
    });
  } catch (error) {
    console.error("Erro ao atualizar turma:", error);
    const { status } = resolveCouncilHttpError(error);
    return NextResponse.json(
      { error: status === 400 ? "Corpo da requisição JSON inválido." : "Erro ao atualizar turma." },
      { status }
    );
  }
}
