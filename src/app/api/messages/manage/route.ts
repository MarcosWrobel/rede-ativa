import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { computeMessageContentHash } from "@/lib/messageCrypto";
import {
  formatZodError,
  messageManageUpdateSchema,
  messageManageDeleteSchema,
} from "@/lib/schemas";

// PUT: Editar campos de um registro do histórico (Restrito a ADMIN)
export async function PUT(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const body = await req.json();
    const parsed = messageManageUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

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
    } = parsed.data;

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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(previous.student.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
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

    // Recalcula o Hash SHA-256 canônico de integridade probatória se campos-chave forem alterados
    const effectiveSentAt = updateData.sentAt || previous.sentAt;
    const effectiveReason = updateData.reasonTitle !== undefined ? updateData.reasonTitle : previous.reasonTitle;
    const effectivePhone = updateData.phoneUsed !== undefined ? updateData.phoneUsed : previous.phoneUsed;
    const effectiveContent = updateData.messageContent !== undefined ? updateData.messageContent : previous.messageContent;
    const effectiveSentByName = updateData.sentByName !== undefined ? updateData.sentByName : previous.sentByName;
    const effectiveGuardianReplied =
      updateData.guardianReplied !== undefined
        ? updateData.guardianReplied
        : Boolean(previous.guardianReplied);
    const effectiveReplyNotes =
      updateData.replyNotes !== undefined ? updateData.replyNotes : previous.replyNotes;
    const effectiveReplyCategory =
      updateData.replyCategory !== undefined ? updateData.replyCategory : previous.replyCategory;
    const effectiveRepliedAt =
      updateData.repliedAt !== undefined ? updateData.repliedAt : previous.repliedAt;

    updateData.contentHash = computeMessageContentHash({
      studentId: previous.studentId,
      schoolId: previous.student.schoolId || currentSchool.id,
      phoneUsed: effectivePhone,
      reasonTitle: effectiveReason,
      messageContent: effectiveContent,
      sentByName: effectiveSentByName,
      sentAt: effectiveSentAt,
      guardianReplied: effectiveGuardianReplied,
      replyNotes: effectiveReplyNotes,
      replyCategory: effectiveReplyCategory,
      repliedAt: effectiveRepliedAt,
    });

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
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error("Erro ao atualizar histórico:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar histórico de mensagens" }, { status: 500 });
  }
}

// DELETE: Excluir um registro do histórico (Restrito a ADMIN)
export async function DELETE(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const parsedQuery = messageManageDeleteSchema.safeParse({ id: searchParams.get("id") });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: formatZodError(parsedQuery.error) }, { status: 400 });
    }
    const { id } = parsedQuery.data;

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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(previous.student.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
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
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error: any) {
    console.error("Erro ao excluir do histórico:", error);
    return NextResponse.json({ error: "Erro interno ao excluir registro de mensagem" }, { status: 500 });
  }
}
