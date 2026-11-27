import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth, checkIsSuperAdmin } from "@/lib/permissions";
import { formatZodError, classGroupCreateSchema } from "@/lib/schemas";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  canMutateSchoolCouncil,
  resolveAuthorizedSchoolForCouncil,
  resolveExplicitSelectedSchoolForCouncil,
} from "@/services/classCouncilService";
import {
  acquireClassGroupSchoolLock,
  isPrismaUniqueConstraintError,
  normalizeClassGroupDisplayName,
  normalizeClassGroupKey,
} from "@/lib/classGroupName";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(authCheck.session, authCheck.schoolId, authCheck.snapshot);
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;

    const classes = await withTenantContext(prisma, currentSchool.id, async (tx) =>
      tx.classGroup.findMany({
        where: { schoolId: currentSchool.id },
        include: {
          _count: { select: { students: { where: { active: true, schoolId: currentSchool.id } } } },
        },
        orderBy: { name: "asc" },
      })
    );

    return NextResponse.json(
      classes.map((c) => ({
        id: c.id,
        name: c.name,
        segment: c.segment,
        shift: c.shift,
        studentsCount: c._count.students,
      }))
    );
  } catch (error: any) {
    console.error("Erro ao listar turmas:", error);
    return NextResponse.json({ error: "Erro ao listar turmas." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const explicitServerSchoolId = authCheck.snapshot
      ? authCheck.snapshot.schoolId
      : authCheck.schoolId;
    const currentSchool = checkIsSuperAdmin(authCheck.session)
      ? await resolveExplicitSelectedSchoolForCouncil(
          authCheck.session,
          explicitServerSchoolId,
          authCheck.snapshot
        )
      : await resolveAuthorizedSchoolForCouncil(
          authCheck.session,
          authCheck.schoolId
        );
    if (!currentSchool) {
      return NextResponse.json(
        { error: "Nenhuma instituição escolar autorizada selecionada na sessão atual." },
        { status: 403 }
      );
    }
    if (!canMutateSchoolCouncil(authCheck.session, currentSchool.id)) {
      return NextResponse.json(
        { error: "Sem permissão de escrita para cadastrar turmas nesta escola." },
        { status: 403 }
      );
    }
    const parsed = classGroupCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { segment, shift } = parsed.data;
    const cleanName = normalizeClassGroupDisplayName(parsed.data.name);
    const canonicalKey = normalizeClassGroupKey(cleanName);

    // Verificação de unicidade canônica dentro da mesma escola (multi-tenant)
    // Evita duplicidades por variação de °/º, acentos ou espaços
    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      await acquireClassGroupSchoolLock(tx, currentSchool.id);

      const schoolClasses =
        typeof tx.classGroup?.findMany === "function"
          ? await tx.classGroup.findMany({
              where: { schoolId: currentSchool.id },
              select: { id: true, name: true },
            })
          : [];
      const existing =
        schoolClasses.find((c) => normalizeClassGroupKey(c.name) === canonicalKey) ||
        (await tx.classGroup.findFirst({
          where: {
            schoolId: currentSchool.id,
            name: { equals: cleanName, mode: "insensitive" },
          },
        }));

      if (existing) {
        return { conflict: true as const };
      }

      const newClass = await tx.classGroup.create({
        data: {
          name: cleanName,
          segment,
          shift,
          schoolId: currentSchool.id,
        },
      });
      return { conflict: false as const, newClass };
    });

    if (txResult.conflict) {
      return NextResponse.json(
        { error: `Já existe uma turma com o nome "${cleanName}" nesta escola.` },
        { status: 409 }
      );
    }

    const newClass = txResult.newClass;

    await logAudit({
      action: "CREATE_CLASS_GROUP",
      entityType: "ClassGroup",
      entityId: newClass.id,
      schoolId: currentSchool.id,
      details: {
        name: newClass.name,
        segment: newClass.segment,
        shift: newClass.shift,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(
      {
        id: newClass.id,
        name: newClass.name,
        segment: newClass.segment,
        shift: newClass.shift,
        studentsCount: 0,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (isPrismaUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "Já existe uma turma com este nome nesta escola." },
        { status: 409 }
      );
    }
    console.error("Erro ao criar turma:", error);
    return NextResponse.json({ error: "Erro ao criar turma." }, { status: 500 });
  }
}
