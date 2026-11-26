import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageDeliveryStatusUpdateSchema } from "@/lib/schemas";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { resolveEffectiveRoleForSchool } from "@/lib/serverAuthContext";
import { isAllowedMessagingRole } from "@/lib/roles";
import { withTenantContext } from "@/lib/rlsTenantContext";

async function handleStatusUpdate(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot,
      { allowSuperAdminReadOnlyFallback: false }
    );
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;

    const effectiveRole =
      (authCheck.snapshot
        ? resolveEffectiveRoleForSchool(authCheck.snapshot, currentSchool)
        : authCheck.role) || "";

    if (!isAllowedMessagingRole(effectiveRole)) {
      return NextResponse.json(
        { error: "Perfil sem autorização para atualizar status de mensagens nesta instituição." },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = messageDeliveryStatusUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { logId, deliveryStatus } = parsed.data;

    const txResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      if (typeof (tx as { $queryRaw?: unknown }).$queryRaw === "function") {
        await tx.$queryRaw`SELECT "id" FROM "MessageLog" WHERE "id" = ${logId} FOR UPDATE`;
      }

      const existing = await tx.messageLog.findUnique({
        where: { id: logId },
        include: {
          student: {
            include: {
              classGroup: true,
              contacts: true,
            },
          },
        },
      });

      if (!existing) {
        return {
          ok: false as const,
          status: 404,
          error: "Registro de envio não encontrado",
        };
      }

      const studentSchoolId = existing.student?.schoolId;
      const logSchoolCoherent =
        existing.schoolId == null ||
        (existing.schoolId === currentSchool.id && existing.schoolId === studentSchoolId);

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

      const updated = await tx.messageLog.update({
        where: { id: logId },
        data: {
          deliveryStatus,
          deliveryUpdatedAt: new Date(),
        },
      });

      // AUT-01: Saneamento automático do telefone no cadastro familiar do estudante na mesma transação
      const normalizedTarget = normalizeWhatsAppPhone(existing.phoneUsed);
      let syncedContactInvalidated = false;

      const matchingContacts = existing.student.contacts.filter(
        (c) => normalizeWhatsAppPhone(c.phone) === normalizedTarget
      );

      if (deliveryStatus === "FAILED_NO_WHATSAPP") {
        if (matchingContacts.length > 0) {
          await tx.studentContact.updateMany({
            where: { id: { in: matchingContacts.map((c) => c.id) } },
            data: { whatsappValid: false },
          });
        } else {
          await tx.studentContact.create({
            data: {
              studentId: existing.studentId,
              name: existing.student.guardianName || "Contato Cadastral",
              kinship: "RESPONSAVEL",
              phone: existing.phoneUsed,
              isPrimary: normalizeWhatsAppPhone(existing.student.phone) === normalizedTarget,
              whatsappValid: false,
              notes: `Sinalizado sem WhatsApp em ${new Date().toLocaleDateString("pt-BR")} por ${authCheck.userName}`,
            },
          });
        }
        syncedContactInvalidated = true;
      } else if (
        (deliveryStatus === "SENT" || deliveryStatus === "DELIVERED" || deliveryStatus === "READ") &&
        matchingContacts.some((c) => !c.whatsappValid)
      ) {
        await tx.studentContact.updateMany({
          where: { id: { in: matchingContacts.map((c) => c.id) } },
          data: { whatsappValid: true },
        });
      }

      return {
        ok: true as const,
        existing,
        updated,
        syncedContactInvalidated,
      };
    });

    if (!txResult.ok) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status });
    }

    const { existing, updated, syncedContactInvalidated } = txResult;

    await logAudit({
      action: "UPDATE_DELIVERY_STATUS",
      entityType: "MessageLog",
      entityId: logId,
      details: {
        studentName: existing.student.name,
        turma: existing.student.classGroup.name,
        phoneUsed: existing.phoneUsed,
        previousStatus: existing.deliveryStatus,
        newStatus: deliveryStatus,
        contactFlaggedInvalid: syncedContactInvalidated,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({
      success: true,
      updated,
      contactFlaggedInvalid: syncedContactInvalidated,
    });
  } catch (error: any) {
    console.error("Erro ao atualizar status de entrega:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar status de entrega" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  return handleStatusUpdate(req);
}

export async function POST(req: Request) {
  return handleStatusUpdate(req);
}
