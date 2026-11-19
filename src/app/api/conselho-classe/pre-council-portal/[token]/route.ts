import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { verifyPreCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { verifyEscolaGoogleIdToken } from "@/lib/escolaGoogleVerify";
import { enforceRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import {
  councilPreCouncilAckSubmitSchema,
  councilTeacherPortalAuthSchema,
  formatZodError,
} from "@/lib/schemas";
import {
  confirmPreCouncilTeacherAck,
  getPreCouncilTeacherPortalContext,
  readSafeJsonBody,
  resolveCouncilHttpError,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const rlCheck = await enforceRateLimit(
      getPublicIpRateLimitKey("council-pre-council-portal", req),
      RATE_LIMIT_POLICIES.COUNCIL_TEACHER_PORTAL
    );
    if (!rlCheck.ok) return rlCheck.response;

    const { token } = await params;
    const tokenCheck = verifyPreCouncilTeacherToken(token);
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

    const preCouncil = await getPreCouncilTeacherPortalContext({
      schoolId: tokenCheck.payload.schoolId,
      boardId: tokenCheck.payload.boardId,
      trimester: tokenCheck.payload.trimester,
      lockedConversationId: tokenCheck.payload.conversationId,
    });

    const matchedByEmail = preCouncil.conversations.find(
      (c) => (c.teacherEmail || "").trim().toLowerCase() === verifiedEmail
    );
    const firstPendingAck = preCouncil.conversations.find((c) => !c.digitalAckEmail);
    const suggestedConversationId =
      tokenCheck.payload.conversationId ||
      matchedByEmail?.id ||
      firstPendingAck?.id ||
      preCouncil.conversations[0]?.id ||
      null;

    return NextResponse.json({
      success: true,
      verifiedEmail,
      verifiedName,
      suggestedConversationId,
      preCouncil,
    });
  } catch (err) {
    console.error("[POST /api/conselho-classe/pre-council-portal/[token]] Erro:", err);
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
      getPublicIpRateLimitKey("council-pre-council-portal", req),
      RATE_LIMIT_POLICIES.COUNCIL_TEACHER_PORTAL
    );
    if (!rlCheck.ok) return rlCheck.response;

    const { token } = await params;
    const tokenCheck = verifyPreCouncilTeacherToken(token);
    if (!tokenCheck.ok) {
      return NextResponse.json({ error: tokenCheck.error }, { status: 401 });
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = councilPreCouncilAckSubmitSchema.safeParse(rawBody);
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

    const ack = await confirmPreCouncilTeacherAck({
      schoolId: tokenCheck.payload.schoolId,
      boardId: tokenCheck.payload.boardId,
      trimester: tokenCheck.payload.trimester,
      lockedConversationId: tokenCheck.payload.conversationId,
      conversationId: parsed.data.conversationId,
      verifiedEmail,
      verifiedName,
    });

    await logAudit({
      action: "TEACHER_ACK_PRE_COUNCIL",
      entityType: "ClassCouncilTrimester",
      entityId: tokenCheck.payload.boardId,
      schoolId: tokenCheck.payload.schoolId,
      details: {
        boardId: tokenCheck.payload.boardId,
        trimester: ack.trimester,
        conversationId: ack.conversationId,
        subjectName: ack.subjectName,
      },
      user: {
        name: verifiedName,
        email: verifiedEmail,
      },
      req,
    });

    const preCouncil = await getPreCouncilTeacherPortalContext({
      schoolId: tokenCheck.payload.schoolId,
      boardId: tokenCheck.payload.boardId,
      trimester: tokenCheck.payload.trimester,
      lockedConversationId: tokenCheck.payload.conversationId,
    });

    return NextResponse.json({
      success: true,
      ack,
      preCouncil,
    });
  } catch (err) {
    console.error("[PUT /api/conselho-classe/pre-council-portal/[token]] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
