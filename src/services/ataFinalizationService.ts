import {
  computeMinuteHash,
  generateVerificationCode,
  type MinuteCanonicalPayload,
} from "@/lib/ataCrypto";
import {
  mergeParticipantSignatures,
  type IncomingMinuteParticipant,
} from "./ataParticipantService";
import {
  acquireMinuteWriteLock,
  acquireSchoolYearSeqLock,
} from "@/lib/minuteLock";

const BRASILIA_TIMEZONE = "America/Sao_Paulo";

function getBrasiliaDateParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRASILIA_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      map[part.type] = parseInt(part.value, 10);
    }
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
  };
}

/**
 * Calcula a quantidade de dias úteis entre duas datas considerando o calendário
 * oficial no fuso horário de Brasília (America/Sao_Paulo).
 */
export function calculateBusinessDaysDiff(
  startDate: Date,
  endDate: Date = new Date()
): number {
  const startParts = getBrasiliaDateParts(startDate);
  const endParts = getBrasiliaDateParts(endDate);

  const cur = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day));
  const target = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day));

  if (cur >= target) return 0;

  let count = 0;
  while (cur < target) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dayOfWeek = cur.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }

  return count;
}

/**
 * Avalia a regra de lavratura extemporânea (> 5 dias úteis entre atendimento e lavratura).
 */
export function evaluateExtemporaneousFinalization(
  attendedAt: Date,
  finalizedAt: Date,
  rawExtemporaneousReason?: unknown
): { isExtemporaneous: boolean; extemporaneousReason: string | null } {
  const businessDays = calculateBusinessDaysDiff(attendedAt, finalizedAt);
  const reason =
    rawExtemporaneousReason !== undefined && rawExtemporaneousReason !== null
      ? String(rawExtemporaneousReason).trim()
      : "";

  if (businessDays > 5) {
    if (!reason || reason.length < 5) {
      throw new Error(
        "VALIDATION:Atendimentos realizados há mais de 5 dias úteis exigem justificativa de lavratura extemporânea para fins de escrituração escolar."
      );
    }
    return {
      isExtemporaneous: true,
      extemporaneousReason: reason,
    };
  }

  if (reason.length >= 5) {
    return {
      isExtemporaneous: true,
      extemporaneousReason: reason,
    };
  }

  return {
    isExtemporaneous: false,
    extemporaneousReason: null,
  };
}

/**
 * Monta o payload canônico determinístico da ata para selagem criptográfica SHA-256.
 */
export function buildCanonicalMinutePayload(params: {
  minute: {
    schoolId: string;
    attendedAt: Date;
    category: string;
    isConfidential: boolean;
    subject: string;
    summary: string;
    agreementsSummary?: string | null;
    students: Array<{
      studentId: string;
      studentNameSnapshot: string;
      classNameSnapshot?: string | null;
      cgmSnapshot?: string | null;
    }>;
    participants: Array<{
      role: string;
      name: string;
      documentType?: string | null;
      documentNumber?: string | null;
      signatureMode: string;
      signatureData?: string | null;
      biometricStrokeData?: string | null;
      biometricVerified?: boolean;
      verifiedEmail?: string | null;
      refusalReason?: string | null;
    }>;
    actionItems: Array<{
      description: string;
      responsible: string;
      dueDate?: Date | null;
    }>;
  };
  year: number;
  ataNumber: number;
  isExtemporaneous: boolean;
  extemporaneousReason: string | null;
  authorEmail: string;
}): MinuteCanonicalPayload {
  const { minute, year, ataNumber, isExtemporaneous, extemporaneousReason, authorEmail } = params;

  return {
    schoolId: minute.schoolId,
    year,
    ataNumber,
    attendedAt: minute.attendedAt.toISOString(),
    category: minute.category,
    isConfidential: minute.isConfidential,
    isExtemporaneous,
    extemporaneousReason,
    subject: minute.subject,
    summary: minute.summary,
    agreementsSummary: minute.agreementsSummary,
    authorEmail,
    students: minute.students.map((s) => ({
      studentId: s.studentId,
      name: s.studentNameSnapshot,
      className: s.classNameSnapshot,
      cgm: s.cgmSnapshot,
    })),
    participants: minute.participants.map((p) => ({
      role: p.role,
      name: p.name,
      documentType: p.documentType,
      documentNumber: p.documentNumber,
      signatureMode: p.signatureMode,
      signatureData: p.signatureData,
      biometricStrokeData: p.biometricStrokeData,
      biometricVerified: p.biometricVerified,
      verifiedEmail: p.verifiedEmail,
      refusalReason: p.refusalReason,
    })),
    actionItems: minute.actionItems.map((a) => ({
      description: a.description,
      responsible: a.responsible,
      dueDate: a.dueDate ? a.dueDate.toISOString() : null,
    })),
  };
}

export interface FinalizeMinutePayloadInput {
  studentIds?: unknown;
  participants?: IncomingMinuteParticipant[];
  actionItems?: Array<{
    description?: unknown;
    responsible?: string;
    dueDate?: string | null;
    status?: string;
  }>;
  category?: string;
  isConfidential?: boolean;
  subject?: unknown;
  rawNotes?: string | null;
  summary?: unknown;
  agreementsSummary?: string | null;
  extemporaneousReason?: unknown;
}

export interface ExecuteMinuteFinalizationParams {
  prisma: any;
  minuteId: string;
  rawBody: FinalizeMinutePayloadInput | null;
  author: {
    userId?: string;
    userName?: string;
    email: string;
    role: string;
    ip?: string | null;
  };
  verifyTenantOwnership: (minuteSchoolId: string) => boolean;
}

export interface ExecuteMinuteFinalizationResult {
  minute: any;
  alreadyFinalized: boolean;
}

/**
 * Orquestra a transação atômica de lavratura oficial de uma Ata Pedagógica:
 * - Valida existência, posse multi-tenant e status DRAFT (com idempotência se já FINALIZED);
 * - Adquire advisory lock exclusivo por escola/ano;
 * - Sincroniza estudantes (validando FKs da mesma escola), participantes e combinados;
 * - Gera numeração sequencial atômica, verifica regra extemporânea e sela o hash SHA-256.
 */
export async function executeMinuteFinalization(
  params: ExecuteMinuteFinalizationParams
): Promise<ExecuteMinuteFinalizationResult> {
  const { prisma, minuteId, rawBody, author, verifyTenantOwnership } = params;
  const currentYear = getBrasiliaDateParts(new Date()).year;

  const runTx =
    typeof prisma.$transaction === "function"
      ? prisma.$transaction.bind(prisma)
      : async (fn: (txClient: any) => Promise<any>) => fn(prisma);

  let finalized: any = null;
  let lastTxError: any = null;
  let isAlreadyFinalized = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      finalized = await runTx(
        async (tx: any) => {
          // Ordem global acíclica de locks: 1) ata -> 2) sequência anual escola/ano
          await acquireMinuteWriteLock(tx, minuteId);

          const minute = await tx.pedagogicalMinute.findUnique({
            where: { id: minuteId },
            include: {
              students: true,
              participants: true,
              actionItems: true,
            },
          });

          if (!minute) {
            throw new Error("NOT_FOUND:Ata pedagógica não encontrada");
          }

          if (!verifyTenantOwnership(minute.schoolId)) {
            throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
          }

          if (minute.status === "FINALIZED") {
            isAlreadyFinalized = true;
            return minute;
          }

          if (minute.status !== "DRAFT") {
            throw new Error(
              `STATUS_INVALID:Esta ata encontra-se com status '${minute.status}' e não pode ser lavrada.`
            );
          }

          // Lock transacional exclusivo por tenant e ano (Lei 14.063/2020)
          await acquireSchoolYearSeqLock(tx, minute.schoolId, currentYear);

          if (rawBody && typeof rawBody === "object") {
            if (Array.isArray(rawBody.studentIds)) {
              const uniqueStudentIds: string[] = Array.from(new Set(rawBody.studentIds.map(String)));
              if (uniqueStudentIds.length > 0) {
                const studentsDb: any[] = await tx.student.findMany({
                  where: { id: { in: uniqueStudentIds }, schoolId: minute.schoolId },
                  include: { classGroup: true },
                });
                if (studentsDb.length !== uniqueStudentIds.length) {
                  throw new Error(
                    "VALIDATION:Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
                  );
                }
                await tx.pedagogicalMinuteStudent.deleteMany({ where: { minuteId } });
                await tx.pedagogicalMinuteStudent.createMany({
                  data: studentsDb.map((s: any) => ({
                    minuteId,
                    studentId: s.id,
                    studentNameSnapshot: s.name,
                    classNameSnapshot: s.classGroup?.name || null,
                    cgmSnapshot: s.cgm || null,
                  })),
                });
              } else {
                await tx.pedagogicalMinuteStudent.deleteMany({ where: { minuteId } });
              }
            }

            if (Array.isArray(rawBody.participants)) {
              const participantsToCreate = mergeParticipantSignatures(
                rawBody.participants,
                minute.participants || [],
                { clearMobileTokens: true, minuteId }
              );

              await tx.pedagogicalMinuteParticipant.deleteMany({ where: { minuteId } });
              if (participantsToCreate.length > 0) {
                await tx.pedagogicalMinuteParticipant.createMany({ data: participantsToCreate });
              }
            }

            if (Array.isArray(rawBody.actionItems)) {
              const validActions = rawBody.actionItems.filter(
                (a) => a && typeof a.description === "string" && a.description.trim().length >= 2
              );
              await tx.pedagogicalActionItem.deleteMany({ where: { minuteId } });
              if (validActions.length > 0) {
                await tx.pedagogicalActionItem.createMany({
                  data: validActions.map((a) => ({
                    minuteId,
                    description: String(a.description).trim(),
                    responsible: a.responsible || "FAMILIA",
                    dueDate: a.dueDate && String(a.dueDate).trim() !== "" ? new Date(a.dueDate) : null,
                    status: a.status || "PENDING",
                  })),
                });
              }
            }

            const nextSubject =
              typeof rawBody.subject === "string" && rawBody.subject.trim().length >= 2
                ? rawBody.subject.trim()
                : minute.subject;

            await tx.pedagogicalMinute.update({
              where: { id: minuteId },
              data: {
                category: rawBody.category ?? minute.category,
                isConfidential:
                  typeof rawBody.isConfidential === "boolean"
                    ? rawBody.isConfidential
                    : minute.isConfidential,
                subject: nextSubject,
                rawNotes: rawBody.rawNotes !== undefined ? rawBody.rawNotes : minute.rawNotes,
                summary: typeof rawBody.summary === "string" ? rawBody.summary : minute.summary,
                agreementsSummary:
                  rawBody.agreementsSummary !== undefined
                    ? rawBody.agreementsSummary
                    : minute.agreementsSummary,
              },
            });
          }

          const refreshedMinute = await tx.pedagogicalMinute.findUnique({
            where: { id: minuteId },
            include: {
              students: true,
              participants: true,
              actionItems: true,
            },
          });

          if (!refreshedMinute) {
            throw new Error("NOT_FOUND:Ata pedagógica não encontrada");
          }

          if (!refreshedMinute.summary || refreshedMinute.summary.trim().length < 10) {
            throw new Error(
              "VALIDATION:O texto formal da ata deve ser preenchido (mínimo de 10 caracteres) antes da lavratura oficial."
            );
          }

          if (refreshedMinute.students.length === 0 && refreshedMinute.participants.length === 0) {
            throw new Error(
              "VALIDATION:Vincule pelo menos um estudante ou registre participantes docentes/servidores antes de lavrar."
            );
          }

          const lastAta = await tx.pedagogicalMinute.findFirst({
            where: {
              schoolId: refreshedMinute.schoolId,
              year: currentYear,
              ataNumber: { not: null },
            },
            orderBy: { ataNumber: "desc" },
            select: { ataNumber: true },
          });

          const nextAtaNumber = (lastAta?.ataNumber || 0) + 1;
          const verificationCode = generateVerificationCode();
          const now = new Date();

          const { isExtemporaneous, extemporaneousReason } = evaluateExtemporaneousFinalization(
            refreshedMinute.attendedAt,
            now,
            rawBody?.extemporaneousReason
          );

          const canonicalPayload = buildCanonicalMinutePayload({
            minute: refreshedMinute,
            year: currentYear,
            ataNumber: nextAtaNumber,
            isExtemporaneous,
            extemporaneousReason,
            authorEmail: author.email,
          });

          const contentHash = computeMinuteHash(canonicalPayload);

          return await tx.pedagogicalMinute.update({
            where: { id: minuteId },
            data: {
              year: currentYear,
              ataNumber: nextAtaNumber,
              status: "FINALIZED",
              finalizedAt: now,
              contentHash,
              verificationCode,
              isExtemporaneous,
              extemporaneousReason,
              authorId: author.userId,
              authorName: author.userName || refreshedMinute.authorName,
              authorEmail: author.email,
              authorRole: author.role || "PEDAGOGA",
              authorIp: author.ip ?? null,
            },
            include: {
              students: true,
              participants: true,
              actionItems: true,
              addendums: { orderBy: { createdAt: "asc" } },
            },
          });
        },
        { maxWait: 10000, timeout: 20000 }
      );
      break;
    } catch (txErr: any) {
      lastTxError = txErr;
      if (txErr?.code === "P2002" && attempt < 3) {
        continue;
      }
      throw txErr;
    }
  }

  if (!finalized) {
    throw lastTxError || new Error("Não foi possível concluir a transação de lavratura.");
  }

  return {
    minute: finalized,
    alreadyFinalized: isAlreadyFinalized,
  };
}
