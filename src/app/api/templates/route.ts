import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth, checkIsSuperAdmin } from "@/lib/permissions";
import { resolveEffectiveRoleForSchool } from "@/lib/serverAuthContext";
import { formatZodError, templateCreateSchema, templateUpdateSchema } from "@/lib/schemas";
import { requireAuthorizedSchool, isDefaultSchoolContext } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(authCheck.session, authCheck.schoolId, authCheck.snapshot);
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;
    const { searchParams } = new URL(req.url);
    const segment = searchParams.get("segment");

    const where: any = {
      active: true,
      ...(isDefaultSchoolContext(currentSchool)
        ? { OR: [{ schoolId: currentSchool.id }, { schoolId: null }] }
        : { schoolId: currentSchool.id }),
    };
    if (segment && segment !== "TODOS") {
      where.AND = [{ OR: [{ segment }, { segment: "TODOS" }] }];
    }

    const templates = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      try {
        return await tx.messageTemplate.findMany({
          where,
          orderBy: { title: "asc" },
        });
      } catch (queryErr: any) {
        if (!isDefaultSchoolContext(currentSchool) || queryErr?.name !== "PrismaClientValidationError") {
          throw queryErr;
        }
        return segment && segment !== "TODOS"
          ? tx.$queryRaw`
              SELECT "id", "title", "segment", "prefixText", "suffixText", "isAbsenceRelated", "active", "schoolId", "createdAt"
              FROM "MessageTemplate"
              WHERE "active" = true
                AND ("schoolId" = ${currentSchool.id} OR "schoolId" IS NULL)
                AND ("segment" = ${segment} OR "segment" = 'TODOS')
              ORDER BY "title" ASC
            `
          : tx.$queryRaw`
              SELECT "id", "title", "segment", "prefixText", "suffixText", "isAbsenceRelated", "active", "schoolId", "createdAt"
              FROM "MessageTemplate"
              WHERE "active" = true
                AND ("schoolId" = ${currentSchool.id} OR "schoolId" IS NULL)
              ORDER BY "title" ASC
            `;
      }
    });

    return NextResponse.json(templates);
  } catch (error: any) {
    console.error("Erro ao listar modelos de mensagem:", error);
    return NextResponse.json({ error: "Erro ao listar modelos de mensagem." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot,
      { allowSuperAdminReadOnlyFallback: false }
    );
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;

    if (authCheck.snapshot) {
      const effectiveRole = resolveEffectiveRoleForSchool(authCheck.snapshot, currentSchool);
      if (!effectiveRole) {
        return NextResponse.json(
          { error: "Sem vínculo ativo autorizado para criar modelos nesta instituição." },
          { status: 403 }
        );
      }
    }

    const parsed = templateCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { title, segment, prefixText, suffixText, isAbsenceRelated } = parsed.data;

    const template = await withTenantContext(prisma, currentSchool.id, async (tx) =>
      tx.messageTemplate.create({
        data: {
          title: title.toUpperCase(),
          segment,
          prefixText,
          suffixText,
          isAbsenceRelated,
          schoolId: currentSchool.id,
        },
      })
    );

    await logAudit({
      action: "CREATE_TEMPLATE",
      entityType: "MessageTemplate",
      entityId: template.id,
      details: { title: template.title, segment: template.segment },
      schoolId: currentSchool.id,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(template);
  } catch (error: any) {
    console.error("Erro ao criar modelo de mensagem:", error);
    return NextResponse.json({ error: "Erro ao criar modelo de mensagem." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const parsed = templateUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { id, title, segment, prefixText, suffixText, isAbsenceRelated, active } = parsed.data;
    const schoolCheck = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot,
      { allowSuperAdminReadOnlyFallback: false }
    );
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;

    if (authCheck.snapshot) {
      const effectiveRole = resolveEffectiveRoleForSchool(authCheck.snapshot, currentSchool);
      if (!effectiveRole) {
        return NextResponse.json(
          { error: "Sem vínculo ativo autorizado para editar modelos nesta instituição." },
          { status: 403 }
        );
      }
    }

    const isSuper = checkIsSuperAdmin(authCheck.session);

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      // Consulta inicial estritamente limitada aos metadados de propriedade (sem conteúdo textual)
      const existingRows = await tx.$queryRaw<
        Array<{
          id: string;
          schoolId: string | null;
        }>
      >`
        SELECT "id", "schoolId"
        FROM "MessageTemplate"
        WHERE "id" = ${id}
        LIMIT 1
      `;
      const existing = existingRows[0] ?? null;

      if (!existing) {
        return { errorStatus: 404 as const, error: "Modelo de mensagem não encontrado" };
      }

      if (!existing.schoolId && !isSuper) {
        return {
          errorStatus: 403 as const,
          error: "Modelos padrão globais só podem ser editados pelo SuperAdmin.",
        };
      }

      if (existing.schoolId && existing.schoolId !== currentSchool.id) {
        return {
          errorStatus: 403 as const,
          error: "Acesso negado a modelo de outra instituição de ensino.",
        };
      }

      const updateData = {
        title: title ? title.toUpperCase() : undefined,
        segment,
        prefixText,
        suffixText,
        isAbsenceRelated,
        active,
      };

      if (existing.schoolId) {
        const updated = await tx.messageTemplate.updateMany({
          where: { id, schoolId: currentSchool.id },
          data: updateData,
        });

        if (updated.count === 0) {
          return {
            errorStatus: 403 as const,
            error: "Acesso negado a modelo de outra instituição de ensino.",
          };
        }

        const template = await tx.messageTemplate.findFirst({
          where: { id, schoolId: currentSchool.id },
        });
        if (!template) {
          return { errorStatus: 404 as const, error: "Modelo de mensagem não encontrado" };
        }

        return { template };
      }

      // Exceção explícita da Fase A: atualização parcial apenas dos campos enviados para modelo global legado (schoolId IS NULL)
      const setClauses: Prisma.Sql[] = [];
      if (updateData.title !== undefined) {
        setClauses.push(Prisma.sql`"title" = ${updateData.title}`);
      }
      if (updateData.segment !== undefined) {
        setClauses.push(Prisma.sql`"segment" = ${updateData.segment}`);
      }
      if (updateData.prefixText !== undefined) {
        setClauses.push(Prisma.sql`"prefixText" = ${updateData.prefixText}`);
      }
      if (updateData.suffixText !== undefined) {
        setClauses.push(Prisma.sql`"suffixText" = ${updateData.suffixText}`);
      }
      if (typeof updateData.isAbsenceRelated === "boolean") {
        setClauses.push(Prisma.sql`"isAbsenceRelated" = ${updateData.isAbsenceRelated}`);
      }
      if (typeof updateData.active === "boolean") {
        setClauses.push(Prisma.sql`"active" = ${updateData.active}`);
      }

      const globalRows =
        setClauses.length > 0
          ? await tx.$queryRaw<
              Array<{
                id: string;
                title: string;
                segment: string;
                prefixText: string;
                suffixText: string;
                isAbsenceRelated: boolean;
                active: boolean;
                schoolId: string | null;
                createdAt: Date;
              }>
            >(Prisma.sql`
              UPDATE "MessageTemplate"
              SET ${Prisma.join(setClauses, ", ")}
              WHERE "id" = ${id} AND "schoolId" IS NULL
              RETURNING "id", "title", "segment", "prefixText", "suffixText", "isAbsenceRelated", "active", "schoolId", "createdAt"
            `)
          : await tx.$queryRaw<
              Array<{
                id: string;
                title: string;
                segment: string;
                prefixText: string;
                suffixText: string;
                isAbsenceRelated: boolean;
                active: boolean;
                schoolId: string | null;
                createdAt: Date;
              }>
            >`
              SELECT "id", "title", "segment", "prefixText", "suffixText", "isAbsenceRelated", "active", "schoolId", "createdAt"
              FROM "MessageTemplate"
              WHERE "id" = ${id} AND "schoolId" IS NULL
              LIMIT 1
            `;

      const template = globalRows[0] ?? null;
      if (!template) {
        return {
          errorStatus: 403 as const,
          error: "Acesso negado a modelo de outra instituição de ensino.",
        };
      }

      return { template };
    });

    if ("error" in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.errorStatus });
    }

    const template = txResult.template;

    await logAudit({
      action: "UPDATE_TEMPLATE",
      entityType: "MessageTemplate",
      entityId: template.id,
      details: { title: template.title, segment: template.segment },
      schoolId: template.schoolId || currentSchool.id,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(template);
  } catch (error: any) {
    console.error("Erro ao atualizar modelo de mensagem:", error);
    return NextResponse.json({ error: "Erro ao atualizar modelo de mensagem." }, { status: 500 });
  }
}
