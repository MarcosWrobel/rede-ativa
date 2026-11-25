import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/ataCrypto";
import * as currentSchoolModule from "@/lib/currentSchool";
import { checkIsSuperAdmin, type AuthSessionLike } from "@/lib/roles";
import {
  councilBelowAvgItemSchema,
  councilBoardMetadataUpdateSchema,
  councilBoardUpsertSchema,
  councilGenerateMinuteSchema,
  councilMatrixBatchSaveSchema,
  councilPostActionItemSchema,
  councilPreCouncilSchema,
  councilSeatingMapLayoutSchema,
  councilStudentCardUpdateSchema,
  councilSubjectsBatchSchema,
  councilTrimesterUpdateSchema,
} from "@/lib/schemas";
import {
  buildConversationFromSubject,
  buildInitialPreCouncilData,
  canConversationConfirmDigitalAck,
  createEmptyPreCouncilSynthesis,
  DEFAULT_PRE_COUNCIL_OBJECTIVE,
  DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
  getDefaultPreCouncilPeriodLabel,
  getTodayYmdSaoPaulo,
  mergeSubjectsIntoPreCouncilConversations,
  parsePreCouncilData,
} from "@/components/conselho/preCouncilUtils";
import type {
  PreCouncilData,
  PreCouncilSubjectConversation,
  PreCouncilSynthesis,
} from "@/components/conselho/types";

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
  if (!session?.user || session.user.active === false) return false;
  if (!schoolId || !schoolId.trim()) return false;
  if (checkIsSuperAdmin(session)) return true;

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

  return false;
}

/**
 * Resolve estritamente a escola autorizada para a sessão autenticada no Conselho de Classe
 * sem fallback silencioso para a Escola Piloto Fundadora (INEP 41042730).
 */
export async function resolveAuthorizedSchoolForCouncil(
  session: AuthSessionLike | null | undefined,
  explicitSchoolId?: string | null
): Promise<currentSchoolModule.SchoolContext | null> {
  if (!session?.user || session.user.active === false) {
    return null;
  }

  const isSuper = checkIsSuperAdmin(session);
  const role = (session.user.role || "").toUpperCase();
  const sessionSchoolId = session.user.schoolId ? String(session.user.schoolId).trim() : null;
  const userSchools = session.user.schools || [];
  const userNetworks = session.user.networks || [];

  const hasExplicitSchool =
    Boolean(sessionSchoolId) ||
    userSchools.some((s) => s.active !== false && Boolean((s.schoolId || s.id || "").trim()));
  const hasNetworkScope = role === "GESTAO_SECRETARIA" && userNetworks.length > 0;

  if (!isSuper && !hasExplicitSchool && !hasNetworkScope) {
    return null;
  }

  let authorizedResolver: typeof currentSchoolModule.getAuthorizedCurrentSchool | undefined;
  try {
    authorizedResolver = currentSchoolModule.getAuthorizedCurrentSchool;
  } catch {
    authorizedResolver = undefined;
  }

  if (typeof authorizedResolver === "function") {
    return authorizedResolver(session, explicitSchoolId);
  }

  // Fallback exclusivo para mocks parciais de testes que expõem apenas getCurrentSchool
  const school = await currentSchoolModule.getCurrentSchool(explicitSchoolId);
  if (!school) return null;
  if (isSuper || hasNetworkScope) return school;

  const hasDirectMatch =
    sessionSchoolId === school.id ||
    userSchools.some(
      (s) => s.active !== false && (s.schoolId === school.id || s.id === school.id)
    );
  return hasDirectMatch ? school : null;
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

async function validateAndSerializeSeatingMapLayout(params: {
  schoolId: string;
  boardId: string;
  layout: z.infer<typeof councilSeatingMapLayoutSchema> | null;
}): Promise<string | null> {
  const { schoolId, boardId, layout } = params;
  if (layout === null) {
    return null;
  }

  const seenMapIds = new Set<string>();
  const allStudentIds = new Set<string>();

  for (const map of layout.maps) {
    if (seenMapIds.has(map.id)) {
      throw new CouncilDomainError("Existem versões de mapa de sala com identificador duplicado.", 400);
    }
    seenMapIds.add(map.id);

    const seenCoords = new Set<string>();
    const seenStudentsInMap = new Set<string>();

    for (const seat of map.seats) {
      if (seat.col < 0 || seat.col >= map.columns || seat.row < 0 || seat.row >= map.rows) {
        throw new CouncilDomainError("Coordenada de carteira fora dos limites da planta da sala.", 400);
      }

      const coordKey = `${seat.col}:${seat.row}`;
      if (seenCoords.has(coordKey)) {
        throw new CouncilDomainError("Coordenada de carteira duplicada no mapa de sala.", 400);
      }
      seenCoords.add(coordKey);

      if (seat.blocked && seat.studentId) {
        throw new CouncilDomainError("Carteira bloqueada não pode ter estudante associado.", 400);
      }

      if (seat.studentId) {
        if (seenStudentsInMap.has(seat.studentId)) {
          throw new CouncilDomainError("Um mesmo estudante não pode ocupar duas carteiras no mesmo mapa.", 400);
        }
        seenStudentsInMap.add(seat.studentId);
        allStudentIds.add(seat.studentId);
      }
    }
  }

  if (layout.activeMapId !== null && !seenMapIds.has(layout.activeMapId)) {
    throw new CouncilDomainError("O mapa de sala vigente selecionado não existe na lista.", 400);
  }

  if (allStudentIds.size > 0) {
    const requestedIds = Array.from(allStudentIds);
    const matched = await prisma.studentCouncilCard.findMany({
      where: {
        boardId,
        schoolId,
        studentId: { in: requestedIds },
      },
      select: { studentId: true },
    });

    if (matched.length !== requestedIds.length) {
      throw new CouncilDomainError(
        "Um ou mais estudantes do mapa de sala não pertencem a esta turma ou instituição.",
        400
      );
    }
  }

  const normalized = {
    version: layout.version,
    activeMapId: layout.activeMapId,
    maps: layout.maps.map((map) => ({
      ...map,
      effectiveDate: map.effectiveDate?.trim() || null,
      notes: map.notes?.trim() || null,
    })),
  };

  return JSON.stringify(normalized);
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

  const seatingMapLayoutJson =
    payload.seatingMapLayout !== undefined
      ? await validateAndSerializeSeatingMapLayout({
          schoolId,
          boardId,
          layout: payload.seatingMapLayout,
        })
      : undefined;

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
      ...(seatingMapLayoutJson !== undefined ? { seatingMapLayoutJson } : {}),
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
      select: { id: true, name: true, active: true, teacherEmail: true, teacherName: true },
    });

    const existingById = new Map(existingSubjects.map((ex) => [ex.id, ex]));
    const existingByName = new Map(
      existingSubjects.map((ex) => [ex.name.trim().toLowerCase(), ex])
    );
    const prevEmailById = new Map(
      existingSubjects.map((ex) => [
        ex.id,
        ex.teacherEmail?.trim() ? ex.teacherEmail.trim().toLowerCase() : null,
      ])
    );

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

    const changedTeacherBySubjectId = new Map<
      string,
      { teacherEmail: string | null; teacherName: string | null; subjectName: string }
    >();

    for (let idx = 0; idx < incomingSubjects.length; idx++) {
      const item = incomingSubjects[idx];
      const cleanName = item.name.trim();
      const cleanTeacherName = item.teacherName?.trim() || null;
      const cleanTeacherEmail = item.teacherEmail?.trim()
        ? item.teacherEmail.trim().toLowerCase()
        : null;
      const order = item.displayOrder ?? idx;
      const prevSubject = item.id
        ? existingById.get(item.id)
        : existingByName.get(cleanName.toLowerCase());

      let savedSubjectId = item.id || null;

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
        const upserted = await tx.classCouncilSubject.upsert({
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
        savedSubjectId = upserted.id;
      }

      if (prevSubject && savedSubjectId) {
        const prevEmailNorm = prevEmailById.get(prevSubject.id) ?? null;
        if (prevEmailNorm !== cleanTeacherEmail) {
          changedTeacherBySubjectId.set(savedSubjectId, {
            teacherEmail: cleanTeacherEmail,
            teacherName: cleanTeacherName,
            subjectName: cleanName,
          });
        }
      }
    }

    if (
      changedTeacherBySubjectId.size > 0 &&
      typeof tx.classCouncilTrimester?.findMany === "function" &&
      typeof tx.classCouncilTrimester?.update === "function"
    ) {
      const trimesters = await tx.classCouncilTrimester.findMany({
        where: { boardId, schoolId },
        select: { id: true, trimester: true, preCouncilJson: true },
      });

      for (const tri of trimesters) {
        const parsedPre = parsePreCouncilData(tri.preCouncilJson);
        if (!parsedPre) continue;
        let touched = false;
        const nextConversations = parsedPre.conversations.map((conv) => {
          if (!conv.subjectId) return conv;
          const change = changedTeacherBySubjectId.get(conv.subjectId);
          if (!change) return conv;
          touched = true;
          return {
            ...conv,
            teacherEmail: change.teacherEmail,
            teacherName: change.teacherName ?? conv.teacherName,
          };
        });
        if (touched) {
          await tx.classCouncilTrimester.update({
            where: { id: tri.id },
            data: {
              preCouncilJson: JSON.stringify({
                ...parsedPre,
                conversations: nextConversations,
              }),
            },
          });
        }
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
    select: { id: true, schoolId: true, classGroupId: true },
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
      const dt = parseCouncilCalendarDateToSaoPauloMidday(payload.postCouncilHeldAt);
      if (!dt) {
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

  if (
    payload.preCouncil !== undefined &&
    payload.preCouncil !== null &&
    board.classGroupId &&
    typeof prisma.student?.findMany === "function" &&
    typeof prisma.studentCouncilCard?.findMany === "function"
  ) {
    await syncMissingStudentCardsForBoard(prisma, schoolId, boardId, board.classGroupId);
  }

  return prisma.$transaction(async (tx) => {
    let serializedPreCouncil: string | null | undefined = undefined;
    if (payload.preCouncil !== undefined) {
      serializedPreCouncil = await validateAndSerializePreCouncilData({
        client: tx,
        schoolId,
        boardId,
        trimester: payload.trimester,
        preCouncil: payload.preCouncil,
      });
    }

    return tx.classCouncilTrimester.upsert({
      where: { boardId_trimester: { boardId, trimester: payload.trimester } },
      create: {
        schoolId,
        boardId,
        trimester: payload.trimester,
        status: payload.status ?? "IN_PROGRESS",
        positivePoints: payload.positivePoints?.trim() || null,
        attentionPoints: payload.attentionPoints?.trim() || null,
        plannedActions: payload.plannedActions?.trim() || null,
        preCouncilJson: serializedPreCouncil ?? null,
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
        ...(serializedPreCouncil !== undefined ? { preCouncilJson: serializedPreCouncil } : {}),
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
  });
}

async function validateAndSerializePreCouncilData(params: {
  client: Prisma.TransactionClient | typeof prisma;
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  preCouncil: z.infer<typeof councilPreCouncilSchema> | null;
}): Promise<string | null> {
  const { client, schoolId, boardId, trimester, preCouncil } = params;
  if (preCouncil === null) {
    return null;
  }

  const seenIds = new Set<string>();
  const distinctSubjectIds = new Set<string>();
  const distinctStudentIds = new Set<string>();

  for (const conv of preCouncil.conversations) {
    const cleanId = conv.id.trim();
    if (seenIds.has(cleanId)) {
      throw new CouncilDomainError(
        "Existem linhas do Pré-Conselho com identificador duplicado.",
        400
      );
    }
    seenIds.add(cleanId);

    if (conv.subjectId) {
      distinctSubjectIds.add(conv.subjectId.trim());
    }
    for (const studentId of conv.monitoredStudentIds || []) {
      const cleanStudentId = studentId.trim();
      if (cleanStudentId) {
        distinctStudentIds.add(cleanStudentId);
      }
    }
  }

  const subjectById = new Map<
    string,
    { id: string; teacherEmail: string | null; teacherName: string | null }
  >();
  if (distinctSubjectIds.size > 0) {
    const subjectIdsArr = Array.from(distinctSubjectIds);
    const matchedSubjects = await client.classCouncilSubject.findMany({
      where: {
        id: { in: subjectIdsArr },
        boardId,
        schoolId,
      },
      select: { id: true, teacherEmail: true, teacherName: true },
    });
    if (matchedSubjects.length !== subjectIdsArr.length) {
      throw new CouncilDomainError(
        "Um ou mais componentes curriculares do Pré-Conselho não pertencem a esta turma ou instituição.",
        400
      );
    }
    for (const subj of matchedSubjects) {
      subjectById.set(subj.id, subj);
    }
  }

  const existingTrimesters = await client.classCouncilTrimester.findMany({
    where: { boardId, schoolId },
    select: { trimester: true, preCouncilJson: true },
  });
  const currentTrimester = existingTrimesters.find((t) => t.trimester === trimester) || null;
  const existingParsed = parsePreCouncilData(currentTrimester?.preCouncilJson);

  // Preserva estritamente ciências digitais, envios docentes verificados e contribuições
  // docentes recém-submetidas que ainda não estavam no rascunho da equipe pedagógica.
  const existingById = new Map<string, PreCouncilSubjectConversation>();
  const existingBySubjectId = new Map<string, PreCouncilSubjectConversation>();
  if (existingParsed) {
    for (const row of existingParsed.conversations) {
      existingById.set(row.id, row);
      if (row.subjectId) {
        existingBySubjectId.set(row.subjectId, row);
      }
      for (const studentId of row.monitoredStudentIds || []) {
        const cleanStudentId = studentId.trim();
        if (cleanStudentId) {
          distinctStudentIds.add(cleanStudentId);
        }
      }
    }
  }

  const validStudentIdSet = new Set<string>();
  if (distinctStudentIds.size > 0) {
    const studentIdsArr = Array.from(distinctStudentIds);
    const matchedCards = await client.studentCouncilCard.findMany({
      where: {
        boardId,
        schoolId,
        studentId: { in: studentIdsArr },
      },
      select: { studentId: true },
    });
    for (const card of matchedCards) {
      validStudentIdSet.add(card.studentId);
    }
  }

  // Rejeita apenas IDs novos que não pertencem a StudentCouncilCard(boardId, schoolId);
  // IDs órfãos previamente persistidos na mesma conversa são podados na normalização abaixo.
  for (const conv of preCouncil.conversations) {
    const cleanId = conv.id.trim();
    const cleanSubjectId = conv.subjectId?.trim() || null;
    const existing =
      existingById.get(cleanId) ??
      (cleanSubjectId ? existingBySubjectId.get(cleanSubjectId) : undefined);
    const persistedIdsForConv = new Set(existing?.monitoredStudentIds || []);
    for (const rawId of conv.monitoredStudentIds || []) {
      const cleanStudentId = rawId.trim();
      if (!validStudentIdSet.has(cleanStudentId) && !persistedIdsForConv.has(cleanStudentId)) {
        throw new CouncilDomainError(
          "Um ou mais estudantes selecionados no Pré-Conselho não pertencem a esta turma ou instituição.",
          400
        );
      }
    }
  }

  const subjectTeacherUpdates: Array<{
    subjectId: string;
    teacherEmail: string | null;
    teacherName: string | null;
  }> = [];

  const normalizedConversations: PreCouncilSubjectConversation[] = preCouncil.conversations.map(
    (conv) => {
      const cleanId = conv.id.trim();
      const cleanSubjectId = conv.subjectId?.trim() || null;
      const existing =
        existingById.get(cleanId) ??
        (cleanSubjectId ? existingBySubjectId.get(cleanSubjectId) : undefined);
      const serverSubmittedAt = existing?.teacherSubmittedAt ?? null;
      const incomingKnownSubmittedAt = (conv.teacherSubmittedAt || "").trim() || null;
      const hasUnseenTeacherSubmission =
        Boolean(serverSubmittedAt) && incomingKnownSubmittedAt !== serverSubmittedAt;

      const incomingIds = Array.from(
        new Set(
          (conv.monitoredStudentIds || [])
            .map((id) => id.trim())
            .filter((id) => validStudentIdSet.has(id))
        )
      );
      const existingValidIds = (existing?.monitoredStudentIds || []).filter((id) =>
        validStudentIdSet.has(id)
      );
      const mergedMonitoredIds = hasUnseenTeacherSubmission
        ? Array.from(new Set([...existingValidIds, ...incomingIds]))
        : incomingIds;

      const existingNotes = (existing?.monitoredStudentsNotes || "").trim();
      const incomingNotes = (conv.monitoredStudentsNotes || "").trim();
      let mergedNotes = incomingNotes;
      if (hasUnseenTeacherSubmission && existingNotes) {
        if (!incomingNotes) {
          mergedNotes = existingNotes;
        } else if (incomingNotes !== existingNotes && !incomingNotes.includes(existingNotes)) {
          mergedNotes = `${existingNotes}\n${incomingNotes}`.slice(0, 3000);
        }
      }

      const incomingTeacherName = (conv.teacherName || "").trim();
      const existingTeacherName = (existing?.teacherName || "").trim();
      const resolvedTeacherName =
        hasUnseenTeacherSubmission && !incomingTeacherName && existingTeacherName
          ? existingTeacherName
          : incomingTeacherName;

      const incomingTeacherEmail = conv.teacherEmail?.trim()
        ? conv.teacherEmail.trim().toLowerCase()
        : null;
      const existingTeacherEmail = existing?.teacherEmail?.trim()
        ? existing.teacherEmail.trim().toLowerCase()
        : null;
      const resolvedTeacherEmail =
        hasUnseenTeacherSubmission && !incomingTeacherEmail && existingTeacherEmail
          ? existingTeacherEmail
          : incomingTeacherEmail;

      if (cleanSubjectId && !hasUnseenTeacherSubmission) {
        const subj = subjectById.get(cleanSubjectId);
        if (subj) {
          const subjEmail = subj.teacherEmail?.trim()
            ? subj.teacherEmail.trim().toLowerCase()
            : null;
          const subjName = (subj.teacherName || "").trim() || null;

          const emailExplicitlyChanged =
            existing !== undefined
              ? resolvedTeacherEmail !== existingTeacherEmail
              : resolvedTeacherEmail !== null && resolvedTeacherEmail !== subjEmail;
          const emailBackfilled = !subjEmail && resolvedTeacherEmail !== null;
          const nameBackfilled = !subjName && Boolean(resolvedTeacherName);

          if (
            (emailExplicitlyChanged && resolvedTeacherEmail !== subjEmail) ||
            emailBackfilled ||
            nameBackfilled
          ) {
            subjectTeacherUpdates.push({
              subjectId: cleanSubjectId,
              teacherEmail:
                emailExplicitlyChanged || emailBackfilled ? resolvedTeacherEmail : subjEmail,
              teacherName: nameBackfilled
                ? resolvedTeacherName
                : emailExplicitlyChanged && resolvedTeacherName
                  ? resolvedTeacherName
                  : subjName,
            });
          }
        }
      }

      return {
        id: cleanId,
        subjectId: cleanSubjectId,
        subjectName: conv.subjectName.trim(),
        teacherName: resolvedTeacherName,
        teacherEmail: resolvedTeacherEmail,
        monitoredStudentIds: mergedMonitoredIds,
        monitoredStudentsNotes: mergedNotes,
        agreements: (conv.agreements || "").trim(),
        conversationStatus: conv.conversationStatus === "COMPLETED" ? "COMPLETED" : "PENDING",
        conversationDate: conv.conversationDate?.trim() || null,
        teacherSubmittedAt: serverSubmittedAt,
        digitalAckEmail: existing?.digitalAckEmail ?? null,
        digitalAckName: existing?.digitalAckName ?? null,
        digitalAckAt: existing?.digitalAckAt ?? null,
      };
    }
  );

  if (
    subjectTeacherUpdates.length > 0 &&
    typeof client.classCouncilSubject?.update === "function"
  ) {
    for (const upd of subjectTeacherUpdates) {
      await client.classCouncilSubject.update({
        where: { id: upd.subjectId },
        data: {
          teacherEmail: upd.teacherEmail,
          teacherName: upd.teacherName,
        },
      });
    }
  }

  const normalized: PreCouncilData = {
    version: 1,
    periodLabel: preCouncil.periodLabel.trim() || getDefaultPreCouncilPeriodLabel(trimester),
    objectiveText: (preCouncil.objectiveText || "").trim() || DEFAULT_PRE_COUNCIL_OBJECTIVE,
    responsiblePedagogueName: (preCouncil.responsiblePedagogueName || "").trim(),
    responsiblePedagogueRole:
      (preCouncil.responsiblePedagogueRole || "").trim() || DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
    conversations: normalizedConversations,
    synthesis: {
      mainDifficulties: (preCouncil.synthesis.mainDifficulties || "").trim(),
      priorityStudents: (preCouncil.synthesis.priorityStudents || "").trim(),
      attendanceIssues: (preCouncil.synthesis.attendanceIssues || "").trim(),
      behaviorIssues: (preCouncil.synthesis.behaviorIssues || "").trim(),
      pedagogicalActions: (preCouncil.synthesis.pedagogicalActions || "").trim(),
    },
  };

  return JSON.stringify(normalized);
}

async function saveCouncilMatrixBatchInTx(
  tx: Prisma.TransactionClient,
  params: {
    schoolId: string;
    boardId: string;
    payload: z.infer<typeof councilMatrixBatchSaveSchema>;
    userEmail: string;
  }
) {
  const { schoolId, boardId, payload, userEmail } = params;

  const distinctStudentIds = Array.from(new Set(payload.entries.map((e) => e.studentId)));
  const distinctSubjectIds = Array.from(new Set(payload.entries.map((e) => e.subjectId)));

  const [cards, subjects] = await Promise.all([
    tx.studentCouncilCard.findMany({
      where: { boardId, schoolId, studentId: { in: distinctStudentIds } },
      select: {
        id: true,
        studentId: true,
        trimester1BelowAvgJson: true,
        trimester2BelowAvgJson: true,
        trimester3BelowAvgJson: true,
      },
    }),
    tx.classCouncilSubject.findMany({
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
    {
      cardId: string;
      subjectId: string;
      descriptorCodes: number[];
      grade: number | null | undefined;
    }
  >();

  for (const entry of payload.entries) {
    const card = cardByStudentId.get(entry.studentId);
    if (!card) continue;
    const key = `${card.id}::${entry.subjectId}`;
    dedupedEntries.set(key, {
      cardId: card.id,
      subjectId: entry.subjectId,
      descriptorCodes: entry.descriptorCodes,
      grade: entry.grade,
    });
  }

  const entriesList = Array.from(dedupedEntries.values());
  const affectedCardIds = Array.from(new Set(entriesList.map((e) => e.cardId)));
  const belowAvgField = getBelowAvgFieldName(payload.trimester);

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
        grade: item.grade ?? null,
        updatedByEmail: userEmail,
      },
      update: {
        descriptorCodes: item.descriptorCodes,
        ...(item.grade !== undefined ? { grade: item.grade } : {}),
        updatedByEmail: userEmail,
      },
    });
  }

  for (const cardId of affectedCardIds) {
    const cardRecord = cards.find((c) => c.id === cardId);

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

    const matrixGradedSubjectIds = new Set(
      cardEntries
        .filter((e) => e.grade !== null && e.grade !== undefined)
        .map((e) => e.subjectId)
    );

    const belowFromMatrix: CouncilBelowAvgItem[] = cardEntries
      .filter((e) => isBelowAverageGrade(e.grade))
      .sort((a, b) => (a.subject.displayOrder ?? 0) - (b.subject.displayOrder ?? 0))
      .map((e) => ({
        subjectId: e.subject.id,
        subjectName: e.subject.name,
        grade: e.grade ?? null,
      }));

    const belowFromMatrixSubjectIds = new Set(belowFromMatrix.map((item) => item.subjectId));

    const preservedExistingItems = parseBelowAverageJson(
      cardRecord?.[belowAvgField] as string | null | undefined
    ).filter(
      (item) =>
        !item.subjectId ||
        (!matrixGradedSubjectIds.has(item.subjectId) &&
          !belowFromMatrixSubjectIds.has(item.subjectId))
    );

    const merged = [...belowFromMatrix, ...preservedExistingItems];

    await tx.studentCouncilCard.update({
      where: { id: cardId },
      data: {
        [belowAvgField]: merged.length > 0 ? JSON.stringify(merged) : null,
      },
    });
  }

  return {
    updatedCount: entriesList.length,
    trimester: payload.trimester,
  };
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

  return prisma.$transaction((tx) =>
    saveCouncilMatrixBatchInTx(tx, { schoolId, boardId, payload, userEmail })
  );
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

function parseCouncilCalendarDateToSaoPauloMidday(
  raw: string | Date | null | undefined
): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    if (
      raw.getUTCHours() === 0 &&
      raw.getUTCMinutes() === 0 &&
      raw.getUTCSeconds() === 0 &&
      raw.getUTCMilliseconds() === 0
    ) {
      const ymd = raw.toISOString().slice(0, 10);
      return new Date(`${ymd}T12:00:00-03:00`);
    }
    return raw;
  }

  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T12:00:00-03:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/i.test(trimmed)) {
    const parsed = new Date(`${trimmed.slice(0, 10)}T12:00:00-03:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
          attendedAt:
            parseCouncilCalendarDateToSaoPauloMidday(trimesterRecord?.postCouncilHeldAt) ||
            new Date(),
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
              dueDate: parseCouncilCalendarDateToSaoPauloMidday(a.dueDate),
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

export interface TeacherPortalSubjectOption {
  id: string;
  name: string;
  teacherName: string | null;
  teacherEmail: string | null;
  displayOrder: number;
}

export interface TeacherPortalStudentItem {
  studentId: string;
  name: string;
  cgm: string | null;
  enrollmentStatus: string;
  attendancePercent: number | null;
  subjectEntries: Array<{
    subjectId: string;
    descriptorCodes: number[];
    grade: number | null;
    updatedByEmail: string | null;
  }>;
}

export interface TeacherPortalPreCouncilConversationSummary {
  id: string;
  subjectId: string | null;
  subjectName: string;
  teacherName: string;
  teacherEmail: string | null;
  monitoredStudentIds: string[];
  monitoredStudentsNotes: string;
  agreements: string;
  conversationStatus: "PENDING" | "COMPLETED";
  conversationDate: string | null;
  teacherSubmittedAt: string | null;
  digitalAckEmail: string | null;
  digitalAckName: string | null;
  digitalAckAt: string | null;
  canConfirmAck: boolean;
}

export interface TeacherPortalPreCouncilSummary {
  periodLabel: string;
  objectiveText: string;
  responsiblePedagogueName: string;
  responsiblePedagogueRole: string;
  synthesis: PreCouncilSynthesis;
  conversationsBySubjectId: Record<string, TeacherPortalPreCouncilConversationSummary>;
}

export interface TeacherPortalCouncilContext {
  boardId: string;
  year: number;
  trimester: 1 | 2 | 3;
  lockedSubjectId: string | null;
  lockedConversationId?: string | null;
  schoolName: string;
  classGroup: {
    id: string;
    name: string;
    segment: string;
    shift: string;
  };
  trimesterStatus: string;
  subjects: TeacherPortalSubjectOption[];
  students: TeacherPortalStudentItem[];
  preCouncil: TeacherPortalPreCouncilSummary;
}

/**
 * Carrega o contexto seguro do Conselho de Classe e Pré-Conselho para o Portal do Professor (@escola.pr.gov.br).
 * Aplica filtragem estrita LGPD/ECA: omite integralmente selos de saúde (ALUNO_COM_LAUDO / AEE),
 * flags de necessidades especiais e pareceres qualitativos sigilosos.
 */
export async function getTeacherPortalCouncilContext(params: {
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  lockedSubjectId: string | null;
  lockedConversationId?: string | null;
  includeCgm?: boolean;
  verifiedEmail?: string | null;
}): Promise<TeacherPortalCouncilContext> {
  const {
    schoolId,
    boardId,
    trimester,
    lockedSubjectId,
    lockedConversationId = null,
    includeCgm = false,
    verifiedEmail = null,
  } = params;

  const boardHeader = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: { id: true, schoolId: true, classGroupId: true },
  });

  if (!boardHeader) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (boardHeader.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  await ensureTrimestersForBoard(prisma, schoolId, boardId);
  await syncMissingStudentCardsForBoard(prisma, schoolId, boardId, boardHeader.classGroupId);

  const [board, schoolRecord] = await Promise.all([
    prisma.classCouncilBoard.findUnique({
      where: { id: boardId },
      include: {
        classGroup: { select: { id: true, name: true, segment: true, shift: true } },
        subjects: {
          where: { active: true },
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        },
        trimesters: {
          where: { trimester },
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
                lowAttendanceRecord: {
                  select: { attendancePercent: true },
                },
              },
            },
            subjectEntries: {
              where: { trimester },
            },
          },
        },
      },
    }),
    prisma.school?.findUnique
      ? prisma.school.findUnique({
          where: { id: schoolId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  if (!board || board.schoolId !== schoolId) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }

  const activeSubjects = (board.subjects || [])
    .filter((s) => s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "pt-BR"));

  let filteredSubjects = activeSubjects;
  if (lockedSubjectId) {
    const locked = activeSubjects.find((s) => s.id === lockedSubjectId);
    if (!locked) {
      throw new CouncilDomainError(
        "O componente curricular indicado neste link não está ativo ou não pertence a esta turma.",
        404
      );
    }
    filteredSubjects = [locked];
  }

  const activeSubjectIdSet = new Set(filteredSubjects.map((s) => s.id));
  const trimesterRecord = (board.trimesters || []).find((t) => t.trimester === trimester) || null;
  const parsedPreCouncil =
    parsePreCouncilData(trimesterRecord?.preCouncilJson) ??
    buildInitialPreCouncilData({
      trimester,
      subjects: activeSubjects,
    });

  const validStudentIdSet = new Set(
    (board.studentCards || []).filter((c) => Boolean(c.student)).map((c) => c.studentId)
  );
  const cleanViewerEmail = verifiedEmail ? verifiedEmail.trim().toLowerCase() : null;
  const accessibleSubjectIdSet = new Set<string>();

  const conversationsBySubjectId: Record<string, TeacherPortalPreCouncilConversationSummary> = {};
  for (const subj of filteredSubjects) {
    const matchedConv =
      parsedPreCouncil.conversations.find((c) => c.subjectId === subj.id) ||
      parsedPreCouncil.conversations.find(
        (c) => c.subjectName.trim().toLowerCase() === subj.name.trim().toLowerCase()
      ) ||
      buildConversationFromSubject(subj);

    const subjOwnerEmail = (subj.teacherEmail || "").trim().toLowerCase();
    const convOwnerEmail = (matchedConv.teacherEmail || "").trim().toLowerCase();
    const isOwnedByOther =
      Boolean(cleanViewerEmail) &&
      ((Boolean(subjOwnerEmail) && subjOwnerEmail !== cleanViewerEmail) ||
        (Boolean(convOwnerEmail) && convOwnerEmail !== cleanViewerEmail));

    if (!isOwnedByOther) {
      accessibleSubjectIdSet.add(subj.id);
    }

    if (isOwnedByOther) {
      conversationsBySubjectId[subj.id] = {
        id: matchedConv.id,
        subjectId: subj.id,
        subjectName: matchedConv.subjectName || subj.name,
        teacherName: matchedConv.teacherName || subj.teacherName || "",
        teacherEmail: matchedConv.teacherEmail || subj.teacherEmail || null,
        monitoredStudentIds: [],
        monitoredStudentsNotes: "",
        agreements: "",
        conversationStatus: matchedConv.conversationStatus,
        conversationDate: null,
        teacherSubmittedAt: null,
        digitalAckEmail: null,
        digitalAckName: null,
        digitalAckAt: null,
        canConfirmAck: false,
      };
    } else {
      conversationsBySubjectId[subj.id] = {
        id: matchedConv.id,
        subjectId: subj.id,
        subjectName: matchedConv.subjectName || subj.name,
        teacherName: matchedConv.teacherName || subj.teacherName || "",
        teacherEmail: matchedConv.teacherEmail || subj.teacherEmail || null,
        monitoredStudentIds: matchedConv.monitoredStudentIds.filter((id) =>
          validStudentIdSet.has(id)
        ),
        monitoredStudentsNotes: matchedConv.monitoredStudentsNotes,
        agreements: matchedConv.agreements,
        conversationStatus: matchedConv.conversationStatus,
        conversationDate: matchedConv.conversationDate,
        teacherSubmittedAt: matchedConv.teacherSubmittedAt ?? null,
        digitalAckEmail: matchedConv.digitalAckEmail,
        digitalAckName: matchedConv.digitalAckName,
        digitalAckAt: matchedConv.digitalAckAt,
        canConfirmAck: canConversationConfirmDigitalAck(matchedConv),
      };
    }
  }

  const hasAccessibleSubjects = !cleanViewerEmail || accessibleSubjectIdSet.size > 0;
  const visibleEntrySubjectIds = cleanViewerEmail ? accessibleSubjectIdSet : activeSubjectIdSet;

  const students: TeacherPortalStudentItem[] = hasAccessibleSubjects
    ? (board.studentCards || [])
        .filter((card) => Boolean(card.student))
        .sort((a, b) => a.student.name.localeCompare(b.student.name, "pt-BR"))
        .map((card) => ({
          studentId: card.studentId,
          name: card.student.name,
          cgm: includeCgm ? (card.student.cgm ?? null) : null,
          enrollmentStatus: card.enrollmentStatus,
          attendancePercent: card.student.lowAttendanceRecord?.attendancePercent ?? null,
          subjectEntries: (card.subjectEntries || [])
            .filter(
              (e) => e.trimester === trimester && visibleEntrySubjectIds.has(e.subjectId)
            )
            .map((e) => ({
              subjectId: e.subjectId,
              descriptorCodes: Array.isArray(e.descriptorCodes) ? [...e.descriptorCodes] : [],
              grade: e.grade ?? null,
              updatedByEmail: e.updatedByEmail ?? null,
            })),
        }))
    : [];

  return {
    boardId: board.id,
    year: board.year,
    trimester,
    lockedSubjectId,
    lockedConversationId,
    schoolName: schoolRecord?.name || "Instituição de Ensino",
    classGroup: {
      id: board.classGroup.id,
      name: board.classGroup.name,
      segment: board.classGroup.segment,
      shift: board.classGroup.shift,
    },
    trimesterStatus: trimesterRecord?.status || "IN_PROGRESS",
    subjects: filteredSubjects.map((s) => ({
      id: s.id,
      name: s.name,
      teacherName: s.teacherName ?? null,
      teacherEmail: s.teacherEmail ?? null,
      displayOrder: s.displayOrder,
    })),
    students,
    preCouncil: {
      periodLabel: parsedPreCouncil.periodLabel,
      objectiveText: parsedPreCouncil.objectiveText,
      responsiblePedagogueName: parsedPreCouncil.responsiblePedagogueName,
      responsiblePedagogueRole: parsedPreCouncil.responsiblePedagogueRole,
      synthesis: hasAccessibleSubjects
        ? parsedPreCouncil.synthesis
        : createEmptyPreCouncilSynthesis(),
      conversationsBySubjectId,
    },
  };
}

/**
 * Persiste os lançamentos de tags pedagógicas da matriz, aportes prévios do Pré-Conselho
 * e eventual confirmação de ciência docente via conta institucional @escola.pr.gov.br.
 */
function assertPreCouncilConversationAccessAndAck(params: {
  target: PreCouncilSubjectConversation | null;
  cleanEmail: string;
  confirmAck: boolean;
}) {
  const { target, cleanEmail, confirmAck } = params;
  if (target) {
    const targetEmail = (target.teacherEmail || "").trim().toLowerCase();
    if (targetEmail && targetEmail !== cleanEmail) {
      throw new CouncilDomainError(
        `Este componente está vinculado a outro docente (${target.teacherName || targetEmail}). Solicite ajuste à equipe pedagógica se necessário.`,
        403
      );
    }
    if (confirmAck) {
      if (!canConversationConfirmDigitalAck(target)) {
        throw new CouncilDomainError(
          "A confirmação de ciência fica disponível após o registro da conversa ou dos combinados pela equipe pedagógica.",
          400
        );
      }
      const existingAckEmail = (target.digitalAckEmail || "").trim().toLowerCase();
      if (existingAckEmail && existingAckEmail !== cleanEmail) {
        throw new CouncilDomainError(
          `A ciência deste componente já foi confirmada por ${target.digitalAckName || existingAckEmail}.`,
          409
        );
      }
    }
    return;
  }

  if (confirmAck) {
    throw new CouncilDomainError(
      "A confirmação de ciência fica disponível após o registro da conversa ou dos combinados pela equipe pedagógica.",
      400
    );
  }
}

export async function submitTeacherPortalSubjectEntries(params: {
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  lockedSubjectId: string | null;
  subjectId: string;
  verifiedEmail: string;
  verifiedName: string;
  entries?: Array<{ studentId: string; descriptorCodes: number[] }>;
  preCouncil?: {
    monitoredStudentIds: string[];
    monitoredStudentsNotes: string;
  };
  confirmAck?: boolean;
}) {
  const {
    schoolId,
    boardId,
    trimester,
    lockedSubjectId,
    subjectId,
    verifiedEmail,
    verifiedName,
    entries = [],
    preCouncil: preCouncilContribution,
    confirmAck = false,
  } = params;

  if (lockedSubjectId && lockedSubjectId !== subjectId) {
    throw new CouncilDomainError("Este link é exclusivo para outro componente curricular.", 403);
  }

  const board = await prisma.classCouncilBoard.findUnique({
    where: { id: boardId },
    select: { id: true, schoolId: true, classGroupId: true },
  });

  if (!board) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (board.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  const cleanEmail = verifiedEmail.trim().toLowerCase();
  const cleanName = verifiedName.trim() || cleanEmail.split("@")[0];

  await ensureTrimestersForBoard(prisma, schoolId, boardId, cleanName, cleanEmail);
  await syncMissingStudentCardsForBoard(prisma, schoolId, boardId, board.classGroupId);

  const nowIso = new Date().toISOString();
  const todayYmd = getTodayYmdSaoPaulo();

  const outcome = await prisma.$transaction(async (tx) => {
    const matchedSubjects = await tx.classCouncilSubject.findMany({
      where: {
        id: { in: [subjectId] },
        boardId,
        schoolId,
        active: true,
      },
    });
    const subject = matchedSubjects[0];
    if (!subject) {
      throw new CouncilDomainError(
        "Componente curricular não encontrado ou inativo nesta turma.",
        404
      );
    }

    const existingTeacherEmail = (subject.teacherEmail || "").trim().toLowerCase();
    if (existingTeacherEmail && existingTeacherEmail !== cleanEmail) {
      throw new CouncilDomainError(
        `Este componente curricular está vinculado a outro docente (${subject.teacherName || existingTeacherEmail}). Solicite ajuste à coordenação pedagógica se necessário.`,
        403
      );
    }

    const [trimesters, activeSubjects] = await Promise.all([
      tx.classCouncilTrimester.findMany({
        where: { boardId, schoolId },
        select: { trimester: true, preCouncilJson: true },
      }),
      tx.classCouncilSubject.findMany({
        where: { boardId, schoolId, active: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
    ]);

    const currentTri = trimesters.find((t) => t.trimester === trimester) || null;
    const basePreCouncil =
      parsePreCouncilData(currentTri?.preCouncilJson) ??
      buildInitialPreCouncilData({
        trimester,
        subjects: activeSubjects,
      });

    const merged = mergeSubjectsIntoPreCouncilConversations(
      basePreCouncil.conversations,
      activeSubjects
    );

    let conversations = [...merged.conversations];
    let targetIndex = conversations.findIndex((c) => c.subjectId === subject.id);
    if (targetIndex < 0) {
      targetIndex = conversations.findIndex(
        (c) => c.subjectName.trim().toLowerCase() === subject.name.trim().toLowerCase()
      );
    }
    if (targetIndex < 0) {
      conversations.push(buildConversationFromSubject(subject));
      targetIndex = conversations.length - 1;
    }

    const target = conversations[targetIndex];
    const targetEmail = (target.teacherEmail || "").trim().toLowerCase();
    assertPreCouncilConversationAccessAndAck({
      target,
      cleanEmail,
      confirmAck,
    });

    let validatedMonitoredIds: string[] | undefined = undefined;
    if (preCouncilContribution !== undefined) {
      const persistedTargetIds = new Set(target.monitoredStudentIds || []);
      const idsToValidate = Array.from(
        new Set([
          ...preCouncilContribution.monitoredStudentIds.map((id) => id.trim()).filter(Boolean),
          ...persistedTargetIds,
        ])
      );
      const validIdSet = new Set<string>();
      if (idsToValidate.length > 0) {
        const matchedCards = await tx.studentCouncilCard.findMany({
          where: {
            boardId,
            schoolId,
            studentId: { in: idsToValidate },
          },
          select: { studentId: true },
        });
        for (const card of matchedCards) {
          validIdSet.add(card.studentId);
        }
      }

      for (const rawId of preCouncilContribution.monitoredStudentIds) {
        const cleanStudentId = rawId.trim();
        if (!validIdSet.has(cleanStudentId) && !persistedTargetIds.has(cleanStudentId)) {
          throw new CouncilDomainError(
            "Um ou mais estudantes selecionados no Pré-Conselho não pertencem a esta turma ou instituição.",
            400
          );
        }
      }

      validatedMonitoredIds = Array.from(
        new Set(
          preCouncilContribution.monitoredStudentIds
            .map((id) => id.trim())
            .filter((id) => validIdSet.has(id))
        )
      );
    }

    const nextTeacherEmail = existingTeacherEmail || cleanEmail;
    const nextTeacherName = (subject.teacherName || "").trim() || cleanName;

    if (!existingTeacherEmail || !(subject.teacherName || "").trim()) {
      await tx.classCouncilSubject.update({
        where: { id: subject.id },
        data: {
          teacherEmail: nextTeacherEmail,
          teacherName: nextTeacherName,
        },
      });
    }

    let updatedCount = 0;
    if (entries.length > 0) {
      const saved = await saveCouncilMatrixBatchInTx(tx, {
        schoolId,
        boardId,
        payload: {
          trimester,
          entries: entries.map((entry) => ({
            studentId: entry.studentId,
            subjectId: subject.id,
            descriptorCodes: entry.descriptorCodes,
          })),
        },
        userEmail: cleanEmail,
      });
      updatedCount = saved.updatedCount;
    }

    const hasTeacherSubmission = entries.length > 0 || preCouncilContribution !== undefined;

    const updatedConv: PreCouncilSubjectConversation = {
      ...target,
      subjectId: target.subjectId || subject.id,
      subjectName: target.subjectName || subject.name,
      teacherEmail: targetEmail || nextTeacherEmail,
      teacherName: target.teacherName.trim() || nextTeacherName,
      ...(preCouncilContribution !== undefined
        ? {
            monitoredStudentIds: validatedMonitoredIds ?? [],
            monitoredStudentsNotes: preCouncilContribution.monitoredStudentsNotes.trim(),
          }
        : {}),
      ...(hasTeacherSubmission ? { teacherSubmittedAt: nowIso } : {}),
      ...(confirmAck
        ? {
            conversationStatus: "COMPLETED",
            conversationDate: target.conversationDate || todayYmd,
            digitalAckEmail: cleanEmail,
            digitalAckName: cleanName,
            digitalAckAt: nowIso,
          }
        : {}),
    };

    conversations = conversations.map((c, idx) => (idx === targetIndex ? updatedConv : c));

    const nextPreCouncil: PreCouncilData = {
      ...basePreCouncil,
      conversations,
    };

    const savedTrimester = await tx.classCouncilTrimester.upsert({
      where: { boardId_trimester: { boardId, trimester } },
      create: {
        schoolId,
        boardId,
        trimester,
        status: "IN_PROGRESS",
        preCouncilJson: JSON.stringify(nextPreCouncil),
        updatedByName: cleanName,
        updatedByEmail: cleanEmail,
      },
      update: {
        preCouncilJson: JSON.stringify(nextPreCouncil),
      },
    });

    return {
      updatedCount,
      trimester,
      trimesterId: savedTrimester?.id ?? boardId,
      subjectId: subject.id,
      subjectName: subject.name,
      teacherName: nextTeacherName,
      teacherEmail: nextTeacherEmail,
      conversationId: updatedConv.id,
      ackConfirmed: confirmAck,
      digitalAckAt: updatedConv.digitalAckAt,
    };
  });

  return outcome;
}

export interface PreCouncilTeacherPortalConversation {
  id: string;
  subjectId: string | null;
  subjectName: string;
  teacherName: string;
  teacherEmail: string | null;
  monitoredStudents: Array<{
    studentId: string;
    name: string;
  }>;
  monitoredStudentsNotes: string;
  agreements: string;
  conversationStatus: "PENDING" | "COMPLETED";
  conversationDate: string | null;
  digitalAckEmail: string | null;
  digitalAckName: string | null;
  digitalAckAt: string | null;
}

export interface PreCouncilTeacherPortalContext {
  boardId: string;
  year: number;
  trimester: 1 | 2 | 3;
  lockedConversationId: string | null;
  schoolName: string;
  classGroup: {
    id: string;
    name: string;
    segment: string;
    shift: string;
  };
  periodLabel: string;
  objectiveText: string;
  responsiblePedagogueName: string;
  responsiblePedagogueRole: string;
  conversations: PreCouncilTeacherPortalConversation[];
  synthesis: PreCouncilSynthesis;
}

export async function getSavedPreCouncilForLink(params: {
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  conversationId?: string | null;
}): Promise<{
  trimesterId: string;
  preCouncil: PreCouncilData;
  matchedConversation: PreCouncilSubjectConversation | null;
}> {
  const { schoolId, boardId, trimester, conversationId } = params;

  const trimesters = await prisma.classCouncilTrimester.findMany({
    where: { boardId, schoolId },
    select: { id: true, trimester: true, preCouncilJson: true },
  });
  const trimesterRecord = trimesters.find((t) => t.trimester === trimester) || null;
  const parsed = parsePreCouncilData(trimesterRecord?.preCouncilJson);

  if (!parsed || parsed.conversations.length === 0) {
    throw new CouncilDomainError(
      "Salve o Pré-Conselho deste trimestre com ao menos um componente antes de gerar o link de ciência.",
      400
    );
  }

  let matchedConversation: PreCouncilSubjectConversation | null = null;
  if (conversationId) {
    matchedConversation =
      parsed.conversations.find((c) => c.id === conversationId) || null;
    if (!matchedConversation) {
      throw new CouncilDomainError(
        "Componente do Pré-Conselho não encontrado neste trimestre.",
        404
      );
    }
  }

  return {
    trimesterId: trimesterRecord?.id ?? boardId,
    preCouncil: parsed,
    matchedConversation,
  };
}

/**
 * Carrega o contexto LGPD-safe do Pré-Conselho para ciência docente via @escola.pr.gov.br.
 * Omite integralmente selos de saúde, CGM, telefone, pareceres qualitativos sigilosos
 * e anotações/combinados de componentes vinculados a outros docentes.
 */
export async function getPreCouncilTeacherPortalContext(params: {
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  lockedConversationId: string | null;
  verifiedEmail?: string | null;
}): Promise<PreCouncilTeacherPortalContext> {
  const { schoolId, boardId, trimester, lockedConversationId, verifiedEmail = null } = params;

  const [board, schoolRecord] = await Promise.all([
    prisma.classCouncilBoard.findUnique({
      where: { id: boardId },
      include: {
        classGroup: { select: { id: true, name: true, segment: true, shift: true } },
        subjects: {
          where: { active: true },
          select: { id: true, name: true, teacherName: true, teacherEmail: true },
        },
        trimesters: {
          where: { trimester },
        },
        studentCards: {
          orderBy: { student: { name: "asc" } },
          include: {
            student: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.school?.findUnique
      ? prisma.school.findUnique({
          where: { id: schoolId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  if (!board) {
    throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
  }
  if (board.schoolId !== schoolId) {
    throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
  }

  const trimesterRecord = (board.trimesters || []).find((t) => t.trimester === trimester) || null;
  const preCouncil = parsePreCouncilData(trimesterRecord?.preCouncilJson);

  if (!preCouncil || preCouncil.conversations.length === 0) {
    throw new CouncilDomainError(
      "O Pré-Conselho deste trimestre ainda não possui conversas registradas.",
      404
    );
  }

  let visibleConversations = preCouncil.conversations;
  if (lockedConversationId) {
    const matched = visibleConversations.find((c) => c.id === lockedConversationId);
    if (!matched) {
      throw new CouncilDomainError(
        "O componente curricular associado a este link não está mais disponível.",
        404
      );
    }
    visibleConversations = [matched];
  }

  const studentNameById = new Map<string, string>();
  for (const card of board.studentCards || []) {
    if (card.student?.name) {
      studentNameById.set(card.studentId, card.student.name);
    }
  }

  const subjectById = new Map((board.subjects || []).map((s) => [s.id, s]));
  const cleanViewerEmail = verifiedEmail ? verifiedEmail.trim().toLowerCase() : null;

  const isConvOwnedByOther = (c: PreCouncilSubjectConversation): boolean => {
    if (!cleanViewerEmail) return false;
    const convEmail = (c.teacherEmail || "").trim().toLowerCase();
    const subjEmail = (c.subjectId ? subjectById.get(c.subjectId)?.teacherEmail || "" : "")
      .trim()
      .toLowerCase();
    return (
      (Boolean(convEmail) && convEmail !== cleanViewerEmail) ||
      (Boolean(subjEmail) && subjEmail !== cleanViewerEmail)
    );
  };

  const allConversationsOwnedByOthers =
    Boolean(cleanViewerEmail) && visibleConversations.every(isConvOwnedByOther);

  return {
    boardId: board.id,
    year: board.year,
    trimester,
    lockedConversationId,
    schoolName: schoolRecord?.name || "Instituição de Ensino",
    classGroup: {
      id: board.classGroup.id,
      name: board.classGroup.name,
      segment: board.classGroup.segment,
      shift: board.classGroup.shift,
    },
    periodLabel: preCouncil.periodLabel,
    objectiveText: preCouncil.objectiveText,
    responsiblePedagogueName: preCouncil.responsiblePedagogueName,
    responsiblePedagogueRole: preCouncil.responsiblePedagogueRole,
    conversations: visibleConversations.map((c) => {
      const linkedSubj = c.subjectId ? subjectById.get(c.subjectId) : null;
      const effectiveTeacherName = c.teacherName || linkedSubj?.teacherName || "";
      const effectiveTeacherEmail = c.teacherEmail || linkedSubj?.teacherEmail || null;

      if (isConvOwnedByOther(c)) {
        return {
          id: c.id,
          subjectId: c.subjectId,
          subjectName: c.subjectName,
          teacherName: effectiveTeacherName,
          teacherEmail: effectiveTeacherEmail,
          monitoredStudents: [],
          monitoredStudentsNotes: "",
          agreements: "",
          conversationStatus: c.conversationStatus,
          conversationDate: null,
          digitalAckEmail: null,
          digitalAckName: null,
          digitalAckAt: null,
        };
      }

      return {
        id: c.id,
        subjectId: c.subjectId,
        subjectName: c.subjectName,
        teacherName: effectiveTeacherName,
        teacherEmail: effectiveTeacherEmail,
        monitoredStudents: c.monitoredStudentIds
          .map((stId) => {
            const name = studentNameById.get(stId);
            return name ? { studentId: stId, name } : null;
          })
          .filter((item): item is { studentId: string; name: string } => Boolean(item)),
        monitoredStudentsNotes: c.monitoredStudentsNotes,
        agreements: c.agreements,
        conversationStatus: c.conversationStatus,
        conversationDate: c.conversationDate,
        digitalAckEmail: c.digitalAckEmail,
        digitalAckName: c.digitalAckName,
        digitalAckAt: c.digitalAckAt,
      };
    }),
    synthesis: allConversationsOwnedByOthers
      ? createEmptyPreCouncilSynthesis()
      : preCouncil.synthesis,
  };
}

/**
 * Registra ciência digital verificada (@escola.pr.gov.br) para um componente do Pré-Conselho.
 */
export async function confirmPreCouncilTeacherAck(params: {
  schoolId: string;
  boardId: string;
  trimester: 1 | 2 | 3;
  lockedConversationId: string | null;
  conversationId: string;
  verifiedEmail: string;
  verifiedName: string;
}) {
  const {
    schoolId,
    boardId,
    trimester,
    lockedConversationId,
    conversationId,
    verifiedEmail,
    verifiedName,
  } = params;

  if (lockedConversationId && lockedConversationId !== conversationId) {
    throw new CouncilDomainError("Este link é exclusivo para outro componente curricular.", 403);
  }

  const cleanEmail = verifiedEmail.trim().toLowerCase();
  const cleanName = verifiedName.trim() || cleanEmail.split("@")[0];
  const ackAtIso = new Date().toISOString();
  const todayYmd = getTodayYmdSaoPaulo();

  return prisma.$transaction(async (tx) => {
    const board = await tx.classCouncilBoard.findUnique({
      where: { id: boardId },
      select: { id: true, schoolId: true },
    });

    if (!board) {
      throw new CouncilDomainError("Conselho de classe não encontrado.", 404);
    }
    if (board.schoolId !== schoolId) {
      throw new CouncilDomainError("Acesso negado a registro de outra instituição de ensino.", 403);
    }

    const trimesters = await tx.classCouncilTrimester.findMany({
      where: { boardId, schoolId },
      select: { trimester: true, preCouncilJson: true },
    });
    const trimesterRecord = trimesters.find((t) => t.trimester === trimester) || null;
    const preCouncil = parsePreCouncilData(trimesterRecord?.preCouncilJson);

    if (!preCouncil) {
      throw new CouncilDomainError(
        "O Pré-Conselho deste trimestre ainda não foi salvo.",
        404
      );
    }

    const targetIndex = preCouncil.conversations.findIndex((c) => c.id === conversationId);
    if (targetIndex < 0) {
      throw new CouncilDomainError(
        "Componente curricular do Pré-Conselho não encontrado.",
        404
      );
    }

    const target = preCouncil.conversations[targetIndex];
    let linkedSubject: {
      id: string;
      teacherEmail: string | null;
      teacherName: string | null;
    } | null = null;

    if (target.subjectId) {
      const matchedSubjects = await tx.classCouncilSubject.findMany({
        where: {
          id: { in: [target.subjectId] },
          boardId,
          schoolId,
        },
        select: {
          id: true,
          teacherEmail: true,
          teacherName: true,
        },
      });
      linkedSubject = matchedSubjects[0] || null;
    }

    const subjectTeacherEmail = (linkedSubject?.teacherEmail || "").trim().toLowerCase();
    const convTeacherEmail = (target.teacherEmail || "").trim().toLowerCase();

    if (subjectTeacherEmail && subjectTeacherEmail !== cleanEmail) {
      throw new CouncilDomainError(
        `Este componente está vinculado a outro docente (${linkedSubject?.teacherName || target.teacherName || subjectTeacherEmail}). Solicite ajuste à equipe pedagógica se necessário.`,
        403
      );
    }

    if (convTeacherEmail && convTeacherEmail !== cleanEmail) {
      throw new CouncilDomainError(
        `Este componente está vinculado a outro docente (${target.teacherName || convTeacherEmail}). Solicite ajuste à equipe pedagógica se necessário.`,
        403
      );
    }

    if (!canConversationConfirmDigitalAck(target)) {
      throw new CouncilDomainError(
        "A confirmação de ciência fica disponível após o registro da conversa ou dos combinados pela equipe pedagógica.",
        400
      );
    }

    const existingAckEmail = (target.digitalAckEmail || "").trim().toLowerCase();
    if (existingAckEmail && existingAckEmail !== cleanEmail) {
      throw new CouncilDomainError(
        `A ciência deste componente já foi confirmada por ${target.digitalAckName || existingAckEmail}.`,
        409
      );
    }

    const nextTeacherEmail = subjectTeacherEmail || convTeacherEmail || cleanEmail;
    const nextTeacherName =
      (linkedSubject?.teacherName || "").trim() || target.teacherName.trim() || cleanName;

    if (
      linkedSubject &&
      (!subjectTeacherEmail || !(linkedSubject.teacherName || "").trim())
    ) {
      await tx.classCouncilSubject.update({
        where: { id: linkedSubject.id },
        data: {
          teacherEmail: nextTeacherEmail,
          teacherName: nextTeacherName,
        },
      });
    }

    const updatedConv: PreCouncilSubjectConversation = {
      ...target,
      teacherEmail: nextTeacherEmail,
      teacherName: target.teacherName.trim() || nextTeacherName,
      conversationStatus: "COMPLETED",
      conversationDate: target.conversationDate || todayYmd,
      digitalAckEmail: cleanEmail,
      digitalAckName: cleanName,
      digitalAckAt: ackAtIso,
    };

    const nextPreCouncil: PreCouncilData = {
      ...preCouncil,
      conversations: preCouncil.conversations.map((c, idx) =>
        idx === targetIndex ? updatedConv : c
      ),
    };

    const savedTrimester = await tx.classCouncilTrimester.upsert({
      where: { boardId_trimester: { boardId, trimester } },
      create: {
        schoolId,
        boardId,
        trimester,
        status: "IN_PROGRESS",
        preCouncilJson: JSON.stringify(nextPreCouncil),
        updatedByName: cleanName,
        updatedByEmail: cleanEmail,
      },
      update: {
        preCouncilJson: JSON.stringify(nextPreCouncil),
      },
    });

    return {
      trimesterId: savedTrimester?.id ?? boardId,
      conversationId: updatedConv.id,
      subjectId: target.subjectId ?? null,
      subjectName: updatedConv.subjectName,
      teacherName: updatedConv.teacherName,
      digitalAckEmail: cleanEmail,
      digitalAckName: cleanName,
      digitalAckAt: ackAtIso,
      trimester,
    };
  });
}
