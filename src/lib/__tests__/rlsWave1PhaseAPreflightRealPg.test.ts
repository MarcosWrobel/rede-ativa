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

import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { dispatchWhatsAppMessage } from "@/lib/whatsappProvider";
import { logAudit } from "@/lib/audit";
import { DELETE as deleteSchoolHandler } from "@/app/api/schools/[id]/route";
import { POST as sendMessageHandler } from "@/app/api/messages/send/route";
import { GET as getPendingMessagesHandler } from "@/app/api/messages/pending/route";
import { PATCH as patchMessageStatusHandler } from "@/app/api/messages/status/route";
import { POST as postMessageReplyHandler } from "@/app/api/messages/reply/route";

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
