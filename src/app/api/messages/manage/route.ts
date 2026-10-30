import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/permissions";

// PUT: Editar campos de um registro do histórico (Restrito a ADMIN)
export async function PUT(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const body = await req.json();
    const {
      id,
      sentAt,
      reasonTitle,
      phoneUsed,
      sentByName,
      guardianReplied,
      replyNotes,
      replyCategory,
      deliveryStatus,
      messageContent,
    } = body;

    if (!id) {
      return NextResponse.json({ error: "ID do registro não informado" }, { status: 400 });
    }

    const previous = await prisma.messageLog.findUnique({
      where: { id },
      include: {
        student: {
          include: { classGroup: true },
        },
      },
    });

    if (!previous) {
      return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
    }

    const updateData: any = {};
    if (reasonTitle !== undefined) updateData.reasonTitle = reasonTitle;
    if (phoneUsed !== undefined) updateData.phoneUsed = phoneUsed;
    if (sentByName !== undefined) updateData.sentByName = sentByName;
    if (messageContent !== undefined) updateData.messageContent = messageContent;
    if (sentAt) updateData.sentAt = new Date(sentAt);
    if (guardianReplied !== undefined) {
      updateData.guardianReplied = Boolean(guardianReplied);
      updateData.repliedAt = Boolean(guardianReplied) ? previous.repliedAt || new Date() : null;
      updateData.repliedByUserId = Boolean(guardianReplied)
        ? previous.repliedByUserId || authCheck.userId || null
        : null;
    }
    if (replyNotes !== undefined) updateData.replyNotes = replyNotes;
    if (replyCategory !== undefined) updateData.replyCategory = replyCategory || null;
    if (deliveryStatus !== undefined) {
      updateData.deliveryStatus = deliveryStatus;
      updateData.deliveryUpdatedAt = new Date();
    }

    const updated = await prisma.messageLog.update({
      where: { id },
      data: updateData,
      include: {
        student: {
          include: { classGroup: true },
        },
      },
    });

    await logAudit({
      action: "UPDATE_MESSAGE_LOG",
      entityType: "MessageLog",
      entityId: id,
      details: {
        studentName: previous.student.name,
        classGroup: previous.student.classGroup.name,
        changes: {
          before: {
            reasonTitle: previous.reasonTitle,
            phoneUsed: previous.phoneUsed,
            sentByName: previous.sentByName,
            sentAt: previous.sentAt,
            guardianReplied: previous.guardianReplied,
            replyNotes: previous.replyNotes,
          },
          after: {
            reasonTitle: updated.reasonTitle,
            phoneUsed: updated.phoneUsed,
            sentByName: updated.sentByName,
            sentAt: updated.sentAt,
            guardianReplied: updated.guardianReplied,
            replyNotes: updated.replyNotes,
          },
        },
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
    console.error("Erro ao atualizar histórico:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// DELETE: Excluir um registro do histórico (Restrito a ADMIN)
export async function DELETE(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID do registro não informado" }, { status: 400 });
    }

    const previous = await prisma.messageLog.findUnique({
      where: { id },
      include: {
        student: {
          include: { classGroup: true },
        },
      },
    });

    if (!previous) {
      return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
    }

    await prisma.messageLog.delete({
      where: { id },
    });

    await logAudit({
      action: "DELETE_MESSAGE_LOG",
      entityType: "MessageLog",
      entityId: id,
      details: {
        studentName: previous.student.name,
        classGroup: previous.student.classGroup.name,
        reasonTitle: previous.reasonTitle,
        phoneUsed: previous.phoneUsed,
        sentByName: previous.sentByName,
        sentAt: previous.sentAt,
        messageContent: previous.messageContent,
        guardianReplied: previous.guardianReplied,
        replyNotes: previous.replyNotes,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error: any) {
    console.error("Erro ao excluir do histórico:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
