import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  reconcileMessageLogSchoolId,
  runRlsWave1Preflight,
} from "@/lib/rlsWave1Preflight";

const prismaRef = vi.hoisted(() => ({ current: null as unknown as PrismaClient }));
const testAuthState = vi.hoisted(() => ({
  schoolId: "school-alpha" as string | undefined,
  inepCode: "99000101",
  role: "PEDAGOGA",
  userId: "",
  userName: "Equipe Teste",
  email: "equipe@redeativa.local",
  snapshot: null as Record<string, unknown> | null,
  useRealCurrentSchool: false,
}));

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
  requireAuth: vi.fn(async () => ({
    ok: true,
    schoolId: testAuthState.schoolId,
    userId: testAuthState.userId,
    userName: testAuthState.userName,
    email: testAuthState.email,
    role: testAuthState.role,
    session: {
      user: {
        id: testAuthState.userId,
        name: testAuthState.userName,
        email: testAuthState.email,
        role: testAuthState.role,
        schoolId: testAuthState.schoolId,
      },
    },
    snapshot: testAuthState.snapshot,
  })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
}));

vi.mock("@/lib/currentSchool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currentSchool")>("@/lib/currentSchool");
  return {
    ...actual,
    invalidateSchoolCache: vi.fn(),
    requireAuthorizedSchool: vi.fn(async (session, explicitSchoolId, snapshot, options) => {
      if (testAuthState.useRealCurrentSchool) {
        return actual.requireAuthorizedSchool(session, explicitSchoolId, snapshot, options);
      }
      return {
        ok: true,
        school: { id: testAuthState.schoolId, inepCode: testAuthState.inepCode },
      };
    }),
  };
});

const whatsappProviderMock = vi.hoisted(() => ({
  overrideDispatch: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true })),
  RATE_LIMIT_POLICIES: { MESSAGE_REPLY: {} },
}));

vi.mock("@/lib/whatsappProvider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsappProvider")>(
    "@/lib/whatsappProvider"
  );
  return {
    ...actual,
    dispatchWhatsAppMessage: vi.fn(async (...args: unknown[]) => {
      if (whatsappProviderMock.overrideDispatch) {
        return whatsappProviderMock.overrideDispatch(...args);
      }
      return actual.dispatchWhatsAppMessage(
        ...(args as Parameters<typeof actual.dispatchWhatsAppMessage>)
      );
    }),
  };
});

import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { dispatchWhatsAppMessage } from "@/lib/whatsappProvider";
import { logAudit } from "@/lib/audit";
import { DELETE as deleteSchoolHandler } from "@/app/api/schools/[id]/route";
import { POST as sendMessageHandler } from "@/app/api/messages/send/route";

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

    it("POST /api/messages/send grava MessageLog.schoolId da escola autorizada (com modelo próprio e modelo nulo), rejeita aluno/modelo cruzado e convive com escritor legado", async () => {
      // 1. Escola Alpha com modelo próprio
      testAuthState.schoolId = "school-alpha";
      const resAlphaTpl = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Aviso Alpha",
            messageContent: "Mensagem com modelo da escola Alpha",
          }),
        })
      );
      expect(resAlphaTpl.status).toBe(200);
      const bodyAlphaTpl = await resAlphaTpl.json();
      const rowAlphaTpl = await prisma.messageLog.findUnique({ where: { id: bodyAlphaTpl.logId } });
      expect(rowAlphaTpl?.schoolId).toBe("school-alpha");
      expect(rowAlphaTpl?.templateId).toBe("tpl-alpha");

      // 2. Escola Alpha com templateId nulo (válido)
      const resAlphaNull = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-alpha",
            templateId: null,
            reasonTitle: "Contato livre",
            messageContent: "Mensagem sem modelo da escola Alpha",
          }),
        })
      );
      expect(resAlphaNull.status).toBe(200);
      const bodyAlphaNull = await resAlphaNull.json();
      const rowAlphaNull = await prisma.messageLog.findUnique({ where: { id: bodyAlphaNull.logId } });
      expect(rowAlphaNull?.schoolId).toBe("school-alpha");
      expect(rowAlphaNull?.templateId).toBeNull();

      // 3. Escola Beta com modelo próprio
      testAuthState.schoolId = "school-beta";
      const resBetaTpl = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Aviso Beta",
            messageContent: "Mensagem com modelo da escola Beta",
          }),
        })
      );
      expect(resBetaTpl.status).toBe(200);
      const bodyBetaTpl = await resBetaTpl.json();
      const rowBetaTpl = await prisma.messageLog.findUnique({ where: { id: bodyBetaTpl.logId } });
      expect(rowBetaTpl?.schoolId).toBe("school-beta");
      expect(rowBetaTpl?.templateId).toBe("tpl-beta");

      const countBeforeRejections = await prisma.messageLog.count();
      expect(countBeforeRejections).toBe(3);

      // 4. Rejeição de estudante de outra escola (sessão Alpha tentando enviar para stu-beta)
      testAuthState.schoolId = "school-alpha";
      const resCrossStudent = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-beta",
            templateId: "tpl-alpha",
            reasonTitle: "Tentativa cruzada",
            messageContent: "Não deve gravar",
          }),
        })
      );
      expect(resCrossStudent.status).toBe(404);
      expect(await prisma.messageLog.count()).toBe(countBeforeRejections);

      // 5. Rejeição de modelo de outra escola (sessão Alpha com stu-alpha e tpl-beta)
      const resCrossTpl = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-alpha",
            templateId: "tpl-beta",
            reasonTitle: "Modelo cruzado",
            messageContent: "Não deve gravar",
          }),
        })
      );
      expect(resCrossTpl.status).toBe(403);
      expect(await prisma.messageLog.count()).toBe(countBeforeRejections);

      // 6. Escritor legado ainda cria log com schoolId nulo; pré-flight detecta; reconciliação preenche preservando os existentes
      await prisma.messageLog.create({
        data: {
          id: "log-legado-null",
          schoolId: null,
          studentId: "stu-beta",
          templateId: null,
          reasonTitle: "Escritor legado",
          messageContent: "Criado com schoolId nulo",
          phoneUsed: "41999992222",
          sentByName: "Legado",
        },
      });

      const preflightWithLegacy = await runRlsWave1Preflight(prisma);
      expect(preflightWithLegacy.findings.logsMissingSchoolId.count).toBe(1);
      expect(preflightWithLegacy.findings.logsMissingSchoolId.sampleIds).toContain("log-legado-null");
      expect(preflightWithLegacy.readyForPhaseB).toBe(false);

      const rec = await reconcileMessageLogSchoolId(prisma);
      expect(rec.updatedCount).toBe(1);

      const reconciledLegacy = await prisma.messageLog.findUnique({ where: { id: "log-legado-null" } });
      expect(reconciledLegacy?.schoolId).toBe("school-beta");
      expect((await prisma.messageLog.findUnique({ where: { id: bodyAlphaTpl.logId } }))?.schoolId).toBe(
        "school-alpha"
      );
      expect((await prisma.messageLog.findUnique({ where: { id: bodyAlphaNull.logId } }))?.schoolId).toBe(
        "school-alpha"
      );

      const preflightClean = await runRlsWave1Preflight(prisma);
      expect(preflightClean.findings.logsMissingSchoolId.count).toBe(0);
      expect(preflightClean.readyForPhaseB).toBe(true);
    });

    it("bloqueia envio para perfil sem permissão (PROFESSOR) e para SUPERADMIN sem escola selecionada mesmo com fallback de leitura ativo", async () => {
      // 1. Perfil sem permissão de envio (ex.: PROFESSOR na escola)
      testAuthState.schoolId = "school-alpha";
      testAuthState.inepCode = "99000101";
      testAuthState.role = "PROFESSOR";
      testAuthState.snapshot = {
        id: "user-prof",
        email: "prof@redeativa.local",
        name: "Docente",
        role: "PROFESSOR",
        active: true,
        schoolId: "school-alpha",
        schools: [{ schoolId: "school-alpha", role: "PROFESSOR", active: true }],
        networks: [],
      };

      const resForbiddenRole = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Tentativa sem papel",
            messageContent: "Não deve gravar",
          }),
        })
      );
      expect(resForbiddenRole.status).toBe(403);
      expect(await prisma.messageLog.count()).toBe(0);

      // 2. SUPERADMIN sem escola selecionada: fallback de leitura retorna escola, mas gravação é bloqueada (403)
      testAuthState.useRealCurrentSchool = true;
      testAuthState.schoolId = undefined;
      testAuthState.role = "SUPERADMIN";
      testAuthState.snapshot = {
        id: "user-super",
        email: "superadmin@redeativa.local",
        name: "Superadmin",
        role: "SUPERADMIN",
        active: true,
        schoolId: null,
        schools: [],
        networks: [],
      };

      try {
        const readCheck = await requireAuthorizedSchool(
          { user: { id: "user-super", email: "superadmin@redeativa.local", role: "SUPERADMIN" } },
          null,
          testAuthState.snapshot as unknown as Parameters<typeof requireAuthorizedSchool>[2]
        );
        expect(readCheck.ok).toBe(true);

        const resSuperNoSchool = await sendMessageHandler(
          new Request("http://127.0.0.1/api/messages/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studentId: "stu-alpha",
              templateId: "tpl-alpha",
              reasonTitle: "Superadmin sem seleção",
              messageContent: "Não deve gravar via fallback de leitura",
            }),
          })
        );
        expect(resSuperNoSchool.status).toBe(403);
        expect(await prisma.messageLog.count()).toBe(0);
      } finally {
        testAuthState.useRealCurrentSchool = false;
        testAuthState.role = "PEDAGOGA";
        testAuthState.snapshot = null;
        testAuthState.schoolId = "school-alpha";
      }
    });

    it("comprova app.current_school_id ativo na mesma transação das leituras/inserção, visibilidade fora da Tx antes do despacho, atualização pós-despacho (Tx 2) e rollback sem chamar provedor", async () => {
      testAuthState.schoolId = "school-alpha";
      testAuthState.inepCode = "99000101";

      // 1. Caminho de sucesso: verificar app.current_school_id na Tx 1 e visibilidade fora da Tx durante o despacho + Tx 2 atualizando status
      const observedSettingsInTx: Array<string | null> = [];
      const originalTransaction = prisma.$transaction.bind(prisma);
      const txSpy = vi.spyOn(prisma, "$transaction").mockImplementation(((fn: unknown, opts?: unknown) => {
        if (typeof fn === "function") {
          return originalTransaction(async (tx) => {
            const result = await (fn as (client: unknown) => Promise<unknown>)(tx);
            const rows = await tx.$queryRaw<Array<{ val: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS val
            `;
            observedSettingsInTx.push(rows[0]?.val ?? null);
            return result;
          }, opts as Parameters<typeof originalTransaction>[1]);
        }
        return originalTransaction(fn as Parameters<typeof originalTransaction>[0]);
      }) as typeof prisma.$transaction);

      let visibleLogDuringDispatch: { id: string; schoolId: string | null; deliveryStatus: string } | null = null;
      vi.mocked(dispatchWhatsAppMessage).mockClear();
      whatsappProviderMock.overrideDispatch = async () => {
        const logs = await prisma.messageLog.findMany({
          where: { schoolId: "school-alpha" },
          select: { id: true, schoolId: true, deliveryStatus: true },
        });
        visibleLogDuringDispatch = logs[0] || null;
        return {
          mode: "API_CLOUD",
          whatsappUrl: "https://wa.me/5541999991111",
          initialStatus: "QUEUED",
        };
      };

      try {
        const resOk = await sendMessageHandler(
          new Request("http://127.0.0.1/api/messages/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studentId: "stu-alpha",
              templateId: "tpl-alpha",
              reasonTitle: "Teste Tx1 e Tx2",
              messageContent: "Mensagem com atualização pós-despacho",
            }),
          })
        );
        expect(resOk.status).toBe(200);
        const bodyOk = await resOk.json();
        expect(bodyOk.deliveryStatus).toBe("QUEUED");

        // Tx 1 e Tx 2 executaram com app.current_school_id === "school-alpha"
        expect(observedSettingsInTx).toEqual(["school-alpha", "school-alpha"]);

        // Log já estava visível fora da transação quando o despacho externo começou
        const observedLog = visibleLogDuringDispatch as {
          id: string;
          schoolId: string | null;
          deliveryStatus: string;
        } | null;
        expect(observedLog).not.toBeNull();
        expect(observedLog?.id).toBe(bodyOk.logId);
        expect(observedLog?.schoolId).toBe("school-alpha");
        expect(observedLog?.deliveryStatus).toBe("LINK_OPENED");

        // Tx 2 atualizou o status final no banco mantendo schoolId
        const finalRow = await prisma.messageLog.findUnique({ where: { id: bodyOk.logId } });
        expect(finalRow?.deliveryStatus).toBe("QUEUED");
        expect(finalRow?.schoolId).toBe("school-alpha");

        // 2. Simulação de falha após inserção e antes do commit: rollback completo, 0 logs persistidos, 0 chamadas ao provedor
        await prisma.messageLog.deleteMany({});
        vi.mocked(dispatchWhatsAppMessage).mockClear();
        whatsappProviderMock.overrideDispatch = null;

        txSpy.mockImplementationOnce(((fn: unknown, opts?: unknown) => {
          if (typeof fn === "function") {
            return originalTransaction(async (tx) => {
              await (fn as (client: unknown) => Promise<unknown>)(tx);
              throw new Error("Simulated failure after insert before commit");
            }, opts as Parameters<typeof originalTransaction>[1]);
          }
          return originalTransaction(fn as Parameters<typeof originalTransaction>[0]);
        }) as typeof prisma.$transaction);

        const resRollback = await sendMessageHandler(
          new Request("http://127.0.0.1/api/messages/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studentId: "stu-alpha",
              templateId: "tpl-alpha",
              reasonTitle: "Falha antes do commit",
              messageContent: "Deve sofrer rollback",
            }),
          })
        );
        expect(resRollback.status).toBe(500);
        expect(await prisma.messageLog.count()).toBe(0);
        expect(dispatchWhatsAppMessage).not.toHaveBeenCalled();
      } finally {
        whatsappProviderMock.overrideDispatch = null;
        txSpy.mockRestore();
      }
    });

    it("rejeita envio quando estudante da escola A está vinculado a turma da escola B sem criar log, chamar provedor ou vazar dados da turma", async () => {
      await prisma.classGroup.update({
        where: { id: "cg-beta" },
        data: { name: "Turma Privada Beta" },
      });
      await prisma.student.create({
        data: {
          id: "stu-alpha-cross-cg",
          schoolId: "school-alpha",
          classGroupId: "cg-beta",
          name: "Estudante Alpha Turma Cruzada",
          phone: "41999995555",
        },
      });

      testAuthState.schoolId = "school-alpha";
      testAuthState.inepCode = "99000101";
      vi.mocked(dispatchWhatsAppMessage).mockClear();
      vi.mocked(logAudit).mockClear();

      const res = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-alpha-cross-cg",
            templateId: "tpl-alpha",
            reasonTitle: "Tentativa turma cruzada",
            messageContent: "Não deve persistir nem auditar turma de B",
          }),
        })
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).not.toContain("Turma Privada Beta");
      expect(body.error).not.toContain("cg-beta");
      expect(await prisma.messageLog.count()).toBe(0);
      expect(dispatchWhatsAppMessage).not.toHaveBeenCalled();

      const auditCalls = vi.mocked(logAudit).mock.calls;
      const sendAudit = auditCalls.find((c) => c[0]?.action === "SEND_MESSAGE");
      expect(sendAudit).toBeUndefined();
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

  it("permite modelo global (schoolId null) na escola piloto mantendo templateId distinto de null e rejeita em outra escola", async () => {
    const previousPrisma = prismaRef.current;
    const prevSchoolId = testAuthState.schoolId;
    const prevInep = testAuthState.inepCode;
    const createLogMock = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `log-${createLogMock.mock.calls.length}`,
      ...data,
    }));

    const mockPrismaObj = {
      $executeRaw: vi.fn(async () => 0),
      student: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === "stu-piloto"
            ? {
                id: "stu-piloto",
                schoolId: "default-leopoldina",
                classGroupId: "cg-piloto",
                phone: "41999994444",
                name: "Estudante Piloto",
              }
            : {
                id: "stu-alpha",
                schoolId: "school-alpha",
                classGroupId: "cg-alpha",
                phone: "41999991111",
                name: "Estudante Alpha",
              }
        ),
      },
      classGroup: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === "cg-piloto"
            ? { id: "cg-piloto", schoolId: "default-leopoldina", name: "7º Ano A" }
            : { id: "cg-alpha", schoolId: "school-alpha", name: "6º Ano A" }
        ),
      },
      messageTemplate: {
        findUnique: vi.fn(async () => ({ id: "tpl-global", schoolId: null })),
      },
      messageLog: {
        create: createLogMock,
        update: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrismaObj)),
    };

    prismaRef.current = mockPrismaObj as unknown as PrismaClient;

    try {
      // 1. Escola Piloto com modelo global (templateId = "tpl-global" != null)
      testAuthState.schoolId = "default-leopoldina";
      testAuthState.inepCode = "41042730";
      const resPilotGlobal = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-piloto",
            templateId: "tpl-global",
            reasonTitle: "Aviso Global",
            messageContent: "Mensagem com modelo global na escola piloto",
          }),
        })
      );
      expect(resPilotGlobal.status).toBe(200);
      expect(createLogMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            schoolId: "default-leopoldina",
            templateId: "tpl-global",
          }),
        })
      );

      // 2. Escola Piloto sem modelo (templateId = null) distingue-se do modelo global
      const resPilotNoTpl = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-piloto",
            templateId: null,
            reasonTitle: "Sem modelo",
            messageContent: "Mensagem sem modelo na escola piloto",
          }),
        })
      );
      expect(resPilotNoTpl.status).toBe(200);
      expect(createLogMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            schoolId: "default-leopoldina",
            templateId: null,
          }),
        })
      );

      // 3. Outra escola (school-alpha) rejeita modelo global (403) sem criar log
      testAuthState.schoolId = "school-alpha";
      testAuthState.inepCode = "99000101";
      const resAlphaGlobal = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "stu-alpha",
            templateId: "tpl-global",
            reasonTitle: "Tentativa global",
            messageContent: "Não deve gravar",
          }),
        })
      );
      expect(resAlphaGlobal.status).toBe(403);
      expect(createLogMock).toHaveBeenCalledTimes(2);
    } finally {
      prismaRef.current = previousPrisma;
      testAuthState.schoolId = prevSchoolId;
      testAuthState.inepCode = prevInep;
    }
  });
});
