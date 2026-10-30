import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { classifyGuardianReplyHeuristic } from "@/lib/whatsappProvider";

export const dynamic = "force-dynamic";

/**
 * Endpoint futuro-compatível para recepção passiva de webhooks WhatsApp (AUT-03).
 * Enquanto a escola operar exclusivamente via wa.me, permanece inativo e seguro (503 se WHATSAPP_WEBHOOK_SECRET não estiver definido).
 * Quando conectado futuramente a um gateway (Evolution / WAHA / Cloud API), vincula automaticamente respostas e status de entrega.
 */
export async function POST(req: Request) {
  try {
    const configuredSecret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();
    if (!configuredSecret) {
      return NextResponse.json(
        {
          error:
            "Webhook WhatsApp desativado (operação atual em modo wa.me). Defina WHATSAPP_WEBHOOK_SECRET para habilitar integração passiva.",
        },
        { status: 503 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const customSecretHeader = req.headers.get("x-webhook-secret") || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (bearerToken !== configuredSecret && customSecretHeader !== configuredSecret) {
      return NextResponse.json({ error: "Assinatura de webhook inválida" }, { status: 401 });
    }

    const payload = await req.json();
    const eventType = String(payload?.event || payload?.type || "message").toLowerCase();
    const rawPhone = String(payload?.phone || payload?.from || payload?.sender || "");
    const digits = normalizeWhatsAppPhone(rawPhone);

    if (!digits || digits.length < 10) {
      return NextResponse.json({ ignored: true, reason: "Telefone ausente ou inválido" });
    }

    // Localiza o acionamento mais recente para este telefone (últimos 14 dias)
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const targetLog = await prisma.messageLog.findFirst({
      where: {
        phoneUsed: { endsWith: digits.slice(-8) },
        sentAt: { gte: cutoff },
      },
      orderBy: { sentAt: "desc" },
      include: { student: true },
    });

    if (!targetLog) {
      return NextResponse.json({ ignored: true, reason: "Nenhum envio recente vinculado ao número" });
    }

    // 1. Atualização de recibo de entrega/leitura
    if (eventType === "status" || payload?.deliveryStatus) {
      const nextStatus = String(payload.deliveryStatus || "DELIVERED").toUpperCase();
      if (["SENT", "DELIVERED", "READ", "FAILED_NO_WHATSAPP"].includes(nextStatus)) {
        await prisma.messageLog.update({
          where: { id: targetLog.id },
          data: {
            deliveryStatus: nextStatus,
            deliveryUpdatedAt: new Date(),
          },
        });
        return NextResponse.json({ success: true, updatedLogId: targetLog.id, deliveryStatus: nextStatus });
      }
    }

    // 2. Mensagem de retorno recebida do responsável
    const incomingText = String(payload?.text || payload?.message || payload?.body || "").trim();
    if (!incomingText) {
      return NextResponse.json({ ignored: true, reason: "Sem conteúdo textual" });
    }

    const classified = classifyGuardianReplyHeuristic(incomingText);
    const updated = await prisma.messageLog.update({
      where: { id: targetLog.id },
      data: {
        guardianReplied: true,
        replyCategory: classified.category,
        replyNotes: classified.formalSummary,
        repliedAt: new Date(),
        deliveryStatus: "READ",
        deliveryUpdatedAt: new Date(),
      },
    });

    await logAudit({
      action: "WEBHOOK_REPLY",
      entityType: "MessageLog",
      entityId: targetLog.id,
      details: {
        studentName: targetLog.student.name,
        phone: digits,
        category: classified.category,
      },
      user: {
        name: "Webhook Automático WhatsApp",
        email: "webhook@sistema.local",
      },
      req,
    });

    return NextResponse.json({
      success: true,
      logId: updated.id,
      category: classified.category,
    });
  } catch (error: any) {
    console.error("Erro no webhook WhatsApp:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
