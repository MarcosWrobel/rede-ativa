import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { logId, guardianReplied, replyNotes } = await req.json();
    if (!logId) {
      return NextResponse.json({ error: "ID do log ausente" }, { status: 400 });
    }

    const pedagogaUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    const previous = await prisma.messageLog.findUnique({
      where: { id: logId },
      include: { student: true },
    });

    const updated = await prisma.messageLog.update({
      where: { id: logId },
      data: {
        guardianReplied: Boolean(guardianReplied),
        replyNotes: replyNotes !== undefined ? replyNotes : previous?.replyNotes,
        repliedAt: Boolean(guardianReplied) ? new Date() : null,
        repliedByUserId: Boolean(guardianReplied) ? pedagogaUser?.id : null,
      },
    });

    await logAudit({
      action: "MARK_REPLY",
      entityType: "MessageLog",
      entityId: logId,
      details: {
        studentName: previous?.student.name,
        previousReplied: previous?.guardianReplied,
        newReplied: Boolean(guardianReplied),
        notes: replyNotes,
      },
      user: {
        id: pedagogaUser?.id,
        name: pedagogaUser?.name || session.user.name || "Pedagoga",
        email: session.user.email,
      },
    });

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error("Erro ao registrar retorno:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
