import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimit,
  enforceRateLimit,
  hashIp,
  getPublicIpRateLimitKey,
  RATE_LIMIT_POLICIES,
} from "../rateLimit";
import { prisma } from "../prisma";

describe("SEC-08: Rate Limiting Distribuído & Proteção Anti-Brute-Force", () => {
  beforeEach(async () => {
    // Limpa eventuais buckets de teste
    try {
      await prisma.rateLimitBucket.deleteMany({
        where: { key: { startsWith: "test-sec08:" } },
      });
    } catch {
      // Ignora se tabela mockada
    }
  });

  it("hashIp gera hash determinístico e seguro de 16 caracteres", () => {
    const h1 = hashIp("189.100.20.15");
    const h2 = hashIp("189.100.20.15");
    const h3 = hashIp("200.18.30.40");

    expect(h1).toHaveLength(16);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("getPublicIpRateLimitKey extrai IP do header e gera chave prefixada segura", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "177.10.20.30" },
    });
    const key = getPublicIpRateLimitKey("pub-ata", req);
    expect(key).toMatch(/^rl:pub-ata:[a-f0-9]{16}$/);
  });

  it("permite requisições dentro do limite da política e bloqueia ao exceder", async () => {
    const testPolicy = {
      name: "TEST_POLICY",
      limit: 3,
      windowMs: 5000,
    };
    const testKey = `test-sec08:req:${Date.now()}`;

    // 1ª requisição
    const r1 = await checkRateLimit(testKey, testPolicy);
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);

    // 2ª requisição
    const r2 = await checkRateLimit(testKey, testPolicy);
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);

    // 3ª requisição (limite exato atingido)
    const r3 = await checkRateLimit(testKey, testPolicy);
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4ª requisição (excedeu)
    const r4 = await checkRateLimit(testKey, testPolicy);
    expect(r4.success).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("enforceRateLimit retorna 429 com cabeçalhos padrão RFC 6585 quando bloqueado", async () => {
    const testPolicy = {
      name: "TEST_ENFORCE",
      limit: 1,
      windowMs: 10000,
    };
    const testKey = `test-sec08:enforce:${Date.now()}`;

    const first = await enforceRateLimit(testKey, testPolicy);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.headers["X-RateLimit-Limit"]).toBe("1");
      expect(first.headers["X-RateLimit-Remaining"]).toBe("0");
    }

    const blocked = await enforceRateLimit(testKey, testPolicy);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.response.status).toBe(429);
      expect(blocked.response.headers.get("Retry-After")).toBeDefined();
      expect(blocked.response.headers.get("X-RateLimit-Limit")).toBe("1");
      expect(blocked.response.headers.get("X-RateLimit-Remaining")).toBe("0");
      const body = await blocked.response.json();
      expect(body.error).toContain("Limite de requisições excedido");
      expect(body.retryAfter).toBeGreaterThan(0);
    }
  });

  it("resetRateLimit limpa a chave permitindo novas requisições imediatas", async () => {
    const testPolicy = {
      name: "TEST_RESET",
      limit: 1,
      windowMs: 10000,
    };
    const testKey = `test-sec08:reset:${Date.now()}`;

    await checkRateLimit(testKey, testPolicy);
    const blocked = await checkRateLimit(testKey, testPolicy);
    expect(blocked.success).toBe(false);

    // Reseta falhas
    await resetRateLimit(testKey);

    const reloaded = await checkRateLimit(testKey, testPolicy);
    expect(reloaded.success).toBe(true);
  });

  it("P2: garante atomicidade sob N chamadas paralelas (Promise.all) no mesmo bucket sem exceder limit", async () => {
    const parallelPolicy = {
      name: "TEST_PARALLEL_ATOMIC",
      limit: 5,
      windowMs: 15000,
      failMode: "closed" as const,
    };
    const parallelKey = `test-sec08:parallel:${Date.now()}`;

    const calls = Array.from({ length: 12 }, () => checkRateLimit(parallelKey, parallelPolicy));
    const results = await Promise.all(calls);

    const allowedCount = results.filter((r) => r.success).length;
    const blockedCount = results.filter((r) => !r.success).length;

    expect(allowedCount).toBe(5);
    expect(blockedCount).toBe(7);
  });

  it("P2: políticas com failMode='closed' bloqueiam (success=false) se o banco falhar, enquanto failMode='open' usa fallback", async () => {
    const queryRawSpy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValue(new Error("Simulated Postgres Outage"));

    try {
      const closedRes = await checkRateLimit(
        `test-sec08:closed:${Date.now()}`,
        RATE_LIMIT_POLICIES.PIN_BRUTE_FORCE
      );
      expect(closedRes.success).toBe(false);
      expect(closedRes.remaining).toBe(0);
      expect(closedRes.retryAfterSeconds).toBeGreaterThanOrEqual(60);

      const openRes = await checkRateLimit(
        `test-sec08:open:${Date.now()}`,
        RATE_LIMIT_POLICIES.PUBLIC_ATA_VERIFY
      );
      expect(openRes.success).toBe(true);
    } finally {
      queryRawSpy.mockRestore();
    }
  });
});
