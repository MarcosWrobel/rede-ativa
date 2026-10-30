import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { generateLocalAtaMinuta } from "@/lib/nreAtaFormatter";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

const formalizeAtaSchema = z
  .object({
    rawNotes: z.string().default(""),
    existingSummary: z.string().optional().default(""),
    category: z.string().default("ACOMPANHAMENTO_PEDAGOGICO"),
    studentNames: z.array(z.string()).default([]),
    guardianNames: z.array(z.string()).default([]),
  })
  .refine(
    (data) => (data.rawNotes && data.rawNotes.trim().length >= 3) || (data.existingSummary && data.existingSummary.trim().length >= 5),
    {
      message: "Informe as anotações do atendimento ou um texto prévio para revisão.",
      path: ["rawNotes"],
    }
  );

const FORMALIZE_ATA_JSON_SCHEMA = {
  type: "object",
  properties: {
    formalSubject: {
      type: "string",
      description: "Título formal e objetivo da ata segundo os padrões SEED-PR (ex: 'Atendimento Pedagógico e Alinhamento de Frequência Escolar').",
    },
    formalSummary: {
      type: "string",
      description: "Texto oficial contínuo (texto corrido sem quebra de linhas/parágrafos em branco), no pretérito perfeito, em estrita norma culta (ortografia, concordância, regência e pontuação), sem abreviaturas informais, com numerais por extenso e cláusula final de leitura e ciência dos presentes conforme diretrizes do NRE/SEED-PR.",
    },
    agreementsSummary: {
      type: "string",
      description: "Síntese objetiva e concisa dos combinados, prazos e compromissos pactuados.",
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descrição objetiva da ação ou compromisso pactuado." },
          responsible: {
            type: "string",
            enum: ["FAMILIA", "ESTUDANTE", "ESCOLA", "REDE_PROTECAO"],
            description: "Responsável direto pelo cumprimento deste combinado.",
          },
          suggestedDaysToComplete: {
            type: "number",
            description: "Prazo sugerido em dias úteis a contar da reunião (ex: 5 para atestado médico, 10 para retorno).",
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

    const { rawNotes, existingSummary, category, studentNames, guardianNames } = parsed.data;

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
        existingSummary,
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

    const systemInstruction = `Você atua como Revisor Gramatical e Redator Oficial da Equipe Pedagógica de um Colégio Estadual da Rede Pública do Paraná (SEED-PR / Núcleo Regional de Educação - NRE).
Sua missão é formalizar e revisar o texto da ata de atendimento pedagógico aplicando com o mais alto rigor a Norma Culta da Língua Portuguesa e as Diretrizes Oficiais do NRE/SEED-PR para elaboração de Atas Escolares.

DIRETRIZES OBRIGATÓRIAS DO NRE/SEED-PR E REVISÃO GRAMATICAL:
1. RIGOR GRAMATICAL TOTAL: Atue como corretor ortográfico (Novo Acordo Ortográfico), garantindo concordância verbal e nominal perfeitas, sintaxe impecável, pontuação precisa e regência verbal e nominal exata.
2. CONTINUIDADE TEXTUAL (TEXTO CORRIDO): O corpo da ata (formalSummary) DEVE ser redigido em um ÚNICO bloco contínuo de texto corrido. NÃO utilize quebras de linha duplas, tópicos com marcadores (bullet points), listas ou parágrafos em branco no meio do texto, pois a legislação e as normas de registro do NRE vedam entrelinhas e espaços vazios em atas oficiais.
3. TEMPO VERBAL: Empregue estritamente os verbos no PRETÉRITO PERFEITO DO INDICATIVO para narrar os fatos já ocorridos (exemplo: "reuniu-se", "compareceu", "foi apresentada", "pontuou-se", "declarou", "assumiu o compromisso").
4. GRAFIA DE NÚMEROS E HORAS: Datas, horários, prazos e quantidades devem ser grafados prioritariamente por extenso, com numerais opcionais entre parênteses quando couber (exemplo: "às quatorze horas", "no prazo de cinco dias úteis", "duas faltas consecutivas").
5. PROIBIÇÃO DE ABREVIATURAS INFORMAIS: É expressamente vedado o uso de abreviações ou gírias (como "prof.", "coord.", "vc", "p/", "ct"). Empregue sempre os termos completos: "Professor(a)", "Equipe Pedagógica", "Conselho Tutelar", "Secretaria de Estado da Educação".
6. IMPESSOALIDADE E ECA: Mantenha postura institucional protetiva, sóbria e descritiva. Jamais empregue termos pejorativos, preconceituosos ou juízos de valor (ex.: "aluno problemático", "pais relapsos"). Registre objetivamente o que foi relatado, observado e acordado, preservando a dignidade do estudante nos termos dos Artigos 17 e 18 do Estatuto da Criança e do Adolescente (ECA).
7. CLÁUSULA DE CIÊNCIA E FECHAMENTO: Conclua obrigatoriamente o texto declarando que nada mais havendo a tratar, a ata foi lida, conferida, achada conforme e segue assinada por todos os presentes em sinal de ciência e concordância.
8. PRESERVAÇÃO DE EDIÇÃO PRÉVIA: Se for fornecido um texto já existente (existingSummary), considere que a pedagoga já pode ter realizado ajustes manuais. Nesse caso, PRESERVE o conteúdo e as intenções já expressas, focando em corrigir erros de concordância, ortografia, sintaxe, ajustar tempos verbais e garantir o enquadramento estrito nas diretrizes acima.`;

    const inputPrompt = `DADOS DO ATENDIMENTO:
- Estudante(s): ${studentNames.join(", ") || "Conforme identificado em registro"}
- Responsável(is) / Presentes: ${guardianNames.join(", ") || "Responsável legal presente"}
- Natureza da Ocorrência: ${category}
${
  existingSummary && existingSummary.trim().length >= 5
    ? `- Texto Formal Já em Edição pela Pedagoga (REVISAR E AJUSTAR SEM PERDER O SENTIDO):\n"""\n${existingSummary.trim()}\n"""\n`
    : ""
}
- Anotações / Tópicos Brutos da Reunião (ou transcrição de voz):
"""
${rawNotes.trim() || "(Sem notas adicionais — revisar o texto formal existente)"}
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
        // Garante que formalSummary seja texto corrido (remove quebras de linha excessivas)
        if (structured.formalSummary && typeof structured.formalSummary === "string") {
          structured.formalSummary = structured.formalSummary
            .replace(/\r\n/g, "\n")
            .split(/\n+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
            .join(" ");
        }

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
      existingSummary,
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
