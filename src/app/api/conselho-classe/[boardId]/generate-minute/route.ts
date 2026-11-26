import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { extractClientIp, logAudit } from "@/lib/audit";
import { stripParticipantSecrets } from "@/lib/ataCrypto";
import { councilGenerateMinuteSchema, formatZodError } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  generateMinuteDraftFromCouncil,
  isCouncilBoardAuthorizedInActiveSchool,
  readSafeJsonBody,
  resolveAuthorizedSchoolForCouncil,
  resolveCouncilHttpError,
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
    const ownership = await findCouncilBoardOwnershipRecord(boardId);
    if (!ownership) {
      return NextResponse.json({ error: "Conselho de classe não encontrado." }, { status: 404 });
    }

    const school = await resolveAuthorizedSchoolForCouncil(authCheck.session, authCheck.schoolId);
    if (!isCouncilBoardAuthorizedInActiveSchool(ownership, school, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canMutateSchoolCouncil(authCheck.session, school.id)) {
      return NextResponse.json(
        { error: "Perfil em modo somente leitura para esta instituição escolar." },
        { status: 403 }
      );
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = councilGenerateMinuteSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const ip = extractClientIp(req);
    const minute = await generateMinuteDraftFromCouncil({
      schoolId: school.id,
      boardId,
      payload: parsed.data,
      authorId: authCheck.userId,
      authorName: authCheck.userName || "Equipe Pedagógica",
      authorEmail: authCheck.email,
      authorRole: authCheck.role || "PEDAGOGA",
      authorIp: ip,
    });

    await logAudit({
      action: "GENERATE_COUNCIL_MINUTE_DRAFT",
      entityType: "PedagogicalMinute",
      entityId: minute.id,
      schoolId: school.id,
      details: {
        boardId,
        minuteId: minute.id,
        source: parsed.data.source,
        trimester: parsed.data.trimester,
        linkedStudentsCount: minute.students.length,
        isConfidential: minute.isConfidential,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
      req,
    });

    return NextResponse.json(
      { success: true, minute: stripParticipantSecrets(minute) },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/conselho-classe/[boardId]/generate-minute] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
