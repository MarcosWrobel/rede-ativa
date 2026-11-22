import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import { councilStudentCardUpdateSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  readSafeJsonBody,
  resolveAuthorizedSchoolForCouncil,
  resolveCouncilHttpError,
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
    const ownership = await findCouncilBoardOwnershipRecord(boardId);
    if (!ownership) {
      return NextResponse.json({ error: "Conselho de classe não encontrado." }, { status: 404 });
    }

    const school = await resolveAuthorizedSchoolForCouncil(authCheck.session, authCheck.schoolId);
    if (!school || !assertTenantOwnership(ownership.schoolId, school.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canMutateSchoolCouncil(authCheck.session, ownership.schoolId)) {
      return NextResponse.json(
        { error: "Perfil em modo somente leitura para esta instituição escolar." },
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
      schoolId: ownership.schoolId,
      boardId,
      studentId,
      payload: parsed.data,
    });

    // LGPD: AuditLog nunca armazena os rótulos clínicos (ALUNO_COM_LAUDO / AEE) nem texto livre de parecer
    await logAudit({
      action: "UPDATE_COUNCIL_STUDENT_CARD",
      entityType: "StudentCouncilCard",
      entityId: card.id,
      schoolId: ownership.schoolId,
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
