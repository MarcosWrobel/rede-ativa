import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageReplySchema } from "@/lib/schemas";

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = messageReplySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { logId, guardianReplied, replyNotes, replyCategory } = parsed.data;

    const previous = await prisma.messageLog.findUnique({
      where: { id: logId },
      include: { student: true },
    });

    if (!previous) {
      return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
    }

    const shouldUpgradeDelivery =
      Boolean(guardianReplied) &&
      (previous.deliveryStatus === "LINK_OPENED" || previous.deliveryStatus === "SENT");

    const updated = await prisma.messageLog.update({
      where: { id: logId },
      data: {
        guardianReplied: Boolean(guardianReplied),
        replyNotes: replyNotes !== undefined ? replyNotes : previous.replyNotes,
        replyCategory: Boolean(guardianReplied)
          ? replyCategory !== undefined
            ? replyCategory
            : previous.replyCategory
          : null,
        repliedAt: Boolean(guardianReplied) ? new Date() : null,
        repliedByUserId: Boolean(guardianReplied) ? authCheck.userId || null : null,
        ...(shouldUpgradeDelivery
          ? { deliveryStatus: "READ", deliveryUpdatedAt: new Date() }
          : {}),
      },
    });

    await logAudit({
      action: "MARK_REPLY",
      entityType: "MessageLog",
      entityId: logId,
      details: {
        studentName: previous.student.name,
        previousReplied: previous.guardianReplied,
        newReplied: Boolean(guardianReplied),
        replyCategory: updated.replyCategory,
        notes: replyNotes,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error("Erro ao registrar retorno:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
