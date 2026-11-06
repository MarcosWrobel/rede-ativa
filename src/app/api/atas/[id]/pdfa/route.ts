import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSchoolManager, checkIsSuperAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
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

    const minute = await prisma.pedagogicalMinute.findUnique({
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
    });

    if (!minute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    // Regra de Fé Pública e Arquivo: PDF/A-1b oficial é exclusivo para atas lavradas (FINALIZED ou VOIDED)
    if (minute.status === "DRAFT") {
      return NextResponse.json(
        {
          error:
            "A emissão de certidão arquivística em PDF/A-1b (ISO 19005-1) requer a lavratura prévia da ata com Fé Pública e PIN do servidor.",
        },
        { status: 400 }
      );
    }

    // Sigilo Reforçado (ECA Art. 143 / JUR-02): se for confidencial, restringe à Gestão Escolar, SuperAdmin ou autor
    if (minute.isConfidential) {
      const isAuthor =
        minute.authorId === authCheck.userId ||
        minute.authorEmail?.toLowerCase() === authCheck.email?.toLowerCase();
      const isManager =
        checkIsSuperAdmin(authCheck.session) ||
        checkIsSchoolManager(authCheck.session, minute.schoolId || currentSchool.id);

      if (!isAuthor && !isManager) {
        return NextResponse.json(
          {
            error:
              "Acesso restrito. Este documento possui sigilo reforçado (ECA Art. 143) e só pode ser exportado pelo autor ou direção escolar.",
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
    await prisma.pedagogicalMinute.update({
      where: { id },
      data: {
        pdfArchiveSha256: archiveResult.sha256,
        pdfArchiveGeneratedAt: new Date(),
      },
    });

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
      { error: error.message || "Erro interno ao gerar certidão arquivística PDF/A-1b" },
      { status: 500 }
    );
  }
}
