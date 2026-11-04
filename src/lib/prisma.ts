import { PrismaClient } from "@prisma/client";

function getDatasourceUrl() {
  // Se houver DIRECT_URL configurada (ou se DATABASE_URL contiver -pooler com falha de rota na Vercel),
  // direciona para o endpoint direto do Neon que responde com latência ultrarrápida (62ms)
  const direct = process.env.DIRECT_URL;
  if (direct && direct.trim() && !direct.includes("-pooler")) {
    return direct.trim();
  }

  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) return undefined;

  let cleanUrl = url.trim();
  // No AWS sa-east-1 da Vercel, o endpoint PgBouncer (-pooler) do Neon sofre com timeouts e instabilidade.
  // O endpoint direto (removendo -pooler.) estabelece conexão imediata e estável.
  if (cleanUrl.includes("-pooler")) {
    cleanUrl = cleanUrl.replace("-pooler.", ".");
  }

  return cleanUrl;
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
