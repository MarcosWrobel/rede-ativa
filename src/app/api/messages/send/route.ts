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

    const body = await req.json();
    const { studentId, templateId, reasonTitle, messageContent, customPhone } = body;

    if (!studentId || !reasonTitle || !messageContent) {
      return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { classGroup: true },
    });

    if (!student) {
      return NextResponse.json({ error: "Aluno não encontrado" }, { status: 404 });
    }

    // Clean phone number
    let rawPhone = customPhone || student.phone;
    let digits = rawPhone.replace(/\D/g, "");
    if (digits.startsWith("5555")) digits = digits.slice(2);
    if (!digits.startsWith("55")) digits = "55" + digits;

    const pedagogaUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    const sentByName = pedagogaUser?.name || session.user.name || "Pedagoga";

    // 1. Create message log
    const log = await prisma.messageLog.create({
      data: {
        studentId: student.id,
        templateId: templateId || null,
        reasonTitle,
        messageContent,
        phoneUsed: digits,
        sentByUserId: pedagogaUser?.id || null,
        sentByName,
        sentAt: new Date(),
      },
    });

    // 2. Create Audit Log
    await logAudit({
      action: "SEND_MESSAGE",
      entityType: "MessageLog",
      entityId: log.id,
      details: {
        studentName: student.name,
        turma: student.classGroup.name,
        reason: reasonTitle,
        phone: digits,
        messageSnippet: messageContent.slice(0, 100),
      },
      user: {
        id: pedagogaUser?.id,
        name: sentByName,
        email: session.user.email,
      },
    });

    // WhatsApp Web URL
    const encodedText = encodeURIComponent(messageContent);
    const whatsappUrl = `https://wa.me/${digits}?text=${encodedText}`;

    return NextResponse.json({
      success: true,
      logId: log.id,
      whatsappUrl,
    });
  } catch (error: any) {
    console.error("Erro ao enviar mensagem:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
