import crypto from "crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { classCouncilBiSyncSchema } from "@/lib/schemas";
import { isComplementarySereCourse } from "@/lib/sereParser";
import {
  buildStudentLookupMaps,
  normalizeStudentName,
} from "@/lib/studentMatcher";
import { applyPendingCgmUpdatesSafely, populateGlobalTakenCgms } from "@/lib/syncCgmGuard";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  matchStudentAndTrackPendingCgm,
  type ResolvedSchool,
} from "@/services/frequencySyncService";
import {
  computeHasSensitiveHealthTag,
  ensureOrUpsertCouncilBoard,
  getCouncilBoardDetail,
  parseBelowAverageJson,
  type CouncilBelowAvgItem,
} from "@/services/classCouncilService";

export type ClassCouncilBiSyncPayload = z.infer<typeof classCouncilBiSyncSchema>;

const BI_DISCIPLINE_DICTIONARY: Record<string, string> = {
  "ADM FINANC E ORCAMENTARIA": "Adm. Financeira e Orçamentária",
  "ADMINISTRACAO FINANCEIRA E ORCAMENTARIA": "Adm. Financeira e Orçamentária",
  "ARTE": "Arte",
  "ARTE I": "Arte I",
  "ARTE II": "Arte II",
  "ARTE PARANAENSE": "Arte Paranaense",
  "BIOLOGIA": "Biologia",
  "BIOLOGIA I": "Biologia I",
  "BIOLOGIA II": "Biologia II",
  "BIOLOGIA SUSTENT EM ACAO": "Biologia: Sustentabilidade em Ação",
  "CIENCIAS": "Ciências",
  "COMUNICACAO E VENDAS": "Comunicação e Vendas",
  "CONTROLADORIA E FINANCAS": "Controladoria e Finanças",
  "ED DIG COMP PROG E IA": "Ed. Digital, Programação e IA",
  "EDUCACAO DIGITAL": "Educação Digital",
  "EDUCACAO FINANCEIRA": "Educação Financeira",
  "EDUCACAO FISICA": "Educação Física",
  "ENSINO RELIGIOSO": "Ensino Religioso",
  "ESTRATEGIAS DE MARKETING": "Estratégias de Marketing",
  "FILOSOFIA": "Filosofia",
  "FILOSOFIA ANALISE TEXTOS FILOS": "Filosofia: Análise de Textos",
  "FINANCAS EMPRESARIAIS": "Finanças Empresariais",
  "FISICA": "Física",
  "FISICA I": "Física I",
  "FISICA II": "Física II",
  "FISICA III": "Física III",
  "FISICA E TECNOCIENCIA": "Física e Tecnociência",
  "GEOGRAFIA": "Geografia",
  "GEOGRAFIA I": "Geografia I",
  "GEOGRAFIA II": "Geografia II",
  "GEOGRAFIA DO PARANA": "Geografia do Paraná",
  "HISTORIA": "História",
  "HISTORIA I": "História I",
  "HISTORIA II": "História II",
  "LINGUA INGLESA": "Língua Inglesa",
  "LINGUA PORTUGUESA": "Língua Portuguesa",
  "LITERATURA": "Literatura",
  "MATEMATICA": "Matemática",
  "MATEMATICA I": "Matemática I",
  "MATEMATICA II": "Matemática II",
  "ORATORIA": "Oratória",
  "PENSAMENTO COMPUTACIONAL": "Pensamento Computacional",
  "PRODUCAO DE TEXTO": "Produção de Texto",
  "PROJETO DE VIDA": "Projeto de Vida",
  "QUIMICA": "Química",
  "QUIMICA I": "Química I",
  "QUIMICA II": "Química II",
  "REDACAO E LEITURA": "Redação e Leitura",
  "ROBOTICA": "Robótica",
  "SOCIOLOGIA": "Sociologia",
  "SOCIOLOGIA I": "Sociologia I",
};

const LOWERCASE_WORDS = new Set(["e", "de", "da", "do", "das", "dos", "em", "para", "no", "na"]);
const UPPERCASE_WORDS = new Set(["I", "II", "III", "IV", "V", "IA", "TI", "RH", "EAD", "EF", "EM"]);

function toAsciiUpperKey(raw: string): string {
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

/**
 * Extrai CGM numérico e idade opcional a partir de `cgmkey` ("1007827080-16"), `cgm` ou `nome` ("ALUNO - 1012704492").
 */
export function parseCgmAndAgeFromBiRow(input: {
  cgm?: string | null;
  cgmkey?: string | null;
  nome?: string | null;
}): { cgm: string; age: number | null; cleanName: string } {
  const rawCgmKey = String(input.cgmkey ?? "").replace(/\u0000/g, "").trim();
  const rawCgm = String(input.cgm ?? "").replace(/\u0000/g, "").trim();
  const rawNome = String(input.nome ?? "").replace(/\u0000/g, "").trim();

  let cgm = "";
  let age: number | null = null;

  if (rawCgmKey) {
    const keyMatch = rawCgmKey.match(/^(\d{6,12})(?:-(\d{1,2}))?$/);
    if (keyMatch) {
      cgm = keyMatch[1];
      if (keyMatch[2]) {
        const parsedAge = parseInt(keyMatch[2], 10);
        if (parsedAge >= 5 && parsedAge <= 99) {
          age = parsedAge;
        }
      }
    }
  }

  if (!cgm && rawCgm) {
    const digits = rawCgm.replace(/\D/g, "");
    if (digits.length >= 6 && digits.length <= 12) {
      cgm = digits;
    }
  }

  let cleanName = rawNome;
  const suffixMatch = rawNome.match(/^(.*?)\s*-\s*(\d+(?:\.\.\.|…)?)$/);
  if (suffixMatch) {
    cleanName = suffixMatch[1].trim();
    const candidateDigits = suffixMatch[2];
    if (!cgm && /^\d{6,12}$/.test(candidateDigits)) {
      cgm = candidateDigits;
    }
  } else {
    const trailingTruncated = rawNome.match(/^(.*?)\s*-\s*$/);
    if (trailingTruncated) {
      cleanName = trailingTruncated[1].trim();
    }
  }

  return {
    cgm,
    age,
    cleanName: cleanName.replace(/\s+/g, " ").trim(),
  };
}

/**
 * Filtra turmas regulares com avaliação TRIMESTRAL na aba ESCOLA,
 * descartando programas complementares, treinamentos esportivos, monitoria e contraturno.
 */
export function isRegularTrimestralBiTurma(item: {
  turmaRaw: string;
  periodoAvaliacao?: string | null;
  equivalenciaSeriacao?: string | null;
  curso?: string | null;
}): boolean {
  const normTurma = toAsciiUpperKey(item.turmaRaw);
  const normPeriodo = toAsciiUpperKey(item.periodoAvaliacao || "");
  const normEquiv = toAsciiUpperKey(item.equivalenciaSeriacao || "");

  if (item.periodoAvaliacao !== undefined && item.periodoAvaliacao !== null) {
    if (normPeriodo !== "TRIMESTRAL") {
      return false;
    }
  }

  if (!normTurma) return false;
  if (normTurma.includes("SEM SERIACAO") || /\bPERIODO\b/.test(normTurma)) {
    return false;
  }
  if (normEquiv.includes("SEM EQUIVALENCIA")) {
    return false;
  }
  if (isComplementarySereCourse(item.curso || "", item.equivalenciaSeriacao || "")) {
    return false;
  }

  return true;
}

/**
 * Normaliza o rótulo de disciplina do BI ("ARTE - 704", "ED DIG COMP PROG E IA - 6507")
 * para nome pedagógico legível + código numérico + chave de pareamento sem duplicação.
 */
export function normalizeBiDisciplineName(raw: string): {
  code: string | null;
  canonicalName: string;
  matchKey: string;
  rawMatchKey: string;
} {
  const cleaned = String(raw || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  const codeMatch = cleaned.match(/^(.*?)\s*-\s*(\d{2,6})$/);
  const baseRaw = codeMatch ? codeMatch[1].trim() : cleaned;
  const code = codeMatch ? codeMatch[2] : null;

  const rawMatchKey = toAsciiUpperKey(baseRaw);
  const canonicalName =
    BI_DISCIPLINE_DICTIONARY[rawMatchKey] ||
    toSmartPtBrTitleCase(baseRaw) ||
    cleaned;

  return {
    code,
    canonicalName,
    matchKey: toAsciiUpperKey(canonicalName),
    rawMatchKey,
  };
}

/**
 * Mescla de forma não-destrutiva os descritivos do estudante conforme nota (escala 0..10):
 * - Preserva 100% dos códigos manuais de conduta/frequência/assiduidade (3, 4, 5).
 * - Se nota < 6.0: adiciona código 2 (Dificuldade de aprendizagem) e remove código 1 conflitante.
 * - Se nota >= 7.0: define código 1 (Atende às expectativas) e remove código 2 anterior recuperado.
 * - Se 6.0 <= nota < 7.0: remove eventual código 2 anterior mantendo os demais códigos.
 */
export function mergeBiDescriptorCodes(
  existingCodes: readonly number[],
  grade: number | null | undefined
): number[] {
  const manualCodes = existingCodes.filter((c) => c === 3 || c === 4 || c === 5);

  if (grade === null || grade === undefined || Number.isNaN(grade)) {
    return Array.from(new Set(existingCodes.filter((c) => c >= 1 && c <= 5))).sort(
      (a, b) => a - b
    );
  }

  if (grade < 6.0) {
    return Array.from(new Set([...manualCodes, 2])).sort((a, b) => a - b);
  }

  if (grade >= 7.0) {
    return Array.from(new Set([...manualCodes, 1])).sort((a, b) => a - b);
  }

  // Faixa Básica [6.0, 7.0): não marca dificuldade (2) nem assume plenamente (1), mantendo se já houver 1
  const keepOne = existingCodes.includes(1) ? [1] : [];
  return Array.from(new Set([...keepOne, ...manualCodes])).sort((a, b) => a - b);
}

/**
 * Sugere selos pedagógicos de destaque/superação preservando integralmente selos existentes
 * (em especial ALUNO_COM_LAUDO, AEE, ESTUDANTE_MONITOR e LIDER_DE_TURMA).
 */
export function mergeBiStudentTags(params: {
  existingTags: readonly string[];
  media1Tri?: number | null;
  media2Tri?: number | null;
  media3Tri?: number | null;
  abaixoBasicoCount?: number | null;
}): string[] {
  const result = new Set(params.existingTags);
  const { media1Tri, media2Tri, media3Tri, abaixoBasicoCount } = params;

  const availableMedias = [media1Tri, media2Tri, media3Tri].filter(
    (v): v is number => v !== null && v !== undefined && Number.isFinite(v)
  );

  if (
    availableMedias.length > 0 &&
    Math.max(...availableMedias) >= 9.0 &&
    availableMedias.every((m) => m >= 8.0) &&
    (abaixoBasicoCount ?? 0) === 0
  ) {
    result.add("DESTAQUE_DA_TURMA");
  }

  if (
    (media1Tri !== null &&
      media1Tri !== undefined &&
      media2Tri !== null &&
      media2Tri !== undefined &&
      media1Tri < 6.0 &&
      media2Tri >= 7.0) ||
    (media2Tri !== null &&
      media2Tri !== undefined &&
      media3Tri !== null &&
      media3Tri !== undefined &&
      media2Tri < 6.0 &&
      media3Tri >= 7.0)
  ) {
    result.add("ESTUDANTE_SUPERACAO");
  }

  return Array.from(result);
}

function extractCodTurmaFromTurmaRaw(turmaRaw: string): string | null {
  const m = turmaRaw.trim().match(/-\s*(\d{5,10})\s*$/);
  return m ? m[1] : null;
}

function matchBiTurmaToClassGroup(
  turmaRaw: string,
  classGroups: Array<{ id: string; name: string; shift: string }>
): string | null {
  const cleanBi = turmaRaw.replace(/-\s*\d{5,10}\s*$/, "").trim();
  const upperBi = toAsciiUpperKey(cleanBi);

  const biShift = upperBi.includes("NOITE")
    ? "NOITE"
    : upperBi.includes("TARDE")
      ? "TARDE"
      : upperBi.includes("MANHA")
        ? "MANHA"
        : null;

  const gradeMatch = upperBi.match(/^(\d{1,2})\s*[Oº°]?\s+SERIE\s+(\d{1,2})\b/);
  if (!gradeMatch) return null;

  const grade = gradeMatch[1];
  const turmaNum = gradeMatch[2];

  const candidates = classGroups.filter((cg) => {
    if (biShift && cg.shift !== biShift) return false;
    const cgUpper = toAsciiUpperKey(cg.name);
    return (
      cgUpper === `${grade}O ${turmaNum}` ||
      cgUpper === `${grade} ${turmaNum}` ||
      new RegExp(`^${grade}[Oº°]?\\s*(?:SERIE\\s*)?${turmaNum}\\b`).test(cgUpper)
    );
  });

  return candidates.length === 1 ? candidates[0].id : null;
}

export async function executeClassCouncilBiSync(options: {
  payload: ClassCouncilBiSyncPayload;
  currentSchool: ResolvedSchool;
  authMethod: "SESSION" | "TOKEN";
  userId?: string;
  userName: string;
  userEmail: string;
  req: Request;
}) {
  const { payload, currentSchool, authMethod, userId, userName, userEmail, req } = options;
  const year = payload.year ?? 2026;

  // 1. Filtra turmas regulares (TRIMESTRAL) e mapeia eventuais codturmas ignorados
  const regularTurmas: Array<{
    codturma: string | null;
    turmaRaw: string;
  }> = [];
  const ignoredNonRegularCodTurmas = new Set<string>();
  let nonRegularCount = 0;

  for (const t of payload.turmas) {
    const cod = (t.codturma || extractCodTurmaFromTurmaRaw(t.turmaRaw) || "").trim() || null;
    if (isRegularTrimestralBiTurma(t)) {
      regularTurmas.push({ codturma: cod, turmaRaw: t.turmaRaw });
    } else {
      nonRegularCount++;
      if (cod) ignoredNonRegularCodTurmas.add(cod);
    }
  }

  // 2. Carrega turmas e estudantes ativos isolados estritamente pelo schoolId dentro de withTenantContext
  const { schoolClassGroups, schoolStudents } = await withTenantContext(
    prisma,
    currentSchool.id,
    async (tx) => {
      const classGroups = await tx.classGroup.findMany({
        where: { schoolId: currentSchool.id },
        select: { id: true, name: true, segment: true, shift: true },
      });
      const students = await tx.student.findMany({
        where: { schoolId: currentSchool.id, active: true },
        select: {
          id: true,
          cgm: true,
          name: true,
          classGroupId: true,
          age: true,
          isSpecialNeeds: true,
        },
      });
      return { schoolClassGroups: classGroups, schoolStudents: students };
    }
  );

  const studentByIdMap = new Map(schoolStudents.map((s) => [s.id, s]));
  const { cgmMap, nameMap, usedCgms } = buildStudentLookupMaps(schoolStudents);

  const incomingRawCgms: string[] = [];
  for (const row of payload.alunosTurma) {
    const parsed = parseCgmAndAgeFromBiRow(row);
    if (parsed.cgm) incomingRawCgms.push(parsed.cgm);
  }
  for (const row of payload.notasMapa) {
    const parsed = parseCgmAndAgeFromBiRow(row);
    if (parsed.cgm) incomingRawCgms.push(parsed.cgm);
  }
  await populateGlobalTakenCgms(prisma, incomingRawCgms, usedCgms);

  const pendingCgmUpdates = new Map<string, string>();
  const pendingAgeUpdates = new Map<string, number>();
  const matchedStudentIds = new Set<string>();
  const naoEncontradosMap = new Map<string, { nome: string; cgm?: string; codturma?: string }>();
  const codTurmaVotes = new Map<string, Map<string, number>>();

  const registerCodTurmaVote = (codturma: string | null | undefined, classGroupId: string) => {
    const cleanCod = (codturma || "").trim();
    if (!cleanCod || ignoredNonRegularCodTurmas.has(cleanCod)) return;
    let votes = codTurmaVotes.get(cleanCod);
    if (!votes) {
      votes = new Map();
      codTurmaVotes.set(cleanCod, votes);
    }
    votes.set(classGroupId, (votes.get(classGroupId) ?? 0) + 1);
  };

  // 3. Processa aba TURMA (médias por trimestre, idade e selos sugeridos)
  const studentMacroById = new Map<
    string,
    {
      media1Tri: number | null;
      media2Tri: number | null;
      media3Tri: number | null;
      abaixoBasicoCount: number | null;
    }
  >();

  for (const row of payload.alunosTurma) {
    const cleanCod = (row.codturma || "").trim();
    if (cleanCod && ignoredNonRegularCodTurmas.has(cleanCod)) {
      continue;
    }

    const parsed = parseCgmAndAgeFromBiRow(row);
    const isTruncated = parsed.cleanName.includes("...") || parsed.cleanName.includes("…");
    const rawName = isTruncated ? "" : normalizeStudentName(parsed.cleanName);

    const studentId = matchStudentAndTrackPendingCgm({
      cgmClean: parsed.cgm,
      rawName,
      cgmMap,
      nameMap,
      usedCgms,
      pendingCgmUpdates,
      logPrefix: "conselho-classe/sync",
    });

    if (!studentId) {
      const missKey = parsed.cgm || normalizeStudentName(parsed.cleanName) || row.nome || "";
      if (missKey && !naoEncontradosMap.has(missKey)) {
        naoEncontradosMap.set(missKey, {
          nome: parsed.cleanName || row.nome || "",
          cgm: parsed.cgm || undefined,
          codturma: cleanCod || undefined,
        });
      }
      continue;
    }

    const studentRec = studentByIdMap.get(studentId);
    if (!studentRec) continue;

    matchedStudentIds.add(studentId);
    registerCodTurmaVote(cleanCod, studentRec.classGroupId);

    if (parsed.age !== null && studentRec.age !== parsed.age) {
      pendingAgeUpdates.set(studentId, parsed.age);
    }

    const existingMacro = studentMacroById.get(studentId);
    studentMacroById.set(studentId, {
      media1Tri: row.media1Tri ?? existingMacro?.media1Tri ?? null,
      media2Tri: row.media2Tri ?? existingMacro?.media2Tri ?? null,
      media3Tri: row.media3Tri ?? existingMacro?.media3Tri ?? null,
      abaixoBasicoCount: row.abaixoBasicoCount ?? existingMacro?.abaixoBasicoCount ?? null,
    });
  }

  // 4. Processa aba MAPA (notas trimestrais por estudante x disciplina)
  type MergedStudentSubjectGrades = {
    studentId: string;
    classGroupId: string;
    discipline: ReturnType<typeof normalizeBiDisciplineName>;
    nota1Tri: number | null;
    nota2Tri: number | null;
    nota3Tri: number | null;
  };

  const gradesByClassGroup = new Map<string, Map<string, MergedStudentSubjectGrades>>();

  for (const row of payload.notasMapa) {
    const hasAnyGrade =
      (row.nota1Tri !== null && row.nota1Tri !== undefined) ||
      (row.nota2Tri !== null && row.nota2Tri !== undefined) ||
      (row.nota3Tri !== null && row.nota3Tri !== undefined);
    if (!hasAnyGrade) continue;

    const cleanCod = (row.codturma || "").trim();
    if (cleanCod && ignoredNonRegularCodTurmas.has(cleanCod)) {
      continue;
    }

    const parsed = parseCgmAndAgeFromBiRow(row);
    const isTruncated = parsed.cleanName.includes("...") || parsed.cleanName.includes("…");
    const rawName = isTruncated ? "" : normalizeStudentName(parsed.cleanName);

    const studentId = matchStudentAndTrackPendingCgm({
      cgmClean: parsed.cgm,
      rawName,
      cgmMap,
      nameMap,
      usedCgms,
      pendingCgmUpdates,
      logPrefix: "conselho-classe/sync",
    });

    if (!studentId) {
      const missKey = parsed.cgm || normalizeStudentName(parsed.cleanName) || row.nome || "";
      if (missKey && !naoEncontradosMap.has(missKey)) {
        naoEncontradosMap.set(missKey, {
          nome: parsed.cleanName || row.nome || "",
          cgm: parsed.cgm || undefined,
          codturma: cleanCod || undefined,
        });
      }
      continue;
    }

    const studentRec = studentByIdMap.get(studentId);
    if (!studentRec) continue;

    matchedStudentIds.add(studentId);
    registerCodTurmaVote(cleanCod, studentRec.classGroupId);

    const disc = normalizeBiDisciplineName(row.disciplinaRaw);
    if (!disc.canonicalName) continue;

    let classMap = gradesByClassGroup.get(studentRec.classGroupId);
    if (!classMap) {
      classMap = new Map();
      gradesByClassGroup.set(studentRec.classGroupId, classMap);
    }

    const dedupKey = `${studentId}::${disc.matchKey}`;
    const prev = classMap.get(dedupKey);
    classMap.set(dedupKey, {
      studentId,
      classGroupId: studentRec.classGroupId,
      discipline: disc,
      nota1Tri: row.nota1Tri ?? prev?.nota1Tri ?? null,
      nota2Tri: row.nota2Tri ?? prev?.nota2Tri ?? null,
      nota3Tri: row.nota3Tri ?? prev?.nota3Tri ?? null,
    });
  }

  // Pareamento de codturma -> classGroupId por voto majoritário + fallback de nome
  const codTurmaToClassGroupId = new Map<string, string>();
  for (const [cod, votes] of codTurmaVotes.entries()) {
    let bestClassId: string | null = null;
    let bestCount = -1;
    for (const [classId, count] of votes.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestClassId = classId;
      }
    }
    if (bestClassId) {
      codTurmaToClassGroupId.set(cod, bestClassId);
    }
  }
  for (const rt of regularTurmas) {
    if (rt.codturma && !codTurmaToClassGroupId.has(rt.codturma)) {
      const matchedId = matchBiTurmaToClassGroup(rt.turmaRaw, schoolClassGroups);
      if (matchedId) {
        codTurmaToClassGroupId.set(rt.codturma, matchedId);
      }
    }
  }

  // 5. Aplica vínculos seguros de CGM e idade na base de estudantes do tenant
  const cgmVinculados = await applyPendingCgmUpdatesSafely(
    prisma,
    pendingCgmUpdates,
    currentSchool.id
  );

  let idadesAtualizadas = 0;
  if (pendingAgeUpdates.size > 0) {
    const ageEntries = Array.from(pendingAgeUpdates.entries());
    const BATCH_SIZE = 250;
    for (let i = 0; i < ageEntries.length; i += BATCH_SIZE) {
      const chunk = ageEntries.slice(i, i + BATCH_SIZE);
      const values = chunk.map(
        ([id, age]) => Prisma.sql`(${id}, CAST(${age} AS INTEGER))`
      );
      const updatedAgeRows = await withTenantContext(prisma, currentSchool.id, async (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "Student" AS s
          SET "age" = v."ageVal",
              "updatedAt" = NOW()
          FROM (VALUES ${Prisma.join(values)}) AS v("id", "ageVal")
          WHERE s."id" = v."id"
            AND s."schoolId" = ${currentSchool.id}
            AND s."active" = true
          RETURNING s."id"
        `
      );
      idadesAtualizadas += updatedAgeRows.length;
    }
  }

  // 6. Identifica todas as turmas com estudantes pareados (por notasMapa ou alunosTurma)
  const affectedClassGroupIdSet = new Set<string>(gradesByClassGroup.keys());
  for (const studentId of studentMacroById.keys()) {
    const st = studentByIdMap.get(studentId);
    if (st) affectedClassGroupIdSet.add(st.classGroupId);
  }

  const affectedClassGroupIds = Array.from(affectedClassGroupIdSet);
  let disciplinasCriadas = 0;
  let notasGravadas = 0;
  let abaixoDaMediaDetectados = 0;
  let cardsAtualizados = 0;

  // 7. Sincroniza cada turma afetada de forma não-destrutiva
  for (const classGroupId of affectedClassGroupIds) {
    const classGradesMap = gradesByClassGroup.get(classGroupId);

    const boardSetup = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const validClassGroup = await tx.classGroup.findFirst({
        where: { id: classGroupId, schoolId: currentSchool.id },
        select: { id: true },
      });
      if (!validClassGroup) {
        return null;
      }

      const existingBoardHeader = await tx.classCouncilBoard.findUnique({
        where: {
          schoolId_classGroupId_year: {
            schoolId: currentSchool.id,
            classGroupId,
            year,
          },
        },
        select: { id: true },
      });

      const board = existingBoardHeader
        ? await getCouncilBoardDetail(currentSchool.id, existingBoardHeader.id, tx)
        : await ensureOrUpsertCouncilBoard(
            {
              schoolId: currentSchool.id,
              payload: {
                classGroupId,
                year,
                seatingMapMode: "REVEZAMENTO_MENSAL",
              },
              authorName: userName,
              authorEmail: userEmail,
            },
            tx
          );

      if (!board || board.schoolId !== currentSchool.id || board.classGroupId !== classGroupId) {
        return null;
      }

      // 7a. Garante as disciplinas encontradas nas notas desta turma (preservando docentes existentes)
      const subjectByMatchKey = new Map<string, (typeof board.subjects)[number]>();
      for (const sub of board.subjects) {
        subjectByMatchKey.set(toAsciiUpperKey(sub.name), sub);
      }

      const missingSubjectsMap = new Map<string, string>();
      const subjectsToReactivateIds = new Set<string>();

      if (classGradesMap) {
        for (const item of classGradesMap.values()) {
          const matched =
            subjectByMatchKey.get(item.discipline.matchKey) ||
            subjectByMatchKey.get(item.discipline.rawMatchKey);

          if (matched) {
            if (!matched.active) {
              subjectsToReactivateIds.add(matched.id);
            }
            subjectByMatchKey.set(item.discipline.matchKey, matched);
            subjectByMatchKey.set(item.discipline.rawMatchKey, matched);
          } else if (!missingSubjectsMap.has(item.discipline.matchKey)) {
            missingSubjectsMap.set(item.discipline.matchKey, item.discipline.canonicalName);
          }
        }
      }

      if (subjectsToReactivateIds.size > 0) {
        await tx.classCouncilSubject.updateMany({
          where: {
            id: { in: Array.from(subjectsToReactivateIds) },
            boardId: board.id,
            schoolId: currentSchool.id,
          },
          data: { active: true },
        });
        for (const sub of board.subjects) {
          if (subjectsToReactivateIds.has(sub.id)) sub.active = true;
        }
      }

      let nextOrder =
        board.subjects.reduce((max, s) => Math.max(max, s.displayOrder ?? 0), -1) + 1;

      const sortedMissingSubjects = Array.from(missingSubjectsMap.entries()).sort((a, b) =>
        a[1].localeCompare(b[1], "pt-BR")
      );

      let createdSubjectsCount = 0;
      for (const [matchKey, canonicalName] of sortedMissingSubjects) {
        const createdSub = await tx.classCouncilSubject.upsert({
          where: {
            boardId_name: {
              boardId: board.id,
              name: canonicalName,
            },
          },
          create: {
            schoolId: currentSchool.id,
            boardId: board.id,
            name: canonicalName,
            displayOrder: nextOrder++,
            active: true,
          },
          update: {
            active: true,
          },
        });
        if (createdSub.schoolId === currentSchool.id && createdSub.boardId === board.id) {
          subjectByMatchKey.set(matchKey, createdSub);
          board.subjects.push(createdSub);
          createdSubjectsCount++;
        }
      }

      return { board, subjectByMatchKey, createdSubjectsCount };
    });

    if (!boardSetup) continue;
    const { board, subjectByMatchKey, createdSubjectsCount } = boardSetup;
    disciplinasCriadas += createdSubjectsCount;

    const activeSubjectById = new Map(
      board.subjects
        .filter((s) => s.active)
        .map((s) => [s.id, s])
    );

    // 7b. Constrói lote de StudentCouncilSubjectEntry e mapa em memória para recomputar abaixo da média
    const cardByStudentId = new Map(board.studentCards.map((c) => [c.studentId, c]));
    const entriesByCardId = new Map<
      string,
      Map<
        string,
        {
          subjectId: string;
          trimester: 1 | 2 | 3;
          descriptorCodes: number[];
          grade: number | null;
        }
      >
    >();

    for (const card of board.studentCards) {
      const cardMap = new Map<
        string,
        {
          subjectId: string;
          trimester: 1 | 2 | 3;
          descriptorCodes: number[];
          grade: number | null;
        }
      >();
      for (const e of card.subjectEntries || []) {
        if (e.trimester === 1 || e.trimester === 2 || e.trimester === 3) {
          cardMap.set(`${e.subjectId}::${e.trimester}`, {
            subjectId: e.subjectId,
            trimester: e.trimester,
            descriptorCodes: e.descriptorCodes || [],
            grade: e.grade ?? null,
          });
        }
      }
      entriesByCardId.set(card.id, cardMap);
    }

    const entriesToUpsert: Array<{
      id: string;
      cardId: string;
      subjectId: string;
      trimester: 1 | 2 | 3;
      descriptorCodes: number[];
      grade: number;
    }> = [];

    const touchedCardTrimesters = new Map<string, Set<1 | 2 | 3>>();
    const markTouchedTrimester = (cardId: string, tri: 1 | 2 | 3) => {
      let set = touchedCardTrimesters.get(cardId);
      if (!set) {
        set = new Set();
        touchedCardTrimesters.set(cardId, set);
      }
      set.add(tri);
    };

    if (classGradesMap) {
      for (const item of classGradesMap.values()) {
        const card = cardByStudentId.get(item.studentId);
        const subject =
          subjectByMatchKey.get(item.discipline.matchKey) ||
          subjectByMatchKey.get(item.discipline.rawMatchKey);

        if (!card || !subject) continue;

        const cardEntriesMap = entriesByCardId.get(card.id)!;
        const triGrades: Array<[1 | 2 | 3, number | null]> = [
          [1, item.nota1Tri],
          [2, item.nota2Tri],
          [3, item.nota3Tri],
        ];

        for (const [tri, grade] of triGrades) {
          if (grade === null || grade === undefined) continue;

          const entryKey = `${subject.id}::${tri}`;
          const existing = cardEntriesMap.get(entryKey);
          const mergedCodes = mergeBiDescriptorCodes(existing?.descriptorCodes ?? [], grade);

          cardEntriesMap.set(entryKey, {
            subjectId: subject.id,
            trimester: tri,
            descriptorCodes: mergedCodes,
            grade,
          });

          entriesToUpsert.push({
            id: crypto.randomUUID(),
            cardId: card.id,
            subjectId: subject.id,
            trimester: tri,
            descriptorCodes: mergedCodes,
            grade,
          });

          markTouchedTrimester(card.id, tri);
        }
      }
    }

    // Persistência em lote de StudentCouncilSubjectEntry com coerência escolar e RETURNING
    const BATCH_SIZE = 250;
    if (entriesToUpsert.length > 0) {
      for (let i = 0; i < entriesToUpsert.length; i += BATCH_SIZE) {
        const chunk = entriesToUpsert.slice(i, i + BATCH_SIZE);
        const values = chunk.map((r) => {
          const safeCodes = r.descriptorCodes.filter(
            (c) => Number.isInteger(c) && c >= 1 && c <= 5
          );
          const codesExpr =
            safeCodes.length === 0
              ? Prisma.sql`ARRAY[]::INTEGER[]`
              : Prisma.sql`ARRAY[${Prisma.join(safeCodes)}]::INTEGER[]`;

          return Prisma.sql`(
            ${r.id},
            ${r.cardId},
            ${r.subjectId},
            CAST(${r.trimester} AS INTEGER),
            ${codesExpr},
            CAST(${r.grade} AS DOUBLE PRECISION),
            ${userEmail}
          )`;
        });

        const persistedEntries = await withTenantContext(prisma, currentSchool.id, async (tx) =>
          tx.$queryRaw<Array<{ cardId: string; subjectId: string; trimester: number; grade: number }>>`
            INSERT INTO "StudentCouncilSubjectEntry" (
              "id",
              "schoolId",
              "cardId",
              "subjectId",
              "trimester",
              "descriptorCodes",
              "grade",
              "updatedByEmail",
              "updatedAt"
            )
            SELECT
              v."id",
              ${currentSchool.id},
              v."cardId",
              v."subjectId",
              v."trimester",
              v."descriptorCodes",
              v."grade",
              v."updatedByEmail",
              NOW()
            FROM (VALUES ${Prisma.join(values)}) AS v(
              "id",
              "cardId",
              "subjectId",
              "trimester",
              "descriptorCodes",
              "grade",
              "updatedByEmail"
            )
            INNER JOIN "StudentCouncilCard" AS c
              ON c."id" = v."cardId"
             AND c."schoolId" = ${currentSchool.id}
             AND c."boardId" = ${board.id}
            INNER JOIN "ClassCouncilBoard" AS b
              ON b."id" = c."boardId"
             AND b."schoolId" = ${currentSchool.id}
             AND b."classGroupId" = ${classGroupId}
            INNER JOIN "Student" AS st
              ON st."id" = c."studentId"
             AND st."schoolId" = ${currentSchool.id}
             AND st."classGroupId" = ${classGroupId}
             AND st."active" = true
            INNER JOIN "ClassCouncilSubject" AS sub
              ON sub."id" = v."subjectId"
             AND sub."schoolId" = ${currentSchool.id}
             AND sub."boardId" = ${board.id}
            ON CONFLICT ("cardId", "subjectId", "trimester") DO UPDATE SET
              "descriptorCodes" = EXCLUDED."descriptorCodes",
              "grade" = EXCLUDED."grade",
              "updatedByEmail" = EXCLUDED."updatedByEmail",
              "updatedAt" = NOW()
            RETURNING "cardId", "subjectId", "trimester", "grade"
          `
        );

        notasGravadas += persistedEntries.length;
        abaixoDaMediaDetectados += persistedEntries.filter(
          (r) => Number(r.grade) < 6.0
        ).length;
      }
    }

    // 7c. Atualiza belowAvgJson por trimestre e selos sugeridos preservando textos manuais/sensíveis
    const cardUpdates: Array<{
      cardId: string;
      data: {
        tags?: string[];
        hasSensitiveHealthTag?: boolean;
        trimester1BelowAvgJson?: string | null;
        trimester2BelowAvgJson?: string | null;
        trimester3BelowAvgJson?: string | null;
      };
    }> = [];

    for (const card of board.studentCards) {
      const touchedTris = touchedCardTrimesters.get(card.id);
      const macro = studentMacroById.get(card.studentId);
      if (!touchedTris && !macro) continue;

      const updateData: {
        tags?: string[];
        hasSensitiveHealthTag?: boolean;
        trimester1BelowAvgJson?: string | null;
        trimester2BelowAvgJson?: string | null;
        trimester3BelowAvgJson?: string | null;
      } = {};
      let hasChange = false;

      if (macro) {
        const mergedTags = mergeBiStudentTags({
          existingTags: card.tags || [],
          media1Tri: macro.media1Tri,
          media2Tri: macro.media2Tri,
          media3Tri: macro.media3Tri,
          abaixoBasicoCount: macro.abaixoBasicoCount,
        });
        const existingTagsSorted = [...(card.tags || [])].sort().join("|");
        const nextTagsSorted = [...mergedTags].sort().join("|");
        if (existingTagsSorted !== nextTagsSorted) {
          updateData.tags = mergedTags;
          updateData.hasSensitiveHealthTag = computeHasSensitiveHealthTag(mergedTags);
          hasChange = true;
        }
      }

      if (touchedTris) {
        const cardEntriesMap = entriesByCardId.get(card.id)!;
        for (const tri of touchedTris) {
          const existingJson =
            tri === 1
              ? card.trimester1BelowAvgJson
              : tri === 2
                ? card.trimester2BelowAvgJson
                : card.trimester3BelowAvgJson;

          const existingManualItems = parseBelowAverageJson(existingJson).filter(
            (item) => !item.subjectId
          );

          const belowFromMatrix: CouncilBelowAvgItem[] = Array.from(cardEntriesMap.values())
            .filter(
              (entry) =>
                entry.trimester === tri &&
                activeSubjectById.has(entry.subjectId) &&
                entry.grade !== null &&
                entry.grade !== undefined &&
                entry.grade < 6.0
            )
            .sort((a, b) => {
              const subA = activeSubjectById.get(a.subjectId)!;
              const subB = activeSubjectById.get(b.subjectId)!;
              return (
                (subA.displayOrder ?? 0) - (subB.displayOrder ?? 0) ||
                subA.name.localeCompare(subB.name, "pt-BR")
              );
            })
            .map((entry) => {
              const sub = activeSubjectById.get(entry.subjectId)!;
              return {
                subjectId: sub.id,
                subjectName: sub.name,
                grade: entry.grade,
              };
            });

          const mergedList = [...belowFromMatrix, ...existingManualItems];
          const nextJson = mergedList.length > 0 ? JSON.stringify(mergedList) : null;

          if (nextJson !== (existingJson ?? null)) {
            if (tri === 1) updateData.trimester1BelowAvgJson = nextJson;
            if (tri === 2) updateData.trimester2BelowAvgJson = nextJson;
            if (tri === 3) updateData.trimester3BelowAvgJson = nextJson;
            hasChange = true;
          }
        }
      }

      if (hasChange) {
        cardUpdates.push({ cardId: card.id, data: updateData });
      }
    }

    if (cardUpdates.length > 0) {
      for (let i = 0; i < cardUpdates.length; i += 100) {
        const chunk = cardUpdates.slice(i, i + 100);
        const chunkUpdatedCount = await withTenantContext(prisma, currentSchool.id, async (tx) => {
          let updatedInChunk = 0;
          for (const cu of chunk) {
            const res = await tx.studentCouncilCard.updateMany({
              where: {
                id: cu.cardId,
                schoolId: currentSchool.id,
                boardId: board.id,
                student: {
                  schoolId: currentSchool.id,
                  classGroupId,
                  active: true,
                },
              },
              data: cu.data,
            });
            updatedInChunk += res.count;
          }
          return updatedInChunk;
        });
        cardsAtualizados += chunkUpdatedCount;
      }
    }
  }

  await logAudit({
    action: "SYNC_CLASS_COUNCIL_BI",
    entityType: "ClassCouncilBoard",
    entityId: "BATCH_BI_SYNC",
    schoolId: currentSchool.id,
    details: {
      year,
      turmasRegularesRecebidas: regularTurmas.length,
      turmasIgnoradasNaoRegulares: nonRegularCount,
      turmasPareadas: codTurmaToClassGroupId.size,
      turmasAfetadas: affectedClassGroupIds.length,
      alunosPareados: matchedStudentIds.size,
      alunosNaoEncontradosCount: naoEncontradosMap.size,
      idadesAtualizadas,
      cgmVinculados,
      disciplinasCriadas,
      notasGravadas,
      abaixoDaMediaDetectados,
      cardsAtualizados,
      authMethod,
    },
    user: {
      id: userId,
      name: userName,
      email: userEmail,
    },
    req,
  });

  const naoEncontrados = Array.from(naoEncontradosMap.values());

  return {
    sucesso: true,
    year,
    turmasRegularesRecebidas: regularTurmas.length,
    turmasIgnoradasNaoRegulares: nonRegularCount,
    turmasPareadas: codTurmaToClassGroupId.size,
    turmasAfetadas: affectedClassGroupIds.length,
    alunosPareados: matchedStudentIds.size,
    idadesAtualizadas,
    cgmVinculados,
    disciplinasCriadas,
    notasGravadas,
    abaixoDaMediaDetectados,
    cardsAtualizados,
    naoEncontradosTotal: naoEncontrados.length,
    naoEncontrados: naoEncontrados.slice(0, 15),
  };
}
