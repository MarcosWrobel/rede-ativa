import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import { councilBoardMetadataUpdateSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  getCouncilBoardDetail,
  readSafeJsonBody,
  resolveCouncilHttpError,
  updateCouncilBoardMetadata,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
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

    const board = await getCouncilBoardDetail(ownership.schoolId, boardId);
    if (!board) {
      return NextResponse.json({ error: "Conselho de classe não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ success: true, board });
  } catch (err) {
    console.error("[GET /api/conselho-classe/[boardId]] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
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
    const parsed = councilBoardMetadataUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const board = await updateCouncilBoardMetadata({
      schoolId: ownership.schoolId,
      boardId,
      payload: parsed.data,
    });

    await logAudit({
      action: "UPSERT_COUNCIL_BOARD",
      entityType: "ClassCouncilBoard",
      entityId: boardId,
      schoolId: ownership.schoolId,
      details: {
        boardId,
        classGroupId: ownership.classGroupId,
        year: ownership.year,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true, board });
  } catch (err) {
    console.error("[PATCH /api/conselho-classe/[boardId]] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
