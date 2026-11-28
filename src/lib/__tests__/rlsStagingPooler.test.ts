import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { populateGlobalTakenCgms } from "@/lib/syncCgmGuard";

const SHOULD_RUN = process.env.RUN_RLS_STAGING_POOLER_TEST === "true";

function assertSafeStagingPoolerConfig(): {
  adminUrl: string;
  runtimePoolerUrl: string;
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
  if (!adminUrl || !runtimePoolerUrl) {
    throw new Error(
      "RLS_STAGING_ADMIN_URL e RLS_STAGING_RUNTIME_POOLER_URL são obrigatórios quando RUN_RLS_STAGING_POOLER_TEST=true."
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

  return { adminUrl, runtimePoolerUrl, allowLocalVerify };
}

describe.skipIf(!SHOULD_RUN)(
  "Homologação Onda 1 RLS — Staging Neon (-pooler) com app_runtime sob FORCE ROW LEVEL SECURITY",
  () => {
    let adminPrisma: PrismaClient;
    let runtimePrisma: PrismaClient;
    let allowLocalVerify = false;

    const ALPHA_ID = "rls-stg-alpha";
    const BETA_ID = "rls-stg-beta";
    const observedPids = new Set<number>();

    beforeAll(async () => {
      const cfg = assertSafeStagingPoolerConfig();
      allowLocalVerify = cfg.allowLocalVerify;

      adminPrisma = new PrismaClient({ datasources: { db: { url: cfg.adminUrl } } });
      runtimePrisma = new PrismaClient({ datasources: { db: { url: cfg.runtimePoolerUrl } } });
      await adminPrisma.$connect();
      await runtimePrisma.$connect();

      await adminPrisma.messageLog.deleteMany({
        where: { id: { startsWith: "stg-" } },
      });
      await adminPrisma.messageTemplate.deleteMany({
        where: { id: { startsWith: "stg-" } },
      });
      await adminPrisma.student.deleteMany({
        where: { id: { startsWith: "stg-" } },
      });
      await adminPrisma.classGroup.deleteMany({
        where: { id: { startsWith: "stg-" } },
      });

      await adminPrisma.school.createMany({
        data: [
          { id: ALPHA_ID, name: "Staging Alpha", inepCode: "99810001", active: true },
          { id: BETA_ID, name: "Staging Beta", inepCode: "99810002", active: true },
        ],
        skipDuplicates: true,
      });
    });

    afterAll(async () => {
      if (adminPrisma) {
        await adminPrisma.messageLog.deleteMany({ where: { id: { startsWith: "stg-" } } }).catch(() => {});
        await adminPrisma.messageTemplate.deleteMany({ where: { id: { startsWith: "stg-" } } }).catch(() => {});
        await adminPrisma.student.deleteMany({ where: { id: { startsWith: "stg-" } } }).catch(() => {});
        await adminPrisma.classGroup.deleteMany({ where: { id: { startsWith: "stg-" } } }).catch(() => {});
      }
      await runtimePrisma?.$disconnect().catch(() => {});
      await adminPrisma?.$disconnect().catch(() => {});
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
          data: { id: "stg-cg-alpha", schoolId: ALPHA_ID, name: "6º A", shift: "Manhã", segment: "FUNDAMENTAL" },
        });
        await tx.student.create({
          data: {
            id: "stg-stu-alpha",
            schoolId: ALPHA_ID,
            classGroupId: "stg-cg-alpha",
            cgm: "9981000101",
            name: "Estudante Alpha",
            phone: "41999998101",
          },
        });
        await tx.messageTemplate.create({
          data: {
            id: "stg-tpl-alpha-del",
            schoolId: ALPHA_ID,
            title: "Modelo Alpha Excluir",
            prefixText: "Olá ",
            suffixText: "!",
          },
        });
        await tx.messageLog.create({
          data: {
            id: "stg-log-alpha",
            schoolId: ALPHA_ID,
            studentId: "stg-stu-alpha",
            templateId: "stg-tpl-alpha-del",
            reasonTitle: "Falta",
            messageContent: "Aviso Alpha",
            phoneUsed: "41999998101",
            sentByName: "Equipe Alpha",
          },
        });
      });

      await withTenantContext(runtimePrisma, BETA_ID, async (tx) => {
        await tx.classGroup.create({
          data: { id: "stg-cg-beta", schoolId: BETA_ID, name: "6º A", shift: "Manhã", segment: "FUNDAMENTAL" },
        });
        await tx.student.create({
          data: {
            id: "stg-stu-beta",
            schoolId: BETA_ID,
            classGroupId: "stg-cg-beta",
            cgm: "9981000201",
            name: "Estudante Beta",
            phone: "41999998101",
          },
        });
        await tx.messageTemplate.create({
          data: {
            id: "stg-tpl-beta",
            schoolId: BETA_ID,
            title: "Modelo Beta",
            prefixText: "Olá ",
            suffixText: "!",
          },
        });
        await tx.messageLog.create({
          data: {
            id: "stg-log-beta",
            schoolId: BETA_ID,
            studentId: "stg-stu-beta",
            templateId: "stg-tpl-beta",
            reasonTitle: "Falta",
            messageContent: "Aviso Beta",
            phoneUsed: "41999998101",
            sentByName: "Equipe Beta",
          },
        });
      });

      const betaSnapshotBefore = await withTenantContext(runtimePrisma, BETA_ID, (tx) =>
        tx.student.findUnique({ where: { id: "stg-stu-beta" }, select: { id: true, name: true, schoolId: true } })
      );
      expect(betaSnapshotBefore).toEqual({
        id: "stg-stu-beta",
        name: "Estudante Beta",
        schoolId: BETA_ID,
      });

      // Sob contexto Alpha: 0 linhas de Beta, UPDATE/DELETE em Beta afeta 0, INSERT Beta falha com 42501
      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        expect(await tx.student.findMany({ where: { id: "stg-stu-beta" } })).toEqual([]);
        expect(
          (await tx.student.updateMany({ where: { id: "stg-stu-beta" }, data: { name: "Alterado" } })).count
        ).toBe(0);
        expect((await tx.messageLog.deleteMany({ where: { id: "stg-log-beta" } })).count).toBe(0);
      });

      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."ClassGroup" ("id", "schoolId", "name", "shift", "segment")
            VALUES ('stg-cg-rls-fail', ${BETA_ID}, 'Invasão', 'Manhã', 'FUNDAMENTAL')
          `
        ).rejects.toThrow(/42501|row-level security/i);
      });

      // FKs compostas (23503)
      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."Student" ("id", "schoolId", "classGroupId", "name", "phone", "updatedAt")
            VALUES ('stg-stu-fk-fail', ${ALPHA_ID}, 'stg-cg-beta', 'FK Cruzada', '41999990000', NOW())
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."MessageLog" ("id", "schoolId", "studentId", "templateId", "reasonTitle", "messageContent", "phoneUsed", "sentByName")
            VALUES ('stg-log-fk-fail', ${ALPHA_ID}, 'stg-stu-alpha', 'stg-tpl-beta', 'X', 'Y', '41999990000', 'Equipe')
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      // Snapshot de Beta intacto
      const betaSnapshotAfter = await withTenantContext(runtimePrisma, BETA_ID, (tx) =>
        tx.student.findUnique({ where: { id: "stg-stu-beta" }, select: { id: true, name: true, schoolId: true } })
      );
      expect(betaSnapshotAfter).toEqual(betaSnapshotBefore);

      // ON DELETE SET NULL ("templateId") preservando schoolId
      await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        await tx.messageTemplate.delete({ where: { id: "stg-tpl-alpha-del" } });
        const logAfter = await tx.messageLog.findUnique({
          where: { id: "stg-log-alpha" },
          select: { schoolId: true, templateId: true },
        });
        expect(logAfter).toEqual({ schoolId: ALPHA_ID, templateId: null });
      });
    });

    it("7-11. valida contexto ausente/vazio, alternância A->B->sem contexto após COMMIT e ROLLBACK, pg_backend_pid() e concorrência", async () => {
      // Sem contexto -> 0 linhas e INSERT negado
      expect(await runtimePrisma.classGroup.count()).toBe(0);
      expect(await runtimePrisma.student.count()).toBe(0);
      expect(await runtimePrisma.messageTemplate.count()).toBe(0);
      expect(await runtimePrisma.messageLog.count()).toBe(0);
      await expect(
        runtimePrisma.$executeRaw`
          INSERT INTO public."ClassGroup" ("id", "schoolId", "name", "shift", "segment")
          VALUES ('stg-cg-no-ctx', ${ALPHA_ID}, 'Sem Ctx', 'Manhã', 'FUNDAMENTAL')
        `
      ).rejects.toThrow(/42501|row-level security/i);

      // Alternância A -> B -> sem contexto após COMMIT
      const alphaTx = await withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
        const r = await tx.$queryRaw<Array<{ pid: number; val: string | null }>>`
          SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS val
        `;
        return r[0];
      });
      expect(alphaTx.val).toBe(ALPHA_ID);
      observedPids.add(alphaTx.pid);

      const betaTx = await withTenantContext(runtimePrisma, BETA_ID, async (tx) => {
        const r = await tx.$queryRaw<Array<{ pid: number; val: string | null }>>`
          SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS val
        `;
        return r[0];
      });
      expect(betaTx.val).toBe(BETA_ID);
      observedPids.add(betaTx.pid);

      const afterCommit = await runtimePrisma.$queryRaw<
        Array<{ pid: number; val: string | null; count: bigint }>
      >`
        SELECT pg_backend_pid()::int AS pid,
               NULLIF(current_setting('app.current_school_id', true), '') AS val,
               (SELECT COUNT(*) FROM public."MessageLog") AS count
      `;
      expect(afterCommit[0].val).toBeNull();
      expect(afterCommit[0].count).toBe(0n);

      // Limpeza após ROLLBACK
      await expect(
        withTenantContext(runtimePrisma, ALPHA_ID, async (tx) => {
          const r = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
          observedPids.add(r[0].pid);
          await tx.classGroup.create({
            data: { id: "stg-cg-rollback", schoolId: ALPHA_ID, name: "Rollback", shift: "Tarde", segment: "MEDIO" },
          });
          throw new Error("FORCED_STAGING_ROLLBACK");
        })
      ).rejects.toThrow("FORCED_STAGING_ROLLBACK");

      const afterRollback = await runtimePrisma.$queryRaw<
        Array<{ pid: number; val: string | null; count: bigint }>
      >`
        SELECT pg_backend_pid()::int AS pid,
               NULLIF(current_setting('app.current_school_id', true), '') AS val,
               (SELECT COUNT(*) FROM public."ClassGroup") AS count
      `;
      expect(afterRollback[0].val).toBeNull();
      expect(afterRollback[0].count).toBe(0n);

      if (allowLocalVerify) {
        expect(afterCommit[0].pid).toBe(alphaTx.pid);
        expect(afterRollback[0].pid).toBe(alphaTx.pid);
      }

      // Concorrência intercalada Alpha & Beta
      const parallelResults = await Promise.all(
        Array.from({ length: 8 }, (_, idx) => {
          const target = idx % 2 === 0 ? ALPHA_ID : BETA_ID;
          return withTenantContext(runtimePrisma, target, async (tx) => {
            const rows = await tx.student.findMany({ select: { schoolId: true } });
            return { target, allMatch: rows.every((r) => r.schoolId === target), count: rows.length };
          });
        })
      );
      expect(parallelResults.every((r) => r.allMatch && r.count >= 1)).toBe(true);
    });

    it("12. comprova resolvers pré-escola mínimos da Onda 1 (CGM global e webhook WhatsApp) sob app_runtime + FORCE RLS", async () => {
      // CGM global via SECURITY DEFINER retorna apenas CGM ocupado (sem vazar Beta)
      const takenCgms = new Set<string>();
      await populateGlobalTakenCgms(
        runtimePrisma,
        ["9981000201", "9981999999"],
        takenCgms,
        { useSecDefResolver: true }
      );
      expect(takenCgms.has("9981000201")).toBe(true);
      expect(takenCgms.has("9981999999")).toBe(false);

      // Webhook por logId retorna correlação mínima sem conteúdo
      const byLogId = await runtimePrisma.$queryRaw<
        Array<{ id: string; schoolId: string | null; studentId: string; studentSchoolId: string | null }>
      >`
        SELECT "id", "schoolId", "studentId", "studentSchoolId"
        FROM public.resolve_whatsapp_webhook_by_log_id('stg-log-alpha')
      `;
      expect(byLogId).toEqual([
        {
          id: "stg-log-alpha",
          schoolId: ALPHA_ID,
          studentId: "stg-stu-alpha",
          studentSchoolId: ALPHA_ID,
        },
      ]);

      // Telefone compartilhado entre Alpha e Beta retorna ambas as escolas para descarte por ambiguidade
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const bySharedPhone = await runtimePrisma.$queryRaw<
        Array<{ id: string; studentSchoolId: string | null }>
      >`
        SELECT "id", "studentSchoolId"
        FROM public.resolve_whatsapp_webhook_by_phone('41999998101', ${cutoff}, NULL, NULL)
      `;
      const distinctSchools = new Set(bySharedPhone.map((r) => r.studentSchoolId).filter(Boolean));
      expect(distinctSchools.has(ALPHA_ID)).toBe(true);
      expect(distinctSchools.has(BETA_ID)).toBe(true);
    });
  }
);
