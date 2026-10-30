/**
 * Utilitários puros para higienização cadastral, normalização de nomes/CGMs,
 * padronização de telefones brasileiros (WhatsApp) e classificação de status SERP.
 */

export function normalizeStudentName(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .toUpperCase()
    .replace(/\s*-\s*\d+.*$/, "") // remove sufixo numérico de CGM caso colado no nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWhatsAppPhone(raw?: string | null): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("5555") && digits.length >= 14) {
    digits = digits.slice(2);
  }
  if (!digits.startsWith("55")) {
    digits = "55" + digits;
  }
  return digits;
}

export function parseAttendancePercent(raw?: string | number | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  const cleaned = String(raw).replace("%", "").replace(",", ".").trim();
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export type SerpStatusEnum =
  | "CONSELHO_TUTELAR"
  | "MINISTERIO_PUBLICO"
  | "ARQUIVADO"
  | "EM_ACOMPANHAMENTO";

export function normalizeSerpStatus(raw?: string | null): SerpStatusEnum {
  const s = (raw || "").toUpperCase();
  if (s.includes("CONSELHO") || /\bCT\b/.test(s) || s.includes("- CT") || s.includes("ENCAMINHAR CT")) {
    return "CONSELHO_TUTELAR";
  }
  if (s.includes("MINIST") || s.includes("PROMOTOR") || /\bMP\b/.test(s)) {
    return "MINISTERIO_PUBLICO";
  }
  if (s.includes("ARQUIV") || s.includes("NORMALIZ") || s.includes("ENCERRAD")) {
    return "ARQUIVADO";
  }
  return "EM_ACOMPANHAMENTO";
}

export interface StudentLookupEntry {
  id: string;
  cgm?: string | null;
  name: string;
}

export function buildStudentLookupMaps(students: StudentLookupEntry[]) {
  const cgmMap = new Map<string, string>();
  const nameMap = new Map<string, { id: string; hasCgm: boolean }>();
  const usedCgms = new Set<string>();

  for (const s of students) {
    const cleanCgm = s.cgm?.trim();
    if (cleanCgm) {
      cgmMap.set(cleanCgm, s.id);
      usedCgms.add(cleanCgm);
    }
    const norm = normalizeStudentName(s.name);
    if (norm) {
      nameMap.set(norm, { id: s.id, hasCgm: Boolean(cleanCgm) });
    }
  }

  return { cgmMap, nameMap, usedCgms };
}
