import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { verifyCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { verifyEscolaGoogleIdToken } from "@/lib/escolaGoogleVerify";
import { enforceRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import {
  councilTeacherPortalAuthSchema,
  councilTeacherPortalSubmitSchema,
  formatZodError,
} from "@/lib/schemas";
import {
  getTeacherPortalCouncilContext,
  readSafeJsonBody,
  resolveCouncilHttpError,
  submitTeacherPortalSubjectEntries,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const rlCheck = await enforceRateLimit(
      getPublicIpRateLimitKey("council-teacher-portal", req),
      RATE_LIMIT_POLICIES.COUNCIL_TEACHER_PORTAL
    );
    if (!rlCheck.ok) return rlCheck.response;

    const { token } = await params;
    const tokenCheck = verifyCouncilTeacherToken(token);
    if (!tokenCheck.ok) {
      return NextResponse.json({ error: tokenCheck.error }, { status: 401 });
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = councilTeacherPortalAuthSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const googleCheck = await verifyEscolaGoogleIdToken(parsed.data.googleIdToken);
    if (!googleCheck.ok || !googleCheck.tokenInfo) {
      return NextResponse.json(
        { error: googleCheck.error || "Não foi possível validar a conta @escola.pr.gov.br." },
        { status: 401 }
      );
    }

    const verifiedEmail = googleCheck.tokenInfo.email.toLowerCase().trim();
    const verifiedName = googleCheck.tokenInfo.name || verifiedEmail.split("@")[0];

    const council = await getTeacherPortalCouncilContext({
      schoolId: tokenCheck.payload.schoolId,
      boardId: tokenCheck.payload.boardId,
      trimester: tokenCheck.payload.trimester,
      lockedSubjectId: tokenCheck.payload.subjectId,
    });

    const matchedByEmail = council.subjects.find(
      (s) => (s.teacherEmail || "").trim().toLowerCase() === verifiedEmail
    );
    const firstUnclaimed = council.subjects.find((s) => !(s.teacherEmail || "").trim());
    const suggestedSubjectId =
      tokenCheck.payload.subjectId ||
      matchedByEmail?.id ||
      firstUnclaimed?.id ||
      council.subjects[0]?.id ||
      null;

    return NextResponse.json({
      success: true,
      verifiedEmail,
      verifiedName,
      suggestedSubjectId,
      council,
    });
  } catch (err) {
    console.error("[POST /api/conselho-classe/teacher-portal/[token]] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const rlCheck = await enforceRateLimit(
      getPublicIpRateLimitKey("council-teacher-portal", req),
      RATE_LIMIT_POLICIES.COUNCIL_TEACHER_PORTAL
    );
    if (!rlCheck.ok) return rlCheck.response;

    const { token } = await params;
    const tokenCheck = verifyCouncilTeacherToken(token);
    if (!tokenCheck.ok) {
      return NextResponse.json({ error: tokenCheck.error }, { status: 401 });
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = councilTeacherPortalSubmitSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const googleCheck = await verifyEscolaGoogleIdToken(parsed.data.googleIdToken);
    if (!googleCheck.ok || !googleCheck.tokenInfo) {
      return NextResponse.json(
        { error: googleCheck.error || "Não foi possível validar a conta @escola.pr.gov.br." },
        { status: 401 }
      );
    }

    const verifiedEmail = googleCheck.tokenInfo.email.toLowerCase().trim();
    const verifiedName = googleCheck.tokenInfo.name || verifiedEmail.split("@")[0];

    const result = await submitTeacherPortalSubjectEntries({
      schoolId: tokenCheck.payload.schoolId,
      boardId: tokenCheck.payload.boardId,
      trimester: tokenCheck.payload.trimester,
      lockedSubjectId: tokenCheck.payload.subjectId,
      subjectId: parsed.data.subjectId,
      verifiedEmail,
      verifiedName,
      entries: parsed.data.entries,
    });

    await logAudit({
      action: "TEACHER_SUBMIT_COUNCIL_SUBJECT",
      entityType: "ClassCouncilBoard",
      entityId: tokenCheck.payload.boardId,
      schoolId: tokenCheck.payload.schoolId,
      details: {
        boardId: tokenCheck.payload.boardId,
        subjectId: result.subjectId,
        trimester: result.trimester,
        updatedCount: result.updatedCount,
      },
      user: {
        name: verifiedName,
        email: verifiedEmail,
      },
      req,
    });

    const council = await getTeacherPortalCouncilContext({
      schoolId: tokenCheck.payload.schoolId,
      boardId: tokenCheck.payload.boardId,
      trimester: tokenCheck.payload.trimester,
      lockedSubjectId: tokenCheck.payload.subjectId,
    });

    return NextResponse.json({
      success: true,
      result,
      council,
    });
  } catch (err) {
    console.error("[PUT /api/conselho-classe/teacher-portal/[token]] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
