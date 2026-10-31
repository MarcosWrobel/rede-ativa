import { PrismaClient } from "@prisma/client";

function getDatasourceUrl() {
  // Se houver DIRECT_URL configurada (ou se DATABASE_URL contiver -pooler com falha de rota na Vercel),
  // direciona para o endpoint direto do Neon que responde com latência ultrarrápida (62ms)
  const direct = process.env.DIRECT_URL;
  if (direct && !direct.includes("-pooler")) {
    return direct;
  }

  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  if (url.includes("-pooler")) {
    return url.replace("-pooler.", ".");
  }

  return url;
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
