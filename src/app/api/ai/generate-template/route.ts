import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

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
          error: "Chave de API do Google Gemini não encontrada.",
          missingApiKey: true,
          helpUrl: "https://aistudio.google.com/app/apikey",
        },
        { status: 400 }
      );
    }

    // Higienizar chave contra aspas e espaços
    const cleanApiKey = apiKey.replace(/^["']|["']$/g, "").trim();

    const systemInstruction = `Você é um assistente pedagógico do Colégio Estadual Leopoldina B. Pedroso (Paraná).
Sua missão é transformar a descrição da pedagoga em um modelo padronizado e acolhedor de mensagem institucional para WhatsApp.

Regras estritas:
1. "title": Título curto em MAIÚSCULAS (ex: "ENTREGA DE BOLETINS", "SOLICITAÇÃO DE ATESTADO").
2. "prefixText": Texto antes do aluno. DEVE OBRIGATORIAMENTE começar com a tag "{saudacao}". Exemplo: "{saudacao}\\nPrezados responsáveis, informamos que o(a) aluno(a)"
3. "suffixText": Texto após o aluno. Polido, acolhedor e terminando com:
"Atenciosamente,\\nEquipe Pedagógica — Colégio Leopoldina"
4. "isAbsenceRelated": booleano (true apenas para faltas/infrequência; false para avisos, notas, convocações, eventos).

Responda OBRIGATORIAMENTE em JSON válido:
{
  "title": string,
  "prefixText": string,
  "suffixText": string,
  "isAbsenceRelated": boolean
}`;

    // Modelos oficiais disponíveis em todas as contas do Google AI Studio
    const models = ["gemini-1.5-flash", "gemini-2.0-flash"];
    let lastError: any = null;
    let data: any = null;

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout max

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `Crie um modelo de mensagem para: "${prompt.trim()}". Siga estritamente as regras pedagógicas e responda apenas o JSON solicitado.`,
                    },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.2,
              },
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
            }),
          }
        );

        clearTimeout(timeoutId);

        const json = await res.json();

        if (!res.ok) {
          const apiMsg = json?.error?.message || `Erro HTTP ${res.status}`;
          lastError = new Error(apiMsg);
          console.warn(`[GEMINI REST] Modelo ${model} falhou: ${apiMsg}`);
          continue;
        }

        const candidateText =
          json?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (candidateText) {
          data = candidateText;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[GEMINI REST] Erro ao chamar ${model}:`, err?.message || err);
      }
    }

    if (!data) {
      const msg = lastError?.message || "Não foi possível obter resposta da IA do Google.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Limpar delimitadores markdown
    const cleaned = data
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
    console.error("Erro na API de IA:", error);
    return NextResponse.json(
      { error: error?.message || "Erro interno ao processar requisição com a IA." },
      { status: 500 }
    );
  }
}
