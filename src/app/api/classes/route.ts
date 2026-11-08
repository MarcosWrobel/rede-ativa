import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, classGroupCreateSchema } from "@/lib/schemas";
import { getCurrentSchool } from "@/lib/currentSchool";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);

    const classes = await prisma.classGroup.findMany({
      where: { schoolId: currentSchool.id },
      include: {
        _count: { select: { students: { where: { active: true } } } },
      },
      orderBy: { name: "asc" },
    });

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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const parsed = classGroupCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { segment, shift } = parsed.data;
    const cleanName = parsed.data.name.replace(/\s+/g, " ").trim();

    // Verificação de unicidade dentro da mesma escola (multi-tenant)
    const existing = await prisma.classGroup.findFirst({
      where: {
        schoolId: currentSchool.id,
        name: { equals: cleanName, mode: "insensitive" },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Já existe uma turma com o nome "${cleanName}" nesta escola.` },
        { status: 409 }
      );
    }

    const newClass = await prisma.classGroup.create({
      data: {
        name: cleanName,
        segment,
        shift,
        schoolId: currentSchool.id,
      },
    });

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
    console.error("Erro ao criar turma:", error);
    return NextResponse.json({ error: "Erro ao criar turma." }, { status: 500 });
  }
}
