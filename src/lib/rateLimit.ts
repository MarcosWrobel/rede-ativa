import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { extractClientIp } from "./audit";

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES = {
  AI_ENDPOINT: {
    name: "AI_ENDPOINT",
    limit: 20,
    windowMs: 60 * 1000, // 20 req/min
  },
  PUBLIC_ATA_VERIFY: {
    name: "PUBLIC_ATA_VERIFY",
    limit: 30,
    windowMs: 60 * 1000, // 30 req/min
  },
  SIGN_TOKEN_ACCESS: {
    name: "SIGN_TOKEN_ACCESS",
    limit: 15,
    windowMs: 60 * 1000, // 15 req/min
  },
  PIN_BRUTE_FORCE: {
    name: "PIN_BRUTE_FORCE",
    limit: 10,
    windowMs: 15 * 60 * 1000, // 10 erros em 15 min
  },
  EXTENSION_SYNC_AUTH: {
    name: "EXTENSION_SYNC_AUTH",
    limit: 10,
    windowMs: 15 * 60 * 1000, // 10 erros em 15 min
  },
  MESSAGE_REPLY: {
    name: "MESSAGE_REPLY",
    limit: 60,
    windowMs: 60 * 1000, // 60 req/min
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

/**
 * Driver Primário Padrão: Neon PostgreSQL Distribuído + L1 Memory Fallback
 */
async function checkPostgresRateLimit(
  key: string,
  policy: RateLimitPolicy
): Promise<RateLimitResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.windowMs);

  try {
    if (Math.random() < 0.02) {
      // Limpeza oportunística leve de buckets expirados (2% das chamadas)
      prisma.rateLimitBucket.deleteMany({
        where: { expiresAt: { lt: now } },
      }).catch(() => {});
    }

    // Upsert ou Incremento
    const existing = await prisma.rateLimitBucket.findUnique({
      where: { key },
    });

    let count = 1;
    let actualExpiresAt = expiresAt;

    if (!existing || existing.expiresAt <= now) {
      const saved = await prisma.rateLimitBucket.upsert({
        where: { key },
        create: {
          key,
          count: 1,
          windowStart: now,
          expiresAt,
        },
        update: {
          count: 1,
          windowStart: now,
          expiresAt,
        },
      });
      count = saved.count;
      actualExpiresAt = saved.expiresAt;
    } else {
      const updated = await prisma.rateLimitBucket.update({
        where: { key },
        data: {
          count: { increment: 1 },
        },
      });
      count = updated.count;
      actualExpiresAt = existing.expiresAt;
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
    // Fallback L1 em memória se o banco oscilar momentaneamente
    cleanMemoryStore();
    const entry = memoryStore.get(key);
    const nowMs = Date.now();

    if (!entry || entry.expiresAt <= nowMs) {
      memoryStore.set(key, { count: 1, expiresAt: nowMs + policy.windowMs });
      return {
        success: true,
        limit: policy.limit,
        remaining: policy.limit - 1,
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
