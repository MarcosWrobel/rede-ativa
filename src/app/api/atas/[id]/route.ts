import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

function sanitizeUpdateBody(raw: any) {
  if (!raw || typeof raw !== "object") return raw;
  const cleaned = { ...raw };

  if (typeof cleaned.subject === "string") {
    cleaned.subject = cleaned.subject.trim() || "Atendimento Pedagógico";
    if (cleaned.subject.length < 2) cleaned.subject = "Atendimento Pedagógico";
  }

  if (Array.isArray(cleaned.participants)) {
    cleaned.participants = cleaned.participants
      .filter((p: any) => p && (p.name?.trim() || p.signatureData || p.signatureMode === "REFUSED" || p.id))
      .map((p: any) => {
        const trimmedName = (p.name || "").trim();
        return {
          ...p,
          name: trimmedName.length >= 2 ? trimmedName : "Responsável Presente",
        };
      });
  }

  if (Array.isArray(cleaned.actionItems)) {
    cleaned.actionItems = cleaned.actionItems
      .filter((a: any) => a && typeof a.description === "string" && a.description.trim().length >= 2)
      .map((a: any) => ({
        ...a,
        description: a.description.trim(),
        dueDate: a.dueDate && String(a.dueDate).trim() !== "" ? a.dueDate : null,
      }));
  }

  return cleaned;
}

const updateMinuteDraftSchema = z.object({
  category: z.string().optional(),
  isConfidential: z.boolean().optional(),
  attendedAt: z.string().optional(),
  subject: z.string().min(2, "Assunto deve ter ao menos 2 caracteres").optional(),
  rawNotes: z.string().optional().nullable(),
  summary: z.string().optional(),
  agreementsSummary: z.string().optional().nullable(),
  studentIds: z.array(z.string()).min(1, "Vincule pelo menos um estudante").optional(),
  participants: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.string(),
        studentId: z.string().optional().nullable(),
        name: z.string().min(2, "Informe o nome do participante"),
        kinship: z.string().optional().nullable(),
        documentType: z.string().optional().nullable(),
        documentNumber: z.string().optional().nullable(),
        documentVerifiedByStaff: z.boolean().default(false),
        phone: z.string().optional().nullable(),
        signatureMode: z.string().default("PENDING"),
        signatureData: z.string().optional().nullable(),
        signedAt: z.string().optional().nullable(),
        clearSignature: z.boolean().optional(),
        biometricVerified: z.boolean().optional(),
        biometricDeviceType: z.string().optional().nullable(),
        expectedEmail: z.string().optional().nullable(),
        verifiedEmail: z.string().optional().nullable(),
        verifiedGoogleSub: z.string().optional().nullable(),
        verifiedGoogleName: z.string().optional().nullable(),
        emailVerifiedAt: z.string().optional().nullable(),
        refusalReason: z.string().optional().nullable(),
        witnessName: z.string().optional().nullable(),
      })
    )
    .optional(),
  actionItems: z
    .array(
      z.object({
        id: z.string().optional(),
        description: z.string().min(2, "Informe a descrição do encaminhamento"),
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
    const parsed = updateMinuteDraftSchema.safeParse(sanitizeUpdateBody(rawBody));
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

    // Se informou participants, preserva id, mobileSignToken e assinaturas mobile recém-coletadas
    if (data.participants) {
      const existingParticipants = await prisma.pedagogicalMinuteParticipant.findMany({
        where: { minuteId: id },
      });

      const usedIds = new Set<string>();

      const participantsToCreate = data.participants.map((p) => {
        const match =
          (p.id && existingParticipants.find((ep) => ep.id === p.id && !usedIds.has(ep.id))) ||
          existingParticipants.find(
            (ep) => !usedIds.has(ep.id) && ep.name.trim().toLowerCase() === p.name.trim().toLowerCase()
          ) ||
          (existingParticipants.length === 1 && data.participants?.length === 1 && !usedIds.has(existingParticipants[0].id)
            ? existingParticipants[0]
            : undefined);

        if (match?.id) {
          usedIds.add(match.id);
        }

        const shouldClear = Boolean(p.clearSignature);
        const isRefused = p.signatureMode === "REFUSED";

        const sigData = shouldClear || isRefused ? null : (p.signatureData || match?.signatureData || null);
        const sigMode = isRefused
          ? "REFUSED"
          : sigData
            ? p.signatureMode !== "PENDING"
              ? p.signatureMode
              : match?.signatureMode || "SCREEN_CANVAS"
            : "PENDING";
        const signedAt = sigData ? (p.signedAt ? new Date(p.signedAt) : match?.signedAt || new Date()) : null;

        const bioVerified = shouldClear || isRefused ? false : (p.biometricVerified ?? match?.biometricVerified ?? false);
        const bioDevice = shouldClear || isRefused ? null : (p.biometricDeviceType || match?.biometricDeviceType || null);
        const bioTime = bioVerified ? (match?.biometricAuthTime || new Date()) : null;

        const verifiedEmail = shouldClear || isRefused ? null : (p.verifiedEmail || match?.verifiedEmail || null);
        const verifiedGoogleName = shouldClear || isRefused ? null : (p.verifiedGoogleName || match?.verifiedGoogleName || null);
        const verifiedGoogleSub = shouldClear || isRefused ? null : (p.verifiedGoogleSub || match?.verifiedGoogleSub || null);
        const emailVerifiedAt = verifiedEmail ? (match?.emailVerifiedAt || new Date()) : null;

        const effectiveSigMode = isRefused
          ? "REFUSED"
          : verifiedEmail
            ? "ESCOLA_OAUTH"
            : sigMode;

        return {
          ...(match?.id ? { id: match.id } : {}),
          minuteId: id,
          role: p.role,
          studentId: p.studentId || null,
          name: p.name,
          kinship: p.kinship || null,
          documentType: p.documentType || null,
          documentNumber: p.documentNumber || null,
          documentVerifiedByStaff: p.documentVerifiedByStaff,
          phone: p.phone || null,
          signatureMode: effectiveSigMode,
          signatureData: sigData,
          signedAt: sigData || verifiedEmail ? (signedAt || new Date()) : null,
          signerIp: shouldClear || isRefused ? null : (match?.signerIp || null),
          mobileSignToken: sigData || verifiedEmail || shouldClear || isRefused ? null : (match?.mobileSignToken || null),
          mobileSignExpiresAt: sigData || verifiedEmail || shouldClear || isRefused ? null : (match?.mobileSignExpiresAt || null),
          biometricVerified: bioVerified,
          biometricDeviceType: bioDevice,
          biometricAuthTime: bioTime,
          expectedEmail: p.expectedEmail !== undefined ? p.expectedEmail : (match?.expectedEmail || null),
          verifiedEmail,
          verifiedGoogleSub,
          verifiedGoogleName,
          emailVerifiedAt,
          refusalReason: isRefused ? (p.refusalReason || null) : null,
          witnessName: isRefused ? (p.witnessName || null) : null,
        };
      });

      await prisma.pedagogicalMinuteParticipant.deleteMany({ where: { minuteId: id } });
      if (participantsToCreate.length > 0) {
        await prisma.pedagogicalMinuteParticipant.createMany({
          data: participantsToCreate,
        });
      }
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

    const isAdmin = authCheck.role === "ADMIN";

    // REGRA DE OURO JURÍDICA: Usuários comuns só podem descartar rascunhos (DRAFT).
    // Administradores Gerais possuem permissão de expurgo técnico (ex: descarte de atas de teste/homologação).
    if (!isAdmin && existing.status !== "DRAFT") {
      return NextResponse.json(
        {
          error:
            "Ata oficial lavrada não pode ser excluída do livro de registros. Apenas Administradores do sistema possuem permissão para expurgar registros.",
        },
        { status: 403 }
      );
    }

    await prisma.pedagogicalMinute.delete({ where: { id } });

    const ip = extractClientIp(req);
    await logAudit({
      action: existing.status === "DRAFT" ? "DELETE_ATA_DRAFT" : "ADMIN_DELETE_ATA",
      entityType: "PedagogicalMinute",
      entityId: id,
      details:
        existing.status === "DRAFT"
          ? `Rascunho descartado: ${existing.subject}`
          : `Ata ${existing.ataNumber ? `nº ${String(existing.ataNumber).padStart(3, "0")}/${existing.year}` : existing.status} (${existing.subject}) expurgada pelo Administrador Geral ${authCheck.userName}`,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({
      success: true,
      message:
        existing.status === "DRAFT"
          ? "Rascunho descartado com sucesso"
          : "Ata excluída com sucesso pelo Administrador",
    });
  } catch (error: any) {
    console.error("[DELETE /api/atas/[id]] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao descartar rascunho" }, { status: 500 });
  }
}
