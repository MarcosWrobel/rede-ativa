import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
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
      edition: "INSTITUCIONAL_ESSENCIAL" as "INSTITUCIONAL_ESSENCIAL" | "PILOTO_INTEGRADA",
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
          if (where?.active !== undefined && (st.active ?? true) !== where.active) {
            return false;
          }
          if (where?.cgm?.in && !where.cgm.in.includes(st.cgm)) {
            return false;
          }
          return true;
        });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const st = hoisted.db.students.find((s) => s.id === where?.id);
        if (st) Object.assign(st, data);
        return st;
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
        let found: any = null;
        if (where?.id) {
          found = hoisted.db.boards.find((b) => b.id === where.id) || null;
        } else if (where?.schoolId_classGroupId_year) {
          const k = where.schoolId_classGroupId_year;
          found =
            hoisted.db.boards.find(
              (b) =>
                b.schoolId === k.schoolId &&
                b.classGroupId === k.classGroupId &&
                b.year === k.year
            ) || null;
        }
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
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id === hoisted.currentSchool.id) {
          return { id: hoisted.currentSchool.id, name: hoisted.currentSchool.name };
        }
        if (where?.id === "school-b") {
          return { id: "school-b", name: "Escola Estadual Beta" };
        }
        return null;
      }),
    },
  };

  return { prisma: client };
});

import {
  classCouncilBiSyncSchema,
  councilMatrixBatchSaveSchema,
  councilSubjectsBatchSchema,
  parsePtBrDecimal,
} from "@/lib/schemas";
import {
  isRegularTrimestralBiTurma,
  mergeBiDescriptorCodes,
  mergeBiStudentTags,
  normalizeBiDisciplineName,
  parseCgmAndAgeFromBiRow,
} from "@/services/classCouncilBiSyncService";
import { POST as postCouncilBiSyncRoute } from "@/app/api/conselho-classe/sync/route";
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
import { POST as postTeacherLinkRoute } from "@/app/api/conselho-classe/[boardId]/teacher-link/route";
import {
  POST as postTeacherPortalRoute,
  PUT as putTeacherPortalRoute,
} from "@/app/api/conselho-classe/teacher-portal/[token]/route";
import {
  createCouncilTeacherToken,
  verifyCouncilTeacherToken,
} from "@/lib/councilTeacherToken";
import { PUBLIC_PREFIXES, SELF_AUTH_API_PREFIXES } from "@/lib/proxyConstants";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import CouncilStudent360Section from "@/components/conselho/CouncilStudent360Section";
import CouncilMatrixGrid from "@/components/conselho/CouncilMatrixGrid";
import ProfessorConselhoClient from "@/app/conselho-classe/professor/[token]/ProfessorConselhoClient";

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
      "src/components/conselho/CouncilTeacherLinkModal.tsx",
      "src/components/conselho/CouncilStudentFichaModal.tsx",
      "src/components/conselho/CouncilPostMeetingTab.tsx",
      "src/components/conselho/CouncilStudent360Section.tsx",
      "src/app/conselho-classe/ConselhoIndexClient.tsx",
      "src/app/conselho-classe/[boardId]/ConselhoTurmaClient.tsx",
      "src/app/conselho-classe/[boardId]/imprimir/ConselhoPrintClient.tsx",
      "src/app/conselho-classe/professor/[token]/page.tsx",
      "src/app/conselho-classe/professor/[token]/ProfessorConselhoClient.tsx",
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

  it("normaliza dados do BI Aprendizagem (cgmkey, decimais PT-BR, filtro TRIMESTRAL, nomes de disciplinas e mesclagem não-destrutiva)", () => {
    expect(parsePtBrDecimal("5,8")).toBe(5.8);
    expect(parsePtBrDecimal("10,0")).toBe(10);
    expect(parsePtBrDecimal("-")).toBeNull();

    expect(
      classCouncilBiSyncSchema.safeParse({
        notasMapa: [
          {
            cgm: "1008044100",
            disciplinaRaw: "MATEMATICA - 1203",
            nota1Tri: "5,8",
            nota2Tri: "8,4",
          },
        ],
      }).success
    ).toBe(true);

    expect(
      classCouncilBiSyncSchema.safeParse({
        notasMapa: [
          {
            cgm: "1008044100",
            disciplinaRaw: "MATEMATICA - 1203",
            nota1Tri: "12,5",
          },
        ],
      }).success
    ).toBe(false);

    expect(
      parseCgmAndAgeFromBiRow({
        cgmkey: "1008044100-18",
        nome: "CLÓVIS AUGUSTO DO ROSÁRIO WALTE... - 1008044100",
      })
    ).toEqual({
      cgm: "1008044100",
      age: 18,
      cleanName: "CLÓVIS AUGUSTO DO ROSÁRIO WALTE...",
    });

    expect(
      isRegularTrimestralBiTurma({
        turmaRaw: "6º Série 1 Manhã - 2636446",
        periodoAvaliacao: "TRIMESTRAL",
        equivalenciaSeriacao: "Fundamental - 6º Ano",
        curso: "ENS FUND 6/9 ANO-SERIE - 4060",
      })
    ).toBe(true);
    expect(
      isRegularTrimestralBiTurma({
        turmaRaw: "Sem Seriação 2 Noite - 2691458",
        periodoAvaliacao: "TRIMESTRAL",
        equivalenciaSeriacao: "Médio - Sem Equivalencia",
        curso: "AULAS ESP. TREIN. ESPORTIVO - 3009",
      })
    ).toBe(false);
    expect(
      isRegularTrimestralBiTurma({
        turmaRaw: "1º Período 2 Tarde - 2749415",
        periodoAvaliacao: "",
        equivalenciaSeriacao: "Médio - Sem Equivalencia",
        curso: "PROG ALUNO MONITOR - 3042",
      })
    ).toBe(false);
    expect(
      isRegularTrimestralBiTurma({
        turmaRaw: "3º Período 1 Manhã - 2793482",
        periodoAvaliacao: "",
        equivalenciaSeriacao: "Fundamental - 7º Ano",
        curso: "ROBOTICA PARANA EF - 3025",
      })
    ).toBe(false);

    expect(normalizeBiDisciplineName("ADM.FINANC.E ORCAMENTARIA - 4191").canonicalName).toBe(
      "Adm. Financeira e Orçamentária"
    );
    expect(normalizeBiDisciplineName("ED DIG COMP PROG E IA - 6507").canonicalName).toBe(
      "Ed. Digital, Programação e IA"
    );
    expect(normalizeBiDisciplineName("EDUCACAO FISICA - 601").canonicalName).toBe(
      "Educação Física"
    );

    expect(mergeBiDescriptorCodes([3, 4], 5.2)).toEqual([2, 3, 4]);
    expect(mergeBiDescriptorCodes([2, 3], 7.8)).toEqual([1, 3]);
    expect(mergeBiDescriptorCodes([2, 5], 6.4)).toEqual([5]);

    const tags = mergeBiStudentTags({
      existingTags: ["ALUNO_COM_LAUDO", "AEE"],
      media1Tri: 5.4,
      media2Tri: 7.5,
      abaixoBasicoCount: 1,
    });
    expect(tags).toEqual(["ALUNO_COM_LAUDO", "AEE", "ESTUDANTE_SUPERACAO"]);

    const topTags = mergeBiStudentTags({
      existingTags: ["LIDER_DE_TURMA"],
      media1Tri: 9.2,
      media2Tri: 9.4,
      abaixoBasicoCount: 0,
    });
    expect(topTags).toEqual(["LIDER_DE_TURMA", "DESTAQUE_DA_TURMA"]);
  });

  it("bloqueia POST /api/conselho-classe/sync com 403 Forbidden na edição INSTITUCIONAL_ESSENCIAL e valida papel operacional na PILOTO_INTEGRADA", async () => {
    hoisted.currentSchool.edition = "INSTITUCIONAL_ESSENCIAL";
    const blockedRes = await postCouncilBiSyncRoute(
      new Request("http://localhost/api/conselho-classe/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notasMapa: [{ cgm: "1001112223", disciplinaRaw: "ARTE - 704", nota1Tri: "8,0" }],
        }),
      })
    );
    expect(blockedRes.status).toBe(403);

    hoisted.currentSchool.edition = "PILOTO_INTEGRADA";
    hoisted.session = {
      user: {
        id: "usr-sec",
        name: "Secretária Municipal",
        email: "sec@tibagi.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [{ networkId: "net-1" }],
      },
    };
    const secBlocked = await postCouncilBiSyncRoute(
      new Request("http://localhost/api/conselho-classe/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notasMapa: [{ cgm: "1001112223", disciplinaRaw: "ARTE - 704", nota1Tri: "8,0" }],
        }),
      })
    );
    expect(secBlocked.status).toBe(403);
  });

  it("sincroniza abas ESCOLA, TURMA e MAPA em POST /api/conselho-classe/sync preservando docentes, pareceres, textos e selos sensíveis", async () => {
    hoisted.currentSchool.edition = "PILOTO_INTEGRADA";
    hoisted.db.students[0].cgm = "1001112223";
    hoisted.db.students[1].cgm = "1002223334";
    hoisted.db.students[2].cgm = "2003334445"; // outra escola (school-b)
    hoisted.db.cards[0].tags = ["AEE", "ESTUDANTE_MONITOR"];
    hoisted.db.entries.push({
      id: "entry-manual-mat",
      schoolId: "school-a",
      cardId: "card-a1",
      subjectId: "subj-a2",
      trimester: 1,
      descriptorCodes: [3, 4],
      grade: null,
    });

    const res = await postCouncilBiSyncRoute(
      new Request("http://localhost/api/conselho-classe/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          turmas: [
            {
              turmaRaw: "6º Série 1 Manhã - 2636446",
              codturma: "2636446",
              periodoAvaliacao: "TRIMESTRAL",
              equivalenciaSeriacao: "Fundamental - 6º Ano",
              curso: "ENS FUND 6/9 ANO-SERIE - 4060",
              alunosMatriculados: 24,
              alunosAvaliados: 24,
            },
            {
              turmaRaw: "Sem Seriação 1 Tarde - 2691389",
              periodoAvaliacao: "",
              equivalenciaSeriacao: "Médio - Sem Equivalencia",
              curso: "AULAS ESP. TREIN. ESPORTIVO - 3009",
            },
          ],
          alunosTurma: [
            {
              cgmkey: "1001112223-15",
              nome: "ANA CLARA SOUZA - 1001112223",
              codturma: "2636446",
              media1Tri: "5,5",
              media2Tri: "7,8",
              abaixoBasicoCount: 1,
            },
          ],
          notasMapa: [
            {
              cgm: "1001112223",
              nome: "ANA CLARA SOUZA - 1001112223",
              codturma: "2636446",
              disciplinaRaw: "MATEMATICA - 1203",
              disciplinaCode: "1203",
              nota1Tri: "4,8",
              nota2Tri: "7,5",
            },
            {
              cgm: "1001112223",
              nome: "ANA CLARA SOUZA - 1001112223",
              codturma: "2636446",
              disciplinaRaw: "CIENCIAS - 301",
              disciplinaCode: "301",
              nota1Tri: "8,5",
            },
            {
              // Aluno pertencente a school-b: não pode ser pareado nem modificado por school-a
              cgm: "2003334445",
              nome: "CARLOS MENDES - 2003334445",
              disciplinaRaw: "CIENCIAS - 301",
              nota1Tri: "3,0",
            },
          ],
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sucesso).toBe(true);
    expect(json.turmasRegularesRecebidas).toBe(1);
    expect(json.turmasIgnoradasNaoRegulares).toBe(1);
    expect(json.alunosPareados).toBe(1);
    expect(json.disciplinasCriadas).toBe(1);
    expect(json.notasGravadas).toBe(3);
    expect(json.naoEncontradosTotal).toBe(1);

    // Idade atualizada via cgmkey e aluno de school-b intocado
    expect(hoisted.db.students[0].age).toBe(15);
    expect(hoisted.db.students[2].age).toBeUndefined();

    // Docente titular de Matemática preservado e apenas Ciências adicionada
    const matSub = hoisted.db.subjects.find((s) => s.id === "subj-a2");
    expect(matSub?.teacherName).toBe("Prof. Marcos");
    expect(hoisted.db.subjects.some((s) => s.name === "Ciências" && s.boardId === "board-a1")).toBe(
      true
    );

    // Descritivos manuais preservados [3, 4] + código 2 no 1º Tri (< 6.0) e código 1 no 2º Tri (>= 7.0)
    const matTri1 = hoisted.db.entries.find(
      (e) => e.cardId === "card-a1" && e.subjectId === "subj-a2" && e.trimester === 1
    );
    expect(matTri1?.grade).toBe(4.8);
    expect(matTri1?.descriptorCodes).toEqual([2, 3, 4]);

    const matTri2 = hoisted.db.entries.find(
      (e) => e.cardId === "card-a1" && e.subjectId === "subj-a2" && e.trimester === 2
    );
    expect(matTri2?.grade).toBe(7.5);
    expect(matTri2?.descriptorCodes).toEqual([1]);

    // Card preservou parecer e manual below-avg sem subjectId, incluiu Matemática < 6.0 e selo de superação mantendo AEE
    const cardA1 = hoisted.db.cards[0];
    expect(cardA1.trimester1Opinion).toBe("Acompanhamento com apoio.");
    expect(cardA1.tags).toEqual(["AEE", "ESTUDANTE_MONITOR", "ESTUDANTE_SUPERACAO"]);
    const below1 = JSON.parse(cardA1.trimester1BelowAvgJson);
    expect(below1).toEqual([
      { subjectId: "subj-a2", subjectName: "Matemática", grade: 4.8 },
      { subjectId: null, subjectName: "Projeto Integrador (manual)", grade: 5 },
    ]);

    // Trimester.positivePoints NÃO foi sobrescrito pelo BI
    expect(hoisted.db.trimesters[0].positivePoints).toBe("Turma participativa");
    expect(hoisted.db.trimesters[0].attentionPoints).toBeNull();

    // Auditoria com schoolId na raiz e sem PII/notas
    expect(hoisted.auditCalls).toHaveLength(1);
    expect(hoisted.auditCalls[0].action).toBe("SYNC_CLASS_COUNCIL_BI");
    expect(hoisted.auditCalls[0].schoolId).toBe("school-a");
    const serializedAudit = JSON.stringify(hoisted.auditCalls[0].details);
    expect(serializedAudit).not.toContain("Ana Clara");
    expect(serializedAudit).not.toContain("1001112223");
    expect(serializedAudit).not.toContain("4.8");
  });

  it("extension/content.js extrai corretamente MAPA com linhas compactas (11px), múltiplos .mid-viewport e Viewport Guard 2D e rota /sync sanitiza HTTP 500", async () => {
    const contentJs = fs.readFileSync(
      path.resolve(process.cwd(), "extension/content.js"),
      "utf8"
    );
    expect(contentJs).toContain(
      "${matchedRow.cgm}|${matchedSub.subjectCode}|${matchedSub.trimester}"
    );
    expect(contentJs).toContain("bounds.dataLeft");
    expect(contentJs).toContain("bounds.dataRight");
    expect(contentJs).toContain("bounds.dataTop");
    expect(contentJs).toContain("bounds.dataBottom");
    expect(contentJs).toContain("/api/conselho-classe/sync");
    expect(contentJs).toContain("isTrustedSyncServerUrl");
    expect(contentJs).not.toContain("rect.height < 12");

    // Simula DOM compacto real do Power BI (múltiplos .mid-viewport, linha 11px, título estreito e colunas cortadas nas bordas)
    type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
    const mkRect = (left: number, top: number, right: number, bottom: number): Rect => ({
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    });

    class FakeEl {
      id = "";
      classes: string[];
      attrs: Record<string, string>;
      innerText = "";
      textContent = "";
      _innerHTML = "";
      style: Record<string, string> = {};
      parentElement: FakeEl | null = null;
      children: FakeEl[] = [];
      listeners: Record<string, Array<(e?: any) => void>> = {};
      rect: Rect;
      scrollTop = 0;
      scrollLeft = 0;
      scrollHeight = 0;
      clientHeight = 0;
      scrollWidth = 0;
      clientWidth = 0;

      constructor(opts: {
        classes?: string[];
        attrs?: Record<string, string>;
        text?: string;
        rect?: Rect;
        id?: string;
      } = {}) {
        this.classes = opts.classes || [];
        this.attrs = opts.attrs || {};
        this.innerText = opts.text || "";
        this.textContent = opts.text || "";
        this.rect = opts.rect || mkRect(0, 0, 0, 0);
        if (opts.id) this.id = opts.id;
      }

      set innerHTML(val: string) {
        this._innerHTML = val;
      }
      get innerHTML() {
        return this._innerHTML;
      }

      append(...nodes: FakeEl[]) {
        for (const n of nodes) {
          n.parentElement = this;
          this.children.push(n);
        }
        return this;
      }
      appendChild(node: FakeEl) {
        this.append(node);
        return node;
      }
      getAttribute(k: string) {
        if (k === "id") return this.id || null;
        return this.attrs[k] ?? null;
      }
      setAttribute(k: string, v: string) {
        if (k === "id") this.id = v;
        this.attrs[k] = v;
      }
      getBoundingClientRect() {
        return this.rect;
      }
      contains(other: FakeEl | null): boolean {
        let cur = other;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentElement;
        }
        return false;
      }
      matchesSimple(sel: string): boolean {
        const s = sel.trim();
        if (s === "*") return true;
        if (s.startsWith("#")) return this.id === s.slice(1);
        if (s.startsWith(".")) return this.classes.includes(s.slice(1));
        const attrMatch = s.match(/^\[([^=\]]+)="([^"]+)"\]$/);
        if (attrMatch) return this.attrs[attrMatch[1]] === attrMatch[2];
        return false;
      }
      matches(selector: string): boolean {
        return selector.split(",").some((part) => {
          const tokens = part.trim().split(/\s+/);
          if (tokens.length === 1) return this.matchesSimple(tokens[0]);
          if (!this.matchesSimple(tokens[tokens.length - 1])) return false;
          let cur: FakeEl | null = this.parentElement;
          let idx = tokens.length - 2;
          while (cur && idx >= 0) {
            if (cur.matchesSimple(tokens[idx])) idx--;
            cur = cur.parentElement;
          }
          return idx < 0;
        });
      }
      closest(selector: string): FakeEl | null {
        let cur: FakeEl | null = this;
        while (cur) {
          if (cur.matches(selector)) return cur;
          cur = cur.parentElement;
        }
        return null;
      }
      querySelectorAll(selector: string): FakeEl[] {
        const out: FakeEl[] = [];
        const visit = (node: FakeEl) => {
          for (const child of node.children) {
            if (child.matches(selector)) out.push(child);
            visit(child);
          }
        };
        visit(this);
        return out;
      }
      querySelector(selector: string): FakeEl | null {
        return this.querySelectorAll(selector)[0] ?? null;
      }
      addEventListener(ev: string, fn: (e?: any) => void) {
        (this.listeners[ev] ||= []).push(fn);
      }
      async click() {
        await Promise.all(
          (this.listeners.click || []).map((fn) => fn({ stopPropagation: () => {} }))
        );
      }
    }

    const root = new FakeEl({ id: "root", rect: mkRect(0, 0, 1200, 800) });
    const bodyEl = new FakeEl({ id: "body", rect: mkRect(0, 0, 1200, 800) });
    root.append(bodyEl);

    const grid = new FakeEl({
      classes: ["pivotTable"],
      attrs: { role: "grid" },
      text: "ALUNO - CGM\nADILSON MARTINS JUNIOR - 1012704492\n1ºTri\n2ºTri\n3ºTri",
      rect: mkRect(100, 100, 800, 520),
    });
    const colHeaders = new FakeEl({ classes: ["columnHeaders"], rect: mkRect(300, 100, 790, 160) });
    // Primeiro .mid-viewport dentro de .columnHeaders (armadilha de altura 60px!)
    const colHeaderMidVp = new FakeEl({ classes: ["mid-viewport"], rect: mkRect(300, 100, 790, 160) });
    colHeaders.append(colHeaderMidVp);

    // 1) Coluna FISICA - 901 parcialmente cortada à esquerda (sem 1ºTri dentro de dataLeft=300)
    const fisOuter = new FakeEl({
      attrs: { role: "columnheader" },
      text: "FISICA - 901",
      rect: mkRect(240, 102, 340, 128),
    });
    const fisTri2 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "2ºTri", rect: mkRect(301, 130, 320, 158) });
    const fisTri3 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "3ºTri", rect: mkRect(321, 130, 340, 158) });

    // 2) Coluna GEOGRAFIA - 401 inteiramente visível, com nó folha de título estreito (54px) dentro de columnheader largo (140px)
    const geoOuter = new FakeEl({
      attrs: { role: "columnheader" },
      text: "GEOGRAFIA - 401",
      rect: mkRect(350, 102, 490, 128),
    });
    const geoLeaf = new FakeEl({
      classes: ["pivotTableCellWrap"],
      text: "GEOGRAFIA - 401",
      rect: mkRect(393, 102, 447, 128), // 54px (< 60px)!
    });
    geoOuter.append(geoLeaf);
    const geoTri1 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "1ºTri", rect: mkRect(352, 130, 384, 158) });
    const geoTri2 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "2ºTri", rect: mkRect(385, 130, 417, 158) });
    const geoTri3 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "3ºTri", rect: mkRect(418, 130, 450, 158) });
    const geoTotal = new FakeEl({ classes: ["pivotTableCellWrap"], text: "Total", rect: mkRect(451, 130, 488, 158) });

    // 3) Coluna HISTORIA - 501 parcialmente cortada à direita (right 820 > dataRight 790)
    const histOuter = new FakeEl({
      attrs: { role: "columnheader" },
      text: "HISTORIA - 501",
      rect: mkRect(680, 102, 820, 128),
    });
    const histTri1 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "1ºTri", rect: mkRect(682, 130, 714, 158) });
    const histTri2 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "2ºTri", rect: mkRect(715, 130, 747, 158) });
    const histTri3 = new FakeEl({ classes: ["pivotTableCellWrap"], text: "3ºTri", rect: mkRect(748, 130, 780, 158) });

    colHeaderMidVp.append(
      fisOuter, fisTri2, fisTri3,
      geoOuter, geoTri1, geoTri2, geoTri3, geoTotal,
      histOuter, histTri1, histTri2, histTri3
    );

    // Linha de estudante compacta de 11px (< 12px!)
    const rowHeaders = new FakeEl({ classes: ["rowHeaders"], rect: mkRect(100, 160, 300, 510) });
    const rowStu = new FakeEl({
      classes: ["pivotTableCellWrap"],
      text: "ADILSON MARTINS JUNIOR - 1012704492",
      rect: mkRect(104, 164, 298, 175), // height = 11px
    });
    rowHeaders.append(rowStu);

    const bodyMidVp = new FakeEl({ classes: ["mid-viewport"], rect: mkRect(300, 160, 790, 510) });
    const bodyCells = new FakeEl({ classes: ["bodyCells"], rect: mkRect(300, 160, 790, 510) });
    bodyMidVp.append(bodyCells);

    // Células de nota: cortadas (FISICA, HISTORIA) e visíveis (GEOGRAFIA)
    bodyCells.append(
      new FakeEl({ classes: ["pivotTableCellWrap"], text: "4,5", rect: mkRect(301, 164, 320, 175) }), // FISICA cortada -> ignorar
      new FakeEl({ classes: ["pivotTableCellWrap"], text: "10,0", rect: mkRect(352, 164, 384, 175) }), // GEO 1ºTri -> capturar
      new FakeEl({ classes: ["pivotTableCellWrap"], text: "9,5", rect: mkRect(385, 164, 417, 175) }), // GEO 2ºTri -> capturar
      new FakeEl({ classes: ["pivotTableCellWrap"], text: "6,4", rect: mkRect(418, 164, 450, 175) }), // GEO 3ºTri -> capturar
      new FakeEl({ classes: ["pivotTableCellWrap"], text: "8,4", rect: mkRect(682, 164, 714, 175) }) // HISTORIA cortada -> ignorar
    );

    grid.append(colHeaders, rowHeaders, bodyMidVp);
    bodyEl.append(grid);

    // Botões sintéticos do widget para acionar copiarJSON sem esperar timer de load
    let copiedJson = "";
    const scheduledFns: Array<() => void> = [];
    const btnById = new Map<string, FakeEl>();

    const fakeDoc: any = {
      readyState: "loading",
      body: bodyEl,
      querySelectorAll: (sel: string) => root.querySelectorAll(sel),
      querySelector: (sel: string) => root.querySelector(sel),
      getElementById: (id: string) => root.querySelector(`#${id}`) || btnById.get(id) || null,
      createElement: () => {
        const el = new FakeEl();
        Object.defineProperty(el, "innerHTML", {
          set(html: string) {
            el._innerHTML = html;
            const matches = html.matchAll(/id="([^"]+)"/g);
            for (const m of matches) {
              if (!btnById.has(m[1])) {
                const sub = new FakeEl({ id: m[1] });
                btnById.set(m[1], sub);
                el.append(sub);
              }
            }
          },
          get() {
            return el._innerHTML;
          },
        });
        return el;
      },
      addEventListener: () => {},
      dispatchEvent: () => {},
    };

    const winListeners = new Map<string, Array<(e?: any) => void>>();
    const sandbox: any = {
      window: {
        addEventListener: (ev: string, fn: (e?: any) => void) => {
          const arr = winListeners.get(ev) || [];
          arr.push(fn);
          winListeners.set(ev, arr);
        },
        dispatchEvent: () => {},
      },
      document: fakeDoc,
      navigator: {
        clipboard: {
          writeText: async (text: string) => {
            copiedJson = text;
          },
        },
      },
      chrome: {},
      setTimeout: (fn: () => void) => {
        scheduledFns.push(fn);
        return scheduledFns.length;
      },
      clearTimeout: () => {},
      console: { log: () => {}, warn: () => {}, error: () => {} },
      URL,
      Set,
      Map,
      Array,
      Math,
      Number,
      String,
      RegExp,
      JSON,
      Date,
      Promise,
      parseFloat,
      parseInt,
      isNaN,
      alert: () => {},
    };
    sandbox.window.window = sandbox.window;

    vm.runInNewContext(contentJs, sandbox, { filename: "extension/content.js" });
    for (const fn of winListeners.get("load") || []) fn();
    for (const fn of scheduledFns) fn();

    await btnById.get("leo-btn-copy-json")!.click();
    const extractedPayload = JSON.parse(copiedJson);
    expect(extractedPayload.notasMapa).toEqual([
      {
        cgm: "1012704492",
        nome: "ADILSON MARTINS JUNIOR - 1012704492",
        disciplinaRaw: "GEOGRAFIA - 401",
        disciplinaCode: "401",
        nota1Tri: 10,
        nota2Tri: 9.5,
        nota3Tri: 6.4,
      },
    ]);

    hoisted.currentSchool.edition = "PILOTO_INTEGRADA";
    hoisted.forceDbError = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const errRes = await postCouncilBiSyncRoute(
        new Request("http://localhost/api/conselho-classe/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notasMapa: [{ cgm: "1001112223", disciplinaRaw: "ARTE - 704", nota1Tri: "7,0" }],
          }),
        })
      );
      expect(errRes.status).toBe(500);
      const errBody = await errRes.json();
      expect(JSON.stringify(errBody)).not.toContain("FATAL_DB_SECRET_CONNECTION_LEAK");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("emite e valida token HMAC stateless do link docente, respeitando expiração e bloqueando adulteração", () => {
    expect(PUBLIC_PREFIXES).toContain("/conselho-classe/professor/");
    expect(SELF_AUTH_API_PREFIXES).toContain("/api/conselho-classe/teacher-portal/");

    const baseNow = 1_760_000_000_000;
    const issued = createCouncilTeacherToken({
      schoolId: "school-a",
      boardId: "board-a1",
      trimester: 2,
      subjectId: "subj-a2",
      expiresInDays: 7,
      nowMs: baseNow,
    });

    const ok = verifyCouncilTeacherToken(issued.token, baseNow + 60_000);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.payload).toEqual({
        v: 1,
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 2,
        subjectId: "subj-a2",
        exp: baseNow + 7 * 24 * 60 * 60 * 1000,
      });
    }

    // Adulteração de assinatura ou payload
    const [payloadPart, sigPart] = issued.token.split(".");
    const tamperedSig = `${payloadPart}.${sigPart.slice(0, -2)}AA`;
    const tamperedCheck = verifyCouncilTeacherToken(tamperedSig, baseNow + 1000);
    expect(tamperedCheck.ok).toBe(false);
    if (!tamperedCheck.ok) {
      expect(tamperedCheck.reason).toBe("invalid");
    }

    const forgedPayload = Buffer.from(
      JSON.stringify({
        v: 1,
        schoolId: "school-b",
        boardId: "board-b1",
        trimester: 1,
        subjectId: null,
        exp: baseNow + 86_400_000,
      }),
      "utf8"
    ).toString("base64url");
    expect(verifyCouncilTeacherToken(`${forgedPayload}.${sigPart}`, baseNow + 1000).ok).toBe(
      false
    );

    // Expiração estrita no limite exp
    const expiredCheck = verifyCouncilTeacherToken(
      issued.token,
      baseNow + 7 * 24 * 60 * 60 * 1000
    );
    expect(expiredCheck.ok).toBe(false);
    if (!expiredCheck.ok) {
      expect(expiredCheck.reason).toBe("expired");
    }
  });

  it("gera link e QR Code docente com isolamento multi-tenant, RBAC de leitura e auditoria com schoolId raiz", async () => {
    const resOk = await postTeacherLinkRoute(
      new Request("https://www.redeativa.app.br/api/conselho-classe/board-a1/teacher-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "www.redeativa.app.br",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({
          trimester: 1,
          subjectId: "subj-a2",
          expiresInDays: 7,
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(resOk.status).toBe(200);
    const bodyOk = await resOk.json();
    expect(bodyOk.success).toBe(true);
    expect(bodyOk.url).toContain("https://www.redeativa.app.br/conselho-classe/professor/");
    expect(bodyOk.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(bodyOk.subjectName).toBe("Matemática");

    expect(hoisted.auditCalls).toHaveLength(1);
    expect(hoisted.auditCalls[0].action).toBe("CREATE_COUNCIL_TEACHER_LINK");
    expect(hoisted.auditCalls[0].schoolId).toBe("school-a");

    // Subject de outra turma/escola retorna 404
    const badSubject = await postTeacherLinkRoute(
      new Request("https://www.redeativa.app.br/api/conselho-classe/board-a1/teacher-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimester: 1, subjectId: "subj-b1" }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(badSubject.status).toBe(404);

    // Cross-tenant board retorna 403
    const crossTenant = await postTeacherLinkRoute(
      new Request("https://www.redeativa.app.br/api/conselho-classe/board-b1/teacher-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimester: 1 }),
      }),
      { params: Promise.resolve({ boardId: "board-b1" }) }
    );
    expect(crossTenant.status).toBe(403);

    // GESTAO_SECRETARIA sem vínculo local recebe 403
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
    const secBlocked = await postTeacherLinkRoute(
      new Request("https://www.redeativa.app.br/api/conselho-classe/board-a1/teacher-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimester: 1 }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(secBlocked.status).toBe(403);
  });

  it("portal docente valida @escola.pr.gov.br, oculta selos de saúde/pareceres, vincula docente e preserva notas do BI", async () => {
    const prevDevAuth = process.env.ENABLE_DEV_AUTH;
    process.env.ENABLE_DEV_AUTH = "true";

    try {
      // Nota pré-existente importada do BI para stu-a1 em Matemática (subj-a2)
      hoisted.db.entries.push({
        id: "entry-bi-mat-a1",
        schoolId: "school-a",
        cardId: "card-a1",
        subjectId: "subj-a2",
        trimester: 1,
        descriptorCodes: [2],
        grade: 4.8,
      });
      hoisted.db.cards[0].tags = ["ALUNO_COM_LAUDO", "AEE", "ESTUDANTE_MONITOR"];
      hoisted.db.cards[0].trimester1Opinion = "Parecer reservado com detalhes de laudo clínico.";

      const { token } = createCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        subjectId: null,
        expiresInDays: 7,
      });

      // 1. Rejeita conta fora do domínio @escola.pr.gov.br
      const invalidDomainRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:docente@gmail.com" }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(invalidDomainRes.status).toBe(401);

      // 2. Autentica docente @escola.pr.gov.br e oculta estritamente selos clínicos e pareceres
      const authRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.oliveira@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(authRes.status).toBe(200);
      const authBody = await authRes.json();
      expect(authBody.verifiedEmail).toBe("marcos.oliveira@escola.pr.gov.br");
      expect(authBody.council.students).toHaveLength(2);

      const serializedAuth = JSON.stringify(authBody);
      expect(serializedAuth).not.toContain("ALUNO_COM_LAUDO");
      expect(serializedAuth).not.toContain("AEE");
      expect(serializedAuth).not.toContain("ESTUDANTE_MONITOR");
      expect(serializedAuth).not.toContain("Parecer reservado");
      expect(serializedAuth).not.toContain("hasSensitiveHealthTag");
      expect(serializedAuth).not.toContain("isSpecialNeeds");

      // 3. Envio pelo portal docente preenche teacherEmail/teacherName em disciplina vaga,
      //    preserva a nota 4.8 do BI e recalcula trimester1BelowAvgJson + AuditLog
      const submitRes = await putTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.oliveira@escola.pr.gov.br",
            subjectId: "subj-a2",
            entries: [
              { studentId: "stu-a1", descriptorCodes: [2, 5] },
              { studentId: "stu-a2", descriptorCodes: [1] },
            ],
          }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(submitRes.status).toBe(200);
      const submitBody = await submitRes.json();
      expect(submitBody.result.updatedCount).toBe(2);

      const matSubject = hoisted.db.subjects.find((s) => s.id === "subj-a2");
      expect(matSubject.teacherEmail).toBe("marcos.oliveira@escola.pr.gov.br");
      expect(matSubject.teacherName).toBe("Prof. Marcos");

      const matEntryA1 = hoisted.db.entries.find(
        (e) => e.cardId === "card-a1" && e.subjectId === "subj-a2" && e.trimester === 1
      );
      expect(matEntryA1.descriptorCodes).toEqual([2, 5]);
      expect(matEntryA1.grade).toBe(4.8);
      expect(matEntryA1.updatedByEmail).toBe("marcos.oliveira@escola.pr.gov.br");

      const updatedCardA1 = hoisted.db.cards.find((c) => c.id === "card-a1");
      const belowAvg = JSON.parse(updatedCardA1.trimester1BelowAvgJson);
      expect(belowAvg).toEqual([
        { subjectId: "subj-a2", subjectName: "Matemática", grade: 4.8 },
        { subjectId: null, subjectName: "Projeto Integrador (manual)", grade: 5 },
      ]);

      expect(hoisted.auditCalls).toHaveLength(1);
      expect(hoisted.auditCalls[0].action).toBe("TEACHER_SUBMIT_COUNCIL_SUBJECT");
      expect(hoisted.auditCalls[0].schoolId).toBe("school-a");

      // 4. Outro professor @escola tentando sobrescrever disciplina já vinculada recebe 403
      const hijackRes = await putTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:outro.docente@escola.pr.gov.br",
            subjectId: "subj-a2",
            entries: [{ studentId: "stu-a1", descriptorCodes: [1] }],
          }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(hijackRes.status).toBe(403);
    } finally {
      if (prevDevAuth === undefined) {
        delete process.env.ENABLE_DEV_AUTH;
      } else {
        process.env.ENABLE_DEV_AUTH = prevDevAuth;
      }
    }
  });

  it("renderiza CouncilMatrixGrid com tags pedagógicas, notas BI somente leitura e ações do fluxo docente (sem input numérico de nota)", () => {
    const boardDetail: any = {
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
      classGroup: {
        id: "cg-a1",
        name: "6º Ano A",
        segment: "FUNDAMENTAL",
        shift: "MANHA",
      },
      subjects: [
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
      ],
      trimesters: [{ id: "tri-1", schoolId: "school-a", boardId: "board-a1", trimester: 1, status: "IN_PROGRESS" }],
      studentCards: [
        {
          id: "card-a1",
          schoolId: "school-a",
          boardId: "board-a1",
          studentId: "stu-a1",
          enrollmentStatus: "ATIVO",
          externalEvalEd1Percent: null,
          externalEvalEd2Percent: null,
          externalEvalEd3Percent: null,
          tags: [],
          hasSensitiveHealthTag: false,
          trimester1Opinion: null,
          trimester2Opinion: null,
          trimester3Opinion: null,
          trimester1BelowAvgJson: null,
          trimester2BelowAvgJson: null,
          trimester3BelowAvgJson: null,
          student: {
            id: "stu-a1",
            name: "Ana Clara Souza",
            cgm: "1001",
            active: true,
            isSpecialNeeds: false,
            isExchangeStudent: false,
            age: 14,
            lowAttendanceRecord: null,
          },
          subjectEntries: [
            {
              id: "e-1",
              schoolId: "school-a",
              cardId: "card-a1",
              subjectId: "subj-a1",
              trimester: 1,
              descriptorCodes: [1],
              grade: 8.5,
            },
            {
              id: "e-2",
              schoolId: "school-a",
              cardId: "card-a1",
              subjectId: "subj-a2",
              trimester: 1,
              descriptorCodes: [2],
              grade: 4.8,
            },
          ],
        },
        {
          id: "card-a2",
          schoolId: "school-a",
          boardId: "board-a1",
          studentId: "stu-a2",
          enrollmentStatus: "ATIVO",
          externalEvalEd1Percent: null,
          externalEvalEd2Percent: null,
          externalEvalEd3Percent: null,
          tags: [],
          hasSensitiveHealthTag: false,
          trimester1Opinion: null,
          trimester2Opinion: null,
          trimester3Opinion: null,
          trimester1BelowAvgJson: null,
          trimester2BelowAvgJson: null,
          trimester3BelowAvgJson: null,
          student: {
            id: "stu-a2",
            name: "Bruno Oliveira",
            cgm: "1002",
            active: true,
            isSpecialNeeds: false,
            isExchangeStudent: false,
            age: 14,
            lowAttendanceRecord: null,
          },
          subjectEntries: [],
        },
      ],
    };

    const matrixHtml = renderToString(
      React.createElement(CouncilMatrixGrid, {
        board: boardDetail,
        activeTrimester: 1,
        hideSensitiveTags: false,
        onOpenStudentModal: () => {},
        onOpenSubjectsModal: () => {},
        onMatrixSaved: async () => {},
        onNotify: () => {},
      })
    );

    expect(matrixHtml).toContain("Atende");
    expect(matrixHtml).toContain("Dificuldade");
    expect(matrixHtml).toContain("Conduta");
    expect(matrixHtml).toContain("Infrequência");
    expect(matrixHtml).toContain("Assiduidade");
    expect(matrixHtml).toContain("Nota 8,5");
    expect(matrixHtml).toContain("Nota 4,8 • Abaixo da média");
    expect(matrixHtml).toContain("Preencher vazios: Atende");
    expect(matrixHtml).toContain("Link para professores");
    expect(matrixHtml).toContain("Sincronizar lançamentos");
    expect(matrixHtml).toContain("Com alertas (Dificuldade, Conduta, Infrequência)");
    expect(matrixHtml).toContain("Prof. Marcos • 1/2");
    expect(matrixHtml).not.toContain('type="number"');
    expect(matrixHtml).not.toContain("Vazios = 1");

    const portalLoginHtml = renderToString(
      React.createElement(ProfessorConselhoClient, {
        token: "sample-token",
        schoolName: "Escola Estadual Alpha",
        classNameLabel: "6º Ano A",
        segmentLabel: "Ensino Fundamental",
        shiftLabel: "Manhã",
        year: 2026,
        trimester: 1,
        lockedSubjectName: "Matemática",
        googleClientId: "",
        enableDevAuth: false,
      })
    );
    expect(portalLoginHtml).toContain("Conselho de Classe — Lançamento Docente");
    expect(portalLoginHtml).toContain("@escola.pr.gov.br");
    expect(portalLoginHtml).toContain("6º Ano A");
    expect(portalLoginHtml).not.toContain("Ana Clara Souza");
  });
});
