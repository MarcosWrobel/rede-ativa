import { PrismaClient } from "@prisma/client";

/**
 * Normaliza a URL de conexão em runtime para utilizar o PgBouncer (-pooler) do Neon
 * com parâmetros controlados para ambientes serverless (Vercel Functions), evitando
 * esgotamento de conexões TCP diretas e colisão de prepared statements em transaction mode.
 *
 * DIRECT_URL permanece restrita ao Prisma CLI (migrations / schema.prisma) e nunca é usada em runtime.
 */
export function normalizeRuntimeDatabaseUrl(rawUrl?: string | null): string | undefined {
  const candidate = (rawUrl ?? process.env.DATABASE_URL ?? "").trim();
  if (!candidate) return undefined;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") {
      if (parsed.hostname.includes("-pooler") && !parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
      }
      if (!parsed.searchParams.has("connection_limit")) {
        parsed.searchParams.set("connection_limit", "1");
      }
      if (!parsed.searchParams.has("pool_timeout")) {
        parsed.searchParams.set("pool_timeout", "20");
      }
      if (!parsed.searchParams.has("connect_timeout")) {
        parsed.searchParams.set("connect_timeout", "15");
      }
      return parsed.toString();
    }
  } catch {
    // Retorna string original caso não seja uma URL padrão parseável
  }

  return candidate;
}

/**
 * Executa uma operação Prisma com retry leve e exponential backoff apenas para erros
 * transitórios de wake-up do Scale-to-Zero do Neon (N5), sem precisar de cron keep-alive.
 */
export async function withNeonWakeRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      attempt += 1;
      const code = String(err?.code || "");
      const msg = String(err?.message || "");
      const isTransientWakeError =
        code === "P1001" ||
        code === "P1002" ||
        msg.includes("57P01") ||
        msg.includes("Can't reach database server") ||
        msg.includes("Timed out fetching a new connection") ||
        msg.includes("Connection terminated unexpectedly");

      if (!isTransientWakeError || attempt > maxRetries) {
        throw err;
      }

      const backoffMs = attempt * 300;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: normalizeRuntimeDatabaseUrl(),
      },
    },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;
