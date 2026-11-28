import type { PrismaClient } from "@prisma/client";

export interface ReadOnlyDbIdentity {
  db: string;
  role: string;
  sessionRole: string;
  startTime: string;
  pgVersion: string;
  dbComment: string | null;
}

const ALLOWED_STAGING_DB_COMMENTS = new Set(["staging", "rls_staging_authorized"]);

export async function readDbIdentityReadOnly(
  client: Pick<PrismaClient, "$queryRaw">
): Promise<ReadOnlyDbIdentity> {
  const rows = await client.$queryRaw<
    Array<{
      db: string;
      role: string;
      sessionRole: string;
      startTime: string;
      pgVersion: string;
      dbComment: string | null;
    }>
  >`
    SELECT
      current_database() AS db,
      current_user AS role,
      session_user AS "sessionRole",
      pg_postmaster_start_time()::text AS "startTime",
      version() AS "pgVersion",
      shobj_description(
        (SELECT oid FROM pg_database WHERE datname = current_database()),
        'pg_database'
      ) AS "dbComment"
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("STAGING_TARGET_UNVERIFIABLE: falha ao consultar identidade somente leitura.");
  }
  return row;
}

/**
 * Valida por consultas exclusivamente de leitura que a conexão direta (`app_migrator`)
 * e a conexão poolada (`app_runtime`) apontam para o mesmo banco, mesma instância e
 * ambiente de staging autorizado (`COMMENT ON DATABASE ... IS 'staging'`).
 * Deve ser executada ANTES de qualquer criação, limpeza ou DDL.
 */
export async function verifyStagingTargetsReadOnly(params: {
  adminClient: Pick<PrismaClient, "$queryRaw">;
  runtimeClient: Pick<PrismaClient, "$queryRaw">;
  expectedDb: string;
}): Promise<{ admin: ReadOnlyDbIdentity; runtime: ReadOnlyDbIdentity }> {
  const expectedDb = params.expectedDb.trim();
  if (!expectedDb) {
    throw new Error("STAGING_EXPECTED_DB_REQUIRED: RLS_STAGING_EXPECTED_DB é obrigatório.");
  }

  const [admin, runtime] = await Promise.all([
    readDbIdentityReadOnly(params.adminClient),
    readDbIdentityReadOnly(params.runtimeClient),
  ]);

  if (admin.role !== "app_migrator") {
    throw new Error(
      `STAGING_ADMIN_ROLE_MISMATCH: conexão direta deve usar 'app_migrator' (recebido '${admin.role}').`
    );
  }
  if (runtime.role !== "app_runtime" || runtime.sessionRole !== "app_runtime") {
    throw new Error(
      `STAGING_RUNTIME_ROLE_MISMATCH: conexão poolada deve usar 'app_runtime' (recebido '${runtime.role}' / '${runtime.sessionRole}').`
    );
  }
  if (admin.db !== expectedDb || runtime.db !== expectedDb || admin.db !== runtime.db) {
    throw new Error(
      `STAGING_DB_MISMATCH: esperado '${expectedDb}', admin='${admin.db}', runtime='${runtime.db}'.`
    );
  }
  if (admin.startTime !== runtime.startTime || admin.pgVersion !== runtime.pgVersion) {
    throw new Error(
      `STAGING_INSTANCE_MISMATCH: conexão direta e poolada apontam para instâncias/branches distintos.`
    );
  }
  const comment = (admin.dbComment || "").trim().toLowerCase();
  if (!ALLOWED_STAGING_DB_COMMENTS.has(comment) || admin.dbComment !== runtime.dbComment) {
    throw new Error(
      `STAGING_ENV_MARKER_MISSING: banco '${admin.db}' não possui COMMENT ON DATABASE autorizado ('staging' ou 'rls_staging_authorized').`
    );
  }

  return { admin, runtime };
}
