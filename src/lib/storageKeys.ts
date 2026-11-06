/**
 * Gerenciador de armazenamento local (LocalStorage) com retrocompatibilidade
 * Permite ler preferências armazenadas sob a chave legada "leopoldina_*"
 * enquanto grava primariamente sob a marca neutra "redeativa_*".
 */

export function getStoredPreference(keySuffix: string, fallbackValue: string = ""): string {
  if (typeof window === "undefined") return fallbackValue;
  try {
    const neutralValue = localStorage.getItem(`redeativa_${keySuffix}`);
    if (neutralValue !== null) return neutralValue;

    const legacyValue = localStorage.getItem(`leopoldina_${keySuffix}`);
    if (legacyValue !== null) return legacyValue;
  } catch {
    // Falha silenciosa em navegadores com cookies/storage bloqueados
  }
  return fallbackValue;
}

export function setStoredPreference(keySuffix: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`redeativa_${keySuffix}`, value);
  } catch {
    // Falha silenciosa
  }
}

export function removeStoredPreference(keySuffix: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`redeativa_${keySuffix}`);
    localStorage.removeItem(`leopoldina_${keySuffix}`);
  } catch {
    // Falha silenciosa
  }
}
