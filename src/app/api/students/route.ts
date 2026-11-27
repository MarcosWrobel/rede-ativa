import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, studentCreateSchema, studentUpdateSchema } from "@/lib/schemas";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
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
    const classGroupId = searchParams.get("classGroupId");
    const search = searchParams.get("search");
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");

    const where: any = {
      active: true,
      schoolId: currentSchool.id,
      classGroup: {
        schoolId: currentSchool.id,
        ...(segment ? { segment } : {}),
      },
    };
    if (classGroupId) where.classGroupId = classGroupId;
    if (search) {
      where.name = { contains: search.toUpperCase() };
    }

    const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : undefined;
    const pageSize = pageSizeParam ? Math.min(500, Math.max(1, parseInt(pageSizeParam, 10))) : undefined;
    const take = pageSize;
    const skip = page && pageSize ? (page - 1) * pageSize : undefined;

    const students = await withTenantContext(prisma, currentSchool.id, async (tx) =>
      tx.student.findMany({
        where,
        include: {
          classGroup: true,
          _count: { select: { messageLogs: { where: { OR: [{ schoolId: null }, { schoolId: currentSchool.id }] } } } },
        },
        orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
        ...(take ? { take } : {}),
        ...(skip ? { skip } : {}),
      })
    );

    return NextResponse.json(students);
  } catch (error: any) {
    console.error("Erro ao listar estudantes:", error);
    return NextResponse.json({ error: "Erro ao listar estudantes." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(authCheck.session, authCheck.schoolId, authCheck.snapshot);
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;
    const parsed = studentCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { cgm, name, guardianName, phone, classGroupId } = parsed.data;

    const cleanDigits = phone.replace(/\D/g, "");
    const cleanCgm = cgm ? cgm.replace(/\D/g, "") || null : null;
    const formattedName = name.toUpperCase();

    if (cleanCgm && typeof (prisma as any).student?.findUnique === "function") {
      const existingCgm = await prisma.student.findUnique({
        where: { cgm: cleanCgm },
        select: { id: true },
      });
      if (existingCgm) {
        return NextResponse.json(
          { error: "O CGM informado já está cadastrado em outra matrícula no sistema." },
          { status: 409 }
        );
      }
    }

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      // Prevenção Cross-Tenant Relation Traversal: valida se a turma pertence à instituição ativa
      const classGroup = await tx.classGroup.findFirst({
        where: {
          id: classGroupId,
          schoolId: currentSchool.id,
        },
      });

      if (!classGroup) {
        return {
          errorStatus: 400 as const,
          error: "A turma selecionada não foi encontrada nesta instituição escolar.",
        };
      }

      const student = await tx.student.create({
        data: {
          cgm: cleanCgm,
          name: formattedName,
          guardianName: guardianName?.trim() || "Responsável",
          phone: cleanDigits,
          classGroupId,
          schoolId: currentSchool.id,
        },
        include: { classGroup: true },
      });
      return { student };
    });

    if ("error" in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.errorStatus });
    }
    const student = txResult.student;

    await logAudit({
      action: "CREATE_STUDENT",
      entityType: "Student",
      entityId: student.id,
      details: {
        name: student.name,
        guardian: student.guardianName,
        phone: student.phone,
        turma: student.classGroup.name,
      },
      schoolId: currentSchool.id,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(student);
  } catch (error: any) {
    if (
      error?.code === "P2002" ||
      String(error?.message || "").toLowerCase().includes("unique constraint")
    ) {
      return NextResponse.json(
        { error: "O CGM informado já está cadastrado em outra matrícula no sistema." },
        { status: 409 }
      );
    }
    console.error("Erro ao cadastrar estudante:", error);
    return NextResponse.json({ error: "Erro ao cadastrar estudante." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(authCheck.session, authCheck.schoolId, authCheck.snapshot);
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;
    const parsed = studentUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { id, cgm, name, guardianName, phone, classGroupId } = parsed.data;

    const cleanCgmRequested =
      cgm !== undefined ? (cgm ? cgm.replace(/\D/g, "") || null : null) : undefined;

    if (cleanCgmRequested && typeof (prisma as any).student?.findUnique === "function") {
      const existingCgm = await prisma.student.findUnique({
        where: { cgm: cleanCgmRequested },
        select: { id: true },
      });
      if (existingCgm && existingCgm.id !== id) {
        return NextResponse.json(
          { error: "O CGM informado já está cadastrado em outra matrícula no sistema." },
          { status: 409 }
        );
      }
    }

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const previous = await tx.student.findFirst({
        where: { id, schoolId: currentSchool.id },
        include: { classGroup: true },
      });

      if (!previous) {
        return { errorStatus: 404 as const, error: "Estudante não encontrado nesta unidade escolar" };
      }

      if (classGroupId && classGroupId !== previous.classGroupId) {
        const classGroup = await tx.classGroup.findFirst({
          where: {
            id: classGroupId,
            schoolId: currentSchool.id,
          },
        });
        if (!classGroup) {
          return {
            errorStatus: 400 as const,
            error: "A turma selecionada não foi encontrada nesta instituição escolar.",
          };
        }
      }

      const cleanDigits = phone !== undefined ? phone.replace(/\D/g, "") : previous.phone;
      const cleanCgm = cleanCgmRequested !== undefined ? cleanCgmRequested : previous.cgm;
      const formattedName = name ? name.toUpperCase() : previous.name;

      const updatedCount = await tx.student.updateMany({
        where: { id, schoolId: currentSchool.id },
        data: {
          cgm: cleanCgm,
          name: formattedName,
          guardianName:
            guardianName !== undefined ? (guardianName ? guardianName.trim() : null) : previous.guardianName,
          phone: cleanDigits,
          classGroupId: classGroupId || previous.classGroupId,
        },
      });
      if (updatedCount.count === 0) {
        return { errorStatus: 404 as const, error: "Estudante não encontrado nesta unidade escolar" };
      }

      const student = await tx.student.findFirst({
        where: { id, schoolId: currentSchool.id },
        include: { classGroup: true },
      });
      if (!student) {
        return { errorStatus: 404 as const, error: "Estudante não encontrado nesta unidade escolar" };
      }

      return { previous, student };
    });

    if ("error" in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.errorStatus });
    }
    const { previous, student } = txResult;

    await logAudit({
      action: "UPDATE_STUDENT",
      entityType: "Student",
      entityId: student.id,
      details: {
        previous: { name: previous?.name, phone: previous?.phone, turma: previous?.classGroup.name },
        new: { name: student.name, phone: student.phone, turma: student.classGroup.name },
      },
      schoolId: currentSchool.id,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(student);
  } catch (error: any) {
    if (
      error?.code === "P2002" ||
      String(error?.message || "").toLowerCase().includes("unique constraint")
    ) {
      return NextResponse.json(
        { error: "O CGM informado já está cadastrado em outra matrícula no sistema." },
        { status: 409 }
      );
    }
    console.error("Erro ao atualizar estudante:", error);
    return NextResponse.json({ error: "Erro ao atualizar estudante." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(authCheck.session, authCheck.schoolId, authCheck.snapshot);
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

    const student = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const previous = await tx.student.findFirst({
        where: { id, schoolId: currentSchool.id },
        include: { classGroup: true },
      });
      if (!previous) return null;

      const updatedCount = await tx.student.updateMany({
        where: { id, schoolId: currentSchool.id },
        data: { active: false },
      });
      if (updatedCount.count === 0) return null;

      return tx.student.findFirst({
        where: { id, schoolId: currentSchool.id },
        include: { classGroup: true },
      });
    });

    if (!student) {
      return NextResponse.json(
        { error: "Estudante não encontrado nesta unidade escolar" },
        { status: 404 }
      );
    }

    await logAudit({
      action: "DELETE_STUDENT",
      entityType: "Student",
      entityId: student.id,
      details: { name: student.name, turma: student.classGroup.name, deactivated: true },
      schoolId: currentSchool.id,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Erro ao inativar estudante:", error);
    return NextResponse.json({ error: "Erro ao inativar estudante." }, { status: 500 });
  }
}
