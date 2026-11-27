import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { createPreCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { generateQrCodeDataUrl, getTrustedAppOrigin } from "@/lib/qrCode";
import { councilPreCouncilLinkCreateSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  getSavedPreCouncilForLink,
  isCouncilBoardAuthorizedInActiveSchool,
  readSafeJsonBody,
  resolveCouncilHttpError,
  resolveExplicitSelectedSchoolForCouncil,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { boardId } = await params;
    const school = await resolveExplicitSelectedSchoolForCouncil(
      authCheck.session,
      undefined,
      authCheck.snapshot
    );
    if (!school || !canMutateSchoolCouncil(authCheck.session, school.id)) {
      return NextResponse.json(
        { error: "Perfil em modo somente leitura para esta instituição escolar." },
        { status: 403 }
      );
    }

    const ownership = await findCouncilBoardOwnershipRecord(boardId);
    if (!ownership) {
      return NextResponse.json({ error: "Conselho de classe não encontrado." }, { status: 404 });
    }

    if (
      !isCouncilBoardAuthorizedInActiveSchool(ownership, school, authCheck.session) ||
      (ownership.classGroup && ownership.classGroup.schoolId !== ownership.schoolId)
    ) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = councilPreCouncilLinkCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { trimesterId, matchedConversation } = await getSavedPreCouncilForLink({
      schoolId: school.id,
      boardId,
      trimester: parsed.data.trimester,
      conversationId: parsed.data.conversationId || null,
    });

    const tokenResult = createPreCouncilTeacherToken({
      schoolId: school.id,
      boardId,
      trimester: parsed.data.trimester,
      conversationId: matchedConversation?.id || null,
      expiresInDays: parsed.data.expiresInDays,
    });

    const origin = getTrustedAppOrigin(req.headers);
    const url = `${origin}/conselho-classe/pre-conselho/${encodeURIComponent(tokenResult.token)}`;
    const qrCodeDataUrl = await generateQrCodeDataUrl(url, {
      width: 256,
      margin: 1,
    });

    await logAudit({
      action: "CREATE_PRE_COUNCIL_TEACHER_LINK",
      entityType: "ClassCouncilTrimester",
      entityId: trimesterId,
      schoolId: school.id,
      details: {
        boardId,
        trimester: parsed.data.trimester,
        conversationId: matchedConversation?.id || null,
        expiresAt: tokenResult.expiresAt.toISOString(),
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({
      success: true,
      url,
      qrCodeDataUrl,
      trimester: parsed.data.trimester,
      conversationId: matchedConversation?.id || null,
      subjectName: matchedConversation?.subjectName || null,
      expiresAt: tokenResult.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[POST /api/conselho-classe/[boardId]/pre-council-link] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
