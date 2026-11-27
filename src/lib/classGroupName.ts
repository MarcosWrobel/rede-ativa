/**
 * Normaliza o nome de exibição de uma turma (`ClassGroup`) para evitar
 * duplicações por variações tipográficas (`°` vs `º`, espaços múltiplos).
 */
export function normalizeClassGroupDisplayName(name: string): string {
  return name
    .replace(/\u00B0/g, "\u00BA") // grau (°) -> ordinal masculino (º)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Gera a chave canônica de comparação de turmas dentro da mesma escola:
 * - converte `°` e `ª` em `º`
 * - remove acentos/diacríticos (`Série` == `Serie`)
 * - colapsa espaços e converte para maiúsculas
 */
export function normalizeClassGroupKey(name: string): string {
  return normalizeClassGroupDisplayName(name)
    .replace(/\u00AA/g, "\u00BA") // ordinal feminino (ª) -> º
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/**
 * Adquire lock transacional por escola no PostgreSQL (`pg_advisory_xact_lock`)
 * para serializar criação, renomeação e importação de turmas na mesma unidade
 * e impedir criação concorrente de nomes canonicamente equivalentes.
 * Escolas distintas não se bloqueiam.
 */
export async function acquireClassGroupSchoolLock(
  tx: { $executeRaw?: (...args: any[]) => Promise<unknown> },
  schoolId: string
): Promise<void> {
  if (typeof tx.$executeRaw !== "function" || !schoolId) return;
  const lockKey = `class_group:${schoolId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
