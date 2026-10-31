import { getActiveJustification } from "./pedagogicalClassifier";
import { normalizeWhatsAppPhone } from "./studentMatcher";

export type DeliveryStatus =
  | "LINK_OPENED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED_NO_WHATSAPP";

export type ReplyCategory =
  | "SAUDE"
  | "TRANSPORTE"
  | "TRABALHO"
  | "VIAGEM_FAMILIAR"
  | "VULNERABILIDADE"
  | "SEM_JUSTIFICATIVA"
  | "OUTROS";

export type WhatsAppProviderMode = "WA_ME" | "HTTP_GATEWAY";

/**
 * Nome fixo da aba do navegador reutilizada no Modo Fila (wa.me),
 * evitando abrir 15–20 abas separadas durante o disparo cadenciado de uma turma.
 */
export const WA_ME_REUSABLE_WINDOW_NAME = "leopoldina_whatsapp_dispatch";

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  LINK_OPENED: "Link Aberto (wa.me)",
  SENT: "Enviado (Confirmado)",
  DELIVERED: "Entregue",
  READ: "Lido / Respondido",
  FAILED_NO_WHATSAPP: "Sem WhatsApp / Inválido",
};

export const REPLY_CATEGORY_LABELS: Record<ReplyCategory, string> = {
  SAUDE: "Saúde / Consulta / Atestado",
  TRANSPORTE: "Transporte Escolar / Clima",
  TRABALHO: "Trabalho / Conflito de Horário",
  VIAGEM_FAMILIAR: "Viagem / Compromisso Familiar",
  VULNERABILIDADE: "Vulnerabilidade / Desmotivação",
  SEM_JUSTIFICATIVA: "Ciente — Sem Justificativa Formal",
  OUTROS: "Outros Motivos",
};

export const REPLY_CATEGORY_OPTIONS: Array<{ value: ReplyCategory; label: string }> = [
  { value: "SAUDE", label: "🩺 Saúde / Consulta / Atestado Médico" },
  { value: "TRANSPORTE", label: "🚌 Transporte Escolar / Condições Climáticas" },
  { value: "TRABALHO", label: "💼 Trabalho Adolescente / Conflito de Horário" },
  { value: "VIAGEM_FAMILIAR", label: "🧳 Viagem / Compromisso Familiar" },
  { value: "VULNERABILIDADE", label: "⚠️ Vulnerabilidade / Desmotivação / Risco" },
  { value: "SEM_JUSTIFICATIVA", label: "📌 Ciente da Falta — Sem Justificativa Formal" },
  { value: "OUTROS", label: "📝 Outros Motivos" },
];

export function buildWaMeUrl(phoneDigits: string, messageText: string): string {
  const cleanDigits = normalizeWhatsAppPhone(phoneDigits);
  const encodedText = encodeURIComponent(messageText);
  return `https://wa.me/${cleanDigits}?text=${encodedText}`;
}

export interface DispatchResult {
  mode: WhatsAppProviderMode;
  whatsappUrl: string;
  initialStatus: DeliveryStatus;
  gatewayMessageId?: string | null;
}

/**
 * Camada plugável de transporte WhatsApp (AUT-02).
 * Permanece 100% em modo wa.me (gratuito/oficial via navegador) por padrão,
 * com suporte opcional futuro a HTTP Gateway caso WHATSAPP_PROVIDER="HTTP_GATEWAY" seja configurado.
 */
export async function dispatchWhatsAppMessage({
  phoneDigits,
  messageText,
}: {
  phoneDigits: string;
  messageText: string;
}): Promise<DispatchResult> {
  const whatsappUrl = buildWaMeUrl(phoneDigits, messageText);
  const configuredMode = (process.env.WHATSAPP_PROVIDER || "WA_ME").toUpperCase();
  const gatewayUrl = process.env.WHATSAPP_GATEWAY_URL?.trim();
  const gatewayToken = process.env.WHATSAPP_GATEWAY_TOKEN?.trim();

  if (configuredMode === "HTTP_GATEWAY" && gatewayUrl && gatewayToken) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          phone: normalizeWhatsAppPhone(phoneDigits),
          message: messageText,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        return {
          mode: "HTTP_GATEWAY",
          whatsappUrl,
          initialStatus: "SENT",
          gatewayMessageId: payload?.id || payload?.messageId || null,
        };
      }
    } catch (err) {
      console.warn("[WhatsAppProvider] Gateway indisponível, operando via wa.me:", err);
    }
  }

  return {
    mode: "WA_ME",
    whatsappUrl,
    initialStatus: "LINK_OPENED",
    gatewayMessageId: null,
  };
}

export interface QueueCandidateEvaluation {
  eligibleByDefault: boolean;
  skipReason: "ATESTADO_VIGENTE" | "SEM_WHATSAPP" | "JA_ACIONADO_HOJE" | "INTERCAMBIO_GANHANDO_MUNDO" | null;
  resolvedPhone: string;
  resolvedGuardianName: string;
  usedFallbackContact: boolean;
}

/**
 * Avalia elegibilidade e escolhe automaticamente o melhor telefone válido do aluno
 * para a Fila Assistida por Turma via wa.me (AUT-01 + AUT-02).
 */
export function evaluateQueueCandidate(
  student: {
    phone: string;
    guardianName?: string | null;
    isExchangeStudent?: boolean;
    isSpecialNeeds?: boolean;
    contacts?: Array<{
      name: string;
      phone: string;
      isPrimary?: boolean;
      whatsappValid?: boolean;
    }>;
    justifications?: Array<{
      id: string;
      type: string;
      startDate: string | Date;
      endDate: string | Date;
      notes?: string | null;
    }>;
    messageLogs?: Array<{
      sentAt: string | Date;
      deliveryStatus?: string | null;
    }>;
  },
  referenceDate: Date = new Date()
): QueueCandidateEvaluation {
  const activeJust = getActiveJustification(student.justifications || [], referenceDate);
  const contacts = student.contacts || [];
  const primaryDigits = normalizeWhatsAppPhone(student.phone || "");

  // Alunos em intercâmbio (Ganhando Mundo) são pulados por padrão
  if (student.isExchangeStudent) {
    return {
      eligibleByDefault: false,
      skipReason: "INTERCAMBIO_GANHANDO_MUNDO",
      resolvedPhone: student.phone || "",
      resolvedGuardianName: student.guardianName || "",
      usedFallbackContact: false,
    };
  }

  // Verifica se o telefone principal está explicitamente marcado como inválido nos contatos
  const primaryFlaggedInvalid = contacts.some(
    (c) => normalizeWhatsAppPhone(c.phone) === primaryDigits && c.whatsappValid === false
  );

  let resolvedPhone = student.phone || "";
  let resolvedGuardianName = student.guardianName || "";
  let usedFallbackContact = false;

  if (!primaryDigits || primaryDigits.length < 10 || primaryFlaggedInvalid) {
    const validAlt = contacts.find(
      (c) => c.whatsappValid !== false && normalizeWhatsAppPhone(c.phone).length >= 10
    );
    if (validAlt) {
      resolvedPhone = validAlt.phone;
      resolvedGuardianName = validAlt.name;
      usedFallbackContact = true;
    } else {
      return {
        eligibleByDefault: false,
        skipReason: "SEM_WHATSAPP",
        resolvedPhone,
        resolvedGuardianName,
        usedFallbackContact: false,
      };
    }
  }

  if (activeJust) {
    return {
      eligibleByDefault: false,
      skipReason: "ATESTADO_VIGENTE",
      resolvedPhone,
      resolvedGuardianName,
      usedFallbackContact,
    };
  }

  const refDay = referenceDate.toISOString().slice(0, 10);
  const sentToday = (student.messageLogs || []).some((log) => {
    if (log.deliveryStatus === "FAILED_NO_WHATSAPP") return false;
    const d = new Date(log.sentAt);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === refDay;
  });

  if (sentToday) {
    return {
      eligibleByDefault: false,
      skipReason: "JA_ACIONADO_HOJE",
      resolvedPhone,
      resolvedGuardianName,
      usedFallbackContact,
    };
  }

  return {
    eligibleByDefault: true,
    skipReason: null,
    resolvedPhone,
    resolvedGuardianName,
    usedFallbackContact,
  };
}

export interface ClassifiedGuardianReply {
  formalSummary: string;
  category: ReplyCategory;
  requiresMedicalCertificate: boolean;
  suggestedFollowUp: string;
}

/**
 * Classificador e formalizador determinístico local (AUT-03).
 * Atua como fallback imediato caso a chave Gemini não esteja configurada ou sofra oscilação.
 */
export function classifyGuardianReplyHeuristic(rawReply: string): ClassifiedGuardianReply {
  const clean = rawReply.trim().replace(/\s+/g, " ");
  const lower = clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    /\b(medic|atestad|postinh|upa|hospital|febre|doent|gripe|dengue|dor|dentist|odonto|consult|exame|internad|cirurgi|receit|remedio|psicolog)\w*/.test(
      lower
    )
  ) {
    return {
      category: "SAUDE",
      requiresMedicalCertificate: true,
      formalSummary: `Responsável informou via WhatsApp que a ausência ocorreu por motivo de saúde/atendimento médico ("${clean.slice(0, 180)}"). Orientada a entrega de atestado ou declaração de comparecimento na secretaria/coordenação.`,
      suggestedFollowUp: "Solicitar e registrar o atestado médico na aba de Atestados do Prontuário 360º.",
    };
  }

  if (/\b(onibus|transporte|van|chuva|estrada| barro|atraso do onibus|linha|pneu)\w*/.test(lower)) {
    return {
      category: "TRANSPORTE",
      requiresMedicalCertificate: false,
      formalSummary: `Responsável justificou via WhatsApp que a ausência decorreu de impossibilidade/intercorrência de deslocamento ou transporte escolar ("${clean.slice(0, 180)}").`,
      suggestedFollowUp: "Monitorar recorrência junto ao setor de transporte escolar se necessário.",
    };
  }

  if (/\b(trabalh|servic|empreg|bico|estagio|menor aprendiz|turno|patrao|empresa)\w*/.test(lower)) {
    return {
      category: "TRABALHO",
      requiresMedicalCertificate: false,
      formalSummary: `Responsável relatou via WhatsApp conflito relacionado a atividade laboral/horário de trabalho ("${clean.slice(0, 180)}").`,
      suggestedFollowUp: "Avaliar adequação de turno ou convocação presencial para garantia do direito à escolarização.",
    };
  }

  if (/\b(viag|viajou|velorio|luto|faleciment|mudanc|transferenc|familia|casament|cidad)\w*/.test(lower)) {
    return {
      category: "VIAGEM_FAMILIAR",
      requiresMedicalCertificate: false,
      formalSummary: `Responsável comunicou via WhatsApp que a ausência ocorreu em virtude de viagem ou compromisso familiar pontual ("${clean.slice(0, 180)}").`,
      suggestedFollowUp: "Acompanhar retorno regular às aulas na data informada pela família.",
    };
  }

  if (
    /\b(nao quer ir|desmotiv|depress|ansiedad|brig|bully|conflit|fug|nao obedece|conselho tutelar|risco|ameac)\w*/.test(
      lower
    )
  ) {
    return {
      category: "VULNERABILIDADE",
      requiresMedicalCertificate: false,
      formalSummary: `Responsável relatou via WhatsApp quadro de resistência escolar, vulnerabilidade ou demanda socioemocional ("${clean.slice(0, 180)}"). Caso requer atenção prioritária da Equipe Pedagógica.`,
      suggestedFollowUp: "Agendar atendimento presencial com a família e avaliar encaminhamento à Rede de Proteção / SERP.",
    };
  }

  if (/\b(ok|ciente|vou conversar|obrigad|nao sabia|achei que estava|cabul|matou aula|dormiu)\w*/.test(lower)) {
    return {
      category: "SEM_JUSTIFICATIVA",
      requiresMedicalCertificate: false,
      formalSummary: `Responsável acusou ciência do acionamento pedagógico via WhatsApp, sem apresentação de justificativa legal amparada ("${clean.slice(0, 180)}"), comprometendo-se a orientar o(a) estudante.`,
      suggestedFollowUp: "Monitorar assiduidade nos próximos dias letivos.",
    };
  }

  return {
    category: "OUTROS",
    requiresMedicalCertificate: false,
    formalSummary: `Responsável retornou o contato via WhatsApp prestando os seguintes esclarecimentos à Equipe Pedagógica: "${clean.slice(0, 220)}".`,
    suggestedFollowUp: "Registrar ciência no histórico escolar e acompanhar frequência.",
  };
}
