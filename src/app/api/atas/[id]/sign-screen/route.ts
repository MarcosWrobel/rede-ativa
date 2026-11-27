import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { buildSessionFromSnapshot } from "@/lib/serverAuthContext";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  canAccessConfidentialMinute,
  stripInternalStudentNameAliases,
  stripParticipantSecrets,
  validatePngSignatureDataUrl,
} from "@/lib/ataCrypto";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import {
  evaluateMinuteRevisionLock,
  hasMinimumOfficialSummary,
  OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR,
} from "@/lib/ataRevision";
import { logAudit, extractClientIp } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_SIG_BYTES = 512 * 1024;
const MAX_SIG_BASE64_CHARS = 700_000;
const MAX_STROKE_BYTES = 200 * 1024;

const signScreenSchema = z.object({
  participantId: z.string().min(1, "Informe o identificador do participante."),
  expectedRevision: z.number().int().min(1, "Revisão conferida é obrigatória."),
  signatureData: z
    .string()
    .min(20, "Assinatura em tela não informada.")
    .max(MAX_SIG_BASE64_CHARS, "Imagem de assinatura excede o tamanho máximo permitido (512KB)."),
  biometricStrokeData: z
    .string()
    .max(MAX_STROKE_BYTES, "Dados do traço excedem o limite permitido (200KB).")
    .optional()
    .nullable(),
  clientTimestampIso: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const rawBody = await req.json();
    const parsed = signScreenSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados de assinatura inválidos." },
        { status: 400 }
      );
    }

    const { participantId, expectedRevision, signatureData, biometricStrokeData, clientTimestampIso } =
      parsed.data;

    const sigValidation = validatePngSignatureDataUrl(signatureData, MAX_SIG_BYTES);
    if (!sigValidation.ok) {
      return NextResponse.json({ error: sigValidation.error }, { status: 400 });
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

    const ip = extractClientIp(req);
    const userAgent = req.headers.get("user-agent") || null;
    const now = new Date();

    const runTx =
      typeof prisma.$transaction === "function"
        ? (fn: (txClient: any) => Promise<any>) => withTenantContext(prisma, currentSchool.id, fn)
        : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

    const txResult = await runTx(async (tx) => {
      await acquireMinuteWriteLock(tx, id);

      const minute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        include: {
          students: true,
          participants: true,
          actionItems: true,
        },
      });

      if (!minute) {
        throw new Error("NOT_FOUND:Ata pedagógica não encontrada.");
      }

      if (!assertTenantOwnership(minute.schoolId, currentSchool.id, effectiveSession)) {
        throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
      }

      if (!canAccessConfidentialMinute(minute, effectiveSession)) {
        throw new Error(
          "FORBIDDEN:Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor."
        );
      }

      if (minute.status !== "DRAFT") {
        throw new Error(
          "CONFLICT:Somente atas em rascunho podem receber assinatura em tela."
        );
      }

      const lockState = evaluateMinuteRevisionLock(minute);
      if (lockState.hasLegacyUnprovableProof) {
        throw new Error(
          "CONFLICT:Esta ata possui assinatura anterior sem comprovação de revisão. Utilize 'Reabrir para edição' antes de coletar novas assinaturas."
        );
      }

      if (expectedRevision !== lockState.currentRevision) {
        throw new Error(
          "CONFLICT:O conteúdo desta ata foi atualizado para outra revisão. Confira a revisão vigente antes de coletar a assinatura."
        );
      }

      if (!hasMinimumOfficialSummary(minute.summary)) {
        throw new Error(`VALIDATION_SUMMARY:${OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR}`);
      }

      const participant = (minute.participants || []).find((p: any) => p.id === participantId);
      if (!participant) {
        throw new Error("NOT_FOUND:Participante não encontrado nesta ata.");
      }

      if (
        participant.signatureMode === "REFUSED" ||
        participant.hasSignature ||
        participant.signatureData ||
        participant.verifiedEmail ||
        participant.signedAt
      ) {
        throw new Error(
          "CONFLICT:Este participante já possui assinatura ou registro de recusa nesta ata. Utilize 'Reabrir para edição' caso precise reiniciar as coletas."
        );
      }

      await tx.pedagogicalMinuteParticipant.update({
        where: { id: participant.id },
        data: {
          signatureMode: "SCREEN_CANVAS",
          signatureData,
          signedAt: now,
          signerIp: ip,
          signerUserAgent: userAgent,
          biometricStrokeData: biometricStrokeData || null,
          clientTimestampIso: clientTimestampIso || now.toISOString(),
          hasSignature: true,
          signedRevision: lockState.currentRevision,
          mobileSignToken: null,
          mobileSignExpiresAt: null,
          mobileSignRevision: null,
          hasActiveSignLink: false,
        },
      });

      const refreshed = await tx.pedagogicalMinute.findUnique({
        where: { id },
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

      return {
        minute: refreshed,
        signedRevision: lockState.currentRevision,
        schoolId: minute.schoolId,
      };
    });

    await logAudit({
      action: "SIGN_ATA_SCREEN",
      entityType: "PedagogicalMinute",
      entityId: id,
      schoolId: txResult.schoolId,
      details: {
        minuteId: id,
        participantId,
        signedRevision: txResult.signedRevision,
        mode: "SCREEN_CANVAS",
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({
      success: true,
      contentRevision: txResult.signedRevision,
      signedRevision: txResult.signedRevision,
      minute: stripParticipantSecrets({
        ...txResult.minute,
        students: stripInternalStudentNameAliases(txResult.minute?.students),
      }),
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
    if (msg.startsWith("VALIDATION_SUMMARY:")) {
      return NextResponse.json(
        {
          error: msg.replace("VALIDATION_SUMMARY:", ""),
          code: "OFFICIAL_SUMMARY_REQUIRED",
        },
        { status: 400 }
      );
    }
    console.error("[POST /api/atas/[id]/sign-screen] Erro:", error);
    return NextResponse.json({ error: "Erro ao registrar assinatura em tela." }, { status: 500 });
  }
}
