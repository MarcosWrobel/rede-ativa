import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_PHASE_B_SQL_PATH = path.resolve(__dirname, "wave1_phase_b_candidate.sql");

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
 *   sqlPath?: string;
 *   sqlText?: string;
 *   onAfterStatement?: (ctx: { index: number; statement: string; tx: unknown }) => Promise<void> | void;
 * }} [options]
 * @returns {Promise<{ statementCount: number }>}
 */
export async function applyWave1PhaseBCandidateInSingleTx(migratorPrisma, options = {}) {
  const sqlText =
    options.sqlText ?? fs.readFileSync(options.sqlPath ?? DEFAULT_PHASE_B_SQL_PATH, "utf8");
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

async function runCli() {
  const migratorUrl = process.env.RLS_PHASE_B_MIGRATOR_URL;
  if (!migratorUrl) {
    throw new Error("RLS_PHASE_B_MIGRATOR_URL é obrigatório (conexão direta de app_migrator).");
  }

  const migratorPrisma = new PrismaClient({ datasources: { db: { url: migratorUrl } } });
  try {
    await migratorPrisma.$connect();
    const { statementCount } = await applyWave1PhaseBCandidateInSingleTx(migratorPrisma);
    console.log(
      `[wave1_phase_b_candidate] Aplicado em transação única (${statementCount} instruções).`
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
