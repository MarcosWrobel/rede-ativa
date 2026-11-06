import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { computeAddendumHash } from "@/lib/ataCrypto";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { verifyServerSigningPin } from "@/lib/signingPin";
import { checkRateLimit, resetRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const DATA_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;

const addendumSchema = z.object({
  content: z.string().min(5, "Informe o texto do termo de aditamento/retificação"),
  participantSignatureData: z.string().optional().nullable(),
  participantSignerName: z.string().optional().nullable(),
  signingPin: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const ip = extractClientIp(req);

    const rawBody = await req.json();
    const parsed = addendumSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const { content, participantSignatureData, participantSignerName, signingPin } = parsed.data;

    if (participantSignatureData) {
      if (participantSignatureData.length > 512 * 1024 || !DATA_IMAGE_REGEX.test(participantSignatureData.trim())) {
        return NextResponse.json(
          { error: "Formato ou tamanho de assinatura inválido no adendo (use imagem PNG/JPEG até 500KB)." },
          { status: 400 }
        );
      }
    }

    // Pré-validação de existência e posse de tenant antes de checar PIN de Fé Pública
    const preCheckMinute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
    });
    if (!preCheckMinute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }
    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(preCheckMinute.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json({ error: "Acesso negado a registro de outra instituição de ensino." }, { status: 403 });
    }
    if (preCheckMinute.status !== "FINALIZED") {
      return NextResponse.json(
        { error: "Termos de aditamento ('Em tempo') só podem ser lavrados em atas já finalizadas." },
        { status: 400 }
      );
    }

    // Simetria das Formas (Lei nº 14.063/2020): exige PIN de Fé Pública para aditar ata oficial
    const pinLockKey = `pin-fail:${authCheck.userId}`;
    const pinRateCheck = await checkRateLimit(pinLockKey, RATE_LIMIT_POLICIES.PIN_BRUTE_FORCE);
    if (!pinRateCheck.success) {
      return NextResponse.json(
        {
          error: `Muitas tentativas incorretas de PIN. Uso bloqueado por ${pinRateCheck.retryAfterSeconds} segundos.`,
          retryAfter: pinRateCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const pinCheck = await verifyServerSigningPin(prisma, authCheck.userId, signingPin);
    if (!pinCheck.ok) {
      return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status || 401 });
    }
    await resetRateLimit(pinLockKey);

    // Executa em transação atômica para garantir encadeamento linear estrito dos hashes dos adendos
    const addendum = await prisma.$transaction(async (tx) => {
      // Bloqueio pessimista de linha na ata pai para garantir linearidade estrita da hash-chain (Lei nº 14.063/2020)
      try {
        await tx.$executeRaw`
          SELECT "id" FROM "PedagogicalMinute" WHERE "id" = ${id} FOR UPDATE;
        `;
      } catch (lockErr) {
        // Tolerância em ambientes de teste sem suporte a FOR UPDATE
      }

      const minute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        include: {
          addendums: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!minute) {
        throw new Error("Ata pedagógica não encontrada");
      }

      const currentSchool = await getCurrentSchool(authCheck.schoolId);
      if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
        throw new Error("Acesso negado a registro de outra instituição de ensino.");
      }

      if (minute.status !== "FINALIZED") {
        throw new Error("Termos de aditamento ('Em tempo') só podem ser lavrados em atas já finalizadas.");
      }

      // Obtém o hash imediatamente anterior (ou o da ata ou o do último adendo) para encadear
      const previousHash =
        minute.addendums.length > 0
          ? minute.addendums[0].addendumHash
          : minute.contentHash || "genesis";

      const now = new Date();
      const addendumHash = computeAddendumHash(
        previousHash,
        content,
        authCheck.email,
        now.toISOString(),
        participantSignerName,
        participantSignatureData
      );

      const created = await tx.pedagogicalMinuteAddendum.create({
        data: {
          minuteId: id,
          content,
          authorName: authCheck.userName || "Equipe Pedagógica",
          authorEmail: authCheck.email,
          authorIp: ip,
          previousHash,
          addendumHash,
          participantSignatureData: participantSignatureData || null,
          participantSignerName: participantSignerName || null,
          createdAt: now,
        },
      });

      return {
        ...created,
        minuteAtaNumber: minute.ataNumber,
        minuteYear: minute.year,
        minuteSchoolId: minute.schoolId,
      };
    });

    await logAudit({
      action: "ADD_ATA_ADDENDUM",
      entityType: "PedagogicalMinuteAddendum",
      entityId: addendum.id,
      details: `Adendo 'Em tempo' adicionado à Ata nº ${String(addendum.minuteAtaNumber || 0).padStart(3, "0")}/${addendum.minuteYear || new Date().getFullYear()} — Hash: ${addendum.addendumHash.slice(0, 16)}...`,
      schoolId: addendum.minuteSchoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, addendum }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/addendums] Erro:", error);
    const status = error.message?.includes("Acesso negado") ? 403 : error.message?.includes("não encontrada") ? 404 : error.message?.includes("já finalizadas") ? 400 : 500;
    return NextResponse.json({ error: error.message || "Erro ao adicionar termo de aditamento" }, { status });
  }
}
