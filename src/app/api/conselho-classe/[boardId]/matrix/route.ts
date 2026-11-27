import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { councilMatrixBatchSaveSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  isCouncilBoardAuthorizedInActiveSchool,
  readSafeJsonBody,
  resolveCouncilHttpError,
  resolveExplicitSelectedSchoolForCouncil,
  saveCouncilMatrixBatch,
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
    const school = await resolveExplicitSelectedSchoolForCouncil(
      authCheck.session,
      undefined,
      authCheck.snapshot
    );
    if (!school) {
      return NextResponse.json(
        { error: "Selecione explicitamente uma instituição escolar autorizada para continuar." },
        { status: 403 }
      );
    }

    if (!canMutateSchoolCouncil(authCheck.session, school.id)) {
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
    const parsed = councilMatrixBatchSaveSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const result = await saveCouncilMatrixBatch({
      schoolId: school.id,
      boardId,
      payload: parsed.data,
      userEmail: authCheck.email,
    });

    await logAudit({
      action: "UPDATE_COUNCIL_MATRIX",
      entityType: "ClassCouncilBoard",
      entityId: boardId,
      schoolId: school.id,
      details: {
        boardId,
        trimester: result.trimester,
        updatedCount: result.updatedCount,
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
      updatedCount: result.updatedCount,
      trimester: result.trimester,
    });
  } catch (err) {
    console.error("[PUT /api/conselho-classe/[boardId]/matrix] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
