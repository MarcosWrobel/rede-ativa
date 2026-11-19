import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";

const hoisted = vi.hoisted(() => {
  const db = {
    classGroups: [] as any[],
    students: [] as any[],
    boards: [] as any[],
    subjects: [] as any[],
    trimesters: [] as any[],
    cards: [] as any[],
    entries: [] as any[],
    minutes: [] as any[],
  };

  return {
    session: null as any,
    currentSchool: {
      id: "school-a",
      inepCode: "41000011",
      name: "Escola Estadual Alpha",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
      edition: "INSTITUCIONAL_ESSENCIAL" as const,
    },
    db,
    auditCalls: [] as any[],
    forceDbError: false,
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("@/lib/currentSchool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currentSchool")>("@/lib/currentSchool");
  return {
    ...actual,
    getCurrentSchool: vi.fn(async () => hoisted.currentSchool),
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (entry: any) => {
    hoisted.auditCalls.push(entry);
  }),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/prisma", () => {
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}-${seq++}`;

  const hydrateBoard = (b: any) => {
    const cg = hoisted.db.classGroups.find((c) => c.id === b.classGroupId) || null;
    const subjects = hoisted.db.subjects
      .filter((s) => s.boardId === b.id)
      .sort((x, y) => x.displayOrder - y.displayOrder || x.name.localeCompare(y.name));
    const trimesters = hoisted.db.trimesters
      .filter((t) => t.boardId === b.id)
      .sort((x, y) => x.trimester - y.trimester);
    const studentCards = hoisted.db.cards
      .filter((c) => c.boardId === b.id)
      .map((c) => {
        const st = hoisted.db.students.find((s) => s.id === c.studentId) || null;
        return {
          ...c,
          student: st
            ? {
                id: st.id,
                name: st.name,
                cgm: st.cgm ?? null,
                active: st.active ?? true,
                isSpecialNeeds: st.isSpecialNeeds ?? false,
                isExchangeStudent: st.isExchangeStudent ?? false,
                age: st.age ?? 14,
                lowAttendanceRecord: st.lowAttendanceRecord ?? null,
                schoolId: st.schoolId,
              }
            : null,
          subjectEntries: hoisted.db.entries.filter((e) => e.cardId === c.id),
        };
      });

    return {
      ...b,
      classGroup: cg,
      subjects,
      trimesters,
      studentCards,
    };
  };

  const client: any = {
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === "function") {
        return arg(client);
      }
      return Promise.all(arg);
    }),
    classGroup: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        if (hoisted.forceDbError) throw new Error("FATAL_DB_SECRET_CONNECTION_LEAK");
        return hoisted.db.classGroups
          .filter((cg) => !where?.schoolId || cg.schoolId === where.schoolId)
          .map((cg) => ({
            ...cg,
            _count: {
              students: hoisted.db.students.filter(
                (s) => s.classGroupId === cg.id && s.active !== false
              ).length,
            },
          }));
      }),
      findFirst: vi.fn(async ({ where }: any = {}) => {
        if (hoisted.forceDbError) throw new Error("FATAL_DB_SECRET_CONNECTION_LEAK");
        return (
          hoisted.db.classGroups.find(
            (cg) =>
              (!where?.id || cg.id === where.id) &&
              (!where?.schoolId || cg.schoolId === where.schoolId)
          ) || null
        );
      }),
    },
    student: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        return hoisted.db.students.filter((st) => {
          if (where?.id?.in && !where.id.in.includes(st.id)) return false;
          if (where?.schoolId !== undefined && st.schoolId !== where.schoolId) return false;
          if (where?.classGroupId !== undefined && st.classGroupId !== where.classGroupId) {
            return false;
          }
          return true;
        });
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const st = hoisted.db.students.find((s) => s.id === where?.id);
        if (!st) return null;
        return {
          ...st,
          classGroup: hoisted.db.classGroups.find((cg) => cg.id === st.classGroupId) || null,
          lowAttendanceRecord: st.lowAttendanceRecord ?? null,
          messageLogs: [],
        };
      }),
    },
    studentContact: { findMany: vi.fn(async () => []) },
    absenceJustification: { findMany: vi.fn(async () => []) },
    inPersonAttendance: { findMany: vi.fn(async () => []) },
    attendanceSnapshot: { findMany: vi.fn(async () => []) },
    pedagogicalMinute: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => {
        const created = {
          id: nextId("min"),
          ...data,
          students: (data.students?.create || []).map((s: any, idx: number) => ({
            id: `ms-${idx}`,
            ...s,
          })),
          participants: [],
          actionItems: (data.actionItems?.create || []).map((a: any, idx: number) => ({
            id: `act-${idx}`,
            ...a,
          })),
        };
        hoisted.db.minutes.push(created);
        return created;
      }),
    },
    classCouncilBoard: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        if (hoisted.forceDbError) throw new Error("FATAL_DB_SECRET_CONNECTION_LEAK");
        return hoisted.db.boards
          .filter(
            (b) =>
              (!where?.schoolId || b.schoolId === where.schoolId) &&
              (!where?.year || b.year === where.year)
          )
          .map((b) => ({
            ...b,
            classGroup: hoisted.db.classGroups.find((cg) => cg.id === b.classGroupId) || null,
            trimesters: hoisted.db.trimesters.filter((t) => t.boardId === b.id),
            _count: {
              subjects: hoisted.db.subjects.filter((s) => s.boardId === b.id && s.active).length,
              studentCards: hoisted.db.cards.filter((c) => c.boardId === b.id).length,
            },
          }));
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        if (hoisted.forceDbError) throw new Error("FATAL_DB_SECRET_CONNECTION_LEAK");
        const found = hoisted.db.boards.find((b) => b.id === where?.id);
        if (!found) return null;
        if (!include) return found;
        return hydrateBoard(found);
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where?.schoolId_classGroupId_year;
        let found = hoisted.db.boards.find(
          (b) =>
            b.schoolId === key.schoolId &&
            b.classGroupId === key.classGroupId &&
            b.year === key.year
        );
        if (found) {
          Object.assign(found, update);
          return found;
        }
        found = {
          id: nextId("board"),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        hoisted.db.boards.push(found);
        return found;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = hoisted.db.boards.find((b) => b.id === where.id);
        if (found) Object.assign(found, data, { updatedAt: new Date() });
        return found;
      }),
    },
    classCouncilSubject: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        return hoisted.db.subjects
          .filter((s) => {
            if (where?.id?.in && !where.id.in.includes(s.id)) return false;
            if (where?.boardId && s.boardId !== where.boardId) return false;
            if (where?.schoolId && s.schoolId !== where.schoolId) return false;
            if (where?.active !== undefined && s.active !== where.active) return false;
            return true;
          })
          .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const s of hoisted.db.subjects) {
          if (
            (!where?.id?.in || where.id.in.includes(s.id)) &&
            (!where?.boardId || s.boardId === where.boardId) &&
            (!where?.schoolId || s.schoolId === where.schoolId)
          ) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = hoisted.db.subjects.find((s) => s.id === where.id);
        if (found) Object.assign(found, data);
        return found;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where?.boardId_name;
        let found = hoisted.db.subjects.find(
          (s) => s.boardId === key.boardId && s.name === key.name
        );
        if (found) {
          Object.assign(found, update);
          return found;
        }
        found = { id: nextId("subj"), ...create };
        hoisted.db.subjects.push(found);
        return found;
      }),
    },
    classCouncilTrimester: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        return hoisted.db.trimesters.filter(
          (t) =>
            (!where?.boardId || t.boardId === where.boardId) &&
            (!where?.schoolId || t.schoolId === where.schoolId)
        );
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const exists = hoisted.db.trimesters.some(
            (t) => t.boardId === item.boardId && t.trimester === item.trimester
          );
          if (!exists) {
            hoisted.db.trimesters.push({
              id: nextId("tri"),
              updatedAt: new Date(),
              ...item,
            });
          }
        }
        return { count: items.length };
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where?.boardId_trimester;
        let found = hoisted.db.trimesters.find(
          (t) => t.boardId === key.boardId && t.trimester === key.trimester
        );
        if (found) {
          Object.assign(found, update, { updatedAt: new Date() });
          return found;
        }
        found = { id: nextId("tri"), updatedAt: new Date(), ...create };
        hoisted.db.trimesters.push(found);
        return found;
      }),
    },
    studentCouncilCard: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        return hoisted.db.cards
          .filter((c) => {
            if (where?.boardId && c.boardId !== where.boardId) return false;
            if (where?.schoolId && c.schoolId !== where.schoolId) return false;
            if (where?.studentId?.in && !where.studentId.in.includes(c.studentId)) return false;
            if (typeof where?.studentId === "string" && c.studentId !== where.studentId) {
              return false;
            }
            return true;
          })
          .map((c) => {
            const b = hoisted.db.boards.find((br) => br.id === c.boardId);
            return {
              ...c,
              board: b
                ? {
                    id: b.id,
                    year: b.year,
                    schoolId: b.schoolId,
                    classGroup:
                      hoisted.db.classGroups.find((cg) => cg.id === b.classGroupId) || null,
                    subjects: hoisted.db.subjects.filter((s) => s.boardId === b.id && s.active),
                  }
                : null,
              subjectEntries: hoisted.db.entries.filter((e) => e.cardId === c.id),
            };
          });
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where?.boardId_studentId;
        const card = hoisted.db.cards.find(
          (c) => c.boardId === key.boardId && c.studentId === key.studentId
        );
        if (!card) return null;
        const st = hoisted.db.students.find((s) => s.id === card.studentId) || null;
        return {
          ...card,
          student: st,
          subjectEntries: hoisted.db.entries.filter((e) => e.cardId === card.id),
        };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const exists = hoisted.db.cards.some(
            (c) => c.boardId === item.boardId && c.studentId === item.studentId
          );
          if (!exists) {
            hoisted.db.cards.push({
              id: nextId("card"),
              trimester1Opinion: null,
              trimester2Opinion: null,
              trimester3Opinion: null,
              trimester1BelowAvgJson: null,
              trimester2BelowAvgJson: null,
              trimester3BelowAvgJson: null,
              externalEvalEd1Percent: null,
              externalEvalEd2Percent: null,
              externalEvalEd3Percent: null,
              ...item,
            });
          }
        }
        return { count: items.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = hoisted.db.cards.find((c) => c.id === where.id);
        if (found) Object.assign(found, data);
        const st = hoisted.db.students.find((s) => s.id === found?.studentId) || null;
        return {
          ...found,
          student: st,
          subjectEntries: hoisted.db.entries.filter((e) => e.cardId === found?.id),
        };
      }),
    },
    studentCouncilSubjectEntry: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        return hoisted.db.entries
          .filter(
            (e) =>
              (!where?.cardId || e.cardId === where.cardId) &&
              (!where?.schoolId || e.schoolId === where.schoolId) &&
              (!where?.trimester || e.trimester === where.trimester)
          )
          .map((e) => ({
            ...e,
            subject: hoisted.db.subjects.find((s) => s.id === e.subjectId) || null,
          }))
          .filter((e) => !where?.subject?.active || e.subject?.active === true);
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where?.cardId_subjectId_trimester;
        let found = hoisted.db.entries.find(
          (e) =>
            e.cardId === key.cardId &&
            e.subjectId === key.subjectId &&
            e.trimester === key.trimester
        );
        if (found) {
          Object.assign(found, update);
          return found;
        }
        found = { id: nextId("entry"), ...create };
        hoisted.db.entries.push(found);
        return found;
      }),
    },
  };

  return { prisma: client };
});

import {
  councilMatrixBatchSaveSchema,
  councilSubjectsBatchSchema,
} from "@/lib/schemas";
import { GET as getBoardsRoute, POST as postBoardRoute } from "@/app/api/conselho-classe/route";
import {
  GET as getBoardDetailRoute,
  PATCH as patchBoardMetadataRoute,
} from "@/app/api/conselho-classe/[boardId]/route";
import { PUT as putSubjectsRoute } from "@/app/api/conselho-classe/[boardId]/subjects/route";
import { PATCH as patchTrimesterRoute } from "@/app/api/conselho-classe/[boardId]/trimesters/route";
import { PUT as putMatrixRoute } from "@/app/api/conselho-classe/[boardId]/matrix/route";
import { PATCH as patchStudentCardRoute } from "@/app/api/conselho-classe/[boardId]/students/[studentId]/route";
import { POST as postGenerateMinuteRoute } from "@/app/api/conselho-classe/[boardId]/generate-minute/route";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import CouncilStudent360Section from "@/components/conselho/CouncilStudent360Section";

describe("Módulo de Acompanhamento Trimestral e Conselho de Classe", () => {
  beforeEach(() => {
    hoisted.forceDbError = false;
    hoisted.auditCalls = [];
    hoisted.currentSchool = {
      id: "school-a",
      inepCode: "41000011",
      name: "Escola Estadual Alpha",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
      edition: "INSTITUCIONAL_ESSENCIAL",
    };
    hoisted.session = {
      user: {
        id: "usr-ped-a",
        name: "Pedagoga Alpha",
        email: "pedagoga@escola-a.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "school-a",
        active: true,
        schools: [{ schoolId: "school-a", role: "PEDAGOGA", active: true }],
      },
    };

    hoisted.db.classGroups = [
      { id: "cg-a1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA", schoolId: "school-a" },
      { id: "cg-a2", name: "6º Ano B", segment: "FUNDAMENTAL", shift: "TARDE", schoolId: "school-a" },
      { id: "cg-b1", name: "7º Ano A", segment: "FUNDAMENTAL", shift: "MANHA", schoolId: "school-b" },
    ];
    hoisted.db.students = [
      {
        id: "stu-a1",
        name: "Ana Clara Souza",
        cgm: "1001",
        classGroupId: "cg-a1",
        schoolId: "school-a",
        active: true,
        isSpecialNeeds: true,
      },
      {
        id: "stu-a2",
        name: "Bruno Oliveira",
        cgm: "1002",
        classGroupId: "cg-a1",
        schoolId: "school-a",
        active: true,
        isSpecialNeeds: false,
      },
      {
        id: "stu-b1",
        name: "Carlos Mendes",
        cgm: "2001",
        classGroupId: "cg-b1",
        schoolId: "school-b",
        active: true,
        isSpecialNeeds: false,
      },
    ];
    hoisted.db.boards = [
      {
        id: "board-a1",
        schoolId: "school-a",
        classGroupId: "cg-a1",
        year: 2026,
        peerLeaderStudentId: null,
        peerLeaderName: null,
        teacherLeaderStudentId: null,
        teacherLeaderName: null,
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        seatingMapMode: "REVEZAMENTO_MENSAL",
        seatingMapNotes: null,
      },
      {
        id: "board-a2",
        schoolId: "school-a",
        classGroupId: "cg-a2",
        year: 2026,
        peerLeaderStudentId: null,
        peerLeaderName: null,
        teacherLeaderStudentId: null,
        teacherLeaderName: null,
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        seatingMapMode: "REVEZAMENTO_MENSAL",
        seatingMapNotes: null,
      },
      {
        id: "board-b1",
        schoolId: "school-b",
        classGroupId: "cg-b1",
        year: 2026,
        peerLeaderStudentId: null,
        peerLeaderName: null,
        teacherLeaderStudentId: null,
        teacherLeaderName: null,
        externalEvalEd1Percent: null,
        externalEvalEd2Percent: null,
        externalEvalEd3Percent: null,
        seatingMapMode: "REVEZAMENTO_MENSAL",
        seatingMapNotes: null,
      },
    ];
    hoisted.db.subjects = [
      {
        id: "subj-a1",
        schoolId: "school-a",
        boardId: "board-a1",
        name: "Língua Portuguesa",
        teacherName: "Prof. Helena",
        teacherEmail: null,
        displayOrder: 0,
        active: true,
      },
      {
        id: "subj-a2",
        schoolId: "school-a",
        boardId: "board-a1",
        name: "Matemática",
        teacherName: "Prof. Marcos",
        teacherEmail: null,
        displayOrder: 1,
        active: true,
      },
      {
        id: "subj-b1",
        schoolId: "school-b",
        boardId: "board-b1",
        name: "História",
        teacherName: "Prof. Outra Escola",
        teacherEmail: null,
        displayOrder: 0,
        active: true,
      },
    ];
    hoisted.db.trimesters = [
      {
        id: "tri-a1-1",
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        status: "IN_PROGRESS",
        positivePoints: "Turma participativa",
        attentionPoints: null,
        plannedActions: null,
        postCouncilHeldAt: null,
        postCouncilAdvances: "Melhora na leitura",
        postCouncilWhatWorked: "Atividades em grupo",
        postCouncilRecognizedAttitudes: null,
        postCouncilCriticalSubjects: "Matemática",
        postCouncilPerformanceFactors: null,
        postCouncilBehaviorAttendance: null,
        postCouncilWhatToImprove: null,
        postCouncilHowTeachersCanHelp: null,
        postCouncilCommitments: null,
        postCouncilActionItemsJson: JSON.stringify([
          { number: 1, description: "Plantão de matemática às quartas", responsible: "ESCOLA" },
        ]),
        linkedMinuteId: null,
      },
    ];
    hoisted.db.cards = [
      {
        id: "card-a1",
        schoolId: "school-a",
        boardId: "board-a1",
        studentId: "stu-a1",
        enrollmentStatus: "ATIVO",
        tags: ["AEE"],
        hasSensitiveHealthTag: true,
        trimester1Opinion: "Acompanhamento com apoio.",
        trimester2Opinion: null,
        trimester3Opinion: null,
        trimester1BelowAvgJson: JSON.stringify([
          { subjectId: null, subjectName: "Projeto Integrador (manual)", grade: 5.0 },
        ]),
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
      },
      {
        id: "card-a2",
        schoolId: "school-a",
        boardId: "board-a1",
        studentId: "stu-a2",
        enrollmentStatus: "ATIVO",
        tags: [],
        hasSensitiveHealthTag: false,
        trimester1Opinion: null,
        trimester2Opinion: null,
        trimester3Opinion: null,
        trimester1BelowAvgJson: null,
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
      },
      {
        id: "card-b1",
        schoolId: "school-b",
        boardId: "board-b1",
        studentId: "stu-b1",
        enrollmentStatus: "ATIVO",
        tags: ["ALUNO_COM_LAUDO"],
        hasSensitiveHealthTag: true,
      },
    ];
    hoisted.db.entries = [];
    hoisted.db.minutes = [];
  });

  it("valida contratos Zod da matriz (desduplicação/ordenação 1..5) e clonagem de componentes", () => {
    const parsedMatrix = councilMatrixBatchSaveSchema.safeParse({
      trimester: 1,
      entries: [
        {
          studentId: "stu-a1",
          subjectId: "subj-a1",
          descriptorCodes: [4, 1, 4, 2],
          grade: 4.5,
        },
      ],
    });
    expect(parsedMatrix.success).toBe(true);
    if (parsedMatrix.success) {
      expect(parsedMatrix.data.entries[0].descriptorCodes).toEqual([1, 2, 4]);
    }

    const invalidCode = councilMatrixBatchSaveSchema.safeParse({
      trimester: 1,
      entries: [{ studentId: "stu-a1", subjectId: "subj-a1", descriptorCodes: [6] }],
    });
    expect(invalidCode.success).toBe(false);

    expect(councilSubjectsBatchSchema.safeParse({ sourceBoardId: "board-a1" }).success).toBe(true);
    expect(councilSubjectsBatchSchema.safeParse({ subjects: [] }).success).toBe(false);
  });

  it("bloqueia acesso e mutação cross-tenant via assertTenantOwnership e aplica modo leitura para GESTAO_SECRETARIA", async () => {
    const crossGet = await getBoardDetailRoute(
      new Request("http://localhost/api/conselho-classe/board-b1"),
      { params: Promise.resolve({ boardId: "board-b1" }) }
    );
    expect(crossGet.status).toBe(403);

    const crossPatch = await patchBoardMetadataRoute(
      new Request("http://localhost/api/conselho-classe/board-b1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatingMapMode: "SEMANAL" }),
      }),
      { params: Promise.resolve({ boardId: "board-b1" }) }
    );
    expect(crossPatch.status).toBe(403);

    // GESTAO_SECRETARIA sem vínculo operacional local na unidade: lê (200), mas recebe 403 em mutações
    hoisted.session = {
      user: {
        id: "usr-sec",
        name: "Secretária Municipal",
        email: "sec@tibagi.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [{ networkId: "net-1" }],
        schools: [],
      },
    };

    const readRes = await getBoardsRoute(
      new Request("http://localhost/api/conselho-classe?year=2026")
    );
    expect(readRes.status).toBe(200);

    const writeRes = await postBoardRoute(
      new Request("http://localhost/api/conselho-classe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classGroupId: "cg-a1", year: 2026 }),
      })
    );
    expect(writeRes.status).toBe(403);
  });

  it("permite clonar matriz curricular entre turmas da mesma escola e bloqueia clonagem de outra escola (403)", async () => {
    const cloneOk = await putSubjectsRoute(
      new Request("http://localhost/api/conselho-classe/board-a2/subjects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceBoardId: "board-a1" }),
      }),
      { params: Promise.resolve({ boardId: "board-a2" }) }
    );
    expect(cloneOk.status).toBe(200);
    const okJson = await cloneOk.json();
    expect(okJson.mode).toBe("CLONED");
    expect(okJson.subjects.map((s: any) => s.name)).toEqual(["Língua Portuguesa", "Matemática"]);
    expect(hoisted.auditCalls[0].action).toBe("CLONE_COUNCIL_SUBJECTS");
    expect(hoisted.auditCalls[0].schoolId).toBe("school-a");

    const cloneCross = await putSubjectsRoute(
      new Request("http://localhost/api/conselho-classe/board-a2/subjects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceBoardId: "board-b1" }),
      }),
      { params: Promise.resolve({ boardId: "board-a2" }) }
    );
    expect(cloneCross.status).toBe(403);
  });

  it("impede cross-tenant FK traversal na matriz e sincroniza componentes abaixo da média preservando itens manuais", async () => {
    const fkBad = await putMatrixRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/matrix", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          entries: [{ studentId: "stu-b1", subjectId: "subj-a1", descriptorCodes: [2] }],
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(fkBad.status).toBe(400);

    const matrixOk = await putMatrixRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/matrix", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          entries: [
            { studentId: "stu-a1", subjectId: "subj-a2", descriptorCodes: [2], grade: 4.5 },
          ],
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(matrixOk.status).toBe(200);

    const updatedCard = hoisted.db.cards.find((c) => c.studentId === "stu-a1");
    const belowList = JSON.parse(updatedCard.trimester1BelowAvgJson);
    expect(belowList).toEqual([
      { subjectId: "subj-a2", subjectName: "Matemática", grade: 4.5 },
      { subjectId: null, subjectName: "Projeto Integrador (manual)", grade: 5.0 },
    ]);
  });

  it("aplica controle LGPD/ECA em selos sensíveis (ALUNO_COM_LAUDO/AEE) e não vaza termos clínicos nem pareceres no AuditLog", async () => {
    const res = await patchStudentCardRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/students/stu-a2", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: ["ALUNO_COM_LAUDO", "ESTUDANTE_MONITOR"],
          trimester: 1,
          qualitativeOpinion: "Parecer sigiloso com recomendação médica confidencial.",
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1", studentId: "stu-a2" }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.card.hasSensitiveHealthTag).toBe(true);

    expect(hoisted.auditCalls).toHaveLength(1);
    const audit = hoisted.auditCalls[0];
    expect(audit.schoolId).toBe("school-a");
    const serializedDetails = JSON.stringify(audit.details);
    expect(serializedDetails).not.toContain("ALUNO_COM_LAUDO");
    expect(serializedDetails).not.toContain("AEE");
    expect(serializedDetails).not.toContain("recomendação médica confidencial");
  });

  it("gera rascunho de Ata Pós-Conselho sem auto-vincular toda a turma e ativa sigilo automático em deliberação com Laudo/AEE", async () => {
    // 1. POST_COUNCIL sem studentIds explícitos -> students: [] e vincula linkedMinuteId
    const postCouncilRes = await postGenerateMinuteRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/generate-minute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "POST_COUNCIL",
          trimester: 1,
          studentIds: [],
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(postCouncilRes.status).toBe(201);
    const postJson = await postCouncilRes.json();
    expect(postJson.minute.status).toBe("DRAFT");
    expect(postJson.minute.students).toHaveLength(0);
    expect(postJson.minute.actionItems).toHaveLength(1);
    expect(postJson.minute.summary).toContain("Melhora na leitura");
    expect(hoisted.db.trimesters[0].linkedMinuteId).toBe(postJson.minute.id);

    // 2. STUDENT_DELIBERATION para aluno com AEE -> isConfidential: true automático
    const studentMinuteRes = await postGenerateMinuteRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/generate-minute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "STUDENT_DELIBERATION",
          trimester: 1,
          studentIds: ["stu-a1"],
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(studentMinuteRes.status).toBe(201);
    const stuMinuteJson = await studentMinuteRes.json();
    expect(stuMinuteJson.minute.status).toBe("DRAFT");
    expect(stuMinuteJson.minute.isConfidential).toBe(true);
    expect(stuMinuteJson.minute.students).toHaveLength(1);
    expect(stuMinuteJson.minute.students[0].studentId).toBe("stu-a1");
  });

  it("sanitiza 100% erros internos inesperados (HTTP 500) sem expor error.message ao cliente", async () => {
    hoisted.forceDbError = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const resGet = await getBoardsRoute(
        new Request("http://localhost/api/conselho-classe?year=2026")
      );
      expect(resGet.status).toBe(500);
      const bodyGet = await resGet.json();
      expect(JSON.stringify(bodyGet)).not.toContain("FATAL_DB_SECRET_CONNECTION_LEAK");

      const resPatch = await patchTrimesterRoute(
        new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trimester: 1, positivePoints: "Teste" }),
        }),
        { params: Promise.resolve({ boardId: "board-a1" }) }
      );
      expect(resPatch.status).toBe(500);
      const bodyPatch = await resPatch.json();
      expect(JSON.stringify(bodyPatch)).not.toContain("FATAL_DB_SECRET_CONNECTION_LEAK");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("integra Prontuário 360º (loadStudent360Bundle + CouncilStudent360Section) com isolamento multi-tenant, onDelete Restrict e UX Writing limpo", async () => {
    // Injeta um cartão de outra escola por acidente para verificar o filtro defensivo no bundle
    hoisted.db.cards.push({
      id: "card-leak",
      schoolId: "school-b",
      boardId: "board-b1",
      studentId: "stu-a1",
      enrollmentStatus: "ATIVO",
      tags: ["ALUNO_COM_LAUDO"],
      hasSensitiveHealthTag: true,
    });

    const bundle = await loadStudent360Bundle("stu-a1");
    expect(bundle).not.toBeNull();
    expect(bundle?.councilCards).toHaveLength(1);
    expect(bundle?.councilCards[0].schoolId).toBe("school-a");

    const html = renderToString(
      React.createElement(CouncilStudent360Section, {
        councilCards: bundle!.councilCards as any,
      })
    );
    expect(html).toContain("Acompanhamento Trimestral (Conselho de Classe)");
    expect(html).toContain("AEE (Acompanhamento Pedagógico - Turno)");
    expect(html).toContain("Ocultar laudo e AEE");

    // Garante onDelete: Restrict nos 5 novos models em prisma/schema.prisma
    const schemaText = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );
    for (const modelName of [
      "ClassCouncilBoard",
      "ClassCouncilSubject",
      "ClassCouncilTrimester",
      "StudentCouncilCard",
      "StudentCouncilSubjectEntry",
    ]) {
      const match = schemaText.match(new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`));
      expect(match, `${modelName} deve existir no schema`).not.toBeNull();
      expect(match![1]).toMatch(/school\s+School\s+@relation\([^)]*onDelete:\s*Restrict\)/);
    }

    // Verifica ausência de termos proibidos pela Seção 10 de GEMINI.md em todos os arquivos de UI do módulo
    const uiFiles = [
      "src/components/conselho/types.ts",
      "src/components/conselho/CouncilHeaderMetadataCard.tsx",
      "src/components/conselho/CouncilSubjectsManagerModal.tsx",
      "src/components/conselho/CouncilTrimesterOverviewTab.tsx",
      "src/components/conselho/CouncilMatrixGrid.tsx",
      "src/components/conselho/CouncilStudentFichaModal.tsx",
      "src/components/conselho/CouncilPostMeetingTab.tsx",
      "src/components/conselho/CouncilStudent360Section.tsx",
      "src/app/conselho-classe/ConselhoIndexClient.tsx",
      "src/app/conselho-classe/[boardId]/ConselhoTurmaClient.tsx",
      "src/app/conselho-classe/[boardId]/imprimir/ConselhoPrintClient.tsx",
    ];
    const forbidden = [
      /f[ée]\s+p[úu]blica/i,
      /imut[áa]vel/i,
      /inviol[áa]vel/i,
      /SHA-256/i,
      /PBKDF2/i,
      /PDF\/A/i,
      /Conselho Tutelar/i,
      /Minist[ée]rio P[úu]blico/i,
      /\b14\.063\b/,
    ];
    for (const rel of uiFiles) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      for (const pat of forbidden) {
        expect(content, `${rel} violou padrão ${pat}`).not.toMatch(pat);
      }
    }
  });
});
