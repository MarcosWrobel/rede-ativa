import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { hasDisallowedAttachmentPayload, recordAiOperationalEvent } from "@/lib/aiPolicy";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function buildLocalTemplateSuggestion(rawPrompt: string): {
  title: string;
  prefixText: string;
  suffixText: string;
  isAbsenceRelated: boolean;
} {
  const normalized = rawPrompt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const isAbsenceRelated =
    /(?:falta|ausencia|infrequenc|evasao|frequenc|atestado|justificativa)/.test(normalized);

  if (/boletim|nota|recuperacao|avaliacao/.test(normalized)) {
    return {
      title: "ENTREGA DE BOLETINS E ACOMPANHAMENTO",
      prefixText:
        "{saudacao}\nPrezados responsáveis, informamos que está aberto o acompanhamento pedagógico referente ao desempenho escolar de",
      suffixText:
        "Solicitamos o comparecimento à equipe pedagógica no horário de atendimento da escola para alinhamento conjunto.\n\nAtenciosamente,\nEquipe Pedagógica",
      isAbsenceRelated: false,
    };
  }

  if (/reuniao|conselho|convocacao|comparecimento/.test(normalized)) {
    return {
      title: "CONVOCAÇÃO PARA ATENDIMENTO ESCOLAR",
      prefixText:
        "{saudacao}\nPrezados responsáveis, convidamos para atendimento presencial na escola referente ao estudante",
      suffixText:
        "Sua participação é fundamental para o acompanhamento pedagógico. Caso não seja possível no horário informado, responda esta mensagem para agendamento.\n\nAtenciosamente,\nEquipe Pedagógica",
      isAbsenceRelated,
    };
  }

  if (isAbsenceRelated) {
    return {
      title: "ACOMPANHAMENTO DE FREQUÊNCIA ESCOLAR",
      prefixText:
        "{saudacao}\nPrezados responsáveis, registramos faltas recentes que requerem acompanhamento referentes ao estudante",
      suffixText:
        "Pedimos que informem o motivo da ausência e apresentem justificativa ou atestado na secretaria escolar quando aplicável.\n\nAtenciosamente,\nEquipe Pedagógica",
      isAbsenceRelated: true,
    };
  }

  const conciseHeadline = rawPrompt
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .toUpperCase();

  return {
    title: conciseHeadline || "COMUNICADO PEDAGÓGICO",
    prefixText:
      "{saudacao}\nPrezados responsáveis, entramos em contato com a família referente ao estudante",
    suffixText:
      `Comunicamos assunto importante relacionado a: ${rawPrompt.trim()}. Permanecemos à disposição para esclarecimentos no atendimento escolar.\n\nAtenciosamente,\nEquipe Pedagógica`,
    isAbsenceRelated: false,
  };
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rateLimitKey = `ai:${authCheck.schoolId || "global"}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.AI_ENDPOINT);
    if (!rlCheck.ok) return rlCheck.response;

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;

    const body = await req.json();

    if (hasDisallowedAttachmentPayload(body)) {
      return NextResponse.json(
        { error: "O envio de imagens ou anexos está indisponível neste fluxo." },
        { status: 400 }
      );
    }

    const prompt = body?.prompt;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "Por favor, descreva o objetivo da mensagem que deseja gerar." },
        { status: 400 }
      );
    }

    const template = buildLocalTemplateSuggestion(prompt.trim());

    await recordAiOperationalEvent({
      schoolId: schoolRes.school.id,
      route: "/api/ai/generate-template",
      mode: "LOCAL_ONLY",
      reason: "local_template_generation",
      status: "SUCCESS",
      user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
      req,
    });

    return NextResponse.json({
      success: true,
      usedFallback: true,
      mode: "LOCAL_ONLY",
      template,
    });
  } catch {
    return NextResponse.json(
      { error: "Erro interno ao processar modelo com IA." },
      { status: 500 }
    );
  }
}
