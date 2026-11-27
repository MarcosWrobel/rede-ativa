import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSchoolManager, checkIsSuperAdmin } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import { generateAtaPdfA1b } from "@/lib/ataPdfArchive";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const targetStudentId = searchParams.get("studentId") || undefined;
    const download = searchParams.get("download") === "1";

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;

    const minute = await withTenantContext(prisma, currentSchool.id, (tx) =>
      tx.pedagogicalMinute.findUnique({
        where: { id },
        include: {
          school: true,
          students: {
            include: { student: true },
          },
          participants: true,
          actionItems: true,
          addendums: {
            orderBy: { createdAt: "asc" },
          },
        },
      })
    );

    if (!minute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    if (
      minute.schoolId !== currentSchool.id ||
      !assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)
    ) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (minute.status === "DRAFT") {
      return NextResponse.json(
        {
          error:
            "A emissão do arquivo PDF para preservação requer a lavratura prévia da ata com confirmação de autoria por PIN do servidor.",
        },
        { status: 400 }
      );
    }

    if (minute.isConfidential) {
      const isAuthor =
        minute.authorId === authCheck.userId ||
        minute.authorEmail?.toLowerCase() === authCheck.email?.toLowerCase();
      const targetDescriptor =
        minute.school ||
        (minute.schoolId === currentSchool.id
          ? {
              id: currentSchool.id,
              active: true,
              networkId: currentSchool.networkId,
              network: currentSchool.network,
              city: currentSchool.city,
            }
          : null);
      const isManager =
        checkIsSuperAdmin(authCheck.session) ||
        checkIsSchoolManager(
          authCheck.session,
          minute.schoolId || currentSchool.id,
          targetDescriptor
        );

      if (!isAuthor && !isManager) {
        return NextResponse.json(
          {
            error:
              "Acesso restrito. Esta ata possui sigilo reforçado e só pode ser exportada pelo autor ou direção escolar.",
          },
          { status: 403 }
        );
      }
    }

    const hostOrigin = req.headers.get("origin") || req.headers.get("host")
      ? `https://${req.headers.get("host")}`
      : undefined;

    const archiveResult = await generateAtaPdfA1b(minute, {
      targetStudentId,
      verificationOrigin: hostOrigin,
    });

    // Registra o hash emitido da certidão PDF/A-1b no banco
    await withTenantContext(prisma, currentSchool.id, (tx) =>
      tx.pedagogicalMinute.update({
        where: { id },
        data: {
          pdfArchiveSha256: archiveResult.sha256,
          pdfArchiveGeneratedAt: new Date(),
        },
      })
    );

    await logAudit({
      action: "GENERATE_DOSSIER",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: {
        ataNumber: minute.ataNumber,
        year: minute.year,
        format: "PDF/A-1b (ISO 19005-1)",
        pdfArchiveSha256: archiveResult.sha256,
        targetStudentId: targetStudentId || null,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    const disposition = download ? "attachment" : "inline";

    return new NextResponse(Buffer.from(archiveResult.pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${archiveResult.filename}"`,
        "X-Archive-SHA256": archiveResult.sha256,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/atas/[id]/pdfa] Erro:", error);
    return NextResponse.json(
      { error: "Erro interno ao gerar arquivo PDF da ata" },
      { status: 500 }
    );
  }
}
