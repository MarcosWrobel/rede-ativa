import { NextResponse } from "next/server";
import { requireAuth, checkIsSuperAdmin, checkIsSecretariat } from "@/lib/permissions";
import {
  aggregateSecretariaMetrics,
  normalizeSecretariaFilterParam,
  resolveSecretariaNetworkScope,
} from "@/lib/secretariaMetrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const isSuper = checkIsSuperAdmin(authCheck.session);
    const isSecretariat = checkIsSecretariat(authCheck.session);

    if (!isSuper && !isSecretariat) {
      return NextResponse.json(
        { error: "Acesso restrito à Gestão da Secretaria de Educação." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const { allowedNetworkIds, allowedCities } = await resolveSecretariaNetworkScope({
      isSuper,
      userId: authCheck.userId,
      snapshot: authCheck.snapshot,
    });

    if (!isSuper && allowedNetworkIds.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma rede municipal vinculada ao seu perfil." },
        { status: 403 }
      );
    }

    const rawNetworkIdParam = normalizeSecretariaFilterParam(searchParams.getAll("networkId"));
    if (rawNetworkIdParam && !isSuper && !allowedNetworkIds.includes(rawNetworkIdParam)) {
      return NextResponse.json(
        { error: "Acesso negado às métricas consolidadas de outra rede municipal." },
        { status: 403 }
      );
    }

    const rawCityParam = normalizeSecretariaFilterParam(searchParams.getAll("city"));
    const requestedCity = rawCityParam || allowedCities[0] || "";

    if (!isSuper && rawCityParam && allowedCities.length > 0) {
      const isCityAllowed = allowedCities.some(
        (c) => c.toLowerCase() === rawCityParam.toLowerCase()
      );
      if (!isCityAllowed) {
        return NextResponse.json(
          { error: "Acesso negado às métricas consolidadas de outro município." },
          { status: 403 }
        );
      }
    }

    const aggregated = await aggregateSecretariaMetrics({
      isSuper,
      allowedNetworkIds,
      networkIdFilter: rawNetworkIdParam || undefined,
      cityFilter: requestedCity || undefined,
    });

    return NextResponse.json({
      success: true,
      city: requestedCity,
      networkName: `SEMEC ${requestedCity}`,
      metrics: aggregated.metrics,
      predictiveAnalysis: aggregated.predictiveAnalysis,
      schools: aggregated.schools,
    });
  } catch (error: any) {
    console.error("[GET /api/secretaria/metrics] Erro:", error);
    return NextResponse.json(
      { error: "Erro interno ao consultar métricas da secretaria" },
      { status: 500 }
    );
  }
}
