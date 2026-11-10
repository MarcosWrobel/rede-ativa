/**
 * Utilitário puro para interpretação de arquivos CSV/TSV e payloads JSON
 * no modal de importação de frequência (/faltas).
 */

export interface ParsedFrequencyRow {
  cgm: string;
  nome: string;
  turma: string;
  mediaGeral: string | number;
  semanaAtual: string | number;
  semanaAnterior: string | number;
  amparoLegalVigencia?: string | null;
  deficienciaAltasHabilidades?: boolean | number | string | null;
  ganhandoMundo?: boolean | number | string | null;
  serpAtivo?: boolean | number | string | null;
  idade?: number | string | null;
}

/**
 * Faz o split de uma linha CSV respeitando campos entre aspas duplas (RFC 4180),
 * evitando quebra em percentuais brasileiros como "84,39%" quando o delimitador é vírgula.
 */
export function parseCsvRow(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  result.push(current.trim());
  return result.map((cell) => cell.replace(/^'|'$/g, "").trim());
}

function detectDelimiter(headerLine: string): string {
  let semicolons = 0;
  let tabs = 0;
  let commas = 0;
  let inQuotes = false;

  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === ";") semicolons++;
    else if (ch === "\t") tabs++;
    else if (ch === ",") commas++;
  }

  if (semicolons >= tabs && semicolons >= commas && semicolons > 0) return ";";
  if (tabs >= commas && tabs > 0) return "\t";
  return ",";
}

function normalizeHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeJsonItem(raw: any): ParsedFrequencyRow {
  const media =
    raw?.mediaGeral ??
    raw?.Media_Geral_Presenca ??
    raw?.frequencia ??
    raw?.frequenciaGeral ??
    raw?.percent ??
    "";

  return {
    cgm: String(raw?.cgm ?? raw?.CGM ?? "").trim(),
    nome: String(raw?.nome ?? raw?.Nome ?? raw?.aluno ?? raw?.name ?? "").trim(),
    turma: String(raw?.turma ?? raw?.Turma ?? "").trim(),
    mediaGeral: media,
    semanaAtual: raw?.semanaAtual ?? raw?.Presenca_Semana_Atual ?? "",
    semanaAnterior: raw?.semanaAnterior ?? raw?.Presenca_Semana_Anterior ?? "",
    ...(raw?.amparoLegalVigencia ?? raw?.Amparo_Legal_Vigencia_Max
      ? { amparoLegalVigencia: String(raw.amparoLegalVigencia ?? raw.Amparo_Legal_Vigencia_Max).trim() }
      : {}),
    ...(raw?.deficienciaAltasHabilidades !== undefined && raw?.deficienciaAltasHabilidades !== null && raw?.deficienciaAltasHabilidades !== ""
      ? { deficienciaAltasHabilidades: raw.deficienciaAltasHabilidades }
      : raw?.Deficiencia_Altas_Habilidades !== undefined && raw?.Deficiencia_Altas_Habilidades !== ""
      ? { deficienciaAltasHabilidades: raw.Deficiencia_Altas_Habilidades }
      : {}),
    ...(raw?.ganhandoMundo !== undefined && raw?.ganhandoMundo !== null && raw?.ganhandoMundo !== ""
      ? { ganhandoMundo: raw.ganhandoMundo }
      : raw?.Ganhando_Mundo !== undefined && raw?.Ganhando_Mundo !== ""
      ? { ganhandoMundo: raw.Ganhando_Mundo }
      : {}),
    ...(raw?.serpAtivo !== undefined && raw?.serpAtivo !== null && raw?.serpAtivo !== ""
      ? { serpAtivo: raw.serpAtivo }
      : raw?.SERP !== undefined && raw?.SERP !== ""
      ? { serpAtivo: raw.SERP }
      : {}),
    ...(raw?.idade !== undefined && raw?.idade !== null && raw?.idade !== ""
      ? { idade: raw.idade }
      : raw?.Idade !== undefined && raw?.Idade !== ""
      ? { idade: raw.Idade }
      : {}),
  };
}

export function parseFrequencyImportInput(raw: string): {
  rows: ParsedFrequencyRow[];
  error?: string;
} {
  const clean = raw.replace(/^\uFEFF/, "").trim();
  if (!clean) {
    return { rows: [] };
  }

  try {
    if (clean.startsWith("[") || clean.startsWith("{")) {
      const json = JSON.parse(clean);
      const arr = Array.isArray(json) ? json : json?.alunos;
      if (Array.isArray(arr) && arr.length > 0) {
        return { rows: arr.map(normalizeJsonItem) };
      }
      return {
        rows: [],
        error: "JSON válido, porém nenhum estudante encontrado na lista.",
      };
    }

    const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const delimiter = detectDelimiter(lines[0]);
      const firstCells = parseCsvRow(lines[0], delimiter);
      const normHeaders = firstCells.map(normalizeHeaderKey);
      const hasHeader = normHeaders.some(
        (h) =>
          h === "cgm" ||
          h === "nome" ||
          h === "aluno" ||
          h.includes("media") ||
          h.includes("frequencia") ||
          h === "turma"
      );

      if (lines.length === 1 && hasHeader) {
        return {
          rows: [],
          error: "O arquivo CSV contém apenas o cabeçalho, sem linhas de estudantes.",
        };
      }

      const findCol = (aliases: string[], fallbackIdx: number): number => {
        if (!hasHeader) return fallbackIdx;
        const exactIdx = normHeaders.findIndex((h) => aliases.some((a) => h === a));
        if (exactIdx >= 0) return exactIdx;
        const tokenIdx = normHeaders.findIndex((h) =>
          aliases.some((a) => h.startsWith(`${a}_`) || h.endsWith(`_${a}`) || h.includes(`_${a}_`))
        );
        return tokenIdx >= 0 ? tokenIdx : -1;
      };

      const idxCgm = findCol(["cgm"], 0);
      const idxNome = findCol(["nome", "aluno", "estudante"], 1);
      const idxTurma = findCol(["turma"], 2);
      const idxMedia = findCol(["media_geral", "mediageral", "media", "frequencia"], 3);
      const idxSemAtual = findCol(["semana_atual", "semanaatual"], 4);
      const idxSemAnt = findCol(["semana_anterior", "semanaanterior"], 5);
      const idxAmparo = findCol(["amparo"], 6);
      const idxDef = findCol(["deficiencia", "pcd", "altas_habilidades"], 7);
      const idxGanhando = findCol(["ganhando"], 8);
      const idxSerp = findCol(["serp"], 9);
      const idxIdade = findCol(["idade"], 10);

      const startIdx = hasHeader ? 1 : 0;
      const rows: ParsedFrequencyRow[] = [];

      for (let i = startIdx; i < lines.length; i++) {
        const parts = parseCsvRow(lines[i], delimiter);
        if (parts.length < 2) continue;

        const getVal = (idx: number) => (idx >= 0 && idx < parts.length ? parts[idx] : "");

        const row: ParsedFrequencyRow = {
          cgm: getVal(idxCgm),
          nome: getVal(idxNome),
          turma: getVal(idxTurma),
          mediaGeral: getVal(idxMedia),
          semanaAtual: getVal(idxSemAtual),
          semanaAnterior: getVal(idxSemAnt),
        };

        const amparo = getVal(idxAmparo);
        if (amparo) row.amparoLegalVigencia = amparo;

        const def = getVal(idxDef);
        if (def) row.deficienciaAltasHabilidades = def;

        const ganhando = getVal(idxGanhando);
        if (ganhando) row.ganhandoMundo = ganhando;

        const serp = getVal(idxSerp);
        if (serp) row.serpAtivo = serp;

        const idade = getVal(idxIdade);
        if (idade) row.idade = idade;

        rows.push(row);
      }

      if (rows.length > 0) {
        return { rows };
      }
    }

    return {
      rows: [],
      error: "Formato não reconhecido. Cole o JSON ou envie o arquivo CSV exportado pela extensão.",
    };
  } catch (e: any) {
    return {
      rows: [],
      error: "Erro ao processar dados: " + (e?.message || "formato inválido"),
    };
  }
}
