import { PrismaClient } from "@prisma/client";
import { withNeonWakeRetry } from "./neonWakeRetry";

export { withNeonWakeRetry };

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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: normalizeRuntimeDatabaseUrl(),
      },
    },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  if (typeof (client as any).$use === "function") {
    (client as any).$use((params: unknown, next: (p: unknown) => Promise<unknown>) =>
      withNeonWakeRetry(() => next(params))
    );
  }

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
