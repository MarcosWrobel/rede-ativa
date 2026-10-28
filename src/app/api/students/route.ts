import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  try {
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
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { name, guardianName, phone, classGroupId } = await req.json();
    if (!name || !phone || !classGroupId) {
      return NextResponse.json({ error: "Nome, telefone e turma são obrigatórios" }, { status: 400 });
    }

    const cleanDigits = phone.replace(/\D/g, "");
    const formattedName = name.trim().toUpperCase();

    const student = await prisma.student.create({
      data: {
        name: formattedName,
        guardianName: guardianName ? guardianName.trim() : "Responsável",
        phone: cleanDigits,
        classGroupId,
      },
      include: { classGroup: true },
    });

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });

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
        id: user?.id,
        name: user?.name || session.user.name || "Pedagoga",
        email: session.user.email,
      },
    });

    return NextResponse.json(student);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { id, name, guardianName, phone, classGroupId } = await req.json();
    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

    const previous = await prisma.student.findUnique({
      where: { id },
      include: { classGroup: true },
    });

    const cleanDigits = phone ? phone.replace(/\D/g, "") : previous?.phone;
    const formattedName = name ? name.trim().toUpperCase() : previous?.name;

    const student = await prisma.student.update({
      where: { id },
      data: {
        name: formattedName,
        guardianName: guardianName !== undefined ? guardianName.trim() : previous?.guardianName,
        phone: cleanDigits,
        classGroupId: classGroupId || previous?.classGroupId,
      },
      include: { classGroup: true },
    });

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });

    await logAudit({
      action: "UPDATE_STUDENT",
      entityType: "Student",
      entityId: student.id,
      details: {
        previous: { name: previous?.name, phone: previous?.phone, turma: previous?.classGroup.name },
        new: { name: student.name, phone: student.phone, turma: student.classGroup.name },
      },
      user: {
        id: user?.id,
        name: user?.name || session.user.name || "Pedagoga",
        email: session.user.email,
      },
    });

    return NextResponse.json(student);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

    const student = await prisma.student.update({
      where: { id },
      data: { active: false },
      include: { classGroup: true },
    });

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });

    await logAudit({
      action: "DELETE_STUDENT",
      entityType: "Student",
      entityId: student.id,
      details: { name: student.name, turma: student.classGroup.name, deactivated: true },
      user: {
        id: user?.id,
        name: user?.name || session.user.name || "Pedagoga",
        email: session.user.email,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
