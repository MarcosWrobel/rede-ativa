import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import { councilTrimesterUpdateSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  readSafeJsonBody,
  resolveCouncilHttpError,
  updateCouncilTrimester,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

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
    const parsed = councilTrimesterUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const trimesterRecord = await updateCouncilTrimester({
      schoolId: ownership.schoolId,
      boardId,
      payload: parsed.data,
      userName: authCheck.userName,
      userEmail: authCheck.email,
    });

    const preCouncilAuditSummary =
      parsed.data.preCouncil !== undefined
        ? {
            hasPreCouncil: parsed.data.preCouncil !== null,
            preCouncilTotalCount: parsed.data.preCouncil?.conversations.length ?? 0,
            preCouncilCompletedCount:
              parsed.data.preCouncil?.conversations.filter(
                (c) => c.conversationStatus === "COMPLETED"
              ).length ?? 0,
          }
        : {};

    await logAudit({
      action: "UPDATE_COUNCIL_TRIMESTER",
      entityType: "ClassCouncilTrimester",
      entityId: trimesterRecord.id,
      schoolId: ownership.schoolId,
      details: {
        boardId,
        trimester: trimesterRecord.trimester,
        status: trimesterRecord.status,
        ...preCouncilAuditSummary,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true, trimesterRecord });
  } catch (err) {
    console.error("[PATCH /api/conselho-classe/[boardId]/trimesters] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
