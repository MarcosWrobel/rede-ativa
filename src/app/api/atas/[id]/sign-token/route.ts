import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const { participantId, expiresInMinutes } = await req.json();

    if (!participantId) {
      return NextResponse.json({ error: "Informe o ID do participante" }, { status: 400 });
    }

    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!minute) {
      return NextResponse.json({ error: "Ata não encontrada" }, { status: 404 });
    }

    if (minute.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Não é possível emitir link de assinatura para uma ata já lavrada ou cancelada." },
        { status: 400 }
      );
    }

    const participant = await prisma.pedagogicalMinuteParticipant.findFirst({
      where: { id: participantId, minuteId: id },
    });

    if (!participant) {
      return NextResponse.json({ error: "Participante não encontrado nesta ata" }, { status: 404 });
    }

    // Validade configurável: padrão 20 minutos, ou até 24 horas (1440 min)
    const validMinutes = Math.min(Math.max(Number(expiresInMinutes) || 20, 5), 1440);
    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);

    const updated = await prisma.pedagogicalMinuteParticipant.update({
      where: { id: participantId },
      data: {
        mobileSignToken: token,
        mobileSignExpiresAt: expiresAt,
      },
    });

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3001";
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const signUrl = `${proto}://${host}/assinar/ata/${token}`;

    return NextResponse.json({
      success: true,
      token,
      signUrl,
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: validMinutes,
      participantName: updated.name,
    });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/sign-token] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao gerar token mobile" }, { status: 500 });
  }
}
