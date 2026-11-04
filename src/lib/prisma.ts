import { PrismaClient } from "@prisma/client";

function getDatasourceUrl() {
  // Em produção Serverless (Vercel/Neon), respeita o endpoint transacional do PgBouncer (-pooler)
  // para evitar exaustão do limite de conexões diretas do banco.
  const url = process.env.DATABASE_URL;
  if (url && url.trim()) {
    return url.trim();
  }

  // Fallback para DIRECT_URL caso DATABASE_URL não esteja definida (ex: scripts ou migrações diretas)
  const direct = process.env.DIRECT_URL;
  if (direct && direct.trim()) {
    return direct.trim();
  }

  return undefined;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: getDatasourceUrl(),
      },
    },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;
