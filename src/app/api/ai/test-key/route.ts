import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { GoogleGenAI } from "@google/genai";

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
      maskedKey: envKey && envKey.trim().length > 10 ? `${envKey.trim().slice(0, 6)}...${envKey.trim().slice(-4)}` : null,
    });
  } catch {
    return NextResponse.json({ hasServerKey: false });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

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
    const maskedKey = `${cleanApiKey.slice(0, 6)}...${cleanApiKey.slice(-4)}`;
    const source = headerKey ? "informada_no_navegador" : bodyKey ? "informada_no_formulario" : "variavel_vercel";

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
        message: "Chave Gemini 100% funcional e conectada com sucesso ao Google AI!",
        respondingModel,
        sampleReply,
        durationMs,
        maskedKey,
        source,
      });
    }

    // Se falhou, extrair mensagem detalhada da resposta do Google
    let errorMessage = lastError?.message || String(lastError);
    if (lastError?.body) {
      try {
        const parsed = JSON.parse(lastError.body);
        const detail = Array.isArray(parsed)
          ? parsed[0]?.error?.message
          : parsed?.error?.message;
        if (detail) errorMessage = detail;
      } catch (e) {}
    }

    return NextResponse.json(
      {
        success: false,
        error: `Google Gemini recusou a conexão: ${errorMessage}`,
        durationMs,
        maskedKey,
        source,
      },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Erro interno ao testar chave." },
      { status: 500 }
    );
  }
}
