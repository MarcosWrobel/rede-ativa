import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth, requireSchoolAdmin } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { computeMessageContentHash } from "@/lib/messageCrypto";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { lockScopedMessageLogForUpdate } from "@/services/messageDispatchService";
import {
  formatZodError,
  messageManageUpdateSchema,
  messageManageDeleteSchema,
} from "@/lib/schemas";

async function authorizeManageSchool() {
  const authCheck = await requireAuth();
  if (!authCheck.ok) {
    return { ok: false as const, response: authCheck.response };
  }

  const schoolCheck = await requireAuthorizedSchool(
    authCheck.session,
    authCheck.schoolId,
    authCheck.snapshot,
    { allowSuperAdminReadOnlyFallback: false }
  );
  if (!schoolCheck.ok) {
    return { ok: false as const, response: schoolCheck.response };
  }

  const adminCheck = await requireSchoolAdmin(schoolCheck.school.id);
  if (!adminCheck.ok) {
    return { ok: false as const, response: adminCheck.response };
  }

  return {
    ok: true as const,
    authCheck: adminCheck,
    currentSchool: schoolCheck.school,
  };
}

// PUT: Editar campos de um registro do histórico (Restrito à Gestão Escolar da unidade ou SuperAdmin)
export async function PUT(req: Request) {
  try {
    const authRes = await authorizeManageSchool();
    if (!authRes.ok) return authRes.response;
    const { authCheck, currentSchool } = authRes;

    const body = await req.json();
    const parsed = messageManageUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const {
      id,
      sentAt,
      reasonTitle,
      phoneUsed,
      sentByName,
      guardianReplied,
      replyNotes,
      replyCategory,
      deliveryStatus,
      messageContent,
    } = parsed.data;

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const lockStatus = await lockScopedMessageLogForUpdate(tx, id, currentSchool.id);
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
        where: { id },
        include: {
          student: true,
        },
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

      const classGroup = previous.student.classGroupId
        ? await tx.classGroup.findFirst({
            where: {
              id: previous.student.classGroupId,
              schoolId: currentSchool.id,
            },
          })
        : null;

      if (
        !classGroup ||
        !assertTenantOwnership(classGroup.schoolId, currentSchool.id, authCheck.session) ||
        classGroup.schoolId !== currentSchool.id
      ) {
        return {
          ok: false as const,
          status: 403,
          error: "Turma do estudante não pertence ou não está disponível nesta instituição.",
        };
      }

      const updateData: any = {};
      if (reasonTitle !== undefined) updateData.reasonTitle = reasonTitle;
      if (phoneUsed !== undefined) updateData.phoneUsed = phoneUsed;
      if (sentByName !== undefined) updateData.sentByName = sentByName;
      if (messageContent !== undefined) updateData.messageContent = messageContent;
      if (sentAt) updateData.sentAt = new Date(sentAt);
      if (guardianReplied !== undefined) {
        updateData.guardianReplied = Boolean(guardianReplied);
        updateData.repliedAt = Boolean(guardianReplied) ? previous.repliedAt || new Date() : null;
        updateData.repliedByUserId = Boolean(guardianReplied)
          ? previous.repliedByUserId || authCheck.userId || null
          : null;
      }
      if (replyNotes !== undefined) updateData.replyNotes = replyNotes;
      if (replyCategory !== undefined) updateData.replyCategory = replyCategory || null;
      if (deliveryStatus !== undefined) {
        updateData.deliveryStatus = deliveryStatus;
        updateData.deliveryUpdatedAt = new Date();
      }

      // Recalcula o Hash SHA-256 canônico de integridade probatória a partir dos valores que serão persistidos
      const effectiveSentAt = updateData.sentAt || previous.sentAt;
      const effectiveReason =
        updateData.reasonTitle !== undefined ? updateData.reasonTitle : previous.reasonTitle;
      const effectivePhone =
        updateData.phoneUsed !== undefined ? updateData.phoneUsed : previous.phoneUsed;
      const effectiveContent =
        updateData.messageContent !== undefined
          ? updateData.messageContent
          : previous.messageContent;
      const effectiveSentByName =
        updateData.sentByName !== undefined ? updateData.sentByName : previous.sentByName;
      const effectiveGuardianReplied =
        updateData.guardianReplied !== undefined
          ? updateData.guardianReplied
          : Boolean(previous.guardianReplied);
      const effectiveReplyNotes =
        updateData.replyNotes !== undefined ? updateData.replyNotes : previous.replyNotes;
      const effectiveReplyCategory =
        updateData.replyCategory !== undefined ? updateData.replyCategory : previous.replyCategory;
      const effectiveRepliedAt =
        updateData.repliedAt !== undefined ? updateData.repliedAt : previous.repliedAt;

      updateData.contentHash = computeMessageContentHash({
        studentId: previous.studentId,
        schoolId: studentSchoolId,
        phoneUsed: effectivePhone,
        reasonTitle: effectiveReason,
        messageContent: effectiveContent,
        sentByName: effectiveSentByName,
        sentAt: effectiveSentAt,
        guardianReplied: effectiveGuardianReplied,
        replyNotes: effectiveReplyNotes,
        replyCategory: effectiveReplyCategory,
        repliedAt: effectiveRepliedAt,
      });

      const updatedRow = await tx.messageLog.update({
        where: { id },
        data: updateData,
      });

      const updated = {
        ...updatedRow,
        student: {
          ...previous.student,
          classGroup,
        },
      };

      return {
        ok: true as const,
        previous,
        validatedClassGroupName: classGroup.name,
        updated,
      };
    });

    if (!txResult.ok) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status });
    }

    const { previous, validatedClassGroupName, updated } = txResult;

    await logAudit({
      action: "UPDATE_MESSAGE_LOG",
      entityType: "MessageLog",
      entityId: id,
      details: {
        studentName: previous.student.name,
        classGroup: validatedClassGroupName,
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
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error("Erro ao atualizar histórico:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar histórico de mensagens" }, { status: 500 });
  }
}

// DELETE: Excluir um registro do histórico (Restrito à Gestão Escolar da unidade ou SuperAdmin)
export async function DELETE(req: Request) {
  try {
    const authRes = await authorizeManageSchool();
    if (!authRes.ok) return authRes.response;
    const { authCheck, currentSchool } = authRes;

    const { searchParams } = new URL(req.url);
    const parsedQuery = messageManageDeleteSchema.safeParse({ id: searchParams.get("id") });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: formatZodError(parsedQuery.error) }, { status: 400 });
    }
    const { id } = parsedQuery.data;

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const lockStatus = await lockScopedMessageLogForUpdate(tx, id, currentSchool.id);
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
        where: { id },
        include: {
          student: {
            select: {
              id: true,
              schoolId: true,
              classGroupId: true,
              name: true,
            },
          },
        },
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

      const classGroup = previous.student.classGroupId
        ? await tx.classGroup.findFirst({
            where: {
              id: previous.student.classGroupId,
              schoolId: currentSchool.id,
            },
            select: { id: true, schoolId: true, name: true },
          })
        : null;

      if (
        !classGroup ||
        !assertTenantOwnership(classGroup.schoolId, currentSchool.id, authCheck.session) ||
        classGroup.schoolId !== currentSchool.id
      ) {
        return {
          ok: false as const,
          status: 403,
          error: "Turma do estudante não pertence ou não está disponível nesta instituição.",
        };
      }

      await tx.messageLog.delete({
        where: { id },
      });

      return {
        ok: true as const,
        previous,
        validatedClassGroupName: classGroup.name,
      };
    });

    if (!txResult.ok) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status });
    }

    const { previous, validatedClassGroupName } = txResult;

    await logAudit({
      action: "DELETE_MESSAGE_LOG",
      entityType: "MessageLog",
      entityId: id,
      details: {
        studentName: previous.student.name,
        classGroup: validatedClassGroupName,
        reasonTitle: previous.reasonTitle,
        phoneUsed: previous.phoneUsed,
        sentByName: previous.sentByName,
        sentAt: previous.sentAt,
        messageContent: previous.messageContent,
        guardianReplied: previous.guardianReplied,
        replyNotes: previous.replyNotes,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error: any) {
    console.error("Erro ao excluir do histórico:", error);
    return NextResponse.json({ error: "Erro interno ao excluir registro de mensagem" }, { status: 500 });
  }
}
