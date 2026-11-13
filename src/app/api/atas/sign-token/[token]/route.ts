import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractClientIp } from "@/lib/audit";
import { anonymizeOtherMinorsInText } from "@/lib/ataCrypto";
import { isSignTokenExpired } from "@/lib/signTokenExpiry";
import { z } from "zod";
import {
  verifyEscolaGoogleIdToken,
  verifyParticipantIdentityMatch,
} from "@/lib/escolaGoogleVerify";
import { enforceRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const ALLOWED_SIG_IMAGE = /^data:image\/(png|jpeg|jpg|webp);base64,/i;
const MAX_SIG_BYTES = 512 * 1024; // 512 KB
const MAX_STROKE_BYTES = 200 * 1024; // 200 KB

const submitSignSchema = z.object({
  // Modo 1: Assinatura manuscrita em tela (canvas)
  signatureData: z.string().optional().nullable(),
  biometricStrokeData: z.string().optional().nullable(),
  clientTimestampIso: z.string().optional().nullable(),
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
    const rlKey = getPublicIpRateLimitKey("sign-token", req);
    const rlCheck = await enforceRateLimit(rlKey, RATE_LIMIT_POLICIES.SIGN_TOKEN_ACCESS);
    if (!rlCheck.ok) return rlCheck.response;

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
            students: {
              select: {
                studentId: true,
                studentNameSnapshot: true,
              },
            },
          },
        },
      },
    });

    if (!participant) {
      console.warn("[GET /api/atas/sign-token] Acesso recusado:", { reason: "token_not_found" });
      return NextResponse.json(
        { error: "Link de assinatura inválido, substituído, revogado ou já utilizado." },
        { status: 404 }
      );
    }

    if (participant.minute.status !== "DRAFT") {
      console.warn("[GET /api/atas/sign-token] Acesso recusado:", {
        reason: "minute_not_draft",
        minuteId: participant.minute.id,
        participantId: participant.id,
      });
      return NextResponse.json(
        { error: "Esta ata pedagógica já foi finalizada ou cancelada." },
        { status: 410 }
      );
    }

    const nowMs = Date.now();
    if (isSignTokenExpired(participant.mobileSignExpiresAt, nowMs)) {
      console.warn("[GET /api/atas/sign-token] Acesso recusado:", {
        reason: "expired",
        minuteId: participant.minute.id,
        participantId: participant.id,
        nowIso: new Date(nowMs).toISOString(),
        expiresAtIso: participant.mobileSignExpiresAt?.toISOString() || null,
      });
      return NextResponse.json({ error: "Este link de assinatura expirou. Solicite um novo link à equipe escolar." }, { status: 410 });
    }

    const linkedStudents = ((participant.minute as any).students || []).map((s: any) => ({
      id: s.studentId,
      name: s.studentNameSnapshot || "",
    }));
    const shouldAnonymizeOthers =
      linkedStudents.length > 1 &&
      (participant.role === "RESPONSAVEL" || participant.role === "ESTUDANTE");

    const safeSubject = shouldAnonymizeOthers
      ? anonymizeOtherMinorsInText(participant.minute.subject, participant.studentId, linkedStudents)
      : participant.minute.subject;
    const safeSummary = shouldAnonymizeOthers
      ? anonymizeOtherMinorsInText(participant.minute.summary, participant.studentId, linkedStudents)
      : participant.minute.summary;
    const safeAgreements =
      shouldAnonymizeOthers && participant.minute.agreementsSummary
        ? anonymizeOtherMinorsInText(participant.minute.agreementsSummary, participant.studentId, linkedStudents)
        : participant.minute.agreementsSummary;

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
        subject: safeSubject,
        summary: safeSummary,
        agreementsSummary: safeAgreements,
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
    const rlKey = getPublicIpRateLimitKey("sign-token", req);
    const rlCheck = await enforceRateLimit(rlKey, RATE_LIMIT_POLICIES.SIGN_TOKEN_ACCESS);
    if (!rlCheck.ok) return rlCheck.response;

    const { token } = await params;
    const ip = extractClientIp(req);
    const userAgent = req.headers.get("user-agent") || null;

    const participant = await prisma.pedagogicalMinuteParticipant.findUnique({
      where: { mobileSignToken: token },
      include: {
        minute: true,
      },
    });

    if (!participant) {
      console.warn("[POST /api/atas/sign-token] Submissão recusada:", { reason: "token_not_found" });
      return NextResponse.json(
        { error: "Link de assinatura inválido, substituído, revogado ou já utilizado." },
        { status: 404 }
      );
    }

    if (participant.minute.status !== "DRAFT") {
      console.warn("[POST /api/atas/sign-token] Submissão recusada:", {
        reason: "minute_not_draft",
        minuteId: participant.minute.id,
        participantId: participant.id,
      });
      return NextResponse.json(
        { error: "Esta ata pedagógica já foi finalizada ou cancelada." },
        { status: 410 }
      );
    }

    const postNowMs = Date.now();
    if (isSignTokenExpired(participant.mobileSignExpiresAt, postNowMs)) {
      console.warn("[POST /api/atas/sign-token] Submissão recusada:", {
        reason: "expired",
        minuteId: participant.minute.id,
        participantId: participant.id,
        nowIso: new Date(postNowMs).toISOString(),
        expiresAtIso: participant.mobileSignExpiresAt?.toISOString() || null,
      });
      return NextResponse.json({ error: "Este link de assinatura expirou." }, { status: 410 });
    }

    const rawBody = await req.json();
    const parsed = submitSignSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Payload de assinatura inválido" }, { status: 400 });
    }

    const { signatureData, biometricStrokeData, clientTimestampIso, biometricVerified, biometricDeviceType, googleIdToken, dryRun } = parsed.data;

    if (participant.signedAt || participant.signatureData || participant.verifiedEmail) {
      return NextResponse.json(
        { error: "Esta assinatura já foi registrada anteriormente. Solicite um novo link caso precise assinar novamente." },
        { status: 409 }
      );
    }

    if (signatureData) {
      if (signatureData.length > MAX_SIG_BYTES || !ALLOWED_SIG_IMAGE.test(signatureData.trim())) {
        return NextResponse.json(
          { error: "Imagem de assinatura inválida ou excede o tamanho máximo permitido (512KB)." },
          { status: 400 }
        );
      }
    }

    if (biometricStrokeData && biometricStrokeData.length > MAX_STROKE_BYTES) {
      return NextResponse.json(
        { error: "Dados vetoriais de biometria excedem o tamanho máximo permitido (200KB)." },
        { status: 400 }
      );
    }

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
          signerUserAgent: userAgent,
          signatureData: signatureData || null, // Se o usuário também desenhou opcionalmente
          biometricStrokeData: signatureData ? (biometricStrokeData || null) : null,
          clientTimestampIso: clientTimestampIso || now.toISOString(),
          biometricVerified: biometricVerified || false,
          biometricDeviceType: biometricDeviceType || null,
          biometricAuthTime: biometricVerified ? now : null,
          mobileSignToken: null, // Queima token de uso único
          mobileSignExpiresAt: null,
          hasSignature: true,
          hasActiveSignLink: false,
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
    const updateData = {
      signatureMode: "MOBILE_QR",
      signatureData,
      signedAt: now,
      signerIp: ip,
      signerUserAgent: userAgent,
      biometricStrokeData: biometricStrokeData || null,
      clientTimestampIso: clientTimestampIso || now.toISOString(),
      biometricVerified,
      biometricDeviceType: biometricDeviceType || null,
      biometricAuthTime: biometricVerified ? now : null,
      mobileSignToken: null, // Queima o token de uso único atomicamente
      mobileSignExpiresAt: null,
      hasSignature: true,
      hasActiveSignLink: false,
    };

    if (typeof (prisma.pedagogicalMinuteParticipant as any).updateMany === "function") {
      const atomicRes = await prisma.pedagogicalMinuteParticipant.updateMany({
        where: {
          id: participant.id,
          mobileSignToken: token,
          signedAt: null,
        },
        data: updateData,
      });
      if (atomicRes.count === 0) {
        return NextResponse.json(
          { error: "Este link de assinatura já foi utilizado em outra requisição simultânea." },
          { status: 409 }
        );
      }
    } else {
      await prisma.pedagogicalMinuteParticipant.update({
        where: { id: participant.id },
        data: updateData,
      });
    }

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
