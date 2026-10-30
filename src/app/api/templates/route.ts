import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, templateCreateSchema, templateUpdateSchema } from "@/lib/schemas";

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

    const parsed = templateCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { title, segment, prefixText, suffixText, isAbsenceRelated } = parsed.data;

    const template = await prisma.messageTemplate.create({
      data: {
        title: title.toUpperCase(),
        segment,
        prefixText,
        suffixText,
        isAbsenceRelated,
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

    const parsed = templateUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { id, title, segment, prefixText, suffixText, isAbsenceRelated, active } = parsed.data;

    const template = await prisma.messageTemplate.update({
      where: { id },
      data: {
        title: title ? title.toUpperCase() : undefined,
        segment,
        prefixText,
        suffixText,
        isAbsenceRelated,
        active,
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
