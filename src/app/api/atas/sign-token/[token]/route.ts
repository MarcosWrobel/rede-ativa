import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractClientIp } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const submitSignSchema = z.object({
  signatureData: z.string().min(20, "Traço de assinatura inválido"),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const participant = await prisma.pedagogicalMinuteParticipant.findUnique({
      where: { mobileSignToken: token },
      include: {
        minute: {
          select: {
            id: true,
            subject: true,
            attendedAt: true,
            school: { select: { name: true } },
          },
        },
      },
    });

    if (!participant) {
      return NextResponse.json({ error: "Link de assinatura inválido ou expirado." }, { status: 404 });
    }

    if (participant.mobileSignExpiresAt && new Date() > participant.mobileSignExpiresAt) {
      return NextResponse.json({ error: "Este link de assinatura expirou (limite de 20 minutos)." }, { status: 410 });
    }

    return NextResponse.json({
      success: true,
      participant: {
        id: participant.id,
        name: participant.name,
        role: participant.role,
        hasSigned: Boolean(participant.signatureData),
        schoolName: participant.minute.school.name,
        subject: participant.minute.subject,
        attendedAt: participant.minute.attendedAt,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/atas/sign-token/[token]] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar token" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const ip = extractClientIp(req);

    const participant = await prisma.pedagogicalMinuteParticipant.findUnique({
      where: { mobileSignToken: token },
      include: { minute: true },
    });

    if (!participant) {
      return NextResponse.json({ error: "Link de assinatura inválido ou expirado." }, { status: 404 });
    }

    if (participant.mobileSignExpiresAt && new Date() > participant.mobileSignExpiresAt) {
      return NextResponse.json({ error: "Este link de assinatura expirou." }, { status: 410 });
    }

    const rawBody = await req.json();
    const parsed = submitSignSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Assinatura inválida" }, { status: 400 });
    }

    const now = new Date();
    await prisma.pedagogicalMinuteParticipant.update({
      where: { id: participant.id },
      data: {
        signatureMode: "MOBILE_QR",
        signatureData: parsed.data.signatureData,
        signedAt: now,
        signerIp: ip,
        mobileSignToken: null, // Queima o token de uso único
        mobileSignExpiresAt: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Assinatura coletada com sucesso. Obrigado!",
    });
  } catch (error: any) {
    console.error("[POST /api/atas/sign-token/[token]] Erro:", error);
    return NextResponse.json({ error: "Erro ao gravar assinatura" }, { status: 500 });
  }
}
