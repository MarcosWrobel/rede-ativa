import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_PHASE_B_SQL_PATH = path.resolve(__dirname, "wave1_phase_b_candidate.sql");
export const PHASE_B_SCHEMA_SQL_PATH = path.resolve(__dirname, "wave1_phase_b_schema.sql");
export const PHASE_B_RESOLVERS_SQL_PATH = path.resolve(__dirname, "wave1_phase_b_resolvers.sql");
export const PHASE_B_POLICIES_SQL_PATH = path.resolve(__dirname, "wave1_phase_b_policies.sql");

export function resolvePhaseBStageSqlPath(stage = "all") {
  if (stage === "schema") return PHASE_B_SCHEMA_SQL_PATH;
  if (stage === "resolvers") return PHASE_B_RESOLVERS_SQL_PATH;
  if (stage === "policies") return PHASE_B_POLICIES_SQL_PATH;
  if (stage === "all") return DEFAULT_PHASE_B_SQL_PATH;
  throw new Error(`Estágio inválido (${stage}): use 'schema', 'resolvers', 'policies' ou 'all'.`);
}

/**
 * Divide um script SQL em instruções individuais preservando blocos `$$ ... $$`,
 * strings literais e comentários `-- ...`.
 * @param {string} sql
 * @returns {string[]}
 */
export function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDollarBlock = false;
  let i = 0;

  while (i < sql.length) {
    if (!inSingleQuote && !inDollarBlock && sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (!inSingleQuote && sql[i] === "$" && sql[i + 1] === "$") {
      inDollarBlock = !inDollarBlock;
      current += "$$";
      i += 2;
      continue;
    }

    if (!inDollarBlock && sql[i] === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += "'";
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inDollarBlock && sql[i] === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      i += 1;
      continue;
    }

    current += sql[i];
    i += 1;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

/**
 * Executa pré-flight SQL, DDL, grants e políticas da Fase B em uma única transação
 * via `app_migrator`, com parada imediata e rollback integral em qualquer erro.
 *
 * @param {import("@prisma/client").PrismaClient} migratorPrisma
 * @param {{
 *   stage?: "schema" | "resolvers" | "policies" | "all";
 *   sqlPath?: string;
 *   sqlText?: string;
 *   onAfterStatement?: (ctx: { index: number; statement: string; tx: unknown }) => Promise<void> | void;
 * }} [options]
 * @returns {Promise<{ statementCount: number }>}
 */
export async function applyWave1PhaseBCandidateInSingleTx(migratorPrisma, options = {}) {
  const targetSqlPath = options.sqlPath ?? resolvePhaseBStageSqlPath(options.stage ?? "all");
  const sqlText = options.sqlText ?? fs.readFileSync(targetSqlPath, "utf8");
  const statements = splitSqlStatements(sqlText);

  await migratorPrisma.$transaction(
    async (tx) => {
      for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index];
        await tx.$executeRawUnsafe(statement);
        if (typeof options.onAfterStatement === "function") {
          await options.onAfterStatement({ index, statement, tx });
        }
      }
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return { statementCount: statements.length };
}

async function assertMigratorTargetConfirmedReadOnly(migratorPrisma, migratorUrl) {
  const parsedUrl = new URL(migratorUrl);
  const host = parsedUrl.hostname.toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const allowLocalVerify = process.env.RLS_PHASE_B_ALLOW_LOCAL_VERIFY === "true";

  const rows = await migratorPrisma.$queryRaw`
    SELECT
      current_database() AS db,
      current_user AS role,
      shobj_description(
        (SELECT oid FROM pg_database WHERE datname = current_database()),
        'pg_database'
      ) AS db_comment
  `;
  const info = rows[0];
  if (!info) {
    throw new Error("STAGING_TARGET_CHECK_FAILED: falha ao consultar identidade do banco.");
  }

  if (info.role !== "app_migrator") {
    throw new Error(
      `STAGING_TARGET_CHECK_FAILED: conexão direta deve usar 'app_migrator' (recebido '${info.role}').`
    );
  }

  if (allowLocalVerify) {
    const dbLower = String(info.db || "").toLowerCase();
    const isSyntheticLocalDb =
      dbLower.includes("rls_wave1_phase_b") || dbLower.includes("rls_staging_local_verify");
    if (!isLoopback || !isSyntheticLocalDb) {
      throw new Error(
        `LOCAL_VERIFY_REJECTED: RLS_PHASE_B_ALLOW_LOCAL_VERIFY=true exige loopback e banco sintético (host=${host}, db=${info.db}).`
      );
    }
    return;
  }

  const targetConfirmed = process.env.RLS_STAGING_TARGET_CONFIRMED === "staging";
  const expectedDb = String(process.env.RLS_STAGING_EXPECTED_DB || "").trim();
  if (!targetConfirmed || !expectedDb) {
    throw new Error(
      "STAGING_TARGET_CONFIRMATION_REQUIRED: defina RLS_STAGING_TARGET_CONFIRMED=staging e RLS_STAGING_EXPECTED_DB=<db> antes de aplicar DDL."
    );
  }

  if (host.includes("-pooler") || parsedUrl.searchParams.get("pgbouncer") === "true") {
    throw new Error(
      "STAGING_DIRECT_URL_REQUIRED: RLS_PHASE_B_MIGRATOR_URL deve usar conexão direta (sem '-pooler' ou 'pgbouncer=true')."
    );
  }

  const comment = String(info.db_comment || "").trim().toLowerCase();
  if (
    info.db !== expectedDb ||
    (comment !== "staging" && comment !== "rls_staging_authorized")
  ) {
    throw new Error(
      `STAGING_TARGET_CHECK_FAILED: alvo não confirmado como staging autorizado (db=${info.db}, expected=${expectedDb}, comment=${info.db_comment}).`
    );
  }
}

async function runCli() {
  const migratorUrl = process.env.RLS_PHASE_B_MIGRATOR_URL;
  if (!migratorUrl) {
    throw new Error("RLS_PHASE_B_MIGRATOR_URL é obrigatório (conexão direta de app_migrator).");
  }

  const stageArg = process.argv.find((arg) => arg.startsWith("--stage="));
  const stage = stageArg ? stageArg.slice("--stage=".length).trim() : "all";

  const migratorPrisma = new PrismaClient({ datasources: { db: { url: migratorUrl } } });
  try {
    await migratorPrisma.$connect();
    await assertMigratorTargetConfirmedReadOnly(migratorPrisma, migratorUrl);
    const { statementCount } = await applyWave1PhaseBCandidateInSingleTx(migratorPrisma, { stage });
    console.log(
      `[wave1_phase_b:${stage}] Aplicado em transação única (${statementCount} instruções).`
    );
  } finally {
    await migratorPrisma.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli().catch((err) => {
    console.error("[wave1_phase_b_candidate] Falha transacional:", err?.message || err);
    process.exit(1);
  });
}
