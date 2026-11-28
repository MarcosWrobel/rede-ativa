import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { classifyGuardianReplyHeuristic } from "@/lib/whatsappProvider";
import { safeCompareStrings } from "@/lib/syncToken";
import { computeMessageContentHash } from "@/lib/messageCrypto";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { lockScopedMessageLogForUpdate } from "@/services/messageDispatchService";

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

    // Identificadores internos explícitos opcionais de MessageLog (logId / messageLogId).
    // Campos de evento/mensagem do gateway (ex.: messageId) NÃO representam MessageLog.id.
    const normalizedLogId =
      typeof payload?.logId === "string" && payload.logId.trim()
        ? payload.logId.trim()
        : null;
    const normalizedMessageLogId =
      typeof payload?.messageLogId === "string" && payload.messageLogId.trim()
        ? payload.messageLogId.trim()
        : null;
    if (normalizedLogId && normalizedMessageLogId && normalizedLogId !== normalizedMessageLogId) {
      return NextResponse.json({
        ignored: true,
        reason: "Identificadores internos logId e messageLogId conflitantes.",
      });
    }
    const explicitLogId = normalizedLogId || normalizedMessageLogId;
    const explicitSchoolId =
      typeof payload?.schoolId === "string" && payload.schoolId.trim()
        ? payload.schoolId.trim()
        : null;
    const explicitStudentId =
      typeof payload?.studentId === "string" && payload.studentId.trim()
        ? payload.studentId.trim()
        : null;
    const explicitCgm =
      typeof payload?.cgm === "string" && payload.cgm.trim()
        ? payload.cgm.trim()
        : null;
    const incomingText = String(payload?.text || payload?.message || payload?.body || "").trim();

    // Localiza o acionamento recente para este telefone (últimos 14 dias)
    // Utiliza sufixo de 10 dígitos (DDD + número) para evitar colisão entre DDDs diferentes
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const phoneSuffix = digits.length >= 10 ? digits.slice(-10) : digits;

    let resolvedSchoolId: string | null = explicitSchoolId;
    let resolvedLogId: string | null = null;
    const useSecDefResolver =
      process.env.RLS_WEBHOOK_SECDEF_RESOLVER === "true" ||
      process.env.RLS_WAVE1_SECDEF_RESOLVER === "true";

    // 1. Identificação inicial mínima pré-escola:
    //    Se houver ID interno explícito (logId / messageLogId), valida existência e correlação sem redirecionar.
    if (explicitLogId) {
      let preLog: {
        id: string;
        schoolId: string | null;
        studentId: string;
        phoneUsed: string;
        student: { id: string; schoolId: string; cgm: string | null } | null;
      } | null = null;

      if (useSecDefResolver) {
        const rows = await prisma.$queryRaw<
          Array<{
            id: string;
            schoolId: string | null;
            studentId: string;
            phoneUsed: string;
            studentSchoolId: string | null;
            studentCgm: string | null;
          }>
        >`
          SELECT "id", "schoolId", "studentId", "phoneUsed", "studentSchoolId", "studentCgm"
          FROM public.resolve_whatsapp_webhook_by_log_id(${explicitLogId})
        `;
        const row = rows[0];
        if (row) {
          preLog = {
            id: row.id,
            schoolId: row.schoolId,
            studentId: row.studentId,
            phoneUsed: row.phoneUsed,
            student: row.studentSchoolId
              ? { id: row.studentId, schoolId: row.studentSchoolId, cgm: row.studentCgm }
              : null,
          };
        }
      } else {
        preLog = await prisma.messageLog.findUnique({
          where: { id: explicitLogId },
          select: {
            id: true,
            schoolId: true,
            studentId: true,
            phoneUsed: true,
            student: {
              select: {
                id: true,
                schoolId: true,
                cgm: true,
              },
            },
          },
        });
      }

      if (!preLog) {
        return NextResponse.json({
          ignored: true,
          reason: "Registro de mensagem explícito não encontrado.",
        });
      }

      const preStudentSchoolId = preLog.student?.schoolId || null;
      const preLogSchoolCoherent =
        preStudentSchoolId !== null &&
        (preLog.schoolId == null || preLog.schoolId === preStudentSchoolId);
      const prePhoneDigits = normalizeWhatsAppPhone(preLog.phoneUsed || "");
      const prePhoneSuffix =
        prePhoneDigits.length >= 10 ? prePhoneDigits.slice(-10) : prePhoneDigits;

      if (
        !preLogSchoolCoherent ||
        (explicitSchoolId && preStudentSchoolId !== explicitSchoolId) ||
        (explicitStudentId && preLog.studentId !== explicitStudentId) ||
        (explicitCgm && (preLog.student?.cgm || null) !== explicitCgm) ||
        prePhoneSuffix !== phoneSuffix
      ) {
        return NextResponse.json({
          ignored: true,
          reason: "Identificador explícito incompatível com os dados de correlação.",
        });
      }

      resolvedSchoolId = preStudentSchoolId;
      resolvedLogId = preLog.id;
    } else if (!resolvedSchoolId) {
      // 2. Busca por telefone sem escola explícita:
      //    Avalia ambiguidade entre escolas em TODO o conjunto elegível antes de ordenar ou limitar.
      let eligiblePreRows: Array<{
        id: string;
        schoolId: string | null;
        studentId: string;
        student: { schoolId: string } | null;
      }>;

      if (useSecDefResolver) {
        const rows = await prisma.$queryRaw<
          Array<{
            id: string;
            schoolId: string | null;
            studentId: string;
            studentSchoolId: string | null;
          }>
        >`
          SELECT "id", "schoolId", "studentId", "studentSchoolId"
          FROM public.resolve_whatsapp_webhook_by_phone(
            ${phoneSuffix},
            ${cutoff},
            ${explicitStudentId},
            ${explicitCgm}
          )
        `;
        eligiblePreRows = rows.map((r: (typeof rows)[number]) => ({
          id: r.id,
          schoolId: r.schoolId,
          studentId: r.studentId,
          student: r.studentSchoolId ? { schoolId: r.studentSchoolId } : null,
        }));
      } else {
        eligiblePreRows = await prisma.messageLog.findMany({
          where: {
            phoneUsed: { endsWith: phoneSuffix },
            sentAt: { gte: cutoff },
            ...(explicitStudentId ? { studentId: explicitStudentId } : {}),
            ...(explicitCgm ? { student: { cgm: explicitCgm } } : {}),
          },
          select: {
            id: true,
            schoolId: true,
            studentId: true,
            student: {
              select: {
                schoolId: true,
              },
            },
          },
        });
      }

      const coherentSchoolIds = Array.from(
        new Set(
          eligiblePreRows
            .filter(
              (r: any) =>
                r.student?.schoolId &&
                (r.schoolId == null || r.schoolId === r.student.schoolId)
            )
            .map((r: any) => r.student.schoolId as string)
        )
      );

      if (coherentSchoolIds.length === 0) {
        return NextResponse.json({ ignored: true, reason: "Nenhum envio recente vinculado ao número" });
      }

      if (coherentSchoolIds.length > 1) {
        // Proibição estrita de associação heurística entre escolas distintas (prevenção de IDOR passivo)
        return NextResponse.json({
          ignored: true,
          reason:
            "Número vinculado a múltiplos estabelecimentos de ensino sem identificação explícita de escola.",
        });
      }

      resolvedSchoolId = coherentSchoolIds[0];
    }

    if (!resolvedSchoolId) {
      return NextResponse.json({ ignored: true, reason: "Nenhum envio recente vinculado ao número" });
    }

    // 3. Seleção intra-escola, bloqueio transacional e atualização dentro de withTenantContext
    const txResult = await withTenantContext(prisma, resolvedSchoolId, async (tx) => {
      let targetLogId = resolvedLogId;

      if (!targetLogId) {
        const candidateLogs = await tx.messageLog.findMany({
          where: {
            phoneUsed: { endsWith: phoneSuffix },
            sentAt: { gte: cutoff },
            OR: [{ schoolId: null }, { schoolId: resolvedSchoolId }],
            student: {
              schoolId: resolvedSchoolId,
              ...(explicitCgm ? { cgm: explicitCgm } : {}),
            },
            ...(explicitStudentId ? { studentId: explicitStudentId } : {}),
          },
          orderBy: { sentAt: "desc" },
          take: 10,
          select: {
            id: true,
            guardianReplied: true,
            student: {
              select: {
                name: true,
              },
            },
          },
        });

        if (candidateLogs.length === 0) {
          return { kind: "ignored" as const, reason: "Nenhum envio recente vinculado ao número" };
        }

        // Desambiguação de irmãos: se houver texto e múltiplos logs na mesma escola, tenta casar pelo primeiro nome
        let selected: any = null;
        if (incomingText && candidateLogs.length > 1) {
          selected = candidateLogs.find((l: any) => {
            const firstName = (l.student?.name || "").split(" ")[0].toLowerCase();
            return firstName.length >= 3 && incomingText.toLowerCase().includes(firstName);
          });
        }

        if (!selected) {
          selected = candidateLogs.find((l: any) => !l.guardianReplied) || candidateLogs[0];
        }

        targetLogId = selected.id;
      }

      if (!targetLogId) {
        return { kind: "ignored" as const, reason: "Nenhum envio recente vinculado ao número" };
      }

      const lockStatus = await lockScopedMessageLogForUpdate(tx, targetLogId, resolvedSchoolId);
      if (lockStatus !== "LOCKED") {
        return { kind: "ignored" as const, reason: "Nenhum envio recente vinculado ao número" };
      }

      const targetLog = await tx.messageLog.findUnique({
        where: { id: targetLogId },
        include: { student: true },
      });

      if (!targetLog) {
        return { kind: "ignored" as const, reason: "Nenhum envio recente vinculado ao número" };
      }

      const targetStudentSchoolId = targetLog.student?.schoolId || null;
      const targetSchoolCoherent =
        targetStudentSchoolId === resolvedSchoolId &&
        (targetLog.schoolId == null || targetLog.schoolId === resolvedSchoolId);
      const targetPhoneDigits = normalizeWhatsAppPhone(targetLog.phoneUsed || "");
      const targetPhoneSuffix =
        targetPhoneDigits.length >= 10 ? targetPhoneDigits.slice(-10) : targetPhoneDigits;

      if (
        !targetSchoolCoherent ||
        (explicitSchoolId && targetStudentSchoolId !== explicitSchoolId) ||
        (explicitStudentId && targetLog.studentId !== explicitStudentId) ||
        (explicitCgm && (targetLog.student?.cgm || null) !== explicitCgm) ||
        targetPhoneSuffix !== phoneSuffix
      ) {
        return {
          kind: "ignored" as const,
          reason: "Identificador explícito incompatível com os dados de correlação.",
        };
      }

      if (!explicitLogId && new Date(targetLog.sentAt).getTime() < cutoff.getTime()) {
        return {
          kind: "ignored" as const,
          reason: "Nenhum envio recente vinculado ao número",
        };
      }

      // 1. Atualização de recibo de entrega/leitura
      if (eventType === "status" || payload?.deliveryStatus) {
        const nextStatus = String(payload.deliveryStatus || "DELIVERED").toUpperCase();
        if (["SENT", "DELIVERED", "READ", "FAILED_NO_WHATSAPP"].includes(nextStatus)) {
          await tx.messageLog.update({
            where: { id: targetLog.id },
            data: {
              deliveryStatus: nextStatus,
              deliveryUpdatedAt: new Date(),
            },
          });
          return {
            kind: "status" as const,
            updatedLogId: targetLog.id,
            deliveryStatus: nextStatus,
          };
        }
      }

      // 2. Mensagem de retorno recebida do responsável
      if (!incomingText) {
        return { kind: "ignored" as const, reason: "Sem conteúdo textual" };
      }

      const classified = classifyGuardianReplyHeuristic(incomingText);
      const repliedAt = new Date();
      const newContentHash = computeMessageContentHash({
        studentId: targetLog.studentId,
        schoolId: targetStudentSchoolId,
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

      const updated = await tx.messageLog.update({
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

      return {
        kind: "reply" as const,
        updatedId: updated.id,
        schoolId: targetStudentSchoolId,
        studentName: targetLog.student?.name,
        category: classified.category,
        contentHash: newContentHash,
      };
    });

    if (txResult.kind === "ignored") {
      return NextResponse.json({ ignored: true, reason: txResult.reason });
    }

    if (txResult.kind === "status") {
      return NextResponse.json({
        success: true,
        updatedLogId: txResult.updatedLogId,
        deliveryStatus: txResult.deliveryStatus,
      });
    }

    await logAudit({
      action: "WEBHOOK_REPLY",
      entityType: "MessageLog",
      entityId: txResult.updatedId,
      schoolId: txResult.schoolId,
      details: {
        studentName: txResult.studentName,
        phone: digits,
        category: txResult.category,
        contentHash: txResult.contentHash,
      },
      user: {
        name: "Webhook Automático WhatsApp",
        email: "webhook@sistema.local",
      },
      req,
    });

    return NextResponse.json({
      success: true,
      logId: txResult.updatedId,
      category: txResult.category,
    });
  } catch (error: any) {
    console.error("Erro no webhook WhatsApp:", error);
    return NextResponse.json({ error: "Erro interno ao processar webhook" }, { status: 500 });
  }
}
