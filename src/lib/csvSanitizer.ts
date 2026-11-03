/**
 * Sanitizador contra CSV/DDE Formula Injection.
 *
 * Se uma célula iniciar com caracteres acionadores de fórmulas no Excel/Calc
 * (=, +, -, @, tabulação ou quebra de linha), prefixa com apóstrofo (')
 * garantindo que a planilha trate o valor puramente como texto literal.
 */
export function sanitizeCsvField(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  const raw = String(value);
  if (/^[=+\-@\t\r]/.test(raw)) {
    return `'${raw}`;
  }

  const trimmed = raw.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`;
  }

  return trimmed;
}
