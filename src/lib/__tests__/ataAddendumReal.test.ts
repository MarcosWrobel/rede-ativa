import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/atas/[id]/addendums/route";
import { verifyAddendumChain } from "@/lib/ataCrypto";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@/lib/signingPin";

const schoolId = "fixture-addendum-school";
const otherSchoolId = "fixture-addendum-other-school";
const userId = "fixture-addendum-user";
const email = "aditamento@example.invalid";
const pin = "261105";

vi.mock("@/lib/permissions", () => ({
  requireAuth: async () => ({
    ok: true,
    userId,
    userName: "Autora Sintética",
    email,
    schoolId,
    session: { user: { id: userId, email, role: "PEDAGOGA", schoolId } },
  }),
}));

const hasIsolatedDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return process.env.REDEATIVA_TEST_ISOLATED_DB === "1" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/redeativa_phase01_synthetic" &&
      (url.searchParams.get("connection_limit") ?? "1") === "1";
  } catch {
    return false;
  }
})();

function postAddendum(id: string, signingPin?: string, content = "Aditamento sintético") {
  const request = new Request(`http://localhost/api/atas/${id}/addendums`, {
    method: "POST",
    body: JSON.stringify({ content, signingPin }),
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

function createMinute(overrides: { schoolId?: string; contentHash?: string | null } = {}) {
  return prisma.pedagogicalMinute.create({
    data: {
      schoolId,
      year: 2026,
      status: "FINALIZED",
      subject: "Assunto sintético",
      summary: "Registro sintético",
      authorId: userId,
      authorName: "Autora Sintética",
      authorEmail: email,
      contentHash: "a".repeat(64),
      ...overrides,
    },
  });
}

function readAddendums(minuteId: string) {
  return prisma.pedagogicalMinuteAddendum.findMany({
    where: { minuteId },
    orderBy: { createdAt: "asc" },
  });
}

describe.skipIf(!hasIsolatedDb)("Aditamento com PostgreSQL e uma conexão Prisma", () => {
  beforeAll(async () => {
    await prisma.school.createMany({
      data: [
        { id: schoolId, name: "Escola Sintética A", inepCode: "99999811" },
        { id: otherSchoolId, name: "Escola Sintética B", inepCode: "99999812" },
      ],
    });
    await prisma.user.create({
      data: { id: userId, email, name: "Autora Sintética", schoolId, signingPinHash: await hashPin(pin) },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.rateLimitBucket.deleteMany({ where: { key: `rl:pin-fail:${userId}` } });
    await prisma.pedagogicalMinute.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolId, otherSchoolId] } } });
    await prisma.$disconnect();
  });

  it("exige PIN, recusa outra escola e grava na escola autorizada", async () => {
    const allowed = await createMinute();
    const denied = await createMinute({ schoolId: otherSchoolId });

    const withoutPin = await postAddendum(allowed.id);
    expect(withoutPin.status).toBe(401);
    expect((await withoutPin.json()).error).toContain("PIN_REQUIRED");
    expect((await postAddendum(allowed.id, "123456")).status).toBe(401);
    expect(await readAddendums(allowed.id)).toHaveLength(0);

    expect((await postAddendum(denied.id, pin)).status).toBe(403);
    expect(await readAddendums(denied.id)).toHaveLength(0);

    const created = await postAddendum(allowed.id, pin);
    expect(created.status).toBe(201);
    const { addendum } = await created.json();
    expect(await readAddendums(allowed.id)).toMatchObject([
      { id: addendum.id, previousHash: allowed.contentHash },
    ]);
    expect(await prisma.auditLog.count({
      where: { schoolId, entityId: addendum.id, action: "ADD_ATA_ADDENDUM" },
    })).toBe(1);
  }, 30_000);

  it("grava solicitações simultâneas em cadeia linear em uma ata legada sem selo", async () => {
    const minute = await createMinute({ contentHash: null });
    const responses = await Promise.all([
      postAddendum(minute.id, pin, "Primeiro texto sintético"),
      postAddendum(minute.id, pin, "Segundo texto sintético"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const addendums = await readAddendums(minute.id);
    expect(addendums).toHaveLength(2);
    expect(addendums[0].previousHash).toBe("genesis");
    expect(addendums[1].previousHash).toBe(addendums[0].addendumHash);
    expect(addendums[1].createdAt.getTime()).toBeGreaterThan(addendums[0].createdAt.getTime());
    expect(verifyAddendumChain(minute.contentHash, addendums)).toMatchObject({ isValid: true });
  }, 30_000);

  it("reverte se o bloqueio falhar e preserva a cadeia na nova tentativa", async () => {
    const minute = await createMinute();
    expect((await postAddendum(minute.id, pin)).status).toBe(201);
    const before = await readAddendums(minute.id);
    const lockHolder = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    await prisma.$executeRaw`SET lock_timeout = '100ms'`;
    try {
      await lockHolder.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT "id" FROM "PedagogicalMinute" WHERE "id" = ${minute.id} FOR UPDATE
        `;
        expect((await postAddendum(minute.id, pin)).status).toBe(500);
        expect(await readAddendums(minute.id)).toEqual(before);
      });
    } finally {
      await prisma.$executeRaw`RESET lock_timeout`;
      await lockHolder.$disconnect();
    }

    expect((await postAddendum(minute.id, pin)).status).toBe(201);
    const after = await readAddendums(minute.id);
    expect(after).toHaveLength(2);
    expect(verifyAddendumChain(minute.contentHash, after)).toMatchObject({ isValid: true });
  }, 30_000);
});
