import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { councilTeacherLinkCreateSchema, formatZodError } from "@/lib/schemas";
import { createCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { generateQrCodeDataUrl, getTrustedAppOrigin } from "@/lib/qrCode";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
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
    const parsed = councilTeacherLinkCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    let matchedSubject: { id: string; name: string } | null = null;
    if (parsed.data.subjectId) {
      const foundSubjects = await prisma.classCouncilSubject.findMany({
        where: {
          id: { in: [parsed.data.subjectId] },
          boardId,
          schoolId: ownership.schoolId,
          active: true,
        },
        select: { id: true, name: true },
      });
      matchedSubject = foundSubjects[0] || null;
      if (!matchedSubject) {
        return NextResponse.json(
          { error: "Componente curricular não encontrado ou inativo nesta turma." },
          { status: 404 }
        );
      }
    }

    const tokenResult = createCouncilTeacherToken({
      schoolId: ownership.schoolId,
      boardId,
      trimester: parsed.data.trimester,
      subjectId: matchedSubject?.id || null,
      expiresInDays: parsed.data.expiresInDays,
    });

    const origin = getTrustedAppOrigin(req.headers);
    const url = `${origin}/conselho-classe/professor/${encodeURIComponent(tokenResult.token)}`;
    const qrCodeDataUrl = await generateQrCodeDataUrl(url, {
      width: 256,
      margin: 1,
    });

    await logAudit({
      action: "CREATE_COUNCIL_TEACHER_LINK",
      entityType: "ClassCouncilBoard",
      entityId: boardId,
      schoolId: ownership.schoolId,
      details: {
        boardId,
        trimester: parsed.data.trimester,
        subjectId: matchedSubject?.id || null,
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
      subjectId: matchedSubject?.id || null,
      subjectName: matchedSubject?.name || null,
      expiresAt: tokenResult.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[POST /api/conselho-classe/[boardId]/teacher-link] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
