import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { classifyGuardianReplyHeuristic } from "@/lib/whatsappProvider";
import { hasDisallowedAttachmentPayload, recordAiOperationalEvent } from "@/lib/aiPolicy";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

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

    const rawBody = await req.json();

    if (hasDisallowedAttachmentPayload(rawBody)) {
      return NextResponse.json(
        {
          error:
            "A leitura de imagens está indisponível. Copie ou digite o texto da resposta do responsável.",
        },
        { status: 400 }
      );
    }

    const rawReply =
      typeof rawBody?.rawReply === "string" ? rawBody.rawReply.trim() : "";

    if (rawReply.length < 3 || rawReply.length > 10_000) {
      return NextResponse.json(
        {
          error:
            "Cole ou digite ao menos uma frase informada pelo responsável para classificar.",
        },
        { status: 400 }
      );
    }

    // Classificação e síntese 100% locais para o fluxo de retorno do WhatsApp,
    // independentemente de haver credencial externa configurada para atas.
    const heuristic = classifyGuardianReplyHeuristic(rawReply);

    await recordAiOperationalEvent({
      schoolId: schoolRes.school.id,
      route: "/api/ai/classify-reply",
      mode: "LOCAL_ONLY",
      reason: "whatsapp_reply_local_classification",
      status: "SUCCESS",
      user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
      req,
    });

    return NextResponse.json({
      success: true,
      usedFallback: true,
      mode: "LOCAL_ONLY",
      classification: {
        ...heuristic,
        extractedRawReply: rawReply,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Erro interno ao classificar retorno pedagógico." },
      { status: 500 }
    );
  }
}
