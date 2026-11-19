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

    // Enriquece com contexto da matriz (sem expor CGM ou selos clínicos) para o fluxo unificado
    const lockedConv = tokenCheck.payload.conversationId
      ? preCouncil.conversations.find((c) => c.id === tokenCheck.payload.conversationId) || null
      : null;
    const lockedSubjectId = lockedConv?.subjectId ?? null;

    let council = null;
    let suggestedSubjectId: string | null = null;
    if (!tokenCheck.payload.conversationId || lockedSubjectId) {
      try {
        const candidateCouncil = await getTeacherPortalCouncilContext({
          schoolId: tokenCheck.payload.schoolId,
          boardId: tokenCheck.payload.boardId,
          trimester: tokenCheck.payload.trimester,
          lockedSubjectId,
          lockedConversationId: tokenCheck.payload.conversationId,
          includeCgm: false,
        });
        if (candidateCouncil.subjects.length > 0) {
          council = candidateCouncil;
          const matchedSubj = candidateCouncil.subjects.find(
            (s) => (s.teacherEmail || "").trim().toLowerCase() === verifiedEmail
          );
          const firstUnclaimedSubj = candidateCouncil.subjects.find(
            (s) => !(s.teacherEmail || "").trim()
          );
          suggestedSubjectId =
            lockedSubjectId ||
            matchedSubj?.id ||
            firstUnclaimedSubj?.id ||
            candidateCouncil.subjects[0]?.id ||
            null;
        }
      } catch {
        // Mantém fallback legado quando o componente ainda não tiver disciplina vinculada
        council = null;
      }
    }

    return NextResponse.json({
      success: true,
      verifiedEmail,
      verifiedName,
      suggestedConversationId,
      suggestedSubjectId,
      preCouncil,
      council,
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

    const isUnifiedPayload =
      Boolean(parsed.data.subjectId) &&
      ((parsed.data.entries?.length ?? 0) > 0 ||
        parsed.data.preCouncil !== undefined ||
        parsed.data.confirmAck !== undefined);

    if (isUnifiedPayload && parsed.data.subjectId) {
      let lockedSubjectId: string | null = null;
      if (tokenCheck.payload.conversationId) {
        const currentCtx = await getPreCouncilTeacherPortalContext({
          schoolId: tokenCheck.payload.schoolId,
          boardId: tokenCheck.payload.boardId,
          trimester: tokenCheck.payload.trimester,
          lockedConversationId: tokenCheck.payload.conversationId,
        });
        lockedSubjectId = currentCtx.conversations[0]?.subjectId ?? null;
        if (!lockedSubjectId || lockedSubjectId !== parsed.data.subjectId) {
          return NextResponse.json(
            { error: "Este link é exclusivo para outro componente curricular." },
            { status: 403 }
          );
        }
      }

      const result = await submitTeacherPortalSubjectEntries({
        schoolId: tokenCheck.payload.schoolId,
        boardId: tokenCheck.payload.boardId,
        trimester: tokenCheck.payload.trimester,
        lockedSubjectId,
        subjectId: parsed.data.subjectId,
        verifiedEmail,
        verifiedName,
        entries: parsed.data.entries,
        preCouncil: parsed.data.preCouncil,
        confirmAck: Boolean(parsed.data.confirmAck),
      });

      if ((parsed.data.entries?.length ?? 0) > 0 || parsed.data.preCouncil !== undefined) {
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
            hasPreCouncilNotes: Boolean(parsed.data.preCouncil),
            monitoredCount: parsed.data.preCouncil?.monitoredStudentIds.length ?? 0,
          },
          user: {
            name: verifiedName,
            email: verifiedEmail,
          },
          req,
        });
      }

      if (result.ackConfirmed) {
        await logAudit({
          action: "TEACHER_ACK_PRE_COUNCIL",
          entityType: "ClassCouncilTrimester",
          entityId: tokenCheck.payload.boardId,
          schoolId: tokenCheck.payload.schoolId,
          details: {
            boardId: tokenCheck.payload.boardId,
            trimester: result.trimester,
            conversationId: result.conversationId,
            subjectId: result.subjectId,
            subjectName: result.subjectName,
          },
          user: {
            name: verifiedName,
            email: verifiedEmail,
          },
          req,
        });
      }

      const [preCouncil, council] = await Promise.all([
        getPreCouncilTeacherPortalContext({
          schoolId: tokenCheck.payload.schoolId,
          boardId: tokenCheck.payload.boardId,
          trimester: tokenCheck.payload.trimester,
          lockedConversationId: tokenCheck.payload.conversationId,
        }),
        getTeacherPortalCouncilContext({
          schoolId: tokenCheck.payload.schoolId,
          boardId: tokenCheck.payload.boardId,
          trimester: tokenCheck.payload.trimester,
          lockedSubjectId,
          lockedConversationId: tokenCheck.payload.conversationId,
          includeCgm: false,
        }),
      ]);

      return NextResponse.json({
        success: true,
        result,
        preCouncil,
        council,
      });
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
