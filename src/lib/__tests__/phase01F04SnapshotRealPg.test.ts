import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const hoisted = vi.hoisted(() => ({
  authSession: null as any,
  cookiesMap: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (key: string) =>
      hoisted.cookiesMap.has(key) ? { name: key, value: hoisted.cookiesMap.get(key)! } : undefined,
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.authSession),
}));

vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
  RATE_LIMIT_POLICIES: {
    AI_ENDPOINT: { key: "ai", max: 100, windowSeconds: 60 },
  },
}));

import { POST as formalizeAtaPost } from "@/app/api/ai/formalize-ata/route";

const hasIsolatedDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return (
      process.env.REDEATIVA_TEST_ISOLATED_DB === "1" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/redeativa_phase01_synthetic"
    );
  } catch {
    return false;
  }
})();

const SCHOOL_ID = "syn-school-f04-r6";
const AUTHOR_ID = "syn-user-f04-author";
const AUTHOR_EMAIL = "autora.f04.sintetica@example.invalid";
const COLLEAGUE_ID = "syn-user-f04-colleague";
const COLLEAGUE_EMAIL = "colega.f04.sintetica@example.invalid";
const MANAGER_ID = "syn-user-f04-manager";
const MANAGER_EMAIL = "gestora.f04.sintetica@example.invalid";
const CLASS_GROUP_ID = "syn-cg-f04-r6";
const STUDENT_PUBLIC_ID = "syn-stu-f04-pub";
const STUDENT_SECRET_ID = "syn-stu-f04-sec";
const MINUTE_RACE_ID = "syn-ata-f04-race";
const MINUTE_SNAPSHOT_ID = "syn-ata-f04-snapshot";

function buildMultiConnUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set("connection_limit", "6");
  return parsed.toString();
}

describe.skipIf(!hasIsolatedDb)(
  "Fase 01 — F04 Snapshot Único em PostgreSQL 16 Real (Prisma RepeatableRead)",
  () => {
    let writerClient: PrismaClient;
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    const prevEnv = {
      FORCE_STRICT_DB_AUTH: process.env.FORCE_STRICT_DB_AUTH,
      AI_FORMALIZE_EXTERNAL_ENABLED: process.env.AI_FORMALIZE_EXTERNAL_ENABLED,
      AI_FORMALIZE_ALLOWED_SCHOOL_IDS: process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };

    beforeAll(async () => {
      writerClient = new PrismaClient({
        datasources: { db: { url: buildMultiConnUrl(process.env.DATABASE_URL!) } },
      });
      await writerClient.$connect();

      await prisma.school.upsert({
        where: { id: SCHOOL_ID },
        update: {
          name: "Escola Sintética F04 Snapshot",
          inepCode: "99990401",
          active: true,
          settingsJson: JSON.stringify({
            edition: "PILOTO_INTEGRADA",
            aiExternalFormalizeEnabled: false,
          }),
        },
        create: {
          id: SCHOOL_ID,
          name: "Escola Sintética F04 Snapshot",
          inepCode: "99990401",
          city: "Cidade Sintética",
          state: "PR",
          network: "ESTADUAL",
          active: true,
          settingsJson: JSON.stringify({
            edition: "PILOTO_INTEGRADA",
            aiExternalFormalizeEnabled: false,
          }),
        },
      });

      for (const u of [
        { id: AUTHOR_ID, email: AUTHOR_EMAIL, name: "Autora Sintética", role: "PEDAGOGA" },
        { id: COLLEAGUE_ID, email: COLLEAGUE_EMAIL, name: "Colega Sintética", role: "PEDAGOGA" },
        { id: MANAGER_ID, email: MANAGER_EMAIL, name: "Gestora Sintética", role: "GESTOR_ESCOLAR" },
      ]) {
        await prisma.user.upsert({
          where: { id: u.id },
          update: {
            email: u.email,
            name: u.name,
            role: u.role,
            active: true,
            schoolId: SCHOOL_ID,
          },
          create: {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            active: true,
            schoolId: SCHOOL_ID,
          },
        });

        await prisma.userSchool.upsert({
          where: { userId_schoolId: { userId: u.id, schoolId: SCHOOL_ID } },
          update: { role: u.role, active: true },
          create: { userId: u.id, schoolId: SCHOOL_ID, role: u.role, active: true },
        });
      }

      await prisma.classGroup.upsert({
        where: { id: CLASS_GROUP_ID },
        update: { name: "6º Sintético F04", schoolId: SCHOOL_ID, segment: "FUNDAMENTAL", shift: "MANHA" },
        create: {
          id: CLASS_GROUP_ID,
          name: "6º Sintético F04",
          schoolId: SCHOOL_ID,
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      });

      for (const stu of [
        {
          id: STUDENT_PUBLIC_ID,
          cgm: "99900401",
          name: "Estudante Público Sintético",
          phone: "00000000401",
        },
        {
          id: STUDENT_SECRET_ID,
          cgm: "99900402",
          name: "Estudante Sigiloso Pós-Snapshot",
          phone: "00000000402",
        },
      ]) {
        await prisma.student.upsert({
          where: { id: stu.id },
          update: {
            name: stu.name,
            schoolId: SCHOOL_ID,
            cgm: stu.cgm,
            phone: stu.phone,
            classGroupId: CLASS_GROUP_ID,
          },
          create: {
            id: stu.id,
            name: stu.name,
            schoolId: SCHOOL_ID,
            cgm: stu.cgm,
            phone: stu.phone,
            classGroupId: CLASS_GROUP_ID,
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.auditLog.deleteMany({ where: { schoolId: SCHOOL_ID } });
      await prisma.pedagogicalMinute.deleteMany({ where: { schoolId: SCHOOL_ID } });
      await prisma.student.deleteMany({ where: { id: { in: [STUDENT_PUBLIC_ID, STUDENT_SECRET_ID] } } });
      await prisma.classGroup.deleteMany({ where: { id: CLASS_GROUP_ID } });
      await prisma.userSchool.deleteMany({ where: { schoolId: SCHOOL_ID } });
      await prisma.user.deleteMany({ where: { id: { in: [AUTHOR_ID, COLLEAGUE_ID, MANAGER_ID] } } });
      await prisma.school.deleteMany({ where: { id: SCHOOL_ID } });
      await writerClient.$disconnect();
    });

    beforeEach(async () => {
      hoisted.cookiesMap.clear();
      hoisted.cookiesMap.set("active_school_id", SCHOOL_ID);
      process.env.FORCE_STRICT_DB_AUTH = "true";
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";
      process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = SCHOOL_ID;
      process.env.GEMINI_API_KEY = "AIzaSyntheticTestKeyOnlyForMockTransport00001";

      fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        formalSubject: "Atendimento Pedagógico",
                        formalSummary: "Texto formalizado com dados pseudonimizados do rascunho.",
                        agreementsSummary: "Acompanhamento de rotina.",
                        actionItems: [],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      await prisma.pedagogicalMinute.deleteMany({
        where: { id: { in: [MINUTE_RACE_ID, MINUTE_SNAPSHOT_ID] } },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.env.FORCE_STRICT_DB_AUTH = prevEnv.FORCE_STRICT_DB_AUTH;
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = prevEnv.AI_FORMALIZE_EXTERNAL_ENABLED;
      process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = prevEnv.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
      process.env.GEMINI_API_KEY = prevEnv.GEMINI_API_KEY;
    });

    it("mantém um único snapshot MVCC (RepeatableRead) entre queries da ata e relações mesmo com COMMIT concorrente em outra conexão", async () => {
      const t0 = new Date("2026-11-24T09:00:00.000Z");
      await prisma.pedagogicalMinute.create({
        data: {
          id: MINUTE_SNAPSHOT_ID,
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          isConfidential: false,
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          subject: "Atendimento Público Inicial",
          summary: "Resumo público inicial",
          authorId: AUTHOR_ID,
          authorName: "Autora Sintética",
          authorEmail: AUTHOR_EMAIL,
          authorRole: "PEDAGOGA",
          updatedAt: t0,
          students: {
            create: [
              {
                studentId: STUDENT_PUBLIC_ID,
                studentNameSnapshot: "Estudante Público Sintético",
              },
            ],
          },
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                studentId: STUDENT_PUBLIC_ID,
                name: "Responsável Público Inicial",
              },
            ],
          },
        },
      });

      const snapshotResult = await prisma.$transaction(
        async (tx) => {
          const isoRows = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`
            SHOW transaction_isolation
          `;

          // Primeira leitura firma o snapshot da transação RepeatableRead
          const minuteBeforeCommit = await tx.pedagogicalMinute.findFirst({
            where: { id: MINUTE_SNAPSHOT_ID, schoolId: SCHOOL_ID },
            select: { id: true, isConfidential: true, category: true },
          });

          // Segunda conexão comita alteração para sigilosa + novos vínculos durante a transação
          await writerClient.$transaction(async (wtx) => {
            await wtx.pedagogicalMinute.update({
              where: { id: MINUTE_SNAPSHOT_ID },
              data: {
                isConfidential: true,
                category: "SAUDE_VULNERABILIDADE",
                updatedAt: new Date("2026-11-24T09:05:00.000Z"),
              },
            });
            await wtx.pedagogicalMinuteStudent.create({
              data: {
                minuteId: MINUTE_SNAPSHOT_ID,
                studentId: STUDENT_SECRET_ID,
                studentNameSnapshot: "Estudante Sigiloso Pós-Snapshot",
              },
            });
            await wtx.pedagogicalMinuteParticipant.create({
              data: {
                minuteId: MINUTE_SNAPSHOT_ID,
                role: "RESPONSAVEL",
                studentId: STUDENT_SECRET_ID,
                name: "Responsável Secreto Pós-Snapshot",
              },
            });
          });

          // Leituras subsequentes no mesmo snapshot não enxergam os dados sigilosos recém-comitados
          const studentsInSameSnapshot = await tx.pedagogicalMinuteStudent.findMany({
            where: { minuteId: MINUTE_SNAPSHOT_ID },
            select: { studentId: true, studentNameSnapshot: true },
          });
          const participantsInSameSnapshot = await tx.pedagogicalMinuteParticipant.findMany({
            where: { minuteId: MINUTE_SNAPSHOT_ID },
            select: { name: true, role: true },
          });

          return {
            isolation: isoRows[0]?.transaction_isolation,
            minuteBeforeCommit,
            studentsInSameSnapshot,
            participantsInSameSnapshot,
          };
        },
        { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 }
      );

      expect(snapshotResult.isolation).toBe("repeatable read");
      expect(snapshotResult.minuteBeforeCommit?.isConfidential).toBe(false);
      expect(snapshotResult.studentsInSameSnapshot.map((s) => s.studentNameSnapshot)).toEqual([
        "Estudante Público Sintético",
      ]);
      expect(snapshotResult.participantsInSameSnapshot.map((p) => p.name)).toEqual([
        "Responsável Público Inicial",
      ]);

      // Fora do snapshot antigo, a mutação já está visível no banco
      const persistedAfter = await writerClient.pedagogicalMinute.findUnique({
        where: { id: MINUTE_SNAPSHOT_ID },
        include: { students: true, participants: true },
      });
      expect(persistedAfter?.isConfidential).toBe(true);
      expect(persistedAfter?.students).toHaveLength(2);
      expect(persistedAfter?.participants).toHaveLength(2);
    });

    it("retorna 409 genérico sem PII nem chamada externa (local e IA externa) quando o estado da ata muda entre a autorização inicial e o snapshot, e preserva local ao autor/gestor", async () => {
      for (const externalEnabled of [true, false]) {
        const minuteId = `${MINUTE_RACE_ID}-${externalEnabled ? "ext" : "loc"}`;
        const t1 = new Date("2026-11-24T10:00:00.000Z");
        const t2 = new Date("2026-11-24T10:01:00.000Z");

        await prisma.school.update({
          where: { id: SCHOOL_ID },
          data: {
            settingsJson: JSON.stringify({
              edition: "PILOTO_INTEGRADA",
              aiExternalFormalizeEnabled: externalEnabled,
              aiExternalFormalizePolicyVersion: 2,
            }),
          },
        });

        await prisma.pedagogicalMinute.deleteMany({ where: { id: minuteId } });
        await prisma.pedagogicalMinute.create({
          data: {
            id: minuteId,
            schoolId: SCHOOL_ID,
            year: 2026,
            status: "DRAFT",
            isConfidential: false,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            subject: "Atendimento de Frequência",
            summary: "",
            authorId: AUTHOR_ID,
            authorName: "Autora Sintética",
            authorEmail: AUTHOR_EMAIL,
            authorRole: "PEDAGOGA",
            updatedAt: t1,
            students: {
              create: [
                {
                  studentId: STUDENT_PUBLIC_ID,
                  studentNameSnapshot: "Estudante Público Sintético",
                },
              ],
            },
            participants: {
              create: [
                {
                  role: "RESPONSAVEL",
                  studentId: STUDENT_PUBLIC_ID,
                  name: "Responsável Público Sintético",
                },
              ],
            },
          },
        });

        const originalTransaction = prisma.$transaction.bind(prisma);
        let sawRepeatableRead = false;
        const txSpy = vi
          .spyOn(prisma, "$transaction")
          .mockImplementationOnce(async (arg: any, opts?: any) => {
            sawRepeatableRead = opts?.isolationLevel === "RepeatableRead";
            // Simula escrita concorrente em outra conexão entre a etapa 1 (autorização) e a etapa 2 (snapshot)
            await writerClient.$transaction(async (wtx) => {
              await wtx.pedagogicalMinute.update({
                where: { id: minuteId },
                data: {
                  isConfidential: true,
                  category: "SAUDE_VULNERABILIDADE",
                  updatedAt: t2,
                },
              });
              await wtx.pedagogicalMinuteStudent.create({
                data: {
                  minuteId,
                  studentId: STUDENT_SECRET_ID,
                  studentNameSnapshot: "Estudante Sigiloso Pós-Snapshot",
                },
              });
              await wtx.pedagogicalMinuteParticipant.create({
                data: {
                  minuteId,
                  role: "RESPONSAVEL",
                  studentId: STUDENT_SECRET_ID,
                  name: "Responsável Sigiloso Confidencial",
                },
              });
            });
            return originalTransaction(arg, opts);
          });

        hoisted.authSession = {
          user: {
            id: COLLEAGUE_ID,
            email: COLLEAGUE_EMAIL,
            name: "Colega Sintética",
            role: "PEDAGOGA",
            schoolId: SCHOOL_ID,
          },
        };
        fetchSpy.mockClear();

        const raceRes = await formalizeAtaPost(
          new Request("http://localhost/api/ai/formalize-ata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              minuteId,
              rawNotes: "Registro preliminar de acompanhamento escolar.",
            }),
          })
        );

        expect(sawRepeatableRead).toBe(true);
        expect(raceRes.status).toBe(409);
        const bodyText = await raceRes.text();
        expect(bodyText).not.toContain("Estudante Público Sintético");
        expect(bodyText).not.toContain("Estudante Sigiloso Pós-Snapshot");
        expect(bodyText).not.toContain("Responsável Sigiloso Confidencial");
        expect(bodyText).not.toContain("Responsável Público Sintético");
        expect(bodyText).not.toContain("SAUDE_VULNERABILIDADE");
        expect(bodyText).not.toContain("ACOMPANHAMENTO_PEDAGOGICO");
        expect(bodyText).not.toContain(minuteId);
        expect(bodyText.toLowerCase()).not.toContain("sigilo");
        expect(fetchSpy).not.toHaveBeenCalled();

        txSpy.mockRestore();

        // Colega sem acesso já recebe 403 na etapa 1 após consolidação do sigilo
        const colleagueBlocked = await formalizeAtaPost(
          new Request("http://localhost/api/ai/formalize-ata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              minuteId,
              rawNotes: "Nova tentativa após ativação do sigilo.",
            }),
          })
        );
        expect(colleagueBlocked.status).toBe(403);
        const blockedText = await colleagueBlocked.text();
        expect(blockedText).not.toContain("Estudante Sigiloso Pós-Snapshot");
        expect(blockedText).not.toContain("Responsável Sigiloso Confidencial");
        expect(fetchSpy).not.toHaveBeenCalled();

        // Autora e Gestora Escolar autorizadas continuam conseguindo formalizar localmente (0 chamadas externas)
        for (const actor of [
          { id: AUTHOR_ID, email: AUTHOR_EMAIL, name: "Autora Sintética", role: "PEDAGOGA" },
          { id: MANAGER_ID, email: MANAGER_EMAIL, name: "Gestora Sintética", role: "GESTOR_ESCOLAR" },
        ]) {
          hoisted.authSession = {
            user: { ...actor, schoolId: SCHOOL_ID },
          };
          const okLocal = await formalizeAtaPost(
            new Request("http://localhost/api/ai/formalize-ata", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                minuteId,
                rawNotes: "Relato registrado pela servidora autorizada.",
              }),
            })
          );
          expect(okLocal.status).toBe(200);
          const okJson = await okLocal.json();
          expect(okJson.mode).toBe(externalEnabled ? "LOCAL_POLICY_GUARD" : "LOCAL_ONLY");
          expect(okJson.result.formalSummary).toContain("Estudante Sigiloso Pós-Snapshot");
        }

        expect(fetchSpy).not.toHaveBeenCalled();
      }
    });

    it("em fluxo elegível sem divergência de snapshot, lê estudantes/participantes em RepeatableRead e envia apenas texto pseudonimizado ao transporte simulado", async () => {
      const minuteEligibleId = `${MINUTE_RACE_ID}-eligible`;
      await prisma.school.update({
        where: { id: SCHOOL_ID },
        data: {
          settingsJson: JSON.stringify({
            edition: "PILOTO_INTEGRADA",
            aiExternalFormalizeEnabled: true,
            aiExternalFormalizePolicyVersion: 2,
          }),
        },
      });
      await prisma.pedagogicalMinute.deleteMany({ where: { id: minuteEligibleId } });
      await prisma.pedagogicalMinute.create({
        data: {
          id: minuteEligibleId,
          schoolId: SCHOOL_ID,
          year: 2026,
          status: "DRAFT",
          isConfidential: false,
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          subject: "Acompanhamento de Frequência",
          summary: "",
          authorId: AUTHOR_ID,
          authorName: "Autora Sintética",
          authorEmail: AUTHOR_EMAIL,
          authorRole: "PEDAGOGA",
          students: {
            create: [
              {
                studentId: STUDENT_PUBLIC_ID,
                studentNameSnapshot: "Estudante Público Sintético",
              },
            ],
          },
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                studentId: STUDENT_PUBLIC_ID,
                name: "Responsável Público Sintético",
              },
            ],
          },
        },
      });

      hoisted.authSession = {
        user: {
          id: AUTHOR_ID,
          email: AUTHOR_EMAIL,
          name: "Autora Sintética",
          role: "PEDAGOGA",
          schoolId: SCHOOL_ID,
        },
      };
      fetchSpy.mockClear();
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        formalSubject: "Acompanhamento de Frequência",
                        formalSummary:
                          "Realizou-se atendimento com [RESPONSAVEL_1] para acompanhamento escolar de [ESTUDANTE_1].",
                        agreementsSummary: "Reforço da rotina escolar.",
                        actionItems: [],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minuteId: minuteEligibleId,
            rawNotes: "Compareceu Responsável Público Sintético tratando de Estudante Público Sintético.",
            attendedAt: "2026-11-24T10:00:00-03:00",
          }),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("EXTERNAL_AI");
      expect(body.result.formalSummary).toContain("Estudante Público Sintético");
      expect(body.result.formalSummary).toContain("Responsável Público Sintético");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const sentBody = String(fetchSpy.mock.calls[0]?.[1]?.body || "");
      expect(sentBody).not.toContain("Estudante Público Sintético");
      expect(sentBody).not.toContain("Responsável Público Sintético");
    });
  }
);
