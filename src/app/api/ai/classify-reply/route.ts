import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { aiClassifyReplySchema, formatZodError, replyCategoryEnum } from "@/lib/schemas";
import {
  classifyGuardianReplyHeuristic,
  type ReplyCategory,
} from "@/lib/whatsappProvider";
import { GoogleGenAI } from "@google/genai";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    formalSummary: {
      type: "string",
      description:
        "Síntese formal, impessoal e objetiva em norma culta para registro em prontuário escolar e dossiê do Conselho Tutelar/SERP.",
    },
    category: {
      type: "string",
      enum: [
        "SAUDE",
        "TRANSPORTE",
        "TRABALHO",
        "VIAGEM_FAMILIAR",
        "VULNERABILIDADE",
        "SEM_JUSTIFICATIVA",
        "OUTROS",
      ],
      description: "Categoria pedagógica predominante da justificativa apresentada pela família.",
    },
    requiresMedicalCertificate: {
      type: "boolean",
      description:
        "True caso o relato mencione consulta médica, odontológica, internação ou doença que demande entrega de atestado.",
    },
    suggestedFollowUp: {
      type: "string",
      description: "Orientação curta de encaminhamento prático para a Equipe Pedagógica.",
    },
  },
  required: ["formalSummary", "category", "requiresMedicalCertificate", "suggestedFollowUp"],
};

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = aiClassifyReplySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { rawReply, studentName, reasonTitle } = parsed.data;

    const headerKey = req.headers.get("x-gemini-key")?.trim();
    const apiKey =
      (headerKey && headerKey.length > 10 ? headerKey : null) ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY;

    // Fallback determinístico imediato caso a chave Gemini não esteja configurada
    if (!apiKey) {
      const heuristic = classifyGuardianReplyHeuristic(rawReply);
      return NextResponse.json({
        success: true,
        usedFallback: true,
        classification: heuristic,
      });
    }

    const cleanApiKey = apiKey.replace(/^["']|["']$/g, "").trim();
    const ai = new GoogleGenAI({ apiKey: cleanApiKey });

    const systemInstruction = `Você é um especialista da Equipe Pedagógica do Colégio Estadual Leopoldina B. Pedroso (SEED-PR).
Sua tarefa é ler a mensagem informal recebida via WhatsApp de um pai, mãe ou responsável legal e transformá-la em um registro administrativo formal, impessoal e objetivo (adequado para compor ata escolar, ficha SERP e Dossiê do Conselho Tutelar), além de classificar a causa da ausência.

Regras:
1. Não invente fatos que não estejam na mensagem original.
2. Escreva "formalSummary" em terceira pessoa (ex.: "Responsável informou via WhatsApp que...").
3. Classifique "category" estritamente em um dos valores permitidos: SAUDE, TRANSPORTE, TRABALHO, VIAGEM_FAMILIAR, VULNERABILIDADE, SEM_JUSTIFICATIVA ou OUTROS.`;

    const inputPrompt = `Estudante: ${studentName || "Não informado"}
Motivo do contato escolar: ${reasonTitle || "Busca Ativa Escolar"}
Mensagem recebida do responsável via WhatsApp:
"""
${rawReply}
"""`;

    const modelsToTry = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
    let rawJsonText: string | null = null;

    for (const model of modelsToTry) {
      try {
        const interaction: any = await ai.interactions.create(
          {
            model,
            input: inputPrompt,
            system_instruction: systemInstruction,
            response_format: CLASSIFICATION_JSON_SCHEMA as any,
          },
          {
            retries: { strategy: "none" },
            timeout_ms: 14000,
          } as any
        );

        const candidateText =
          interaction?.output_text ||
          interaction?.outputs?.find((o: any) => o?.type === "text")?.text ||
          null;

        if (candidateText) {
          rawJsonText = candidateText;
          break;
        }
      } catch (err: any) {
        console.warn(`[GEMINI classify-reply] Modelo ${model} indisponível:`, err?.message || err);
      }
    }

    if (!rawJsonText) {
      const heuristic = classifyGuardianReplyHeuristic(rawReply);
      return NextResponse.json({
        success: true,
        usedFallback: true,
        classification: heuristic,
      });
    }

    try {
      const cleaned = rawJsonText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      const aiObj = JSON.parse(cleaned);
      const catCheck = replyCategoryEnum.safeParse(aiObj.category);
      const validCategory: ReplyCategory = catCheck.success ? catCheck.data : "OUTROS";

      return NextResponse.json({
        success: true,
        usedFallback: false,
        classification: {
          formalSummary: String(aiObj.formalSummary || "").trim() || classifyGuardianReplyHeuristic(rawReply).formalSummary,
          category: validCategory,
          requiresMedicalCertificate: Boolean(aiObj.requiresMedicalCertificate),
          suggestedFollowUp:
            String(aiObj.suggestedFollowUp || "").trim() ||
            "Acompanhar assiduidade nos próximos dias letivos.",
        },
      });
    } catch {
      const heuristic = classifyGuardianReplyHeuristic(rawReply);
      return NextResponse.json({
        success: true,
        usedFallback: true,
        classification: heuristic,
      });
    }
  } catch (error: any) {
    console.error("Erro em /api/ai/classify-reply:", error);
    return NextResponse.json(
      { error: error?.message || "Erro interno ao classificar retorno." },
      { status: 500 }
    );
  }
}
