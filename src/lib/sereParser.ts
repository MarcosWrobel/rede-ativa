/**
 * Parser Universal de Arquivos do SERE (Sistema Estadual de Registro Escolar - SEED/PR)
 * Suporta diretamente:
 * 1. Planilhas Excel (.xls BIFF8, .xlsx XML, .html table do SERE) via SheetJS
 * 2. Relatórios em PDF (.pdf) exportados do SERE via 'unpdf' (WASM/JavaScript puro)
 * 3. Arquivos CSV/TXT (.csv, .txt) com autodetecção UTF-8 e Windows-1252
 * 
 * Executa deduplicação de dupla matriz técnica, filtragem de programas complementares
 * e mapeamento de turnos e séries automaticamente.
 */

import * as XLSX from "xlsx";
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

export interface RawFileInput {
  fileName: string;
  buffer: ArrayBuffer;
  textContent?: string;
}

/**
 * Decodifica texto tentando UTF-8 estrito primeiro e caindo para Windows-1252 (Latin-1).
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
 * Detecta o delimitador CSV fora de aspas.
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
 * Parser CSV compatível com RFC 4180.
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
 * Extrai grade tabular de linhas a partir de planilhas Excel (.xls, .xlsx) ou HTML do SERE.
 */
export function parseExcelBufferToRows(buffer: ArrayBuffer): string[][] {
  try {
    const wb = XLSX.read(buffer, { type: "array", cellDates: false });
    const allRows: string[][] = [];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const rawRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      }) as any[][];

      for (const r of rawRows) {
        if (!Array.isArray(r)) continue;
        allRows.push(
          r.map((c) => (c === null || c === undefined ? "" : String(c).trim()))
        );
      }
    }

    return allRows;
  } catch (err) {
    console.warn("[sereParser] Falha ao processar arquivo com XLSX:", err);
    return [];
  }
}

/**
 * Converte texto extraído de PDF em linhas tabulares equivalentes ao SERE.
 */
export function parsePdfTextToRows(pdfText: string): string[][] {
  const lines = pdfText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: string[][] = [];

  for (const line of lines) {
    // 1. Linha de cabeçalho de turma: "Curso: ... Seriação: ... Turno: ... Turma: ..."
    if (/Curso\s*:/i.test(line) && /Seria[cç][aã]o\s*:/i.test(line)) {
      const parts: string[] = ["", ""];
      const cMatch = line.match(/Curso\s*:\s*(.*?)(?=\s+Seria|$)/i);
      if (cMatch) parts.push(`Curso: ${cMatch[1].trim()}`);

      const sMatch = line.match(/Seria[cç][aã]o\s*:\s*(.*?)(?=\s+Turno|$)/i);
      if (sMatch) parts.push(`Seriação: ${sMatch[1].trim()}`);

      const tMatch = line.match(/Turno\s*:\s*(.*?)(?=\s+Turma|$)/i);
      if (tMatch) parts.push(`Turno: ${tMatch[1].trim()}`);

      const trMatch = line.match(/Turma\s*:\s*(.*?)(?=$)/i);
      if (trMatch) parts.push(`Turma: ${trMatch[1].trim()}`);

      rows.push(parts);
      continue;
    }

    // 2. Linha de cabeçalho da escola ou relatório
    if (/SECRETARIA DE ESTADO|GOVERNO DO ESTADO|RELA[CÇ][AÃ]O DE ALUNOS/i.test(line)) {
      rows.push([line]);
      continue;
    }

    // 3. Linha de dados do estudante
    const studentRegex =
      /^\s*(?:\d{1,3}\s+)?(\d{7,11})\s+([A-ZÀ-Ú\s]+?)\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{1,2}))?(?:\s+([MF]))?\s+(.*)$/i;
    const sm = line.match(studentRegex);
    if (sm) {
      const [, cgm, name, birthDate, age, sex, remainder] = sm;

      // Telefone com DDD entre parênteses
      let phone = "";
      const phoneMatch = remainder.match(/\(\d{2}\)\s*\d{4,5}[-\s]?\d{4}/);
      if (phoneMatch) {
        phone = phoneMatch[0];
      }

      // Situação de matrícula
      let situacao = "Matriculado";
      const sitMatch = remainder.match(
        /\b(Matriculad\w*|Concluint\w*|Reclassificad\w*|Remanejad\w*|Transferid\w*|Desistent\w*|Abandon\w*|Cancelad\w*|Sem(?:\s+Frequ[eê]ncia)?)\b/i
      );
      if (sitMatch) {
        situacao = sitMatch[0].trim();
      }

      // Data de Matrícula (última data DD/MM/YYYY na linha)
      let enrollmentDate = "";
      const dateMatches = [...remainder.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)];
      if (dateMatches.length > 0) {
        enrollmentDate = dateMatches[dateMatches.length - 1][1];
      }

      // Mapeia nas colunas padrão SERE:
      // [ '', '', N, CGM, Nome, DataNasc, '', Idade, Sexo, Telefone, RG, '', CPF, '', '', Situação, '', DataMatricula ]
      const rowArr: string[] = new Array(18).fill("");
      rowArr[3] = cgm;
      rowArr[4] = name.trim();
      rowArr[5] = birthDate;
      rowArr[7] = age || "";
      rowArr[8] = sex || "";
      rowArr[9] = phone;
      rowArr[15] = situacao;
      rowArr[17] = enrollmentDate;
      rows.push(rowArr);
      continue;
    }

    rows.push([line]);
  }

  return rows;
}

/**
 * Converte um buffer de arquivo em linhas de texto ou matriz tabular,
 * suportando PDF, Excel (.xls/.xlsx), HTML e CSV.
 */
export async function extractRowsFromFile(file: RawFileInput): Promise<string[][]> {
  const fileNameLower = file.fileName.toLowerCase();
  const bytes = new Uint8Array(file.buffer);

  // 1. Detecção de PDF (pela extensão ou magic bytes %PDF-)
  const isPdf =
    fileNameLower.endsWith(".pdf") ||
    (bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d);

  if (isPdf) {
    try {
      const { extractText } = await import("unpdf");
      const res = await extractText(bytes);
      const fullText = Array.isArray(res.text) ? res.text.join("\n") : String(res.text || "");
      return parsePdfTextToRows(fullText);
    } catch (err) {
      console.warn("[sereParser] Falha ao extrair texto do PDF:", err);
    }
  }

  // 2. Detecção de Excel (.xls BIFF8, .xlsx PK-zip)
  const isXls =
    fileNameLower.endsWith(".xls") ||
    fileNameLower.endsWith(".xlsx") ||
    (bytes.length >= 8 &&
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0) ||
    (bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04);

  if (isXls) {
    const excelRows = parseExcelBufferToRows(file.buffer);
    if (excelRows.length > 0) return excelRows;
  }

  // 3. Fallback: Texto / CSV / HTML
  const text = file.textContent || decodeCsvBuffer(file.buffer);

  // Se o conteúdo começar com tags HTML (comum em arquivos .xls gerados como tabela HTML no SERE)
  if (/<table|<html|<body/i.test(text)) {
    const htmlRows = parseExcelBufferToRows(file.buffer);
    if (htmlRows.length > 0) return htmlRows;
  }

  return parseCsvRows(text);
}

/**
 * Higieniza o telefone para dígitos com DDD.
 */
export function cleanSerePhone(raw?: string | null): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return "";

  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }

  if (digits.length < 8) return "";
  return digits;
}

/**
 * Converte data DD/MM/YYYY em timestamp numérico.
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
 * Converte nome invertido do SERE em nome legível institucional.
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
 * Identifica se é um Programa Complementar / Contraturno.
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
  return "MANHA";
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

  if (techAbbr && gradeNum) {
    const suffixShift = shift === "NOITE" ? " Not" : "";
    return {
      baseName: `${gradeNum}º ${techAbbr}${suffixShift}`,
      turmaCode,
      canOmitSingleTurmaCode: true,
    };
  }

  if (segment === "FUNDAMENTAL" && gradeNum) {
    return {
      baseName: `${gradeNum}º ${turmaCode}`,
      turmaCode,
      canOmitSingleTurmaCode: false,
    };
  }

  if (shift === "NOITE" && gradeNum) {
    return {
      baseName: `${gradeNum}º Série`,
      turmaCode,
      canOmitSingleTurmaCode: true,
    };
  }

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
 * Processa linhas tabulares (extraídas de XLS, XLSX, PDF, HTML ou CSV) e retorna
 * turmas estruturadas e deduplicadas.
 */
export function parseSereRows(
  fileSections: Array<{ fileName: string; rows: string[][] }>
): SereParseResult {
  const rawSections: Array<{
    sourceFile: string;
    header: RawTurmaHeader;
    studentsMap: Map<string, ParsedSereStudent>;
  }> = [];

  let detectedSchoolMeta: SereSchoolMetadata | null = null;
  const warnings: string[] = [];
  let isTabularFallback = false;

  for (const { fileName, rows } of fileSections) {
    if (rows.length === 0) continue;

    const meta = extractSchoolMetadata(rows);
    if (meta && !detectedSchoolMeta) {
      detectedSchoolMeta = meta;
    }

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
              sourceFile: fileName,
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

        const joined = row.join("").trim();
        if (!joined || /P[aá]gina\s+\d+\s+de/i.test(row.join(" "))) continue;

        const rawCgm = (row[colMap.cgmIdx] || "").replace(/\D/g, "");
        const rawName = (row[colMap.nameIdx] || "").replace(/\s+/g, " ").trim().toUpperCase();

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
      const parsedTabular = parseTabularCsvFallback(rows, fileName);
      if (parsedTabular.length > 0) {
        isTabularFallback = true;
        rawSections.push(...parsedTabular);
      } else {
        warnings.push(
          `Não foi possível identificar cabeçalhos do SERE ou colunas de alunos no arquivo "${fileName}".`
        );
      }
    }
  }

  // Deduplicação de Dupla Matrícula Técnica (ex: NEM EPT + Ensino Médio Profissional)
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
          break;
        }
      }
    }
  }

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
 * Função unificada assíncrona: recebe arquivos brutos (.xls, .xlsx, .pdf, .csv)
 * e devolve o resultado estruturado.
 */
export async function parseSereRawFiles(files: RawFileInput[]): Promise<SereParseResult> {
  const sections: Array<{ fileName: string; rows: string[][] }> = [];

  for (const file of files) {
    const rows = await extractRowsFromFile(file);
    sections.push({ fileName: file.fileName, rows });
  }

  return parseSereRows(sections);
}

/**
 * Função síncrona mantida para compatibilidade com CSV já decodificado.
 */
export function parseSereFiles(
  files: Array<{ fileName: string; content: string }>
): SereParseResult {
  const sections = files.map((f) => ({
    fileName: f.fileName,
    rows: parseCsvRows(f.content),
  }));
  return parseSereRows(sections);
}

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
 * Consolida e deduplica globalmente os alunos das turmas selecionadas pelo usuário.
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
