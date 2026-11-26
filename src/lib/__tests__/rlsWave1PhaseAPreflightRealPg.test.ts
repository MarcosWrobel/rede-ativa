import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  reconcileMessageLogSchoolId,
  runRlsWave1Preflight,
} from "@/lib/rlsWave1Preflight";

const prismaRef = vi.hoisted(() => ({ current: null as unknown as PrismaClient }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        return (prismaRef.current as unknown as Record<string | symbol, unknown>)[prop];
      },
    }
  ),
}));

vi.mock("@/lib/permissions", () => ({
  requireSuperAdmin: vi.fn(async () => ({
    ok: true,
    userId: "superadmin-test",
    userName: "Superadmin Teste",
    email: "superadmin@redeativa.local",
  })),
  requireSchoolAdmin: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
}));

vi.mock("@/lib/currentSchool", () => ({
  invalidateSchoolCache: vi.fn(),
}));

import { DELETE as deleteSchoolHandler } from "@/app/api/schools/[id]/route";

const SHOULD_RUN = process.env.RUN_RLS_PHASE_A_TEST === "true";

function assertSafeLocalPhaseADbUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error("RLS_PHASE_A_DB_URL é obrigatório quando RUN_RLS_PHASE_A_TEST=true.");
  }
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const isSynthetic = dbName.includes("rls_phase_a_test");
  if (!isLoopback || !isSynthetic) {
    throw new Error(
      "RLS_PHASE_A_DB_URL recusada por segurança: exige host loopback e banco sintético 'rls_phase_a_test'."
    );
  }
  return rawUrl;
}

describe.skipIf(!SHOULD_RUN)(
  "RLS Onda 1 — Fase A (Migração Aditiva, Reconciliação e Pré-Flight)",
  () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
      const url = assertSafeLocalPhaseADbUrl(process.env.RLS_PHASE_A_DB_URL);
      prisma = new PrismaClient({ datasources: { db: { url } } });
      await prisma.$connect();
      prismaRef.current = prisma;
    });

    beforeEach(async () => {
      await prisma.messageLog.deleteMany({});
      await prisma.messageTemplate.deleteMany({});
      await prisma.student.deleteMany({});
      await prisma.classGroup.deleteMany({});
      await prisma.school.deleteMany({});

      await prisma.school.createMany({
        data: [
          {
            id: "school-alpha",
            inepCode: "99000101",
            name: "Escola Sintética Alpha",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
          {
            id: "school-beta",
            inepCode: "99000102",
            name: "Escola Sintética Beta",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        ],
      });

      await prisma.classGroup.createMany({
        data: [
          {
            id: "cg-alpha",
            schoolId: "school-alpha",
            name: "6º Ano A",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
          },
          {
            id: "cg-beta",
            schoolId: "school-beta",
            name: "6º Ano A",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
          },
        ],
      });

      await prisma.student.createMany({
        data: [
          {
            id: "stu-alpha",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha",
            name: "Estudante Alpha",
            phone: "41999991111",
          },
          {
            id: "stu-beta",
            schoolId: "school-beta",
            classGroupId: "cg-beta",
            name: "Estudante Beta",
            phone: "41999992222",
          },
        ],
      });

      await prisma.messageTemplate.createMany({
        data: [
          {
            id: "tpl-alpha",
            schoolId: "school-alpha",
            title: "Aviso Alpha",
            prefixText: "Olá",
            suffixText: "Fim",
          },
          {
            id: "tpl-beta",
            schoolId: "school-beta",
            title: "Aviso Beta",
            prefixText: "Olá",
            suffixText: "Fim",
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("preserva logs existentes, faz backfill idempotente, aceita template nulo e detecta log legado pós-migração até reconciliação final", async () => {
      const migrationPath = path.resolve(
        process.cwd(),
        "prisma/migrations/20261126140000_rls_wave1_message_log_school_id_phase_a/migration.sql"
      );
      const migrationSql = fs.readFileSync(migrationPath, "utf8");
      expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "schoolId" TEXT');

      // Cria log já com schoolId preenchido e log com templateId nulo (legítimo)
      await prisma.messageLog.createMany({
        data: [
          {
            id: "log-prefilled-alpha",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Aviso Alpha",
            messageContent: "Log já preenchido",
            phoneUsed: "41999991111",
            sentByName: "Equipe Alpha",
          },
          {
            id: "log-null-tpl-beta",
            schoolId: null,
            studentId: "stu-beta",
            templateId: null,
            reasonTitle: "Sem modelo",
            messageContent: "Log sem modelo legítimo",
            phoneUsed: "41999992222",
            sentByName: "Equipe Beta",
          },
        ],
      });

      // 1ª reconciliação preenche apenas o nulo e preserva o já preenchido
      const rec1 = await reconcileMessageLogSchoolId(prisma);
      expect(rec1.updatedCount).toBe(1);

      const rec2 = await reconcileMessageLogSchoolId(prisma);
      expect(rec2.updatedCount).toBe(0);

      const cleanReport = await runRlsWave1Preflight(prisma);
      expect(cleanReport.postgresVersion).toContain("PostgreSQL");
      expect(cleanReport.hasMessageLogSchoolIdColumn).toBe(true);
      expect(cleanReport.logsWithNullTemplateCount).toBe(1);
      expect(cleanReport.readyForPhaseA).toBe(true);
      expect(cleanReport.readyForPhaseB).toBe(true);
      expect(cleanReport.findings.studentsWithoutSchool.count).toBe(0);
      expect(cleanReport.findings.studentsWithoutSchool.blockingForPhaseA).toBe(true);
      expect(cleanReport.findings.logsWithMissingSchool.count).toBe(0);
      expect(cleanReport.findings.logsWithMissingSchool.blockingForPhaseA).toBe(true);

      // Escritor legado cria novo log com schoolId = null durante a Fase A
      await prisma.messageLog.create({
        data: {
          id: "log-legacy-writer-after-backfill",
          schoolId: null,
          studentId: "stu-alpha",
          templateId: null,
          reasonTitle: "Escritor anterior",
          messageContent: "Criado na versão antiga durante Fase A",
          phoneUsed: "41999991111",
          sentByName: "Versão Anterior",
        },
      });

      const duringTransition = await runRlsWave1Preflight(prisma);
      expect(duringTransition.readyForPhaseA).toBe(true);
      expect(duringTransition.readyForPhaseB).toBe(false);
      expect(duringTransition.findings.logsMissingSchoolId.count).toBe(1);
      expect(duringTransition.findings.logsMissingSchoolId.blockingForPhaseA).toBe(false);
      expect(duringTransition.findings.logsMissingSchoolId.transitionExpectedDuringPhaseA).toBe(true);
      expect(duringTransition.findings.logsMissingSchoolId.blockingForPhaseB).toBe(true);
      expect(duringTransition.findings.logsMissingSchoolId.sampleIds).toContain(
        "log-legacy-writer-after-backfill"
      );

      // Reconciliação final cobre o log criado durante a transição
      const recFinal = await reconcileMessageLogSchoolId(prisma);
      expect(recFinal.updatedCount).toBe(1);

      const afterFinalRec = await runRlsWave1Preflight(prisma);
      expect(afterFinalRec.readyForPhaseB).toBe(true);
    });

    it("detecta divergência de escola, referências cruzadas entre escolas e registros órfãos bloqueando a Fase B", async () => {
      // Divergência: MessageLog.schoolId preenchido diferente de Student.schoolId (reconciliação NÃO sobrescreve)
      await prisma.messageLog.create({
        data: {
          id: "log-divergent",
          schoolId: "school-beta",
          studentId: "stu-alpha",
          templateId: "tpl-alpha",
          reasonTitle: "Divergente",
          messageContent: "Escola divergente",
          phoneUsed: "41999991111",
          sentByName: "Teste",
        },
      });

      // Template de outra escola
      await prisma.messageLog.create({
        data: {
          id: "log-cross-tpl",
          schoolId: "school-alpha",
          studentId: "stu-alpha",
          templateId: "tpl-beta",
          reasonTitle: "Modelo cruzado",
          messageContent: "Modelo de outra escola",
          phoneUsed: "41999991111",
          sentByName: "Teste",
        },
      });

      const rec = await reconcileMessageLogSchoolId(prisma);
      expect(rec.updatedCount).toBe(0);

      // Estudante vinculado a turma de outra escola
      await prisma.student.create({
        data: {
          id: "stu-cross-cg",
          schoolId: "school-alpha",
          classGroupId: "cg-beta",
          name: "Estudante Turma Cruzada",
          phone: "41999993333",
        },
      });

      const report = await runRlsWave1Preflight(prisma);
      expect(report.readyForPhaseB).toBe(false);
      expect(report.findings.logsDivergentSchoolId.count).toBe(1);
      expect(report.findings.logsDivergentSchoolId.sampleIds).toContain("log-divergent");
      // Tanto log-cross-tpl quanto log-divergent (schoolId='school-beta', templateId='tpl-alpha') divergem do template
      expect(report.findings.logsWithCrossSchoolTemplate.count).toBe(2);
      expect(report.findings.logsWithCrossSchoolTemplate.sampleIds).toContain("log-cross-tpl");
      expect(report.findings.logsWithCrossSchoolTemplate.sampleIds).toContain("log-divergent");
      expect(report.findings.studentsWithCrossSchoolClassGroup.count).toBe(1);
      expect(report.findings.studentsWithCrossSchoolClassGroup.sampleIds).toContain("stu-cross-cg");
    });

    it("comprova bloqueio ON DELETE RESTRICT da FK simples na exclusão de escola e pré-flight limpo pós-exclusão", async () => {
      await prisma.messageLog.create({
        data: {
          id: "log-pre-mig-alpha",
          schoolId: "school-alpha",
          studentId: "stu-alpha",
          templateId: "tpl-alpha",
          reasonTitle: "Antes da Fase A",
          messageContent: "Log existente antes da Fase A",
          phoneUsed: "41999991111",
          sentByName: "Equipe Alpha",
        },
      });

      // Efeito da FK simples MessageLog_schoolId_fkey (ON DELETE RESTRICT) na exclusão de escola
      await expect(
        prisma.school.delete({ where: { id: "school-alpha" } })
      ).rejects.toThrow(/23503|foreign key|MessageLog_schoolId_fkey|Student_schoolId_fkey|ClassGroup_schoolId_fkey/i);

      // Na ordem correta (messageLog -> student -> classGroup -> template -> school), a exclusão conclui:
      await prisma.messageLog.deleteMany({ where: { schoolId: "school-alpha" } });
      await prisma.student.deleteMany({ where: { schoolId: "school-alpha" } });
      await prisma.classGroup.deleteMany({ where: { schoolId: "school-alpha" } });
      await prisma.messageTemplate.deleteMany({ where: { schoolId: "school-alpha" } });
      const deletedSchool = await prisma.school.delete({ where: { id: "school-alpha" } });
      expect(deletedSchool.id).toBe("school-alpha");

      const recAfter = await reconcileMessageLogSchoolId(prisma);
      expect(recAfter.updatedCount).toBe(0);

      const afterReport = await runRlsWave1Preflight(prisma);
      expect(afterReport.hasMessageLogSchoolIdColumn).toBe(true);
      expect(afterReport.readyForPhaseA).toBe(true);
      expect(afterReport.readyForPhaseB).toBe(true);
    });

    it("executa DELETE /api/schools/[id] real em dados coerentes mantendo a outra escola intacta", async () => {
      await prisma.messageLog.createMany({
        data: [
          {
            id: "log-coherent-alpha",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Aviso Alpha",
            messageContent: "Mensagem coerente Alpha",
            phoneUsed: "41999991111",
            sentByName: "Equipe Alpha",
          },
          {
            id: "log-coherent-beta",
            schoolId: "school-beta",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Aviso Beta",
            messageContent: "Mensagem coerente Beta",
            phoneUsed: "41999992222",
            sentByName: "Equipe Beta",
          },
        ],
      });

      const res = await deleteSchoolHandler(
        new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
        { params: Promise.resolve({ id: "school-alpha" }) }
      );
      expect(res.status).toBe(200);

      expect(await prisma.school.findUnique({ where: { id: "school-alpha" } })).toBeNull();
      expect(await prisma.messageLog.findUnique({ where: { id: "log-coherent-alpha" } })).toBeNull();

      // Outra escola e seus registros permanecem intactos
      expect(await prisma.school.findUnique({ where: { id: "school-beta" } })).not.toBeNull();
      expect(await prisma.student.findUnique({ where: { id: "stu-beta" } })).not.toBeNull();
      expect(await prisma.messageLog.findUnique({ where: { id: "log-coherent-beta" } })).not.toBeNull();
    });

    it("sinaliza 409 e preserva todos os registros em rollback atômico quando DELETE /api/schools/[id] encontra MessageLog.schoolId divergente", async () => {
      await prisma.messageLog.createMany({
        data: [
          {
            id: "log-normal-alpha",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Aviso Alpha",
            messageContent: "Mensagem normal Alpha",
            phoneUsed: "41999991111",
            sentByName: "Equipe Alpha",
          },
          {
            id: "log-normal-beta",
            schoolId: "school-beta",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Aviso Beta",
            messageContent: "Mensagem normal Beta",
            phoneUsed: "41999992222",
            sentByName: "Equipe Beta",
          },
          {
            // Divergência: schoolId aponta para school-alpha, mas studentId pertence a school-beta
            id: "log-divergent-fk-block",
            schoolId: "school-alpha",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Divergente",
            messageContent: "Log divergente que bloqueia exclusão de school-alpha",
            phoneUsed: "41999992222",
            sentByName: "Teste",
          },
        ],
      });

      const res = await deleteSchoolHandler(
        new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
        { params: Promise.resolve({ id: "school-alpha" }) }
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("SCHOOL_DELETE_INTEGRITY_CONFLICT");
      expect(body.error).toContain("mensageria");

      // Rollback atômico: registros da própria transação de school-alpha permanecem intactos
      expect(await prisma.school.findUnique({ where: { id: "school-alpha" } })).not.toBeNull();
      expect(await prisma.classGroup.findUnique({ where: { id: "cg-alpha" } })).not.toBeNull();
      expect(await prisma.student.findUnique({ where: { id: "stu-alpha" } })).not.toBeNull();
      expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-alpha" } })).not.toBeNull();
      expect(await prisma.messageLog.findUnique({ where: { id: "log-normal-alpha" } })).not.toBeNull();

      // Dados da outra escola permanecem intactos
      expect(await prisma.school.findUnique({ where: { id: "school-beta" } })).not.toBeNull();
      expect(await prisma.student.findUnique({ where: { id: "stu-beta" } })).not.toBeNull();
      expect(await prisma.messageLog.findUnique({ where: { id: "log-normal-beta" } })).not.toBeNull();
      expect(
        await prisma.messageLog.findUnique({ where: { id: "log-divergent-fk-block" } })
      ).not.toBeNull();
    });
  }
);

describe("RLS Onda 1 — Pré-flight unitário (escolas inexistentes pré e pós-migração)", () => {
  it("reporta separadamente studentsWithoutSchool antes da migração bloqueando Fase A e Fase B", async () => {
    const queryRaw = vi
      .fn()
      // 1-4: version, column exists (false), total logs, null templates
      .mockResolvedValueOnce([{ version: "PostgreSQL 16.0" }])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ count: 2n }])
      .mockResolvedValueOnce([{ count: 0n }])
      // 5-9: studentsWithoutSchool, logsWithoutStudent, logsWithMissingTemplate, studentsWithMissingClassGroup, studentsWithCrossSchoolClassGroup
      .mockResolvedValueOnce([{ totalCount: 1n, id: "stu-orphan-school" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // 10: logsWithCrossSchoolTemplate (else branch)
      .mockResolvedValueOnce([]);

    const report = await runRlsWave1Preflight({ $queryRaw: queryRaw as unknown as PrismaClient["$queryRaw"] });

    expect(report.hasMessageLogSchoolIdColumn).toBe(false);
    expect(report.readyForPhaseA).toBe(false);
    expect(report.readyForPhaseB).toBe(false);
    expect(report.findings.studentsWithoutSchool).toMatchObject({
      count: 1,
      blockingForPhaseA: true,
      blockingForPhaseB: true,
      sampleIds: ["stu-orphan-school"],
    });
    expect(report.findings.logsWithMissingSchool).toMatchObject({
      count: 0,
      blockingForPhaseA: true,
      blockingForPhaseB: true,
      sampleIds: [],
    });
  });

  it("reporta logsWithMissingSchool quando a coluna existe bloqueando Fase A e Fase B", async () => {
    const queryRaw = vi
      .fn()
      // 1-4: version, column exists (true), total logs, null templates
      .mockResolvedValueOnce([{ version: "PostgreSQL 16.0" }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ count: 2n }])
      .mockResolvedValueOnce([{ count: 0n }])
      // 5-9: studentsWithoutSchool, logsWithoutStudent, logsWithMissingTemplate, studentsWithMissingClassGroup, studentsWithCrossSchoolClassGroup
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // 10-13: logsWithMissingSchool, logsMissingSchoolId, logsDivergentSchoolId, logsWithCrossSchoolTemplate
      .mockResolvedValueOnce([{ totalCount: 1n, id: "log-missing-school" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const report = await runRlsWave1Preflight({ $queryRaw: queryRaw as unknown as PrismaClient["$queryRaw"] });

    expect(report.hasMessageLogSchoolIdColumn).toBe(true);
    expect(report.readyForPhaseA).toBe(false);
    expect(report.readyForPhaseB).toBe(false);
    expect(report.findings.studentsWithoutSchool.count).toBe(0);
    expect(report.findings.logsWithMissingSchool).toMatchObject({
      count: 1,
      blockingForPhaseA: true,
      blockingForPhaseB: true,
      sampleIds: ["log-missing-school"],
    });
  });

  it("DELETE /api/schools/[id] retorna diagnóstico genérico de FK para P2003 de outra constraint sem mencionar mensageria", async () => {
    const previousPrisma = prismaRef.current;
    const noopDeleteMany = vi.fn(async () => ({ count: 0 }));
    const noopUpdateMany = vi.fn(async () => ({ count: 0 }));
    prismaRef.current = {
      school: {
        findUnique: vi.fn(async () => ({
          id: "school-other-fk",
          inepCode: "99000999",
          name: "Escola Teste FK",
          network: "MUNICIPAL",
          city: "Cidade Teste",
          _count: { students: 0, classGroups: 0, pedagogicalMinutes: 0, userSchools: 0 },
        })),
        delete: vi.fn(),
      },
      messageLog: { deleteMany: noopDeleteMany },
      lowAttendanceRecord: { deleteMany: noopDeleteMany },
      absenceJustification: { deleteMany: noopDeleteMany },
      inPersonAttendance: { deleteMany: noopDeleteMany },
      attendanceSnapshot: { deleteMany: noopDeleteMany },
      studentContact: { deleteMany: noopDeleteMany },
      pedagogicalMinuteStudent: { deleteMany: noopDeleteMany },
      pedagogicalMinuteParticipant: { deleteMany: noopDeleteMany },
      pedagogicalMinuteAddendum: { deleteMany: noopDeleteMany },
      pedagogicalActionItem: { deleteMany: noopDeleteMany },
      pedagogicalMinute: { deleteMany: noopDeleteMany },
      student: { deleteMany: noopDeleteMany },
      classGroup: { deleteMany: noopDeleteMany },
      messageTemplate: { deleteMany: noopDeleteMany },
      userSchool: { deleteMany: noopDeleteMany },
      user: { updateMany: noopUpdateMany },
      $transaction: vi.fn(async () => {
        const fkErr = new Error("Foreign key constraint violated: `AuditLog_schoolId_fkey`") as Error & {
          code?: string;
          meta?: { field_name?: string };
        };
        fkErr.code = "P2003";
        fkErr.meta = { field_name: "AuditLog_schoolId_fkey" };
        throw fkErr;
      }),
    } as unknown as PrismaClient;

    try {
      const res = await deleteSchoolHandler(
        new Request("http://127.0.0.1/api/schools/school-other-fk", { method: "DELETE" }),
        { params: Promise.resolve({ id: "school-other-fk" }) }
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("SCHOOL_DELETE_FK_CONFLICT");
      expect(body.error).not.toContain("mensageria");
    } finally {
      prismaRef.current = previousPrisma;
    }
  });
});
