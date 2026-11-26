import type { Prisma } from "@prisma/client";

export type SchoolCleanupConflictCode =
  | "SCHOOL_DELETE_INTEGRITY_CONFLICT"
  | "SCHOOL_SANITIZE_INTEGRITY_CONFLICT";

function makeIntegrityConflictError(message: string, code: SchoolCleanupConflictCode) {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

/**
 * Valida dentro da mesma transação `withTenantContext` que não há referências cruzadas
 * entre instituições que possam sofrer mutação ou exclusão por cascata (`ON DELETE CASCADE`
 * no Conselho de Classe, `ON DELETE SET NULL` em `MessageTemplate` ou vínculos divergentes).
 */
export async function assertNoCrossSchoolCleanupConflicts(
  tx: Prisma.TransactionClient,
  params: {
    schoolId: string;
    conflictCode: SchoolCleanupConflictCode;
    actionLabel: "Exclusão" | "Higienização";
    checkTemplateCrossReferences: boolean;
  }
): Promise<void> {
  const { schoolId, conflictCode, actionLabel, checkTemplateCrossReferences } = params;

  if (checkTemplateCrossReferences && typeof (tx as any).$queryRaw === "function") {
    // Bloqueia os modelos da escola antes da verificação cruzada para fechar a janela
    // de concorrência contra inserções/atualizações simultâneas de MessageLog (ON DELETE SET NULL).
    await tx.$queryRaw`
      SELECT "id"
      FROM "MessageTemplate"
      WHERE "schoolId" = ${schoolId}
      ORDER BY "id" ASC
      FOR UPDATE
    `;
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
}
