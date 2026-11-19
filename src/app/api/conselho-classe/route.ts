import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { logAudit } from "@/lib/audit";
import { councilBoardUpsertSchema, formatZodError } from "@/lib/schemas";
import { getCurrentBrasiliaYear } from "@/services/ataFinalizationService";
import {
  canMutateSchoolCouncil,
  ensureOrUpsertCouncilBoard,
  listSchoolCouncilBoards,
  readSafeJsonBody,
  resolveCouncilHttpError,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const school = await getCurrentSchool(authCheck.schoolId);
    const rawYear = new URL(req.url).searchParams.get("year");
    const parsedYear = rawYear ? Number.parseInt(rawYear, 10) : getCurrentBrasiliaYear();
    const year =
      Number.isInteger(parsedYear) && parsedYear >= 2024 && parsedYear <= 2100
        ? parsedYear
        : getCurrentBrasiliaYear();

    const data = await listSchoolCouncilBoards(school.id, year);

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (err) {
    console.error("[GET /api/conselho-classe] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const school = await getCurrentSchool(authCheck.schoolId);
    if (!canMutateSchoolCouncil(authCheck.session, school.id)) {
      return NextResponse.json(
        { error: "Perfil em modo somente leitura para esta instituição escolar." },
        { status: 403 }
      );
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = councilBoardUpsertSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const board = await ensureOrUpsertCouncilBoard({
      schoolId: school.id,
      payload: parsed.data,
      authorName: authCheck.userName,
      authorEmail: authCheck.email,
    });

    if (board) {
      await logAudit({
        action: "UPSERT_COUNCIL_BOARD",
        entityType: "ClassCouncilBoard",
        entityId: board.id,
        schoolId: school.id,
        details: {
          boardId: board.id,
          classGroupId: board.classGroupId,
          year: board.year,
        },
        user: {
          id: authCheck.userId,
          name: authCheck.userName,
          email: authCheck.email,
        },
        req,
      });
    }

    return NextResponse.json({ success: true, board }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/conselho-classe] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
