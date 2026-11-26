import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import {
  evaluateMinuteRevisionLock,
  hasMinimumOfficialSummary,
  OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR,
} from "@/lib/ataRevision";
import { buildSessionFromSnapshot } from "@/lib/serverAuthContext";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function isParticipantAlreadySigned(participant: {
  signedAt?: Date | string | null;
  hasSignature?: boolean | null;
  signatureData?: string | null;
  verifiedEmail?: string | null;
  biometricVerified?: boolean | null;
  signatureMode?: string | null;
}): boolean {
  return Boolean(
    participant.signedAt ||
      participant.hasSignature ||
      participant.signatureData ||
      participant.verifiedEmail ||
      participant.biometricVerified ||
      participant.signatureMode === "REFUSED"
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const { participantId, expiresInMinutes, expectedRevision } = await req.json();

    if (!participantId) {
      return NextResponse.json({ error: "Informe o ID do participante" }, { status: 400 });
    }
    if (
      typeof expectedRevision !== "number" ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      return NextResponse.json(
        { error: "Informe a revisão conferida antes de emitir o link de assinatura." },
        { status: 400 }
      );
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
    const validMinutes = Math.min(Math.max(Number(expiresInMinutes) || 20, 5), 1440);
    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);

    const runTx =
      typeof prisma.$transaction === "function"
        ? prisma.$transaction.bind(prisma)
        : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

    const result = await runTx(async (tx) => {
      await acquireMinuteWriteLock(tx, id);

      const minute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          schoolId: true,
          summary: true,
          isConfidential: true,
          authorId: true,
          authorEmail: true,
          contentRevision: true,
          physicalScanRevision: true,
          physicalScanSupersededAt: true,
          hasPhysicalScan: true,
          physicalSignedScanData: true,
          physicalScanStorageKey: true,
          govBrVerified: true,
          participants: {
            select: {
              id: true,
              signatureMode: true,
              hasSignature: true,
              signatureData: true,
              verifiedEmail: true,
              signedAt: true,
              biometricVerified: true,
              signedRevision: true,
            },
          },
        },
      });

      if (!minute) {
        throw new Error("NOT_FOUND:Ata não encontrada");
      }

      if (!assertTenantOwnership(minute.schoolId, currentSchool.id, effectiveSession)) {
        throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
      }

      if (!canAccessConfidentialMinute(minute, effectiveSession)) {
        throw new Error(
          "FORBIDDEN:Esta ata possui sigilo reforçado. Apenas o autor ou a Direção Escolar possuem acesso."
        );
      }

      if (minute.status !== "DRAFT") {
        throw new Error(
          "VALIDATION:Não é possível emitir link de assinatura para uma ata já lavrada ou cancelada."
        );
      }

      const lockState = evaluateMinuteRevisionLock(minute);
      if (lockState.hasLegacyUnprovableProof) {
        throw new Error(
          "CONFLICT:Esta ata possui assinatura anterior sem vínculo de revisão comprovado. Utilize 'Reabrir para edição' antes de emitir novos links."
        );
      }

      if (expectedRevision !== lockState.currentRevision) {
        throw new Error(
          "CONFLICT:O rascunho desta ata foi atualizado para outra revisão. Recarregue e confira a revisão vigente antes de emitir o link."
        );
      }

      if (!hasMinimumOfficialSummary(minute.summary)) {
        throw new Error(`VALIDATION_SUMMARY:${OFFICIAL_SUMMARY_REQUIRED_FOR_COLLECTION_ERROR}`);
      }

      const participant = await tx.pedagogicalMinuteParticipant.findFirst({
        where: { id: participantId, minuteId: id },
      });

      if (!participant) {
        throw new Error("NOT_FOUND:Participante não encontrado nesta ata");
      }

      if (isParticipantAlreadySigned(participant)) {
        throw new Error(
          "CONFLICT:Este participante já concluiu a assinatura na revisão vigente. Para alterar ou refazer, utilize 'Reabrir para edição'."
        );
      }

      const updatedParticipant = await tx.pedagogicalMinuteParticipant.update({
        where: { id: participantId },
        data: {
          mobileSignToken: token,
          mobileSignExpiresAt: expiresAt,
          mobileSignRevision: lockState.currentRevision,
          hasActiveSignLink: true,
        },
      });

      return {
        updatedParticipant,
        contentRevision: lockState.currentRevision,
      };
    });

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3001";
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const signUrl = `${proto}://${host}/assinar/ata/${token}`;

    console.info("[POST /api/atas/[id]/sign-token] Link emitido:", {
      minuteId: id,
      participantId,
      contentRevision: result.contentRevision,
      validMinutes,
      expiresAt: expiresAt.toISOString(),
    });

    return NextResponse.json({
      success: true,
      token,
      signUrl,
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: validMinutes,
      contentRevision: result.contentRevision,
      participantName: result.updatedParticipant.name,
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
    if (msg.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: msg.replace("VALIDATION:", "") }, { status: 400 });
    }
    console.error("[POST /api/atas/[id]/sign-token] Erro:", error);
    return NextResponse.json({ error: "Erro ao gerar token mobile" }, { status: 500 });
  }
}

/**
 * Cancelamento direcionado de link QR pendente de um único participante.
 * Só executa enquanto o participante não possuir assinatura registrada;
 * caso uma assinatura concorrente já tenha sido gravada, retorna 409 Conflict.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    let participantId: string | null = new URL(req.url).searchParams.get("participantId");
    if (!participantId) {
      try {
        const body = await req.json();
        participantId = body?.participantId ? String(body.participantId) : null;
      } catch {
        participantId = null;
      }
    }

    if (!participantId) {
      return NextResponse.json({ error: "Informe o ID do participante" }, { status: 400 });
    }

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;

    const runTx =
      typeof prisma.$transaction === "function"
        ? prisma.$transaction.bind(prisma)
        : async (fn: (txClient: typeof prisma) => Promise<any>) => fn(prisma);

    const updated = await runTx(async (tx) => {
      await acquireMinuteWriteLock(tx, id);

      const minute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          schoolId: true,
          summary: true,
          isConfidential: true,
          authorId: true,
          authorEmail: true,
        },
      });

      if (!minute) {
        throw new Error("NOT_FOUND:Ata não encontrada");
      }

      if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
        throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
      }

      if (!canAccessConfidentialMinute(minute, authCheck.session)) {
        throw new Error(
          "FORBIDDEN:Esta ata possui sigilo reforçado. Apenas o autor ou a Direção Escolar possuem acesso."
        );
      }

      if (minute.status !== "DRAFT") {
        throw new Error(
          "FORBIDDEN:Ata já lavrada ou cancelada não permite cancelar links de assinatura."
        );
      }

      const participant = await tx.pedagogicalMinuteParticipant.findFirst({
        where: { id: participantId, minuteId: id },
      });

      if (!participant) {
        throw new Error("NOT_FOUND:Participante não encontrado nesta ata");
      }

      if (isParticipantAlreadySigned(participant)) {
        throw new Error(
          "CONFLICT:Este participante já concluiu a assinatura. Utilize 'Refazer assinatura' se precisar substituí-la."
        );
      }

      return await tx.pedagogicalMinuteParticipant.update({
        where: { id: participantId },
        data: {
          mobileSignToken: null,
          mobileSignExpiresAt: null,
          mobileSignRevision: null,
          hasActiveSignLink: false,
        },
      });
    });

    return NextResponse.json({
      success: true,
      participantId: updated.id,
      hasActiveSignLink: false,
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
    if (msg.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: msg.replace("VALIDATION:", "") }, { status: 400 });
    }
    console.error("[DELETE /api/atas/[id]/sign-token] Erro:", error);
    return NextResponse.json({ error: "Erro ao cancelar link de assinatura" }, { status: 500 });
  }
}
