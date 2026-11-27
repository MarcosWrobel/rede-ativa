import type { Prisma, PrismaClient } from "@prisma/client";

export interface TenantContextOptions {
  maxWait?: number;
  timeout?: number;
}

/**
 * Propaga o identificador da escola autorizada no escopo estritamente local da
 * transação PostgreSQL (`SET LOCAL app.current_school_id = ...`), compatível
 * com PgBouncer / Neon em transaction pooling mode.
 */
export async function withTenantContext<T>(
  prismaClient: PrismaClient,
  schoolId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TenantContextOptions
): Promise<T> {
  const normalizedSchoolId = (schoolId || "").trim();
  if (!normalizedSchoolId) {
    throw new Error("withTenantContext: schoolId autorizado é obrigatório.");
  }

  const runCallback = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.current_school_id', ${normalizedSchoolId}, true)`;
    return fn(tx);
  };

  return options
    ? prismaClient.$transaction(runCallback, options)
    : prismaClient.$transaction(runCallback);
}
