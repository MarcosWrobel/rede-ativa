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
