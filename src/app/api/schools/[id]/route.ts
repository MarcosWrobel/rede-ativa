import { NextResponse } from "next/server";
import { requireSchoolAdmin, requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import { isProxyLogoPath, resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { resolveSchoolEdition } from "@/lib/platformEditions";
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

    // Busca o registro atual da escola para validações de integridade
    const currentSchoolRecord = await prisma.school.findUnique({
      where: { id },
      select: { inepCode: true, name: true },
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

    // Se estiver alterando o INEP, verifica se não colide com outra escola
    if (data.inepCode && data.inepCode !== currentSchoolRecord.inepCode) {
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

    let finalSettingsJson: string | undefined = undefined;
    if (data.settings !== undefined || data.settingsJson !== undefined || data.edition !== undefined) {
      let currentSettingsObj: Record<string, any> = {};
      try {
        const existingSchool = await prisma.school.findUnique({
          where: { id },
          select: { settingsJson: true },
        });
        if (existingSchool?.settingsJson) {
          currentSettingsObj = JSON.parse(existingSchool.settingsJson);
        }
      } catch {}

      if (data.settings !== undefined) {
        currentSettingsObj = { ...currentSettingsObj, ...(data.settings || {}) };
      } else if (data.settingsJson !== undefined && data.settingsJson) {
        try {
          currentSettingsObj = { ...currentSettingsObj, ...JSON.parse(data.settingsJson) };
        } catch {}
      }

      if (data.edition) {
        currentSettingsObj.edition = data.edition;
      }

      finalSettingsJson = JSON.stringify(currentSettingsObj);
    }

    const shouldUpdateLogoUrl = data.logoUrl !== undefined && !isProxyLogoPath(data.logoUrl);

    const updated = await prisma.school.update({
      where: { id },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.inepCode?.trim() ? { inepCode: data.inepCode.trim() } : {}),
        ...(data.city?.trim() ? { city: data.city.trim() } : {}),
        ...(data.state?.trim() ? { state: data.state.trim().toUpperCase() } : {}),
        ...(data.nre?.trim() ? { nre: data.nre.trim() } : {}),
        ...(data.network ? { network: data.network } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(shouldUpdateLogoUrl ? { logoUrl: data.logoUrl?.trim() || null } : {}),
        ...(finalSettingsJson !== undefined ? { settingsJson: finalSettingsJson } : {}),
      },
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

    invalidateSchoolCache(id);

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
        _count: {
          select: {
            students: true,
            classGroups: true,
            pedagogicalMinutes: true,
            userSchools: true,
          },
        },
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

    // Executa a exclusão de todas as dependências em batch transaction compatível com PgBouncer
    await prisma.$transaction([
      prisma.messageLog.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.lowAttendanceRecord.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.absenceJustification.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.inPersonAttendance.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.attendanceSnapshot.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.studentContact.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.pedagogicalMinuteStudent.deleteMany({
        where: {
          OR: [{ minute: { schoolId: id } }, { student: { schoolId: id } }],
        },
      }),
      prisma.pedagogicalMinuteParticipant.deleteMany({ where: { minute: { schoolId: id } } }),
      prisma.pedagogicalMinuteAddendum.deleteMany({ where: { minute: { schoolId: id } } }),
      prisma.pedagogicalActionItem.deleteMany({ where: { minute: { schoolId: id } } }),
      prisma.pedagogicalMinute.deleteMany({ where: { schoolId: id } }),
      prisma.student.deleteMany({ where: { schoolId: id } }),
      prisma.classGroup.deleteMany({ where: { schoolId: id } }),
      prisma.messageTemplate.deleteMany({ where: { schoolId: id } }),
      prisma.userSchool.deleteMany({ where: { schoolId: id } }),
      prisma.user.updateMany({
        where: { schoolId: id },
        data: { schoolId: null },
      }),
      prisma.school.delete({ where: { id } }),
    ]);

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
    return NextResponse.json(
      { error: "Erro ao excluir instituição escolar" },
      { status: 500 }
    );
  }
}
