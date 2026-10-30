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
    const { participantId } = await req.json();

    if (!participantId) {
      return NextResponse.json({ error: "Informe o ID do participante" }, { status: 400 });
    }

    const participant = await prisma.pedagogicalMinuteParticipant.findFirst({
      where: { id: participantId, minuteId: id },
    });

    if (!participant) {
      return NextResponse.json({ error: "Participante não encontrado nesta ata" }, { status: 404 });
    }

    // Gera token de 32 caracteres com validade de 20 minutos
    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

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
      participantName: updated.name,
    });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/sign-token] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao gerar token mobile" }, { status: 500 });
  }
}
