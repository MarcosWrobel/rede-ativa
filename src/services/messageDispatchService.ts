import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import {
  dispatchWhatsAppMessage,
  type DeliveryStatus,
  type WhatsAppProviderMode,
} from "@/lib/whatsappProvider";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { computeMessageContentHash } from "@/lib/messageCrypto";

export interface DispatchMessageInput {
  studentId: string;
  templateId?: string | null;
  reasonTitle: string;
  messageContent: string;
  customPhone?: string | null;
  initialDeliveryStatus?: DeliveryStatus;
  currentSchoolId: string;
  session: Session | null;
  userId?: string;
  userName: string;
  userEmail: string;
  userAgent?: string;
  req?: Request;
}

export type DispatchMessageResult =
  | {
      ok: true;
      data: {
        success: true;
        logId: string;
        whatsappUrl: string;
        deliveryStatus: DeliveryStatus;
        providerMode: WhatsAppProviderMode;
        contentHash: string;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export interface ClaimedPendingMessage {
  id: string;
  studentId: string;
  phoneUsed: string;
  reasonTitle: string;
  messageContent: string;
  sentByName: string;
  sentAt: Date;
  contentHash: string | null;
  deliveryStatus: string;
  deliveryUpdatedAt: Date | null;
}

/**
 * Orquestra o envio ou enfileiramento de mensagem pedagógica com garantia de:
 * 1. Isolamento multi-tenant estrito (estudante e modelo de mensagem).
 * 2. Hash SHA-256 canônico bipartido calculado antes da persistência.
 * 3. Persistência atômica antes de acionar gateway externo ou abrir link wa.me.
 * 4. Trilha de auditoria com schoolId raiz obrigatório.
 */
export async function dispatchAndPersistMessage(
  input: DispatchMessageInput
): Promise<DispatchMessageResult> {
  const {
    studentId,
    templateId,
    reasonTitle,
    messageContent,
    customPhone,
    initialDeliveryStatus,
    currentSchoolId,
    session,
    userId,
    userName,
    userEmail,
    userAgent,
    req,
  } = input;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { classGroup: true },
  });

  if (!student || !assertTenantOwnership(student.schoolId, currentSchoolId, session)) {
    return {
      ok: false,
      status: 404,
      error: "Aluno não encontrado nesta instituição",
    };
  }

  if (templateId) {
    const template = await prisma.messageTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, schoolId: true },
    });
    if (
      template &&
      template.schoolId &&
      !assertTenantOwnership(template.schoolId, currentSchoolId, session)
    ) {
      return {
        ok: false,
        status: 403,
        error: "Modelo de mensagem não pertence a esta instituição.",
      };
    }
  }

  const digits = normalizeWhatsAppPhone(customPhone || student.phone);
  if (!digits || digits.length < 10) {
    return {
      ok: false,
      status: 400,
      error: "Telefone inválido para envio no WhatsApp",
    };
  }

  const sentAt = new Date();

  // 1. Calcular Hash SHA-256 canônico de integridade probatória (JUR-02)
  const contentHash = computeMessageContentHash({
    studentId: student.id,
    schoolId: student.schoolId || currentSchoolId,
    phoneUsed: digits,
    reasonTitle,
    messageContent,
    sentByName: userName,
    sentAt,
  });

  // 2. Persistência garantida antes de acionar qualquer gateway de rede externa
  const initialStatus: DeliveryStatus = initialDeliveryStatus || "LINK_OPENED";
  const log = await prisma.messageLog.create({
    data: {
      studentId: student.id,
      templateId: templateId || null,
      reasonTitle,
      messageContent,
      phoneUsed: digits,
      sentByUserId: userId || null,
      sentByName: userName,
      deliveryStatus: initialStatus,
      deliveryUpdatedAt: new Date(),
      sentAt,
      contentHash,
    },
  });

  // 3. Despacho no gateway / construção de URL otimizada wa.me
  const dispatch = await dispatchWhatsAppMessage({
    phoneDigits: digits,
    messageText: messageContent,
    userAgent,
  });

  const finalStatus: DeliveryStatus = initialDeliveryStatus || dispatch.initialStatus;
  if (finalStatus !== initialStatus) {
    await prisma.messageLog.update({
      where: { id: log.id },
      data: {
        deliveryStatus: finalStatus,
        deliveryUpdatedAt: new Date(),
      },
    });
  }

  // 4. Trilha de Auditoria com schoolId raiz
  await logAudit({
    action: "SEND_MESSAGE",
    entityType: "MessageLog",
    entityId: log.id,
    details: {
      studentName: student.name,
      turma: student.classGroup.name,
      reason: reasonTitle,
      phone: digits,
      deliveryStatus: finalStatus,
      providerMode: dispatch.mode,
      contentHash,
      messageSnippet: messageContent.slice(0, 100),
    },
    user: {
      id: userId,
      name: userName,
      email: userEmail,
    },
    schoolId: currentSchoolId,
    req,
  });

  return {
    ok: true,
    data: {
      success: true,
      logId: log.id,
      whatsappUrl: dispatch.whatsappUrl,
      deliveryStatus: finalStatus,
      providerMode: dispatch.mode,
      contentHash,
    },
  };
}

/**
 * Reverte mensagens presas em DISPATCHING há mais de `staleMinutes` de volta para QUEUED
 * dentro do escopo exclusivo da escola informada, e reclama atomicamente até `limit`
 * mensagens na fila via `FOR UPDATE OF ml SKIP LOCKED`.
 */
export async function claimPendingQueuedMessages(options: {
  schoolId: string;
  limit?: number;
  staleDispatchMinutes?: number;
}): Promise<ClaimedPendingMessage[]> {
  const safeLimit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const staleMinutes = Math.max(1, Math.min(options.staleDispatchMinutes ?? 5, 60));
  const staleThreshold = new Date(Date.now() - staleMinutes * 60_000);

  // 1. Recuperação automática de mensagens presas em DISPATCHING caso o companion tenha caído
  if (typeof prisma.$executeRaw === "function") {
    try {
      await prisma.$executeRaw`
        UPDATE "MessageLog" ml
        SET "deliveryStatus" = 'QUEUED',
            "deliveryUpdatedAt" = NOW()
        FROM "Student" s
        WHERE ml."studentId" = s."id"
          AND s."schoolId" = ${options.schoolId}
          AND ml."deliveryStatus" = 'DISPATCHING'
          AND COALESCE(ml."deliveryUpdatedAt", ml."sentAt") < ${staleThreshold}
      `;
    } catch (err) {
      console.warn("[messageDispatchService] Aviso ao recuperar mensagens DISPATCHING órfãs:", err);
    }
  }

  // 2. Claim atômico (statement único compatível com PgBouncer transaction-mode)
  const claimed = await prisma.$queryRaw<ClaimedPendingMessage[]>`
    UPDATE "MessageLog"
    SET "deliveryStatus" = 'DISPATCHING',
        "deliveryUpdatedAt" = NOW()
    WHERE "id" IN (
      SELECT ml."id"
      FROM "MessageLog" ml
      INNER JOIN "Student" s ON s."id" = ml."studentId"
      WHERE s."schoolId" = ${options.schoolId}
        AND ml."deliveryStatus" = 'QUEUED'
      ORDER BY ml."sentAt" ASC
      LIMIT ${safeLimit}
      FOR UPDATE OF ml SKIP LOCKED
    )
    RETURNING
      "id",
      "studentId",
      "phoneUsed",
      "reasonTitle",
      "messageContent",
      "sentByName",
      "sentAt",
      "contentHash",
      "deliveryStatus",
      "deliveryUpdatedAt"
  `;

  return claimed;
}
