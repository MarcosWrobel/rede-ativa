import {
  isBelowAverageGradeUi,
  type CouncilBoardDetailRecord,
  type CouncilStudentCardRecord,
  type CouncilSubjectRecord,
  type CouncilTrimesterNumber,
  type PreCouncilConversationStatus,
  type PreCouncilData,
  type PreCouncilSubjectConversation,
  type PreCouncilSynthesis,
} from "./types";

export const DEFAULT_PRE_COUNCIL_OBJECTIVE =
  "O Pré-Conselho é realizado por turma através do atendimento individual e dialogado com os professores que atuam na classe. As informações e observações registradas neste documento visam subsidiar o Conselho de Classe formal, fundamentar intervenções pedagógicas tempestivas e mapear necessidades de acompanhamento de estudantes.";

export const DEFAULT_PRE_COUNCIL_ACK_STATEMENT =
  "Os professores abaixo relacionados participaram do Pré-Conselho da turma, contribuindo com informações referentes ao seu componente curricular, tomando ciência das observações e dos encaminhamentos registrados.";

export const DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE = "Pedagoga Responsável";

export function getDefaultPreCouncilPeriodLabel(trimester: CouncilTrimesterNumber): string {
  return `${trimester}º Trimestre`;
}

export function createEmptyPreCouncilSynthesis(): PreCouncilSynthesis {
  return {
    mainDifficulties: "",
    priorityStudents: "",
    attendanceIssues: "",
    behaviorIssues: "",
    pedagogicalActions: "",
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDateYmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeUniqueStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function normalizeConversationStatus(value: unknown): PreCouncilConversationStatus {
  return value === "COMPLETED" ? "COMPLETED" : "PENDING";
}

function normalizeConversation(
  raw: unknown,
  fallbackIndex: number
): PreCouncilSubjectConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const subjectName = normalizeString(obj.subjectName);
  if (!subjectName) return null;

  const subjectId = normalizeNullableString(obj.subjectId);
  const id = normalizeString(obj.id) || subjectId || `pre-conv-${fallbackIndex + 1}`;

  return {
    id,
    subjectId,
    subjectName,
    teacherName: normalizeString(obj.teacherName),
    teacherEmail: normalizeNullableString(obj.teacherEmail),
    monitoredStudentIds: normalizeUniqueStringIds(obj.monitoredStudentIds),
    monitoredStudentsNotes: normalizeString(obj.monitoredStudentsNotes),
    agreements: normalizeString(obj.agreements),
    conversationStatus: normalizeConversationStatus(obj.conversationStatus),
    conversationDate: normalizeDateYmd(obj.conversationDate),
    digitalAckEmail: normalizeNullableString(obj.digitalAckEmail),
    digitalAckName: normalizeNullableString(obj.digitalAckName),
    digitalAckAt: normalizeNullableString(obj.digitalAckAt),
  };
}

export function parsePreCouncilData(raw: string | null | undefined): PreCouncilData | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1) return null;

    const rawConvs = Array.isArray(obj.conversations) ? obj.conversations : [];
    const seenIds = new Set<string>();
    const conversations: PreCouncilSubjectConversation[] = [];
    for (let i = 0; i < rawConvs.length; i++) {
      const normalized = normalizeConversation(rawConvs[i], i);
      if (!normalized) continue;
      if (seenIds.has(normalized.id)) continue;
      seenIds.add(normalized.id);
      conversations.push(normalized);
    }

    const rawSyn =
      obj.synthesis && typeof obj.synthesis === "object"
        ? (obj.synthesis as Record<string, unknown>)
        : {};

    return {
      version: 1,
      periodLabel: normalizeString(obj.periodLabel) || "1º Trimestre",
      objectiveText: normalizeString(obj.objectiveText) || DEFAULT_PRE_COUNCIL_OBJECTIVE,
      responsiblePedagogueName: normalizeString(obj.responsiblePedagogueName),
      responsiblePedagogueRole:
        normalizeString(obj.responsiblePedagogueRole) || DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
      conversations,
      synthesis: {
        mainDifficulties: normalizeString(rawSyn.mainDifficulties),
        priorityStudents: normalizeString(rawSyn.priorityStudents),
        attendanceIssues: normalizeString(rawSyn.attendanceIssues),
        behaviorIssues: normalizeString(rawSyn.behaviorIssues),
        pedagogicalActions: normalizeString(rawSyn.pedagogicalActions),
      },
    };
  } catch {
    return null;
  }
}

export function buildConversationFromSubject(
  subj: CouncilSubjectRecord
): PreCouncilSubjectConversation {
  return {
    id: subj.id,
    subjectId: subj.id,
    subjectName: subj.name,
    teacherName: subj.teacherName?.trim() || "",
    teacherEmail: subj.teacherEmail?.trim() || null,
    monitoredStudentIds: [],
    monitoredStudentsNotes: "",
    agreements: "",
    conversationStatus: "PENDING",
    conversationDate: null,
    digitalAckEmail: null,
    digitalAckName: null,
    digitalAckAt: null,
  };
}

export function buildInitialPreCouncilData(params: {
  trimester: CouncilTrimesterNumber;
  subjects: CouncilSubjectRecord[];
  responsiblePedagogueName?: string | null;
}): PreCouncilData {
  const activeSubjects = [...params.subjects]
    .filter((s) => s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "pt-BR"));

  return {
    version: 1,
    periodLabel: getDefaultPreCouncilPeriodLabel(params.trimester),
    objectiveText: DEFAULT_PRE_COUNCIL_OBJECTIVE,
    responsiblePedagogueName: params.responsiblePedagogueName?.trim() || "",
    responsiblePedagogueRole: DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
    conversations: activeSubjects.map(buildConversationFromSubject),
    synthesis: createEmptyPreCouncilSynthesis(),
  };
}

export function mergeSubjectsIntoPreCouncilConversations(
  conversations: PreCouncilSubjectConversation[],
  subjects: CouncilSubjectRecord[]
): { conversations: PreCouncilSubjectConversation[]; addedCount: number } {
  const activeSubjects = [...subjects]
    .filter((s) => s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "pt-BR"));

  const existingSubjectIds = new Set(
    conversations.map((c) => c.subjectId).filter((id): id is string => Boolean(id))
  );
  const existingNames = new Set(
    conversations.map((c) => c.subjectName.trim().toLowerCase()).filter(Boolean)
  );
  const existingRowIds = new Set(conversations.map((c) => c.id));

  const next = [...conversations];
  let addedCount = 0;

  for (const subj of activeSubjects) {
    const cleanNameKey = subj.name.trim().toLowerCase();
    if (existingSubjectIds.has(subj.id) || existingNames.has(cleanNameKey)) {
      continue;
    }
    let candidateId = subj.id;
    let suffix = 1;
    while (existingRowIds.has(candidateId)) {
      candidateId = `${subj.id}-${suffix++}`;
    }
    existingRowIds.add(candidateId);
    existingSubjectIds.add(subj.id);
    existingNames.add(cleanNameKey);

    next.push({
      ...buildConversationFromSubject(subj),
      id: candidateId,
    });
    addedCount++;
  }

  return { conversations: next, addedCount };
}

export interface PreCouncilProgressSummary {
  total: number;
  completed: number;
  acknowledged: number;
  citedStudentsCount: number;
}

export function getPreCouncilProgress(
  data: PreCouncilData | null | undefined
): PreCouncilProgressSummary {
  if (!data || data.conversations.length === 0) {
    return {
      total: 0,
      completed: 0,
      acknowledged: 0,
      citedStudentsCount: 0,
    };
  }

  const citedIds = new Set<string>();
  let completed = 0;
  let acknowledged = 0;

  for (const conv of data.conversations) {
    if (conv.conversationStatus === "COMPLETED") completed++;
    if (conv.digitalAckEmail) acknowledged++;
    for (const stId of conv.monitoredStudentIds) {
      citedIds.add(stId);
    }
  }

  return {
    total: data.conversations.length,
    completed,
    acknowledged,
    citedStudentsCount: citedIds.size,
  };
}

export interface PreCouncilStudentAlert {
  studentId: string;
  studentName: string;
  grade: number | null;
  attendancePercent: number | null;
  descriptorCodes: number[];
  isBelowAvg: boolean;
  isLowAttendance: boolean;
  hasAttentionDescriptor: boolean;
  reasons: string[];
}

export interface PreCouncilAlertsBundle {
  bySubjectId: Record<string, PreCouncilStudentAlert[]>;
  lowAttendanceStudents: Array<{
    studentId: string;
    studentName: string;
    attendancePercent: number;
  }>;
}

const ATTENTION_DESCRIPTOR_SET = new Set<number>([2, 3, 4]);

/**
 * Mapeia alertas pedagógicos por componente (notas abaixo da média, descritivos 2/3/4
 * e frequência < 75%) sem expor selos de saúde ou diagnósticos.
 */
export function buildPreCouncilStudentAlertsBySubject(
  board: CouncilBoardDetailRecord,
  trimester: CouncilTrimesterNumber
): PreCouncilAlertsBundle {
  const bySubjectId: Record<string, PreCouncilStudentAlert[]> = {};
  const lowAttendanceStudents: Array<{
    studentId: string;
    studentName: string;
    attendancePercent: number;
  }> = [];

  const activeSubjects = board.subjects.filter((s) => s.active);
  for (const subj of activeSubjects) {
    bySubjectId[subj.id] = [];
  }

  const activeCards = board.studentCards.filter((c) => c.enrollmentStatus === "ATIVO");

  for (const card of activeCards) {
    const attendancePercent = card.student.lowAttendanceRecord?.attendancePercent ?? null;
    const isLowAttendance = attendancePercent !== null && attendancePercent < 75;

    if (isLowAttendance && attendancePercent !== null) {
      lowAttendanceStudents.push({
        studentId: card.studentId,
        studentName: card.student.name,
        attendancePercent,
      });
    }

    for (const subj of activeSubjects) {
      const entry = card.subjectEntries.find(
        (e) => e.subjectId === subj.id && e.trimester === trimester
      );
      const grade = entry?.grade ?? null;
      const descriptorCodes = entry?.descriptorCodes ?? [];
      const isBelowAvg = isBelowAverageGradeUi(grade);
      const hasAttentionDescriptor = descriptorCodes.some((code) =>
        ATTENTION_DESCRIPTOR_SET.has(code)
      );

      if (!isBelowAvg && !isLowAttendance && !hasAttentionDescriptor) {
        continue;
      }

      const reasons: string[] = [];
      if (isBelowAvg && grade !== null) {
        reasons.push(`Nota ${grade.toFixed(1).replace(".", ",")}`);
      }
      if (descriptorCodes.includes(2)) reasons.push("Dificuldade");
      if (descriptorCodes.includes(3)) reasons.push("Conduta");
      if (descriptorCodes.includes(4)) reasons.push("Infrequência");
      if (isLowAttendance && attendancePercent !== null) {
        reasons.push(`Freq. ${attendancePercent.toFixed(0)}%`);
      }

      bySubjectId[subj.id].push({
        studentId: card.studentId,
        studentName: card.student.name,
        grade,
        attendancePercent,
        descriptorCodes,
        isBelowAvg,
        isLowAttendance,
        hasAttentionDescriptor,
        reasons,
      });
    }
  }

  for (const subj of activeSubjects) {
    bySubjectId[subj.id].sort((a, b) => {
      const scoreA =
        (a.isBelowAvg ? 4 : 0) + (a.isLowAttendance ? 2 : 0) + (a.hasAttentionDescriptor ? 1 : 0);
      const scoreB =
        (b.isBelowAvg ? 4 : 0) + (b.isLowAttendance ? 2 : 0) + (b.hasAttentionDescriptor ? 1 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.studentName.localeCompare(b.studentName, "pt-BR");
    });
  }

  lowAttendanceStudents.sort((a, b) => a.attendancePercent - b.attendancePercent);

  return { bySubjectId, lowAttendanceStudents };
}

export interface CitedStudentSummaryItem {
  studentId: string;
  studentName: string;
  count: number;
  subjectNames: string[];
}

export function buildCitedStudentsSummary(
  conversations: PreCouncilSubjectConversation[],
  studentCards: CouncilStudentCardRecord[]
): CitedStudentSummaryItem[] {
  const nameByStudentId = new Map(studentCards.map((c) => [c.studentId, c.student.name]));
  const map = new Map<string, { studentName: string; subjectNames: string[] }>();

  for (const conv of conversations) {
    for (const stId of conv.monitoredStudentIds) {
      const studentName = nameByStudentId.get(stId);
      if (!studentName) continue;
      const existing = map.get(stId);
      if (existing) {
        if (!existing.subjectNames.includes(conv.subjectName)) {
          existing.subjectNames.push(conv.subjectName);
        }
      } else {
        map.set(stId, {
          studentName,
          subjectNames: [conv.subjectName],
        });
      }
    }
  }

  return Array.from(map.entries())
    .map(([studentId, info]) => ({
      studentId,
      studentName: info.studentName,
      count: info.subjectNames.length,
      subjectNames: info.subjectNames,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.studentName.localeCompare(b.studentName, "pt-BR");
    });
}

export function getTodayYmdSaoPaulo(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export function formatPreCouncilDatePtBr(isoOrYmd: string | null | undefined): string {
  if (!isoOrYmd || !isoOrYmd.trim()) return "";
  const clean = isoOrYmd.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split("-");
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(clean);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dt);
}

export function formatPreCouncilDateTimePtBr(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return "";
  const dt = new Date(iso.trim());
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}
