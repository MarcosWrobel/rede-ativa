import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json();
    const prompt = body?.prompt;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "Por favor, descreva o objetivo da mensagem que deseja gerar." },
        { status: 400 }
      );
    }

    // Aceita chave pelo header do cliente OU pela variável de ambiente da Vercel
    const headerKey = req.headers.get("x-gemini-key")?.trim();
    const apiKey =
      (headerKey && headerKey.length > 10 ? headerKey : null) ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Chave GEMINI_API_KEY não configurada.",
          missingApiKey: true,
          helpUrl: "https://aistudio.google.com/app/apikey",
        },
        { status: 400 }
      );
    }

    const cleanApiKey = apiKey.replace(/^["']|["']$/g, "").trim();
    const ai = new GoogleGenAI({ apiKey: cleanApiKey });

    const systemInstruction = `Você é um assistente pedagógico oficial do Colégio Estadual Leopoldina B. Pedroso (Paraná).
Sua missão é transformar a solicitação da pedagoga em um modelo padronizado e acolhedor de mensagem institucional para envio via WhatsApp aos pais ou responsáveis.

Regras obrigatórias:
1. "title": Título curto e objetivo em MAIÚSCULAS (ex: "ENTREGA DE BOLETINS", "SOLICITAÇÃO DE ATESTADO", "CONVOCAÇÃO DE RESPONSÁVEL").
2. "prefixText": Texto que vem antes da identificação do aluno. DEVE OBRIGATORIAMENTE começar com a tag "{saudacao}" (que o sistema converte automaticamente em Bom dia!, Boa tarde! ou Boa noite!). Exemplo: "{saudacao}\\nPrezados responsáveis, informamos que o(a) aluno(a)"
3. "suffixText": Texto que vem depois da identificação do aluno. Texto polido, acolhedor e convidando à parceria da família, finalizando com:
"Atenciosamente,\\nEquipe Pedagógica — Colégio Leopoldina"
4. "isAbsenceRelated": booleano (true apenas se o assunto for faltas/infrequência/ausência; false para notas, reuniões, convocações, uniforme ou avisos gerais).

Responda OBRIGATORIAMENTE em JSON válido com as seguintes propriedades:
{
  "title": string,
  "prefixText": string,
  "suffixText": string,
  "isAbsenceRelated": boolean
}`;

    let responseText: string | null = null;
    let lastError: any = null;

    // 1. Tentar primeiro via Interactions API (Recomendada pelo Google) com gemini-3.8-flash
    try {
      const interaction = await ai.interactions.create({
        model: "gemini-3.8-flash",
        input: `Crie um modelo de mensagem para: "${prompt.trim()}". Responda estritamente no formato JSON especificado.`,
        system_instruction: systemInstruction,
        response_format: {
          type: "text",
          mime_type: "application/json",
        },
      });

      if (interaction?.output_text) {
        responseText = interaction.output_text;
      }
    } catch (err: any) {
      lastError = err;
      console.warn("[GEMINI Interactions API] Falhou, tentando fallback generateContent:", err?.message || err);
    }

    // 2. Fallback via generateContent com gemini-3.8-flash ou gemini-3.5-flash-lite
    if (!responseText) {
      const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-1.5-flash"];
      for (const model of models) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: `Crie um modelo de mensagem escolar para a seguinte situação: "${prompt.trim()}". Responda estritamente em JSON.`,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          if (response?.text) {
            responseText = response.text;
            break;
          }
        } catch (err: any) {
          lastError = err;
          console.warn(`[GEMINI generateContent] Modelo ${model} falhou:`, err?.message || err);
        }
      }
    }

    if (!responseText) {
      const errorMsg = lastError?.message || "Não foi possível obter resposta da IA do Google.";
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    // Limpar possíveis delimitadores markdown
    const cleaned = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    return NextResponse.json({
      success: true,
      template: {
        title: String(parsed.title || "NOVO MODELO").toUpperCase().trim(),
        prefixText: String(
          parsed.prefixText || "{saudacao}\nPrezados responsáveis, informamos que o(a) aluno(a)"
        ).trim(),
        suffixText: String(
          parsed.suffixText || "Atenciosamente,\nEquipe Pedagógica — Colégio Leopoldina"
        ).trim(),
        isAbsenceRelated: Boolean(parsed.isAbsenceRelated),
      },
    });
  } catch (error: any) {
    console.error("Erro geral na rota de IA:", error);
    return NextResponse.json(
      { error: error?.message || "Erro interno ao processar modelo com IA." },
      { status: 500 }
    );
  }
}
