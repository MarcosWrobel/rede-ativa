import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSuperAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { logAudit, extractClientIp } from "@/lib/audit";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { generateVerificationCode, canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { isSignTokenExpired } from "@/lib/signTokenExpiry";
import {
  mergeParticipantSignatures,
  sanitizeMinutePayload,
} from "@/services/ataParticipantService";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateMinuteDraftSchema = z.object({
  category: z.string().optional(),
  isConfidential: z.boolean().optional(),
  attendedAt: z.string().optional(),
  subject: z.string().min(2, "Assunto deve ter ao menos 2 caracteres").optional(),
  rawNotes: z.string().optional().nullable(),
  summary: z.string().optional(),
  agreementsSummary: z.string().optional().nullable(),
  studentIds: z.array(z.string()).optional(),
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
    const isPollMode = new URL(req.url).searchParams.get("poll") === "1";

    if (isPollMode) {
      const pollMinute = await prisma.pedagogicalMinute.findUnique({
        where: { id },
        select: {
          id: true,
          schoolId: true,
          status: true,
          isConfidential: true,
          authorEmail: true,
          participants: {
            select: {
              id: true,
              role: true,
              signatureMode: true,
              hasSignature: true,
              hasActiveSignLink: true,
              verifiedEmail: true,
              mobileSignExpiresAt: true,
            },
          },
        },
      });

      if (!pollMinute) {
        return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
      }

      const currentSchool = await getCurrentSchool(authCheck.schoolId);
      if (!assertTenantOwnership(pollMinute.schoolId, currentSchool.id, authCheck.session)) {
        return NextResponse.json(
          { error: "Acesso negado a registro de outra instituição de ensino." },
          { status: 403 }
        );
      }

      if (!canAccessConfidentialMinute(pollMinute, authCheck.session)) {
        return NextResponse.json(
          { error: "Esta ata possui Sigilo Reforçado (ECA) restrito à Direção Escolar e ao servidor autor." },
          { status: 403 }
        );
      }

      const nowMs = Date.now();
      return NextResponse.json({
        success: true,
        poll: true,
        minuteId: pollMinute.id,
        status: pollMinute.status,
        participants: (pollMinute.participants || []).map((p) => ({
          participantId: p.id,
          role: p.role,
          signatureMode: p.signatureMode,
          hasSignature: Boolean(p.hasSignature),
          hasActiveSignLink: Boolean(p.hasActiveSignLink),
          institutionalVerificationComplete: Boolean(p.verifiedEmail),
          linkExpired: Boolean(
            p.hasActiveSignLink && isSignTokenExpired(p.mobileSignExpiresAt, nowMs)
          ),
        })),
      });
    }

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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canAccessConfidentialMinute(minute, authCheck.session)) {
      return NextResponse.json(
        { error: "Esta ata possui Sigilo Reforçado (ECA) restrito à Direção Escolar e ao servidor autor." },
        { status: 403 }
      );
    }

    // Auto-recuperação de fé pública: assegura verificationCode para ata finalizada legada
    if (minute.status === "FINALIZED" && !minute.verificationCode) {
      const code = generateVerificationCode();
      minute.verificationCode = code;
      try {
        await prisma.pedagogicalMinute.update({
          where: { id: minute.id },
          data: { verificationCode: code },
        });
      } catch (e) {
        console.warn(`[GET /api/atas/${id}] Falha ao persistir verificationCode legado:`, e);
      }
    }

    const safeMinute = {
      ...minute,
      hasPhysicalScan: Boolean(minute.hasPhysicalScan),
      participants: (minute.participants || []).map(
        ({ mobileSignToken, mobileSignExpiresAt, ...rest }: any) => ({
          ...rest,
          hasSignature: Boolean(rest.hasSignature),
          hasActiveSignLink: Boolean(rest.hasActiveSignLink),
        })
      ),
    };

    return NextResponse.json({ success: true, minute: safeMinute });
  } catch (error: any) {
    console.error("[GET /api/atas/[id]] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar ata" }, { status: 500 });
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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    // REGRA DE OURO JURÍDICA: Se já foi lavrada (FINALIZED) ou cancelada (VOIDED),
    // o registro é 100% imutável via PATCH. Vias físicas digitalizadas exigem o endpoint auditado /physical-scan.
    if (existing.status !== "DRAFT") {
      return NextResponse.json(
        {
          error:
            "Ata já lavrada e imutável juridicamente (Lei nº 14.063/2020). Qualquer retificação deve ser feita via Adendo ('Em tempo'), Despacho de Cancelamento ou anexo auditado em /physical-scan.",
        },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = updateMinuteDraftSchema.safeParse(sanitizeMinutePayload(rawBody, "UPDATE"));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const data = parsed.data;
    const ip = extractClientIp(req);

    const runTx =
      typeof prisma.$transaction === "function"
        ? prisma.$transaction.bind(prisma)
        : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

    const updated = await runTx(async (tx) => {
      // Se informou studentIds, valida e atualiza vínculos garantindo isolamento multi-tenant
      if (data.studentIds !== undefined) {
        const uniqueStudentIds = Array.from(new Set(data.studentIds));

        if (uniqueStudentIds.length === 0) {
          // Se ficou com 0 estudantes, verifica se a ata terá ao menos 1 participante
          const participantsCount =
            data.participants !== undefined
              ? data.participants.length
              : tx.pedagogicalMinuteParticipant?.count
                ? await tx.pedagogicalMinuteParticipant.count({ where: { minuteId: id } })
                : (existing.participants || []).length;

          if (participantsCount === 0) {
            throw new Error(
              "VALIDATION:A ata deve possuir ao menos um estudante vinculado ou participante docente/servidor registrado."
            );
          }

          await tx.pedagogicalMinuteStudent.deleteMany({ where: { minuteId: id } });
        } else {
          const studentsDb = await tx.student.findMany({
            where: { id: { in: uniqueStudentIds }, schoolId: existing.schoolId },
            include: { classGroup: true },
          });

          if (studentsDb.length !== uniqueStudentIds.length) {
            throw new Error(
              "VALIDATION:Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
            );
          }

          await tx.pedagogicalMinuteStudent.deleteMany({ where: { minuteId: id } });
          await tx.pedagogicalMinuteStudent.createMany({
            data: studentsDb.map((s) => ({
              minuteId: id,
              studentId: s.id,
              studentNameSnapshot: s.name,
              classNameSnapshot: s.classGroup?.name || null,
              cgmSnapshot: s.cgm || null,
            })),
          });
        }
      }

      // Se informou participants, preserva id, mobileSignToken e assinaturas mobile recém-coletadas
      if (data.participants) {
        const existingParticipants = tx.pedagogicalMinuteParticipant?.findMany
          ? await tx.pedagogicalMinuteParticipant.findMany({ where: { minuteId: id } })
          : existing.participants || [];

        const participantsToCreate = mergeParticipantSignatures(
          data.participants,
          existingParticipants,
          { clearMobileTokens: false, minuteId: id }
        );

        await tx.pedagogicalMinuteParticipant.deleteMany({ where: { minuteId: id } });
        if (participantsToCreate.length > 0) {
          await tx.pedagogicalMinuteParticipant.createMany({
            data: participantsToCreate,
          });
        }
      }

      // Se informou actionItems, atualiza
      if (data.actionItems) {
        await tx.pedagogicalActionItem.deleteMany({ where: { minuteId: id } });
        if (data.actionItems.length > 0) {
          await tx.pedagogicalActionItem.createMany({
            data: data.actionItems.map((a) => ({
              minuteId: id,
              description: a.description,
              responsible: a.responsible,
              dueDate: a.dueDate ? new Date(a.dueDate) : null,
              status: a.status || "PENDING",
            })),
          });
        }
      }

          return await tx.pedagogicalMinute.update({
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
              ...(data.physicalSignedScanData !== undefined
                ? {
                    hasPhysicalScan: Boolean(
                      data.physicalSignedScanData ||
                        existing.physicalScanStorageKey ||
                        existing.physicalScanSha256
                    ),
                  }
                : {}),
            },
            include: {
              students: true,
              participants: true,
              actionItems: true,
            },
          });
        },
        { maxWait: 5000, timeout: 10000 }
      );

    await logAudit({
      action: "UPDATE_ATA_DRAFT",
      entityType: "PedagogicalMinute",
      entityId: id,
      schoolId: existing.schoolId,
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
    const msg = error?.message || "";
    if (msg.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: msg.replace("VALIDATION:", "") }, { status: 400 });
    }
    console.error("[PATCH /api/atas/[id]] Erro:", error);
    return NextResponse.json({ error: "Erro ao atualizar rascunho" }, { status: 500 });
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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    const isSuper = checkIsSuperAdmin(authCheck.session);

    // REGRA DE OURO JURÍDICA: Usuários comuns só podem descartar rascunhos (DRAFT).
    // Administradores Gerais possuem permissão de expurgo técnico (ex: descarte de atas de teste/homologação).
    if (!isSuper && existing.status !== "DRAFT") {
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
      schoolId: currentSchool.id,
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
    return NextResponse.json({ error: "Erro ao descartar ou remover ata" }, { status: 500 });
  }
}
