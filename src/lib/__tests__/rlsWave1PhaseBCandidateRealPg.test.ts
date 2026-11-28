import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import {
  materializePilotGlobalTemplatesForPhaseB,
  reconcileMessageLogSchoolId,
  runRlsWave1Preflight,
} from "@/lib/rlsWave1Preflight";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  applyWave1PhaseBCandidateInSingleTx,
  splitSqlStatements,
} from "../../../lab/rls-pilot/apply_wave1_phase_b_candidate.mjs";

const require = createRequire(import.meta.url);
const { runSeed } = require("../../../scripts/seed.cjs") as {
  runSeed: (options?: {
    prismaClient?: PrismaClient;
    schoolId?: string;
    inepCode?: string;
    dataPath?: string;
    replaceSchoolLogs?: boolean;
    bootstrapPilotIfMissing?: boolean;
  }) => Promise<{
    schoolId: string;
    earlyExit: boolean;
    classGroupsCount: number;
    templatesCount: number;
    studentsCount: number;
    logsCount: number;
    lowAttendanceCount: number;
  }>;
};

const SHOULD_RUN = process.env.RUN_RLS_WAVE1_PHASE_B_TEST === "true";

function assertSafeLocalPhaseBDbUrl(rawUrl: string | undefined, label: string): string {
  if (!rawUrl) {
    throw new Error(`${label} é obrigatório quando RUN_RLS_WAVE1_PHASE_B_TEST=true.`);
  }
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const isSynthetic = dbName.includes("rls_wave1_phase_b_test") || dbName.includes("rls_wave1_phase_b_clean_test");
  if (!isLoopback || !isSynthetic) {
    throw new Error(
      `${label} recusada por segurança: exige host loopback e banco sintético 'rls_wave1_phase_b_test'.`
    );
  }
  return rawUrl;
}

async function provisionLabRolesWithEphemeralPasswords(
  adminPrisma: PrismaClient,
  adminUrl: string
): Promise<{ migratorUrl: string; runtimeUrl: string }> {
  const rolesSqlTemplate = fs.readFileSync(
    path.resolve(process.cwd(), "lab/rls-pilot/wave1_phase_b_roles_setup.sql"),
    "utf8"
  );
  const migratorPassword = crypto.randomBytes(24).toString("hex");
  const runtimePassword = crypto.randomBytes(24).toString("hex");

  const rolesSql = rolesSqlTemplate
    .replaceAll("__APP_MIGRATOR_PASSWORD__", migratorPassword)
    .replaceAll("__APP_RUNTIME_PASSWORD__", runtimePassword);

  for (const stmt of splitSqlStatements(rolesSql)) {
    await adminPrisma.$executeRawUnsafe(stmt);
  }

  const baseParsed = new URL(adminUrl);
  const migratorUrl = new URL(baseParsed.toString());
  migratorUrl.username = "app_migrator";
  migratorUrl.password = migratorPassword;

  const runtimeUrl = new URL(baseParsed.toString());
  runtimeUrl.username = "app_runtime";
  runtimeUrl.password = runtimePassword;
  runtimeUrl.searchParams.set("connection_limit", "1");

  return {
    migratorUrl: migratorUrl.toString(),
    runtimeUrl: runtimeUrl.toString(),
  };
}

async function captureCatalogSnapshot(adminPrisma: PrismaClient) {
  const [columns, indexes, constraints, rlsFlags, grants, policies] = await Promise.all([
    adminPrisma.$queryRaw<Array<{ table_name: string; column_name: string; is_nullable: string }>>`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'MessageTemplate' AND column_name = 'schoolId')
          OR (table_name = 'MessageLog' AND column_name = 'schoolId')
        )
      ORDER BY table_name ASC, column_name ASC
    `,
    adminPrisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'MessageLog_schoolId_sentAt_idx'
      ORDER BY indexname ASC
    `,
    adminPrisma.$queryRaw<Array<{ conname: string; contype: string }>>`
      SELECT conname, contype::text AS contype
      FROM pg_constraint
      WHERE conname IN (
        'ClassGroup_schoolId_id_key',
        'Student_schoolId_id_key',
        'MessageTemplate_schoolId_id_key',
        'Student_schoolId_classGroupId_fkey',
        'MessageLog_schoolId_studentId_fkey',
        'MessageLog_schoolId_templateId_fkey'
      )
      ORDER BY conname ASC
    `,
    adminPrisma.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('ClassGroup', 'Student', 'MessageTemplate', 'MessageLog')
      ORDER BY relname ASC
    `,
    adminPrisma.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_runtime'
        AND table_schema = 'public'
        AND table_name IN ('School', 'ClassGroup', 'Student', 'MessageTemplate', 'MessageLog')
      ORDER BY table_name ASC, privilege_type ASC
    `,
    adminPrisma.$queryRaw<Array<{ tablename: string; policyname: string }>>`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('ClassGroup', 'Student', 'MessageTemplate', 'MessageLog')
      ORDER BY tablename ASC, policyname ASC
    `,
  ]);

  return { columns, indexes, constraints, rlsFlags, grants, policies };
}

describe.skipIf(!SHOULD_RUN)(
  "Onda 1 RLS — Migração Candidata da Fase B (ClassGroup, Student, MessageTemplate, MessageLog)",
  () => {
    let adminPrisma: PrismaClient;
    let migratorPrisma: PrismaClient;
    let runtimePrisma: PrismaClient;

    beforeAll(async () => {
      const adminUrl = assertSafeLocalPhaseBDbUrl(
        process.env.RLS_WAVE1_PHASE_B_ADMIN_URL,
        "RLS_WAVE1_PHASE_B_ADMIN_URL"
      );
      adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      await adminPrisma.$connect();

      const { migratorUrl, runtimeUrl } = await provisionLabRolesWithEphemeralPasswords(
        adminPrisma,
        adminUrl
      );

      migratorPrisma = new PrismaClient({ datasources: { db: { url: migratorUrl } } });
      runtimePrisma = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
      await migratorPrisma.$connect();
      await runtimePrisma.$connect();
    });

    afterAll(async () => {
      await runtimePrisma?.$disconnect().catch(() => {});
      await migratorPrisma?.$disconnect().catch(() => {});
      await adminPrisma?.$disconnect().catch(() => {});
    });

    it("valida preflight, materialização seletiva, rollback transacional completo, identidade de app_runtime, isolamento/FKs, seed.cjs e limpeza", async () => {
      await adminPrisma.messageLog.deleteMany({ where: { id: { startsWith: "pb-log-" } } });
      await adminPrisma.messageTemplate.deleteMany({ where: { id: { startsWith: "pb-tpl-" } } });
      await adminPrisma.student.deleteMany({ where: { id: { startsWith: "pb-stu-" } } });
      await adminPrisma.classGroup.deleteMany({ where: { id: { startsWith: "pb-cg-" } } });

      // Garante que script de roles recusa execução literal sem injeção efêmera
      const rawRolesSql = fs.readFileSync(
        path.resolve(process.cwd(), "lab/rls-pilot/wave1_phase_b_roles_setup.sql"),
        "utf8"
      );
      await expect(
        adminPrisma.$executeRawUnsafe(splitSqlStatements(rawRolesSql)[0])
      ).rejects.toThrow(/ROLE_SETUP_ERROR/);

      // 1. Carga sintética da Fase A (Piloto + Alpha + Beta + todos os cenários de modelo global)
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
          { id: "pb-stu-cross", schoolId: "phaseb-alpha", classGroupId: "pb-cg-beta", name: "Aluno Cruzado", phone: "41999991609", active: true },
        ],
      });

      await migratorPrisma.$executeRawUnsafe(
        `ALTER TABLE public."MessageTemplate" ALTER COLUMN "schoolId" DROP NOT NULL`
      );
      await migratorPrisma.$executeRaw`
        INSERT INTO public."MessageTemplate" ("id", "schoolId", "title", "prefixText", "suffixText")
        VALUES
          ('pb-tpl-pilot-global', NULL, 'Modelo Exclusivo Piloto', 'Olá ', '!'),
          ('pb-tpl-unused-global', NULL, 'Modelo Global Sem Uso', 'Aviso ', '!'),
          ('pb-tpl-cross-global', NULL, 'Modelo Global Cruzado', 'Aviso ', '!'),
          ('pb-tpl-divergent-global', NULL, 'Modelo Global Divergente', 'Aviso ', '!')
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
            messageContent: "Log piloto legado com modelo exclusivo",
            phoneUsed: "41999991600",
            sentByName: "Equipe Piloto",
          },
          {
            id: "pb-log-cross-global-beta",
            schoolId: "phaseb-beta",
            studentId: "pb-stu-beta",
            templateId: "pb-tpl-cross-global",
            reasonTitle: "Cruzado",
            messageContent: "Log beta usando modelo global",
            phoneUsed: "41999991602",
            sentByName: "Equipe Beta",
          },
          {
            id: "pb-log-divergent-global",
            schoolId: "phaseb-beta",
            studentId: "pb-stu-pilot",
            templateId: "pb-tpl-divergent-global",
            reasonTitle: "Divergente",
            messageContent: "Log com schoolId Beta apontando para aluno da Piloto",
            phoneUsed: "41999991600",
            sentByName: "Equipe Divergente",
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

      // 2. Preflight detecta templatesMissingSchoolId (inclusive sem uso) + divergências; bloqueio SQL preserva catálogo
      const snapshotBeforePrecondition = await captureCatalogSnapshot(adminPrisma);
      const blockedReport = await runRlsWave1Preflight(migratorPrisma);
      expect(blockedReport.readyForPhaseB).toBe(false);
      expect(blockedReport.findings.templatesMissingSchoolId.count).toBe(4);
      expect(blockedReport.findings.logsDivergentSchoolId.count).toBe(1);
      expect(blockedReport.findings.studentsWithCrossSchoolClassGroup.count).toBe(1);
      expect(blockedReport.findings.logsMissingSchoolId.count).toBe(2);

      await expect(applyWave1PhaseBCandidateInSingleTx(migratorPrisma)).rejects.toThrow(
        /PREFLIGHT_BLOCKED_PHASE_B/
      );
      expect(await captureCatalogSnapshot(adminPrisma)).toEqual(snapshotBeforePrecondition);

      // 3. Materialização seletiva: apenas modelo exclusivo da piloto é materializado; 2ª execução = 0
      const mat1 = await materializePilotGlobalTemplatesForPhaseB(migratorPrisma);
      expect(mat1.materializedCount).toBe(1);
      const mat2 = await materializePilotGlobalTemplatesForPhaseB(migratorPrisma);
      expect(mat2.materializedCount).toBe(0);

      const tplRowsAfterMat = await migratorPrisma.$queryRaw<
        Array<{ id: string; schoolId: string | null }>
      >`
        SELECT "id", "schoolId"
        FROM public."MessageTemplate"
        WHERE "id" IN (
          'pb-tpl-pilot-global',
          'pb-tpl-unused-global',
          'pb-tpl-cross-global',
          'pb-tpl-divergent-global'
        )
      `;
      const tplById = Object.fromEntries(tplRowsAfterMat.map((r) => [r.id, r.schoolId]));
      expect(tplById["pb-tpl-pilot-global"]).toBe("default-leopoldina");
      expect(tplById["pb-tpl-unused-global"]).toBeNull();
      expect(tplById["pb-tpl-cross-global"]).toBeNull();
      expect(tplById["pb-tpl-divergent-global"]).toBeNull();

      // Enquanto restarem modelos sem uso / cruzado / divergente, preflight TS e SQL bloqueiam
      const pendingGlobalReport = await runRlsWave1Preflight(migratorPrisma);
      expect(pendingGlobalReport.readyForPhaseB).toBe(false);
      expect(pendingGlobalReport.findings.templatesMissingSchoolId.count).toBe(3);
      await expect(applyWave1PhaseBCandidateInSingleTx(migratorPrisma)).rejects.toThrow(
        /PREFLIGHT_BLOCKED_PHASE_B.*MessageTemplate/
      );

      // 4. Tratamento explícito das pendências + reconciliação de nulos
      await migratorPrisma.messageLog.deleteMany({
        where: {
          id: { in: ["pb-log-cross-tpl", "pb-log-cross-global-beta", "pb-log-divergent-global"] },
        },
      });
      await migratorPrisma.$executeRaw`
        DELETE FROM public."MessageTemplate"
        WHERE "id" IN ('pb-tpl-unused-global', 'pb-tpl-cross-global', 'pb-tpl-divergent-global')
      `;
      await migratorPrisma.student.deleteMany({ where: { id: "pb-stu-cross" } });

      const recResult = await reconcileMessageLogSchoolId(migratorPrisma);
      expect(recResult.updatedCount).toBe(2);

      const readyReport = await runRlsWave1Preflight(migratorPrisma);
      expect(readyReport.readyForPhaseB).toBe(true);
      expect(readyReport.logsWithNullTemplateCount).toBe(1);

      // 5. Falha controlada após DDL bem-sucedido reverte toda a transação (catálogo idêntico)
      const snapshotBeforeRollback = await captureCatalogSnapshot(adminPrisma);
      await expect(
        applyWave1PhaseBCandidateInSingleTx(migratorPrisma, {
          onAfterStatement: ({ statement }) => {
            if (statement.includes('ALTER TABLE public."MessageLog"') && statement.includes("SET NOT NULL")) {
              throw new Error("INJECTED_MID_TX_FAILURE");
            }
          },
        })
      ).rejects.toThrow("INJECTED_MID_TX_FAILURE");
      expect(await captureCatalogSnapshot(adminPrisma)).toEqual(snapshotBeforeRollback);

      // 6. Aplicação transacional completa com o mesmo executor do roteiro
      await applyWave1PhaseBCandidateInSingleTx(migratorPrisma);
      const snapshotAfterPhaseB = await captureCatalogSnapshot(adminPrisma);

      expect(snapshotAfterPhaseB.columns).toEqual([
        { table_name: "MessageLog", column_name: "schoolId", is_nullable: "NO" },
        { table_name: "MessageTemplate", column_name: "schoolId", is_nullable: "NO" },
      ]);
      expect(snapshotAfterPhaseB.indexes).toEqual([{ indexname: "MessageLog_schoolId_sentAt_idx" }]);
      expect(snapshotAfterPhaseB.constraints).toEqual([
        { conname: "ClassGroup_schoolId_id_key", contype: "u" },
        { conname: "MessageLog_schoolId_studentId_fkey", contype: "f" },
        { conname: "MessageLog_schoolId_templateId_fkey", contype: "f" },
        { conname: "MessageTemplate_schoolId_id_key", contype: "u" },
        { conname: "Student_schoolId_classGroupId_fkey", contype: "f" },
        { conname: "Student_schoolId_id_key", contype: "u" },
      ]);
      expect(snapshotAfterPhaseB.rlsFlags).toEqual([
        { relname: "ClassGroup", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "MessageLog", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "MessageTemplate", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "Student", relrowsecurity: true, relforcerowsecurity: true },
      ]);

      // 7. Identidade efetiva de app_runtime (sem superuser, BYPASSRLS, posse ou SET ROLE app_migrator)
      const runtimeIdentity = await runtimePrisma.$queryRaw<
        Array<{ current_user: string; session_user: string }>
      >`SELECT current_user, session_user`;
      expect(runtimeIdentity[0]).toEqual({ current_user: "app_runtime", session_user: "app_runtime" });

      const roleAttrs = await adminPrisma.$queryRaw<
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
      expect(roleAttrs).toEqual([
        {
          rolname: "app_runtime",
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
        },
      ]);

      const ownersCheck = await adminPrisma.$queryRaw<Array<{ tablename: string; tableowner: string }>>`
        SELECT tablename, tableowner FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('School', 'ClassGroup', 'Student', 'MessageTemplate', 'MessageLog')
      `;
      expect(ownersCheck.every((o) => o.tableowner === "app_migrator")).toBe(true);
      expect(ownersCheck.some((o) => o.tableowner === "app_runtime")).toBe(false);

      await expect(runtimePrisma.$executeRawUnsafe(`SET ROLE app_migrator`)).rejects.toThrow(
        /42501|permission denied to set role/i
      );

      // 8. NOT NULL (23502) e Isolamento RLS (42501) vs FKs compostas (23503)
      await expect(
        adminPrisma.$executeRaw`
          INSERT INTO public."MessageLog" ("id", "studentId", "reasonTitle", "messageContent", "phoneUsed", "sentByName")
          VALUES ('pb-log-no-school', 'pb-stu-alpha', 'Erro', 'Sem schoolId', '41999991601', 'Equipe Teste')
        `
      ).rejects.toThrow(/23502|null value in column "schoolId"/i);

      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await tx.messageTemplate.delete({ where: { id: "pb-tpl-alpha-del" } });
        const afterTplDelete = await tx.messageLog.findUnique({
          where: { id: "pb-log-alpha-del-tpl" },
          select: { schoolId: true, templateId: true },
        });
        expect(afterTplDelete).toEqual({ schoolId: "phaseb-alpha", templateId: null });
      });

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

      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."ClassGroup" ("id", "schoolId", "name", "shift", "segment")
            VALUES ('pb-cg-rls-fail', 'phaseb-beta', 'Invasao', 'Manhã', 'FUNDAMENTAL')
          `
        ).rejects.toThrow(/42501|row-level security/i);
      });

      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."Student" ("id", "schoolId", "classGroupId", "name", "phone", "updatedAt")
            VALUES ('pb-stu-fk-fail', 'phaseb-alpha', 'pb-cg-beta', 'FK Cruzada', '41999991601', NOW())
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      await withTenantContext(runtimePrisma, "phaseb-alpha", async (tx) => {
        await expect(
          tx.$executeRaw`
            INSERT INTO public."MessageLog" ("id", "schoolId", "studentId", "templateId", "reasonTitle", "messageContent", "phoneUsed", "sentByName")
            VALUES ('pb-log-fk-fail', 'phaseb-alpha', 'pb-stu-alpha', 'pb-tpl-beta', 'X', 'Y', '41999991601', 'Equipe Teste')
          `
        ).rejects.toThrow(/23503|foreign key/i);
      });

      // 9. Ponto de entrada real de scripts/seed.cjs com app_runtime sob FORCE RLS e preservação da segunda escola
      await expect(runSeed({ prismaClient: runtimePrisma })).rejects.toThrow(
        /SEED_EXPLICIT_SCHOOL_REQUIRED/
      );

      const betaLogsBeforeSeed = await withTenantContext(runtimePrisma, "phaseb-beta", async (tx) =>
        tx.messageLog.findMany({ orderBy: { id: "asc" }, select: { id: true, schoolId: true, reasonTitle: true } })
      );
      expect(betaLogsBeforeSeed).toEqual([
        { id: "pb-log-beta", schoolId: "phaseb-beta", reasonTitle: "Beta" },
      ]);

      const tmpSeedJson = path.join(os.tmpdir(), `seed-phaseb-${Date.now()}.json`);
      fs.writeFileSync(
        tmpSeedJson,
        JSON.stringify({
          FUNDAMENTAL: {
            templates: [{ title: "Aviso Seed Alpha", prefix: "Olá ", suffix: "!" }],
            students: [
              {
                name: "Aluno Seed Alpha",
                guardian: "Resp Seed",
                phone: "41999991777",
                turma: "7º Ano Seed",
              },
            ],
            logs: [
              {
                student_name: "Aluno Seed Alpha",
                reason: "Aviso Seed Alpha",
                pedagoga: "Equipe Alpha",
                returned: false,
                date: "2026-11-28T12:00:00.000Z",
              },
            ],
            low_attendance: [],
          },
        }),
        "utf8"
      );

      try {
        const seedSummary = await runSeed({
          prismaClient: runtimePrisma,
          schoolId: "phaseb-alpha",
          dataPath: tmpSeedJson,
          replaceSchoolLogs: true,
        });
        expect(seedSummary.schoolId).toBe("phaseb-alpha");
        expect(seedSummary.studentsCount).toBe(1);
        expect(seedSummary.logsCount).toBe(1);
      } finally {
        fs.rmSync(tmpSeedJson, { force: true });
      }

      const betaLogsAfterSeed = await withTenantContext(runtimePrisma, "phaseb-beta", async (tx) =>
        tx.messageLog.findMany({ orderBy: { id: "asc" }, select: { id: true, schoolId: true, reasonTitle: true } })
      );
      expect(betaLogsAfterSeed).toEqual(betaLogsBeforeSeed);

      // 10. Limpeza de app.current_school_id após COMMIT e ROLLBACK na mesma conexão física
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

    it("valida piloto ausente no preflight/materialização e instalação limpa (banco vazio pós-Fase A) com app_runtime", async () => {
      const cleanUrl = assertSafeLocalPhaseBDbUrl(
        process.env.RLS_WAVE1_PHASE_B_CLEAN_ADMIN_URL,
        "RLS_WAVE1_PHASE_B_CLEAN_ADMIN_URL"
      );

      const cleanAdmin = new PrismaClient({ datasources: { db: { url: cleanUrl } } });
      await cleanAdmin.$connect();
      try {
        const { migratorUrl, runtimeUrl } = await provisionLabRolesWithEphemeralPasswords(
          cleanAdmin,
          cleanUrl
        );

        const cleanMigrator = new PrismaClient({ datasources: { db: { url: migratorUrl } } });
        const cleanRuntime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
        await cleanMigrator.$connect();
        await cleanRuntime.$connect();

        try {
          // Cenário sem piloto identificável + modelo global pendente
          await cleanMigrator.$executeRawUnsafe(
            `ALTER TABLE public."MessageTemplate" ALTER COLUMN "schoolId" DROP NOT NULL`
          );
          await cleanMigrator.$executeRaw`
            INSERT INTO public."MessageTemplate" ("id", "schoolId", "title", "prefixText", "suffixText")
            VALUES ('pb-clean-no-pilot-tpl', NULL, 'Sem Piloto', 'Olá ', '!')
          `;
          const noPilotMat = await materializePilotGlobalTemplatesForPhaseB(cleanMigrator);
          expect(noPilotMat.materializedCount).toBe(0);
          const noPilotPreflight = await runRlsWave1Preflight(cleanMigrator);
          expect(noPilotPreflight.readyForPhaseB).toBe(false);
          expect(noPilotPreflight.findings.templatesMissingSchoolId.count).toBe(1);
          await expect(applyWave1PhaseBCandidateInSingleTx(cleanMigrator)).rejects.toThrow(
            /PREFLIGHT_BLOCKED_PHASE_B/
          );

          await cleanMigrator.$executeRaw`
            DELETE FROM public."MessageTemplate" WHERE "id" = 'pb-clean-no-pilot-tpl'
          `;

          const cleanPreflight = await runRlsWave1Preflight(cleanMigrator);
          expect(cleanPreflight.readyForPhaseB).toBe(true);
          expect(cleanPreflight.totalMessageLogs).toBe(0);

          await applyWave1PhaseBCandidateInSingleTx(cleanMigrator);

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
