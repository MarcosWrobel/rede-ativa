import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { extractClientIp } from "./audit";

export type RateLimitFailMode = "open" | "closed";

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
  failMode?: RateLimitFailMode;
}

export const RATE_LIMIT_POLICIES = {
  AI_ENDPOINT: {
    name: "AI_ENDPOINT",
    limit: 20,
    windowMs: 60 * 1000, // 20 req/min
    failMode: "open" as const,
  },
  PUBLIC_ATA_VERIFY: {
    name: "PUBLIC_ATA_VERIFY",
    limit: 30,
    windowMs: 60 * 1000, // 30 req/min
    failMode: "open" as const,
  },
  PUBLIC_LOGO: {
    name: "PUBLIC_LOGO",
    limit: 60,
    windowMs: 60 * 1000, // 60 req/min
    failMode: "open" as const,
  },
  SIGN_TOKEN_ACCESS: {
    name: "SIGN_TOKEN_ACCESS",
    limit: 15,
    windowMs: 60 * 1000, // 15 req/min
    failMode: "closed" as const,
  },
  PIN_BRUTE_FORCE: {
    name: "PIN_BRUTE_FORCE",
    limit: 10,
    windowMs: 15 * 60 * 1000, // 10 erros em 15 min
    failMode: "closed" as const,
  },
  EXTENSION_SYNC_AUTH: {
    name: "EXTENSION_SYNC_AUTH",
    limit: 10,
    windowMs: 15 * 60 * 1000, // 10 erros em 15 min
    failMode: "closed" as const,
  },
  MESSAGE_REPLY: {
    name: "MESSAGE_REPLY",
    limit: 60,
    windowMs: 60 * 1000, // 60 req/min
    failMode: "open" as const,
  },
} as const;

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp em ms
  retryAfterSeconds: number;
}

// Cache local L1 para rajadas e fail-open em memória
interface MemoryEntry {
  count: number;
  expiresAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();

function cleanMemoryStore() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Gera hash seguro para identificadores de IP, evitando armazenar IPs abertos como chave primária
 */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16);
}

/**
 * Driver Upstash REST (se UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN estiverem definidos)
 */
async function checkUpstashRedis(
  key: string,
  policy: RateLimitPolicy
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const pipelineUrl = `${url.replace(/\/$/, "")}/pipeline`;
    const res = await fetch(pipelineUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PTTL", key],
      ]),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const count = Number(data[0]?.result);
    let pttl = Number(data[1]?.result);

    // Se a chave for nova, define expiração
    if (pttl === -1 || pttl < 0) {
      await fetch(`${url.replace(/\/$/, "")}/pexpire/${encodeURIComponent(key)}/${policy.windowMs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      pttl = policy.windowMs;
    }

    const remaining = Math.max(0, policy.limit - count);
    const retryAfter = Math.ceil(Math.max(1000, pttl) / 1000);

    return {
      success: count <= policy.limit,
      limit: policy.limit,
      remaining,
      resetAt: Date.now() + Math.max(0, pttl),
      retryAfterSeconds: retryAfter,
    };
  } catch (err) {
    console.warn("[RateLimit] Falha no adapter Upstash, caindo para driver PostgreSQL/Memory:", err);
    return null;
  }
}

function checkMemoryRateLimit(key: string, policy: RateLimitPolicy): RateLimitResult {
  cleanMemoryStore();
  const entry = memoryStore.get(key);
  const nowMs = Date.now();

  if (!entry || entry.expiresAt <= nowMs) {
    memoryStore.set(key, { count: 1, expiresAt: nowMs + policy.windowMs });
    return {
      success: true,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - 1),
      resetAt: nowMs + policy.windowMs,
      retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
    };
  }

  entry.count += 1;
  const remaining = Math.max(0, policy.limit - entry.count);
  const retryAfterSeconds = Math.ceil(Math.max(1000, entry.expiresAt - nowMs) / 1000);

  return {
    success: entry.count <= policy.limit,
    limit: policy.limit,
    remaining,
    resetAt: entry.expiresAt,
    retryAfterSeconds,
  };
}

/**
 * Driver Primário Padrão: Neon PostgreSQL Distribuído Atômico + Fail-Closed/Open por Política
 */
async function checkPostgresRateLimit(
  key: string,
  policy: RateLimitPolicy
): Promise<RateLimitResult> {
  // Para políticas leves de assets públicos (ex.: PUBLIC_LOGO), evita escrita em banco por requisição
  if (policy.name === "PUBLIC_LOGO") {
    return checkMemoryRateLimit(key, policy);
  }

  // Em testes unitários onde o Prisma foi mockado parcialmente sem $queryRaw nem rateLimitBucket
  const hasQueryRaw = typeof (prisma as any)?.$queryRaw === "function";
  const hasBucketModel = Boolean((prisma as any)?.rateLimitBucket);
  if (!hasQueryRaw && !hasBucketModel) {
    return checkMemoryRateLimit(key, policy);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.windowMs);

  try {
    if (Math.random() < 0.02 && hasBucketModel) {
      // Limpeza oportunística leve de buckets expirados (2% das chamadas)
      prisma.rateLimitBucket
        .deleteMany({
          where: { expiresAt: { lt: now } },
        })
        .catch(() => {});
    }

    let count = 1;
    let actualExpiresAt = expiresAt;

    if (hasQueryRaw) {
      // Operação atômica única no PostgreSQL (elimina TOCTOU / race condition em rajadas paralelas)
      const rows = await prisma.$queryRaw<Array<{ count: number | bigint; expiresAt: Date | string }>>`
        INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt")
        VALUES (${key}, 1, ${now}, ${expiresAt})
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE
            WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1
            ELSE "RateLimitBucket"."count" + 1
          END,
          "windowStart" = CASE
            WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${now}
            ELSE "RateLimitBucket"."windowStart"
          END,
          "expiresAt" = CASE
            WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt}
            ELSE "RateLimitBucket"."expiresAt"
          END
        RETURNING "count", "expiresAt"
      `;

      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) {
        throw new Error("Retorno vazio de RateLimitBucket upsert atômico");
      }
      count = Number(row.count);
      actualExpiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
    } else {
      const existing = await prisma.rateLimitBucket.findUnique({ where: { key } });
      if (!existing || existing.expiresAt <= now) {
        const saved = await prisma.rateLimitBucket.upsert({
          where: { key },
          create: { key, count: 1, windowStart: now, expiresAt },
          update: { count: 1, windowStart: now, expiresAt },
        });
        count = saved.count;
        actualExpiresAt = saved.expiresAt;
      } else {
        const updated = await prisma.rateLimitBucket.update({
          where: { key },
          data: { count: { increment: 1 } },
        });
        count = updated.count;
        actualExpiresAt = existing.expiresAt;
      }
    }

    const remaining = Math.max(0, policy.limit - count);
    const msUntilReset = Math.max(1000, actualExpiresAt.getTime() - Date.now());
    const retryAfterSeconds = Math.ceil(msUntilReset / 1000);

    return {
      success: count <= policy.limit,
      limit: policy.limit,
      remaining,
      resetAt: actualExpiresAt.getTime(),
      retryAfterSeconds,
    };
  } catch (dbErr) {
    // Políticas críticas de autenticação/PIN operam em fail-closed quando o banco falha
    if (policy.failMode === "closed") {
      const retryAfterSeconds = Math.max(60, Math.ceil(policy.windowMs / 1000));
      return {
        success: false,
        limit: policy.limit,
        remaining: 0,
        resetAt: Date.now() + retryAfterSeconds * 1000,
        retryAfterSeconds,
      };
    }

    // Políticas abertas usam fallback L1 em memória se o banco oscilar momentaneamente
    return checkMemoryRateLimit(key, policy);
  }
}

/**
 * Função central para verificar rate limiting
 */
export async function checkRateLimit(
  key: string,
  policy: RateLimitPolicy
): Promise<RateLimitResult> {
  const upstashResult = await checkUpstashRedis(key, policy);
  if (upstashResult) return upstashResult;

  return checkPostgresRateLimit(key, policy);
}

/**
 * Reseta o contador de uma chave (útil para zerar falhas após login/PIN bem-sucedido)
 */
export async function resetRateLimit(key: string): Promise<void> {
  memoryStore.delete(key);
  try {
    await prisma.rateLimitBucket.delete({ where: { key } });
  } catch {
    // Chave pode não existir no banco
  }
}

/**
 * Obtém a contagem atual de falhas ou tentativas sem incrementar
 */
export async function getRateLimitStatus(key: string): Promise<{ count: number; isBlocked: boolean; retryAfterSeconds: number }> {
  try {
    const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });
    if (!bucket || bucket.expiresAt <= new Date()) {
      return { count: 0, isBlocked: false, retryAfterSeconds: 0 };
    }
    const msUntilReset = Math.max(0, bucket.expiresAt.getTime() - Date.now());
    return {
      count: bucket.count,
      isBlocked: false, // O limite depende da policy
      retryAfterSeconds: Math.ceil(msUntilReset / 1000),
    };
  } catch {
    return { count: 0, isBlocked: false, retryAfterSeconds: 0 };
  }
}

/**
 * Helper para rotas de API: avalia cota e retorna NextResponse com 429 se excedida
 */
export async function enforceRateLimit(
  key: string,
  policy: RateLimitPolicy,
  customMessage?: string
): Promise<{ ok: true; headers: Record<string, string> } | { ok: false; response: NextResponse }> {
  const result = await checkRateLimit(key, policy);

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.success) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
    const message =
      customMessage ||
      `Limite de requisições excedido. Por favor, aguarde ${result.retryAfterSeconds} segundos antes de tentar novamente.`;

    return {
      ok: false,
      response: NextResponse.json(
        {
          error: message,
          retryAfter: result.retryAfterSeconds,
        },
        {
          status: 429,
          headers,
        }
      ),
    };
  }

  return { ok: true, headers };
}

/**
 * Extrai IP e gera chave segura para rotas públicas
 */
export function getPublicIpRateLimitKey(prefix: string, req: Request): string {
  const ip = extractClientIp(req) || "unknown";
  return `rl:${prefix}:${hashIp(ip)}`;
}
