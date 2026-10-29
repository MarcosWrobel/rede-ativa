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

    // Modelos vigentes na API do Google (2026).
    // gemini-3.5-flash-lite é o modelo oficial rápido e com alta disponibilidade na cota gratuita.
    const modelsToTry = [
      "gemini-3.5-flash-lite",
      "gemini-flash-latest",
      "gemini-3.5-flash",
      "gemini-3.8-flash",
    ];

    // 1. Tentativa via models.generateContent com timeout de 15s por modelo
    for (const model of modelsToTry) {
      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 15000);

        const response = await ai.models.generateContent({
          model,
          contents: `Crie um modelo de mensagem institucional escolar para WhatsApp sobre o seguinte assunto: "${prompt.trim()}". Responda estritamente em JSON com as chaves "title", "prefixText", "suffixText", "isAbsenceRelated".`,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            temperature: 0.2,
            abortSignal: abortController.signal,
          },
        });

        clearTimeout(timeoutId);

        if (response?.text) {
          responseText = response.text;
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

        // Se a chave API for comprovadamente inválida, interrompe sem testar outros modelos
        if (lastErrorMsg.toLowerCase().includes("api key not valid") || lastErrorMsg.includes("403 Forbidden")) {
          break;
        }

        console.warn(`[GEMINI generateContent] Modelo ${model} falhou: ${lastErrorMsg}. Tentando próximo...`);
      }
    }

    // 2. Se generateContent não respondeu, tentar via Interactions API com gemini-3.5-flash-lite
    if (!responseText && !lastErrorMsg.toLowerCase().includes("api key not valid")) {
      try {
        const interaction = await ai.interactions.create(
          {
            model: "gemini-3.5-flash-lite",
            input: `Crie um modelo de mensagem institucional para: "${prompt.trim()}". Responda estritamente em JSON.`,
            system_instruction: systemInstruction,
          },
          {
            retries: { strategy: "none" },
            timeout_ms: 15000,
          }
        );

        if (interaction?.output_text) {
          responseText = interaction.output_text;
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.warn("[GEMINI Interactions] Falhou:", msg);
        if (!lastErrorMsg) lastErrorMsg = msg;
      }
    }

    if (!responseText) {
      const isKeyError = lastErrorMsg.toLowerCase().includes("api key not valid");
      return NextResponse.json(
        {
          error: `Google Gemini: ${lastErrorMsg || "Serviço de IA indisponível temporariamente. Tente novamente."}`,
          missingApiKey: isKeyError,
        },
        { status: 400 }
      );
    }

    // Limpar delimitadores markdown caso existam
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
