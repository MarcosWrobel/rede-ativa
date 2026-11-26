import { NextResponse } from "next/server";
import { requireSchoolAdmin, requireSuperAdmin } from "@/lib/permissions";
import { checkIsSuperAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import { isProxyLogoPath, resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import { parseSchoolAiExternalFormalizeFlag } from "@/lib/aiPolicy";
import { mutateSchoolSettingsAtomically } from "@/lib/schoolSettingsMutation";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchoolSchema = z.object({
  name: z.string().min(3, "Nome da instituição deve ter no mínimo 3 caracteres").optional(),
  inepCode: z
    .string()
    .min(4, "Código INEP deve ter no mínimo 4 dígitos")
    .max(12, "Código INEP inválido")
    .regex(/^\d+$/, "Código INEP deve conter apenas números")
    .optional(),
  city: z.string().min(2, "Município é obrigatório").optional(),
  state: z.string().length(2, "UF deve ter 2 letras").optional(),
  nre: z.string().optional().nullable(),
  network: z.enum(["ESTADUAL", "MUNICIPAL", "PRIVADA"]).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email("E-mail institucional inválido").optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  edition: z.enum(["PILOTO_INTEGRADA", "INSTITUCIONAL_ESSENCIAL"]).optional(),
  aiExternalFormalizeEnabled: z.boolean().optional(),
  expectedUpdatedAt: z.string().optional().nullable(),
  settingsJson: z.string().optional().nullable(),
  settings: z.record(z.string(), z.any()).optional().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authCheck = await requireSchoolAdmin(id);
    if (!authCheck.ok) return authCheck.response;

    const school = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        inepCode: true,
        name: true,
        city: true,
        state: true,
        nre: true,
        network: true,
        phone: true,
        email: true,
        active: true,
        syncTokenHash: true,
        settingsJson: true,
        networkId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            students: { where: { active: true } },
            classGroups: true,
            pedagogicalMinutes: true,
            userSchools: { where: { active: true } },
          },
        },
        userSchools: {
          where: { active: true },
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true, active: true },
            },
          },
          orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
        },
      },
    });

    if (!school) {
      return NextResponse.json({ error: "Instituição escolar não encontrada" }, { status: 404 });
    }

    const { syncTokenHash, ...safeSchool } = school;
    const aiPolicyFlag = parseSchoolAiExternalFormalizeFlag(school.settingsJson);

    return NextResponse.json({
      success: true,
      school: {
        ...safeSchool,
        logoUrl: resolveSchoolLogoProxyUrl({
          id: school.id,
          logoUrl: (school as { logoUrl?: string | null }).logoUrl,
          updatedAt: school.updatedAt,
        }),
        edition: resolveSchoolEdition(school),
        aiExternalFormalizeEnabled: aiPolicyFlag.verified && aiPolicyFlag.enabled,
        hasSyncToken: Boolean(syncTokenHash),
      },
    });
  } catch (error: any) {
    console.error("[GET /api/schools/[id]] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar instituição" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authCheck = await requireSchoolAdmin(id);
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = updateSchoolSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const data = parsed.data;

    // Busca o registro atual da escola para validações de integridade e auditoria
    const currentSchoolRecord = await prisma.school.findUnique({
      where: { id },
      select: {
        inepCode: true,
        name: true,
        network: true,
        networkId: true,
        settingsJson: true,
        updatedAt: true,
      },
    });

    if (!currentSchoolRecord) {
      return NextResponse.json({ error: "Instituição escolar não encontrada" }, { status: 404 });
    }

    // Proteção absoluta da escola sede fundadora contra alteração de INEP ou edição
    const isPilotSchool = currentSchoolRecord.inepCode === "41042730" || id === "default-leopoldina";
    if (isPilotSchool && data.inepCode && data.inepCode !== "41042730") {
      return NextResponse.json(
        { error: "O código INEP da Unidade Piloto Fundadora (41042730) é a escola sede e não pode ser alterado." },
        { status: 403 }
      );
    }
    if (isPilotSchool && data.edition && data.edition !== "PILOTO_INTEGRADA") {
      return NextResponse.json(
        { error: "A Unidade Piloto Fundadora (41042730) opera permanentemente na Edição Piloto Integrada." },
        { status: 403 }
      );
    }

    let parsedInputSettingsJson: Record<string, any> | null = null;
    if (typeof data.settingsJson === "string" && data.settingsJson.trim().length > 0) {
      try {
        const tmp = JSON.parse(data.settingsJson);
        if (!tmp || typeof tmp !== "object" || Array.isArray(tmp)) {
          return NextResponse.json({ error: "Campo settingsJson inválido." }, { status: 400 });
        }
        parsedInputSettingsJson = tmp;
      } catch {
        return NextResponse.json({ error: "Campo settingsJson inválido." }, { status: 400 });
      }
    }

    const attemptsAiPolicyMutation =
      data.aiExternalFormalizeEnabled !== undefined ||
      (data.settings !== null &&
        data.settings !== undefined &&
        typeof data.settings === "object" &&
        (Object.prototype.hasOwnProperty.call(data.settings, "aiExternalFormalizeEnabled") ||
          Object.prototype.hasOwnProperty.call(data.settings, "aiExternalFormalizePolicyVersion") ||
          Object.prototype.hasOwnProperty.call(data.settings, "aiExternalFormalizeTransitionedAt") ||
          Object.prototype.hasOwnProperty.call(
            data.settings,
            "aiExternalFormalizeTransitionOutcome"
          ))) ||
      (parsedInputSettingsJson !== null &&
        (Object.prototype.hasOwnProperty.call(
          parsedInputSettingsJson,
          "aiExternalFormalizeEnabled"
        ) ||
          Object.prototype.hasOwnProperty.call(
            parsedInputSettingsJson,
            "aiExternalFormalizePolicyVersion"
          ) ||
          Object.prototype.hasOwnProperty.call(
            parsedInputSettingsJson,
            "aiExternalFormalizeTransitionedAt"
          ) ||
          Object.prototype.hasOwnProperty.call(
            parsedInputSettingsJson,
            "aiExternalFormalizeTransitionOutcome"
          )));

    // Restrição de autoelevação de edição, IA externa e metadados estruturais exclusivamente ao SuperAdmin
    const isSuper = checkIsSuperAdmin(authCheck.session);
    const rawNetworkIdProvided =
      rawBody !== null &&
      typeof rawBody === "object" &&
      Object.prototype.hasOwnProperty.call(rawBody, "networkId");
    const hasRestrictedMetadata =
      data.edition !== undefined ||
      attemptsAiPolicyMutation ||
      data.settings !== undefined ||
      data.settingsJson !== undefined ||
      rawNetworkIdProvided ||
      (data.inepCode !== undefined && data.inepCode !== currentSchoolRecord.inepCode) ||
      (data.network !== undefined && data.network !== currentSchoolRecord.network);

    if (!isSuper && hasRestrictedMetadata) {
      return NextResponse.json(
        {
          error:
            "Apenas o SuperAdmin pode alterar edição, controle de IA externa, configurações avançadas, INEP ou rede da instituição.",
        },
        { status: 403 }
      );
    }

    if (isSuper && attemptsAiPolicyMutation) {
      return NextResponse.json(
        {
          error:
            "Ligar ou desligar a formalização externa de atas exige a ação explícita de política de IA da escola (/api/schools/[id]/ai-policy).",
        },
        { status: 400 }
      );
    }

    // Se estiver alterando o INEP (somente SuperAdmin), verifica se não colide com outra escola
    if (isSuper && data.inepCode && data.inepCode !== currentSchoolRecord.inepCode) {
      const collision = await prisma.school.findFirst({
        where: {
          inepCode: data.inepCode,
          id: { not: id },
        },
        select: { name: true },
      });
      if (collision) {
        return NextResponse.json(
          { error: `O código INEP ${data.inepCode} já está em uso por ${collision.name}.` },
          { status: 409 }
        );
      }
    }

    const shouldUpdateLogoUrl = data.logoUrl !== undefined && !isProxyLogoPath(data.logoUrl);
    const scalarUpdateData: Record<string, any> = {
      ...(data.name?.trim() ? { name: data.name.trim() } : {}),
      ...(isSuper && data.inepCode?.trim() ? { inepCode: data.inepCode.trim() } : {}),
      ...(data.city?.trim() ? { city: data.city.trim() } : {}),
      ...(data.state?.trim() ? { state: data.state.trim().toUpperCase() } : {}),
      ...(data.nre?.trim() ? { nre: data.nre.trim() } : {}),
      ...(isSuper && data.network ? { network: data.network } : {}),
      ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
      ...(shouldUpdateLogoUrl ? { logoUrl: data.logoUrl?.trim() || null } : {}),
    };

    const previousAiExternalFormalizeEnabled = parseSchoolAiExternalFormalizeFlag(
      currentSchoolRecord.settingsJson
    ).enabled;

    const touchesSettings =
      isSuper &&
      (data.settings !== undefined ||
        data.settingsJson !== undefined ||
        data.edition !== undefined);
    const hasExpectedVersion =
      data.expectedUpdatedAt !== undefined &&
      data.expectedUpdatedAt !== null &&
      String(data.expectedUpdatedAt).trim() !== "";

    let updated: any;

    if (touchesSettings || hasExpectedVersion) {
      const atomicRes = await mutateSchoolSettingsAtomically({
        schoolId: id,
        expectedUpdatedAt: data.expectedUpdatedAt ?? null,
        buildPatch: (currentSettings) => {
          let nextSettings: Record<string, unknown> = { ...currentSettings };
          if (isSuper) {
            if (data.settings !== undefined && data.settings) {
              nextSettings = { ...nextSettings, ...data.settings };
            } else if (parsedInputSettingsJson !== null) {
              nextSettings = { ...nextSettings, ...parsedInputSettingsJson };
            }
            if (data.edition) {
              nextSettings.edition = data.edition;
            }
          }

          // Preserva chaves de segurança/controle independentes da gravação geral
          const protectedKeys = [
            "syncTokenEncrypted",
            "aiExternalFormalizeEnabled",
            "aiExternalFormalizePolicyVersion",
            "aiExternalFormalizeTransitionedAt",
            "aiExternalFormalizeTransitionOutcome",
            "aiExternalFormalizeUpdatedAt",
            "aiExternalFormalizeUpdatedBy",
          ] as const;
          for (const key of protectedKeys) {
            if (Object.prototype.hasOwnProperty.call(currentSettings, key)) {
              nextSettings[key] = currentSettings[key];
            } else {
              delete nextSettings[key];
            }
          }

          return {
            ok: true,
            nextSettings,
            extraData: scalarUpdateData,
          };
        },
      });

      if (!atomicRes.ok) {
        return NextResponse.json(
          { error: atomicRes.error, code: atomicRes.reason },
          { status: atomicRes.status }
        );
      }

      updated = atomicRes.updatedRow;
    } else {
      updated = await prisma.school.update({
        where: { id },
        data: scalarUpdateData,
        select: {
          id: true,
          inepCode: true,
          name: true,
          city: true,
          state: true,
          nre: true,
          network: true,
          phone: true,
          email: true,
          active: true,
          syncTokenHash: true,
          settingsJson: true,
          networkId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    invalidateSchoolCache(id);

    const nextAiFlag = parseSchoolAiExternalFormalizeFlag(
      updated.settingsJson ?? currentSchoolRecord.settingsJson
    );
    const nextAiExternalFormalizeEnabled = nextAiFlag.verified && nextAiFlag.enabled;

    await logAudit({
      action: "UPDATE_SCHOOL",
      entityType: "School",
      entityId: id,
      schoolId: id,
      details: {
        name: updated.name,
        inepCode: updated.inepCode,
        network: updated.network,
        city: updated.city,
        previousAiExternalFormalizeEnabled,
        aiExternalFormalizeEnabled: nextAiExternalFormalizeEnabled,
        aiExternalFormalizeChanged:
          previousAiExternalFormalizeEnabled !== nextAiExternalFormalizeEnabled,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    const { syncTokenHash: updatedSyncTokenHash, ...safeUpdated } = updated;

    return NextResponse.json({
      success: true,
      school: {
        ...safeUpdated,
        logoUrl: resolveSchoolLogoProxyUrl({
          id: updated.id,
          logoUrl: (updated as { logoUrl?: string | null }).logoUrl,
          updatedAt: updated.updatedAt,
        }),
        aiExternalFormalizeEnabled: nextAiExternalFormalizeEnabled,
        hasSyncToken: Boolean(updatedSyncTokenHash),
      },
    });
  } catch (error: any) {
    console.error("[PUT /api/schools/[id]] Erro:", error);
    return NextResponse.json({ error: "Erro ao atualizar instituição" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const target = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        inepCode: true,
        name: true,
        network: true,
        city: true,
      },
    });

    if (!target) {
      return NextResponse.json({ error: "Instituição escolar não encontrada" }, { status: 404 });
    }

    // Proteção absoluta da escola sede fundadora
    const isPilotSchool = target.inepCode === "41042730" || target.id === "default-leopoldina";
    if (isPilotSchool) {
      return NextResponse.json(
        { error: "A Unidade Piloto Fundadora (INEP 41042730) é a escola sede da plataforma e não pode ser excluída." },
        { status: 403 }
      );
    }

    const { deletedStudentsCount, deletedClassesCount } = await withTenantContext(
      prisma,
      target.id,
      async (tx) => {
        const studentsCount =
          typeof (tx.student as any)?.count === "function"
            ? await tx.student.count({ where: { schoolId: target.id } })
            : 0;
        const classGroupsCount =
          typeof (tx.classGroup as any)?.count === "function"
            ? await tx.classGroup.count({ where: { schoolId: target.id } })
            : 0;

        if (typeof (tx.messageLog as any)?.findFirst === "function") {
          const divergentMessageLog = await tx.messageLog.findFirst({
            where: {
              OR: [
                {
                  student: { schoolId: target.id },
                  schoolId: { not: null },
                  NOT: { schoolId: target.id },
                },
                {
                  schoolId: target.id,
                  student: { NOT: { schoolId: target.id } },
                },
              ],
            },
            select: { id: true },
          });
          if (divergentMessageLog) {
            const conflictErr = new Error(
              "Exclusão bloqueada por integridade referencial: existem registros de mensageria com divergência de vínculo institucional."
            ) as Error & { code?: string };
            conflictErr.code = "SCHOOL_DELETE_INTEGRITY_CONFLICT";
            throw conflictErr;
          }

          const crossSchoolTemplateLog = await tx.messageLog.findFirst({
            where: {
              template: { schoolId: target.id },
              OR: [
                { schoolId: { not: null }, NOT: { schoolId: target.id } },
                { student: { NOT: { schoolId: target.id } } },
              ],
            },
            select: { id: true },
          });
          if (crossSchoolTemplateLog) {
            const conflictErr = new Error(
              "Exclusão bloqueada por integridade referencial: existem registros de mensageria de outra instituição referenciando modelos desta escola."
            ) as Error & { code?: string };
            conflictErr.code = "SCHOOL_DELETE_INTEGRITY_CONFLICT";
            throw conflictErr;
          }
        }

        if (typeof (tx.pedagogicalMinuteStudent as any)?.findFirst === "function") {
          const crossSchoolMinuteStudent = await tx.pedagogicalMinuteStudent.findFirst({
            where: {
              OR: [
                {
                  minute: { schoolId: target.id },
                  student: { NOT: { schoolId: target.id } },
                },
                {
                  student: { schoolId: target.id },
                  minute: { NOT: { schoolId: target.id } },
                },
              ],
            },
            select: { id: true },
          });
          if (crossSchoolMinuteStudent) {
            const conflictErr = new Error(
              "Exclusão bloqueada por integridade referencial: existem vínculos de atas pedagógicas com divergência de instituição."
            ) as Error & { code?: string };
            conflictErr.code = "SCHOOL_DELETE_INTEGRITY_CONFLICT";
            throw conflictErr;
          }
        }

        await tx.messageLog.deleteMany({
          where: {
            student: { schoolId: target.id },
            OR: [{ schoolId: null }, { schoolId: target.id }],
          },
        });
        await tx.lowAttendanceRecord.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.absenceJustification.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.inPersonAttendance.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.attendanceSnapshot.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.studentContact.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.pedagogicalMinuteStudent.deleteMany({
          where: {
            minute: { schoolId: target.id },
            student: { schoolId: target.id },
          },
        });
        await tx.pedagogicalMinuteParticipant.deleteMany({ where: { minute: { schoolId: target.id } } });
        await tx.pedagogicalMinuteAddendum.deleteMany({ where: { minute: { schoolId: target.id } } });
        await tx.pedagogicalActionItem.deleteMany({ where: { minute: { schoolId: target.id } } });
        await tx.pedagogicalMinute.deleteMany({ where: { schoolId: target.id } });
        if (typeof tx.studentCouncilSubjectEntry?.deleteMany === "function") {
          await tx.studentCouncilSubjectEntry.deleteMany({ where: { schoolId: target.id } });
        }
        if (typeof tx.studentCouncilCard?.deleteMany === "function") {
          await tx.studentCouncilCard.deleteMany({ where: { schoolId: target.id } });
        }
        if (typeof tx.classCouncilTrimester?.deleteMany === "function") {
          await tx.classCouncilTrimester.deleteMany({ where: { schoolId: target.id } });
        }
        if (typeof tx.classCouncilSubject?.deleteMany === "function") {
          await tx.classCouncilSubject.deleteMany({ where: { schoolId: target.id } });
        }
        if (typeof tx.classCouncilBoard?.deleteMany === "function") {
          await tx.classCouncilBoard.deleteMany({ where: { schoolId: target.id } });
        }
        await tx.student.deleteMany({ where: { schoolId: target.id } });
        await tx.classGroup.deleteMany({ where: { schoolId: target.id } });
        await tx.messageTemplate.deleteMany({ where: { schoolId: target.id } });
        await tx.userSchool.deleteMany({ where: { schoolId: target.id } });
        await tx.user.updateMany({
          where: { schoolId: target.id },
          data: { schoolId: null },
        });
        await tx.school.delete({ where: { id: target.id } });

        return {
          deletedStudentsCount: studentsCount,
          deletedClassesCount: classGroupsCount,
        };
      }
    );

    await logAudit({
      action: "DELETE_SCHOOL",
      entityType: "School",
      entityId: id,
      schoolId: id,
      details: {
        deletedSchoolName: target.name,
        inepCode: target.inepCode,
        network: target.network,
        city: target.city,
        deletedStudentsCount,
        deletedClassesCount,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    invalidateSchoolCache(id);

    return NextResponse.json({
      success: true,
      message: `Instituição escolar "${target.name}" excluída com sucesso juntamente com todos os seus registros associados.`,
    });
  } catch (error: any) {
    console.error("[DELETE /api/schools/[id]] Erro:", error);

    if (error?.code === "SCHOOL_DELETE_INTEGRITY_CONFLICT") {
      return NextResponse.json(
        {
          error: error.message,
          code: "SCHOOL_DELETE_INTEGRITY_CONFLICT",
        },
        { status: 409 }
      );
    }

    const constraintText = [
      error?.meta?.constraint,
      error?.meta?.field_name,
      error?.message,
    ]
      .filter((v): v is string => typeof v === "string")
      .join(" ");

    const isMessageLogSchoolFk = constraintText.includes("MessageLog_schoolId_fkey");

    if (isMessageLogSchoolFk) {
      return NextResponse.json(
        {
          error:
            "Exclusão bloqueada por integridade referencial: existem registros de mensageria vinculados a esta instituição com divergência de vínculo estudantil.",
          code: "SCHOOL_DELETE_INTEGRITY_CONFLICT",
        },
        { status: 409 }
      );
    }

    if (error?.code === "P2003") {
      return NextResponse.json(
        {
          error:
            "Exclusão bloqueada por integridade referencial: existem registros vinculados a esta instituição que impedem a remoção.",
          code: "SCHOOL_DELETE_FK_CONFLICT",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Erro ao excluir instituição escolar" },
      { status: 500 }
    );
  }
}
