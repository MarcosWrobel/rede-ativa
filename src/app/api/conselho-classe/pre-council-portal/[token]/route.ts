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
      verifiedEmail,
    });

    const accessibleConversations = preCouncil.conversations.filter((c) => {
      const owner = (c.teacherEmail || "").trim().toLowerCase();
      return !owner || owner === verifiedEmail;
    });
    const matchedByEmail = accessibleConversations.find(
      (c) => (c.teacherEmail || "").trim().toLowerCase() === verifiedEmail
    );
    const firstPendingAck = accessibleConversations.find((c) => !c.digitalAckEmail);
    const suggestedConversationId =
      tokenCheck.payload.conversationId ||
      matchedByEmail?.id ||
      firstPendingAck?.id ||
      accessibleConversations[0]?.id ||
      preCouncil.conversations[0]?.id ||
      null;

    return NextResponse.json({
      success: true,
      verifiedEmail,
      verifiedName,
      suggestedConversationId,
      suggestedSubjectId: null,
      preCouncil,
      council: null,
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

    // Isolamento estrito de escopo: o link de ciência do Pré-Conselho não permite editar a matriz de descritivos
    if (
      (parsed.data.entries?.length ?? 0) > 0 ||
      parsed.data.preCouncil !== undefined ||
      (Boolean(parsed.data.subjectId) && !parsed.data.conversationId)
    ) {
      return NextResponse.json(
        {
          error:
            "O link de Pré-Conselho é exclusivo para consulta e confirmação de ciência. Utilize o link do portal docente para lançamentos na matriz.",
        },
        { status: 403 }
      );
    }

    if (!parsed.data.conversationId) {
      return NextResponse.json(
        { error: "Selecione o componente curricular." },
        { status: 400 }
      );
    }

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
      entityId: ack.trimesterId,
      schoolId: tokenCheck.payload.schoolId,
      details: {
        boardId: tokenCheck.payload.boardId,
        trimester: ack.trimester,
        conversationId: ack.conversationId,
        ...(ack.subjectId ? { subjectId: ack.subjectId } : {}),
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
      verifiedEmail,
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
