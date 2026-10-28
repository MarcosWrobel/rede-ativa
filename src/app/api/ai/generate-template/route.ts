import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "Por favor, descreva o objetivo da mensagem que deseja gerar." },
        { status: 400 }
      );
    }

    const apiKey =
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

    const ai = new GoogleGenAI({ apiKey });

    const systemInstruction = `Você é um assistente pedagógico especializado em comunicação escolar oficial por WhatsApp para o Colégio Estadual Leopoldina B. Pedroso (Paraná).
Sua missão é transformar o pedido da pedagoga em um modelo padronizado e acolhedor de mensagem institucional.

Regras obrigatórias de formatação:
1. "title": Título curto, objetivo e em MAIÚSCULAS (ex: "ENTREGA DE BOLETINS", "CONVOCAÇÃO DE PAIS", "SOLICITAÇÃO DE ATESTADO").
2. "prefixText": Texto que antecede a identificação do aluno. DEVE OBRIGATORIAMENTE começar com a tag "{saudacao}" (que o sistema substitui automaticamente por Bom dia!, Boa tarde! ou Boa noite!). Exemplo: "{saudacao}\\nPrezados responsáveis, informamos que o(a) aluno(a)"
3. "suffixText": Texto que vem após a identificação do aluno. Deve ser claro, polido, demonstrar parceria entre escola e família e finalizar com:
"Atenciosamente,\\nEquipe Pedagógica — Colégio Leopoldina"
4. "isAbsenceRelated": booleano. Deve ser true apenas se o assunto for faltas, ausências ou abandono escolar. Deve ser false para convocações, reuniões, eventos, notas, uniforme ou avisos gerais.

Responda OBRIGATORIAMENTE em JSON válido com as seguintes chaves exatas:
{
  "title": string,
  "prefixText": string,
  "suffixText": string,
  "isAbsenceRelated": boolean
}`;

    // Tentar modelos atuais do Google Gemini
    const modelsToTry = [
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-3.8-flash",
    ];

    let lastError: any = null;
    let responseText: string | null = null;

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: `Crie um modelo de mensagem escolar para a seguinte situação: "${prompt.trim()}".`,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            temperature: 0.3,
          },
        });

        if (response && response.text) {
          responseText = response.text;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[GEMINI] Tentativa com modelo ${model} falhou:`, err?.message || err);
      }
    }

    if (!responseText) {
      throw lastError || new Error("Não foi possível gerar o modelo com a IA.");
    }

    // Limpar delimitadores markdown se houver
    const cleanedJson = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedJson);

    return NextResponse.json({
      success: true,
      template: {
        title: String(parsed.title || "NOVO MODELO").toUpperCase().trim(),
        prefixText: String(parsed.prefixText || "{saudacao}\nPrezados responsáveis, informamos que o(a) aluno(a)").trim(),
        suffixText: String(parsed.suffixText || "Atenciosamente,\nEquipe Pedagógica — Colégio Leopoldina").trim(),
        isAbsenceRelated: Boolean(parsed.isAbsenceRelated),
      },
    });
  } catch (error: any) {
    console.error("Erro na rota de IA:", error);
    return NextResponse.json(
      { error: error?.message || "Erro interno ao processar requisição com a IA." },
      { status: 500 }
    );
  }
}
