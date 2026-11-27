import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { councilStudentCardUpdateSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  isCouncilBoardAuthorizedInActiveSchool,
  readSafeJsonBody,
  resolveCouncilHttpError,
  resolveExplicitSelectedSchoolForCouncil,
  updateStudentCouncilCard,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ boardId: string; studentId: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { boardId, studentId } = await params;
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
    const payloadCandidate =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? { ...(rawBody as Record<string, unknown>), studentId }
        : { studentId };

    const parsed = councilStudentCardUpdateSchema.safeParse(payloadCandidate);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const card = await updateStudentCouncilCard({
      schoolId: school.id,
      boardId,
      studentId,
      payload: parsed.data,
    });

    // LGPD: AuditLog nunca armazena os rótulos clínicos (ALUNO_COM_LAUDO / AEE) nem texto livre de parecer
    await logAudit({
      action: "UPDATE_COUNCIL_STUDENT_CARD",
      entityType: "StudentCouncilCard",
      entityId: card.id,
      schoolId: school.id,
      details: {
        boardId,
        studentId,
        trimester: parsed.data.trimester ?? null,
        enrollmentStatus: card.enrollmentStatus,
        tagsCount: card.tags.length,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true, card });
  } catch (err) {
    console.error("[PATCH /api/conselho-classe/[boardId]/students/[studentId]] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
