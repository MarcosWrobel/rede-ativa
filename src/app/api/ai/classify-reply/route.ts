import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { aiClassifyReplySchema, formatZodError, replyCategoryEnum } from "@/lib/schemas";
import {
  classifyGuardianReplyHeuristic,
  type ReplyCategory,
} from "@/lib/whatsappProvider";
import { GoogleGenAI } from "@google/genai";
import { createAiPseudonymizer } from "@/lib/aiPseudonymizer";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    extractedRawReply: {
      type: "string",
      description:
        "Transcrição literal (OCR) das últimas mensagens recebidas da família/responsável na tela do WhatsApp Web (balões à esquerda). Ignore mensagens enviadas pela escola (balões à direita).",
    },
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

function parseDataUrlImage(dataUrl?: string | null): { mimeType: string; data: string } | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rateLimitKey = `ai:${authCheck.schoolId || "global"}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.AI_ENDPOINT);
    if (!rlCheck.ok) return rlCheck.response;

    const rawBody = await req.json();
    const parsed = aiClassifyReplySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { rawReply, screenshotDataUrl, studentName, reasonTitle } = parsed.data;
    const parsedImage = parseDataUrlImage(screenshotDataUrl);

    const headerKey = req.headers.get("x-gemini-key")?.trim();
    const apiKey =
      (headerKey && headerKey.length > 10 ? headerKey : null) ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY;

    // Fallback determinístico caso a chave Gemini não esteja configurada
    if (!apiKey) {
      if (!rawReply || rawReply.trim().length < 2) {
        return NextResponse.json(
          {
            error:
              "Para leitura automática de imagem (OCR), configure a chave da API Gemini nas configurações ou selecione/cole o texto da conversa.",
          },
          { status: 422 }
        );
      }
      const heuristic = classifyGuardianReplyHeuristic(rawReply);
      return NextResponse.json({
        success: true,
        usedFallback: true,
        classification: {
          ...heuristic,
          extractedRawReply: rawReply,
        },
      });
    }

    const cleanApiKey = apiKey.replace(/^["']|["']$/g, "").trim();
    const ai = new GoogleGenAI({ apiKey: cleanApiKey });

    const systemInstruction = `Você é um especialista da Equipe Pedagógica e de Busca Ativa da Rede Ativa integrada à instituição de ensino.
Sua tarefa é ler a resposta recebida via WhatsApp de um pai, mãe ou responsável legal (seja por texto ou fazendo OCR da imagem da janela do WhatsApp Web) e transformá-la em um registro administrativo formal, impessoal e objetivo (adequado para compor ata escolar, ficha SERP e Dossiê do Conselho Tutelar), além de classificar a causa da ausência.

Regras:
1. Se uma imagem do WhatsApp Web for fornecida, extraia em "extractedRawReply" APENAS o texto das últimas mensagens RECEBIDAS do responsável (balões alinhados à esquerda), ignorando o texto padrão enviado pela escola (balões alinhados à direita).
2. Não invente fatos que não estejam na mensagem original.
3. Escreva "formalSummary" em terceira pessoa (ex.: "Responsável informou via WhatsApp que...").
4. Classifique "category" estritamente em um dos valores permitidos: SAUDE, TRANSPORTE, TRABALHO, VIAGEM_FAMILIAR, VULNERABILIDADE, SEM_JUSTIFICATIVA ou OUTROS.`;

    const pseudonymizer = createAiPseudonymizer(studentName ? [studentName] : [], []);
    const maskedReply = rawReply ? pseudonymizer.maskText(rawReply) : "";

    const textPrompt = parsedImage
      ? `Estudante: ${pseudonymizer.maskedStudentNames[0] || "Não informado"}
Motivo do contato escolar: ${reasonTitle || "Busca Ativa Escolar"}
${maskedReply ? `Texto auxiliar capturado do DOM:\n"""\n${maskedReply}\n"""\n` : ""}Analise a captura de tela da conversa do WhatsApp Web em anexo, extraia via OCR a resposta recebida da família (balões à esquerda) em "extractedRawReply" e gere a classificação e síntese formal.`
      : `Estudante: ${pseudonymizer.maskedStudentNames[0] || "Não informado"}
Motivo do contato escolar: ${reasonTitle || "Busca Ativa Escolar"}
Mensagem recebida do responsável via WhatsApp:
"""
${maskedReply}
"""`;

    const modelsToTry = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
    let rawJsonText: string | null = null;

    for (const model of modelsToTry) {
      try {
        // Quando há imagem (OCR Multimodal), prioriza generateContent com inlineData ou interactions multimodal
        if (parsedImage && (ai as any).models?.generateContent) {
          const response: any = await (ai as any).models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { text: textPrompt },
                  {
                    inlineData: {
                      mimeType: parsedImage.mimeType,
                      data: parsedImage.data,
                    },
                  },
                ],
              },
            ],
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema: CLASSIFICATION_JSON_SCHEMA as any,
            } as any,
          });
          const candidateText = response?.text || null;
          if (candidateText) {
            rawJsonText = candidateText;
            break;
          }
        }

        if (typeof (ai as any).interactions?.create === "function") {
          const interactionInput = parsedImage
            ? [
                { type: "text", text: textPrompt },
                {
                  type: "image",
                  mime_type: parsedImage.mimeType,
                  data: parsedImage.data,
                },
              ]
            : textPrompt;

          const interaction: any = await (ai as any).interactions.create(
            {
              model,
              input: interactionInput,
              system_instruction: systemInstruction,
              response_format: CLASSIFICATION_JSON_SCHEMA as any,
            },
            {
              retries: { strategy: "none" },
              timeout_ms: 18000,
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
        }
      } catch (err: any) {
        console.warn(`[GEMINI classify-reply] Modelo ${model} indisponível:`, err?.message || err);
      }
    }

    if (!rawJsonText) {
      if (rawReply && rawReply.trim().length >= 3) {
        const heuristic = classifyGuardianReplyHeuristic(rawReply);
        return NextResponse.json({
          success: true,
          usedFallback: true,
          classification: {
            ...heuristic,
            extractedRawReply: rawReply,
          },
        });
      }
      return NextResponse.json(
        { error: "Não foi possível extrair texto da imagem da conversa no momento." },
        { status: 422 }
      );
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

      const extractedRaw = String(aiObj.extractedRawReply || rawReply || "").trim();
      const fallbackBase = extractedRaw || rawReply || "Retorno verificado via WhatsApp.";
      const rawFormalSummary =
        String(aiObj.formalSummary || "").trim() ||
        classifyGuardianReplyHeuristic(fallbackBase).formalSummary;
      const rawFollowUp =
        String(aiObj.suggestedFollowUp || "").trim() ||
        "Acompanhar assiduidade nos próximos dias letivos.";

      return NextResponse.json({
        success: true,
        usedFallback: false,
        usedOcr: Boolean(parsedImage),
        classification: {
          extractedRawReply: pseudonymizer.unmaskText(extractedRaw),
          formalSummary: pseudonymizer.unmaskText(rawFormalSummary),
          category: validCategory,
          requiresMedicalCertificate: Boolean(aiObj.requiresMedicalCertificate),
          suggestedFollowUp: pseudonymizer.unmaskText(rawFollowUp),
        },
      });
    } catch {
      const heuristic = classifyGuardianReplyHeuristic(rawReply || "Retorno via WhatsApp");
      return NextResponse.json({
        success: true,
        usedFallback: true,
        classification: {
          ...heuristic,
          extractedRawReply: rawReply || "",
        },
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
