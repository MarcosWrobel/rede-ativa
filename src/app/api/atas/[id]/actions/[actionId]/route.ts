import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateActionSchema = z.object({
  status: z.enum(["PENDING", "COMPLETED", "CANCELED"]),
  completionNotes: z.string().optional().nullable(),
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

    const rawBody = await req.json();
    const parsed = updateActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const isCompleted = parsed.data.status === "COMPLETED";

    const updated = await prisma.pedagogicalActionItem.update({
      where: { id: actionId },
      data: {
        status: parsed.data.status,
        completedAt: isCompleted ? new Date() : null,
        completedByName: isCompleted ? authCheck.userName || "Equipe Pedagógica" : null,
        completionNotes: parsed.data.completionNotes || null,
      },
    });

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
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, actionItem: updated });
  } catch (error: any) {
    console.error("[PATCH /api/atas/[id]/actions/[actionId]] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao atualizar encaminhamento" }, { status: 500 });
  }
}
