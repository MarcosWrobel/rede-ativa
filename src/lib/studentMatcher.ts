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
  let parsed: number | null = null;
  if (typeof raw === "number") {
    parsed = Number.isFinite(raw) ? raw : null;
  } else {
    const cleaned = String(raw).replace("%", "").replace(",", ".").trim();
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    parsed = Number.isFinite(num) ? num : null;
  }
  if (parsed === null) return null;
  // Clamp estrito de integridade no intervalo percentual válido [0, 100] (Q-02)
  return Math.min(100, Math.max(0, parsed));
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

export interface StudentLookupNameMatch {
  id: string;
  hasCgm: boolean;
  isHomonym?: boolean;
}

export function buildStudentLookupMaps(students: StudentLookupEntry[]) {
  const cgmMap = new Map<string, string>();
  const nameMap = new Map<string, StudentLookupNameMatch>();
  const usedCgms = new Set<string>();

  for (const s of students) {
    const cleanCgm = s.cgm?.trim();
    if (cleanCgm) {
      cgmMap.set(cleanCgm, s.id);
      usedCgms.add(cleanCgm);
    }
    const norm = normalizeStudentName(s.name);
    if (norm) {
      const existing = nameMap.get(norm);
      if (existing) {
        if (existing.id !== s.id) {
          // Homônimo detectado: mais de um aluno com mesmo nome normalizado na instituição (Q-01)
          existing.isHomonym = true;
          nameMap.set(norm, { id: existing.id, hasCgm: existing.hasCgm, isHomonym: true });
        }
      } else {
        nameMap.set(norm, { id: s.id, hasCgm: Boolean(cleanCgm), isHomonym: false });
      }
    }
  }

  return { cgmMap, nameMap, usedCgms };
}
