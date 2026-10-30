import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { maskName, maskDocument, maskEmail } from "@/lib/ataCrypto";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const cleanCode = code.toUpperCase().trim();

    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { verificationCode: cleanCode },
      include: {
        school: {
          select: { name: true, city: true, state: true, nre: true, inepCode: true },
        },
        participants: {
          select: {
            role: true,
            name: true,
            documentNumber: true,
            signatureMode: true,
            signedAt: true,
            verifiedEmail: true,
            biometricVerified: true,
          },
        },
        addendums: {
          select: { createdAt: true, authorName: true, addendumHash: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!minute) {
      return NextResponse.json({ error: "Documento não encontrado ou código de verificação inválido." }, { status: 404 });
    }

    // Retorna APENAS dados institucionais e metadados criptográficos mascarados (LGPD-safe)
    // O texto da ata e dados sensíveis de menores NUNCA são expostos na internet pública!
    const maskedResponse = {
      isAuthentic: true,
      verificationCode: minute.verificationCode,
      school: minute.school,
      ataNumber: minute.ataNumber,
      year: minute.year,
      status: minute.status,
      category: minute.category,
      attendedAt: minute.attendedAt,
      finalizedAt: minute.finalizedAt,
      authorName: maskName(minute.authorName),
      authorRole: minute.authorRole,
      contentHash: minute.contentHash,
      participants: minute.participants.map((p) => ({
        role: p.role,
        maskedName: maskName(p.name),
        maskedDoc: maskDocument(p.documentNumber),
        maskedEmail: p.verifiedEmail ? maskEmail(p.verifiedEmail) : null,
        isEscolaSigned: Boolean(p.verifiedEmail),
        signatureMode: p.signatureMode,
        biometricVerified: Boolean(p.biometricVerified),
        signedAt: p.signedAt,
      })),
      addendumsCount: minute.addendums.length,
      addendums: minute.addendums.map((a, idx) => ({
        index: idx + 1,
        createdAt: a.createdAt,
        author: maskName(a.authorName),
        hash: a.addendumHash,
      })),
      isVoided: minute.status === "VOIDED",
      voidedAt: minute.voidedAt,
      voidReason: minute.voidReason ? "Ata tornada sem efeito pela Direção/Equipe Pedagógica por motivo administrativo." : null,
    };

    return NextResponse.json({ success: true, data: maskedResponse });
  } catch (error: any) {
    console.error("[GET /api/atas/public/[code]] Erro:", error);
    return NextResponse.json({ error: "Erro ao verificar documento" }, { status: 500 });
  }
}
