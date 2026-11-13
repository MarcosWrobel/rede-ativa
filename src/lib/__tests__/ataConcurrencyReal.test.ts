import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SCHOOL_ID = "fixture-school-ata-concurrency";
const USER_ID = "fixture-user-ata-concurrency";
const USER_EMAIL = "pedagoga.concorrencia@example.invalid";

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    userId: USER_ID,
    userName: "Pedagoga Sintética",
    email: USER_EMAIL,
    schoolId: SCHOOL_ID,
    role: "PEDAGOGA",
    session: {
      user: {
        id: USER_ID,
        name: "Pedagoga Sintética",
        email: USER_EMAIL,
        role: "PEDAGOGA",
        schoolId: SCHOOL_ID,
      },
    },
  })),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async () => ({
    id: SCHOOL_ID,
    name: "Escola Sintética Concorrência",
    inepCode: "99999991",
  })),
}));

vi.mock("@/lib/signingPin", () => ({
  verifyServerSigningPin: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/escolaGoogleVerify", () => ({
  verifyEscolaGoogleIdToken: vi.fn(async () => ({
    ok: true,
    tokenInfo: {
      email: "docente.sintetico@escola.pr.gov.br",
      name: "Docente Sintético",
      sub: "sub-sintetico-1",
    },
  })),
  verifyParticipantIdentityMatch: vi.fn(() => ({ match: true })),
}));

vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true })),
  checkRateLimit: vi.fn(async () => ({ success: true })),
  resetRateLimit: vi.fn(async () => {}),
  getPublicIpRateLimitKey: vi.fn(() => "ip-test"),
  RATE_LIMIT_POLICIES: {
    SIGN_TOKEN_ACCESS: { max: 30, windowMs: 60_000 },
    PIN_BRUTE_FORCE: { max: 10, windowMs: 60_000 },
  },
}));

vi.mock("@/lib/audit", () => ({
  extractClientIp: vi.fn(() => "127.0.0.1"),
  logAudit: vi.fn(async () => {}),
}));

import { PATCH as patchMinuteHandler } from "@/app/api/atas/[id]/route";
import { DELETE as deleteSignTokenHandler } from "@/app/api/atas/[id]/sign-token/route";
import { POST as postPublicSignTokenHandler } from "@/app/api/atas/sign-token/[token]/route";
import { POST as finalizeMinuteHandler } from "@/app/api/atas/[id]/finalize/route";
import { buildCanonicalMinutePayload } from "@/services/ataFinalizationService";
import { computeMinuteHash } from "@/lib/ataCrypto";

const hasIsolatedDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return (
      process.env.REDEATIVA_TEST_ISOLATED_DB === "1" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/redeativa_phase01_synthetic"
    );
  } catch {
    return false;
  }
})();

function buildMultiConnUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set("connection_limit", "5");
  return parsed.toString();
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasIsolatedDb)(
  "Ata Concurrency Protocol (PostgreSQL real pg_advisory_xact_lock — ambas as ordens)",
  () => {
    let lockHolderClient: PrismaClient;

    beforeAll(async () => {
      lockHolderClient = new PrismaClient({
        datasources: { db: { url: buildMultiConnUrl(process.env.DATABASE_URL!) } },
      });

      await prisma.school.upsert({
        where: { id: SCHOOL_ID },
        update: {},
        create: {
          id: SCHOOL_ID,
          name: "Escola Sintética Concorrência",
          inepCode: "99999991",
          active: true,
        },
      });
    });

    afterAll(async () => {
      await prisma.pedagogicalMinute.deleteMany({
        where: { schoolId: SCHOOL_ID },
      });
      await prisma.school.deleteMany({
        where: { id: SCHOOL_ID },
      });
      await lockHolderClient.$disconnect();
    });

    /**
     * Executa uma transação PostgreSQL independente que adquire `minute_write_<minuteId>`,
     * dispara a operação concorrente (chamando os handlers reais via `prisma`), comprova que
     * ela permanece bloqueada no PostgreSQL enquanto o lock está preso e só desbloqueia após COMMIT.
     */
    async function runWithAdvisoryLockBarrier<T>(
      minuteId: string,
      insideLock: (tx: any) => Promise<void>,
      launchCompetitor: () => Promise<T>
    ): Promise<{ competitorResult: T; competitorFinishedWhileLocked: boolean }> {
      let signalLockAcquired!: () => void;
      const lockAcquiredPromise = new Promise<void>((r) => {
        signalLockAcquired = r;
      });
      let signalReleaseLock!: () => void;
      const releaseLockPromise = new Promise<void>((r) => {
        signalReleaseLock = r;
      });

      const holderTxPromise = lockHolderClient.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtext('minute_write_' || ${minuteId}));
          `;
          signalLockAcquired();
          await releaseLockPromise;
          await insideLock(tx);
        },
        { maxWait: 10_000, timeout: 15_000 }
      );

      await lockAcquiredPromise;

      let competitorFinishedWhileLocked = false;
      const competitorPromise = launchCompetitor().then((res) => {
        competitorFinishedWhileLocked = true;
        return res;
      });

      // Aguarda janela suficiente para que o competidor chegue ao pg_advisory_xact_lock no Postgres
      await delay(120);
      const settledBeforeUnlock = competitorFinishedWhileLocked;

      signalReleaseLock();
      const [, competitorResult] = await Promise.all([holderTxPromise, competitorPromise]);

      return {
        competitorResult,
        competitorFinishedWhileLocked: settledBeforeUnlock,
      };
    }

    it("Disputa 1A (Assinar QR vence, DELETE espera no lock): DELETE retorna 409 e preserva assinatura", async () => {
      const token = `tok-real-del-a-${Date.now()}`;
      const minute = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          subject: "Concorrência QR vs DELETE (Ordem A)",
          summary: "Assinatura chega antes e segura lock até commit.",
          authorName: "Pedagoga Sintética",
          authorEmail: USER_EMAIL,
          authorRole: "PEDAGOGA",
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Responsável Ordem A",
                mobileSignToken: token,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });
      const partId = minute.participants[0].id;

      const { competitorResult: deleteRes, competitorFinishedWhileLocked } =
        await runWithAdvisoryLockBarrier(
          minute.id,
          async (tx) => {
            await tx.pedagogicalMinuteParticipant.update({
              where: { id: partId },
              data: {
                signatureMode: "MOBILE_QR",
                signatureData: "data:image/png;base64,MOBILE_A",
                hasSignature: true,
                signedAt: new Date(),
                mobileSignToken: null,
                hasActiveSignLink: false,
              },
            });
          },
          () =>
            deleteSignTokenHandler(
              new Request(`http://localhost:3001/api/atas/${minute.id}/sign-token`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ participantId: partId }),
              }),
              { params: Promise.resolve({ id: minute.id }) }
            )
        );

      expect(competitorFinishedWhileLocked).toBe(false);
      expect(deleteRes.status).toBe(409);

      const fresh = await prisma.pedagogicalMinuteParticipant.findUnique({ where: { id: partId } });
      expect(fresh?.hasSignature).toBe(true);
      expect(fresh?.signatureData).toBe("data:image/png;base64,MOBILE_A");
    }, 30_000);

    it("Disputa 1B (DELETE QR vence, Assinar espera no lock): Sign retorna 404 após token revogado", async () => {
      const token = `tok-real-del-b-${Date.now()}`;
      const minute = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          subject: "Concorrência QR vs DELETE (Ordem B)",
          summary: "Cancelamento revoga token e sign-token bloqueia no lock.",
          authorName: "Pedagoga Sintética",
          authorEmail: USER_EMAIL,
          authorRole: "PEDAGOGA",
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Responsável Ordem B",
                mobileSignToken: token,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });
      const partId = minute.participants[0].id;

      const { competitorResult: signRes, competitorFinishedWhileLocked } =
        await runWithAdvisoryLockBarrier(
          minute.id,
          async (tx) => {
            await tx.pedagogicalMinuteParticipant.update({
              where: { id: partId },
              data: {
                mobileSignToken: null,
                mobileSignExpiresAt: null,
                hasActiveSignLink: false,
              },
            });
          },
          () =>
            postPublicSignTokenHandler(
              new Request(`http://localhost:3001/api/atas/sign-token/${token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  signatureData: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAA",
                }),
              }),
              { params: Promise.resolve({ token }) }
            )
        );

      expect(competitorFinishedWhileLocked).toBe(false);
      expect(signRes.status).toBe(404);

      const fresh = await prisma.pedagogicalMinuteParticipant.findUnique({ where: { id: partId } });
      expect(fresh?.hasSignature).toBe(false);
      expect(fresh?.mobileSignToken).toBeNull();
    }, 30_000);

    it("Disputa 2A (OAuth Sign vence, PATCH identidade espera no lock): PATCH retorna 409 e preserva OAuth", async () => {
      const token = `tok-real-patch-a-${Date.now()}`;
      const minute = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          subject: "Concorrência OAuth vs PATCH (Ordem A)",
          summary: "OAuth assina primeiro; PATCH tenta substituir identidade.",
          authorName: "Pedagoga Sintética",
          authorEmail: USER_EMAIL,
          authorRole: "PEDAGOGA",
          participants: {
            create: [
              {
                role: "PROFESSOR",
                name: "Docente Sintético",
                expectedEmail: "docente.sintetico@escola.pr.gov.br",
                mobileSignToken: token,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });
      const partId = minute.participants[0].id;

      const { competitorResult: patchRes, competitorFinishedWhileLocked } =
        await runWithAdvisoryLockBarrier(
          minute.id,
          async (tx) => {
            await tx.pedagogicalMinuteParticipant.update({
              where: { id: partId },
              data: {
                signatureMode: "ESCOLA_OAUTH",
                hasSignature: true,
                signedAt: new Date(),
                verifiedEmail: "docente.sintetico@escola.pr.gov.br",
                verifiedGoogleSub: "sub-sintetico-1",
                verifiedGoogleName: "Docente Sintético",
                emailVerifiedAt: new Date(),
                mobileSignToken: null,
                hasActiveSignLink: false,
              },
            });
          },
          () =>
            patchMinuteHandler(
              new Request(`http://localhost:3001/api/atas/${minute.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  subject: "Concorrência OAuth vs PATCH (Ordem A)",
                  summary: "OAuth assina primeiro; PATCH tenta substituir identidade.",
                  participants: [
                    {
                      id: partId,
                      role: "PROFESSOR",
                      name: "Outro Docente Substituído",
                      expectedEmail: "outro.docente@escola.pr.gov.br",
                    },
                  ],
                }),
              }),
              { params: Promise.resolve({ id: minute.id }) }
            )
        );

      expect(competitorFinishedWhileLocked).toBe(false);
      expect(patchRes.status).toBe(409);

      const fresh = await prisma.pedagogicalMinuteParticipant.findUnique({ where: { id: partId } });
      expect(fresh?.name).toBe("Docente Sintético");
      expect(fresh?.verifiedEmail).toBe("docente.sintetico@escola.pr.gov.br");
    }, 30_000);

    it("Disputa 2B (PATCH identidade vence, OAuth Sign espera no lock): Sign retorna 404 com token queimado", async () => {
      const token = `tok-real-patch-b-${Date.now()}`;
      const minute = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          subject: "Concorrência OAuth vs PATCH (Ordem B)",
          summary: "PATCH altera identidade e queima token antes do sign-token.",
          authorName: "Pedagoga Sintética",
          authorEmail: USER_EMAIL,
          authorRole: "PEDAGOGA",
          participants: {
            create: [
              {
                role: "PROFESSOR",
                name: "Docente Sintético",
                expectedEmail: "docente.sintetico@escola.pr.gov.br",
                mobileSignToken: token,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });
      const partId = minute.participants[0].id;

      const { competitorResult: signRes, competitorFinishedWhileLocked } =
        await runWithAdvisoryLockBarrier(
          minute.id,
          async (tx) => {
            await tx.pedagogicalMinuteParticipant.update({
              where: { id: partId },
              data: {
                name: "Outro Docente Substituído",
                expectedEmail: "outro.docente@escola.pr.gov.br",
                mobileSignToken: null,
                mobileSignExpiresAt: null,
                hasActiveSignLink: false,
              },
            });
          },
          () =>
            postPublicSignTokenHandler(
              new Request(`http://localhost:3001/api/atas/sign-token/${token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ googleIdToken: "fake-oidc-token" }),
              }),
              { params: Promise.resolve({ token }) }
            )
        );

      expect(competitorFinishedWhileLocked).toBe(false);
      expect(signRes.status).toBe(404);

      const fresh = await prisma.pedagogicalMinuteParticipant.findUnique({ where: { id: partId } });
      expect(fresh?.name).toBe("Outro Docente Substituído");
      expect(fresh?.verifiedEmail).toBeNull();
      expect(fresh?.hasSignature).toBe(false);
    }, 30_000);

    it("Disputa 3A (Mobile Sign vence, Finalize espera no lock): Finalize sela ata com assinatura já gravada", async () => {
      const token = `tok-real-fin-a-${Date.now()}`;
      const minute = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          subject: "Concorrência Sign vs Finalize (Ordem A)",
          summary: "Texto completo para lavratura oficial após assinatura.",
          authorName: "Pedagoga Sintética",
          authorEmail: USER_EMAIL,
          authorRole: "PEDAGOGA",
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Responsável Lavratura A",
                mobileSignToken: token,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });
      const partId = minute.participants[0].id;

      const { competitorResult: finRes, competitorFinishedWhileLocked } =
        await runWithAdvisoryLockBarrier(
          minute.id,
          async (tx) => {
            await tx.pedagogicalMinuteParticipant.update({
              where: { id: partId },
              data: {
                signatureMode: "MOBILE_QR",
                signatureData: "data:image/png;base64,MOBILE_FIN_A",
                hasSignature: true,
                signedAt: new Date(),
                mobileSignToken: null,
                hasActiveSignLink: false,
              },
            });
          },
          () =>
            finalizeMinuteHandler(
              new Request(`http://localhost:3001/api/atas/${minute.id}/finalize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ signingPin: "123456" }),
              }),
              { params: Promise.resolve({ id: minute.id }) }
            )
        );

      expect(competitorFinishedWhileLocked).toBe(false);
      expect(finRes.status).toBe(200);

      const freshMinute = await prisma.pedagogicalMinute.findUnique({
        where: { id: minute.id },
        include: { students: true, participants: true, actionItems: true },
      });
      expect(freshMinute?.status).toBe("FINALIZED");
      expect(freshMinute?.participants[0].hasSignature).toBe(true);
      expect(freshMinute?.participants[0].signatureData).toBe("data:image/png;base64,MOBILE_FIN_A");

      const expectedHashWithSignature = computeMinuteHash(
        buildCanonicalMinutePayload({
          minute: freshMinute!,
          year: freshMinute!.year,
          ataNumber: freshMinute!.ataNumber!,
          isExtemporaneous: freshMinute!.isExtemporaneous,
          extemporaneousReason: freshMinute!.extemporaneousReason,
          authorEmail: freshMinute!.authorEmail,
        })
      );
      const hashWithoutSignature = computeMinuteHash(
        buildCanonicalMinutePayload({
          minute: {
            ...freshMinute!,
            participants: freshMinute!.participants.map((p) => ({
              ...p,
              signatureMode: "PENDING",
              signatureData: null,
            })),
          },
          year: freshMinute!.year,
          ataNumber: freshMinute!.ataNumber!,
          isExtemporaneous: freshMinute!.isExtemporaneous,
          extemporaneousReason: freshMinute!.extemporaneousReason,
          authorEmail: freshMinute!.authorEmail,
        })
      );

      expect(freshMinute?.contentHash).toBe(expectedHashWithSignature);
      expect(freshMinute?.contentHash).not.toBe(hashWithoutSignature);
    }, 30_000);

    it("Disputa 3B (Finalize vence, Mobile Sign espera no lock): Sign retorna 410 mantendo FINALIZED íntegro", async () => {
      const token = `tok-real-fin-b-${Date.now()}`;
      const minute = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          subject: "Concorrência Sign vs Finalize (Ordem B)",
          summary: "Lavratura conclui primeiro; assinatura tardia é rejeitada com 410.",
          authorName: "Pedagoga Sintética",
          authorEmail: USER_EMAIL,
          authorRole: "PEDAGOGA",
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Responsável Lavratura B",
                mobileSignToken: token,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });

      const { competitorResult: signRes, competitorFinishedWhileLocked } =
        await runWithAdvisoryLockBarrier(
          minute.id,
          async (tx) => {
            await tx.pedagogicalMinute.update({
              where: { id: minute.id },
              data: {
                status: "FINALIZED",
                ataNumber: 901,
                finalizedAt: new Date(),
                contentHash: "a".repeat(64),
                verificationCode: `VRF-LOCK-${Date.now()}`,
              },
            });
          },
          () =>
            postPublicSignTokenHandler(
              new Request(`http://localhost:3001/api/atas/sign-token/${token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  signatureData: "data:image/png;base64,BBBBBBBBBBBBBBBBBBBB",
                }),
              }),
              { params: Promise.resolve({ token }) }
            )
        );

      expect(competitorFinishedWhileLocked).toBe(false);
      expect(signRes.status).toBe(410);

      const freshMinute = await prisma.pedagogicalMinute.findUnique({
        where: { id: minute.id },
        include: { participants: true },
      });
      expect(freshMinute?.status).toBe("FINALIZED");
      expect(freshMinute?.participants[0].hasSignature).toBe(false);
    }, 30_000);
  }
);
