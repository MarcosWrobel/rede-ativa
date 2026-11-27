import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";

const SCHOOL_READ_TX_CONCURRENCY = 4;

export interface SchoolScopedCountsOptions {
  includeInactiveStudents?: boolean;
  includePedagogicalMinutes?: boolean;
  includeActiveUserSchools?: boolean;
  includeLastStudentUpdate?: boolean;
}

export interface SchoolScopedCountsResult {
  students: number;
  classGroups: number;
  pedagogicalMinutes?: number;
  userSchools?: number;
  lastStudentUpdatedAt?: Date | null;
}

/**
 * Executa contagens de estudantes, turmas (e opcionais de atas, vínculos e última atualização)
 * dentro de `withTenantContext` para a escola autorizada, excluindo vínculos de turma cruzados.
 */
export async function readSchoolScopedCounts(
  schoolId: string,
  options: SchoolScopedCountsOptions = {}
): Promise<SchoolScopedCountsResult> {
  return withTenantContext(prisma, schoolId, async (tx) => {
    const students = await tx.student.count({
      where: {
        schoolId,
        ...(options.includeInactiveStudents ? {} : { active: true }),
        classGroup: { schoolId },
      },
    });

    const classGroups = await tx.classGroup.count({
      where: { schoolId },
    });

    const result: SchoolScopedCountsResult = {
      students,
      classGroups,
    };

    if (options.includePedagogicalMinutes) {
      result.pedagogicalMinutes = await tx.pedagogicalMinute.count({
        where: { schoolId },
      });
    }

    if (options.includeActiveUserSchools) {
      result.userSchools = await tx.userSchool.count({
        where: { schoolId, active: true },
      });
    }

    if (options.includeLastStudentUpdate) {
      const latestStudent = await tx.student.findFirst({
        where: {
          schoolId,
          classGroup: { schoolId },
        },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      });
      result.lastStudentUpdatedAt = latestStudent?.updatedAt ?? null;
    }

    return result;
  });
}

/**
 * Consolida contagens isoladas por escola com concorrência limitada.
 */
export async function readSchoolsScopedCountsBatch(
  schoolIds: string[],
  options: SchoolScopedCountsOptions = {},
  concurrency = SCHOOL_READ_TX_CONCURRENCY
): Promise<Map<string, SchoolScopedCountsResult>> {
  const uniqueIds = Array.from(new Set(schoolIds.filter(Boolean)));
  const results = new Map<string, SchoolScopedCountsResult>();
  if (uniqueIds.length === 0) return results;

  let nextIdx = 0;
  const workerCount = Math.min(concurrency, uniqueIds.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= uniqueIds.length) break;
      const schoolId = uniqueIds[idx];
      const counts = await readSchoolScopedCounts(schoolId, options);
      results.set(schoolId, counts);
    }
  });

  await Promise.all(workers);
  return results;
}
