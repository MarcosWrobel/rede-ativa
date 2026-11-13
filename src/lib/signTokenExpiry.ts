/**
 * Regra única de fronteira para expiração de tokens móveis de assinatura.
 * O token é considerado expirado quando o instante atual atinge ou ultrapassa `expiresAt`.
 */
export function isSignTokenExpired(
  expiresAt: Date | string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!expiresAt) return false;
  const expiresMs = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  return nowMs >= expiresMs;
}
