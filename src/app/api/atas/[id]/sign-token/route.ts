import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { acquireMinuteWriteLock } from "@/lib/minuteLock";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function isParticipantAlreadySigned(participant: {
  signedAt?: Date | string | null;
  hasSignature?: boolean | null;
  signatureData?: string | null;
  verifiedEmail?: string | null;
  biometricVerified?: boolean | null;
}): boolean {
  return Boolean(
    participant.signedAt ||
      participant.hasSignature ||
      participant.signatureData ||
      participant.verifiedEmail ||
      participant.biometricVerified
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
    const { participantId, expiresInMinutes } = await req.json();

    if (!participantId) {
      return NextResponse.json({ error: "Informe o ID do participante" }, { status: 400 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const validMinutes = Math.min(Math.max(Number(expiresInMinutes) || 20, 5), 1440);
    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);

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
          "VALIDATION:Não é possível emitir link de assinatura para uma ata já lavrada ou cancelada."
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
          "CONFLICT:Este participante já concluiu a assinatura. Utilize 'Refazer assinatura' para emitir um novo link."
        );
      }

      return await tx.pedagogicalMinuteParticipant.update({
        where: { id: participantId },
        data: {
          mobileSignToken: token,
          mobileSignExpiresAt: expiresAt,
          hasActiveSignLink: true,
        },
      });
    });

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3001";
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const signUrl = `${proto}://${host}/assinar/ata/${token}`;

    console.info("[POST /api/atas/[id]/sign-token] Link emitido:", {
      minuteId: id,
      participantId,
      validMinutes,
      expiresAt: expiresAt.toISOString(),
    });

    return NextResponse.json({
      success: true,
      token,
      signUrl,
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: validMinutes,
      participantName: updated.name,
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

    const currentSchool = await getCurrentSchool(authCheck.schoolId);

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
    if (msg.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: msg.replace("VALIDATION:", "") }, { status: 400 });
    }
    console.error("[DELETE /api/atas/[id]/sign-token] Erro:", error);
    return NextResponse.json({ error: "Erro ao cancelar link de assinatura" }, { status: 500 });
  }
}
