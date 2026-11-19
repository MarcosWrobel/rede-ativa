import {
  getCardBelowAvgForTrimester,
  getCardOpinionForTrimester,
  isBelowAverageGradeUi,
  type CouncilBoardDetailRecord,
  type CouncilStudentCardRecord,
  type CouncilSubjectRecord,
  type CouncilTrimesterNumber,
} from "./types";

export type StudentPriorityLevel = "CRITICAL" | "ATTENTION" | "REGULAR";

export type AnalysisSortMode = "PRIORITY" | "BELOW_AVG" | "ATTENDANCE" | "NAME";

export type AnalysisQuickFilter =
  | "ALL"
  | "CRITICAL"
  | "ATTENTION"
  | "REGULAR"
  | "BELOW_AVG"
  | "LOW_ATTENDANCE"
  | "DIFFICULTY"
  | "CONDUCT"
  | "INFREQUENCY"
  | "CORR_INFREQ_BELOW"
  | "CORR_CONDUCT_BELOW"
  | "CORR_DIFFICULTY_REGULAR_ATT"
  | "HIGHLIGHTS";

export interface StudentSubjectCellSummary {
  subjectId: string;
  subjectName: string;
  shortName: string;
  teacherName: string | null;
  grade: number | null;
  isBelowAvg: boolean;
  descriptorCodes: number[];
  hasAlertDescriptor: boolean;
  prevGrade: number | null;
  gradeDelta: number | null;
}

export interface StudentTrimesterComparison {
  prevTrimester: CouncilTrimesterNumber;
  hasPrevData: boolean;
  prevBelowAvgCount: number;
  belowAvgDelta: number;
  prevAverageGrade: number | null;
  averageGradeDelta: number | null;
  trend: "IMPROVED" | "WORSENED" | "STABLE" | "NONE";
}

export interface StudentAnalyticsSummary {
  card: CouncilStudentCardRecord;
  studentId: string;
  studentName: string;
  isActiveEnrollment: boolean;
  priority: StudentPriorityLevel;
  priorityScore: number;
  attendancePercent: number | null;
  hasLowAttendance: boolean;
  belowAvgCount: number;
  belowAvgItems: Array<{
    subjectId: string | null;
    subjectName: string;
    shortName: string;
    grade: number | null;
  }>;
  descriptorCounts: Record<1 | 2 | 3 | 4 | 5, number>;
  alertDescriptorTotal: number;
  averageGrade: number | null;
  opinion: string;
  prevOpinion: string;
  subjectCells: StudentSubjectCellSummary[];
  comparison: StudentTrimesterComparison | null;
  isHighlight: boolean;
}

export interface SubjectAnalyticsSummary {
  subject: CouncilSubjectRecord;
  subjectId: string;
  subjectName: string;
  shortName: string;
  teacherName: string | null;
  totalActiveStudents: number;
  evaluatedCount: number;
  gradedCount: number;
  belowAvgCount: number;
  belowAvgPercent: number;
  difficultyCount: number;
  conductCount: number;
  infrequencyCount: number;
  atendeCount: number;
  averageGrade: number | null;
  attentionScore: number;
}

export interface ClassCouncilCorrelations {
  lowAttendanceAndBelowAvg: number;
  conductAndBelowAvg: number;
  difficultyWithRegularAttendance: number;
  highlights: number;
}

export interface ClassCouncilAnalytics {
  activeTrimester: CouncilTrimesterNumber;
  prevTrimester: CouncilTrimesterNumber | null;
  activeStudentsCount: number;
  totalStudentsCount: number;
  criticalCount: number;
  attentionCount: number;
  regularCount: number;
  belowAvgStudentsCount: number;
  lowAttendanceStudentsCount: number;
  correlations: ClassCouncilCorrelations;
  students: StudentAnalyticsSummary[];
  subjects: SubjectAnalyticsSummary[];
}

const KNOWN_SUBJECT_ABBREVIATIONS: Array<{ pattern: RegExp; abbr: string }> = [
  { pattern: /^l[ií]ngua portuguesa|^portugu[eê]s/i, abbr: "PORT" },
  { pattern: /^matem[aá]tica/i, abbr: "MAT" },
  { pattern: /^hist[oó]ria/i, abbr: "HIST" },
  { pattern: /^geografia/i, abbr: "GEO" },
  { pattern: /^ci[eê]ncias/i, abbr: "CIÊN" },
  { pattern: /^biologia/i, abbr: "BIO" },
  { pattern: /^f[ií]sica/i, abbr: "FÍS" },
  { pattern: /^qu[ií]mica/i, abbr: "QUÍM" },
  { pattern: /^educa[cç][aã]o f[ií]sica/i, abbr: "ED.F" },
  { pattern: /^l[ií]ngua inglesa|^ingl[eê]s/i, abbr: "ING" },
  { pattern: /^l[ií]ngua espanhola|^espanhol/i, abbr: "ESP" },
  { pattern: /^arte/i, abbr: "ARTE" },
  { pattern: /^filosofia/i, abbr: "FIL" },
  { pattern: /^sociologia/i, abbr: "SOC" },
  { pattern: /^projeto de vida/i, abbr: "P.VID" },
  { pattern: /^pensamento computacional/i, abbr: "COMP" },
  { pattern: /^educa[cç][aã]o financeira/i, abbr: "FIN" },
  { pattern: /^ensino religioso/i, abbr: "REL" },
  { pattern: /^reda[cç][aã]o/i, abbr: "RED" },
  { pattern: /^literatura/i, abbr: "LIT" },
  { pattern: /^rob[oó]tica/i, abbr: "ROB" },
  { pattern: /^empreendedorismo/i, abbr: "EMP" },
];

const HIGHLIGHT_TAGS = new Set([
  "DESTAQUE_DA_TURMA",
  "ESTUDANTE_SUPERACAO",
  "ESTUDANTE_MONITOR",
  "DESTAQUE_INTEGRADO_NOTA_INTEGRA",
]);

const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "com", "a", "o"]);

export function abbreviateSubjectName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "COMP";

  for (const item of KNOWN_SUBJECT_ABBREVIATIONS) {
    if (item.pattern.test(trimmed)) {
      return item.abbr;
    }
  }

  const words = trimmed
    .split(/[\s/\-–]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()));

  if (words.length === 0) {
    return trimmed.slice(0, 4).toUpperCase();
  }

  if (words.length === 1) {
    return words[0].slice(0, 4).toUpperCase();
  }

  if (words.length === 2) {
    return `${words[0].slice(0, 2)}.${words[1].slice(0, 2)}`.toUpperCase();
  }

  return words
    .slice(0, 4)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function normalizeSubjectKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function computeMean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

function getBelowAvgSummaryForTrimester(
  card: CouncilStudentCardRecord,
  activeSubjects: CouncilSubjectRecord[],
  trimester: CouncilTrimesterNumber
): Array<{
  subjectId: string | null;
  subjectName: string;
  shortName: string;
  grade: number | null;
}> {
  const byKey = new Map<
    string,
    { subjectId: string | null; subjectName: string; shortName: string; grade: number | null }
  >();

  const subjectById = new Map(activeSubjects.map((s) => [s.id, s]));

  for (const entry of card.subjectEntries) {
    if (entry.trimester !== trimester) continue;
    if (!isBelowAverageGradeUi(entry.grade)) continue;
    const subj = subjectById.get(entry.subjectId);
    if (!subj) continue;
    const key = normalizeSubjectKey(subj.name);
    byKey.set(key, {
      subjectId: subj.id,
      subjectName: subj.name,
      shortName: abbreviateSubjectName(subj.name),
      grade: entry.grade,
    });
  }

  const persisted = getCardBelowAvgForTrimester(card, trimester);
  for (const item of persisted) {
    const key = normalizeSubjectKey(item.subjectName);
    if (!byKey.has(key)) {
      byKey.set(key, {
        subjectId: item.subjectId ?? null,
        subjectName: item.subjectName,
        shortName: abbreviateSubjectName(item.subjectName),
        grade: item.grade,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const ga = a.grade ?? Number.POSITIVE_INFINITY;
    const gb = b.grade ?? Number.POSITIVE_INFINITY;
    if (ga !== gb) return ga - gb;
    return a.subjectName.localeCompare(b.subjectName, "pt-BR");
  });
}

export function buildClassCouncilAnalytics(
  board: CouncilBoardDetailRecord,
  activeTrimester: CouncilTrimesterNumber
): ClassCouncilAnalytics {
  const activeSubjects = board.subjects.filter((s) => s.active);
  const prevTrimester: CouncilTrimesterNumber | null =
    activeTrimester === 3 ? 2 : activeTrimester === 2 ? 1 : null;

  const activeEnrollmentCards = board.studentCards.filter((c) => c.enrollmentStatus === "ATIVO");
  const activeStudentsCount = activeEnrollmentCards.length;
  const totalStudentsCount = board.studentCards.length;

  const subjectAccumulators = new Map<
    string,
    {
      subject: CouncilSubjectRecord;
      shortName: string;
      evaluatedCount: number;
      grades: number[];
      belowAvgCount: number;
      difficultyCount: number;
      conductCount: number;
      infrequencyCount: number;
      atendeCount: number;
    }
  >();

  for (const subj of activeSubjects) {
    subjectAccumulators.set(subj.id, {
      subject: subj,
      shortName: abbreviateSubjectName(subj.name),
      evaluatedCount: 0,
      grades: [],
      belowAvgCount: 0,
      difficultyCount: 0,
      conductCount: 0,
      infrequencyCount: 0,
      atendeCount: 0,
    });
  }

  const students: StudentAnalyticsSummary[] = board.studentCards.map((card) => {
    const isActiveEnrollment = card.enrollmentStatus === "ATIVO";
    const attendancePercent = card.student.lowAttendanceRecord?.attendancePercent ?? null;
    const hasLowAttendance = attendancePercent !== null && attendancePercent < 75;

    const currentEntriesBySubject = new Map<string, { descriptorCodes: number[]; grade: number | null }>();
    const prevEntriesBySubject = new Map<string, { descriptorCodes: number[]; grade: number | null }>();

    for (const entry of card.subjectEntries) {
      if (entry.trimester === activeTrimester) {
        currentEntriesBySubject.set(entry.subjectId, {
          descriptorCodes: entry.descriptorCodes || [],
          grade: entry.grade ?? null,
        });
      } else if (prevTrimester !== null && entry.trimester === prevTrimester) {
        prevEntriesBySubject.set(entry.subjectId, {
          descriptorCodes: entry.descriptorCodes || [],
          grade: entry.grade ?? null,
        });
      }
    }

    const descriptorCounts: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    const currentGrades: number[] = [];
    const prevGrades: number[] = [];

    const subjectCells: StudentSubjectCellSummary[] = activeSubjects.map((subj) => {
      const current = currentEntriesBySubject.get(subj.id);
      const prev = prevEntriesBySubject.get(subj.id);
      const descriptorCodes = current?.descriptorCodes ?? [];
      const grade = current?.grade ?? null;
      const prevGrade = prev?.grade ?? null;
      const isBelowAvg = isBelowAverageGradeUi(grade);

      if (grade !== null && Number.isFinite(grade)) {
        currentGrades.push(grade);
      }
      if (prevGrade !== null && Number.isFinite(prevGrade)) {
        prevGrades.push(prevGrade);
      }

      for (const code of descriptorCodes) {
        if (code === 1 || code === 2 || code === 3 || code === 4 || code === 5) {
          descriptorCounts[code] += 1;
        }
      }

      const hasAlertDescriptor = descriptorCodes.some((c) => c === 2 || c === 3 || c === 4);

      // Agrega métricas do componente considerando estudantes ativos (ou todos se não houver ativos)
      if (isActiveEnrollment || activeStudentsCount === 0) {
        const acc = subjectAccumulators.get(subj.id);
        if (acc) {
          if (descriptorCodes.length > 0) acc.evaluatedCount += 1;
          if (grade !== null && Number.isFinite(grade)) {
            acc.grades.push(grade);
          }
          if (isBelowAvg) acc.belowAvgCount += 1;
          if (descriptorCodes.includes(2)) acc.difficultyCount += 1;
          if (descriptorCodes.includes(3)) acc.conductCount += 1;
          if (descriptorCodes.includes(4)) acc.infrequencyCount += 1;
          if (descriptorCodes.includes(1)) acc.atendeCount += 1;
        }
      }

      const gradeDelta =
        grade !== null && prevGrade !== null
          ? Math.round((grade - prevGrade) * 100) / 100
          : null;

      return {
        subjectId: subj.id,
        subjectName: subj.name,
        shortName: abbreviateSubjectName(subj.name),
        teacherName: subj.teacherName,
        grade,
        isBelowAvg,
        descriptorCodes,
        hasAlertDescriptor,
        prevGrade,
        gradeDelta,
      };
    });

    const belowAvgItems = getBelowAvgSummaryForTrimester(card, activeSubjects, activeTrimester);
    const belowAvgCount = belowAvgItems.length;
    const alertDescriptorTotal =
      descriptorCounts[2] + descriptorCounts[3] + descriptorCounts[4];
    const averageGrade = computeMean(currentGrades);

    let priority: StudentPriorityLevel = "REGULAR";
    if (hasLowAttendance || belowAvgCount >= 3 || alertDescriptorTotal >= 3) {
      priority = "CRITICAL";
    } else if (belowAvgCount >= 1 || alertDescriptorTotal >= 1) {
      priority = "ATTENTION";
    }

    const baseScore =
      (hasLowAttendance ? 40 : 0) +
      belowAvgCount * 15 +
      descriptorCounts[3] * 10 +
      descriptorCounts[4] * 10 +
      descriptorCounts[2] * 8;
    const priorityScore = isActiveEnrollment ? baseScore : baseScore - 1000;

    let comparison: StudentTrimesterComparison | null = null;
    if (prevTrimester !== null) {
      const prevBelowItems = getBelowAvgSummaryForTrimester(card, activeSubjects, prevTrimester);
      const prevBelowAvgCount = prevBelowItems.length;
      const prevAverageGrade = computeMean(prevGrades);
      const hasPrevData = prevGrades.length > 0 || prevBelowAvgCount > 0 || prevEntriesBySubject.size > 0;
      const belowAvgDelta = belowAvgCount - prevBelowAvgCount;
      const averageGradeDelta =
        averageGrade !== null && prevAverageGrade !== null
          ? Math.round((averageGrade - prevAverageGrade) * 100) / 100
          : null;

      let trend: StudentTrimesterComparison["trend"] = "NONE";
      if (hasPrevData) {
        if (belowAvgDelta < 0 || (belowAvgDelta === 0 && averageGradeDelta !== null && averageGradeDelta >= 0.5)) {
          trend = "IMPROVED";
        } else if (
          belowAvgDelta > 0 ||
          (belowAvgDelta === 0 && averageGradeDelta !== null && averageGradeDelta <= -0.5)
        ) {
          trend = "WORSENED";
        } else {
          trend = "STABLE";
        }
      }

      comparison = {
        prevTrimester,
        hasPrevData,
        prevBelowAvgCount,
        belowAvgDelta,
        prevAverageGrade,
        averageGradeDelta,
        trend,
      };
    }

    const hasHighlightTag = card.tags.some((t) => HIGHLIGHT_TAGS.has(t));
    const isHighlight =
      isActiveEnrollment &&
      (hasHighlightTag ||
        (belowAvgCount === 0 &&
          !hasLowAttendance &&
          alertDescriptorTotal === 0 &&
          descriptorCounts[1] > 0));

    return {
      card,
      studentId: card.studentId,
      studentName: card.student.name,
      isActiveEnrollment,
      priority,
      priorityScore,
      attendancePercent,
      hasLowAttendance,
      belowAvgCount,
      belowAvgItems,
      descriptorCounts,
      alertDescriptorTotal,
      averageGrade,
      opinion: getCardOpinionForTrimester(card, activeTrimester),
      prevOpinion: prevTrimester ? getCardOpinionForTrimester(card, prevTrimester) : "",
      subjectCells,
      comparison,
      isHighlight,
    };
  });

  const subjects: SubjectAnalyticsSummary[] = Array.from(subjectAccumulators.values())
    .map((acc) => {
      const denom = activeStudentsCount > 0 ? activeStudentsCount : totalStudentsCount;
      const belowAvgPercent =
        denom > 0 ? Math.round((acc.belowAvgCount / denom) * 100) : 0;
      const attentionScore =
        acc.belowAvgCount * 3 +
        acc.difficultyCount * 2 +
        acc.conductCount * 2 +
        acc.infrequencyCount;

      return {
        subject: acc.subject,
        subjectId: acc.subject.id,
        subjectName: acc.subject.name,
        shortName: acc.shortName,
        teacherName: acc.subject.teacherName,
        totalActiveStudents: denom,
        evaluatedCount: acc.evaluatedCount,
        gradedCount: acc.grades.length,
        belowAvgCount: acc.belowAvgCount,
        belowAvgPercent,
        difficultyCount: acc.difficultyCount,
        conductCount: acc.conductCount,
        infrequencyCount: acc.infrequencyCount,
        atendeCount: acc.atendeCount,
        averageGrade: computeMean(acc.grades),
        attentionScore,
      };
    })
    .sort((a, b) => {
      if (b.attentionScore !== a.attentionScore) return b.attentionScore - a.attentionScore;
      if (b.belowAvgCount !== a.belowAvgCount) return b.belowAvgCount - a.belowAvgCount;
      return a.subjectName.localeCompare(b.subjectName, "pt-BR");
    });

  const activeSummaries = students.filter((s) => s.isActiveEnrollment);
  const kpiScope = activeSummaries.length > 0 ? activeSummaries : students;

  let criticalCount = 0;
  let attentionCount = 0;
  let regularCount = 0;
  let belowAvgStudentsCount = 0;
  let lowAttendanceStudentsCount = 0;
  let lowAttendanceAndBelowAvg = 0;
  let conductAndBelowAvg = 0;
  let difficultyWithRegularAttendance = 0;
  let highlights = 0;

  for (const s of kpiScope) {
    if (s.priority === "CRITICAL") criticalCount += 1;
    else if (s.priority === "ATTENTION") attentionCount += 1;
    else regularCount += 1;

    if (s.belowAvgCount > 0) belowAvgStudentsCount += 1;
    if (s.hasLowAttendance) lowAttendanceStudentsCount += 1;
    if (s.hasLowAttendance && s.belowAvgCount > 0) lowAttendanceAndBelowAvg += 1;
    if (s.descriptorCounts[3] > 0 && s.belowAvgCount > 0) conductAndBelowAvg += 1;
    if (!s.hasLowAttendance && (s.descriptorCounts[2] > 0 || s.belowAvgCount > 0)) {
      difficultyWithRegularAttendance += 1;
    }
    if (s.isHighlight) highlights += 1;
  }

  return {
    activeTrimester,
    prevTrimester,
    activeStudentsCount,
    totalStudentsCount,
    criticalCount,
    attentionCount,
    regularCount,
    belowAvgStudentsCount,
    lowAttendanceStudentsCount,
    correlations: {
      lowAttendanceAndBelowAvg,
      conductAndBelowAvg,
      difficultyWithRegularAttendance,
      highlights,
    },
    students,
    subjects,
  };
}

export function filterAndSortStudentAnalytics(
  students: StudentAnalyticsSummary[],
  options: {
    searchTerm: string;
    quickFilter: AnalysisQuickFilter;
    subjectIdFilter: string;
    sortMode: AnalysisSortMode;
  }
): StudentAnalyticsSummary[] {
  const q = options.searchTerm.trim().toLowerCase();

  const filtered = students.filter((s) => {
    if (q) {
      const matchName = s.studentName.toLowerCase().includes(q);
      const matchCgm = (s.card.student.cgm || "").toLowerCase().includes(q);
      if (!matchName && !matchCgm) return false;
    }

    if (options.subjectIdFilter) {
      const cell = s.subjectCells.find((c) => c.subjectId === options.subjectIdFilter);
      if (!cell || (!cell.isBelowAvg && !cell.hasAlertDescriptor)) {
        return false;
      }
    }

    switch (options.quickFilter) {
      case "CRITICAL":
        return s.priority === "CRITICAL";
      case "ATTENTION":
        return s.priority === "ATTENTION";
      case "REGULAR":
        return s.priority === "REGULAR";
      case "BELOW_AVG":
        return s.belowAvgCount > 0;
      case "LOW_ATTENDANCE":
        return s.hasLowAttendance;
      case "DIFFICULTY":
        return s.descriptorCounts[2] > 0;
      case "CONDUCT":
        return s.descriptorCounts[3] > 0;
      case "INFREQUENCY":
        return s.descriptorCounts[4] > 0 || s.hasLowAttendance;
      case "CORR_INFREQ_BELOW":
        return s.hasLowAttendance && s.belowAvgCount > 0;
      case "CORR_CONDUCT_BELOW":
        return s.descriptorCounts[3] > 0 && s.belowAvgCount > 0;
      case "CORR_DIFFICULTY_REGULAR_ATT":
        return !s.hasLowAttendance && (s.descriptorCounts[2] > 0 || s.belowAvgCount > 0);
      case "HIGHLIGHTS":
        return s.isHighlight;
      case "ALL":
      default:
        return true;
    }
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (options.sortMode === "NAME") {
      return a.studentName.localeCompare(b.studentName, "pt-BR");
    }

    if (options.sortMode === "BELOW_AVG") {
      if (b.belowAvgCount !== a.belowAvgCount) return b.belowAvgCount - a.belowAvgCount;
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return a.studentName.localeCompare(b.studentName, "pt-BR");
    }

    if (options.sortMode === "ATTENDANCE") {
      const attA = a.attendancePercent ?? 999;
      const attB = b.attendancePercent ?? 999;
      if (attA !== attB) return attA - attB;
      return a.studentName.localeCompare(b.studentName, "pt-BR");
    }

    // PRIORITY (padrão)
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (b.belowAvgCount !== a.belowAvgCount) return b.belowAvgCount - a.belowAvgCount;
    return a.studentName.localeCompare(b.studentName, "pt-BR");
  });

  return sorted;
}

export function sortStudentCellsByCriticality(
  cells: StudentSubjectCellSummary[]
): StudentSubjectCellSummary[] {
  return [...cells].sort((a, b) => {
    const scoreA = (a.isBelowAvg ? 10 : 0) + (a.hasAlertDescriptor ? 5 : 0);
    const scoreB = (b.isBelowAvg ? 10 : 0) + (b.hasAlertDescriptor ? 5 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    const gradeA = a.grade ?? 999;
    const gradeB = b.grade ?? 999;
    if (gradeA !== gradeB) return gradeA - gradeB;
    return a.subjectName.localeCompare(b.subjectName, "pt-BR");
  });
}
