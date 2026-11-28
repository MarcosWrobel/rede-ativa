import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { PrismaClient } from "@prisma/client";
import {
  reconcileMessageLogSchoolId,
  runRlsWave1Preflight,
} from "@/lib/rlsWave1Preflight";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

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
    requireSuperAdmin: vi.fn(async () => {
      if (testAuthState.useRealPermissions) {
        return actual.requireSuperAdmin();
      }
      return {
        ok: true,
        userId: null,
        userName: "Superadmin Teste",
        email: "superadmin@redeativa.local",
      };
    }),
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
          user: testAuthState.pendingSessionUser ?? {
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

vi.mock("@/lib/escolaGoogleVerify", async () => {
  const actual = await vi.importActual<typeof import("@/lib/escolaGoogleVerify")>("@/lib/escolaGoogleVerify");
  return {
    ...actual,
    verifyEscolaGoogleIdToken: vi.fn(),
  };
});

import { auth } from "@/lib/auth";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { dispatchWhatsAppMessage } from "@/lib/whatsappProvider";
import { logAudit } from "@/lib/audit";
import * as rlsTenantContext from "@/lib/rlsTenantContext";
import { POST as createSchoolHandler, GET as listSchoolsHandler } from "@/app/api/schools/route";
import { GET as getSchoolByIdHandler, DELETE as deleteSchoolHandler } from "@/app/api/schools/[id]/route";
import { POST as sanitizeSchoolHandler } from "@/app/api/schools/[id]/sanitize/route";
import { GET as getMessagesHandler } from "@/app/api/messages/route";
import { POST as webhookWhatsappHandler } from "@/app/api/webhooks/whatsapp/route";
import { POST as frequenciaSyncHandler } from "@/app/api/frequencia/sync/route";
import { POST as serpSyncHandler } from "@/app/api/serp/sync/route";
import { NextRequest } from "next/server";
import { POST as conselhoSyncHandler } from "@/app/api/conselho-classe/sync/route";
import { GET as weeklyDigestGetHandler, POST as weeklyDigestPostHandler } from "@/app/api/cron/weekly-digest/route";
import { compileWeeklyDigest } from "@/lib/weeklyDigest";
import { verifyEscolaGoogleIdToken } from "@/lib/escolaGoogleVerify";
import { GET as signTokenGetHandler, POST as signTokenPostHandler } from "@/app/api/atas/sign-token/[token]/route";
import { POST as sendMessageHandler } from "@/app/api/messages/send/route";
import { GET as getPendingMessagesHandler } from "@/app/api/messages/pending/route";
import { PATCH as patchMessageStatusHandler } from "@/app/api/messages/status/route";
import { POST as postMessageReplyHandler } from "@/app/api/messages/reply/route";
import { PUT as putMessageManageHandler, DELETE as deleteMessageManageHandler } from "@/app/api/messages/manage/route";
import { GET as secretariaMetricsHandler } from "@/app/api/secretaria/metrics/route";
import SecretariaPage from "@/app/secretaria/page";
import AdminPage from "@/app/admin/page";
import AdminEscolasPage from "@/app/admin/escolas/page";
import { GET as listTemplatesHandler, POST as createTemplateHandler, PUT as updateTemplateHandler } from "@/app/api/templates/route";
import ModelosPage from "@/app/modelos/page";
import BuscaAtivaPage from "@/app/busca-ativa/page";
import FaltasPage from "@/app/faltas/page";
import { GET as listClassesHandler, POST as createClassHandler } from "@/app/api/classes/route";
import { PATCH as patchClassHandler } from "@/app/api/classes/[id]/route";
import { GET as listLowAttHandler, POST as upsertLowAttHandler } from "@/app/api/low-attendance/route";
import {
  GET as listStudentsHandler,
  POST as createStudentHandler,
  PUT as updateStudentHandler,
  DELETE as deleteStudentHandler,
} from "@/app/api/students/route";
import { POST as importStudentsHandler } from "@/app/api/students/import/route";
import {
  POST as createAttendanceHandler,
  DELETE as deleteAttendanceHandler,
} from "@/app/api/students/[id]/attendances/route";
import {
  POST as createContactHandler,
  PUT as updateContactHandler,
  DELETE as deleteContactHandler,
} from "@/app/api/students/[id]/contacts/route";
import {
  POST as createStudentJustificationHandler,
  DELETE as deleteStudentJustificationHandler,
} from "@/app/api/students/[id]/justifications/route";
import { GET as getReportsHandler } from "@/app/api/reports/route";
import RelatoriosPage from "@/app/relatorios/page";
import AlunosPage from "@/app/alunos/page";
import ProntuarioPage from "@/app/alunos/[id]/page";
import DossiePage from "@/app/alunos/[id]/dossie/page";
import HistoricoPage from "@/app/historico/page";
import GestaoPage from "@/app/gestao/page";
import VisaoGeralPage from "@/app/visao-geral/page";
import AtestadosPage from "@/app/atestados/page";
import EncaminhamentosPage from "@/app/encaminhamentos/page";
import ProfessorConselhoPage from "@/app/conselho-classe/professor/[token]/page";
import ProfessorPreConselhoPage from "@/app/conselho-classe/pre-conselho/[token]/page";
import {
  POST as postTeacherPortalRoute,
  PUT as putTeacherPortalRoute,
} from "@/app/api/conselho-classe/teacher-portal/[token]/route";
import {
  POST as postPreCouncilPortalRoute,
  PUT as putPreCouncilPortalRoute,
} from "@/app/api/conselho-classe/pre-council-portal/[token]/route";
import {
  createCouncilTeacherToken,
  createPreCouncilTeacherToken,
} from "@/lib/councilTeacherToken";
import { renderToStaticMarkup } from "react-dom/server";

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
      await prisma.auditLog.deleteMany({});
      await prisma.pedagogicalMinuteParticipant.deleteMany({});
      await prisma.pedagogicalMinuteStudent.deleteMany({});
      await prisma.pedagogicalMinute.deleteMany({});
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

    it("integra withTenantContext ao boletim semanal (cron geral, cron explícito, escola inativa, sessão com schoolId conflitante, SSR, Fase A e turmas cruzadas)", async () => {
      const now = Date.now();
      const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);

      await prisma.school.create({
        data: {
          id: "school-inactive",
          inepCode: "99000303",
          name: "Escola Sintética Inativa",
          city: "Cidade Teste",
          state: "PR",
          nre: "NRE Teste",
          network: "MUNICIPAL",
          active: false,
        },
      });

      await prisma.classGroup.createMany({
        data: [
          {
            id: "cg-alpha-wd",
            name: "1º Ano A",
            segment: "EM",
            shift: "MANHA",
            schoolId: "school-alpha",
          },
          {
            id: "cg-beta-wd",
            name: "1º Ano A",
            segment: "EM",
            shift: "MANHA",
            schoolId: "school-beta",
          },
          {
            id: "cg-beta-wd-2",
            name: "2º Ano B",
            segment: "EM",
            shift: "TARDE",
            schoolId: "school-beta",
          },
          {
            id: "cg-inact-wd",
            name: "1º Ano A",
            segment: "EM",
            shift: "MANHA",
            schoolId: "school-inactive",
          },
        ],
      });

      await prisma.student.createMany({
        data: [
          {
            id: "stu-wd-a1",
            name: "Ana Boletim Alpha",
            cgm: "810000101",
            phone: "41999998101",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-wd",
            active: true,
          },
          {
            id: "stu-wd-a2",
            name: "Bruno Ação Alpha",
            cgm: "810000102",
            phone: "41999998102",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha-wd",
            active: true,
          },
          {
            id: "stu-wd-cross",
            name: "Carlos Turma Cruzada",
            cgm: "810000103",
            phone: "41999998103",
            schoolId: "school-alpha",
            classGroupId: "cg-beta-wd-2",
            active: true,
          },
          {
            id: "stu-wd-b1",
            name: "Daniela Boletim Beta",
            cgm: "820000101",
            phone: "41999998201",
            schoolId: "school-beta",
            classGroupId: "cg-beta-wd",
            active: true,
          },
          {
            id: "stu-wd-inact",
            name: "Eduardo Escola Inativa",
            cgm: "830000101",
            phone: "41999998301",
            schoolId: "school-inactive",
            classGroupId: "cg-inact-wd",
            active: true,
          },
        ],
      });

      await prisma.lowAttendanceRecord.createMany({
        data: [
          {
            id: "la-wd-a1",
            studentId: "stu-wd-a1",
            attendancePercent: 60.0,
            serpStatus: "EM_ANDAMENTO",
            serpProtocol: "SERP-101",
          },
          {
            id: "la-wd-a2",
            studentId: "stu-wd-a2",
            attendancePercent: 55.0,
          },
          {
            id: "la-wd-cross",
            studentId: "stu-wd-cross",
            attendancePercent: 40.0,
            serpStatus: "EM_ANDAMENTO",
          },
          {
            id: "la-wd-b1",
            studentId: "stu-wd-b1",
            attendancePercent: 62.0,
          },
          {
            id: "la-wd-inact",
            studentId: "stu-wd-inact",
            attendancePercent: 50.0,
          },
        ],
      });

      await prisma.attendanceSnapshot.createMany({
        data: [
          {
            id: "snap-wd-a1",
            studentId: "stu-wd-a1",
            referenceWeek: "2026-W48",
            attendancePercent: 60.0,
            weeklyPercent: 60.0,
            previousWeeklyPercent: 85.0,
            recordedAt: oneDayAgo,
          },
          {
            id: "snap-wd-cross",
            studentId: "stu-wd-cross",
            referenceWeek: "2026-W48",
            attendancePercent: 50.0,
            weeklyPercent: 50.0,
            previousWeeklyPercent: 90.0,
            recordedAt: oneDayAgo,
          },
          {
            id: "snap-wd-b1",
            studentId: "stu-wd-b1",
            referenceWeek: "2026-W48",
            attendancePercent: 62.0,
            weeklyPercent: 62.0,
            previousWeeklyPercent: 88.0,
            recordedAt: oneDayAgo,
          },
        ],
      });

      await prisma.messageLog.createMany({
        data: [
          // Legado nulo elegível para stu-wd-a1 (deve contar e ser o último contato)
          {
            id: "ml-wd-a1-legacy",
            studentId: "stu-wd-a1",
            schoolId: null,
            reasonTitle: "Faltas",
            messageContent: "Contato legado elegível",
            phoneUsed: "41999998101",
            sentByName: "Sistema",
            sentAt: twoDaysAgo,
            guardianReplied: true,
            deliveryStatus: "READ",
          },
          // Divergente mais recente para stu-wd-a1 (deve ser excluído do último contato e dos totais)
          {
            id: "ml-wd-a1-div",
            studentId: "stu-wd-a1",
            schoolId: "school-beta",
            reasonTitle: "Faltas",
            messageContent: "Contato divergente",
            phoneUsed: "41999998101",
            sentByName: "Sistema",
            sentAt: oneDayAgo,
            guardianReplied: false,
            deliveryStatus: "SENT",
          },
          // Divergente único para stu-wd-a2 (stu-wd-a2 deve permanecer sem contato na fila de ação)
          {
            id: "ml-wd-a2-div",
            studentId: "stu-wd-a2",
            schoolId: "school-beta",
            reasonTitle: "Faltas",
            messageContent: "Contato divergente a2",
            phoneUsed: "41999998102",
            sentByName: "Sistema",
            sentAt: oneDayAgo,
            guardianReplied: false,
            deliveryStatus: "SENT",
          },
          // Log de aluno com turma cruzada (não deve contar no boletim de school-alpha)
          {
            id: "ml-wd-cross",
            studentId: "stu-wd-cross",
            schoolId: "school-alpha",
            reasonTitle: "Faltas",
            messageContent: "Contato turma cruzada",
            phoneUsed: "41999998103",
            sentByName: "Sistema",
            sentAt: oneDayAgo,
            guardianReplied: true,
            deliveryStatus: "READ",
          },
          // Log legítimo de school-beta
          {
            id: "ml-wd-b1",
            studentId: "stu-wd-b1",
            schoolId: "school-beta",
            reasonTitle: "Faltas",
            messageContent: "Contato beta",
            phoneUsed: "41999998201",
            sentByName: "Sistema",
            sentAt: twoDaysAgo,
            guardianReplied: false,
            deliveryStatus: "DELIVERED",
          },
        ],
      });

      await prisma.user.create({
        data: {
          id: "wd-ped-a",
          name: "Pedagoga Boletim",
          email: "ped.boletim@redeativa.local",
          role: "PEDAGOGA",
          active: true,
          schoolId: "school-alpha",
        },
      });
      await prisma.userSchool.create({
        data: {
          id: "us-wd-ped-a",
          userId: "wd-ped-a",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      });

      const originalCronSecret = process.env.CRON_SECRET;
      process.env.CRON_SECRET = "cron-pg16-secret";
      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;

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
        // 1. Sem credencial válida -> 401 sem abrir contexto transacional
        testAuthState.pendingSessionUser = null;
        vi.mocked(auth).mockResolvedValueOnce(null as any);
        const r401 = await weeklyDigestGetHandler(
          new NextRequest("http://127.0.0.1/api/cron/weekly-digest", {
            headers: { authorization: "Bearer wrong-secret" },
          })
        );
        expect(r401.status).toBe(401);
        expect(withTenantSpy).not.toHaveBeenCalled();

        // 2. Cron com escola inativa ou ausente -> 404
        const rInactive = await weeklyDigestGetHandler(
          new NextRequest("http://127.0.0.1/api/cron/weekly-digest?schoolId=school-inactive", {
            headers: { authorization: "Bearer cron-pg16-secret" },
          })
        );
        expect(rInactive.status).toBe(404);

        const rMissing = await weeklyDigestGetHandler(
          new NextRequest("http://127.0.0.1/api/cron/weekly-digest?schoolId=school-nao-existe", {
            headers: { authorization: "Bearer cron-pg16-secret" },
          })
        );
        expect(rMissing.status).toBe(404);
        expect(withTenantSpy).not.toHaveBeenCalled();

        // 3. Cron geral sem schoolId: enumera apenas escolas ativas, abre Tx independente por escola e não vaza contexto pós-Tx
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();
        const rCronAll = await weeklyDigestGetHandler(
          new NextRequest("http://127.0.0.1/api/cron/weekly-digest", {
            headers: { authorization: "Bearer cron-pg16-secret" },
          })
        );
        expect(rCronAll.status).toBe(200);
        const cronAllBody = await rCronAll.json();
        expect(cronAllBody.totalSchools).toBe(2);
        expect(cronAllBody.digests).toHaveLength(2);
        expect(capturedContextSchools).toEqual(["school-alpha", "school-beta"]);
        const [{ afterAllVal }] = await prisma.$queryRaw<Array<{ afterAllVal: string | null }>>`
          SELECT current_setting('app.current_school_id', true) AS "afterAllVal"
        `;
        expect(afterAllVal ?? "").toBe("");
        expect(vi.mocked(logAudit)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({ schoolId: "school-alpha", action: "GENERATE_WEEKLY_DIGEST" })
        );
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({ schoolId: "school-beta", action: "GENERATE_WEEKLY_DIGEST" })
        );

        // 4. Cron com schoolId=school-alpha explícito: comprova Fase A e exclusão de turma cruzada
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();
        const rCronAlpha = await weeklyDigestGetHandler(
          new NextRequest("http://127.0.0.1/api/cron/weekly-digest?schoolId=school-alpha", {
            headers: { authorization: "Bearer cron-pg16-secret" },
          })
        );
        expect(rCronAlpha.status).toBe(200);
        const alphaBody = await rCronAlpha.json();
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(alphaBody.school.inepCode).toBe("99000101");
        expect(alphaBody.kpis).toMatchObject({
          totalStudents: 3,
          criticalCount: 2,
          criticalWithoutRecentContactCount: 1,
          serpActiveCount: 1,
          sentLast7Days: 1,
          repliedLast7Days: 1,
          replyRatePercent: 100,
          abruptDropCount: 1,
        });
        expect(alphaBody.topRiskClasses).toEqual([
          { className: "1º Ano A", shift: "MANHA", criticalCount: 2 },
        ]);
        expect(alphaBody.abruptDrops).toHaveLength(1);
        expect(alphaBody.abruptDrops[0]).toMatchObject({
          studentId: "stu-wd-a1",
          className: "1º Ano A",
          drop: 25,
        });
        expect(alphaBody.actionQueue).toHaveLength(1);
        expect(alphaBody.actionQueue[0]).toMatchObject({
          id: "stu-wd-a2",
          lastContactAt: null,
          daysWithoutContact: null,
        });

        // 5. Geração manual por sessão ignora ?schoolId=school-beta conflitante e usa escola da sessão
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();
        testAuthState.pendingSessionUser = {
          id: "wd-ped-a",
          email: "ped.boletim@redeativa.local",
          active: true,
        };
        const rSessionPost = await weeklyDigestPostHandler(
          new NextRequest("http://127.0.0.1/api/cron/weekly-digest?schoolId=school-beta", {
            method: "POST",
          })
        );
        expect(rSessionPost.status).toBe(200);
        const sessionBody = await rSessionPost.json();
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(sessionBody.school.inepCode).toBe("99000101");
        expect(sessionBody.kpis).toMatchObject(alphaBody.kpis);
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({
            schoolId: "school-alpha",
            action: "GENERATE_WEEKLY_DIGEST",
            details: expect.objectContaining({ source: "MANUAL_UI" }),
          })
        );

        // 6. Chamada usada pelo SSR (/boletim/page.tsx)
        capturedContextSchools.length = 0;
        const ssrDigest = await compileWeeklyDigest("school-alpha");
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(ssrDigest.kpis).toMatchObject(alphaBody.kpis);
        expect(ssrDigest.abruptDrops).toHaveLength(1);
        expect(ssrDigest.actionQueue).toHaveLength(1);
        const [{ afterSsrVal }] = await prisma.$queryRaw<Array<{ afterSsrVal: string | null }>>`
          SELECT current_setting('app.current_school_id', true) AS "afterSsrVal"
        `;
        expect(afterSsrVal ?? "").toBe("");
      } finally {
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = null;
        testAuthState.useRealPermissions = false;
        testAuthState.useRealCurrentSchool = false;
        if (originalCronSecret === undefined) {
          delete process.env.CRON_SECRET;
        } else {
          process.env.CRON_SECRET = originalCronSecret;
        }
      }
    });

    it("integra withTenantContext em GET e POST /api/atas/sign-token/[token] (anonimização, vínculo legado cruzado, conflito de escola na requisição, OAuth, dryRun, expiração, revisão, reabertura e concorrência)", async () => {
      await prisma.student.createMany({
        data: [
          {
            id: "stu-sign-a1",
            name: "Lucas Primeiro Alpha",
            cgm: "910000101",
            phone: "41999999101",
            email: null,
            schoolId: "school-alpha",
            classGroupId: "cg-alpha",
            active: true,
          },
          {
            id: "stu-sign-a2",
            name: "Mariana Segunda Alpha",
            cgm: "910000102",
            phone: "41999999102",
            email: "mariana.existente@escola.pr.gov.br",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha",
            active: true,
          },
          {
            id: "stu-sign-b-legacy",
            name: "Nome Cadastral Beta",
            cgm: "920000101",
            phone: "41999999201",
            email: null,
            schoolId: "school-beta",
            classGroupId: "cg-beta",
            active: true,
          },
        ],
      });

      const futureExpiry = new Date(Date.now() + 30 * 60 * 1000);
      const pastExpiry = new Date(Date.now() - 5 * 60 * 1000);

      // Ata 1: dois estudantes da school-alpha (anonimização + OAuth email null/existente + dryRun + concorrência)
      await prisma.pedagogicalMinute.create({
        data: {
          id: "min-sign-alpha",
          schoolId: "school-alpha",
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          subject: "Atendimento conjunto Lucas Primeiro Alpha e Mariana Segunda Alpha",
          summary:
            "Registro oficial referente a Lucas Primeiro Alpha e Mariana Segunda Alpha com acompanhamento pedagógico.",
          agreementsSummary: "Contato com responsáveis de Mariana Segunda Alpha e Lucas Primeiro Alpha.",
          authorName: "Pedagoga Alpha",
          authorEmail: "ped.alpha@escola.pr.gov.br",
        },
      });
      await prisma.pedagogicalMinuteStudent.createMany({
        data: [
          {
            id: "pms-sign-a1",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a1",
            studentNameSnapshot: "Lucas Primeiro Alpha",
          },
          {
            id: "pms-sign-a2",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a2",
            studentNameSnapshot: "Mariana Segunda Alpha",
          },
        ],
      });
      await prisma.pedagogicalMinuteParticipant.createMany({
        data: [
          {
            id: "pmp-resp-a1",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a1",
            name: "Responsável Lucas",
            role: "RESPONSAVEL",
            mobileSignToken: "tok-pg16-get-valid",
            mobileSignExpiresAt: futureExpiry,
            mobileSignRevision: 1,
            hasActiveSignLink: true,
          },
          {
            id: "pmp-est-a1-oauth",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a1",
            name: "Lucas Primeiro Alpha",
            role: "ESTUDANTE",
            mobileSignToken: "tok-pg16-oauth-null",
            mobileSignExpiresAt: futureExpiry,
            mobileSignRevision: 1,
            hasActiveSignLink: true,
          },
          {
            id: "pmp-est-a2-existing",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a2",
            name: "Mariana Segunda Alpha",
            role: "ESTUDANTE",
            mobileSignToken: "tok-pg16-oauth-keep",
            mobileSignExpiresAt: futureExpiry,
            mobileSignRevision: 1,
            hasActiveSignLink: true,
          },
          {
            id: "pmp-race-qr",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a1",
            name: "Pai Concorrência",
            role: "RESPONSAVEL",
            mobileSignToken: "tok-pg16-race-unique",
            mobileSignExpiresAt: futureExpiry,
            mobileSignRevision: 1,
            hasActiveSignLink: true,
          },
          {
            id: "pmp-expired",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a1",
            name: "Expirado",
            role: "RESPONSAVEL",
            mobileSignToken: "tok-pg16-expired",
            mobileSignExpiresAt: pastExpiry,
            mobileSignRevision: 1,
            hasActiveSignLink: true,
          },
          {
            id: "pmp-superseded",
            minuteId: "min-sign-alpha",
            studentId: "stu-sign-a1",
            name: "Revisão Superada",
            role: "RESPONSAVEL",
            mobileSignToken: "tok-pg16-superseded",
            mobileSignExpiresAt: futureExpiry,
            mobileSignRevision: 0,
            hasActiveSignLink: true,
          },
        ],
      });

      // Ata 2: vínculo legado inconsistente apontando para stu-sign-b-legacy (school-beta)
      await prisma.pedagogicalMinute.create({
        data: {
          id: "min-sign-legacy-cross",
          schoolId: "school-alpha",
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          subject: "Atendimento Lucas Primeiro Alpha e Nome Histórico Beta (Nome Cadastral Beta)",
          summary:
            "Ata oficial envolvendo Lucas Primeiro Alpha e Nome Histórico Beta, mantendo sigilo entre menores.",
          agreementsSummary: "Encaminhamento para Nome Histórico Beta.",
          authorName: "Pedagoga Alpha",
          authorEmail: "ped.alpha@escola.pr.gov.br",
        },
      });
      await prisma.pedagogicalMinuteStudent.createMany({
        data: [
          {
            id: "pms-leg-a1",
            minuteId: "min-sign-legacy-cross",
            studentId: "stu-sign-a1",
            studentNameSnapshot: "Lucas Primeiro Alpha",
          },
          {
            id: "pms-leg-b",
            minuteId: "min-sign-legacy-cross",
            studentId: "stu-sign-b-legacy",
            studentNameSnapshot: "Nome Histórico Beta",
          },
        ],
      });
      await prisma.pedagogicalMinuteParticipant.createMany({
        data: [
          {
            id: "pmp-leg-resp",
            minuteId: "min-sign-legacy-cross",
            studentId: "stu-sign-a1",
            name: "Responsável Legado",
            role: "RESPONSAVEL",
            mobileSignToken: "tok-pg16-legacy-get",
            mobileSignExpiresAt: futureExpiry,
            mobileSignRevision: 1,
            hasActiveSignLink: true,
          },
          {
            id: "pmp-leg-oauth-div",
            minuteId: "min-sign-legacy-cross",
            studentId: "stu-sign-b-legacy",
            name: "Nome Histórico Beta",
            role: "ESTUDANTE",
            mobileSignToken: "tok-pg16-oauth-div",
            mobileSignExpiresAt: futureExpiry,
            mobileSignRevision: 1,
            hasActiveSignLink: true,
          },
        ],
      });

      // Ata 3: ata de um único estudante com vínculo divergente (stu-sign-b-legacy pertence à school-beta)
      await prisma.pedagogicalMinute.create({
        data: {
          id: "min-sign-single-div",
          schoolId: "school-alpha",
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          subject: "Atendimento individual Nome Cadastral Beta (grafia Nome Histórico Beta)",
          summary: "Resumo oficial de atendimento individual de Nome Cadastral Beta.",
          agreementsSummary: "Combinados com Nome Histórico Beta.",
          authorName: "Pedagoga Alpha",
          authorEmail: "ped.alpha@escola.pr.gov.br",
        },
      });
      await prisma.pedagogicalMinuteStudent.create({
        data: {
          id: "pms-single-div",
          minuteId: "min-sign-single-div",
          studentId: "stu-sign-b-legacy",
          studentNameSnapshot: "Nome Histórico Beta",
        },
      });
      await prisma.pedagogicalMinuteParticipant.create({
        data: {
          id: "pmp-single-div",
          minuteId: "min-sign-single-div",
          studentId: null,
          name: "Responsável Único Divergente",
          role: "RESPONSAVEL",
          mobileSignToken: "tok-pg16-single-div",
          mobileSignExpiresAt: futureExpiry,
          mobileSignRevision: 1,
          hasActiveSignLink: true,
        },
      });

      // Ata 4: estudante da ata é coerente (stu-sign-a1), mas participant.studentId pertence à school-beta
      await prisma.pedagogicalMinute.create({
        data: {
          id: "min-sign-part-div",
          schoolId: "school-alpha",
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          subject: "Atendimento Lucas Primeiro Alpha com participante divergente",
          summary: "Resumo oficial referente a Lucas Primeiro Alpha na escola Alpha.",
          agreementsSummary: "Combinados para Lucas Primeiro Alpha.",
          authorName: "Pedagoga Alpha",
          authorEmail: "ped.alpha@escola.pr.gov.br",
        },
      });
      await prisma.pedagogicalMinuteStudent.create({
        data: {
          id: "pms-part-div",
          minuteId: "min-sign-part-div",
          studentId: "stu-sign-a1",
          studentNameSnapshot: "Lucas Primeiro Alpha",
        },
      });
      await prisma.pedagogicalMinuteParticipant.create({
        data: {
          id: "pmp-part-div",
          minuteId: "min-sign-part-div",
          studentId: "stu-sign-b-legacy",
          name: "Participante Divergente",
          role: "RESPONSAVEL",
          mobileSignToken: "tok-pg16-part-div",
          mobileSignExpiresAt: futureExpiry,
          mobileSignRevision: 1,
          hasActiveSignLink: true,
        },
      });

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
        // 1. GET válido com anonimização e tentativa de forjar escola por query/headers/cookies
        capturedContextSchools.length = 0;
        const rGetValid = await signTokenGetHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-get-valid?schoolId=school-beta", {
            headers: {
              "x-school-id": "school-beta",
              cookie: "active_school_id=school-beta",
            },
          }),
          { params: Promise.resolve({ token: "tok-pg16-get-valid" }) }
        );
        expect(rGetValid.status).toBe(200);
        const getValidBody = await rGetValid.json();
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(getValidBody.participant.schoolName).toBe("Escola Sintética Alpha");
        expect(getValidBody.participant.subject).toContain("Lucas Primeiro Alpha");
        expect(getValidBody.participant.subject).not.toContain("Mariana Segunda Alpha");
        expect(getValidBody.participant.summary).not.toContain("Mariana Segunda Alpha");
        expect(getValidBody.participant.agreementsSummary).not.toContain("Mariana Segunda Alpha");

        // 2. GET com vínculos divergentes (entre vários estudantes, estudante único e participant.studentId externo):
        //    bloqueia com resposta pública genérica (409 STUDENT_LINK_UNVERIFIED), sem expor conteúdo da ata ou dados das fixtures
        for (const divToken of ["tok-pg16-legacy-get", "tok-pg16-single-div", "tok-pg16-part-div"]) {
          capturedContextSchools.length = 0;
          const rGetDiv = await signTokenGetHandler(
            new Request(`http://127.0.0.1/api/atas/sign-token/${divToken}`),
            { params: Promise.resolve({ token: divToken }) }
          );
          expect(rGetDiv.status).toBe(409);
          const divRaw = await rGetDiv.text();
          const divBody = JSON.parse(divRaw);
          expect(capturedContextSchools).toEqual(["school-alpha"]);
          expect(divBody).toEqual({
            error:
              "Não foi possível confirmar o vínculo escolar dos registros desta ata. Procure a equipe escolar para revisar o vínculo.",
            code: "STUDENT_LINK_UNVERIFIED",
          });
          expect(divBody.participant).toBeUndefined();
          for (const forbidden of [
            "Lucas Primeiro Alpha",
            "Mariana Segunda Alpha",
            "Nome Histórico Beta",
            "Nome Cadastral Beta",
            "Responsável Legado",
            "Responsável Único Divergente",
            "Participante Divergente",
            "Escola Sintética",
            "Atendimento",
            "Resumo oficial",
          ]) {
            expect(divRaw).not.toContain(forbidden);
          }
        }

        // 3. POST dryRun com OAuth: valida identidade fora da transação e não grava assinatura nem altera Student
        capturedContextSchools.length = 0;
        vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
          ok: true,
          tokenInfo: {
            email: "lucas.primeiro@escola.pr.gov.br",
            email_verified: true,
            name: "Lucas Primeiro Alpha",
            sub: "sub-lucas-1",
          },
        });
        const rDryRun = await signTokenPostHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-oauth-null", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              googleIdToken: "fake-id-token-dry",
              dryRun: true,
            }),
          }),
          { params: Promise.resolve({ token: "tok-pg16-oauth-null" }) }
        );
        expect(rDryRun.status).toBe(200);
        expect((await rDryRun.json()).dryRun).toBe(true);
        expect(capturedContextSchools).toEqual([]);
        const lucasAfterDry = await prisma.student.findUnique({ where: { id: "stu-sign-a1" } });
        expect(lucasAfterDry?.email).toBeNull();

        // 4. POST OAuth preenche e-mail nulo na escola correta dentro de withTenantContext
        capturedContextSchools.length = 0;
        vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
          ok: true,
          tokenInfo: {
            email: "lucas.primeiro@escola.pr.gov.br",
            email_verified: true,
            name: "Lucas Primeiro Alpha",
            sub: "sub-lucas-1",
          },
        });
        const rOAuthFill = await signTokenPostHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-oauth-null?schoolId=school-beta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              googleIdToken: "fake-id-token-fill",
            }),
          }),
          { params: Promise.resolve({ token: "tok-pg16-oauth-null" }) }
        );
        expect(rOAuthFill.status).toBe(200);
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        const lucasAfterFill = await prisma.student.findUnique({ where: { id: "stu-sign-a1" } });
        expect(lucasAfterFill?.email).toBe("lucas.primeiro@escola.pr.gov.br");

        // 5. POST OAuth preserva e-mail existente na escola correta
        capturedContextSchools.length = 0;
        vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
          ok: true,
          tokenInfo: {
            email: "mariana.nova@escola.pr.gov.br",
            email_verified: true,
            name: "Mariana Segunda Alpha",
            sub: "sub-mariana-2",
          },
        });
        const rOAuthKeep = await signTokenPostHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-oauth-keep", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              googleIdToken: "fake-id-token-keep",
            }),
          }),
          { params: Promise.resolve({ token: "tok-pg16-oauth-keep" }) }
        );
        expect(rOAuthKeep.status).toBe(200);
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        const marianaAfterKeep = await prisma.student.findUnique({ where: { id: "stu-sign-a2" } });
        expect(marianaAfterKeep?.email).toBe("mariana.existente@escola.pr.gov.br");

        // 6. POST OAuth com studentId de outra escola (vínculo divergente): zero alterações em Student da outra escola
        capturedContextSchools.length = 0;
        vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
          ok: true,
          tokenInfo: {
            email: "historico.beta@escola.pr.gov.br",
            email_verified: true,
            name: "Nome Histórico Beta",
            sub: "sub-beta-div",
          },
        });
        const rOAuthDiv = await signTokenPostHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-oauth-div", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              googleIdToken: "fake-id-token-div",
            }),
          }),
          { params: Promise.resolve({ token: "tok-pg16-oauth-div" }) }
        );
        expect(rOAuthDiv.status).toBe(200);
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        const betaAfterDiv = await prisma.student.findUnique({ where: { id: "stu-sign-b-legacy" } });
        expect(betaAfterDiv?.email).toBeNull();

        // 7. Regressões: expiração (410), revisão superada (409) e revogação pós-reabertura (404)
        const rExpired = await signTokenGetHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-expired"),
          { params: Promise.resolve({ token: "tok-pg16-expired" }) }
        );
        expect(rExpired.status).toBe(410);

        const rSuperseded = await signTokenPostHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-superseded", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            }),
          }),
          { params: Promise.resolve({ token: "tok-pg16-superseded" }) }
        );
        expect(rSuperseded.status).toBe(409);

        // Simula reabertura revogando o token no banco
        await prisma.pedagogicalMinuteParticipant.update({
          where: { id: "pmp-superseded" },
          data: { mobileSignToken: null, hasActiveSignLink: false },
        });
        const rRevoked = await signTokenGetHandler(
          new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-superseded"),
          { params: Promise.resolve({ token: "tok-pg16-superseded" }) }
        );
        expect(rRevoked.status).toBe(404);

        // 8. Dois envios simultâneos com o mesmo token sintético: apenas 1 assinatura registrada
        const validPng =
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const [raceRes1, raceRes2] = await Promise.all([
          signTokenPostHandler(
            new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-race-unique", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expectedRevision: 1, signatureData: validPng }),
            }),
            { params: Promise.resolve({ token: "tok-pg16-race-unique" }) }
          ),
          signTokenPostHandler(
            new Request("http://127.0.0.1/api/atas/sign-token/tok-pg16-race-unique", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expectedRevision: 1, signatureData: validPng }),
            }),
            { params: Promise.resolve({ token: "tok-pg16-race-unique" }) }
          ),
        ]);
        const raceStatuses = [raceRes1.status, raceRes2.status].sort((a, b) => a - b);
        expect(raceStatuses[0]).toBe(200);
        expect([404, 409]).toContain(raceStatuses[1]);

        const raceParticipant = await prisma.pedagogicalMinuteParticipant.findUnique({
          where: { id: "pmp-race-qr" },
        });
        expect(raceParticipant?.hasSignature).toBe(true);
        expect(raceParticipant?.mobileSignToken).toBeNull();
      } finally {
        withTenantSpy.mockRestore();
      }
    });

    it("integra withTenantContext no ciclo de vida das escolas (POST /api/schools, POST /api/schools/[id]/sanitize e DELETE /api/schools/[id]) com isolamento entre escolas, proteção da piloto e rollback", async () => {
      await prisma.user.createMany({
        data: [
          {
            id: "lc-super",
            name: "SuperAdmin Ciclo",
            email: "super.ciclo@redeativa.local",
            role: "SUPERADMIN",
            active: true,
          },
          {
            id: "lc-ped",
            name: "Pedagoga Ciclo",
            email: "ped.ciclo@redeativa.local",
            role: "PEDAGOGA",
            active: true,
            schoolId: "school-alpha",
          },
        ],
      });
      await prisma.userSchool.create({
        data: {
          id: "us-lc-ped-a",
          userId: "lc-ped",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      });
      await prisma.school.create({
        data: {
          id: "default-leopoldina",
          inepCode: "41042730",
          name: "Unidade Piloto Sintética",
          city: "Cidade Piloto",
          state: "PR",
          nre: "NRE Piloto",
          network: "ESTADUAL",
          active: true,
        },
      });

      testAuthState.useRealPermissions = true;

      const capturedContextSchools: Array<string | null> = [];
      const originalWithTenantContext = rlsTenantContext.withTenantContext;
      let failStarterTemplate = false;
      let failAuditStrictCreate = false;
      let lastCleanupPid: number | null = null;
      let beforeTxHook: (() => Promise<void>) | null = null;
      let beforeDeleteHook: (() => Promise<void>) | null = null;
      const waitForPgLockOnPid = async (blockedPid: number, expectedBlockerPid: number) => {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<
            Array<{ waitEventType: string | null; blockingPids: number[] }>
          >`
            SELECT
              a.wait_event_type AS "waitEventType",
              pg_blocking_pids(a.pid) AS "blockingPids"
            FROM pg_stat_activity a
            WHERE a.pid = ${blockedPid}
          `;
          const row = rows[0];
          if (
            row?.waitEventType === "Lock" &&
            Array.isArray(row.blockingPids) &&
            row.blockingPids.includes(expectedBlockerPid)
          ) {
            return row;
          }
          await new Promise((r) => setTimeout(r, 15));
        }
        throw new Error(
          `Timeout aguardando bloqueio PostgreSQL de pid=${blockedPid} por blocker=${expectedBlockerPid}`
        );
      };
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation((client, schoolId, fn) =>
          originalWithTenantContext(client, schoolId, async (tx) => {
            if (beforeTxHook) {
              const hook = beforeTxHook;
              beforeTxHook = null;
              await hook();
            }
            const [{ val, pid }] = await tx.$queryRaw<Array<{ val: string | null; pid: number }>>`
              SELECT
                current_setting('app.current_school_id', true) AS val,
                pg_backend_pid() AS pid
            `;
            lastCleanupPid = pid;
            capturedContextSchools.push(val);
            if (failStarterTemplate) {
              let count = 0;
              const origCreate = tx.messageTemplate.create.bind(tx.messageTemplate);
              const wrappedTx = {
                ...tx,
                messageTemplate: {
                  ...tx.messageTemplate,
                  create: async (args: any) => {
                    count++;
                    if (count === 2) {
                      throw new Error("Simulated starter template failure");
                    }
                    return origCreate(args);
                  },
                },
              } as unknown as typeof tx;
              return fn(wrappedTx);
            }
            if (failAuditStrictCreate || beforeDeleteHook) {
              const origAuditCreate = tx.auditLog.create.bind(tx.auditLog);
              const origMsgDeleteMany = tx.messageLog.deleteMany.bind(tx.messageLog);
              const wrappedTx = {
                ...tx,
                messageLog: {
                  ...tx.messageLog,
                  deleteMany: async (args: any) => {
                    if (beforeDeleteHook) {
                      const hook = beforeDeleteHook;
                      beforeDeleteHook = null;
                      await hook();
                    }
                    return origMsgDeleteMany(args);
                  },
                },
                auditLog: {
                  ...tx.auditLog,
                  create: async (args: any) => {
                    if (failAuditStrictCreate) {
                      throw new Error("Simulated AuditLog failure inside DELETE tx");
                    }
                    return origAuditCreate(args);
                  },
                },
              } as unknown as typeof tx;
              return fn(wrappedTx);
            }
            return fn(tx);
          })
        );

      try {
        // 1. Negativa por papel (PEDAGOGA) -> 403 sem abrir withTenantContext
        testAuthState.pendingSessionUser = {
          id: "lc-ped",
          email: "ped.ciclo@redeativa.local",
          active: true,
        };
        capturedContextSchools.length = 0;
        const rPedCreate = await createSchoolHandler(
          new Request("http://127.0.0.1/api/schools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inepCode: "99000701",
              name: "Escola Não Autorizada",
              network: "ESTADUAL",
              city: "Cidade Teste",
              state: "PR",
            }),
          })
        );
        expect(rPedCreate.status).toBe(403);

        const rPedSan = await sanitizeSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha/sanitize", { method: "POST" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rPedSan.status).toBe(403);

        const rPedDel = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rPedDel.status).toBe(403);
        expect(capturedContextSchools).toEqual([]);

        // 2. Proteção da escola piloto (INEP 41042730 e ID default-leopoldina) -> 403
        testAuthState.pendingSessionUser = {
          id: "lc-super",
          email: "super.ciclo@redeativa.local",
          active: true,
        };
        const rPilotCreate = await createSchoolHandler(
          new Request("http://127.0.0.1/api/schools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inepCode: "41042730",
              name: "Tentativa Piloto",
              network: "ESTADUAL",
              city: "Cidade Piloto",
              state: "PR",
            }),
          })
        );
        expect(rPilotCreate.status).toBe(403);

        const rPilotSan = await sanitizeSchoolHandler(
          new Request("http://127.0.0.1/api/schools/default-leopoldina/sanitize", { method: "POST" }),
          { params: Promise.resolve({ id: "default-leopoldina" }) }
        );
        expect(rPilotSan.status).toBe(403);

        const rPilotDel = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/default-leopoldina", { method: "DELETE" }),
          { params: Promise.resolve({ id: "default-leopoldina" }) }
        );
        expect(rPilotDel.status).toBe(403);

        // 3. POST /api/schools legítimo cria escola, 3 modelos starter em withTenantContext e vínculo do criador
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();
        const rCreateOk = await createSchoolHandler(
          new Request("http://127.0.0.1/api/schools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inepCode: "99000777",
              name: "Escola Ciclo Criada",
              network: "ESTADUAL",
              city: "Cidade Ciclo",
              state: "PR",
            }),
          })
        );
        expect(rCreateOk.status).toBe(201);
        const createdOkBody = await rCreateOk.json();
        const createdOkId = createdOkBody.school.id as string;
        expect(capturedContextSchools).toEqual([createdOkId]);
        const createdTemplates = await prisma.messageTemplate.findMany({
          where: { schoolId: createdOkId },
        });
        expect(createdTemplates).toHaveLength(3);
        const creatorLink = await prisma.userSchool.findUnique({
          where: { userId_schoolId: { userId: "lc-super", schoolId: createdOkId } },
        });
        expect(creatorLink?.role).toBe("GESTOR_ESCOLAR");
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({ action: "CREATE_SCHOOL", schoolId: createdOkId })
        );

        // 4. POST /api/schools com falha no 2º modelo starter: rollback dos modelos (0 gravados), mas preserva criação e vínculo
        failStarterTemplate = true;
        capturedContextSchools.length = 0;
        const rCreateFailTpl = await createSchoolHandler(
          new Request("http://127.0.0.1/api/schools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inepCode: "99000778",
              name: "Escola Falha Starter",
              network: "ESTADUAL",
              city: "Cidade Ciclo",
              state: "PR",
            }),
          })
        );
        failStarterTemplate = false;
        expect(rCreateFailTpl.status).toBe(201);
        const createdFailId = (await rCreateFailTpl.json()).school.id as string;
        expect(capturedContextSchools).toEqual([createdFailId]);
        const rolledBackTemplates = await prisma.messageTemplate.findMany({
          where: { schoolId: createdFailId },
        });
        expect(rolledBackTemplates).toHaveLength(0);

        // Limpa as duas escolas criadas antes de testar conflitos em school-alpha/school-beta
        await prisma.messageTemplate.deleteMany({ where: { schoolId: { in: [createdOkId, createdFailId] } } });
        await prisma.userSchool.deleteMany({ where: { schoolId: { in: [createdOkId, createdFailId] } } });
        await prisma.school.deleteMany({ where: { id: { in: [createdOkId, createdFailId] } } });

        // 5. Configura school-alpha e school-beta com dados legítimos + dependências divergentes
        await prisma.student.createMany({
          data: [
            {
              id: "stu-lc-a1",
              name: "Aluno Ciclo Alpha",
              cgm: "950000101",
              phone: "41999999501",
              schoolId: "school-alpha",
              classGroupId: "cg-alpha",
              active: true,
            },
            {
              id: "stu-lc-b1",
              name: "Aluno Ciclo Beta",
              cgm: "950000201",
              phone: "41999999502",
              schoolId: "school-beta",
              classGroupId: "cg-beta",
              active: true,
            },
          ],
        });
        await prisma.messageTemplate.createMany({
          data: [
            {
              id: "tpl-lc-a",
              schoolId: "school-alpha",
              title: "Modelo Alpha",
              segment: "TODOS",
              prefixText: "Olá {aluno}",
              suffixText: "Fim",
              active: true,
            },
            {
              id: "tpl-lc-b",
              schoolId: "school-beta",
              title: "Modelo Beta",
              segment: "TODOS",
              prefixText: "Olá {aluno}",
              suffixText: "Fim",
              active: true,
            },
          ],
        });
        await prisma.messageLog.createMany({
          data: [
            {
              id: "ml-lc-a-legacy",
              schoolId: null,
              studentId: "stu-lc-a1",
              templateId: "tpl-lc-a",
              reasonTitle: "Faltas",
              messageContent: "Legado Alpha",
              phoneUsed: "41999999501",
              sentByName: "Sistema",
            },
            {
              id: "ml-lc-b-ok",
              schoolId: "school-beta",
              studentId: "stu-lc-b1",
              templateId: "tpl-lc-b",
              reasonTitle: "Faltas",
              messageContent: "Beta OK",
              phoneUsed: "41999999502",
              sentByName: "Sistema",
            },
            // Divergência 1: log de stu-lc-a1 marcado com schoolId=school-beta
            {
              id: "ml-lc-div",
              schoolId: "school-beta",
              studentId: "stu-lc-a1",
              templateId: "tpl-lc-a",
              reasonTitle: "Faltas",
              messageContent: "Divergente",
              phoneUsed: "41999999501",
              sentByName: "Sistema",
            },
            // Divergência 2: log de school-beta referenciando templateId=tpl-lc-a (risco de ON DELETE SET NULL)
            {
              id: "ml-lc-b-cross-tpl",
              schoolId: "school-beta",
              studentId: "stu-lc-b1",
              templateId: "tpl-lc-a",
              reasonTitle: "Faltas",
              messageContent: "Beta usando modelo Alpha",
              phoneUsed: "41999999502",
              sentByName: "Sistema",
            },
          ],
        });

        // 5a. MessageLog divergente bloqueia sanitize e delete com 409, rollback integral e sem logAudit
        vi.mocked(logAudit).mockClear();
        const rSanDivLog = await sanitizeSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha/sanitize", { method: "POST" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rSanDivLog.status).toBe(409);
        expect((await rSanDivLog.json()).code).toBe("SCHOOL_SANITIZE_INTEGRITY_CONFLICT");

        const rDelDivLog = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rDelDivLog.status).toBe(409);
        expect((await rDelDivLog.json()).code).toBe("SCHOOL_DELETE_INTEGRITY_CONFLICT");
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
        expect(await prisma.messageLog.findUnique({ where: { id: "ml-lc-a-legacy" } })).not.toBeNull();

        // Remove divergência 1; mantém divergência 2 (template de school-alpha usado por school-beta)
        await prisma.messageLog.delete({ where: { id: "ml-lc-div" } });
        const rDelCrossTpl = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rDelCrossTpl.status).toBe(409);
        expect((await rDelCrossTpl.json()).code).toBe("SCHOOL_DELETE_INTEGRITY_CONFLICT");
        const betaLogAfterCrossTpl = await prisma.messageLog.findUnique({
          where: { id: "ml-lc-b-cross-tpl" },
        });
        expect(betaLogAfterCrossTpl?.templateId).toBe("tpl-lc-a");
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // Remove divergência 2 e adiciona PedagogicalMinuteStudent cruzado (ata de school-alpha -> aluno de school-beta)
        await prisma.messageLog.delete({ where: { id: "ml-lc-b-cross-tpl" } });
        await prisma.pedagogicalMinute.create({
          data: {
            id: "min-lc-a",
            schoolId: "school-alpha",
            year: 2026,
            status: "DRAFT",
            subject: "Ata Ciclo",
            summary: "Resumo oficial da ata de ciclo para teste de integridade.",
            authorName: "Pedagoga",
            authorEmail: "ped@redeativa.local",
          },
        });
        await prisma.pedagogicalMinuteStudent.create({
          data: {
            id: "pms-lc-cross",
            minuteId: "min-lc-a",
            studentId: "stu-lc-b1",
            studentNameSnapshot: "Aluno Ciclo Beta",
          },
        });

        const rSanCrossMin = await sanitizeSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha/sanitize", { method: "POST" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rSanCrossMin.status).toBe(409);
        expect((await rSanCrossMin.json()).code).toBe("SCHOOL_SANITIZE_INTEGRITY_CONFLICT");

        const rDelCrossMin = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rDelCrossMin.status).toBe(409);
        expect((await rDelCrossMin.json()).code).toBe("SCHOOL_DELETE_INTEGRITY_CONFLICT");
        expect(await prisma.pedagogicalMinuteStudent.findUnique({ where: { id: "pms-lc-cross" } })).not.toBeNull();
        expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

        // Corrige vínculo da ata para stu-lc-a1 (coerente)
        await prisma.pedagogicalMinuteStudent.update({
          where: { id: "pms-lc-cross" },
          data: { studentId: "stu-lc-a1", studentNameSnapshot: "Aluno Ciclo Alpha" },
        });

        // 5c. Nota do Conselho divergente (schoolId=school-beta) vinculada a card/disciplina de school-alpha
        //     não pode ser apagada por ON DELETE CASCADE: deve retornar 409 e preservar ambas as escolas
        await prisma.classCouncilBoard.create({
          data: {
            id: "board-lc-a",
            schoolId: "school-alpha",
            classGroupId: "cg-alpha",
            year: 2026,
          },
        });
        await prisma.classCouncilSubject.create({
          data: {
            id: "sub-lc-a",
            schoolId: "school-alpha",
            boardId: "board-lc-a",
            name: "MATEMATICA",
            displayOrder: 1,
            active: true,
          },
        });
        await prisma.studentCouncilCard.create({
          data: {
            id: "card-lc-a",
            schoolId: "school-alpha",
            boardId: "board-lc-a",
            studentId: "stu-lc-a1",
          },
        });
        await prisma.studentCouncilSubjectEntry.create({
          data: {
            id: "entry-lc-div",
            schoolId: "school-beta",
            cardId: "card-lc-a",
            subjectId: "sub-lc-a",
            trimester: 1,
            descriptorCodes: [2],
            grade: 4.5,
          },
        });

        const rSanCouncilDiv = await sanitizeSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha/sanitize", { method: "POST" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rSanCouncilDiv.status).toBe(409);
        const sanCouncilBody = await rSanCouncilDiv.text();
        expect(JSON.parse(sanCouncilBody).code).toBe("SCHOOL_SANITIZE_INTEGRITY_CONFLICT");
        expect(sanCouncilBody).not.toContain("school-beta");
        expect(sanCouncilBody).not.toContain("Beta");

        const rDelCouncilDiv = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rDelCouncilDiv.status).toBe(409);
        const delCouncilBody = await rDelCouncilDiv.text();
        expect(JSON.parse(delCouncilBody).code).toBe("SCHOOL_DELETE_INTEGRITY_CONFLICT");
        expect(delCouncilBody).not.toContain("school-beta");
        expect(delCouncilBody).not.toContain("Beta");

        expect(await prisma.studentCouncilSubjectEntry.findUnique({ where: { id: "entry-lc-div" } })).not.toBeNull();
        expect(await prisma.studentCouncilCard.findUnique({ where: { id: "card-lc-a" } })).not.toBeNull();
        expect(await prisma.classCouncilSubject.findUnique({ where: { id: "sub-lc-a" } })).not.toBeNull();
        expect(await prisma.auditLog.count({ where: { entityId: "school-alpha" } })).toBe(0);

        // Remove entrada divergente e substitui por entrada coerente de school-alpha
        await prisma.studentCouncilSubjectEntry.update({
          where: { id: "entry-lc-div" },
          data: { schoolId: "school-alpha" },
        });

        // 6. Saneamento legítimo: limpa dados operacionais de school-alpha (incluindo legado nulo e Conselho coerente),
        //    preserva school-alpha, tpl-lc-a e UserSchool da equipe, mantendo school-beta intacta
        capturedContextSchools.length = 0;
        vi.mocked(logAudit).mockClear();
        const rSanOk = await sanitizeSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha/sanitize", { method: "POST" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rSanOk.status).toBe(200);
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(await prisma.school.findUnique({ where: { id: "school-alpha" } })).not.toBeNull();
        expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-lc-a" } })).not.toBeNull();
        expect(await prisma.userSchool.findUnique({ where: { id: "us-lc-ped-a" } })).not.toBeNull();
        expect(await prisma.student.count({ where: { schoolId: "school-alpha" } })).toBe(0);
        expect(await prisma.classGroup.count({ where: { schoolId: "school-alpha" } })).toBe(0);
        expect(await prisma.studentCouncilSubjectEntry.count({ where: { schoolId: "school-alpha" } })).toBe(0);
        expect(await prisma.messageLog.findUnique({ where: { id: "ml-lc-a-legacy" } })).toBeNull();
        expect(await prisma.student.count({ where: { schoolId: "school-beta" } })).toBe(2);
        expect(await prisma.messageLog.findUnique({ where: { id: "ml-lc-b-ok" } })).not.toBeNull();
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
          expect.objectContaining({ action: "SANITIZE_SCHOOL", schoolId: "school-alpha" })
        );

        // 6b. Concorrência em DELETE /api/schools/[id]:
        //     (i) Referência divergente confirmada antes do lock -> DELETE retorna 409 e templateId não é zerado
        await prisma.school.create({
          data: {
            id: "school-conc-b",
            inepCode: "99000881",
            name: "Escola Concorrência B",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        });
        await prisma.messageTemplate.create({
          data: {
            id: "tpl-conc-b",
            schoolId: "school-conc-b",
            title: "Modelo Concorrência",
            segment: "TODOS",
            prefixText: "Olá",
            suffixText: "Fim",
            active: true,
          },
        });
        beforeTxHook = async () => {
          await prisma.messageLog.create({
            data: {
              id: "ml-conc-div-first",
              schoolId: "school-beta",
              studentId: "stu-lc-b1",
              templateId: "tpl-conc-b",
              reasonTitle: "Faltas",
              messageContent: "Referência concorrente confirmada antes",
              phoneUsed: "41999999502",
              sentByName: "Sistema",
            },
          });
        };
        const rDelConcFirst = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-conc-b", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-conc-b" }) }
        );
        expect(rDelConcFirst.status).toBe(409);
        expect((await rDelConcFirst.json()).code).toBe("SCHOOL_DELETE_INTEGRITY_CONFLICT");
        const concLogPersisted = await prisma.messageLog.findUnique({ where: { id: "ml-conc-div-first" } });
        expect(concLogPersisted?.templateId).toBe("tpl-conc-b");
        await prisma.messageLog.delete({ where: { id: "ml-conc-div-first" } });
        await prisma.messageTemplate.delete({ where: { id: "tpl-conc-b" } });
        await prisma.school.delete({ where: { id: "school-conc-b" } });

        //     (ii) DELETE adquire FOR UPDATE em tpl-lc-a primeiro: inserção concorrente em school-beta bloqueia até commit e nunca grava templateId nulo
        let lockReadyResolve!: () => void;
        const lockReadyPromise = new Promise<void>((res) => {
          lockReadyResolve = res;
        });
        let releaseDeleteResolve!: () => void;
        const releaseDeletePromise = new Promise<void>((res) => {
          releaseDeleteResolve = res;
        });
        beforeDeleteHook = async () => {
          lockReadyResolve();
          await releaseDeletePromise;
        };

        capturedContextSchools.length = 0;
        const delAlphaPromise = deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        await lockReadyPromise;

        let concurrentInsertSettled = false;
        const concurrentInsertPromise = prisma.messageLog
          .create({
            data: {
              id: "ml-conc-blocked",
              schoolId: "school-beta",
              studentId: "stu-lc-b1",
              templateId: "tpl-lc-a",
              reasonTitle: "Faltas",
              messageContent: "Tentativa concorrente pós-lock",
              phoneUsed: "41999999502",
              sentByName: "Sistema",
            },
          })
          .then(
            () => {
              concurrentInsertSettled = true;
              return "committed";
            },
            () => {
              concurrentInsertSettled = true;
              return "rejected";
            }
          );

        await new Promise((r) => setTimeout(r, 80));
        expect(concurrentInsertSettled).toBe(false);
        releaseDeleteResolve();

        const [rDelOk, concurrentOutcome] = await Promise.all([
          delAlphaPromise,
          concurrentInsertPromise,
        ]);

        // 7. Exclusão legítima de school-alpha e persistência real de AuditLog na mesma transação
        expect(rDelOk.status).toBe(200);
        expect(concurrentOutcome).toBe("rejected");
        expect(await prisma.messageLog.findUnique({ where: { id: "ml-conc-blocked" } })).toBeNull();
        expect(capturedContextSchools).toEqual(["school-alpha"]);
        expect(await prisma.school.findUnique({ where: { id: "school-alpha" } })).toBeNull();
        expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-lc-a" } })).toBeNull();
        expect(await prisma.userSchool.findUnique({ where: { id: "us-lc-ped-a" } })).toBeNull();
        expect(await prisma.school.findUnique({ where: { id: "school-beta" } })).not.toBeNull();
        expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-lc-b" } })).not.toBeNull();
        expect(await prisma.messageLog.findUnique({ where: { id: "ml-lc-b-ok" } })).not.toBeNull();

        const realDeleteAudits = await prisma.auditLog.findMany({
          where: { action: "DELETE_SCHOOL", entityId: "school-alpha" },
        });
        expect(realDeleteAudits).toHaveLength(1);
        expect(realDeleteAudits[0]).toMatchObject({
          schoolId: null,
          entityType: "School",
          entityId: "school-alpha",
          userId: "lc-super",
          userEmail: "super.ciclo@redeativa.local",
        });
        expect(JSON.parse(realDeleteAudits[0].details || "{}")).toMatchObject({
          deletedSchoolId: "school-alpha",
          deletedSchoolName: "Escola Sintética Alpha",
          deletedStudentsCount: 0,
          deletedClassesCount: 0,
        });

        // 8. Falha na gravação de AuditLog em DELETE /api/schools/[id] reverte toda a exclusão
        await prisma.school.create({
          data: {
            id: "school-audit-fail",
            inepCode: "99000882",
            name: "Escola Falha Auditoria",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        });
        await prisma.messageTemplate.create({
          data: {
            id: "tpl-audit-fail",
            schoolId: "school-audit-fail",
            title: "Modelo Audit Fail",
            segment: "TODOS",
            prefixText: "Olá",
            suffixText: "Fim",
            active: true,
          },
        });

        failAuditStrictCreate = true;
        const rDelAuditFail = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-audit-fail", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-audit-fail" }) }
        );
        failAuditStrictCreate = false;
        expect(rDelAuditFail.status).toBe(500);
        expect(await prisma.school.findUnique({ where: { id: "school-audit-fail" } })).not.toBeNull();
        expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-audit-fail" } })).not.toBeNull();
        expect(
          await prisma.auditLog.count({ where: { action: "DELETE_SCHOOL", entityId: "school-audit-fail" } })
        ).toBe(0);

        // 9. Modelo criado concorrentemente durante DELETE (fora do conjunto bloqueado):
        //    não é removido por deleteMany({ where: { schoolId } }), aborta com 409 FK e preserva templateId em school-beta
        await prisma.school.create({
          data: {
            id: "school-conc-new",
            inepCode: "99000883",
            name: "Escola Novo Modelo Concorrente",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        });
        await prisma.messageTemplate.create({
          data: {
            id: "tpl-conc-new-1",
            schoolId: "school-conc-new",
            title: "Modelo Bloqueado 1",
            segment: "TODOS",
            prefixText: "Olá",
            suffixText: "Fim",
            active: true,
          },
        });

        let newTplLockResolve!: () => void;
        const newTplLockPromise = new Promise<void>((res) => {
          newTplLockResolve = res;
        });
        let releaseNewTplDelete!: () => void;
        const releaseNewTplPromise = new Promise<void>((res) => {
          releaseNewTplDelete = res;
        });
        beforeDeleteHook = async () => {
          newTplLockResolve();
          await releaseNewTplPromise;
        };

        const delNewTplPromise = deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-conc-new", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-conc-new" }) }
        );
        await newTplLockPromise;

        await prisma.messageTemplate.create({
          data: {
            id: "tpl-conc-new-2",
            schoolId: "school-conc-new",
            title: "Modelo Criado Concorrente 2",
            segment: "TODOS",
            prefixText: "Olá",
            suffixText: "Fim",
            active: true,
          },
        });
        await prisma.messageLog.create({
          data: {
            id: "ml-beta-new-tpl",
            schoolId: "school-beta",
            studentId: "stu-lc-b1",
            templateId: "tpl-conc-new-2",
            reasonTitle: "Faltas",
            messageContent: "Referência a modelo criado durante DELETE",
            phoneUsed: "41999999502",
            sentByName: "Sistema",
          },
        });
        releaseNewTplDelete();

        const rDelNewTpl = await delNewTplPromise;
        expect(rDelNewTpl.status).toBe(409);
        expect((await rDelNewTpl.json()).code).toBe("SCHOOL_DELETE_FK_CONFLICT");
        expect(await prisma.school.findUnique({ where: { id: "school-conc-new" } })).not.toBeNull();
        expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-conc-new-1" } })).not.toBeNull();
        expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-conc-new-2" } })).not.toBeNull();
        expect((await prisma.messageLog.findUnique({ where: { id: "ml-beta-new-tpl" } }))?.templateId).toBe(
          "tpl-conc-new-2"
        );
        expect(
          await prisma.auditLog.count({ where: { action: "DELETE_SCHOOL", entityId: "school-conc-new" } })
        ).toBe(0);

        // 10. Mudança concorrente de vínculo em MessageLog existente mantendo templateId igual:
        //     FOR UPDATE em MessageLog impede re-vinculação a school-beta durante DELETE
        await prisma.school.create({
          data: {
            id: "school-conc-rebind",
            inepCode: "99000884",
            name: "Escola Rebind Log",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        });
        await prisma.classGroup.create({
          data: {
            id: "cg-conc-rebind",
            name: "1º Ano R",
            segment: "EM",
            shift: "MANHA",
            schoolId: "school-conc-rebind",
          },
        });
        await prisma.student.create({
          data: {
            id: "stu-conc-rebind",
            name: "Aluno Rebind",
            cgm: "960000101",
            phone: "41999999601",
            schoolId: "school-conc-rebind",
            classGroupId: "cg-conc-rebind",
            active: true,
          },
        });
        await prisma.messageTemplate.create({
          data: {
            id: "tpl-conc-rebind",
            schoolId: "school-conc-rebind",
            title: "Modelo Rebind",
            segment: "TODOS",
            prefixText: "Olá",
            suffixText: "Fim",
            active: true,
          },
        });
        await prisma.messageLog.create({
          data: {
            id: "ml-conc-rebind",
            schoolId: "school-conc-rebind",
            studentId: "stu-conc-rebind",
            templateId: "tpl-conc-rebind",
            reasonTitle: "Faltas",
            messageContent: "Log Rebind",
            phoneUsed: "41999999601",
            sentByName: "Sistema",
          },
        });

        let rebindLockResolve!: () => void;
        const rebindLockPromise = new Promise<void>((res) => {
          rebindLockResolve = res;
        });
        let releaseRebindDelete!: () => void;
        const releaseRebindPromise = new Promise<void>((res) => {
          releaseRebindDelete = res;
        });
        beforeDeleteHook = async () => {
          rebindLockResolve();
          await releaseRebindPromise;
        };

        const delRebindPromise = deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-conc-rebind", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-conc-rebind" }) }
        );
        await rebindLockPromise;

        let rebindSettled = false;
        const concurrentRebindPromise = prisma.messageLog
          .update({
            where: { id: "ml-conc-rebind" },
            data: { schoolId: "school-beta" },
          })
          .then(
            () => {
              rebindSettled = true;
              return "updated";
            },
            () => {
              rebindSettled = true;
              return "rejected";
            }
          );

        await new Promise((r) => setTimeout(r, 80));
        expect(rebindSettled).toBe(false);
        releaseRebindDelete();

        const [rDelRebind, rebindOutcome] = await Promise.all([
          delRebindPromise,
          concurrentRebindPromise,
        ]);
        expect(rDelRebind.status).toBe(200);
        expect(rebindOutcome).toBe("rejected");
        expect(await prisma.school.findUnique({ where: { id: "school-conc-rebind" } })).toBeNull();

        // 11. Concorrência no Conselho durante POST /api/schools/[id]/sanitize:
        //     FOR UPDATE em ClassCouncilBoard/Subject/Card bloqueia inserção concorrente de nota divergente (pg_blocking_pids)
        //     e preserva escola, modelos, equipe e school-beta intactos
        await prisma.classCouncilBoard.create({
          data: {
            id: "board-beta-pres",
            schoolId: "school-beta",
            classGroupId: "cg-beta",
            year: 2026,
          },
        });
        await prisma.classCouncilSubject.create({
          data: {
            id: "sub-beta-pres",
            schoolId: "school-beta",
            boardId: "board-beta-pres",
            name: "MATEMATICA",
            displayOrder: 1,
            active: true,
          },
        });
        await prisma.studentCouncilCard.create({
          data: {
            id: "card-beta-pres",
            schoolId: "school-beta",
            boardId: "board-beta-pres",
            studentId: "stu-lc-b1",
          },
        });
        await prisma.studentCouncilSubjectEntry.create({
          data: {
            id: "entry-beta-pres",
            schoolId: "school-beta",
            cardId: "card-beta-pres",
            subjectId: "sub-beta-pres",
            trimester: 1,
            descriptorCodes: [1],
            grade: 7.5,
          },
        });

        await prisma.school.create({
          data: {
            id: "school-conc-council",
            inepCode: "99000885",
            name: "Escola Concorrência Conselho",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        });
        await prisma.messageTemplate.create({
          data: {
            id: "tpl-conc-council",
            schoolId: "school-conc-council",
            title: "Modelo Preservado Sanitize",
            segment: "TODOS",
            prefixText: "Olá",
            suffixText: "Fim",
            active: true,
          },
        });
        await prisma.userSchool.create({
          data: {
            id: "us-conc-council",
            userId: "lc-ped",
            schoolId: "school-conc-council",
            role: "PEDAGOGA",
            active: true,
          },
        });
        await prisma.classGroup.create({
          data: {
            id: "cg-conc-council",
            name: "1º Ano C",
            segment: "EM",
            shift: "MANHA",
            schoolId: "school-conc-council",
          },
        });
        await prisma.student.create({
          data: {
            id: "stu-conc-council",
            name: "Aluno Conselho Conc",
            cgm: "970000101",
            phone: "41999999701",
            schoolId: "school-conc-council",
            classGroupId: "cg-conc-council",
            active: true,
          },
        });
        await prisma.classCouncilBoard.create({
          data: {
            id: "board-conc-council",
            schoolId: "school-conc-council",
            classGroupId: "cg-conc-council",
            year: 2026,
          },
        });
        await prisma.classCouncilSubject.create({
          data: {
            id: "sub-conc-council",
            schoolId: "school-conc-council",
            boardId: "board-conc-council",
            name: "PORTUGUES",
            displayOrder: 1,
            active: true,
          },
        });
        await prisma.studentCouncilCard.create({
          data: {
            id: "card-conc-council",
            schoolId: "school-conc-council",
            boardId: "board-conc-council",
            studentId: "stu-conc-council",
          },
        });

        let councilLockResolve!: () => void;
        const councilLockPromise = new Promise<void>((res) => {
          councilLockResolve = res;
        });
        let releaseCouncilSanitize!: () => void;
        const releaseCouncilPromise = new Promise<void>((res) => {
          releaseCouncilSanitize = res;
        });
        beforeDeleteHook = async () => {
          councilLockResolve();
          await releaseCouncilPromise;
        };

        const sanCouncilPromise = sanitizeSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-conc-council/sanitize", { method: "POST" }),
          { params: Promise.resolve({ id: "school-conc-council" }) }
        );
        await councilLockPromise;
        const sanitizeBlockerPid = lastCleanupPid!;
        expect(sanitizeBlockerPid).toBeGreaterThan(0);

        let sanWriterPidResolve!: (pid: number) => void;
        const sanWriterPidPromise = new Promise<number>((res) => {
          sanWriterPidResolve = res;
        });
        const concurrentCouncilEntryPromise = prisma
          .$transaction(async (tx2) => {
            const [{ pid }] = await tx2.$queryRaw<Array<{ pid: number }>>`
              SELECT pg_backend_pid() AS pid
            `;
            sanWriterPidResolve(pid);
            return tx2.studentCouncilSubjectEntry.create({
              data: {
                id: "entry-conc-div",
                schoolId: "school-beta",
                cardId: "card-conc-council",
                subjectId: "sub-conc-council",
                trimester: 1,
                descriptorCodes: [2],
                grade: 4.0,
              },
            });
          })
          .then(
            () => "committed",
            () => "rejected"
          );

        try {
          const sanWriterPid = await sanWriterPidPromise;
          const sanLockObs = await waitForPgLockOnPid(sanWriterPid, sanitizeBlockerPid);
          expect(sanLockObs.waitEventType).toBe("Lock");
          expect(sanLockObs.blockingPids).toContain(sanitizeBlockerPid);
        } finally {
          releaseCouncilSanitize();
        }

        const [rSanConcCouncil, councilInsertOutcome] = await Promise.all([
          sanCouncilPromise,
          concurrentCouncilEntryPromise,
        ]);
        expect(rSanConcCouncil.status).toBe(200);
        expect(councilInsertOutcome).toBe("rejected");
        expect(
          await prisma.studentCouncilSubjectEntry.findUnique({ where: { id: "entry-conc-div" } })
        ).toBeNull();
        expect(await prisma.school.findUnique({ where: { id: "school-conc-council" } })).not.toBeNull();
        expect(await prisma.messageTemplate.findUnique({ where: { id: "tpl-conc-council" } })).not.toBeNull();
        expect(await prisma.userSchool.findUnique({ where: { id: "us-conc-council" } })).not.toBeNull();
        expect(await prisma.student.count({ where: { schoolId: "school-conc-council" } })).toBe(0);
        expect(await prisma.classCouncilBoard.count({ where: { schoolId: "school-conc-council" } })).toBe(0);
        expect(await prisma.studentCouncilCard.count({ where: { schoolId: "school-conc-council" } })).toBe(0);
        expect(await prisma.studentCouncilSubjectEntry.findUnique({ where: { id: "entry-beta-pres" } })).not.toBeNull();

        // 12. Concorrência no Conselho durante DELETE /api/schools/[id]:
        //     (a) DELETE adquire FOR UPDATE primeiro -> escritor divergente aguarda blocker PID (pg_blocking_pids),
        //         falha após commit, escola/Conselho removidos, school-beta preservada e 1 DELETE_SCHOOL no AuditLog real
        await prisma.school.create({
          data: {
            id: "school-conc-del-council",
            inepCode: "99000886",
            name: "Escola Concorrência Delete Conselho",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        });
        await prisma.classGroup.create({
          data: {
            id: "cg-conc-del-council",
            name: "1º Ano D",
            segment: "EM",
            shift: "MANHA",
            schoolId: "school-conc-del-council",
          },
        });
        await prisma.student.create({
          data: {
            id: "stu-conc-del-council",
            name: "Aluno Delete Conselho",
            cgm: "980000101",
            phone: "41999999801",
            schoolId: "school-conc-del-council",
            classGroupId: "cg-conc-del-council",
            active: true,
          },
        });
        await prisma.classCouncilBoard.create({
          data: {
            id: "board-conc-del-council",
            schoolId: "school-conc-del-council",
            classGroupId: "cg-conc-del-council",
            year: 2026,
          },
        });
        await prisma.classCouncilSubject.create({
          data: {
            id: "sub-conc-del-council",
            schoolId: "school-conc-del-council",
            boardId: "board-conc-del-council",
            name: "HISTORIA",
            displayOrder: 1,
            active: true,
          },
        });
        await prisma.studentCouncilCard.create({
          data: {
            id: "card-conc-del-council",
            schoolId: "school-conc-del-council",
            boardId: "board-conc-del-council",
            studentId: "stu-conc-del-council",
          },
        });

        let delCouncilLockResolve!: () => void;
        const delCouncilLockPromise = new Promise<void>((res) => {
          delCouncilLockResolve = res;
        });
        let releaseDelCouncil!: () => void;
        const releaseDelCouncilPromise = new Promise<void>((res) => {
          releaseDelCouncil = res;
        });
        beforeDeleteHook = async () => {
          delCouncilLockResolve();
          await releaseDelCouncilPromise;
        };

        const delCouncilPromise = deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-conc-del-council", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-conc-del-council" }) }
        );
        await delCouncilLockPromise;
        const deleteBlockerPid = lastCleanupPid!;
        expect(deleteBlockerPid).toBeGreaterThan(0);

        let delWriterPidResolve!: (pid: number) => void;
        const delWriterPidPromise = new Promise<number>((res) => {
          delWriterPidResolve = res;
        });
        const concurrentDelCouncilEntryPromise = prisma
          .$transaction(async (tx2) => {
            const [{ pid }] = await tx2.$queryRaw<Array<{ pid: number }>>`
              SELECT pg_backend_pid() AS pid
            `;
            delWriterPidResolve(pid);
            return tx2.studentCouncilSubjectEntry.create({
              data: {
                id: "entry-del-conc-div",
                schoolId: "school-beta",
                cardId: "card-conc-del-council",
                subjectId: "sub-conc-del-council",
                trimester: 1,
                descriptorCodes: [2],
                grade: 4.5,
              },
            });
          })
          .then(
            () => "committed",
            () => "rejected"
          );

        try {
          const delWriterPid = await delWriterPidPromise;
          const delLockObs = await waitForPgLockOnPid(delWriterPid, deleteBlockerPid);
          expect(delLockObs.waitEventType).toBe("Lock");
          expect(delLockObs.blockingPids).toContain(deleteBlockerPid);
        } finally {
          releaseDelCouncil();
        }

        const [rDelConcCouncil, delCouncilOutcome] = await Promise.all([
          delCouncilPromise,
          concurrentDelCouncilEntryPromise,
        ]);
        expect(rDelConcCouncil.status).toBe(200);
        expect(delCouncilOutcome).toBe("rejected");
        expect(await prisma.school.findUnique({ where: { id: "school-conc-del-council" } })).toBeNull();
        expect(await prisma.classCouncilBoard.count({ where: { schoolId: "school-conc-del-council" } })).toBe(0);
        expect(await prisma.studentCouncilCard.count({ where: { schoolId: "school-conc-del-council" } })).toBe(0);
        expect(
          await prisma.studentCouncilSubjectEntry.findUnique({ where: { id: "entry-del-conc-div" } })
        ).toBeNull();
        expect(await prisma.classCouncilBoard.findUnique({ where: { id: "board-beta-pres" } })).not.toBeNull();
        expect(await prisma.studentCouncilSubjectEntry.findUnique({ where: { id: "entry-beta-pres" } })).not.toBeNull();
        expect(
          await prisma.auditLog.count({
            where: { action: "DELETE_SCHOOL", entityId: "school-conc-del-council" },
          })
        ).toBe(1);

        //     (b) Ordem inversa: vínculo divergente do Conselho confirma antes do DELETE -> 409, rollback integral e 0 AuditLog
        await prisma.school.create({
          data: {
            id: "school-conc-del-inv",
            inepCode: "99000887",
            name: "Escola Concorrência Delete Inversa",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: true,
          },
        });
        await prisma.classGroup.create({
          data: {
            id: "cg-conc-del-inv",
            name: "1º Ano I",
            segment: "EM",
            shift: "MANHA",
            schoolId: "school-conc-del-inv",
          },
        });
        await prisma.student.create({
          data: {
            id: "stu-conc-del-inv",
            name: "Aluno Delete Inversa",
            cgm: "980000201",
            phone: "41999999802",
            schoolId: "school-conc-del-inv",
            classGroupId: "cg-conc-del-inv",
            active: true,
          },
        });
        await prisma.classCouncilBoard.create({
          data: {
            id: "board-conc-del-inv",
            schoolId: "school-conc-del-inv",
            classGroupId: "cg-conc-del-inv",
            year: 2026,
          },
        });
        await prisma.classCouncilSubject.create({
          data: {
            id: "sub-conc-del-inv",
            schoolId: "school-conc-del-inv",
            boardId: "board-conc-del-inv",
            name: "GEOGRAFIA",
            displayOrder: 1,
            active: true,
          },
        });
        await prisma.studentCouncilCard.create({
          data: {
            id: "card-conc-del-inv",
            schoolId: "school-conc-del-inv",
            boardId: "board-conc-del-inv",
            studentId: "stu-conc-del-inv",
          },
        });

        beforeTxHook = async () => {
          await prisma.studentCouncilSubjectEntry.create({
            data: {
              id: "entry-del-inv-div",
              schoolId: "school-beta",
              cardId: "card-conc-del-inv",
              subjectId: "sub-conc-del-inv",
              trimester: 1,
              descriptorCodes: [2],
              grade: 3.8,
            },
          });
        };

        const rDelInv = await deleteSchoolHandler(
          new Request("http://127.0.0.1/api/schools/school-conc-del-inv", { method: "DELETE" }),
          { params: Promise.resolve({ id: "school-conc-del-inv" }) }
        );
        expect(rDelInv.status).toBe(409);
        expect((await rDelInv.json()).code).toBe("SCHOOL_DELETE_INTEGRITY_CONFLICT");
        expect(await prisma.school.findUnique({ where: { id: "school-conc-del-inv" } })).not.toBeNull();
        expect(
          await prisma.studentCouncilSubjectEntry.findUnique({ where: { id: "entry-del-inv-div" } })
        ).not.toBeNull();
        expect(
          await prisma.auditLog.count({
            where: { action: "DELETE_SCHOOL", entityId: "school-conc-del-inv" },
          })
        ).toBe(0);
      } finally {
        beforeTxHook = null;
        beforeDeleteHook = null;
        failAuditStrictCreate = false;
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = null;
        testAuthState.useRealPermissions = false;
      }
    });

    it("isola painel /secretaria e GET /api/secretaria/metrics por escola autorizada com withTenantContext e integridade Fase A", async () => {
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenant = rlsTenantContext.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(async (client, schoolId, callback) => {
          return originalWithTenant(client, schoolId, async (tx) => {
            const rows = await tx.$queryRaw<Array<{ sid: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS sid
            `;
            tenantCalls.push({
              schoolId,
              currentSetting: rows[0]?.sid ?? null,
            });
            return callback(tx);
          });
        });

      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      const prevSnapshot = testAuthState.snapshot;
      const prevUserId = testAuthState.userId;
      const prevRole = testAuthState.role;
      testAuthState.useRealPermissions = true;

      try {
        await prisma.userNetwork.deleteMany({ where: { id: { in: ["un-sec-a"] } } });
        await prisma.user.deleteMany({ where: { id: { in: ["user-sec-a", "user-sec-no-link", "superadmin-sec-test"] } } });
        await prisma.educationNetwork.deleteMany({ where: { id: { in: ["net-sec-a", "net-sec-b"] } } });

        await prisma.educationNetwork.createMany({
          data: [
            {
              id: "net-sec-a",
              name: "SEMEC Sec A",
              shortName: "SEMEC A",
              city: "Cidade Sec Teste",
              state: "PR",
              active: true,
            },
            {
              id: "net-sec-b",
              name: "SEMEC Sec B",
              shortName: "SEMEC B",
              city: "Cidade Sec Teste",
              state: "PR",
              active: true,
            },
          ],
        });

        await prisma.school.createMany({
          data: [
            {
              id: "school-sec-a1",
              inepCode: "99000901",
              name: "Escola Sec A1",
              city: "Cidade Sec Teste",
              state: "PR",
              nre: "NRE Teste",
              network: "MUNICIPAL",
              networkId: "net-sec-a",
              active: true,
            },
            {
              id: "school-sec-a2",
              inepCode: "99000902",
              name: "Escola Sec A2",
              city: "Cidade Sec Teste",
              state: "PR",
              nre: "NRE Teste",
              network: "MUNICIPAL",
              networkId: "net-sec-a",
              active: true,
            },
            {
              id: "school-sec-a-inativa",
              inepCode: "99000903",
              name: "Escola Sec A Inativa",
              city: "Cidade Sec Teste",
              state: "PR",
              nre: "NRE Teste",
              network: "MUNICIPAL",
              networkId: "net-sec-a",
              active: false,
            },
            {
              id: "school-sec-b1",
              inepCode: "99000904",
              name: "Escola Sec B1",
              city: "Cidade Sec Teste",
              state: "PR",
              nre: "NRE Teste",
              network: "MUNICIPAL",
              networkId: "net-sec-b",
              active: true,
            },
          ],
        });

        await prisma.classGroup.createMany({
          data: [
            { id: "cg-sec-a1", name: "6º A", segment: "EF2", shift: "MANHA", schoolId: "school-sec-a1" },
            { id: "cg-sec-a2", name: "7º A", segment: "EF2", shift: "MANHA", schoolId: "school-sec-a2" },
            { id: "cg-sec-a-inativa", name: "8º A", segment: "EF2", shift: "MANHA", schoolId: "school-sec-a-inativa" },
            { id: "cg-sec-b1", name: "9º A", segment: "EF2", shift: "MANHA", schoolId: "school-sec-b1" },
          ],
        });

        await prisma.student.createMany({
          data: [
            {
              id: "stu-sec-a1-1",
              cgm: "99090101",
              name: "Estudante A1 1",
              phone: "5541999900011",
              classGroupId: "cg-sec-a1",
              schoolId: "school-sec-a1",
            },
            {
              id: "stu-sec-a1-2",
              cgm: "99090102",
              name: "Estudante A1 2",
              phone: "5541999900012",
              classGroupId: "cg-sec-a1",
              schoolId: "school-sec-a1",
            },
            {
              id: "stu-sec-a1-cross",
              cgm: "99090103",
              name: "Estudante A1 Cross",
              phone: "5541999900013",
              classGroupId: "cg-sec-b1",
              schoolId: "school-sec-a1",
            },
            {
              id: "stu-sec-a2-1",
              cgm: "99090201",
              name: "Estudante A2 1",
              phone: "5541999900021",
              classGroupId: "cg-sec-a2",
              schoolId: "school-sec-a2",
            },
            {
              id: "stu-sec-a2-norec",
              cgm: "99090202",
              name: "Estudante A2 Sem Registro",
              phone: "5541999900022",
              classGroupId: "cg-sec-a2",
              schoolId: "school-sec-a2",
            },
            {
              id: "stu-sec-a-inativa-1",
              cgm: "99090301",
              name: "Estudante Inativa",
              phone: "5541999900031",
              classGroupId: "cg-sec-a-inativa",
              schoolId: "school-sec-a-inativa",
            },
            {
              id: "stu-sec-b1-1",
              cgm: "99090401",
              name: "Estudante B1 1",
              phone: "5541999900041",
              classGroupId: "cg-sec-b1",
              schoolId: "school-sec-b1",
            },
          ],
        });

        await prisma.lowAttendanceRecord.createMany({
          data: [
            { studentId: "stu-sec-a1-1", attendancePercent: 60 },
            { studentId: "stu-sec-a1-2", attendancePercent: 80 },
            { studentId: "stu-sec-a1-cross", attendancePercent: 10 },
            { studentId: "stu-sec-a2-1", attendancePercent: 100 },
            { studentId: "stu-sec-a-inativa-1", attendancePercent: 20 },
            { studentId: "stu-sec-b1-1", attendancePercent: 50 },
          ],
        });

        const now = new Date();
        const oldDate = new Date(now.getFullYear(), now.getMonth() - 2, 10, 12, 0, 0);

        await prisma.messageLog.createMany({
          data: [
            {
              id: "msg-sec-a1-own",
              studentId: "stu-sec-a1-1",
              schoolId: "school-sec-a1",
              phoneUsed: "5541999900011",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Contato A1",
              sentAt: now,
              guardianReplied: true,
              replyCategory: "TRANSPORTE",
            },
            {
              id: "msg-sec-a1-legacy",
              studentId: "stu-sec-a1-2",
              schoolId: null,
              phoneUsed: "5541999900012",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Contato Legado",
              sentAt: now,
              guardianReplied: true,
              replyCategory: "SAUDE",
            },
            {
              id: "msg-sec-a1-div",
              studentId: "stu-sec-a1-1",
              schoolId: "school-sec-b1",
              phoneUsed: "5541999900011",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Contato Divergente",
              sentAt: now,
              guardianReplied: true,
              replyCategory: "TRABALHO",
            },
            {
              id: "msg-sec-a1-old-cause",
              studentId: "stu-sec-a1-2",
              schoolId: "school-sec-a1",
              phoneUsed: "5541999900012",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Contato Mês Anterior",
              sentAt: oldDate,
              guardianReplied: true,
              replyCategory: "TRANSPORTE",
            },
            {
              id: "msg-sec-a-inativa",
              studentId: "stu-sec-a-inativa-1",
              schoolId: "school-sec-a-inativa",
              phoneUsed: "5541999900031",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Contato Inativa",
              sentAt: now,
              guardianReplied: true,
              replyCategory: "TRABALHO",
            },
            {
              id: "msg-sec-b1-own",
              studentId: "stu-sec-b1-1",
              schoolId: "school-sec-b1",
              phoneUsed: "5541999900041",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Contato B1",
              sentAt: now,
              guardianReplied: true,
              replyCategory: "VULNERABILIDADE",
            },
          ],
        });

        await prisma.pedagogicalMinute.create({
          data: {
            id: "ata-sec-a1",
            schoolId: "school-sec-a1",
            year: now.getFullYear(),
            subject: "Ata Sec A1",
            summary: "Resumo",
            status: "FINALIZED",
            attendedAt: now,
            authorName: "Gestora Sec A",
            authorEmail: "sec-a@redeativa.local",
          },
        });

        const secUser = await prisma.user.create({
          data: {
            id: "user-sec-a",
            email: "sec-a@redeativa.local",
            name: "Gestora Sec A",
            role: "GESTAO_SECRETARIA",
            active: true,
          },
        });
        await prisma.user.create({
          data: {
            id: "superadmin-sec-test",
            email: "super@redeativa.local",
            name: "Superadmin Teste",
            role: "SUPERADMIN",
            active: true,
          },
        });

        await prisma.userNetwork.create({
          data: {
            id: "un-sec-a",
            userId: secUser.id,
            networkId: "net-sec-a",
            active: true,
          },
        });

        const secSessionUser = {
          id: secUser.id,
          email: secUser.email,
          name: secUser.name,
          role: "GESTAO_SECRETARIA",
          schoolId: null,
          networks: [{ networkId: "net-sec-a", name: "SEMEC Sec A", city: "Cidade Sec Teste" }],
        };
        testAuthState.pendingSessionUser = secSessionUser;

        // 1. GESTAO_SECRETARIA ativo: paridade API x SSR, contexto por escola, Fase A + exclusão de turma cruzada
        tenantCalls.length = 0;
        const rSecApi = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics")
        );
        expect(rSecApi.status).toBe(200);
        const secApiBody = await rSecApi.json();

        expect(secApiBody.city).toBe("Cidade Sec Teste");
        expect(secApiBody.schools.map((s: { id: string }) => s.id)).toEqual([
          "school-sec-a1",
          "school-sec-a2",
        ]);
        expect(secApiBody.metrics).toEqual({
          totalSchools: 2,
          totalStudents: 4,
          totalClasses: 2,
          criticalStudentsCount: 1,
          networkAverageAttendance: 80,
          messagesSentThisMonth: 2,
        });
        expect(secApiBody.predictiveAnalysis.totalCategorizedReplies).toBe(3);
        expect(secApiBody.predictiveAnalysis.causesBreakdown).toEqual([
          { category: "TRANSPORTE", count: 2, percentage: 66.7 },
          { category: "SAUDE", count: 1, percentage: 33.3 },
        ]);
        expect([...tenantCalls].sort((a, b) => a.schoolId.localeCompare(b.schoolId))).toEqual([
          { schoolId: "school-sec-a1", currentSetting: "school-sec-a1" },
          { schoolId: "school-sec-a2", currentSetting: "school-sec-a2" },
        ]);
        expect(tenantCalls.some((c) => c.schoolId === "school-sec-a-inativa" || c.schoolId === "school-sec-b1")).toBe(false);

        tenantCalls.length = 0;
        const pageEl = (await SecretariaPage({
          searchParams: Promise.resolve({}),
        })) as unknown as {
          props: {
            city: string;
            metrics: typeof secApiBody.metrics;
            initialSchools: typeof secApiBody.schools;
            predictiveData: typeof secApiBody.predictiveAnalysis;
          };
        };
        expect(pageEl.props.city).toBe("Cidade Sec Teste");
        expect(pageEl.props.metrics).toEqual(secApiBody.metrics);
        expect(pageEl.props.initialSchools).toEqual(secApiBody.schools);
        expect(pageEl.props.predictiveData).toEqual(secApiBody.predictiveAnalysis);
        expect([...tenantCalls].sort((a, b) => a.schoolId.localeCompare(b.schoolId))).toEqual([
          { schoolId: "school-sec-a1", currentSetting: "school-sec-a1" },
          { schoolId: "school-sec-a2", currentSetting: "school-sec-a2" },
        ]);

        // 2. Filtro networkId estrangeiro e cidade conflitante -> 403 na API e fallback seguro na página
        tenantCalls.length = 0;
        const rForeignNet = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics?networkId=net-sec-b")
        );
        expect(rForeignNet.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        const rConflictCity = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics?city=OutraCidade")
        );
        expect(rConflictCity.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        const pageConflictEl = (await SecretariaPage({
          searchParams: Promise.resolve({ city: "OutraCidade", networkId: "net-sec-b" }),
        })) as unknown as {
          props: { city: string; initialSchools: Array<{ id: string }> };
        };
        expect(pageConflictEl.props.city).toBe("Cidade Sec Teste");
        expect(pageConflictEl.props.initialSchools.map((s) => s.id)).toEqual([
          "school-sec-a1",
          "school-sec-a2",
        ]);

        // 3. Vínculo UserNetwork revogado mesmo com sessão antiga -> 403 na API e estado vazio na página
        await prisma.userNetwork.update({
          where: { id: "un-sec-a" },
          data: { active: false },
        });
        tenantCalls.length = 0;
        const rRevoked = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics")
        );
        expect(rRevoked.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        await expect(
          SecretariaPage({
            searchParams: Promise.resolve({}),
          })
        ).rejects.toThrow("NEXT_REDIRECT");
        expect(tenantCalls).toHaveLength(0);

        // 4. Rede inativa mesmo com vínculo ativo -> 403 na API e redirect seguro na página
        await prisma.userNetwork.update({
          where: { id: "un-sec-a" },
          data: { active: true },
        });
        await prisma.educationNetwork.update({
          where: { id: "net-sec-a" },
          data: { active: false },
        });
        tenantCalls.length = 0;
        const rInactiveNet = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics")
        );
        expect(rInactiveNet.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        await expect(
          SecretariaPage({
            searchParams: Promise.resolve({}),
          })
        ).rejects.toThrow("NEXT_REDIRECT");
        expect(tenantCalls).toHaveLength(0);

        // 5. SUPERADMIN municipal vê ambas as redes da cidade com média ponderada e filtro networkId
        await prisma.educationNetwork.update({
          where: { id: "net-sec-a" },
          data: { active: true },
        });
        testAuthState.pendingSessionUser = {
          id: "superadmin-sec-test",
          email: "super@redeativa.local",
          name: "Superadmin Teste",
          role: "SUPERADMIN",
          schoolId: null,
        };
        tenantCalls.length = 0;
        const rSuperCity = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics?city=Cidade%20Sec%20Teste")
        );
        expect(rSuperCity.status).toBe(200);
        const superCityBody = await rSuperCity.json();
        expect(superCityBody.schools.map((s: { id: string }) => s.id)).toEqual([
          "school-sec-a1",
          "school-sec-a2",
          "school-sec-b1",
        ]);
        expect(superCityBody.metrics).toEqual({
          totalSchools: 3,
          totalStudents: 5,
          totalClasses: 3,
          criticalStudentsCount: 2,
          networkAverageAttendance: 72.5,
          messagesSentThisMonth: 3,
        });
        expect(tenantCalls.map((c) => c.schoolId).sort()).toEqual([
          "school-sec-a1",
          "school-sec-a2",
          "school-sec-b1",
        ]);
        expect(tenantCalls.every((c) => c.currentSetting === c.schoolId)).toBe(true);

        tenantCalls.length = 0;
        const rSuperNetB = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics?networkId=net-sec-b")
        );
        expect(rSuperNetB.status).toBe(200);
        const superNetBBody = await rSuperNetB.json();
        expect(superNetBBody.schools.map((s: { id: string }) => s.id)).toEqual(["school-sec-b1"]);
        expect(tenantCalls).toEqual([
          { schoolId: "school-sec-b1", currentSetting: "school-sec-b1" },
        ]);

        // 6. Parâmetros repetidos, vazios e em ordem invertida (API e SSR) com GESTAO_SECRETARIA ativo
        testAuthState.pendingSessionUser = secSessionUser;

        // 6a. Primeiro valor válido com espaços e segundo conflitante -> usa o 1º valor normalizado (200 + paridade SSR)
        tenantCalls.length = 0;
        const rRepValid = await secretariaMetricsHandler(
          new NextRequest(
            "http://127.0.0.1/api/secretaria/metrics?city=%20Cidade%20Sec%20Teste%20&city=OutraCidade&networkId=%20net-sec-a%20&networkId=net-sec-b"
          )
        );
        expect(rRepValid.status).toBe(200);
        const repValidBody = await rRepValid.json();
        expect(repValidBody.metrics).toEqual(secApiBody.metrics);
        expect(repValidBody.schools).toEqual(secApiBody.schools);

        const pageRepValidEl = (await SecretariaPage({
          searchParams: Promise.resolve({
            city: [" Cidade Sec Teste ", "OutraCidade"],
            networkId: [" net-sec-a ", "net-sec-b"],
          }),
        })) as unknown as {
          props: {
            city: string;
            metrics: typeof secApiBody.metrics;
            initialSchools: typeof secApiBody.schools;
            predictiveData: typeof secApiBody.predictiveAnalysis;
          };
        };
        expect(pageRepValidEl.props.city).toBe("Cidade Sec Teste");
        expect(pageRepValidEl.props.metrics).toEqual(repValidBody.metrics);
        expect(pageRepValidEl.props.initialSchools).toEqual(repValidBody.schools);
        expect(pageRepValidEl.props.predictiveData).toEqual(repValidBody.predictiveAnalysis);

        // 6b. Primeiro valor vazio seguido de valor alheio -> vazio é tratado como ausência de filtro (200 + paridade SSR)
        tenantCalls.length = 0;
        const rRepEmpty = await secretariaMetricsHandler(
          new NextRequest(
            "http://127.0.0.1/api/secretaria/metrics?city=%20%20&city=OutraCidade&networkId=&networkId=net-sec-b"
          )
        );
        expect(rRepEmpty.status).toBe(200);
        const repEmptyBody = await rRepEmpty.json();
        expect(repEmptyBody.metrics).toEqual(secApiBody.metrics);

        const pageRepEmptyEl = (await SecretariaPage({
          searchParams: Promise.resolve({
            city: ["   ", "OutraCidade"],
            networkId: ["", "net-sec-b"],
          }),
        })) as unknown as {
          props: {
            city: string;
            metrics: typeof secApiBody.metrics;
            initialSchools: Array<{ id: string }>;
          };
        };
        expect(pageRepEmptyEl.props.city).toBe("Cidade Sec Teste");
        expect(pageRepEmptyEl.props.metrics).toEqual(repEmptyBody.metrics);
        expect(pageRepEmptyEl.props.initialSchools.map((s) => s.id)).toEqual([
          "school-sec-a1",
          "school-sec-a2",
        ]);

        // 6c. Ordem invertida (rede/cidade alheia primeiro, autorizada depois) -> 403 na API e SSR seguro sem vazar rede alheia
        tenantCalls.length = 0;
        const rInvNet = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics?networkId=net-sec-b&networkId=net-sec-a")
        );
        expect(rInvNet.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        const rInvCity = await secretariaMetricsHandler(
          new NextRequest(
            "http://127.0.0.1/api/secretaria/metrics?city=OutraCidade&city=Cidade%20Sec%20Teste"
          )
        );
        expect(rInvCity.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        const pageInvEl = (await SecretariaPage({
          searchParams: Promise.resolve({
            city: ["OutraCidade", "Cidade Sec Teste"],
            networkId: ["net-sec-b", "net-sec-a"],
          }),
        })) as unknown as {
          props: { city: string; initialSchools: Array<{ id: string }> };
        };
        expect(pageInvEl.props.city).toBe("Cidade Sec Teste");
        expect(pageInvEl.props.initialSchools.map((s) => s.id)).toEqual([
          "school-sec-a1",
          "school-sec-a2",
        ]);
        expect(
          tenantCalls.some((c) => c.schoolId === "school-sec-b1" || c.schoolId === "school-sec-a-inativa")
        ).toBe(false);

        const secUserNoLink = await prisma.user.create({
          data: {
            id: "user-sec-no-link",
            email: "sec-nolink@redeativa.local",
            name: "Gestora Sem Vínculo",
            role: "GESTAO_SECRETARIA",
            active: true,
          },
        });
        const secStaleNoLinkSessionUser = {
          id: secUserNoLink.id,
          email: secUserNoLink.email,
          name: secUserNoLink.name,
          role: "GESTAO_SECRETARIA",
          schoolId: null,
          networks: [{ networkId: "net-sec-a", name: "SEMEC Sec A", city: "Cidade Sec Teste" }],
        };

        // 7. Ausência de snapshot (usuário sintético existente sem vínculo ativo no banco) e snapshot revalidado com networks: []
        // mantendo vínculo antigo efetivamente em session.user.networks retornado por requireAuth -> 403 e 0 transações
        testAuthState.useRealPermissions = false;
        testAuthState.role = "GESTAO_SECRETARIA";
        testAuthState.userId = secUserNoLink.id;
        testAuthState.snapshot = null;
        testAuthState.pendingSessionUser = secStaleNoLinkSessionUser;

        tenantCalls.length = 0;
        const rNoSnapshot = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics")
        );
        expect(rNoSnapshot.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        testAuthState.snapshot = {
          id: secUserNoLink.id,
          email: secUserNoLink.email,
          name: secUserNoLink.name,
          role: "GESTAO_SECRETARIA",
          active: true,
          schoolId: null,
          schools: [],
          networks: [],
        };
        testAuthState.pendingSessionUser = secStaleNoLinkSessionUser;
        tenantCalls.length = 0;
        const rEmptySnapshot = await secretariaMetricsHandler(
          new NextRequest("http://127.0.0.1/api/secretaria/metrics")
        );
        expect(rEmptySnapshot.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);
      } finally {
        await prisma.userNetwork.deleteMany({ where: { id: { in: ["un-sec-a"] } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: ["user-sec-a", "user-sec-no-link", "superadmin-sec-test"] } } }).catch(() => {});
        await prisma.educationNetwork.deleteMany({ where: { id: { in: ["net-sec-a", "net-sec-b"] } } }).catch(() => {});
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealPermissions = prevUseRealPermissions;
        testAuthState.snapshot = prevSnapshot;
        testAuthState.userId = prevUserId;
        testAuthState.role = prevRole;
      }
    });

    it("isola métricas globais de /admin por escola com withTenantContext preservando denominadores e RBAC", async () => {
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenant = rlsTenantContext.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(async (client, schoolId, callback) => {
          return originalWithTenant(client, schoolId, async (tx) => {
            const rows = await tx.$queryRaw<Array<{ sid: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS sid
            `;
            tenantCalls.push({
              schoolId,
              currentSetting: rows[0]?.sid ?? null,
            });
            return callback(tx);
          });
        });

      const netFindSpy = vi.spyOn(prisma.educationNetwork, "findMany");
      const schoolFindSpy = vi.spyOn(prisma.school, "findMany");
      const auditFindSpy = vi.spyOn(prisma.auditLog, "findMany");

      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      const prevPendingTokenSchoolId = testAuthState.pendingTokenSchoolId;
      testAuthState.useRealPermissions = true;

      try {
        await prisma.user.deleteMany({
          where: { id: { in: ["user-adm-super", "user-adm-inativo", "user-adm-sec"] } },
        });
        await prisma.educationNetwork.deleteMany({
          where: { id: { in: ["net-adm-a", "net-adm-inativa"] } },
        });

        await prisma.educationNetwork.createMany({
          data: [
            {
              id: "net-adm-a",
              name: "SEMEC Admin A",
              shortName: "SEMEC Adm A",
              city: "Cidade Teste",
              state: "PR",
              active: true,
            },
            {
              id: "net-adm-inativa",
              name: "SEMEC Admin Inativa",
              shortName: "SEMEC Adm Inat",
              city: "Cidade Teste",
              state: "PR",
              active: false,
            },
          ],
        });

        await prisma.school.update({
          where: { id: "school-alpha" },
          data: { network: "MUNICIPAL", networkId: "net-adm-a" },
        });

        await prisma.school.create({
          data: {
            id: "school-adm-inativa",
            inepCode: "99000950",
            name: "Escola Admin Inativa",
            city: "Cidade Teste",
            state: "PR",
            nre: "NRE Teste",
            network: "MUNICIPAL",
            active: false,
          },
        });

        await prisma.classGroup.createMany({
          data: [
            { id: "cg-adm-a1", name: "1º A", segment: "EM", shift: "MANHA", schoolId: "school-alpha" },
            { id: "cg-adm-a2", name: "2º A", segment: "EM", shift: "MANHA", schoolId: "school-alpha" },
            { id: "cg-adm-b1", name: "1º B", segment: "EM", shift: "MANHA", schoolId: "school-beta" },
            {
              id: "cg-adm-inativa",
              name: "1º Inat",
              segment: "EM",
              shift: "MANHA",
              schoolId: "school-adm-inativa",
            },
          ],
        });

        await prisma.student.createMany({
          data: [
            {
              id: "stu-adm-a1",
              cgm: "99095101",
              name: "Estudante Adm A1",
              phone: "5541999950011",
              classGroupId: "cg-adm-a1",
              schoolId: "school-alpha",
              active: true,
            },
            {
              id: "stu-adm-a2",
              cgm: "99095102",
              name: "Estudante Adm A2",
              phone: "5541999950012",
              classGroupId: "cg-adm-a1",
              schoolId: "school-alpha",
              active: true,
            },
            {
              id: "stu-adm-a-inativo",
              cgm: "99095103",
              name: "Estudante Adm A Inativo",
              phone: "5541999950013",
              classGroupId: "cg-adm-a1",
              schoolId: "school-alpha",
              active: false,
            },
            {
              id: "stu-adm-a-cross",
              cgm: "99095104",
              name: "Estudante Adm A Cross",
              phone: "5541999950014",
              classGroupId: "cg-adm-b1",
              schoolId: "school-alpha",
              active: true,
            },
            {
              id: "stu-adm-b1",
              cgm: "99095201",
              name: "Estudante Adm B1",
              phone: "5541999950021",
              classGroupId: "cg-adm-b1",
              schoolId: "school-beta",
              active: true,
            },
            {
              id: "stu-adm-inativa-1",
              cgm: "99095301",
              name: "Estudante Adm Inativa",
              phone: "5541999950031",
              classGroupId: "cg-adm-inativa",
              schoolId: "school-adm-inativa",
              active: true,
            },
          ],
        });

        await prisma.messageLog.createMany({
          data: [
            {
              id: "msg-adm-a-own",
              studentId: "stu-adm-a1",
              schoolId: "school-alpha",
              phoneUsed: "5541999950011",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Msg A Own",
            },
            {
              id: "msg-adm-a-legacy",
              studentId: "stu-adm-a2",
              schoolId: null,
              phoneUsed: "5541999950012",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Msg A Legacy",
            },
            {
              id: "msg-adm-a-inativo-stu",
              studentId: "stu-adm-a-inativo",
              schoolId: "school-alpha",
              phoneUsed: "5541999950013",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Msg A Inativo",
            },
            {
              id: "msg-adm-a-div",
              studentId: "stu-adm-a1",
              schoolId: "school-beta",
              phoneUsed: "5541999950011",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Msg A Divergente",
            },
            {
              id: "msg-adm-a-cross-stu",
              studentId: "stu-adm-a-cross",
              schoolId: "school-alpha",
              phoneUsed: "5541999950014",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Msg A Cross",
            },
            {
              id: "msg-adm-b-own",
              studentId: "stu-adm-b1",
              schoolId: "school-beta",
              phoneUsed: "5541999950021",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Msg B Own",
            },
            {
              id: "msg-adm-inativa",
              studentId: "stu-adm-inativa-1",
              schoolId: "school-adm-inativa",
              phoneUsed: "5541999950031",
              sentByName: "Equipe Teste",
              reasonTitle: "Faltas",
              messageContent: "Msg Inativa",
            },
          ],
        });

        await prisma.auditLog.create({
          data: {
            id: "audit-adm-1",
            action: "CREATE_SCHOOL",
            entityType: "School",
            userName: "Super Admin Teste",
            userEmail: "super-adm@redeativa.local",
            details: "Registro de auditoria admin",
          },
        });

        await prisma.user.createMany({
          data: [
            {
              id: "user-adm-super",
              email: "super-adm@redeativa.local",
              name: "Super Admin Teste",
              role: "SUPERADMIN",
              active: true,
            },
            {
              id: "user-adm-inativo",
              email: "inativo-adm@redeativa.local",
              name: "Inativo Teste",
              role: "SUPERADMIN",
              active: false,
            },
            {
              id: "user-adm-sec",
              email: "sec-adm@redeativa.local",
              name: "Secretaria Sem Global",
              role: "GESTAO_SECRETARIA",
              active: true,
            },
          ],
        });

        // 1. Sessão ausente -> redirect("/login"), zero consultas de métricas
        tenantCalls.length = 0;
        netFindSpy.mockClear();
        schoolFindSpy.mockClear();
        auditFindSpy.mockClear();
        testAuthState.pendingSessionUser = null;
        testAuthState.pendingTokenSchoolId = "force-null";
        await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT");
        expect(tenantCalls).toHaveLength(0);
        expect(netFindSpy).not.toHaveBeenCalled();
        expect(schoolFindSpy).not.toHaveBeenCalled();
        expect(auditFindSpy).not.toHaveBeenCalled();

        // 2. Usuário inativo -> redirect("/login?error=AccountInactive"), zero consultas de métricas
        testAuthState.pendingTokenSchoolId = null;
        testAuthState.pendingSessionUser = {
          id: "user-adm-inativo",
          email: "inativo-adm@redeativa.local",
          name: "Inativo Teste",
          role: "SUPERADMIN",
          schoolId: null,
        };
        await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT");
        expect(tenantCalls).toHaveLength(0);
        expect(netFindSpy).not.toHaveBeenCalled();
        expect(schoolFindSpy).not.toHaveBeenCalled();
        expect(auditFindSpy).not.toHaveBeenCalled();

        // 3. GESTAO_SECRETARIA (ou ADMIN) sem privilégio global -> redirect("/"), zero consultas de métricas
        testAuthState.pendingSessionUser = {
          id: "user-adm-sec",
          email: "sec-adm@redeativa.local",
          name: "Secretaria Sem Global",
          role: "GESTAO_SECRETARIA",
          schoolId: null,
        };
        await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT");
        expect(tenantCalls).toHaveLength(0);
        expect(netFindSpy).not.toHaveBeenCalled();
        expect(schoolFindSpy).not.toHaveBeenCalled();
        expect(auditFindSpy).not.toHaveBeenCalled();

        // 4. SUPERADMIN sem escola selecionada -> consolida métricas via withTenantContext por escola
        testAuthState.pendingSessionUser = {
          id: "user-adm-super",
          email: "super-adm@redeativa.local",
          name: "Super Admin Teste",
          role: "SUPERADMIN",
          schoolId: null,
        };

        const adminEl = (await AdminPage()) as unknown as {
          props: {
            metrics: {
              totalNetworks: number;
              totalSchools: number;
              totalStudents: number;
              totalMessages: number;
            };
            networks: Array<{ id: string; schoolsCount: number }>;
            schools: Array<{
              id: string;
              networkName: string | null;
              studentsCount: number;
              classesCount: number;
            }>;
            auditLogs: Array<{ id: string }>;
          };
        };

        expect(adminEl.props.metrics).toEqual({
          totalNetworks: 1,
          totalSchools: 2,
          totalStudents: 6,
          totalMessages: 5,
        });
        expect(adminEl.props.networks).toHaveLength(1);
        expect(adminEl.props.networks[0]).toMatchObject({
          id: "net-adm-a",
          schoolsCount: 1,
        });
        expect(adminEl.props.schools.map((s) => s.id)).toEqual(["school-alpha", "school-beta"]);
        expect(adminEl.props.schools.find((s) => s.id === "school-alpha")).toMatchObject({
          id: "school-alpha",
          networkName: "SEMEC Admin A",
          studentsCount: 3,
          classesCount: 3,
        });
        expect(adminEl.props.schools.find((s) => s.id === "school-beta")).toMatchObject({
          id: "school-beta",
          studentsCount: 2,
          classesCount: 2,
        });
        expect(adminEl.props.auditLogs.some((a) => a.id === "audit-adm-1")).toBe(true);
        expect(tenantCalls.map((c) => c.schoolId).sort()).toEqual([
          "school-adm-inativa",
          "school-alpha",
          "school-beta",
        ]);
        expect(tenantCalls.every((c) => c.currentSetting === c.schoolId)).toBe(true);
      } finally {
        await prisma.user
          .deleteMany({
            where: { id: { in: ["user-adm-super", "user-adm-inativo", "user-adm-sec"] } },
          })
          .catch(() => {});
        await prisma.educationNetwork
          .deleteMany({ where: { id: { in: ["net-adm-a", "net-adm-inativa"] } } })
          .catch(() => {});
        netFindSpy.mockRestore();
        schoolFindSpy.mockRestore();
        auditFindSpy.mockRestore();
        withTenantSpy.mockRestore();
        testAuthState.pendingTokenSchoolId = prevPendingTokenSchoolId;
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("isola leituras de GET /api/schools, GET /api/schools/[id] e /admin/escolas por escola com withTenantContext", async () => {
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenant = rlsTenantContext.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(async (client, schoolId, callback) => {
          return originalWithTenant(client, schoolId, async (tx) => {
            const rows = await tx.$queryRaw<Array<{ sid: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS sid
            `;
            tenantCalls.push({
              schoolId,
              currentSetting: rows[0]?.sid ?? null,
            });
            return callback(tx);
          });
        });

      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;

      try {
        await prisma.userNetwork.deleteMany({ where: { id: { in: ["un-sch-combo"] } } });
        await prisma.userSchool.deleteMany({
          where: { id: { in: ["us-sch-gestor", "us-sch-combo"] } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: ["user-sch-super", "user-sch-gestor", "user-sch-combo"] } },
        });
        await prisma.educationNetwork.deleteMany({
          where: { id: { in: ["net-sch-a", "net-sch-b"] } },
        });

        await prisma.educationNetwork.createMany({
          data: [
            {
              id: "net-sch-a",
              name: "SEMEC Escolas A",
              shortName: "SEMEC Esc A",
              city: "Cidade Teste",
              state: "PR",
              active: true,
            },
            {
              id: "net-sch-b",
              name: "SEMEC Escolas B",
              shortName: "SEMEC Esc B",
              city: "Cidade Teste",
              state: "PR",
              active: true,
            },
          ],
        });

        await prisma.school.update({
          where: { id: "school-alpha" },
          data: { network: "MUNICIPAL", networkId: "net-sch-a", syncTokenHash: "hash-alpha" },
        });

        await prisma.school.createMany({
          data: [
            {
              id: "school-sch-a2",
              inepCode: "99000961",
              name: "Escola A2",
              city: "Cidade Teste",
              state: "PR",
              nre: "NRE Teste",
              network: "MUNICIPAL",
              networkId: "net-sch-a",
              active: true,
            },
            {
              id: "school-sch-b1",
              inepCode: "99000962",
              name: "Escola B1",
              city: "Cidade Teste",
              state: "PR",
              nre: "NRE Teste",
              network: "MUNICIPAL",
              networkId: "net-sch-b",
              active: true,
            },
            {
              id: "school-sch-inativa",
              inepCode: "99000963",
              name: "Escola Inativa",
              city: "Cidade Teste",
              state: "PR",
              nre: "NRE Teste",
              network: "MUNICIPAL",
              networkId: "net-sch-a",
              active: false,
            },
          ],
        });

        await prisma.classGroup.createMany({
          data: [
            { id: "cg-sch-a2", name: "2º A", segment: "EM", shift: "MANHA", schoolId: "school-alpha" },
            { id: "cg-sch-a2-1", name: "1º A2", segment: "EM", shift: "MANHA", schoolId: "school-sch-a2" },
            { id: "cg-sch-b1", name: "1º B1", segment: "EM", shift: "MANHA", schoolId: "school-sch-b1" },
            {
              id: "cg-sch-inativa",
              name: "1º Inat",
              segment: "EM",
              shift: "MANHA",
              schoolId: "school-sch-inativa",
            },
          ],
        });

        await prisma.student.createMany({
          data: [
            {
              id: "stu-sch-a-act",
              cgm: "99096101",
              name: "Estudante Alpha Ativo",
              phone: "5541999960011",
              classGroupId: "cg-alpha",
              schoolId: "school-alpha",
              active: true,
              updatedAt: new Date("2026-06-01T12:00:00.000Z"),
            },
            {
              id: "stu-sch-a-inact",
              cgm: "99096102",
              name: "Estudante Alpha Inativo",
              phone: "5541999960012",
              classGroupId: "cg-alpha",
              schoolId: "school-alpha",
              active: false,
              updatedAt: new Date("2099-01-15T12:00:00.000Z"),
            },
            {
              id: "stu-sch-a-cross",
              cgm: "99096103",
              name: "Estudante Alpha Cross",
              phone: "5541999960013",
              classGroupId: "cg-sch-b1",
              schoolId: "school-alpha",
              active: true,
              updatedAt: new Date("2099-06-01T12:00:00.000Z"),
            },
            {
              id: "stu-sch-a2-1",
              cgm: "99096201",
              name: "Estudante A2",
              phone: "5541999960021",
              classGroupId: "cg-sch-a2-1",
              schoolId: "school-sch-a2",
              active: true,
            },
            {
              id: "stu-sch-b1-1",
              cgm: "99096301",
              name: "Estudante B1",
              phone: "5541999960031",
              classGroupId: "cg-sch-b1",
              schoolId: "school-sch-b1",
              active: true,
            },
            {
              id: "stu-sch-inativa-1",
              cgm: "99096401",
              name: "Estudante Inativa",
              phone: "5541999960041",
              classGroupId: "cg-sch-inativa",
              schoolId: "school-sch-inativa",
              active: false,
              updatedAt: new Date("2026-07-01T12:00:00.000Z"),
            },
          ],
        });

        await prisma.pedagogicalMinute.create({
          data: {
            id: "ata-sch-a",
            schoolId: "school-alpha",
            year: 2026,
            subject: "Ata Alpha",
            summary: "Resumo",
            status: "FINALIZED",
            authorName: "Equipe",
            authorEmail: "equipe@redeativa.local",
          },
        });

        await prisma.user.createMany({
          data: [
            {
              id: "user-sch-super",
              email: "super-sch@redeativa.local",
              name: "Super Escolas",
              role: "SUPERADMIN",
              active: true,
            },
            {
              id: "user-sch-gestor",
              email: "gestor-sch@redeativa.local",
              name: "Gestor Alpha",
              role: "GESTOR_ESCOLAR",
              active: true,
            },
            {
              id: "user-sch-combo",
              email: "combo-sch@redeativa.local",
              name: "Gestor Secretaria Combo",
              role: "GESTAO_SECRETARIA",
              active: true,
            },
          ],
        });

        await prisma.userSchool.createMany({
          data: [
            {
              id: "us-sch-gestor",
              userId: "user-sch-gestor",
              schoolId: "school-alpha",
              role: "GESTOR_ESCOLAR",
              active: true,
            },
            {
              id: "us-sch-combo",
              userId: "user-sch-combo",
              schoolId: "school-alpha",
              role: "GESTOR_ESCOLAR",
              active: true,
            },
          ],
        });

        await prisma.userNetwork.create({
          data: {
            id: "un-sch-combo",
            userId: "user-sch-combo",
            networkId: "net-sch-a",
            role: "GESTAO_SECRETARIA",
            active: true,
          },
        });

        // 1. SUPERADMIN sem escola selecionada -> GET /api/schools e /admin/escolas
        testAuthState.pendingSessionUser = {
          id: "user-sch-super",
          email: "super-sch@redeativa.local",
          name: "Super Escolas",
          role: "SUPERADMIN",
          schoolId: null,
        };

        tenantCalls.length = 0;
        const rSuperList = await listSchoolsHandler();
        expect(rSuperList.status).toBe(200);
        const superListBody = await rSuperList.json();
        expect(superListBody.success).toBe(true);
        const superIds = superListBody.schools.map((s: { id: string }) => s.id);
        expect(superIds).toEqual(
          expect.arrayContaining(["school-alpha", "school-beta", "school-sch-a2", "school-sch-b1"])
        );
        expect(superIds).not.toContain("school-sch-inativa");
        const superAlpha = superListBody.schools.find((s: { id: string }) => s.id === "school-alpha");
        expect(superAlpha.syncTokenHash).toBeUndefined();
        expect(superAlpha.hasSyncToken).toBe(true);
        expect(superAlpha._count).toEqual({
          students: 2,
          classGroups: 2,
          pedagogicalMinutes: 1,
          userSchools: 2,
        });
        expect(tenantCalls.map((c) => c.schoolId).sort()).toEqual([
          "school-alpha",
          "school-beta",
          "school-sch-a2",
          "school-sch-b1",
        ]);
        expect(tenantCalls.every((c) => c.currentSetting === c.schoolId)).toBe(true);

        tenantCalls.length = 0;
        const escolasEl = (await AdminEscolasPage()) as unknown as {
          props: {
            schools: Array<{
              id: string;
              studentsCount: number;
              classesCount: number;
              lastSyncAt: string | null;
              hasSyncToken: boolean;
            }>;
          };
        };
        const escAlpha = escolasEl.props.schools.find((s) => s.id === "school-alpha");
        const escInativa = escolasEl.props.schools.find((s) => s.id === "school-sch-inativa");
        expect(escAlpha).toMatchObject({
          id: "school-alpha",
          studentsCount: 3,
          classesCount: 2,
          lastSyncAt: "2099-01-15T12:00:00.000Z",
          hasSyncToken: true,
        });
        expect(escInativa).toMatchObject({
          id: "school-sch-inativa",
          studentsCount: 1,
          classesCount: 1,
          lastSyncAt: "2026-07-01T12:00:00.000Z",
        });
        expect(tenantCalls.map((c) => c.schoolId).sort()).toEqual([
          "school-alpha",
          "school-beta",
          "school-sch-a2",
          "school-sch-b1",
          "school-sch-inativa",
        ]);
        expect(tenantCalls.every((c) => c.currentSetting === c.schoolId)).toBe(true);

        // 2. Gestor com vínculo ativo na escola-alvo (sessão apontando para school-beta) -> GET /api/schools/[id]
        testAuthState.pendingSessionUser = {
          id: "user-sch-gestor",
          email: "gestor-sch@redeativa.local",
          name: "Gestor Alpha",
          role: "GESTOR_ESCOLAR",
          schoolId: "school-beta",
        };
        tenantCalls.length = 0;
        const rDetailOk = await getSchoolByIdHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha"),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rDetailOk.status).toBe(200);
        const detailBody = await rDetailOk.json();
        expect(detailBody.success).toBe(true);
        expect(detailBody.school.id).toBe("school-alpha");
        expect(detailBody.school.syncTokenHash).toBeUndefined();
        expect(detailBody.school.hasSyncToken).toBe(true);
        expect(detailBody.school._count).toEqual({
          students: 2,
          classGroups: 2,
          pedagogicalMinutes: 1,
          userSchools: 2,
        });
        expect(detailBody.school.userSchools.map((u: { user: { id: string } }) => u.user.id).sort()).toEqual([
          "user-sch-combo",
          "user-sch-gestor",
        ]);
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        tenantCalls.length = 0;
        const rDetailForbidden = await getSchoolByIdHandler(
          new Request("http://127.0.0.1/api/schools/school-sch-b1"),
          { params: Promise.resolve({ id: "school-sch-b1" }) }
        );
        expect(rDetailForbidden.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        // 3. Secretaria com vínculo ativo na rede + UserSchool em school-alpha -> deduplicação e precedência de userRole
        testAuthState.pendingSessionUser = {
          id: "user-sch-combo",
          email: "combo-sch@redeativa.local",
          name: "Gestor Secretaria Combo",
          role: "GESTAO_SECRETARIA",
          schoolId: null,
        };
        tenantCalls.length = 0;
        const rComboList = await listSchoolsHandler();
        expect(rComboList.status).toBe(200);
        const comboListBody = await rComboList.json();
        expect(comboListBody.schools.map((s: { id: string }) => s.id).sort()).toEqual([
          "school-alpha",
          "school-sch-a2",
        ]);
        expect(comboListBody.schools.find((s: { id: string }) => s.id === "school-alpha")).toMatchObject({
          userRole: "GESTOR_ESCOLAR",
          _count: { students: 2, classGroups: 2, pedagogicalMinutes: 1 },
        });
        expect(comboListBody.schools.find((s: { id: string }) => s.id === "school-sch-a2")).toMatchObject({
          userRole: "GESTAO_SECRETARIA",
          _count: { students: 1, classGroups: 1, pedagogicalMinutes: 0 },
        });
        expect(tenantCalls.map((c) => c.schoolId).sort()).toEqual(["school-alpha", "school-sch-a2"]);

        tenantCalls.length = 0;
        const rSecOtherNet = await getSchoolByIdHandler(
          new Request("http://127.0.0.1/api/schools/school-sch-b1"),
          { params: Promise.resolve({ id: "school-sch-b1" }) }
        );
        expect(rSecOtherNet.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);

        // 4. Vínculo revogado -> lista vazia sem withTenantContext e detalhe 403 sem withTenantContext
        await prisma.userSchool.update({
          where: { id: "us-sch-combo" },
          data: { active: false },
        });
        await prisma.userNetwork.update({
          where: { id: "un-sch-combo" },
          data: { active: false },
        });

        tenantCalls.length = 0;
        const rRevokedList = await listSchoolsHandler();
        expect(rRevokedList.status).toBe(200);
        const revokedListBody = await rRevokedList.json();
        expect(revokedListBody.schools).toEqual([]);
        expect(tenantCalls).toHaveLength(0);

        const rRevokedDetail = await getSchoolByIdHandler(
          new Request("http://127.0.0.1/api/schools/school-alpha"),
          { params: Promise.resolve({ id: "school-alpha" }) }
        );
        expect(rRevokedDetail.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);
      } finally {
        await prisma.userNetwork.deleteMany({ where: { id: { in: ["un-sch-combo"] } } }).catch(() => {});
        await prisma.userSchool
          .deleteMany({ where: { id: { in: ["us-sch-gestor", "us-sch-combo"] } } })
          .catch(() => {});
        await prisma.user
          .deleteMany({ where: { id: { in: ["user-sch-super", "user-sch-gestor", "user-sch-combo"] } } })
          .catch(() => {});
        await prisma.educationNetwork
          .deleteMany({ where: { id: { in: ["net-sch-a", "net-sch-b"] } } })
          .catch(() => {});
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("isola MessageTemplate em GET/POST/PUT /api/templates e /modelos, /busca-ativa e /faltas com exceção global do SuperAdmin", async () => {
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenant = rlsTenantContext.withTenantContext;
      let captureSqlHook: ((sql: string) => void) | null = null;
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(async (client, schoolId, callback) => {
          return originalWithTenant(client, schoolId, async (tx) => {
            const rows = await tx.$queryRaw<Array<{ sid: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS sid
            `;
            tenantCalls.push({
              schoolId,
              currentSetting: rows[0]?.sid ?? null,
            });
            const hook = captureSqlHook;
            if (!hook) {
              return callback(tx);
            }
            const origQueryRaw = tx.$queryRaw.bind(tx);
            const wrappedTx = new Proxy(tx, {
              get(target, prop) {
                if (prop === "$queryRaw") {
                  return (...args: unknown[]) => {
                    const first = args[0];
                    if (Array.isArray(first)) {
                      hook(first.join("?"));
                    }
                    return (origQueryRaw as (...a: unknown[]) => unknown)(...args);
                  };
                }
                return Reflect.get(target, prop);
              },
            });
            return callback(wrappedTx);
          });
        });

      const logAuditMock = vi.mocked(logAudit);
      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;

      try {
        await prisma.userSchool.deleteMany({
          where: { id: { in: ["us-tpl-alpha", "us-tpl-piloto"] } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: ["user-tpl-alpha", "user-tpl-piloto", "user-tpl-super"] } },
        });
        await prisma.messageTemplate.deleteMany({
          where: {
            id: {
              in: [
                "tpl-piloto-own",
                "tpl-piloto-inact",
                "tpl-global-legacy",
                "tpl-alpha-ef2",
                "tpl-alpha-inact",
              ],
            },
          },
        });
        await prisma.school.deleteMany({ where: { id: { in: ["default-leopoldina"] } } });

        await prisma.school.create({
          data: {
            id: "default-leopoldina",
            inepCode: "41042730",
            name: "Escola Piloto Teste",
            city: "Tibagi",
            state: "PR",
            nre: "Telêmaco Borba",
            network: "ESTADUAL",
            active: true,
          },
        });

        await prisma.$executeRawUnsafe(
          `ALTER TABLE "MessageTemplate" ALTER COLUMN "schoolId" DROP NOT NULL`
        );

        await prisma.messageTemplate.createMany({
          data: [
            {
              id: "tpl-piloto-own",
              schoolId: "default-leopoldina",
              title: "AVISO PILOTO EM",
              segment: "EM",
              prefixText: "Prezado piloto",
              suffixText: "Att",
              active: true,
              isAbsenceRelated: true,
            },
            {
              id: "tpl-piloto-inact",
              schoolId: "default-leopoldina",
              title: "AVISO PILOTO INATIVO",
              segment: "TODOS",
              prefixText: "Inativo",
              suffixText: "Att",
              active: false,
              isAbsenceRelated: false,
            },
            {
              id: "tpl-alpha-ef2",
              schoolId: "school-alpha",
              title: "AVISO ALPHA EF2",
              segment: "EF2",
              prefixText: "Alpha EF2",
              suffixText: "Att",
              active: true,
              isAbsenceRelated: true,
            },
            {
              id: "tpl-alpha-inact",
              schoolId: "school-alpha",
              title: "AVISO ALPHA INATIVO",
              segment: "TODOS",
              prefixText: "Alpha Inat",
              suffixText: "Att",
              active: false,
              isAbsenceRelated: false,
            },
          ],
        });

        await prisma.$executeRawUnsafe(
          `INSERT INTO "MessageTemplate" ("id", "schoolId", "title", "segment", "prefixText", "suffixText", "active", "isAbsenceRelated")
           VALUES ('tpl-global-legacy', NULL, 'AVISO GLOBAL LEGADO', 'TODOS', 'Global', 'Att', true, true)`
        );

        await prisma.user.createMany({
          data: [
            {
              id: "user-tpl-alpha",
              email: "tpl-alpha@redeativa.local",
              name: "Pedagoga Alpha",
              role: "PEDAGOGA",
              active: true,
            },
            {
              id: "user-tpl-piloto",
              email: "tpl-piloto@redeativa.local",
              name: "Gestora Piloto",
              role: "GESTOR_ESCOLAR",
              active: true,
            },
            {
              id: "user-tpl-super",
              email: "tpl-super@redeativa.local",
              name: "Super Templates",
              role: "SUPERADMIN",
              active: true,
            },
          ],
        });

        await prisma.userSchool.createMany({
          data: [
            {
              id: "us-tpl-alpha",
              userId: "user-tpl-alpha",
              schoolId: "school-alpha",
              role: "PEDAGOGA",
              active: true,
            },
            {
              id: "us-tpl-piloto",
              userId: "user-tpl-piloto",
              schoolId: "default-leopoldina",
              role: "GESTOR_ESCOLAR",
              active: true,
            },
          ],
        });

        // 1. Escola Piloto (default-leopoldina): GET inclui global legado; SSRs retornam modelos da própria escola
        testAuthState.pendingSessionUser = {
          id: "user-tpl-piloto",
          email: "tpl-piloto@redeativa.local",
          name: "Gestora Piloto",
          role: "GESTOR_ESCOLAR",
          schoolId: "default-leopoldina",
        };

        tenantCalls.length = 0;
        const rGetPiloto = await listTemplatesHandler(
          new Request("http://127.0.0.1/api/templates?segment=EM")
        );
        expect(rGetPiloto.status).toBe(200);
        const pilotoApiList = await rGetPiloto.json();
        expect(pilotoApiList.map((t: { id: string }) => t.id)).toEqual([
          "tpl-global-legacy",
          "tpl-piloto-own",
        ]);
        expect(tenantCalls).toEqual([
          { schoolId: "default-leopoldina", currentSetting: "default-leopoldina" },
        ]);

        tenantCalls.length = 0;
        const modelosPilotoEl = (await ModelosPage()) as unknown as {
          props: { initialTemplates: Array<{ id: string }> };
        };
        expect(modelosPilotoEl.props.initialTemplates.map((t) => t.id)).toEqual([
          "tpl-piloto-own",
          "tpl-piloto-inact",
        ]);
        expect(tenantCalls).toEqual([
          { schoolId: "default-leopoldina", currentSetting: "default-leopoldina" },
        ]);

        tenantCalls.length = 0;
        const buscaPilotoEl = (await BuscaAtivaPage({
          searchParams: Promise.resolve({}),
        })) as unknown as {
          props: { templates: Array<{ id: string }> };
        };
        expect(buscaPilotoEl.props.templates.map((t) => t.id)).toEqual(["tpl-piloto-own"]);
        expect(tenantCalls).toEqual([
          { schoolId: "default-leopoldina", currentSetting: "default-leopoldina" },
        ]);

        tenantCalls.length = 0;
        const faltasPilotoEl = (await FaltasPage()) as unknown as {
          props: { templates: Array<{ id: string }> };
        };
        expect(faltasPilotoEl.props.templates.map((t) => t.id)).toEqual(["tpl-piloto-own"]);
        expect(tenantCalls).toEqual([
          { schoolId: "default-leopoldina", currentSetting: "default-leopoldina" },
        ]);

        // 2. Outra escola (school-alpha): GET e SSR excluem global legado e escola piloto
        testAuthState.pendingSessionUser = {
          id: "user-tpl-alpha",
          email: "tpl-alpha@redeativa.local",
          name: "Pedagoga Alpha",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
        };

        tenantCalls.length = 0;
        const rGetAlpha = await listTemplatesHandler(
          new Request("http://127.0.0.1/api/templates?segment=EF2")
        );
        expect(rGetAlpha.status).toBe(200);
        const alphaApiList = await rGetAlpha.json();
        expect(alphaApiList.map((t: { id: string }) => t.id)).toEqual([
          "tpl-alpha-ef2",
          "tpl-alpha",
        ]);
        expect(tenantCalls).toEqual([
          { schoolId: "school-alpha", currentSetting: "school-alpha" },
        ]);

        tenantCalls.length = 0;
        const modelosAlphaEl = (await ModelosPage()) as unknown as {
          props: { initialTemplates: Array<{ id: string }> };
        };
        expect(modelosAlphaEl.props.initialTemplates.map((t) => t.id).sort()).toEqual([
          "tpl-alpha",
          "tpl-alpha-ef2",
          "tpl-alpha-inact",
        ]);

        tenantCalls.length = 0;
        const buscaAlphaEl = (await BuscaAtivaPage({
          searchParams: Promise.resolve({}),
        })) as unknown as {
          props: { templates: Array<{ id: string }> };
        };
        expect(buscaAlphaEl.props.templates.map((t) => t.id).sort()).toEqual([
          "tpl-alpha",
          "tpl-alpha-ef2",
        ]);

        tenantCalls.length = 0;
        const faltasAlphaEl = (await FaltasPage()) as unknown as {
          props: { templates: Array<{ id: string }> };
        };
        expect(faltasAlphaEl.props.templates.map((t) => t.id).sort()).toEqual([
          "tpl-alpha",
          "tpl-alpha-ef2",
        ]);

        // 3. POST e PUT na própria escola (school-alpha) + negativas cruzadas e de auditoria
        logAuditMock.mockClear();
        tenantCalls.length = 0;
        const rPostAlpha = await createTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "Novo Modelo Alpha",
              segment: "MEDIO",
              prefixText: "Olá responsável",
              suffixText: "Atenciosamente",
              isAbsenceRelated: true,
            }),
          })
        );
        expect(rPostAlpha.status).toBe(200);
        const createdAlpha = await rPostAlpha.json();
        expect(createdAlpha.schoolId).toBe("school-alpha");
        expect(createdAlpha.title).toBe("NOVO MODELO ALPHA");
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);
        expect(logAuditMock).toHaveBeenCalledTimes(1);
        expect(logAuditMock).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "CREATE_TEMPLATE",
            schoolId: "school-alpha",
          })
        );

        logAuditMock.mockClear();
        const rPutAlpha = await updateTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: createdAlpha.id,
              title: "Modelo Alpha Editado",
              segment: "FUNDAMENTAL",
              prefixText: "Olá atualizado",
              suffixText: "Equipe",
              isAbsenceRelated: false,
              active: true,
            }),
          })
        );
        expect(rPutAlpha.status).toBe(200);
        const updatedAlpha = await rPutAlpha.json();
        expect(updatedAlpha.title).toBe("MODELO ALPHA EDITADO");
        expect(updatedAlpha.schoolId).toBe("school-alpha");
        expect(logAuditMock).toHaveBeenCalledTimes(1);

        // Negativa: school-alpha tentando editar modelo da Escola Piloto -> 403, sem consultar conteúdo e sem auditoria
        logAuditMock.mockClear();
        const inspectedSql: string[] = [];
        captureSqlHook = (sql) => inspectedSql.push(sql);
        const rPutCross = await updateTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: "tpl-piloto-own",
              title: "Tentativa Cruzada",
              segment: "MEDIO",
              prefixText: "Invasão",
              suffixText: "Att",
            }),
          })
        );
        captureSqlHook = null;
        expect(rPutCross.status).toBe(403);
        expect(inspectedSql).toHaveLength(1);
        expect(inspectedSql[0]).not.toContain("prefixText");
        expect(inspectedSql[0]).not.toContain("suffixText");
        expect(inspectedSql[0]).not.toContain("title");
        expect(logAuditMock).not.toHaveBeenCalled();
        expect(
          (await prisma.messageTemplate.findUnique({ where: { id: "tpl-piloto-own" } }))?.title
        ).toBe("AVISO PILOTO EM");

        // Negativa: não-SUPERADMIN tentando editar modelo global legado -> 403 e sem auditoria
        testAuthState.pendingSessionUser = {
          id: "user-tpl-piloto",
          email: "tpl-piloto@redeativa.local",
          name: "Gestora Piloto",
          role: "GESTOR_ESCOLAR",
          schoolId: "default-leopoldina",
        };
        logAuditMock.mockClear();
        const rPutGlobalNonSuper = await updateTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: "tpl-global-legacy",
              title: "Alteração Não Autorizada",
              segment: "TODOS",
              prefixText: "X",
              suffixText: "Y",
            }),
          })
        );
        expect(rPutGlobalNonSuper.status).toBe(403);
        expect(logAuditMock).not.toHaveBeenCalled();
        const globalCheckRows = await prisma.$queryRaw<Array<{ title: string }>>`
          SELECT "title" FROM "MessageTemplate" WHERE "id" = 'tpl-global-legacy'
        `;
        expect(globalCheckRows[0]?.title).toBe("AVISO GLOBAL LEGADO");

        // Negativa: vínculo revogado -> 403 sem withTenantContext e sem auditoria
        await prisma.userSchool.update({
          where: { id: "us-tpl-alpha" },
          data: { active: false },
        });
        testAuthState.pendingSessionUser = {
          id: "user-tpl-alpha",
          email: "tpl-alpha@redeativa.local",
          name: "Pedagoga Alpha",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
        };
        tenantCalls.length = 0;
        logAuditMock.mockClear();
        const rPostRevoked = await createTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "Sem Vínculo",
              segment: "TODOS",
              prefixText: "A",
              suffixText: "B",
            }),
          })
        );
        expect(rPostRevoked.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);
        expect(logAuditMock).not.toHaveBeenCalled();

        // 4. SUPERADMIN sem escola selecionada -> 403 em POST e PUT
        testAuthState.pendingSessionUser = {
          id: "user-tpl-super",
          email: "tpl-super@redeativa.local",
          name: "Super Templates",
          role: "SUPERADMIN",
          schoolId: null,
        };
        tenantCalls.length = 0;
        logAuditMock.mockClear();
        const rSuperPostNoSchool = await createTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "Super Sem Escola",
              segment: "TODOS",
              prefixText: "A",
              suffixText: "B",
            }),
          })
        );
        expect(rSuperPostNoSchool.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);
        expect(logAuditMock).not.toHaveBeenCalled();

        const rSuperPutNoSchool = await updateTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: "tpl-global-legacy",
              title: "Super Sem Escola",
              segment: "TODOS",
              prefixText: "A",
              suffixText: "B",
            }),
          })
        );
        expect(rSuperPutNoSchool.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);
        expect(logAuditMock).not.toHaveBeenCalled();

        // SUPERADMIN com school-beta selecionada tentando editar modelo de school-alpha -> 403
        await prisma.user.update({
          where: { id: "user-tpl-super" },
          data: { schoolId: "school-beta" },
        });
        testAuthState.pendingSessionUser = {
          id: "user-tpl-super",
          email: "tpl-super@redeativa.local",
          name: "Super Templates",
          role: "SUPERADMIN",
          schoolId: "school-beta",
        };
        logAuditMock.mockClear();
        const rSuperCrossEdit = await updateTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: "tpl-alpha-ef2",
              title: "Super Cruzado",
              segment: "FUNDAMENTAL",
              prefixText: "X",
              suffixText: "Y",
            }),
          })
        );
        expect(rSuperCrossEdit.status).toBe(403);
        expect(logAuditMock).not.toHaveBeenCalled();

        // SUPERADMIN com escola selecionada (default-leopoldina) edita modelo global legado (schoolId: null) -> 200
        await prisma.user.update({
          where: { id: "user-tpl-super" },
          data: { schoolId: "default-leopoldina" },
        });
        testAuthState.pendingSessionUser = {
          id: "user-tpl-super",
          email: "tpl-super@redeativa.local",
          name: "Super Templates",
          role: "SUPERADMIN",
          schoolId: "default-leopoldina",
        };
        tenantCalls.length = 0;
        logAuditMock.mockClear();
        const rSuperEditGlobal = await updateTemplateHandler(
          new Request("http://127.0.0.1/api/templates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: "tpl-global-legacy",
              title: "Aviso Global Atualizado",
              segment: "TODOS",
              prefixText: "Global Novo",
              suffixText: "Att",
            }),
          })
        );
        expect(rSuperEditGlobal.status).toBe(200);
        const globalUpdated = await rSuperEditGlobal.json();
        expect(globalUpdated.schoolId).toBeNull();
        expect(globalUpdated.title).toBe("AVISO GLOBAL ATUALIZADO");
        expect(tenantCalls).toEqual([
          { schoolId: "default-leopoldina", currentSetting: "default-leopoldina" },
        ]);
        expect(logAuditMock).toHaveBeenCalledTimes(1);

        // Duas edições concorrentes em campos distintos do mesmo modelo global persistem ambas
        const [rConcTitle, rConcSuffix] = await Promise.all([
          updateTemplateHandler(
            new Request("http://127.0.0.1/api/templates", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: "tpl-global-legacy",
                title: "Título Concorrente Global",
              }),
            })
          ),
          updateTemplateHandler(
            new Request("http://127.0.0.1/api/templates", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: "tpl-global-legacy",
                suffixText: "Rodapé Concorrente Global",
              }),
            })
          ),
        ]);
        expect(rConcTitle.status).toBe(200);
        expect(rConcSuffix.status).toBe(200);
        const finalGlobalRows = await prisma.$queryRaw<
          Array<{ title: string; prefixText: string; suffixText: string; schoolId: string | null }>
        >`
          SELECT "title", "prefixText", "suffixText", "schoolId"
          FROM "MessageTemplate"
          WHERE "id" = 'tpl-global-legacy'
        `;
        expect(finalGlobalRows[0]).toEqual({
          title: "TÍTULO CONCORRENTE GLOBAL",
          prefixText: "Global Novo",
          suffixText: "Rodapé Concorrente Global",
          schoolId: null,
        });
      } finally {
        await prisma.userSchool
          .deleteMany({ where: { id: { in: ["us-tpl-alpha", "us-tpl-piloto"] } } })
          .catch(() => {});
        await prisma.user
          .deleteMany({ where: { id: { in: ["user-tpl-alpha", "user-tpl-piloto", "user-tpl-super"] } } })
          .catch(() => {});
        await prisma.messageTemplate
          .deleteMany({
            where: {
              id: {
                in: [
                  "tpl-piloto-own",
                  "tpl-piloto-inact",
                  "tpl-global-legacy",
                  "tpl-alpha-ef2",
                  "tpl-alpha-inact",
                ],
              },
            },
          })
          .catch(() => {});
        await prisma.messageTemplate
          .deleteMany({ where: { schoolId: "default-leopoldina" } })
          .catch(() => {});
        await prisma
          .$executeRawUnsafe(`ALTER TABLE "MessageTemplate" ALTER COLUMN "schoolId" SET NOT NULL`)
          .catch(() => {});
        await prisma.school.deleteMany({ where: { id: { in: ["default-leopoldina"] } } }).catch(() => {});
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("isola /api/classes/**, /api/low-attendance e /api/students/** (incl. import e subrotas) por escola com withTenantContext", async () => {
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenant = rlsTenantContext.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(async (client, schoolId, callback) => {
          return originalWithTenant(client, schoolId, async (tx) => {
            const rows = await tx.$queryRaw<Array<{ sid: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS sid
            `;
            tenantCalls.push({
              schoolId,
              currentSetting: rows[0]?.sid ?? null,
            });
            return callback(tx);
          });
        });

      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;

      try {
        await prisma.userSchool.deleteMany({ where: { id: { in: ["us-l2-alpha"] } } });
        await prisma.user.deleteMany({ where: { id: { in: ["user-l2-alpha"] } } });

        await prisma.user.create({
          data: {
            id: "user-l2-alpha",
            email: "l2-alpha@redeativa.local",
            name: "Gestor Lote 2",
            role: "GESTOR_ESCOLAR",
            active: true,
          },
        });
        await prisma.userSchool.create({
          data: {
            id: "us-l2-alpha",
            userId: "user-l2-alpha",
            schoolId: "school-alpha",
            role: "GESTOR_ESCOLAR",
            active: true,
          },
        });

        await prisma.student.update({
          where: { id: "stu-beta" },
          data: { cgm: "88800099" },
        });

        // Estudante com turma cruzada em school-alpha (deve ficar fora de GET /api/classes e GET /api/students)
        await prisma.student.create({
          data: {
            id: "stu-l2-cross",
            schoolId: "school-alpha",
            classGroupId: "cg-beta",
            name: "Estudante Cross L2",
            phone: "41999990000",
          },
        });

        testAuthState.pendingSessionUser = {
          id: "user-l2-alpha",
          email: "l2-alpha@redeativa.local",
          name: "Gestor Lote 2",
          role: "GESTOR_ESCOLAR",
          schoolId: "school-alpha",
        };

        // 1. /api/classes e /api/classes/[id]
        tenantCalls.length = 0;
        const rPostClass = await createClassHandler(
          new Request("http://127.0.0.1/api/classes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "7º Ano B", segment: "FUNDAMENTAL", shift: "TARDE" }),
          })
        );
        expect(rPostClass.status).toBe(201);
        const createdClass = await rPostClass.json();
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        const rDupClass = await createClassHandler(
          new Request("http://127.0.0.1/api/classes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "7º ano b", segment: "FUNDAMENTAL", shift: "TARDE" }),
          })
        );
        expect(rDupClass.status).toBe(409);

        tenantCalls.length = 0;
        const rGetClasses = await listClassesHandler(new Request("http://127.0.0.1/api/classes"));
        expect(rGetClasses.status).toBe(200);
        const classesList = await rGetClasses.json();
        expect(classesList.find((c: { id: string }) => c.id === "cg-alpha")?.studentsCount).toBe(1);
        expect(classesList.some((c: { id: string }) => c.id === "cg-beta")).toBe(false);
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        tenantCalls.length = 0;
        const rPatchClass = await patchClassHandler(
          new Request(`http://127.0.0.1/api/classes/${createdClass.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shift: "NOITE" }),
          }),
          { params: Promise.resolve({ id: createdClass.id }) }
        );
        expect(rPatchClass.status).toBe(200);
        expect((await rPatchClass.json()).classGroup.shift).toBe("NOITE");
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        const rPatchBetaClass = await patchClassHandler(
          new Request("http://127.0.0.1/api/classes/cg-beta", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shift: "NOITE" }),
          }),
          { params: Promise.resolve({ id: "cg-beta" }) }
        );
        expect(rPatchBetaClass.status).toBe(404);

        // 2. /api/students (GET, POST, PUT, DELETE)
        const rPostCrossTurma = await createStudentHandler(
          new Request("http://127.0.0.1/api/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Aluno Turma Beta",
              phone: "41999998888",
              classGroupId: "cg-beta",
            }),
          })
        );
        expect(rPostCrossTurma.status).toBe(400);

        const rPostCgmCollision = await createStudentHandler(
          new Request("http://127.0.0.1/api/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cgm: "88800099",
              name: "Aluno CGM Beta",
              phone: "41999998888",
              classGroupId: "cg-alpha",
            }),
          })
        );
        expect(rPostCgmCollision.status).toBe(409);

        tenantCalls.length = 0;
        const rPostStudent = await createStudentHandler(
          new Request("http://127.0.0.1/api/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cgm: "77700011",
              name: "Aluno Novo Alpha",
              guardianName: "Responsável Alpha",
              phone: "41999997777",
              classGroupId: "cg-alpha",
            }),
          })
        );
        expect(rPostStudent.status).toBe(200);
        const createdStudent = await rPostStudent.json();
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        tenantCalls.length = 0;
        const rGetStudents = await listStudentsHandler(new Request("http://127.0.0.1/api/students"));
        expect(rGetStudents.status).toBe(200);
        const studentsList = await rGetStudents.json();
        const studentIds = studentsList.map((s: { id: string }) => s.id);
        expect(studentIds).toContain("stu-alpha");
        expect(studentIds).toContain(createdStudent.id);
        expect(studentIds).not.toContain("stu-l2-cross");
        expect(studentIds).not.toContain("stu-beta");
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        const rPutStudent = await updateStudentHandler(
          new Request("http://127.0.0.1/api/students", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: createdStudent.id,
              name: "Aluno Novo Alpha Editado",
              classGroupId: createdClass.id,
            }),
          })
        );
        expect(rPutStudent.status).toBe(200);

        const rPutBetaStudent = await updateStudentHandler(
          new Request("http://127.0.0.1/api/students", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "stu-beta", name: "Invasão Beta" }),
          })
        );
        expect(rPutBetaStudent.status).toBe(404);

        // 3. /api/low-attendance
        const rUpsertBetaLowAtt = await upsertLowAttHandler(
          new Request("http://127.0.0.1/api/low-attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId: "stu-beta", attendancePercent: 55 }),
          })
        );
        expect(rUpsertBetaLowAtt.status).toBe(404);

        tenantCalls.length = 0;
        const rUpsertAlphaLowAtt = await upsertLowAttHandler(
          new Request("http://127.0.0.1/api/low-attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId: createdStudent.id, attendancePercent: 62 }),
          })
        );
        expect(rUpsertAlphaLowAtt.status).toBe(200);
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        const rGetLowAtt = await listLowAttHandler();
        expect(rGetLowAtt.status).toBe(200);
        const lowAttRows = await rGetLowAtt.json();
        expect(lowAttRows.map((r: { studentId: string }) => r.studentId)).toEqual([createdStudent.id]);

        // 4. Subrotas /api/students/[id]/{attendances,contacts,justifications}
        const rAttBeta = await createAttendanceHandler(
          new Request("http://127.0.0.1/api/students/stu-beta/attendances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attendedAt: "2026-11-26",
              guardianPresent: "Mãe Responsável",
              subject: "Assunto Beta",
              summary: "Resumo detalhado do atendimento presencial",
            }),
          }),
          { params: Promise.resolve({ id: "stu-beta" }) }
        );
        expect(rAttBeta.status).toBe(404);

        const rAttAlpha = await createAttendanceHandler(
          new Request(`http://127.0.0.1/api/students/${createdStudent.id}/attendances`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attendedAt: "2026-11-26",
              guardianPresent: "Mãe Responsável",
              subject: "Assunto Alpha",
              summary: "Resumo detalhado do atendimento presencial",
            }),
          }),
          { params: Promise.resolve({ id: createdStudent.id }) }
        );
        expect(rAttAlpha.status).toBe(201);
        const attCreated = await rAttAlpha.json();

        const rDelAtt = await deleteAttendanceHandler(
          new Request(
            `http://127.0.0.1/api/students/${createdStudent.id}/attendances?attendanceId=${attCreated.id}`,
            { method: "DELETE" }
          ),
          { params: Promise.resolve({ id: createdStudent.id }) }
        );
        expect(rDelAtt.status).toBe(200);

        const rContactAlpha = await createContactHandler(
          new Request(`http://127.0.0.1/api/students/${createdStudent.id}/contacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Mãe Alpha",
              kinship: "MAE",
              phone: "41999996666",
              isPrimary: true,
              whatsappValid: true,
            }),
          }),
          { params: Promise.resolve({ id: createdStudent.id }) }
        );
        expect(rContactAlpha.status).toBe(201);
        const contactCreated = await rContactAlpha.json();
        expect(
          (await prisma.student.findUnique({ where: { id: createdStudent.id } }))?.phone
        ).toBe("41999996666");

        const rPutContact = await updateContactHandler(
          new Request(`http://127.0.0.1/api/students/${createdStudent.id}/contacts`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contactId: contactCreated.id,
              name: "Mãe Alpha Atualizada",
              isPrimary: true,
            }),
          }),
          { params: Promise.resolve({ id: createdStudent.id }) }
        );
        expect(rPutContact.status).toBe(200);

        const rDelContact = await deleteContactHandler(
          new Request(
            `http://127.0.0.1/api/students/${createdStudent.id}/contacts?contactId=${contactCreated.id}`,
            { method: "DELETE" }
          ),
          { params: Promise.resolve({ id: createdStudent.id }) }
        );
        expect(rDelContact.status).toBe(200);

        const rJustAlpha = await createStudentJustificationHandler(
          new Request(`http://127.0.0.1/api/students/${createdStudent.id}/justifications`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "ATESTADO_MEDICO",
              startDate: "2026-11-25",
              endDate: "2026-11-26",
            }),
          }),
          { params: Promise.resolve({ id: createdStudent.id }) }
        );
        expect(rJustAlpha.status).toBe(201);
        const justCreated = await rJustAlpha.json();

        const rDelJust = await deleteStudentJustificationHandler(
          new Request(
            `http://127.0.0.1/api/students/${createdStudent.id}/justifications?justificationId=${justCreated.id}`,
            { method: "DELETE" }
          ),
          { params: Promise.resolve({ id: createdStudent.id }) }
        );
        expect(rDelJust.status).toBe(200);

        const rDelStudent = await deleteStudentHandler(
          new Request(`http://127.0.0.1/api/students?id=${createdStudent.id}`, { method: "DELETE" })
        );
        expect(rDelStudent.status).toBe(200);

        // 5. POST /api/students/import (bloqueio updateSchoolInfo, importação isolada, CGM collision e lista fresca)
        const rImportForbid = await importStudentsHandler(
          new Request("http://127.0.0.1/api/students/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              turmas: [{ tempId: "t1", name: "8º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }],
              students: [
                { name: "Aluno Importado", phone: "41999995555", turmaTempId: "t1", cgm: "55500011" },
              ],
              transferredStudents: [],
              options: {
                updateExisting: true,
                deactivateTransferred: false,
                updateSchoolInfo: true,
              },
            }),
          })
        );
        expect(rImportForbid.status).toBe(403);

        tenantCalls.length = 0;
        const rImportOk = await importStudentsHandler(
          new Request("http://127.0.0.1/api/students/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              turmas: [{ tempId: "t1", name: "8º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }],
              students: [
                { name: "Aluno Importado", phone: "41999995555", turmaTempId: "t1", cgm: "55500011" },
                { name: "Aluno CGM Beta", phone: "41999994444", turmaTempId: "t1", cgm: "88800099" },
              ],
              transferredStudents: [],
              options: {
                updateExisting: true,
                deactivateTransferred: false,
                updateSchoolInfo: false,
              },
            }),
          })
        );
        expect(rImportOk.status).toBe(200);
        const importBody = await rImportOk.json();
        expect(importBody.success).toBe(true);
        expect(importBody.summary.createdCount).toBe(2);
        expect(importBody.students.some((s: { name: string }) => s.name === "ALUNO IMPORTADO")).toBe(
          true
        );
        expect(importBody.students.some((s: { id: string }) => s.id === "stu-l2-cross")).toBe(false);
        expect(tenantCalls.every((c) => c.schoolId === "school-alpha" && c.currentSetting === "school-alpha")).toBe(true);

        // 6. Vínculo revogado -> 403 com 0 chamadas a withTenantContext
        await prisma.userSchool.update({
          where: { id: "us-l2-alpha" },
          data: { active: false },
        });
        tenantCalls.length = 0;
        const rRevokedClasses = await listClassesHandler(new Request("http://127.0.0.1/api/classes"));
        expect(rRevokedClasses.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);
      } finally {
        await prisma.userSchool.deleteMany({ where: { id: { in: ["us-l2-alpha"] } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: ["user-l2-alpha"] } } }).catch(() => {});
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("isola leituras SSR e relatórios (/api/reports, /relatorios, /alunos/**, /busca-ativa, /faltas, /historico, /gestao, /visao-geral, /atestados, /encaminhamentos) com withTenantContext", async () => {
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenant = rlsTenantContext.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantContext, "withTenantContext")
        .mockImplementation(async (client, schoolId, callback) => {
          return originalWithTenant(client, schoolId, async (tx) => {
            const rows = await tx.$queryRaw<Array<{ sid: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS sid
            `;
            tenantCalls.push({
              schoolId,
              currentSetting: rows[0]?.sid ?? null,
            });
            return callback(tx);
          });
        });

      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      testAuthState.useRealPermissions = true;
      testAuthState.useRealCurrentSchool = true;

      try {
        await prisma.userSchool.deleteMany({ where: { id: { in: ["us-l3-alpha"] } } });
        await prisma.user.deleteMany({ where: { id: { in: ["user-l3-alpha"] } } });

        await prisma.user.create({
          data: {
            id: "user-l3-alpha",
            email: "l3-alpha@redeativa.local",
            name: "Gestor Lote 3",
            role: "GESTOR_ESCOLAR",
            active: true,
          },
        });
        await prisma.userSchool.create({
          data: {
            id: "us-l3-alpha",
            userId: "user-l3-alpha",
            schoolId: "school-alpha",
            role: "GESTOR_ESCOLAR",
            active: true,
          },
        });

        await prisma.student.create({
          data: {
            id: "stu-l3-cross",
            schoolId: "school-alpha",
            classGroupId: "cg-beta",
            name: "Estudante Cross L3",
            phone: "41999990003",
          },
        });

        await prisma.lowAttendanceRecord.create({
          data: { studentId: "stu-alpha", attendancePercent: 65 },
        });
        await prisma.lowAttendanceRecord.create({
          data: { studentId: "stu-l3-cross", attendancePercent: 30 },
        });
        await prisma.lowAttendanceRecord.create({
          data: { studentId: "stu-beta", attendancePercent: 40 },
        });

        await prisma.absenceJustification.create({
          data: {
            id: "just-l3-alpha",
            studentId: "stu-alpha",
            type: "ATESTADO_MEDICO",
            startDate: new Date("2026-11-20T03:00:00.000Z"),
            endDate: new Date("2099-12-31T23:59:59.000Z"),
            createdByName: "Gestor Lote 3",
            createdByEmail: "l3-alpha@redeativa.local",
          },
        });

        await prisma.messageLog.createMany({
          data: [
            {
              id: "msg-l3-own",
              studentId: "stu-alpha",
              schoolId: "school-alpha",
              phoneUsed: "41999991111",
              sentByName: "Gestor Lote 3",
              reasonTitle: "Faltas consecutivas",
              messageContent: "Msg L3 Own",
              guardianReplied: true,
            },
            {
              id: "msg-l3-legacy",
              studentId: "stu-alpha",
              schoolId: null,
              phoneUsed: "41999991111",
              sentByName: "Gestor Lote 3",
              reasonTitle: "Atraso",
              messageContent: "Msg L3 Legacy",
              guardianReplied: false,
            },
            {
              id: "msg-l3-div",
              studentId: "stu-alpha",
              schoolId: "school-beta",
              phoneUsed: "41999991111",
              sentByName: "Intruso Beta",
              reasonTitle: "Faltas",
              messageContent: "Msg L3 Divergente",
              guardianReplied: true,
            },
            {
              id: "msg-l3-cross",
              studentId: "stu-l3-cross",
              schoolId: "school-alpha",
              phoneUsed: "41999990003",
              sentByName: "Cross",
              reasonTitle: "Faltas",
              messageContent: "Msg L3 Cross",
              guardianReplied: true,
            },
            {
              id: "msg-l3-beta",
              studentId: "stu-beta",
              schoolId: "school-beta",
              phoneUsed: "41999992222",
              sentByName: "Beta",
              reasonTitle: "Faltas",
              messageContent: "Msg L3 Beta",
              guardianReplied: true,
            },
          ],
        });

        testAuthState.pendingSessionUser = {
          id: "user-l3-alpha",
          email: "l3-alpha@redeativa.local",
          name: "Gestor Lote 3",
          role: "GESTOR_ESCOLAR",
          schoolId: "school-alpha",
        };

        // 1. GET /api/reports e /relatorios
        tenantCalls.length = 0;
        const rReports = await getReportsHandler(
          new Request("http://127.0.0.1/api/reports?segment=TODOS")
        );
        expect(rReports.status).toBe(200);
        const repBody = await rReports.json();
        expect(repBody.total).toBe(2);
        expect(repBody.replied).toBe(1);
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        tenantCalls.length = 0;
        const relEl = (await RelatoriosPage()) as unknown as {
          props: { initialSummary: { total: number; replied: number } };
        };
        expect(relEl.props.initialSummary.total).toBe(2);
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        // 2. /alunos, /alunos/[id], /alunos/[id]/dossie
        tenantCalls.length = 0;
        const alunosEl = (await AlunosPage()) as unknown as {
          props: { initialStudents: Array<{ id: string }> };
        };
        expect(alunosEl.props.initialStudents.map((s) => s.id)).toEqual(["stu-alpha"]);
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        tenantCalls.length = 0;
        const prontEl = (await ProntuarioPage({
          params: Promise.resolve({ id: "stu-alpha" }),
        })) as unknown as {
          props: { initialStudent: { id: string; messageLogs: Array<{ id: string }> } };
        };
        expect(prontEl.props.initialStudent.id).toBe("stu-alpha");
        expect(prontEl.props.initialStudent.messageLogs.map((m) => m.id).sort()).toEqual([
          "msg-l3-legacy",
          "msg-l3-own",
        ]);
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        await expect(
          ProntuarioPage({ params: Promise.resolve({ id: "stu-beta" }) })
        ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");

        tenantCalls.length = 0;
        const dossieEl = (await DossiePage({
          params: Promise.resolve({ id: "stu-alpha" }),
        })) as unknown as {
          props: { student: { id: string } };
        };
        expect(dossieEl.props.student.id).toBe("stu-alpha");
        expect(tenantCalls).toEqual([{ schoolId: "school-alpha", currentSetting: "school-alpha" }]);

        await expect(
          DossiePage({ params: Promise.resolve({ id: "stu-beta" }) })
        ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");

        // 3. /busca-ativa, /faltas, /historico, /gestao, /visao-geral, /atestados, /encaminhamentos
        tenantCalls.length = 0;
        const buscaEl = (await BuscaAtivaPage({
          searchParams: Promise.resolve({}),
        })) as unknown as {
          props: { initialStudents: Array<{ id: string }> };
        };
        expect(buscaEl.props.initialStudents.map((s) => s.id)).toEqual(["stu-alpha"]);

        const faltasEl = (await FaltasPage()) as unknown as {
          props: { lowAttendance: Array<{ student: { id: string } }> };
        };
        expect(faltasEl.props.lowAttendance.map((r) => r.student.id)).toEqual(["stu-alpha"]);

        const histEl = (await HistoricoPage()) as unknown as {
          props: { initialLogs: Array<{ id: string }>; initialTotal: number };
        };
        expect(histEl.props.initialTotal).toBe(2);
        expect(histEl.props.initialLogs.map((l) => l.id).sort()).toEqual([
          "msg-l3-legacy",
          "msg-l3-own",
        ]);

        const gestaoEl = (await GestaoPage()) as unknown as {
          props: { metrics: { totalStudents: number; totalClasses: number; messagesThisMonth: number } };
        };
        expect(gestaoEl.props.metrics.totalStudents).toBe(1);
        expect(gestaoEl.props.metrics.totalClasses).toBe(1);
        expect(gestaoEl.props.metrics.messagesThisMonth).toBe(2);

        await VisaoGeralPage();

        const atestadosEl = (await AtestadosPage()) as unknown as {
          props: { initialMetrics: { total: number } };
        };
        expect(atestadosEl.props.initialMetrics.total).toBe(1);

        await EncaminhamentosPage();

        expect(tenantCalls.length).toBeGreaterThanOrEqual(7);
        expect(tenantCalls.every((c) => c.schoolId === "school-alpha" && c.currentSetting === "school-alpha")).toBe(true);

        // 4. Vínculo revogado -> 403 na API e redirect nas páginas sem abrir withTenantContext
        await prisma.userSchool.update({
          where: { id: "us-l3-alpha" },
          data: { active: false },
        });
        tenantCalls.length = 0;
        const rRevokedReports = await getReportsHandler(
          new Request("http://127.0.0.1/api/reports?segment=TODOS")
        );
        expect(rRevokedReports.status).toBe(403);
        await expect(AlunosPage()).rejects.toThrow("NEXT_REDIRECT");
        expect(tenantCalls).toHaveLength(0);
      } finally {
        await prisma.userSchool.deleteMany({ where: { id: { in: ["us-l3-alpha"] } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: ["user-l3-alpha"] } } }).catch(() => {});
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("isola Justificativas e Atas (/api/justifications/**, /api/atas/**, /atas/** e executeMinuteFinalization) com withTenantContext", async () => {
      const rlsTenantModule = await import("@/lib/rlsTenantContext");
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenantContext = rlsTenantModule.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantModule, "withTenantContext")
        .mockImplementation(async (client: any, schoolId: string, fn: any) => {
          return originalWithTenantContext(client, schoolId, async (tx: any) => {
            const rows = await tx.$queryRaw<Array<{ current_school_id: string | null }>>`
              SELECT current_setting('app.current_school_id', true) AS current_school_id
            `;
            tenantCalls.push({
              schoolId,
              currentSetting: rows[0]?.current_school_id ?? null,
            });
            return fn(tx);
          });
        });

      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevUseRealPermissions = testAuthState.useRealPermissions;
      let createdBetaJustificationId: string | null = null;
      let createdBetaMinuteId: string | null = null;
      let createdAlphaMinuteId: string | null = null;

      try {
        testAuthState.useRealCurrentSchool = true;
        testAuthState.useRealPermissions = true;

        const { hashPin } = await import("@/lib/signingPin");
        const pinHash = await hashPin("4829");

        await prisma.user.create({
          data: {
            id: "user-l4-alpha",
            email: "l4-alpha@escola-alpha.local",
            name: "Pedagoga L4 Alpha",
            role: "PEDAGOGA",
            active: true,
            schoolId: "school-alpha",
            signingPinHash: pinHash,
          },
        });
        await prisma.userSchool.create({
          data: {
            id: "us-l4-alpha",
            userId: "user-l4-alpha",
            schoolId: "school-alpha",
            role: "PEDAGOGA",
            active: true,
          },
        });

        const betaStudent = await prisma.student.findFirst({
          where: { schoolId: "school-beta", active: true },
          select: { id: true },
        });
        const alphaStudent = await prisma.student.findFirst({
          where: { schoolId: "school-alpha", active: true },
          select: { id: true },
        });
        expect(betaStudent?.id).toBeTruthy();
        expect(alphaStudent?.id).toBeTruthy();

        const createdBetaJust = await prisma.absenceJustification.create({
          data: {
            studentId: betaStudent!.id,
            type: "ATESTADO_MEDICO",
            startDate: new Date("2026-04-10T00:00:00.000-03:00"),
            endDate: new Date("2026-04-11T23:59:59.999-03:00"),
            notes: "Atestado sintetico beta L4",
            createdByName: "Equipe Beta",
            createdByEmail: "beta@escola-beta.local",
          },
        });
        createdBetaJustificationId = createdBetaJust.id;

        const createdBetaMin = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: "school-beta",
            year: 2026,
            status: "DRAFT",
            contentRevision: 1,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            attendedAt: new Date("2026-04-10T10:00:00.000-03:00"),
            subject: "Ata Beta L4",
            summary: "Resumo sintetico da escola beta",
            authorId: "user-beta-l4",
            authorName: "Equipe Beta",
            authorEmail: "beta@escola-beta.local",
            authorRole: "PEDAGOGA",
            students: {
              create: [
                {
                  studentId: betaStudent!.id,
                  studentNameSnapshot: "Aluno Beta",
                },
              ],
            },
          },
        });
        createdBetaMinuteId = createdBetaMin.id;

        testAuthState.pendingSessionUser = {
          id: "user-l4-alpha",
          email: "l4-alpha@escola-alpha.local",
          name: "Pedagoga L4 Alpha",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
        };

        const { GET: getJustificationsHandler, POST: postJustificationsHandler } = await import(
          "@/app/api/justifications/route"
        );
        const { DELETE: deleteJustificationHandler } = await import(
          "@/app/api/justifications/[id]/route"
        );
        const { GET: getAtasHandler, POST: postAtasHandler } = await import(
          "@/app/api/atas/route"
        );
        const {
          GET: getAtaByIdHandler,
          PATCH: patchAtaByIdHandler,
          DELETE: deleteAtaByIdHandler,
        } = await import("@/app/api/atas/[id]/route");
        const { POST: finalizeAtaHandler } = await import("@/app/api/atas/[id]/finalize/route");
        const { GET: getAtaActionsHandler } = await import("@/app/api/atas/actions/route");
        const { GET: getAtaAlertsHandler } = await import("@/app/api/atas/actions/alerts/route");
        const { GET: getCandidatesHandler } = await import(
          "@/app/api/atas/participant-candidates/route"
        );
        const { default: AtasPage } = await import("@/app/atas/page");

        // 1. Justificativas: cria em alpha, lista apenas alpha, deleta em alpha e bloqueia beta (403)
        tenantCalls.length = 0;
        const rPostJustAlpha = await postJustificationsHandler(
          new Request("http://127.0.0.1/api/justifications", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              studentId: alphaStudent!.id,
              type: "ATESTADO_MEDICO",
              startDate: "2026-04-12",
              endDate: "2026-04-13",
              notes: "Atestado alpha L4",
            }),
          })
        );
        expect(rPostJustAlpha.status).toBe(200);
        const jPostJustAlpha = await rPostJustAlpha.json();
        const createdAlphaJustId = jPostJustAlpha.justification.id as string;

        const rGetJustAlpha = await getJustificationsHandler(
          new Request("http://127.0.0.1/api/justifications")
        );
        expect(rGetJustAlpha.status).toBe(200);
        const jGetJustAlpha = await rGetJustAlpha.json();
        expect(
          jGetJustAlpha.justifications.some((j: any) => j.id === createdBetaJustificationId)
        ).toBe(false);
        expect(
          jGetJustAlpha.justifications.some((j: any) => j.id === createdAlphaJustId)
        ).toBe(true);

        const rPostJustCross = await postJustificationsHandler(
          new Request("http://127.0.0.1/api/justifications", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              studentId: betaStudent!.id,
              type: "ATESTADO_MEDICO",
              startDate: "2026-04-12",
              endDate: "2026-04-13",
            }),
          })
        );
        expect(rPostJustCross.status).toBe(403);

        const rDelJustCross = await deleteJustificationHandler(
          new Request(`http://127.0.0.1/api/justifications/${createdBetaJustificationId}`, {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: createdBetaJustificationId }) }
        );
        expect(rDelJustCross.status).toBe(403);

        const rDelJustAlpha = await deleteJustificationHandler(
          new Request(`http://127.0.0.1/api/justifications/${createdAlphaJustId}`, {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: createdAlphaJustId }) }
        );
        expect(rDelJustAlpha.status).toBe(200);

        // 2. Atas: cria rascunho em alpha, bloqueia studentId de beta, edita, finaliza e lê ações/alertas/candidatos/SSR
        const rPostAtaCross = await postAtasHandler(
          new Request("http://127.0.0.1/api/atas", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Tentativa Cruzada",
              studentIds: [betaStudent!.id],
            }),
          })
        );
        expect(rPostAtaCross.status).toBe(400);

        const rPostAtaAlpha = await postAtasHandler(
          new Request("http://127.0.0.1/api/atas", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Atendimento Alpha L4",
              attendedAt: new Date().toISOString(),
              summary: "Texto oficial sintético com mais de cinquenta caracteres para validação completa do fluxo de lavratura.",
              studentIds: [alphaStudent!.id],
              participants: [
                {
                  role: "SERVIDOR",
                  name: "Pedagoga L4 Alpha",
                },
              ],
              actionItems: [
                {
                  description: "Acompanhar frequência semanalmente",
                  responsible: "ESCOLA",
                },
              ],
            }),
          })
        );
        expect(rPostAtaAlpha.status).toBe(201);
        const jPostAtaAlpha = await rPostAtaAlpha.json();
        createdAlphaMinuteId = jPostAtaAlpha.minute.id as string;

        const rPatchAtaAlpha = await patchAtaByIdHandler(
          new Request(`http://127.0.0.1/api/atas/${createdAlphaMinuteId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              subject: "Atendimento Alpha L4 Atualizado",
            }),
          }),
          { params: Promise.resolve({ id: createdAlphaMinuteId }) }
        );
        expect(rPatchAtaAlpha.status).toBe(200);

        const rFinalizeAlpha = await finalizeAtaHandler(
          new Request(`http://127.0.0.1/api/atas/${createdAlphaMinuteId}/finalize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              signingPin: "4829",
              expectedRevision: 2,
            }),
          }),
          { params: Promise.resolve({ id: createdAlphaMinuteId }) }
        );
        expect(rFinalizeAlpha.status).toBe(200);

        // Bloqueios cross-tenant em [id] e participant-candidates
        const rGetAtaCross = await getAtaByIdHandler(
          new Request(`http://127.0.0.1/api/atas/${createdBetaMinuteId}`),
          { params: Promise.resolve({ id: createdBetaMinuteId }) }
        );
        expect(rGetAtaCross.status).toBe(403);

        const rPatchAtaCross = await patchAtaByIdHandler(
          new Request(`http://127.0.0.1/api/atas/${createdBetaMinuteId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subject: "Invasao" }),
          }),
          { params: Promise.resolve({ id: createdBetaMinuteId }) }
        );
        expect(rPatchAtaCross.status).toBe(403);

        const rDelAtaCross = await deleteAtaByIdHandler(
          new Request(`http://127.0.0.1/api/atas/${createdBetaMinuteId}`, {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: createdBetaMinuteId }) }
        );
        expect(rDelAtaCross.status).toBe(403);

        const rCandCrossMinute = await getCandidatesHandler(
          new Request(
            `http://127.0.0.1/api/atas/participant-candidates?minuteId=${createdBetaMinuteId}`
          )
        );
        expect(rCandCrossMinute.status).toBe(403);

        const rCandCrossStudent = await getCandidatesHandler(
          new Request(
            `http://127.0.0.1/api/atas/participant-candidates?part=contacts&studentIds=${betaStudent!.id}`
          )
        );
        expect(rCandCrossStudent.status).toBe(403);

        const rGetAtasAlpha = await getAtasHandler(new Request("http://127.0.0.1/api/atas"));
        expect(rGetAtasAlpha.status).toBe(200);
        const rGetActionsAlpha = await getAtaActionsHandler(
          new Request("http://127.0.0.1/api/atas/actions")
        );
        expect(rGetActionsAlpha.status).toBe(200);
        const rGetAlertsAlpha = await getAtaAlertsHandler(
          new Request("http://127.0.0.1/api/atas/actions/alerts")
        );
        expect(rGetAlertsAlpha.status).toBe(200);
        const rCandAlpha = await getCandidatesHandler(
          new Request(
            `http://127.0.0.1/api/atas/participant-candidates?minuteId=${createdAlphaMinuteId}&studentIds=${alphaStudent!.id}`
          )
        );
        expect(rCandAlpha.status).toBe(200);
        await expect(AtasPage({})).resolves.toBeTruthy();

        expect(tenantCalls.length).toBeGreaterThanOrEqual(12);
        expect(
          tenantCalls.every(
            (c) => c.schoolId === "school-alpha" && c.currentSetting === "school-alpha"
          )
        ).toBe(true);

        // 3. Vínculo revogado -> 403 antes de abrir withTenantContext
        await prisma.userSchool.update({
          where: { id: "us-l4-alpha" },
          data: { active: false },
        });
        tenantCalls.length = 0;
        const rRevokedAtas = await getAtasHandler(new Request("http://127.0.0.1/api/atas"));
        expect(rRevokedAtas.status).toBe(403);
        const rRevokedJust = await getJustificationsHandler(
          new Request("http://127.0.0.1/api/justifications")
        );
        expect(rRevokedJust.status).toBe(403);
        expect(tenantCalls).toHaveLength(0);
      } finally {
        if (createdAlphaMinuteId) {
          await prisma.pedagogicalMinute
            .deleteMany({ where: { id: createdAlphaMinuteId } })
            .catch(() => {});
        }
        if (createdBetaMinuteId) {
          await prisma.pedagogicalMinute
            .deleteMany({ where: { id: createdBetaMinuteId } })
            .catch(() => {});
        }
        if (createdBetaJustificationId) {
          await prisma.absenceJustification
            .deleteMany({ where: { id: createdBetaJustificationId } })
            .catch(() => {});
        }
        await prisma.userSchool.deleteMany({ where: { id: { in: ["us-l4-alpha"] } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: ["user-l4-alpha"] } } }).catch(() => {});
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("bloqueia SUPERADMIN com escola A selecionada ao usar IDs de escola B em Justificativas e Atas e preserva fluxos legítimos de A e B", async () => {
      const rlsTenantModule = await import("@/lib/rlsTenantContext");
      const tenantCalls: Array<{ schoolId: string; currentSetting: string | null }> = [];
      const originalWithTenantContext = rlsTenantModule.withTenantContext;
      const withTenantSpy = vi
        .spyOn(rlsTenantModule, "withTenantContext")
        .mockImplementation(async (client: any, schoolId: string, fn: any, options?: any) => {
          return originalWithTenantContext(
            client,
            schoolId,
            async (tx: any) => {
              const rows = await tx.$queryRaw<Array<{ current_school_id: string | null }>>`
                SELECT current_setting('app.current_school_id', true) AS current_school_id
              `;
              tenantCalls.push({
                schoolId,
                currentSetting: rows[0]?.current_school_id ?? null,
              });
              return fn(tx);
            },
            options
          );
        });

      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const createdIds: {
        justIds: string[];
        minuteIds: string[];
        studentIds: string[];
      } = { justIds: [], minuteIds: [], studentIds: [] };

      try {
        testAuthState.useRealCurrentSchool = true;
        testAuthState.useRealPermissions = true;

        const { hashPin } = await import("@/lib/signingPin");
        const pinHash = await hashPin("4829");

        await prisma.user.create({
          data: {
            id: "user-super-l4-strict",
            email: "super-l4@redeativa.local",
            name: "SuperAdmin L4",
            role: "SUPERADMIN",
            active: true,
            schoolId: "school-alpha",
            signingPinHash: pinHash,
          },
        });

        const alphaStudent = await prisma.student.findFirst({
          where: { schoolId: "school-alpha", active: true },
          select: { id: true, classGroupId: true },
        });
        const betaStudent = await prisma.student.findFirst({
          where: { schoolId: "school-beta", active: true },
          select: { id: true, classGroupId: true },
        });
        const betaClass = await prisma.classGroup.findFirst({
          where: { schoolId: "school-beta" },
          select: { id: true },
        });
        expect(alphaStudent?.id).toBeTruthy();
        expect(betaStudent?.id).toBeTruthy();
        expect(betaClass?.id).toBeTruthy();

        // Estudante pertencente a school-alpha mas com turma cruzada em school-beta
        const crossClassStudent = await prisma.student.create({
          data: {
            name: "Aluno Alpha Turma Beta L4",
            cgm: `CGM-L4-${Date.now()}`,
            phone: "42999998888",
            schoolId: "school-alpha",
            classGroupId: betaClass!.id,
            active: true,
          },
        });
        createdIds.studentIds.push(crossClassStudent.id);

        const crossClassJust = await prisma.absenceJustification.create({
          data: {
            studentId: crossClassStudent.id,
            type: "ATESTADO_MEDICO",
            startDate: new Date("2026-04-10T00:00:00.000-03:00"),
            endDate: new Date("2026-04-11T23:59:59.999-03:00"),
            notes: "Justificativa turma cruzada",
            createdByName: "Equipe",
            createdByEmail: "super-l4@redeativa.local",
          },
        });
        createdIds.justIds.push(crossClassJust.id);

        const betaJust = await prisma.absenceJustification.create({
          data: {
            studentId: betaStudent!.id,
            type: "ATESTADO_MEDICO",
            startDate: new Date("2026-04-10T00:00:00.000-03:00"),
            endDate: new Date("2026-04-11T23:59:59.999-03:00"),
            notes: "Justificativa sigilosa beta",
            createdByName: "Equipe Beta",
            createdByEmail: "beta@escola-beta.local",
          },
        });
        createdIds.justIds.push(betaJust.id);

        const betaDraftMinute = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: "school-beta",
            year: 2026,
            status: "DRAFT",
            contentRevision: 1,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            attendedAt: new Date(),
            subject: "Assunto Secreto Beta Draft",
            summary:
              "Resumo sigiloso da escola beta com mais de cinquenta caracteres para validação estrita.",
            authorId: "user-beta-owner",
            authorName: "Autor Beta",
            authorEmail: "autor@escola-beta.local",
            authorRole: "PEDAGOGA",
            students: {
              create: [{ studentId: betaStudent!.id, studentNameSnapshot: "Aluno Beta" }],
            },
            participants: {
              create: [{ role: "SERVIDOR", name: "Autor Beta" }],
            },
          },
          include: { participants: true },
        });
        createdIds.minuteIds.push(betaDraftMinute.id);

        // Ata FINALIZED legada sem verificationCode em beta para provar que GET /api/atas/[id] não gera efeito colateral
        const betaLegacyFinalized = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: "school-beta",
            year: 2026,
            ataNumber: 901,
            status: "FINALIZED",
            contentRevision: 1,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            attendedAt: new Date(),
            subject: "Ata Finalizada Beta Legada",
            summary:
              "Resumo finalizado da escola beta com mais de cinquenta caracteres para validação de legado.",
            authorId: "user-beta-owner",
            authorName: "Autor Beta",
            authorEmail: "autor@escola-beta.local",
            authorRole: "PEDAGOGA",
            verificationCode: null,
            students: {
              create: [{ studentId: betaStudent!.id, studentNameSnapshot: "Aluno Beta" }],
            },
          },
        });
        createdIds.minuteIds.push(betaLegacyFinalized.id);

        testAuthState.pendingSessionUser = {
          id: "user-super-l4-strict",
          email: "super-l4@redeativa.local",
          name: "SuperAdmin L4",
          role: "SUPERADMIN",
          schoolId: "school-alpha",
        };

        const { GET: getJust, POST: postJust } = await import("@/app/api/justifications/route");
        const { DELETE: delJust } = await import("@/app/api/justifications/[id]/route");
        const { POST: postAta } = await import("@/app/api/atas/route");
        const {
          GET: getAta,
          PATCH: patchAta,
          DELETE: delAta,
        } = await import("@/app/api/atas/[id]/route");
        const { POST: finalizeAta } = await import("@/app/api/atas/[id]/finalize/route");
        const { POST: reopenAta } = await import("@/app/api/atas/[id]/reopen/route");
        const { POST: signScreenAta } = await import("@/app/api/atas/[id]/sign-screen/route");
        const { GET: pdfaAta } = await import("@/app/api/atas/[id]/pdfa/route");
        const { GET: getCandidates } = await import(
          "@/app/api/atas/participant-candidates/route"
        );
        const { POST: formalizeAta } = await import("@/app/api/ai/formalize-ata/route");

        const auditBefore = await prisma.auditLog.count();

        // 1. SUPERADMIN com school-alpha selecionada tenta acessar/mutar IDs de school-beta e turma cruzada
        const rGetJust = await getJust(new Request("http://127.0.0.1/api/justifications"));
        expect(rGetJust.status).toBe(200);
        const jGetJust = await rGetJust.json();
        expect(jGetJust.justifications.some((j: any) => j.id === crossClassJust.id)).toBe(false);
        expect(jGetJust.justifications.some((j: any) => j.id === betaJust.id)).toBe(false);

        const rPostJustBeta = await postJust(
          new Request("http://127.0.0.1/api/justifications", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              studentId: betaStudent!.id,
              type: "ATESTADO_MEDICO",
              startDate: "2026-04-12",
              endDate: "2026-04-13",
            }),
          })
        );
        expect(rPostJustBeta.status).toBe(403);

        const rPostJustCrossClass = await postJust(
          new Request("http://127.0.0.1/api/justifications", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              studentId: crossClassStudent.id,
              type: "ATESTADO_MEDICO",
              startDate: "2026-04-12",
              endDate: "2026-04-13",
            }),
          })
        );
        expect(rPostJustCrossClass.status).toBe(403);

        const rDelJustBeta = await delJust(
          new Request(`http://127.0.0.1/api/justifications/${betaJust.id}`, { method: "DELETE" }),
          { params: Promise.resolve({ id: betaJust.id }) }
        );
        expect(rDelJustBeta.status).toBe(403);

        const rDelJustCrossClass = await delJust(
          new Request(`http://127.0.0.1/api/justifications/${crossClassJust.id}`, {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: crossClassJust.id }) }
        );
        expect(rDelJustCrossClass.status).toBe(403);

        const rGetAtaPoll = await getAta(
          new Request(`http://127.0.0.1/api/atas/${betaDraftMinute.id}?poll=1`),
          { params: Promise.resolve({ id: betaDraftMinute.id }) }
        );
        expect(rGetAtaPoll.status).toBe(403);

        const rGetAtaLegacy = await getAta(
          new Request(`http://127.0.0.1/api/atas/${betaLegacyFinalized.id}`),
          { params: Promise.resolve({ id: betaLegacyFinalized.id }) }
        );
        expect(rGetAtaLegacy.status).toBe(403);
        const bodyGetLegacy = await rGetAtaLegacy.text();
        expect(bodyGetLegacy).not.toContain("Ata Finalizada Beta Legada");

        const rPatchBeta = await patchAta(
          new Request(`http://127.0.0.1/api/atas/${betaDraftMinute.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subject: "Alterado por SuperAdmin A" }),
          }),
          { params: Promise.resolve({ id: betaDraftMinute.id }) }
        );
        expect(rPatchBeta.status).toBe(403);

        const rDelBeta = await delAta(
          new Request(`http://127.0.0.1/api/atas/${betaDraftMinute.id}`, { method: "DELETE" }),
          { params: Promise.resolve({ id: betaDraftMinute.id }) }
        );
        expect(rDelBeta.status).toBe(403);

        const rFinBeta = await finalizeAta(
          new Request(`http://127.0.0.1/api/atas/${betaDraftMinute.id}/finalize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signingPin: "4829" }),
          }),
          { params: Promise.resolve({ id: betaDraftMinute.id }) }
        );
        expect(rFinBeta.status).toBe(403);

        const rReopenBeta = await reopenAta(
          new Request(`http://127.0.0.1/api/atas/${betaDraftMinute.id}/reopen`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
          }),
          { params: Promise.resolve({ id: betaDraftMinute.id }) }
        );
        expect(rReopenBeta.status).toBe(403);

        const rSignBeta = await signScreenAta(
          new Request(`http://127.0.0.1/api/atas/${betaDraftMinute.id}/sign-screen`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              participantId: betaDraftMinute.participants[0].id,
              expectedRevision: 1,
              signatureData:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            }),
          }),
          { params: Promise.resolve({ id: betaDraftMinute.id }) }
        );
        expect(rSignBeta.status).toBe(403);

        const rPdfaBeta = await pdfaAta(
          new Request(`http://127.0.0.1/api/atas/${betaLegacyFinalized.id}/pdfa`),
          { params: Promise.resolve({ id: betaLegacyFinalized.id }) }
        );
        expect(rPdfaBeta.status).toBe(403);

        const rCandBeta = await getCandidates(
          new Request(
            `http://127.0.0.1/api/atas/participant-candidates?minuteId=${betaDraftMinute.id}`
          )
        );
        expect(rCandBeta.status).toBe(403);

        const rFormalizeBeta = await formalizeAta(
          new Request("http://127.0.0.1/api/ai/formalize-ata", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              minuteId: betaDraftMinute.id,
              rawNotes: "Notas sintéticas de teste",
            }),
          })
        );
        expect([403, 404]).toContain(rFormalizeBeta.status);

        // Confirma nenhuma mutação, nenhum verificationCode gerado e nenhum AuditLog de sucesso
        const betaDraftAfter = await prisma.pedagogicalMinute.findUnique({
          where: { id: betaDraftMinute.id },
        });
        expect(betaDraftAfter?.status).toBe("DRAFT");
        expect(betaDraftAfter?.subject).toBe("Assunto Secreto Beta Draft");
        const betaLegacyAfter = await prisma.pedagogicalMinute.findUnique({
          where: { id: betaLegacyFinalized.id },
        });
        expect(betaLegacyAfter?.verificationCode).toBeNull();
        const betaJustAfter = await prisma.absenceJustification.findUnique({
          where: { id: betaJust.id },
        });
        expect(betaJustAfter).not.toBeNull();
        const auditAfterRejects = await prisma.auditLog.count();
        expect(auditAfterRejects).toBe(auditBefore);

        // 2. Caminho legítimo em A (school-alpha selecionada)
        tenantCalls.length = 0;
        const rPostAtaAlpha = await postAta(
          new Request("http://127.0.0.1/api/atas", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Ata Legitima SuperAdmin Alpha",
              attendedAt: new Date().toISOString(),
              summary:
                "Texto oficial sintético com mais de cinquenta caracteres para validação de lavratura em Alpha.",
              studentIds: [alphaStudent!.id],
              participants: [{ role: "SERVIDOR", name: "SuperAdmin L4" }],
            }),
          })
        );
        expect(rPostAtaAlpha.status).toBe(201);
        const alphaMinuteId = (await rPostAtaAlpha.json()).minute.id as string;
        createdIds.minuteIds.push(alphaMinuteId);

        const rFinAlpha = await finalizeAta(
          new Request(`http://127.0.0.1/api/atas/${alphaMinuteId}/finalize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signingPin: "4829", expectedRevision: 1 }),
          }),
          { params: Promise.resolve({ id: alphaMinuteId }) }
        );
        expect(rFinAlpha.status).toBe(200);
        expect(
          tenantCalls.every(
            (c) => c.schoolId === "school-alpha" && c.currentSetting === "school-alpha"
          )
        ).toBe(true);

        // 3. Troca explícita de seleção para school-beta -> caminhos legítimos de B funcionam com app.current_school_id = school-beta
        await prisma.user.update({
          where: { id: "user-super-l4-strict" },
          data: { schoolId: "school-beta" },
        });
        testAuthState.pendingSessionUser = {
          id: "user-super-l4-strict",
          email: "super-l4@redeativa.local",
          name: "SuperAdmin L4",
          role: "SUPERADMIN",
          schoolId: "school-beta",
        };
        tenantCalls.length = 0;

        const rFinBetaAllowed = await finalizeAta(
          new Request(`http://127.0.0.1/api/atas/${betaDraftMinute.id}/finalize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signingPin: "4829", expectedRevision: 1 }),
          }),
          { params: Promise.resolve({ id: betaDraftMinute.id }) }
        );
        expect(rFinBetaAllowed.status).toBe(200);

        const rDelJustBetaAllowed = await delJust(
          new Request(`http://127.0.0.1/api/justifications/${betaJust.id}`, { method: "DELETE" }),
          { params: Promise.resolve({ id: betaJust.id }) }
        );
        expect(rDelJustBetaAllowed.status).toBe(200);
        expect(
          tenantCalls.every(
            (c) => c.schoolId === "school-beta" && c.currentSetting === "school-beta"
          )
        ).toBe(true);
      } finally {
        for (const mId of createdIds.minuteIds) {
          await prisma.pedagogicalMinute.deleteMany({ where: { id: mId } }).catch(() => {});
        }
        for (const jId of createdIds.justIds) {
          await prisma.absenceJustification.deleteMany({ where: { id: jId } }).catch(() => {});
        }
        for (const sId of createdIds.studentIds) {
          await prisma.student.deleteMany({ where: { id: sId } }).catch(() => {});
        }
        await prisma.auditLog
          .deleteMany({ where: { userEmail: "super-l4@redeativa.local" } })
          .catch(() => {});
        await prisma.user
          .deleteMany({ where: { id: { in: ["user-super-l4-strict"] } } })
          .catch(() => {});
        withTenantSpy.mockRestore();
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("exige seleção explícita de SUPERADMIN nas mutações/efeitos GET e recusa reopen/sign-screen sem esperar quando lock de escola B está ocupado", async () => {
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevUseRealPermissions = testAuthState.useRealPermissions;
      let alphaMinId: string | null = null;
      let alphaLegacyId: string | null = null;
      let alphaJustId: string | null = null;
      let betaMinId: string | null = null;

      try {
        testAuthState.useRealCurrentSchool = true;
        testAuthState.useRealPermissions = true;

        const { hashPin } = await import("@/lib/signingPin");
        const { acquireMinuteWriteLock } = await import("@/lib/minuteLock");
        const pinHash = await hashPin("4829");

        // SUPERADMIN com vínculo ativo em school-alpha (UserSchool), mas SEM schoolId no perfil e SEM cookie active_school_id
        await prisma.user.create({
          data: {
            id: "user-super-no-sel",
            email: "super-nosel@redeativa.local",
            name: "SuperAdmin Sem Seleção",
            role: "SUPERADMIN",
            active: true,
            schoolId: null,
            signingPinHash: pinHash,
          },
        });
        await prisma.userSchool.create({
          data: {
            id: "us-super-no-sel-alpha",
            userId: "user-super-no-sel",
            schoolId: "school-alpha",
            role: "SUPERADMIN",
            active: true,
          },
        });

        const alphaStudent = await prisma.student.findFirst({
          where: { schoolId: "school-alpha", active: true },
          select: { id: true },
        });
        const betaStudent = await prisma.student.findFirst({
          where: { schoolId: "school-beta", active: true },
          select: { id: true },
        });
        expect(alphaStudent?.id).toBeTruthy();
        expect(betaStudent?.id).toBeTruthy();

        const alphaJust = await prisma.absenceJustification.create({
          data: {
            studentId: alphaStudent!.id,
            type: "ATESTADO_MEDICO",
            startDate: new Date("2026-04-10T00:00:00.000-03:00"),
            endDate: new Date("2026-04-11T23:59:59.999-03:00"),
            notes: "Justificativa Alpha",
            createdByName: "Equipe",
            createdByEmail: "super-nosel@redeativa.local",
          },
        });
        alphaJustId = alphaJust.id;

        const alphaMin = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: "school-alpha",
            year: 2026,
            status: "DRAFT",
            contentRevision: 1,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            attendedAt: new Date(),
            subject: "Ata Alpha Sem Selecao",
            summary:
              "Resumo oficial da ata em Alpha com mais de cinquenta caracteres para teste de seleção explícita.",
            authorId: "user-super-no-sel",
            authorName: "SuperAdmin Sem Seleção",
            authorEmail: "super-nosel@redeativa.local",
            authorRole: "SUPERADMIN",
            students: {
              create: [{ studentId: alphaStudent!.id, studentNameSnapshot: "Aluno Alpha" }],
            },
            participants: {
              create: [{ role: "SERVIDOR", name: "SuperAdmin Sem Seleção" }],
            },
          },
          include: { participants: true },
        });
        alphaMinId = alphaMin.id;

        const alphaLegacy = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: "school-alpha",
            year: 2026,
            ataNumber: 902,
            status: "FINALIZED",
            contentRevision: 1,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            attendedAt: new Date(),
            subject: "Ata Finalizada Alpha Legada",
            summary:
              "Resumo finalizado em Alpha com mais de cinquenta caracteres para validar GET sem escrita implícita.",
            authorId: "user-super-no-sel",
            authorName: "SuperAdmin Sem Seleção",
            authorEmail: "super-nosel@redeativa.local",
            authorRole: "SUPERADMIN",
            verificationCode: null,
          },
        });
        alphaLegacyId = alphaLegacy.id;

        const betaMin = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: "school-beta",
            year: 2026,
            status: "DRAFT",
            contentRevision: 1,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            attendedAt: new Date(),
            subject: "Ata Beta Lock Test",
            summary:
              "Resumo da escola beta com mais de cinquenta caracteres para teste determinístico de lock ocupado.",
            authorId: "user-beta-owner",
            authorName: "Autor Beta",
            authorEmail: "autor@escola-beta.local",
            authorRole: "PEDAGOGA",
            students: {
              create: [{ studentId: betaStudent!.id, studentNameSnapshot: "Aluno Beta" }],
            },
            participants: {
              create: [{ role: "SERVIDOR", name: "Autor Beta" }],
            },
          },
          include: { participants: true },
        });
        betaMinId = betaMin.id;

        testAuthState.pendingSessionUser = {
          id: "user-super-no-sel",
          email: "super-nosel@redeativa.local",
          name: "SuperAdmin Sem Seleção",
          role: "SUPERADMIN",
          schoolId: null,
        };

        const { POST: postJust } = await import("@/app/api/justifications/route");
        const { DELETE: delJust } = await import("@/app/api/justifications/[id]/route");
        const { GET: getAtas, POST: postAta } = await import("@/app/api/atas/route");
        const {
          GET: getAta,
          PATCH: patchAta,
          DELETE: delAta,
        } = await import("@/app/api/atas/[id]/route");
        const { POST: finalizeAta } = await import("@/app/api/atas/[id]/finalize/route");
        const { POST: reopenAta } = await import("@/app/api/atas/[id]/reopen/route");
        const { POST: signScreenAta } = await import("@/app/api/atas/[id]/sign-screen/route");
        const { POST: formalizeAta } = await import("@/app/api/ai/formalize-ata/route");

        const auditBefore = await prisma.auditLog.count();

        // 1. Todas as mutações retornam 403 mesmo com vínculo ativo em A (sem cookie e sem schoolId no perfil)
        expect(
          (
            await postJust(
              new Request("http://127.0.0.1/api/justifications", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  studentId: alphaStudent!.id,
                  type: "ATESTADO_MEDICO",
                  startDate: "2026-04-12",
                  endDate: "2026-04-13",
                }),
              })
            )
          ).status
        ).toBe(403);

        expect(
          (
            await delJust(
              new Request(`http://127.0.0.1/api/justifications/${alphaJust.id}`, {
                method: "DELETE",
              }),
              { params: Promise.resolve({ id: alphaJust.id }) }
            )
          ).status
        ).toBe(403);

        expect(
          (
            await postAta(
              new Request("http://127.0.0.1/api/atas", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  subject: "Tentativa Sem Seleção",
                  studentIds: [alphaStudent!.id],
                }),
              })
            )
          ).status
        ).toBe(403);

        expect(
          (
            await patchAta(
              new Request(`http://127.0.0.1/api/atas/${alphaMin.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ subject: "Tentativa" }),
              }),
              { params: Promise.resolve({ id: alphaMin.id }) }
            )
          ).status
        ).toBe(403);

        expect(
          (
            await delAta(
              new Request(`http://127.0.0.1/api/atas/${alphaMin.id}`, { method: "DELETE" }),
              { params: Promise.resolve({ id: alphaMin.id }) }
            )
          ).status
        ).toBe(403);

        expect(
          (
            await finalizeAta(
              new Request(`http://127.0.0.1/api/atas/${alphaMin.id}/finalize`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ signingPin: "4829" }),
              }),
              { params: Promise.resolve({ id: alphaMin.id }) }
            )
          ).status
        ).toBe(403);

        expect(
          (
            await reopenAta(
              new Request(`http://127.0.0.1/api/atas/${alphaMin.id}/reopen`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
              }),
              { params: Promise.resolve({ id: alphaMin.id }) }
            )
          ).status
        ).toBe(403);

        expect(
          (
            await signScreenAta(
              new Request(`http://127.0.0.1/api/atas/${alphaMin.id}/sign-screen`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  participantId: alphaMin.participants[0].id,
                  expectedRevision: 1,
                  signatureData:
                    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                }),
              }),
              { params: Promise.resolve({ id: alphaMin.id }) }
            )
          ).status
        ).toBe(403);

        expect(
          (
            await formalizeAta(
              new Request("http://127.0.0.1/api/ai/formalize-ata", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  minuteId: alphaMin.id,
                  rawNotes: "Anotação sintética",
                }),
              })
            )
          ).status
        ).toBe(403);

        // 2. Leituras via fallback preservadas, mas sem efeito de escrita (verificationCode continua null)
        const rGetList = await getAtas(new Request("http://127.0.0.1/api/atas"));
        expect(rGetList.status).toBe(200);
        const rGetSingle = await getAta(
          new Request(`http://127.0.0.1/api/atas/${alphaLegacy.id}`),
          { params: Promise.resolve({ id: alphaLegacy.id }) }
        );
        expect(rGetSingle.status).toBe(200);
        const legacyAfterGet = await prisma.pedagogicalMinute.findUnique({
          where: { id: alphaLegacy.id },
          select: { verificationCode: true },
        });
        expect(legacyAfterGet?.verificationCode).toBeNull();
        expect(await prisma.auditLog.count()).toBe(auditBefore);

        // 3. Seleciona explicitamente school-alpha e mantém lock de B ocupado em conexão separada:
        //    reopen e sign-screen para ata de B recusam com 403 imediatamente enquanto o lock de B está ocupado
        await prisma.user.update({
          where: { id: "user-super-no-sel" },
          data: { schoolId: "school-alpha" },
        });
        testAuthState.pendingSessionUser = {
          id: "user-super-no-sel",
          email: "super-nosel@redeativa.local",
          name: "SuperAdmin Sem Seleção",
          role: "SUPERADMIN",
          schoolId: "school-alpha",
        };

        let resolveLockAcquired!: () => void;
        const lockAcquired = new Promise<void>((res) => {
          resolveLockAcquired = res;
        });
        let releaseLock!: () => void;
        const waitReleaseLock = new Promise<void>((res) => {
          releaseLock = res;
        });

        const lockHolderTx = prisma.$transaction(
          async (tx) => {
            await acquireMinuteWriteLock(tx, betaMin.id);
            resolveLockAcquired();
            await waitReleaseLock;
          },
          { maxWait: 5000, timeout: 10000 }
        );

        await lockAcquired;
        try {
          const rReopenWhileLocked = await reopenAta(
            new Request(`http://127.0.0.1/api/atas/${betaMin.id}/reopen`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
            }),
            { params: Promise.resolve({ id: betaMin.id }) }
          );
          expect(rReopenWhileLocked.status).toBe(403);

          const rSignWhileLocked = await signScreenAta(
            new Request(`http://127.0.0.1/api/atas/${betaMin.id}/sign-screen`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                participantId: betaMin.participants[0].id,
                expectedRevision: 1,
                signatureData:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              }),
            }),
            { params: Promise.resolve({ id: betaMin.id }) }
          );
          expect(rSignWhileLocked.status).toBe(403);
        } finally {
          releaseLock();
          await lockHolderTx;
        }

        const betaAfter = await prisma.pedagogicalMinute.findUnique({
          where: { id: betaMin.id },
          include: { participants: true },
        });
        expect(betaAfter?.contentRevision).toBe(1);
        expect(betaAfter?.participants[0]?.hasSignature).toBe(false);
        expect(await prisma.auditLog.count()).toBe(auditBefore);
      } finally {
        for (const mId of [alphaMinId, alphaLegacyId, betaMinId].filter(Boolean) as string[]) {
          await prisma.pedagogicalMinute.deleteMany({ where: { id: mId } }).catch(() => {});
        }
        if (alphaJustId) {
          await prisma.absenceJustification
            .deleteMany({ where: { id: alphaJustId } })
            .catch(() => {});
        }
        await prisma.auditLog
          .deleteMany({ where: { userEmail: "super-nosel@redeativa.local" } })
          .catch(() => {});
        await prisma.userSchool
          .deleteMany({ where: { id: { in: ["us-super-no-sel-alpha"] } } })
          .catch(() => {});
        await prisma.user
          .deleteMany({ where: { id: { in: ["user-super-no-sel"] } } })
          .catch(() => {});
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });

    it("restringe gravação legada de verificationCode em GET /api/atas, GET /api/atas/[id] e /atas/[id]/imprimir à seleção estrita coincidente", async () => {
      const prevPendingSessionUser = testAuthState.pendingSessionUser;
      const prevUseRealCurrentSchool = testAuthState.useRealCurrentSchool;
      const prevUseRealPermissions = testAuthState.useRealPermissions;
      const nextHeaders = await import("next/headers");
      const legacyIds: string[] = [];

      try {
        testAuthState.useRealCurrentSchool = true;
        testAuthState.useRealPermissions = true;

        await prisma.school.create({
          data: {
            id: "school-inactive-legacy",
            inepCode: "99000999",
            name: "Escola Inativa Legacy",
            active: false,
          },
        });

        await prisma.user.create({
          data: {
            id: "user-super-legacy-check",
            email: "super-legacy@redeativa.local",
            name: "SuperAdmin Legacy",
            role: "SUPERADMIN",
            active: true,
            schoolId: null,
          },
        });
        await prisma.userSchool.create({
          data: {
            id: "us-super-legacy-alpha",
            userId: "user-super-legacy-check",
            schoolId: "school-alpha",
            role: "SUPERADMIN",
            active: true,
          },
        });

        for (let i = 1; i <= 3; i++) {
          const m = await prisma.pedagogicalMinute.create({
            data: {
              schoolId: "school-alpha",
              year: 2026,
              ataNumber: 950 + i,
              status: "FINALIZED",
              contentRevision: 1,
              category: "ACOMPANHAMENTO_PEDAGOGICO",
              attendedAt: new Date(),
              subject: `Ata Legada Alpha ${i}`,
              summary:
                "Resumo finalizado em Alpha com mais de cinquenta caracteres para testar gravação legada.",
              authorId: "user-super-legacy-check",
              authorName: "SuperAdmin Legacy",
              authorEmail: "super-legacy@redeativa.local",
              authorRole: "SUPERADMIN",
              verificationCode: null,
            },
          });
          legacyIds.push(m.id);
        }

        const { GET: getAtas } = await import("@/app/api/atas/route");
        const { GET: getAtaById } = await import("@/app/api/atas/[id]/route");
        const { default: AtaPrintPage } = await import("@/app/atas/[id]/imprimir/page");
        const { hasExplicitSuperAdminSchoolSelection } = await import("@/lib/currentSchool");
        const { resolveServerUserAuthSnapshot } = await import("@/lib/serverAuthContext");

        testAuthState.pendingSessionUser = {
          id: "user-super-legacy-check",
          email: "super-legacy@redeativa.local",
          name: "SuperAdmin Legacy",
          role: "SUPERADMIN",
          schoolId: null,
        };

        // 1. Seleção ausente (sem cookie e sem schoolId no perfil) -> leitura via fallback funciona sem gravar verificationCode
        expect((await getAtas(new Request("http://127.0.0.1/api/atas"))).status).toBe(200);
        expect(
          (
            await getAtaById(new Request(`http://127.0.0.1/api/atas/${legacyIds[0]}`), {
              params: Promise.resolve({ id: legacyIds[0] }),
            })
          ).status
        ).toBe(200);
        await expect(
          AtaPrintPage({ params: Promise.resolve({ id: legacyIds[0] }) })
        ).resolves.toBeTruthy();

        let check0 = await prisma.pedagogicalMinute.findUnique({
          where: { id: legacyIds[0] },
          select: { verificationCode: true },
        });
        expect(check0?.verificationCode).toBeNull();

        // 2. Cookie obsoleto / de escola inativa -> leitura via fallback funciona sem gravar verificationCode
        vi.mocked(nextHeaders.cookies).mockResolvedValue({
          get: (name: string) =>
            name === "active_school_id" ? { name, value: "school-inactive-legacy" } : undefined,
        } as any);

        expect((await getAtas(new Request("http://127.0.0.1/api/atas"))).status).toBe(200);
        expect(
          (
            await getAtaById(new Request(`http://127.0.0.1/api/atas/${legacyIds[1]}`), {
              params: Promise.resolve({ id: legacyIds[1] }),
            })
          ).status
        ).toBe(200);
        await expect(
          AtaPrintPage({ params: Promise.resolve({ id: legacyIds[1] }) })
        ).resolves.toBeTruthy();

        let check1 = await prisma.pedagogicalMinute.findUnique({
          where: { id: legacyIds[1] },
          select: { verificationCode: true },
        });
        expect(check1?.verificationCode).toBeNull();

        // 3. Perfil obsoleto (User.schoolId = escola inativa, sem cookie) -> leitura via fallback sem gravar
        vi.mocked(nextHeaders.cookies).mockResolvedValue({ get: () => undefined } as any);
        await prisma.user.update({
          where: { id: "user-super-legacy-check" },
          data: { schoolId: "school-inactive-legacy" },
        });

        expect((await getAtas(new Request("http://127.0.0.1/api/atas"))).status).toBe(200);
        expect(
          (
            await getAtaById(new Request(`http://127.0.0.1/api/atas/${legacyIds[2]}`), {
              params: Promise.resolve({ id: legacyIds[2] }),
            })
          ).status
        ).toBe(200);
        await expect(
          AtaPrintPage({ params: Promise.resolve({ id: legacyIds[2] }) })
        ).resolves.toBeTruthy();

        let check2 = await prisma.pedagogicalMinute.findUnique({
          where: { id: legacyIds[2] },
          select: { verificationCode: true },
        });
        expect(check2?.verificationCode).toBeNull();

        // 4. Divergência entre seleção estrita (school-alpha) e contexto de leitura (school-beta) -> false
        await prisma.user.update({
          where: { id: "user-super-legacy-check" },
          data: { schoolId: "school-alpha" },
        });
        const sessionWrap = { user: testAuthState.pendingSessionUser };
        const snap = await resolveServerUserAuthSnapshot(sessionWrap);
        expect(snap).not.toBeNull();
        expect(
          await hasExplicitSuperAdminSchoolSelection(
            snap,
            "school-beta",
            sessionWrap
          )
        ).toBe(false);
        expect(
          await hasExplicitSuperAdminSchoolSelection(
            snap,
            "school-alpha",
            sessionWrap
          )
        ).toBe(true);

        // 5. Seleção válida coincidente -> grava verificationCode nos três pontos de entrada
        testAuthState.pendingSessionUser = {
          id: "user-super-legacy-check",
          email: "super-legacy@redeativa.local",
          name: "SuperAdmin Legacy",
          role: "SUPERADMIN",
          schoolId: "school-alpha",
        };
        expect(
          (
            await getAtaById(new Request(`http://127.0.0.1/api/atas/${legacyIds[0]}`), {
              params: Promise.resolve({ id: legacyIds[0] }),
            })
          ).status
        ).toBe(200);
        check0 = await prisma.pedagogicalMinute.findUnique({
          where: { id: legacyIds[0] },
          select: { verificationCode: true },
        });
        expect(check0?.verificationCode).toBeTruthy();

        await expect(
          AtaPrintPage({ params: Promise.resolve({ id: legacyIds[1] }) })
        ).resolves.toBeTruthy();
        check1 = await prisma.pedagogicalMinute.findUnique({
          where: { id: legacyIds[1] },
          select: { verificationCode: true },
        });
        expect(check1?.verificationCode).toBeTruthy();

        expect((await getAtas(new Request("http://127.0.0.1/api/atas"))).status).toBe(200);
        check2 = await prisma.pedagogicalMinute.findUnique({
          where: { id: legacyIds[2] },
          select: { verificationCode: true },
        });
        expect(check2?.verificationCode).toBeTruthy();
      } finally {
        vi.mocked(nextHeaders.cookies).mockResolvedValue({ get: () => undefined } as any);
        for (const id of legacyIds) {
          await prisma.pedagogicalMinute.deleteMany({ where: { id } }).catch(() => {});
        }
        await prisma.userSchool
          .deleteMany({ where: { id: { in: ["us-super-legacy-alpha"] } } })
          .catch(() => {});
        await prisma.user
          .deleteMany({ where: { id: { in: ["user-super-legacy-check"] } } })
          .catch(() => {});
        await prisma.school
          .deleteMany({ where: { id: { in: ["school-inactive-legacy"] } } })
          .catch(() => {});
        testAuthState.pendingSessionUser = prevPendingSessionUser;
        testAuthState.useRealCurrentSchool = prevUseRealCurrentSchool;
        testAuthState.useRealPermissions = prevUseRealPermissions;
      }
    });
  it("Commit 2 Conselho e SERE PDF: isola vínculo revogado, papel leitura, SUPERADMIN sem seleção, IDs cruzados e preview sem escrita em PG16", async () => {
    const { NextResponse } = await import("next/server");
    const { cookies } = await import("next/headers");
    const { logAudit } = await import("@/lib/audit");
    const { GET: getBoardsRoute, POST: postBoardRoute } = await import(
      "@/app/api/conselho-classe/route"
    );
    const { GET: getBoardRoute, PATCH: patchBoardRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/route"
    );
    const { PUT: putSubjectsRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/subjects/route"
    );
    const { PUT: putMatrixRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/matrix/route"
    );
    const { PATCH: patchTrimestersRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/trimesters/route"
    );
    const { PATCH: patchStudentCardRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/students/[studentId]/route"
    );
    const { POST: postGenerateMinuteRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/generate-minute/route"
    );
    const { POST: postPreCouncilLinkRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/pre-council-link/route"
    );
    const { POST: postTeacherLinkRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/teacher-link/route"
    );
    const { POST: postImportPdfRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/import-pdf/route"
    );

    const buildMiniSerePdf = (studentName: string): Uint8Array => {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const yFromBottom = (pdfY: number) => doc.internal.pageSize.getHeight() - pdfY;
      doc.setFontSize(8);
      doc.text("GOVERNO DO ESTADO DO PARANÁ", 28.3, yFromBottom(573.5));
      doc.text("DATA: 18/11/2026", 748, yFromBottom(573.5));
      doc.text("SECRETARIA DE ESTADO DA EDUCAÇÃO - SEED", 28.3, yFromBottom(562.5));
      doc.text("SISTEMA ESCOLA", 743.5, yFromBottom(562.5));
      doc.text("ESCOLA SINTÉTICA", 28.3, yFromBottom(539.5));
      doc.text("2026", 802, yFromBottom(539.5));
      doc.text("Curso: ENSINO FUNDAMENTAL", 28.3, yFromBottom(528.5));
      doc.text("Seriação: 6º Ano", 247.7, yFromBottom(528.5));
      doc.text("Turno: Manhã", 359.5, yFromBottom(528.5));
      doc.text("Turma: A", 783.5, yFromBottom(528.5));
      doc.setFontSize(10);
      doc.text("RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL", 318.3, yFromBottom(503));
      doc.setFontSize(7);
      doc.text("Disciplinas", 300, yFromBottom(475));
      doc.text("Nro.", 31.1, yFromBottom(453.5));
      doc.text("Nome", 48.4, yFromBottom(453.5));
      doc.text("MATEMATICA", 169.2, yFromBottom(458));
      doc.text("T1", 164.2, yFromBottom(445));
      doc.text("T2", 182.6, yFromBottom(445));
      doc.text("T3", 201.0, yFromBottom(445));
      doc.text("1", 31.4, yFromBottom(432));
      doc.text(studentName, 48.4, yFromBottom(432));
      doc.text("5.5", 162.2, yFromBottom(432));
      doc.text("--", 180.6, yFromBottom(432));
      doc.text("--", 199.0, yFromBottom(432));
      doc.text("--", 220.8, yFromBottom(432));
      return new Uint8Array(doc.output("arraybuffer"));
    };

    const makePdfRequest = (boardId: string, mode: "preview" | "apply", studentName: string) => {
      const pdfBytes = buildMiniSerePdf(studentName);
      const fd = new FormData();
      fd.set("mode", mode);
      fd.set(
        "files",
        new File([Buffer.from(pdfBytes)], "sere.pdf", { type: "application/pdf" })
      );
      return new Request(`http://127.0.0.1/api/conselho-classe/${boardId}/import-pdf`, {
        method: "POST",
        body: fd,
      });
    };

    // Criar turmas homônimas, estudantes, boards, disciplinas e usuários sintéticos em A e B
    await prisma.classGroup.createMany({
      data: [
        {
          id: "cc-cg-alpha",
          schoolId: "school-alpha",
          name: "6º Ano Conselho",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
        {
          id: "cc-cg-beta",
          schoolId: "school-beta",
          name: "6º Ano Conselho",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      ],
      skipDuplicates: true,
    });

    await prisma.student.createMany({
      data: [
        {
          id: "cc-stu-alpha",
          schoolId: "school-alpha",
          classGroupId: "cc-cg-alpha",
          cgm: "9900011",
          name: "ESTUDANTE CONSELHO ALPHA",
          phone: "41999990011",
          active: true,
        },
        {
          id: "cc-stu-beta",
          schoolId: "school-beta",
          classGroupId: "cc-cg-beta",
          cgm: "9900022",
          name: "ESTUDANTE CONSELHO BETA",
          phone: "41999990022",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilBoard.createMany({
      data: [
        {
          id: "cc-board-alpha",
          schoolId: "school-alpha",
          classGroupId: "cc-cg-alpha",
          year: 2026,
        },
        {
          id: "cc-board-beta",
          schoolId: "school-beta",
          classGroupId: "cc-cg-beta",
          year: 2026,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilSubject.createMany({
      data: [
        {
          id: "cc-sub-alpha",
          schoolId: "school-alpha",
          boardId: "cc-board-alpha",
          name: "Língua Portuguesa",
          displayOrder: 1,
          active: true,
        },
        {
          id: "cc-sub-beta",
          schoolId: "school-beta",
          boardId: "cc-board-beta",
          name: "Língua Portuguesa",
          displayOrder: 1,
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilTrimester.createMany({
      data: [
        {
          id: "cc-tri-alpha-1",
          schoolId: "school-alpha",
          boardId: "cc-board-alpha",
          trimester: 1,
          preCouncilJson: JSON.stringify({
            trimester: 1,
            periodLabel: "1º Trimestre",
            objective: "Acompanhar aprendizagem",
            responsiblePedagogueName: "Pedagoga Alpha",
            responsiblePedagogueRole: "Pedagoga",
            conversations: [
              {
                id: "conv-alpha-1",
                subjectId: "cc-sub-alpha",
                subjectName: "Língua Portuguesa",
                teacherName: "Prof. Alpha",
                teacherEmail: "prof.alpha@redeativa.local",
                notes: "Observação registrada",
                monitoredStudentIds: ["cc-stu-alpha"],
                updatedAt: new Date().toISOString(),
                updatedBy: "Pedagoga Alpha",
              },
            ],
            synthesis: "Síntese Alpha",
            acknowledgements: [],
          }),
        },
        {
          id: "cc-tri-beta-1",
          schoolId: "school-beta",
          boardId: "cc-board-beta",
          trimester: 1,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.studentCouncilCard.createMany({
      data: [
        {
          id: "cc-card-alpha",
          schoolId: "school-alpha",
          boardId: "cc-board-alpha",
          studentId: "cc-stu-alpha",
        },
        {
          id: "cc-card-beta",
          schoolId: "school-beta",
          boardId: "cc-board-beta",
          studentId: "cc-stu-beta",
        },
      ],
      skipDuplicates: true,
    });

    await prisma.user.createMany({
      data: [
        {
          id: "cc-usr-revoked",
          email: "cc.revoked@redeativa.local",
          name: "Vínculo Revogado",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
          active: true,
        },
        {
          id: "cc-usr-sec",
          email: "cc.sec@redeativa.local",
          name: "Secretaria Leitura",
          role: "GESTAO_SECRETARIA",
          active: true,
        },
        {
          id: "cc-usr-super",
          email: "cc.super@redeativa.local",
          name: "Superadmin Conselho",
          role: "SUPERADMIN",
          active: true,
        },
        {
          id: "cc-usr-ped-a",
          email: "cc.ped.a@redeativa.local",
          name: "Pedagoga Alpha",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.userSchool.createMany({
      data: [
        {
          id: "cc-us-revoked",
          userId: "cc-usr-revoked",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: false,
        },
        {
          id: "cc-us-ped-a",
          userId: "cc-usr-ped-a",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    const alphaSchoolRow = await prisma.school.findUnique({
      where: { id: "school-alpha" },
      select: { networkId: true },
    });
    const alphaNetId = alphaSchoolRow?.networkId || "cc-net-alpha";
    if (!alphaSchoolRow?.networkId) {
      await prisma.educationNetwork.upsert({
        where: { id: alphaNetId },
        create: { id: alphaNetId, name: "Rede Alpha Sintética", shortName: "Rede A", city: "Curitiba" },
        update: {},
      });
      await prisma.school.update({
        where: { id: "school-alpha" },
        data: { networkId: alphaNetId },
      });
    }
    await prisma.userNetwork.createMany({
      data: [
        {
          id: "cc-un-sec",
          userId: "cc-usr-sec",
          networkId: alphaNetId,
          role: "GESTAO_SECRETARIA",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    testAuthState.useRealPermissions = true;
    testAuthState.useRealCurrentSchool = true;

    try {
      // 1. Vínculo revogado (active: false) -> 403
      testAuthState.pendingSessionUser = {
        id: "cc-usr-revoked",
        email: "cc.revoked@redeativa.local",
        schoolId: "school-alpha",
        active: true,
      };
      const rRevokedGet = await getBoardRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha"),
        { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
      );
      expect(rRevokedGet.status).toBe(403);

      // 2. Papel leitura (GESTAO_SECRETARIA sem vínculo local) -> lê A, 403 em mutações
      testAuthState.pendingSessionUser = {
        id: "cc-usr-sec",
        email: "cc.sec@redeativa.local",
        networkId: alphaNetId,
        active: true,
      };
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) =>
          name === "active_school_id" ? { name, value: "school-alpha" } : undefined,
      } as never);
      expect(
        (
          await getBoardsRoute(
            new Request("http://127.0.0.1/api/conselho-classe?year=2026")
          )
        ).status
      ).toBe(200);
      expect(
        (
          await patchBoardRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ peerLeaderStudentId: "cc-stu-alpha" }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
          )
        ).status
      ).toBe(403);

      // 3. SUPERADMIN sem seleção explícita -> 403 em mutações
      testAuthState.pendingSessionUser = {
        id: "cc-usr-super",
        email: "cc.super@redeativa.local",
        active: true,
      };
      vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      vi.mocked(logAudit).mockClear();

      expect(
        (
          await postBoardRoute(
            new Request("http://127.0.0.1/api/conselho-classe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ classGroupId: "cc-cg-alpha", year: 2026 }),
            })
          )
        ).status
      ).toBe(403);
      expect(
        (
          await patchBoardRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ peerLeaderStudentId: "cc-stu-alpha" }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await postImportPdfRoute(
            makePdfRequest("cc-board-alpha", "apply", "ESTUDANTE CONSELHO ALPHA"),
            { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
          )
        ).status
      ).toBe(403);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // 4. IDs cruzados (boardId, sourceBoardId, studentId, subjectId, leaderStudentId)
      testAuthState.pendingSessionUser = {
        id: "cc-usr-ped-a",
        email: "cc.ped.a@redeativa.local",
        schoolId: "school-alpha",
        active: true,
      };
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) =>
          name === "active_school_id" ? { name, value: "school-alpha" } : undefined,
      } as never);
      vi.mocked(logAudit).mockClear();

      // boardId de B
      expect(
        (
          await getBoardRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-beta"),
            { params: Promise.resolve({ boardId: "cc-board-beta" }) }
          )
        ).status
      ).toBe(403);
      // sourceBoardId de B em PUT /subjects
      expect(
        (
          await putSubjectsRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha/subjects", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceBoardId: "cc-board-beta" }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
          )
        ).status
      ).toBe(403);
      // studentId/subjectId de B em PUT /matrix
      expect(
        (
          await putMatrixRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha/matrix", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                trimester: 1,
                entries: [
                  {
                    studentId: "cc-stu-beta",
                    subjectId: "cc-sub-beta",
                    grade: 7.5,
                  },
                ],
              }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
          )
        ).status
      ).toBe(400);
      // peerLeaderStudentId de B em PATCH /conselho-classe/[boardId]
      expect(
        (
          await patchBoardRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ peerLeaderStudentId: "cc-stu-beta" }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
          )
        ).status
      ).toBe(400);
      // studentId de B em PATCH /students/[studentId]
      expect(
        (
          await patchStudentCardRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha/students/cc-stu-beta", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, observations: "Invasão" }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-alpha", studentId: "cc-stu-beta" }) }
          )
        ).status
      ).toBe(404);
      // subjectId de B em POST /teacher-link
      expect(
        (
          await postTeacherLinkRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-alpha/teacher-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, subjectId: "cc-sub-beta" }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
          )
        ).status
      ).toBe(404);
      expect(
        (
          await postGenerateMinuteRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-beta/generate-minute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source: "PRE_COUNCIL", trimester: 1 }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-beta" }) }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await postPreCouncilLinkRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-beta/pre-council-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1 }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-beta" }) }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await patchTrimestersRoute(
            new Request("http://127.0.0.1/api/conselho-classe/cc-board-beta/trimesters", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trimester: 1, status: "CLOSED" }),
            }),
            { params: Promise.resolve({ boardId: "cc-board-beta" }) }
          )
        ).status
      ).toBe(403);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // 5. SERE PDF preview sem escrita no banco vs apply autorizado em school-alpha
      const subjectsCountBeforePreview = await prisma.classCouncilSubject.count({
        where: { boardId: "cc-board-alpha" },
      });
      const rPreview = await postImportPdfRoute(
        makePdfRequest("cc-board-alpha", "preview", "ESTUDANTE CONSELHO ALPHA"),
        { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
      );
      expect(rPreview.status).toBe(200);
      expect(
        await prisma.classCouncilSubject.count({ where: { boardId: "cc-board-alpha" } })
      ).toBe(subjectsCountBeforePreview);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      const rApply = await postImportPdfRoute(
        makePdfRequest("cc-board-alpha", "apply", "ESTUDANTE CONSELHO ALPHA"),
        { params: Promise.resolve({ boardId: "cc-board-alpha" }) }
      );
      expect(rApply.status).toBe(200);
      expect(
        await prisma.classCouncilSubject.count({ where: { boardId: "cc-board-alpha" } })
      ).toBeGreaterThan(subjectsCountBeforePreview);
      expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolId: "school-alpha",
          entityId: "cc-board-alpha",
        })
      );

      // 6. Fluxo legítimo após troca para school-beta por SUPERADMIN com seleção explícita
      testAuthState.pendingSessionUser = {
        id: "cc-usr-super",
        email: "cc.super@redeativa.local",
        schoolId: "school-beta",
        active: true,
      };
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) =>
          name === "active_school_id" ? { name, value: "school-beta" } : undefined,
      } as never);
      const rBetaPatch = await patchBoardRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc-board-beta", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peerLeaderStudentId: "cc-stu-beta" }),
        }),
        { params: Promise.resolve({ boardId: "cc-board-beta" }) }
      );
      expect(rBetaPatch.status).toBe(200);
      expect(
        (await prisma.classCouncilBoard.findUnique({ where: { id: "cc-board-beta" } }))
          ?.peerLeaderStudentId
      ).toBe("cc-stu-beta");
    } finally {
      testAuthState.useRealPermissions = false;
      testAuthState.useRealCurrentSchool = false;
      testAuthState.pendingSessionUser = null;
      vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      await prisma.userNetwork.deleteMany({ where: { id: "cc-un-sec" } }).catch(() => {});
      await prisma.userSchool
        .deleteMany({ where: { id: { in: ["cc-us-revoked", "cc-us-ped-a"] } } })
        .catch(() => {});
      await prisma.user
        .deleteMany({
          where: { id: { in: ["cc-usr-revoked", "cc-usr-sec", "cc-usr-super", "cc-usr-ped-a"] } },
        })
        .catch(() => {});
      await prisma.studentCouncilSubjectEntry
        .deleteMany({ where: { cardId: { in: ["cc-card-alpha", "cc-card-beta"] } } })
        .catch(() => {});
      await prisma.studentCouncilCard
        .deleteMany({ where: { id: { in: ["cc-card-alpha", "cc-card-beta"] } } })
        .catch(() => {});
      await prisma.classCouncilTrimester
        .deleteMany({ where: { id: { in: ["cc-tri-alpha-1", "cc-tri-beta-1"] } } })
        .catch(() => {});
      await prisma.classCouncilSubject
        .deleteMany({ where: { boardId: { in: ["cc-board-alpha", "cc-board-beta"] } } })
        .catch(() => {});
      await prisma.classCouncilBoard
        .deleteMany({ where: { id: { in: ["cc-board-alpha", "cc-board-beta"] } } })
        .catch(() => {});
      await prisma.student
        .deleteMany({ where: { id: { in: ["cc-stu-alpha", "cc-stu-beta"] } } })
        .catch(() => {});
      await prisma.classGroup
        .deleteMany({ where: { id: { in: ["cc-cg-alpha", "cc-cg-beta"] } } })
        .catch(() => {});
      if (!alphaSchoolRow?.networkId) {
        await prisma.school
          .update({ where: { id: "school-alpha" }, data: { networkId: null } })
          .catch(() => {});
        await prisma.educationNetwork
          .deleteMany({ where: { id: "cc-net-alpha" } })
          .catch(() => {});
      }
      void NextResponse;
    }
  });

  it("Aceite final Conselho e SERE PDF: leitura sem gravação, posse nas relações e colisões, e pareamento alinhado prévia × aplicação", async () => {
    const { cookies } = await import("next/headers");
    const { logAudit } = await import("@/lib/audit");
    const { POST: postBoardRoute } = await import("@/app/api/conselho-classe/route");
    const { GET: getBoardRoute } = await import("@/app/api/conselho-classe/[boardId]/route");
    const { PUT: putMatrixRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/matrix/route"
    );
    const { POST: postImportPdfRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/import-pdf/route"
    );
    const { default: ConselhoTurmaPage } = await import(
      "@/app/conselho-classe/[boardId]/page"
    );
    const { default: ConselhoPrintPage } = await import(
      "@/app/conselho-classe/[boardId]/imprimir/page"
    );
    const { getCouncilBoardDetail, listSchoolCouncilBoards } = await import(
      "@/services/classCouncilService"
    );

    const buildMultiStudentSerePdf = (opts: {
      shift: string;
      subjects: string[];
      rows: Array<{ nro: number; name: string; grades: Array<[string, string, string]> }>;
    }): Uint8Array => {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const yFromBottom = (pdfY: number) => doc.internal.pageSize.getHeight() - pdfY;
      doc.setFontSize(8);
      doc.text("GOVERNO DO ESTADO DO PARANÁ", 28.3, yFromBottom(573.5));
      doc.text("DATA: 18/11/2026", 748, yFromBottom(573.5));
      doc.text("SECRETARIA DE ESTADO DA EDUCAÇÃO - SEED", 28.3, yFromBottom(562.5));
      doc.text("SISTEMA ESCOLA", 743.5, yFromBottom(562.5));
      doc.text("ESCOLA SINTÉTICA", 28.3, yFromBottom(539.5));
      doc.text("2026", 802, yFromBottom(539.5));
      doc.text("Curso: ENSINO FUNDAMENTAL", 28.3, yFromBottom(528.5));
      doc.text("Seriação: 6º Ano", 247.7, yFromBottom(528.5));
      doc.text(`Turno: ${opts.shift}`, 359.5, yFromBottom(528.5));
      doc.text("Turma: Conselho", 783.5, yFromBottom(528.5));
      doc.setFontSize(10);
      doc.text("RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL", 318.3, yFromBottom(503));
      doc.setFontSize(7);
      doc.text("Disciplinas", 300, yFromBottom(475));
      doc.text("Nro.", 31.1, yFromBottom(453.5));
      doc.text("Nome", 48.4, yFromBottom(453.5));

      const firstT1X = 164.2;
      const tStep = 18.4;
      const subjectStep = 73.7;
      opts.subjects.forEach((subj, sIdx) => {
        const baseX = firstT1X + sIdx * subjectStep;
        doc.text(subj, baseX + 5, yFromBottom(458));
        doc.text("T1", baseX, yFromBottom(445));
        doc.text("T2", baseX + tStep, yFromBottom(445));
        doc.text("T3", baseX + tStep * 2, yFromBottom(445));
      });

      let currentY = 432;
      for (const row of opts.rows) {
        doc.text(String(row.nro), 31.4, yFromBottom(currentY));
        doc.text(row.name, 48.4, yFromBottom(currentY));
        row.grades.forEach(([t1, t2, t3], sIdx) => {
          const baseX = firstT1X + sIdx * subjectStep;
          doc.text(t1, baseX - 2, yFromBottom(currentY));
          doc.text(t2, baseX + tStep - 2, yFromBottom(currentY));
          doc.text(t3, baseX + tStep * 2 - 2, yFromBottom(currentY));
          doc.text("--", baseX + tStep * 3 + 1.4, yFromBottom(currentY));
        });
        currentY -= 20;
      }
      return new Uint8Array(doc.output("arraybuffer"));
    };

    const makeSereReq = (
      boardId: string,
      mode: "preview" | "apply",
      pdfBytes: Uint8Array,
      confirmShiftUpdate = false
    ) => {
      const fd = new FormData();
      fd.set("mode", mode);
      if (confirmShiftUpdate) fd.set("updateClassShift", "true");
      fd.set("files", new File([Buffer.from(pdfBytes)], "sere.pdf", { type: "application/pdf" }));
      return new Request(`http://127.0.0.1/api/conselho-classe/${boardId}/import-pdf`, {
        method: "POST",
        body: fd,
      });
    };

    const alphaSchoolRow = await prisma.school.findUnique({
      where: { id: "school-alpha" },
      select: { networkId: true },
    });
    const alphaNetId = alphaSchoolRow?.networkId || "ac-net-alpha";
    if (!alphaSchoolRow?.networkId) {
      await prisma.educationNetwork.upsert({
        where: { id: alphaNetId },
        create: { id: alphaNetId, name: "Rede Aceite Alpha", shortName: "Rede AC", city: "Curitiba" },
        update: {},
      });
      await prisma.school.update({
        where: { id: "school-alpha" },
        data: { networkId: alphaNetId },
      });
    }

    await prisma.classGroup.createMany({
      data: [
        {
          id: "ac-cg-alpha",
          schoolId: "school-alpha",
          name: "6º Ano Aceite",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
        {
          id: "ac-cg-alpha-hist",
          schoolId: "school-alpha",
          name: "6º Ano Histórico",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
        {
          id: "ac-cg-beta",
          schoolId: "school-beta",
          name: "6º Ano Aceite",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      ],
      skipDuplicates: true,
    });

    await prisma.student.createMany({
      data: [
        {
          id: "ac-stu-a-card",
          schoolId: "school-alpha",
          classGroupId: "ac-cg-alpha",
          cgm: "9800011",
          name: "ALUNO ALPHA COM FICHA",
          phone: "41999980011",
          active: true,
        },
        {
          id: "ac-stu-a-nocard",
          schoolId: "school-alpha",
          classGroupId: "ac-cg-alpha",
          cgm: "9800012",
          name: "ALUNO ALPHA SEM FICHA",
          phone: "41999980012",
          active: true,
        },
        {
          id: "ac-stu-a-hom-1",
          schoolId: "school-alpha",
          classGroupId: "ac-cg-alpha",
          cgm: "9800013",
          name: "HOMONIMO TURMA ALPHA",
          phone: "41999980013",
          active: true,
        },
        {
          id: "ac-stu-a-hom-2",
          schoolId: "school-alpha",
          classGroupId: "ac-cg-alpha",
          cgm: "9800014",
          name: "HOMONIMO TURMA ALPHA",
          phone: "41999980014",
          active: true,
        },
        {
          id: "ac-stu-a-hist",
          schoolId: "school-alpha",
          classGroupId: "ac-cg-alpha-hist",
          cgm: "9800015",
          name: "ALUNO HISTORICO ALPHA",
          phone: "41999980015",
          active: true,
        },
        {
          id: "ac-stu-b-foreign",
          schoolId: "school-beta",
          classGroupId: "ac-cg-beta",
          cgm: "9800021",
          name: "ALUNO ESTRANGEIRO BETA",
          phone: "41999980021",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilBoard.createMany({
      data: [
        {
          id: "ac-board-alpha",
          schoolId: "school-alpha",
          classGroupId: "ac-cg-alpha",
          year: 2026,
        },
        {
          id: "ac-board-beta",
          schoolId: "school-beta",
          classGroupId: "ac-cg-beta",
          year: 2026,
        },
      ],
      skipDuplicates: true,
    });

    // Disciplinas: 1 legítima de Alpha + 1 divergente de Beta presa no mesmo board
    await prisma.classCouncilSubject.createMany({
      data: [
        {
          id: "ac-sub-a-lp",
          schoolId: "school-alpha",
          boardId: "ac-board-alpha",
          name: "Língua Portuguesa",
          displayOrder: 1,
          active: true,
        },
        {
          id: "ac-sub-b-colisao",
          schoolId: "school-beta",
          boardId: "ac-board-alpha",
          name: "História",
          displayOrder: 2,
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    // Fichas: 1 com ficha, 1 histórica válida de outra turma da mesma escola, 1 divergente de Beta
    await prisma.studentCouncilCard.createMany({
      data: [
        {
          id: "ac-card-a-main",
          schoolId: "school-alpha",
          boardId: "ac-board-alpha",
          studentId: "ac-stu-a-card",
        },
        {
          id: "ac-card-a-hist",
          schoolId: "school-alpha",
          boardId: "ac-board-alpha",
          studentId: "ac-stu-a-hist",
        },
        {
          id: "ac-card-b-divergent",
          schoolId: "school-beta",
          boardId: "ac-board-alpha",
          studentId: "ac-stu-b-foreign",
        },
      ],
      skipDuplicates: true,
    });

    // Avaliações: 1 manual em LP + 1 colisão divergente (schoolId: school-beta) no mesmo card/subject/trimester 2
    await prisma.studentCouncilSubjectEntry.createMany({
      data: [
        {
          id: "ac-eval-a-manual",
          schoolId: "school-alpha",
          cardId: "ac-card-a-main",
          subjectId: "ac-sub-a-lp",
          trimester: 1,
          descriptorCodes: [3, 4],
          grade: 7.5,
        },
        {
          id: "ac-eval-b-colisao",
          schoolId: "school-beta",
          cardId: "ac-card-a-main",
          subjectId: "ac-sub-a-lp",
          trimester: 2,
          descriptorCodes: [5],
          grade: 8.8,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.user.createMany({
      data: [
        {
          id: "ac-usr-sec",
          email: "ac.sec@redeativa.local",
          name: "Secretaria Aceite",
          role: "GESTAO_SECRETARIA",
          active: true,
        },
        {
          id: "ac-usr-super",
          email: "ac.super@redeativa.local",
          name: "Superadmin Aceite",
          role: "SUPERADMIN",
          active: true,
        },
        {
          id: "ac-usr-ped-a",
          email: "ac.ped.a@redeativa.local",
          name: "Pedagoga Aceite",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
          active: true,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.userNetwork.createMany({
      data: [
        {
          id: "ac-un-sec",
          userId: "ac-usr-sec",
          networkId: alphaNetId,
          role: "GESTAO_SECRETARIA",
          active: true,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.userSchool.createMany({
      data: [
        {
          id: "ac-us-ped-a",
          userId: "ac-usr-ped-a",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    testAuthState.useRealPermissions = true;
    testAuthState.useRealCurrentSchool = true;

    try {
      // --- REQUISITO 1: Leitura sem gravações (com trimestres e fichas faltantes) ---
      expect(
        await prisma.classCouncilTrimester.count({ where: { boardId: "ac-board-alpha" } })
      ).toBe(0);
      expect(
        await prisma.studentCouncilCard.count({
          where: { boardId: "ac-board-alpha", studentId: "ac-stu-a-nocard" },
        })
      ).toBe(0);

      // 1a. Perfil de leitura (GESTAO_SECRETARIA) em GET, detalhe SSR e impressão SSR
      testAuthState.pendingSessionUser = {
        id: "ac-usr-sec",
        email: "ac.sec@redeativa.local",
        networkId: alphaNetId,
        active: true,
      };
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) =>
          name === "active_school_id" ? { name, value: "school-alpha" } : undefined,
      } as never);
      vi.mocked(logAudit).mockClear();

      const secGet = await getBoardRoute(
        new Request("http://127.0.0.1/api/conselho-classe/ac-board-alpha"),
        { params: Promise.resolve({ boardId: "ac-board-alpha" }) }
      );
      expect(secGet.status).toBe(200);
      const secBody = await secGet.json();
      expect(secBody.board.trimesters).toHaveLength(0);
      expect(secBody.board.studentCards.map((c: { studentId: string }) => c.studentId)).toEqual(
        expect.arrayContaining(["ac-stu-a-card", "ac-stu-a-hist"])
      );
      // Requisito 2 (leitura): exclui sujeitos/fichas/avaliações divergentes, preserva ficha histórica válida
      expect(
        secBody.board.subjects.some((s: { id: string }) => s.id === "ac-sub-b-colisao")
      ).toBe(false);
      expect(
        secBody.board.studentCards.some((c: { id: string }) => c.id === "ac-card-b-divergent")
      ).toBe(false);
      const cardMainRead = secBody.board.studentCards.find(
        (c: { id: string }) => c.id === "ac-card-a-main"
      );
      expect(
        cardMainRead.subjectEntries.some((e: { id: string }) => e.id === "ac-eval-b-colisao")
      ).toBe(false);

      // Listagem também exclui contagens divergentes
      const listedAlpha = await listSchoolCouncilBoards("school-alpha", 2026);
      const listedBoard = listedAlpha.boards.find((b) => b.id === "ac-board-alpha");
      expect(listedBoard?._count.subjects).toBe(1);
      expect(listedBoard?._count.studentCards).toBe(2);

      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: "ac-board-alpha" }) })
      ).resolves.toBeTruthy();
      await expect(
        ConselhoPrintPage({ params: Promise.resolve({ boardId: "ac-board-alpha" }) })
      ).resolves.toBeTruthy();

      // Zero gravações após leitura da secretaria
      expect(
        await prisma.classCouncilTrimester.count({ where: { boardId: "ac-board-alpha" } })
      ).toBe(0);
      expect(
        await prisma.studentCouncilCard.count({
          where: { boardId: "ac-board-alpha", studentId: "ac-stu-a-nocard" },
        })
      ).toBe(0);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // 1b. SUPERADMIN sem seleção explícita (cookie ausente, schoolId nulo) em leitura
      testAuthState.pendingSessionUser = {
        id: "ac-usr-super",
        email: "ac.super@redeativa.local",
        active: true,
      };
      vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      const superDetail = await getCouncilBoardDetail("school-alpha", "ac-board-alpha");
      expect(superDetail?.id).toBe("ac-board-alpha");
      expect(
        await prisma.classCouncilTrimester.count({ where: { boardId: "ac-board-alpha" } })
      ).toBe(0);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // --- REQUISITO 2: Colisão na gravação (Matriz e SERE PDF) com rollback atômico ---
      testAuthState.pendingSessionUser = {
        id: "ac-usr-ped-a",
        email: "ac.ped.a@redeativa.local",
        schoolId: "school-alpha",
        active: true,
      };
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) =>
          name === "active_school_id" ? { name, value: "school-alpha" } : undefined,
      } as never);
      vi.mocked(logAudit).mockClear();

      // 2a. Colisão em PUT /matrix: lote com 1 item válido (ac-stu-a-hist T2) + 1 item colidindo com ac-eval-b-colisao (school-beta)
      const matrixCollisionRes = await putMatrixRoute(
        new Request("http://127.0.0.1/api/conselho-classe/ac-board-alpha/matrix", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: 2,
            entries: [
              {
                studentId: "ac-stu-a-hist",
                subjectId: "ac-sub-a-lp",
                descriptorCodes: [1],
                grade: 9.0,
              },
              {
                studentId: "ac-stu-a-card",
                subjectId: "ac-sub-a-lp",
                descriptorCodes: [2],
                grade: 4.0,
              },
            ],
          }),
        }),
        { params: Promise.resolve({ boardId: "ac-board-alpha" }) }
      );
      expect(matrixCollisionRes.status).toBe(409);
      // Rollback integral: nem o item válido foi gravado e a linha divergente de Beta permanece intacta
      expect(
        await prisma.studentCouncilSubjectEntry.findUnique({
          where: { id: "ac-eval-b-colisao" },
          select: { schoolId: true, grade: true },
        })
      ).toEqual({ schoolId: "school-beta", grade: 8.8 });
      expect(
        await prisma.studentCouncilSubjectEntry.count({
          where: { cardId: "ac-card-a-hist", trimester: 2 },
        })
      ).toBe(0);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // 2b. Colisão em SERE PDF apply contra disciplina divergente ("História", schoolId: school-beta)
      const collisionPdf = buildMultiStudentSerePdf({
        shift: "Manhã",
        subjects: ["HISTORIA"],
        rows: [
          {
            nro: 1,
            name: "ALUNO ALPHA COM FICHA",
            grades: [["5.0", "--", "--"]],
          },
        ],
      });
      const sereSubjCollisionRes = await postImportPdfRoute(
        makeSereReq("ac-board-alpha", "apply", collisionPdf),
        { params: Promise.resolve({ boardId: "ac-board-alpha" }) }
      );
      expect(sereSubjCollisionRes.status).toBe(409);
      expect(
        await prisma.classCouncilSubject.findUnique({
          where: { id: "ac-sub-b-colisao" },
          select: { schoolId: true, name: true },
        })
      ).toEqual({ schoolId: "school-beta", name: "História" });
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // --- REQUISITO 3: Alinhamento prévia × aplicação SERE PDF (sem ficha, homônimo, outra escola, turno) ---
      const alignedPdf = buildMultiStudentSerePdf({
        shift: "Tarde",
        subjects: ["LINGUA PORTU"],
        rows: [
          {
            nro: 1,
            name: "ALUNO ALPHA COM FICHA",
            grades: [["5.1", "--", "--"]],
          },
          {
            nro: 2,
            name: "ALUNO ALPHA SEM FICHA",
            grades: [["4.5", "--", "--"]],
          },
          {
            nro: 3,
            name: "HOMONIMO TURMA ALPHA",
            grades: [["6.5", "--", "--"]],
          },
          {
            nro: 4,
            name: "ALUNO ESTRANGEIRO BETA",
            grades: [["3.0", "--", "--"]],
          },
        ],
      });

      const previewRes = await postImportPdfRoute(
        makeSereReq("ac-board-alpha", "preview", alignedPdf),
        { params: Promise.resolve({ boardId: "ac-board-alpha" }) }
      );
      expect(previewRes.status).toBe(200);
      const previewJson = await previewRes.json();

      expect(previewJson.preview.summary.studentsMatched).toBe(2);
      expect(previewJson.preview.summary.studentsUnmatched).toBe(2);
      expect(previewJson.preview.summary.belowAverageGrades).toBe(2);
      expect(previewJson.preview.detectedShift).toBe("TARDE");
      const matchedPreviewIds = previewJson.preview.students
        .filter((s: { status: string }) => s.status === "matched")
        .map((s: { matchedStudentId: string }) => s.matchedStudentId);
      expect(matchedPreviewIds).toEqual(["ac-stu-a-card", "ac-stu-a-nocard"]);
      expect(
        previewJson.preview.students.find((s: { pdfName: string }) =>
          s.pdfName.includes("HOMONIMO")
        )?.status
      ).toBe("ambiguous");
      expect(
        previewJson.preview.students.find((s: { pdfName: string }) =>
          s.pdfName.includes("ESTRANGEIRO")
        )?.status
      ).toBe("unmatched");

      // Prévia NÃO gravou ficha nem turno nem notas
      expect(
        await prisma.studentCouncilCard.count({
          where: { boardId: "ac-board-alpha", studentId: "ac-stu-a-nocard" },
        })
      ).toBe(0);
      expect(
        (await prisma.classGroup.findUnique({ where: { id: "ac-cg-alpha" } }))?.shift
      ).toBe("MANHA");
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // Aplicação sem confirmar mudança de turno -> concorda com prévia e preserva turno + descritivos manuais
      const applyRes = await postImportPdfRoute(
        makeSereReq("ac-board-alpha", "apply", alignedPdf, false),
        { params: Promise.resolve({ boardId: "ac-board-alpha" }) }
      );
      expect(applyRes.status).toBe(200);
      const applyJson = await applyRes.json();
      expect(applyJson.summary.studentsMatched).toBe(previewJson.preview.summary.studentsMatched);
      expect(applyJson.summary.studentsUnmatched).toBe(previewJson.preview.summary.studentsUnmatched);
      expect(applyJson.summary.belowAverageGrades).toBe(previewJson.preview.summary.belowAverageGrades);
      expect(applyJson.summary.shiftUpdatedTo ?? null).toBeNull();
      expect(
        (await prisma.classGroup.findUnique({ where: { id: "ac-cg-alpha" } }))?.shift
      ).toBe("MANHA");

      // Ficha criada para aluno elegível sem ficha e descritivos manuais (3, 4) preservados no aluno existente
      const createdNoCard = await prisma.studentCouncilCard.findUnique({
        where: {
          boardId_studentId: { boardId: "ac-board-alpha", studentId: "ac-stu-a-nocard" },
        },
      });
      expect(createdNoCard?.schoolId).toBe("school-alpha");

      const updatedManualEval = await prisma.studentCouncilSubjectEntry.findUnique({
        where: { id: "ac-eval-a-manual" },
      });
      expect(updatedManualEval?.grade).toBe(5.1);
      expect(updatedManualEval?.descriptorCodes).toEqual(expect.arrayContaining([3, 4]));

      // Aplicação com confirmShiftUpdate: true atualiza turno da turma
      const applyShiftRes = await postImportPdfRoute(
        makeSereReq("ac-board-alpha", "apply", alignedPdf, true),
        { params: Promise.resolve({ boardId: "ac-board-alpha" }) }
      );
      expect(applyShiftRes.status).toBe(200);
      expect((await applyShiftRes.json()).board.classGroup.shift).toBe("TARDE");
      expect(
        (await prisma.classGroup.findUnique({ where: { id: "ac-cg-alpha" } }))?.shift
      ).toBe("TARDE");

      // --- Inicialização legítima por fluxo autorizado de escrita (POST /api/conselho-classe) ---
      const initBoardRes = await postBoardRoute(
        new Request("http://127.0.0.1/api/conselho-classe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classGroupId: "ac-cg-alpha", year: 2026 }),
        })
      );
      expect(initBoardRes.status).toBe(201);
      expect(
        await prisma.classCouncilTrimester.count({ where: { boardId: "ac-board-alpha" } })
      ).toBe(3);
    } finally {
      testAuthState.useRealPermissions = false;
      testAuthState.useRealCurrentSchool = false;
      testAuthState.pendingSessionUser = null;
      vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      await prisma.userNetwork.deleteMany({ where: { id: "ac-un-sec" } }).catch(() => {});
      await prisma.userSchool.deleteMany({ where: { id: "ac-us-ped-a" } }).catch(() => {});
      await prisma.user
        .deleteMany({ where: { id: { in: ["ac-usr-sec", "ac-usr-super", "ac-usr-ped-a"] } } })
        .catch(() => {});
      await prisma.studentCouncilSubjectEntry
        .deleteMany({
          where: {
            card: { boardId: { in: ["ac-board-alpha", "ac-board-beta"] } },
          },
        })
        .catch(() => {});
      await prisma.studentCouncilCard
        .deleteMany({ where: { boardId: { in: ["ac-board-alpha", "ac-board-beta"] } } })
        .catch(() => {});
      await prisma.classCouncilTrimester
        .deleteMany({ where: { boardId: { in: ["ac-board-alpha", "ac-board-beta"] } } })
        .catch(() => {});
      await prisma.classCouncilSubject
        .deleteMany({ where: { boardId: { in: ["ac-board-alpha", "ac-board-beta"] } } })
        .catch(() => {});
      await prisma.classCouncilBoard
        .deleteMany({ where: { id: { in: ["ac-board-alpha", "ac-board-beta"] } } })
        .catch(() => {});
      await prisma.student
        .deleteMany({
          where: {
            id: {
              in: [
                "ac-stu-a-card",
                "ac-stu-a-nocard",
                "ac-stu-a-hom-1",
                "ac-stu-a-hom-2",
                "ac-stu-a-hist",
                "ac-stu-b-foreign",
              ],
            },
          },
        })
        .catch(() => {});
      await prisma.classGroup
        .deleteMany({ where: { id: { in: ["ac-cg-alpha", "ac-cg-alpha-hist", "ac-cg-beta"] } } })
        .catch(() => {});
      if (!alphaSchoolRow?.networkId) {
        await prisma.school
          .update({ where: { id: "school-alpha" }, data: { networkId: null } })
          .catch(() => {});
        await prisma.educationNetwork.deleteMany({ where: { id: "ac-net-alpha" } }).catch(() => {});
      }
    }
  });

  it("Aceite final 2: isola avaliações e resumo por quadro/escola e serializa primeira gravação concorrente sem HTTP 500", async () => {
    const { cookies } = await import("next/headers");
    const { PUT: putMatrixRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/matrix/route"
    );
    const { POST: postImportPdfRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/import-pdf/route"
    );
    const { getCouncilBoardDetail } = await import("@/services/classCouncilService");

    const buildSereSinglePdf = (subjectHeader: string, gradeT1: string): Uint8Array => {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const yFromBottom = (pdfY: number) => doc.internal.pageSize.getHeight() - pdfY;
      doc.setFontSize(8);
      doc.text("GOVERNO DO ESTADO DO PARANÁ", 28.3, yFromBottom(573.5));
      doc.text("DATA: 18/11/2026", 748, yFromBottom(573.5));
      doc.text("SECRETARIA DE ESTADO DA EDUCAÇÃO - SEED", 28.3, yFromBottom(562.5));
      doc.text("SISTEMA ESCOLA", 743.5, yFromBottom(562.5));
      doc.text("ESCOLA SINTÉTICA", 28.3, yFromBottom(539.5));
      doc.text("2026", 802, yFromBottom(539.5));
      doc.text("Curso: ENSINO FUNDAMENTAL", 28.3, yFromBottom(528.5));
      doc.text("Seriação: 7º Ano", 247.7, yFromBottom(528.5));
      doc.text("Turno: Manhã", 359.5, yFromBottom(528.5));
      doc.text("Turma: A1", 783.5, yFromBottom(528.5));
      doc.setFontSize(10);
      doc.text("RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL", 318.3, yFromBottom(503));
      doc.setFontSize(7);
      doc.text("Disciplinas", 300, yFromBottom(475));
      doc.text("Nro.", 31.1, yFromBottom(453.5));
      doc.text("Nome", 48.4, yFromBottom(453.5));
      doc.text(subjectHeader, 169.2, yFromBottom(458));
      doc.text("T1", 164.2, yFromBottom(445));
      doc.text("T2", 182.6, yFromBottom(445));
      doc.text("T3", 201.0, yFromBottom(445));
      doc.text("1", 31.4, yFromBottom(432));
      doc.text("ESTUDANTE CC4 ALPHA", 48.4, yFromBottom(432));
      doc.text(gradeT1, 162.2, yFromBottom(432));
      doc.text("--", 180.6, yFromBottom(432));
      doc.text("--", 199.0, yFromBottom(432));
      doc.text("--", 220.8, yFromBottom(432));
      return new Uint8Array(doc.output("arraybuffer"));
    };

    await prisma.classGroup.createMany({
      data: [
        {
          id: "cc4-cg-a1",
          schoolId: "school-alpha",
          name: "7º Ano A1",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
        {
          id: "cc4-cg-a2",
          schoolId: "school-alpha",
          name: "7º Ano A2",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
        {
          id: "cc4-cg-b1",
          schoolId: "school-beta",
          name: "7º Ano B1",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      ],
      skipDuplicates: true,
    });

    await prisma.student.createMany({
      data: [
        {
          id: "cc4-stu-a1",
          schoolId: "school-alpha",
          classGroupId: "cc4-cg-a1",
          cgm: "9700011",
          name: "ESTUDANTE CC4 ALPHA",
          phone: "41999970011",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilBoard.createMany({
      data: [
        {
          id: "cc4-board-a1",
          schoolId: "school-alpha",
          classGroupId: "cc4-cg-a1",
          year: 2026,
        },
        {
          id: "cc4-board-a2",
          schoolId: "school-alpha",
          classGroupId: "cc4-cg-a2",
          year: 2026,
        },
        {
          id: "cc4-board-b1",
          schoolId: "school-beta",
          classGroupId: "cc4-cg-b1",
          year: 2026,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilSubject.createMany({
      data: [
        {
          id: "cc4-sub-a1-lp",
          schoolId: "school-alpha",
          boardId: "cc4-board-a1",
          name: "Língua Portuguesa",
          displayOrder: 1,
          active: true,
        },
        {
          id: "cc4-sub-a1-mat",
          schoolId: "school-alpha",
          boardId: "cc4-board-a1",
          name: "Matemática",
          displayOrder: 2,
          active: true,
        },
        {
          id: "cc4-sub-a2-otherboard",
          schoolId: "school-alpha",
          boardId: "cc4-board-a2",
          name: "Geografia Outro Quadro",
          displayOrder: 1,
          active: true,
        },
        {
          id: "cc4-sub-b1-foreign",
          schoolId: "school-beta",
          boardId: "cc4-board-b1",
          name: "Ciências Outra Escola",
          displayOrder: 1,
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.studentCouncilCard.createMany({
      data: [
        {
          id: "cc4-card-a1",
          schoolId: "school-alpha",
          boardId: "cc4-board-a1",
          studentId: "cc4-stu-a1",
          trimester1BelowAvgJson: JSON.stringify([
            { subjectName: "Projeto Manual", grade: 4.5 },
            {
              subjectId: "cc4-sub-a2-otherboard",
              subjectName: "Geografia Outro Quadro",
              grade: 3.0,
            },
            {
              subjectId: "cc4-sub-b1-foreign",
              subjectName: "Ciências Outra Escola",
              grade: 2.0,
            },
          ]),
        },
      ],
      skipDuplicates: true,
    });

    await prisma.studentCouncilSubjectEntry.createMany({
      data: [
        {
          id: "cc4-eval-otherboard",
          schoolId: "school-alpha",
          cardId: "cc4-card-a1",
          subjectId: "cc4-sub-a2-otherboard",
          trimester: 1,
          descriptorCodes: [1],
          grade: 3.0,
        },
        {
          id: "cc4-eval-foreign",
          schoolId: "school-beta",
          cardId: "cc4-card-a1",
          subjectId: "cc4-sub-b1-foreign",
          trimester: 1,
          descriptorCodes: [2],
          grade: 2.0,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.user.createMany({
      data: [
        {
          id: "cc4-usr-ped",
          email: "cc4.ped@redeativa.local",
          name: "Pedagoga CC4",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
          active: true,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.userSchool.createMany({
      data: [
        {
          id: "cc4-us-ped",
          userId: "cc4-usr-ped",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    testAuthState.useRealPermissions = true;
    testAuthState.useRealCurrentSchool = true;
    testAuthState.pendingSessionUser = {
      id: "cc4-usr-ped",
      email: "cc4.ped@redeativa.local",
      schoolId: "school-alpha",
      active: true,
    };
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === "active_school_id" ? { name, value: "school-alpha" } : undefined,
    } as never);

    try {
      // 1a. Detalhe exclui avaliações de outro quadro da mesma escola e de outra escola
      const detail = await getCouncilBoardDetail("school-alpha", "cc4-board-a1");
      const cardDetail = detail?.studentCards.find((c) => c.id === "cc4-card-a1");
      expect(cardDetail?.subjectEntries).toHaveLength(0);

      // 1b. Salvar nota legítima recalcula resumo excluindo disciplinas de outro quadro/escola e preservando item manual
      const saveLegitRes = await putMatrixRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc4-board-a1/matrix", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: 1,
            entries: [
              {
                studentId: "cc4-stu-a1",
                subjectId: "cc4-sub-a1-lp",
                descriptorCodes: [1],
                grade: 4.8,
              },
            ],
          }),
        }),
        { params: Promise.resolve({ boardId: "cc4-board-a1" }) }
      );
      expect(saveLegitRes.status).toBe(200);

      const cardAfterMatrix = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: "cc4-card-a1" },
      });
      const t1AfterMatrix = JSON.parse(cardAfterMatrix.trimester1BelowAvgJson || "[]") as Array<{
        subjectId?: string;
        subjectName: string;
      }>;
      expect(t1AfterMatrix.map((i) => i.subjectName)).toEqual([
        "Língua Portuguesa",
        "Projeto Manual",
      ]);

      // Linhas divergentes permanecem intactas no banco
      expect(
        await prisma.studentCouncilSubjectEntry.findUnique({
          where: { id: "cc4-eval-otherboard" },
          select: { grade: true },
        })
      ).toEqual({ grade: 3.0 });
      expect(
        await prisma.studentCouncilSubjectEntry.findUnique({
          where: { id: "cc4-eval-foreign" },
          select: { schoolId: true, grade: true },
        })
      ).toEqual({ schoolId: "school-beta", grade: 2.0 });

      // 1c. SERE PDF apply também preserva manual + LP e exclui itens divergentes
      const fd = new FormData();
      fd.set("mode", "apply");
      fd.set(
        "files",
        new File([Buffer.from(buildSereSinglePdf("MATEMATICA", "5.4"))], "sere.pdf", {
          type: "application/pdf",
        })
      );
      const sereRes = await postImportPdfRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc4-board-a1/import-pdf", {
          method: "POST",
          body: fd,
        }),
        { params: Promise.resolve({ boardId: "cc4-board-a1" }) }
      );
      expect(sereRes.status).toBe(200);

      const cardAfterSere = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: "cc4-card-a1" },
      });
      const t1AfterSere = JSON.parse(cardAfterSere.trimester1BelowAvgJson || "[]") as Array<{
        subjectName: string;
      }>;
      expect(t1AfterSere.map((i) => i.subjectName)).toEqual([
        "Língua Portuguesa",
        "Matemática",
        "Projeto Manual",
      ]);

      // 2a. Duas gravações concorrentes de avaliação inicialmente inexistente (T2, Matemática)
      const [concSameA, concSameB] = await Promise.all([
        putMatrixRoute(
          new Request("http://127.0.0.1/api/conselho-classe/cc4-board-a1/matrix", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trimester: 2,
              entries: [
                {
                  studentId: "cc4-stu-a1",
                  subjectId: "cc4-sub-a1-mat",
                  descriptorCodes: [1],
                  grade: 5.0,
                },
              ],
            }),
          }),
          { params: Promise.resolve({ boardId: "cc4-board-a1" }) }
        ),
        putMatrixRoute(
          new Request("http://127.0.0.1/api/conselho-classe/cc4-board-a1/matrix", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trimester: 2,
              entries: [
                {
                  studentId: "cc4-stu-a1",
                  subjectId: "cc4-sub-a1-mat",
                  descriptorCodes: [2],
                  grade: 4.2,
                },
              ],
            }),
          }),
          { params: Promise.resolve({ boardId: "cc4-board-a1" }) }
        ),
      ]);
      expect(concSameA.status).toBe(200);
      expect(concSameB.status).toBe(200);

      const t2Entries = await prisma.studentCouncilSubjectEntry.findMany({
        where: { cardId: "cc4-card-a1", subjectId: "cc4-sub-a1-mat", trimester: 2 },
      });
      expect(t2Entries).toHaveLength(1);
      const cardAfterT2 = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: "cc4-card-a1" },
      });
      const t2Summary = JSON.parse(cardAfterT2.trimester2BelowAvgJson || "[]") as Array<{
        subjectId: string;
        grade: number;
      }>;
      expect(t2Summary).toEqual([
        expect.objectContaining({
          subjectId: "cc4-sub-a1-mat",
          grade: t2Entries[0].grade,
        }),
      ]);

      // 2b. Gravações concorrentes em disciplinas diferentes da mesma ficha (T3: LP e Matemática)
      const [concDiffA, concDiffB] = await Promise.all([
        putMatrixRoute(
          new Request("http://127.0.0.1/api/conselho-classe/cc4-board-a1/matrix", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trimester: 3,
              entries: [
                {
                  studentId: "cc4-stu-a1",
                  subjectId: "cc4-sub-a1-lp",
                  descriptorCodes: [1],
                  grade: 4.1,
                },
              ],
            }),
          }),
          { params: Promise.resolve({ boardId: "cc4-board-a1" }) }
        ),
        putMatrixRoute(
          new Request("http://127.0.0.1/api/conselho-classe/cc4-board-a1/matrix", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trimester: 3,
              entries: [
                {
                  studentId: "cc4-stu-a1",
                  subjectId: "cc4-sub-a1-mat",
                  descriptorCodes: [2],
                  grade: 5.3,
                },
              ],
            }),
          }),
          { params: Promise.resolve({ boardId: "cc4-board-a1" }) }
        ),
      ]);
      expect(concDiffA.status).toBe(200);
      expect(concDiffB.status).toBe(200);

      const cardAfterT3 = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: "cc4-card-a1" },
      });
      const t3Summary = JSON.parse(cardAfterT3.trimester3BelowAvgJson || "[]") as Array<{
        subjectId: string;
      }>;
      expect(t3Summary.map((i) => i.subjectId).sort()).toEqual([
        "cc4-sub-a1-lp",
        "cc4-sub-a1-mat",
      ]);
    } finally {
      testAuthState.useRealPermissions = false;
      testAuthState.useRealCurrentSchool = false;
      testAuthState.pendingSessionUser = null;
      vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      await prisma.userSchool.deleteMany({ where: { id: "cc4-us-ped" } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: "cc4-usr-ped" } }).catch(() => {});
      await prisma.studentCouncilSubjectEntry
        .deleteMany({ where: { cardId: "cc4-card-a1" } })
        .catch(() => {});
      await prisma.studentCouncilCard
        .deleteMany({ where: { id: "cc4-card-a1" } })
        .catch(() => {});
      await prisma.classCouncilSubject
        .deleteMany({
          where: { boardId: { in: ["cc4-board-a1", "cc4-board-a2", "cc4-board-b1"] } },
        })
        .catch(() => {});
      await prisma.classCouncilBoard
        .deleteMany({ where: { id: { in: ["cc4-board-a1", "cc4-board-a2", "cc4-board-b1"] } } })
        .catch(() => {});
      await prisma.student.deleteMany({ where: { id: "cc4-stu-a1" } }).catch(() => {});
      await prisma.classGroup
        .deleteMany({ where: { id: { in: ["cc4-cg-a1", "cc4-cg-a2", "cc4-cg-b1"] } } })
        .catch(() => {});
    }
  });

  it("Aceite final 3: filtra resumos legados em leitura sem gravar e comprova contenção real de bloqueio entre matriz e SERE PDF", async () => {
    const { cookies } = await import("next/headers");
    const { logAudit } = await import("@/lib/audit");
    const { GET: getBoardRoute } = await import("@/app/api/conselho-classe/[boardId]/route");
    const { PUT: putMatrixRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/matrix/route"
    );
    const { POST: postImportPdfRoute } = await import(
      "@/app/api/conselho-classe/[boardId]/import-pdf/route"
    );
    const { default: ConselhoTurmaPage } = await import(
      "@/app/conselho-classe/[boardId]/page"
    );
    const { default: ConselhoPrintPage } = await import(
      "@/app/conselho-classe/[boardId]/imprimir/page"
    );
    const { applyCouncilSerePdfImport } = await import("@/services/classCouncilSerePdfService");

    const buildSerePdf = (opts: {
      subjects: string[];
      rows: Array<{ nro: number; name: string; grades: Array<[string, string, string]> }>;
    }): Uint8Array => {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const yFromBottom = (pdfY: number) => doc.internal.pageSize.getHeight() - pdfY;
      doc.setFontSize(8);
      doc.text("GOVERNO DO ESTADO DO PARANÁ", 28.3, yFromBottom(573.5));
      doc.text("DATA: 18/11/2026", 748, yFromBottom(573.5));
      doc.text("SECRETARIA DE ESTADO DA EDUCAÇÃO - SEED", 28.3, yFromBottom(562.5));
      doc.text("SISTEMA ESCOLA", 743.5, yFromBottom(562.5));
      doc.text("ESCOLA SINTÉTICA", 28.3, yFromBottom(539.5));
      doc.text("2026", 802, yFromBottom(539.5));
      doc.text("Curso: ENSINO FUNDAMENTAL", 28.3, yFromBottom(528.5));
      doc.text("Seriação: 8º Ano", 247.7, yFromBottom(528.5));
      doc.text("Turno: Manhã", 359.5, yFromBottom(528.5));
      doc.text("Turma: C5", 783.5, yFromBottom(528.5));
      doc.setFontSize(10);
      doc.text("RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL", 318.3, yFromBottom(503));
      doc.setFontSize(7);
      doc.text("Disciplinas", 300, yFromBottom(475));
      doc.text("Nro.", 31.1, yFromBottom(453.5));
      doc.text("Nome", 48.4, yFromBottom(453.5));
      const firstT1X = 164.2;
      const tStep = 18.4;
      const subjectStep = 73.7;
      opts.subjects.forEach((subj, sIdx) => {
        const baseX = firstT1X + sIdx * subjectStep;
        doc.text(subj, baseX + 5, yFromBottom(458));
        doc.text("T1", baseX, yFromBottom(445));
        doc.text("T2", baseX + tStep, yFromBottom(445));
        doc.text("T3", baseX + tStep * 2, yFromBottom(445));
      });
      let currentY = 432;
      for (const row of opts.rows) {
        doc.text(String(row.nro), 31.4, yFromBottom(currentY));
        doc.text(row.name, 48.4, yFromBottom(currentY));
        row.grades.forEach(([t1, t2, t3], sIdx) => {
          const baseX = firstT1X + sIdx * subjectStep;
          doc.text(t1, baseX - 2, yFromBottom(currentY));
          doc.text(t2, baseX + tStep - 2, yFromBottom(currentY));
          doc.text(t3, baseX + tStep * 2 - 2, yFromBottom(currentY));
          doc.text("--", baseX + tStep * 3 + 1.4, yFromBottom(currentY));
        });
        currentY -= 20;
      }
      return new Uint8Array(doc.output("arraybuffer"));
    };

    const legacySummaryPayload = JSON.stringify([
      { subjectId: "cc5-sub-a1-lp", subjectName: "Língua Portuguesa", grade: 5.2 },
      { subjectName: "Projeto Manual C5", grade: 4.1 },
      { subjectName: "", grade: "invalido" },
      { subjectId: "cc5-sub-a2-otherboard", subjectName: "História Outro Quadro", grade: 3.5 },
      { subjectId: "cc5-sub-b1-foreign", subjectName: "Física Outra Escola", grade: 2.5 },
    ]);
    const unreadableSummary = "{json-ilegivel";
    const emptyAfterFilterSummary = JSON.stringify([
      { subjectId: "cc5-sub-b1-foreign", subjectName: "Física Outra Escola", grade: 2.5 },
      { wrongField: 123 },
    ]);
    const nonArraySummary = JSON.stringify({ notAList: true });

    await prisma.classGroup.createMany({
      data: [
        {
          id: "cc5-cg-a1",
          schoolId: "school-alpha",
          name: "8º Ano C5",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
        {
          id: "cc5-cg-a2",
          schoolId: "school-alpha",
          name: "8º Ano C5 Outro",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
        {
          id: "cc5-cg-b1",
          schoolId: "school-beta",
          name: "8º Ano C5",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      ],
      skipDuplicates: true,
    });

    await prisma.student.createMany({
      data: [
        {
          id: "cc5-stu-a1-mat",
          schoolId: "school-alpha",
          classGroupId: "cc5-cg-a1",
          cgm: "9600011",
          name: "ESTUDANTE CC5 MATRIZ",
          phone: "41999960011",
          active: true,
        },
        {
          id: "cc5-stu-a1-sere",
          schoolId: "school-alpha",
          classGroupId: "cc5-cg-a1",
          cgm: "9600012",
          name: "ESTUDANTE CC5 SERE",
          phone: "41999960012",
          active: true,
        },
        {
          id: "cc5-stu-b1",
          schoolId: "school-beta",
          classGroupId: "cc5-cg-b1",
          cgm: "9600021",
          name: "ESTUDANTE CC5 BETA",
          phone: "41999960021",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilBoard.createMany({
      data: [
        { id: "cc5-board-a1", schoolId: "school-alpha", classGroupId: "cc5-cg-a1", year: 2026 },
        { id: "cc5-board-a2", schoolId: "school-alpha", classGroupId: "cc5-cg-a2", year: 2026 },
        { id: "cc5-board-b1", schoolId: "school-beta", classGroupId: "cc5-cg-b1", year: 2026 },
      ],
      skipDuplicates: true,
    });

    await prisma.classCouncilSubject.createMany({
      data: [
        {
          id: "cc5-sub-a1-lp",
          schoolId: "school-alpha",
          boardId: "cc5-board-a1",
          name: "Língua Portuguesa",
          displayOrder: 1,
          active: true,
        },
        {
          id: "cc5-sub-a1-mat",
          schoolId: "school-alpha",
          boardId: "cc5-board-a1",
          name: "Matemática",
          displayOrder: 2,
          active: true,
        },
        {
          id: "cc5-sub-a2-otherboard",
          schoolId: "school-alpha",
          boardId: "cc5-board-a2",
          name: "História Outro Quadro",
          displayOrder: 1,
          active: true,
        },
        {
          id: "cc5-sub-b1-foreign",
          schoolId: "school-beta",
          boardId: "cc5-board-b1",
          name: "Física Outra Escola",
          displayOrder: 1,
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.studentCouncilCard.createMany({
      data: [
        {
          id: "cc5-card-a1-mat",
          schoolId: "school-alpha",
          boardId: "cc5-board-a1",
          studentId: "cc5-stu-a1-mat",
          trimester1BelowAvgJson: legacySummaryPayload,
          trimester2BelowAvgJson: unreadableSummary,
          trimester3BelowAvgJson: JSON.stringify([{ subjectName: "Manual T3", grade: 4.0 }]),
        },
        {
          id: "cc5-card-a1-sere",
          schoolId: "school-alpha",
          boardId: "cc5-board-a1",
          studentId: "cc5-stu-a1-sere",
          trimester1BelowAvgJson: legacySummaryPayload,
          trimester2BelowAvgJson: emptyAfterFilterSummary,
          trimester3BelowAvgJson: nonArraySummary,
        },
        {
          id: "cc5-card-b1",
          schoolId: "school-beta",
          boardId: "cc5-board-b1",
          studentId: "cc5-stu-b1",
          trimester1BelowAvgJson: JSON.stringify([
            { subjectId: "cc5-sub-b1-foreign", subjectName: "Física Outra Escola", grade: 2.5 },
          ]),
        },
      ],
      skipDuplicates: true,
    });

    await prisma.user.createMany({
      data: [
        {
          id: "cc5-usr-ped",
          email: "cc5.ped@redeativa.local",
          name: "Pedagoga CC5",
          role: "PEDAGOGA",
          schoolId: "school-alpha",
          active: true,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.userSchool.createMany({
      data: [
        {
          id: "cc5-us-ped",
          userId: "cc5-usr-ped",
          schoolId: "school-alpha",
          role: "PEDAGOGA",
          active: true,
        },
      ],
      skipDuplicates: true,
    });

    testAuthState.useRealPermissions = true;
    testAuthState.useRealCurrentSchool = true;
    testAuthState.pendingSessionUser = {
      id: "cc5-usr-ped",
      email: "cc5.ped@redeativa.local",
      schoolId: "school-alpha",
      active: true,
    };
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === "active_school_id" ? { name, value: "school-alpha" } : undefined,
    } as never);

    const blockerClient = new PrismaClient({
      datasources: { db: { url: process.env.RLS_PHASE_A_DB_URL } },
    });

    try {
      // --- CRITÉRIO 1: Leitura filtra resumos legados sem gravar no banco ---
      vi.mocked(logAudit).mockClear();
      const getRes = await getBoardRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc5-board-a1"),
        { params: Promise.resolve({ boardId: "cc5-board-a1" }) }
      );
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      for (const cardId of ["cc5-card-a1-mat", "cc5-card-a1-sere"]) {
        const readCard = getBody.board.studentCards.find((c: { id: string }) => c.id === cardId);
        const parsedRead = JSON.parse(readCard.trimester1BelowAvgJson) as Array<{
          subjectName: string;
        }>;
        expect(parsedRead.map((i) => i.subjectName)).toEqual([
          "Língua Portuguesa",
          "Projeto Manual C5",
        ]);
      }
      const readMatCard = getBody.board.studentCards.find(
        (c: { id: string }) => c.id === "cc5-card-a1-mat"
      );
      const readSereCard = getBody.board.studentCards.find(
        (c: { id: string }) => c.id === "cc5-card-a1-sere"
      );
      expect(readMatCard.trimester2BelowAvgJson).toBeNull();
      expect(readSereCard.trimester2BelowAvgJson).toBeNull();
      expect(readSereCard.trimester3BelowAvgJson).toBeNull();

      // Detalhe SSR e Impressão SSR preservam contrato sem gravar no banco
      await expect(
        ConselhoTurmaPage({ params: Promise.resolve({ boardId: "cc5-board-a1" }) })
      ).resolves.toBeTruthy();
      await expect(
        ConselhoPrintPage({ params: Promise.resolve({ boardId: "cc5-board-a1" }) })
      ).resolves.toBeTruthy();

      // Banco permanece intacto (resumo legado bruto ainda contém os 4 itens) e sem logAudit
      const rawCardMatBefore = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: "cc5-card-a1-mat" },
      });
      const rawCardSereBefore = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: "cc5-card-a1-sere" },
      });
      expect(rawCardMatBefore.trimester1BelowAvgJson).toBe(legacySummaryPayload);
      expect(rawCardSereBefore.trimester1BelowAvgJson).toBe(legacySummaryPayload);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // Matriz e SERE PDF com cenários independentes (cc5-card-a1-mat vs cc5-card-a1-sere)
      const matSaveRes = await putMatrixRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc5-board-a1/matrix", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: 1,
            entries: [
              {
                studentId: "cc5-stu-a1-mat",
                subjectId: "cc5-sub-a1-mat",
                descriptorCodes: [1],
                grade: 4.9,
              },
            ],
          }),
        }),
        { params: Promise.resolve({ boardId: "cc5-board-a1" }) }
      );
      expect(matSaveRes.status).toBe(200);
      // Confirma que cc5-card-a1-sere ainda estava intacta antes do SERE
      expect(
        (
          await prisma.studentCouncilCard.findUniqueOrThrow({
            where: { id: "cc5-card-a1-sere" },
          })
        ).trimester1BelowAvgJson
      ).toBe(legacySummaryPayload);

      const sereFd1 = new FormData();
      sereFd1.set("mode", "apply");
      sereFd1.set(
        "files",
        new File(
          [
            Buffer.from(
              buildSerePdf({
                subjects: ["MATEMATICA"],
                rows: [{ nro: 1, name: "ESTUDANTE CC5 SERE", grades: [["4.4", "--", "--"]] }],
              })
            ),
          ],
          "sere1.pdf",
          { type: "application/pdf" }
        )
      );
      const sereSaveRes = await postImportPdfRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc5-board-a1/import-pdf", {
          method: "POST",
          body: sereFd1,
        }),
        { params: Promise.resolve({ boardId: "cc5-board-a1" }) }
      );
      expect(sereSaveRes.status).toBe(200);

      for (const cid of ["cc5-card-a1-mat", "cc5-card-a1-sere"]) {
        const refreshed = await prisma.studentCouncilCard.findUniqueOrThrow({ where: { id: cid } });
        const summary = JSON.parse(refreshed.trimester1BelowAvgJson || "[]") as Array<{
          subjectName: string;
        }>;
        expect(summary.map((i) => i.subjectName)).toEqual([
          "Matemática",
          "Língua Portuguesa",
          "Projeto Manual C5",
        ]);
      }

      // --- CRITÉRIO 2: Barreira explícita de bloqueio entre PUT /matrix e POST /import-pdf ---
      let releaseBlocker!: () => void;
      let signalBlockerReady!: () => void;
      const blockerReady = new Promise<void>((res) => {
        signalBlockerReady = res;
      });
      const blockerHold = new Promise<void>((res) => {
        releaseBlocker = res;
      });

      const blockerPromise = blockerClient.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "ClassCouncilBoard"
          WHERE "id" = 'cc5-board-a1' AND "schoolId" = 'school-alpha'
          FOR UPDATE
        `;
        signalBlockerReady();
        await blockerHold;
      });

      await blockerReady;

      // Dispara PUT /matrix (1ª criação em LP T2) e POST /import-pdf (1ª criação em LP T2 + Matemática T2) enquanto o lock está preso
      const concPdf = buildSerePdf({
        subjects: ["LINGUA PORTU", "MATEMATICA"],
        rows: [
          {
            nro: 1,
            name: "ESTUDANTE CC5 MATRIZ",
            grades: [
              ["--", "4.3", "--"],
              ["--", "5.1", "--"],
            ],
          },
        ],
      });
      const concFd = new FormData();
      concFd.set("mode", "apply");
      concFd.set("files", new File([Buffer.from(concPdf)], "conc.pdf", { type: "application/pdf" }));

      const matrixConcurrentPromise = putMatrixRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc5-board-a1/matrix", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: 2,
            entries: [
              {
                studentId: "cc5-stu-a1-mat",
                subjectId: "cc5-sub-a1-lp",
                descriptorCodes: [2],
                grade: 4.7,
              },
            ],
          }),
        }),
        { params: Promise.resolve({ boardId: "cc5-board-a1" }) }
      );
      const sereConcurrentPromise = postImportPdfRoute(
        new Request("http://127.0.0.1/api/conselho-classe/cc5-board-a1/import-pdf", {
          method: "POST",
          body: concFd,
        }),
        { params: Promise.resolve({ boardId: "cc5-board-a1" }) }
      );

      // Confirma contenção real em pg_stat_activity (2 sessões aguardando lock do mesmo quadro antes de liberar)
      let waitingCount = 0;
      for (let i = 0; i < 40; i++) {
        const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT COUNT(*)::bigint AS waiting
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND cardinality(pg_blocking_pids(pid)) > 0
        `;
        waitingCount = Number(rows[0]?.waiting ?? 0n);
        if (waitingCount >= 2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(waitingCount).toBeGreaterThanOrEqual(2);

      releaseBlocker();
      const [, matrixConcurrentRes, sereConcurrentRes] = await Promise.all([
        blockerPromise,
        matrixConcurrentPromise,
        sereConcurrentPromise,
      ]);

      expect(matrixConcurrentRes.status).toBe(200);
      expect(sereConcurrentRes.status).toBe(200);

      // Unicidade e consistência entre notas persistidas e resumo em T2 (LP + Matemática na mesma ficha)
      const lpT2Entries = await prisma.studentCouncilSubjectEntry.findMany({
        where: { cardId: "cc5-card-a1-mat", subjectId: "cc5-sub-a1-lp", trimester: 2 },
      });
      const matT2Entries = await prisma.studentCouncilSubjectEntry.findMany({
        where: { cardId: "cc5-card-a1-mat", subjectId: "cc5-sub-a1-mat", trimester: 2 },
      });
      expect(lpT2Entries).toHaveLength(1);
      expect(matT2Entries).toHaveLength(1);

      const cardAfterT2 = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: "cc5-card-a1-mat" },
      });
      const t2Summary = JSON.parse(cardAfterT2.trimester2BelowAvgJson || "[]") as Array<{
        subjectId: string;
        grade: number;
      }>;
      expect(t2Summary).toEqual([
        expect.objectContaining({ subjectId: "cc5-sub-a1-lp", grade: lpT2Entries[0].grade }),
        expect.objectContaining({ subjectId: "cc5-sub-a1-mat", grade: matT2Entries[0].grade }),
      ]);

      // --- Recuperação real de P2002 na criação de disciplina em nova transação withTenantContext ---
      // Insere "Arte" (active: false) antes de iniciar tx1 para provocar P2002 real do PostgreSQL quando tx1
      // tentar executar classCouncilSubject.create (sem deadlock de FK com o lock FOR UPDATE do board);
      // na tentativa 2 (novo txid), a transação é reaberta, revalida escola/quadro e reativa "Arte".
      await prisma.classCouncilSubject.create({
        data: {
          schoolId: "school-alpha",
          boardId: "cc5-board-a1",
          name: "Arte",
          displayOrder: 99,
          active: false,
        },
      });

      vi.mocked(logAudit).mockClear();
      const origTransaction = prisma.$transaction.bind(prisma);
      const txIds: string[] = [];
      let createCalledOnAttempt1 = false;
      let attempt2RevalidatedScope = false;

      const txSpy = vi.spyOn(prisma, "$transaction").mockImplementation(((
        fn: (tx: unknown) => Promise<unknown>,
        opts?: unknown
      ) => {
        if (typeof fn !== "function") {
          return origTransaction(fn as never, opts as never);
        }
        return origTransaction(async (tx) => {
          const txidRows = await tx.$queryRaw<Array<{ txid: string }>>`
            SELECT txid_current()::text AS txid
          `;
          txIds.push(txidRows[0].txid);
          const currentAttempt = txIds.length;

          const origSubjCreate = tx.classCouncilSubject.create.bind(tx.classCouncilSubject);
          const origSubjFindUnique = tx.classCouncilSubject.findUnique.bind(tx.classCouncilSubject);
          const origBoardFindUnique = tx.classCouncilBoard.findUnique.bind(tx.classCouncilBoard);

          if (currentAttempt === 1) {
            // Na 1ª tentativa, oculta apenas "Arte" do snapshot inicial de tx1 para forçar a chegada em create() e P2002 real do PG
            vi.spyOn(tx.classCouncilBoard, "findUnique").mockImplementation((async (args: {
              include?: unknown;
            }) => {
              const res = (await origBoardFindUnique(args as never)) as {
                subjects?: Array<{ name: string }>;
              } | null;
              if (res && Array.isArray(res.subjects)) {
                res.subjects = res.subjects.filter((s) => s.name !== "Arte");
              }
              return res;
            }) as never);
            vi.spyOn(tx.classCouncilSubject, "findUnique").mockImplementation((async (args: {
              where?: { boardId_name?: { boardId: string; name: string } };
            }) => {
              if (
                args?.where?.boardId_name?.boardId === "cc5-board-a1" &&
                args?.where?.boardId_name?.name === "Arte"
              ) {
                return null;
              }
              return origSubjFindUnique(args as never);
            }) as never);
            vi.spyOn(tx.classCouncilSubject, "create").mockImplementation((async (args: {
              data: { name: string };
            }) => {
              if (args.data.name === "Arte") {
                createCalledOnAttempt1 = true;
                expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
              }
              return origSubjCreate(args as never);
            }) as never);
          } else if (currentAttempt === 2) {
            vi.spyOn(tx.classCouncilBoard, "findUnique").mockImplementation((async (args: {
              include?: unknown;
            }) => {
              const res = (await origBoardFindUnique(args as never)) as {
                schoolId?: string;
                subjects?: Array<{ name: string; schoolId?: string; boardId?: string }>;
              } | null;
              const arteInBoard = res?.subjects?.find((s) => s.name === "Arte");
              if (
                res?.schoolId === "school-alpha" &&
                arteInBoard?.schoolId === "school-alpha" &&
                arteInBoard?.boardId === "cc5-board-a1"
              ) {
                attempt2RevalidatedScope = true;
              }
              return res;
            }) as never);
          }

          return fn(tx);
        }, opts as never);
      }) as never);

      try {
        const retryResult = await applyCouncilSerePdfImport({
          boardId: "cc5-board-a1",
          schoolId: "school-alpha",
          actor: { email: "cc5.ped@redeativa.local", name: "Pedagoga CC5" },
          batch: {
            files: [],
            warnings: [],
            totalGrades: 1,
            belowAverageGrades: 1,
            subjects: [
              {
                rawHeader: "ARTE",
                name: "Arte",
                matchKey: "arte",
                sourceFiles: ["artes.pdf"],
              },
            ],
            students: [
              {
                rowNumber: 1,
                rawName: "ESTUDANTE CC5 MATRIZ",
                normalizedName: "ESTUDANTE CC5 MATRIZ",
                isAmbiguousInPdf: false,
                hasAnyGrade: true,
                grades: [{ subjectMatchKey: "arte", subjectName: "Arte", trimester: 3, grade: 5.5 }],
              },
            ],
          },
        });
        expect(createCalledOnAttempt1).toBe(true);
        expect(txIds).toHaveLength(2);
        expect(txIds[0]).not.toBe(txIds[1]);
        expect(attempt2RevalidatedScope).toBe(true);
        expect(retryResult.summary.subjectsMatched).toBe(1);
        expect(retryResult.summary.subjectsCreated).toBe(0);

        const arteSubjects = await prisma.classCouncilSubject.findMany({
          where: { boardId: "cc5-board-a1", name: "Arte" },
        });
        expect(arteSubjects).toHaveLength(1);
        expect(arteSubjects[0].active).toBe(true);

        const t3CardAfterRetry = await prisma.studentCouncilCard.findUniqueOrThrow({
          where: { id: "cc5-card-a1-mat" },
        });
        const t3List = JSON.parse(t3CardAfterRetry.trimester3BelowAvgJson || "[]") as Array<{
          subjectName: string;
        }>;
        expect(t3List.map((i) => i.subjectName)).toEqual(["Arte", "Manual T3"]);
        expect(vi.mocked(logAudit)).toHaveBeenCalledTimes(1);
      } finally {
        txSpy.mockRestore();
      }

      // Escola Beta permanece intacta
      expect(
        (await prisma.studentCouncilCard.findUniqueOrThrow({ where: { id: "cc5-card-b1" } }))
          .trimester1BelowAvgJson
      ).toContain("cc5-sub-b1-foreign");
    } finally {
      await blockerClient.$disconnect().catch(() => {});
      testAuthState.useRealPermissions = false;
      testAuthState.useRealCurrentSchool = false;
      testAuthState.pendingSessionUser = null;
      vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      await prisma.userSchool.deleteMany({ where: { id: "cc5-us-ped" } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: "cc5-usr-ped" } }).catch(() => {});
      await prisma.studentCouncilSubjectEntry
        .deleteMany({
          where: { cardId: { in: ["cc5-card-a1-mat", "cc5-card-a1-sere", "cc5-card-b1"] } },
        })
        .catch(() => {});
      await prisma.studentCouncilCard
        .deleteMany({ where: { id: { in: ["cc5-card-a1-mat", "cc5-card-a1-sere", "cc5-card-b1"] } } })
        .catch(() => {});
      await prisma.classCouncilSubject
        .deleteMany({
          where: { boardId: { in: ["cc5-board-a1", "cc5-board-a2", "cc5-board-b1"] } },
        })
        .catch(() => {});
      await prisma.classCouncilBoard
        .deleteMany({ where: { id: { in: ["cc5-board-a1", "cc5-board-a2", "cc5-board-b1"] } } })
        .catch(() => {});
      await prisma.student
        .deleteMany({ where: { id: { in: ["cc5-stu-a1-mat", "cc5-stu-a1-sere", "cc5-stu-b1"] } } })
        .catch(() => {});
      await prisma.classGroup
        .deleteMany({ where: { id: { in: ["cc5-cg-a1", "cc5-cg-a2", "cc5-cg-b1"] } } })
        .catch(() => {});
    }
  });

  it("isola os portais docentes por token (Matriz e Pré-Conselho) com withTenantContext, cookie divergente ignorado, rejeições e preservação entre escolas", async () => {
    const { cookies } = await import("next/headers");
    const originalWithTenantContext = rlsTenantContext.withTenantContext;
    const observedContexts: Array<{ schoolId: string; pgSetting: string | null }> = [];
    const spy = vi
      .spyOn(rlsTenantContext, "withTenantContext")
      .mockImplementation(async (client, schoolId, fn) => {
        return originalWithTenantContext(client, schoolId, async (tx) => {
          const rows = await tx.$queryRaw<Array<{ val: string | null }>>`
            SELECT NULLIF(current_setting('app.current_school_id', true), '') AS val
          `;
          observedContexts.push({ schoolId, pgSetting: rows[0]?.val ?? null });
          return fn(tx);
        });
      });

    try {
      await prisma.school.createMany({
        data: [
          { id: "tp-school-alpha", name: "Colégio Alpha", inepCode: "99110101", active: true },
          { id: "tp-school-beta", name: "Colégio Beta", inepCode: "99110102", active: true },
          { id: "tp-school-inactive", name: "Colégio Inativo", inepCode: "99110103", active: false },
        ],
      });

      await prisma.classGroup.createMany({
        data: [
          { id: "tp-cg-alpha", schoolId: "tp-school-alpha", name: "6º Ano A", shift: "Manhã", segment: "FUNDAMENTAL" },
          { id: "tp-cg-beta", schoolId: "tp-school-beta", name: "6º Ano A", shift: "Manhã", segment: "FUNDAMENTAL" },
          { id: "tp-cg-inactive", schoolId: "tp-school-inactive", name: "6º Ano A", shift: "Manhã", segment: "FUNDAMENTAL" },
        ],
      });

      await prisma.student.createMany({
        data: [
          { id: "tp-stu-alpha", schoolId: "tp-school-alpha", classGroupId: "tp-cg-alpha", name: "Aluno Alpha 1", phone: "41999990101", active: true },
          { id: "tp-stu-beta", schoolId: "tp-school-beta", classGroupId: "tp-cg-beta", name: "Aluno Beta 1", phone: "41999990102", active: true },
          { id: "tp-stu-inactive", schoolId: "tp-school-inactive", classGroupId: "tp-cg-inactive", name: "Aluno Inativo 1", phone: "41999990103", active: true },
        ],
      });

      await prisma.classCouncilBoard.createMany({
        data: [
          { id: "tp-board-alpha", schoolId: "tp-school-alpha", classGroupId: "tp-cg-alpha", year: 2026 },
          { id: "tp-board-beta", schoolId: "tp-school-beta", classGroupId: "tp-cg-beta", year: 2026 },
          { id: "tp-board-inactive", schoolId: "tp-school-inactive", classGroupId: "tp-cg-inactive", year: 2026 },
        ],
      });

      await prisma.classCouncilSubject.createMany({
        data: [
          {
            id: "tp-subj-alpha",
            schoolId: "tp-school-alpha",
            boardId: "tp-board-alpha",
            name: "Matemática",
            teacherName: "Prof. Alpha",
            teacherEmail: "prof.alpha@escola.pr.gov.br",
          },
          {
            id: "tp-subj-alpha-other",
            schoolId: "tp-school-alpha",
            boardId: "tp-board-alpha",
            name: "História",
            teacherName: "Prof. Outro",
            teacherEmail: "prof.outro@escola.pr.gov.br",
          },
          {
            id: "tp-subj-beta",
            schoolId: "tp-school-beta",
            boardId: "tp-board-beta",
            name: "Matemática",
            teacherName: "Prof. Alpha",
            teacherEmail: "prof.alpha@escola.pr.gov.br",
          },
          {
            id: "tp-subj-inactive",
            schoolId: "tp-school-inactive",
            boardId: "tp-board-inactive",
            name: "Matemática",
            teacherName: "Prof. Alpha",
            teacherEmail: "prof.alpha@escola.pr.gov.br",
          },
        ],
      });

      await prisma.studentCouncilCard.createMany({
        data: [
          { id: "tp-card-alpha", schoolId: "tp-school-alpha", boardId: "tp-board-alpha", studentId: "tp-stu-alpha" },
          { id: "tp-card-beta", schoolId: "tp-school-beta", boardId: "tp-board-beta", studentId: "tp-stu-beta" },
        ],
      });

      const preCouncilAlphaJson = JSON.stringify({
        version: 1,
        periodLabel: "1º Trimestre",
        objectiveText: "Alinhamento prévio",
        responsiblePedagogueName: "Pedagoga Teste",
        responsiblePedagogueRole: "Pedagoga Responsável",
        conversations: [
          {
            id: "tp-conv-alpha",
            subjectId: "tp-subj-alpha",
            subjectName: "Matemática",
            teacherName: "Prof. Alpha",
            teacherEmail: "prof.alpha@escola.pr.gov.br",
            monitoredStudentIds: ["tp-stu-alpha"],
            monitoredStudentsNotes: "Acompanhamento inicial Alpha",
            agreements: "Combinado pedagógico Alpha",
            conversationStatus: "COMPLETED",
            conversationDate: "2026-11-20",
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
          {
            id: "tp-conv-alpha-other",
            subjectId: "tp-subj-alpha-other",
            subjectName: "História",
            teacherName: "Prof. Outro",
            teacherEmail: "prof.outro@escola.pr.gov.br",
            monitoredStudentIds: ["tp-stu-alpha"],
            monitoredStudentsNotes: "Nota privada Outro",
            agreements: "Combinado privado Outro",
            conversationStatus: "COMPLETED",
            conversationDate: "2026-11-20",
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
        ],
        synthesis: {
          mainDifficulties: "Frequência",
          priorityStudents: "Aluno Alpha 1",
          attendanceIssues: "Poucas faltas",
          behaviorIssues: "",
          pedagogicalActions: "Contato semanal",
        },
      });

      const preCouncilBetaJson = JSON.stringify({
        version: 1,
        periodLabel: "1º Trimestre",
        objectiveText: "Alinhamento Beta",
        responsiblePedagogueName: "Pedagoga Beta",
        responsiblePedagogueRole: "Pedagoga Responsável",
        conversations: [
          {
            id: "tp-conv-beta",
            subjectId: "tp-subj-beta",
            subjectName: "Matemática",
            teacherName: "Prof. Alpha",
            teacherEmail: "prof.alpha@escola.pr.gov.br",
            monitoredStudentIds: ["tp-stu-beta"],
            monitoredStudentsNotes: "Nota Beta intacta",
            agreements: "Combinado Beta intacto",
            conversationStatus: "COMPLETED",
            conversationDate: "2026-11-20",
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
        ],
        synthesis: {
          mainDifficulties: "Beta",
          priorityStudents: "",
          attendanceIssues: "",
          behaviorIssues: "",
          pedagogicalActions: "",
        },
      });

      await prisma.classCouncilTrimester.createMany({
        data: [
          {
            id: "tp-trim-alpha-1",
            schoolId: "tp-school-alpha",
            boardId: "tp-board-alpha",
            trimester: 1,
            preCouncilJson: preCouncilAlphaJson,
          },
          {
            id: "tp-trim-beta-1",
            schoolId: "tp-school-beta",
            boardId: "tp-board-beta",
            trimester: 1,
            preCouncilJson: preCouncilBetaJson,
          },
        ],
      });

      // Cookie tentando apontar para school-beta NÃO pode sobrescrever o escopo do token de school-alpha
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) => (name === "active_school_id" ? { value: "tp-school-beta" } : undefined),
      } as never);

      const { token: teacherTokenAlpha } = createCouncilTeacherToken({
        schoolId: "tp-school-alpha",
        boardId: "tp-board-alpha",
        trimester: 1,
        subjectId: "tp-subj-alpha",
        expiresInDays: 7,
      });

      const { token: preCouncilTokenAlpha } = createPreCouncilTeacherToken({
        schoolId: "tp-school-alpha",
        boardId: "tp-board-alpha",
        trimester: 1,
        conversationId: "tp-conv-alpha",
        expiresInDays: 7,
      });

      // 1. SSR legítimo do Portal da Matriz (professor/[token])
      observedContexts.length = 0;
      const teacherSsrHtml = renderToStaticMarkup(
        await ProfessorConselhoPage({ params: Promise.resolve({ token: teacherTokenAlpha }) })
      );
      expect(teacherSsrHtml).toContain("Colégio Alpha");
      expect(teacherSsrHtml).toContain("6º Ano A");
      expect(teacherSsrHtml).not.toContain("Colégio Beta");
      expect(observedContexts.length).toBeGreaterThan(0);
      expect(observedContexts.every((c) => c.schoolId === "tp-school-alpha" && c.pgSetting === "tp-school-alpha")).toBe(true);

      // 2. POST legítimo no Portal da Matriz (tentando forçar schoolId=tp-school-beta na query)
      observedContexts.length = 0;
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const postTeacherRes = await postTeacherPortalRoute(
        new Request(
          `http://127.0.0.1/api/conselho-classe/teacher-portal/${teacherTokenAlpha}?schoolId=tp-school-beta&boardId=tp-board-beta`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ googleIdToken: "valid-google-token" }),
          }
        ),
        { params: Promise.resolve({ token: teacherTokenAlpha }) }
      );
      expect(postTeacherRes.status).toBe(200);
      const postTeacherJson = await postTeacherRes.json();
      expect(postTeacherJson.council.schoolName).toBe("Colégio Alpha");
      expect(postTeacherJson.council.subjects.map((s: { id: string }) => s.id)).toEqual(["tp-subj-alpha"]);
      expect(Object.keys(postTeacherJson.council.preCouncil.conversationsBySubjectId)).toEqual(["tp-subj-alpha"]);
      expect(observedContexts.every((c) => c.schoolId === "tp-school-alpha" && c.pgSetting === "tp-school-alpha")).toBe(true);

      // 3. PUT legítimo no Portal da Matriz + logAudit pós-commit
      observedContexts.length = 0;
      vi.mocked(logAudit).mockClear();
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const putTeacherRes = await putTeacherPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/teacher-portal/${teacherTokenAlpha}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "valid-google-token",
            subjectId: "tp-subj-alpha",
            entries: [
              {
                studentId: "tp-stu-alpha",
                descriptorCodes: [1, 2],
              },
            ],
            preCouncil: {
              monitoredStudentIds: ["tp-stu-alpha"],
              monitoredStudentsNotes: "Atualizado pelo docente",
            },
            confirmAck: false,
          }),
        }),
        { params: Promise.resolve({ token: teacherTokenAlpha }) }
      );
      expect(putTeacherRes.status).toBe(200);
      expect(observedContexts.every((c) => c.schoolId === "tp-school-alpha" && c.pgSetting === "tp-school-alpha")).toBe(true);
      expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolId: "tp-school-alpha",
          entityId: "tp-board-alpha",
          action: "TEACHER_SUBMIT_COUNCIL_SUBJECT",
        })
      );

      const persistedEntry = await prisma.studentCouncilSubjectEntry.findFirst({
        where: { cardId: "tp-card-alpha", subjectId: "tp-subj-alpha", trimester: 1 },
      });
      expect(persistedEntry?.schoolId).toBe("tp-school-alpha");
      expect(persistedEntry?.descriptorCodes).toEqual([1, 2]);

      // 4. SSR legítimo do Portal de Pré-Conselho (pre-conselho/[token])
      observedContexts.length = 0;
      const preCouncilSsrHtml = renderToStaticMarkup(
        await ProfessorPreConselhoPage({ params: Promise.resolve({ token: preCouncilTokenAlpha }) })
      );
      expect(preCouncilSsrHtml).toContain("Colégio Alpha");
      expect(preCouncilSsrHtml).not.toContain("Colégio Beta");
      expect(observedContexts.every((c) => c.schoolId === "tp-school-alpha" && c.pgSetting === "tp-school-alpha")).toBe(true);

      // 5. POST e PUT legítimos no Portal de Pré-Conselho + logAudit pós-commit
      observedContexts.length = 0;
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const postPreCouncilRes = await postPreCouncilPortalRoute(
        new Request(
          `http://127.0.0.1/api/conselho-classe/pre-council-portal/${preCouncilTokenAlpha}?schoolId=tp-school-beta`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ googleIdToken: "valid-google-token" }),
          }
        ),
        { params: Promise.resolve({ token: preCouncilTokenAlpha }) }
      );
      expect(postPreCouncilRes.status).toBe(200);
      const postPreCouncilJson = await postPreCouncilRes.json();
      expect(postPreCouncilJson.preCouncil.schoolName).toBe("Colégio Alpha");
      expect(postPreCouncilJson.preCouncil.conversations.map((c: { id: string }) => c.id)).toEqual(["tp-conv-alpha"]);
      expect(observedContexts.every((c) => c.schoolId === "tp-school-alpha" && c.pgSetting === "tp-school-alpha")).toBe(true);

      observedContexts.length = 0;
      vi.mocked(logAudit).mockClear();
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const putPreCouncilRes = await putPreCouncilPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/pre-council-portal/${preCouncilTokenAlpha}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "valid-google-token",
            conversationId: "tp-conv-alpha",
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token: preCouncilTokenAlpha }) }
      );
      expect(putPreCouncilRes.status).toBe(200);
      expect(observedContexts.every((c) => c.schoolId === "tp-school-alpha" && c.pgSetting === "tp-school-alpha")).toBe(true);
      expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolId: "tp-school-alpha",
          entityId: "tp-trim-alpha-1",
          action: "TEACHER_ACK_PRE_COUNCIL",
        })
      );

      // 6. Token inválido/expirado não consulta conteúdo nem audita
      observedContexts.length = 0;
      vi.mocked(logAudit).mockClear();
      const invalidTeacherSsr = renderToStaticMarkup(
        await ProfessorConselhoPage({ params: Promise.resolve({ token: "token-invalido-123" }) })
      );
      expect(invalidTeacherSsr).toContain("Link Inválido");
      const invalidPreSsr = renderToStaticMarkup(
        await ProfessorPreConselhoPage({ params: Promise.resolve({ token: "token-invalido-123" }) })
      );
      expect(invalidPreSsr).toContain("Link Inválido");
      expect(observedContexts).toHaveLength(0);

      const invalidPostTeacher = await postTeacherPortalRoute(
        new Request("http://127.0.0.1/api/conselho-classe/teacher-portal/token-invalido-123", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-google-token" }),
        }),
        { params: Promise.resolve({ token: "token-invalido-123" }) }
      );
      expect(invalidPostTeacher.status).toBe(401);

      const { token: expiredPreToken } = createPreCouncilTeacherToken({
        schoolId: "tp-school-alpha",
        boardId: "tp-board-alpha",
        trimester: 1,
        expiresInDays: 1,
        nowMs: Date.now() - 10 * 24 * 60 * 60 * 1000,
      });
      const expiredPostPre = await postPreCouncilPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/pre-council-portal/${expiredPreToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-google-token" }),
        }),
        { params: Promise.resolve({ token: expiredPreToken }) }
      );
      expect(expiredPostPre.status).toBe(401);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // 7. Vínculos divergentes (escola x quadro, escola inativa, trimestre ausente, body adulterado e docente não atribuído)
      vi.mocked(logAudit).mockClear();
      const { token: crossSchoolToken } = createCouncilTeacherToken({
        schoolId: "tp-school-beta",
        boardId: "tp-board-alpha",
        trimester: 1,
        expiresInDays: 7,
      });
      const crossSsr = renderToStaticMarkup(
        await ProfessorConselhoPage({ params: Promise.resolve({ token: crossSchoolToken }) })
      );
      expect(crossSsr).toContain("Conselho não encontrado");

      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const crossPost = await postTeacherPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/teacher-portal/${crossSchoolToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-google-token" }),
        }),
        { params: Promise.resolve({ token: crossSchoolToken }) }
      );
      expect(crossPost.status).toBe(403);

      const { token: inactiveSchoolToken } = createPreCouncilTeacherToken({
        schoolId: "tp-school-inactive",
        boardId: "tp-board-inactive",
        trimester: 1,
        expiresInDays: 7,
      });
      const inactiveSsr = renderToStaticMarkup(
        await ProfessorPreConselhoPage({ params: Promise.resolve({ token: inactiveSchoolToken }) })
      );
      expect(inactiveSsr).toContain("Conselho não encontrado");
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const inactivePost = await postPreCouncilPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/pre-council-portal/${inactiveSchoolToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-google-token" }),
        }),
        { params: Promise.resolve({ token: inactiveSchoolToken }) }
      );
      expect(inactivePost.status).toBe(403);

      // Trimestre divergente / conversa inexistente
      const { token: wrongTrimToken } = createPreCouncilTeacherToken({
        schoolId: "tp-school-alpha",
        boardId: "tp-board-alpha",
        trimester: 2,
        conversationId: "tp-conv-alpha",
        expiresInDays: 7,
      });
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const wrongTrimPost = await postPreCouncilPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/pre-council-portal/${wrongTrimToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-google-token" }),
        }),
        { params: Promise.resolve({ token: wrongTrimToken }) }
      );
      expect(wrongTrimPost.status).toBe(404);

      // Tentativa de adulterar subjectId/conversationId para school-beta no PUT
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const tamperedTeacherPut = await putTeacherPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/teacher-portal/${teacherTokenAlpha}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "valid-google-token",
            subjectId: "tp-subj-beta",
            entries: [{ studentId: "tp-stu-beta", descriptorCodes: [1] }],
          }),
        }),
        { params: Promise.resolve({ token: teacherTokenAlpha }) }
      );
      expect(tamperedTeacherPut.status).toBe(403);

      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.alpha@escola.pr.gov.br", name: "Prof. Alpha" } as never,
      });
      const tamperedPrePut = await putPreCouncilPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/pre-council-portal/${preCouncilTokenAlpha}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "valid-google-token",
            conversationId: "tp-conv-beta",
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token: preCouncilTokenAlpha }) }
      );
      expect(tamperedPrePut.status).toBe(403);

      // Docente sem atribuição no quadro
      vi.mocked(verifyEscolaGoogleIdToken).mockResolvedValueOnce({
        ok: true,
        tokenInfo: { email: "prof.intruso@escola.pr.gov.br", name: "Prof. Intruso" } as never,
      });
      const unassignedPost = await postTeacherPortalRoute(
        new Request(`http://127.0.0.1/api/conselho-classe/teacher-portal/${teacherTokenAlpha}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "valid-google-token" }),
        }),
        { params: Promise.resolve({ token: teacherTokenAlpha }) }
      );
      expect(unassignedPost.status).toBe(403);
      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();

      // Preservação integral de school-beta após todas as tentativas
      const betaEntries = await prisma.studentCouncilSubjectEntry.findMany({
        where: { schoolId: "tp-school-beta" },
      });
      expect(betaEntries).toHaveLength(0);
      const betaTrim = await prisma.classCouncilTrimester.findUnique({
        where: { id: "tp-trim-beta-1" },
      });
      expect(betaTrim?.preCouncilJson).toBe(preCouncilBetaJson);
    } finally {
      spy.mockRestore();
      vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      await prisma.studentCouncilSubjectEntry
        .deleteMany({ where: { schoolId: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
      await prisma.classCouncilTrimester
        .deleteMany({ where: { schoolId: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
      await prisma.studentCouncilCard
        .deleteMany({ where: { schoolId: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
      await prisma.classCouncilSubject
        .deleteMany({ where: { schoolId: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
      await prisma.classCouncilBoard
        .deleteMany({ where: { schoolId: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
      await prisma.student
        .deleteMany({ where: { schoolId: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
      await prisma.classGroup
        .deleteMany({ where: { schoolId: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
      await prisma.school
        .deleteMany({ where: { id: { in: ["tp-school-alpha", "tp-school-beta", "tp-school-inactive"] } } })
        .catch(() => {});
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
                id: "tp-stu-alpha",
                schoolId: "tp-school-alpha",
                classGroupId: "tp-cg-alpha",
                phone: "41999991111",
                name: "Estudante Alpha",
              }
        ),
      },
      classGroup: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === "cg-piloto"
            ? { id: "cg-piloto", schoolId: "default-leopoldina", name: "7º Ano A" }
            : { id: "tp-cg-alpha", schoolId: "tp-school-alpha", name: "6º Ano A" }
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
      testAuthState.schoolId = "tp-school-alpha";
      testAuthState.inepCode = "99000101";
      const resAlphaGlobal = await sendMessageHandler(
        new Request("http://127.0.0.1/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "tp-stu-alpha",
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