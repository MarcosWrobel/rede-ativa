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
          error: "Chave GEMINI_API_KEY não configurada na Vercel nem no painel.",
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
    let lastErrorMsg = "";

    // 1. Cascata de modelos via Interactions API (resiliente contra picos de demanda no 3.8-flash)
    // Modelos leves como 3.5-flash-lite e flash-latest têm alta disponibilidade e não sofrem com spikes de capacidade
    const interactionModels = [
      "gemini-3.5-flash-lite",
      "gemini-flash-latest",
      "gemini-3.8-flash",
    ];

    for (const model of interactionModels) {
      try {
        const interaction = await ai.interactions.create(
          {
            model: model as any,
            input: `Crie um modelo de mensagem para: "${prompt.trim()}". Responda estritamente no formato JSON especificado.`,
            system_instruction: systemInstruction,
            response_format: {
              type: "text",
              mime_type: "application/json",
            },
          },
          {
            retries: { strategy: "none" },
            timeout_ms: 6000, // 6 segundos de tolerância por modelo
          }
        );

        if (interaction?.output_text) {
          responseText = interaction.output_text;
          break;
        }
      } catch (err: any) {
        lastErrorMsg = err?.message || String(err);
        if (err?.body) {
          try {
            const parsed = JSON.parse(err.body);
            const detail = Array.isArray(parsed)
              ? parsed[0]?.error?.message
              : parsed?.error?.message;
            if (detail) lastErrorMsg = detail;
          } catch (e) {}
        }

        // Se a chave for declaradamente inválida, interrompe imediatamente sem testar outros modelos
        if (lastErrorMsg.includes("API key not valid")) {
          break;
        }

        console.warn(`[GEMINI Interactions] Modelo ${model} indisponível ou em pico de demanda (${lastErrorMsg}). Tentando próximo modelo...`);
      }
    }

    // 2. Se a Interactions API estiver sob manutenção geral, recorrer ao endpoint clássico generateContent
    if (!responseText && !lastErrorMsg.includes("API key not valid")) {
      const fallbackModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
      for (const model of fallbackModels) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: `Crie um modelo de mensagem escolar para: "${prompt.trim()}". Responda estritamente no formato JSON com as chaves: title, prefixText, suffixText, isAbsenceRelated.`,
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
          lastErrorMsg = err?.message || String(err);
          console.warn(`[GEMINI generateContent] Modelo ${model} falhou:`, lastErrorMsg);
        }
      }
    }

    if (!responseText) {
      return NextResponse.json(
        {
          error: `Google Gemini: ${lastErrorMsg || "Os servidores da IA estão com alta demanda temporária. Tente novamente em instantes."}`,
          missingApiKey: lastErrorMsg.includes("API key not valid"),
        },
        { status: 400 }
      );
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
