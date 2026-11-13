import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { verifyServerSigningPin } from "@/lib/signingPin";
import { checkRateLimit, resetRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { executeMinuteFinalization } from "@/services/ataFinalizationService";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const ip = extractClientIp(req);

    // Lê payload opcional enviado junto com o pedido de lavratura para sincronização atômica
    let rawBody: any = null;
    try {
      const text = await req.text();
      if (text && text.trim()) {
        rawBody = JSON.parse(text);
      }
    } catch {
      rawBody = null;
    }

    // Proteção Anti-Brute-Force contra adivinhação de PIN de Fé Pública (SEC-08)
    const pinLockKey = `pin-fail:${authCheck.userId}`;
    const pinRateCheck = await checkRateLimit(pinLockKey, RATE_LIMIT_POLICIES.PIN_BRUTE_FORCE);
    if (!pinRateCheck.success) {
      await logAudit({
        action: "SIGNING_PIN_LOCKOUT",
        entityType: "User",
        entityId: authCheck.userId,
        details: {
          reason: "Bloqueio temporário por excesso de tentativas incorretas de PIN de Fé Pública (15 min)",
          attemptedMinuteId: id,
          retryAfterSeconds: pinRateCheck.retryAfterSeconds,
        },
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        schoolId: authCheck.schoolId || "global",
        req,
      });

      return NextResponse.json(
        {
          error: `Muitas tentativas incorretas de PIN. Por segurança, o uso do PIN foi temporariamente bloqueado por ${pinRateCheck.retryAfterSeconds} segundos.`,
          retryAfter: pinRateCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // Validação estrita de Fé Pública (Lei nº 14.063/2020, Art. 4º, II):
    // Exige PIN cadastrado e verificado antes de lavrar oficialmente a ata (sem bypass para signingPinHash nulo)
    const pinCheck = await verifyServerSigningPin(prisma, authCheck.userId, rawBody?.signingPin);
    if (!pinCheck.ok) {
      return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status || 401 });
    }

    // PIN validado com sucesso: reseta eventuais falhas anteriores
    await resetRateLimit(pinLockKey);

    const currentSchool = await getCurrentSchool(authCheck.schoolId);

    const { minute: finalized, alreadyFinalized } = await executeMinuteFinalization({
      prisma,
      minuteId: id,
      rawBody,
      author: {
        userId: authCheck.userId,
        userName: authCheck.userName,
        email: authCheck.email,
        role: authCheck.role || "PEDAGOGA",
        ip,
      },
      verifyTenantOwnership: (minuteSchoolId) =>
        assertTenantOwnership(minuteSchoolId, currentSchool.id, authCheck.session),
    });

    if (alreadyFinalized) {
      return NextResponse.json({ success: true, minute: finalized, alreadyFinalized: true });
    }

    await logAudit({
      action: "FINALIZE_ATA",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Lavratura oficial da Ata nº ${String(finalized.ataNumber).padStart(3, "0")}/${finalized.year} (${finalized.subject}) — Hash SHA-256: ${finalized.contentHash?.slice(0, 16)}...`,
      schoolId: finalized.schoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute: finalized });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/finalize] Erro:", error);
    const msg = error.message || "";
    if (msg.startsWith("NOT_FOUND:")) {
      return NextResponse.json({ error: msg.replace("NOT_FOUND:", "") }, { status: 404 });
    }
    if (msg.startsWith("FORBIDDEN:")) {
      return NextResponse.json({ error: msg.replace("FORBIDDEN:", "") }, { status: 403 });
    }
    if (msg.startsWith("CONFLICT:")) {
      return NextResponse.json({ error: msg.replace("CONFLICT:", "") }, { status: 409 });
    }
    if (msg.startsWith("STATUS_INVALID:") || msg.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: msg.replace(/^(STATUS_INVALID|VALIDATION):/, "") }, { status: 400 });
    }
    return NextResponse.json({ error: "Erro interno ao lavrar ata" }, { status: 500 });
  }
}
