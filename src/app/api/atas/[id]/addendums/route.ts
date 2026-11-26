import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { computeAddendumHash, canAccessConfidentialMinute } from "@/lib/ataCrypto";
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
  let stage = "precheck";
  let stageStartedAt = performance.now();
  const stageDurationsMs: Record<string, number> = {};
  const advanceStage = (next: string) => {
    const now = performance.now();
    stageDurationsMs[stage] = Math.round(now - stageStartedAt);
    stage = next;
    stageStartedAt = now;
  };

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
    if (!canAccessConfidentialMinute(preCheckMinute, authCheck.session)) {
      return NextResponse.json(
        { error: "Esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor." },
        { status: 403 }
      );
    }
    if (preCheckMinute.status !== "FINALIZED") {
      return NextResponse.json(
        { error: "Termos de aditamento ('Em tempo') só podem ser lavrados em atas já finalizadas." },
        { status: 400 }
      );
    }

    // Simetria das Formas: exige confirmação de autoria por PIN para aditar ata confirmada
    const pinLockKey = `pin-fail:${authCheck.userId}`;
    const pinRateCheck = await checkRateLimit(pinLockKey, RATE_LIMIT_POLICIES.PIN_BRUTE_FORCE);
    if (!pinRateCheck.success) {
      await logAudit({
        action: "SIGNING_PIN_LOCKOUT",
        entityType: "User",
        entityId: authCheck.userId,
        details: {
          reason: "Bloqueio temporário por excesso de tentativas incorretas de PIN (15 min)",
          attemptedMinuteId: id,
          retryAfterSeconds: pinRateCheck.retryAfterSeconds,
        },
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        schoolId: preCheckMinute.schoolId || currentSchool.id,
        req,
      });

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
    advanceStage("transaction_open");
    const addendum = await prisma.$transaction(async (tx) => {
      advanceStage("minute_lock");
      // Bloqueia a ata pai antes de ler o último elo da cadeia.
      await tx.$executeRaw`
        SELECT "id" FROM "PedagogicalMinute" WHERE "id" = ${id} FOR UPDATE;
      `;

      advanceStage("minute_read");
      const minute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        include: {
          addendums: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { addendumHash: true, createdAt: true },
          },
        },
      });

      if (!minute) {
        throw new Error("Ata pedagógica não encontrada");
      }

      if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
        throw new Error("Acesso negado a registro de outra instituição de ensino.");
      }
      if (!canAccessConfidentialMinute(minute, authCheck.session)) {
        throw new Error("Acesso negado: esta ata possui sigilo reforçado restrito à Direção Escolar e ao servidor autor.");
      }

      if (minute.status !== "FINALIZED") {
        throw new Error("Termos de aditamento ('Em tempo') só podem ser lavrados em atas já finalizadas.");
      }

      // Obtém o hash imediatamente anterior (ou o da ata ou o do último adendo) para encadear
      const latestAddendum = minute.addendums[0];
      const previousHash = latestAddendum?.addendumHash ?? (minute.contentHash || "genesis");
      // Mantém a ordem da cadeia mesmo quando dois adendos usam o mesmo milissegundo.
      const now = new Date(Math.max(Date.now(), (latestAddendum?.createdAt.getTime() ?? 0) + 1));
      const addendumHash = computeAddendumHash(
        previousHash,
        content,
        authCheck.email,
        now.toISOString(),
        participantSignerName,
        participantSignatureData
      );

      advanceStage("addendum_create");
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

      advanceStage("transaction_commit");
      return {
        ...created,
        minuteAtaNumber: minute.ataNumber,
        minuteYear: minute.year,
        minuteSchoolId: minute.schoolId,
      };
    }, { maxWait: 5000, timeout: 10000 });

    advanceStage("audit");
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
    console.error("[POST /api/atas/[id]/addendums] Erro:", {
      requestId: req.headers.get("x-vercel-id"),
      code: error.code,
      stage,
      stageElapsedMs: Math.round(performance.now() - stageStartedAt),
      stageDurationsMs,
    });
    const status = error.message?.includes("Acesso negado") ? 403 : error.message?.includes("não encontrada") ? 404 : error.message?.includes("já finalizadas") ? 400 : 500;
    const safeMsg = status === 500 ? "Erro ao adicionar termo de aditamento" : error.message || "Erro ao adicionar termo de aditamento";
    return NextResponse.json({ error: safeMsg }, { status });
  }
}
