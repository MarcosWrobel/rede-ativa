import { NextResponse } from "next/server";
import { normalizePublicAtaCode, resolvePublicAtaByCode } from "@/lib/ataPublicVerification";
import { enforceRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const rlKey = getPublicIpRateLimitKey("pub-ata", req);
    const rlCheck = await enforceRateLimit(rlKey, RATE_LIMIT_POLICIES.PUBLIC_ATA_VERIFY);
    if (!rlCheck.ok) return rlCheck.response;

    const { code } = await params;
    const cleanCode = normalizePublicAtaCode(code);

    const maskedResponse = await resolvePublicAtaByCode(cleanCode);
    if (!maskedResponse) {
      return NextResponse.json(
        { error: "Documento não encontrado ou código de verificação inválido." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: maskedResponse });
  } catch (error: unknown) {
    console.error("[GET /api/atas/public/[code]] Erro:", error);
    return NextResponse.json({ error: "Erro ao verificar documento" }, { status: 500 });
  }
}
