import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/ataCrypto";
import { checkIsSuperAdmin, type AuthSessionLike } from "@/lib/roles";
import {
  councilBelowAvgItemSchema,
  councilBoardMetadataUpdateSchema,
  councilBoardUpsertSchema,
  councilGenerateMinuteSchema,
  councilMatrixBatchSaveSchema,
  councilPostActionItemSchema,
  councilStudentCardUpdateSchema,
  councilSubjectsBatchSchema,
  councilTrimesterUpdateSchema,
} from "@/lib/schemas";

export const COUNCIL_DESCRIPTOR_LABELS: Record<number, string> = {
  1: "Atende às expectativas propostas para o componente/itinerário",
  2: "Apresenta dificuldade de aprendizagem",
  3: "Conduta indisciplinar e alheio às normas e regras",
  4: "Infrequência",
  5: "Assiduidade em atividades propostas em sala de aula e plataformas digitais",
};

export const COUNCIL_TAG_LABELS: Record<string, string> = {
  ALUNO_COM_LAUDO: "Estudante com Laudo",
  AEE: "AEE (Acompanhamento Pedagógico - Turno)",
  ESTUDANTE_MONITOR: "Estudante Monitor",
  LIDER_DE_TURMA: "Líder de Turma",
  DESTAQUE_DA_TURMA: "Destaque da Turma",
  ESTUDANTE_SUPERACAO: "Estudante Superação",
  DESTAQUE_INTEGRADO_NOTA_INTEGRA: "Destaque Integrado / Nota Integra",
};

export const SENSITIVE_HEALTH_TAGS = new Set<string>(["ALUNO_COM_LAUDO", "AEE"]);

export type CouncilBelowAvgItem = z.infer<typeof councilBelowAvgItemSchema>;
export type CouncilPostActionItem = z.infer<typeof councilPostActionItemSchema>;

export function computeHasSensitiveHealthTag(tags: readonly string[]): boolean {
  return tags.some((tag) => SENSITIVE_HEALTH_TAGS.has(tag));
}

export class CouncilDomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 403 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "CouncilDomainError";
  }
}

export function resolveCouncilHttpError(err: unknown): { status: number; message: string } {
  if (err instanceof CouncilDomainError) {
    return { status: err.statusCode, message: err.message };
  }
  return {
    status: 500,
    message: "Erro interno ao processar operação do conselho de classe.",
  };
}

export async function readSafeJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new CouncilDomainError("Corpo da requisição JSON inválido.", 400);
  }
}

/**
 * Valida se o usuário autenticado possui permissão de escrita/mutação no Conselho de Classe
 * da unidade escolar especificada.
 * `GESTAO_SECRETARIA` sem vínculo operacional direto na unidade possui apenas leitura (GET).
 */
export function canMutateSchoolCouncil(
  session: AuthSessionLike | null | undefined,
  schoolId: string
): boolean {
  if (checkIsSuperAdmin(session)) return true;
  if (!session?.user || session.user.active === false) return false;

  const role = (session.user.role || "").toUpperCase();
  const userSchools = session.user.schools || [];

  if (role === "GESTAO_SECRETARIA") {
    return userSchools.some(
      (s) =>
        (s.id === schoolId || s.schoolId === schoolId) &&
        s.active !== false &&
        (s.role === "ADMIN" || s.role === "GESTOR_ESCOLAR" || s.role === "PEDAGOGA")
    );
  }

  if (role !== "PEDAGOGA" && role !== "GESTOR_ESCOLAR" && role !== "ADMIN") {
    return false;
  }

  if (session.user.schoolId && session.user.schoolId === schoolId) {
    return true;
  }

  if (
    userSchools.some(
      (s) => (s.id === schoolId || s.schoolId === schoolId) && s.active !== false
    )
  ) {
    return true;
  }

  return !session.user.schoolId && userSchools.length === 0;
}

export function parseBelowAverageJson(raw: string | null | undefined): CouncilBelowAvgItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const result = z.array(councilBelowAvgItemSchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function parsePostActionItemsJson(raw: string | null | undefined): CouncilPostActionItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const result = z.array(councilPostActionItemSchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function isBelowAverageGrade(grade: number | null | undefined): boolean {
  if (grade === null || grade === undefined || Number.isNaN(grade)) return false;
  if (grade <= 10) return grade < 6;
  return grade < 60;
}

function getBelowAvgFieldName(
  trimester: 1 | 2 | 3
): "trimester1BelowAvgJson" | "trimester2BelowAvgJson" | "trimester3BelowAvgJson" {
  if (trimester === 1) return "trimester1BelowAvgJson";
  if (trimester === 2) return "trimester2BelowAvgJson";
  return "trimester3BelowAvgJson";
}

function getOpinionFieldName(
  trimester: 1 | 2 | 3
): "trimester1Opinion" | "trimester2Opinion" | "trimester3Opinion" {
  if (trimester === 1) return "trimester1Opinion";
  if (trimester === 2) return "trimester2Opinion";
  return "trimester3Opinion";
}

async function resolveValidatedLeaderStudents(
  schoolId: string,
  classGroupId: string,
  peerLeaderStudentId?: string | null,
  teacherLeaderStudentId?: string | null,
  peerLeaderName?: string | null,
  teacherLeaderName?: string | null
) {
  const peerId = peerLeaderStudentId?.trim() || null;
  const teacherId = teacherLeaderStudentId?.trim() || null;
  const distinctIds = Array.from(new Set([peerId, teacherId].filter((v): v is string => Boolean(v))));

  let matchedMap = new Map<string, string>();
  if (distinctIds.length > 0) {
    const matched = await prisma.student.findMany({
      where: {
        id: { in: distinctIds },
        schoolId,
        classGroupId,
      },
      select: { id: true, name: true },
    });

    if (matched.length !== distinctIds.length) {
      throw new CouncilDomainError(
        "O estudante indicado como líder não pertence a esta turma ou instituição.",
        400
      );
    }

    matchedMap = new Map(matched.map((s) => [s.id, s.name]));
  }

  return {
    peerLeaderStudentId: peerId,
    peerLeaderName:
      peerLeaderName !== undefined
        ? peerLeaderName?.trim() || (peerId ? matchedMap.get(peerId) || null : null)
        : peerId
          ? matchedMap.get(peerId) || null
          : undefined,
    teacherLeaderStudentId: teacherId,
    teacherLeaderName:
      teacherLeaderName !== undefined
        ? teacherLeaderName?.trim() || (teacherId ? matchedMap.get(teacherId) || null : null)
        : teacherId
          ? matchedMap.get(teacherId) || null
          : undefined,
  };
}

async function ensureTrimestersForBoard(
  client: Prisma.TransactionClient | typeof prisma,
  schoolId: string,
  boardId: string,
  userName?: string | null,
  userEmail?: string | null
): Promise<boolean> {
  const existing = await client.classCouncilTrimester.findMany({
    where: { boardId, schoolId },
    select: { trimester: true },
  });
  const existingSet = new Set(existing.map((t) => t.trimester));
  const missing = ([1, 2, 3] as const).filter((tri) => !existingSet.has(tri));
  if (missing.length === 0) return false;

  await client.classCouncilTrimester.createMany({
    data: missing.map((tri) => ({
      schoolId,
      boardId,
      trimester: tri,
      status: "IN_PROGRESS",
      updatedByName: userName || null,
      updatedByEmail: userEmail || null,
    })),
    skipDuplicates: true,
  });
  return true;
}

async function syncMissingStudentCardsForBoard(
  client: Prisma.TransactionClient | typeof prisma,
  schoolId: string,
  boardId: string,
  classGroupId: string
): Promise<boolean> {
  const [students, existingCards] = await Promise.all([
    client.student.findMany({
      where: { schoolId, classGroupId },
      select: { id: true, active: true, isSpecialNeeds: true },
    }),
    client.studentCouncilCard.findMany({
      where: { boardId, schoolId },
      select: { studentId: true },
    }),
  ]);

  const existingStudentIds = new Set(existingCards.map((c) => c.studentId));
  const missingStudents = students.filter((s) => !existingStudentIds.has(s.id));
  if (missingStudents.length === 0) return false;

  await client.studentCouncilCard.createMany({
    data: missingStudents.map((s) => ({
      schoolId,
      boardId,
      studentId: s.id,
      enrollmentStatus: s.active ? "ATIVO" : "TRANSFERIDO",
      tags: s.isSpecialNeeds ? ["AEE"] : [],
      hasSensitiveHealthTag: Boolean(s.isSpecialNeeds),
    })),
    skipDuplicates: true,
  });
  return true;
}

export async function findCouncilBoardOwnershipRecord(boardId: string) {
  return prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      schoolId: true,
      classGroupId: true,
      year: true,
    },
  });
}

export async function listSchoolCouncilBoards(schoolId: string, year: number) {
  const [classGroups, boards] = await Promise.all([
    prisma.classGroup.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            students: { where: { active: true } },
          },
        },
      },
    }),
    prisma.classCouncilBoard.findMany({
      where: { schoolId, year },
      orderBy: { classGroup: { name: "asc" } },
      include: {
        classGroup: {
          select: { id: true, name: true, segment: true, shift: true },
        },
        trimesters: {
          orderBy: { trimester: "asc" },
          select: {
            id: true,
            trimester: true,
            status: true,
            linkedMinuteId: true,
            postCouncilHeldAt: true,
            updatedAt: true,
          },
        },
        _count: {
          select: {
            subjects: { where: { active: true } },
            studentCards: true,
          },
        },
      },
    }),
  ]);

  return {
    year,
    classGroups,
    boards,
  };
}

export async function getCouncilBoardDetail(schoolId: string, boardId: string) {
  const boardHeader = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: { id: true, schoolId: true, classGroupId: true },
  });

  if (!boardHeader || boardHeader.schoolId !== schoolId) {
    return null;
  }

  await ensureTrimestersForBoard(prisma, schoolId, boardId);
  await syncMissingStudentCardsForBoard(prisma, schoolId, boardId, boardHeader.classGroupId);

  return prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    include: {
      classGroup: {
        select: { id: true, name: true, segment: true, shift: true },
      },
      subjects: {
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      },
      trimesters: {
        orderBy: { trimester: "asc" },
      },
      studentCards: {
        orderBy: { student: { name: "asc" } },
        include: {
          student: {
            select: {
              id: true,
              name: true,
              cgm: true,
              active: true,
              isSpecialNeeds: true,
              isExchangeStudent: true,
              age: true,
              lowAttendanceRecord: {
                select: { attendancePercent: true },
              },
            },
          },
          subjectEntries: {
            orderBy: [{ trimester: "asc" }],
          },
        },
      },
    },
  });
}

export async function ensureOrUpsertCouncilBoard(params: {
  schoolId: string;
  payload: z.infer<typeof councilBoardUpsertSchema>;
  authorName: string;
  authorEmail: string;
}) {
  const { schoolId, payload, authorName, authorEmail } = params;

  const classGroup = await prisma.classGroup.findFirst({
    where: { id: payload.classGroupId, schoolId },
    select: { id: true, schoolId: true, name: true },
  });

  if (!classGroup) {
    throw new CouncilDomainError("Turma não encontrada nesta instituição escolar.", 404);
  }

  const leaders = await resolveValidatedLeaderStudents(
    schoolId,
    classGroup.id,
    payload.peerLeaderStudentId,
    payload.teacherLeaderStudentId,
    payload.peerLeaderName,
    payload.teacherLeaderName
  );

  const board = await prisma.$transaction(async (tx) => {
    const upserted = await tx.classCouncilBoard.upsert({
      where: {
        schoolId_classGroupId_year: {
          schoolId,
          classGroupId: classGroup.id,
          year: payload.year,
        },
      },
      create: {
        schoolId,
        classGroupId: classGroup.id,
        year: payload.year,
        peerLeaderStudentId: leaders.peerLeaderStudentId,
        peerLeaderName: leaders.peerLeaderName ?? null,
        teacherLeaderStudentId: leaders.teacherLeaderStudentId,
        teacherLeaderName: leaders.teacherLeaderName ?? null,
        externalEvalEd1Percent: payload.externalEvalEd1Percent ?? null,
        externalEvalEd2Percent: payload.externalEvalEd2Percent ?? null,
        externalEvalEd3Percent: payload.externalEvalEd3Percent ?? null,
        seatingMapMode: payload.seatingMapMode ?? "REVEZAMENTO_MENSAL",
        seatingMapNotes: payload.seatingMapNotes?.trim() || null,
      },
      update: {
        ...(payload.peerLeaderStudentId !== undefined
          ? { peerLeaderStudentId: leaders.peerLeaderStudentId }
          : {}),
        ...(leaders.peerLeaderName !== undefined ? { peerLeaderName: leaders.peerLeaderName } : {}),
        ...(payload.teacherLeaderStudentId !== undefined
          ? { teacherLeaderStudentId: leaders.teacherLeaderStudentId }
          : {}),
        ...(leaders.teacherLeaderName !== undefined
          ? { teacherLeaderName: leaders.teacherLeaderName }
          : {}),
        ...(payload.externalEvalEd1Percent !== undefined
          ? { externalEvalEd1Percent: payload.externalEvalEd1Percent }
          : {}),
        ...(payload.externalEvalEd2Percent !== undefined
          ? { externalEvalEd2Percent: payload.externalEvalEd2Percent }
          : {}),
        ...(payload.externalEvalEd3Percent !== undefined
          ? { externalEvalEd3Percent: payload.externalEvalEd3Percent }
          : {}),
        ...(payload.seatingMapMode !== undefined ? { seatingMapMode: payload.seatingMapMode } : {}),
        ...(payload.seatingMapNotes !== undefined
          ? { seatingMapNotes: payload.seatingMapNotes?.trim() || null }
          : {}),
      },
    });

    await ensureTrimestersForBoard(tx, schoolId, upserted.id, authorName, authorEmail);
    await syncMissingStudentCardsForBoard(tx, schoolId, upserted.id, classGroup.id);

    return upserted;
  });

  return getCouncilBoardDetail(schoolId, board.id);
}

export async function updateCouncilBoardMetadata(params: {
  schoolId: string;
  boardId: string;
  payload: z.infer<typeof councilBoardMetadataUpdateSchema>;
}) {
  const { schoolId, boardId, payload } = params;

  const existing = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: { id: true, schoolId: true, classGroupId: true },
  });

  if (!existing) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (existing.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  const leaders = await resolveValidatedLeaderStudents(
    schoolId,
    existing.classGroupId,
    payload.peerLeaderStudentId,
    payload.teacherLeaderStudentId,
    payload.peerLeaderName,
    payload.teacherLeaderName
  );

  await prisma.classCouncilBoard.update({
    where: { id: boardId },
    data: {
      ...(payload.peerLeaderStudentId !== undefined
        ? { peerLeaderStudentId: leaders.peerLeaderStudentId }
        : {}),
      ...(leaders.peerLeaderName !== undefined ? { peerLeaderName: leaders.peerLeaderName } : {}),
      ...(payload.teacherLeaderStudentId !== undefined
        ? { teacherLeaderStudentId: leaders.teacherLeaderStudentId }
        : {}),
      ...(leaders.teacherLeaderName !== undefined
        ? { teacherLeaderName: leaders.teacherLeaderName }
        : {}),
      ...(payload.externalEvalEd1Percent !== undefined
        ? { externalEvalEd1Percent: payload.externalEvalEd1Percent }
        : {}),
      ...(payload.externalEvalEd2Percent !== undefined
        ? { externalEvalEd2Percent: payload.externalEvalEd2Percent }
        : {}),
      ...(payload.externalEvalEd3Percent !== undefined
        ? { externalEvalEd3Percent: payload.externalEvalEd3Percent }
        : {}),
      ...(payload.seatingMapMode !== undefined ? { seatingMapMode: payload.seatingMapMode } : {}),
      ...(payload.seatingMapNotes !== undefined
        ? { seatingMapNotes: payload.seatingMapNotes?.trim() || null }
        : {}),
    },
  });

  return getCouncilBoardDetail(schoolId, boardId);
}

export async function saveOrCloneCouncilSubjects(params: {
  schoolId: string;
  boardId: string;
  payload: z.infer<typeof councilSubjectsBatchSchema>;
}) {
  const { schoolId, boardId, payload } = params;

  const board = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: { id: true, schoolId: true },
  });

  if (!board) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (board.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  if (payload.sourceBoardId) {
    if (payload.sourceBoardId === boardId) {
      throw new CouncilDomainError(
        "Selecione uma turma diferente da atual para importar componentes curriculares.",
        400
      );
    }

    const sourceBoard = await prisma.classCouncilBoard.findUnique({
      where: { id: payload.sourceBoardId },
      select: {
        id: true,
        schoolId: true,
        classGroup: { select: { name: true } },
      },
    });

    if (!sourceBoard) {
      throw new CouncilDomainError("Turma de origem não encontrada.", 404);
    }
    if (sourceBoard.schoolId !== schoolId) {
      throw new CouncilDomainError(
        "Acesso negado: a turma de origem pertence a outra instituição escolar.",
        403
      );
    }

    const sourceSubjects = await prisma.classCouncilSubject.findMany({
      where: { boardId: sourceBoard.id, schoolId, active: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });

    if (sourceSubjects.length === 0) {
      throw new CouncilDomainError(
        "A turma selecionada não possui componentes curriculares ativos para importar.",
        400
      );
    }

    const cloned = await prisma.$transaction(async (tx) => {
      for (const s of sourceSubjects) {
        await tx.classCouncilSubject.upsert({
          where: { boardId_name: { boardId, name: s.name } },
          create: {
            schoolId,
            boardId,
            name: s.name,
            teacherName: s.teacherName,
            teacherEmail: s.teacherEmail,
            displayOrder: s.displayOrder,
            active: true,
          },
          update: {
            teacherName: s.teacherName,
            teacherEmail: s.teacherEmail,
            displayOrder: s.displayOrder,
            active: true,
          },
        });
      }

      return tx.classCouncilSubject.findMany({
        where: { boardId, schoolId },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      });
    });

    return {
      mode: "CLONED" as const,
      sourceClassName: sourceBoard.classGroup?.name || null,
      subjects: cloned,
    };
  }

  const incomingSubjects = payload.subjects || [];
  const normalizedNames = new Set<string>();
  for (const item of incomingSubjects) {
    const key = item.name.trim().toLowerCase();
    if (normalizedNames.has(key)) {
      throw new CouncilDomainError(
        "Existem componentes curriculares com nomes duplicados na lista.",
        400
      );
    }
    normalizedNames.add(key);
  }

  const providedIds = Array.from(
    new Set(incomingSubjects.map((s) => s.id).filter((id): id is string => Boolean(id)))
  );

  if (providedIds.length > 0) {
    const matched = await prisma.classCouncilSubject.findMany({
      where: { id: { in: providedIds }, boardId, schoolId },
      select: { id: true },
    });
    if (matched.length !== providedIds.length) {
      throw new CouncilDomainError(
        "Um ou mais componentes informados não pertencem a esta turma ou instituição.",
        403
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const existingSubjects = await tx.classCouncilSubject.findMany({
      where: { boardId, schoolId },
      select: { id: true, name: true, active: true },
    });

    const submittedIdSet = new Set(providedIds);
    const submittedNameSet = normalizedNames;

    // Desativa componentes ativos omitidos do lote sem apagar histórico de descritivos
    const toDeactivateIds = existingSubjects
      .filter(
        (ex) =>
          ex.active &&
          !submittedIdSet.has(ex.id) &&
          !submittedNameSet.has(ex.name.trim().toLowerCase())
      )
      .map((ex) => ex.id);

    if (toDeactivateIds.length > 0) {
      await tx.classCouncilSubject.updateMany({
        where: { id: { in: toDeactivateIds }, boardId, schoolId },
        data: { active: false },
      });
    }

    for (let idx = 0; idx < incomingSubjects.length; idx++) {
      const item = incomingSubjects[idx];
      const cleanName = item.name.trim();
      const cleanTeacherName = item.teacherName?.trim() || null;
      const cleanTeacherEmail = item.teacherEmail?.trim() || null;
      const order = item.displayOrder ?? idx;

      if (item.id) {
        await tx.classCouncilSubject.update({
          where: { id: item.id },
          data: {
            name: cleanName,
            teacherName: cleanTeacherName,
            teacherEmail: cleanTeacherEmail,
            displayOrder: order,
            active: item.active,
          },
        });
      } else {
        await tx.classCouncilSubject.upsert({
          where: { boardId_name: { boardId, name: cleanName } },
          create: {
            schoolId,
            boardId,
            name: cleanName,
            teacherName: cleanTeacherName,
            teacherEmail: cleanTeacherEmail,
            displayOrder: order,
            active: item.active,
          },
          update: {
            teacherName: cleanTeacherName,
            teacherEmail: cleanTeacherEmail,
            displayOrder: order,
            active: item.active,
          },
        });
      }
    }

    return tx.classCouncilSubject.findMany({
      where: { boardId, schoolId },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  });

  return {
    mode: "UPDATED" as const,
    sourceClassName: null,
    subjects: updated,
  };
}

export async function updateCouncilTrimester(params: {
  schoolId: string;
  boardId: string;
  payload: z.infer<typeof councilTrimesterUpdateSchema>;
  userName: string;
  userEmail: string;
}) {
  const { schoolId, boardId, payload, userName, userEmail } = params;

  const board = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: { id: true, schoolId: true },
  });

  if (!board) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (board.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  let parsedHeldAt: Date | null | undefined = undefined;
  if (payload.postCouncilHeldAt !== undefined) {
    if (!payload.postCouncilHeldAt || !payload.postCouncilHeldAt.trim()) {
      parsedHeldAt = null;
    } else {
      const dt = new Date(payload.postCouncilHeldAt);
      if (Number.isNaN(dt.getTime())) {
        throw new CouncilDomainError("Data da reunião de pós-conselho inválida.", 400);
      }
      parsedHeldAt = dt;
    }
  }

  const serializedActions =
    payload.postCouncilActionItems !== undefined
      ? JSON.stringify(
          payload.postCouncilActionItems.map((item, idx) => ({
            number: item.number || idx + 1,
            description: item.description.trim(),
            responsible: item.responsible,
            dueDate: item.dueDate?.trim() || null,
          }))
        )
      : undefined;

  return prisma.classCouncilTrimester.upsert({
    where: { boardId_trimester: { boardId, trimester: payload.trimester } },
    create: {
      schoolId,
      boardId,
      trimester: payload.trimester,
      status: payload.status ?? "IN_PROGRESS",
      positivePoints: payload.positivePoints?.trim() || null,
      attentionPoints: payload.attentionPoints?.trim() || null,
      plannedActions: payload.plannedActions?.trim() || null,
      postCouncilHeldAt: parsedHeldAt ?? null,
      postCouncilAdvances: payload.postCouncilAdvances?.trim() || null,
      postCouncilWhatWorked: payload.postCouncilWhatWorked?.trim() || null,
      postCouncilRecognizedAttitudes: payload.postCouncilRecognizedAttitudes?.trim() || null,
      postCouncilCriticalSubjects: payload.postCouncilCriticalSubjects?.trim() || null,
      postCouncilPerformanceFactors: payload.postCouncilPerformanceFactors?.trim() || null,
      postCouncilBehaviorAttendance: payload.postCouncilBehaviorAttendance?.trim() || null,
      postCouncilWhatToImprove: payload.postCouncilWhatToImprove?.trim() || null,
      postCouncilHowTeachersCanHelp: payload.postCouncilHowTeachersCanHelp?.trim() || null,
      postCouncilCommitments: payload.postCouncilCommitments?.trim() || null,
      postCouncilActionItemsJson: serializedActions ?? null,
      updatedByName: userName,
      updatedByEmail: userEmail,
    },
    update: {
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.positivePoints !== undefined
        ? { positivePoints: payload.positivePoints?.trim() || null }
        : {}),
      ...(payload.attentionPoints !== undefined
        ? { attentionPoints: payload.attentionPoints?.trim() || null }
        : {}),
      ...(payload.plannedActions !== undefined
        ? { plannedActions: payload.plannedActions?.trim() || null }
        : {}),
      ...(parsedHeldAt !== undefined ? { postCouncilHeldAt: parsedHeldAt } : {}),
      ...(payload.postCouncilAdvances !== undefined
        ? { postCouncilAdvances: payload.postCouncilAdvances?.trim() || null }
        : {}),
      ...(payload.postCouncilWhatWorked !== undefined
        ? { postCouncilWhatWorked: payload.postCouncilWhatWorked?.trim() || null }
        : {}),
      ...(payload.postCouncilRecognizedAttitudes !== undefined
        ? { postCouncilRecognizedAttitudes: payload.postCouncilRecognizedAttitudes?.trim() || null }
        : {}),
      ...(payload.postCouncilCriticalSubjects !== undefined
        ? { postCouncilCriticalSubjects: payload.postCouncilCriticalSubjects?.trim() || null }
        : {}),
      ...(payload.postCouncilPerformanceFactors !== undefined
        ? { postCouncilPerformanceFactors: payload.postCouncilPerformanceFactors?.trim() || null }
        : {}),
      ...(payload.postCouncilBehaviorAttendance !== undefined
        ? { postCouncilBehaviorAttendance: payload.postCouncilBehaviorAttendance?.trim() || null }
        : {}),
      ...(payload.postCouncilWhatToImprove !== undefined
        ? { postCouncilWhatToImprove: payload.postCouncilWhatToImprove?.trim() || null }
        : {}),
      ...(payload.postCouncilHowTeachersCanHelp !== undefined
        ? { postCouncilHowTeachersCanHelp: payload.postCouncilHowTeachersCanHelp?.trim() || null }
        : {}),
      ...(payload.postCouncilCommitments !== undefined
        ? { postCouncilCommitments: payload.postCouncilCommitments?.trim() || null }
        : {}),
      ...(serializedActions !== undefined ? { postCouncilActionItemsJson: serializedActions } : {}),
      updatedByName: userName,
      updatedByEmail: userEmail,
    },
  });
}

export async function saveCouncilMatrixBatch(params: {
  schoolId: string;
  boardId: string;
  payload: z.infer<typeof councilMatrixBatchSaveSchema>;
  userEmail: string;
}) {
  const { schoolId, boardId, payload, userEmail } = params;

  const board = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: { id: true, schoolId: true },
  });

  if (!board) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (board.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  const distinctStudentIds = Array.from(new Set(payload.entries.map((e) => e.studentId)));
  const distinctSubjectIds = Array.from(new Set(payload.entries.map((e) => e.subjectId)));

  const [cards, subjects] = await Promise.all([
    prisma.studentCouncilCard.findMany({
      where: { boardId, schoolId, studentId: { in: distinctStudentIds } },
      select: {
        id: true,
        studentId: true,
        trimester1BelowAvgJson: true,
        trimester2BelowAvgJson: true,
        trimester3BelowAvgJson: true,
      },
    }),
    prisma.classCouncilSubject.findMany({
      where: { boardId, schoolId, id: { in: distinctSubjectIds } },
      select: { id: true, name: true },
    }),
  ]);

  if (cards.length !== distinctStudentIds.length || subjects.length !== distinctSubjectIds.length) {
    throw new CouncilDomainError(
      "Um ou mais estudantes ou componentes curriculares não pertencem a esta turma ou instituição.",
      400
    );
  }

  const cardByStudentId = new Map(cards.map((c) => [c.studentId, c]));
  const dedupedEntries = new Map<
    string,
    { cardId: string; subjectId: string; descriptorCodes: number[]; grade: number | null }
  >();

  for (const entry of payload.entries) {
    const card = cardByStudentId.get(entry.studentId);
    if (!card) continue;
    const key = `${card.id}::${entry.subjectId}`;
    dedupedEntries.set(key, {
      cardId: card.id,
      subjectId: entry.subjectId,
      descriptorCodes: entry.descriptorCodes,
      grade: entry.grade ?? null,
    });
  }

  const entriesList = Array.from(dedupedEntries.values());
  const affectedCardIds = Array.from(new Set(entriesList.map((e) => e.cardId)));
  const belowAvgField = getBelowAvgFieldName(payload.trimester);

  await prisma.$transaction(async (tx) => {
    for (const item of entriesList) {
      await tx.studentCouncilSubjectEntry.upsert({
        where: {
          cardId_subjectId_trimester: {
            cardId: item.cardId,
            subjectId: item.subjectId,
            trimester: payload.trimester,
          },
        },
        create: {
          schoolId,
          cardId: item.cardId,
          subjectId: item.subjectId,
          trimester: payload.trimester,
          descriptorCodes: item.descriptorCodes,
          grade: item.grade,
          updatedByEmail: userEmail,
        },
        update: {
          descriptorCodes: item.descriptorCodes,
          grade: item.grade,
          updatedByEmail: userEmail,
        },
      });
    }

    for (const cardId of affectedCardIds) {
      const cardRecord = cards.find((c) => c.id === cardId);
      const existingManualItems = parseBelowAverageJson(
        cardRecord?.[belowAvgField] as string | null | undefined
      ).filter((item) => !item.subjectId);

      const cardEntries = await tx.studentCouncilSubjectEntry.findMany({
        where: {
          cardId,
          schoolId,
          trimester: payload.trimester,
          subject: { active: true },
        },
        include: {
          subject: { select: { id: true, name: true, displayOrder: true } },
        },
      });

      const belowFromMatrix: CouncilBelowAvgItem[] = cardEntries
        .filter((e) => isBelowAverageGrade(e.grade))
        .sort((a, b) => (a.subject.displayOrder ?? 0) - (b.subject.displayOrder ?? 0))
        .map((e) => ({
          subjectId: e.subject.id,
          subjectName: e.subject.name,
          grade: e.grade ?? null,
        }));

      const merged = [...belowFromMatrix, ...existingManualItems];

      await tx.studentCouncilCard.update({
        where: { id: cardId },
        data: {
          [belowAvgField]: merged.length > 0 ? JSON.stringify(merged) : null,
        },
      });
    }
  });

  return {
    updatedCount: entriesList.length,
    trimester: payload.trimester,
  };
}

export async function updateStudentCouncilCard(params: {
  schoolId: string;
  boardId: string;
  studentId: string;
  payload: z.infer<typeof councilStudentCardUpdateSchema>;
}) {
  const { schoolId, boardId, studentId, payload } = params;

  const card = await prisma.studentCouncilCard.findUnique({
    where: { boardId_studentId: { boardId, studentId } },
    include: {
      student: { select: { id: true, schoolId: true } },
    },
  });

  if (!card) {
    throw new CouncilDomainError("Ficha do estudante não encontrada neste conselho de turma.", 404);
  }
  if (card.schoolId !== schoolId || card.student.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  if (
    (payload.qualitativeOpinion !== undefined || payload.belowAverageSubjects !== undefined) &&
    !payload.trimester
  ) {
    throw new CouncilDomainError(
      "Informe o trimestre (1, 2 ou 3) ao atualizar parecer ou componentes abaixo da média.",
      400
    );
  }

  if (payload.belowAverageSubjects && payload.belowAverageSubjects.length > 0) {
    const subjectIds = Array.from(
      new Set(
        payload.belowAverageSubjects
          .map((item) => item.subjectId)
          .filter((id): id is string => Boolean(id && id.trim()))
      )
    );
    if (subjectIds.length > 0) {
      const matchedSubjects = await prisma.classCouncilSubject.findMany({
        where: { id: { in: subjectIds }, boardId, schoolId },
        select: { id: true },
      });
      if (matchedSubjects.length !== subjectIds.length) {
        throw new CouncilDomainError(
          "Um ou mais componentes abaixo da média não pertencem a esta turma ou instituição.",
          400
        );
      }
    }
  }

  const nextTags = payload.tags !== undefined ? Array.from(new Set(payload.tags)) : undefined;
  const opinionField = payload.trimester ? getOpinionFieldName(payload.trimester) : null;
  const belowAvgField = payload.trimester ? getBelowAvgFieldName(payload.trimester) : null;

  return prisma.studentCouncilCard.update({
    where: { id: card.id },
    data: {
      ...(payload.enrollmentStatus !== undefined
        ? { enrollmentStatus: payload.enrollmentStatus }
        : {}),
      ...(payload.externalEvalEd1Percent !== undefined
        ? { externalEvalEd1Percent: payload.externalEvalEd1Percent }
        : {}),
      ...(payload.externalEvalEd2Percent !== undefined
        ? { externalEvalEd2Percent: payload.externalEvalEd2Percent }
        : {}),
      ...(payload.externalEvalEd3Percent !== undefined
        ? { externalEvalEd3Percent: payload.externalEvalEd3Percent }
        : {}),
      ...(nextTags !== undefined
        ? {
            tags: nextTags,
            hasSensitiveHealthTag: computeHasSensitiveHealthTag(nextTags),
          }
        : {}),
      ...(opinionField && payload.qualitativeOpinion !== undefined
        ? { [opinionField]: payload.qualitativeOpinion?.trim() || null }
        : {}),
      ...(belowAvgField && payload.belowAverageSubjects !== undefined
        ? {
            [belowAvgField]:
              payload.belowAverageSubjects.length > 0
                ? JSON.stringify(
                    payload.belowAverageSubjects.map((item) => ({
                      subjectId: item.subjectId || null,
                      subjectName: item.subjectName.trim(),
                      grade: item.grade ?? null,
                    }))
                  )
                : null,
          }
        : {}),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          cgm: true,
          active: true,
          isSpecialNeeds: true,
          isExchangeStudent: true,
          age: true,
        },
      },
      subjectEntries: {
        orderBy: [{ trimester: "asc" }],
      },
    },
  });
}

export async function generateMinuteDraftFromCouncil(params: {
  schoolId: string;
  boardId: string;
  payload: z.infer<typeof councilGenerateMinuteSchema>;
  authorId?: string;
  authorName: string;
  authorEmail: string;
  authorRole: string;
  authorIp?: string | null;
}) {
  const { schoolId, boardId, payload, authorId, authorName, authorEmail, authorRole, authorIp } =
    params;

  const board = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    include: {
      classGroup: { select: { id: true, name: true, segment: true, shift: true } },
      subjects: {
        where: { active: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      },
      trimesters: {
        where: { trimester: payload.trimester },
      },
      studentCards: {
        include: {
          student: {
            select: { id: true, name: true, cgm: true, schoolId: true },
          },
          subjectEntries: {
            where: { trimester: payload.trimester },
          },
        },
      },
    },
  });

  if (!board) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (board.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  const uniqueStudentIds = Array.from(new Set(payload.studentIds || []));
  const cardByStudentId = new Map(board.studentCards.map((c) => [c.studentId, c]));
  const matchedCards = uniqueStudentIds
    .map((id) => cardByStudentId.get(id))
    .filter((card): card is NonNullable<typeof card> => Boolean(card));

  if (matchedCards.length !== uniqueStudentIds.length) {
    throw new CouncilDomainError(
      "Um ou mais estudantes informados não pertencem a esta turma ou instituição escolar.",
      400
    );
  }

  if (uniqueStudentIds.length > 0) {
    const dbStudents = await prisma.student.findMany({
      where: { id: { in: uniqueStudentIds }, schoolId },
      select: { id: true },
    });
    if (dbStudents.length !== uniqueStudentIds.length) {
      throw new CouncilDomainError(
        "Um ou mais estudantes informados não pertencem a esta instituição escolar.",
        400
      );
    }
  }

  const trimesterRecord = board.trimesters[0] || null;
  const subjectNameById = new Map(board.subjects.map((s) => [s.id, s.name]));

  if (payload.source === "POST_COUNCIL") {
    const postActions = parsePostActionItemsJson(trimesterRecord?.postCouncilActionItemsJson);
    const lines: string[] = [
      `Reunião de Pós-Conselho de Classe — Turma ${board.classGroup.name} (${payload.trimester}º Trimestre / ${board.year}).`,
    ];

    if (trimesterRecord?.positivePoints) {
      lines.push(`\nObservações Gerais — Pontos Positivos:\n${trimesterRecord.positivePoints}`);
    }
    if (trimesterRecord?.attentionPoints) {
      lines.push(`\nObservações Gerais — Pontos de Atenção:\n${trimesterRecord.attentionPoints}`);
    }
    if (trimesterRecord?.plannedActions) {
      lines.push(`\nAções Planejadas pela Equipe:\n${trimesterRecord.plannedActions}`);
    }

    const axis1 = [
      trimesterRecord?.postCouncilAdvances ? `- Avanços: ${trimesterRecord.postCouncilAdvances}` : null,
      trimesterRecord?.postCouncilWhatWorked
        ? `- O que funcionou bem: ${trimesterRecord.postCouncilWhatWorked}`
        : null,
      trimesterRecord?.postCouncilRecognizedAttitudes
        ? `- Atitudes reconhecidas: ${trimesterRecord.postCouncilRecognizedAttitudes}`
        : null,
    ].filter(Boolean);
    if (axis1.length > 0) {
      lines.push(`\n1. Pontos Positivos (Autoavaliação):\n${axis1.join("\n")}`);
    }

    const axis2 = [
      trimesterRecord?.postCouncilCriticalSubjects
        ? `- Componentes críticos: ${trimesterRecord.postCouncilCriticalSubjects}`
        : null,
      trimesterRecord?.postCouncilPerformanceFactors
        ? `- Fatores que prejudicam o rendimento: ${trimesterRecord.postCouncilPerformanceFactors}`
        : null,
      trimesterRecord?.postCouncilBehaviorAttendance
        ? `- Comportamento e frequência: ${trimesterRecord.postCouncilBehaviorAttendance}`
        : null,
    ].filter(Boolean);
    if (axis2.length > 0) {
      lines.push(`\n2. Dificuldades Observadas:\n${axis2.join("\n")}`);
    }

    const axis3 = [
      trimesterRecord?.postCouncilWhatToImprove
        ? `- O que melhorar: ${trimesterRecord.postCouncilWhatToImprove}`
        : null,
      trimesterRecord?.postCouncilHowTeachersCanHelp
        ? `- Como os docentes podem apoiar: ${trimesterRecord.postCouncilHowTeachersCanHelp}`
        : null,
      trimesterRecord?.postCouncilCommitments
        ? `- Compromissos assumidos pelos estudantes: ${trimesterRecord.postCouncilCommitments}`
        : null,
    ].filter(Boolean);
    if (axis3.length > 0) {
      lines.push(`\n3. Escuta dos Estudantes:\n${axis3.join("\n")}`);
    }

    if (postActions.length > 0) {
      lines.push(
        `\n4. Encaminhamentos Numerados:\n${postActions
          .map((a) => `${a.number}. ${a.description}`)
          .join("\n")}`
      );
    }

    const agreementsSummary =
      postActions.length > 0
        ? postActions.map((a) => `${a.number}. ${a.description}`).join("\n")
        : null;

    const minuteSubject = `Reunião de Pós-Conselho — ${board.classGroup.name} (${payload.trimester}º Trimestre/${board.year})`;

    return prisma.$transaction(async (tx) => {
      const created = await tx.pedagogicalMinute.create({
        data: {
          schoolId,
          year: board.year,
          status: "DRAFT",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          isConfidential: Boolean(payload.isConfidential),
          attendedAt: trimesterRecord?.postCouncilHeldAt || new Date(),
          subject: minuteSubject,
          rawNotes: null,
          summary: lines.join("\n"),
          agreementsSummary,
          verificationCode: generateVerificationCode(),
          authorId: authorId || null,
          authorName,
          authorEmail,
          authorRole,
          authorIp: authorIp || null,
          // Refinamento #2: em POST_COUNCIL não vincula todos os estudantes automaticamente;
          // somente vincula quando studentIds explícitos forem informados.
          students: {
            create: matchedCards.map((c) => ({
              studentId: c.student.id,
              studentNameSnapshot: c.student.name,
              classNameSnapshot: board.classGroup.name,
              cgmSnapshot: c.student.cgm || null,
            })),
          },
          actionItems: {
            create: postActions.map((a) => ({
              description: a.description,
              responsible: a.responsible,
              dueDate: a.dueDate ? new Date(a.dueDate) : null,
            })),
          },
        },
        include: {
          students: true,
          participants: true,
          actionItems: true,
        },
      });

      await tx.classCouncilTrimester.upsert({
        where: { boardId_trimester: { boardId, trimester: payload.trimester } },
        create: {
          schoolId,
          boardId,
          trimester: payload.trimester,
          status: "IN_PROGRESS",
          linkedMinuteId: created.id,
          updatedByName: authorName,
          updatedByEmail: authorEmail,
        },
        update: {
          linkedMinuteId: created.id,
        },
      });

      return created;
    });
  }

  // source === "STUDENT_DELIBERATION"
  if (matchedCards.length === 0) {
    throw new CouncilDomainError(
      "Selecione ao menos um estudante para gerar rascunho de ata individual.",
      400
    );
  }

  const hasSensitiveStudent = matchedCards.some(
    (c) => c.hasSensitiveHealthTag || computeHasSensitiveHealthTag(c.tags)
  );
  const isConfidential = Boolean(payload.isConfidential) || hasSensitiveStudent;

  const opinionField = getOpinionFieldName(payload.trimester);
  const belowAvgField = getBelowAvgFieldName(payload.trimester);

  const studentSections = matchedCards.map((card) => {
    const opinion = (card[opinionField] as string | null | undefined) || "";
    const belowAvg = parseBelowAverageJson(card[belowAvgField] as string | null | undefined);
    const descriptorsSummary = card.subjectEntries
      .filter((entry) => entry.descriptorCodes.length > 0)
      .map((entry) => {
        const subjectLabel = subjectNameById.get(entry.subjectId) || "Componente";
        const labels = entry.descriptorCodes
          .map((code) => COUNCIL_DESCRIPTOR_LABELS[code] || `Descritivo ${code}`)
          .join("; ");
        return `- ${subjectLabel}: ${labels}${entry.grade !== null && entry.grade !== undefined ? ` (Nota: ${entry.grade})` : ""}`;
      });

    const parts: string[] = [`Estudante: ${card.student.name} (Turma ${board.classGroup.name})`];
    if (opinion) {
      parts.push(`Parecer do ${payload.trimester}º Trimestre:\n${opinion}`);
    }
    if (belowAvg.length > 0) {
      parts.push(
        `Componentes abaixo da média: ${belowAvg
          .map((b) => (b.grade !== null ? `${b.subjectName} (${b.grade})` : b.subjectName))
          .join(", ")}`
      );
    }
    if (descriptorsSummary.length > 0) {
      parts.push(`Registros por componente:\n${descriptorsSummary.join("\n")}`);
    }
    return parts.join("\n");
  });

  const minuteSubject =
    matchedCards.length === 1
      ? `Deliberação do Conselho de Classe — ${matchedCards[0].student.name} (${board.classGroup.name} · ${payload.trimester}º Trim./${board.year})`
      : `Deliberação do Conselho de Classe — ${board.classGroup.name} (${matchedCards.length} estudantes · ${payload.trimester}º Trim./${board.year})`;

  return prisma.pedagogicalMinute.create({
    data: {
      schoolId,
      year: board.year,
      status: "DRAFT",
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      isConfidential,
      attendedAt: new Date(),
      subject: minuteSubject,
      rawNotes: null,
      summary: studentSections.join("\n\n"),
      agreementsSummary: null,
      verificationCode: generateVerificationCode(),
      authorId: authorId || null,
      authorName,
      authorEmail,
      authorRole,
      authorIp: authorIp || null,
      students: {
        create: matchedCards.map((c) => ({
          studentId: c.student.id,
          studentNameSnapshot: c.student.name,
          classNameSnapshot: board.classGroup.name,
          cgmSnapshot: c.student.cgm || null,
        })),
      },
    },
    include: {
      students: true,
      participants: true,
      actionItems: true,
    },
  });
}
