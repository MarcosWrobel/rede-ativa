import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  materializePilotGlobalTemplatesForPhaseB,
  reconcileMessageLogSchoolId,
  runRlsWave1Preflight,
} from "@/lib/rlsWave1Preflight";
import { withTenantContext } from "@/lib/rlsTenantContext";

const SHOULD_RUN = process.env.RUN_RLS_WAVE1_PHASE_B_TEST === "true";

function assertSafeLocalPhaseBDbUrl(rawUrl: string | undefined, label: string): string {
  if (!rawUrl) {
    throw new Error(`${label} é obrigatório quando RUN_RLS_WAVE1_PHASE_B_TEST=true.`);
  }
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const isSynthetic = dbName.includes("rls_wave1_phase_b_test");
  if (!isLoopback || !isSynthetic) {
    throw new Error(
      `${label} recusada por segurança: exige host loopback e banco sintético 'rls_wave1_phase_b_test'.`
    );
  }
  return rawUrl;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "$" && sql[i + 1] === "$") {
      inDollar = !inDollar;
      current += "$$";
      i++;
      continue;
    }
    if (sql[i] === ";" && !inDollar) {
      const trimmed = current.trim();
      if (trimmed && !trimmed.split("\n").every((l) => !l.trim() || l.trim().startsWith("--"))) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += sql[i];
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function executeSqlStatementsInTx(
  client: PrismaClient,
  statements: string[]
): Promise<void> {
  await client.$transaction(async (tx) => {
    for (const stmt of statements) {
      await tx.$executeRawUnsafe(stmt);
    }
  });
}

describe.skipIf(!SHOULD_RUN)(
  "Onda 1 RLS — Migração Candidata da Fase B (ClassGroup, Student, MessageTemplate, MessageLog)",
  () => {
    let adminPrisma: PrismaClient;
    let migratorPrisma: PrismaClient;
    let runtimePrisma: PrismaClient;
    let phaseBStatements: string[];

    beforeAll(async () => {
      const adminUrl = assertSafeLocalPhaseBDbUrl(
        process.env.RLS_WAVE1_PHASE_B_ADMIN_URL,
        "RLS_WAVE1_PHASE_B_ADMIN_URL"
      );
      adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      await adminPrisma.$connect();

      const rolesSql = fs.readFileSync(
        path.resolve(process.cwd(), "lab/rls-pilot/wave1_phase_b_roles_setup.sql"),
        "utf8"
      );
      for (const stmt of splitSqlStatements(rolesSql)) {
        await adminPrisma.$executeRawUnsafe(stmt);
      }

      const phaseBSql = fs.readFileSync(
        path.resolve(process.cwd(), "lab/rls-pilot/wave1_phase_b_candidate.sql"),
        "utf8"
      );
      phaseBStatements = splitSqlStatements(phaseBSql);

      const baseParsed = new URL(adminUrl);
      const migratorUrl = new URL(baseParsed.toString());
      migratorUrl.username = "app_migrator";
      migratorUrl.password = "rls_lab_migrator_pass";

      const runtimeUrl = new URL(baseParsed.toString());
      runtimeUrl.username = "app_runtime";
      runtimeUrl.password = "rls_lab_runtime_pass";
      runtimeUrl.searchParams.set("connection_limit", "1");

      migratorPrisma = new PrismaClient({ datasources: { db: { url: migratorUrl.toString() } } });
      runtimePrisma = new PrismaClient({ datasources: { db: { url: runtimeUrl.toString() } } });
      await migratorPrisma.$connect();
      await runtimePrisma.$connect();
    });

    afterAll(async () => {
      await runtimePrisma?.$disconnect().catch(() => {});
      await migratorPrisma?.$disconnect().catch(() => {});
      await adminPrisma?.$disconnect().catch(() => {});
    });

    it("bloqueia Fase B em divergências sem alterações parciais, reconcilia legado/piloto, aplica migração com app_migrator e comprova isolamento/FKs/limpeza com app_runtime", async () => {
      await adminPrisma.messageLog.deleteMany({
        where: { id: { startsWith: "pb-log-" } },
      });
      await adminPrisma.messageTemplate.deleteMany({
        where: { id: { startsWith: "pb-tpl-" } },
      });
      await adminPrisma.student.deleteMany({
        where: { id: { startsWith: "pb-stu-" } },
      });
      await adminPrisma.classGroup.deleteMany({
        where: { id: { startsWith: "pb-cg-" } },
      });
      // 1. Carga sintética da Fase A (Piloto + duas escolas sintéticas + legado + violação cruzada)
      await migratorPrisma.school.createMany({
        data: [
          { id: "default-leopoldina", name: "Escola Piloto", inepCode: "41042730", active: true },
          { id: "phaseb-alpha", name: "Escola Alpha B", inepCode: "99150101", active: true },
          { id: "phaseb-beta", name: "Escola Beta B", inepCode: "99150102", active: true },
        ],
        skipDuplicates: true,
      });

      await migratorPrisma.classGroup.createMany({
        data: [
          { id: "pb-cg-pilot", schoolId: "default-leopoldina", name: "6º Ano Piloto", shift: "Manhã", segment: "FUNDAMENTAL" },
          { id: "pb-cg-alpha", schoolId: "phaseb-alpha", name: "6º Ano A", shift: "Manhã", segment: "FUNDAMENTAL" },
          { id: "pb-cg-beta", schoolId: "phaseb-beta", name: "6º Ano A", shift: "Manhã", segment: "FUNDAMENTAL" },
        ],
      });

      await migratorPrisma.student.createMany({
        data: [
          { id: "pb-stu-pilot", schoolId: "default-leopoldina", classGroupId: "pb-cg-pilot", name: "Aluno Piloto", phone: "41999991600", active: true },
          { id: "pb-stu-alpha", schoolId: "phaseb-alpha", classGroupId: "pb-cg-alpha", name: "Aluno Alpha", phone: "41999991601", active: true },
          { id: "pb-stu-beta", schoolId: "phaseb-beta", classGroupId: "pb-cg-beta", name: "Aluno Beta", phone: "41999991602", active: true },
          // Violação cruzada proposital: Student(Alpha) -> ClassGroup(Beta)
          { id: "pb-stu-cross", schoolId: "phaseb-alpha", classGroupId: "pb-cg-beta", name: "Aluno Cruzado", phone: "41999991609", active: true },
        ],
      });

      await migratorPrisma.$executeRawUnsafe(
        `ALTER TABLE public."MessageTemplate" ALTER COLUMN "schoolId" DROP NOT NULL`
      );
      await migratorPrisma.$executeRaw`
        INSERT INTO public."MessageTemplate" ("id", "schoolId", "title", "prefixText", "suffixText")
        VALUES ('pb-tpl-pilot-global', NULL, 'Modelo Global Legado', 'Olá ', '!')
      `;
      await migratorPrisma.messageTemplate.createMany({
        data: [
          { id: "pb-tpl-alpha-del", schoolId: "phaseb-alpha", title: "Modelo Alpha Excluir", prefixText: "Aviso ", suffixText: " Alpha" },
          { id: "pb-tpl-alpha-keep", schoolId: "phaseb-alpha", title: "Modelo Alpha Manter", prefixText: "Aviso ", suffixText: " Alpha 2" },
          { id: "pb-tpl-beta", schoolId: "phaseb-beta", title: "Modelo Beta", prefixText: "Aviso ", suffixText: " Beta" },
        ],
      });

      await migratorPrisma.messageLog.createMany({
        data: [
          {
            id: "pb-log-pilot-global",
            schoolId: null,
            studentId: "pb-stu-pilot",
            templateId: "pb-tpl-pilot-global",
            reasonTitle: "Aviso",
            messageContent: "Log piloto legado com modelo global",
            phoneUsed: "41999991600",
            sentByName: "Equipe Piloto",
          },
          {
            id: "pb-log-alpha-null-tpl",
            schoolId: null,
            studentId: "pb-stu-alpha",
            templateId: null,
            reasonTitle: "Sem modelo",
            messageContent: "Log Alpha sem modelo",
            phoneUsed: "41999991601",
            sentByName: "Equipe Alpha",
          },
          {
            id: "pb-log-alpha-del-tpl",
            schoolId: "phaseb-alpha",
            studentId: "pb-stu-alpha",
            templateId: "pb-tpl-alpha-del",
            reasonTitle: "Com modelo",
            messageContent: "Log Alpha para testar ON DELETE SET NULL",
            phoneUsed: "41999991601",
            sentByName: "Equipe Alpha",
          },
          {
            id: "pb-log-beta",
            schoolId: "phaseb-beta",
            studentId: "pb-stu-beta",
            templateId: "pb-tpl-beta",
            reasonTitle: "Beta",
            messageContent: "Log Beta",
            phoneUsed: "41999991602",
            sentByName: "Equipe Beta",
          },
          // Violação cruzada proposital: MessageLog(Alpha) -> template(Beta)
          {
            id: "pb-log-cross-tpl",
            schoolId: "phaseb-alpha",
            studentId: "pb-stu-alpha",
            templateId: "pb-tpl-beta",
            reasonTitle: "Cruzado",
            messageContent: "Log com modelo de outra escola",
            phoneUsed: "41999991601",
            sentByName: "Equipe Alpha",
          },
        ],
      });

      // 2. Preflight detecta bloqueios e migração falha atomicamente sem alterações parciais
      const blockedReport = await runRlsWave1Preflight(migratorPrisma);
      expect(blockedReport.readyForPhaseB).toBe(false);
      expect(blockedReport.findings.studentsWithCrossSchoolClassGroup.count).toBe(1);
      expect(blockedReport.findings.logsWithCrossSchoolTemplate.count).toBe(2); // pb-log-pilot-global + pb-log-cross-tpl
      expect(blockedReport.findings.logsMissingSchoolId.count).toBe(2);

      await expect(executeSqlStatementsInTx(migratorPrisma, phaseBStatements)).rejects.toThrow(
        /PREFLIGHT_BLOCKED_PHASE_B/
      );

      // Estado pós-falha: MessageLog.schoolId continua nullable, RLS desligado, violação ainda visível
      const colAfterFail = await migratorPrisma.$queryRaw<Array<{ is_nullable: string }>>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'MessageLog' AND column_name = 'schoolId'
      `;
      expect(colAfterFail[0].is_nullable).toBe("YES");
      const rlsAfterFail = await migratorPrisma.$queryRaw<
        Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
      >`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'MessageLog'
      `;
      expect(rlsAfterFail[0]).toEqual({ relrowsecurity: false, relforcerowsecurity: false });
      const stillVisibleReport = await runRlsWave1Preflight(migratorPrisma);
      expect(stillVisibleReport.findings.studentsWithCrossSchoolClassGroup.sampleIds).toEqual(["pb-stu-cross"]);

      // 3. Correção das violações cruzadas + reconciliação de nulos + materialização do modelo global da Piloto
      await migratorPrisma.messageLog.deleteMany({ where: { id: "pb-log-cross-tpl" } });
      await migratorPrisma.student.deleteMany({ where: { id: "pb-stu-cross" } });

      const recResult = await reconcileMessageLogSchoolId(migratorPrisma);
      expect(recResult.updatedCount).toBe(2);

      const matResult = await materializePilotGlobalTemplatesForPhaseB(migratorPrisma);
      expect(matResult.materializedCount).toBe(1);

      const pilotTplAfter = await migratorPrisma.messageTemplate.findUnique({
        where: { id: "pb-tpl-pilot-global" },
        select: { schoolId: true },
      });
      expect(pilotTplAfter?.schoolId).toBe("default-leopoldina");

      const readyReport = await runRlsWave1Preflight(migratorPrisma);
      expect(readyReport.readyForPhaseB).toBe(true);
      expect(readyReport.logsWithNullTemplateCount).toBe(1);

      // 4. Aplicação da migração candidata da Fase B via app_migrator
      await executeSqlStatementsInTx(migratorPrisma, phaseBStatements);

      const colAfterPhaseB = await migratorPrisma.$queryRaw<Array<{ is_nullable: string }>>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'MessageLog' AND column_name = 'schoolId'
      `;
      expect(colAfterPhaseB[0].is_nullable).toBe("NO");

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

      const roleCheck = await adminPrisma.$queryRaw<
        Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
      >`
        SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime'
      `;
      expect(roleCheck).toEqual([{ rolname: "app_runtime", rolsuper: false, rolbypassrls: false }]);

      const ownersCheck = await adminPrisma.$queryRaw<Array<{ tablename: string; tableowner: string }>>`
        SELECT tablename, tableowner FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('ClassGroup', 'Student', 'MessageTemplate', 'MessageLog')
      `;
      expect(ownersCheck.every((o) => o.tableowner === "app_migrator")).toBe(true);

      // 5. Compatibilidade de escritores com NOT NULL (como scripts/seed.cjs com schoolId e templateId null)
      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        const seeded = await tx.messageLog.create({
          data: {
            id: "pb-log-seeded-null-tpl",
            schoolId: "phaseb-alpha",
            studentId: "pb-stu-alpha",
            templateId: null,
            reasonTitle: "Seed",
            messageContent: "Seed com schoolId explícito e templateId null",
            phoneUsed: "41999991601",
            sentByName: "Seed CJS",
          },
        });
        expect(seeded.schoolId).toBe("phaseb-alpha");
        expect(seeded.templateId).toBeNull();
      });

      await expect(
        adminPrisma.$executeRaw`
          INSERT INTO public."MessageLog" ("id", "studentId", "reasonTitle", "messageContent", "phoneUsed", "sentByName")
          VALUES ('pb-log-no-school', 'pb-stu-alpha', 'Erro', 'Sem schoolId', '41999991601', 'Equipe Teste')
        `
      ).rejects.toThrow(/23502|null value in column "schoolId"/i);

      // 6. Exclusão de MessageTemplate em Alpha coloca apenas templateId = NULL preservando schoolId no log
      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await tx.messageTemplate.delete({ where: { id: "pb-tpl-alpha-del" } });
        const logAfterDel = await tx.messageLog.findUnique({
          where: { id: "pb-log-alpha-del-tpl" },
          select: { schoolId: true, templateId: true },
        });
        expect(logAfterDel).toEqual({ schoolId: "phaseb-alpha", templateId: null });
      });

      // 7. Isolamento RLS com app_runtime vs violações das FKs compostas (42501 vs 23503)
      // Sem contexto -> 0 linhas e INSERT negado por RLS (42501)
      expect(await runtimePrisma.classGroup.count()).toBe(0);
      expect(await runtimePrisma.student.count()).toBe(0);
      expect(await runtimePrisma.messageTemplate.count()).toBe(0);
      expect(await runtimePrisma.messageLog.count()).toBe(0);
      await expect(
        runtimePrisma.$executeRaw`
          INSERT INTO public."MessageLog" ("id", "schoolId", "studentId", "reasonTitle", "messageContent", "phoneUsed", "sentByName")
          VALUES ('pb-log-no-ctx', 'phaseb-alpha', 'pb-stu-alpha', 'X', 'Y', '41999991601', 'Equipe Teste')
        `
      ).rejects.toThrow(/42501|row-level security/i);

      // Sob contexto Alpha: enxerga só Alpha, bloqueia INSERT de Beta por RLS (42501) e vínculo cruzado por FK composta (23503)
      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        const visibleLogs = await tx.messageLog.findMany({ select: { id: true, schoolId: true } });
        expect(visibleLogs.every((l) => l.schoolId === "phaseb-alpha")).toBe(true);
        expect(visibleLogs.some((l) => l.id === "pb-log-beta")).toBe(false);

        const updBeta = await tx.student.updateMany({
          where: { id: "pb-stu-beta" },
          data: { name: "Tentativa Beta" },
        });
        expect(updBeta.count).toBe(0);

      });

      // Violação RLS WITH CHECK (42501)
      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."ClassGroup" ("id", "schoolId", "name", "shift", "segment")
            VALUES ('pb-cg-rls-fail', 'phaseb-beta', 'Invasao', 'Manhã', 'FUNDAMENTAL')
          `
        ).rejects.toThrow(/42501|row-level security/i);
      });

      // Violação FK composta Student_schoolId_classGroupId_fkey (23503)
      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."Student" ("id", "schoolId", "classGroupId", "name", "phone", "updatedAt")
            VALUES ('pb-stu-fk-fail', 'phaseb-alpha', 'pb-cg-beta', 'FK Cruzada', '41999991601', NOW())
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      // Violação FK composta MessageLog_schoolId_templateId_fkey (23503)
      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."MessageLog" ("id", "schoolId", "studentId", "templateId", "reasonTitle", "messageContent", "phoneUsed", "sentByName")
            VALUES ('pb-log-fk-fail', 'phaseb-alpha', 'pb-stu-alpha', 'pb-tpl-beta', 'X', 'Y', '41999991601', 'Equipe Teste')
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      // 8. Limpeza de app.current_school_id após COMMIT e ROLLBACK na mesma conexão física
      const commitInfo = await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        const r = await tx.$queryRaw<Array<{ pid: number; val: string | null }>>`
          SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS val
        `;
        return r[0];
      });
      expect(commitInfo.val).toBe("phaseb-alpha");

      const afterCommit = await runtimePrisma.$queryRaw<
        Array<{ pid: number; val: string | null; count: bigint }>
      >`
        SELECT pg_backend_pid()::int AS pid,
               NULLIF(current_setting('app.current_school_id', true), '') AS val,
               (SELECT COUNT(*) FROM public."MessageLog") AS count
      `;
      expect(afterCommit[0]).toEqual({ pid: commitInfo.pid, val: null, count: 0n });

      let rollbackPid = -1;
      await expect(
        withTenantContext(runtimePrisma, "phaseb-beta", async (tx) => {
          const r = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
          rollbackPid = r[0].pid;
          await tx.classGroup.create({
            data: { id: "pb-cg-rollback", schoolId: "phaseb-beta", name: "Rollback", shift: "Tarde", segment: "MEDIO" },
          });
          throw new Error("FORCED_PHASEB_ROLLBACK");
        })
      ).rejects.toThrow("FORCED_PHASEB_ROLLBACK");

      const afterRollback = await runtimePrisma.$queryRaw<
        Array<{ pid: number; val: string | null; count: bigint }>
      >`
        SELECT pg_backend_pid()::int AS pid,
               NULLIF(current_setting('app.current_school_id', true), '') AS val,
               (SELECT COUNT(*) FROM public."ClassGroup") AS count
      `;
      expect(rollbackPid).toBe(commitInfo.pid);
      expect(afterRollback[0]).toEqual({ pid: commitInfo.pid, val: null, count: 0n });
      expect(
        await adminPrisma.classGroup.findUnique({ where: { id: "pb-cg-rollback" } })
      ).toBeNull();
    });

    it("valida instalação limpa (banco vazio pós-Fase A) aplicando Fase B com preflight limpo e operação via app_runtime", async () => {
      const cleanParsed = new URL(
        assertSafeLocalPhaseBDbUrl(
          process.env.RLS_WAVE1_PHASE_B_ADMIN_URL,
          "RLS_WAVE1_PHASE_B_ADMIN_URL"
        )
      );
      cleanParsed.pathname = "/rls_wave1_phase_b_clean_test";

      const cleanAdmin = new PrismaClient({ datasources: { db: { url: cleanParsed.toString() } } });
      await cleanAdmin.$connect();
      try {
        const rolesSql = fs.readFileSync(
          path.resolve(process.cwd(), "lab/rls-pilot/wave1_phase_b_roles_setup.sql"),
          "utf8"
        );
        for (const stmt of splitSqlStatements(rolesSql)) {
          await cleanAdmin.$executeRawUnsafe(stmt);
        }

        const migratorCleanUrl = new URL(cleanParsed.toString());
        migratorCleanUrl.username = "app_migrator";
        migratorCleanUrl.password = "rls_lab_migrator_pass";
        const runtimeCleanUrl = new URL(cleanParsed.toString());
        runtimeCleanUrl.username = "app_runtime";
        runtimeCleanUrl.password = "rls_lab_runtime_pass";
        runtimeCleanUrl.searchParams.set("connection_limit", "1");

        const cleanMigrator = new PrismaClient({
          datasources: { db: { url: migratorCleanUrl.toString() } },
        });
        const cleanRuntime = new PrismaClient({
          datasources: { db: { url: runtimeCleanUrl.toString() } },
        });
        await cleanMigrator.$connect();
        await cleanRuntime.$connect();

        try {
          const cleanPreflight = await runRlsWave1Preflight(cleanMigrator);
          expect(cleanPreflight.readyForPhaseB).toBe(true);
          expect(cleanPreflight.totalMessageLogs).toBe(0);

          await executeSqlStatementsInTx(cleanMigrator, phaseBStatements);

          await cleanMigrator.school.upsert({
            where: { id: "pb-clean-school" },
            create: { id: "pb-clean-school", name: "Escola Limpa", inepCode: "99150999", active: true },
            update: { name: "Escola Limpa", active: true },
          });

          await withTenantContext(cleanRuntime, "pb-clean-school", async (tx) => {
            await tx.messageLog.deleteMany({ where: { id: "pb-clean-log" } });
            await tx.student.deleteMany({ where: { id: "pb-clean-stu" } });
            await tx.classGroup.deleteMany({ where: { id: "pb-clean-cg" } });
            await tx.classGroup.create({
              data: { id: "pb-clean-cg", schoolId: "pb-clean-school", name: "1º Ano A", shift: "Manhã", segment: "MEDIO" },
            });
            await tx.student.create({
              data: { id: "pb-clean-stu", schoolId: "pb-clean-school", classGroupId: "pb-clean-cg", name: "Aluno Limpo", phone: "41999991999" },
            });
            const log = await tx.messageLog.create({
              data: {
                id: "pb-clean-log",
                schoolId: "pb-clean-school",
                studentId: "pb-clean-stu",
                templateId: null,
                reasonTitle: "Limpo",
                messageContent: "Instalação limpa",
                phoneUsed: "41999991999",
                sentByName: "Equipe Limpa",
              },
            });
            expect(log.schoolId).toBe("pb-clean-school");
          });
        } finally {
          await cleanRuntime.$disconnect().catch(() => {});
          await cleanMigrator.$disconnect().catch(() => {});
        }
      } finally {
        await cleanAdmin.$disconnect().catch(() => {});
      }
    });
  }
);
