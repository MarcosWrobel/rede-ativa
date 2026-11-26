import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  reconcileMessageLogSchoolId,
  runRlsWave1Preflight,
} from "@/lib/rlsWave1Preflight";

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
      expect(cleanReport.readyForPhaseB).toBe(true);

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
      expect(duringTransition.readyForPhaseB).toBe(false);
      expect(duringTransition.findings.logsMissingSchoolId.count).toBe(1);
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
      expect(afterReport.readyForPhaseB).toBe(true);
    });
  }
);
