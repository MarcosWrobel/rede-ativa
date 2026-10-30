import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const voidAtaSchema = z.object({
  reason: z.string().min(10, "A justificativa para tornar a ata sem efeito deve ter no mínimo 10 caracteres"),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const ip = extractClientIp(req);

    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
    });

    if (!minute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    if (minute.status !== "FINALIZED") {
      return NextResponse.json(
        { error: "Apenas atas lavradas (FINALIZED) podem receber averbação de cancelamento ('Tornada Sem Efeito'). Rascunhos devem ser descartados." },
        { status: 400 }
      );
    }

    const rawBody = await req.json();
    const parsed = voidAtaSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const now = new Date();
    const updated = await prisma.pedagogicalMinute.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidedAt: now,
        voidedByName: authCheck.userName || "Equipe Pedagógica",
        voidedByEmail: authCheck.email,
        voidReason: parsed.data.reason.trim(),
      },
    });

    await logAudit({
      action: "VOID_ATA",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Ata nº ${String(minute.ataNumber).padStart(3, "0")}/${minute.year} TORNADA SEM EFEITO. Motivo: ${parsed.data.reason}`,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute: updated });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/void] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao averbar cancelamento" }, { status: 500 });
  }
}
