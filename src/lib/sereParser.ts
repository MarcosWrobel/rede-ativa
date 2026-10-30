/**
 * Parser e Higienizador Oficial de Relatórios do SERE (Sistema Estadual de Registro Escolar - SEED/PR)
 * Suporta:
 * 1. Relatório "Relação de Alunos por Turma" exportado em CSV (1 ou múltiplos turnos de uma só vez)
 * 2. Planilhas CSV tabulares genéricas (CGM, Nome, Turma, Turno, Telefone, Responsável)
 * 3. Autodetecção de codificação UTF-8 e Windows-1252 / ISO-8859-1 (padrão Celepar/Crystal Reports)
 * 4. Deduplicação automática de dupla matrícula técnica (NEM EPT + Ensino Médio Profissional)
 * 5. Identificação automática de Programas Complementares (Aluno Monitor, Mais Aprendizagem, AEE, CELEM, etc.)
 * 6. Tratamento de movimentações SERE (Matriculado, Concluinte, Sem Frequência, Remanejado, Reclassificado, Transferido)
 */

import { normalizeStudentName } from "./studentMatcher";

export type SchoolSegment = "FUNDAMENTAL" | "MEDIO" | "NOTURNO";
export type SchoolShift = "MANHA" | "TARDE" | "NOITE";

export type SereStatusCategory =
  | "ACTIVE"          // Matriculado
  | "CONCLUINTE"      // Concluinte (comum em matriz técnica/aproveitamento)
  | "SEM_FREQUENCIA"  // "Sem " / Sem Frequência / Sem Movimentação (alvo de Busca Ativa)
  | "MOVED_INTERNAL"  // Remanejado / Reclassificado (já está ou irá para outra turma)
  | "LEFT_SCHOOL";    // Transferido / Desistente / Abandono / Cancelado / Falecido

export interface ParsedSereStudent {
  cgm: string;
  name: string;
  phone: string;
  guardianName?: string;
  birthDate?: string;
  sex?: string;
  situacaoRaw: string;
  statusCategory: SereStatusCategory;
  enrollmentDate?: string;
  enrollmentTimestamp: number;
}

export interface ParsedSereTurma {
  tempId: string;
  sourceFile: string;
  cursoRaw: string;
  seriacaoRaw: string;
  turnoRaw: string;
  turmaRaw: string;
  suggestedName: string;
  segment: SchoolSegment;
  shift: SchoolShift;
  isComplementary: boolean;
  selectedByDefault: boolean;
  mergedDualMatrixCount: number;
  students: ParsedSereStudent[];
}

export interface SereSchoolMetadata {
  rawSchoolName: string;
  formattedSchoolName: string;
  city: string;
  reportDate: string;
  schoolYear: string;
}

export interface SereParseResult {
  format: "SERE_REPORT" | "TABULAR_CSV";
  schoolMetadata: SereSchoolMetadata | null;
  turmas: ParsedSereTurma[];
  transferredOrLeft: Array<{ cgm: string; name: string; situacaoRaw: string }>;
  warnings: string[];
}

/**
 * Decodifica ArrayBuffer tentando UTF-8 estrito primeiro e caindo para Windows-1252 (Latin-1)
 * caso o arquivo do SERE/Celepar contenha bytes acentuados legados.
 */
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return utf8.replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer).replace(/^\uFEFF/, "");
  }
}

/**
 * Detecta o delimitador predominante (vírgula ou ponto-e-vírgula) fora de aspas.
 */
export function detectCsvDelimiter(text: string): "," | ";" {
  const sampleLines = text.split(/\r?\n/).slice(0, 25);
  let commas = 0;
  let semicolons = 0;

  for (const line of sampleLines) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (ch === ",") commas++;
        else if (ch === ";") semicolons++;
      }
    }
  }

  return semicolons > commas ? ";" : ",";
}

/**
 * Parser CSV compatível com RFC 4180 (suporta campos entre aspas com vírgulas internas).
 */
export function parseCsvRows(text: string, delimiter?: "," | ";"): string[][] {
  const sep = delimiter || detectCsvDelimiter(text);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const cleanText = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];

    if (inQuotes) {
      if (ch === '"') {
        if (cleanText[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        currentRow.push(currentCell);
        currentCell = "";
      } else if (ch === "\r") {
        if (cleanText[i + 1] === "\n") i++;
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else if (ch === "\n") {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Higieniza o telefone vindo do SERE para dígitos puros com DDD (ex: "(42)98839-3454" -> "42988393454").
 * Retorna "" caso ausente ou inválido, permitindo o cadastro do aluno sem travar o lote.
 */
export function cleanSerePhone(raw?: string | null): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return "";

  // Remove prefixo 55 caso já tenha vindo com DDI
  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }
  // Remove zero inicial de operadora/DDD (ex: 042988393454 -> 42988393454)
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }

  if (digits.length < 8) return "";
  return digits;
}

/**
 * Converte data DD/MM/YYYY em timestamp numérico para desempate cronológico de matrículas.
 */
export function parseBrDateToTimestamp(raw?: string | null): number {
  if (!raw) return 0;
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  const [, dd, mm, yyyy] = m;
  const time = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isFinite(time) ? time : 0;
}

/**
 * Classifica a situação de matrícula do SERE.
 */
export function classifySereSituacao(raw?: string | null): SereStatusCategory {
  const norm = (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

  if (!norm || norm.startsWith("MATRICULAD") || norm === "ATIVO" || norm === "CURSANDO") {
    return "ACTIVE";
  }
  if (norm.startsWith("CONCLUINTE") || norm.startsWith("APROVAD")) {
    return "CONCLUINTE";
  }
  // No SERE, "Sem Frequência" / "Sem Movimentação" frequentemente é truncado para "Sem" na coluna CSV
  if (norm === "SEM" || norm.startsWith("SEM ") || norm.includes("INFREQUEN")) {
    return "SEM_FREQUENCIA";
  }
  if (norm.startsWith("REMANEJAD") || norm.startsWith("RECLASSIFICAD")) {
    return "MOVED_INTERNAL";
  }
  if (
    norm.startsWith("TRANSFERID") ||
    norm.startsWith("DESISTENT") ||
    norm.startsWith("ABANDON") ||
    norm.startsWith("CANCELAD") ||
    norm.startsWith("FALECID") ||
    norm.startsWith("EVADID") ||
    norm.startsWith("ENCERRAD") ||
    norm.startsWith("TRANCAD")
  ) {
    return "LEFT_SCHOOL";
  }

  return "ACTIVE";
}

/**
 * Converte o nome invertido padrão SERE (ex: "LEOPOLDINA B PEDROSO, C E PROFA-EF M PRO")
 * em um formato legível institucional (ex: "Colégio Estadual Profa. Leopoldina B. Pedroso").
 */
export function formatSereSchoolName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) return trimmed;

  const baseName = trimmed.slice(0, commaIdx).trim();
  const suffix = trimmed
    .slice(commaIdx + 1)
    .replace(/-.*$/, "")
    .trim()
    .toUpperCase();

  const toTitle = (str: string) =>
    str
      .toLowerCase()
      .split(" ")
      .map((w) => {
        if (["de", "da", "do", "das", "dos", "e"].includes(w)) return w;
        if (w.length === 1) return `${w.toUpperCase()}.`;
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");

  let prefix = "";
  if (/\bC\s*E\s*C\s*M\b/.test(suffix)) {
    prefix = "Colégio Cívico-Militar";
  } else if (/\bC\s*E\b/.test(suffix)) {
    prefix = "Colégio Estadual";
  } else if (/\bE\s*E\b/.test(suffix)) {
    prefix = "Escola Estadual";
  }

  if (/\bPROFA\b/.test(suffix)) {
    prefix = `${prefix} Profa.`.trim();
  } else if (/\bPROF\b/.test(suffix)) {
    prefix = `${prefix} Prof.`.trim();
  } else if (/\bPE\b/.test(suffix)) {
    prefix = `${prefix} Pe.`.trim();
  } else if (/\bDR\b/.test(suffix)) {
    prefix = `${prefix} Dr.`.trim();
  }

  const formattedBase = toTitle(baseName);
  return prefix ? `${prefix} ${formattedBase}` : formattedBase;
}

/**
 * Detecta se o curso do SERE é um Programa Complementar / Contraturno / Monitoria / AEE,
 * que não deve sobrescrever a turma regular do aluno por padrão.
 */
export function isComplementarySereCourse(cursoRaw: string, seriacaoRaw: string): boolean {
  const c = cursoRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const s = seriacaoRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const complementaryPatterns = [
    /\bPROG\b.*MONITOR/,
    /ALUNO MONITOR/,
    /MAIS APRENDIZAGEM/,
    /\bPMA\b/,
    /SALA DE RECURSOS/,
    /ATEND.*EDUC.*ESPECIAL/,
    /\bAEE\b/,
    /\bCELEM\b/,
    /TREINAMENTO ESPORTIVO/,
    /AMPLIACAO DE JORNADA/,
    /CONTRATURNO/,
    /\bEDUTECH\b/,
    /PROGRAMA PONTE/,
    /RECOMPOSICAO/,
    /TUTORIA/,
    /OFICINA/,
    /ROBOTICA/,
    / ESCOLINHA /,
    /ATIVIDADE COMPLEMENTAR/,
  ];

  if (complementaryPatterns.some((re) => re.test(c))) {
    return true;
  }

  if (c.startsWith("PROG ") && s.includes("PERIODO")) {
    return true;
  }

  return false;
}

const TECHNICAL_COURSE_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/ADMINISTR/, "ADM"],
  [/DESENV.*SIST|ANALISE.*DESENV/, "DS"],
  [/INFORMATICA/, "INF"],
  [/FORM.*DOCENT|MAGISTERIO/, "FD"],
  [/ENFERMAGEM/, "ENF"],
  [/AGROPECUARIA/, "AGRO"],
  [/AGRONEGOCIO/, "AGRON"],
  [/LOGISTICA/, "LOG"],
  [/CONTABILIDADE/, "CONT"],
  [/MARKETING/, "MKT"],
  [/FARMACIA/, "FARM"],
  [/ESTETICA/, "EST"],
  [/EDIFICACOES/, "EDIF"],
  [/ELETROMECANICA/, "ELET"],
  [/ELETRONICA/, "ELTR"],
  [/ELETROTECNICA/, "ELTC"],
  [/MEIO AMBIENTE/, "MA"],
  [/SEGURANCA DO TRABALHO/, "ST"],
  [/QUIMICA/, "QUIM"],
  [/NUTRICAO/, "NUT"],
  [/GASTRONOMIA/, "GAST"],
  [/HOSPEDAGEM|TURISMO/, "TUR"],
  [/RECURSOS HUMANOS/, "RH"],
  [/VENDAS|COMERCIO/, "COM"],
  [/CUIDADO.*IDOSO/, "CI"],
  [/SAUDE BUCAL/, "SB"],
  [/ANALISES CLINICAS/, "AC"],
  [/AUDIO E VIDEO|MULTIMIDIA/, "AV"],
  [/JOGOS DIGITAIS/, "JD"],
];

export function detectTechnicalAbbreviation(cursoRaw: string): string | null {
  const norm = cursoRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  for (const [regex, abbr] of TECHNICAL_COURSE_ABBREVIATIONS) {
    if (regex.test(norm)) return abbr;
  }

  if (/\bTEC\b|\bTECNICO\b|\bEPT\b/.test(norm)) {
    return "TEC";
  }

  return null;
}

export function mapSereShift(turnoRaw: string): SchoolShift {
  const norm = (turnoRaw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (norm.includes("NOIT") || norm.includes("NOTURN")) return "NOITE";
  if (norm.includes("TARD") || norm.includes("VESPERT")) return "TARDE";
  return "MANHA"; // Manhã ou Integral operam saudação matutina como base
}

export function mapSereSegment(
  cursoRaw: string,
  seriacaoRaw: string,
  shift: SchoolShift
): SchoolSegment {
  if (shift === "NOITE") return "NOTURNO";

  const normCurso = cursoRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const normSer = seriacaoRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (
    normCurso.includes("FUND") ||
    /[6789]\s*[ºªO°]?\s*ANO/.test(normSer) ||
    /[12345]\s*[ºªO°]?\s*ANO/.test(normSer)
  ) {
    return "FUNDAMENTAL";
  }

  return "MEDIO";
}

function extractGradeNumber(seriacaoRaw: string): string | null {
  const m = seriacaoRaw.trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

function buildBaseTurmaName(params: {
  cursoRaw: string;
  seriacaoRaw: string;
  turmaRaw: string;
  shift: SchoolShift;
  segment: SchoolSegment;
  isComplementary: boolean;
}): { baseName: string; turmaCode: string; canOmitSingleTurmaCode: boolean } {
  const { cursoRaw, seriacaoRaw, turmaRaw, shift, segment, isComplementary } = params;
  const gradeNum = extractGradeNumber(seriacaoRaw);
  const turmaCode = turmaRaw.trim().toUpperCase() || "1";

  if (isComplementary) {
    const shortCourse = cursoRaw.trim().slice(0, 18).trim();
    return {
      baseName: `${shortCourse} ${turmaCode}`.trim(),
      turmaCode,
      canOmitSingleTurmaCode: false,
    };
  }

  const techAbbr = detectTechnicalAbbreviation(cursoRaw);

  // Curso Técnico Integrado ou Subsequente (ex: "1º ADM", "2º DS")
  if (techAbbr && gradeNum) {
    const suffixShift = shift === "NOITE" ? " Not" : "";
    return {
      baseName: `${gradeNum}º ${techAbbr}${suffixShift}`,
      turmaCode,
      canOmitSingleTurmaCode: true,
    };
  }

  // Ensino Fundamental (ex: "6º 1", "7º A")
  if (segment === "FUNDAMENTAL" && gradeNum) {
    return {
      baseName: `${gradeNum}º ${turmaCode}`,
      turmaCode,
      canOmitSingleTurmaCode: false,
    };
  }

  // Ensino Noturno Regular (ex: "1º Série", ou "1º Série A" / "1º Série 2" se múltiplas)
  if (shift === "NOITE" && gradeNum) {
    return {
      baseName: `${gradeNum}º Série`,
      turmaCode,
      canOmitSingleTurmaCode: true,
    };
  }

  // Ensino Médio Diurno Regular (ex: "1º 2", "1º A")
  if (gradeNum) {
    return {
      baseName: `${gradeNum}º ${turmaCode}`,
      turmaCode,
      canOmitSingleTurmaCode: false,
    };
  }

  const fallback = [seriacaoRaw.trim(), turmaCode].filter(Boolean).join(" ");
  return {
    baseName: fallback || `Turma ${turmaCode}`,
    turmaCode,
    canOmitSingleTurmaCode: false,
  };
}

/**
 * Extrai metadados da escola no cabeçalho superior do relatório SERE.
 */
function extractSchoolMetadata(rows: string[][]): SereSchoolMetadata | null {
  let city = "";
  let rawSchoolName = "";
  let reportDate = "";
  let schoolYear = "";

  const limit = Math.min(rows.length, 12);
  let seedLineIdx = -1;

  for (let i = 0; i < limit; i++) {
    const rowText = rows[i].join(" ");
    const dateMatch = rowText.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dateMatch && !reportDate) {
      reportDate = dateMatch[1];
    }

    if (/SECRETARIA DE ESTADO DA EDUCA/i.test(rowText) || /SISTEMA ESCOLA/i.test(rowText)) {
      seedLineIdx = i;
    }
  }

  if (seedLineIdx !== -1) {
    const cityRow = rows[seedLineIdx + 1] || [];
    const schoolRow = rows[seedLineIdx + 2] || [];

    const nonEmptyCity = cityRow.map((c) => c.trim()).filter(Boolean);
    if (nonEmptyCity.length > 0 && !/RELA[CÇ][AÃ]O/i.test(nonEmptyCity[0])) {
      city = nonEmptyCity[0];
    }

    const nonEmptySchool = schoolRow.map((c) => c.trim()).filter(Boolean);
    if (nonEmptySchool.length > 0 && !/RELA[CÇ][AÃ]O/i.test(nonEmptySchool[0])) {
      rawSchoolName = nonEmptySchool[0];
      const yearCandidate = nonEmptySchool.find((c) => /^20\d{2}$/.test(c));
      if (yearCandidate) schoolYear = yearCandidate;
    }
  }

  if (!rawSchoolName && !city) return null;

  const formattedCity = city
    ? city
        .toLowerCase()
        .split(" ")
        .map((w) => (["de", "da", "do", "das", "dos"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(" ")
    : "";

  return {
    rawSchoolName,
    formattedSchoolName: rawSchoolName ? formatSereSchoolName(rawSchoolName) : "",
    city: formattedCity,
    reportDate,
    schoolYear,
  };
}

interface RawTurmaHeader {
  curso: string;
  seriacao: string;
  turno: string;
  turma: string;
  explicitName?: string;
}

function parseTurmaHeaderRow(row: string[]): RawTurmaHeader | null {
  let curso = "";
  let seriacao = "";
  let turno = "";
  let turma = "";

  for (let i = 0; i < row.length; i++) {
    const cell = row[i].trim();
    if (!cell) continue;

    const extractVal = (prefixRe: RegExp): string | null => {
      const m = cell.match(prefixRe);
      if (!m) return null;
      const inline = m[1].trim();
      if (inline) return inline;
      for (let j = i + 1; j < Math.min(i + 4, row.length); j++) {
        const next = row[j].trim();
        if (next && !/^(Curso|Seria|Turno|Turma)\s*:/i.test(next)) return next;
      }
      return "";
    };

    const cVal = extractVal(/^Curso\s*:\s*(.*)$/i);
    if (cVal !== null) curso = cVal;

    const sVal = extractVal(/^Seria[cç][aã]o\s*:\s*(.*)$/i);
    if (sVal !== null) seriacao = sVal;

    const tVal = extractVal(/^Turno\s*:\s*(.*)$/i);
    if (tVal !== null) turno = tVal;

    const trVal = extractVal(/^Turma\s*:\s*(.*)$/i);
    if (trVal !== null) turma = trVal;
  }

  if (!curso && !seriacao) return null;
  return { curso, seriacao, turno, turma };
}

interface ColumnMap {
  cgmIdx: number;
  nameIdx: number;
  birthIdx: number;
  sexIdx: number;
  phoneIdx: number;
  situacaoIdx: number;
  enrollmentDateIdx: number;
}

const DEFAULT_SERE_COLS: ColumnMap = {
  cgmIdx: 3,
  nameIdx: 4,
  birthIdx: 5,
  sexIdx: 8,
  phoneIdx: 9,
  situacaoIdx: 15,
  enrollmentDateIdx: 17,
};

function detectSereColumnMap(row: string[]): ColumnMap | null {
  let cgmIdx = -1;
  let nameIdx = -1;
  let phoneIdx = -1;
  let situacaoIdx = -1;
  let birthIdx = -1;
  let sexIdx = -1;
  let enrollmentDateIdx = -1;

  for (let i = 0; i < row.length; i++) {
    const norm = row[i]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
    if (!norm) continue;

    if (norm === "CGM" || norm === "MATRICULA") cgmIdx = i;
    else if (norm.includes("NOME DO ESTUDANTE") || norm.includes("NOME DO ALUNO") || norm === "ESTUDANTE") nameIdx = i;
    else if (norm.includes("TELEFONE") || norm.includes("CELULAR") || norm.includes("FONE")) phoneIdx = i;
    else if (norm.startsWith("SITUACAO")) situacaoIdx = i;
    else if (norm.startsWith("DATA DE") || norm.includes("NASCIMENTO")) birthIdx = i;
    else if (norm.startsWith("SEX")) sexIdx = i;
    else if (norm.includes("DATA MATRICULA") || norm.includes("DT MATRICULA")) enrollmentDateIdx = i;
  }

  if (cgmIdx !== -1 && nameIdx !== -1) {
    return {
      cgmIdx,
      nameIdx,
      birthIdx: birthIdx !== -1 ? birthIdx : DEFAULT_SERE_COLS.birthIdx,
      sexIdx: sexIdx !== -1 ? sexIdx : DEFAULT_SERE_COLS.sexIdx,
      phoneIdx: phoneIdx !== -1 ? phoneIdx : DEFAULT_SERE_COLS.phoneIdx,
      situacaoIdx: situacaoIdx !== -1 ? situacaoIdx : DEFAULT_SERE_COLS.situacaoIdx,
      enrollmentDateIdx:
        enrollmentDateIdx !== -1 ? enrollmentDateIdx : DEFAULT_SERE_COLS.enrollmentDateIdx,
    };
  }

  return null;
}

const STATUS_PRIORITY: Record<SereStatusCategory, number> = {
  ACTIVE: 5,
  CONCLUINTE: 4,
  SEM_FREQUENCIA: 3,
  MOVED_INTERNAL: 2,
  LEFT_SCHOOL: 1,
};

/**
 * Processa 1 ou mais arquivos CSV (do SERE ou planilha tabular) e retorna turmas estruturadas,
 * deduplicadas e prontas para revisão visual antes da gravação em lote.
 */
export function parseSereFiles(
  files: Array<{ fileName: string; content: string }>
): SereParseResult {
  const rawSections: Array<{
    sourceFile: string;
    header: RawTurmaHeader;
    studentsMap: Map<string, ParsedSereStudent>;
  }> = [];

  let detectedSchoolMeta: SereSchoolMetadata | null = null;
  const warnings: string[] = [];
  let isTabularFallback = false;

  for (const file of files) {
    const rows = parseCsvRows(file.content);
    if (rows.length === 0) continue;

    const meta = extractSchoolMetadata(rows);
    if (meta && !detectedSchoolMeta) {
      detectedSchoolMeta = meta;
    }

    // Verifica se o arquivo possui blocos "Curso: ... Seriação: ..." do SERE
    const hasSereSections = rows.some((r) => parseTurmaHeaderRow(r) !== null);

    if (hasSereSections) {
      let currentSection: {
        sourceFile: string;
        header: RawTurmaHeader;
        studentsMap: Map<string, ParsedSereStudent>;
      } | null = null;
      let colMap: ColumnMap = DEFAULT_SERE_COLS;

      for (const row of rows) {
        const header = parseTurmaHeaderRow(row);
        if (header) {
          // Verifica se já existe seção idêntica aberta (ex: quebra de página da mesma turma)
          const existingSame = rawSections.find(
            (s) =>
              s.header.curso === header.curso &&
              s.header.seriacao === header.seriacao &&
              s.header.turno === header.turno &&
              s.header.turma === header.turma
          );
          if (existingSame) {
            currentSection = existingSame;
          } else {
            currentSection = {
              sourceFile: file.fileName,
              header,
              studentsMap: new Map(),
            };
            rawSections.push(currentSection);
          }
          continue;
        }

        const detectedCols = detectSereColumnMap(row);
        if (detectedCols) {
          colMap = detectedCols;
          continue;
        }

        if (!currentSection) continue;

        // Ignora rodapés de página ("Página 1 de 14") ou linhas em branco
        const joined = row.join("").trim();
        if (!joined || /P[aá]gina\s+\d+\s+de/i.test(row.join(" "))) continue;

        const rawCgm = (row[colMap.cgmIdx] || "").replace(/\D/g, "");
        const rawName = (row[colMap.nameIdx] || "").replace(/\s+/g, " ").trim().toUpperCase();

        // Linha válida de aluno no SERE possui CGM numérico (>= 5 dígitos) e Nome
        if (!rawName || rawName.length < 3 || rawCgm.length < 5) continue;

        const situacaoRaw = (row[colMap.situacaoIdx] || "").trim() || "Matriculado";
        const statusCategory = classifySereSituacao(situacaoRaw);
        const enrollmentDate = (row[colMap.enrollmentDateIdx] || "").trim();
        const studentObj: ParsedSereStudent = {
          cgm: rawCgm,
          name: rawName,
          phone: cleanSerePhone(row[colMap.phoneIdx]),
          birthDate: (row[colMap.birthIdx] || "").trim() || undefined,
          sex: (row[colMap.sexIdx] || "").trim() || undefined,
          situacaoRaw,
          statusCategory,
          enrollmentDate: enrollmentDate || undefined,
          enrollmentTimestamp: parseBrDateToTimestamp(enrollmentDate),
        };

        const key = rawCgm || normalizeStudentName(rawName);
        const prev = currentSection.studentsMap.get(key);
        if (
          !prev ||
          STATUS_PRIORITY[studentObj.statusCategory] > STATUS_PRIORITY[prev.statusCategory] ||
          (STATUS_PRIORITY[studentObj.statusCategory] === STATUS_PRIORITY[prev.statusCategory] &&
            studentObj.enrollmentTimestamp >= prev.enrollmentTimestamp)
        ) {
          currentSection.studentsMap.set(key, studentObj);
        }
      }
    } else {
      // Fallback: Planilha CSV Tabular (ex: colunas Nome, Turma, Telefone, CGM, Turno, Responsável)
      const parsedTabular = parseTabularCsvFallback(rows, file.fileName);
      if (parsedTabular.length > 0) {
        isTabularFallback = true;
        rawSections.push(...parsedTabular);
      } else {
        warnings.push(
          `Não foi possível identificar cabeçalhos do SERE ou colunas de alunos no arquivo "${file.fileName}".`
        );
      }
    }
  }

  // Etapa 2: Deduplicação automática de Dupla Matrícula Técnica do SERE
  // Ex: "NEM EPT IF TEC ADMINISTR-ET GN" (Página 9) + "NOVO ENSINO MEDIO-PROFISSIONAL" (Página 10)
  // com os mesmos alunos na mesma série e turno.
  const mergedIndices = new Set<number>();
  const mergedCounts = new Map<number, number>();

  for (let i = 0; i < rawSections.length; i++) {
    if (mergedIndices.has(i)) continue;
    const secA = rawSections[i];
    const activeA = Array.from(secA.studentsMap.values()).filter(
      (s) => s.statusCategory === "ACTIVE" && s.cgm
    );
    if (activeA.length < 3) continue;
    const cgmsA = new Set(activeA.map((s) => s.cgm));

    for (let j = i + 1; j < rawSections.length; j++) {
      if (mergedIndices.has(j)) continue;
      const secB = rawSections[j];

      const sameShift = mapSereShift(secA.header.turno) === mapSereShift(secB.header.turno);
      const sameGrade =
        extractGradeNumber(secA.header.seriacao) === extractGradeNumber(secB.header.seriacao);
      if (!sameShift || !sameGrade) continue;

      const activeB = Array.from(secB.studentsMap.values()).filter(
        (s) => s.statusCategory === "ACTIVE" && s.cgm
      );
      if (activeB.length < 3) continue;

      let overlap = 0;
      for (const st of activeB) {
        if (cgmsA.has(st.cgm)) overlap++;
      }

      const minSize = Math.min(activeA.length, activeB.length);
      if (overlap / minSize >= 0.8) {
        // Escolhe como principal a seção que possui sigla técnica específica (ex: ADM, DS)
        const abbrA = detectTechnicalAbbreviation(secA.header.curso);
        const abbrB = detectTechnicalAbbreviation(secB.header.curso);

        const primaryIdx = !abbrA && abbrB ? j : i;
        const secondaryIdx = primaryIdx === i ? j : i;

        const primary = rawSections[primaryIdx];
        const secondary = rawSections[secondaryIdx];

        for (const [k, st] of secondary.studentsMap.entries()) {
          if (!primary.studentsMap.has(k)) {
            primary.studentsMap.set(k, st);
          }
        }

        mergedIndices.add(secondaryIdx);
        mergedCounts.set(primaryIdx, (mergedCounts.get(primaryIdx) || 0) + activeB.length);

        if (primaryIdx === j) {
          break; // i foi absorvido em j; segue para o próximo i
        }
      }
    }
  }

  // Etapa 3: Construção das turmas e desambiguação de nomes sugeridos
  const survivingSections = rawSections
    .map((sec, idx) => ({ sec, idx }))
    .filter(({ idx }) => !mergedIndices.has(idx));

  const draftTurmas = survivingSections.map(({ sec, idx }, orderIdx) => {
    const shift = mapSereShift(sec.header.turno);
    const isComplementary = isComplementarySereCourse(sec.header.curso, sec.header.seriacao);
    const segment = mapSereSegment(sec.header.curso, sec.header.seriacao, shift);
    const naming = sec.header.explicitName
      ? {
          baseName: sec.header.explicitName,
          turmaCode: "",
          canOmitSingleTurmaCode: false,
        }
      : buildBaseTurmaName({
          cursoRaw: sec.header.curso,
          seriacaoRaw: sec.header.seriacao,
          turmaRaw: sec.header.turma,
          shift,
          segment,
          isComplementary,
        });

    return {
      tempId: `sere-turma-${orderIdx + 1}`,
      sourceFile: sec.sourceFile,
      cursoRaw: sec.header.curso,
      seriacaoRaw: sec.header.seriacao,
      turnoRaw: sec.header.turno || shift,
      turmaRaw: sec.header.turma,
      baseName: naming.baseName,
      turmaCode: naming.turmaCode,
      canOmitSingleTurmaCode: naming.canOmitSingleTurmaCode,
      segment,
      shift,
      isComplementary,
      selectedByDefault: !isComplementary,
      mergedDualMatrixCount: mergedCounts.get(idx) || 0,
      students: Array.from(sec.studentsMap.values()),
    };
  });

  // Conta quantas turmas regulares compartilham o mesmo baseName (ex: duas turmas "1º ADM" ou duas "1º Série")
  const baseNameCounts = new Map<string, number>();
  for (const dt of draftTurmas) {
    if (!dt.isComplementary) {
      baseNameCounts.set(dt.baseName, (baseNameCounts.get(dt.baseName) || 0) + 1);
    }
  }

  const usedFinalNames = new Set<string>();
  const turmas: ParsedSereTurma[] = draftTurmas.map((dt) => {
    let suggestedName = dt.baseName;
    if ((baseNameCounts.get(dt.baseName) || 0) > 1 && dt.canOmitSingleTurmaCode) {
      suggestedName = `${dt.baseName} ${dt.turmaCode}`.trim();
    }

    if (usedFinalNames.has(suggestedName)) {
      const shiftTag = dt.shift === "NOITE" ? "Not" : dt.shift === "TARDE" ? "Vesp" : "Mat";
      suggestedName = `${suggestedName} (${shiftTag})`;
    }
    usedFinalNames.add(suggestedName);

    return {
      tempId: dt.tempId,
      sourceFile: dt.sourceFile,
      cursoRaw: dt.cursoRaw,
      seriacaoRaw: dt.seriacaoRaw,
      turnoRaw: dt.turnoRaw,
      turmaRaw: dt.turmaRaw,
      suggestedName,
      segment: dt.segment,
      shift: dt.shift,
      isComplementary: dt.isComplementary,
      selectedByDefault: dt.selectedByDefault,
      mergedDualMatrixCount: dt.mergedDualMatrixCount,
      students: dt.students,
    };
  });

  // Etapa 4: Coleta consolidada de alunos Transferidos/Desistentes (que não estejam ativos em outra turma)
  const activeKeysGlobal = new Set<string>();
  for (const t of turmas) {
    if (!t.selectedByDefault) continue;
    for (const s of t.students) {
      if (
        s.statusCategory === "ACTIVE" ||
        s.statusCategory === "CONCLUINTE" ||
        s.statusCategory === "SEM_FREQUENCIA"
      ) {
        activeKeysGlobal.add(s.cgm || normalizeStudentName(s.name));
      }
    }
  }

  const transferredMap = new Map<string, { cgm: string; name: string; situacaoRaw: string }>();
  for (const t of turmas) {
    for (const s of t.students) {
      if (s.statusCategory === "LEFT_SCHOOL") {
        const key = s.cgm || normalizeStudentName(s.name);
        if (!activeKeysGlobal.has(key)) {
          transferredMap.set(key, {
            cgm: s.cgm,
            name: s.name,
            situacaoRaw: s.situacaoRaw,
          });
        }
      }
    }
  }

  return {
    format: isTabularFallback && !detectedSchoolMeta ? "TABULAR_CSV" : "SERE_REPORT",
    schoolMetadata: detectedSchoolMeta,
    turmas,
    transferredOrLeft: Array.from(transferredMap.values()),
    warnings,
  };
}

/**
 * Fallback para planilhas tabulares simples (ex: exportadas do Excel por outras secretarias)
 * com cabeçalho contendo Nome, Turma e opcionalmente CGM, Telefone, Turno e Responsável.
 */
function parseTabularCsvFallback(
  rows: string[][],
  sourceFile: string
): Array<{
  sourceFile: string;
  header: RawTurmaHeader;
  studentsMap: Map<string, ParsedSereStudent>;
}> {
  let headerRowIdx = -1;
  let nameCol = -1;
  let turmaCol = -1;
  let phoneCol = -1;
  let cgmCol = -1;
  let guardianCol = -1;
  let shiftCol = -1;
  let situacaoCol = -1;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    let nIdx = -1;
    let tIdx = -1;

    for (let c = 0; c < row.length; c++) {
      const norm = row[c]
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim();

      if (norm === "NOME" || norm.includes("ALUNO") || norm.includes("ESTUDANTE")) nIdx = c;
      else if (norm === "TURMA" || norm === "SERIE" || norm === "CLASSE") tIdx = c;
      else if (norm.includes("TELEFONE") || norm.includes("WHATSAPP") || norm.includes("CELULAR") || norm === "FONE") phoneCol = c;
      else if (norm === "CGM" || norm === "MATRICULA" || norm === "RA") cgmCol = c;
      else if (norm.includes("RESPONSAVEL") || norm.includes("MAE") || norm.includes("PAI")) guardianCol = c;
      else if (norm === "TURNO" || norm === "PERIODO") shiftCol = c;
      else if (norm.startsWith("SITUACAO") || norm === "STATUS") situacaoCol = c;
    }

    if (nIdx !== -1 && tIdx !== -1) {
      headerRowIdx = r;
      nameCol = nIdx;
      turmaCol = tIdx;
      break;
    }
  }

  if (headerRowIdx === -1) return [];

  const groups = new Map<
    string,
    {
      sourceFile: string;
      header: RawTurmaHeader;
      studentsMap: Map<string, ParsedSereStudent>;
    }
  >();

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[nameCol] || "").replace(/\s+/g, " ").trim().toUpperCase();
    const turma = (row[turmaCol] || "").trim();
    if (!name || name.length < 3 || !turma) continue;

    const turno = shiftCol !== -1 ? (row[shiftCol] || "").trim() : "Manhã";
    const cgm = cgmCol !== -1 ? (row[cgmCol] || "").replace(/\D/g, "") : "";
    const phone = phoneCol !== -1 ? cleanSerePhone(row[phoneCol]) : "";
    const guardian = guardianCol !== -1 ? (row[guardianCol] || "").trim() : undefined;
    const situacaoRaw = situacaoCol !== -1 ? (row[situacaoCol] || "").trim() || "Matriculado" : "Matriculado";

    const groupKey = `${turma.toUpperCase()}__${turno.toUpperCase()}`;
    let grp = groups.get(groupKey);
    if (!grp) {
      const upperTurma = turma.toUpperCase();
      const isFund = /^[6789]\b|^[6789][ºªO°]/.test(upperTurma) || upperTurma.includes("FUND");
      grp = {
        sourceFile,
        header: {
          curso: isFund ? "ENS FUND" : "ENS MEDIO",
          seriacao: turma,
          turno,
          turma: "",
          explicitName: turma.replace(/\s+/g, " ").trim(),
        },
        studentsMap: new Map(),
      };
      groups.set(groupKey, grp);
    }

    const key = cgm || normalizeStudentName(name);
    grp.studentsMap.set(key, {
      cgm,
      name,
      phone,
      guardianName: guardian || undefined,
      situacaoRaw,
      statusCategory: classifySereSituacao(situacaoRaw),
      enrollmentTimestamp: 0,
    });
  }

  return Array.from(groups.values());
}

export interface TurmaSelectionConfig {
  tempId: string;
  selected: boolean;
  customName: string;
  segment: SchoolSegment;
  shift: SchoolShift;
  isComplementary?: boolean;
}

export interface ConsolidatedImportPreview {
  turmasToImport: Array<{
    tempId: string;
    name: string;
    segment: SchoolSegment;
    shift: SchoolShift;
  }>;
  studentsToImport: Array<{
    cgm: string;
    name: string;
    phone: string;
    guardianName?: string;
    turmaTempId: string;
    turmaName: string;
    situacaoRaw: string;
    statusCategory: SereStatusCategory;
  }>;
  transferredToDeactivate: Array<{
    cgm: string;
    name: string;
    situacaoRaw: string;
  }>;
  stats: {
    selectedTurmasCount: number;
    activeStudentsCount: number;
    missingPhoneCount: number;
    skippedInternalMoveCount: number;
    skippedLeftSchoolCount: number;
    mergedDualMatrixTotal: number;
  };
}

/**
 * Consolida e deduplica globalmente os alunos das turmas selecionadas pelo usuário,
 * resolvendo casos em que um estudante aparece em mais de um turno/arquivo (mantendo
 * turmas regulares acima de complementares e a matrícula mais recente).
 */
export function consolidateSelectedStudents(
  parsed: SereParseResult,
  configs: Record<string, TurmaSelectionConfig>,
  options: {
    includeSemFrequencia: boolean;
    includeConcluinte: boolean;
  }
): ConsolidatedImportPreview {
  const allowedCategories = new Set<SereStatusCategory>(["ACTIVE"]);
  if (options.includeSemFrequencia) allowedCategories.add("SEM_FREQUENCIA");
  if (options.includeConcluinte) allowedCategories.add("CONCLUINTE");

  const turmasToImport: ConsolidatedImportPreview["turmasToImport"] = [];
  const chosenByStudentKey = new Map<
    string,
    {
      cgm: string;
      name: string;
      phone: string;
      guardianName?: string;
      turmaTempId: string;
      turmaName: string;
      situacaoRaw: string;
      statusCategory: SereStatusCategory;
      isComplementary: boolean;
      enrollmentTimestamp: number;
    }
  >();

  let skippedInternalMoveCount = 0;
  let skippedLeftSchoolCount = 0;
  let mergedDualMatrixTotal = 0;

  for (const t of parsed.turmas) {
    mergedDualMatrixTotal += t.mergedDualMatrixCount;
    const cfg = configs[t.tempId] || {
      tempId: t.tempId,
      selected: t.selectedByDefault,
      customName: t.suggestedName,
      segment: t.segment,
      shift: t.shift,
      isComplementary: t.isComplementary,
    };

    if (!cfg.selected) continue;

    const cleanTurmaName = cfg.customName.trim() || t.suggestedName;
    turmasToImport.push({
      tempId: t.tempId,
      name: cleanTurmaName,
      segment: cfg.segment,
      shift: cfg.shift,
    });

    for (const s of t.students) {
      if (s.statusCategory === "MOVED_INTERNAL") {
        skippedInternalMoveCount++;
        continue;
      }
      if (s.statusCategory === "LEFT_SCHOOL") {
        skippedLeftSchoolCount++;
        continue;
      }
      if (!allowedCategories.has(s.statusCategory)) {
        continue;
      }

      const key = s.cgm || normalizeStudentName(s.name);
      const existing = chosenByStudentKey.get(key);

      if (!existing) {
        chosenByStudentKey.set(key, {
          cgm: s.cgm,
          name: s.name,
          phone: s.phone,
          guardianName: s.guardianName,
          turmaTempId: t.tempId,
          turmaName: cleanTurmaName,
          situacaoRaw: s.situacaoRaw,
          statusCategory: s.statusCategory,
          isComplementary: t.isComplementary,
          enrollmentTimestamp: s.enrollmentTimestamp,
        });
      } else {
        // Prioriza turma regular sobre complementar; em empate, matrícula mais recente
        const preferNew =
          (existing.isComplementary && !t.isComplementary) ||
          (existing.isComplementary === t.isComplementary &&
            s.enrollmentTimestamp > existing.enrollmentTimestamp);

        if (preferNew) {
          chosenByStudentKey.set(key, {
            cgm: s.cgm,
            name: s.name,
            phone: s.phone || existing.phone,
            guardianName: s.guardianName || existing.guardianName,
            turmaTempId: t.tempId,
            turmaName: cleanTurmaName,
            situacaoRaw: s.situacaoRaw,
            statusCategory: s.statusCategory,
            isComplementary: t.isComplementary,
            enrollmentTimestamp: s.enrollmentTimestamp,
          });
        } else if (!existing.phone && s.phone) {
          existing.phone = s.phone;
        }
      }
    }
  }

  const studentsToImport = Array.from(chosenByStudentKey.values()).map(
    ({ isComplementary: _ic, enrollmentTimestamp: _ts, ...rest }) => rest
  );

  const activeKeys = new Set(chosenByStudentKey.keys());
  const transferredToDeactivate = parsed.transferredOrLeft.filter(
    (item) => !activeKeys.has(item.cgm || normalizeStudentName(item.name))
  );

  const missingPhoneCount = studentsToImport.filter((s) => !s.phone).length;

  return {
    turmasToImport,
    studentsToImport,
    transferredToDeactivate,
    stats: {
      selectedTurmasCount: turmasToImport.length,
      activeStudentsCount: studentsToImport.length,
      missingPhoneCount,
      skippedInternalMoveCount,
      skippedLeftSchoolCount,
      mergedDualMatrixTotal,
    },
  };
}

