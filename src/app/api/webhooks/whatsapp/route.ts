import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { classifyGuardianReplyHeuristic } from "@/lib/whatsappProvider";
import { safeCompareStrings } from "@/lib/syncToken";
import { computeMessageContentHash } from "@/lib/messageCrypto";

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

    const isAuthorized =
      safeCompareStrings(bearerToken, configuredSecret) ||
      safeCompareStrings(customSecretHeader, configuredSecret);

    if (!isAuthorized) {
      return NextResponse.json({ error: "Assinatura de webhook inválida" }, { status: 401 });
    }

    const payload = await req.json();
    const eventType = String(payload?.event || payload?.type || "message").toLowerCase();
    const rawPhone = String(payload?.phone || payload?.from || payload?.sender || "");
    const digits = normalizeWhatsAppPhone(rawPhone);

    if (!digits || digits.length < 10) {
      return NextResponse.json({ ignored: true, reason: "Telefone ausente ou inválido" });
    }

    // Identificadores explícitos opcionais no payload do webhook/gateway (H-06)
    const explicitLogId =
      typeof payload?.logId === "string"
        ? payload.logId.trim()
        : typeof payload?.messageLogId === "string"
        ? payload.messageLogId.trim()
        : typeof payload?.messageId === "string"
        ? payload.messageId.trim()
        : null;
    const explicitSchoolId = typeof payload?.schoolId === "string" ? payload.schoolId.trim() : null;
    const explicitStudentId = typeof payload?.studentId === "string" ? payload.studentId.trim() : null;
    const explicitCgm = typeof payload?.cgm === "string" ? payload.cgm.trim() : null;
    const incomingText = String(payload?.text || payload?.message || payload?.body || "").trim();

    // Localiza o acionamento recente para este telefone (últimos 14 dias)
    // Utiliza sufixo de 10 dígitos (DDD + número) para evitar colisão entre DDDs diferentes
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const phoneSuffix = digits.length >= 10 ? digits.slice(-10) : digits;

    let targetLog: any = null;

    // 1. Busca prioritária por ID direto de MessageLog se fornecido pelo webhook/gateway
    if (explicitLogId) {
      targetLog = await prisma.messageLog.findUnique({
        where: { id: explicitLogId },
        include: { student: true },
      });
      if (targetLog && explicitSchoolId && targetLog.student.schoolId !== explicitSchoolId) {
        targetLog = null;
      }
    }

    // 2. Se não encontrou por ID direto, busca pelos logs recentes do telefone com escopo
    if (!targetLog) {
      const candidateLogs = await prisma.messageLog.findMany({
        where: {
          phoneUsed: { endsWith: phoneSuffix },
          sentAt: { gte: cutoff },
          ...(explicitSchoolId ? { student: { schoolId: explicitSchoolId } } : {}),
          ...(explicitStudentId ? { studentId: explicitStudentId } : {}),
          ...(explicitCgm ? { student: { cgm: explicitCgm } } : {}),
        },
        orderBy: { sentAt: "desc" },
        include: { student: true },
        take: 10,
      });

      if (candidateLogs.length > 0) {
        // Multi-tenant check: se os logs candidatos pertencerem a mais de uma instituição de ensino
        // e não houver explicitSchoolId nem identificador unívoco:
        const distinctSchoolIds = Array.from(
          new Set(candidateLogs.map((l: any) => l.student?.schoolId).filter(Boolean))
        );

        if (!explicitSchoolId && distinctSchoolIds.length > 1) {
          // Se houver texto, tenta desambiguar pelo primeiro nome do estudante
          let matchedByName: any = null;
          if (incomingText) {
            matchedByName = candidateLogs.find((l: any) => {
              const firstName = l.student.name.split(" ")[0].toLowerCase();
              return firstName.length >= 3 && incomingText.toLowerCase().includes(firstName);
            });
          }

          if (matchedByName) {
            targetLog = matchedByName;
          } else {
            // Rejeita associação cega entre escolas distintas para evitar vazamento / IDOR passivo
            return NextResponse.json({
              ignored: true,
              reason: "Número vinculado a múltiplos estabelecimentos de ensino sem identificação explícita de escola.",
            });
          }
        } else {
          // Desambiguação de irmãos: se houver texto e múltiplos logs, tenta casar pelo primeiro nome do estudante
          if (incomingText && candidateLogs.length > 1) {
            const matchedByName = candidateLogs.find((l: any) => {
              const firstName = l.student.name.split(" ")[0].toLowerCase();
              return firstName.length >= 3 && incomingText.toLowerCase().includes(firstName);
            });
            if (matchedByName) {
              targetLog = matchedByName;
            }
          }

          // Prioriza o envio mais recente ainda pendente de resposta do responsável
          if (!targetLog) {
            targetLog = candidateLogs.find((l: any) => !l.guardianReplied) || candidateLogs[0];
          }
        }
      }
    }

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
    if (!incomingText) {
      return NextResponse.json({ ignored: true, reason: "Sem conteúdo textual" });
    }

    const classified = classifyGuardianReplyHeuristic(incomingText);
    const repliedAt = new Date();
    const newContentHash = computeMessageContentHash({
      studentId: targetLog.studentId,
      schoolId: targetLog.student?.schoolId || null,
      phoneUsed: targetLog.phoneUsed,
      reasonTitle: targetLog.reasonTitle,
      messageContent: targetLog.messageContent,
      sentByName: targetLog.sentByName,
      sentAt: targetLog.sentAt,
      guardianReplied: true,
      replyNotes: classified.formalSummary,
      replyCategory: classified.category,
      repliedAt,
    });

    const updated = await prisma.messageLog.update({
      where: { id: targetLog.id },
      data: {
        guardianReplied: true,
        replyCategory: classified.category,
        replyNotes: classified.formalSummary,
        repliedAt,
        deliveryStatus: "READ",
        deliveryUpdatedAt: new Date(),
        contentHash: newContentHash,
      },
    });

    await logAudit({
      action: "WEBHOOK_REPLY",
      entityType: "MessageLog",
      entityId: targetLog.id,
      schoolId: targetLog.student?.schoolId || null,
      details: {
        studentName: targetLog.student?.name,
        phone: digits,
        category: classified.category,
        contentHash: newContentHash,
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
    return NextResponse.json({ error: "Erro interno ao processar webhook" }, { status: 500 });
  }
}
