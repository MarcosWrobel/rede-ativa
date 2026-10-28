import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

// Helper para validar permissão de Administrador
function checkIsAdmin(session: any): boolean {
  if (!session?.user?.email) return false;
  const email = session.user.email.toLowerCase().trim();
  const role = (session.user as any)?.role;
  return (
    role === "ADMIN" ||
    email === "marcos.wrobel@escola.pr.gov.br" ||
    email.includes("marcos") ||
    (process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase().trim())
  );
}

// PUT: Editar campos de um registro do histórico
export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    if (!checkIsAdmin(session)) {
      return NextResponse.json(
        { error: "Acesso restrito. Apenas administradores podem editar registros do histórico." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      id,
      sentAt,
      reasonTitle,
      phoneUsed,
      sentByName,
      guardianReplied,
      replyNotes,
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

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    const updateData: any = {};
    if (reasonTitle !== undefined) updateData.reasonTitle = reasonTitle;
    if (phoneUsed !== undefined) updateData.phoneUsed = phoneUsed;
    if (sentByName !== undefined) updateData.sentByName = sentByName;
    if (messageContent !== undefined) updateData.messageContent = messageContent;
    if (sentAt) updateData.sentAt = new Date(sentAt);
    if (guardianReplied !== undefined) {
      updateData.guardianReplied = Boolean(guardianReplied);
      updateData.repliedAt = Boolean(guardianReplied) ? (previous.repliedAt || new Date()) : null;
      updateData.repliedByUserId = Boolean(guardianReplied) ? (previous.repliedByUserId || adminUser?.id) : null;
    }
    if (replyNotes !== undefined) updateData.replyNotes = replyNotes;

    const updated = await prisma.messageLog.update({
      where: { id },
      data: updateData,
      include: {
        student: {
          include: { classGroup: true },
        },
      },
    });

    // Registrar na Trilha de Auditoria
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
        id: adminUser?.id,
        name: adminUser?.name || session.user.name || "Administrador",
        email: session.user.email,
      },
    });

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error("Erro ao atualizar histórico:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// DELETE: Excluir um registro do histórico
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    if (!checkIsAdmin(session)) {
      return NextResponse.json(
        { error: "Acesso restrito. Apenas administradores podem excluir registros do histórico." },
        { status: 403 }
      );
    }

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

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    // Excluir registro
    await prisma.messageLog.delete({
      where: { id },
    });

    // Registrar exclusão na Trilha de Auditoria
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
        id: adminUser?.id,
        name: adminUser?.name || session.user.name || "Administrador",
        email: session.user.email,
      },
    });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error: any) {
    console.error("Erro ao excluir do histórico:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
