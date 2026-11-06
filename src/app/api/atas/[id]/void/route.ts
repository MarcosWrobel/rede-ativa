import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSchoolManager, checkIsSuperAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { logAudit, extractClientIp } from "@/lib/audit";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { verifyServerSigningPin } from "@/lib/signingPin";
import { checkRateLimit, resetRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const voidAtaSchema = z.object({
  reason: z.string().min(10, "A justificativa para tornar a ata sem efeito deve ter no mínimo 10 caracteres"),
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

    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
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

    // Princípio do Paralelismo das Formas: apenas Direção/Gestão Escolar ou SuperAdmin podem anular ata lavrada
    const canVoid =
      checkIsSuperAdmin(authCheck.session) ||
      checkIsSchoolManager(authCheck.session, minute.schoolId || currentSchool.id);
    if (!canVoid) {
      return NextResponse.json(
        {
          error:
            "Apenas a Direção/Gestão Escolar ou Administração Geral possui alçada para tornar sem efeito uma ata oficial já lavrada.",
        },
        { status: 403 }
      );
    }

    if (minute.status !== "FINALIZED") {
      return NextResponse.json(
        { error: "Apenas atas lavradas (FINALIZED) podem receber averbação de cancelamento ('Tornada Sem Efeito'). Rascunhos devem ser descartados." },
        { status: 400 }
      );
    }

    const rawBody = await req.json();
    const parsed = voidAtaSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    // Exige validação do PIN de Fé Pública do gestor responsável pelo cancelamento com trava anti-brute-force
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

    const pinCheck = await verifyServerSigningPin(prisma, authCheck.userId, parsed.data.signingPin);
    if (!pinCheck.ok) {
      return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status || 401 });
    }
    await resetRateLimit(pinLockKey);

    const now = new Date();
    const updated = await prisma.pedagogicalMinute.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidedAt: now,
        voidedByName: authCheck.userName || "Equipe Pedagógica",
        voidedByEmail: authCheck.email,
        voidReason: parsed.data.reason.trim(),
      },
    });

    await logAudit({
      action: "VOID_ATA",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Ata nº ${String(minute.ataNumber).padStart(3, "0")}/${minute.year} TORNADA SEM EFEITO. Motivo: ${parsed.data.reason}`,
      schoolId: minute.schoolId || currentSchool.id,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute: updated });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/void] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao averbar cancelamento" }, { status: 500 });
  }
}
