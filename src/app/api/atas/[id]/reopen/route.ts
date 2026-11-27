import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { buildSessionFromSnapshot } from "@/lib/serverAuthContext";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  PHYSICAL_PROOF_HISTORY_SELECT,
  canAccessConfidentialMinute,
  filterAccessiblePhysicalProofHistory,
  stripInternalStudentNameAliases,
  stripParticipantSecrets,
} from "@/lib/ataCrypto";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import { evaluateMinuteRevisionLock, hasDraftPhysicalProof } from "@/lib/ataRevision";
import { logAuditStrict, extractClientIp } from "@/lib/audit";

export const dynamic = "force-dynamic";

const reopenAtaSchema = z.object({
  confirmReopen: z.literal(true, {
    message: "Confirme explicitamente a reabertura da ata para edição.",
  }),
  expectedRevision: z.number().int().min(1, "Informe a revisão exibida para confirmar a reabertura."),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    let rawBody: unknown = null;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = null;
    }

    const parsed = reopenAtaSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Confirmação explícita obrigatória." },
        { status: 400 }
      );
    }

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot,
      { allowSuperAdminReadOnlyFallback: false }
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;
    const effectiveSession = authCheck.snapshot
      ? buildSessionFromSnapshot(authCheck.session, authCheck.snapshot, currentSchool)
      : authCheck.session;

    const ip = extractClientIp(req);
    const reopenedAt = new Date();

    const runTx =
      typeof prisma.$transaction === "function"
        ? (fn: (txClient: any) => Promise<any>) => withTenantContext(prisma, currentSchool.id, fn)
        : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

    const txResult = await runTx(async (tx) => {
      await acquireMinuteWriteLock(tx, id);

      const minute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        include: {
          participants: true,
        },
      });

      if (!minute) {
        throw new Error("NOT_FOUND:Ata pedagógica não encontrada.");
      }

      if (
        minute.schoolId !== currentSchool.id ||
        !assertTenantOwnership(minute.schoolId, currentSchool.id, effectiveSession)
      ) {
        throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
      }

      if (!canAccessConfidentialMinute(minute, effectiveSession)) {
        throw new Error(
          "FORBIDDEN:Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor."
        );
      }

      if (minute.status !== "DRAFT") {
        throw new Error(
          "CONFLICT:Somente atas em rascunho podem ser reabertas para edição. Atas já confirmadas aceitam complemento vinculado."
        );
      }

      const lockState = evaluateMinuteRevisionLock(minute);
      if (parsed.data.expectedRevision !== lockState.currentRevision) {
        throw new Error(
          `CONFLICT:A revisão desta ata foi atualizada (exibida: ${parsed.data.expectedRevision}, vigente: ${lockState.currentRevision}). Recarregue os dados atuais e confirme novamente a reabertura.`
        );
      }

      const invalidatedRevision = lockState.currentRevision;
      const nextRevision = invalidatedRevision + 1;
      const invalidatedSignaturesCount = lockState.signedCount;
      const revokedLinksCount = lockState.activeLinksCount;
      const hadDraftPhysicalProof = hasDraftPhysicalProof(minute);
      const hadLegacyUnprovableProof = lockState.hasLegacyUnprovableProof;

      if (hadDraftPhysicalProof && typeof (tx as any).pedagogicalMinutePhysicalProofHistory?.create === "function") {
        await (tx as any).pedagogicalMinutePhysicalProofHistory.create({
          data: {
            minuteId: id,
            schoolId: minute.schoolId,
            contentRevision: minute.physicalScanRevision ?? null,
            originIsConfidential: Boolean(minute.isConfidential),
            originAuthorId: minute.authorId ?? null,
            originAuthorEmail: minute.authorEmail ?? null,
            scanStorageKey: minute.physicalScanStorageKey ?? null,
            scanProvider: minute.physicalScanProvider ?? null,
            scanMimeType: minute.physicalScanMimeType ?? null,
            scanSizeBytes: minute.physicalScanSizeBytes ?? null,
            scanSha256: minute.physicalScanSha256 ?? null,
            scanFallbackData: minute.physicalSignedScanData ?? null,
            uploadedAt: minute.physicalScanUploadedAt ?? null,
            uploadedBy: minute.physicalScanUploadedBy ?? null,
            govBrVerified: Boolean(minute.govBrVerified),
            govBrProtocol: minute.govBrProtocol ?? null,
            supersededAt: reopenedAt,
            supersededByRevision: nextRevision,
            supersededByEmail: authCheck.email,
          },
        });
      }

      await tx.pedagogicalMinuteParticipant.updateMany({
        where: { minuteId: id },
        data: {
          signatureMode: "PENDING",
          signatureData: null,
          signedAt: null,
          signerIp: null,
          signerUserAgent: null,
          biometricStrokeData: null,
          clientTimestampIso: null,
          biometricVerified: false,
          biometricDeviceType: null,
          biometricAuthTime: null,
          verifiedEmail: null,
          verifiedGoogleSub: null,
          verifiedGoogleName: null,
          emailVerifiedAt: null,
          hasSignature: false,
          signedRevision: null,
          mobileSignToken: null,
          mobileSignExpiresAt: null,
          mobileSignRevision: null,
          hasActiveSignLink: false,
          refusalReason: null,
          witnessName: null,
        },
      });

      // Arquiva o histórico no banco sem excluir blobs/arquivos em object storage e limpa os campos ativos da revisão atual.
      const updated = await tx.pedagogicalMinute.update({
        where: { id },
        data: {
          contentRevision: nextRevision,
          ...(hadDraftPhysicalProof
            ? {
                hasPhysicalScan: false,
                physicalSignedScanData: null,
                physicalScanStorageKey: null,
                physicalScanProvider: null,
                physicalScanMimeType: null,
                physicalScanSizeBytes: null,
                physicalScanSha256: null,
                physicalScanUploadedAt: null,
                physicalScanUploadedBy: null,
                physicalScanRevision: null,
                govBrVerified: false,
                govBrProtocol: null,
                physicalScanSupersededAt: reopenedAt,
              }
            : {}),
        },
        include: {
          school: true,
          students: {
            include: {
              student: { select: { id: true, name: true, phone: true, cgm: true } },
            },
          },
          participants: true,
          addendums: { orderBy: { createdAt: "asc" } },
          actionItems: { orderBy: { createdAt: "asc" } },
        },
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
        minute.schoolId,
        currentSchool.id,
        effectiveSession
      );

      // Registra estritamente os metadados necessários na mesma transação (sem dados pessoais ou texto da ata)
      await logAuditStrict(
        {
          action: "REOPEN_ATA_DRAFT",
          entityType: "PedagogicalMinute",
          entityId: id,
          schoolId: minute.schoolId,
          details: {
            minuteId: id,
            reopenedByUserId: authCheck.userId || null,
            reopenedByEmail: authCheck.email,
            reopenedByName: authCheck.userName || "Equipe Pedagógica",
            reopenedAt: reopenedAt.toISOString(),
            invalidatedRevision,
            nextRevision,
            invalidatedSignaturesCount,
            revokedLinksCount,
            hadDraftPhysicalProof,
            hadLegacyUnprovableProof,
          },
          user: {
            id: authCheck.userId,
            name: authCheck.userName || "Equipe Pedagógica",
            email: authCheck.email,
          },
          ipAddress: ip,
        },
        tx as any
      );

      return {
        minute: {
          ...updated,
          students: stripInternalStudentNameAliases(updated.students),
          physicalProofHistory,
        },
        invalidatedRevision,
        nextRevision,
        invalidatedSignaturesCount,
        revokedLinksCount,
      };
    });

    return NextResponse.json({
      success: true,
      invalidatedRevision: txResult.invalidatedRevision,
      contentRevision: txResult.nextRevision,
      invalidatedSignaturesCount: txResult.invalidatedSignaturesCount,
      revokedLinksCount: txResult.revokedLinksCount,
      minute: stripParticipantSecrets(txResult.minute),
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
    console.error("[POST /api/atas/[id]/reopen] Erro:", error);
    return NextResponse.json({ error: "Erro ao reabrir ata para edição." }, { status: 500 });
  }
}
