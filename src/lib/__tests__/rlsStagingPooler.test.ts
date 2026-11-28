import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { populateGlobalTakenCgms } from "@/lib/syncCgmGuard";
import { verifyStagingTargetsReadOnly } from "@/lib/rlsStagingTargetGuard";

const hoisted = vi.hoisted(() => ({
  runtimePrismaRef: { current: null as PrismaClient | null },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = hoisted.runtimePrismaRef.current;
        if (!client) {
          throw new Error("runtimePrismaRef.current não inicializado.");
        }
        const value = Reflect.get(client, prop, client);
        return typeof value === "function" ? value.bind(client) : value;
      },
    }
  ),
}));

import { POST as whatsappWebhookPost } from "@/app/api/webhooks/whatsapp/route";
import { resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";

const SHOULD_RUN = process.env.RUN_RLS_STAGING_POOLER_TEST === "true";

function assertSafeStagingPoolerConfig(): {
  adminUrl: string;
  runtimePoolerUrl: string;
  expectedDb: string;
  allowLocalVerify: boolean;
} {
  const targetMarker = process.env.RLS_STAGING_TARGET_CONFIRMED;
  if (targetMarker !== "staging") {
    throw new Error(
      "RLS_STAGING_TARGET_CONFIRMED='staging' é obrigatório quando RUN_RLS_STAGING_POOLER_TEST=true (trava contra execução acidental em produção)."
    );
  }

  const adminUrl = process.env.RLS_STAGING_ADMIN_URL;
  const runtimePoolerUrl = process.env.RLS_STAGING_RUNTIME_POOLER_URL;
  const expectedDb = String(process.env.RLS_STAGING_EXPECTED_DB || "").trim();
  if (!adminUrl || !runtimePoolerUrl || !expectedDb) {
    throw new Error(
      "RLS_STAGING_ADMIN_URL, RLS_STAGING_RUNTIME_POOLER_URL e RLS_STAGING_EXPECTED_DB são obrigatórios quando RUN_RLS_STAGING_POOLER_TEST=true."
    );
  }

  const allowLocalVerify = process.env.RLS_STAGING_ALLOW_LOCAL_VERIFY === "true";
  const parsedAdmin = new URL(adminUrl);
  const parsedRuntime = new URL(runtimePoolerUrl);

  const isLoopback = (host: string) =>
    host === "127.0.0.1" || host === "localhost" || host === "::1";

  if (allowLocalVerify) {
    if (!isLoopback(parsedAdmin.hostname) || !isLoopback(parsedRuntime.hostname)) {
      throw new Error("RLS_STAGING_ALLOW_LOCAL_VERIFY=true aceita apenas hosts loopback.");
    }
  } else {
    const runtimeHost = parsedRuntime.hostname.toLowerCase();
    const hasPoolerHost = runtimeHost.includes("-pooler");
    const hasPgBouncer = parsedRuntime.searchParams.get("pgbouncer") === "true";
    if (!hasPoolerHost || !hasPgBouncer) {
      throw new Error(
        "RLS_STAGING_RUNTIME_POOLER_URL deve apontar para endpoint '-pooler' do Neon com '?pgbouncer=true'."
      );
    }
    if (parsedAdmin.hostname.toLowerCase().includes("-pooler")) {
      throw new Error(
        "RLS_STAGING_ADMIN_URL deve usar conexão direta de app_migrator (sem '-pooler')."
      );
    }
  }

  return { adminUrl, runtimePoolerUrl, expectedDb, allowLocalVerify };
}

describe.skipIf(!SHOULD_RUN)(
  "Homologação Onda 1 RLS — Staging Neon (-pooler) com app_runtime sob FORCE ROW LEVEL SECURITY",
  () => {
    let adminPrisma: PrismaClient;
    let runtimePrisma: PrismaClient;
    let allowLocalVerify = false;
    let expectedDb = "";
    let targetConfirmed = false;

    const runId = crypto.randomBytes(6).toString("hex");
    const ALPHA_ID = `rls-stg-alpha-${runId}`;
    const BETA_ID = `rls-stg-beta-${runId}`;
    const authUserId = `stg-${runId}-user`;
    const authUserEmail = `stg.${runId}@escola.pr.gov.br`;
    const authUserSchoolId = `stg-${runId}-us`;

    const trackedIds = {
      alphaClassGroups: [] as string[],
      alphaStudents: [] as string[],
      alphaTemplates: [] as string[],
      alphaLogs: [] as string[],
      betaClassGroups: [] as string[],
      betaStudents: [] as string[],
      betaTemplates: [] as string[],
      betaLogs: [] as string[],
      auditEntityIds: [] as string[],
      userSchoolIds: [] as string[],
      userIds: [] as string[],
      schoolIds: [] as string[],
    };

    const cgAlphaId = `stg-${runId}-cg-alpha`;
    const stuAlphaId = `stg-${runId}-stu-alpha`;
    const tplAlphaDelId = `stg-${runId}-tpl-alpha-del`;
    const logAlphaId = `stg-${runId}-log-alpha`;
    const logAlphaWebhookId = `stg-${runId}-log-alpha-wh`;

    const cgBetaId = `stg-${runId}-cg-beta`;
    const stuBetaId = `stg-${runId}-stu-beta`;
    const tplBetaId = `stg-${runId}-tpl-beta`;
    const logBetaId = `stg-${runId}-log-beta`;

    beforeAll(async () => {
      const cfg = assertSafeStagingPoolerConfig();
      allowLocalVerify = cfg.allowLocalVerify;
      expectedDb = cfg.expectedDb;

      adminPrisma = new PrismaClient({ datasources: { db: { url: cfg.adminUrl } } });
      runtimePrisma = new PrismaClient({ datasources: { db: { url: cfg.runtimePoolerUrl } } });
      await adminPrisma.$connect();
      await runtimePrisma.$connect();

      // Verificação SOMENTE LEITURA antes de qualquer criação ou limpeza
      await verifyStagingTargetsReadOnly({
        adminClient: adminPrisma,
        runtimeClient: runtimePrisma,
        expectedDb,
      });
      targetConfirmed = true;

      hoisted.runtimePrismaRef.current = runtimePrisma;

      await adminPrisma.school.createMany({
        data: [
          { id: ALPHA_ID, name: `Staging Alpha ${runId}`, inepCode: `99${runId.slice(0, 6)}`, active: true },
          { id: BETA_ID, name: `Staging Beta ${runId}`, inepCode: `98${runId.slice(0, 6)}`, active: true },
        ],
      });
      trackedIds.schoolIds.push(ALPHA_ID, BETA_ID);

      await adminPrisma.user.create({
        data: {
          id: authUserId,
          email: authUserEmail,
          name: `Docente Staging ${runId}`,
          role: "PEDAGOGA",
          active: true,
          schoolId: ALPHA_ID,
        },
      });
      trackedIds.userIds.push(authUserId);

      await adminPrisma.userSchool.create({
        data: {
          id: authUserSchoolId,
          userId: authUserId,
          schoolId: ALPHA_ID,
          role: "PEDAGOGA",
          active: true,
        },
      });
      trackedIds.userSchoolIds.push(authUserSchoolId);
    });

    afterAll(async () => {
      hoisted.runtimePrismaRef.current = null;
      const cleanupErrors: string[] = [];

      if (targetConfirmed) {
        try {
          if (runtimePrisma) {
            await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
              if (trackedIds.alphaLogs.length > 0) {
                await tx.messageLog.deleteMany({ where: { id: { in: trackedIds.alphaLogs } } });
              }
              if (trackedIds.alphaTemplates.length > 0) {
                await tx.messageTemplate.deleteMany({ where: { id: { in: trackedIds.alphaTemplates } } });
              }
              if (trackedIds.alphaStudents.length > 0) {
                await tx.student.deleteMany({ where: { id: { in: trackedIds.alphaStudents } } });
              }
              if (trackedIds.alphaClassGroups.length > 0) {
                await tx.classGroup.deleteMany({ where: { id: { in: trackedIds.alphaClassGroups } } });
              }
              const leftoverLogs = await tx.messageLog.count();
              const leftoverStudents = await tx.student.count();
              if (leftoverLogs !== 0 || leftoverStudents !== 0) {
                throw new Error(
                  `CLEANUP_LEFTOVER_ALPHA: logs=${leftoverLogs}, students=${leftoverStudents}`
                );
              }
            });

            await withTenantContext(runtimePrisma, BETA_ID, async (tx) => {
              if (trackedIds.betaLogs.length > 0) {
                await tx.messageLog.deleteMany({ where: { id: { in: trackedIds.betaLogs } } });
              }
              if (trackedIds.betaTemplates.length > 0) {
                await tx.messageTemplate.deleteMany({ where: { id: { in: trackedIds.betaTemplates } } });
              }
              if (trackedIds.betaStudents.length > 0) {
                await tx.student.deleteMany({ where: { id: { in: trackedIds.betaStudents } } });
              }
              if (trackedIds.betaClassGroups.length > 0) {
                await tx.classGroup.deleteMany({ where: { id: { in: trackedIds.betaClassGroups } } });
              }
              const leftoverLogs = await tx.messageLog.count();
              const leftoverStudents = await tx.student.count();
              if (leftoverLogs !== 0 || leftoverStudents !== 0) {
                throw new Error(
                  `CLEANUP_LEFTOVER_BETA: logs=${leftoverLogs}, students=${leftoverStudents}`
                );
              }
            });
          }
        } catch (err) {
          cleanupErrors.push(`tenantCleanup: ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
          if (adminPrisma) {
            if (trackedIds.auditEntityIds.length > 0) {
              await adminPrisma.auditLog.deleteMany({
                where: { entityId: { in: trackedIds.auditEntityIds } },
              });
            }
            if (trackedIds.userSchoolIds.length > 0) {
              await adminPrisma.userSchool.deleteMany({
                where: { id: { in: trackedIds.userSchoolIds } },
              });
            }
            if (trackedIds.userIds.length > 0) {
              await adminPrisma.user.deleteMany({
                where: { id: { in: trackedIds.userIds } },
              });
            }
            if (trackedIds.schoolIds.length > 0) {
              const delSchools = await adminPrisma.school.deleteMany({
                where: { id: { in: trackedIds.schoolIds } },
              });
              if (delSchools.count !== trackedIds.schoolIds.length) {
                throw new Error(
                  `Expected ${trackedIds.schoolIds.length} synthetic schools deleted, got ${delSchools.count}`
                );
              }
            }
          }
        } catch (err) {
          cleanupErrors.push(`schoolCleanup: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      await runtimePrisma?.$disconnect().catch((err) => {
        cleanupErrors.push(`runtimeDisconnect: ${err instanceof Error ? err.message : String(err)}`);
      });
      await adminPrisma?.$disconnect().catch((err) => {
        cleanupErrors.push(`adminDisconnect: ${err instanceof Error ? err.message : String(err)}`);
      });

      if (cleanupErrors.length > 0) {
        throw new Error(`STAGING_CLEANUP_FAILED: ${cleanupErrors.join(" | ")}`);
      }
    });

    it("0. bloqueia conexões desencontradas ou alvo sem identificação antes de qualquer escrita", async () => {
      await expect(
        verifyStagingTargetsReadOnly({
          adminClient: adminPrisma,
          runtimeClient: runtimePrisma,
          expectedDb: "banco_inexistente_nao_autorizado",
        })
      ).rejects.toThrow(/STAGING_DB_MISMATCH/);

      // Simula runtime apontando para papel ou instância divergente (somente leitura)
      await expect(
        verifyStagingTargetsReadOnly({
          adminClient: runtimePrisma,
          runtimeClient: runtimePrisma,
          expectedDb,
        })
      ).rejects.toThrow(/STAGING_ADMIN_ROLE_MISMATCH/);

      const fakeMissingCommentClient = {
        $queryRaw: async () => [
          {
            db: expectedDb,
            role: "app_migrator",
            sessionRole: "app_migrator",
            startTime: "2026-11-28",
            pgVersion: "16",
            dbComment: null,
          },
        ],
      } as unknown as Pick<PrismaClient, "$queryRaw">;

      await expect(
        verifyStagingTargetsReadOnly({
          adminClient: fakeMissingCommentClient,
          runtimeClient: runtimePrisma,
          expectedDb,
        })
      ).rejects.toThrow(/STAGING_RUNTIME_ROLE_MISMATCH|STAGING_INSTANCE_MISMATCH|STAGING_ENV_MARKER_MISSING/);
    });

    it("1. comprova privilégios mínimos de app_runtime, posse de app_migrator e ENABLE/FORCE RLS nas 4 tabelas", async () => {
      const identity = await runtimePrisma.$queryRaw<
        Array<{ current_user: string; session_user: string }>
      >`SELECT current_user, session_user`;
      expect(identity[0]).toEqual({ current_user: "app_runtime", session_user: "app_runtime" });

      const roleRows = await adminPrisma.$queryRaw<
        Array<{
          rolname: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
          rolcreaterole: boolean;
          rolcreatedb: boolean;
        }>
      >`
        SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
        FROM pg_roles
        WHERE rolname = 'app_runtime'
      `;
      expect(roleRows).toEqual([
        {
          rolname: "app_runtime",
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
        },
      ]);

      const ownerRows = await adminPrisma.$queryRaw<
        Array<{ tablename: string; tableowner: string }>
      >`
        SELECT tablename, tableowner
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('School', 'ClassGroup', 'Student', 'MessageTemplate', 'MessageLog')
      `;
      expect(ownerRows.length).toBe(5);
      expect(ownerRows.every((r) => r.tableowner !== "app_runtime")).toBe(true);

      await expect(runtimePrisma.$executeRawUnsafe(`SET ROLE app_migrator`)).rejects.toThrow(
        /42501|permission denied to set role/i
      );

      const rlsFlags = await adminPrisma.$queryRaw<
        Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
      >`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN ('ClassGroup', 'Student', 'MessageTemplate', 'MessageLog')
        ORDER BY relname ASC
      `;
      expect(rlsFlags).toEqual([
        { relname: "ClassGroup", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "MessageLog", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "MessageTemplate", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "Student", relrowsecurity: true, relforcerowsecurity: true },
      ]);
    });

    it("2-6. valida operações legítimas, isolamento (42501), UPDATE/DELETE sem visibilidade, FKs compostas (23503) e ON DELETE SET NULL (templateId)", async () => {
      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await tx.classGroup.create({
          data: { id: cgAlphaId, schoolId: ALPHA_ID, name: "6º A", shift: "Manhã", segment: "FUNDAMENTAL" },
        });
        trackedIds.alphaClassGroups.push(cgAlphaId);

        await tx.student.create({
          data: {
            id: stuAlphaId,
            schoolId: ALPHA_ID,
            classGroupId: cgAlphaId,
            cgm: `9981${runId.slice(0, 6)}`,
            name: "Estudante Alpha",
            phone: "41999998101",
          },
        });
        trackedIds.alphaStudents.push(stuAlphaId);

        await tx.messageTemplate.create({
          data: {
            id: tplAlphaDelId,
            schoolId: ALPHA_ID,
            title: "Modelo Alpha Excluir",
            prefixText: "Olá ",
            suffixText: "!",
          },
        });
        trackedIds.alphaTemplates.push(tplAlphaDelId);

        await tx.messageLog.create({
          data: {
            id: logAlphaId,
            schoolId: ALPHA_ID,
            studentId: stuAlphaId,
            templateId: tplAlphaDelId,
            reasonTitle: "Falta",
            messageContent: "Aviso Alpha",
            phoneUsed: "41999998101",
            sentByName: "Equipe Alpha",
          },
        });
        trackedIds.alphaLogs.push(logAlphaId);

        await tx.messageLog.create({
          data: {
            id: logAlphaWebhookId,
            schoolId: ALPHA_ID,
            studentId: stuAlphaId,
            templateId: null,
            reasonTitle: "Webhook Alpha",
            messageContent: "Aviso Webhook Alpha",
            phoneUsed: "41999998222",
            sentByName: "Equipe Alpha",
          },
        });
        trackedIds.alphaLogs.push(logAlphaWebhookId);
      });

      await withTenantContext(runtimePrisma, BETA_ID, async (tx) => {
        await tx.classGroup.create({
          data: { id: cgBetaId, schoolId: BETA_ID, name: "6º A", shift: "Manhã", segment: "FUNDAMENTAL" },
        });
        trackedIds.betaClassGroups.push(cgBetaId);

        await tx.student.create({
          data: {
            id: stuBetaId,
            schoolId: BETA_ID,
            classGroupId: cgBetaId,
            cgm: `9881${runId.slice(0, 6)}`,
            name: "Estudante Beta",
            phone: "41999998101",
          },
        });
        trackedIds.betaStudents.push(stuBetaId);

        await tx.messageTemplate.create({
          data: {
            id: tplBetaId,
            schoolId: BETA_ID,
            title: "Modelo Beta",
            prefixText: "Olá ",
            suffixText: "!",
          },
        });
        trackedIds.betaTemplates.push(tplBetaId);

        await tx.messageLog.create({
          data: {
            id: logBetaId,
            schoolId: BETA_ID,
            studentId: stuBetaId,
            templateId: tplBetaId,
            reasonTitle: "Falta",
            messageContent: "Aviso Beta",
            phoneUsed: "41999998101",
            sentByName: "Equipe Beta",
          },
        });
        trackedIds.betaLogs.push(logBetaId);
      });

      const betaSnapshotBefore = await withTenantContext(runtimePrisma, BETA_ID, (tx) =>
        tx.student.findUnique({ where: { id: stuBetaId }, select: { id: true, name: true, schoolId: true } })
      );
      expect(betaSnapshotBefore).toEqual({
        id: stuBetaId,
        name: "Estudante Beta",
        schoolId: BETA_ID,
      });

      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        expect(await tx.student.findMany({ where: { id: stuBetaId } })).toEqual([]);
        expect(
          (await tx.student.updateMany({ where: { id: stuBetaId }, data: { name: "Alterado" } })).count
        ).toBe(0);
        expect((await tx.messageLog.deleteMany({ where: { id: logBetaId } })).count).toBe(0);
      });

      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."ClassGroup" ("id", "schoolId", "name", "shift", "segment")
            VALUES (${`stg-${runId}-cg-rls-fail`}, ${BETA_ID}, 'Invasão', 'Manhã', 'FUNDAMENTAL')
          `
        ).rejects.toThrow(/42501|row-level security/i);
      });

      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."Student" ("id", "schoolId", "classGroupId", "name", "phone", "updatedAt")
            VALUES (${`stg-${runId}-stu-fk-fail`}, ${ALPHA_ID}, ${cgBetaId}, 'FK Cruzada', '41999990000', NOW())
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."MessageLog" ("id", "schoolId", "studentId", "templateId", "reasonTitle", "messageContent", "phoneUsed", "sentByName")
            VALUES (${`stg-${runId}-log-fk-fail`}, ${ALPHA_ID}, ${stuAlphaId}, ${tplBetaId}, 'X', 'Y', '41999990000', 'Equipe')
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      const betaSnapshotAfter = await withTenantContext(runtimePrisma, BETA_ID, (tx) =>
        tx.student.findUnique({ where: { id: stuBetaId }, select: { id: true, name: true, schoolId: true } })
      );
      expect(betaSnapshotAfter).toEqual(betaSnapshotBefore);

      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await tx.messageTemplate.delete({ where: { id: tplAlphaDelId } });
        const logAfter = await tx.messageLog.findUnique({
          where: { id: logAlphaId },
          select: { schoolId: true, templateId: true },
        });
        expect(logAfter).toEqual({ schoolId: ALPHA_ID, templateId: null });
      });
    });

    it("7-11. valida contexto ausente/vazio, alternância A->B->sem contexto após COMMIT e ROLLBACK, reúso de pg_backend_pid() e concorrência", async () => {
      expect(await runtimePrisma.classGroup.count()).toBe(0);
      expect(await runtimePrisma.student.count()).toBe(0);
      expect(await runtimePrisma.messageTemplate.count()).toBe(0);
      expect(await runtimePrisma.messageLog.count()).toBe(0);
      await expect(
        runtimePrisma.$executeRaw`
          INSERT INTO public."ClassGroup" ("id", "schoolId", "name", "shift", "segment")
          VALUES (${`stg-${runId}-cg-no-ctx`}, ${ALPHA_ID}, 'Sem Ctx', 'Manhã', 'FUNDAMENTAL')
        `
      ).rejects.toThrow(/42501|row-level security/i);

      const maxAttempts = allowLocalVerify ? 1 : 8;
      let commitPidReused = false;
      let rollbackPidReused = false;

      for (let attempt = 0; attempt < maxAttempts && !commitPidReused; attempt += 1) {
        const alphaTx = await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
          const r = await tx.$queryRaw<Array<{ pid: number; val: string | null }>>`
            SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS val
          `;
          return r[0];
        });
        expect(alphaTx.val).toBe(ALPHA_ID);

        const betaTx = await withTenantContext(runtimePrisma, BETA_ID, async (tx) => {
          const r = await tx.$queryRaw<Array<{ pid: number; val: string | null }>>`
            SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS val
          `;
          return r[0];
        });
        expect(betaTx.val).toBe(BETA_ID);

        const afterCommit = await runtimePrisma.$queryRaw<
          Array<{ pid: number; val: string | null; count: bigint }>
        >`
          SELECT pg_backend_pid()::int AS pid,
                 NULLIF(current_setting('app.current_school_id', true), '') AS val,
                 (SELECT COUNT(*) FROM public."MessageLog") AS count
        `;
        expect(afterCommit[0].val).toBeNull();
        expect(afterCommit[0].count).toBe(0n);

        console.log(
          `[pooler-pid-commit] mode=${allowLocalVerify ? "local_direct" : "pooler"} attempt=${attempt + 1} alphaPid=${alphaTx.pid}(${alphaTx.val}) betaPid=${betaTx.pid}(${betaTx.val}) afterCommitPid=${afterCommit[0].pid}(${afterCommit[0].val})`
        );

        if (afterCommit[0].pid === alphaTx.pid || afterCommit[0].pid === betaTx.pid) {
          commitPidReused = true;
        }
      }

      for (let attempt = 0; attempt < maxAttempts && !rollbackPidReused; attempt += 1) {
        const rollbackCgId = `stg-${runId}-cg-rb-${attempt}`;
        let rollbackPid = -1;
        await expect(
          withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
            const r = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
            rollbackPid = r[0].pid;
            await tx.classGroup.create({
              data: { id: rollbackCgId, schoolId: ALPHA_ID, name: `Rollback ${attempt}`, shift: "Tarde", segment: "MEDIO" },
            });
            throw new Error("FORCED_STAGING_ROLLBACK");
          })
        ).rejects.toThrow("FORCED_STAGING_ROLLBACK");

        // PRIMEIRA consulta após ROLLBACK deve ser sem contexto escolar!
        const afterRollback = await runtimePrisma.$queryRaw<
          Array<{ pid: number; val: string | null; count: bigint }>
        >`
          SELECT pg_backend_pid()::int AS pid,
                 NULLIF(current_setting('app.current_school_id', true), '') AS val,
                 (SELECT COUNT(*) FROM public."ClassGroup") AS count
        `;
        expect(afterRollback[0].val).toBeNull();
        expect(afterRollback[0].count).toBe(0n);

        console.log(
          `[pooler-pid-rollback] mode=${allowLocalVerify ? "local_direct" : "pooler"} attempt=${attempt + 1} rollbackPid=${rollbackPid}(${ALPHA_ID}) afterRollbackPid=${afterRollback[0].pid}(${afterRollback[0].val})`
        );

        // Somente DEPOIS verifica em withTenantContext que a linha abortada não persistiu
        const persistedAborted = await withTenantContext(runtimePrisma, ALPHA_ID, (tx) =>
          tx.classGroup.findUnique({ where: { id: rollbackCgId } })
        );
        expect(persistedAborted).toBeNull();

        if (afterRollback[0].pid === rollbackPid) {
          rollbackPidReused = true;
        }
      }

      if (!commitPidReused || !rollbackPidReused) {
        throw new Error(
          `PENDENTE_REUSO_PID_POOLER: isolamento sem vazamento confirmado, mas repetição de pg_backend_pid() não foi observada em ${maxAttempts} tentativas (commitPidReused=${commitPidReused}, rollbackPidReused=${rollbackPidReused}).`
        );
      }

      // Leituras e escritas concorrentes intercaladas entre Alpha e Beta
      const concAlphaIds: string[] = [];
      const concBetaIds: string[] = [];
      await Promise.all(
        Array.from({ length: 8 }, (_, idx) => {
          const isAlpha = idx % 2 === 0;
          const target = isAlpha ? ALPHA_ID : BETA_ID;
          const cgId = `stg-${runId}-cg-conc-${isAlpha ? "a" : "b"}-${idx}`;
          if (isAlpha) {
            concAlphaIds.push(cgId);
            trackedIds.alphaClassGroups.push(cgId);
          } else {
            concBetaIds.push(cgId);
            trackedIds.betaClassGroups.push(cgId);
          }
          return withTenantContext(runtimePrisma, target, async (tx) => {
            await tx.classGroup.create({
              data: { id: cgId, schoolId: target, name: `Conc ${idx}`, shift: "Manhã", segment: "MEDIO" },
            });
            const rows = await tx.classGroup.findMany({ select: { id: true, schoolId: true } });
            expect(rows.every((r) => r.schoolId === target)).toBe(true);
          });
        })
      );

      const persistedAlpha = await withTenantContext(runtimePrisma, ALPHA_ID, (tx) =>
        tx.classGroup.findMany({ where: { id: { in: [...concAlphaIds, ...concBetaIds] } }, select: { id: true, schoolId: true } })
      );
      expect(persistedAlpha.map((r) => r.id).sort()).toEqual([...concAlphaIds].sort());

      const persistedBeta = await withTenantContext(runtimePrisma, BETA_ID, (tx) =>
        tx.classGroup.findMany({ where: { id: { in: [...concAlphaIds, ...concBetaIds] } }, select: { id: true, schoolId: true } })
      );
      expect(persistedBeta.map((r) => r.id).sort()).toEqual([...concBetaIds].sort());

      expect(await runtimePrisma.classGroup.count()).toBe(0);
    });

    it("12. executa auth snapshot, handler real do webhook WhatsApp (com AuditLog) e populateGlobalTakenCgms sob app_runtime + FORCE RLS", async () => {
      const prevWebhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
      const prevResolverFlag = process.env.RLS_WAVE1_SECDEF_RESOLVER;
      const prevStrictAuth = process.env.FORCE_STRICT_DB_AUTH;
      process.env.WHATSAPP_WEBHOOK_SECRET = "staging-webhook-secret-synthetic";
      process.env.RLS_WAVE1_SECDEF_RESOLVER = "true";
      process.env.FORCE_STRICT_DB_AUTH = "true";

      try {
        // 12a. Revalidação de sessão real (User + UserSchool) sob app_runtime
        const authSnapshot = await resolveServerUserAuthSnapshot({
          user: { id: authUserId, email: authUserEmail, role: "PEDAGOGA", active: true },
        });
        expect(authSnapshot).not.toBeNull();
        expect(authSnapshot?.active).toBe(true);
        expect(authSnapshot?.schools.some((s) => s.schoolId === ALPHA_ID && s.role === "PEDAGOGA")).toBe(true);
        expect(authSnapshot?.schools.some((s) => s.schoolId === BETA_ID)).toBe(false);

        // 12b. CGM global via SECURITY DEFINER retorna apenas CGM ocupado
        const takenCgms = new Set<string>();
        await populateGlobalTakenCgms(
          runtimePrisma,
          [`9881${runId.slice(0, 6)}`, `9999${runId.slice(0, 6)}`],
          takenCgms
        );
        expect(takenCgms.has(`9881${runId.slice(0, 6)}`)).toBe(true);
        expect(takenCgms.has(`9999${runId.slice(0, 6)}`)).toBe(false);

        // 12c. Handler real POST /api/webhooks/whatsapp com logId válido altera apenas Alpha e persiste AuditLog
        trackedIds.auditEntityIds.push(logAlphaWebhookId, logAlphaId, logBetaId);
        const validReq = new Request("http://localhost:3000/api/webhooks/whatsapp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-secret": "staging-webhook-secret-synthetic",
          },
          body: JSON.stringify({
            logId: logAlphaWebhookId,
            phone: "41999998222",
            text: "Confirmado recebimento",
          }),
        });
        const validRes = await whatsappWebhookPost(validReq);
        expect(validRes.status).toBe(200);
        const validBody = await validRes.json();
        expect(validBody.ignored).not.toBe(true);

        const alphaWhLog = await withTenantContext(runtimePrisma, ALPHA_ID, (tx) =>
          tx.messageLog.findUnique({
            where: { id: logAlphaWebhookId },
            select: { guardianReplied: true, replyNotes: true },
          })
        );
        expect(alphaWhLog?.guardianReplied).toBe(true);
        expect(alphaWhLog?.replyNotes).toContain("Confirmado recebimento");

        const persistedAudit = await runtimePrisma.auditLog.findFirst({
          where: {
            schoolId: ALPHA_ID,
            entityId: logAlphaWebhookId,
            action: "WEBHOOK_REPLY",
          },
          select: { id: true, schoolId: true, entityId: true, action: true },
        });
        expect(persistedAudit).toMatchObject({
          schoolId: ALPHA_ID,
          entityId: logAlphaWebhookId,
          action: "WEBHOOK_REPLY",
        });

        // 12d. Handler real POST /api/webhooks/whatsapp com telefone compartilhado (Alpha e Beta) ignora sem gravar nem auditar
        const ambiguousReq = new Request("http://localhost:3000/api/webhooks/whatsapp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-secret": "staging-webhook-secret-synthetic",
          },
          body: JSON.stringify({
            phone: "41999998101",
            text: "Resposta ambígua",
          }),
        });
        const ambiguousRes = await whatsappWebhookPost(ambiguousReq);
        expect(ambiguousRes.status).toBe(200);
        const ambiguousBody = await ambiguousRes.json();
        expect(ambiguousBody.ignored).toBe(true);

        const [alphaSharedLog, betaSharedLog, ambiguousAudits] = await Promise.all([
          withTenantContext(runtimePrisma, ALPHA_ID, (tx) =>
            tx.messageLog.findUnique({ where: { id: logAlphaId }, select: { guardianReplied: true } })
          ),
          withTenantContext(runtimePrisma, BETA_ID, (tx) =>
            tx.messageLog.findUnique({ where: { id: logBetaId }, select: { guardianReplied: true } })
          ),
          runtimePrisma.auditLog.findMany({
            where: {
              entityId: { in: [logAlphaId, logBetaId] },
              action: "WEBHOOK_REPLY",
            },
          }),
        ]);
        expect(alphaSharedLog?.guardianReplied).toBe(false);
        expect(betaSharedLog?.guardianReplied).toBe(false);
        expect(ambiguousAudits).toEqual([]);
      } finally {
        if (prevWebhookSecret === undefined) delete process.env.WHATSAPP_WEBHOOK_SECRET;
        else process.env.WHATSAPP_WEBHOOK_SECRET = prevWebhookSecret;
        if (prevResolverFlag === undefined) delete process.env.RLS_WAVE1_SECDEF_RESOLVER;
        else process.env.RLS_WAVE1_SECDEF_RESOLVER = prevResolverFlag;
        if (prevStrictAuth === undefined) delete process.env.FORCE_STRICT_DB_AUTH;
        else process.env.FORCE_STRICT_DB_AUTH = prevStrictAuth;
      }
    });
  }
);
