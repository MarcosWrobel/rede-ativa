import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { generateLocalAtaMinuta, formatAtaDateExtenso } from "@/lib/nreAtaFormatter";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

const formalizeAtaSchema = z
  .object({
    rawNotes: z.string().default(""),
    existingSummary: z.string().optional().default(""),
    category: z.string().default("ACOMPANHAMENTO_PEDAGOGICO"),
    studentNames: z.array(z.string()).default([]),
    guardianNames: z.array(z.string()).default([]),
    attendedAt: z.string().optional(),
    apiKey: z.string().optional(),
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

    const { rawNotes, existingSummary, category, studentNames, guardianNames, attendedAt, apiKey: bodyApiKey } = parsed.data;

    const dateInfo = formatAtaDateExtenso(attendedAt);

    // Prioriza a chave oficial da Vercel (GEMINI_API_KEY)
    const envKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY
    )?.replace(/^["']|["']$/g, "").trim();

    const headerKey = req.headers.get("x-gemini-key")?.replace(/^["']|["']$/g, "").trim();
    const bodyKey = bodyApiKey?.replace(/^["']|["']$/g, "").trim();

    const apiKey =
      (envKey && envKey.length > 10 ? envKey : null) ||
      (headerKey && headerKey.length > 10 ? headerKey : null) ||
      (bodyKey && bodyKey.length > 10 ? bodyKey : null);

    // Fallback heurístico inteligente se não houver chave Gemini
    if (!apiKey) {
      const fallbackResult = generateLocalAtaMinuta({
        rawNotes,
        existingSummary,
        category,
        studentNames,
        guardianNames,
        attendedAt,
      });
      return NextResponse.json({
        success: true,
        usedFallback: true,
        fallbackReason: "Chave da API Gemini não configurada no servidor (Vercel) nem no navegador.",
        result: fallbackResult,
      });
    }

    const cleanApiKey = apiKey.replace(/^["']|["']$/g, "").trim();
    const ai = new GoogleGenAI({ apiKey: cleanApiKey });

    const systemInstruction = `Você atua como Revisor Gramatical e Redator Oficial da Equipe Pedagógica de um Colégio Estadual da Rede Pública do Paraná (SEED-PR / Núcleo Regional de Educação - NRE).
Sua missão é formalizar e revisar o texto da ata de atendimento pedagógico aplicando com o mais alto rigor a Norma Culta da Língua Portuguesa e as Diretrizes Oficiais do NRE/SEED-PR para elaboração de Atas Escolares.

DIRETRIZES OBRIGATÓRIAS DO NRE/SEED-PR E REVISÃO GRAMATICAL:
1. RIGOR GRAMATICAL TOTAL: Atue como corretor ortográfico (Novo Acordo Ortográfico), garantindo concordância verbal e nominal perfeitas, sintaxe impecável, pontuação precisa e regência verbal e nominal exata. Corrija imediatamente erros e vícios como "conflita", "por conta de", "entraram em atrito", convertendo para linguagem pedagógica culta.
2. ABERTURA CANÔNICA COM DATA REAL DO ATENDIMENTO: O corpo da ata (formalSummary) DEVE OBRIGATORIAMENTE iniciar mencionando a data oficial do atendimento por extenso:
"${dateInfo.dataExtensoCompleta}, nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento com a presença de..."
É EXPRESSAMENTE VEDADO inventar qualquer outro mês, dia ou ano (exemplo: JAMAIS invente maio, outro dia ou expressões como 'ano pré-estabelecido'). O ano DEVE ser estritamente ${dateInfo.anoExtenso}.
3. CONTINUIDADE TEXTUAL (TEXTO CORRIDO): O corpo da ata (formalSummary) DEVE ser redigido em um ÚNICO bloco contínuo de texto corrido. NÃO utilize quebras de linha duplas, tópicos com marcadores (bullet points), listas ou parágrafos em branco no meio do texto, pois a legislação e as normas de registro do NRE vedam entrelinhas e espaços vazios em atas oficiais.
4. TEMPO VERBAL: Empregue estritamente os verbos no PRETÉRITO PERFEITO DO INDICATIVO para narrar os fatos já ocorridos (exemplo: "reuniu-se", "compareceu", "foi apresentada", "pontuou-se", "declarou", "assumiu o compromisso").
5. PROIBIÇÃO DE ABREVIATURAS INFORMAIS: É expressamente vedado o uso de abreviações ou gírias (como "prof.", "coord.", "vc", "p/", "ct"). Empregue sempre os termos completos: "Professor(a)", "Equipe Pedagógica", "Conselho Tutelar", "Secretaria de Estado da Educação".
6. IMPESSOALIDADE E ECA: Mantenha postura institucional protetiva, sóbria e descritiva. Jamais empregue termos pejorativos, preconceituosos ou juízos de valor (ex.: "aluno problemático", "pais relapsos"). Registre objetivamente o que foi relatado, observado e acordado, preservando a dignidade do estudante nos termos dos Artigos 17 e 18 do Estatuto da Criança e do Adolescente (ECA).
7. CLÁUSULA DE CIÊNCIA E FECHAMENTO: Conclua obrigatoriamente o texto declarando que nada mais havendo a tratar, a ata foi lida, conferida, achada conforme e segue assinada por todos os presentes em sinal de ciência e concordância.
8. PRESERVAÇÃO DE EDIÇÃO PRÉVIA: Se for fornecido um texto já existente (existingSummary), considere que a pedagoga já pode ter realizado ajustes manuais. Nesse caso, PRESERVE o conteúdo e as intenções já expressas, focando em corrigir erros de concordância, ortografia, sintaxe, ajustar tempos verbais e garantir o enquadramento estrito nas diretrizes acima.`;

    const inputPrompt = `DADOS DO ATENDIMENTO:
- Data e Hora Oficiais do Atendimento: ${dateInfo.dataExtensoCompleta}, às ${dateInfo.horaFormatada}
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
"""

REGRAS DE FORMATAÇÃO DO JSON DE RESPOSTA:
Responda OBRIGATORIAMENTE em formato JSON com as 4 chaves exatas:
{
  "formalSubject": "Título formal e objetivo da ata",
  "formalSummary": "${dateInfo.dataExtensoCompleta}, nas dependências da Equipe Pedagógica deste estabelecimento de ensino...",
  "agreementsSummary": "Síntese dos combinados e compromissos pactuados",
  "actionItems": [
    {
      "description": "Texto claro da ação combinada (ex: Entregar tarefas pendentes de todas as disciplinas)",
      "responsible": "FAMILIA",
      "suggestedDaysToComplete": 7
    }
  ]
}
Importante: O campo "actionItems" DEVE conter de 1 a 3 objetos com a chave "description" obrigatoriamente preenchida (nunca string solta ou vazia), "responsible" ("FAMILIA", "ESTUDANTE", "ESCOLA" ou "REDE_PROTECAO") e "suggestedDaysToComplete" (número de dias de prazo).`;

    // Modelos vigentes na API do Google (2026) - gemini-3.5-flash confirmado como prioritário
    const modelsToTry = [
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-3.5-flash-lite",
      "gemini-3.8-flash",
    ];

    let rawJsonText: string | null = null;
    let lastErrorMsg = "";

    // 1. Tentativa principal via ai.models.generateContent com thinkingLevel: low
    for (const model of modelsToTry) {
      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 18000);

        const response = await ai.models.generateContent({
          model,
          contents: `${inputPrompt}\n\nResponda estritamente em formato JSON com as chaves: "formalSubject", "formalSummary", "agreementsSummary", "actionItems".`,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: FORMALIZE_ATA_JSON_SCHEMA,
            temperature: 0.2,
            thinkingConfig: {
              thinkingLevel: "low" as any,
            },
            abortSignal: abortController.signal,
          },
        });

        clearTimeout(timeoutId);

        if (response?.text) {
          rawJsonText = response.text.trim();
          break;
        }
      } catch (err: any) {
        lastErrorMsg = err?.message || String(err);
        if (lastErrorMsg.toLowerCase().includes("api key not valid")) {
          break;
        }
        console.warn(`[GEMINI generateContent] Modelo ${model} falhou: ${lastErrorMsg}. Tentando próximo...`);
      }
    }

    // 2. Fallback secundário para Interactions API caso generateContent oscile
    if (!rawJsonText && !lastErrorMsg.toLowerCase().includes("api key not valid")) {
      try {
        const interaction: any = await ai.interactions.create({
          model: "gemini-3.5-flash-lite",
          input: inputPrompt,
          system_instruction: systemInstruction,
          response_format: {
            type: "json_object",
            response_schema: FORMALIZE_ATA_JSON_SCHEMA,
          },
        });

        if (interaction?.output_text) {
          rawJsonText = interaction.output_text.trim();
        } else if (interaction?.outputs?.[0]?.text) {
          rawJsonText = interaction.outputs[0].text.trim();
        }
      } catch (err: any) {
        console.warn("[GEMINI Interactions fallback] Falhou:", err.message);
      }
    }

    if (rawJsonText) {
      try {
        const cleanJson = rawJsonText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/i, "")
          .trim();
        const structured = JSON.parse(cleanJson);
        // Garante que formalSummary seja texto corrido (remove quebras de linha excessivas)
        if (structured.formalSummary && typeof structured.formalSummary === "string") {
          let cleanSummary = structured.formalSummary
            .replace(/\r\n/g, "\n")
            .split(/\n+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
            .join(" ");

          // Garante a data real por extenso na abertura sem alucinação
          const prefixoDataObrigatorio = dateInfo.dataExtensoCompleta;
          if (!cleanSummary.startsWith(prefixoDataObrigatorio)) {
            // Se o modelo começou com uma fórmula alternativa ou data alucinada, substitui o trecho inicial
            const matchAbertura = cleanSummary.match(/^(?:Aos?\s+[^,]+|No dia\s+[^,]+|Em\s+[^,]+),\s*(?:nas dependências|\s*realizou-se|\s*reuniram-se)/i);
            if (matchAbertura) {
              cleanSummary = cleanSummary.replace(
                matchAbertura[0],
                `${prefixoDataObrigatorio}, nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento`
              );
            } else if (!cleanSummary.toLowerCase().includes(dateInfo.mesExtenso.toLowerCase())) {
              cleanSummary = `${prefixoDataObrigatorio}, ${cleanSummary}`;
            }
          }

          structured.formalSummary = cleanSummary;
        }

        // Normaliza actionItems para garantir que as propriedades description, responsible e suggestedDaysToComplete estejam populadas
        if (Array.isArray(structured.actionItems)) {
          structured.actionItems = structured.actionItems
            .map((item: any) => {
              if (typeof item === "string") {
                return {
                  description: item.trim(),
                  responsible: "FAMILIA",
                  suggestedDaysToComplete: 7,
                };
              }
              const desc =
                item.description ||
                item.descricao ||
                item.acao ||
                item.item ||
                item.task ||
                item.texto ||
                item.detalhes ||
                "";
              let resp = String(item.responsible || item.responsavel || "FAMILIA").toUpperCase();
              if (!["FAMILIA", "ESTUDANTE", "ESCOLA", "REDE_PROTECAO"].includes(resp)) {
                resp = "FAMILIA";
              }
              const days =
                Number(item.suggestedDaysToComplete || item.prazoDias || item.prazo || item.days) || 7;
              return {
                description: String(desc).trim(),
                responsible: resp,
                suggestedDaysToComplete: days,
              };
            })
            .filter((a: any) => a.description && a.description.length > 0);
        }

        return NextResponse.json({
          success: true,
          usedFallback: false,
          result: structured,
        });
      } catch (parseErr) {
        console.warn("[AI Formalize Ata] Falha no parse de JSON:", parseErr);
      }
    }

    // Fallback caso a API Gemini esteja indisponível
    const fallbackResult = generateLocalAtaMinuta({
      rawNotes,
      existingSummary,
      category,
      studentNames,
      guardianNames,
      attendedAt,
    });
    return NextResponse.json({
      success: true,
      usedFallback: true,
      fallbackReason: !apiKey
        ? "Chave da API Gemini não configurada no navegador nem no servidor."
        : `A chamada à API Gemini falhou (${lastErrorMsg || "tempo limite esgotado"}).`,
      result: fallbackResult,
    });
  } catch (error: any) {
    console.error("[AI Formalize Ata] Erro inesperado:", error);
    return NextResponse.json({ error: error.message || "Erro ao processar minuta" }, { status: 500 });
  }
}
