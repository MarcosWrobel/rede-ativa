import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

const formalizeAtaSchema = z.object({
  rawNotes: z.string().min(3, "Informe as notas ou pauta do atendimento"),
  category: z.string().default("ACOMPANHAMENTO_PEDAGOGICO"),
  studentNames: z.array(z.string()).default([]),
  guardianNames: z.array(z.string()).default([]),
});

const FORMALIZE_ATA_JSON_SCHEMA = {
  type: "object",
  properties: {
    formalSubject: {
      type: "string",
      description: "Título formal da pauta da ata (ex: 'Atendimento Pedagógico e Alinhamento de Frequência Escolar').",
    },
    formalSummary: {
      type: "string",
      description: "Texto formal, impessoal e objetivo da ata em norma culta, narrando os fatos sem juízos de valor pejorativos e respeitando as diretrizes do ECA e regimento escolar da SEED-PR.",
    },
    agreementsSummary: {
      type: "string",
      description: "Síntese dos combinados, prazos e compromissos firmados durante a reunião.",
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descrição objetiva da ação ou entrega pactuada." },
          responsible: {
            type: "string",
            enum: ["FAMILIA", "ESTUDANTE", "ESCOLA", "REDE_PROTECAO"],
            description: "Responsável direto pelo cumprimento deste combinado.",
          },
          suggestedDaysToComplete: {
            type: "number",
            description: "Prazo sugerido em dias úteis a contar de hoje (ex: 5 para atestado médico, 10 para retorno).",
          },
        },
        required: ["description", "responsible"],
      },
      description: "Lista estruturada de ações e combinados.",
    },
  },
  required: ["formalSubject", "formalSummary", "agreementsSummary", "actionItems"],
};

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = formalizeAtaSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const { rawNotes, category, studentNames, guardianNames } = parsed.data;

    const headerKey = req.headers.get("x-gemini-key")?.trim();
    const apiKey =
      (headerKey && headerKey.length > 10 ? headerKey : null) ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY;

    // Fallback heurístico inteligente se não houver chave Gemini
    if (!apiKey) {
      const fallbackResult = generateLocalAtaMinuta({
        rawNotes,
        category,
        studentNames,
        guardianNames,
      });
      return NextResponse.json({
        success: true,
        usedFallback: true,
        result: fallbackResult,
      });
    }

    const cleanApiKey = apiKey.replace(/^["']|["']$/g, "").trim();
    const ai = new GoogleGenAI({ apiKey: cleanApiKey });

    const systemInstruction = `Você é o redator oficial da Equipe Pedagógica de um Colégio Estadual da Rede Pública do Paraná (SEED-PR).
Sua missão é converter anotações rápidas e informais da pedagoga em uma Minuta Oficial de Ata do Atendimento Pedagógico.

Diretrizes Obrigatórias:
1. Imparcialidade e Respeito ao ECA: Jamais use rótulos pejorativos ("aluno preguiçoso", "pais relapsos"). Registre fatos, relatos declarados e condutas observadas de forma descritiva e técnica.
2. Estrutura Canônica: Inicie situando o atendimento pedagógico no Colégio Estadual, cite os presentes de forma impessoal ("presente a mãe Sra. ..."), relate a exposição pedagógica, a fala e justificativas da família/estudante e conclua com as deliberações e combinados.
3. Extraia com precisão os combinados estruturados ("actionItems") atribuindo o responsável correto (FAMILIA, ESTUDANTE, ESCOLA ou REDE_PROTECAO) e prazo em dias.`;

    const inputPrompt = `Estudante(s): ${studentNames.join(", ") || "Conforme identificado em registro"}
Responsável(is) / Presentes: ${guardianNames.join(", ") || "Responsável legal presente"}
Natureza da Ocorrência: ${category}
Anotações / Tópicos da Pedagoga:
"""
${rawNotes}
"""`;

    const modelsToTry = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
    let rawJsonText: string | null = null;

    for (const model of modelsToTry) {
      try {
        const interaction: any = await ai.interactions.create({
          model,
          input: inputPrompt,
          system_instruction: systemInstruction,
          response_format: {
            type: "json_object",
            response_schema: FORMALIZE_ATA_JSON_SCHEMA,
          },
        });

        if (interaction.outputs && interaction.outputs.length > 0) {
          const firstOutput = interaction.outputs[0];
          if (firstOutput.type === "text" && firstOutput.text) {
            rawJsonText = firstOutput.text.trim();
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[AI Formalize Ata] Erro com ${model}:`, err.message);
      }
    }

    if (rawJsonText) {
      try {
        const structured = JSON.parse(rawJsonText);
        return NextResponse.json({
          success: true,
          usedFallback: false,
          result: structured,
        });
      } catch {
        // cai no fallback se o parse falhar
      }
    }

    // Fallback caso a API Gemini esteja indisponível
    const fallbackResult = generateLocalAtaMinuta({
      rawNotes,
      category,
      studentNames,
      guardianNames,
    });
    return NextResponse.json({
      success: true,
      usedFallback: true,
      result: fallbackResult,
    });
  } catch (error: any) {
    console.error("[AI Formalize Ata] Erro inesperado:", error);
    return NextResponse.json({ error: error.message || "Erro ao processar minuta" }, { status: 500 });
  }
}

function generateLocalAtaMinuta({
  rawNotes,
  category,
  studentNames,
  guardianNames,
}: {
  rawNotes: string;
  category: string;
  studentNames: string[];
  guardianNames: string[];
}) {
  const studentsStr = studentNames.length > 0 ? studentNames.join(" e ") : "estudante";
  const guardiansStr = guardianNames.length > 0 ? guardianNames.join(", ") : "responsável legal";

  const lines = rawNotes
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cleanNotes = lines.join(" ");

  const formalSummary = `Aos dias correntes, nas dependências da Equipe Pedagógica deste Colégio Estadual, realizou-se atendimento com a presença de ${guardiansStr}, referente ao(à) ${studentsStr}, para tratar de assuntos pertinentes a(o) ${category.toLowerCase().replace(/_/g, " ")}. Pela equipe pedagógica foram pontuados os seguintes aspectos: ${cleanNotes}. O(A) responsável tomou ciência das orientações escolares e comprometeu-se a acompanhar a rotina e as recomendações pedagógicas estabelecidas nesta data.`;

  return {
    formalSubject: `Atendimento Pedagógico — ${category.replace(/_/g, " ")}`,
    formalSummary,
    agreementsSummary: "A família e a escola acordaram acompanhar conjuntamente a assiduidade e o cumprimento das atividades escolares.",
    actionItems: [
      {
        description: "Acompanhar cumprimento dos combinados e rotina escolar",
        responsible: "FAMILIA",
        suggestedDaysToComplete: 7,
      },
    ],
  };
}
