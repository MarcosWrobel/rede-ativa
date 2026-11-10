import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, studentCreateSchema, studentUpdateSchema } from "@/lib/schemas";
import { getCurrentSchool } from "@/lib/currentSchool";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const { searchParams } = new URL(req.url);
    const segment = searchParams.get("segment");
    const classGroupId = searchParams.get("classGroupId");
    const search = searchParams.get("search");
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");

    const where: any = { active: true, schoolId: currentSchool.id };
    if (classGroupId) where.classGroupId = classGroupId;
    if (segment) where.classGroup = { segment };
    if (search) {
      where.name = { contains: search.toUpperCase() };
    }

    const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : undefined;
    const pageSize = pageSizeParam ? Math.min(500, Math.max(1, parseInt(pageSizeParam, 10))) : undefined;
    const take = pageSize;
    const skip = page && pageSize ? (page - 1) * pageSize : undefined;

    const students = await prisma.student.findMany({
      where,
      include: {
        classGroup: true,
        _count: { select: { messageLogs: true } },
      },
      orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
      ...(take ? { take } : {}),
      ...(skip ? { skip } : {}),
    });

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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const parsed = studentCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { cgm, name, guardianName, phone, classGroupId } = parsed.data;

    // Prevenção Cross-Tenant Relation Traversal: valida se a turma pertence à instituição ativa (tolerante a turmas legadas apenas para a escola piloto)
    const classGroup = await prisma.classGroup.findFirst({
      where: {
        id: classGroupId,
        schoolId: currentSchool.id,
      },
    });

    if (!classGroup) {
      return NextResponse.json(
        { error: "A turma selecionada não foi encontrada nesta instituição escolar." },
        { status: 400 }
      );
    }

    const cleanDigits = phone.replace(/\D/g, "");
    const cleanCgm = cgm ? cgm.replace(/\D/g, "") || null : null;
    const formattedName = name.toUpperCase();

    const student = await prisma.student.create({
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
    console.error("Erro ao cadastrar estudante:", error);
    return NextResponse.json({ error: "Erro ao cadastrar estudante." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const parsed = studentUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { id, cgm, name, guardianName, phone, classGroupId } = parsed.data;

    const previous = await prisma.student.findUnique({
      where: { id },
      include: { classGroup: true },
    });

    if (!previous || previous.schoolId !== currentSchool.id) {
      return NextResponse.json(
        { error: "Estudante não encontrado nesta unidade escolar" },
        { status: 404 }
      );
    }

    if (classGroupId && classGroupId !== previous.classGroupId) {
      const classGroup = await prisma.classGroup.findFirst({
        where: {
          id: classGroupId,
          schoolId: currentSchool.id,
        },
      });
      if (!classGroup) {
        return NextResponse.json(
          { error: "A turma selecionada não foi encontrada nesta instituição escolar." },
          { status: 400 }
        );
      }
    }

    const cleanDigits = phone !== undefined ? phone.replace(/\D/g, "") : previous?.phone;
    const cleanCgm =
      cgm !== undefined ? (cgm ? cgm.replace(/\D/g, "") || null : null) : previous?.cgm;
    const formattedName = name ? name.toUpperCase() : previous?.name;

    const student = await prisma.student.update({
      where: { id },
      data: {
        cgm: cleanCgm,
        name: formattedName,
        guardianName:
          guardianName !== undefined ? (guardianName ? guardianName.trim() : null) : previous?.guardianName,
        phone: cleanDigits,
        classGroupId: classGroupId || previous?.classGroupId,
      },
      include: { classGroup: true },
    });

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
    console.error("Erro ao atualizar estudante:", error);
    return NextResponse.json({ error: "Erro ao atualizar estudante." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

    const previous = await prisma.student.findUnique({
      where: { id },
      include: { classGroup: true },
    });

    if (!previous || previous.schoolId !== currentSchool.id) {
      return NextResponse.json(
        { error: "Estudante não encontrado nesta unidade escolar" },
        { status: 404 }
      );
    }

    const student = await prisma.student.update({
      where: { id },
      data: { active: false },
      include: { classGroup: true },
    });

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
