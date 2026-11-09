/**
 * Utilitário LGPD & Estatuto da Criança e do Adolescente (ECA) para
 * pseudo-anonimização de dados pessoais de estudantes e responsáveis em chamadas
 * para serviços externos de Inteligência Artificial Generativa.
 */

export interface AiPseudonymizer {
  maskText: (text: string) => string;
  unmaskText: (text: string) => string;
  maskedStudentNames: string[];
  maskedGuardianNames: string[];
  maskedTeacherNames: string[];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDiacriticInsensitivePattern(str: string): string {
  const charMap: Record<string, string> = {
    a: "[aáàãâäAÁÀÃÂÄ]",
    e: "[eéèêëEÉÈÊË]",
    i: "[iíìîïIÍÌÎÏ]",
    o: "[oóòõôöOÓÒÕÔÖ]",
    u: "[uúùûüUÚÙÛÜ]",
    c: "[cçCÇ]",
  };

  const escaped = escapeRegex(str);
  let pattern = "";
  for (let i = 0; i < escaped.length; i++) {
    const ch = escaped[i];
    const normalized = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (charMap[normalized]) {
      pattern += charMap[normalized];
    } else {
      pattern += ch;
    }
  }
  return pattern;
}

const CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_REGEX = /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)(?:9\s?)?\d{4}[-.\s]?\d{4}\b/g;

export function createAiPseudonymizer(
  studentNames: string[] = [],
  guardianNames: string[] = [],
  teacherNames: string[] = []
): AiPseudonymizer {
  const replacements: Array<{ placeholder: string; real: string }> = [];

  const maskedStudentNames = studentNames.map((name, idx) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return "";
    const placeholder = `[ESTUDANTE_${idx + 1}]`;
    replacements.push({ placeholder, real: trimmed });
    return placeholder;
  }).filter(Boolean);

  const maskedGuardianNames = guardianNames.map((name, idx) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return "";
    const placeholder = `[RESPONSAVEL_${idx + 1}]`;
    replacements.push({ placeholder, real: trimmed });
    return placeholder;
  }).filter(Boolean);

  const maskedTeacherNames = teacherNames.map((name, idx) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return "";
    const placeholder = `[DOCENTE_${idx + 1}]`;
    replacements.push({ placeholder, real: trimmed });
    return placeholder;
  }).filter(Boolean);

  // Ordena substituições do nome mais longo para o mais curto para evitar colisões de substrings
  const sortedByLengthDesc = [...replacements].sort(
    (a, b) => b.real.length - a.real.length
  );

  const maskText = (text: string): string => {
    if (!text || typeof text !== "string") return text;
    let masked = text;

    // 1. Substitui nomes de estudantes e responsáveis conhecidos (inclusive variações acentuadas)
    for (const item of sortedByLengthDesc) {
      if (!item.real || item.real.length < 2) continue;
      const pattern = buildDiacriticInsensitivePattern(item.real);
      const regex = new RegExp(pattern, "gi");
      masked = masked.replace(regex, item.placeholder);
    }

    // 2. Higieniza dados sensíveis adicionais (CPFs, e-mails e telefones)
    masked = masked.replace(CPF_REGEX, "[DOCUMENTO_SIGILOSO]");
    masked = masked.replace(EMAIL_REGEX, "[EMAIL_SIGILOSO]");
    masked = masked.replace(PHONE_REGEX, "[TELEFONE_SIGILOSO]");

    return masked;
  };

  const unmaskText = (text: string): string => {
    if (!text || typeof text !== "string") return text;
    let unmasked = text;
    for (const item of replacements) {
      const regex = new RegExp(escapeRegex(item.placeholder), "g");
      unmasked = unmasked.replace(regex, item.real);
    }
    return unmasked;
  };

  return {
    maskText,
    unmaskText,
    maskedStudentNames,
    maskedGuardianNames,
    maskedTeacherNames,
  };
}
