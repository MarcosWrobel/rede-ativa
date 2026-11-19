export type CouncilTrimesterNumber = 1 | 2 | 3;

export type CouncilEnrollmentStatus =
  | "ATIVO"
  | "TRANSFERIDO"
  | "REMANEJADO"
  | "ABANDONO";

export type CouncilSeatingMapMode =
  | "SEMANAL"
  | "REVEZAMENTO_MENSAL"
  | "FIXO"
  | "PERSONALIZADO";

export type CouncilStudentTag =
  | "ALUNO_COM_LAUDO"
  | "AEE"
  | "ESTUDANTE_MONITOR"
  | "LIDER_DE_TURMA"
  | "DESTAQUE_DA_TURMA"
  | "ESTUDANTE_SUPERACAO"
  | "DESTAQUE_INTEGRADO_NOTA_INTEGRA";

export type CouncilActionResponsible =
  | "FAMILIA"
  | "ESTUDANTE"
  | "ESCOLA"
  | "REDE_PROTECAO";

export interface CouncilDescriptorOption {
  code: 1 | 2 | 3 | 4 | 5;
  shortLabel: string;
  fullLabel: string;
  badgeClass: string;
  activeClass: string;
}

export const COUNCIL_DESCRIPTORS: CouncilDescriptorOption[] = [
  {
    code: 1,
    shortLabel: "Atende",
    fullLabel: "Atende às expectativas propostas para o componente/itinerário",
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    activeClass:
      "bg-emerald-600 text-white border-emerald-600 shadow-xs",
  },
  {
    code: 2,
    shortLabel: "Dificuldade",
    fullLabel: "Apresenta dificuldade de aprendizagem",
    badgeClass:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    activeClass:
      "bg-amber-500 text-white border-amber-500 shadow-xs",
  },
  {
    code: 3,
    shortLabel: "Conduta",
    fullLabel: "Conduta indisciplinar e alheio às normas e regras",
    badgeClass:
      "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
    activeClass:
      "bg-rose-600 text-white border-rose-600 shadow-xs",
  },
  {
    code: 4,
    shortLabel: "Infrequência",
    fullLabel: "Infrequência",
    badgeClass:
      "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800",
    activeClass:
      "bg-orange-600 text-white border-orange-600 shadow-xs",
  },
  {
    code: 5,
    shortLabel: "Assiduidade",
    fullLabel: "Assiduidade em atividades propostas em sala de aula e plataformas digitais",
    badgeClass:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
    activeClass:
      "bg-sky-600 text-white border-sky-600 shadow-xs",
  },
];

export interface CouncilStudentTagOption {
  value: CouncilStudentTag;
  label: string;
  shortLabel: string;
  isSensitiveHealth: boolean;
  badgeClass: string;
}

export const COUNCIL_STUDENT_TAG_OPTIONS: CouncilStudentTagOption[] = [
  {
    value: "ALUNO_COM_LAUDO",
    label: "Estudante com Laudo",
    shortLabel: "Com Laudo",
    isSensitiveHealth: true,
    badgeClass:
      "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800",
  },
  {
    value: "AEE",
    label: "AEE (Acompanhamento Pedagógico - Turno)",
    shortLabel: "AEE",
    isSensitiveHealth: true,
    badgeClass:
      "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-950/60 dark:text-fuchsia-300 dark:border-fuchsia-800",
  },
  {
    value: "ESTUDANTE_MONITOR",
    label: "Estudante Monitor",
    shortLabel: "Monitor",
    isSensitiveHealth: false,
    badgeClass:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
  },
  {
    value: "LIDER_DE_TURMA",
    label: "Líder de Turma",
    shortLabel: "Líder",
    isSensitiveHealth: false,
    badgeClass:
      "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800",
  },
  {
    value: "DESTAQUE_DA_TURMA",
    label: "Destaque da Turma",
    shortLabel: "Destaque",
    isSensitiveHealth: false,
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
  {
    value: "ESTUDANTE_SUPERACAO",
    label: "Estudante Superação",
    shortLabel: "Superação",
    isSensitiveHealth: false,
    badgeClass:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  },
  {
    value: "DESTAQUE_INTEGRADO_NOTA_INTEGRA",
    label: "Destaque Integrado / Nota Integra",
    shortLabel: "Nota Integra",
    isSensitiveHealth: false,
    badgeClass:
      "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800",
  },
];

export const COUNCIL_SEATING_MAP_LABELS: Record<CouncilSeatingMapMode, string> = {
  SEMANAL: "Revezamento semanal",
  REVEZAMENTO_MENSAL: "Revezamento mensal",
  FIXO: "Mapeamento fixo",
  PERSONALIZADO: "Organização personalizada",
};

export const COUNCIL_ENROLLMENT_STATUS_LABELS: Record<CouncilEnrollmentStatus, string> = {
  ATIVO: "Ativo",
  TRANSFERIDO: "Transferido",
  REMANEJADO: "Remanejado",
  ABANDONO: "Afastado / Abandono",
};

export const COUNCIL_ACTION_RESPONSIBLE_LABELS: Record<CouncilActionResponsible, string> = {
  ESCOLA: "Equipe escolar",
  ESTUDANTE: "Estudantes",
  FAMILIA: "Família / Responsáveis",
  REDE_PROTECAO: "Rede de apoio",
};

export const COMMON_CURRICULUM_PRESETS: string[] = [
  "Língua Portuguesa",
  "Matemática",
  "História",
  "Geografia",
  "Ciências",
  "Arte",
  "Educação Física",
  "Língua Inglesa",
  "Projeto de Vida",
  "Biologia",
  "Física",
  "Química",
  "Sociologia",
  "Filosofia",
];

export interface CouncilSubjectRecord {
  id: string;
  schoolId: string;
  boardId: string;
  name: string;
  teacherName: string | null;
  teacherEmail: string | null;
  displayOrder: number;
  active: boolean;
}

export interface CouncilTrimesterRecord {
  id: string;
  schoolId: string;
  boardId: string;
  trimester: number;
  status: string;
  positivePoints: string | null;
  attentionPoints: string | null;
  plannedActions: string | null;
  postCouncilHeldAt: string | Date | null;
  postCouncilAdvances: string | null;
  postCouncilWhatWorked: string | null;
  postCouncilRecognizedAttitudes: string | null;
  postCouncilCriticalSubjects: string | null;
  postCouncilPerformanceFactors: string | null;
  postCouncilBehaviorAttendance: string | null;
  postCouncilWhatToImprove: string | null;
  postCouncilHowTeachersCanHelp: string | null;
  postCouncilCommitments: string | null;
  postCouncilActionItemsJson: string | null;
  linkedMinuteId: string | null;
  updatedByName: string | null;
  updatedByEmail: string | null;
  updatedAt: string | Date;
}

export interface CouncilBelowAvgItem {
  subjectId?: string | null;
  subjectName: string;
  grade: number | null;
}

export interface CouncilPostActionItem {
  number: number;
  description: string;
  responsible: CouncilActionResponsible;
  dueDate?: string | null;
}

export interface CouncilSubjectEntryRecord {
  id: string;
  schoolId: string;
  cardId: string;
  subjectId: string;
  trimester: number;
  descriptorCodes: number[];
  grade: number | null;
}

export interface CouncilStudentSummary {
  id: string;
  name: string;
  cgm: string | null;
  active: boolean;
  isSpecialNeeds: boolean;
  isExchangeStudent: boolean;
  age: number | null;
  lowAttendanceRecord: {
    attendancePercent: number;
  } | null;
}

export interface CouncilStudentCardRecord {
  id: string;
  schoolId: string;
  boardId: string;
  studentId: string;
  enrollmentStatus: string;
  externalEvalEd1Percent: number | null;
  externalEvalEd2Percent: number | null;
  externalEvalEd3Percent: number | null;
  tags: string[];
  hasSensitiveHealthTag: boolean;
  trimester1Opinion: string | null;
  trimester2Opinion: string | null;
  trimester3Opinion: string | null;
  trimester1BelowAvgJson: string | null;
  trimester2BelowAvgJson: string | null;
  trimester3BelowAvgJson: string | null;
  student: CouncilStudentSummary;
  subjectEntries: CouncilSubjectEntryRecord[];
}

export interface CouncilClassGroupSummary {
  id: string;
  name: string;
  segment: string;
  shift: string;
}

export interface CouncilBoardDetailRecord {
  id: string;
  schoolId: string;
  classGroupId: string;
  year: number;
  peerLeaderStudentId: string | null;
  peerLeaderName: string | null;
  teacherLeaderStudentId: string | null;
  teacherLeaderName: string | null;
  externalEvalEd1Percent: number | null;
  externalEvalEd2Percent: number | null;
  externalEvalEd3Percent: number | null;
  seatingMapMode: string;
  seatingMapNotes: string | null;
  classGroup: CouncilClassGroupSummary;
  subjects: CouncilSubjectRecord[];
  trimesters: CouncilTrimesterRecord[];
  studentCards: CouncilStudentCardRecord[];
}

export interface CouncilIndexClassGroupItem {
  id: string;
  name: string;
  segment: string;
  shift: string;
  _count: {
    students: number;
  };
}

export interface CouncilIndexBoardItem {
  id: string;
  schoolId: string;
  classGroupId: string;
  year: number;
  peerLeaderName: string | null;
  teacherLeaderName: string | null;
  externalEvalEd1Percent: number | null;
  externalEvalEd2Percent: number | null;
  externalEvalEd3Percent: number | null;
  classGroup: CouncilClassGroupSummary;
  trimesters: Array<{
    id: string;
    trimester: number;
    status: string;
    linkedMinuteId: string | null;
    postCouncilHeldAt: string | Date | null;
    updatedAt: string | Date;
  }>;
  _count: {
    subjects: number;
    studentCards: number;
  };
}

export interface CouncilSourceBoardOption {
  id: string;
  classGroupName: string;
  shift: string;
  subjectsCount: number;
}

export interface SchoolPrintMeta {
  id: string;
  name: string;
  inepCode: string;
  city: string;
  state: string;
  nre: string;
  network?: string;
  logoUrl?: string | null;
}

export function parseBelowAverageList(raw: string | null | undefined): CouncilBelowAvgItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        subjectId: typeof item.subjectId === "string" ? item.subjectId : null,
        subjectName: typeof item.subjectName === "string" ? item.subjectName : "",
        grade: typeof item.grade === "number" && Number.isFinite(item.grade) ? item.grade : null,
      }))
      .filter((item) => item.subjectName.trim().length > 0);
  } catch {
    return [];
  }
}

export function parsePostActionItemsList(raw: string | null | undefined): CouncilPostActionItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, idx) => {
        const resp =
          item.responsible === "FAMILIA" ||
          item.responsible === "ESTUDANTE" ||
          item.responsible === "ESCOLA" ||
          item.responsible === "REDE_PROTECAO"
            ? item.responsible
            : "ESCOLA";
        return {
          number: typeof item.number === "number" && Number.isFinite(item.number) ? item.number : idx + 1,
          description: typeof item.description === "string" ? item.description : "",
          responsible: resp as CouncilActionResponsible,
          dueDate: typeof item.dueDate === "string" ? item.dueDate : null,
        };
      })
      .filter((item) => item.description.trim().length > 0);
  } catch {
    return [];
  }
}

export function formatShiftLabel(shift: string): string {
  const norm = shift.toUpperCase();
  if (norm === "MANHA") return "Manhã";
  if (norm === "TARDE") return "Tarde";
  if (norm === "NOITE") return "Noite";
  if (norm === "INTEGRAL") return "Integral";
  return shift;
}

export function formatSegmentLabel(segment: string): string {
  const norm = segment.toUpperCase();
  if (norm === "FUNDAMENTAL") return "Ensino Fundamental";
  if (norm === "MEDIO") return "Ensino Médio";
  if (norm === "NOTURNO") return "Ensino Noturno";
  if (norm === "INFANTIL") return "Educação Infantil";
  if (norm === "EJA") return "EJA";
  return segment;
}

export function isBelowAverageGradeUi(grade: number | null | undefined): boolean {
  if (grade === null || grade === undefined || Number.isNaN(grade)) return false;
  if (grade <= 10) return grade < 6;
  return grade < 60;
}

export function getStudentInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function getCardOpinionForTrimester(
  card: CouncilStudentCardRecord,
  trimester: CouncilTrimesterNumber
): string {
  if (trimester === 1) return card.trimester1Opinion || "";
  if (trimester === 2) return card.trimester2Opinion || "";
  return card.trimester3Opinion || "";
}

export function getCardBelowAvgForTrimester(
  card: CouncilStudentCardRecord,
  trimester: CouncilTrimesterNumber
): CouncilBelowAvgItem[] {
  if (trimester === 1) return parseBelowAverageList(card.trimester1BelowAvgJson);
  if (trimester === 2) return parseBelowAverageList(card.trimester2BelowAvgJson);
  return parseBelowAverageList(card.trimester3BelowAvgJson);
}
