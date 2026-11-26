import type { Prisma } from "@prisma/client";

export type SchoolCleanupConflictCode =
  | "SCHOOL_DELETE_INTEGRITY_CONFLICT"
  | "SCHOOL_SANITIZE_INTEGRITY_CONFLICT";

export interface LockedCleanupIds {
  lockedTemplateIds: string[];
  lockedCouncilBoardIds: string[];
  lockedCouncilSubjectIds: string[];
  lockedCouncilTrimesterIds: string[];
  lockedCouncilCardIds: string[];
  lockedCouncilEntryIds: string[];
}

function makeIntegrityConflictError(message: string, code: SchoolCleanupConflictCode) {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

/**
 * Bloqueia em ordem consistente (`ORDER BY id ASC FOR UPDATE`) os registros de modelos,
 * mensagens, turmas, estudantes e Conselho de Classe relacionados à escola-alvo e valida
 * dentro da mesma transação `withTenantContext` que não há referências cruzadas entre
 * instituições que possam sofrer mutação ou exclusão por cascata (`ON DELETE CASCADE` no
 * Conselho de Classe, `ON DELETE SET NULL` em `MessageTemplate` ou vínculos divergentes).
 *
 * Retorna os IDs bloqueados e verificados quando o cliente suporta `$queryRaw` (PostgreSQL),
 * garantindo que a remoção posterior atinja apenas registros previamente validados sob lock.
 */
export async function assertNoCrossSchoolCleanupConflicts(
  tx: Prisma.TransactionClient,
  params: {
    schoolId: string;
    conflictCode: SchoolCleanupConflictCode;
    actionLabel: "Exclusão" | "Higienização";
    checkTemplateCrossReferences: boolean;
  }
): Promise<LockedCleanupIds | null> {
  const { schoolId, conflictCode, actionLabel, checkTemplateCrossReferences } = params;

  let lockedIds: LockedCleanupIds | null = null;

  if (typeof (tx as any).$queryRaw === "function") {
    let lockedTemplateIds: string[] = [];
    if (checkTemplateCrossReferences) {
      const tplRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "MessageTemplate"
        WHERE "schoolId" = ${schoolId}
        ORDER BY "id" ASC
        FOR UPDATE
      `;
      lockedTemplateIds = tplRows.map((r) => r.id);

      // Bloqueia MessageLogs da escola ou que referenciem algum dos modelos bloqueados,
      // impedindo alteração concorrente de schoolId/studentId mantendo o mesmo templateId.
      if (lockedTemplateIds.length > 0) {
        await tx.$queryRaw`
          SELECT "id"
          FROM "MessageLog"
          WHERE "schoolId" = ${schoolId}
             OR "templateId" = ANY(${lockedTemplateIds})
          ORDER BY "id" ASC
          FOR UPDATE
        `;
      } else {
        await tx.$queryRaw`
          SELECT "id"
          FROM "MessageLog"
          WHERE "schoolId" = ${schoolId}
          ORDER BY "id" ASC
          FOR UPDATE
        `;
      }
    }

    // Bloqueia Turmas, Estudantes e todas as camadas do Conselho de Classe em ordem
    // determinística pai -> filho para impedir novas referências ou mutações concorrentes.
    await tx.$queryRaw`
      SELECT "id"
      FROM "ClassGroup"
      WHERE "schoolId" = ${schoolId}
      ORDER BY "id" ASC
      FOR UPDATE
    `;
    await tx.$queryRaw`
      SELECT "id"
      FROM "Student"
      WHERE "schoolId" = ${schoolId}
      ORDER BY "id" ASC
      FOR UPDATE
    `;

    const boardRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT b."id"
      FROM "ClassCouncilBoard" b
      LEFT JOIN "ClassGroup" cg ON cg."id" = b."classGroupId"
      WHERE b."schoolId" = ${schoolId} OR cg."schoolId" = ${schoolId}
      ORDER BY b."id" ASC
      FOR UPDATE OF b
    `;
    const subjectRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT sub."id"
      FROM "ClassCouncilSubject" sub
      LEFT JOIN "ClassCouncilBoard" b ON b."id" = sub."boardId"
      WHERE sub."schoolId" = ${schoolId} OR b."schoolId" = ${schoolId}
      ORDER BY sub."id" ASC
      FOR UPDATE OF sub
    `;
    const trimesterRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT tr."id"
      FROM "ClassCouncilTrimester" tr
      LEFT JOIN "ClassCouncilBoard" b ON b."id" = tr."boardId"
      WHERE tr."schoolId" = ${schoolId} OR b."schoolId" = ${schoolId}
      ORDER BY tr."id" ASC
      FOR UPDATE OF tr
    `;
    const cardRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT c."id"
      FROM "StudentCouncilCard" c
      LEFT JOIN "ClassCouncilBoard" b ON b."id" = c."boardId"
      LEFT JOIN "Student" st ON st."id" = c."studentId"
      WHERE c."schoolId" = ${schoolId} OR b."schoolId" = ${schoolId} OR st."schoolId" = ${schoolId}
      ORDER BY c."id" ASC
      FOR UPDATE OF c
    `;
    const entryRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT e."id"
      FROM "StudentCouncilSubjectEntry" e
      LEFT JOIN "StudentCouncilCard" c ON c."id" = e."cardId"
      LEFT JOIN "ClassCouncilSubject" sub ON sub."id" = e."subjectId"
      WHERE e."schoolId" = ${schoolId} OR c."schoolId" = ${schoolId} OR sub."schoolId" = ${schoolId}
      ORDER BY e."id" ASC
      FOR UPDATE OF e
    `;

    lockedIds = {
      lockedTemplateIds,
      lockedCouncilBoardIds: boardRows.map((r) => r.id),
      lockedCouncilSubjectIds: subjectRows.map((r) => r.id),
      lockedCouncilTrimesterIds: trimesterRows.map((r) => r.id),
      lockedCouncilCardIds: cardRows.map((r) => r.id),
      lockedCouncilEntryIds: entryRows.map((r) => r.id),
    };
  }

  if (typeof (tx.messageLog as any)?.findFirst === "function") {
    const divergentMessageLog = await tx.messageLog.findFirst({
      where: {
        OR: [
          {
            student: { schoolId },
            schoolId: { not: null },
            NOT: { schoolId },
          },
          {
            schoolId,
            student: { NOT: { schoolId } },
          },
        ],
      },
      select: { id: true },
    });
    if (divergentMessageLog) {
      throw makeIntegrityConflictError(
        `${actionLabel} bloqueada por integridade referencial: existem registros de mensageria com divergência de vínculo institucional.`,
        conflictCode
      );
    }

    if (checkTemplateCrossReferences) {
      const crossSchoolTemplateLog = await tx.messageLog.findFirst({
        where: {
          template: { schoolId },
          OR: [
            { schoolId: { not: null }, NOT: { schoolId } },
            { student: { NOT: { schoolId } } },
          ],
        },
        select: { id: true },
      });
      if (crossSchoolTemplateLog) {
        throw makeIntegrityConflictError(
          `${actionLabel} bloqueada por integridade referencial: existem registros de mensageria de outra instituição referenciando modelos desta escola.`,
          conflictCode
        );
      }
    }
  }

  if (typeof (tx.pedagogicalMinuteStudent as any)?.findFirst === "function") {
    const crossSchoolMinuteStudent = await tx.pedagogicalMinuteStudent.findFirst({
      where: {
        OR: [
          {
            minute: { schoolId },
            student: { NOT: { schoolId } },
          },
          {
            student: { schoolId },
            minute: { NOT: { schoolId } },
          },
        ],
      },
      select: { id: true },
    });
    if (crossSchoolMinuteStudent) {
      throw makeIntegrityConflictError(
        `${actionLabel} bloqueada por integridade referencial: existem vínculos de atas pedagógicas com divergência de instituição.`,
        conflictCode
      );
    }
  }

  if (typeof (tx.studentCouncilSubjectEntry as any)?.findFirst === "function") {
    const crossCouncilEntry = await tx.studentCouncilSubjectEntry.findFirst({
      where: {
        OR: [
          {
            NOT: { schoolId },
            OR: [
              { card: { schoolId } },
              { subject: { schoolId } },
              { card: { board: { schoolId } } },
              { subject: { board: { schoolId } } },
            ],
          },
          {
            schoolId,
            OR: [
              { card: { NOT: { schoolId } } },
              { subject: { NOT: { schoolId } } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (crossCouncilEntry) {
      throw makeIntegrityConflictError(
        `${actionLabel} bloqueada por integridade referencial: existem notas do Conselho de Classe com vínculo divergente entre instituições.`,
        conflictCode
      );
    }
  }

  if (typeof (tx.studentCouncilCard as any)?.findFirst === "function") {
    const crossCouncilCard = await tx.studentCouncilCard.findFirst({
      where: {
        OR: [
          {
            NOT: { schoolId },
            OR: [{ board: { schoolId } }, { student: { schoolId } }],
          },
          {
            schoolId,
            OR: [{ board: { NOT: { schoolId } } }, { student: { NOT: { schoolId } } }],
          },
        ],
      },
      select: { id: true },
    });
    if (crossCouncilCard) {
      throw makeIntegrityConflictError(
        `${actionLabel} bloqueada por integridade referencial: existem fichas do Conselho de Classe com vínculo divergente entre instituições.`,
        conflictCode
      );
    }
  }

  if (typeof (tx.classCouncilSubject as any)?.findFirst === "function") {
    const crossCouncilSubject = await tx.classCouncilSubject.findFirst({
      where: {
        OR: [
          { NOT: { schoolId }, board: { schoolId } },
          { schoolId, board: { NOT: { schoolId } } },
        ],
      },
      select: { id: true },
    });
    if (crossCouncilSubject) {
      throw makeIntegrityConflictError(
        `${actionLabel} bloqueada por integridade referencial: existem disciplinas do Conselho de Classe com vínculo divergente entre instituições.`,
        conflictCode
      );
    }
  }

  if (typeof (tx.classCouncilTrimester as any)?.findFirst === "function") {
    const crossCouncilTrimester = await tx.classCouncilTrimester.findFirst({
      where: {
        OR: [
          { NOT: { schoolId }, board: { schoolId } },
          { schoolId, board: { NOT: { schoolId } } },
        ],
      },
      select: { id: true },
    });
    if (crossCouncilTrimester) {
      throw makeIntegrityConflictError(
        `${actionLabel} bloqueada por integridade referencial: existem trimestres do Conselho de Classe com vínculo divergente entre instituições.`,
        conflictCode
      );
    }
  }

  if (typeof (tx.classCouncilBoard as any)?.findFirst === "function") {
    const crossCouncilBoard = await tx.classCouncilBoard.findFirst({
      where: {
        OR: [
          { NOT: { schoolId }, classGroup: { schoolId } },
          { schoolId, classGroup: { NOT: { schoolId } } },
        ],
      },
      select: { id: true },
    });
    if (crossCouncilBoard) {
      throw makeIntegrityConflictError(
        `${actionLabel} bloqueada por integridade referencial: existem conselhos de classe com turma vinculada a outra instituição.`,
        conflictCode
      );
    }
  }

  return lockedIds;
}
