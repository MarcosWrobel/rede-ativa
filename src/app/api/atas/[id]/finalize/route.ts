import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { computeMinuteHash, generateVerificationCode } from "@/lib/ataCrypto";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const ip = extractClientIp(req);

    // Consulta ata e dependências
    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      include: {
        students: true,
        participants: true,
        actionItems: true,
      },
    });

    if (!minute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    if (minute.status !== "DRAFT") {
      return NextResponse.json(
        { error: `Esta ata já foi lavrada anteriormente (Ata nº ${minute.ataNumber}/${minute.year}).` },
        { status: 400 }
      );
    }

    if (!minute.summary || minute.summary.trim().length < 10) {
      return NextResponse.json(
        { error: "O texto formal da ata deve ser preenchido antes da lavratura oficial." },
        { status: 400 }
      );
    }

    if (minute.students.length === 0) {
      return NextResponse.json({ error: "Vincule pelo menos um estudante antes de lavrar." }, { status: 400 });
    }

    const currentYear = new Date().getFullYear();

    // Executa em transação serializada com atribuição sequencial atômica
    const finalized = await prisma.$transaction(async (tx) => {
      // Busca o maior ataNumber da escola no ano corrente
      const lastAta = await tx.pedagogicalMinute.findFirst({
        where: {
          schoolId: minute.schoolId,
          year: currentYear,
          ataNumber: { not: null },
        },
        orderBy: { ataNumber: "desc" },
        select: { ataNumber: true },
      });

      const nextAtaNumber = (lastAta?.ataNumber || 0) + 1;
      const verificationCode = generateVerificationCode();
      const now = new Date();

      // Monta payload canônico para cálculo do hash SHA-256
      const canonicalPayload = {
        schoolId: minute.schoolId,
        year: currentYear,
        ataNumber: nextAtaNumber,
        attendedAt: minute.attendedAt.toISOString(),
        category: minute.category,
        subject: minute.subject,
        summary: minute.summary,
        agreementsSummary: minute.agreementsSummary,
        authorEmail: authCheck.email,
        students: minute.students.map((s) => ({
          studentId: s.studentId,
          name: s.studentNameSnapshot,
          className: s.classNameSnapshot,
          cgm: s.cgmSnapshot,
        })),
        participants: minute.participants.map((p) => ({
          role: p.role,
          name: p.name,
          documentType: p.documentType,
          documentNumber: p.documentNumber,
          signatureMode: p.signatureMode,
          signatureData: p.signatureData,
          biometricVerified: p.biometricVerified,
          refusalReason: p.refusalReason,
        })),
        actionItems: minute.actionItems.map((a) => ({
          description: a.description,
          responsible: a.responsible,
          dueDate: a.dueDate ? a.dueDate.toISOString() : null,
        })),
      };

      const contentHash = computeMinuteHash(canonicalPayload);

      return await tx.pedagogicalMinute.update({
        where: { id },
        data: {
          year: currentYear,
          ataNumber: nextAtaNumber,
          status: "FINALIZED",
          finalizedAt: now,
          contentHash,
          verificationCode,
          authorId: authCheck.userId,
          authorName: authCheck.userName || minute.authorName,
          authorEmail: authCheck.email,
          authorRole: authCheck.role || "PEDAGOGA",
          authorIp: ip,
        },
        include: {
          students: true,
          participants: true,
          actionItems: true,
        },
      });
    });

    await logAudit({
      action: "FINALIZE_ATA",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Lavratura oficial da Ata nº ${String(finalized.ataNumber).padStart(3, "0")}/${finalized.year} (${finalized.subject}) — Hash SHA-256: ${finalized.contentHash?.slice(0, 16)}...`,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute: finalized });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/finalize] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao lavrar ata" }, { status: 500 });
  }
}
