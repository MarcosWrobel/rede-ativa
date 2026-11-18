import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { GoogleGenAI } from "@google/genai";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const envKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY;

    return NextResponse.json({
      hasServerKey: Boolean(envKey && envKey.trim().length > 10),
    });
  } catch {
    return NextResponse.json({ hasServerKey: false });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rateLimitKey = `ai:${authCheck.schoolId || "global"}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.AI_ENDPOINT);
    if (!rlCheck.ok) return rlCheck.response;

    const body = await req.json().catch(() => ({}));
    const envKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY
    )?.replace(/^["']|["']$/g, "").trim();

    const headerKey = req.headers.get("x-gemini-key")?.replace(/^["']|["']$/g, "").trim();
    const bodyKey = body?.apiKey?.replace(/^["']|["']$/g, "").trim();

    const apiKey =
      (bodyKey && bodyKey.length > 10 ? bodyKey : null) ||
      (envKey && envKey.length > 10 ? envKey : null) ||
      (headerKey && headerKey.length > 10 ? headerKey : null);

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Nenhuma chave API foi informada nem encontrada nas variáveis da Vercel.",
          source: "nenhuma",
        },
        { status: 400 }
      );
    }

    const cleanApiKey = apiKey.replace(/^["']|["']$/g, "").trim();
    const source =
      bodyKey && bodyKey.length > 10
        ? "informada_no_formulario"
        : headerKey && headerKey.length > 10
        ? "informada_no_navegador"
        : "variavel_vercel";

    const ai = new GoogleGenAI({ apiKey: cleanApiKey });

    const startTime = Date.now();
    const candidateModels = [
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-3.5-flash-lite",
    ];

    let respondingModel = "";
    let sampleReply = "";
    let lastError: any = null;

    for (const model of candidateModels) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: "Responda apenas com a palavra: OK",
          config: {
            thinkingConfig: {
              thinkingLevel: "low" as any,
            },
          },
        });

        if (res?.text) {
          respondingModel = model;
          sampleReply = res.text.trim();
          break;
        }
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || String(err);
        if (msg.toLowerCase().includes("api key not valid") || msg.includes("403 Forbidden")) {
          break;
        }
      }
    }

    const durationMs = Date.now() - startTime;

    if (respondingModel) {
      return NextResponse.json({
        success: true,
        message: "Chave Gemini conectada e respondendo corretamente.",
        respondingModel,
        sampleReply,
        durationMs,
        source,
      });
    }

    // Mapeia falhas conhecidas da API externa sem expor payload bruto de erro
    const rawDetail = String(lastError?.message || "").toLowerCase();
    const safeErrorMessage =
      rawDetail.includes("api key not valid") || rawDetail.includes("403 forbidden")
        ? "Chave da API recusada ou inválida."
        : rawDetail.includes("429") || rawDetail.includes("resource_exhausted")
        ? "Limite temporário de requisições da API atingido."
        : rawDetail.includes("503") || rawDetail.includes("unavailable")
        ? "Serviço externo temporariamente indisponível."
        : "Não foi possível validar a conexão com o provedor de IA.";

    return NextResponse.json(
      {
        success: false,
        error: safeErrorMessage,
        durationMs,
        source,
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[POST /api/ai/test-key] Erro interno:", error);
    return NextResponse.json(
      { success: false, error: "Erro interno ao testar conectividade da chave de IA." },
      { status: 500 }
    );
  }
}
