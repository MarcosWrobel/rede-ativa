import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const segment = searchParams.get("segment");

    const where: any = { active: true };
    if (segment && segment !== "TODOS") {
      where.OR = [{ segment }, { segment: "TODOS" }];
    }

    const templates = await prisma.messageTemplate.findMany({
      where,
      orderBy: { title: "asc" },
    });

    return NextResponse.json(templates);
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

    const { title, segment, prefixText, suffixText, isAbsenceRelated } = await req.json();
    if (!title) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });

    const template = await prisma.messageTemplate.create({
      data: {
        title: title.trim().toUpperCase(),
        segment: segment || "TODOS",
        prefixText: prefixText || "",
        suffixText: suffixText || "",
        isAbsenceRelated: Boolean(isAbsenceRelated),
      },
    });

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    await logAudit({
      action: "CREATE_TEMPLATE",
      entityType: "MessageTemplate",
      entityId: template.id,
      details: { title: template.title, segment: template.segment },
      user: {
        id: user?.id,
        name: user?.name || session.user.name || "Pedagoga",
        email: session.user.email,
      },
    });

    return NextResponse.json(template);
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

    const { id, title, segment, prefixText, suffixText, isAbsenceRelated, active } = await req.json();
    if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

    const template = await prisma.messageTemplate.update({
      where: { id },
      data: {
        title: title ? title.trim().toUpperCase() : undefined,
        segment: segment !== undefined ? segment : undefined,
        prefixText: prefixText !== undefined ? prefixText : undefined,
        suffixText: suffixText !== undefined ? suffixText : undefined,
        isAbsenceRelated: isAbsenceRelated !== undefined ? Boolean(isAbsenceRelated) : undefined,
        active: active !== undefined ? Boolean(active) : undefined,
      },
    });

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    await logAudit({
      action: "UPDATE_TEMPLATE",
      entityType: "MessageTemplate",
      entityId: template.id,
      details: { title: template.title, segment: template.segment },
      user: {
        id: user?.id,
        name: user?.name || session.user.name || "Pedagoga",
        email: session.user.email,
      },
    });

    return NextResponse.json(template);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
