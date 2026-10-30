import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageSendSchema } from "@/lib/schemas";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { dispatchWhatsAppMessage } from "@/lib/whatsappProvider";

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const parsed = messageSendSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const {
      studentId,
      templateId,
      reasonTitle,
      messageContent,
      customPhone,
      initialDeliveryStatus,
    } = parsed.data;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { classGroup: true },
    });

    if (!student) {
      return NextResponse.json({ error: "Aluno não encontrado" }, { status: 404 });
    }

    const digits = normalizeWhatsAppPhone(customPhone || student.phone);
    if (!digits || digits.length < 10) {
      return NextResponse.json(
        { error: "Telefone inválido para envio no WhatsApp" },
        { status: 400 }
      );
    }

    const sentByName = authCheck.userName;
    const dispatch = await dispatchWhatsAppMessage({
      phoneDigits: digits,
      messageText: messageContent,
    });

    const resolvedStatus = initialDeliveryStatus || dispatch.initialStatus;

    // 1. Create message log with deliveryStatus (AUT-01)
    const log = await prisma.messageLog.create({
      data: {
        studentId: student.id,
        templateId: templateId || null,
        reasonTitle,
        messageContent,
        phoneUsed: digits,
        sentByUserId: authCheck.userId || null,
        sentByName,
        deliveryStatus: resolvedStatus,
        deliveryUpdatedAt: new Date(),
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
        deliveryStatus: resolvedStatus,
        providerMode: dispatch.mode,
        messageSnippet: messageContent.slice(0, 100),
      },
      user: {
        id: authCheck.userId,
        name: sentByName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({
      success: true,
      logId: log.id,
      whatsappUrl: dispatch.whatsappUrl,
      deliveryStatus: resolvedStatus,
      providerMode: dispatch.mode,
    });
  } catch (error: any) {
    console.error("Erro ao enviar mensagem:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
