import { prisma } from "@/lib/prisma";
import { logAudit, type AuditUser } from "@/lib/audit";
import { normalizeStudentName } from "@/lib/studentMatcher";
import {
  toCouncilSubjectMatchKey,
  type MergedSereCouncilPdfBatch,
  type ParsedSereCouncilMetadata,
  type SereCouncilTrimesterKey,
} from "@/lib/sereCouncilPdfParser";
import { mergeBiDescriptorCodes } from "@/services/classCouncilBiSyncService";
import {
  CouncilDomainError,
  getCouncilBoardDetail,
  parseBelowAverageJson,
  type CouncilBelowAvgItem,
} from "@/services/classCouncilService";

export interface CouncilSerePdfPreviewSubject {
  rawHeader: string;
  name: string;
  matchKey: string;
  status: "existing" | "new";
  existingSubjectId: string | null;
  sourceFiles: string[];
}

export interface CouncilSerePdfPreviewStudent {
  rowNumber: number | null;
  pdfName: string;
  matchedStudentId: string | null;
  matchedStudentName: string | null;
  gradesCount: number;
  belowAverageCount: number;
  hasAnyGrade: boolean;
  status: "matched" | "unmatched" | "unmatched_no_grades" | "ambiguous";
}

export interface CouncilSerePdfPreviewResult {
  boardId: string;
  classGroupName: string;
  classGroupShift: string;
  detectedShift: string | null;
  year: number;
  files: ParsedSereCouncilMetadata[];
  subjects: CouncilSerePdfPreviewSubject[];
  students: CouncilSerePdfPreviewStudent[];
  trimestersTouched: SereCouncilTrimesterKey[];
  summary: {
    filesCount: number;
    subjectsTotal: number;
    subjectsMatched: number;
    subjectsToCreate: number;
    studentsInPdf: number;
    studentsMatched: number;
    studentsUnmatched: number;
    studentsWithoutGrades: number;
    gradesToImport: number;
    belowAverageGrades: number;
  };
  warnings: string[];
}

export interface CouncilSerePdfApplySummary {
  filesCount: number;
  subjectsCreated: number;
  subjectsMatched: number;
  studentsMatched: number;
  studentsUnmatched: number;
  evaluationsUpserted: number;
  cardsUpdated: number;
  belowAverageGrades: number;
  trimestersTouched: SereCouncilTrimesterKey[];
  warnings: string[];
}

function normalizeShiftToken(raw?: string | null): string | null {
  if (!raw) return null;
  const upper = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (upper.includes("MANHA") || upper.includes("MATUTINO")) return "MANHA";
  if (upper.includes("TARDE") || upper.includes("VESPERTINO")) return "TARDE";
  if (upper.includes("NOITE") || upper.includes("NOTURNO")) return "NOITE";
  if (upper.includes("INTEGRAL")) return "INTEGRAL";
  return null;
}

function formatShiftPtBr(shift: string): string {
  const norm = normalizeShiftToken(shift);
  if (norm === "MANHA") return "Manhã";
  if (norm === "TARDE") return "Tarde";
  if (norm === "NOITE") return "Noite";
  if (norm === "INTEGRAL") return "Integral";
  return shift;
}

function resolveConsistentPdfShift(files: ParsedSereCouncilMetadata[]): string | null {
  const detected = Array.from(
    new Set(files.map((f) => normalizeShiftToken(f.shift)).filter((s): s is string => Boolean(s)))
  );
  return detected.length === 1 ? detected[0] : null;
}

function extractLeadingGradeNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/\b(\d{1,2})\s*[ªº°]?\s*(?:ANO|SERIE|SÉRIE)\b/i);
  return m ? m[1] : null;
}

function buildClassMetadataWarnings(
  files: ParsedSereCouncilMetadata[],
  classGroupName: string,
  classGroupShift: string,
  boardYear: number,
  includeShiftUpdateNotice = false
): string[] {
  const warnings: string[] = [];
  const boardShift = normalizeShiftToken(classGroupShift);
  const boardGradeNum = extractLeadingGradeNumber(classGroupName);

  if (includeShiftUpdateNotice) {
    const resolvedPdfShift = resolveConsistentPdfShift(files);
    if (resolvedPdfShift && boardShift !== resolvedPdfShift) {
      warnings.push(
        `O PDF informa turno ${formatShiftPtBr(resolvedPdfShift)}, diferente do turno atual da turma (${formatShiftPtBr(classGroupShift)}). Confirme abaixo se deseja atualizar o turno da turma.`
      );
    }
  }

  for (const file of files) {
    if (file.year && file.year !== boardYear) {
      warnings.push(
        `${file.fileName}: ano letivo do PDF (${file.year}) difere do painel atual (${boardYear}).`
      );
    }

    const pdfGradeNum = extractLeadingGradeNumber(file.grade);
    if (boardGradeNum && pdfGradeNum && boardGradeNum !== pdfGradeNum) {
      warnings.push(
        `${file.fileName}: seriação do PDF (${file.grade}) difere da turma atual (${classGroupName}).`
      );
    }
  }

  return warnings;
}

function buildBoardSubjectLookup(
  subjects: Array<{ id: string; name: string; active: boolean; displayOrder: number }>
) {
  const byMatchKey = new Map<string, { id: string; name: string; active: boolean; displayOrder: number }>();
  for (const sub of subjects) {
    const key = toCouncilSubjectMatchKey(sub.name);
    if (key && !byMatchKey.has(key)) {
      byMatchKey.set(key, sub);
    }
  }
  return byMatchKey;
}

function buildBoardStudentLookup(
  cards: Array<{
    id: string;
    studentId: string;
    student: { id: string; name: string; active: boolean };
  }>
) {
  const byNormName = new Map<
    string,
    Array<{
      cardId: string;
      studentId: string;
      studentName: string;
      active: boolean;
    }>
  >();

  for (const card of cards) {
    const norm = normalizeStudentName(card.student.name);
    if (!norm) continue;
    const list = byNormName.get(norm) || [];
    list.push({
      cardId: card.id,
      studentId: card.studentId,
      studentName: card.student.name,
      active: card.student.active,
    });
    byNormName.set(norm, list);
  }

  return byNormName;
}

/**
 * Gera prévia sem escrita no banco para conferência humana antes da importação dos PDFs do SERE.
 */
export async function previewCouncilSerePdfImport(params: {
  boardId: string;
  schoolId: string;
  batch: MergedSereCouncilPdfBatch;
}): Promise<CouncilSerePdfPreviewResult> {
  const { boardId, schoolId, batch } = params;
  const board = await getCouncilBoardDetail(schoolId, boardId);
  if (!board) {
    throw new CouncilDomainError("Quadro do conselho de classe não encontrado.", 404);
  }

  const subjectLookup = buildBoardSubjectLookup(board.subjects);
  const studentLookup = buildBoardStudentLookup(board.studentCards);

  const subjects: CouncilSerePdfPreviewSubject[] = batch.subjects.map((subj) => {
    const existing =
      subjectLookup.get(subj.matchKey) ||
      subjectLookup.get(toCouncilSubjectMatchKey(subj.rawHeader)) ||
      null;
    return {
      rawHeader: subj.rawHeader,
      name: existing ? existing.name : subj.name,
      matchKey: subj.matchKey,
      status: existing ? "existing" : "new",
      existingSubjectId: existing ? existing.id : null,
      sourceFiles: subj.sourceFiles,
    };
  });

  const trimestersSet = new Set<SereCouncilTrimesterKey>();
  let studentsMatched = 0;
  let studentsUnmatched = 0;
  let studentsWithoutGrades = 0;
  let gradesToImport = 0;
  let belowAverageGrades = 0;

  const students: CouncilSerePdfPreviewStudent[] = batch.students.map((stu) => {
    const matches = studentLookup.get(stu.normalizedName) || [];
    const belowCount = stu.grades.filter((g) => g.grade < 6.0).length;

    if (!stu.hasAnyGrade) {
      studentsWithoutGrades += 1;
    }

    if (stu.isAmbiguousInPdf || matches.length > 1) {
      studentsUnmatched += 1;
      return {
        rowNumber: stu.rowNumber,
        pdfName: stu.rawName,
        matchedStudentId: null,
        matchedStudentName: null,
        gradesCount: stu.grades.length,
        belowAverageCount: belowCount,
        hasAnyGrade: stu.hasAnyGrade,
        status: "ambiguous",
      };
    }

    if (matches.length === 1) {
      const target = matches[0];
      studentsMatched += 1;
      gradesToImport += stu.grades.length;
      belowAverageGrades += belowCount;
      for (const g of stu.grades) {
        trimestersSet.add(g.trimester);
      }
      return {
        rowNumber: stu.rowNumber,
        pdfName: stu.rawName,
        matchedStudentId: target.studentId,
        matchedStudentName: target.studentName,
        gradesCount: stu.grades.length,
        belowAverageCount: belowCount,
        hasAnyGrade: stu.hasAnyGrade,
        status: "matched",
      };
    }

    studentsUnmatched += 1;
    return {
      rowNumber: stu.rowNumber,
      pdfName: stu.rawName,
      matchedStudentId: null,
      matchedStudentName: null,
      gradesCount: stu.grades.length,
      belowAverageCount: belowCount,
      hasAnyGrade: stu.hasAnyGrade,
      status: stu.hasAnyGrade ? "unmatched" : "unmatched_no_grades",
    };
  });

  const warnings = [
    ...batch.warnings,
    ...buildClassMetadataWarnings(
      batch.files,
      board.classGroup.name,
      board.classGroup.shift,
      board.year,
      true
    ),
  ];

  const ambiguousCount = students.filter((s) => s.status === "ambiguous").length;
  if (ambiguousCount > 0) {
    warnings.push(
      `${ambiguousCount} estudante(s) possuem homônimo exato na turma e foram ignorados para evitar associação incorreta.`
    );
  }

  if (studentsMatched === 0) {
    warnings.push(
      "Nenhum estudante do PDF foi localizado nesta turma. Verifique se o relatório corresponde à turma selecionada."
    );
  }

  const subjectsMatched = subjects.filter((s) => s.status === "existing").length;
  const subjectsToCreate = subjects.filter((s) => s.status === "new").length;
  const trimestersTouched = Array.from(trimestersSet).sort((a, b) => a - b) as SereCouncilTrimesterKey[];

  const resolvedPdfShift = resolveConsistentPdfShift(batch.files);
  const currentBoardShift = normalizeShiftToken(board.classGroup.shift);
  const detectedShift =
    resolvedPdfShift && resolvedPdfShift !== currentBoardShift ? resolvedPdfShift : null;

  return {
    boardId: board.id,
    classGroupName: board.classGroup.name,
    classGroupShift: board.classGroup.shift,
    detectedShift,
    year: board.year,
    files: batch.files,
    subjects,
    students,
    trimestersTouched,
    summary: {
      filesCount: batch.files.length,
      subjectsTotal: subjects.length,
      subjectsMatched,
      subjectsToCreate,
      studentsInPdf: batch.students.length,
      studentsMatched,
      studentsUnmatched,
      studentsWithoutGrades,
      gradesToImport,
      belowAverageGrades,
    },
    warnings,
  };
}

/**
 * Aplica de forma não-destrutiva as notas extraídas de 1 ou mais PDFs do SERE no quadro da turma:
 * - Cria apenas disciplinas novas, preservando todas as disciplinas anteriores (suporte a 2 matrizes na 3ª Série)
 *   e mantendo teacherName/teacherEmail já cadastrados.
 * - Mescla descritivos preservando 100% dos códigos manuais (3, 4, 5).
 * - Atualiza belowAvgJson por trimestre preservando lançamentos manuais (!subjectId) e disciplinas de outras matrizes.
 * - Preserva 100% dos textos qualitativos, pareceres e selos (ALUNO_COM_LAUDO, AEE, etc.).
 */
export async function applyCouncilSerePdfImport(params: {
  boardId: string;
  schoolId: string;
  batch: MergedSereCouncilPdfBatch;
  actor: AuditUser;
  req?: Request | Headers | null;
  confirmShiftUpdate?: boolean;
}): Promise<{
  board: Awaited<ReturnType<typeof getCouncilBoardDetail>>;
  summary: CouncilSerePdfApplySummary;
}> {
  const { boardId, schoolId, batch, actor, req, confirmShiftUpdate = false } = params;
  const board = await getCouncilBoardDetail(schoolId, boardId);
  if (!board) {
    throw new CouncilDomainError("Quadro do conselho de classe não encontrado.", 404);
  }

  const subjectLookup = buildBoardSubjectLookup(board.subjects);
  const studentLookup = buildBoardStudentLookup(board.studentCards);

  // 1. Garante que todas as disciplinas presentes no lote existam no quadro (sem apagar existentes)
  let nextDisplayOrder =
    board.subjects.reduce((max, s) => Math.max(max, s.displayOrder ?? 0), 0) + 1;
  const resolvedSubjectByMatchKey = new Map<
    string,
    { id: string; name: string; displayOrder: number }
  >();
  let subjectsCreated = 0;
  let subjectsMatched = 0;

  for (const subj of batch.subjects) {
    const existing =
      subjectLookup.get(subj.matchKey) ||
      subjectLookup.get(toCouncilSubjectMatchKey(subj.rawHeader)) ||
      null;

    if (existing) {
      subjectsMatched += 1;
      // Se estava inativa, reativa mantendo professor/e-mail existentes
      if (!existing.active) {
        await prisma.classCouncilSubject.update({
          where: { id: existing.id },
          data: { active: true },
        });
      }
      resolvedSubjectByMatchKey.set(subj.matchKey, {
        id: existing.id,
        name: existing.name,
        displayOrder: existing.displayOrder,
      });
    } else {
      try {
        const created = await prisma.classCouncilSubject.create({
          data: {
            schoolId,
            boardId: board.id,
            name: subj.name,
            displayOrder: nextDisplayOrder++,
            active: true,
          },
          select: { id: true, name: true, displayOrder: true },
        });
        subjectsCreated += 1;
        resolvedSubjectByMatchKey.set(subj.matchKey, created);
        subjectLookup.set(toCouncilSubjectMatchKey(created.name), {
          ...created,
          active: true,
        });
      } catch (err) {
        if ((err as { code?: string })?.code !== "P2002") {
          throw err;
        }
        const conflicted =
          (await prisma.classCouncilSubject.findUnique?.({
            where: { boardId_name: { boardId: board.id, name: subj.name } },
            select: { id: true, name: true, displayOrder: true, active: true },
          })) ??
          (await prisma.classCouncilSubject.findFirst?.({
            where: { boardId: board.id, schoolId, name: subj.name },
            select: { id: true, name: true, displayOrder: true, active: true },
          })) ??
          null;

        if (!conflicted) {
          throw err;
        }
        if (!conflicted.active) {
          await prisma.classCouncilSubject.update({
            where: { id: conflicted.id },
            data: { active: true },
          });
        }
        subjectsMatched += 1;
        const resolvedConflicted = {
          id: conflicted.id,
          name: conflicted.name,
          displayOrder: conflicted.displayOrder,
        };
        resolvedSubjectByMatchKey.set(subj.matchKey, resolvedConflicted);
        subjectLookup.set(toCouncilSubjectMatchKey(conflicted.name), {
          ...resolvedConflicted,
          active: true,
        });
      }
    }
  }

  // Mapa rápido de avaliações existentes por cardId -> `${subjectId}|${trimester}`
  const existingEvalByCardId = new Map<
    string,
    Map<string, { subjectId: string; trimester: number; descriptorCodes: number[]; grade: number | null }>
  >();
  for (const card of board.studentCards) {
    const map = new Map<
      string,
      { subjectId: string; trimester: number; descriptorCodes: number[]; grade: number | null }
    >();
    for (const ev of card.subjectEntries || []) {
      map.set(`${ev.subjectId}|${ev.trimester}`, {
        subjectId: ev.subjectId,
        trimester: ev.trimester,
        descriptorCodes: ev.descriptorCodes || [],
        grade: ev.grade ?? null,
      });
    }
    existingEvalByCardId.set(card.id, map);
  }

  // Mapa completo de disciplinas ativas do quadro (anteriores + recém-criadas)
  const activeSubjectById = new Map<string, { id: string; name: string; displayOrder: number }>();
  for (const s of board.subjects) {
    if (s.active) {
      activeSubjectById.set(s.id, { id: s.id, name: s.name, displayOrder: s.displayOrder });
    }
  }
  for (const s of resolvedSubjectByMatchKey.values()) {
    activeSubjectById.set(s.id, s);
  }

  // 2. Prepara upserts de StudentCouncilEvaluation preservando descritivos manuais (3, 4, 5)
  const evaluationUpserts: Array<{
    cardId: string;
    subjectId: string;
    trimester: SereCouncilTrimesterKey;
    descriptorCodes: number[];
    grade: number;
  }> = [];
  const touchedCardTrimesters = new Map<string, Set<SereCouncilTrimesterKey>>();
  const trimestersSet = new Set<SereCouncilTrimesterKey>();

  let studentsMatched = 0;
  let studentsUnmatched = 0;
  let belowAverageGrades = 0;

  for (const stu of batch.students) {
    const matches = studentLookup.get(stu.normalizedName) || [];
    if (stu.isAmbiguousInPdf || matches.length !== 1) {
      studentsUnmatched += 1;
      continue;
    }

    studentsMatched += 1;
    const targetCardId = matches[0].cardId;
    const cardEvalMap = existingEvalByCardId.get(targetCardId) || new Map();
    if (!existingEvalByCardId.has(targetCardId)) {
      existingEvalByCardId.set(targetCardId, cardEvalMap);
    }

    for (const g of stu.grades) {
      const resolvedSub = resolvedSubjectByMatchKey.get(g.subjectMatchKey);
      if (!resolvedSub) continue;

      const cellKey = `${resolvedSub.id}|${g.trimester}`;
      const existingEval = cardEvalMap.get(cellKey);
      const mergedCodes = mergeBiDescriptorCodes(existingEval?.descriptorCodes || [], g.grade);

      evaluationUpserts.push({
        cardId: targetCardId,
        subjectId: resolvedSub.id,
        trimester: g.trimester,
        descriptorCodes: mergedCodes,
        grade: g.grade,
      });

      cardEvalMap.set(cellKey, {
        subjectId: resolvedSub.id,
        trimester: g.trimester,
        descriptorCodes: mergedCodes,
        grade: g.grade,
      });

      if (g.grade < 6.0) {
        belowAverageGrades += 1;
      }

      trimestersSet.add(g.trimester);
      let cardTris = touchedCardTrimesters.get(targetCardId);
      if (!cardTris) {
        cardTris = new Set();
        touchedCardTrimesters.set(targetCardId, cardTris);
      }
      cardTris.add(g.trimester);
    }
  }

  // Persiste avaliações em lotes seguros
  for (let i = 0; i < evaluationUpserts.length; i += 100) {
    const chunk = evaluationUpserts.slice(i, i + 100);
    await prisma.$transaction(
      chunk.map((item) =>
        prisma.studentCouncilSubjectEntry.upsert({
          where: {
            cardId_subjectId_trimester: {
              cardId: item.cardId,
              subjectId: item.subjectId,
              trimester: item.trimester,
            },
          },
          create: {
            schoolId,
            cardId: item.cardId,
            subjectId: item.subjectId,
            trimester: item.trimester,
            descriptorCodes: item.descriptorCodes,
            grade: item.grade,
            updatedByEmail: actor.email,
          },
          update: {
            descriptorCodes: item.descriptorCodes,
            grade: item.grade,
            updatedByEmail: actor.email,
          },
        })
      )
    );
  }

  // 3. Atualiza trimester{1,2,3}BelowAvgJson preservando itens manuais (!subjectId) e outras disciplinas já salvas
  const cardUpdates: Array<{
    cardId: string;
    data: {
      trimester1BelowAvgJson?: string | null;
      trimester2BelowAvgJson?: string | null;
      trimester3BelowAvgJson?: string | null;
    };
  }> = [];

  for (const card of board.studentCards) {
    const touchedTris = touchedCardTrimesters.get(card.id);
    if (!touchedTris || touchedTris.size === 0) continue;

    const cardEvalMap = existingEvalByCardId.get(card.id)!;
    const updateData: {
      trimester1BelowAvgJson?: string | null;
      trimester2BelowAvgJson?: string | null;
      trimester3BelowAvgJson?: string | null;
    } = {};
    let hasChange = false;

    for (const tri of touchedTris) {
      const existingJson =
        tri === 1
          ? card.trimester1BelowAvgJson
          : tri === 2
            ? card.trimester2BelowAvgJson
            : card.trimester3BelowAvgJson;

      // Recompõe abaixo da média a partir de TODAS as avaliações ativas da ficha naquele trimestre
      // (preserva disciplinas de outra matriz, itens manuais sem subjectId e registros da Ficha sem nota na matriz)
      const trimesterEntries = Array.from(cardEvalMap.values()).filter(
        (entry) => entry.trimester === tri && activeSubjectById.has(entry.subjectId)
      );
      const matrixGradedSubjectIds = new Set(
        trimesterEntries
          .filter((entry) => entry.grade !== null && entry.grade !== undefined)
          .map((entry) => entry.subjectId)
      );

      const belowFromMatrix: CouncilBelowAvgItem[] = trimesterEntries
        .filter(
          (entry) =>
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
            grade: entry.grade as number,
          };
        });

      const belowFromMatrixSubjectIds = new Set(belowFromMatrix.map((item) => item.subjectId));

      const preservedExistingItems = parseBelowAverageJson(existingJson).filter(
        (item) =>
          !item.subjectId ||
          (!matrixGradedSubjectIds.has(item.subjectId) &&
            !belowFromMatrixSubjectIds.has(item.subjectId))
      );

      const mergedList = [...belowFromMatrix, ...preservedExistingItems];
      const nextJson = mergedList.length > 0 ? JSON.stringify(mergedList) : null;

      if (nextJson !== (existingJson ?? null)) {
        if (tri === 1) updateData.trimester1BelowAvgJson = nextJson;
        if (tri === 2) updateData.trimester2BelowAvgJson = nextJson;
        if (tri === 3) updateData.trimester3BelowAvgJson = nextJson;
        hasChange = true;
      }
    }

    if (hasChange) {
      cardUpdates.push({ cardId: card.id, data: updateData });
    }
  }

  for (let i = 0; i < cardUpdates.length; i += 100) {
    const chunk = cardUpdates.slice(i, i + 100);
    await prisma.$transaction(
      chunk.map((cu) =>
        prisma.studentCouncilCard.update({
          where: { id: cu.cardId },
          data: cu.data,
        })
      )
    );
  }

  const resolvedPdfShift = resolveConsistentPdfShift(batch.files);
  const currentBoardShift = normalizeShiftToken(board.classGroup.shift);
  let shiftUpdatedTo: string | null = null;
  if (confirmShiftUpdate && resolvedPdfShift && resolvedPdfShift !== currentBoardShift) {
    if (typeof prisma.classGroup?.updateMany === "function") {
      const updated = await prisma.classGroup.updateMany({
        where: { id: board.classGroup.id, schoolId },
        data: { shift: resolvedPdfShift },
      });
      if ((updated?.count ?? 1) > 0) {
        shiftUpdatedTo = resolvedPdfShift;
      }
    }
  }

  const trimestersTouched = Array.from(trimestersSet).sort((a, b) => a - b) as SereCouncilTrimesterKey[];
  const warnings = [
    ...batch.warnings,
    ...(!confirmShiftUpdate && resolvedPdfShift && resolvedPdfShift !== currentBoardShift
      ? [
          `O PDF informa turno ${formatShiftPtBr(resolvedPdfShift)}, diferente do turno atual da turma (${formatShiftPtBr(board.classGroup.shift)}). Nenhuma alteração automática de turno foi aplicada.`,
        ]
      : []),
    ...buildClassMetadataWarnings(
      batch.files,
      board.classGroup.name,
      shiftUpdatedTo ?? board.classGroup.shift,
      board.year,
      false
    ),
  ];

  // Auditoria sem PII (apenas contadores agregados e schoolId na raiz)
  await logAudit({
    action: "IMPORT_COUNCIL_SERE_PDF",
    entityType: "ClassCouncilBoard",
    entityId: board.id,
    schoolId,
    user: actor,
    req,
    details: {
      year: board.year,
      filesCount: batch.files.length,
      subjectsCreated,
      subjectsMatched,
      studentsMatched,
      studentsUnmatched,
      evaluationsUpserted: evaluationUpserts.length,
      cardsUpdated: cardUpdates.length,
      belowAverageGrades,
      trimestersTouched,
      ...(shiftUpdatedTo ? { shiftUpdatedTo } : {}),
    },
  });

  const refreshedBoard = await getCouncilBoardDetail(schoolId, board.id);

  return {
    board: refreshedBoard,
    summary: {
      filesCount: batch.files.length,
      subjectsCreated,
      subjectsMatched,
      studentsMatched,
      studentsUnmatched,
      evaluationsUpserted: evaluationUpserts.length,
      cardsUpdated: cardUpdates.length,
      belowAverageGrades,
      trimestersTouched,
      warnings,
    },
  };
}
