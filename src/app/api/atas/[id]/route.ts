import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSuperAdmin } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { logAudit, extractClientIp } from "@/lib/audit";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  PHYSICAL_PROOF_HISTORY_SELECT,
  canAccessConfidentialMinute,
  filterAccessiblePhysicalProofHistory,
  generateVerificationCode,
  retainNecessaryPreviousStudentNames,
  stripInternalStudentNameAliases,
  stripParticipantSecrets,
} from "@/lib/ataCrypto";
import { isSignTokenExpired } from "@/lib/signTokenExpiry";
import {
  mergeParticipantSignatures,
  sanitizeMinutePayload,
  validateParticipantStudentLinks,
} from "@/services/ataParticipantService";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import { buildSessionFromSnapshot } from "@/lib/serverAuthContext";
import {
  evaluateEffectivePhysicalProof,
  evaluateMinuteRevisionLock,
  hasEffectiveMinuteDraftChanges,
} from "@/lib/ataRevision";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PNG_DATA_URL_MAX_CHARS = 700_000;

const updateMinuteDraftSchema = z.object({
  expectedRevision: z.number().int().min(1).optional(),
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
        signatureData: z
          .string()
          .max(PNG_DATA_URL_MAX_CHARS, "Imagem de assinatura excede o tamanho máximo permitido (512KB).")
          .refine(
            (v) => v.trim().startsWith("data:image/png;base64,"),
            "Formato de assinatura inválido: utilize apenas imagem PNG (data:image/png;base64,)."
          )
          .optional()
          .nullable(),
        biometricStrokeData: z
          .string()
          .max(200_000, "Dados vetoriais da assinatura excedem o limite permitido (200KB).")
          .optional()
          .nullable(),
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
          contentRevision: true,
          updatedAt: true,
          hasPhysicalScan: true,
          physicalScanStorageKey: true,
          physicalScanRevision: true,
          physicalScanSupersededAt: true,
          govBrVerified: true,
          govBrProtocol: true,
          isConfidential: true,
          authorId: true,
          authorEmail: true,
          participants: {
            select: {
              id: true,
              role: true,
              signatureMode: true,
              hasSignature: true,
              hasActiveSignLink: true,
              signedRevision: true,
              verifiedEmail: true,
              mobileSignExpiresAt: true,
            },
          },
        },
      });

      if (!pollMinute) {
        return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
      }

      const schoolRes = await requireAuthorizedSchool(
        authCheck.session,
        authCheck.schoolId,
        authCheck.snapshot
      );
      if (!schoolRes.ok) return schoolRes.response;
      const currentSchool = schoolRes.school;
      const effectiveSession = authCheck.snapshot
        ? buildSessionFromSnapshot(authCheck.session, authCheck.snapshot, currentSchool)
        : authCheck.session;
      if (!assertTenantOwnership(pollMinute.schoolId, currentSchool.id, effectiveSession)) {
        return NextResponse.json(
          { error: "Acesso negado a registro de outra instituição de ensino." },
          { status: 403 }
        );
      }

      if (!canAccessConfidentialMinute(pollMinute, effectiveSession)) {
        return NextResponse.json(
          { error: "Esta ata possui Sigilo Reforçado (ECA) restrito à Direção Escolar e ao servidor autor." },
          { status: 403 }
        );
      }

      const nowMs = Date.now();
      const pollProofState = evaluateEffectivePhysicalProof(pollMinute);
      return NextResponse.json({
        success: true,
        poll: true,
        minuteId: pollMinute.id,
        status: pollMinute.status,
        contentRevision: pollMinute.contentRevision ?? 1,
        updatedAt: pollMinute.updatedAt ? new Date(pollMinute.updatedAt).toISOString() : null,
        hasPhysicalScan:
          pollProofState.hasValidPhysicalProof && pollProofState.hasPhysicalArtifact,
        hasPhysicalProof: pollProofState.hasValidPhysicalProof,
        physicalScanRevision: pollMinute.physicalScanRevision ?? null,
        physicalScanSupersededAt: pollMinute.physicalScanSupersededAt ?? null,
        govBrVerified: pollProofState.isValidGovBrVerified,
        govBrProtocol: pollProofState.effectiveGovBrProtocol,
        participants: (pollMinute.participants || []).map((p) => ({
          participantId: p.id,
          role: p.role,
          signatureMode: p.signatureMode,
          hasSignature: Boolean(p.hasSignature),
          hasActiveSignLink: Boolean(p.hasActiveSignLink),
          signedRevision: p.signedRevision ?? null,
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

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const effectiveSession = authCheck.snapshot
      ? buildSessionFromSnapshot(authCheck.session, authCheck.snapshot, currentSchool)
      : authCheck.session;
    if (!assertTenantOwnership(minute.schoolId, currentSchool.id, effectiveSession)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canAccessConfidentialMinute(minute, effectiveSession)) {
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

    const rawPhysicalProofHistory =
      typeof (prisma as any).pedagogicalMinutePhysicalProofHistory?.findMany === "function"
        ? await (prisma as any).pedagogicalMinutePhysicalProofHistory.findMany({
            where: { minuteId: id },
            orderBy: { supersededAt: "desc" },
            select: PHYSICAL_PROOF_HISTORY_SELECT,
          })
        : [];
    const physicalProofHistory = filterAccessiblePhysicalProofHistory(
      rawPhysicalProofHistory,
      minute.schoolId,
      currentSchool.id,
      effectiveSession
    );

    const proofState = evaluateEffectivePhysicalProof({ ...minute, physicalProofHistory });
    const safeMinute = {
      ...minute,
      students: stripInternalStudentNameAliases(minute.students),
      hasPhysicalScan: proofState.hasValidPhysicalProof && proofState.hasPhysicalArtifact,
      govBrVerified: proofState.isValidGovBrVerified,
      govBrProtocol: proofState.effectiveGovBrProtocol,
      physicalSignedScanData: proofState.hasValidPhysicalProof ? minute.physicalSignedScanData : null,
      physicalScanStorageKey: proofState.hasValidPhysicalProof ? minute.physicalScanStorageKey : null,
      physicalScanProvider: proofState.hasValidPhysicalProof ? minute.physicalScanProvider : null,
      physicalScanMimeType: proofState.hasValidPhysicalProof ? minute.physicalScanMimeType : null,
      physicalScanSizeBytes: proofState.hasValidPhysicalProof ? minute.physicalScanSizeBytes : null,
      physicalScanSha256: proofState.hasValidPhysicalProof ? minute.physicalScanSha256 : null,
      physicalScanUploadedAt: proofState.hasValidPhysicalProof ? minute.physicalScanUploadedAt : null,
      physicalScanUploadedBy: proofState.hasValidPhysicalProof ? minute.physicalScanUploadedBy : null,
      physicalProofHistory,
      participants: (minute.participants || []).map(
        ({ mobileSignToken, mobileSignExpiresAt, mobileSignRevision, ...rest }: any) => ({
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

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const effectiveSession = authCheck.snapshot
      ? buildSessionFromSnapshot(authCheck.session, authCheck.snapshot, currentSchool)
      : authCheck.session;

    if (!assertTenantOwnership(existing.schoolId, currentSchool.id, effectiveSession)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canAccessConfidentialMinute(existing, effectiveSession)) {
      return NextResponse.json(
        { error: "Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor." },
        { status: 403 }
      );
    }

    if (existing.status !== "DRAFT") {
      return NextResponse.json(
        {
          error:
            "Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico (ou via anexo físico).",
        },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    if (
      rawBody &&
      typeof rawBody === "object" &&
      Object.prototype.hasOwnProperty.call(rawBody, "physicalSignedScanData") &&
      rawBody.physicalSignedScanData !== undefined
    ) {
      return NextResponse.json(
        { error: "Anexos físicos digitalizados devem ser enviados exclusivamente pelo endpoint /api/atas/[id]/physical-scan." },
        { status: 400 }
      );
    }
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
      await acquireMinuteWriteLock(tx, id);

      const lockedMinute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        include: {
          students: true,
          participants: true,
          actionItems: true,
        },
      });

      if (!lockedMinute) {
        throw new Error("NOT_FOUND:Ata não encontrada");
      }

      if (!assertTenantOwnership(lockedMinute.schoolId, currentSchool.id, effectiveSession)) {
        throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
      }

      if (!canAccessConfidentialMinute(lockedMinute, effectiveSession)) {
        throw new Error(
          "FORBIDDEN:Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor."
        );
      }

      if (lockedMinute.status !== "DRAFT") {
        throw new Error(
          "IMMUTABLE:Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico (ou via anexo físico)."
        );
      }

      if (data.participants) {
        await validateParticipantStudentLinks(tx, lockedMinute.schoolId, data.participants);
      }

      const lockState = evaluateMinuteRevisionLock(lockedMinute);
      if (lockState.isLockedBySignature) {
        throw new Error(
          lockState.hasLegacyUnprovableProof
            ? "CONFLICT:Esta ata possui assinatura anterior sem comprovação de revisão e está bloqueada. Utilize 'Reabrir para edição' para invalidar as coletas antigas e coletar novamente."
            : "CONFLICT:Esta ata já possui assinatura registrada na revisão atual e está travada para edição. Utilize 'Reabrir para edição' caso precise alterar o conteúdo."
        );
      }

      if (data.expectedRevision !== undefined && data.expectedRevision !== lockState.currentRevision) {
        throw new Error(
          "CONFLICT:O rascunho desta ata foi atualizado para uma nova revisão em outra aba ou sessão. Recarregue antes de editar."
        );
      }

      if (
        (data.participants || []).some((p) =>
          Boolean(p.signatureData || p.verifiedEmail || p.biometricVerified)
        )
      ) {
        throw new Error(
          "CONFLICT:Coletas de assinatura devem ser confirmadas diretamente na revisão conferida via assinatura em tela ou link de assinatura."
        );
      }

      let nextStudentSnapshots:
        | Array<{
            minuteId: string;
            studentId: string;
            studentNameSnapshot: string;
            previousNameSnapshots: string[];
            classNameSnapshot: string | null;
            cgmSnapshot: string | null;
          }>
        | undefined;

      const effectiveTexts = [
        data.subject !== undefined ? data.subject : lockedMinute.subject,
        data.summary !== undefined ? data.summary : lockedMinute.summary,
        data.agreementsSummary !== undefined ? data.agreementsSummary : lockedMinute.agreementsSummary,
      ];

      if (data.studentIds !== undefined) {
        const uniqueStudentIds = Array.from(new Set(data.studentIds));

        if (uniqueStudentIds.length === 0) {
          const participantsCount =
            data.participants !== undefined
              ? data.participants.length
              : tx.pedagogicalMinuteParticipant?.count
                ? await tx.pedagogicalMinuteParticipant.count({ where: { minuteId: id } })
                : (lockedMinute.participants || []).length;

          if (participantsCount === 0) {
            throw new Error(
              "VALIDATION:A ata deve possuir ao menos um estudante vinculado ou participante docente/servidor registrado."
            );
          }
          nextStudentSnapshots = [];
        } else {
          const studentsDb = await tx.student.findMany({
            where: { id: { in: uniqueStudentIds }, schoolId: lockedMinute.schoolId },
            include: { classGroup: true },
          });

          if (studentsDb.length !== uniqueStudentIds.length) {
            throw new Error(
              "VALIDATION:Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
            );
          }

          nextStudentSnapshots = studentsDb.map((s) => {
            const prevLink = (lockedMinute.students || []).find(
              (es: any) => es.studentId === s.id
            ) as
              | {
                  studentNameSnapshot?: string | null;
                  previousNameSnapshots?: string[] | null;
                }
              | undefined;
            return {
              minuteId: id,
              studentId: s.id,
              studentNameSnapshot: s.name,
              previousNameSnapshots: retainNecessaryPreviousStudentNames(
                prevLink?.previousNameSnapshots,
                prevLink?.studentNameSnapshot,
                s.name,
                effectiveTexts
              ),
              classNameSnapshot: s.classGroup?.name || null,
              cgmSnapshot: s.cgm || null,
            };
          });
        }
      }

      const existingParticipants = data.participants
        ? tx.pedagogicalMinuteParticipant?.findMany
          ? await tx.pedagogicalMinuteParticipant.findMany({
              where: { minuteId: id },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            })
          : lockedMinute.participants || []
        : lockedMinute.participants || [];

      let previewParticipants: ReturnType<typeof mergeParticipantSignatures> | undefined;
      if (data.participants) {
        previewParticipants = mergeParticipantSignatures(
          data.participants,
          existingParticipants,
          { clearMobileTokens: false, minuteId: id }
        );
        await validateParticipantStudentLinks(tx, lockedMinute.schoolId, previewParticipants);
      }

      const nextActionItems = data.actionItems
        ? data.actionItems.map((a) => ({
            minuteId: id,
            description: a.description,
            responsible: a.responsible,
            dueDate: a.dueDate ? new Date(a.dueDate) : null,
            status: a.status || "PENDING",
          }))
        : undefined;

      const existingForDiff = {
        ...lockedMinute,
        participants: existingParticipants,
      };
      const effectiveChanged = hasEffectiveMinuteDraftChanges(existingForDiff, {
        ...data,
        nextStudentSnapshots,
        nextMergedParticipants: previewParticipants,
        nextActionItems,
      });

      const rawPhysicalProofHistory =
        typeof (tx as any).pedagogicalMinutePhysicalProofHistory?.findMany === "function"
          ? await (tx as any).pedagogicalMinutePhysicalProofHistory.findMany({
              where: { minuteId: id },
              orderBy: { supersededAt: "desc" },
              select: PHYSICAL_PROOF_HISTORY_SELECT,
            })
          : [];
      const physicalProofHistory = filterAccessiblePhysicalProofHistory(
        rawPhysicalProofHistory,
        lockedMinute.schoolId,
        currentSchool.id,
        effectiveSession
      );

      if (!effectiveChanged) {
        return {
          effectiveChanged: false as const,
          minute: {
            ...lockedMinute,
            physicalProofHistory,
          },
        };
      }

      const nextRevision = lockState.currentRevision + 1;

      if (nextStudentSnapshots !== undefined) {
        await tx.pedagogicalMinuteStudent.deleteMany({ where: { minuteId: id } });
        if (nextStudentSnapshots.length > 0) {
          await tx.pedagogicalMinuteStudent.createMany({
            data: nextStudentSnapshots,
          });
        }
      }

      if (data.participants) {
        const participantsToCreate = mergeParticipantSignatures(
          data.participants,
          existingParticipants,
          { clearMobileTokens: true, minuteId: id }
        );

        await validateParticipantStudentLinks(tx, lockedMinute.schoolId, participantsToCreate);

        await tx.pedagogicalMinuteParticipant.deleteMany({ where: { minuteId: id } });
        if (participantsToCreate.length > 0) {
          await tx.pedagogicalMinuteParticipant.createMany({
            data: participantsToCreate,
          });
        }
      } else if (typeof tx.pedagogicalMinuteParticipant?.updateMany === "function") {
        await tx.pedagogicalMinuteParticipant.updateMany({
          where: { minuteId: id },
          data: {
            mobileSignToken: null,
            mobileSignExpiresAt: null,
            mobileSignRevision: null,
            hasActiveSignLink: false,
          },
        });
      }

      if (nextActionItems !== undefined) {
        await tx.pedagogicalActionItem.deleteMany({ where: { minuteId: id } });
        if (nextActionItems.length > 0) {
          await tx.pedagogicalActionItem.createMany({
            data: nextActionItems,
          });
        }
      }

      const savedMinute = await tx.pedagogicalMinute.update({
        where: { id },
        data: {
          category: data.category,
          isConfidential: data.isConfidential,
          attendedAt: data.attendedAt ? new Date(data.attendedAt) : undefined,
          subject: data.subject,
          rawNotes: data.rawNotes,
          summary: data.summary,
          agreementsSummary: data.agreementsSummary,
          contentRevision: nextRevision,
        },
        include: {
          students: true,
          participants: true,
          actionItems: true,
        },
      });

      return {
        effectiveChanged: true as const,
        minute: {
          ...savedMinute,
          physicalProofHistory,
        },
      };
        },
        { maxWait: 5000, timeout: 10000 }
      );

    if (updated.effectiveChanged) {
      await logAudit({
        action: "UPDATE_ATA_DRAFT",
        entityType: "PedagogicalMinute",
        entityId: id,
        schoolId: existing.schoolId,
        details: `Rascunho de ata atualizado: ${updated.minute.subject}`,
        user: {
          id: authCheck.userId,
          name: authCheck.userName,
          email: authCheck.email,
        },
        ipAddress: ip,
      });
    }

      const updatedProofState = evaluateEffectivePhysicalProof(updated.minute);
    const sanitizedUpdated = stripParticipantSecrets({
      ...updated.minute,
      students: stripInternalStudentNameAliases(updated.minute.students),
      hasPhysicalScan:
        updatedProofState.hasValidPhysicalProof && updatedProofState.hasPhysicalArtifact,
      govBrVerified: updatedProofState.isValidGovBrVerified,
      govBrProtocol: updatedProofState.effectiveGovBrProtocol,
      physicalSignedScanData: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalSignedScanData
        : null,
      physicalScanStorageKey: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalScanStorageKey
        : null,
      physicalScanProvider: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalScanProvider
        : null,
      physicalScanMimeType: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalScanMimeType
        : null,
      physicalScanSizeBytes: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalScanSizeBytes
        : null,
      physicalScanSha256: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalScanSha256
        : null,
      physicalScanUploadedAt: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalScanUploadedAt
        : null,
      physicalScanUploadedBy: updatedProofState.hasValidPhysicalProof
        ? updated.minute.physicalScanUploadedBy
        : null,
    });

    return NextResponse.json({ success: true, minute: sanitizedUpdated });
  } catch (error: any) {
    const msg = error?.message || "";
    if (msg.startsWith("NOT_FOUND:")) {
      return NextResponse.json({ error: msg.replace("NOT_FOUND:", "") }, { status: 404 });
    }
    if (msg.startsWith("FORBIDDEN:") || msg.startsWith("IMMUTABLE:")) {
      return NextResponse.json({ error: msg.replace(/^(FORBIDDEN|IMMUTABLE):/, "") }, { status: 403 });
    }
    if (msg.startsWith("CONFLICT:")) {
      return NextResponse.json({ error: msg.replace("CONFLICT:", "") }, { status: 409 });
    }
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

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
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
