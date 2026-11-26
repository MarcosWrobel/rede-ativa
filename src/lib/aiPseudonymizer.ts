/**
 * Utilitário LGPD & Estatuto da Criança e do Adolescente (ECA) para
 * pseudo-anonimização de dados pessoais de estudantes, responsáveis, docentes,
 * datas, horários e documentos em chamadas para provedor externo autorizado.
 */

export interface AiDateReplacements {
  attendedDateExtenso?: string | null;
  attendedYearExtenso?: string | null;
  attendedYearNumeric?: string | null;
  attendedDateNumeric?: string | null;
  attendedDateIso?: string | null;
  attendedTime?: string | null;
  attendedTimeColon?: string | null;
}

export interface AiPseudonymizerOptions {
  dateReplacements?: AiDateReplacements;
  schoolName?: string | null;
  schoolCity?: string | null;
  schoolInep?: string | null;
  maskDatesAndTimes?: boolean;
  maskPartialNames?: boolean;
}

export interface AiPseudonymizer {
  maskText: (text: string) => string;
  unmaskText: (text: string) => string;
  maskedStudentNames: string[];
  maskedGuardianNames: string[];
  maskedTeacherNames: string[];
  maskedSchoolName: string | null;
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

const CPF_REGEX = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;
const CNPJ_REGEX = /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g;
const RG_LABELED_REGEX = /\bRG\s*[:.#-]?\s*[\d.\-Xx]{5,14}\b/gi;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_REGEX = /(?<!\d)(?:\+?55\s?)?(?:\(\d{2}\)\s*|\d{2}\s*)(?:9\s?)?\d{4}[-.\s]?\d{4}(?!\d)/g;
const CEP_LABELED_REGEX = /\bCEP\s*[:.#-]?\s*\d{5}-?\d{3}\b/gi;
const CGM_LABELED_REGEX = /\b(?:CGM|MATR[IÍ]CULA)\s*[:#-]?\s*\d{5,12}\b/gi;
const CGM_ISOLATED_REGEX = /(?<!\d)\d{8,12}(?!\d)/g;
const GENERIC_DATE_REGEX = /\b\d{2}\/\d{2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const GENERIC_TIME_REGEX = /\b(?:[01]?\d|2[0-3])(?:[:h][0-5]\d)\b/gi;

const COMMON_STOP_TOKENS = new Set([
  "silva",
  "santos",
  "souza",
  "sousa",
  "oliveira",
  "pereira",
  "costa",
  "rodrigues",
  "almeida",
  "nascimento",
  "lima",
  "araujo",
  "fernandes",
  "carvalho",
  "gomes",
  "martins",
  "rocha",
  "ribeiro",
  "alves",
  "monteiro",
  "mendes",
  "barros",
  "freitas",
  "barbosa",
  "pinto",
  "moura",
  "cavalcanti",
  "dias",
  "castro",
  "campos",
  "cardoso",
  "escola",
  "colegio",
  "municipal",
  "estadual",
  "aluno",
  "aluna",
  "responsavel",
  "familia",
  "professor",
  "professora",
  "diretor",
  "diretora",
  "pedagoga",
]);

const GENERIC_SCHOOL_NAME_TOKENS = new Set([
  "escola",
  "colegio",
  "estadual",
  "municipal",
  "ensino",
  "fundamental",
  "medio",
  "infantil",
  "educacao",
  "centro",
  "unidade",
  "professor",
  "professora",
  "rural",
  "campo",
  "bairro",
]);

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function createAiPseudonymizer(
  studentNames: string[] = [],
  guardianNames: string[] = [],
  teacherNames: string[] = [],
  options: AiPseudonymizerOptions = {}
): AiPseudonymizer {
  const restoreReplacements: Array<{ placeholder: string; real: string }> = [];
  const maskAliases: Array<{ placeholder: string; real: string; requireBoundary: boolean }> = [];
  const extraDateMap = new Map<string, string>();
  let extraDateSeq = 0;
  let extraTimeSeq = 0;

  const registerPerson = (names: string[], prefix: string): string[] => {
    const firstNamesRaw = names
      .map((n) => (n || "").trim().split(/\s+/)[0] || "")
      .map(normalizeToken)
      .filter(Boolean);
    const firstNameCounts = new Map<string, number>();
    for (const fn of firstNamesRaw) {
      firstNameCounts.set(fn, (firstNameCounts.get(fn) || 0) + 1);
    }

    return names
      .map((name, idx) => {
        const trimmed = (name || "").trim();
        if (!trimmed) return "";
        const placeholder = `[${prefix}_${idx + 1}]`;
        restoreReplacements.push({ placeholder, real: trimmed });
        maskAliases.push({ placeholder, real: trimmed, requireBoundary: false });

        if (options.maskPartialNames !== false) {
          const parts = trimmed.split(/\s+/).filter((p) => p.length >= 2 && !/^(da|de|do|das|dos|e)$/i.test(p));
          if (parts.length >= 2) {
            const firstAndLast = `${parts[0]} ${parts[parts.length - 1]}`;
            if (normalizeToken(firstAndLast) !== normalizeToken(trimmed)) {
              maskAliases.push({ placeholder, real: firstAndLast, requireBoundary: true });
            }
          }
          const first = parts[0];
          const firstNorm = first ? normalizeToken(first) : "";
          if (
            first &&
            first.length >= 4 &&
            !COMMON_STOP_TOKENS.has(firstNorm) &&
            (firstNameCounts.get(firstNorm) || 0) <= 1 &&
            Boolean(options.dateReplacements || options.maskPartialNames)
          ) {
            maskAliases.push({ placeholder, real: first, requireBoundary: true });
          }
        }
        return placeholder;
      })
      .filter(Boolean);
  };

  const maskedStudentNames = registerPerson(studentNames, "ESTUDANTE");
  const maskedGuardianNames = registerPerson(guardianNames, "RESPONSAVEL");
  const maskedTeacherNames = registerPerson(teacherNames, "DOCENTE");

  let maskedSchoolName: string | null = null;
  const trimmedSchoolName = (options.schoolName || "").trim();
  if (trimmedSchoolName.length >= 3) {
    maskedSchoolName = "[ESCOLA]";
    restoreReplacements.push({ placeholder: "[ESCOLA]", real: trimmedSchoolName });
    maskAliases.push({ placeholder: "[ESCOLA]", real: trimmedSchoolName, requireBoundary: false });

    for (const token of trimmedSchoolName.split(/\s+/)) {
      const cleanToken = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const norm = normalizeToken(cleanToken);
      if (cleanToken.length >= 5 && !GENERIC_SCHOOL_NAME_TOKENS.has(norm)) {
        maskAliases.push({ placeholder: "[ESCOLA]", real: cleanToken, requireBoundary: true });
      }
    }
  }

  const trimmedSchoolCity = (options.schoolCity || "").trim();
  if (trimmedSchoolCity.length >= 3) {
    restoreReplacements.push({ placeholder: "[MUNICIPIO]", real: trimmedSchoolCity });
    maskAliases.push({
      placeholder: "[MUNICIPIO]",
      real: trimmedSchoolCity,
      requireBoundary: true,
    });
  }

  const trimmedSchoolInep = (options.schoolInep || "").trim();
  if (trimmedSchoolInep.length >= 4) {
    restoreReplacements.push({ placeholder: "[INEP_SIGILOSO]", real: trimmedSchoolInep });
    maskAliases.push({
      placeholder: "[INEP_SIGILOSO]",
      real: trimmedSchoolInep,
      requireBoundary: true,
    });
  }

  const dates = options.dateReplacements;
  const shouldMaskDates = Boolean(dates || options.maskDatesAndTimes);
  if (dates) {
    if (dates.attendedDateExtenso) {
      restoreReplacements.push({
        placeholder: "[DATA_ATENDIMENTO]",
        real: dates.attendedDateExtenso,
      });
      maskAliases.push({
        placeholder: "[DATA_ATENDIMENTO]",
        real: dates.attendedDateExtenso,
        requireBoundary: false,
      });
    }
    if (dates.attendedDateNumeric) {
      maskAliases.push({
        placeholder: "[DATA_ATENDIMENTO]",
        real: dates.attendedDateNumeric,
        requireBoundary: true,
      });
    }
    if (dates.attendedDateIso) {
      maskAliases.push({
        placeholder: "[DATA_ATENDIMENTO]",
        real: dates.attendedDateIso,
        requireBoundary: true,
      });
    }
    if (dates.attendedYearExtenso) {
      restoreReplacements.push({
        placeholder: "[ANO_ATENDIMENTO]",
        real: dates.attendedYearExtenso,
      });
      maskAliases.push({
        placeholder: "[ANO_ATENDIMENTO]",
        real: dates.attendedYearExtenso,
        requireBoundary: false,
      });
    }
    if (dates.attendedYearNumeric && /^\d{4}$/.test(dates.attendedYearNumeric.trim())) {
      maskAliases.push({
        placeholder: "[ANO_ATENDIMENTO]",
        real: dates.attendedYearNumeric.trim(),
        requireBoundary: true,
      });
    }
    if (dates.attendedTime) {
      restoreReplacements.push({
        placeholder: "[HORA_ATENDIMENTO]",
        real: dates.attendedTime,
      });
      maskAliases.push({
        placeholder: "[HORA_ATENDIMENTO]",
        real: dates.attendedTime,
        requireBoundary: false,
      });
    }
    if (dates.attendedTimeColon) {
      maskAliases.push({
        placeholder: "[HORA_ATENDIMENTO]",
        real: dates.attendedTimeColon,
        requireBoundary: true,
      });
    }
  }

  const sortedByLengthDesc = [...maskAliases].sort(
    (a, b) => b.real.length - a.real.length
  );

  const maskText = (text: string): string => {
    if (!text || typeof text !== "string") return text;
    let masked = text;

    // 1. Substitui nomes conhecidos, escola e data/ano/hora canônicos do atendimento
    for (const item of sortedByLengthDesc) {
      if (!item.real || item.real.length < 2) continue;
      const pattern = buildDiacriticInsensitivePattern(item.real);
      const bounded = item.requireBoundary
        ? `(?<![A-Za-zÀ-ÿ0-9_])${pattern}(?![A-Za-zÀ-ÿ0-9_])`
        : pattern;
      const regex = new RegExp(bounded, "gi");
      masked = masked.replace(regex, item.placeholder);
    }

    // 2. Sanitiza datas e horários genéricos quando em modo estrito (ex.: formalização de ata)
    if (shouldMaskDates) {
      masked = masked.replace(GENERIC_DATE_REGEX, (match) => {
        for (const [ph, orig] of extraDateMap.entries()) {
          if (orig === match) return ph;
        }
        extraDateSeq += 1;
        const placeholder = `[DATA_${extraDateSeq}]`;
        extraDateMap.set(placeholder, match);
        return placeholder;
      });

      masked = masked.replace(GENERIC_TIME_REGEX, (match) => {
        for (const [ph, orig] of extraDateMap.entries()) {
          if (orig === match) return ph;
        }
        extraTimeSeq += 1;
        const placeholder = `[HORA_${extraTimeSeq}]`;
        extraDateMap.set(placeholder, match);
        return placeholder;
      });
    }

    // 3. Sanitiza identificadores e documentos diretos
    masked = masked.replace(CGM_LABELED_REGEX, "CGM [CGM_SIGILOSO]");
    masked = masked.replace(RG_LABELED_REGEX, "RG [DOCUMENTO_SIGILOSO]");
    masked = masked.replace(CEP_LABELED_REGEX, "CEP [ENDERECO_SIGILOSO]");
    masked = masked.replace(CNPJ_REGEX, "[DOCUMENTO_SIGILOSO]");
    masked = masked.replace(CPF_REGEX, "[DOCUMENTO_SIGILOSO]");
    masked = masked.replace(EMAIL_REGEX, "[EMAIL_SIGILOSO]");
    masked = masked.replace(PHONE_REGEX, "[TELEFONE_SIGILOSO]");
    masked = masked.replace(CGM_ISOLATED_REGEX, "[CGM_SIGILOSO]");

    return masked;
  };

  const unmaskText = (text: string): string => {
    if (!text || typeof text !== "string") return text;
    let unmasked = text;
    for (const item of restoreReplacements) {
      const regex = new RegExp(escapeRegex(item.placeholder), "g");
      unmasked = unmasked.replace(regex, item.real);
    }
    for (const [placeholder, original] of extraDateMap.entries()) {
      const regex = new RegExp(escapeRegex(placeholder), "g");
      unmasked = unmasked.replace(regex, original);
    }
    return unmasked;
  };

  return {
    maskText,
    unmaskText,
    maskedStudentNames,
    maskedGuardianNames,
    maskedTeacherNames,
    maskedSchoolName,
  };
}

const RESIDUAL_LABELED_NAME_REGEX =
  /\b(?:Estudante|Aluno|Aluna|Respons[áa]vel|M[ãa]e|Pai|Genitor|Genitora)\s*[:\-]\s*(?!\[)(?:[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]+(?:\s+(?:da|de|do|das|dos|e)\s+|\s+)[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]+)/;

const RESIDUAL_ADDRESS_REGEX =
  /\b(?:Rua|Avenida|Av\.|Travessa|Alameda|Rodovia|Estrada|Bairro|Loteamento|Conjunto\s+Habitacional)\s+[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ0-9]/i;

const RESIDUAL_PROPER_NAME_PHRASE_REGEX =
  /(?<![\[A-ZÀ-Ý])[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]{2,}(?:(?:\s+(?:da|de|do|das|dos|e)\s+|\s+)[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]{2,})+/g;

const SAFE_INSTITUTIONAL_PHRASES = new Set([
  "equipe pedagogica",
  "conselho de classe",
  "atendimento pedagogico",
  "alinhamento de frequencia",
  "atendimento pedagogico e alinhamento de frequencia",
  "orientacao pedagogica",
  "orientacao docente",
  "orientacao de rotina",
  "busca ativa",
  "frequencia escolar",
  "ensino fundamental",
  "ensino medio",
  "educacao infantil",
  "educacao especial",
  "educacao basica",
  "sala de recursos",
  "rede publica",
  "estabelecimento de ensino",
  "secretaria municipal",
  "nucleo regional",
  "turno manha",
  "turno tarde",
  "turno noite",
  "ano letivo",
  "lingua portuguesa",
  "educacao fisica",
  "escola municipal",
  "escola estadual",
  "colegio estadual",
  "unidade escolar",
  "coordenacao pedagogica",
]);

function isSafeInstitutionalPhrase(candidate: string): boolean {
  const norm = normalizeToken(candidate).replace(/\s+/g, " ");
  if (SAFE_INSTITUTIONAL_PHRASES.has(norm)) return true;
  const parts = norm.split(/\s+(?:e|de|da|do)\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => SAFE_INSTITUTIONAL_PHRASES.has(p) || p.split(" ").length === 1)) {
    return parts.some((p) => SAFE_INSTITUTIONAL_PHRASES.has(p));
  }
  return false;
}

/**
 * Inspeciona payload já pseudonimizado para barrar envio externo caso reste
 * qualquer identificador pessoal direto ou padrão de nome/endereço/documento não mascarado.
 */
export function detectResidualIdentifiers(
  maskedPayload: string,
  options?: { checkUnmaskedProperNames?: boolean }
): string[] {
  if (!maskedPayload || typeof maskedPayload !== "string") return [];
  const findings: string[] = [];

  if (/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/.test(maskedPayload)) {
    findings.push("residual_cpf");
  }
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(maskedPayload)) {
    findings.push("residual_email");
  }
  if (/(?<!\d)(?:\+?55\s?)?(?:\(\d{2}\)\s*|\d{2}\s*)(?:9\s?)?\d{4}[-.\s]?\d{4}(?!\d)/.test(maskedPayload)) {
    findings.push("residual_phone");
  }
  if (/\b(?:RG|CGM|CPF|CNPJ|MATR[IÍ]CULA|NIS|CNS|SUS|INEP|CEP|PROCESSO)\s*[:.#-]?\s*[\d.\-Xx]{4,}/i.test(maskedPayload)) {
    findings.push("residual_document_id");
  }
  if (RESIDUAL_ADDRESS_REGEX.test(maskedPayload)) {
    findings.push("residual_address");
  }
  if (RESIDUAL_LABELED_NAME_REGEX.test(maskedPayload)) {
    findings.push("residual_labeled_full_name");
  }

  if (options?.checkUnmaskedProperNames) {
    const cleaned = maskedPayload.replace(/\[[A-Z0-9_]+\]/g, " | ");
    const matches = cleaned.match(RESIDUAL_PROPER_NAME_PHRASE_REGEX) || [];
    for (const match of matches) {
      if (!isSafeInstitutionalPhrase(match)) {
        findings.push("residual_unmasked_proper_name");
        break;
      }
    }
  }

  return findings;
}
