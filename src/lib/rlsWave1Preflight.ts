import type { PrismaClient } from "@prisma/client";

export interface RlsWave1PreflightFinding {
  count: number;
  blockingForPhaseA: boolean;
  blockingForPhaseB: boolean;
  transitionExpectedDuringPhaseA: boolean;
  description: string;
  sampleIds: string[];
}

export interface RlsWave1PreflightReport {
  postgresVersion: string;
  hasMessageLogSchoolIdColumn: boolean;
  totalMessageLogs: number;
  logsWithNullTemplateCount: number;
  readyForPhaseA: boolean;
  readyForPhaseB: boolean;
  findings: {
    studentsWithoutSchool: RlsWave1PreflightFinding;
    logsWithMissingSchool: RlsWave1PreflightFinding;
    logsWithoutStudent: RlsWave1PreflightFinding;
    logsMissingSchoolId: RlsWave1PreflightFinding;
    logsDivergentSchoolId: RlsWave1PreflightFinding;
    logsWithMissingTemplate: RlsWave1PreflightFinding;
    logsWithCrossSchoolTemplate: RlsWave1PreflightFinding;
    studentsWithMissingClassGroup: RlsWave1PreflightFinding;
    studentsWithCrossSchoolClassGroup: RlsWave1PreflightFinding;
  };
}

interface CountAndSampleRow {
  totalCount: bigint | number;
  id: string | null;
}

function toNumber(value: bigint | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function extractCountAndIds(rows: CountAndSampleRow[]): { count: number; sampleIds: string[] } {
  if (!rows.length) {
    return { count: 0, sampleIds: [] };
  }
  const count = toNumber(rows[0].totalCount);
  const sampleIds = rows
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return { count, sampleIds };
}

/**
 * Executa pré-flight somente leitura de integridade referencial e multi-tenant
 * para a Onda 1 da RLS (`ClassGroup` -> `Student` -> `MessageTemplate` -> `MessageLog`).
 * Reutilizável antes da migração aditiva (Fase A) e antes do fechamento (Fase B).
 */
export async function runRlsWave1Preflight(
  prismaClient: Pick<PrismaClient, "$queryRaw">,
  options: { sampleLimit?: number } = {}
): Promise<RlsWave1PreflightReport> {
  const sampleLimit = Math.min(Math.max(options.sampleLimit ?? 50, 1), 200);

  const [versionRows, colRows, totalLogsRows, nullTemplateRows] = await Promise.all([
    prismaClient.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`,
    prismaClient.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'MessageLog'
          AND column_name = 'schoolId'
      ) AS exists
    `,
    prismaClient.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*)::bigint AS count FROM "MessageLog"
    `,
    prismaClient.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*)::bigint AS count FROM "MessageLog" WHERE "templateId" IS NULL
    `,
  ]);

  const postgresVersion = versionRows[0]?.version || "unknown";
  const hasMessageLogSchoolIdColumn = Boolean(colRows[0]?.exists);
  const totalMessageLogs = toNumber(totalLogsRows[0]?.count);
  const logsWithNullTemplateCount = toNumber(nullTemplateRows[0]?.count);

  const [
    studentsWithoutSchoolRows,
    logsWithoutStudentRows,
    logsWithMissingTemplateRows,
    studentsWithMissingClassGroupRows,
    studentsWithCrossSchoolClassGroupRows,
  ] = await Promise.all([
    prismaClient.$queryRaw<CountAndSampleRow[]>`
      WITH bad AS (
        SELECT st."id"
        FROM "Student" st
        LEFT JOIN "School" sc ON sc."id" = st."schoolId"
        WHERE sc."id" IS NULL
      )
      SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
      FROM bad b
      ORDER BY b."id" ASC
      LIMIT ${sampleLimit}
    `,
    prismaClient.$queryRaw<CountAndSampleRow[]>`
      WITH bad AS (
        SELECT ml."id"
        FROM "MessageLog" ml
        LEFT JOIN "Student" st ON st."id" = ml."studentId"
        WHERE st."id" IS NULL
      )
      SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
      FROM bad b
      ORDER BY b."id" ASC
      LIMIT ${sampleLimit}
    `,
    prismaClient.$queryRaw<CountAndSampleRow[]>`
      WITH bad AS (
        SELECT ml."id"
        FROM "MessageLog" ml
        LEFT JOIN "MessageTemplate" tpl ON tpl."id" = ml."templateId"
        WHERE ml."templateId" IS NOT NULL
          AND tpl."id" IS NULL
      )
      SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
      FROM bad b
      ORDER BY b."id" ASC
      LIMIT ${sampleLimit}
    `,
    prismaClient.$queryRaw<CountAndSampleRow[]>`
      WITH bad AS (
        SELECT st."id"
        FROM "Student" st
        LEFT JOIN "ClassGroup" cg ON cg."id" = st."classGroupId"
        WHERE cg."id" IS NULL
      )
      SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
      FROM bad b
      ORDER BY b."id" ASC
      LIMIT ${sampleLimit}
    `,
    prismaClient.$queryRaw<CountAndSampleRow[]>`
      WITH bad AS (
        SELECT st."id"
        FROM "Student" st
        INNER JOIN "ClassGroup" cg ON cg."id" = st."classGroupId"
        WHERE st."schoolId" IS DISTINCT FROM cg."schoolId"
      )
      SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
      FROM bad b
      ORDER BY b."id" ASC
      LIMIT ${sampleLimit}
    `,
  ]);

  let logsWithMissingSchool = { count: 0, sampleIds: [] as string[] };
  let logsMissingSchoolId = { count: 0, sampleIds: [] as string[] };
  let logsDivergentSchoolId = { count: 0, sampleIds: [] as string[] };
  let logsWithCrossSchoolTemplateRows: CountAndSampleRow[];

  if (hasMessageLogSchoolIdColumn) {
    const [missingSchoolFkRows, missingSchoolRows, divergentSchoolRows, crossTplRows] =
      await Promise.all([
        prismaClient.$queryRaw<CountAndSampleRow[]>`
          WITH bad AS (
            SELECT ml."id"
            FROM "MessageLog" ml
            LEFT JOIN "School" sc ON sc."id" = ml."schoolId"
            WHERE ml."schoolId" IS NOT NULL
              AND sc."id" IS NULL
          )
          SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
          FROM bad b
          ORDER BY b."id" ASC
          LIMIT ${sampleLimit}
        `,
        prismaClient.$queryRaw<CountAndSampleRow[]>`
          WITH bad AS (
            SELECT ml."id"
            FROM "MessageLog" ml
            WHERE ml."schoolId" IS NULL
          )
          SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
          FROM bad b
          ORDER BY b."id" ASC
          LIMIT ${sampleLimit}
        `,
      prismaClient.$queryRaw<CountAndSampleRow[]>`
        WITH bad AS (
          SELECT ml."id"
          FROM "MessageLog" ml
          INNER JOIN "Student" st ON st."id" = ml."studentId"
          WHERE ml."schoolId" IS NOT NULL
            AND ml."schoolId" IS DISTINCT FROM st."schoolId"
        )
        SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
        FROM bad b
        ORDER BY b."id" ASC
        LIMIT ${sampleLimit}
      `,
      prismaClient.$queryRaw<CountAndSampleRow[]>`
        WITH bad AS (
          SELECT ml."id"
          FROM "MessageLog" ml
          LEFT JOIN "Student" st ON st."id" = ml."studentId"
          INNER JOIN "MessageTemplate" tpl ON tpl."id" = ml."templateId"
          WHERE ml."templateId" IS NOT NULL
            AND COALESCE(ml."schoolId", st."schoolId") IS DISTINCT FROM tpl."schoolId"
        )
        SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
        FROM bad b
        ORDER BY b."id" ASC
        LIMIT ${sampleLimit}
      `,
    ]);

    logsWithMissingSchool = extractCountAndIds(missingSchoolFkRows);
    logsMissingSchoolId = extractCountAndIds(missingSchoolRows);
    logsDivergentSchoolId = extractCountAndIds(divergentSchoolRows);
    logsWithCrossSchoolTemplateRows = crossTplRows;
  } else {
    logsWithCrossSchoolTemplateRows = await prismaClient.$queryRaw<CountAndSampleRow[]>`
      WITH bad AS (
        SELECT ml."id"
        FROM "MessageLog" ml
        INNER JOIN "Student" st ON st."id" = ml."studentId"
        INNER JOIN "MessageTemplate" tpl ON tpl."id" = ml."templateId"
        WHERE ml."templateId" IS NOT NULL
          AND st."schoolId" IS DISTINCT FROM tpl."schoolId"
      )
      SELECT (SELECT COUNT(*)::bigint FROM bad) AS "totalCount", b."id"
      FROM bad b
      ORDER BY b."id" ASC
      LIMIT ${sampleLimit}
    `;
  }

  const studentsWithoutSchool = extractCountAndIds(studentsWithoutSchoolRows);
  const logsWithoutStudent = extractCountAndIds(logsWithoutStudentRows);
  const logsWithMissingTemplate = extractCountAndIds(logsWithMissingTemplateRows);
  const logsWithCrossSchoolTemplate = extractCountAndIds(logsWithCrossSchoolTemplateRows);
  const studentsWithMissingClassGroup = extractCountAndIds(studentsWithMissingClassGroupRows);
  const studentsWithCrossSchoolClassGroup = extractCountAndIds(
    studentsWithCrossSchoolClassGroupRows
  );

  const findings: RlsWave1PreflightReport["findings"] = {
    studentsWithoutSchool: {
      ...studentsWithoutSchool,
      blockingForPhaseA: true,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description:
        "Student com schoolId apontando para School inexistente (bloqueia backfill e FK simples MessageLog_schoolId_fkey na Fase A e Fase B).",
    },
    logsWithMissingSchool: {
      ...logsWithMissingSchool,
      blockingForPhaseA: true,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description:
        "MessageLog com schoolId preenchido apontando para School inexistente (incompatível com MessageLog_schoolId_fkey na Fase A e Fase B).",
    },
    logsWithoutStudent: {
      ...logsWithoutStudent,
      blockingForPhaseA: false,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description: "MessageLog sem Student correspondente.",
    },
    logsMissingSchoolId: {
      ...logsMissingSchoolId,
      blockingForPhaseA: false,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: true,
      description:
        "MessageLog com schoolId nulo (esperado durante transição da Fase A enquanto escritores anteriores estiverem ativos; bloqueia NOT NULL da Fase B).",
    },
    logsDivergentSchoolId: {
      ...logsDivergentSchoolId,
      blockingForPhaseA: false,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description: "MessageLog.schoolId preenchido divergente de Student.schoolId.",
    },
    logsWithMissingTemplate: {
      ...logsWithMissingTemplate,
      blockingForPhaseA: false,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description: "MessageLog com templateId não nulo apontando para MessageTemplate inexistente.",
    },
    logsWithCrossSchoolTemplate: {
      ...logsWithCrossSchoolTemplate,
      blockingForPhaseA: false,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description:
        "MessageLog referenciando MessageTemplate de outra escola (impede FK composta).",
    },
    studentsWithMissingClassGroup: {
      ...studentsWithMissingClassGroup,
      blockingForPhaseA: false,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description: "Student sem ClassGroup correspondente.",
    },
    studentsWithCrossSchoolClassGroup: {
      ...studentsWithCrossSchoolClassGroup,
      blockingForPhaseA: false,
      blockingForPhaseB: true,
      transitionExpectedDuringPhaseA: false,
      description: "Student vinculado a ClassGroup de outra escola (impede FK composta).",
    },
  };

  const hasBlockingPhaseAFinding = Object.values(findings).some(
    (f) => f.blockingForPhaseA && f.count > 0
  );
  const hasBlockingPhaseBFinding = Object.values(findings).some(
    (f) => f.blockingForPhaseB && f.count > 0
  );

  return {
    postgresVersion,
    hasMessageLogSchoolIdColumn,
    totalMessageLogs,
    logsWithNullTemplateCount,
    readyForPhaseA: !hasBlockingPhaseAFinding,
    readyForPhaseB: hasMessageLogSchoolIdColumn && !hasBlockingPhaseBFinding,
    findings,
  };
}

/**
 * Reconcilia de forma idempotente `MessageLog.schoolId` a partir de `Student.schoolId`
 * exclusivamente onde `MessageLog.schoolId` estiver nulo, preservando valores já preenchidos.
 */
export async function reconcileMessageLogSchoolId(
  prismaClient: Pick<PrismaClient, "$executeRaw">
): Promise<{ updatedCount: number }> {
  const updatedCount = await prismaClient.$executeRaw`
    UPDATE "MessageLog" ml
    SET "schoolId" = st."schoolId"
    FROM "Student" st
    WHERE ml."studentId" = st."id"
      AND ml."schoolId" IS NULL
      AND st."schoolId" IS NOT NULL
  `;
  return { updatedCount: Number(updatedCount) };
}
