/**
 * Executa uma operação Prisma/PostgreSQL com retry leve e exponential backoff apenas para erros
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
