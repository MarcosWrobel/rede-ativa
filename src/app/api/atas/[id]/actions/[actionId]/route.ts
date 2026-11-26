import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import { evaluateMinuteRevisionLock } from "@/lib/ataRevision";
import { buildSessionFromSnapshot } from "@/lib/serverAuthContext";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateActionSchema = z.object({
  status: z.enum(["PENDING", "COMPLETED", "CANCELED"]),
  completionNotes: z.string().optional().nullable(),
  expectedRevision: z.number().int().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id, actionId } = await params;
    const ip = extractClientIp(req);

    const actionItem = await prisma.pedagogicalActionItem.findFirst({
      where: { id: actionId, minuteId: id },
      include: { minute: true },
    });

    if (!actionItem) {
      return NextResponse.json({ error: "Encaminhamento não encontrado" }, { status: 404 });
    }

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const effectiveSession = authCheck.snapshot
      ? buildSessionFromSnapshot(authCheck.session, authCheck.snapshot, currentSchool)
      : authCheck.session;
    if (!assertTenantOwnership(actionItem.minute.schoolId, currentSchool.id, effectiveSession)) {
      return NextResponse.json({ error: "Acesso negado a registro de outra instituição de ensino." }, { status: 403 });
    }

    if (!canAccessConfidentialMinute(actionItem.minute, effectiveSession)) {
      return NextResponse.json(
        { error: "Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor." },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = updateActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const isCompleted = parsed.data.status === "COMPLETED";

    let updated: any;
    if (actionItem.minute.status === "DRAFT") {
      const runTx =
        typeof prisma.$transaction === "function"
          ? prisma.$transaction.bind(prisma)
          : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

      updated = await runTx(async (tx) => {
        await acquireMinuteWriteLock(tx, id);

        const lockedMinute = await tx.pedagogicalMinute.findUnique({
          where: { id },
          include: { participants: true },
        });
        if (!lockedMinute) {
          throw new Error("NOT_FOUND:Ata pedagógica não encontrada");
        }
        if (!assertTenantOwnership(lockedMinute.schoolId, currentSchool.id, effectiveSession)) {
          throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
        }
        if (!canAccessConfidentialMinute(lockedMinute, effectiveSession)) {
          throw new Error(
            "FORBIDDEN:Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor."
          );
        }

        const lockState = evaluateMinuteRevisionLock(lockedMinute);
        if (lockedMinute.status === "DRAFT" && lockState.isLockedBySignature) {
          throw new Error(
            "CONFLICT:Esta ata já possui assinatura registrada na revisão atual e seus encaminhamentos não podem ser alterados sem reabertura."
          );
        }
        if (
          lockedMinute.status === "DRAFT" &&
          parsed.data.expectedRevision !== undefined &&
          parsed.data.expectedRevision !== lockState.currentRevision
        ) {
          throw new Error(
            "CONFLICT:O rascunho desta ata foi atualizado para outra revisão. Recarregue antes de alterar."
          );
        }

        const freshItem = await tx.pedagogicalActionItem.findFirst({
          where: { id: actionId, minuteId: id },
        });
        if (!freshItem) {
          throw new Error("NOT_FOUND:Encaminhamento não encontrado");
        }

        const saved = await tx.pedagogicalActionItem.update({
          where: { id: actionId },
          data: {
            status: parsed.data.status,
            completedAt: isCompleted ? new Date() : null,
            completedByName: isCompleted ? authCheck.userName || "Equipe Pedagógica" : null,
            completionNotes: parsed.data.completionNotes || null,
          },
        });

        const changedEffective =
          freshItem.status !== parsed.data.status ||
          (parsed.data.completionNotes ?? null) !== (freshItem.completionNotes ?? null);

        if (lockedMinute.status === "DRAFT" && changedEffective) {
          await tx.pedagogicalMinuteParticipant.updateMany({
            where: { minuteId: id },
            data: {
              mobileSignToken: null,
              mobileSignExpiresAt: null,
              mobileSignRevision: null,
              hasActiveSignLink: false,
            },
          });
          await tx.pedagogicalMinute.update({
            where: { id },
            data: { contentRevision: lockState.currentRevision + 1 },
          });
        }

        return saved;
      });
    } else {
      updated = await prisma.pedagogicalActionItem.update({
        where: { id: actionId },
        data: {
          status: parsed.data.status,
          completedAt: isCompleted ? new Date() : null,
          completedByName: isCompleted ? authCheck.userName || "Equipe Pedagógica" : null,
          completionNotes: parsed.data.completionNotes || null,
        },
      });
    }

    await logAudit({
      action: "UPDATE_ATA_ACTION",
      entityType: "PedagogicalActionItem",
      entityId: actionId,
      details: `Status do encaminhamento da Ata ${actionItem.minute.ataNumber || "rascunho"} alterado para ${parsed.data.status}: ${actionItem.description}`,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, actionItem: updated });
  } catch (error: any) {
    const msg = error?.message || "";
    if (msg.startsWith("NOT_FOUND:")) {
      return NextResponse.json({ error: msg.replace("NOT_FOUND:", "") }, { status: 404 });
    }
    if (msg.startsWith("FORBIDDEN:")) {
      return NextResponse.json({ error: msg.replace("FORBIDDEN:", "") }, { status: 403 });
    }
    if (msg.startsWith("CONFLICT:")) {
      return NextResponse.json({ error: msg.replace("CONFLICT:", "") }, { status: 409 });
    }
    console.error("[PATCH /api/atas/[id]/actions/[actionId]] Erro:", error);
    return NextResponse.json({ error: "Erro ao atualizar encaminhamento" }, { status: 500 });
  }
}
