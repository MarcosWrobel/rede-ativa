import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractClientIp } from "@/lib/audit";
import { z } from "zod";
import {
  verifyEscolaGoogleIdToken,
  verifyParticipantIdentityMatch,
} from "@/lib/escolaGoogleVerify";

export const dynamic = "force-dynamic";

const submitSignSchema = z.object({
  // Modo 1: Assinatura manuscrita em tela (canvas)
  signatureData: z.string().optional().nullable(),
  biometricVerified: z.boolean().default(false),
  biometricDeviceType: z.string().optional().nullable(),

  // Modo 2: Assinatura OIDC com conta institucional @escola.pr.gov.br
  googleIdToken: z.string().optional().nullable(),
  dryRun: z.boolean().default(false), // Apenas verifica titularidade sem salvar/queimar o token
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
            status: true,
            subject: true,
            summary: true,
            agreementsSummary: true,
            attendedAt: true,
            school: { select: { name: true } },
          },
        },
      },
    });

    if (!participant) {
      return NextResponse.json({ error: "Link de assinatura inválido ou expirado." }, { status: 404 });
    }

    if (participant.minute.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Esta ata pedagógica já foi finalizada ou cancelada." },
        { status: 410 }
      );
    }

    if (participant.mobileSignExpiresAt && new Date() > participant.mobileSignExpiresAt) {
      return NextResponse.json({ error: "Este link de assinatura expirou. Solicite um novo link à equipe escolar." }, { status: 410 });
    }

    return NextResponse.json({
      success: true,
      participant: {
        id: participant.id,
        name: participant.name,
        role: participant.role,
        expectedEmail: participant.expectedEmail,
        hasSigned: Boolean(participant.signatureData) || Boolean(participant.verifiedEmail),
        verifiedEmail: participant.verifiedEmail,
        schoolName: participant.minute.school.name,
        subject: participant.minute.subject,
        summary: participant.minute.summary,
        agreementsSummary: participant.minute.agreementsSummary,
        attendedAt: participant.minute.attendedAt,
        expiresAt: participant.mobileSignExpiresAt?.toISOString() || null,
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
      include: {
        minute: true,
      },
    });

    if (!participant) {
      return NextResponse.json({ error: "Link de assinatura inválido ou expirado." }, { status: 404 });
    }

    if (participant.minute.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Esta ata pedagógica já foi finalizada ou cancelada." },
        { status: 410 }
      );
    }

    if (participant.mobileSignExpiresAt && new Date() > participant.mobileSignExpiresAt) {
      return NextResponse.json({ error: "Este link de assinatura expirou." }, { status: 410 });
    }

    const rawBody = await req.json();
    const parsed = submitSignSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Payload de assinatura inválido" }, { status: 400 });
    }

    const { signatureData, biometricVerified, biometricDeviceType, googleIdToken, dryRun } = parsed.data;

    // FLUXO A: Assinatura Institucional via Google @escola.pr.gov.br
    if (googleIdToken) {
      const authResult = await verifyEscolaGoogleIdToken(googleIdToken);
      if (!authResult.ok || !authResult.tokenInfo) {
        return NextResponse.json(
          { error: authResult.error || "Não foi possível validar o token @escola.pr.gov.br." },
          { status: 401 }
        );
      }

      const { email: verifiedEmail, name: verifiedGoogleName, sub: verifiedGoogleSub } = authResult.tokenInfo;

      // Validação de titularidade contra o nome do participante (anti-colega)
      const matchCheck = verifyParticipantIdentityMatch({
        participantName: participant.name,
        expectedEmail: participant.expectedEmail,
        verifiedEmail,
        verifiedName: verifiedGoogleName,
      });

      if (!matchCheck.match) {
        return NextResponse.json(
          { error: matchCheck.reason || "A conta Google conectada não corresponde ao participante desta ata." },
          { status: 403 }
        );
      }

      // Se for apenas teste prévio / dry-run de verificação na UI do cliente
      if (dryRun) {
        return NextResponse.json({
          success: true,
          dryRun: true,
          verifiedEmail,
          verifiedGoogleName,
          message: "Conta institucional @escola.pr.gov.br verificada com sucesso!",
        });
      }

      const now = new Date();

      // Grava assinatura institucional em 1 clique
      await prisma.pedagogicalMinuteParticipant.update({
        where: { id: participant.id },
        data: {
          signatureMode: "ESCOLA_OAUTH",
          verifiedEmail,
          verifiedGoogleName: verifiedGoogleName || null,
          verifiedGoogleSub: verifiedGoogleSub || null,
          emailVerifiedAt: now,
          signedAt: now,
          signerIp: ip,
          signatureData: signatureData || null, // Se o usuário também desenhou opcionalmente
          biometricVerified: biometricVerified || false,
          biometricDeviceType: biometricDeviceType || null,
          biometricAuthTime: biometricVerified ? now : null,
          mobileSignToken: null, // Queima token de uso único
          mobileSignExpiresAt: null,
        },
      });

      // Se houver studentId vinculado e o e-mail no cadastro do aluno estiver vazio, atualiza automaticamente
      if (participant.studentId) {
        try {
          await prisma.student.updateMany({
            where: { id: participant.studentId, email: null },
            data: { email: verifiedEmail },
          });
        } catch (err) {
          console.warn("[POST sign-token] Aviso ao salvar email no aluno:", err);
        }
      }

      return NextResponse.json({
        success: true,
        mode: "ESCOLA_OAUTH",
        verifiedEmail,
        message: "Assinatura digital institucional @escola.pr.gov.br confirmada com sucesso!",
      });
    }

    // FLUXO B: Assinatura Padrão por Canvas / Biometria (Pais / Responsáveis)
    if (!signatureData || signatureData.trim().length < 20) {
      return NextResponse.json(
        { error: "Faça sua assinatura no quadro ou utilize o botão 'Assinar com @escola.pr.gov.br'." },
        { status: 400 }
      );
    }

    const now = new Date();
    await prisma.pedagogicalMinuteParticipant.update({
      where: { id: participant.id },
      data: {
        signatureMode: "MOBILE_QR",
        signatureData,
        signedAt: now,
        signerIp: ip,
        biometricVerified,
        biometricDeviceType: biometricDeviceType || null,
        biometricAuthTime: biometricVerified ? now : null,
        mobileSignToken: null, // Queima o token de uso único
        mobileSignExpiresAt: null,
      },
    });

    return NextResponse.json({
      success: true,
      mode: "MOBILE_QR",
      message: "Assinatura coletada com sucesso. Obrigado!",
    });
  } catch (error: any) {
    console.error("[POST /api/atas/sign-token/[token]] Erro:", error);
    return NextResponse.json({ error: "Erro ao gravar assinatura" }, { status: 500 });
  }
}
