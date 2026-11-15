/** Diagnóstico de desenvolvimento: nunca inclui identificadores ou conteúdo. */
export const EXTENSION_DIAGNOSTIC_KEY = "redeativa_extension_diagnostics";
export const EXTENSION_DIAGNOSTIC_EVENT = "redeativa-extension-diagnostic";

export function extensionDiagnosticsEnabled(): boolean {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return false;
  if (!["localhost", "127.0.0.1"].includes(window.location?.hostname || "")) return false;
  try { return window.sessionStorage.getItem(EXTENSION_DIAGNOSTIC_KEY) === "1"; } catch { return false; }
}

export function traceExtensionStep(stage: string): void {
  if (!extensionDiagnosticsEnabled()) return;
  window.dispatchEvent(new CustomEvent(EXTENSION_DIAGNOSTIC_EVENT, { detail: { stage } }));
}
