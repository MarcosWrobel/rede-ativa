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
import { withTenantContext } from "@/lib/rlsTenantContext";

export interface DispatchMessageInput {
  studentId: string;
  templateId?: string | null;
  reasonTitle: string;
  messageContent: string;
  customPhone?: string | null;
  initialDeliveryStatus?: DeliveryStatus;
  currentSchoolId: string;
  currentSchoolInepCode?: string | null;
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
    currentSchoolInepCode,
    session,
    userId,
    userName,
    userEmail,
    userAgent,
    req,
  } = input;

  const resolvedSchoolId = currentSchoolId;
  const isPilotSchool =
    currentSchoolInepCode === "41042730" || resolvedSchoolId === "default-leopoldina";
  const initialStatus: DeliveryStatus = initialDeliveryStatus || "LINK_OPENED";

  // 1-2. Validação multi-tenant + persistência atômica dentro do contexto RLS da escola (Tx 1)
  const txResult = await withTenantContext(prisma, resolvedSchoolId, async (tx) => {
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        schoolId: true,
        classGroupId: true,
        name: true,
        phone: true,
      },
    });

    if (
      !student ||
      !assertTenantOwnership(student.schoolId, resolvedSchoolId, session) ||
      student.schoolId !== resolvedSchoolId
    ) {
      return {
        ok: false as const,
        status: 404,
        error: "Aluno não encontrado nesta instituição",
      };
    }

    const classGroup = student.classGroupId
      ? await tx.classGroup.findUnique({
          where: { id: student.classGroupId },
          select: { id: true, schoolId: true, name: true },
        })
      : null;

    if (
      !classGroup ||
      !assertTenantOwnership(classGroup.schoolId, resolvedSchoolId, session) ||
      classGroup.schoolId !== resolvedSchoolId
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "Turma do estudante não pertence ou não está disponível nesta instituição.",
      };
    }

    let validatedTemplateId: string | null = null;
    if (templateId) {
      const template = await tx.messageTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, schoolId: true },
      });
      if (!template) {
        return {
          ok: false as const,
          status: 404,
          error: "Modelo de mensagem não encontrado.",
        };
      }
      const isGlobalTemplateAllowedForPilot = template.schoolId === null && isPilotSchool;
      if (
        !isGlobalTemplateAllowedForPilot &&
        (!template.schoolId ||
          !assertTenantOwnership(template.schoolId, resolvedSchoolId, session) ||
          template.schoolId !== student.schoolId)
      ) {
        return {
          ok: false as const,
          status: 403,
          error: "Modelo de mensagem não pertence a esta instituição.",
        };
      }
      validatedTemplateId = template.id;
    }

    const digits = normalizeWhatsAppPhone(customPhone || student.phone);
    if (!digits || digits.length < 10) {
      return {
        ok: false as const,
        status: 400,
        error: "Telefone inválido para envio no WhatsApp",
      };
    }

    const sentAt = new Date();

    // Calcular Hash SHA-256 canônico de integridade probatória (JUR-02)
    const contentHash = computeMessageContentHash({
      studentId: student.id,
      schoolId: resolvedSchoolId,
      phoneUsed: digits,
      reasonTitle,
      messageContent,
      sentByName: userName,
      sentAt,
    });

    const log = await tx.messageLog.create({
      data: {
        schoolId: resolvedSchoolId,
        studentId: student.id,
        templateId: validatedTemplateId,
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

    return {
      ok: true as const,
      log,
      student,
      validatedClassGroupName: classGroup.name,
      digits,
      contentHash,
    };
  });

  if (!txResult.ok) {
    return txResult;
  }

  const { log, student, validatedClassGroupName, digits, contentHash } = txResult;

  // 3. Despacho no gateway / construção de URL otimizada wa.me (somente após commit da Tx 1)
  const dispatch = await dispatchWhatsAppMessage({
    phoneDigits: digits,
    messageText: messageContent,
    userAgent,
  });

  const finalStatus: DeliveryStatus = initialDeliveryStatus || dispatch.initialStatus;
  if (finalStatus !== initialStatus) {
    await withTenantContext(prisma, resolvedSchoolId, async (tx) => {
      await tx.messageLog.update({
        where: { id: log.id },
        data: {
          deliveryStatus: finalStatus,
          deliveryUpdatedAt: new Date(),
        },
      });
    });
  }

  // 4. Trilha de Auditoria com schoolId raiz
  await logAudit({
    action: "SEND_MESSAGE",
    entityType: "MessageLog",
    entityId: log.id,
    details: {
      studentName: student.name,
      turma: validatedClassGroupName,
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
