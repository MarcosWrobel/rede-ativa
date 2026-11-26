import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageReplySchema } from "@/lib/schemas";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { computeMessageContentHash } from "@/lib/messageCrypto";
import {
  classifyGuardianReplyHeuristic,
  type ReplyCategory,
} from "@/lib/whatsappProvider";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { resolveEffectiveRoleForSchool } from "@/lib/serverAuthContext";
import { isAllowedMessagingRole } from "@/lib/roles";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { lockScopedMessageLogForUpdate } from "@/services/messageDispatchService";

function classifyReplyLocally(rawText: string): {
  formalSummary: string;
  category: ReplyCategory;
} {
  const heuristic = classifyGuardianReplyHeuristic(rawText);
  return {
    formalSummary: heuristic.formalSummary,
    category: heuristic.category,
  };
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rateLimitKey = `msg-reply:${authCheck.schoolId || "global"}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.MESSAGE_REPLY);
    if (!rlCheck.ok) return rlCheck.response;

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot,
      { allowSuperAdminReadOnlyFallback: false }
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;

    const effectiveRole =
      (authCheck.snapshot
        ? resolveEffectiveRoleForSchool(authCheck.snapshot, currentSchool)
        : authCheck.role) || "";

    if (!isAllowedMessagingRole(effectiveRole)) {
      return NextResponse.json(
        { error: "Perfil sem autorização para registrar retorno nesta instituição." },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = messageReplySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const {
      logId,
      guardianReplied,
      replyNotes,
      replyCategory,
      rawReply,
      extractedAt,
      sourceMethod = "MANUAL",
      classifyWithAi = false,
    } = parsed.data;

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const lockStatus = await lockScopedMessageLogForUpdate(tx, logId, currentSchool.id);
      if (lockStatus === "NOT_FOUND") {
        return { ok: false as const, status: 404, error: "Registro não encontrado" };
      }
      if (lockStatus === "FORBIDDEN") {
        return {
          ok: false as const,
          status: 403,
          error: "Acesso negado a registro de outra instituição de ensino.",
        };
      }

      const previous = await tx.messageLog.findUnique({
        where: { id: logId },
        include: { student: true },
      });

      if (!previous) {
        return { ok: false as const, status: 404, error: "Registro não encontrado" };
      }

      const studentSchoolId = previous.student?.schoolId;
      const logSchoolCoherent =
        previous.schoolId == null ||
        (previous.schoolId === currentSchool.id && previous.schoolId === studentSchoolId);

      if (
        !assertTenantOwnership(studentSchoolId, currentSchool.id, authCheck.session) ||
        studentSchoolId !== currentSchool.id ||
        !logSchoolCoherent
      ) {
        return {
          ok: false as const,
          status: 403,
          error: "Acesso negado a registro de outra instituição de ensino.",
        };
      }

      let finalReplyNotes: string | null =
        replyNotes !== undefined ? replyNotes : previous.replyNotes;
      let finalReplyCategory: string | null =
        replyCategory !== undefined ? replyCategory : previous.replyCategory;
      let finalRepliedAt: Date | null = null;

      if (guardianReplied === true) {
        const baseText = (rawReply || replyNotes || "").trim();
        const shouldClassify =
          (classifyWithAi === true || (!replyNotes && Boolean(rawReply))) && Boolean(baseText);

        if (shouldClassify) {
          const classification = classifyReplyLocally(baseText);

          if (!replyCategory || classifyWithAi) {
            finalReplyCategory = classification.category;
          }
          if (!replyNotes || classifyWithAi) {
            finalReplyNotes = classification.formalSummary;
          }
        }

        if (extractedAt) {
          const parsedExtracted =
            extractedAt instanceof Date ? extractedAt : new Date(extractedAt);
          if (!isNaN(parsedExtracted.getTime())) {
            finalRepliedAt = parsedExtracted;
          } else {
            finalRepliedAt = new Date();
          }
        } else {
          finalRepliedAt = new Date();
        }
      } else {
        finalReplyNotes = null;
        finalReplyCategory = null;
        finalRepliedAt = null;
      }

      const newContentHash = computeMessageContentHash({
        studentId: previous.studentId,
        schoolId: studentSchoolId,
        phoneUsed: previous.phoneUsed,
        reasonTitle: previous.reasonTitle,
        messageContent: previous.messageContent,
        sentByName: previous.sentByName,
        sentAt: previous.sentAt,
        guardianReplied: Boolean(guardianReplied),
        replyNotes: finalReplyNotes,
        replyCategory: finalReplyCategory,
        repliedAt: finalRepliedAt,
      });

      const shouldUpgradeDelivery =
        Boolean(guardianReplied) &&
        (previous.deliveryStatus === "QUEUED" ||
          previous.deliveryStatus === "DISPATCHING" ||
          previous.deliveryStatus === "LINK_OPENED" ||
          previous.deliveryStatus === "SENT");

      const updated = await tx.messageLog.update({
        where: { id: logId },
        data: {
          guardianReplied: Boolean(guardianReplied),
          replyNotes: finalReplyNotes,
          replyCategory: finalReplyCategory,
          repliedAt: finalRepliedAt,
          repliedByUserId: Boolean(guardianReplied)
            ? authCheck.session?.user?.id || authCheck.userId || null
            : null,
          contentHash: newContentHash,
          ...(shouldUpgradeDelivery
            ? { deliveryStatus: "READ", deliveryUpdatedAt: new Date() }
            : {}),
        },
      });

      if (Boolean(guardianReplied) && previous.studentId && previous.phoneUsed) {
        const normalizedTarget = normalizeWhatsAppPhone(previous.phoneUsed);
        if (normalizedTarget && tx.studentContact?.updateMany) {
          const contacts = await tx.studentContact.findMany({
            where: { studentId: previous.studentId, whatsappValid: false },
          });
          const matchIds = contacts
            .filter((c) => normalizeWhatsAppPhone(c.phone) === normalizedTarget)
            .map((c) => c.id);
          if (matchIds.length > 0) {
            await tx.studentContact.updateMany({
              where: { id: { in: matchIds } },
              data: { whatsappValid: true },
            });
          }
        }
      }

      return {
        ok: true as const,
        previous,
        updated,
        newContentHash,
      };
    });

    if (!txResult.ok) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status });
    }

    const { previous, updated, newContentHash } = txResult;

    await logAudit({
      action: "MARK_REPLY",
      entityType: "MessageLog",
      entityId: logId,
      details: {
        previousReplied: previous.guardianReplied,
        newReplied: Boolean(guardianReplied),
        sourceMethod,
        classificationMode: "LOCAL_ONLY",
        replyCategory: updated.replyCategory,
        contentHash: newContentHash,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true, mode: "LOCAL_ONLY", updated });
  } catch {
    return NextResponse.json(
      { error: "Erro interno ao registrar resposta do responsável" },
      { status: 500 }
    );
  }
}
