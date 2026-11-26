import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractClientIp } from "@/lib/audit";
import {
  anonymizeOtherMinorsInText,
  buildStudentMaskingEntries,
  validatePngSignatureDataUrl,
} from "@/lib/ataCrypto";
import { isSignTokenExpired } from "@/lib/signTokenExpiry";
import { z } from "zod";
import {
  verifyEscolaGoogleIdToken,
  verifyParticipantIdentityMatch,
} from "@/lib/escolaGoogleVerify";
import { enforceRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  evaluateMinuteRevisionLock,
  hasMinimumOfficialSummary,
  OFFICIAL_SUMMARY_REQUIRED_FOR_LINK_SIGN_ERROR,
} from "@/lib/ataRevision";

export const dynamic = "force-dynamic";

const MAX_SIG_BYTES = 512 * 1024; // 512 KB
const MAX_SIG_BASE64_CHARS = 700_000;
const MAX_STROKE_BYTES = 200 * 1024; // 200 KB

const submitSignSchema = z.object({
  expectedRevision: z.number().int().min(1).optional(),
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
            schoolId: true,
            status: true,
            contentRevision: true,
            physicalScanRevision: true,
            physicalScanSupersededAt: true,
            hasPhysicalScan: true,
            govBrVerified: true,
            subject: true,
            summary: true,
            agreementsSummary: true,
            attendedAt: true,
            school: { select: { name: true } },
            participants: {
              select: {
                id: true,
                signatureMode: true,
                hasSignature: true,
                signatureData: true,
                verifiedEmail: true,
                signedAt: true,
                biometricVerified: true,
                signedRevision: true,
              },
            },
            students: {
              select: {
                studentId: true,
                studentNameSnapshot: true,
                previousNameSnapshots: true,
              },
            },
          },
        },
      },
    });

    if (!participant) {
      console.warn("[GET /api/atas/sign-token] Acesso recusado:", { reason: "token_not_found" });
      return NextResponse.json(
        {
          error:
            "Link de assinatura inválido, substituído, revogado após alteração da ata ou já utilizado. Solicite um novo link à equipe escolar.",
          code: "LINK_REVOKED_OR_SUPERSEDED",
        },
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

    const lockState = evaluateMinuteRevisionLock(participant.minute);
    if (lockState.hasLegacyUnprovableProof) {
      return NextResponse.json(
        {
          error:
            "Esta ata possui registro anterior sem comprovação de revisão. Solicite à equipe escolar a reabertura e um novo link atualizado.",
          code: "LEGACY_SIGNATURE_REQUIRES_REOPEN",
        },
        { status: 409 }
      );
    }

    if (
      participant.mobileSignRevision === null ||
      participant.mobileSignRevision === undefined ||
      participant.mobileSignRevision !== lockState.currentRevision
    ) {
      return NextResponse.json(
        {
          error:
            "O conteúdo desta ata foi atualizado após a emissão deste link. Solicite um novo link atualizado à equipe escolar.",
          code: "REVISION_SUPERSEDED",
        },
        { status: 409 }
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

    if (participant.signatureMode === "REFUSED") {
      return NextResponse.json(
        { error: "Este participante possui registro de recusa na ata. Solicite um novo link à equipe após cancelar a recusa." },
        { status: 409 }
      );
    }

    if (!hasMinimumOfficialSummary(participant.minute.summary)) {
      return NextResponse.json(
        {
          error: OFFICIAL_SUMMARY_REQUIRED_FOR_LINK_SIGN_ERROR,
          code: "OFFICIAL_SUMMARY_REQUIRED",
        },
        { status: 409 }
      );
    }

    const rawMinuteStudents: Array<{
      studentId: string;
      studentNameSnapshot?: string | null;
      previousNameSnapshots?: ReadonlyArray<string | null | undefined> | null;
    }> = (participant.minute as any).students || [];

    const shouldAnonymizeOthers =
      rawMinuteStudents.length > 1 &&
      (participant.role === "RESPONSAVEL" ||
        participant.role === "FAMILIAR_CONTATO" ||
        participant.role === "ESTUDANTE");

    const studentNameById = new Map<string, string>();
    if (shouldAnonymizeOthers) {
      const minuteSchoolId = participant.minute.schoolId;
      if (!minuteSchoolId) {
        return NextResponse.json(
          {
            error:
              "Link de assinatura inválido, substituído, revogado após alteração da ata ou já utilizado. Solicite um novo link à equipe escolar.",
            code: "LINK_REVOKED_OR_SUPERSEDED",
          },
          { status: 404 }
        );
      }
      const studentIds = Array.from(
        new Set(rawMinuteStudents.map((ms) => ms.studentId).filter(Boolean))
      );
      if (studentIds.length > 0) {
        const scopedStudents = await withTenantContext(prisma, minuteSchoolId, async (tx) =>
          tx.student.findMany({
            where: {
              id: { in: studentIds },
              schoolId: minuteSchoolId,
            },
            select: {
              id: true,
              name: true,
            },
          })
        );
        for (const st of scopedStudents) {
          studentNameById.set(st.id, st.name);
        }
      }
    }

    const linkedStudents = buildStudentMaskingEntries(
      rawMinuteStudents.map((ms) => ({
        ...ms,
        student: studentNameById.has(ms.studentId)
          ? { name: studentNameById.get(ms.studentId)! }
          : null,
      }))
    );

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
        minuteRevision: lockState.currentRevision,
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
      select: {
        id: true,
        minuteId: true,
        studentId: true,
        name: true,
        role: true,
        expectedEmail: true,
        signedAt: true,
        signatureData: true,
        verifiedEmail: true,
        hasSignature: true,
        signatureMode: true,
        mobileSignToken: true,
        mobileSignExpiresAt: true,
        mobileSignRevision: true,
        minute: {
          select: {
            id: true,
            schoolId: true,
            status: true,
            contentRevision: true,
            physicalScanRevision: true,
            physicalScanSupersededAt: true,
            hasPhysicalScan: true,
            govBrVerified: true,
            summary: true,
            participants: {
              select: {
                id: true,
                signatureMode: true,
                hasSignature: true,
                signatureData: true,
                verifiedEmail: true,
                signedAt: true,
                biometricVerified: true,
                signedRevision: true,
              },
            },
          },
        },
      },
    });

    if (!participant || !participant.minute?.schoolId) {
      console.warn("[POST /api/atas/sign-token] Submissão recusada:", { reason: "token_not_found" });
      return NextResponse.json(
        {
          error:
            "Este link não é mais válido porque a ata foi atualizada, reaberta ou o link foi revogado. Solicite um novo link atualizado à equipe escolar.",
          code: "LINK_REVOKED_OR_SUPERSEDED",
        },
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

    const {
      expectedRevision,
      signatureData,
      biometricStrokeData,
      clientTimestampIso,
      biometricVerified,
      biometricDeviceType,
      googleIdToken,
      dryRun,
    } = parsed.data;

    const preLockState = evaluateMinuteRevisionLock(participant.minute);
    if (preLockState.hasLegacyUnprovableProof) {
      return NextResponse.json(
        {
          error:
            "Esta ata possui assinatura anterior sem comprovação de revisão. Solicite à equipe escolar a reabertura e um novo link atualizado.",
          code: "LEGACY_SIGNATURE_REQUIRES_REOPEN",
        },
        { status: 409 }
      );
    }

    if (
      participant.mobileSignRevision === null ||
      participant.mobileSignRevision === undefined ||
      participant.mobileSignRevision !== preLockState.currentRevision ||
      (expectedRevision !== undefined && expectedRevision !== preLockState.currentRevision)
    ) {
      return NextResponse.json(
        {
          error:
            "O conteúdo desta ata foi atualizado após a emissão deste link. Solicite um novo link atualizado à equipe escolar.",
          code: "REVISION_SUPERSEDED",
        },
        { status: 409 }
      );
    }

    if (participant.signedAt || participant.signatureData || participant.verifiedEmail) {
      return NextResponse.json(
        { error: "Esta assinatura já foi registrada anteriormente. Solicite um novo link caso precise assinar novamente." },
        { status: 409 }
      );
    }

    if (!hasMinimumOfficialSummary(participant.minute.summary)) {
      return NextResponse.json(
        {
          error: OFFICIAL_SUMMARY_REQUIRED_FOR_LINK_SIGN_ERROR,
          code: "OFFICIAL_SUMMARY_REQUIRED",
        },
        { status: 409 }
      );
    }

    if (signatureData) {
      if (signatureData.length > MAX_SIG_BASE64_CHARS) {
        return NextResponse.json(
          { error: "Imagem de assinatura inválida ou excede o tamanho máximo permitido (512KB)." },
          { status: 400 }
        );
      }
      const sigValidation = validatePngSignatureDataUrl(signatureData, MAX_SIG_BYTES);
      if (!sigValidation.ok) {
        return NextResponse.json(
          { error: sigValidation.error },
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
      const targetMinuteId = participant.minuteId || participant.minute.id;
      const minuteSchoolId = participant.minute.schoolId;
      const runTx =
        typeof prisma.$transaction === "function"
          ? prisma.$transaction.bind(prisma)
          : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

      const txResult = await runTx(async (tx) => {
        await acquireMinuteWriteLock(tx, targetMinuteId);

        const freshParticipant = await tx.pedagogicalMinuteParticipant.findFirst({
          where: {
            id: participant.id,
            minuteId: targetMinuteId,
            mobileSignToken: token,
            minute: {
              schoolId: minuteSchoolId,
            },
          },
          include: { minute: { include: { participants: true } } },
        });

        if (!freshParticipant || freshParticipant.minute.schoolId !== minuteSchoolId) {
          return {
            ok: false as const,
            status: 404,
            code: "LINK_REVOKED_OR_SUPERSEDED",
            error:
              "Este link não é mais válido porque a ata foi atualizada, reaberta ou o link foi revogado. Solicite um novo link atualizado à equipe escolar.",
          };
        }
        if (freshParticipant.minute.status !== "DRAFT") {
          return { ok: false as const, status: 410, error: "Esta ata pedagógica já foi finalizada ou cancelada." };
        }
        if (isSignTokenExpired(freshParticipant.mobileSignExpiresAt, Date.now())) {
          return { ok: false as const, status: 410, error: "Este link de assinatura expirou." };
        }
        const txLockState = evaluateMinuteRevisionLock(freshParticipant.minute);
        if (txLockState.hasLegacyUnprovableProof) {
          return {
            ok: false as const,
            status: 409,
            code: "LEGACY_SIGNATURE_REQUIRES_REOPEN",
            error:
              "Esta ata possui assinatura anterior sem comprovação de revisão. Solicite à equipe escolar a reabertura e um novo link atualizado.",
          };
        }
        if (
          freshParticipant.mobileSignRevision === null ||
          freshParticipant.mobileSignRevision === undefined ||
          freshParticipant.mobileSignRevision !== txLockState.currentRevision ||
          (expectedRevision !== undefined && expectedRevision !== txLockState.currentRevision)
        ) {
          return {
            ok: false as const,
            status: 409,
            code: "REVISION_SUPERSEDED",
            error:
              "O conteúdo desta ata foi atualizado após a emissão deste link. Solicite um novo link atualizado à equipe escolar.",
          };
        }
        if (!hasMinimumOfficialSummary(freshParticipant.minute.summary)) {
          return {
            ok: false as const,
            status: 409,
            code: "OFFICIAL_SUMMARY_REQUIRED",
            error: OFFICIAL_SUMMARY_REQUIRED_FOR_LINK_SIGN_ERROR,
          };
        }
        if (
          freshParticipant.signedAt ||
          freshParticipant.signatureData ||
          freshParticipant.verifiedEmail ||
          freshParticipant.hasSignature ||
          freshParticipant.signatureMode === "REFUSED"
        ) {
          return {
            ok: false as const,
            status: 409,
            error: "Esta assinatura ou registro de recusa já foi registrado anteriormente. Solicite um novo link caso precise assinar novamente.",
          };
        }

        // Revalida titularidade contra o registro mais recente sob lock transacional
        const freshMatchCheck = verifyParticipantIdentityMatch({
          participantName: freshParticipant.name,
          expectedEmail: freshParticipant.expectedEmail,
          verifiedEmail,
          verifiedName: verifiedGoogleName,
        });
        if (!freshMatchCheck.match) {
          return {
            ok: false as const,
            status: 403,
            error: freshMatchCheck.reason || "A conta Google conectada não corresponde ao participante desta ata.",
          };
        }

        const oauthUpdateData = {
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
          mobileSignRevision: null,
          signedRevision: txLockState.currentRevision,
          hasSignature: true,
          hasActiveSignLink: false,
        };

        if (typeof (tx.pedagogicalMinuteParticipant as any).updateMany === "function") {
          const atomicRes = await tx.pedagogicalMinuteParticipant.updateMany({
            where: {
              id: freshParticipant.id,
              mobileSignToken: token,
              signedAt: null,
            },
            data: oauthUpdateData,
          });
          if (atomicRes.count === 0) {
            return {
              ok: false as const,
              status: 409,
              error: "Este link de assinatura já foi utilizado em outra requisição simultânea.",
            };
          }
        } else {
          await tx.pedagogicalMinuteParticipant.update({
            where: { id: freshParticipant.id },
            data: oauthUpdateData,
          });
        }

        return {
          ok: true as const,
          studentId: freshParticipant.studentId,
          schoolId: freshParticipant.minute.schoolId,
          signedRevision: txLockState.currentRevision,
        };
      });

      if (!txResult.ok) {
        return NextResponse.json(
          { error: txResult.error, ...(txResult.code ? { code: txResult.code } : {}) },
          { status: txResult.status }
        );
      }

      // Se houver studentId vinculado à mesma escola e o e-mail no cadastro estiver vazio, atualiza em contexto RLS
      if (txResult.studentId && txResult.schoolId) {
        try {
          await withTenantContext(prisma, txResult.schoolId, async (tx) => {
            await tx.student.updateMany({
              where: {
                id: txResult.studentId!,
                schoolId: txResult.schoolId,
                email: null,
              },
              data: { email: verifiedEmail },
            });
          });
        } catch (err) {
          console.warn("[POST sign-token] Aviso ao salvar email no aluno:", err);
        }
      }

      return NextResponse.json({
        success: true,
        mode: "ESCOLA_OAUTH",
        verifiedEmail,
        signedRevision: txResult.signedRevision,
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
    const targetMinuteId = participant.minuteId || participant.minute.id;
    const minuteSchoolId = participant.minute.schoolId;
    const runTx =
      typeof prisma.$transaction === "function"
        ? prisma.$transaction.bind(prisma)
        : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

    const txResult = await runTx(async (tx) => {
      await acquireMinuteWriteLock(tx, targetMinuteId);

      const freshParticipant = await tx.pedagogicalMinuteParticipant.findFirst({
        where: {
          id: participant.id,
          minuteId: targetMinuteId,
          mobileSignToken: token,
          minute: {
            schoolId: minuteSchoolId,
          },
        },
        include: { minute: { include: { participants: true } } },
      });

      if (!freshParticipant || freshParticipant.minute.schoolId !== minuteSchoolId) {
        return {
          ok: false as const,
          status: 404,
          code: "LINK_REVOKED_OR_SUPERSEDED",
          error:
            "Este link não é mais válido porque a ata foi atualizada, reaberta ou o link foi revogado. Solicite um novo link atualizado à equipe escolar.",
        };
      }
      if (freshParticipant.minute.status !== "DRAFT") {
        return { ok: false as const, status: 410, error: "Esta ata pedagógica já foi finalizada ou cancelada." };
      }
      if (isSignTokenExpired(freshParticipant.mobileSignExpiresAt, Date.now())) {
        return { ok: false as const, status: 410, error: "Este link de assinatura expirou." };
      }
      const txLockState = evaluateMinuteRevisionLock(freshParticipant.minute);
      if (txLockState.hasLegacyUnprovableProof) {
        return {
          ok: false as const,
          status: 409,
          code: "LEGACY_SIGNATURE_REQUIRES_REOPEN",
          error:
            "Esta ata possui assinatura anterior sem comprovação de revisão. Solicite à equipe escolar a reabertura e um novo link atualizado.",
        };
      }
      if (
        freshParticipant.mobileSignRevision === null ||
        freshParticipant.mobileSignRevision === undefined ||
        freshParticipant.mobileSignRevision !== txLockState.currentRevision ||
        (expectedRevision !== undefined && expectedRevision !== txLockState.currentRevision)
      ) {
        return {
          ok: false as const,
          status: 409,
          code: "REVISION_SUPERSEDED",
          error:
            "O conteúdo desta ata foi atualizado após a emissão deste link. Solicite um novo link atualizado à equipe escolar.",
        };
      }
      if (!hasMinimumOfficialSummary(freshParticipant.minute.summary)) {
        return {
          ok: false as const,
          status: 409,
          code: "OFFICIAL_SUMMARY_REQUIRED",
          error: OFFICIAL_SUMMARY_REQUIRED_FOR_LINK_SIGN_ERROR,
        };
      }
      if (
        freshParticipant.signedAt ||
        freshParticipant.signatureData ||
        freshParticipant.verifiedEmail ||
        freshParticipant.hasSignature ||
        freshParticipant.signatureMode === "REFUSED"
      ) {
        return {
          ok: false as const,
          status: 409,
          error: "Este link de assinatura já foi utilizado ou o participante possui registro de recusa.",
        };
      }

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
        mobileSignRevision: null,
        signedRevision: txLockState.currentRevision,
        hasSignature: true,
        hasActiveSignLink: false,
      };

      if (typeof (tx.pedagogicalMinuteParticipant as any).updateMany === "function") {
        const atomicRes = await tx.pedagogicalMinuteParticipant.updateMany({
          where: {
            id: freshParticipant.id,
            mobileSignToken: token,
            signedAt: null,
          },
          data: updateData,
        });
        if (atomicRes.count === 0) {
          return {
            ok: false as const,
            status: 409,
            error: "Este link de assinatura já foi utilizado em outra requisição simultânea.",
          };
        }
      } else {
        await tx.pedagogicalMinuteParticipant.update({
          where: { id: freshParticipant.id },
          data: updateData,
        });
      }

      return { ok: true as const, signedRevision: txLockState.currentRevision };
    });

    if (!txResult.ok) {
      return NextResponse.json(
        { error: txResult.error, ...(txResult.code ? { code: txResult.code } : {}) },
        { status: txResult.status }
      );
    }

    return NextResponse.json({
      success: true,
      mode: "MOBILE_QR",
      signedRevision: txResult.signedRevision,
      message: "Assinatura coletada com sucesso. Obrigado!",
    });
  } catch (error: any) {
    console.error("[POST /api/atas/sign-token/[token]] Erro:", error);
    return NextResponse.json({ error: "Erro ao gravar assinatura" }, { status: 500 });
  }
}
