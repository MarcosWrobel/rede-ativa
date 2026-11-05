import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageSendSchema } from "@/lib/schemas";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { dispatchWhatsAppMessage } from "@/lib/whatsappProvider";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { computeMessageContentHash } from "@/lib/messageCrypto";

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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!student || !assertTenantOwnership(student.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json({ error: "Aluno não encontrado nesta instituição" }, { status: 404 });
    }

    if (templateId) {
      const template = await prisma.messageTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, schoolId: true },
      });
      if (template && template.schoolId && !assertTenantOwnership(template.schoolId, currentSchool.id, authCheck.session)) {
        return NextResponse.json({ error: "Modelo de mensagem não pertence a esta instituição." }, { status: 403 });
      }
    }

    const digits = normalizeWhatsAppPhone(customPhone || student.phone);
    if (!digits || digits.length < 10) {
      return NextResponse.json(
        { error: "Telefone inválido para envio no WhatsApp" },
        { status: 400 }
      );
    }

    const sentByName = authCheck.userName;
    const userAgent = req.headers.get("user-agent") || undefined;
    const dispatch = await dispatchWhatsAppMessage({
      phoneDigits: digits,
      messageText: messageContent,
      userAgent,
    });

    const resolvedStatus = initialDeliveryStatus || dispatch.initialStatus;
    const sentAt = new Date();

    // 1. Calcular Hash SHA-256 canônico de integridade probatória (JUR-02)
    const contentHash = computeMessageContentHash({
      studentId: student.id,
      schoolId: student.schoolId || currentSchool.id,
      phoneUsed: digits,
      reasonTitle,
      messageContent,
      sentByName,
      sentAt,
    });

    // 2. Create message log with deliveryStatus (AUT-01) and contentHash (JUR-02)
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
        sentAt,
        contentHash,
      },
    });

    // 3. Create Audit Log
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
        contentHash,
        messageSnippet: messageContent.slice(0, 100),
      },
      user: {
        id: authCheck.userId,
        name: sentByName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({
      success: true,
      logId: log.id,
      whatsappUrl: dispatch.whatsappUrl,
      deliveryStatus: resolvedStatus,
      providerMode: dispatch.mode,
      contentHash,
    });
  } catch (error: any) {
    console.error("Erro ao enviar mensagem:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
