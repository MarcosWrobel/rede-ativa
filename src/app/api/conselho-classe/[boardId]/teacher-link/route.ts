import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { councilTeacherLinkCreateSchema, formatZodError } from "@/lib/schemas";
import { createCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { generateQrCodeDataUrl, getTrustedAppOrigin } from "@/lib/qrCode";
import { isBootstrapAdminEmail } from "@/lib/roles";
import {
  findCouncilBoardOwnershipRecord,
  isCouncilBoardAuthorizedInActiveSchool,
  readSafeJsonBody,
  resolveCouncilHttpError,
  resolveExplicitSelectedSchoolForCouncil,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

const teacherLinkIssuerRoles = new Set(["ADMIN", "GESTOR_ESCOLAR", "PEDAGOGA"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const explicitServerSchoolId = authCheck.snapshot
      ? authCheck.snapshot.schoolId
      : authCheck.schoolId;
    const school = await resolveExplicitSelectedSchoolForCouncil(
      authCheck.session,
      explicitServerSchoolId,
      authCheck.snapshot
    );
    if (!school) {
      return NextResponse.json(
        { error: "Selecione explicitamente uma instituição de ensino antes de emitir o link." },
        { status: 403 }
      );
    }

    const { boardId } = await params;
    const ownership = await findCouncilBoardOwnershipRecord(boardId);
    if (!ownership) {
      return NextResponse.json({ error: "Conselho de classe não encontrado." }, { status: 404 });
    }

    if (ownership.school && ownership.school.active === false) {
      return NextResponse.json(
        { error: "Instituição de ensino inativa para emissão de link." },
        { status: 403 }
      );
    }

    // Mesma verificação estrita de posse aplicada a todos os papéis, incluindo SUPERADMIN
    if (!isCouncilBoardAuthorizedInActiveSchool(ownership, school, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (ownership.classGroup && ownership.classGroup.schoolId !== ownership.schoolId) {
      return NextResponse.json(
        { error: "Inconsistência institucional entre conselho de classe e turma." },
        { status: 403 }
      );
    }

    const issuer = await prisma.user.findUnique({
      where: { email: authCheck.email },
      select: {
        active: true,
        role: true,
        schools: {
          where: { schoolId: school.id, active: true },
          select: { role: true },
        },
      },
    });
    const canIssue = issuer?.active && (
      issuer.role === "SUPERADMIN" ||
      isBootstrapAdminEmail(authCheck.email) ||
      teacherLinkIssuerRoles.has(issuer.schools[0]?.role ?? "")
    );
    if (!canIssue) {
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
      const foundSubjects = await withTenantContext(prisma, school.id, (tx) =>
        tx.classCouncilSubject.findMany({
          where: {
            id: { in: [parsed.data.subjectId!] },
            boardId,
            schoolId: school.id,
            active: true,
          },
          select: { id: true, name: true },
        })
      );
      matchedSubject = foundSubjects[0] || null;
      if (!matchedSubject) {
        return NextResponse.json(
          { error: "Componente curricular não encontrado ou inativo nesta turma." },
          { status: 404 }
        );
      }
    }

    const tokenResult = createCouncilTeacherToken({
      schoolId: school.id,
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
      schoolId: school.id,
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
