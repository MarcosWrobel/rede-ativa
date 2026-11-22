import { extractTextItems, type StructuredTextItem } from "unpdf";
import { normalizeStudentName } from "@/lib/studentMatcher";

export const SERE_COUNCIL_PDF_MAX_FILES = 5;
export const SERE_COUNCIL_PDF_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export type SereCouncilTrimesterKey = 1 | 2 | 3;

export interface ParsedSereCouncilMetadata {
  fileName: string;
  schoolName: string | null;
  year: number | null;
  reportDate: string | null;
  course: string | null;
  grade: string | null;
  shift: string | null;
  classCode: string | null;
  pageCount: number;
}

export interface ParsedSereCouncilSubject {
  rawHeader: string;
  name: string;
  matchKey: string;
  sourceFiles: string[];
}

export interface ParsedSereCouncilGradeEntry {
  subjectMatchKey: string;
  subjectName: string;
  trimester: SereCouncilTrimesterKey;
  grade: number;
}

export interface ParsedSereCouncilStudentRow {
  rowNumber: number | null;
  rawName: string;
  normalizedName: string;
  grades: ParsedSereCouncilGradeEntry[];
  hasAnyGrade: boolean;
  isAmbiguousInPdf?: boolean;
}

export interface ParsedSereCouncilPdfReport {
  metadata: ParsedSereCouncilMetadata;
  subjects: ParsedSereCouncilSubject[];
  students: ParsedSereCouncilStudentRow[];
  warnings: string[];
}

export interface MergedSereCouncilPdfBatch {
  files: ParsedSereCouncilMetadata[];
  subjects: ParsedSereCouncilSubject[];
  students: ParsedSereCouncilStudentRow[];
  totalGrades: number;
  belowAverageGrades: number;
  warnings: string[];
}

/**
 * Dicionário de cabeçalhos truncados (~12 caracteres) gerados pelo relatório
 * "RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL" do SERE / Sistema Escola (SEED-PR).
 */
const SERE_TRUNCATED_DISCIPLINE_MAP: Record<string, string> = {
  "ADM FINANC E": "Adm. Financeira e Orçamentária",
  "ADMINISTRACA": "Administração",
  "ARTE": "Arte",
  "ARTE I": "Arte I",
  "ARTE II": "Arte II",
  "ARTE PARANAE": "Arte Paranaense",
  "BIOLOGIA": "Biologia",
  "BIOLOGIA I": "Biologia I",
  "BIOLOGIA II": "Biologia II",
  "BIOLOGIA SUS": "Biologia: Sustentabilidade em Ação",
  "CIENCIAS": "Ciências",
  "COMUNICACAO": "Comunicação e Vendas",
  "CONTROLADORI": "Controladoria e Finanças",
  "ED DIG COMP": "Ed. Digital, Programação e IA",
  "EDUCACAO DIG": "Educação Digital",
  "EDUCACAO FIN": "Educação Financeira",
  "EDUCACAO FIS": "Educação Física",
  "ENSINO RELIG": "Ensino Religioso",
  "ESTRATEGIAS": "Estratégias de Marketing",
  "FILOSOFIA": "Filosofia",
  "FILOSOFIA AN": "Filosofia: Análise de Textos",
  "FILOSOFIA I": "Filosofia I",
  "FILOSOFIA II": "Filosofia II",
  "FINANCAS EMP": "Finanças Empresariais",
  "FISICA": "Física",
  "FISICA E TEC": "Física e Tecnociência",
  "FISICA I": "Física I",
  "FISICA II": "Física II",
  "FISICA III": "Física III",
  "GEOGRAFIA": "Geografia",
  "GEOGRAFIA DO": "Geografia do Paraná",
  "GEOGRAFIA I": "Geografia I",
  "GEOGRAFIA II": "Geografia II",
  "HISTORIA": "História",
  "HISTORIA I": "História I",
  "HISTORIA II": "História II",
  "LINGUA ESPAN": "Língua Espanhola",
  "LINGUA INGLE": "Língua Inglesa",
  "LINGUA PORTU": "Língua Portuguesa",
  "LITERATURA": "Literatura",
  "MATEMATICA": "Matemática",
  "MATEMATICA I": "Matemática I",
  "MATEMATICA II": "Matemática II",
  "ORATORIA": "Oratória",
  "PENSAMENTO C": "Pensamento Computacional",
  "PRODUCAO DE": "Produção de Texto",
  "PROJETO DE V": "Projeto de Vida",
  "QUIMICA": "Química",
  "QUIMICA I": "Química I",
  "QUIMICA II": "Química II",
  "REC APREND L": "Recomposição da Aprendizagem - Língua Portuguesa",
  "REC APREND M": "Recomposição da Aprendizagem - Matemática",
  "REDACAO E LE": "Redação e Leitura",
  "ROBOTICA": "Robótica",
  "SOCIOLOGIA": "Sociologia",
  "SOCIOLOGIA I": "Sociologia I",
  "SOCIOLOGIA II": "Sociologia II",
};

const LOWERCASE_WORDS = new Set(["e", "de", "da", "do", "das", "dos", "em", "para", "no", "na"]);
const UPPERCASE_WORDS = new Set(["I", "II", "III", "IV", "V", "IA", "TI", "RH", "EAD", "EF", "EM"]);

export function toCouncilSubjectMatchKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.:,;()\/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSmartPtBrTitleCase(raw: string): string {
  const cleaned = raw.replace(/\./g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word, idx) => {
      const upper = word.toUpperCase();
      if (UPPERCASE_WORDS.has(upper)) return upper;
      const lower = word.toLowerCase();
      if (idx > 0 && LOWERCASE_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function extractTrailingRomanNumeral(key: string): string | null {
  const match = key.match(/\s+(I|II|III|IV|V)$/);
  return match ? match[1] : null;
}

const SORTED_SERE_DISCIPLINE_ENTRIES = Object.entries(SERE_TRUNCATED_DISCIPLINE_MAP).sort(
  (a, b) => b[0].length - a[0].length
);

/**
 * Converte cabeçalhos truncados do SERE (ex.: "EDUCACAO FIS", "LINGUA PORTU", "PROJETO DE V")
 * em nomes padronizados em português e gera `matchKey` estável para deduplicação.
 */
export function normalizeSereTruncatedDisciplineName(raw: string): {
  name: string;
  matchKey: string;
} {
  const cleaned = raw.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return { name: "", matchKey: "" };
  }

  const asciiKey = toCouncilSubjectMatchKey(cleaned);
  const direct = SERE_TRUNCATED_DISCIPLINE_MAP[asciiKey];
  if (direct) {
    return { name: direct, matchKey: toCouncilSubjectMatchKey(direct) };
  }

  const asciiRoman = extractTrailingRomanNumeral(asciiKey);
  if (asciiRoman) {
    const baseAscii = asciiKey.slice(0, -(asciiRoman.length + 1)).trim();
    const baseDirect = SERE_TRUNCATED_DISCIPLINE_MAP[baseAscii];
    if (baseDirect) {
      const displayName = `${baseDirect} ${asciiRoman}`;
      return { name: displayName, matchKey: toCouncilSubjectMatchKey(displayName) };
    }
    if (baseAscii.length >= 10) {
      for (const [dictKey, displayName] of SORTED_SERE_DISCIPLINE_ENTRIES) {
        if (extractTrailingRomanNumeral(dictKey)) continue;
        if (
          dictKey.length >= 10 &&
          ((baseAscii.startsWith(dictKey) && baseAscii[dictKey.length] !== " ") ||
            (dictKey.startsWith(baseAscii) && dictKey[baseAscii.length] !== " "))
        ) {
          const withRoman = `${displayName} ${asciiRoman}`;
          return { name: withRoman, matchKey: toCouncilSubjectMatchKey(withRoman) };
        }
      }
    }
  }

  // Fallback por prefixo seguro >= 10 chars (sem colisão entre palavras/numerais romanos distintos)
  if (asciiKey.length >= 10) {
    for (const [dictKey, displayName] of SORTED_SERE_DISCIPLINE_ENTRIES) {
      if (extractTrailingRomanNumeral(dictKey) !== asciiRoman) continue;
      if (dictKey.length < 10) continue;
      const matchesPrefix =
        asciiKey.startsWith(dictKey) &&
        asciiKey.length > dictKey.length &&
        asciiKey[dictKey.length] !== " ";
      const matchesTruncated =
        dictKey.startsWith(asciiKey) &&
        dictKey.length > asciiKey.length &&
        dictKey[asciiKey.length] !== " ";
      if (matchesPrefix || matchesTruncated) {
        return { name: displayName, matchKey: toCouncilSubjectMatchKey(displayName) };
      }
    }
  }

  const displayName = toSmartPtBrTitleCase(cleaned);
  return {
    name: displayName,
    matchKey: toCouncilSubjectMatchKey(displayName),
  };
}

/**
 * Valida magic bytes `%PDF-` no cabeçalho binário do arquivo.
 */
export function isValidPdfBuffer(buffer: Uint8Array): boolean {
  if (!buffer || buffer.byteLength < 5) return false;
  return (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 && // F
    buffer[4] === 0x2d // -
  );
}

function parseSereGradeToken(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "--" || trimmed === "-" || trimmed === "—") {
    return null;
  }
  const normalized = trimmed.replace(",", ".");
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  centerX: number;
}

interface TrimesterColumnDef {
  subjectIndex: number;
  trimester: SereCouncilTrimesterKey;
  centerX: number;
}

function toPositionedItems(rawItems: StructuredTextItem[]): PositionedItem[] {
  const result: PositionedItem[] = [];
  for (const item of rawItems) {
    const str = (item.str || "").replace(/\u0000/g, "").trim();
    if (!str) continue;
    const width = Number.isFinite(item.width) && item.width > 0 ? item.width : str.length * 4;
    result.push({
      str,
      x: item.x,
      y: item.y,
      width,
      centerX: item.x + width / 2,
    });
  }
  return result;
}

function groupByY(items: PositionedItem[], tolerance = 2.0): Array<{ y: number; items: PositionedItem[] }> {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Array<{ y: number; items: PositionedItem[] }> = [];

  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
  }
  return rows;
}

function extractMetadataFromPageItems(
  items: PositionedItem[],
  fileName: string,
  pageCount: number
): ParsedSereCouncilMetadata {
  const rows = groupByY(items, 2.5);
  let schoolName: string | null = null;
  let year: number | null = null;
  let reportDate: string | null = null;
  let course: string | null = null;
  let grade: string | null = null;
  let shift: string | null = null;
  let classCode: string | null = null;

  for (const row of rows) {
    const lineText = row.items.map((i) => i.str).join(" ");

    if (!reportDate) {
      const dateMatch = lineText.match(/DATA:\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (dateMatch) reportDate = dateMatch[1];
    }

    if (!year) {
      const yearItem = row.items.find((i) => /^20\d{2}$/.test(i.str));
      if (yearItem) {
        year = Number.parseInt(yearItem.str, 10);
        // Na mesma linha do ano costuma aparecer o nome da escola à esquerda
        const leftSchool = row.items.find(
          (i) => i !== yearItem && i.x < 300 && i.str.length >= 6 && !/^DATA:/i.test(i.str)
        );
        if (leftSchool && !schoolName) {
          schoolName = leftSchool.str;
        }
      }
    }

    for (const item of row.items) {
      if (!course && /^Curso:/i.test(item.str)) {
        course = item.str.replace(/^Curso:\s*/i, "").trim() || null;
      } else if (!grade && /^Seria[çc][ãa]o:/i.test(item.str)) {
        grade = item.str.replace(/^Seria[çc][ãa]o:\s*/i, "").trim() || null;
      } else if (!shift && /^Turno:/i.test(item.str)) {
        shift = item.str.replace(/^Turno:\s*/i, "").trim() || null;
      } else if (!classCode && /^Turma:/i.test(item.str)) {
        classCode = item.str.replace(/^Turma:\s*/i, "").trim() || null;
      }
    }

    // Fallback se Curso/Seriação/Turno/Turma estiverem unidos num único item
    if (!course && /Curso:/i.test(lineText)) {
      const m = lineText.match(
        /Curso:\s*(.+?)\s+Seria[çc][ãa]o:\s*(.+?)\s+Turno:\s*(.+?)\s+Turma:\s*(\S+)/i
      );
      if (m) {
        course = m[1].trim();
        grade = m[2].trim();
        shift = m[3].trim();
        classCode = m[4].trim();
      }
    }
  }

  return {
    fileName,
    schoolName,
    year,
    reportDate,
    course,
    grade,
    shift,
    classCode,
    pageCount,
  };
}

interface PageParseResult {
  subjects: Array<{ rawHeader: string; name: string; matchKey: string }>;
  students: Array<{
    rowNumber: number;
    rawName: string;
    normalizedName: string;
    grades: ParsedSereCouncilGradeEntry[];
  }>;
  hasReportTitle: boolean;
}

function parseSinglePageItems(rawItems: StructuredTextItem[]): PageParseResult {
  const items = toPositionedItems(rawItems);
  const hasReportTitle = items.some((i) =>
    /RELAT[ÓO]RIO\s+DE\s+ACOMPANHAMENTO\s+TRIMESTRAL/i.test(i.str)
  );

  // 1. Localiza a linha dos subcabeçalhos T1, T2, T3
  const tItems = items.filter((i) => /^T[123]$/i.test(i.str));
  if (tItems.length < 3) {
    return { subjects: [], students: [], hasReportTitle };
  }

  // Agrupa T1/T2/T3 pela linha Y mais populosa (normalmente há apenas uma por página)
  const tRows = groupByY(tItems, 2.5);
  tRows.sort((a, b) => b.items.length - a.items.length);
  const trimesterHeaderRow = tRows[0];
  const trimesterRowY = trimesterHeaderRow.y;

  // Ordena T1/T2/T3 da esquerda para a direita e agrupa em trios (T1, T2, T3) por disciplina
  const sortedT = [...trimesterHeaderRow.items].sort((a, b) => a.x - b.x);
  const triplets: Array<{
    t1: PositionedItem;
    t2: PositionedItem;
    t3: PositionedItem;
    minX: number;
    maxX: number;
    centerX: number;
  }> = [];

  for (let i = 0; i + 2 < sortedT.length; ) {
    const a = sortedT[i];
    const b = sortedT[i + 1];
    const c = sortedT[i + 2];
    if (
      a.str.toUpperCase() === "T1" &&
      b.str.toUpperCase() === "T2" &&
      c.str.toUpperCase() === "T3"
    ) {
      triplets.push({
        t1: a,
        t2: b,
        t3: c,
        minX: a.x,
        maxX: c.x + c.width,
        centerX: (a.centerX + c.centerX) / 2,
      });
      i += 3;
    } else {
      i += 1;
    }
  }

  if (triplets.length === 0) {
    return { subjects: [], students: [], hasReportTitle };
  }

  // 2. Localiza as colunas "Nro." e "Nome"
  const nroHeader = items.find(
    (i) => /^Nro\.?$/i.test(i.str) && Math.abs(i.y - trimesterRowY) <= 22
  );
  const nomeHeader = items.find(
    (i) => /^Nome$/i.test(i.str) && Math.abs(i.y - trimesterRowY) <= 22
  );
  const firstGradeX = triplets[0].t1.x;
  const nomeColX = nomeHeader ? nomeHeader.x : nroHeader ? nroHeader.x + 15 : 46;
  const nroColMaxX = nomeColX - 4;
  const gradeZoneMinX = firstGradeX - 10;

  // 3. Localiza cabeçalhos das disciplinas (acima da linha T1/T2/T3, à direita da coluna Nome)
  const disciplinasLabel = items.find(
    (i) => /^Disciplinas$/i.test(i.str) && i.y > trimesterRowY && i.y <= trimesterRowY + 45
  );
  const subjectBandMaxY = disciplinasLabel ? disciplinasLabel.y - 3 : trimesterRowY + 26;
  const subjectBandMinY = trimesterRowY + 3;

  const subjectCandidates = items
    .filter(
      (i) =>
        i.y >= subjectBandMinY &&
        i.y <= subjectBandMaxY &&
        i.x >= gradeZoneMinX - 8 &&
        !/^Disciplinas$/i.test(i.str) &&
        !/^T[123]$/i.test(i.str)
    )
    .sort((a, b) => a.x - b.x);

  // Emparelha cada trio (T1, T2, T3) ao cabeçalho de disciplina correspondente
  const subjects: Array<{ rawHeader: string; name: string; matchKey: string }> = [];
  if (subjectCandidates.length === triplets.length) {
    for (let idx = 0; idx < triplets.length; idx++) {
      const rawHeader = subjectCandidates[idx].str;
      const normalized = normalizeSereTruncatedDisciplineName(rawHeader);
      subjects.push({
        rawHeader,
        name: normalized.name || rawHeader,
        matchKey: normalized.matchKey || toCouncilSubjectMatchKey(rawHeader),
      });
    }
  } else {
    // Fallback por proximidade horizontal (caso um título de disciplina quebre em 2 itens)
    const stepBetweenSubjects =
      triplets.length >= 2 ? triplets[1].t1.centerX - triplets[0].t1.centerX : 74;
    for (let idx = 0; idx < triplets.length; idx++) {
      const triplet = triplets[idx];
      const leftBound = triplet.t1.x - 10;
      const rightBound =
        idx + 1 < triplets.length
          ? triplets[idx + 1].t1.x - 10
          : triplet.t1.x + stepBetweenSubjects;
      const matched = subjectCandidates
        .filter((c) => c.centerX >= leftBound && c.centerX <= rightBound)
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const rawHeader = matched.map((m) => m.str).join(" ").trim() || `DISCIPLINA ${idx + 1}`;
      const normalized = normalizeSereTruncatedDisciplineName(rawHeader);
      subjects.push({
        rawHeader,
        name: normalized.name || rawHeader,
        matchKey: normalized.matchKey || toCouncilSubjectMatchKey(rawHeader),
      });
    }
  }

  // Mapa plano de colunas T1/T2/T3 com tolerância horizontal (rejeita automaticamente a 4ª coluna "--")
  const trimesterCols: TrimesterColumnDef[] = [];
  for (let sIdx = 0; sIdx < triplets.length; sIdx++) {
    trimesterCols.push({ subjectIndex: sIdx, trimester: 1, centerX: triplets[sIdx].t1.centerX });
    trimesterCols.push({ subjectIndex: sIdx, trimester: 2, centerX: triplets[sIdx].t2.centerX });
    trimesterCols.push({ subjectIndex: sIdx, trimester: 3, centerX: triplets[sIdx].t3.centerX });
  }

  // Calcula espaçamento típico entre T1 e T2 para definir tolerância segura
  const tSpacing = Math.abs(triplets[0].t2.centerX - triplets[0].t1.centerX);
  const colMatchTolerance = Math.max(6.5, Math.min(10.5, tSpacing * 0.48));

  // 4. Localiza rodapé "Total de registros abaixo da Média" (se presente nesta página)
  const footerItem = items.find(
    (i) => /Total\s+de\s+registros\s+abaixo/i.test(i.str) && i.y < trimesterRowY
  );
  const bodyMinY = footerItem ? footerItem.y + 4 : -Infinity;
  const bodyMaxY = trimesterRowY - 3;

  // 5. Encontra âncoras de linha de estudante (números sequenciais na coluna Nro.)
  const rowAnchors = items
    .filter(
      (i) =>
        i.y < bodyMaxY &&
        i.y > bodyMinY &&
        i.x <= nroColMaxX &&
        /^\d{1,3}$/.test(i.str)
    )
    .sort((a, b) => b.y - a.y);

  if (rowAnchors.length === 0) {
    return { subjects, students: [], hasReportTitle };
  }

  // Estima altura média de linha para delimitar a última linha
  let avgRowGap = 16;
  if (rowAnchors.length >= 2) {
    const gaps: number[] = [];
    for (let i = 0; i + 1 < rowAnchors.length; i++) {
      const gap = rowAnchors[i].y - rowAnchors[i + 1].y;
      if (gap > 6 && gap < 35) gaps.push(gap);
    }
    if (gaps.length > 0) {
      avgRowGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    }
  }

  // 6. Para cada âncora, agrupa nome (1 ou mais linhas) e notas T1/T2/T3
  const bodyItems = items.filter((i) => i.y < bodyMaxY && i.y > bodyMinY);
  const students: PageParseResult["students"] = [];

  for (let i = 0; i < rowAnchors.length; i++) {
    const anchor = rowAnchors[i];
    const rowNumber = Number.parseInt(anchor.str, 10);

    const upperBound =
      i === 0
        ? Math.min(bodyMaxY, anchor.y + avgRowGap * 0.65)
        : (rowAnchors[i - 1].y + anchor.y) / 2;
    const lowerBound =
      i + 1 < rowAnchors.length
        ? (anchor.y + rowAnchors[i + 1].y) / 2
        : Math.max(bodyMinY, anchor.y - avgRowGap * 0.65);

    const bandItems = bodyItems.filter((it) => it.y <= upperBound && it.y > lowerBound);

    // Nome do estudante (pode ocupar 1, 2 ou 3 linhas dentro da faixa vertical)
    const nameItems = bandItems
      .filter((it) => it.x >= nomeColX - 3 && it.x < gradeZoneMinX)
      .sort((a, b) => {
        if (Math.abs(a.y - b.y) > 1.8) return b.y - a.y;
        return a.x - b.x;
      });
    const rawName = nameItems
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!rawName || /Total\s+de\s+registros/i.test(rawName)) {
      continue;
    }

    const normalizedName = normalizeStudentName(rawName);
    if (!normalizedName) continue;

    // Notas nas colunas T1/T2/T3
    const gradeItems = bandItems.filter(
      (it) => it.x >= gradeZoneMinX && Math.abs(it.y - anchor.y) <= Math.max(6, avgRowGap * 0.45)
    );
    const grades: ParsedSereCouncilGradeEntry[] = [];
    const seenCols = new Set<string>();

    for (const gItem of gradeItems) {
      const parsedGrade = parseSereGradeToken(gItem.str);
      if (parsedGrade === null) continue;

      let bestCol: TrimesterColumnDef | null = null;
      let bestDist = Infinity;
      for (const col of trimesterCols) {
        const dist = Math.abs(gItem.centerX - col.centerX);
        if (dist <= colMatchTolerance && dist < bestDist) {
          bestDist = dist;
          bestCol = col;
        }
      }

      if (!bestCol) continue;
      const subject = subjects[bestCol.subjectIndex];
      if (!subject) continue;

      const cellKey = `${subject.matchKey}|${bestCol.trimester}`;
      if (seenCols.has(cellKey)) continue;
      seenCols.add(cellKey);

      grades.push({
        subjectMatchKey: subject.matchKey,
        subjectName: subject.name,
        trimester: bestCol.trimester,
        grade: parsedGrade,
      });
    }

    students.push({
      rowNumber,
      rawName,
      normalizedName,
      grades,
    });
  }

  return { subjects, students, hasReportTitle };
}

/**
 * Parser principal de PDF binário do SERE ("RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL")
 * usando extração posicional X/Y via `unpdf`.
 */
export async function parseSereCouncilPdfBuffer(
  buffer: Uint8Array,
  fileName: string
): Promise<ParsedSereCouncilPdfReport> {
  if (!isValidPdfBuffer(buffer)) {
    throw new Error(`O arquivo "${fileName}" não é um PDF válido.`);
  }
  if (buffer.byteLength > SERE_COUNCIL_PDF_MAX_FILE_BYTES) {
    throw new Error(`O arquivo "${fileName}" excede o limite de 10 MB.`);
  }

  const { totalPages, items: pagesItems } = await extractTextItems(buffer);
  if (!pagesItems || pagesItems.length === 0) {
    throw new Error(`O arquivo "${fileName}" não possui texto legível.`);
  }

  const firstPageItems = toPositionedItems(pagesItems[0] || []);
  const metadata = extractMetadataFromPageItems(firstPageItems, fileName, totalPages);

  const subjectMap = new Map<string, ParsedSereCouncilSubject>();
  const studentMap = new Map<string, ParsedSereCouncilStudentRow>();
  const ambiguousNames = new Set<string>();
  const warnings: string[] = [];
  let sawReportTitle = false;

  for (let p = 0; p < pagesItems.length; p++) {
    const pageResult = parseSinglePageItems(pagesItems[p] || []);
    if (pageResult.hasReportTitle) sawReportTitle = true;

    for (const subj of pageResult.subjects) {
      if (!subjectMap.has(subj.matchKey)) {
        subjectMap.set(subj.matchKey, {
          rawHeader: subj.rawHeader,
          name: subj.name,
          matchKey: subj.matchKey,
          sourceFiles: [fileName],
        });
      }
    }

    const seenOnPage = new Set<string>();
    for (const stu of pageResult.students) {
      if (seenOnPage.has(stu.normalizedName)) {
        ambiguousNames.add(stu.normalizedName);
      }
      seenOnPage.add(stu.normalizedName);

      const existing = studentMap.get(stu.normalizedName);
      if (!existing) {
        studentMap.set(stu.normalizedName, {
          rowNumber: stu.rowNumber,
          rawName: stu.rawName,
          normalizedName: stu.normalizedName,
          grades: ambiguousNames.has(stu.normalizedName) ? [] : [...stu.grades],
          hasAnyGrade: ambiguousNames.has(stu.normalizedName) ? false : stu.grades.length > 0,
        });
      } else {
        // Números de chamada distintos com o mesmo nome dentro do mesmo PDF indicam homônimos
        if (
          existing.rowNumber !== null &&
          stu.rowNumber !== null &&
          existing.rowNumber !== stu.rowNumber
        ) {
          ambiguousNames.add(stu.normalizedName);
          continue;
        }
        if (ambiguousNames.has(stu.normalizedName)) {
          continue;
        }
        // Mescla notas caso o estudante apareça em múltiplas páginas (ex.: quebra horizontal de disciplinas)
        const existingKeys = new Set(
          existing.grades.map((g) => `${g.subjectMatchKey}|${g.trimester}`)
        );
        for (const g of stu.grades) {
          const key = `${g.subjectMatchKey}|${g.trimester}`;
          if (!existingKeys.has(key)) {
            existing.grades.push(g);
            existingKeys.add(key);
          }
        }
        existing.hasAnyGrade = existing.grades.length > 0;
      }
    }
  }

  for (const normName of ambiguousNames) {
    const row = studentMap.get(normName);
    if (row) {
      row.isAmbiguousInPdf = true;
      row.grades = [];
      row.hasAnyGrade = false;
      warnings.push(
        `${fileName}: nome duplicado no PDF ("${row.rawName}") tratado como homônimo e ignorado para evitar mistura de notas.`
      );
    }
  }

  if (subjectMap.size === 0 || studentMap.size === 0) {
    throw new Error(
      sawReportTitle
        ? `Não foram encontradas disciplinas ou notas válidas em "${fileName}".`
        : `O arquivo "${fileName}" não corresponde ao Relatório de Acompanhamento Trimestral do SERE.`
    );
  }

  const studentsWithoutGrades = Array.from(studentMap.values()).filter(
    (s) => !s.hasAnyGrade && !s.isAmbiguousInPdf
  ).length;
  if (studentsWithoutGrades > 0) {
    warnings.push(
      `${fileName}: ${studentsWithoutGrades} estudante(s) sem notas lançadas (apenas "--", possivelmente transferidos).`
    );
  }

  return {
    metadata,
    subjects: Array.from(subjectMap.values()),
    students: Array.from(studentMap.values()),
    warnings,
  };
}

/**
 * Fallback textual puro para o Relatório de Acompanhamento Trimestral do SERE
 * (útil para testes unitários determinísticos e validação sem coordenadas).
 */
export function parseSereCouncilPdfText(
  pagesText: string[],
  fileName: string
): ParsedSereCouncilPdfReport {
  const fullText = pagesText.join("\n");
  const rawLines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lines = rawLines.map((l) => l.replace(/\s+/g, " "));

  const courseMatch = fullText.match(/Curso:\s*(.+?)\s+Seria[çc][ãa]o:/i);
  const gradeMatch = fullText.match(/Seria[çc][ãa]o:\s*(.+?)\s+Turno:/i);
  const shiftMatch = fullText.match(/Turno:\s*(.+?)\s+Turma:/i);
  const classMatch = fullText.match(/Turma:\s*(\S+)/i);
  const dateMatch = fullText.match(/DATA:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const yearMatch = fullText.match(/\b(20\d{2})\b/);

  const metadata: ParsedSereCouncilMetadata = {
    fileName,
    schoolName: null,
    year: yearMatch ? Number.parseInt(yearMatch[1], 10) : null,
    reportDate: dateMatch ? dateMatch[1] : null,
    course: courseMatch ? courseMatch[1].trim() : null,
    grade: gradeMatch ? gradeMatch[1].trim() : null,
    shift: shiftMatch ? shiftMatch[1].trim() : null,
    classCode: classMatch ? classMatch[1].trim() : null,
    pageCount: pagesText.length,
  };

  // Detecta linha de cabeçalho "Nro. Nome <DISC1> ..." ou linha logo acima de "T1 T2 T3"
  const subjects: ParsedSereCouncilSubject[] = [];
  const tLineIdx = lines.findIndex((l) => /^(?:T1\s+T2\s+T3(?:\s+|$)){1,}/i.test(l));
  if (tLineIdx === -1) {
    throw new Error(
      `O arquivo "${fileName}" não corresponde ao Relatório de Acompanhamento Trimestral do SERE.`
    );
  }

  const tripletCount = (lines[tLineIdx].match(/T1\s+T2\s+T3/gi) || []).length;
  const headerLine = rawLines[Math.max(0, tLineIdx - 1)] || "";
  const cleanedHeader = headerLine.replace(/^Nro\.?\s+Nome\s+/i, "").trim();

  // Divide cabeçalhos conhecidos por 2+ espaços ou fallback simples
  const rawSubjectTokens = cleanedHeader.split(/\s{2,}|\|/).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(tripletCount, rawSubjectTokens.length); i++) {
    const norm = normalizeSereTruncatedDisciplineName(rawSubjectTokens[i]);
    subjects.push({
      rawHeader: rawSubjectTokens[i],
      name: norm.name || rawSubjectTokens[i],
      matchKey: norm.matchKey || toCouncilSubjectMatchKey(rawSubjectTokens[i]),
      sourceFiles: [fileName],
    });
  }

  const rawStudents: ParsedSereCouncilStudentRow[] = [];
  const tokenRegex = /(?:\d{1,2}[.,]\d{1,2}|--)/g;
  const occurrencesByNorm = new Map<string, number>();

  for (let i = tLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/Total\s+de\s+registros\s+abaixo/i.test(line)) break;
    const rowMatch = line.match(/^(\d{1,3})\s+(.+)$/);
    if (!rowMatch) continue;

    const rowNumber = Number.parseInt(rowMatch[1], 10);
    const rest = rowMatch[2];
    const firstTokenMatch = rest.match(/\s+(?:\d{1,2}[.,]\d{1,2}|--)(?:\s|$)/);
    if (!firstTokenMatch || firstTokenMatch.index === undefined) continue;

    const rawName = rest.slice(0, firstTokenMatch.index).trim();
    const tokensStr = rest.slice(firstTokenMatch.index);
    const tokens = tokensStr.match(tokenRegex) || [];
    const normalizedName = normalizeStudentName(rawName);
    if (!normalizedName) continue;

    occurrencesByNorm.set(normalizedName, (occurrencesByNorm.get(normalizedName) ?? 0) + 1);

    const grades: ParsedSereCouncilGradeEntry[] = [];
    const stride = tokens.length >= subjects.length * 4 ? 4 : 3;
    for (let sIdx = 0; sIdx < subjects.length; sIdx++) {
      const base = sIdx * stride;
      for (let t = 0; t < 3; t++) {
        const tok = tokens[base + t];
        if (!tok) continue;
        const val = parseSereGradeToken(tok);
        if (val !== null) {
          grades.push({
            subjectMatchKey: subjects[sIdx].matchKey,
            subjectName: subjects[sIdx].name,
            trimester: (t + 1) as SereCouncilTrimesterKey,
            grade: val,
          });
        }
      }
    }

    rawStudents.push({
      rowNumber,
      rawName,
      normalizedName,
      grades,
      hasAnyGrade: grades.length > 0,
    });
  }

  const warnings: string[] = [];
  const students: ParsedSereCouncilStudentRow[] = [];
  const seenAmbiguous = new Set<string>();
  for (const stu of rawStudents) {
    if ((occurrencesByNorm.get(stu.normalizedName) ?? 0) > 1) {
      if (!seenAmbiguous.has(stu.normalizedName)) {
        seenAmbiguous.add(stu.normalizedName);
        students.push({
          ...stu,
          grades: [],
          hasAnyGrade: false,
          isAmbiguousInPdf: true,
        });
        warnings.push(
          `${fileName}: nome duplicado no PDF ("${stu.rawName}") tratado como homônimo e ignorado para evitar mistura de notas.`
        );
      }
    } else {
      students.push(stu);
    }
  }

  if (subjects.length === 0 || students.length === 0) {
    throw new Error(`Não foram encontradas disciplinas ou notas válidas em "${fileName}".`);
  }

  return {
    metadata,
    subjects,
    students,
    warnings,
  };
}

/**
 * Consolida 1 ou mais relatórios PDF do SERE pertencentes à mesma turma
 * (ex.: 3ª Série com 2 matrizes curriculares — FGB + Itinerário Formativo).
 */
export function mergeParsedSereCouncilReports(
  reports: ParsedSereCouncilPdfReport[]
): MergedSereCouncilPdfBatch {
  const warnings: string[] = [];
  const files: ParsedSereCouncilMetadata[] = [];
  const subjectMap = new Map<string, ParsedSereCouncilSubject>();
  const ambiguousNames = new Set<string>();
  const studentMap = new Map<
    string,
    {
      rowNumber: number | null;
      rawName: string;
      normalizedName: string;
      isAmbiguousInPdf: boolean;
      gradeByCell: Map<string, ParsedSereCouncilGradeEntry>;
    }
  >();

  // Detecta divergência de turma/série/turno entre múltiplos PDFs no mesmo envio
  const classSignatures = new Set<string>();

  for (const report of reports) {
    files.push(report.metadata);
    warnings.push(...report.warnings);

    const reportCounts = new Map<string, number>();
    for (const stu of report.students) {
      reportCounts.set(stu.normalizedName, (reportCounts.get(stu.normalizedName) ?? 0) + 1);
      if (stu.isAmbiguousInPdf) {
        ambiguousNames.add(stu.normalizedName);
      }
    }
    for (const [norm, count] of reportCounts.entries()) {
      if (count > 1) {
        ambiguousNames.add(norm);
      }
    }

    const sigParts = [
      report.metadata.grade?.toUpperCase().trim() || "",
      report.metadata.shift?.toUpperCase().trim() || "",
      report.metadata.classCode?.toUpperCase().trim() || "",
    ].filter(Boolean);
    if (sigParts.length > 0) {
      classSignatures.add(sigParts.join(" | "));
    }

    for (const subj of report.subjects) {
      const existing = subjectMap.get(subj.matchKey);
      if (!existing) {
        subjectMap.set(subj.matchKey, {
          ...subj,
          sourceFiles: [...subj.sourceFiles],
        });
      } else {
        if (!existing.sourceFiles.includes(report.metadata.fileName)) {
          existing.sourceFiles.push(report.metadata.fileName);
        }
      }
    }

    for (const stu of report.students) {
      let target = studentMap.get(stu.normalizedName);
      if (!target) {
        target = {
          rowNumber: stu.rowNumber,
          rawName: stu.rawName,
          normalizedName: stu.normalizedName,
          isAmbiguousInPdf: ambiguousNames.has(stu.normalizedName),
          gradeByCell: new Map(),
        };
        studentMap.set(stu.normalizedName, target);
      }

      if (ambiguousNames.has(stu.normalizedName)) {
        target.isAmbiguousInPdf = true;
        target.gradeByCell.clear();
        continue;
      }

      for (const g of stu.grades) {
        const cellKey = `${g.subjectMatchKey}|${g.trimester}`;
        target.gradeByCell.set(cellKey, g);
      }
    }
  }

  if (classSignatures.size > 1) {
    warnings.push(
      `Os arquivos enviados indicam turmas diferentes (${Array.from(classSignatures).join(" vs. ")}). Confira antes de confirmar.`
    );
  }

  let totalGrades = 0;
  let belowAverageGrades = 0;
  const students: ParsedSereCouncilStudentRow[] = [];

  for (const stu of studentMap.values()) {
    const isAmbiguous = stu.isAmbiguousInPdf || ambiguousNames.has(stu.normalizedName);
    const grades = isAmbiguous ? [] : Array.from(stu.gradeByCell.values());
    totalGrades += grades.length;
    belowAverageGrades += grades.filter((g) => g.grade < 6.0).length;
    students.push({
      rowNumber: stu.rowNumber,
      rawName: stu.rawName,
      normalizedName: stu.normalizedName,
      grades,
      hasAnyGrade: grades.length > 0,
      ...(isAmbiguous ? { isAmbiguousInPdf: true } : {}),
    });
  }

  return {
    files,
    subjects: Array.from(subjectMap.values()),
    students,
    totalGrades,
    belowAverageGrades,
    warnings,
  };
}
