const { execSync } = require("child_process");

// Na Vercel, aplica automaticamente índices e evoluções não-destrutivas do schema.prisma ao Neon PostgreSQL
if (process.env.VERCEL === "1" && process.env.DATABASE_URL) {
  try {
    if (!process.env.DIRECT_URL) {
      process.env.DIRECT_URL = process.env.DATABASE_URL.replace("-pooler.", ".");
    }
    console.log("[Vercel Build] Sincronizando índices e schema Prisma com Neon PostgreSQL...");
    execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
    console.log("[Vercel Build] Schema sincronizado com sucesso.");
  } catch (err) {
    console.warn("[Vercel Build] Aviso ao executar prisma db push:", err.message);
  }
}
