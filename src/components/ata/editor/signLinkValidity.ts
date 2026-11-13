export interface SignLinkValidityDisplay {
  label: string;
  isLocallyElapsed: boolean;
  expiresAtMs: number;
}

/**
 * Formata o horário de vencimento retornado pelo servidor e o tempo restante aproximado.
 * Retorna `null` quando `expiresAtIso` está ausente ou inválido.
 */
export function formatSignLinkValidity(
  expiresAtIso: string | null | undefined,
  nowMs: number = Date.now()
): SignLinkValidityDisplay | null {
  if (!expiresAtIso || typeof expiresAtIso !== "string") return null;
  const expiresAtMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAtMs)) return null;

  const expiresDate = new Date(expiresAtMs);
  const nowDate = new Date(nowMs);

  const hh = String(expiresDate.getHours()).padStart(2, "0");
  const min = String(expiresDate.getMinutes()).padStart(2, "0");
  const timeText = `${hh}h${min}`;

  const isSameDay =
    expiresDate.getFullYear() === nowDate.getFullYear() &&
    expiresDate.getMonth() === nowDate.getMonth() &&
    expiresDate.getDate() === nowDate.getDate();

  const dd = String(expiresDate.getDate()).padStart(2, "0");
  const mm = String(expiresDate.getMonth() + 1).padStart(2, "0");
  const targetText = isSameDay ? timeText : `${dd}/${mm} às ${timeText}`;

  const diffMs = expiresAtMs - nowMs;
  if (diffMs <= 0) {
    return {
      label: `Prazo previsto (${targetText}) atingido — aguardando confirmação do servidor`,
      isLocallyElapsed: true,
      expiresAtMs,
    };
  }

  const totalMinutes = Math.ceil(diffMs / 60_000);
  let remainingText: string;
  if (diffMs < 60_000) {
    remainingText = "menos de 1 minuto restante";
  } else if (totalMinutes < 60) {
    remainingText =
      totalMinutes === 1
        ? "aproximadamente 1 minuto restante"
        : `aproximadamente ${totalMinutes} minutos restantes`;
  } else {
    const hours = Math.floor(totalMinutes / 60);
    const remMins = totalMinutes % 60;
    remainingText =
      remMins === 0
        ? `aproximadamente ${hours}h restantes`
        : `aproximadamente ${hours}h e ${remMins}min restantes`;
  }

  return {
    label: `Válido até ${targetText} — ${remainingText}`,
    isLocallyElapsed: false,
    expiresAtMs,
  };
}
