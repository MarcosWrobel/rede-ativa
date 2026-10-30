import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, studentCreateSchema, studentUpdateSchema } from "@/lib/schemas";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const segment = searchParams.get("segment");
    const classGroupId = searchParams.get("classGroupId");
    const search = searchParams.get("search");

    const where: any = { active: true };
    if (classGroupId) where.classGroupId = classGroupId;
    if (segment) where.classGroup = { segment };
    if (search) {
      where.name = { contains: search.toUpperCase() };
    }

    const students = await prisma.student.findMany({
      where,
      include: {
        classGroup: true,
        _count: { select: { messageLogs: true } },
      },
      orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
    });

    return NextResponse.json(students);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const parsed = studentCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { cgm, name, guardianName, phone, classGroupId } = parsed.data;
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
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(student);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const parsed = studentUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { id, cgm, name, guardianName, phone, classGroupId } = parsed.data;

    const previous = await prisma.student.findUnique({
      where: { id },
      include: { classGroup: true },
    });

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
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(student);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

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
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
