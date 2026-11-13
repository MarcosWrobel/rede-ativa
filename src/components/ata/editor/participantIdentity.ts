import type { AtaActionItemDraft, AtaParticipantDraft } from "./types";
import { sanitizeKinshipForRole } from "@/lib/participantKinship";

/**
 * Indica se o participante já possui assinatura ou verificação OIDC/biométrica
 * que bloqueia alterações diretas em identidade e informação documental.
 */
export function isParticipantSignatureLocked(participant: AtaParticipantDraft): boolean {
  return Boolean(
    participant.verifiedEmail ||
      participant.signatureData ||
      participant.hasSignature ||
      participant.biometricVerified
  );
}

/**
 * Indica se o participante possui um link/QR ativo aguardando assinatura (ainda não assinado).
 */
export function isParticipantQrActive(
  participant: AtaParticipantDraft,
  qrModalParticipantId?: string | null
): boolean {
  if (isParticipantSignatureLocked(participant)) return false;
  return Boolean(
    participant.hasActiveSignLink ||
      (participant.id && qrModalParticipantId && participant.id === qrModalParticipantId)
  );
}

/**
 * Limpa integralmente todos os campos probatórios de assinatura, OIDC, biometria,
 * recusa e link QR anterior ao acionar "Refazer assinatura".
 */
export function buildRefazerAssinaturaPatch(
  participant: AtaParticipantDraft
): AtaParticipantDraft {
  return {
    ...participant,
    signatureData: null,
    signedAt: null,
    hasSignature: false,
    signatureMode: "PENDING",
    verifiedEmail: null,
    verifiedGoogleSub: null,
    verifiedGoogleName: null,
    emailVerifiedAt: null,
    biometricVerified: false,
    biometricDeviceType: null,
    biometricAuthTime: null,
    biometricStrokeData: null,
    signerIp: null,
    signerUserAgent: null,
    clientTimestampIso: null,
    hasActiveSignLink: false,
    refusalReason: "",
    witnessName: "",
    clearSignature: true,
  };
}

/**
 * Atualiza o papel de um participante ainda não assinado aplicando a sanitização
 * compartilhada de `kinship` e limpando `studentId` quando deixa de ser `ESTUDANTE`.
 */
export function applyRoleChangeToUnsignedParticipant(
  participant: AtaParticipantDraft,
  nextRole: string
): AtaParticipantDraft {
  if (isParticipantSignatureLocked(participant)) {
    return participant;
  }

  const sanitizedKinship = sanitizeKinshipForRole(nextRole, participant.kinship, {
    isSigned: false,
  });

  return {
    ...participant,
    role: nextRole,
    studentId: nextRole === "ESTUDANTE" ? participant.studentId ?? null : null,
    kinship: sanitizedKinship ?? "",
  };
}

/**
 * Decide se novas sugestões de encaminhamento vindas da IA podem ser aplicadas diretamente
 * ou se devem aguardar confirmação explícita do usuário para não apagar itens/prazos existentes
 * (inclusive editados enquanto a resposta da IA estava em andamento).
 */
export function applyPendingAiActionItemsDecision(
  currentItems: AtaActionItemDraft[],
  suggestedItems: AtaActionItemDraft[]
): {
  nextItems: AtaActionItemDraft[];
  pendingSuggestions: AtaActionItemDraft[] | null;
} {
  if (!suggestedItems || suggestedItems.length === 0) {
    return { nextItems: currentItems, pendingSuggestions: null };
  }

  const hasExistingContent = currentItems.some(
    (item) =>
      Boolean(item.description && item.description.trim().length > 0) ||
      Boolean(item.dueDate && item.dueDate.trim().length > 0) ||
      Boolean(item.id)
  );

  if (hasExistingContent) {
    return {
      nextItems: currentItems,
      pendingSuggestions: suggestedItems,
    };
  }

  return {
    nextItems: suggestedItems,
    pendingSuggestions: null,
  };
}

export interface ResetParticipantSignatureResult {
  ok: boolean;
  persistedOnServer: boolean;
  participants: AtaParticipantDraft[];
  minuteId?: string;
  error?: string;
}

/**
 * Executa a remoção da assinatura garantindo persistência no servidor (`PATCH /api/atas/[id]`)
 * antes de liberar os campos de identidade quando o rascunho/participante já existe no banco.
 * Se o servidor recusar ou falhar, mantém a assinatura anterior reconhecida.
 */
export async function resetParticipantSignatureWithServer(params: {
  minuteId?: string | null;
  participantIndex: number;
  participants: AtaParticipantDraft[];
  buildPayload: (nextParticipants: AtaParticipantDraft[]) => Record<string, unknown>;
  fetcher?: typeof fetch;
}): Promise<ResetParticipantSignatureResult> {
  const { minuteId, participantIndex, participants, buildPayload, fetcher = fetch } = params;
  const target = participants[participantIndex];
  if (!target) {
    return {
      ok: false,
      persistedOnServer: false,
      participants,
      error: "Participante não encontrado.",
    };
  }

  const nextParticipants = participants.map((item, i) =>
    i === participantIndex ? buildRefazerAssinaturaPatch(item) : item
  );

  // Rascunho ainda não salvo no servidor ou linha ainda não persistida
  if (!minuteId || !target.id) {
    return {
      ok: true,
      persistedOnServer: false,
      participants: nextParticipants,
    };
  }

  try {
    const res = await fetcher(`/api/atas/${minuteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(nextParticipants)),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      minute?: { id?: string; participants?: AtaParticipantDraft[] };
    };

    if (!res.ok) {
      return {
        ok: false,
        persistedOnServer: false,
        participants,
        error:
          data.error ||
          "Não foi possível remover a assinatura no servidor. A assinatura anterior foi mantida.",
      };
    }

    return {
      ok: true,
      persistedOnServer: true,
      minuteId: data.minute?.id || minuteId,
      participants: data.minute?.participants || nextParticipants,
    };
  } catch {
    return {
      ok: false,
      persistedOnServer: false,
      participants,
      error:
        "Falha de conexão ao remover a assinatura no servidor. A assinatura anterior foi mantida.",
    };
  }
}
