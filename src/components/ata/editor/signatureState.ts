import type { AtaParticipantDraft } from "./types";

export interface ParticipantSignatureSummary {
  isRefused: boolean;
  isInstitutionalVerified: boolean;
  hasRenderableImage: boolean;
  hasPersistedSignature: boolean;
}

/**
 * Centraliza a leitura do estado de assinatura por participante, alinhada às regras do servidor.
 * Separa verificação institucional, imagem renderizável, recusa e assinatura persistida.
 */
export function getParticipantSignatureSummary(
  participant: Pick<
    AtaParticipantDraft,
    "signatureMode" | "signatureData" | "verifiedEmail" | "hasSignature"
  >
): ParticipantSignatureSummary {
  const isRefused = participant.signatureMode === "REFUSED";
  const isInstitutionalVerified = !isRefused && Boolean(participant.verifiedEmail);
  const hasRenderableImage = !isRefused && Boolean(participant.signatureData);

  let hasPersistedSignature = false;
  if (!isRefused) {
    if (participant.signatureMode === "ESCOLA_OAUTH") {
      hasPersistedSignature = isInstitutionalVerified && participant.hasSignature !== false;
    } else {
      hasPersistedSignature = hasRenderableImage || Boolean(participant.hasSignature);
    }
  }

  return {
    isRefused,
    isInstitutionalVerified,
    hasRenderableImage,
    hasPersistedSignature,
  };
}
