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
  pendingTokenSchoolId: null as string | null,
  useRealExtensionSyncAuth: false,
  pendingSessionUser: null as Record<string, unknown> | null,
  useRealPermissions: false,
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

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    ...actual,
    requireSuperAdmin: vi.fn(async () => ({
      ok: true,
      userId: "superadmin-test",
      userName: "Superadmin Teste",
      email: "superadmin@redeativa.local",
    })),
    requireSchoolAdmin: vi.fn(async (targetSchoolId?: string | null) => {
      if (testAuthState.useRealPermissions) {
        return actual.requireSchoolAdmin(targetSchoolId);
      }
      return {
        ok: true,
        userId: testAuthState.userId,
        userName: testAuthState.userName,
        email: testAuthState.email,
        role: testAuthState.role,
        schoolId: testAuthState.schoolId,
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
      };
    }),
    requireAuth: vi.fn(async () => {
      if (testAuthState.useRealPermissions) {
        return actual.requireAuth();
      }
      return {
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
      };
    }),
  };
});

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    ...actual,
    logAudit: vi.fn(async () => {}),
  };
});

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

vi.mock("@/lib/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rateLimit")>("@/lib/rateLimit");
  return {
    ...actual,
    enforceRateLimit: vi.fn(async () => ({ ok: true })),
    getRateLimitStatus: vi.fn(async () => ({ count: 0, retryAfterSeconds: 0 })),
    checkRateLimit: vi.fn(async () => ({ success: true, retryAfterSeconds: 0 })),
    resetRateLimit: vi.fn(async () => {}),
  };
});

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

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => {
    if (testAuthState.pendingSessionUser !== null) {
      return { user: testAuthState.pendingSessionUser };
    }
    return testAuthState.pendingTokenSchoolId
      ? null
      : {
          user: {
            id: testAuthState.userId,
            name: testAuthState.userName,
            email: testAuthState.email,
            role: testAuthState.role,
            schoolId: testAuthState.schoolId,
            active: true,
          },
        };
  }),
}));

vi.mock("@/lib/extensionSyncAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/extensionSyncAuth")>(
    "@/lib/extensionSyncAuth"
  );
  return {
    ...actual,
    authenticateExtensionSyncToken: vi.fn(async (params) => {
      if (testAuthState.useRealExtensionSyncAuth) {
        return actual.authenticateExtensionSyncToken(params);
      }
      if (!testAuthState.pendingTokenSchoolId) {
        return {
          ok: false,
          response: new Response(JSON.stringify({ error: "Não autorizado." }), { status: 401 }),
        };
      }
      return {
        ok: true,
        targetSchoolId: testAuthState.pendingTokenSchoolId,
        userName: "Companion Teste",
      };
    }),
  };
});

import { auth } from "@/lib/auth";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { dispatchWhatsAppMessage } from "@/lib/whatsappProvider";
import { logAudit } from "@/lib/audit";
import * as rlsTenantContext from "@/lib/rlsTenantContext";
import { DELETE as deleteSchoolHandler } from "@/app/api/schools/[id]/route";
import { GET as getMessagesHandler } from "@/app/api/messages/route";
import { POST as webhookWhatsappHandler } from "@/app/api/webhooks/whatsapp/route";
import { POST as frequenciaSyncHandler } from "@/app/api/frequencia/sync/route";
import { POST as serpSyncHandler } from "@/app/api/serp/sync/route";
import { POST as conselhoSyncHandler } from "@/app/api/conselho-classe/sync/route";
import { POST as sendMessageHandler } from "@/app/api/messages/send/route";
import { GET as getPendingMessagesHandler } from "@/app/api/messages/pending/route";
import { PATCH as patchMessageStatusHandler } from "@/app/api/messages/status/route";
import { POST as postMessageReplyHandler } from "@/app/api/messages/reply/route";
import { PUT as putMessageManageHandler, DELETE as deleteMessageManageHandler } from "@/app/api/messages/manage/route";

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
      await prisma.studentCouncilSubjectEntry.deleteMany({});
      await prisma.studentCouncilCard.deleteMany({});
      await prisma.classCouncilSubject.deleteMany({});
      await prisma.classCouncilBoard.deleteMany({});
      await prisma.absenceJustification.deleteMany({});
      await prisma.attendanceSnapshot.deleteMany({});
      await prisma.lowAttendanceRecord.deleteMany({});
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

    it("GET /api/messages/pending usa withTenantContext na recuperação/claim, mantém elegível legado nulo, rejeita divergentes e isola concorrência", async () => {
      const now = Date.now();
      const tenMinutesAgo = new Date(now - 10 * 60_000);
      const oneMinuteAgo = new Date(now - 60_000);

      await prisma.messageLog.createMany({
        data: [
          {
            id: "q-alpha-1",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Fila A1",
            messageContent: "Msg A1",
            phoneUsed: "41999991111",
            sentByName: "Equipe A",
            deliveryStatus: "QUEUED",
            sentAt: new Date(now - 40_000),
          },
          {
            id: "q-alpha-legacy-null",
            schoolId: null,
            studentId: "stu-alpha",
            templateId: null,
            reasonTitle: "Legado A",
            messageContent: "Msg Legada A",
            phoneUsed: "41999991111",
            sentByName: "Legado A",
            deliveryStatus: "QUEUED",
            sentAt: new Date(now - 30_000),
          },
          {
            id: "d-alpha-expired",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Expirado A",
            messageContent: "Msg Expirada A",
            phoneUsed: "41999991111",
            sentByName: "Equipe A",
            deliveryStatus: "DISPATCHING",
            deliveryUpdatedAt: tenMinutesAgo,
            sentAt: tenMinutesAgo,
          },
          {
            id: "d-alpha-valid",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Válido A",
            messageContent: "Msg Válida A",
            phoneUsed: "41999991111",
            sentByName: "Equipe A",
            deliveryStatus: "DISPATCHING",
            deliveryUpdatedAt: oneMinuteAgo,
            sentAt: oneMinuteAgo,
          },
          {
            id: "q-divergent-log-b-stu-a",
            schoolId: "school-beta",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Divergente 1",
            messageContent: "Divergente 1",
            phoneUsed: "41999991111",
            sentByName: "Teste",
            deliveryStatus: "QUEUED",
            sentAt: new Date(now - 20_000),
          },
          {
            id: "q-divergent-log-a-stu-b",
            schoolId: "school-alpha",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Divergente 2",
            messageContent: "Divergente 2",
            phoneUsed: "41999992222",
            sentByName: "Teste",
            deliveryStatus: "QUEUED",
            sentAt: new Date(now - 10_000),
          },
          {
            id: "q-beta-1",
            schoolId: "school-beta",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Fila B1",
            messageContent: "Msg B1",
            phoneUsed: "41999992222",
            sentByName: "Equipe B",
            deliveryStatus: "QUEUED",
            sentAt: new Date(now - 35_000),
          },
          {
            id: "d-beta-expired",
            schoolId: "school-beta",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Expirado B",
            messageContent: "Msg Expirada B",
            phoneUsed: "41999992222",
            sentByName: "Equipe B",
            deliveryStatus: "DISPATCHING",
            deliveryUpdatedAt: tenMinutesAgo,
            sentAt: tenMinutesAgo,
          },
        ],
      });

      try {
        // 1. Credencial de A via token recupera expirado de A e reclama apenas elegíveis de A (incluindo legado nulo)
        testAuthState.pendingTokenSchoolId = "school-alpha";
        const resA = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=10", {
            headers: { "x-sync-token": "token-alpha" },
          })
        );
        expect(resA.status).toBe(200);
        const bodyA = await resA.json();
        const idsA = bodyA.messages.map((m: { id: string }) => m.id).sort();
        expect(idsA).toEqual(["d-alpha-expired", "q-alpha-1", "q-alpha-legacy-null"]);

        // Itens de B, DISPATCHING válido de A e divergentes permanecem intactos
        expect((await prisma.messageLog.findUnique({ where: { id: "d-alpha-valid" } }))?.deliveryStatus).toBe(
          "DISPATCHING"
        );
        expect((await prisma.messageLog.findUnique({ where: { id: "q-beta-1" } }))?.deliveryStatus).toBe("QUEUED");
        expect((await prisma.messageLog.findUnique({ where: { id: "d-beta-expired" } }))?.deliveryStatus).toBe(
          "DISPATCHING"
        );
        expect(
          (await prisma.messageLog.findUnique({ where: { id: "q-divergent-log-b-stu-a" } }))?.deliveryStatus
        ).toBe("QUEUED");
        expect(
          (await prisma.messageLog.findUnique({ where: { id: "q-divergent-log-a-stu-b" } }))?.deliveryStatus
        ).toBe("QUEUED");

        // 2. Concorrência: 2 chamadas simultâneas para A (limit=2 com 3 itens) e chamada simultânea para B
        await prisma.messageLog.updateMany({
          where: { id: { in: ["q-alpha-1", "q-alpha-legacy-null", "d-alpha-expired"] } },
          data: { deliveryStatus: "QUEUED", deliveryUpdatedAt: new Date(now - 5_000) },
        });

        const [resConcA1, resConcA2] = await Promise.all([
          getPendingMessagesHandler(
            new Request("http://127.0.0.1/api/messages/pending?limit=2", {
              headers: { "x-sync-token": "token-alpha" },
            })
          ),
          getPendingMessagesHandler(
            new Request("http://127.0.0.1/api/messages/pending?limit=2", {
              headers: { "x-sync-token": "token-alpha" },
            })
          ),
        ]);
        expect(resConcA1.status).toBe(200);
        expect(resConcA2.status).toBe(200);
        const [bodyConcA1, bodyConcA2] = await Promise.all([resConcA1.json(), resConcA2.json()]);
        const concIdsA1 = bodyConcA1.messages.map((m: { id: string }) => m.id);
        const concIdsA2 = bodyConcA2.messages.map((m: { id: string }) => m.id);
        expect(concIdsA1.length).toBeLessThanOrEqual(2);
        expect(concIdsA2.length).toBeLessThanOrEqual(2);
        const unionA = new Set([...concIdsA1, ...concIdsA2]);
        expect(unionA.size).toBe(concIdsA1.length + concIdsA2.length);
        expect(Array.from(unionA).sort()).toEqual(["d-alpha-expired", "q-alpha-1", "q-alpha-legacy-null"]);

        // Chamadas concorrentes de A e B isoladas
        await prisma.messageLog.update({
          where: { id: "q-alpha-1" },
          data: { deliveryStatus: "QUEUED" },
        });
        const actualExtAuth = await import("@/lib/extensionSyncAuth");
        vi.mocked(actualExtAuth.authenticateExtensionSyncToken)
          .mockResolvedValueOnce({
            ok: true,
            targetSchoolId: "school-alpha",
            userName: "Companion A",
          } as never)
          .mockResolvedValueOnce({
            ok: true,
            targetSchoolId: "school-beta",
            userName: "Companion B",
          } as never);

        const [isoA, isoB] = await Promise.all([
          getPendingMessagesHandler(
            new Request("http://127.0.0.1/api/messages/pending?limit=5", {
              headers: { "x-sync-token": "token-a" },
            })
          ),
          getPendingMessagesHandler(
            new Request("http://127.0.0.1/api/messages/pending?limit=5", {
              headers: { "x-sync-token": "token-b" },
            })
          ),
        ]);
        const bodyIsoA = await isoA.json();
        const bodyIsoB = await isoB.json();
        expect(bodyIsoA.schoolId).toBe("school-alpha");
        expect(bodyIsoA.messages.map((m: { id: string }) => m.id)).toEqual(["q-alpha-1"]);
        expect(bodyIsoB.schoolId).toBe("school-beta");
        expect(bodyIsoB.messages.map((m: { id: string }) => m.id).sort()).toEqual([
          "d-beta-expired",
          "q-beta-1",
        ]);

        // 3. Contexto app.current_school_id ativo na transação + rollback em falha após recuperação e antes do commit
        await prisma.messageLog.update({
          where: { id: "d-alpha-expired" },
          data: { deliveryStatus: "DISPATCHING", deliveryUpdatedAt: tenMinutesAgo },
        });
        await prisma.messageLog.update({
          where: { id: "q-alpha-1" },
          data: { deliveryStatus: "QUEUED" },
        });

        const observedContextSettings: Array<string | null> = [];
        const originalTx = prisma.$transaction.bind(prisma);
        const txSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: unknown, opts?: unknown) => {
          if (typeof fn === "function") {
            return originalTx(async (tx) => {
              await (fn as (client: unknown) => Promise<unknown>)(tx);
              const rows = await tx.$queryRaw<Array<{ val: string | null }>>`
                SELECT current_setting('app.current_school_id', true) AS val
              `;
              observedContextSettings.push(rows[0]?.val ?? null);
              throw new Error("Simulated failure after recovery/claim before commit");
            }, opts as Parameters<typeof originalTx>[1]);
          }
          return originalTx(fn as Parameters<typeof originalTx>[0]);
        }) as typeof prisma.$transaction);

        try {
          const resRollback = await getPendingMessagesHandler(
            new Request("http://127.0.0.1/api/messages/pending?limit=5", {
              headers: { "x-sync-token": "token-alpha" },
            })
          );
          expect(resRollback.status).toBe(500);
          expect(observedContextSettings).toEqual(["school-alpha"]);

          // Rollback preservou os estados anteriores (nenhum item devolvido como reservado)
          expect((await prisma.messageLog.findUnique({ where: { id: "d-alpha-expired" } }))?.deliveryStatus).toBe(
            "DISPATCHING"
          );
          expect((await prisma.messageLog.findUnique({ where: { id: "q-alpha-1" } }))?.deliveryStatus).toBe("QUEUED");
        } finally {
          txSpy.mockRestore();
        }
      } finally {
        testAuthState.pendingTokenSchoolId = null;
      }
    });

    it("fecha autorização de GET /api/messages/pending para sessão (papel, vínculo revogado, SUPERADMIN), token por escola, token global e precedência", async () => {
      const { hashSchoolSyncToken } = await import("@/lib/syncToken");
      const now = Date.now();
      const tenMinutesAgo = new Date(now - 10 * 60_000);

      // Limpa usuários/vínculos sintéticos e prepara tokens e usuários reais no PostgreSQL 16
      await prisma.userSchool.deleteMany({});
      await prisma.user.deleteMany({});

      const tokenAlphaPlain = "sync-alpha-secret-token";
      const tokenBetaPlain = "sync-beta-secret-token";
      await prisma.school.update({
        where: { id: "school-alpha" },
        data: { syncTokenHash: hashSchoolSyncToken(tokenAlphaPlain), active: true },
      });
      await prisma.school.update({
        where: { id: "school-beta" },
        data: { syncTokenHash: hashSchoolSyncToken(tokenBetaPlain), active: true },
      });
      await prisma.school.create({
        data: {
          id: "school-inactive",
          inepCode: "99000199",
          name: "Escola Inativa",
          city: "Cidade Teste",
          state: "PR",
          nre: "NRE Teste",
          network: "MUNICIPAL",
          active: false,
        },
      });

      await prisma.user.createMany({
        data: [
          {
            id: "u-pedagoga-a",
            email: "pedagoga.a@redeativa.local",
            name: "Pedagoga A",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "u-professor-a",
            email: "professor.a@redeativa.local",
            name: "Professor A",
            role: "PROFESSOR",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "u-revoked-a",
            email: "revoked.a@redeativa.local",
            name: "Revogado A",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "u-superadmin",
            email: "super.queue@redeativa.local",
            name: "Super Queue",
            role: "SUPERADMIN",
            schoolId: null,
            active: true,
          },
        ],
      });

      await prisma.userSchool.createMany({
        data: [
          { userId: "u-pedagoga-a", schoolId: "school-alpha", role: "PEDAGOGA", active: true },
          { userId: "u-professor-a", schoolId: "school-alpha", role: "PROFESSOR", active: true },
          { userId: "u-revoked-a", schoolId: "school-alpha", role: "PEDAGOGA", active: false },
        ],
      });

      const seedQueueItems = async () => {
        await prisma.messageLog.deleteMany({});
        await prisma.messageLog.createMany({
          data: [
            {
              id: "auth-q-alpha",
              schoolId: "school-alpha",
              studentId: "stu-alpha",
              templateId: "tpl-alpha",
              reasonTitle: "Fila A",
              messageContent: "Msg A",
              phoneUsed: "41999991111",
              sentByName: "Equipe A",
              deliveryStatus: "QUEUED",
              sentAt: new Date(now - 20_000),
            },
            {
              id: "auth-d-alpha-exp",
              schoolId: "school-alpha",
              studentId: "stu-alpha",
              templateId: "tpl-alpha",
              reasonTitle: "Exp A",
              messageContent: "Msg Exp A",
              phoneUsed: "41999991111",
              sentByName: "Equipe A",
              deliveryStatus: "DISPATCHING",
              deliveryUpdatedAt: tenMinutesAgo,
              sentAt: tenMinutesAgo,
            },
            {
              id: "auth-q-beta",
              schoolId: "school-beta",
              studentId: "stu-beta",
              templateId: "tpl-beta",
              reasonTitle: "Fila B",
              messageContent: "Msg B",
              phoneUsed: "41999992222",
              sentByName: "Equipe B",
              deliveryStatus: "QUEUED",
              sentAt: new Date(now - 20_000),
            },
          ],
        });
      };

      const assertNoQueueMutation = async () => {
        expect((await prisma.messageLog.findUnique({ where: { id: "auth-q-alpha" } }))?.deliveryStatus).toBe("QUEUED");
        expect((await prisma.messageLog.findUnique({ where: { id: "auth-d-alpha-exp" } }))?.deliveryStatus).toBe(
          "DISPATCHING"
        );
        expect((await prisma.messageLog.findUnique({ where: { id: "auth-q-beta" } }))?.deliveryStatus).toBe("QUEUED");
      };

      const prevSyncToken = process.env.SYNC_API_TOKEN;
      process.env.SYNC_API_TOKEN = "global-admin-sync-secret";
      testAuthState.useRealCurrentSchool = true;
      testAuthState.useRealExtensionSyncAuth = true;

      try {
        await seedQueueItems();

        // 1. Sessão sem permissão de operação (PROFESSOR) -> 403, nada recuperado/reservado
        testAuthState.pendingSessionUser = { id: "u-professor-a", email: "professor.a@redeativa.local", active: true };
        const resProf = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5")
        );
        expect(resProf.status).toBe(403);
        await assertNoQueueMutation();

        // 2. Vínculo revogado (UserSchool.active = false) -> 403, nada recuperado/reservado
        testAuthState.pendingSessionUser = { id: "u-revoked-a", email: "revoked.a@redeativa.local", active: true };
        const resRevoked = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5")
        );
        expect(resRevoked.status).toBe(403);
        await assertNoQueueMutation();

        // 3. SUPERADMIN sem escola selecionada (fallback de leitura bloqueado) -> 403, nada recuperado/reservado
        testAuthState.pendingSessionUser = { id: "u-superadmin", email: "super.queue@redeativa.local", active: true };
        const resSuperNoSchool = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5")
        );
        expect(resSuperNoSchool.status).toBe(403);
        await assertNoQueueMutation();

        // 4. Sessão e token simultâneos: sessão sem permissão + token válido -> 403 (precedência da sessão, sem fallback ao token)
        testAuthState.pendingSessionUser = { id: "u-professor-a", email: "professor.a@redeativa.local", active: true };
        const resBothUnauthorized = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5", {
            headers: { "x-sync-token": tokenAlphaPlain },
          })
        );
        expect(resBothUnauthorized.status).toBe(403);
        await assertNoQueueMutation();

        // 5. Sessão autorizada (PEDAGOGA em school-alpha) + token de school-beta -> usa school-alpha da sessão
        testAuthState.pendingSessionUser = { id: "u-pedagoga-a", email: "pedagoga.a@redeativa.local", active: true };
        const resBothAuthorized = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5", {
            headers: { "x-sync-token": tokenBetaPlain },
          })
        );
        expect(resBothAuthorized.status).toBe(200);
        const bodySessionWins = await resBothAuthorized.json();
        expect(bodySessionWins.schoolId).toBe("school-alpha");
        expect(bodySessionWins.messages.map((m: { id: string }) => m.id).sort()).toEqual([
          "auth-d-alpha-exp",
          "auth-q-alpha",
        ]);
        expect((await prisma.messageLog.findUnique({ where: { id: "auth-q-beta" } }))?.deliveryStatus).toBe("QUEUED");

        // 6. Token por escola com indicação conflitante (schoolId=school-beta e x-school-id=school-beta) -> ignora conflito e usa school-alpha
        await seedQueueItems();
        testAuthState.pendingSessionUser = null;
        testAuthState.pendingTokenSchoolId = "active-token-mode"; // força auth() a retornar null
        const resSchoolTokenConflict = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5&schoolId=school-beta", {
            headers: {
              "x-sync-token": tokenAlphaPlain,
              "x-school-id": "school-beta",
            },
          })
        );
        expect(resSchoolTokenConflict.status).toBe(200);
        const bodySchoolToken = await resSchoolTokenConflict.json();
        expect(bodySchoolToken.schoolId).toBe("school-alpha");
        expect(bodySchoolToken.messages.map((m: { id: string }) => m.id).sort()).toEqual([
          "auth-d-alpha-exp",
          "auth-q-alpha",
        ]);
        expect((await prisma.messageLog.findUnique({ where: { id: "auth-q-beta" } }))?.deliveryStatus).toBe("QUEUED");

        // 7. Token administrativo global: sem schoolId -> 400; escola inativa -> 404; escola ativa -> 200
        await seedQueueItems();
        const resGlobalMissing = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5", {
            headers: { authorization: "Bearer global-admin-sync-secret" },
          })
        );
        expect(resGlobalMissing.status).toBe(400);
        await assertNoQueueMutation();

        const resGlobalInactive = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5&schoolId=school-inactive", {
            headers: { authorization: "Bearer global-admin-sync-secret" },
          })
        );
        expect(resGlobalInactive.status).toBe(404);
        await assertNoQueueMutation();

        const resGlobalActive = await getPendingMessagesHandler(
          new Request("http://127.0.0.1/api/messages/pending?limit=5&schoolId=school-beta", {
            headers: { authorization: "Bearer global-admin-sync-secret" },
          })
        );
        expect(resGlobalActive.status).toBe(200);
        const bodyGlobalBeta = await resGlobalActive.json();
        expect(bodyGlobalBeta.schoolId).toBe("school-beta");
        expect(bodyGlobalBeta.messages.map((m: { id: string }) => m.id)).toEqual(["auth-q-beta"]);
        expect((await prisma.messageLog.findUnique({ where: { id: "auth-q-alpha" } }))?.deliveryStatus).toBe("QUEUED");
      } finally {
        if (prevSyncToken === undefined) {
          delete process.env.SYNC_API_TOKEN;
        } else {
          process.env.SYNC_API_TOKEN = prevSyncToken;
        }
        testAuthState.useRealCurrentSchool = false;
        testAuthState.useRealExtensionSyncAuth = false;
        testAuthState.pendingSessionUser = null;
        testAuthState.pendingTokenSchoolId = null;
        await prisma.messageLog.deleteMany({});
        await prisma.userSchool.deleteMany({});
        await prisma.user.deleteMany({});
        await prisma.school.deleteMany({ where: { id: "school-inactive" } });
      }
    });

    it("integra withTenantContext em PATCH /api/messages/status e POST /api/messages/reply com coerência Fase A, hash, atomicidade e rollback", async () => {
      const { computeMessageContentHash } = await import("@/lib/messageCrypto");
      const sentAt = new Date("2026-11-26T12:00:00.000Z");

      const hashAlpha = computeMessageContentHash({
        studentId: "stu-alpha",
        schoolId: "school-alpha",
        phoneUsed: "41999991111",
        reasonTitle: "Falta",
        messageContent: "Msg Alpha",
        sentByName: "Equipe A",
        sentAt,
      });
      const hashBeta = computeMessageContentHash({
        studentId: "stu-beta",
        schoolId: "school-beta",
        phoneUsed: "41999992222",
        reasonTitle: "Falta",
        messageContent: "Msg Beta",
        sentByName: "Equipe B",
        sentAt,
      });
      const hashLegacy = computeMessageContentHash({
        studentId: "stu-alpha",
        schoolId: "school-alpha",
        phoneUsed: "41999991111",
        reasonTitle: "Legado",
        messageContent: "Msg Legada",
        sentByName: "Legado",
        sentAt,
      });

      await prisma.studentContact.create({
        data: {
          id: "contact-alpha-1",
          studentId: "stu-alpha",
          name: "Responsável Alpha",
          kinship: "MAE",
          phone: "41999991111",
          whatsappValid: true,
        },
      });

      await prisma.messageLog.createMany({
        data: [
          {
            id: "sr-alpha-ok",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Falta",
            messageContent: "Msg Alpha",
            phoneUsed: "41999991111",
            sentByName: "Equipe A",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashAlpha,
          },
          {
            id: "sr-alpha-legacy",
            schoolId: null,
            studentId: "stu-alpha",
            templateId: null,
            reasonTitle: "Legado",
            messageContent: "Msg Legada",
            phoneUsed: "41999991111",
            sentByName: "Legado",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashLegacy,
          },
          {
            id: "sr-beta-ok",
            schoolId: "school-beta",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Falta",
            messageContent: "Msg Beta",
            phoneUsed: "41999992222",
            sentByName: "Equipe B",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashBeta,
          },
          {
            id: "sr-divergent",
            schoolId: "school-beta",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Divergente",
            messageContent: "Msg Divergente",
            phoneUsed: "41999991111",
            sentByName: "Teste",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashAlpha,
          },
        ],
      });

      try {
        // 1. Atualização legítima de status (FAILED_NO_WHATSAPP invalida StudentContact na mesma Tx)
        testAuthState.schoolId = "school-alpha";
        testAuthState.role = "PEDAGOGA";
        const resStatusOk = await patchMessageStatusHandler(
          new Request("http://127.0.0.1/api/messages/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logId: "sr-alpha-ok", deliveryStatus: "FAILED_NO_WHATSAPP" }),
          })
        );
        expect(resStatusOk.status).toBe(200);
        expect((await prisma.messageLog.findUnique({ where: { id: "sr-alpha-ok" } }))?.deliveryStatus).toBe(
          "FAILED_NO_WHATSAPP"
        );
        expect((await prisma.studentContact.findUnique({ where: { id: "contact-alpha-1" } }))?.whatsappValid).toBe(
          false
        );

        // 2. Retorno legítimo (revalida StudentContact para true e atualiza hash bipartido)
        const repliedAtIso = "2026-11-26T13:00:00.000Z";
        const resReplyOk = await postMessageReplyHandler(
          new Request("http://127.0.0.1/api/messages/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              logId: "sr-alpha-ok",
              guardianReplied: true,
              replyNotes: "Responsável justificou ausência",
              replyCategory: "SAUDE",
              extractedAt: repliedAtIso,
            }),
          })
        );
        expect(resReplyOk.status).toBe(200);
        const rowAfterReply = await prisma.messageLog.findUnique({ where: { id: "sr-alpha-ok" } });
        expect(rowAfterReply?.guardianReplied).toBe(true);
        const expectedReplyHash = computeMessageContentHash({
          studentId: "stu-alpha",
          schoolId: "school-alpha",
          phoneUsed: "41999991111",
          reasonTitle: "Falta",
          messageContent: "Msg Alpha",
          sentByName: "Equipe A",
          sentAt,
          guardianReplied: true,
          replyNotes: "Responsável justificou ausência",
          replyCategory: "SAUDE",
          repliedAt: new Date(repliedAtIso),
        });
        expect(rowAfterReply?.contentHash).toBe(expectedReplyHash);
        expect((await prisma.studentContact.findUnique({ where: { id: "contact-alpha-1" } }))?.whatsappValid).toBe(
          true
        );

        // 3. Log legado com schoolId nulo (aluno de school-alpha) aceito em status e reply
        const resLegacyStatus = await patchMessageStatusHandler(
          new Request("http://127.0.0.1/api/messages/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logId: "sr-alpha-legacy", deliveryStatus: "SENT" }),
          })
        );
        expect(resLegacyStatus.status).toBe(200);
        const resLegacyReply = await postMessageReplyHandler(
          new Request("http://127.0.0.1/api/messages/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              logId: "sr-alpha-legacy",
              guardianReplied: true,
              replyNotes: "Confirmado legado",
              replyCategory: "TRANSPORTE",
              extractedAt: repliedAtIso,
            }),
          })
        );
        expect(resLegacyReply.status).toBe(200);
        const legacyRow = await prisma.messageLog.findUnique({ where: { id: "sr-alpha-legacy" } });
        expect(legacyRow?.schoolId).toBeNull();
        expect(legacyRow?.deliveryStatus).toBe("READ");
        expect(legacyRow?.guardianReplied).toBe(true);

        // 4. Negativas: log de outra escola (sr-beta-ok) e log divergente (sr-divergent) -> 403 sem mutação
        for (const badId of ["sr-beta-ok", "sr-divergent"]) {
          const rStatus = await patchMessageStatusHandler(
            new Request("http://127.0.0.1/api/messages/status", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ logId: badId, deliveryStatus: "READ" }),
            })
          );
          expect(rStatus.status).toBe(403);

          const rReply = await postMessageReplyHandler(
            new Request("http://127.0.0.1/api/messages/reply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                logId: badId,
                guardianReplied: true,
                replyNotes: "Invasão",
                replyCategory: "SAUDE",
              }),
            })
          );
          expect(rReply.status).toBe(403);

          const untouched = await prisma.messageLog.findUnique({ where: { id: badId } });
          expect(untouched?.deliveryStatus).toBe("SENT");
          expect(untouched?.guardianReplied).toBe(false);
          expect(untouched?.contentHash).toBe(badId === "sr-beta-ok" ? hashBeta : hashAlpha);
        }

        // 5. Sessão sem permissão (PROFESSOR) -> 403 antes da transação
        testAuthState.role = "PROFESSOR";
        const resProfStatus = await patchMessageStatusHandler(
          new Request("http://127.0.0.1/api/messages/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logId: "sr-alpha-ok", deliveryStatus: "DELIVERED" }),
          })
        );
        expect(resProfStatus.status).toBe(403);
        const resProfReply = await postMessageReplyHandler(
          new Request("http://127.0.0.1/api/messages/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              logId: "sr-alpha-ok",
              guardianReplied: false,
            }),
          })
        );
        expect(resProfReply.status).toBe(403);
        expect((await prisma.messageLog.findUnique({ where: { id: "sr-alpha-ok" } }))?.guardianReplied).toBe(true);

        // 6. Contexto app.current_school_id ativo + rollback pré-commit reverte MessageLog e StudentContact
        testAuthState.role = "PEDAGOGA";
        const observedSettings: Array<string | null> = [];
        const originalTx = prisma.$transaction.bind(prisma);
        const txSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: unknown, opts?: unknown) => {
          if (typeof fn === "function") {
            return originalTx(async (tx) => {
              await (fn as (client: unknown) => Promise<unknown>)(tx);
              const rows = await tx.$queryRaw<Array<{ val: string | null }>>`
                SELECT current_setting('app.current_school_id', true) AS val
              `;
              observedSettings.push(rows[0]?.val ?? null);
              throw new Error("Simulated pre-commit failure on status update");
            }, opts as Parameters<typeof originalTx>[1]);
          }
          return originalTx(fn as Parameters<typeof originalTx>[0]);
        }) as typeof prisma.$transaction);

        try {
          const resRollbackStatus = await patchMessageStatusHandler(
            new Request("http://127.0.0.1/api/messages/status", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ logId: "sr-alpha-ok", deliveryStatus: "DELIVERED" }),
            })
          );
          expect(resRollbackStatus.status).toBe(500);
          expect(observedSettings).toEqual(["school-alpha"]);
          expect((await prisma.messageLog.findUnique({ where: { id: "sr-alpha-ok" } }))?.deliveryStatus).toBe(
            "FAILED_NO_WHATSAPP"
          );
          expect((await prisma.studentContact.findUnique({ where: { id: "contact-alpha-1" } }))?.whatsappValid).toBe(
            true
          );
        } finally {
          txSpy.mockRestore();
        }

        // 7. Requisição de A sobre log de B é recusada (403) sem bloquear no row lock de B (mesmo com B bloqueado em outra Tx)
        const releaseBetaLock = await new Promise<() => void>((resolveLockHeld) => {
          let releaseFn!: () => void;
          const lockReady = new Promise<void>((r) => {
            releaseFn = r;
          });
          void prisma.$transaction(async (txB) => {
            await txB.$queryRaw`SELECT "id" FROM "MessageLog" WHERE "id" = 'sr-beta-ok' FOR UPDATE`;
            resolveLockHeld(releaseFn);
            await lockReady;
          });
        });
        try {
          const rStatusNoBlock = await patchMessageStatusHandler(
            new Request("http://127.0.0.1/api/messages/status", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ logId: "sr-beta-ok", deliveryStatus: "DELIVERED" }),
            })
          );
          expect(rStatusNoBlock.status).toBe(403);
          const rReplyNoBlock = await postMessageReplyHandler(
            new Request("http://127.0.0.1/api/messages/reply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ logId: "sr-beta-ok", guardianReplied: false }),
            })
          );
          expect(rReplyNoBlock.status).toBe(403);
          expect((await prisma.messageLog.findUnique({ where: { id: "sr-beta-ok" } }))?.deliveryStatus).toBe("SENT");
        } finally {
          releaseBetaLock();
        }

        // 8. Estudante de A associado a turma de B -> 403 antes de alterar MessageLog ou StudentContact, sem auditoria
        await prisma.classGroup.update({
          where: { id: "cg-beta" },
          data: { name: "Turma Secreta B" },
        });
        await prisma.student.create({
          data: {
            id: "stu-alpha-turma-b",
            schoolId: "school-alpha",
            classGroupId: "cg-beta",
            name: "Estudante A Turma B",
            phone: "41999996666",
          },
        });
        await prisma.studentContact.create({
          data: {
            id: "contact-alpha-tb",
            studentId: "stu-alpha-turma-b",
            name: "Responsável TB",
            kinship: "MAE",
            phone: "41999996666",
            whatsappValid: true,
          },
        });
        await prisma.messageLog.create({
          data: {
            id: "sr-alpha-turma-b",
            schoolId: "school-alpha",
            studentId: "stu-alpha-turma-b",
            templateId: "tpl-alpha",
            reasonTitle: "Falta",
            messageContent: "Msg TB",
            phoneUsed: "41999996666",
            sentByName: "Equipe A",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashAlpha,
          },
        });

        vi.mocked(logAudit).mockClear();
        const resCrossCgStatus = await patchMessageStatusHandler(
          new Request("http://127.0.0.1/api/messages/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logId: "sr-alpha-turma-b", deliveryStatus: "FAILED_NO_WHATSAPP" }),
          })
        );
        expect(resCrossCgStatus.status).toBe(403);
        const crossCgBody = await resCrossCgStatus.json();
        expect(crossCgBody.error).not.toContain("Turma Secreta B");
        expect(crossCgBody.error).not.toContain("cg-beta");
        expect((await prisma.messageLog.findUnique({ where: { id: "sr-alpha-turma-b" } }))?.deliveryStatus).toBe(
          "SENT"
        );
        expect((await prisma.studentContact.findUnique({ where: { id: "contact-alpha-tb" } }))?.whatsappValid).toBe(
          true
        );
        expect(
          vi.mocked(logAudit).mock.calls.find((c) => c[0]?.action === "UPDATE_DELIVERY_STATUS")
        ).toBeUndefined();
      } finally {
        testAuthState.role = "PEDAGOGA";
        testAuthState.schoolId = "school-alpha";
        await prisma.studentContact.deleteMany({ where: { id: { in: ["contact-alpha-1", "contact-alpha-tb"] } } });
      }
    });

    it("integra withTenantContext em PUT e DELETE /api/messages/manage com RBAC de gestão, bloqueio filtrado, turma validada, hash e rollback", async () => {
      const { computeMessageContentHash } = await import("@/lib/messageCrypto");
      const sentAt = new Date("2026-11-26T12:00:00.000Z");

      await prisma.userSchool.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.user.createMany({
        data: [
          {
            id: "mgr-gestor-a",
            email: "gestor.a@redeativa.local",
            name: "Gestor Alpha",
            role: "GESTOR_ESCOLAR",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "mgr-pedagoga-a",
            email: "pedagoga.mgr@redeativa.local",
            name: "Pedagoga Alpha",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "mgr-superadmin",
            email: "super.mgr@redeativa.local",
            name: "Superadmin Mgr",
            role: "SUPERADMIN",
            schoolId: null,
            active: true,
          },
        ],
      });
      await prisma.userSchool.createMany({
        data: [
          { userId: "mgr-gestor-a", schoolId: "school-alpha", role: "GESTOR_ESCOLAR", active: true },
          { userId: "mgr-pedagoga-a", schoolId: "school-alpha", role: "PEDAGOGA", active: true },
        ],
      });

      await prisma.student.create({
        data: {
          id: "stu-alpha-turma-b-mgr",
          schoolId: "school-alpha",
          classGroupId: "cg-beta",
          name: "Estudante A Turma B",
          phone: "41999997777",
        },
      });

      const hashAlpha = computeMessageContentHash({
        studentId: "stu-alpha",
        schoolId: "school-alpha",
        phoneUsed: "41999991111",
        reasonTitle: "Falta",
        messageContent: "Msg Alpha Original",
        sentByName: "Equipe A",
        sentAt,
      });
      const hashBeta = computeMessageContentHash({
        studentId: "stu-beta",
        schoolId: "school-beta",
        phoneUsed: "41999992222",
        reasonTitle: "Falta B",
        messageContent: "Msg Beta Original",
        sentByName: "Equipe B",
        sentAt,
      });

      await prisma.messageLog.createMany({
        data: [
          {
            id: "mgr-alpha-ok",
            schoolId: "school-alpha",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Falta",
            messageContent: "Msg Alpha Original",
            phoneUsed: "41999991111",
            sentByName: "Equipe A",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashAlpha,
          },
          {
            id: "mgr-alpha-legacy",
            schoolId: null,
            studentId: "stu-alpha",
            templateId: null,
            reasonTitle: "Legado",
            messageContent: "Msg Legada",
            phoneUsed: "41999991111",
            sentByName: "Legado",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashAlpha,
          },
          {
            id: "mgr-beta-ok",
            schoolId: "school-beta",
            studentId: "stu-beta",
            templateId: "tpl-beta",
            reasonTitle: "Falta B",
            messageContent: "Msg Beta Original",
            phoneUsed: "41999992222",
            sentByName: "Equipe B",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashBeta,
          },
          {
            id: "mgr-divergent",
            schoolId: "school-beta",
            studentId: "stu-alpha",
            templateId: "tpl-alpha",
            reasonTitle: "Divergente",
            messageContent: "Msg Divergente",
            phoneUsed: "41999991111",
            sentByName: "Teste",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashAlpha,
          },
          {
            id: "mgr-alpha-turma-b",
            schoolId: "school-alpha",
            studentId: "stu-alpha-turma-b-mgr",
            templateId: "tpl-alpha",
            reasonTitle: "Turma B",
            messageContent: "Msg Turma B",
            phoneUsed: "41999997777",
            sentByName: "Equipe A",
            sentAt,
            deliveryStatus: "SENT",
            contentHash: hashAlpha,
          },
        ],
      });

      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;
      testAuthState.useRealExtensionSyncAuth = true;

      try {
        // 1. Sessão sem permissão de gestão (PEDAGOGA) -> 403 em PUT e DELETE, sem auditoria
        testAuthState.pendingSessionUser = { id: "mgr-pedagoga-a", email: "pedagoga.mgr@redeativa.local", active: true };
        vi.mocked(logAudit).mockClear();
        const rPedPut = await putMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "mgr-alpha-ok", reasonTitle: "Editado" }),
          })
        );
        expect(rPedPut.status).toBe(403);
        const rPedDel = await deleteMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage?id=mgr-alpha-ok", { method: "DELETE" })
        );
        expect(rPedDel.status).toBe(403);
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // 2. SUPERADMIN sem escola selecionada -> 403 (fallback de leitura desativado)
        testAuthState.pendingSessionUser = { id: "mgr-superadmin", email: "super.mgr@redeativa.local", active: true };
        const rSuperNoSchool = await putMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "mgr-alpha-ok", reasonTitle: "Super sem escola" }),
          })
        );
        expect(rSuperNoSchool.status).toBe(403);

        // 3. SUPERADMIN com school-alpha selecionada tentando PUT/DELETE em mgr-beta-ok -> 403 (acesso cruzado rejeitado)
        testAuthState.pendingSessionUser = {
          id: "mgr-superadmin",
          email: "super.mgr@redeativa.local",
          schoolId: "school-alpha",
          active: true,
        };
        const rSuperCrossPut = await putMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "mgr-beta-ok", reasonTitle: "Invasão Superadmin" }),
          })
        );
        expect(rSuperCrossPut.status).toBe(403);
        const rSuperCrossDel = await deleteMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage?id=mgr-beta-ok", { method: "DELETE" })
        );
        expect(rSuperCrossDel.status).toBe(403);
        expect((await prisma.messageLog.findUnique({ where: { id: "mgr-beta-ok" } }))?.reasonTitle).toBe("Falta B");

        // 4. GESTOR_ESCOLAR de school-alpha: retificação legítima (PUT) + auditoria + hash
        testAuthState.pendingSessionUser = { id: "mgr-gestor-a", email: "gestor.a@redeativa.local", active: true };
        vi.mocked(logAudit).mockClear();
        const rGestorPut = await putMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "mgr-alpha-ok", reasonTitle: "Falta Retificada" }),
          })
        );
        expect(rGestorPut.status).toBe(200);
        const putJson = await rGestorPut.json();
        const rowAfterPut = await prisma.messageLog.findUnique({ where: { id: "mgr-alpha-ok" } });
        const expectedStudent = await prisma.student.findUnique({
          where: { id: "stu-alpha" },
          include: { classGroup: true },
        });
        expect(expectedStudent).not.toBeNull();
        expect(rowAfterPut?.reasonTitle).toBe("Falta Retificada");
        expect(rowAfterPut?.messageContent).toBe("Msg Alpha Original");
        const expectedPutHash = computeMessageContentHash({
          studentId: "stu-alpha",
          schoolId: "school-alpha",
          phoneUsed: "41999991111",
          reasonTitle: "Falta Retificada",
          messageContent: "Msg Alpha Original",
          sentByName: "Equipe A",
          sentAt,
          guardianReplied: false,
          replyNotes: null,
          replyCategory: null,
          repliedAt: null,
        });
        expect(rowAfterPut?.contentHash).toBe(expectedPutHash);
        expect(putJson.success).toBe(true);
        expect(putJson.updated).toMatchObject({
          id: "mgr-alpha-ok",
          schoolId: "school-alpha",
          studentId: "stu-alpha",
          reasonTitle: "Falta Retificada",
          messageContent: "Msg Alpha Original",
          phoneUsed: "41999991111",
          sentByName: "Equipe A",
          contentHash: expectedPutHash,
          student: {
            ...JSON.parse(JSON.stringify(expectedStudent)),
            classGroup: JSON.parse(JSON.stringify(expectedStudent!.classGroup)),
          },
        });
        expect(Object.keys(putJson.updated.student).sort()).toEqual(
          Object.keys(expectedStudent!).sort()
        );
        expect(Object.keys(putJson.updated.student.classGroup).sort()).toEqual(
          Object.keys(expectedStudent!.classGroup).sort()
        );
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "UPDATE_MESSAGE_LOG",
            entityId: "mgr-alpha-ok",
            schoolId: "school-alpha",
          })
        );

        // 5. Log legado (schoolId null) aceito em PUT e DELETE; exclusão legítima + auditoria
        const rLegacyPut = await putMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "mgr-alpha-legacy", reasonTitle: "Legado Retificado" }),
          })
        );
        expect(rLegacyPut.status).toBe(200);
        vi.mocked(logAudit).mockClear();
        const rLegacyDel = await deleteMessageManageHandler(
          new Request("http://127.0.0.1/api/messages/manage?id=mgr-alpha-legacy", { method: "DELETE" })
        );
        expect(rLegacyDel.status).toBe(200);
        expect(await prisma.messageLog.findUnique({ where: { id: "mgr-alpha-legacy" } })).toBeNull();
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "DELETE_MESSAGE_LOG",
            entityId: "mgr-alpha-legacy",
            schoolId: "school-alpha",
          })
        );

        // 6. Negativas: log divergente e estudante de A em turma de B -> 403, intactos e sem auditoria
        for (const badId of ["mgr-divergent", "mgr-alpha-turma-b"]) {
          vi.mocked(logAudit).mockClear();
          const rBadPut = await putMessageManageHandler(
            new Request("http://127.0.0.1/api/messages/manage", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: badId, reasonTitle: "Alteração indevida" }),
            })
          );
          expect(rBadPut.status).toBe(403);
          const badPutJson = await rBadPut.json();
          expect(badPutJson.updated).toBeUndefined();
          expect(typeof badPutJson.error).toBe("string");
          const rBadDel = await deleteMessageManageHandler(
            new Request(`http://127.0.0.1/api/messages/manage?id=${badId}`, { method: "DELETE" })
          );
          expect(rBadDel.status).toBe(403);
          expect(await prisma.messageLog.findUnique({ where: { id: badId } })).not.toBeNull();
          expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
        }

        // 7. Requisição recusada de A sobre B não bloqueia no row lock de B
        const releaseBetaLock = await new Promise<() => void>((resolveLockHeld) => {
          let releaseFn!: () => void;
          const lockReady = new Promise<void>((r) => {
            releaseFn = r;
          });
          void prisma.$transaction(async (txB) => {
            await txB.$queryRaw`SELECT "id" FROM "MessageLog" WHERE "id" = 'mgr-beta-ok' FOR UPDATE`;
            resolveLockHeld(releaseFn);
            await lockReady;
          });
        });
        try {
          const rNoBlock = await putMessageManageHandler(
            new Request("http://127.0.0.1/api/messages/manage", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: "mgr-beta-ok", reasonTitle: "Sem bloqueio" }),
            })
          );
          expect(rNoBlock.status).toBe(403);
        } finally {
          releaseBetaLock();
        }

        // 8. Concorrência PUT + POST /api/messages/reply: hash final coerente com estado persistido
        const repliedAtIso = "2026-11-26T14:00:00.000Z";
        const [rConcPut, rConcReply] = await Promise.all([
          putMessageManageHandler(
            new Request("http://127.0.0.1/api/messages/manage", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: "mgr-alpha-ok", reasonTitle: "Concorrência Final" }),
            })
          ),
          postMessageReplyHandler(
            new Request("http://127.0.0.1/api/messages/reply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                logId: "mgr-alpha-ok",
                guardianReplied: true,
                replyNotes: "Retorno concorrente",
                replyCategory: "SAUDE",
                extractedAt: repliedAtIso,
              }),
            })
          ),
        ]);
        expect(rConcPut.status).toBe(200);
        expect(rConcReply.status).toBe(200);
        const rowConc = await prisma.messageLog.findUnique({ where: { id: "mgr-alpha-ok" } });
        const expectedConcHash = computeMessageContentHash({
          studentId: rowConc!.studentId,
          schoolId: "school-alpha",
          phoneUsed: rowConc!.phoneUsed,
          reasonTitle: rowConc!.reasonTitle,
          messageContent: rowConc!.messageContent,
          sentByName: rowConc!.sentByName,
          sentAt: rowConc!.sentAt,
          guardianReplied: Boolean(rowConc!.guardianReplied),
          replyNotes: rowConc!.replyNotes,
          replyCategory: rowConc!.replyCategory,
          repliedAt: rowConc!.repliedAt,
        });
        expect(rowConc?.contentHash).toBe(expectedConcHash);

        // 9. Rollback pré-commit no DELETE preserva o registro e não emite auditoria
        vi.mocked(logAudit).mockClear();
        const originalTx = prisma.$transaction.bind(prisma);
        const txSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: unknown, opts?: unknown) => {
          if (typeof fn === "function") {
            return originalTx(async (tx) => {
              await (fn as (client: unknown) => Promise<unknown>)(tx);
              throw new Error("Simulated pre-commit failure on manage DELETE");
            }, opts as Parameters<typeof originalTx>[1]);
          }
          return originalTx(fn as Parameters<typeof originalTx>[0]);
        }) as typeof prisma.$transaction);
        try {
          const rDelRollback = await deleteMessageManageHandler(
            new Request("http://127.0.0.1/api/messages/manage?id=mgr-alpha-ok", { method: "DELETE" })
          );
          expect(rDelRollback.status).toBe(500);
          expect(await prisma.messageLog.findUnique({ where: { id: "mgr-alpha-ok" } })).not.toBeNull();
          expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
        } finally {
          txSpy.mockRestore();
        }
      } finally {
        testAuthState.useRealPermissions = false;
        testAuthState.useRealCurrentSchool = false;
        testAuthState.pendingSessionUser = null;
        await prisma.messageLog.deleteMany({});
        await prisma.userSchool.deleteMany({});
        await prisma.user.deleteMany({});
        await prisma.student.deleteMany({ where: { id: "stu-alpha-turma-b-mgr" } });
      }
    });

    it("integra withTenantContext em GET /api/messages com coerência Fase A, exclusão de turma cruzada, filtros, paginação e contrato do Histórico", async () => {
      await prisma.messageLog.deleteMany({});
      await prisma.messageTemplate.deleteMany({});
      await prisma.student.deleteMany({});
      await prisma.classGroup.deleteMany({});
      await prisma.userSchool.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.school.deleteMany({});

      await prisma.school.createMany({
        data: [
          { id: "school-alpha", name: "Escola Alpha", inepCode: "11111111" },
          { id: "school-beta", name: "Escola Beta", inepCode: "22222222" },
        ],
      });
      await prisma.classGroup.createMany({
        data: [
          { id: "cg-alpha-em", name: "1º Ano A", segment: "EM", schoolId: "school-alpha" },
          { id: "cg-alpha-ef", name: "9º Ano B", segment: "EF2", schoolId: "school-alpha" },
          { id: "cg-beta-em", name: "2º Ano B", segment: "EM", schoolId: "school-beta" },
        ],
      });
      await prisma.student.createMany({
        data: [
          {
            id: "stu-alpha-em",
            name: "Estudante Alpha EM",
            cgm: "100100100",
            phone: "41999991111",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-em",
          },
          {
            id: "stu-alpha-ef",
            name: "Estudante Alpha EF",
            cgm: "100100200",
            phone: "41999991112",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-ef",
          },
          {
            id: "stu-alpha-turma-b",
            name: "Estudante Alpha Turma Cruzada",
            cgm: "100100300",
            phone: "41999993333",
            schoolId: "school-alpha",
            classGroupId: "cg-beta-em",
          },
          {
            id: "stu-beta-em",
            name: "Estudante Beta EM",
            cgm: "200200200",
            phone: "41999992222",
            schoolId: "school-beta",
            classGroupId: "cg-beta-em",
          },
        ],
      });

      await prisma.user.createMany({
        data: [
          {
            id: "list-pedagoga-a",
            email: "pedagoga.list@redeativa.local",
            name: "Pedagoga Listagem A",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "list-sem-vinculo",
            email: "sem.vinculo.list@redeativa.local",
            name: "Sem Vinculo",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: true,
          },
        ],
      });
      await prisma.userSchool.create({
        data: {
          id: "us-list-ped-a",
          userId: "list-pedagoga-a",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      });

      const logsData: Array<{
        id: string;
        schoolId: string | null;
        studentId: string;
        reasonTitle: string;
        messageContent: string;
        phoneUsed: string;
        sentByName: string;
        sentAt: Date;
        deliveryStatus: string;
      }> = [];
      // 10 logs coerentes de Alpha (cg-alpha-em), ordenados do mais recente ao mais antigo
      for (let i = 1; i <= 10; i++) {
        const day = String(20 - i).padStart(2, "0"); // 2026-11-19 até 2026-11-10
        logsData.push({
          id: `list-alpha-${i}`,
          schoolId: "school-alpha",
          studentId: "stu-alpha-em",
          reasonTitle: i === 3 ? "Motivo Especial TermoBuscaAlpha" : `Motivo Alpha ${i}`,
          messageContent: `Conteudo Alpha ${i}`,
          phoneUsed: "41999991111",
          sentByName: "Pedagoga Listagem A",
          sentAt: new Date(`2026-11-${day}T12:00:00.000-03:00`),
          deliveryStatus: "SENT",
        });
      }
      // 1 log legado (schoolId: null) de Alpha em cg-alpha-ef (mais antigo -> cai na página 2)
      logsData.push({
        id: "list-alpha-legacy",
        schoolId: null,
        studentId: "stu-alpha-ef",
        reasonTitle: "Motivo Legado Alpha",
        messageContent: "Conteudo Legado",
        phoneUsed: "41999991112",
        sentByName: "Pedagoga Listagem A",
        sentAt: new Date("2026-11-05T10:00:00.000-03:00"),
        deliveryStatus: "DELIVERED",
      });
      // 3 logs excluídos: outra escola, escola divergente, e estudante de Alpha em turma de Beta
      logsData.push(
        {
          id: "list-beta-only",
          schoolId: "school-beta",
          studentId: "stu-beta-em",
          reasonTitle: "Motivo Exclusivo Beta",
          messageContent: "Conteudo Beta",
          phoneUsed: "41999992222",
          sentByName: "Pedagoga Beta",
          sentAt: new Date("2026-11-21T12:00:00.000-03:00"),
          deliveryStatus: "SENT",
        },
        {
          id: "list-divergent",
          schoolId: "school-beta",
          studentId: "stu-alpha-em",
          reasonTitle: "Motivo Divergente Excluido",
          messageContent: "Conteudo Divergente",
          phoneUsed: "41999991111",
          sentByName: "Pedagoga Beta",
          sentAt: new Date("2026-11-22T12:00:00.000-03:00"),
          deliveryStatus: "SENT",
        },
        {
          id: "list-turma-cruzada",
          schoolId: "school-alpha",
          studentId: "stu-alpha-turma-b",
          reasonTitle: "Motivo Turma Cruzada Excluido",
          messageContent: "Conteudo Turma Cruzada",
          phoneUsed: "41999993333",
          sentByName: "Pedagoga Listagem A",
          sentAt: new Date("2026-11-23T12:00:00.000-03:00"),
          deliveryStatus: "SENT",
        }
      );

      await prisma.messageLog.createMany({ data: logsData });

      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;
      testAuthState.useRealExtensionSyncAuth = true;

      const capturedContextSchools: Array<string | null> = [];
      const originalWithTenantContext = rlsTenantContext.withTenantContext;
      const baseWithTenantImpl = (
        client: Parameters<typeof originalWithTenantContext>[0],
        schoolId: string,
        fn: Parameters<typeof originalWithTenantContext>[2]
      ) =>
        originalWithTenantContext(client, schoolId, async (tx) => {
          const [{ val }] = await tx.$queryRaw<Array<{ val: string | null }>>`
            SELECT current_setting('app.current_school_id', true) AS val
          `;
          capturedContextSchools.push(val);
          return fn(tx);
        });
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(baseWithTenantImpl);

      try {
        // 1. Sem sessão -> 401; sessão sem vínculo ativo -> 403
        vi.mocked(auth).mockResolvedValueOnce(null as any);
        const rUnauth = await getMessagesHandler(new Request("http://127.0.0.1/api/messages"));
        expect(rUnauth.status).toBe(401);

        testAuthState.pendingSessionUser = {
          id: "list-sem-vinculo",
          email: "sem.vinculo.list@redeativa.local",
          active: true,
        };
        const rNoLink = await getMessagesHandler(new Request("http://127.0.0.1/api/messages"));
        expect(rNoLink.status).toBe(403);

        // 2. Sessão autorizada de school-alpha (parâmetro schoolId=school-beta na query é ignorado)
        testAuthState.pendingSessionUser = {
          id: "list-pedagoga-a",
          email: "pedagoga.list@redeativa.local",
          active: true,
        };
        capturedContextSchools.length = 0;

        const rPage1 = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?page=1&pageSize=10&schoolId=school-beta")
        );
        expect(rPage1.status).toBe(200);
        const page1Json = await rPage1.json();
        expect(withTenantSpy).toHaveBeenCalled();
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(page1Json.total).toBe(11);
        expect(page1Json.page).toBe(1);
        expect(page1Json.pageSize).toBe(10);
        expect(page1Json.totalPages).toBe(2);
        expect(page1Json.logs).toHaveLength(10);
        // Ordenação decrescente por sentAt e contrato completo de student + classGroup
        expect(page1Json.logs[0].id).toBe("list-alpha-1");
        expect(page1Json.logs[9].id).toBe("list-alpha-10");
        expect(page1Json.logs[0].student).toMatchObject({
          id: "stu-alpha-em",
          name: "Estudante Alpha EM",
          schoolId: "school-alpha",
          classGroup: {
            id: "cg-alpha-em",
            name: "1º Ano A",
            segment: "EM",
            schoolId: "school-alpha",
          },
        });
        const page1Ids = page1Json.logs.map((l: { id: string }) => l.id);
        expect(page1Ids).not.toContain("list-beta-only");
        expect(page1Ids).not.toContain("list-divergent");
        expect(page1Ids).not.toContain("list-turma-cruzada");

        // 3. Página 2 retorna o log legado (schoolId null)
        const rPage2 = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?page=2&pageSize=10")
        );
        expect(rPage2.status).toBe(200);
        const page2Json = await rPage2.json();
        expect(page2Json.total).toBe(11);
        expect(page2Json.page).toBe(2);
        expect(page2Json.totalPages).toBe(2);
        expect(page2Json.logs).toHaveLength(1);
        expect(page2Json.logs[0].id).toBe("list-alpha-legacy");
        expect(page2Json.logs[0].schoolId).toBeNull();
        expect(page2Json.logs[0].student.classGroup.id).toBe("cg-alpha-ef");

        // 4. Página vazia preserva total e totalPages
        const rPageEmpty = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?page=3&pageSize=10")
        );
        expect(rPageEmpty.status).toBe(200);
        const pageEmptyJson = await rPageEmpty.json();
        expect(pageEmptyJson.total).toBe(11);
        expect(pageEmptyJson.page).toBe(3);
        expect(pageEmptyJson.totalPages).toBe(2);
        expect(pageEmptyJson.logs).toEqual([]);

        // 5. Busca textual encontra apenas registro elegível de Alpha e nunca expõe excluídos
        const rSearchAlpha = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?search=TermoBuscaAlpha")
        );
        expect(rSearchAlpha.status).toBe(200);
        const searchAlphaJson = await rSearchAlpha.json();
        expect(searchAlphaJson.total).toBe(1);
        expect(searchAlphaJson.logs[0].id).toBe("list-alpha-3");

        const rSearchExcluded = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?search=Excluido")
        );
        expect(rSearchExcluded.status).toBe(200);
        const searchExcludedJson = await rSearchExcluded.json();
        expect(searchExcludedJson.total).toBe(0);
        expect(searchExcludedJson.logs).toEqual([]);

        // 6. Filtros por turma e segmento respeitam coerência da turma dentro da escola autorizada
        const rTurmaCruzada = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?classGroupId=cg-beta-em")
        );
        expect(rTurmaCruzada.status).toBe(200);
        expect((await rTurmaCruzada.json())).toMatchObject({ total: 0, logs: [] });

        const rTurmaEf = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?classGroupId=cg-alpha-ef")
        );
        expect(rTurmaEf.status).toBe(200);
        const turmaEfJson = await rTurmaEf.json();
        expect(turmaEfJson.total).toBe(1);
        expect(turmaEfJson.logs[0].id).toBe("list-alpha-legacy");

        const rSegEm = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?segment=EM")
        );
        expect(rSegEm.status).toBe(200);
        expect((await rSegEm.json()).total).toBe(10);

        const rSegEf2 = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?segment=EF2")
        );
        expect(rSegEf2.status).toBe(200);
        expect((await rSegEf2.json()).total).toBe(1);

        // 7. Intervalo de datas com deslocamento -03:00
        const rDate = await getMessagesHandler(
          new Request("http://127.0.0.1/api/messages?dateFrom=2026-11-10&dateTo=2026-11-10")
        );
        expect(rDate.status).toBe(200);
        const dateJson = await rDate.json();
        expect(dateJson.total).toBe(1);
        expect(dateJson.logs[0].id).toBe("list-alpha-10");
      } finally {
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = null;
        testAuthState.useRealPermissions = false;
        testAuthState.useRealCurrentSchool = false;
        testAuthState.useRealExtensionSyncAuth = false;
      }
    });

    it("integra withTenantContext em POST /api/webhooks/whatsapp com correlação, ambiguidade >10 candidatos, legado, divergente, hash e rollback", async () => {
      const { computeMessageContentHash } = await import("@/lib/messageCrypto");
      const originalSecret = process.env.WHATSAPP_WEBHOOK_SECRET;

      await prisma.messageLog.deleteMany({});
      await prisma.messageTemplate.deleteMany({});
      await prisma.student.deleteMany({});
      await prisma.classGroup.deleteMany({});
      await prisma.userSchool.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.school.deleteMany({});

      await prisma.school.createMany({
        data: [
          { id: "school-alpha", name: "Escola Alpha", inepCode: "11111111" },
          { id: "school-beta", name: "Escola Beta", inepCode: "22222222" },
        ],
      });
      await prisma.classGroup.createMany({
        data: [
          { id: "cg-alpha-wh", name: "1º Ano A", segment: "EM", schoolId: "school-alpha" },
          { id: "cg-beta-wh", name: "2º Ano B", segment: "EM", schoolId: "school-beta" },
        ],
      });
      await prisma.student.createMany({
        data: [
          {
            id: "stu-alpha-wh",
            name: "Lucas Alpha",
            cgm: "300100100",
            phone: "41988881111",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-wh",
          },
          {
            id: "stu-alpha-single",
            name: "Mariana Unica",
            cgm: "300100200",
            phone: "41977771111",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-wh",
          },
          {
            id: "stu-beta-wh",
            name: "Ana Beta",
            cgm: "300200200",
            phone: "41988881111",
            schoolId: "school-beta",
            classGroupId: "cg-beta-wh",
          },
        ],
      });

      const baseSentAt = new Date("2026-11-25T12:00:00.000Z");
      const singleHash = computeMessageContentHash({
        studentId: "stu-alpha-single",
        schoolId: "school-alpha",
        phoneUsed: "41977771111",
        reasonTitle: "Falta Unica",
        messageContent: "Msg Unica",
        sentByName: "Equipe A",
        sentAt: baseSentAt,
      });
      const legacyHash = computeMessageContentHash({
        studentId: "stu-alpha-single",
        schoolId: "school-alpha",
        phoneUsed: "41977771111",
        reasonTitle: "Falta Legada",
        messageContent: "Msg Legada",
        sentByName: "Equipe A",
        sentAt: new Date("2026-11-24T12:00:00.000Z"),
      });

      const batchLogs: Array<{
        id: string;
        schoolId: string | null;
        studentId: string;
        reasonTitle: string;
        messageContent: string;
        phoneUsed: string;
        sentByName: string;
        sentAt: Date;
        deliveryStatus: string;
        contentHash: string;
      }> = [];

      // 10 logs mais recentes na school-alpha com telefone compartilhado 41988881111
      for (let i = 1; i <= 10; i++) {
        const sentAtItem = new Date(Date.now() - i * 60 * 60 * 1000);
        batchLogs.push({
          id: `wh-alpha-shared-${i}`,
          schoolId: "school-alpha",
          studentId: "stu-alpha-wh",
          reasonTitle: `Falta Shared A ${i}`,
          messageContent: `Msg Shared A ${i}`,
          phoneUsed: "41988881111",
          sentByName: "Equipe A",
          sentAt: sentAtItem,
          deliveryStatus: "SENT",
          contentHash: `hash-shared-a-${i}`,
        });
      }
      // 1 log mais antigo (ainda dentro de 14 dias) na school-beta com o MESMO telefone (fora do top 10!)
      batchLogs.push(
        {
          id: "wh-beta-shared-11",
          schoolId: "school-beta",
          studentId: "stu-beta-wh",
          reasonTitle: "Falta Shared B 11",
          messageContent: "Msg Shared B 11",
          phoneUsed: "5541988881111",
          sentByName: "Equipe B",
          sentAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
          deliveryStatus: "SENT",
          contentHash: "hash-shared-b-11",
        },
        // Log único coerente de school-alpha (telefone exclusivo)
        {
          id: "wh-alpha-single",
          schoolId: "school-alpha",
          studentId: "stu-alpha-single",
          reasonTitle: "Falta Unica",
          messageContent: "Msg Unica",
          phoneUsed: "41977771111",
          sentByName: "Equipe A",
          sentAt: baseSentAt,
          deliveryStatus: "SENT",
          contentHash: singleHash,
        },
        // Log legado (schoolId: null) de school-alpha
        {
          id: "wh-alpha-legacy",
          schoolId: null,
          studentId: "stu-alpha-single",
          reasonTitle: "Falta Legada",
          messageContent: "Msg Legada",
          phoneUsed: "41977771111",
          sentByName: "Equipe A",
          sentAt: new Date("2026-11-24T12:00:00.000Z"),
          deliveryStatus: "SENT",
          contentHash: legacyHash,
        },
        // Log divergente (schoolId: school-beta para estudante de school-alpha)
        {
          id: "wh-divergent",
          schoolId: "school-beta",
          studentId: "stu-alpha-single",
          reasonTitle: "Falta Divergente",
          messageContent: "Msg Divergente",
          phoneUsed: "41977771111",
          sentByName: "Equipe B",
          sentAt: baseSentAt,
          deliveryStatus: "SENT",
          contentHash: "hash-divergent-intact",
        }
      );

      await prisma.messageLog.createMany({ data: batchLogs });

      const capturedContextSchools: Array<string | null> = [];
      const originalWithTenantContext = rlsTenantContext.withTenantContext;
      const baseWithTenantImpl = (
        client: Parameters<typeof originalWithTenantContext>[0],
        schoolId: string,
        fn: Parameters<typeof originalWithTenantContext>[2]
      ) =>
        originalWithTenantContext(client, schoolId, async (tx) => {
          const [{ val }] = await tx.$queryRaw<Array<{ val: string | null }>>`
            SELECT current_setting('app.current_school_id', true) AS val
          `;
          capturedContextSchools.push(val);
          return fn(tx);
        });
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(baseWithTenantImpl);

      try {
        // 1. 503 quando webhook desabilitado
        delete process.env.WHATSAPP_WEBHOOK_SECRET;
        const r503 = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: "41977771111", text: "ok" }),
          })
        );
        expect(r503.status).toBe(503);

        // 2. 401 para credencial inválida antes de qualquer consulta
        process.env.WHATSAPP_WEBHOOK_SECRET = "webhook-realpg-secret";
        const r401 = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer wrong-secret",
            },
            body: JSON.stringify({ phone: "41977771111", text: "ok" }),
          })
        );
        expect(r401.status).toBe(401);
        expect(withTenantSpy).not.toHaveBeenCalled();

        // 3. Telefone compartilhado entre 2 escolas com 11º candidato fora do take(10) -> ignorado sem mutação
        vi.mocked(logAudit).mockClear();
        const rAmbiguousBeyond10 = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer webhook-realpg-secret",
            },
            body: JSON.stringify({
              phone: "41988881111",
              text: "Ele está com febre hoje.",
            }),
          })
        );
        expect(rAmbiguousBeyond10.status).toBe(200);
        const ambJson = await rAmbiguousBeyond10.json();
        expect(ambJson.ignored).toBe(true);
        expect(ambJson.reason).toContain("múltiplos estabelecimentos");
        expect(
          (await prisma.messageLog.findUnique({ where: { id: "wh-alpha-shared-1" } }))?.guardianReplied
        ).toBe(false);
        expect(
          (await prisma.messageLog.findUnique({ where: { id: "wh-beta-shared-11" } }))?.guardianReplied
        ).toBe(false);
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // 4. ID explícito ausente ou incompatível com correlação -> ignorado sem redirecionar para outro log
        for (const badBody of [
          { logId: "wh-nao-existe", phone: "41977771111", text: "Foi ao médico" },
          { logId: "wh-alpha-single", schoolId: "school-beta", phone: "41977771111", text: "Foi ao médico" },
          { logId: "wh-alpha-single", cgm: "999999999", phone: "41977771111", text: "Foi ao médico" },
          { logId: "wh-alpha-single", phone: "41966669999", text: "Foi ao médico" },
          { logId: "wh-divergent", phone: "41977771111", text: "Foi ao médico" },
        ]) {
          const rBad = await webhookWhatsappHandler(
            new Request("http://127.0.0.1/api/webhooks/whatsapp", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer webhook-realpg-secret",
              },
              body: JSON.stringify(badBody),
            })
          );
          expect(rBad.status).toBe(200);
          expect((await rBad.json()).ignored).toBe(true);
        }
        expect((await prisma.messageLog.findUnique({ where: { id: "wh-alpha-single" } }))?.contentHash).toBe(
          singleHash
        );
        expect((await prisma.messageLog.findUnique({ where: { id: "wh-divergent" } }))?.contentHash).toBe(
          "hash-divergent-intact"
        );
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // 5. Recibo de entrega legítimo (event: status) usando messageId de gateway (não tratado como MessageLog.id)
        capturedContextSchools.length = 0;
        const rStatus = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer webhook-realpg-secret",
            },
            body: JSON.stringify({
              event: "status",
              deliveryStatus: "DELIVERED",
              messageId: "wamid.gateway.event.999",
              phone: "41977771111",
              schoolId: "school-alpha",
              logId: "wh-alpha-single",
            }),
          })
        );
        expect(rStatus.status).toBe(200);
        expect(await rStatus.json()).toMatchObject({
          success: true,
          updatedLogId: "wh-alpha-single",
          deliveryStatus: "DELIVERED",
        });
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(
          (await prisma.messageLog.findUnique({ where: { id: "wh-alpha-single" } }))?.deliveryStatus
        ).toBe("DELIVERED");
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // 6. Retorno legítimo no log único com verificação de contexto, hash e auditoria
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();
        const rReply = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-webhook-secret": "webhook-realpg-secret",
            },
            body: JSON.stringify({
              messageId: "wamid.gateway.reply.1",
              logId: "wh-alpha-single",
              phone: "41977771111",
              text: "Bom dia, ela teve febre e foi ao médico hoje.",
            }),
          })
        );
        expect(rReply.status).toBe(200);
        const replyJson = await rReply.json();
        expect(replyJson).toMatchObject({
          success: true,
          logId: "wh-alpha-single",
          category: "SAUDE",
        });
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        const singleAfterReply = await prisma.messageLog.findUnique({
          where: { id: "wh-alpha-single" },
        });
        expect(singleAfterReply?.guardianReplied).toBe(true);
        expect(singleAfterReply?.deliveryStatus).toBe("READ");
        const expectedSingleHash = computeMessageContentHash({
          studentId: "stu-alpha-single",
          schoolId: "school-alpha",
          phoneUsed: "41977771111",
          reasonTitle: "Falta Unica",
          messageContent: "Msg Unica",
          sentByName: "Equipe A",
          sentAt: baseSentAt,
          guardianReplied: true,
          replyNotes: singleAfterReply?.replyNotes ?? null,
          replyCategory: singleAfterReply?.replyCategory ?? null,
          repliedAt: singleAfterReply?.repliedAt ?? null,
        });
        expect(singleAfterReply?.contentHash).toBe(expectedSingleHash);
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "WEBHOOK_REPLY",
            entityId: "wh-alpha-single",
            schoolId: "school-alpha",
          })
        );

        // 7. Log legado (schoolId: null) aceito pela escola do estudante
        vi.mocked(logAudit).mockClear();
        const rLegacyReply = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer webhook-realpg-secret",
            },
            body: JSON.stringify({
              logId: "wh-alpha-legacy",
              phone: "41977771111",
              text: "Vai apresentar atestado amanhã no médico.",
            }),
          })
        );
        expect(rLegacyReply.status).toBe(200);
        expect((await rLegacyReply.json()).success).toBe(true);
        const legacyAfter = await prisma.messageLog.findUnique({ where: { id: "wh-alpha-legacy" } });
        expect(legacyAfter?.guardianReplied).toBe(true);
        expect(legacyAfter?.contentHash).not.toBe(legacyHash);
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "WEBHOOK_REPLY",
            entityId: "wh-alpha-legacy",
            schoolId: "school-alpha",
          })
        );

        // 8. Rollback antes do commit preserva status, retorno e hash e não emite auditoria
        vi.mocked(logAudit).mockClear();
        withTenantSpy.mockImplementationOnce(async (client, schoolId, fn) => {
          return client.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
            await fn(tx);
            throw new Error("Simulated pre-commit failure on webhook");
          });
        });

        const rRollback = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer webhook-realpg-secret",
            },
            body: JSON.stringify({
              logId: "wh-beta-shared-11",
              schoolId: "school-beta",
              phone: "41988881111",
              text: "Retorno que deve sofrer rollback.",
            }),
          })
        );
        expect(rRollback.status).toBe(500);
        const betaAfterRollback = await prisma.messageLog.findUnique({
          where: { id: "wh-beta-shared-11" },
        });
        expect(betaAfterRollback?.guardianReplied).toBe(false);
        expect(betaAfterRollback?.deliveryStatus).toBe("SENT");
        expect(betaAfterRollback?.contentHash).toBe("hash-shared-b-11");
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // 9. logId e messageLogId conflitantes -> ignorado antes de consultar qualquer MessageLog
        vi.mocked(logAudit).mockClear();
        const findUniqueSpy = vi.spyOn(prisma.messageLog, "findUnique");
        const findManySpy = vi.spyOn(prisma.messageLog, "findMany");
        const updateSpy = vi.spyOn(prisma.messageLog, "update");
        withTenantSpy.mockClear();

        const rConflictIds = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer webhook-realpg-secret",
            },
            body: JSON.stringify({
              logId: "wh-alpha-single",
              messageLogId: "wh-alpha-legacy",
              phone: "41977771111",
              text: "Não deve consultar nem atualizar.",
            }),
          })
        );
        expect(rConflictIds.status).toBe(200);
        expect(await rConflictIds.json()).toMatchObject({
          ignored: true,
          reason: "Identificadores internos logId e messageLogId conflitantes.",
        });
        expect(findUniqueSpy).not.toHaveBeenCalled();
        expect(findManySpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
        expect(withTenantSpy).not.toHaveBeenCalled();
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
        findUniqueSpy.mockRestore();
        findManySpy.mockRestore();
        updateSpy.mockRestore();

        // 10. logId e messageLogId iguais + messageLogId individualmente
        const rMatchingIds = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer webhook-realpg-secret",
            },
            body: JSON.stringify({
              event: "status",
              deliveryStatus: "READ",
              logId: "wh-alpha-single",
              messageLogId: "  wh-alpha-single  ",
              phone: "41977771111",
            }),
          })
        );
        expect(rMatchingIds.status).toBe(200);
        expect(await rMatchingIds.json()).toMatchObject({
          success: true,
          updatedLogId: "wh-alpha-single",
          deliveryStatus: "READ",
        });

        const rMessageLogIdOnly = await webhookWhatsappHandler(
          new Request("http://127.0.0.1/api/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer webhook-realpg-secret",
            },
            body: JSON.stringify({
              event: "status",
              deliveryStatus: "DELIVERED",
              messageLogId: "wh-alpha-legacy",
              phone: "41977771111",
            }),
          })
        );
        expect(rMessageLogIdOnly.status).toBe(200);
        expect(await rMessageLogIdOnly.json()).toMatchObject({
          success: true,
          updatedLogId: "wh-alpha-legacy",
          deliveryStatus: "DELIVERED",
        });

        // 11. Limite exato de 14 dias na busca por telefone continua elegível
        const fixedNowMs = Date.parse("2026-11-26T17:00:00.000Z");
        const exactCutoffMs = fixedNowMs - 14 * 24 * 60 * 60 * 1000;
        const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNowMs);
        try {
          await prisma.student.create({
            data: {
              id: "stu-alpha-window",
              name: "Carlos Janela",
              cgm: "300100999",
              phone: "41955551111",
              schoolId: "school-alpha",
              classGroupId: "cg-alpha-wh",
            },
          });
          await prisma.messageLog.create({
            data: {
              id: "wh-window-exact",
              schoolId: "school-alpha",
              studentId: "stu-alpha-window",
              reasonTitle: "Limite 14 dias",
              messageContent: "Msg limite",
              phoneUsed: "41955551111",
              sentByName: "Equipe A",
              sentAt: new Date(exactCutoffMs),
              deliveryStatus: "SENT",
              contentHash: "hash-window-exact",
            },
          });

          const rExactBoundary = await webhookWhatsappHandler(
            new Request("http://127.0.0.1/api/webhooks/whatsapp", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer webhook-realpg-secret",
              },
              body: JSON.stringify({
                event: "status",
                deliveryStatus: "DELIVERED",
                phone: "41955551111",
              }),
            })
          );
          expect(rExactBoundary.status).toBe(200);
          expect(await rExactBoundary.json()).toMatchObject({
            success: true,
            updatedLogId: "wh-window-exact",
            deliveryStatus: "DELIVERED",
          });

          // 12. Mudança determinística de sentAt fora da janela entre seleção por telefone e releitura após o lock
          await prisma.messageLog.create({
            data: {
              id: "wh-window-race",
              schoolId: "school-alpha",
              studentId: "stu-alpha-window",
              reasonTitle: "Corrida Janela 14 dias",
              messageContent: "Msg corrida",
              phoneUsed: "41955551111",
              sentByName: "Equipe A",
              sentAt: new Date(fixedNowMs - 1000),
              deliveryStatus: "SENT",
              contentHash: "hash-window-race",
            },
          });

          vi.mocked(logAudit).mockClear();
          withTenantSpy.mockImplementationOnce(async (client, schoolId, fn) => {
            return client.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
              const originalQueryRaw = tx.$queryRaw.bind(tx);
              let raced = false;
              const patchedTx = new Proxy(tx, {
                get(target, prop, receiver) {
                  if (prop === "$queryRaw") {
                    return async (...args: any[]) => {
                      if (!raced) {
                        raced = true;
                        await client.messageLog.update({
                          where: { id: "wh-window-race" },
                          data: { sentAt: new Date(exactCutoffMs - 1000) },
                        });
                      }
                      return (originalQueryRaw as any)(...args);
                    };
                  }
                  return Reflect.get(target, prop, receiver);
                },
              });
              return fn(patchedTx as any);
            });
          });

          const rWindowRace = await webhookWhatsappHandler(
            new Request("http://127.0.0.1/api/webhooks/whatsapp", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer webhook-realpg-secret",
              },
              body: JSON.stringify({
                phone: "41955551111",
                text: "Retorno que chegou após retificação tirar o registro da janela.",
              }),
            })
          );
          expect(rWindowRace.status).toBe(200);
          expect(await rWindowRace.json()).toMatchObject({
            ignored: true,
            reason: "Nenhum envio recente vinculado ao número",
          });
          const raceAfter = await prisma.messageLog.findUnique({ where: { id: "wh-window-race" } });
          expect(raceAfter?.guardianReplied).toBe(false);
          expect(raceAfter?.deliveryStatus).toBe("SENT");
          expect(raceAfter?.contentHash).toBe("hash-window-race");
          expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
        } finally {
          dateNowSpy.mockRestore();
        }
      } finally {
        withTenantSpy.mockRestore();
        if (originalSecret === undefined) {
          delete process.env.WHATSAPP_WEBHOOK_SECRET;
        } else {
          process.env.WHATSAPP_WEBHOOK_SECRET = originalSecret;
        }
      }
    });

    it("integra withTenantContext em POST /api/frequencia/sync e POST /api/serp/sync com auth, lotes, falha de snapshot, colisão concorrente P2002 e isolamento", async () => {
      const { hashSchoolSyncToken } = await import("@/lib/syncToken");
      const originalSyncToken = process.env.SYNC_API_TOKEN;
      process.env.SYNC_API_TOKEN = "global-sync-admin-token-realpg";

      await prisma.absenceJustification.deleteMany({});
      await prisma.attendanceSnapshot.deleteMany({});
      await prisma.lowAttendanceRecord.deleteMany({});
      await prisma.messageLog.deleteMany({});
      await prisma.messageTemplate.deleteMany({});
      await prisma.student.deleteMany({});
      await prisma.classGroup.deleteMany({});
      await prisma.userSchool.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.school.deleteMany({});

      const tokenAlpha = "school-alpha-sync-token-realpg";
      const tokenAlphaHash = hashSchoolSyncToken(tokenAlpha);

      await prisma.school.createMany({
        data: [
          {
            id: "school-alpha",
            name: "Escola Alpha Integrada",
            inepCode: "11111111",
            active: true,
            syncTokenHash: tokenAlphaHash,
            settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }),
          },
          {
            id: "school-beta",
            name: "Escola Beta Integrada",
            inepCode: "22222222",
            active: true,
            settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }),
          },
          {
            id: "school-essencial",
            name: "Escola Essencial",
            inepCode: "33333333",
            active: true,
            settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
          },
        ],
      });

      await prisma.classGroup.createMany({
        data: [
          { id: "cg-alpha-sync", name: "1º Ano A", segment: "EM", schoolId: "school-alpha" },
          { id: "cg-beta-sync", name: "2º Ano B", segment: "EM", schoolId: "school-beta" },
          { id: "cg-ess-sync", name: "3º Ano C", segment: "EM", schoolId: "school-essencial" },
        ],
      });

      await prisma.student.createMany({
        data: [
          {
            id: "stu-alpha-sync-1",
            name: "Joao Pedro Sync",
            cgm: "777000111",
            phone: "41999991111",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-sync",
            active: true,
            isExchangeStudent: false,
            isSpecialNeeds: false,
            age: 15,
          },
          {
            id: "stu-alpha-nocgm-ok",
            name: "Maria Sem Cgm Ok",
            cgm: null,
            phone: "41999991112",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-sync",
            active: true,
          },
          {
            id: "stu-alpha-nocgm-race",
            name: "Carlos Sem Cgm Race",
            cgm: null,
            phone: "41999991113",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-sync",
            active: true,
          },
          {
            id: "stu-alpha-inactive",
            name: "Inativo Alpha",
            cgm: "888000999",
            phone: "41999991114",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-sync",
            active: false,
          },
          {
            id: "stu-beta-sync-1",
            name: "Ana Beta Sync",
            cgm: "999000111",
            phone: "41999992222",
            schoolId: "school-beta",
            classGroupId: "cg-beta-sync",
            active: true,
          },
          {
            id: "stu-beta-race-holder",
            name: "Holder Beta Race",
            cgm: null,
            phone: "41999992223",
            schoolId: "school-beta",
            classGroupId: "cg-beta-sync",
            active: true,
          },
        ],
      });

      await prisma.user.createMany({
        data: [
          {
            id: "sync-pedagoga-a",
            email: "pedagoga.sync@redeativa.local",
            name: "Pedagoga Sync Alpha",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "sync-superadmin",
            email: "super.sync@redeativa.local",
            name: "Superadmin Sync",
            role: "SUPERADMIN",
            schoolId: null,
            active: true,
          },
          {
            id: "sync-essencial-user",
            email: "ped.essencial@redeativa.local",
            name: "Pedagoga Essencial",
            role: "PEDAGOGA",
            schoolId: "school-essencial",
            active: true,
          },
          {
            id: "sync-professor-a",
            email: "prof.sync@redeativa.local",
            name: "Professor Sync Alpha",
            role: "PROFESSOR",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "sync-inactive-a",
            email: "inativo.sync@redeativa.local",
            name: "Inativo Sync Alpha",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: false,
          },
        ],
      });
      await prisma.userSchool.createMany({
        data: [
          {
            id: "us-sync-ped-a",
            userId: "sync-pedagoga-a",
            schoolId: "school-alpha",
            role: "PEDAGOGA",
            active: true,
          },
          {
            id: "us-sync-ess",
            userId: "sync-essencial-user",
            schoolId: "school-essencial",
            role: "PEDAGOGA",
            active: true,
          },
          {
            id: "us-sync-prof-a",
            userId: "sync-professor-a",
            schoolId: "school-alpha",
            role: "PROFESSOR",
            active: true,
          },
          {
            id: "us-sync-inact-a",
            userId: "sync-inactive-a",
            schoolId: "school-alpha",
            role: "PEDAGOGA",
            active: true,
          },
        ],
      });

      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;
      testAuthState.useRealExtensionSyncAuth = true;

      const capturedContextSchools: Array<string | null> = [];
      const originalWithTenantContext = rlsTenantContext.withTenantContext;
      const baseWithTenantImpl = (
        client: Parameters<typeof originalWithTenantContext>[0],
        schoolId: string,
        fn: Parameters<typeof originalWithTenantContext>[2]
      ) =>
        originalWithTenantContext(client, schoolId, async (tx) => {
          const [{ val }] = await tx.$queryRaw<Array<{ val: string | null }>>`
            SELECT current_setting('app.current_school_id', true) AS val
          `;
          capturedContextSchools.push(val);
          return fn(tx);
        });
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(baseWithTenantImpl);

      try {
        // 1. Credenciais inválidas e guardas de auth
        vi.mocked(auth).mockResolvedValueOnce(null as any);
        const rNoToken = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alunos: [{ nome: "Joao Pedro Sync", mediaGeral: "70%" }] }),
          })
        );
        expect(rNoToken.status).toBe(401);

        vi.mocked(auth).mockResolvedValueOnce(null as any);
        const rBadToken = await serpSyncHandler(
          new Request("http://127.0.0.1/api/serp/sync", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer token-invalido-xyz",
            },
            body: JSON.stringify({ fichas: [{ nome: "Joao Pedro Sync", status: "EM_ACOMPANHAMENTO" }] }),
          })
        );
        expect(rBadToken.status).toBe(401);

        // SUPERADMIN sem escola selecionada -> 403 (allowSuperAdminReadOnlyFallback: false)
        testAuthState.pendingSessionUser = {
          id: "sync-superadmin",
          email: "super.sync@redeativa.local",
          active: true,
        };
        const rSuperNoSchool = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alunos: [{ nome: "Joao Pedro Sync", mediaGeral: "70%" }] }),
          })
        );
        expect(rSuperNoSchool.status).toBe(403);

        // Escola na edição INSTITUCIONAL_ESSENCIAL -> 403
        testAuthState.pendingSessionUser = {
          id: "sync-essencial-user",
          email: "ped.essencial@redeativa.local",
          active: true,
        };
        const rEssencial = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alunos: [{ nome: "Joao Pedro Sync", mediaGeral: "70%" }] }),
          })
        );
        expect(rEssencial.status).toBe(403);

        // Sessão com vínculo ativo em school-alpha, mas papel PROFESSOR sem permissão -> 403 e zero escritas
        withTenantSpy.mockClear();
        testAuthState.pendingSessionUser = {
          id: "sync-professor-a",
          email: "prof.sync@redeativa.local",
          active: true,
        };
        const rProfFreq = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alunos: [{ nome: "Joao Pedro Sync", mediaGeral: "70%" }] }),
          })
        );
        expect(rProfFreq.status).toBe(403);
        const rProfSerp = await serpSyncHandler(
          new Request("http://127.0.0.1/api/serp/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fichas: [{ nome: "Joao Pedro Sync", status: "EM_ACOMPANHAMENTO" }] }),
          })
        );
        expect(rProfSerp.status).toBe(403);
        expect(withTenantSpy).not.toHaveBeenCalled();

        // Precedência: sessão inativa com token válido simultâneo -> 403 (não faz fallback para token)
        testAuthState.pendingSessionUser = {
          id: "sync-inactive-a",
          email: "inativo.sync@redeativa.local",
          active: false,
        };
        const rInactiveWithToken = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenAlpha}`,
            },
            body: JSON.stringify({ alunos: [{ nome: "Joao Pedro Sync", mediaGeral: "70%" }] }),
          })
        );
        expect(rInactiveWithToken.status).toBe(403);
        expect(withTenantSpy).not.toHaveBeenCalled();

        // 2. Token por escola com schoolId conflitante na query -> opera exclusivamente em school-alpha
        //    Inclui CGM de school-beta ("999000111") e de estudante inativo ("888000999") -> ambos bloqueados sem erro 500
        testAuthState.pendingSessionUser = null;
        vi.mocked(auth).mockResolvedValueOnce(null as any);
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();

        const rTokenSync = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync?schoolId=school-beta", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenAlpha}`,
            },
            body: JSON.stringify({
              alunos: [
                {
                  cgm: "777000111",
                  nome: "Joao Pedro Sync",
                  mediaGeral: "68.5%",
                  semanaAtual: "60%",
                  semanaAnterior: "72%",
                  idade: 16,
                  deficienciaAltasHabilidades: true,
                  amparoLegalVigencia: "15/12/2026",
                },
                {
                  cgm: "999000111", // CGM já ocupado por stu-beta-sync-1
                  nome: "Maria Sem Cgm Ok",
                  mediaGeral: "74%",
                },
                {
                  cgm: "888000999", // CGM já ocupado por stu-alpha-inactive
                  nome: "Carlos Sem Cgm Race",
                  mediaGeral: "71%",
                },
                {
                  cgm: "999000111",
                  nome: "Ana Beta Sync", // Pertence à outra escola -> naoEncontrados
                  mediaGeral: "50%",
                },
              ],
            }),
          })
        );
        expect(rTokenSync.status).toBe(200);
        const tokenSyncJson = await rTokenSync.json();
        expect(tokenSyncJson).toMatchObject({
          sucesso: true,
          totalRecebido: 4,
          atualizados: 3,
          cgmVinculados: 0,
          estudantesEnriquecidos: 1,
          amparosCriados: 1,
          naoEncontradosTotal: 1,
        });
        expect(capturedContextSchools.length).toBeGreaterThanOrEqual(4);
        expect(capturedContextSchools.every((v) => v === "school-alpha")).toBe(true);

        const stu1After = await prisma.student.findUnique({ where: { id: "stu-alpha-sync-1" } });
        expect(stu1After?.age).toBe(16);
        expect(stu1After?.isSpecialNeeds).toBe(true);
        const low1 = await prisma.lowAttendanceRecord.findUnique({
          where: { studentId: "stu-alpha-sync-1" },
        });
        expect(low1?.attendancePercent).toBeCloseTo(68.5);
        expect(
          await prisma.lowAttendanceRecord.findUnique({ where: { studentId: "stu-beta-sync-1" } })
        ).toBeNull();
        expect(
          (await prisma.student.findUnique({ where: { id: "stu-alpha-nocgm-ok" } }))?.cgm
        ).toBeNull();
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "UPDATE_LOW_ATTENDANCE",
            schoolId: "school-alpha",
          })
        );

        // 3. Falha simulada em AttendanceSnapshot não invalida transações seguintes (enriquecimento/amparo)
        capturedContextSchools.length = 0;
        let snapshotIntercepted = false;
        const originalImpl = withTenantSpy.getMockImplementation()!;
        withTenantSpy.mockImplementation(async (client, schoolId, fn) => {
          return originalImpl(client, schoolId, async (tx) => {
            const origExec = tx.$executeRaw.bind(tx);
            const wrappedTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === "$executeRaw") {
                  return async (strings: TemplateStringsArray, ...values: any[]) => {
                    const sqlText = strings.join(" ");
                    if (!snapshotIntercepted && sqlText.includes('"AttendanceSnapshot"')) {
                      snapshotIntercepted = true;
                      throw new Error("Simulated AttendanceSnapshot failure");
                    }
                    return (origExec as any)(strings, ...values);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return fn(wrappedTx as any);
          });
        });

        testAuthState.pendingSessionUser = {
          id: "sync-pedagoga-a",
          email: "pedagoga.sync@redeativa.local",
          active: true,
        };
        const rSnapFail = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              alunos: [
                {
                  cgm: "777000111",
                  nome: "Joao Pedro Sync",
                  mediaGeral: "62%",
                  idade: 17,
                },
              ],
            }),
          })
        );
        expect(rSnapFail.status).toBe(200);
        expect(snapshotIntercepted).toBe(true);
        const snapFailJson = await rSnapFail.json();
        expect(snapFailJson.atualizados).toBe(1);
        expect(snapFailJson.estudantesEnriquecidos).toBe(1);
        expect((await prisma.student.findUnique({ where: { id: "stu-alpha-sync-1" } }))?.age).toBe(17);
        expect(
          (
            await prisma.lowAttendanceRecord.findUnique({
              where: { studentId: "stu-alpha-sync-1" },
            })
          )?.attendancePercent
        ).toBeCloseTo(62);

        // Restaura implementação delegada ao helper real de produção
        withTenantSpy.mockImplementation(baseWithTenantImpl);

        // 4. Colisão concorrente P2002 em applyPendingCgmUpdatesSafely + retry em transação válida + SERP sync
        testAuthState.pendingSessionUser = null;
        vi.mocked(auth).mockResolvedValueOnce(null as any);
        capturedContextSchools.length = 0;

        let racedCgmCollision = false;
        withTenantSpy.mockImplementation((client, schoolId, fn) =>
          baseWithTenantImpl(client, schoolId, async (tx) => {
            // Na 2ª chamada withTenantContext (lote de applyPendingCgmUpdatesSafely), simula corrida externa
            if (!racedCgmCollision && capturedContextSchools.length === 2) {
              racedCgmCollision = true;
              await client.student.update({
                where: { id: "stu-beta-race-holder" },
                data: { cgm: "555000222" },
              });
            }
            return fn(tx);
          })
        );

        const rSerpCollision = await serpSyncHandler(
          new Request("http://127.0.0.1/api/serp/sync?schoolId=school-alpha", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer global-sync-admin-token-realpg",
            },
            body: JSON.stringify({
              fichas: [
                {
                  cgm: "555000111",
                  nome: "Maria Sem Cgm Ok",
                  numeroFicha: "SERP-100",
                  status: "CONSELHO_TUTELAR",
                },
                {
                  cgm: "555000222",
                  nome: "Carlos Sem Cgm Race",
                  numeroFicha: "SERP-200",
                  status: "EM_ACOMPANHAMENTO",
                },
              ],
            }),
          })
        );
        expect(rSerpCollision.status).toBe(200);
        const serpJson = await rSerpCollision.json();
        expect(serpJson).toMatchObject({
          sucesso: true,
          atualizados: 2,
          cgmVinculados: 1,
          conselhoTutelarCount: 1,
        });
        expect((await prisma.student.findUnique({ where: { id: "stu-alpha-nocgm-ok" } }))?.cgm).toBe(
          "555000111"
        );
        expect(
          (await prisma.student.findUnique({ where: { id: "stu-alpha-nocgm-race" } }))?.cgm
        ).toBeNull();
        expect(
          (await prisma.student.findUnique({ where: { id: "stu-beta-race-holder" } }))?.cgm
        ).toBe("555000222");
        expect(capturedContextSchools.every((v) => v === "school-alpha")).toBe(true);

        // 5. Falha em lote intermediário (>250 itens): lote 1 confirmado, lote 2 revertido, sem logAudit
        withTenantSpy.mockImplementation(baseWithTenantImpl);

        const bulkStudents: Array<{
          id: string;
          name: string;
          cgm: string;
          phone: string;
          schoolId: string;
          classGroupId: string;
          active: boolean;
        }> = [];
        const bulkFichas: Array<{ cgm: string; nome: string; numeroFicha: string; status: string }> = [];
        for (let idx = 1; idx <= 251; idx++) {
          const cgm = `6600${String(idx).padStart(5, "0")}`;
          const name = `Aluno Lote ${idx}`;
          bulkStudents.push({
            id: `stu-lote-${idx}`,
            name,
            cgm,
            phone: "41999990000",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-sync",
            active: true,
          });
          bulkFichas.push({
            cgm,
            nome: name,
            numeroFicha: `LOTE-${idx}`,
            status: "EM_ACOMPANHAMENTO",
          });
        }
        await prisma.student.createMany({ data: bulkStudents });

        let lowAttBatchCalls = 0;
        const defaultWithTenant = withTenantSpy.getMockImplementation()!;
        withTenantSpy.mockImplementation(async (client, schoolId, fn) => {
          return defaultWithTenant(client, schoolId, async (tx) => {
            const origExec = tx.$executeRaw.bind(tx);
            const origQuery = tx.$queryRaw.bind(tx);
            const wrappedTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === "$executeRaw" || prop === "$queryRaw") {
                  return async (strings: TemplateStringsArray, ...values: any[]) => {
                    const sqlText = strings.join(" ");
                    if (sqlText.includes('"LowAttendanceRecord"')) {
                      lowAttBatchCalls++;
                      if (lowAttBatchCalls === 2) {
                        throw new Error("Simulated batch 2 failure");
                      }
                    }
                    return prop === "$queryRaw"
                      ? (origQuery as any)(strings, ...values)
                      : (origExec as any)(strings, ...values);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return fn(wrappedTx as any);
          });
        });

        vi.mocked(logAudit).mockClear();
        testAuthState.pendingSessionUser = {
          id: "sync-pedagoga-a",
          email: "pedagoga.sync@redeativa.local",
          active: true,
        };
        const rBatchFail = await serpSyncHandler(
          new Request("http://127.0.0.1/api/serp/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fichas: bulkFichas }),
          })
        );
        expect(rBatchFail.status).toBe(500);
        // Lote 1 (250 registros) foi confirmado antes da falha do lote 2 (1 registro restante)
        expect(
          await prisma.lowAttendanceRecord.findUnique({ where: { studentId: "stu-lote-1" } })
        ).not.toBeNull();
        expect(
          await prisma.lowAttendanceRecord.findUnique({ where: { studentId: "stu-lote-251" } })
        ).toBeNull();
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // 6. Contagens baseadas nas linhas efetivamente persistidas quando estudante perde elegibilidade antes da escrita
        await prisma.student.createMany({
          data: [
            {
              id: "stu-alpha-keep-count",
              name: "Elegivel Mantido",
              cgm: "440000111",
              phone: "41999994411",
              schoolId: "school-alpha",
              classGroupId: "cg-alpha-sync",
              active: true,
              age: 14,
            },
            {
              id: "stu-alpha-drop-count",
              name: "Perde Elegibilidade",
              cgm: "440000222",
              phone: "41999994422",
              schoolId: "school-alpha",
              classGroupId: "cg-alpha-sync",
              active: true,
              age: 14,
            },
          ],
        });

        // 6.1 Power BI sync: stu-alpha-drop-count (40%, idade 18) é movido para school-beta após a leitura inicial
        let movedDropFreq = false;
        withTenantSpy.mockImplementation((client, schoolId, fn) =>
          baseWithTenantImpl(client, schoolId, async (tx) => {
            const res = await fn(tx);
            if (!movedDropFreq) {
              movedDropFreq = true;
              await client.student.update({
                where: { id: "stu-alpha-drop-count" },
                data: { schoolId: "school-beta", classGroupId: "cg-beta-sync" },
              });
            }
            return res;
          })
        );

        vi.mocked(logAudit).mockClear();
        const rCountFreq = await frequenciaSyncHandler(
          new Request("http://127.0.0.1/api/frequencia/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              alunos: [
                { cgm: "440000111", nome: "Elegivel Mantido", mediaGeral: "82%", idade: 16 },
                { cgm: "440000222", nome: "Perde Elegibilidade", mediaGeral: "40%", idade: 18 },
              ],
            }),
          })
        );
        expect(rCountFreq.status).toBe(200);
        const countFreqJson = await rCountFreq.json();
        expect(countFreqJson).toMatchObject({
          sucesso: true,
          totalRecebido: 2,
          atualizados: 1,
          emRiscoCount: 0,
          estudantesEnriquecidos: 1,
        });
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "UPDATE_LOW_ATTENDANCE",
            schoolId: "school-alpha",
            details: expect.objectContaining({
              atualizados: 1,
              emRiscoCount: 0,
              estudantesEnriquecidos: 1,
            }),
          })
        );
        expect(
          await prisma.lowAttendanceRecord.findUnique({ where: { studentId: "stu-alpha-drop-count" } })
        ).toBeNull();
        expect((await prisma.student.findUnique({ where: { id: "stu-alpha-drop-count" } }))?.age).toBe(14);
        expect((await prisma.student.findUnique({ where: { id: "stu-alpha-keep-count" } }))?.age).toBe(16);

        // 6.2 SERP sync: move outro estudante para school-beta antes da escrita -> conselhoTutelarCount e atualizados refletem apenas persistidos
        await prisma.student.update({
          where: { id: "stu-alpha-drop-count" },
          data: { schoolId: "school-alpha", classGroupId: "cg-alpha-sync" },
        });
        let movedDropSerp = false;
        withTenantSpy.mockImplementation((client, schoolId, fn) =>
          baseWithTenantImpl(client, schoolId, async (tx) => {
            const res = await fn(tx);
            if (!movedDropSerp) {
              movedDropSerp = true;
              await client.student.update({
                where: { id: "stu-alpha-drop-count" },
                data: { schoolId: "school-beta", classGroupId: "cg-beta-sync" },
              });
            }
            return res;
          })
        );

        vi.mocked(logAudit).mockClear();
        const rCountSerp = await serpSyncHandler(
          new Request("http://127.0.0.1/api/serp/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fichas: [
                {
                  cgm: "440000111",
                  nome: "Elegivel Mantido",
                  numeroFicha: "SERP-KEEP",
                  status: "EM_ACOMPANHAMENTO",
                },
                {
                  cgm: "440000222",
                  nome: "Perde Elegibilidade",
                  numeroFicha: "SERP-DROP",
                  status: "CONSELHO_TUTELAR",
                },
              ],
            }),
          })
        );
        expect(rCountSerp.status).toBe(200);
        const countSerpJson = await rCountSerp.json();
        expect(countSerpJson).toMatchObject({
          sucesso: true,
          totalRecebido: 2,
          atualizados: 1,
          conselhoTutelarCount: 0,
        });
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "UPDATE_LOW_ATTENDANCE",
            entityType: "SerpSync",
            schoolId: "school-alpha",
            details: expect.objectContaining({
              atualizados: 1,
              conselhoTutelarCount: 0,
            }),
          })
        );
        expect(
          await prisma.lowAttendanceRecord.findUnique({ where: { studentId: "stu-alpha-drop-count" } })
        ).toBeNull();
      } finally {
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = null;
        testAuthState.useRealPermissions = false;
        testAuthState.useRealCurrentSchool = false;
        testAuthState.useRealExtensionSyncAuth = false;
        if (originalSyncToken === undefined) {
          delete process.env.SYNC_API_TOKEN;
        } else {
          process.env.SYNC_API_TOKEN = originalSyncToken;
        }
      }
    });

    it("integra withTenantContext em POST /api/conselho-classe/sync com canMutateSchoolCouncil, turmas homônimas, CGM, perda de elegibilidade e falha em lote", async () => {
      const { hashSchoolSyncToken } = await import("@/lib/syncToken");
      const originalSyncToken = process.env.SYNC_API_TOKEN;
      process.env.SYNC_API_TOKEN = "global-sync-council-token-realpg";

      await prisma.studentCouncilSubjectEntry.deleteMany({});
      await prisma.studentCouncilCard.deleteMany({});
      await prisma.classCouncilSubject.deleteMany({});
      await prisma.classCouncilTrimester.deleteMany({});
      await prisma.classCouncilBoard.deleteMany({});
      await prisma.absenceJustification.deleteMany({});
      await prisma.attendanceSnapshot.deleteMany({});
      await prisma.lowAttendanceRecord.deleteMany({});
      await prisma.messageLog.deleteMany({});
      await prisma.messageTemplate.deleteMany({});
      await prisma.student.deleteMany({});
      await prisma.classGroup.deleteMany({});
      await prisma.userSchool.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.school.deleteMany({});

      const tokenAlpha = "school-alpha-council-token";
      const tokenAlphaHash = hashSchoolSyncToken(tokenAlpha);

      await prisma.school.createMany({
        data: [
          {
            id: "school-alpha",
            name: "Colégio Alpha",
            inepCode: "11111111",
            active: true,
            syncTokenHash: tokenAlphaHash,
            settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }),
          },
          {
            id: "school-beta",
            name: "Colégio Beta",
            inepCode: "22222222",
            active: true,
            settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }),
          },
          {
            id: "school-essencial",
            name: "Colégio Essencial",
            inepCode: "33333333",
            active: true,
            settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
          },
        ],
      });

      // Duas escolas com turma de MESMO nome ("1º Ano A")
      await prisma.classGroup.createMany({
        data: [
          { id: "cg-alpha-bi", name: "1º Ano A", segment: "EM", schoolId: "school-alpha" },
          { id: "cg-beta-bi", name: "1º Ano A", segment: "EM", schoolId: "school-beta" },
          { id: "cg-ess-bi", name: "1º Ano A", segment: "EM", schoolId: "school-essencial" },
        ],
      });

      await prisma.student.createMany({
        data: [
          {
            id: "stu-alpha-bi-1",
            name: "Lucas Conselho Alpha",
            cgm: "710000111",
            phone: "41999997101",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-bi",
            active: true,
            age: 15,
          },
          {
            id: "stu-alpha-bi-nocgm",
            name: "Sofia Sem Cgm Alpha",
            cgm: null,
            phone: "41999997102",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-bi",
            active: true,
            age: 15,
          },
          {
            id: "stu-alpha-bi-drop",
            name: "Aluno Perde Elegibilidade BI",
            cgm: "710000333",
            phone: "41999997103",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-bi",
            active: true,
            age: 14,
          },
          {
            id: "stu-beta-bi-1",
            name: "Pedro Conselho Beta",
            cgm: "720000111",
            phone: "41999997201",
            schoolId: "school-beta",
            classGroupId: "cg-beta-bi",
            active: true,
            age: 16,
          },
        ],
      });

      await prisma.user.createMany({
        data: [
          {
            id: "bi-pedagoga-a",
            email: "ped.bi@redeativa.local",
            name: "Pedagoga BI Alpha",
            role: "PEDAGOGA",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "bi-prof-a",
            email: "prof.bi@redeativa.local",
            name: "Professor BI Alpha",
            role: "PROFESSOR",
            schoolId: "school-alpha",
            active: true,
          },
          {
            id: "bi-essencial",
            email: "ess.bi@redeativa.local",
            name: "Pedagoga Essencial",
            role: "PEDAGOGA",
            schoolId: "school-essencial",
            active: true,
          },
        ],
      });
      await prisma.userSchool.createMany({
        data: [
          {
            id: "us-bi-ped-a",
            userId: "bi-pedagoga-a",
            schoolId: "school-alpha",
            role: "PEDAGOGA",
            active: true,
          },
          {
            id: "us-bi-prof-a",
            userId: "bi-prof-a",
            schoolId: "school-alpha",
            role: "PROFESSOR",
            active: true,
          },
          {
            id: "us-bi-ess",
            userId: "bi-essencial",
            schoolId: "school-essencial",
            role: "PEDAGOGA",
            active: true,
          },
        ],
      });

      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;
      testAuthState.useRealExtensionSyncAuth = true;

      const capturedContextSchools: Array<string | null> = [];
      const originalWithTenantContext = rlsTenantContext.withTenantContext;
      const baseWithTenantImpl = (
        client: Parameters<typeof originalWithTenantContext>[0],
        schoolId: string,
        fn: Parameters<typeof originalWithTenantContext>[2]
      ) =>
        originalWithTenantContext(client, schoolId, async (tx) => {
          const [{ val }] = await tx.$queryRaw<Array<{ val: string | null }>>`
            SELECT current_setting('app.current_school_id', true) AS val
          `;
          capturedContextSchools.push(val);
          return fn(tx);
        });
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(baseWithTenantImpl);

      try {
        // 1. Sem credencial -> 401; PROFESSOR com vínculo ativo -> 403 via canMutateSchoolCouncil; Essencial -> 403
        vi.mocked(auth).mockResolvedValueOnce(null as any);
        const r401 = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [{ cgm: "710000111", nome: "Lucas Conselho Alpha", media1Tri: 8.5 }],
              notasMapa: [],
            }),
          })
        );
        expect(r401.status).toBe(401);

        testAuthState.pendingSessionUser = {
          id: "bi-prof-a",
          email: "prof.bi@redeativa.local",
          active: true,
        };
        const rProf403 = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [{ cgm: "710000111", nome: "Lucas Conselho Alpha", media1Tri: 8.5 }],
              notasMapa: [],
            }),
          })
        );
        expect(rProf403.status).toBe(403);
        expect(withTenantSpy).not.toHaveBeenCalled();

        testAuthState.pendingSessionUser = {
          id: "bi-essencial",
          email: "ess.bi@redeativa.local",
          active: true,
        };
        const rEss403 = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [{ cgm: "710000111", nome: "Lucas Conselho Alpha", media1Tri: 8.5 }],
              notasMapa: [],
            }),
          })
        );
        expect(rEss403.status).toBe(403);

        // 2. Token por escola com ?schoolId=school-beta conflitante + colisão de CGM com school-beta ("720000111")
        //    Opera exclusivamente na turma "1º Ano A" de school-alpha, mantendo school-beta intocada
        testAuthState.pendingSessionUser = null;
        vi.mocked(auth).mockResolvedValueOnce(null as any);
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();

        const rSyncAlpha = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync?schoolId=school-beta", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenAlpha}`,
            },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [
                {
                  cgmkey: "710000111-16",
                  nome: "Lucas Conselho Alpha",
                  media1Tri: 9.2,
                  abaixoBasicoCount: 0,
                  codturma: "T1",
                },
                {
                  cgm: "720000111", // CGM já ocupado por stu-beta-bi-1
                  nome: "Sofia Sem Cgm Alpha",
                  media1Tri: 7.0,
                  codturma: "T1",
                },
              ],
              notasMapa: [
                {
                  cgm: "710000111",
                  nome: "Lucas Conselho Alpha",
                  disciplinaRaw: "MATEMATICA - 101",
                  nota1Tri: 5.2,
                  nota2Tri: 8.4,
                  codturma: "T1",
                },
              ],
            }),
          })
        );
        expect(rSyncAlpha.status).toBe(200);
        const syncAlphaJson = await rSyncAlpha.json();
        expect(syncAlphaJson).toMatchObject({
          sucesso: true,
          turmasAfetadas: 1,
          alunosPareados: 2,
          idadesAtualizadas: 1,
          cgmVinculados: 0,
          disciplinasCriadas: 1,
          notasGravadas: 2,
          abaixoDaMediaDetectados: 1,
          cardsAtualizados: 1,
        });
        expect(capturedContextSchools.length).toBeGreaterThanOrEqual(4);
        expect(capturedContextSchools.every((v) => v === "school-alpha")).toBe(true);

        const alphaBoard = await prisma.classCouncilBoard.findUnique({
          where: {
            schoolId_classGroupId_year: {
              schoolId: "school-alpha",
              classGroupId: "cg-alpha-bi",
              year: 2026,
            },
          },
        });
        expect(alphaBoard).not.toBeNull();
        expect(
          await prisma.classCouncilBoard.findUnique({
            where: {
              schoolId_classGroupId_year: {
                schoolId: "school-beta",
                classGroupId: "cg-beta-bi",
                year: 2026,
              },
            },
          })
        ).toBeNull();
        expect((await prisma.student.findUnique({ where: { id: "stu-alpha-bi-1" } }))?.age).toBe(16);
        expect(
          (await prisma.student.findUnique({ where: { id: "stu-alpha-bi-nocgm" } }))?.cgm
        ).toBeNull();
        expect((await prisma.student.findUnique({ where: { id: "stu-beta-bi-1" } }))?.age).toBe(16);
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "SYNC_CLASS_COUNCIL_BI",
            schoolId: "school-alpha",
            details: expect.objectContaining({
              notasGravadas: 2,
              abaixoDaMediaDetectados: 1,
              idadesAtualizadas: 1,
            }),
          })
        );

        // 3. Perda de elegibilidade antes da escrita: stu-alpha-bi-drop movido para school-beta após boardSetup
        let movedDropBi = false;
        withTenantSpy.mockImplementation((client, schoolId, fn) =>
          baseWithTenantImpl(client, schoolId, async (tx) => {
            const res = await fn(tx);
            // Após a 2ª chamada withTenantContext (boardSetup, que segue a leitura inicial), move stu-alpha-bi-drop
            if (!movedDropBi && capturedContextSchools.length >= 2) {
              movedDropBi = true;
              await client.student.update({
                where: { id: "stu-alpha-bi-drop" },
                data: { schoolId: "school-beta", classGroupId: "cg-beta-bi" },
              });
            }
            return res;
          })
        );

        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();
        testAuthState.pendingSessionUser = {
          id: "bi-pedagoga-a",
          email: "ped.bi@redeativa.local",
          active: true,
        };
        const rDropBi = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [],
              notasMapa: [
                {
                  cgm: "710000111",
                  nome: "Lucas Conselho Alpha",
                  disciplinaRaw: "MATEMATICA - 101",
                  nota1Tri: 7.5,
                  codturma: "T1",
                },
                {
                  cgm: "710000333",
                  nome: "Aluno Perde Elegibilidade BI",
                  disciplinaRaw: "MATEMATICA - 101",
                  nota1Tri: 4.0,
                  codturma: "T1",
                },
              ],
            }),
          })
        );
        expect(rDropBi.status).toBe(200);
        const dropBiJson = await rDropBi.json();
        expect(dropBiJson).toMatchObject({
          sucesso: true,
          notasGravadas: 1,
          abaixoDaMediaDetectados: 0,
        });
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "SYNC_CLASS_COUNCIL_BI",
            schoolId: "school-alpha",
            details: expect.objectContaining({
              notasGravadas: 1,
              abaixoDaMediaDetectados: 0,
            }),
          })
        );
        const dropCard = await prisma.studentCouncilCard.findFirst({
          where: { studentId: "stu-alpha-bi-drop" },
          include: { subjectEntries: true },
        });
        expect(dropCard?.subjectEntries ?? []).toHaveLength(0);

        // 4. Falha em lote intermediário (>250 lançamentos): lote 1 (250) confirmado, lote 2 revertido, sem logAudit
        const manyGrades: Array<{
          cgm: string;
          nome: string;
          disciplinaRaw: string;
          nota1Tri: number;
          codturma: string;
        }> = [];
        const bulkStudents: Array<{
          id: string;
          name: string;
          cgm: string;
          phone: string;
          schoolId: string;
          classGroupId: string;
          active: boolean;
        }> = [];
        for (let idx = 1; idx <= 251; idx++) {
          const cgm = `7300${String(idx).padStart(5, "0")}`;
          const name = `Estudante BI Lote ${idx}`;
          bulkStudents.push({
            id: `stu-bi-lote-${idx}`,
            name,
            cgm,
            phone: "41999990000",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-bi",
            active: true,
          });
          manyGrades.push({
            cgm,
            nome: name,
            disciplinaRaw: "MATEMATICA - 101",
            nota1Tri: 8.0,
            codturma: "T1",
          });
        }
        await prisma.student.createMany({ data: bulkStudents });

        let entryBatchCount = 0;
        withTenantSpy.mockImplementation((client, schoolId, fn) =>
          baseWithTenantImpl(client, schoolId, async (tx) => {
            const origQuery = tx.$queryRaw.bind(tx);
            const wrappedTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === "$queryRaw") {
                  return async (strings: TemplateStringsArray, ...values: any[]) => {
                    const sqlText = strings.join(" ");
                    if (sqlText.includes('"StudentCouncilSubjectEntry"')) {
                      entryBatchCount++;
                      if (entryBatchCount === 2) {
                        throw new Error("Simulated council entry batch 2 failure");
                      }
                    }
                    return (origQuery as any)(strings, ...values);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return fn(wrappedTx as any);
          })
        );

        vi.mocked(logAudit).mockClear();
        const rBiBatchFail = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [],
              notasMapa: manyGrades,
            }),
          })
        );
        expect(rBiBatchFail.status).toBe(500);
        const cardLote1 = await prisma.studentCouncilCard.findFirst({
          where: { studentId: "stu-bi-lote-1" },
          include: { subjectEntries: true },
        });
        const cardLote251 = await prisma.studentCouncilCard.findFirst({
          where: { studentId: "stu-bi-lote-251" },
          include: { subjectEntries: true },
        });
        expect(cardLote1?.subjectEntries).toHaveLength(1);
        expect(cardLote251?.subjectEntries ?? []).toHaveLength(0);
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
      } finally {
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = null;
        testAuthState.useRealPermissions = false;
        testAuthState.useRealCurrentSchool = false;
        testAuthState.useRealExtensionSyncAuth = false;
        if (originalSyncToken === undefined) {
          delete process.env.SYNC_API_TOKEN;
        } else {
          process.env.SYNC_API_TOKEN = originalSyncToken;
        }
      }
    });

    it("protege ON CONFLICT de StudentCouncilSubjectEntry pelo schoolId persistido e calcula trimester*BelowAvgJson apenas com notas confirmadas", async () => {
      await prisma.school.update({
        where: { id: "school-alpha" },
        data: { settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }) },
      });
      await prisma.school.update({
        where: { id: "school-beta" },
        data: { settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }) },
      });

      await prisma.classGroup.create({
        data: {
          id: "cg-alpha-conf",
          name: "1º Ano A",
          segment: "EM",
          shift: "Manhã",
          schoolId: "school-alpha",
        },
      });
      await prisma.student.create({
        data: {
          id: "stu-alpha-conf",
          name: "Aluno Conflito Matriz",
          cgm: "750000111",
          phone: "41999997501",
          schoolId: "school-alpha",
          classGroupId: "cg-alpha-conf",
          active: true,
        },
      });
      await prisma.user.create({
        data: {
          id: "bi-ped-conf",
          name: "Pedagoga Conflito",
          email: "ped.conf@redeativa.local",
          role: "PEDAGOGA",
          active: true,
          schoolId: "school-alpha",
        },
      });
      await prisma.userSchool.create({
        data: {
          id: "us-bi-ped-conf",
          userId: "bi-ped-conf",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      });

      await prisma.classCouncilBoard.create({
        data: {
          id: "board-alpha-conf",
          schoolId: "school-alpha",
          classGroupId: "cg-alpha-conf",
          year: 2026,
        },
      });
      await prisma.classCouncilSubject.createMany({
        data: [
          {
            id: "sub-conf-mat",
            schoolId: "school-alpha",
            boardId: "board-alpha-conf",
            name: "MATEMATICA",
            displayOrder: 1,
            active: true,
          },
          {
            id: "sub-conf-port",
            schoolId: "school-alpha",
            boardId: "board-alpha-conf",
            name: "PORTUGUES",
            displayOrder: 2,
            active: true,
          },
          {
            id: "sub-conf-hist",
            schoolId: "school-alpha",
            boardId: "board-alpha-conf",
            name: "HISTORIA",
            displayOrder: 3,
            active: true,
          },
          {
            id: "sub-conf-art",
            schoolId: "school-alpha",
            boardId: "board-alpha-conf",
            name: "ARTES",
            displayOrder: 4,
            active: true,
          },
        ],
      });
      await prisma.studentCouncilCard.create({
        data: {
          id: "card-alpha-conf",
          schoolId: "school-alpha",
          boardId: "board-alpha-conf",
          studentId: "stu-alpha-conf",
          tags: ["Manual Tag"],
        },
      });

      await prisma.studentCouncilSubjectEntry.createMany({
        data: [
          {
            id: "entry-divergent-beta",
            schoolId: "school-beta",
            cardId: "card-alpha-conf",
            subjectId: "sub-conf-mat",
            trimester: 1,
            descriptorCodes: [2],
            grade: 3.5,
          },
          {
            id: "entry-legit-hist",
            schoolId: "school-alpha",
            cardId: "card-alpha-conf",
            subjectId: "sub-conf-hist",
            trimester: 1,
            descriptorCodes: [],
            grade: 7.5,
          },
          {
            id: "entry-manual-art",
            schoolId: "school-alpha",
            cardId: "card-alpha-conf",
            subjectId: "sub-conf-art",
            trimester: 1,
            descriptorCodes: [1],
            grade: 4.8,
          },
        ],
      });

      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;
      testAuthState.useRealExtensionSyncAuth = true;
      testAuthState.pendingSessionUser = {
        id: "bi-ped-conf",
        email: "ped.conf@redeativa.local",
        active: true,
      };

      const capturedContextSchools: Array<string | null> = [];
      const originalWithTenantContext = rlsTenantContext.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation((client, schoolId, fn) =>
          originalWithTenantContext(client, schoolId, async (tx) => {
            const [{ val }] = await tx.$queryRaw<Array<{ val: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS val
            `;
            capturedContextSchools.push(val);
            return fn(tx);
          })
        );

      try {
        vi.mocked(logAudit).mockClear();

        // 1. Combina conflito divergente (sub-conf-mat = 4.1 descartada), update legítimo (sub-conf-hist = 5.2)
        //    e insert legítimo (sub-conf-port = 8.4), preservando nota manual (sub-conf-art = 4.8)
        const rSync1 = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [],
              notasMapa: [
                {
                  cgm: "750000111",
                  nome: "Aluno Conflito Matriz",
                  disciplinaRaw: "MATEMATICA - 101",
                  nota1Tri: 4.1,
                  codturma: "T1",
                },
                {
                  cgm: "750000111",
                  nome: "Aluno Conflito Matriz",
                  disciplinaRaw: "HISTORIA - 102",
                  nota1Tri: 5.2,
                  codturma: "T1",
                },
                {
                  cgm: "750000111",
                  nome: "Aluno Conflito Matriz",
                  disciplinaRaw: "PORTUGUES - 103",
                  nota1Tri: 8.4,
                  codturma: "T1",
                },
              ],
            }),
          })
        );
        expect(rSync1.status).toBe(200);
        const body1 = await rSync1.json();
        expect(body1).toMatchObject({
          sucesso: true,
          notasGravadas: 2,
          abaixoDaMediaDetectados: 1,
          cardsAtualizados: 1,
        });
        expect(capturedContextSchools.length).toBeGreaterThan(0);
        expect(capturedContextSchools.every((s) => s === "school-alpha")).toBe(true);

        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "SYNC_CLASS_COUNCIL_BI",
            schoolId: "school-alpha",
            details: expect.objectContaining({
              notasGravadas: 2,
              abaixoDaMediaDetectados: 1,
              cardsAtualizados: 1,
            }),
          })
        );

        const divergentRow = await prisma.studentCouncilSubjectEntry.findUnique({
          where: { id: "entry-divergent-beta" },
        });
        expect(divergentRow).toMatchObject({
          schoolId: "school-beta",
          grade: 3.5,
          descriptorCodes: [2],
        });

        const histRow = await prisma.studentCouncilSubjectEntry.findUnique({
          where: {
            cardId_subjectId_trimester: {
              cardId: "card-alpha-conf",
              subjectId: "sub-conf-hist",
              trimester: 1,
            },
          },
        });
        expect(histRow).toMatchObject({ schoolId: "school-alpha", grade: 5.2 });

        const portRow = await prisma.studentCouncilSubjectEntry.findUnique({
          where: {
            cardId_subjectId_trimester: {
              cardId: "card-alpha-conf",
              subjectId: "sub-conf-port",
              trimester: 1,
            },
          },
        });
        expect(portRow).toMatchObject({ schoolId: "school-alpha", grade: 8.4 });

        const cardAfter1 = await prisma.studentCouncilCard.findUnique({
          where: { id: "card-alpha-conf" },
        });
        expect(cardAfter1?.tags).toEqual(["Manual Tag"]);
        const belowList = JSON.parse(cardAfter1?.trimester1BelowAvgJson || "[]") as Array<{
          subjectId?: string;
          grade: number | null;
        }>;
        expect(belowList.map((b) => b.subjectId)).toEqual(["sub-conf-hist", "sub-conf-art"]);
        expect(belowList.find((b) => b.subjectId === "sub-conf-mat")).toBeUndefined();

        // 2. Execução contendo apenas a nota divergente descartada não altera resumo nem incrementa contadores
        vi.mocked(logAudit).mockClear();
        const rSync2 = await conselhoSyncHandler(
          new Request("http://127.0.0.1/api/conselho-classe/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: 2026,
              turmas: [{ codturma: "T1", turmaRaw: "1º Ano A", periodoAvaliacao: "TRIMESTRAL" }],
              alunosTurma: [],
              notasMapa: [
                {
                  cgm: "750000111",
                  nome: "Aluno Conflito Matriz",
                  disciplinaRaw: "MATEMATICA - 101",
                  nota1Tri: 2.0,
                  codturma: "T1",
                },
              ],
            }),
          })
        );
        expect(rSync2.status).toBe(200);
        const body2 = await rSync2.json();
        expect(body2).toMatchObject({
          sucesso: true,
          notasGravadas: 0,
          abaixoDaMediaDetectados: 0,
          cardsAtualizados: 0,
        });
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "SYNC_CLASS_COUNCIL_BI",
            schoolId: "school-alpha",
            details: expect.objectContaining({
              notasGravadas: 0,
              abaixoDaMediaDetectados: 0,
              cardsAtualizados: 0,
            }),
          })
        );
        const cardAfter2 = await prisma.studentCouncilCard.findUnique({
          where: { id: "card-alpha-conf" },
        });
        expect(cardAfter2?.trimester1BelowAvgJson).toBe(cardAfter1?.trimester1BelowAvgJson);
      } finally {
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = null;
        testAuthState.useRealPermissions = false;
        testAuthState.useRealCurrentSchool = false;
        testAuthState.useRealExtensionSyncAuth = false;
      }
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
