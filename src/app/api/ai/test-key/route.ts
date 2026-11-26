import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { prisma } from "@/lib/prisma";
import {
  evaluateFormalizeExternalAiEligibility,
  getServerGeminiApiKey,
  isExternalFormalizeEnabledGlobally,
} from "@/lib/aiPolicy";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

async function resolveSchoolStatus(schoolId: string) {
  let settingsJson: string | null = null;
  let schoolConfigLoaded = false;
  if (typeof (prisma as any)?.school?.findUnique === "function") {
    try {
      const row = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { settingsJson: true },
      });
      if (row) {
        settingsJson = row.settingsJson ?? null;
        schoolConfigLoaded = true;
      }
    } catch {
      schoolConfigLoaded = false;
    }
  }

  const eligibility = evaluateFormalizeExternalAiEligibility({
    schoolId,
    schoolSettingsJson: settingsJson,
    schoolConfigLoaded,
  });

  const serverKeyConfigured = Boolean(getServerGeminiApiKey());
  const externalFormalizeEnabled = isExternalFormalizeEnabledGlobally();

  return {
    serverKeyConfigured,
    externalFormalizeEnabled,
    schoolAuthorized: eligibility.allowed,
    mode: eligibility.allowed ? ("EXTERNAL_AI_ELIGIBLE" as const) : ("LOCAL_ONLY" as const),
    reason: eligibility.reason,
  };
}

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;

    const status = await resolveSchoolStatus(schoolRes.school.id);

    return NextResponse.json({
      hasServerKey: status.schoolAuthorized,
      serverKeyConfigured: status.serverKeyConfigured,
      externalFormalizeEnabled: status.externalFormalizeEnabled,
      schoolAuthorized: status.schoolAuthorized,
      mode: status.mode,
      reason: status.reason,
    });
  } catch {
    return NextResponse.json({
      hasServerKey: false,
      serverKeyConfigured: false,
      externalFormalizeEnabled: false,
      schoolAuthorized: false,
      mode: "LOCAL_ONLY",
    });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rateLimitKey = `ai:${authCheck.schoolId || "global"}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.AI_ENDPOINT);
    if (!rlCheck.ok) return rlCheck.response;

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;

    // Ignora eventuais corpos legados (`apiKey`) sem realizar chamadas externas neste endpoint
    await req.text().catch(() => "");

    const status = await resolveSchoolStatus(schoolRes.school.id);

    return NextResponse.json({
      success: true,
      hasServerKey: status.schoolAuthorized,
      serverKeyConfigured: status.serverKeyConfigured,
      externalFormalizeEnabled: status.externalFormalizeEnabled,
      schoolAuthorized: status.schoolAuthorized,
      mode: status.mode,
      reason: status.reason,
      source: status.schoolAuthorized ? "configuracao_servidor_institucional" : "somente_local",
      message: status.schoolAuthorized
        ? "Formalização de atas autorizada para uso da configuração institucional do servidor."
        : "Instituição operando com processamento exclusivamente local.",
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Erro interno ao testar conectividade da chave de IA." },
      { status: 500 }
    );
  }
}
