import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageReplySchema, replyCategoryEnum } from "@/lib/schemas";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { computeMessageContentHash } from "@/lib/messageCrypto";
import { createAiPseudonymizer } from "@/lib/aiPseudonymizer";
import {
  classifyGuardianReplyHeuristic,
  type ReplyCategory,
} from "@/lib/whatsappProvider";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { GoogleGenAI } from "@google/genai";

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
  },
  required: ["formalSummary", "category"],
};

async function classifyReplyWithFallback({
  rawText,
  studentName,
  guardianName,
  reasonTitle,
}: {
  rawText: string;
  studentName?: string;
  guardianName?: string | null;
  reasonTitle?: string;
}): Promise<{ formalSummary: string; category: ReplyCategory }> {
  const pseudonymizer = createAiPseudonymizer(
    studentName ? [studentName] : [],
    guardianName ? [guardianName] : []
  );
  const maskedText = pseudonymizer.maskText(rawText);

  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^["']|["']$/g, "").trim();

  if (apiKey) {
    const systemInstruction = `Você é um especialista da Equipe Pedagógica e de Busca Ativa da Rede Ativa integrada à instituição de ensino.
Sua tarefa é ler a mensagem informal recebida via WhatsApp de um pai, mãe ou responsável legal e transformá-la em um registro administrativo formal, impessoal e objetivo (adequado para compor ata escolar, ficha SERP e Dossiê do Conselho Tutelar), além de classificar a causa da ausência.

Regras:
1. Não invente fatos que não estejam na mensagem original.
2. Escreva "formalSummary" em terceira pessoa (ex.: "Responsável informou via WhatsApp que...").
3. Classifique "category" estritamente em um dos valores permitidos: SAUDE, TRANSPORTE, TRABALHO, VIAGEM_FAMILIAR, VULNERABILIDADE, SEM_JUSTIFICATIVA ou OUTROS.`;

    const inputPrompt = `Estudante: ${pseudonymizer.maskedStudentNames[0] || "Não informado"}
Motivo do contato escolar: ${reasonTitle || "Busca Ativa Escolar"}
Mensagem recebida do responsável via WhatsApp:
"""
${maskedText}
"""`;

    const modelsToTry = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

    for (const model of modelsToTry) {
      let timer: NodeJS.Timeout | null = null;
      try {
        const abortController = new AbortController();
        timer = setTimeout(() => abortController.abort(), 14000);

        const ai = new GoogleGenAI({ apiKey });
        let rawJsonText: string | null = null;

        try {
          if (typeof (ai as any).interactions?.create === "function") {
            const interaction: any = await (ai as any).interactions.create(
              {
                model,
                input: inputPrompt,
                system_instruction: systemInstruction,
                response_format: CLASSIFICATION_JSON_SCHEMA as any,
              },
              {
                signal: abortController.signal,
                timeout_ms: 14000,
              } as any
            );
            rawJsonText =
              interaction?.output_text ||
              interaction?.outputs?.find((o: any) => o?.type === "text")?.text ||
              null;
          }
        } catch {
          // Fallback para models.generateContent se interactions não responder
        }

        if (!rawJsonText && ai.models?.generateContent) {
          const response: any = await ai.models.generateContent({
            model,
            contents: inputPrompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema: CLASSIFICATION_JSON_SCHEMA as any,
              abortSignal: abortController.signal,
            } as any,
          });
          rawJsonText = response?.text || null;
        }

        if (rawJsonText) {
          const cleaned = rawJsonText
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```$/i, "")
            .trim();
          const parsed = JSON.parse(cleaned);
          const catCheck = replyCategoryEnum.safeParse(parsed.category);
          const validCat: ReplyCategory = catCheck.success ? catCheck.data : "OUTROS";
          const rawSummary = String(parsed.formalSummary || "").trim();
          if (rawSummary) {
            return {
              formalSummary: pseudonymizer.unmaskText(rawSummary),
              category: validCat,
            };
          }
        }
      } catch (err: any) {
        console.warn(`[GEMINI classify reply] Modelo ${model} falhou:`, err?.message || err);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }
  }

  // Fallback determinístico caso Gemini não esteja configurado, falhe ou dê timeout
  const heuristic = classifyGuardianReplyHeuristic(rawText);
  return {
    formalSummary: pseudonymizer.unmaskText(heuristic.formalSummary),
    category: heuristic.category,
  };
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rateLimitKey = `msg-reply:${authCheck.schoolId || "global"}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.MESSAGE_REPLY);
    if (!rlCheck.ok) return rlCheck.response;

    const rawBody = await req.json();
    const parsed = messageReplySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const {
      logId,
      guardianReplied,
      replyNotes,
      replyCategory,
      rawReply,
      extractedAt,
      sourceMethod = "MANUAL",
      classifyWithAi = false,
    } = parsed.data;

    const previous = await prisma.messageLog.findUnique({
      where: { id: logId },
      include: { student: true },
    });

    if (!previous) {
      return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(previous.student?.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    let finalReplyNotes: string | null =
      replyNotes !== undefined ? replyNotes : previous.replyNotes;
    let finalReplyCategory: string | null =
      replyCategory !== undefined ? replyCategory : previous.replyCategory;
    let finalRepliedAt: Date | null = null;

    if (guardianReplied === true) {
      const baseText = (rawReply || replyNotes || "").trim();
      const shouldClassify =
        (classifyWithAi === true || (!replyNotes && Boolean(rawReply))) && Boolean(baseText);

      if (shouldClassify) {
        const classification = await classifyReplyWithFallback({
          rawText: baseText,
          studentName: previous.student?.name,
          guardianName: previous.student?.guardianName,
          reasonTitle: previous.reasonTitle,
        });

        if (!replyCategory || classifyWithAi) {
          finalReplyCategory = classification.category;
        }
        if (!replyNotes || classifyWithAi) {
          finalReplyNotes = classification.formalSummary;
        }
      }

      if (extractedAt) {
        const parsedExtracted =
          extractedAt instanceof Date ? extractedAt : new Date(extractedAt);
        if (!isNaN(parsedExtracted.getTime())) {
          finalRepliedAt = parsedExtracted;
        } else {
          finalRepliedAt = new Date();
        }
      } else {
        finalRepliedAt = new Date();
      }
    } else {
      finalReplyNotes = null;
      finalReplyCategory = null;
      finalRepliedAt = null;
    }

    const newContentHash = computeMessageContentHash({
      studentId: previous.studentId,
      schoolId: previous.student?.schoolId,
      phoneUsed: previous.phoneUsed,
      reasonTitle: previous.reasonTitle,
      messageContent: previous.messageContent,
      sentByName: previous.sentByName,
      sentAt: previous.sentAt,
      guardianReplied: Boolean(guardianReplied),
      replyNotes: finalReplyNotes,
      replyCategory: finalReplyCategory,
      repliedAt: finalRepliedAt,
    });

    const shouldUpgradeDelivery =
      Boolean(guardianReplied) &&
      (previous.deliveryStatus === "QUEUED" ||
        previous.deliveryStatus === "DISPATCHING" ||
        previous.deliveryStatus === "LINK_OPENED" ||
        previous.deliveryStatus === "SENT");

    const updated = await prisma.messageLog.update({
      where: { id: logId },
      data: {
        guardianReplied: Boolean(guardianReplied),
        replyNotes: finalReplyNotes,
        replyCategory: finalReplyCategory,
        repliedAt: finalRepliedAt,
        repliedByUserId: Boolean(guardianReplied)
          ? authCheck.session?.user?.id || authCheck.userId || null
          : null,
        contentHash: newContentHash,
        ...(shouldUpgradeDelivery
          ? { deliveryStatus: "READ", deliveryUpdatedAt: new Date() }
          : {}),
      },
    });

    if (Boolean(guardianReplied) && previous.studentId && previous.phoneUsed) {
      try {
        const normalizedTarget = normalizeWhatsAppPhone(previous.phoneUsed);
        if (normalizedTarget && prisma.studentContact?.updateMany) {
          const contacts = await prisma.studentContact.findMany({
            where: { studentId: previous.studentId, whatsappValid: false },
          });
          const matchIds = contacts
            .filter((c) => normalizeWhatsAppPhone(c.phone) === normalizedTarget)
            .map((c) => c.id);
          if (matchIds.length > 0) {
            await prisma.studentContact.updateMany({
              where: { id: { in: matchIds } },
              data: { whatsappValid: true },
            });
          }
        }
      } catch (contactErr) {
        console.warn("Aviso ao revalidar contato após retorno:", contactErr);
      }
    }

    await logAudit({
      action: "MARK_REPLY",
      entityType: "MessageLog",
      entityId: logId,
      details: {
        previousReplied: previous.guardianReplied,
        newReplied: Boolean(guardianReplied),
        sourceMethod,
        replyCategory: updated.replyCategory,
        contentHash: newContentHash,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error("Erro ao registrar retorno:", error);
    return NextResponse.json(
      { error: "Erro interno ao registrar resposta do responsável" },
      { status: 500 }
    );
  }
}
