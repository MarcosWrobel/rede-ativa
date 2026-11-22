import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CouncilDomainError,
  confirmPreCouncilTeacherAck,
  saveCouncilMatrixBatch,
  submitTeacherPortalSubjectEntries,
} from "@/services/classCouncilService";

const SCHOOL_ID = "fixture-school-council-conc";
const SCHOOL_INEP = "99999992";
const CLASS_GROUP_ID = "fixture-cg-council-conc";
const STUDENT_ID = "fixture-stu-council-conc";
const BOARD_ID = "fixture-board-council-conc";
const SUBJECT_ID = "fixture-subj-council-conc";
const CONV_ID = "fixture-conv-council-conc";

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

async function cleanupFixtures() {
  await prisma.studentCouncilSubjectEntry.deleteMany({ where: { schoolId: SCHOOL_ID } });
  await prisma.studentCouncilCard.deleteMany({ where: { schoolId: SCHOOL_ID } });
  await prisma.classCouncilTrimester.deleteMany({ where: { schoolId: SCHOOL_ID } });
  await prisma.classCouncilSubject.deleteMany({ where: { schoolId: SCHOOL_ID } });
  await prisma.classCouncilBoard.deleteMany({ where: { schoolId: SCHOOL_ID } });
  await prisma.student.deleteMany({ where: { schoolId: SCHOOL_ID } });
  await prisma.classGroup.deleteMany({ where: { schoolId: SCHOOL_ID } });
  await prisma.school.deleteMany({ where: { id: SCHOOL_ID } });
}

describe.skipIf(!hasIsolatedDb)(
  "Conselho de Classe — Replay real de migrations e concorrência PostgreSQL",
  () => {
    beforeAll(async () => {
      await cleanupFixtures();

      await prisma.school.create({
        data: {
          id: SCHOOL_ID,
          inepCode: SCHOOL_INEP,
          name: "Escola Sintética Conselho Concorrência",
          city: "Cidade Sintética",
          state: "PR",
          nre: "Núcleo Sintético",
          active: true,
        },
      });

      await prisma.classGroup.create({
        data: {
          id: CLASS_GROUP_ID,
          schoolId: SCHOOL_ID,
          name: "8º Ano Sintético",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      });

      await prisma.student.create({
        data: {
          id: STUDENT_ID,
          schoolId: SCHOOL_ID,
          classGroupId: CLASS_GROUP_ID,
          name: "Estudante Concorrência Sintético",
          phone: "5500000000001",
          active: true,
        },
      });

      await prisma.classCouncilBoard.create({
        data: {
          id: BOARD_ID,
          schoolId: SCHOOL_ID,
          classGroupId: CLASS_GROUP_ID,
          year: 2026,
        },
      });

      await prisma.classCouncilSubject.create({
        data: {
          id: SUBJECT_ID,
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          name: "Matemática",
          displayOrder: 0,
          active: true,
        },
      });

      await prisma.studentCouncilCard.create({
        data: {
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          studentId: STUDENT_ID,
          enrollmentStatus: "ATIVO",
          trimester1BelowAvgJson: JSON.stringify([
            { subjectId: null, subjectName: "Projeto Leitura", grade: 5.5 },
          ]),
        },
      });
    }, 30_000);

    afterAll(async () => {
      await cleanupFixtures();
    }, 30_000);

    it("executa replay completo de migrations em schema efêmero e valida idempotência da migration do Conselho", async () => {
      const schemaName = `council_mig_replay_${Date.now()}`;
      if (!/^[a-z0-9_]+$/.test(schemaName)) {
        throw new Error("Nome de schema inválido.");
      }

      const ephemeralUrl = new URL(process.env.DATABASE_URL!);
      ephemeralUrl.searchParams.set("schema", schemaName);

      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

      try {
        execFileSync("npx", ["prisma", "migrate", "deploy"], {
          env: {
            ...process.env,
            DATABASE_URL: ephemeralUrl.toString(),
            DIRECT_URL: ephemeralUrl.toString(),
          },
          stdio: "pipe",
          encoding: "utf8",
        });

        const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = ${schemaName}
            AND table_name IN (
              'ClassCouncilBoard',
              'ClassCouncilSubject',
              'ClassCouncilTrimester',
              'StudentCouncilCard',
              'StudentCouncilSubjectEntry'
            )
        `;
        expect(tables).toHaveLength(5);

        const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = ${schemaName}
            AND (
              (table_name = 'ClassCouncilBoard' AND column_name = 'seatingMapLayoutJson')
              OR (table_name = 'ClassCouncilTrimester' AND column_name = 'preCouncilJson')
            )
        `;
        expect(cols).toHaveLength(2);

        // Reaplicação idempotente da migration base do Conselho no mesmo schema
        execFileSync(
          "npx",
          [
            "prisma",
            "db",
            "execute",
            "--file",
            path.join(
              process.cwd(),
              "prisma/migrations/20261118120000_class_council_module/migration.sql"
            ),
            "--schema",
            path.join(process.cwd(), "prisma/schema.prisma"),
          ],
          {
            env: {
              ...process.env,
              DATABASE_URL: ephemeralUrl.toString(),
              DIRECT_URL: ephemeralUrl.toString(),
            },
            stdio: "pipe",
            encoding: "utf8",
          }
        );
      } finally {
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
    }, 60_000);

    it("impõe unicidade P2002 em StudentCouncilSubjectEntry e executa saveCouncilMatrixBatch concorrente preservando itens manuais", async () => {
      const card = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { boardId_studentId: { boardId: BOARD_ID, studentId: STUDENT_ID } },
      });

      await prisma.studentCouncilSubjectEntry.upsert({
        where: {
          cardId_subjectId_trimester: {
            cardId: card.id,
            subjectId: SUBJECT_ID,
            trimester: 1,
          },
        },
        create: {
          schoolId: SCHOOL_ID,
          cardId: card.id,
          subjectId: SUBJECT_ID,
          trimester: 1,
          descriptorCodes: [1],
          grade: 5.2,
          updatedByEmail: "seed@example.invalid",
        },
        update: {
          descriptorCodes: [1],
          grade: 5.2,
        },
      });

      await expect(
        prisma.studentCouncilSubjectEntry.create({
          data: {
            schoolId: SCHOOL_ID,
            cardId: card.id,
            subjectId: SUBJECT_ID,
            trimester: 1,
            descriptorCodes: [2],
          },
        })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
      );

      const results = await Promise.allSettled([
        saveCouncilMatrixBatch({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          userEmail: "pedagoga1@example.invalid",
          payload: {
            trimester: 1,
            entries: [
              { studentId: STUDENT_ID, subjectId: SUBJECT_ID, descriptorCodes: [2] },
            ],
          },
        }),
        saveCouncilMatrixBatch({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          userEmail: "pedagoga2@example.invalid",
          payload: {
            trimester: 1,
            entries: [
              { studentId: STUDENT_ID, subjectId: SUBJECT_ID, descriptorCodes: [1, 2] },
            ],
          },
        }),
      ]);

      expect(results.some((r) => r.status === "fulfilled")).toBe(true);

      const entryCount = await prisma.studentCouncilSubjectEntry.count({
        where: { cardId: card.id, subjectId: SUBJECT_ID, trimester: 1 },
      });
      expect(entryCount).toBe(1);

      const refreshedCard = await prisma.studentCouncilCard.findUniqueOrThrow({
        where: { id: card.id },
      });
      const belowList = JSON.parse(refreshedCard.trimester1BelowAvgJson || "[]") as Array<{
        subjectName: string;
      }>;
      expect(belowList.some((item) => item.subjectName === "Projeto Leitura")).toBe(true);
    }, 30_000);

    it("mantém integridade transacional em submitTeacherPortalSubjectEntries concorrente e bloqueia terceiro docente", async () => {
      await prisma.classCouncilSubject.update({
        where: { id: SUBJECT_ID },
        data: { teacherEmail: null, teacherName: null },
      });

      await prisma.classCouncilTrimester.upsert({
        where: { boardId_trimester: { boardId: BOARD_ID, trimester: 1 } },
        create: {
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          trimester: 1,
          status: "IN_PROGRESS",
          preCouncilJson: JSON.stringify({
            version: 1,
            periodLabel: "1º Trimestre",
            objectiveText: "Objetivo",
            responsiblePedagogueName: "Pedagoga",
            responsiblePedagogueRole: "Pedagoga",
            conversations: [
              {
                id: CONV_ID,
                subjectId: SUBJECT_ID,
                subjectName: "Matemática",
                teacherName: "",
                teacherEmail: null,
                monitoredStudentIds: [],
                monitoredStudentsNotes: "",
                agreements: "",
                conversationStatus: "PENDING",
                conversationDate: null,
                digitalAckEmail: null,
                digitalAckName: null,
                digitalAckAt: null,
              },
            ],
            synthesis: {
              mainDifficulties: "",
              priorityStudents: "",
              attendanceIssues: "",
              behaviorIssues: "",
              pedagogicalActions: "",
            },
          }),
        },
        update: {
          preCouncilJson: JSON.stringify({
            version: 1,
            periodLabel: "1º Trimestre",
            objectiveText: "Objetivo",
            responsiblePedagogueName: "Pedagoga",
            responsiblePedagogueRole: "Pedagoga",
            conversations: [
              {
                id: CONV_ID,
                subjectId: SUBJECT_ID,
                subjectName: "Matemática",
                teacherName: "",
                teacherEmail: null,
                monitoredStudentIds: [],
                monitoredStudentsNotes: "",
                agreements: "",
                conversationStatus: "PENDING",
                conversationDate: null,
                digitalAckEmail: null,
                digitalAckName: null,
                digitalAckAt: null,
              },
            ],
            synthesis: {
              mainDifficulties: "",
              priorityStudents: "",
              attendanceIssues: "",
              behaviorIssues: "",
              pedagogicalActions: "",
            },
          }),
        },
      });

      const concurrentRuns = await Promise.allSettled([
        submitTeacherPortalSubjectEntries({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          trimester: 1,
          lockedSubjectId: SUBJECT_ID,
          subjectId: SUBJECT_ID,
          verifiedEmail: "docente.a@escola.pr.gov.br",
          verifiedName: "Prof. Alfa",
          entries: [{ studentId: STUDENT_ID, descriptorCodes: [1, 3] }],
          preCouncil: {
            monitoredStudentIds: [STUDENT_ID],
            monitoredStudentsNotes: "Observação paralela 1",
          },
        }),
        submitTeacherPortalSubjectEntries({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          trimester: 1,
          lockedSubjectId: SUBJECT_ID,
          subjectId: SUBJECT_ID,
          verifiedEmail: "docente.a@escola.pr.gov.br",
          verifiedName: "Prof. Alfa",
          entries: [{ studentId: STUDENT_ID, descriptorCodes: [2] }],
          preCouncil: {
            monitoredStudentIds: [STUDENT_ID],
            monitoredStudentsNotes: "Observação paralela 2",
          },
        }),
      ]);

      expect(concurrentRuns.some((r) => r.status === "fulfilled")).toBe(true);

      const subj = await prisma.classCouncilSubject.findUniqueOrThrow({
        where: { id: SUBJECT_ID },
      });
      expect(subj.teacherEmail).toBe("docente.a@escola.pr.gov.br");

      await expect(
        submitTeacherPortalSubjectEntries({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          trimester: 1,
          lockedSubjectId: SUBJECT_ID,
          subjectId: SUBJECT_ID,
          verifiedEmail: "docente.outro@escola.pr.gov.br",
          verifiedName: "Prof. Outro",
          entries: [{ studentId: STUDENT_ID, descriptorCodes: [4] }],
        })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof CouncilDomainError && err.statusCode === 403
      );
    }, 30_000);

    it("garante idempotência concorrente em confirmPreCouncilTeacherAck e rejeita ciência de outro docente", async () => {
      await prisma.classCouncilSubject.update({
        where: { id: SUBJECT_ID },
        data: { teacherEmail: null, teacherName: null },
      });

      await prisma.classCouncilTrimester.update({
        where: { boardId_trimester: { boardId: BOARD_ID, trimester: 1 } },
        data: {
          preCouncilJson: JSON.stringify({
            version: 1,
            periodLabel: "1º Trimestre",
            objectiveText: "Objetivo",
            responsiblePedagogueName: "Pedagoga",
            responsiblePedagogueRole: "Pedagoga",
            conversations: [
              {
                id: CONV_ID,
                subjectId: SUBJECT_ID,
                subjectName: "Matemática",
                teacherName: "",
                teacherEmail: null,
                monitoredStudentIds: [STUDENT_ID],
                monitoredStudentsNotes: "Acompanhamento semanal",
                agreements: "Aplicar recuperação paralela.",
                conversationStatus: "COMPLETED",
                conversationDate: "2026-05-12",
                digitalAckEmail: null,
                digitalAckName: null,
                digitalAckAt: null,
              },
            ],
            synthesis: {
              mainDifficulties: "",
              priorityStudents: "",
              attendanceIssues: "",
              behaviorIssues: "",
              pedagogicalActions: "",
            },
          }),
        },
      });

      const ackRuns = await Promise.allSettled([
        confirmPreCouncilTeacherAck({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          trimester: 1,
          lockedConversationId: CONV_ID,
          conversationId: CONV_ID,
          verifiedEmail: "docente.ci@escola.pr.gov.br",
          verifiedName: "Prof. Ciência",
        }),
        confirmPreCouncilTeacherAck({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          trimester: 1,
          lockedConversationId: CONV_ID,
          conversationId: CONV_ID,
          verifiedEmail: "docente.ci@escola.pr.gov.br",
          verifiedName: "Prof. Ciência",
        }),
      ]);

      expect(ackRuns.every((r) => r.status === "fulfilled")).toBe(true);

      const subj = await prisma.classCouncilSubject.findUniqueOrThrow({
        where: { id: SUBJECT_ID },
      });
      expect(subj.teacherEmail).toBe("docente.ci@escola.pr.gov.br");

      const tri = await prisma.classCouncilTrimester.findUniqueOrThrow({
        where: { boardId_trimester: { boardId: BOARD_ID, trimester: 1 } },
      });
      const parsedPre = JSON.parse(tri.preCouncilJson || "{}") as {
        conversations: Array<{ digitalAckEmail: string | null }>;
      };
      expect(parsedPre.conversations[0].digitalAckEmail).toBe("docente.ci@escola.pr.gov.br");

      await expect(
        confirmPreCouncilTeacherAck({
          schoolId: SCHOOL_ID,
          boardId: BOARD_ID,
          trimester: 1,
          lockedConversationId: CONV_ID,
          conversationId: CONV_ID,
          verifiedEmail: "docente.intruso@escola.pr.gov.br",
          verifiedName: "Prof. Intruso",
        })
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof CouncilDomainError && (err.statusCode === 403 || err.statusCode === 409)
      );
    }, 30_000);
  }
);
