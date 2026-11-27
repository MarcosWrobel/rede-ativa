import { NextResponse } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { verifyCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { verifyEscolaGoogleIdToken } from "@/lib/escolaGoogleVerify";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { formatZodError } from "@/lib/schemas";
import {
  isSchoolTeacherInviteActive,
  parseSchoolTeacherInviteSettings,
  verifySchoolTeacherInviteCode,
  verifySchoolTeacherInviteToken,
} from "@/lib/schoolTeacherInvite";
import { safeCompareStrings } from "@/lib/syncToken";
import {
  claimSubjectsWithTeacherInvite,
  listAvailableSubjectsForTeacherInvite,
  readSafeJsonBody,
  resolveCouncilHttpError,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

const teacherInviteClaimSchema = z.object({
  googleIdToken: z.string().trim().min(10, "Token Google institucional obrigatório."),
  inviteCode: z.string().trim().optional(),
  inviteToken: z.string().trim().optional(),
  portalToken: z.string().trim().optional(),
  schoolId: z.string().trim().optional(),
  subjectIds: z.array(z.string().trim().min(1)).max(60).optional(),
});

export async function POST(req: Request) {
  try {
    const rlCheck = await enforceRateLimit(
      getPublicIpRateLimitKey("council-teacher-invite-claim", req),
      RATE_LIMIT_POLICIES.TEACHER_INVITE_CLAIM
    );
    if (!rlCheck.ok) return rlCheck.response;

    const rawBody = await readSafeJsonBody(req);
    const parsed = teacherInviteClaimSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { googleIdToken, inviteCode, inviteToken, portalToken, schoolId, subjectIds } =
      parsed.data;

    if (!inviteCode && !inviteToken) {
      return NextResponse.json(
        { error: "Informe o código de convite da escola ou utilize o link de vínculo." },
        { status: 400 }
      );
    }

    const googleCheck = await verifyEscolaGoogleIdToken(googleIdToken);
    if (!googleCheck.ok || !googleCheck.tokenInfo) {
      return NextResponse.json(
        { error: googleCheck.error || "Não foi possível validar a conta @escola.pr.gov.br." },
        { status: 401 }
      );
    }

    const verifiedEmail = googleCheck.tokenInfo.email.toLowerCase().trim();
    const verifiedName = googleCheck.tokenInfo.name || verifiedEmail.split("@")[0];

    let targetSchoolId: string | null = schoolId || null;
    let scopedBoardId: string | null = null;
    let verifiedByToken = false;
    let tokenNonce: string | null = null;

    if (portalToken) {
      const portalCheck = verifyCouncilTeacherToken(portalToken);
      if (!portalCheck.ok) {
        return NextResponse.json({ error: portalCheck.error }, { status: 401 });
      }
      targetSchoolId = portalCheck.payload.schoolId;
      scopedBoardId = portalCheck.payload.boardId;
    }

    if (inviteToken) {
      const tokenCheck = verifySchoolTeacherInviteToken(inviteToken);
      if (!tokenCheck.ok) {
        return NextResponse.json({ error: tokenCheck.error }, { status: 401 });
      }
      if (targetSchoolId && targetSchoolId !== tokenCheck.payload.schoolId) {
        return NextResponse.json(
          { error: "O link de vínculo pertence a outra instituição de ensino." },
          { status: 403 }
        );
      }
      targetSchoolId = tokenCheck.payload.schoolId;
      tokenNonce = tokenCheck.payload.nonce;
      verifiedByToken = true;
    }

    if (!targetSchoolId) {
      return NextResponse.json(
        {
          error:
            "Não foi possível identificar a escola. Abra o link completo de vínculo enviado pela coordenação.",
        },
        { status: 400 }
      );
    }

    const dbSchool = await prisma.school.findUnique({
      where: { id: targetSchoolId },
      select: { id: true, name: true, active: true, settingsJson: true },
    });
    if (!dbSchool || !dbSchool.active) {
      return NextResponse.json(
        { error: "Instituição de ensino não encontrada ou inativa." },
        { status: 404 }
      );
    }

    const inviteState = parseSchoolTeacherInviteSettings(dbSchool.settingsJson);
    if (!isSchoolTeacherInviteActive(inviteState)) {
      return NextResponse.json(
        {
          error:
            "O código de vínculo docente desta escola expirou ou foi revogado. Solicite um novo à coordenação.",
        },
        { status: 403 }
      );
    }

    if (verifiedByToken) {
      if (!tokenNonce || !safeCompareStrings(tokenNonce, inviteState.nonce)) {
        return NextResponse.json(
          { error: "Este link de vínculo foi substituído ou revogado pela escola." },
          { status: 403 }
        );
      }
    } else {
      const codeOk = verifySchoolTeacherInviteCode({
        providedCode: inviteCode || "",
        schoolId: targetSchoolId,
        state: inviteState,
      });
      if (!codeOk) {
        return NextResponse.json(
          { error: "Código de convite da escola inválido ou expirado." },
          { status: 403 }
        );
      }
    }

    let claimResult: Awaited<ReturnType<typeof claimSubjectsWithTeacherInvite>> | null = null;
    if (subjectIds && subjectIds.length > 0) {
      claimResult = await claimSubjectsWithTeacherInvite({
        schoolId: targetSchoolId,
        verifiedEmail,
        verifiedName,
        subjectIds,
      });

      if (claimResult.claimedIds.length > 0) {
        await logAudit({
          action: "TEACHER_SELF_CLAIM_SUBJECTS",
          entityType: "School",
          entityId: targetSchoolId,
          schoolId: targetSchoolId,
          details: {
            boardId: scopedBoardId,
            claimedIds: claimResult.claimedIds,
            skippedCount: claimResult.skippedClaimedByOtherIds.length,
          },
          user: {
            name: verifiedName,
            email: verifiedEmail,
          },
          req,
        });
      }
    }

    const catalog = await listAvailableSubjectsForTeacherInvite({
      schoolId: targetSchoolId,
      verifiedEmail,
      boardId: scopedBoardId,
    });

    return NextResponse.json({
      success: true,
      verifiedEmail,
      verifiedName,
      schoolId: targetSchoolId,
      schoolName: catalog.schoolName,
      boards: catalog.boards,
      claimResult,
    });
  } catch (err) {
    console.error("[POST /api/conselho-classe/teacher-invite/claim] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
