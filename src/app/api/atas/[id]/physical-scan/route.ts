import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSchoolManager, checkIsSuperAdmin } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  PHYSICAL_PROOF_HISTORY_SELECT,
  canAccessConfidentialMinute,
  canAccessPhysicalProofHistoryItem,
  filterAccessiblePhysicalProofHistory,
} from "@/lib/ataCrypto";
import { logAudit } from "@/lib/audit";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import {
  evaluateEffectivePhysicalProof,
  evaluateMinuteRevisionLock,
  hasDraftPhysicalProof,
  normalizeRevisionNumber,
} from "@/lib/ataRevision";
import { buildSessionFromSnapshot } from "@/lib/serverAuthContext";
import {
  validateAndDecodeScanData,
  savePhysicalScanFile,
  getPhysicalScanBuffer,
  deletePhysicalScanFile,
} from "@/lib/objectStorage";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ALLOWED_SCAN_PREFIX = /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,/i;

const physicalScanSchema = z
  .object({
    expectedRevision: z.number().int().min(1).optional(),
    scanData: z
      .string()
      .min(10, "Dados do anexo digitalizado não informados")
      .refine((v) => ALLOWED_SCAN_PREFIX.test(v.trim()), {
        message: "Formato de arquivo inválido. Envie apenas imagem (PNG, JPEG, WEBP) ou documento PDF codificado em Base64.",
      })
      .optional()
      .nullable(),
    govBrVerified: z.boolean().default(false),
    govBrProtocol: z.string().optional().nullable(),
  })
  .refine((d) => !d.govBrVerified || Boolean(d.govBrProtocol && d.govBrProtocol.trim().length >= 5), {
    message: "Informe o código/protocolo verificador ICP-Brasil/Gov.br (mínimo 5 caracteres) ao marcar assinatura Gov.br verificada.",
    path: ["govBrProtocol"],
  });

/**
 * GET /api/atas/[id]/physical-scan
 * Proxy Autenticado Anti-IDOR para Visualização e Download do Anexo Físico
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const download = searchParams.get("download") === "1";
    const historyId = searchParams.get("historyId")?.trim() || null;

    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        ataNumber: true,
        year: true,
        subject: true,
        status: true,
        contentRevision: true,
        physicalScanRevision: true,
        physicalScanSupersededAt: true,
        hasPhysicalScan: true,
        govBrVerified: true,
        govBrProtocol: true,
        isConfidential: true,
        authorId: true,
        authorEmail: true,
        physicalSignedScanData: true,
        physicalScanStorageKey: true,
        physicalScanProvider: true,
        physicalScanMimeType: true,
        physicalScanSizeBytes: true,
        physicalScanSha256: true,
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
        {
          error:
            "Acesso restrito. Este documento possui sigilo reforçado e sua via física só pode ser acessada pelo autor ou direção escolar.",
        },
        { status: 403 }
      );
    }

    if (historyId) {
      const historyItem = prisma.pedagogicalMinutePhysicalProofHistory?.findFirst
        ? await prisma.pedagogicalMinutePhysicalProofHistory.findFirst({
            where: { id: historyId, minuteId: id },
          })
        : null;

      if (!historyItem) {
        return NextResponse.json(
          { error: "Registro histórico de via física não encontrado." },
          { status: 404 }
        );
      }

      if (
        !canAccessPhysicalProofHistoryItem(
          historyItem,
          minute.schoolId,
          currentSchool.id,
          effectiveSession
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Acesso restrito. Esta via física histórica possui restrição de sigilo vinculada à revisão de origem.",
          },
          { status: 403 }
        );
      }

      if (!historyItem.scanFallbackData && !historyItem.scanStorageKey) {
        return NextResponse.json(
          { error: "Registro histórico de via física não encontrado." },
          { status: 404 }
        );
      }

      const { buffer, mimeType, isVerifiedSha256 } = await getPhysicalScanBuffer({
        physicalSignedScanData: historyItem.scanFallbackData,
        physicalScanStorageKey: historyItem.scanStorageKey,
        physicalScanProvider: historyItem.scanProvider,
        physicalScanMimeType: historyItem.scanMimeType,
        physicalScanSha256: historyItem.scanSha256,
      });

      const ext = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1] || "bin";
      const numStr = minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "SN";
      const revSuffix = historyItem.contentRevision ? `_Rev${historyItem.contentRevision}` : "";
      const filename = `Ata_${numStr}_${minute.year}_ViaFisica_Historico${revSuffix}.${ext}`;
      const disposition = download ? "attachment" : "inline";

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `${disposition}; filename="${filename}"`,
          "Content-Length": String(buffer.length),
          "X-Content-Type-Options": "nosniff",
          "X-Scan-SHA256": historyItem.scanSha256 || "",
          "X-Scan-Integrity-Verified": String(isVerifiedSha256),
          "X-Scan-Historical": "true",
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    if (!minute.physicalSignedScanData && !minute.physicalScanStorageKey) {
      return NextResponse.json(
        { error: "Esta ata não possui via física digitalizada anexada." },
        { status: 404 }
      );
    }

    const effectiveStatus =
      minute.status || (minute.ataNumber != null ? "FINALIZED" : "DRAFT");
    const proofState = evaluateEffectivePhysicalProof({
      ...minute,
      status: effectiveStatus,
    });
    if (!proofState.hasValidPhysicalProof || !proofState.hasPhysicalArtifact) {
      return NextResponse.json(
        {
          error:
            "Esta via física foi superada por reabertura da ata ou não pertence à revisão vigente.",
        },
        { status: 404 }
      );
    }

    const { buffer, mimeType, isVerifiedSha256 } = await getPhysicalScanBuffer(minute);

    const ext = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1] || "bin";
    const numStr = minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "SN";
    const filename = `Ata_${numStr}_${minute.year}_ViaFisica.${ext}`;
    const disposition = download ? "attachment" : "inline";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        "X-Scan-SHA256": minute.physicalScanSha256 || "",
        "X-Scan-Integrity-Verified": String(isVerifiedSha256),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/atas/[id]/physical-scan] Erro:", error);
    return NextResponse.json(
      { error: "Erro interno ao obter anexo da via física" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/atas/[id]/physical-scan
 * Upload Multi-Driver de Anexo Físico com Custódia SHA-256 e Fallback Automático
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const existing = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        ataNumber: true,
        year: true,
        subject: true,
        status: true,
        isConfidential: true,
        authorId: true,
        authorEmail: true,
        physicalScanStorageKey: true,
        physicalScanProvider: true,
        physicalScanSha256: true,
        physicalSignedScanData: true,
        hasPhysicalScan: true,
        govBrVerified: true,
        govBrProtocol: true,
        contentRevision: true,
        physicalScanRevision: true,
        physicalScanSupersededAt: true,
      },
    });

    if (!existing) {
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
    if (!assertTenantOwnership(existing.schoolId, currentSchool.id, effectiveSession)) {
      return NextResponse.json(
        { error: "Acesso negado a ata de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canAccessConfidentialMinute(existing, effectiveSession)) {
      return NextResponse.json(
        { error: "Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor." },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = physicalScanSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Payload inválido" },
        { status: 400 }
      );
    }

    const { scanData, govBrVerified, govBrProtocol, expectedRevision } = parsed.data;
    const hasExistingScan = Boolean(existing.physicalScanStorageKey || existing.physicalSignedScanData);
    const existingEffectiveProof = evaluateEffectivePhysicalProof(existing);

    if (existing.status === "DRAFT") {
      if (expectedRevision === undefined) {
        return NextResponse.json(
          {
            error:
              "Informe a revisão atual da ata para vincular a via física ou o registro Gov.br.",
          },
          { status: 400 }
        );
      }
      const existingRevision = normalizeRevisionNumber(existing.contentRevision);
      if (expectedRevision !== existingRevision) {
        return NextResponse.json(
          {
            error:
              "O conteúdo desta ata foi atualizado para outra revisão. Confira a revisão vigente antes de vincular a via física ou Gov.br.",
          },
          { status: 409 }
        );
      }
      if (hasDraftPhysicalProof(existing)) {
        return NextResponse.json(
          {
            error:
              "Já existe via física ou registro Gov.br vinculado a esta revisão no rascunho. Utilize 'Reabrir para edição' preservando a guarda do original antes de anexar nova versão.",
          },
          { status: 409 }
        );
      }
      if (!scanData) {
        return NextResponse.json(
          {
            error:
              "O envio de um novo arquivo digitalizado é obrigatório para vincular via física ou Gov.br ao rascunho.",
          },
          { status: 400 }
        );
      }
    } else if (!scanData && (!hasExistingScan || !existingEffectiveProof.hasValidPhysicalProof)) {
      return NextResponse.json(
        {
          error:
            "O envio do arquivo digitalizado é obrigatório quando a ata não possui anexo físico vigente.",
        },
        { status: 400 }
      );
    }

    const now = new Date();
    let updateData: any = {
      govBrVerified: Boolean(govBrVerified),
      govBrProtocol: govBrProtocol?.trim() || null,
    };
    let auditDetails: any = {
      ataNumber: existing.ataNumber,
      year: existing.year,
      subject: existing.subject,
      govBrVerified: Boolean(govBrVerified),
      govBrProtocol: govBrProtocol?.trim() || null,
    };

    let decodedSha256: string | null = null;
    if (scanData) {
      try {
        const decoded = validateAndDecodeScanData(scanData);
        decodedSha256 = decoded.sha256;
      } catch (validationErr: any) {
        return NextResponse.json(
          { error: validationErr?.message || "Arquivo digitalizado inválido." },
          { status: 400 }
        );
      }

      const historicalMatch =
        decodedSha256 && prisma.pedagogicalMinutePhysicalProofHistory?.findFirst
          ? await prisma.pedagogicalMinutePhysicalProofHistory.findFirst({
              where: {
                minuteId: id,
                scanSha256: decodedSha256,
              },
              select: { id: true, contentRevision: true },
            })
          : null;

      const isSupersededCurrentSha =
        Boolean(decodedSha256) &&
        existing.physicalScanSha256 === decodedSha256 &&
        (Boolean(existing.physicalScanSupersededAt) ||
          (existing.physicalScanRevision !== null &&
            existing.physicalScanRevision !==
              normalizeRevisionNumber(existing.contentRevision)));

      if (historicalMatch || isSupersededCurrentSha) {
        return NextResponse.json(
          {
            error:
              "Este arquivo digitalizado pertence a uma revisão superada desta ata e permanece apenas no histórico. Digitalize ou envie uma nova via física assinada para a revisão vigente.",
          },
          { status: 409 }
        );
      }

      // Salva via motor híbrido (Object Storage se configurado ou Fallback Base64 no Postgres)
      const stored = await savePhysicalScanFile({
        schoolId: existing.schoolId,
        minuteId: id,
        year: existing.year,
        dataUrl: scanData,
      });

      updateData = {
        ...updateData,
        physicalSignedScanData: stored.fallbackBase64,
        physicalScanStorageKey: stored.storageKey,
        physicalScanProvider: stored.provider,
        physicalScanMimeType: stored.mimeType,
        physicalScanSizeBytes: stored.sizeBytes,
        physicalScanSha256: stored.sha256,
        physicalScanUploadedAt: now,
        physicalScanUploadedBy: authCheck.userName,
        hasPhysicalScan: true,
      };

      auditDetails = {
        ...auditDetails,
        storageProvider: stored.provider,
        dataSizeBytes: stored.sizeBytes,
        scanSha256: stored.sha256,
      };
    }

    let updated: any;
    const selectFields = {
      id: true,
      contentRevision: true,
      physicalScanRevision: true,
      physicalScanSupersededAt: true,
      physicalSignedScanData: true,
      physicalScanStorageKey: true,
      physicalScanProvider: true,
      physicalScanMimeType: true,
      physicalScanSizeBytes: true,
      physicalScanSha256: true,
      physicalScanUploadedAt: true,
      physicalScanUploadedBy: true,
      hasPhysicalScan: true,
      govBrVerified: true,
      govBrProtocol: true,
    };

    if (existing.status === "DRAFT") {
      const runTx =
        typeof prisma.$transaction === "function"
          ? prisma.$transaction.bind(prisma)
          : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

      updated = await runTx(async (tx) => {
        await acquireMinuteWriteLock(tx, id);
        const lockedMinute = await tx.pedagogicalMinute.findUnique({
          where: { id },
          include: { participants: true },
        });
        if (!lockedMinute) {
          throw new Error("NOT_FOUND:Ata pedagógica não encontrada");
        }
        if (!assertTenantOwnership(lockedMinute.schoolId, currentSchool.id, effectiveSession)) {
          throw new Error("FORBIDDEN:Acesso negado a ata de outra instituição de ensino.");
        }
        if (!canAccessConfidentialMinute(lockedMinute, effectiveSession)) {
          throw new Error(
            "FORBIDDEN:Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor."
          );
        }

        const lockState = evaluateMinuteRevisionLock(lockedMinute);
        if (lockedMinute.status !== "DRAFT") {
          throw new Error(
            "CONFLICT:O status desta ata foi alterado antes de salvar a via física. Atualize a tela para conferir."
          );
        }
        if (lockState.hasLegacyUnprovableProof) {
          throw new Error(
            "CONFLICT:Esta ata possui assinatura ou comprovante anterior sem vínculo de revisão comprovado. Utilize 'Reabrir para edição' antes de anexar nova prova."
          );
        }
        if (expectedRevision === undefined) {
          throw new Error(
            "CONFLICT:Informe a revisão atual da ata para vincular a via física ou o registro Gov.br."
          );
        }
        if (expectedRevision !== lockState.currentRevision) {
          throw new Error(
            "CONFLICT:O conteúdo desta ata foi atualizado para outra revisão. Confira a revisão vigente antes de vincular a via física ou Gov.br."
          );
        }
        if (hasDraftPhysicalProof(lockedMinute)) {
          throw new Error(
            "CONFLICT:Já existe via física ou registro Gov.br vinculado a esta revisão no rascunho. Utilize 'Reabrir para edição' preservando a guarda do original antes de anexar nova versão."
          );
        }
        if (!scanData) {
          throw new Error(
            "CONFLICT:O envio de um novo arquivo digitalizado é obrigatório para vincular via física ao rascunho."
          );
        }
        if (decodedSha256) {
          const txHistoricalMatch = tx.pedagogicalMinutePhysicalProofHistory?.findFirst
            ? await tx.pedagogicalMinutePhysicalProofHistory.findFirst({
                where: {
                  minuteId: id,
                  scanSha256: decodedSha256,
                },
                select: { id: true },
              })
            : null;
          const isTxSupersededSha =
            lockedMinute.physicalScanSha256 === decodedSha256 &&
            (Boolean(lockedMinute.physicalScanSupersededAt) ||
              (lockedMinute.physicalScanRevision !== null &&
                lockedMinute.physicalScanRevision !== lockState.currentRevision));
          if (txHistoricalMatch || isTxSupersededSha) {
            throw new Error(
              "CONFLICT:Este arquivo digitalizado pertence a uma revisão superada desta ata e permanece apenas no histórico. Anexe uma nova via física assinada para a revisão vigente."
            );
          }
        }

        return await tx.pedagogicalMinute.update({
          where: { id },
          data: {
            ...updateData,
            physicalScanRevision: lockState.currentRevision,
            physicalScanSupersededAt: null,
          },
          select: selectFields,
        });
      });
    } else {
      const needsRevMetadataReset = Boolean(
        scanData &&
          (existing.physicalScanSupersededAt ||
            (typeof existing.contentRevision === "number" && existing.contentRevision > 1))
      );
      updated = await prisma.pedagogicalMinute.update({
        where: { id },
        data: {
          ...updateData,
          ...(needsRevMetadataReset
            ? {
                physicalScanRevision: normalizeRevisionNumber(existing.contentRevision),
                physicalScanSupersededAt: null,
              }
            : {}),
        },
        select: selectFields,
      });
    }

    const rawPhysicalProofHistory = prisma.pedagogicalMinutePhysicalProofHistory?.findMany
      ? await prisma.pedagogicalMinutePhysicalProofHistory.findMany({
          where: { minuteId: id },
          orderBy: { supersededAt: "desc" },
          select: PHYSICAL_PROOF_HISTORY_SELECT,
        })
      : undefined;
    const physicalProofHistory =
      rawPhysicalProofHistory !== undefined
        ? filterAccessiblePhysicalProofHistory(
            rawPhysicalProofHistory,
            existing.schoolId,
            currentSchool.id,
            effectiveSession
          )
        : undefined;

    await logAudit({
      action: "ATTACH_PHYSICAL_SCAN",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: auditDetails,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({
      success: true,
      minute: {
        ...updated,
        ...(physicalProofHistory !== undefined ? { physicalProofHistory } : {}),
      },
    });
  } catch (error: any) {
    const msg = error?.message || "";
    if (msg.startsWith("NOT_FOUND:")) {
      return NextResponse.json({ error: msg.replace("NOT_FOUND:", "") }, { status: 404 });
    }
    if (msg.startsWith("FORBIDDEN:")) {
      return NextResponse.json({ error: msg.replace("FORBIDDEN:", "") }, { status: 403 });
    }
    if (msg.startsWith("CONFLICT:")) {
      return NextResponse.json({ error: msg.replace("CONFLICT:", "") }, { status: 409 });
    }
    console.error("[POST /api/atas/[id]/physical-scan] Erro:", error);
    return NextResponse.json(
      { error: "Erro interno ao salvar via física digitalizada" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/atas/[id]/physical-scan
 * Remoção com Purga do Storage Externo e Auditoria
 */
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
      select: {
        id: true,
        schoolId: true,
        ataNumber: true,
        year: true,
        subject: true,
        status: true,
        isConfidential: true,
        authorId: true,
        authorEmail: true,
        contentRevision: true,
        physicalScanRevision: true,
        physicalScanSupersededAt: true,
        hasPhysicalScan: true,
        govBrVerified: true,
        physicalScanStorageKey: true,
        physicalScanProvider: true,
      },
    });

    if (!existing) {
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
    if (!assertTenantOwnership(existing.schoolId, currentSchool.id, effectiveSession)) {
      return NextResponse.json(
        { error: "Acesso negado a ata de outra instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canAccessConfidentialMinute(existing, effectiveSession)) {
      return NextResponse.json(
        { error: "Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor." },
        { status: 403 }
      );
    }

    if (existing.status === "DRAFT") {
      const runTx =
        typeof prisma.$transaction === "function"
          ? prisma.$transaction.bind(prisma)
          : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

      await runTx(async (tx) => {
        await acquireMinuteWriteLock(tx, id);
        const lockedMinute = await tx.pedagogicalMinute.findUnique({
          where: { id },
          include: { participants: true },
        });
        if (!lockedMinute) {
          throw new Error("NOT_FOUND:Ata pedagógica não encontrada");
        }
        const lockState = evaluateMinuteRevisionLock(lockedMinute);
        if (lockedMinute.status === "DRAFT" && (lockState.isLockedBySignature || hasDraftPhysicalProof(lockedMinute))) {
          throw new Error(
            "CONFLICT:A via física ou registro Gov.br vinculado ao rascunho não pode ser removido diretamente para preservar a guarda do original. Utilize 'Reabrir para edição' se precisar invalidar a revisão atual."
          );
        }
        await tx.pedagogicalMinute.update({
          where: { id },
          data: {
            govBrVerified: false,
            govBrProtocol: null,
            physicalScanRevision: null,
          },
        });
      });
    } else {
      // Cadeia de Custódia Probatória: em atas já lavradas (FINALIZED/VOIDED), apenas Direção Escolar ou SuperAdmin removem
      if (existing.status === "FINALIZED" || existing.status === "VOIDED") {
        const targetDescriptor =
          existing.schoolId === currentSchool.id
            ? {
                id: currentSchool.id,
                active: true,
                networkId: currentSchool.networkId,
                network: currentSchool.network,
                city: currentSchool.city,
              }
            : null;
        const canRemoveOfficialScan =
          checkIsSuperAdmin(effectiveSession) ||
          checkIsSchoolManager(
            effectiveSession,
            existing.schoolId || currentSchool.id,
            targetDescriptor
          );
        if (!canRemoveOfficialScan) {
          return NextResponse.json(
            {
              error:
                "A remoção de via física assinada em ata oficial lavrada é restrita à Direção/Gestão Escolar.",
            },
            { status: 403 }
          );
        }
      }

      // Remove do storage externo apenas se o arquivo não estiver em guarda no histórico
      const storageKeyInHistory =
        existing.physicalScanStorageKey &&
        prisma.pedagogicalMinutePhysicalProofHistory?.findFirst
          ? await prisma.pedagogicalMinutePhysicalProofHistory.findFirst({
              where: {
                minuteId: id,
                scanStorageKey: existing.physicalScanStorageKey,
              },
              select: { id: true },
            })
          : null;

      if (!storageKeyInHistory) {
        await deletePhysicalScanFile(existing);
      }

      await prisma.pedagogicalMinute.update({
        where: { id },
        data: {
          physicalSignedScanData: null,
          physicalScanStorageKey: null,
          physicalScanProvider: null,
          physicalScanMimeType: null,
          physicalScanSizeBytes: null,
          physicalScanSha256: null,
          physicalScanUploadedAt: null,
          physicalScanUploadedBy: null,
          hasPhysicalScan: false,
          physicalScanRevision: null,
          physicalScanSupersededAt: null,
          govBrVerified: false,
          govBrProtocol: null,
        },
      });
    }

    await logAudit({
      action: "REMOVE_PHYSICAL_SCAN",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: {
        ataNumber: existing.ataNumber,
        year: existing.year,
        subject: existing.subject,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const msg = error?.message || "";
    if (msg.startsWith("NOT_FOUND:")) {
      return NextResponse.json({ error: msg.replace("NOT_FOUND:", "") }, { status: 404 });
    }
    if (msg.startsWith("FORBIDDEN:")) {
      return NextResponse.json({ error: msg.replace("FORBIDDEN:", "") }, { status: 403 });
    }
    if (msg.startsWith("CONFLICT:")) {
      return NextResponse.json({ error: msg.replace("CONFLICT:", "") }, { status: 409 });
    }
    console.error("[DELETE /api/atas/[id]/physical-scan] Erro:", error);
    return NextResponse.json(
      { error: "Erro interno ao remover via física" },
      { status: 500 }
    );
  }
}
