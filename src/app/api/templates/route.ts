import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

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
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

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

    await logAudit({
      action: "CREATE_TEMPLATE",
      entityType: "MessageTemplate",
      entityId: template.id,
      details: { title: template.title, segment: template.segment },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(template);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

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

    await logAudit({
      action: "UPDATE_TEMPLATE",
      entityType: "MessageTemplate",
      entityId: template.id,
      details: { title: template.title, segment: template.segment },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(template);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
