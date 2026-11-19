import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import { councilSubjectsBatchSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  readSafeJsonBody,
  resolveCouncilHttpError,
  saveOrCloneCouncilSubjects,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { boardId } = await params;
    const ownership = await findCouncilBoardOwnershipRecord(boardId);
    if (!ownership) {
      return NextResponse.json({ error: "Conselho de classe não encontrado." }, { status: 404 });
    }

    const school = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(ownership.schoolId, school.id, authCheck.session)) {
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
    const parsed = councilSubjectsBatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const result = await saveOrCloneCouncilSubjects({
      schoolId: ownership.schoolId,
      boardId,
      payload: parsed.data,
    });

    await logAudit({
      action: result.mode === "CLONED" ? "CLONE_COUNCIL_SUBJECTS" : "UPDATE_COUNCIL_SUBJECTS",
      entityType: "ClassCouncilBoard",
      entityId: boardId,
      schoolId: ownership.schoolId,
      details: {
        boardId,
        mode: result.mode,
        subjectsCount: result.subjects.length,
        sourceBoardId: parsed.data.sourceBoardId || null,
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
      mode: result.mode,
      sourceClassName: result.sourceClassName,
      subjects: result.subjects,
    });
  } catch (err) {
    console.error("[PUT /api/conselho-classe/[boardId]/subjects] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
