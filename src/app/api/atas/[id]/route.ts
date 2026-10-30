import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateMinuteDraftSchema = z.object({
  category: z.string().optional(),
  isConfidential: z.boolean().optional(),
  attendedAt: z.string().optional(),
  subject: z.string().min(2).optional(),
  rawNotes: z.string().optional().nullable(),
  summary: z.string().optional(),
  agreementsSummary: z.string().optional().nullable(),
  studentIds: z.array(z.string()).min(1).optional(),
  participants: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.string(),
        studentId: z.string().optional().nullable(),
        name: z.string().min(2),
        kinship: z.string().optional().nullable(),
        documentType: z.string().optional().nullable(),
        documentNumber: z.string().optional().nullable(),
        documentVerifiedByStaff: z.boolean().default(false),
        phone: z.string().optional().nullable(),
        signatureMode: z.string().default("PENDING"),
        signatureData: z.string().optional().nullable(),
        signedAt: z.string().optional().nullable(),
        biometricVerified: z.boolean().optional(),
        biometricDeviceType: z.string().optional().nullable(),
        refusalReason: z.string().optional().nullable(),
        witnessName: z.string().optional().nullable(),
      })
    )
    .optional(),
  actionItems: z
    .array(
      z.object({
        id: z.string().optional(),
        description: z.string().min(2),
        responsible: z.string(),
        dueDate: z.string().optional().nullable(),
        status: z.string().default("PENDING"),
      })
    )
    .optional(),
  physicalSignedScanData: z.string().optional().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      include: {
        school: true,
        students: {
          include: {
            student: {
              select: { id: true, name: true, phone: true, cgm: true },
            },
          },
        },
        participants: true,
        addendums: {
          orderBy: { createdAt: "asc" },
        },
        actionItems: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!minute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true, minute });
  } catch (error: any) {
    console.error("[GET /api/atas/[id]] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao consultar ata" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const existing = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      include: { students: true, participants: true, actionItems: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Ata não encontrada" }, { status: 404 });
    }

    // REGRA DE OURO JURÍDICA: Se já foi lavrada (FINALIZED) ou cancelada (VOIDED),
    // o texto da ata é 100% imutável. Permite apenas anexar scan físico ou atualizar ação.
    if (existing.status !== "DRAFT") {
      const rawBody = await req.json();
      if (rawBody.physicalSignedScanData !== undefined) {
        const updated = await prisma.pedagogicalMinute.update({
          where: { id },
          data: { physicalSignedScanData: rawBody.physicalSignedScanData },
        });
        return NextResponse.json({ success: true, minute: updated });
      }

      return NextResponse.json(
        {
          error:
            "Ata já lavrada e imutável juridicamente (Lei nº 14.063/2020). Qualquer retificação deve ser feita via Adendo ('Em tempo') ou Despacho de Cancelamento.",
        },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = updateMinuteDraftSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const data = parsed.data;
    const ip = extractClientIp(req);

    // Se informou studentIds, atualiza vínculos
    if (data.studentIds) {
      const studentsDb = await prisma.student.findMany({
        where: { id: { in: data.studentIds } },
        include: { classGroup: true },
      });

      await prisma.pedagogicalMinuteStudent.deleteMany({ where: { minuteId: id } });
      await prisma.pedagogicalMinuteStudent.createMany({
        data: studentsDb.map((s) => ({
          minuteId: id,
          studentId: s.id,
          studentNameSnapshot: s.name,
          classNameSnapshot: s.classGroup?.name || null,
          cgmSnapshot: s.cgm || null,
        })),
      });
    }

    // Se informou participants, preserva assinaturas mobile recém-coletadas caso o front-end envie rascunho anterior
    if (data.participants) {
      const existingParticipants = await prisma.pedagogicalMinuteParticipant.findMany({
        where: { minuteId: id },
      });

      await prisma.pedagogicalMinuteParticipant.deleteMany({ where: { minuteId: id } });
      await prisma.pedagogicalMinuteParticipant.createMany({
        data: data.participants.map((p, idx) => {
          // Se o participante já tinha assinatura salva no banco (ex: via QR Code móvel), não perde!
          const match =
            (p.id && existingParticipants.find((ep) => ep.id === p.id)) ||
            existingParticipants.find((ep) => ep.name.trim() === p.name.trim()) ||
            existingParticipants[idx];

          const sigData = p.signatureData || match?.signatureData || null;
          const sigMode = sigData ? (p.signatureMode !== "PENDING" ? p.signatureMode : match?.signatureMode || "SCREEN_CANVAS") : p.signatureMode || "PENDING";
          const signedAt = sigData ? (p.signedAt ? new Date(p.signedAt) : match?.signedAt || new Date()) : null;

          const bioVerified = p.biometricVerified ?? match?.biometricVerified ?? false;
          const bioDevice = p.biometricDeviceType || match?.biometricDeviceType || null;
          const bioTime = bioVerified ? (match?.biometricAuthTime || new Date()) : null;

          return {
            minuteId: id,
            role: p.role,
            studentId: p.studentId || null,
            name: p.name,
            kinship: p.kinship || null,
            documentType: p.documentType || null,
            documentNumber: p.documentNumber || null,
            documentVerifiedByStaff: p.documentVerifiedByStaff,
            phone: p.phone || null,
            signatureMode: sigMode,
            signatureData: sigData,
            signedAt,
            biometricVerified: bioVerified,
            biometricDeviceType: bioDevice,
            biometricAuthTime: bioTime,
            refusalReason: p.refusalReason || null,
            witnessName: p.witnessName || null,
          };
        }),
      });
    }

    // Se informou actionItems, atualiza
    if (data.actionItems) {
      await prisma.pedagogicalActionItem.deleteMany({ where: { minuteId: id } });
      await prisma.pedagogicalActionItem.createMany({
        data: data.actionItems.map((a) => ({
          minuteId: id,
          description: a.description,
          responsible: a.responsible,
          dueDate: a.dueDate ? new Date(a.dueDate) : null,
          status: a.status || "PENDING",
        })),
      });
    }

    const updated = await prisma.pedagogicalMinute.update({
      where: { id },
      data: {
        category: data.category,
        isConfidential: data.isConfidential,
        attendedAt: data.attendedAt ? new Date(data.attendedAt) : undefined,
        subject: data.subject,
        rawNotes: data.rawNotes,
        summary: data.summary,
        agreementsSummary: data.agreementsSummary,
        physicalSignedScanData: data.physicalSignedScanData,
      },
      include: {
        students: true,
        participants: true,
        actionItems: true,
      },
    });

    await logAudit({
      action: "UPDATE_ATA_DRAFT",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Rascunho de ata atualizado: ${updated.subject}`,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute: updated });
  } catch (error: any) {
    console.error("[PATCH /api/atas/[id]] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao atualizar rascunho" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const existing = await prisma.pedagogicalMinute.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Ata não encontrada" }, { status: 404 });
    }

    // REGRA DE OURO JURÍDICA: Apenas rascunhos podem ser excluídos (não consumiram número).
    // Atas lavradas NUNCA podem ser deletadas; se houver erro, usa-se 'Tornar Sem Efeito'.
    if (existing.status !== "DRAFT") {
      return NextResponse.json(
        {
          error:
            "Ata oficial lavrada não pode ser excluída do livro de registros. Utilize a função 'Tornar Sem Efeito' com justificativa auditada.",
        },
        { status: 403 }
      );
    }

    await prisma.pedagogicalMinute.delete({ where: { id } });

    const ip = extractClientIp(req);
    await logAudit({
      action: "DELETE_ATA_DRAFT",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Rascunho descartado: ${existing.subject}`,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, message: "Rascunho descartado com sucesso" });
  } catch (error: any) {
    console.error("[DELETE /api/atas/[id]] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao descartar rascunho" }, { status: 500 });
  }
}
