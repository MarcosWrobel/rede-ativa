import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSchool } from "@/lib/currentSchool";
import { findSchoolBySyncToken, safeCompareStrings } from "@/lib/syncToken";
import {
  checkRateLimit,
  getPublicIpRateLimitKey,
  getRateLimitStatus,
  RATE_LIMIT_POLICIES,
  resetRateLimit,
} from "@/lib/rateLimit";

export type ExtensionSyncAuthResult =
  | {
      ok: true;
      targetSchoolId: string;
      userName: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export type ExtensionSyncLabel =
  | "Extensão Power BI"
  | "Extensão SERP"
  | "Fila Companion WhatsApp";

/**
 * Autentica requisições de sincronização da Extensão Chrome MV3 usando leitura prévia
 * de Rate Limit (zero escritas no Postgres para tokens válidos) e incremento apenas em falhas.
 */
export async function authenticateExtensionSyncToken(params: {
  req: Request;
  corsHeaders: Record<string, string>;
  label: ExtensionSyncLabel;
}): Promise<ExtensionSyncAuthResult> {
  const { req, corsHeaders, label } = params;
  const configuredToken = (process.env.SYNC_API_TOKEN || "").trim();
  const authHeader = req.headers.get("authorization") || "";
  const customTokenHeader = req.headers.get("x-sync-token") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const providedToken = bearerToken || customTokenHeader.trim();

  // Trava Anti-Brute-Force com leitura leve prévia (evita INSERT/DELETE a cada sync legítimo)
  const syncLockKey = getPublicIpRateLimitKey("sync-fail", req);
  const rateStatus = await getRateLimitStatus(syncLockKey);
  if (rateStatus.count >= RATE_LIMIT_POLICIES.EXTENSION_SYNC_AUTH.limit) {
    const retryAfter = rateStatus.retryAfterSeconds || 60;
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Muitas tentativas com token inválido. Acesso bloqueado por ${retryAfter} segundos.`,
          retryAfter,
        },
        { status: 429, headers: corsHeaders }
      ),
    };
  }

  if (!providedToken) {
    await checkRateLimit(syncLockKey, RATE_LIMIT_POLICIES.EXTENSION_SYNC_AUTH);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Não autorizado. Forneça o token de sincronização da instituição no cabeçalho Authorization: Bearer <TOKEN>.",
        },
        { status: 401, headers: corsHeaders }
      ),
    };
  }

  // 1.1 Chave por escola (SHA-256 ou fallback legado)
  const schoolByToken = await findSchoolBySyncToken(prisma, providedToken);
  if (schoolByToken) {
    if (rateStatus.count > 0) {
      await resetRateLimit(syncLockKey);
    }
    return {
      ok: true,
      targetSchoolId: schoolByToken.id,
      userName: `${label} (${schoolByToken.name})`,
    };
  }

  // 1.2 Token global administrativo
  if (configuredToken && safeCompareStrings(providedToken, configuredToken)) {
    const { searchParams } = new URL(req.url);
    const reqSchoolId = searchParams.get("schoolId") || req.headers.get("x-school-id");
    const resolved = await getCurrentSchool(reqSchoolId);
    if (rateStatus.count > 0) {
      await resetRateLimit(syncLockKey);
    }
    return {
      ok: true,
      targetSchoolId: resolved.id,
      userName: `${label} (API)`,
    };
  }

  const failCheck = await checkRateLimit(syncLockKey, RATE_LIMIT_POLICIES.EXTENSION_SYNC_AUTH);
  if (!failCheck.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Muitas tentativas com token inválido. Acesso bloqueado por ${failCheck.retryAfterSeconds} segundos.`,
          retryAfter: failCheck.retryAfterSeconds,
        },
        { status: 429, headers: corsHeaders }
      ),
    };
  }

  return {
    ok: false,
    response: NextResponse.json(
      {
        error:
          "Chave de sincronização inválida. Copie a chave atualizada no painel da sua escola e cole na Extensão.",
      },
      { status: 401, headers: corsHeaders }
    ),
  };
}
