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
    getAuthorizedCurrentSchool: vi.fn(async (session?: {
      user?: {
        role?: string;
        active?: boolean;
        schoolId?: string | null;
        schools?: Array<{ schoolId?: string | null; active?: boolean }>;
        networks?: string[];
      };
    } | null, explicitSchoolId?: string | null) => {
      const user = session?.user;
      const school = hoisted.currentSchool as (typeof hoisted.currentSchool & { networkId?: string | null }) | null;
      if (!user || user.active === false || !school) return null;
      if (explicitSchoolId && explicitSchoolId !== school.id && user.role !== "SUPERADMIN") {
        const inSchools = Array.isArray(user.schools)
          ? user.schools.some((s) => s?.schoolId === explicitSchoolId && s?.active !== false)
          : false;
        if (!inSchools && user.schoolId !== explicitSchoolId) return null;
      }
      if (user.role === "SUPERADMIN") return school;
      if (user.schoolId && user.schoolId === school.id) return school;
      if (Array.isArray(user.schools) && user.schools.some((s) => s?.schoolId === school.id && s?.active !== false)) {
        return school;
      }
      if (
        user.role === "GESTAO_SECRETARIA" &&
        Array.isArray(user.networks) &&
        user.networks.length > 0 &&
        (!school.networkId || user.networks.includes(school.networkId))
      ) {
        return school;
      }
      return null;
    }),
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
    user: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        if (where.email !== "pedagoga@escola-a.pr.gov.br") return null;
        return {
          active: true,
          role: "PEDAGOGA",
          schools: select.schools.where.schoolId === "school-a" ? [{ role: "PEDAGOGA" }] : [],
        };
      }),
    },
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
            (!where?.schoolId || t.schoolId === where.schoolId) &&
            (where?.trimester === undefined || t.trimester === where.trimester)
        );
      }),
      findUnique: vi.fn(async ({ where }: any = {}) => {
        if (where?.id) {
          return hoisted.db.trimesters.find((t) => t.id === where.id) || null;
        }
        if (where?.boardId_trimester) {
          const k = where.boardId_trimester;
          return (
            hoisted.db.trimesters.find(
              (t) => t.boardId === k.boardId && t.trimester === k.trimester
            ) || null
          );
        }
        return null;
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
      update: vi.fn(async ({ where, data }: any) => {
        let found: any = null;
        if (where?.id) {
          found = hoisted.db.trimesters.find((t) => t.id === where.id) || null;
        } else if (where?.boardId_trimester) {
          const k = where.boardId_trimester;
          found =
            hoisted.db.trimesters.find(
              (t) => t.boardId === k.boardId && t.trimester === k.trimester
            ) || null;
        }
        if (found) Object.assign(found, data, { updatedAt: new Date() });
        return found;
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
import { POST as postPreCouncilLinkRoute } from "@/app/api/conselho-classe/[boardId]/pre-council-link/route";
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
  verifyCouncilTeacherToken,
  verifyPreCouncilTeacherToken,
} from "@/lib/councilTeacherToken";
import {
  buildCitedStudentsSummary,
  buildInitialPreCouncilData,
  buildLiveAlertsFromDraft,
  buildPreCouncilStudentAlertsBySubject,
  canConversationConfirmDigitalAck,
  clearTeacherPortalLocalDraft,
  getMatrixFillStatsBySubject,
  getPreCouncilProgress,
  loadTeacherPortalLocalDraft,
  mergeSubjectsIntoPreCouncilConversations,
  parsePreCouncilData,
  saveTeacherPortalLocalDraft,
} from "@/components/conselho/preCouncilUtils";
import { PUBLIC_PREFIXES, SELF_AUTH_API_PREFIXES } from "@/lib/proxyConstants";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import CouncilStudent360Section from "@/components/conselho/CouncilStudent360Section";
import CouncilMatrixGrid from "@/components/conselho/CouncilMatrixGrid";
import CouncilPreCouncilTab from "@/components/conselho/CouncilPreCouncilTab";
import ProfessorConselhoClient from "@/app/conselho-classe/professor/[token]/ProfessorConselhoClient";
import ProfessorPreConselhoClient from "@/app/conselho-classe/pre-conselho/[token]/ProfessorPreConselhoClient";
import ConselhoPrintClient from "@/app/conselho-classe/[boardId]/imprimir/ConselhoPrintClient";

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
      "src/components/conselho/CouncilPreCouncilTab.tsx",
      "src/components/conselho/CouncilPreCouncilConversationsView.tsx",
      "src/components/conselho/CouncilPreCouncilSynthesisAckView.tsx",
      "src/components/conselho/preCouncilUtils.ts",
      "src/components/conselho/CouncilStudentFichaModal.tsx",
      "src/components/conselho/CouncilPostMeetingTab.tsx",
      "src/components/conselho/CouncilStudent360Section.tsx",
      "src/app/conselho-classe/ConselhoIndexClient.tsx",
      "src/app/conselho-classe/[boardId]/ConselhoTurmaClient.tsx",
      "src/app/conselho-classe/[boardId]/imprimir/ConselhoPrintClient.tsx",
      "src/app/conselho-classe/professor/[token]/page.tsx",
      "src/app/conselho-classe/professor/[token]/ProfessorConselhoClient.tsx",
      "src/app/conselho-classe/pre-conselho/[token]/page.tsx",
      "src/app/conselho-classe/pre-conselho/[token]/ProfessorPreConselhoClient.tsx",
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

    // SUPERADMIN sem escola selecionada explicitamente recebe 403
    hoisted.session = {
      user: {
        id: "usr-super",
        name: "Super Admin",
        email: "super@redeativa.app.br",
        role: "SUPERADMIN",
        active: true,
        schoolId: null,
        schools: [],
      },
    };
    const superNoSchool = await postTeacherLinkRoute(
      new Request("https://www.redeativa.app.br/api/conselho-classe/board-a1/teacher-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimester: 1 }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(superNoSchool.status).toBe(403);

    // SUPERADMIN com school-b selecionada tentando emitir para board-a1 (school-a) recebe 403
    hoisted.session = {
      user: {
        id: "usr-super",
        name: "Super Admin",
        email: "super@redeativa.app.br",
        role: "SUPERADMIN",
        active: true,
        schoolId: "school-b",
        schools: [],
      },
    };
    const superCrossSchool = await postTeacherLinkRoute(
      new Request("https://www.redeativa.app.br/api/conselho-classe/board-a1/teacher-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimester: 1 }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(superCrossSchool.status).toBe(403);
  });

  it("portal docente valida @escola.pr.gov.br, oculta selos de saúde/pareceres, vincula docente e preserva notas do BI", async () => {
    const prevDevAuth = process.env.ENABLE_DEV_AUTH;
    process.env.ENABLE_DEV_AUTH = "true";

    try {
      // Atribui Matemática (subj-a2) ao docente no servidor; subj-a1 permanece sem atribuição
      const matSubjectSetup = hoisted.db.subjects.find((s) => s.id === "subj-a2");
      matSubjectSetup.teacherEmail = "marcos.oliveira@escola.pr.gov.br";

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

      // 1b. Conta @escola.pr.gov.br sem atribuição confirmada recebe 403 e nenhum dado estudantil
      const unassignedRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:sem.vinculo@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(unassignedRes.status).toBe(403);
      const unassignedBody = await unassignedRes.json();
      expect(unassignedBody.council).toBeUndefined();
      expect(JSON.stringify(unassignedBody)).not.toContain("Ana Clara");

      // 2. Autentica docente @escola.pr.gov.br e retorna somente seu componente autorizado,
      //    ocultando estritamente selos clínicos e pareceres
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
      expect(authBody.council.subjects.map((s: { id: string }) => s.id)).toEqual(["subj-a2"]);
      expect(authBody.council.students).toHaveLength(2);

      const serializedAuth = JSON.stringify(authBody);
      expect(serializedAuth).not.toContain("ALUNO_COM_LAUDO");
      expect(serializedAuth).not.toContain("AEE");
      expect(serializedAuth).not.toContain("ESTUDANTE_MONITOR");
      expect(serializedAuth).not.toContain("Parecer reservado");
      expect(
        authBody.council.students.every(
          (st: { cgm: string | null }) => st.cgm === null
        )
      ).toBe(true);
      expect(serializedAuth).not.toContain('"cgm":"1001"');
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

  it("orquestra helpers puros de Pré-Conselho (inicialização, sincronização não-destrutiva, alertas e progresso)", () => {
    const subjects = [
      {
        id: "subj-a1",
        schoolId: "school-a",
        boardId: "board-a1",
        name: "Arte",
        teacherName: "Prof. André",
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
        teacherEmail: "marcos@escola.pr.gov.br",
        displayOrder: 1,
        active: true,
      },
      {
        id: "subj-off",
        schoolId: "school-a",
        boardId: "board-a1",
        name: "Inativa",
        teacherName: null,
        teacherEmail: null,
        displayOrder: 2,
        active: false,
      },
    ];

    const initial = buildInitialPreCouncilData({
      trimester: 2,
      subjects,
      responsiblePedagogueName: "Pedagoga Alpha",
    });

    expect(initial.periodLabel).toBe("2º Trimestre");
    expect(initial.responsiblePedagogueName).toBe("Pedagoga Alpha");
    expect(initial.conversations).toHaveLength(2);
    expect(initial.conversations.map((c) => c.subjectName)).toEqual(["Arte", "Matemática"]);

    initial.conversations[0].monitoredStudentIds = ["stu-a1"];
    initial.conversations[0].conversationStatus = "COMPLETED";
    initial.conversations[0].digitalAckEmail = "andre@escola.pr.gov.br";

    const merged = mergeSubjectsIntoPreCouncilConversations(initial.conversations, [
      ...subjects,
      {
        id: "subj-a3",
        schoolId: "school-a",
        boardId: "board-a1",
        name: "Biologia",
        teacherName: "Profª. Elis",
        teacherEmail: null,
        displayOrder: 3,
        active: true,
      },
    ]);
    expect(merged.addedCount).toBe(1);
    expect(merged.conversations).toHaveLength(3);
    expect(merged.conversations[0].digitalAckEmail).toBe("andre@escola.pr.gov.br");
    expect(merged.conversations[2].subjectName).toBe("Biologia");

    const progress = getPreCouncilProgress({ ...initial, conversations: merged.conversations });
    expect(progress).toEqual({
      total: 3,
      completed: 1,
      acknowledged: 1,
      citedStudentsCount: 1,
    });

    const alertsBundle = buildPreCouncilStudentAlertsBySubject(
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
        classGroup: { id: "cg-a1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
        subjects,
        trimesters: [],
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
            tags: ["ALUNO_COM_LAUDO"],
            hasSensitiveHealthTag: true,
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
              isSpecialNeeds: true,
              isExchangeStudent: false,
              age: 14,
              lowAttendanceRecord: { attendancePercent: 68.5 },
            },
            subjectEntries: [
              {
                id: "e-2",
                schoolId: "school-a",
                cardId: "card-a1",
                subjectId: "subj-a2",
                trimester: 2,
                descriptorCodes: [2, 4],
                grade: 4.5,
              },
            ],
          },
        ],
      },
      2
    );

    expect(alertsBundle.lowAttendanceStudents).toHaveLength(1);
    expect(alertsBundle.bySubjectId["subj-a2"]).toHaveLength(1);
    expect(alertsBundle.bySubjectId["subj-a2"][0].reasons).toContain("Nota 4,5");
    expect(alertsBundle.bySubjectId["subj-a2"][0].reasons).toContain("Freq. 69%");

    const cited = buildCitedStudentsSummary(merged.conversations, [
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
        subjectEntries: [],
      },
    ]);
    expect(cited).toEqual([
      {
        studentId: "stu-a1",
        studentName: "Ana Clara Souza",
        count: 1,
        subjectNames: ["Arte"],
      },
    ]);
  });

  it("valida isolamento multi-tenant, FK traversal e preservação server-side de ciência em PATCH /trimesters (Pré-Conselho)", async () => {
    // Seed de ciência digital pré-existente no trimestre 1
    hoisted.db.trimesters[0].preCouncilJson = JSON.stringify({
      version: 1,
      periodLabel: "1º Trimestre",
      objectiveText: "Objetivo inicial",
      responsiblePedagogueName: "Pedagoga Alpha",
      responsiblePedagogueRole: "Pedagoga Responsável",
      conversations: [
        {
          id: "subj-a1",
          subjectId: "subj-a1",
          subjectName: "Língua Portuguesa",
          teacherName: "Prof. Helena",
          teacherEmail: "helena@escola.pr.gov.br",
          monitoredStudentIds: [],
          monitoredStudentsNotes: "",
          agreements: "",
          conversationStatus: "COMPLETED",
          conversationDate: "2026-11-18",
          digitalAckEmail: "helena@escola.pr.gov.br",
          digitalAckName: "Prof. Helena",
          digitalAckAt: "2026-11-18T14:00:00.000Z",
        },
      ],
      synthesis: {
        mainDifficulties: "",
        priorityStudents: "",
        attendanceIssues: "",
        behaviorIssues: "",
        pedagogicalActions: "",
      },
    });

    // 1. FK traversal em subjectId externo retorna 400
    const badSubjectRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          preCouncil: {
            version: 1,
            periodLabel: "2º Semestre",
            objectiveText: "Objetivo",
            responsiblePedagogueName: "Pedagoga Alpha",
            responsiblePedagogueRole: "Pedagoga Responsável",
            conversations: [
              {
                id: "subj-b1",
                subjectId: "subj-b1",
                subjectName: "Matemática Externa",
                teacherName: "Outro",
                teacherEmail: null,
                monitoredStudentIds: [],
                monitoredStudentsNotes: "",
                agreements: "",
                conversationStatus: "PENDING",
                conversationDate: null,
              },
            ],
            synthesis: {
              mainDifficulties: "",
              priorityStudents: "",
              attendanceIssues: "",
              behaviorIssues: "",
              pedagogicalActions: "",
            },
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(badSubjectRes.status).toBe(400);

    // 2. FK traversal em studentId de outra escola retorna 400
    const badStudentRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          preCouncil: {
            version: 1,
            periodLabel: "2º Semestre",
            objectiveText: "Objetivo",
            responsiblePedagogueName: "Pedagoga Alpha",
            responsiblePedagogueRole: "Pedagoga Responsável",
            conversations: [
              {
                id: "subj-a1",
                subjectId: "subj-a1",
                subjectName: "Língua Portuguesa",
                teacherName: "Prof. Helena",
                teacherEmail: "helena@escola.pr.gov.br",
                monitoredStudentIds: ["stu-b1"],
                monitoredStudentsNotes: "",
                agreements: "",
                conversationStatus: "COMPLETED",
                conversationDate: "2026-11-19",
              },
            ],
            synthesis: {
              mainDifficulties: "",
              priorityStudents: "",
              attendanceIssues: "",
              behaviorIssues: "",
              pedagogicalActions: "",
            },
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(badStudentRes.status).toBe(400);

    // 3. Salvamento válido preserva digitalAck* do servidor mesmo se cliente tentar spoofing ou apagar
    const validRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          preCouncil: {
            version: 1,
            periodLabel: "2º Semestre",
            objectiveText: "Objetivo atualizado",
            responsiblePedagogueName: "Pedagoga Alpha",
            responsiblePedagogueRole: "Pedagoga Responsável",
            conversations: [
              {
                id: "subj-a1",
                subjectId: "subj-a1",
                subjectName: "Língua Portuguesa",
                teacherName: "Prof. Helena",
                teacherEmail: "helena@escola.pr.gov.br",
                monitoredStudentIds: ["stu-a1"],
                monitoredStudentsNotes: "Apoio em leitura",
                agreements: "Retomar atividades",
                conversationStatus: "COMPLETED",
                conversationDate: "2026-11-19",
                digitalAckEmail: "impostor@escola.pr.gov.br",
                digitalAckName: "Impostor",
              },
              {
                id: "subj-a2",
                subjectId: "subj-a2",
                subjectName: "Matemática",
                teacherName: "Prof. Marcos",
                teacherEmail: null,
                monitoredStudentIds: [],
                monitoredStudentsNotes: "",
                agreements: "",
                conversationStatus: "PENDING",
                conversationDate: null,
                digitalAckEmail: "forged@escola.pr.gov.br",
                digitalAckName: "Forjado",
              },
            ],
            synthesis: {
              mainDifficulties: "Interpretação de enunciados",
              priorityStudents: "Ana Clara Souza",
              attendanceIssues: "",
              behaviorIssues: "",
              pedagogicalActions: "Agendar reunião",
            },
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(validRes.status).toBe(200);
    const validBody = await validRes.json();
    const parsedSaved = parsePreCouncilData(validBody.trimesterRecord.preCouncilJson);
    expect(parsedSaved).not.toBeNull();
    expect(parsedSaved!.periodLabel).toBe("2º Semestre");
    // Preserva ciência existente de subj-a1 e ignora ciência forjada de subj-a2
    expect(parsedSaved!.conversations[0].digitalAckEmail).toBe("helena@escola.pr.gov.br");
    expect(parsedSaved!.conversations[1].digitalAckEmail).toBeNull();

    // Auditoria não expõe textos livres ou nomes de estudantes
    expect(hoisted.auditCalls).toHaveLength(1);
    expect(hoisted.auditCalls[0].schoolId).toBe("school-a");
    const serializedAudit = JSON.stringify(hoisted.auditCalls[0]);
    expect(serializedAudit).not.toContain("Ana Clara Souza");
    expect(serializedAudit).not.toContain("Apoio em leitura");
    expect(serializedAudit).toContain('"hasPreCouncil":true');
  });

  it("isola tokens HMAC do Pré-Conselho vs Matriz e valida portal de ciência docente @escola.pr.gov.br + impressão A4", async () => {
    expect(PUBLIC_PREFIXES).toContain("/conselho-classe/pre-conselho/");
    expect(SELF_AUTH_API_PREFIXES).toContain("/api/conselho-classe/pre-council-portal/");

    const prevDevAuth = process.env.ENABLE_DEV_AUTH;
    process.env.ENABLE_DEV_AUTH = "true";

    try {
      // Seed do Pré-Conselho salvo no trimestre 1 de board-a1
      hoisted.db.cards[0].tags = ["ALUNO_COM_LAUDO", "AEE"];
      hoisted.db.cards[0].trimester1Opinion = "Parecer sigiloso com dados médicos";
      hoisted.db.trimesters[0].preCouncilJson = JSON.stringify({
        version: 1,
        periodLabel: "2º Semestre",
        objectiveText: "Objetivo do Pré-Conselho",
        responsiblePedagogueName: "Pedagoga Alpha",
        responsiblePedagogueRole: "Pedagoga Responsável",
        conversations: [
          {
            id: "subj-a1",
            subjectId: "subj-a1",
            subjectName: "Língua Portuguesa",
            teacherName: "Prof. Helena",
            teacherEmail: "helena@escola.pr.gov.br",
            monitoredStudentIds: ["stu-a1"],
            monitoredStudentsNotes: "Reforço ortográfico",
            agreements: "Enviar atividades extras",
            conversationStatus: "COMPLETED",
            conversationDate: "2026-11-18",
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
          {
            id: "subj-a2",
            subjectId: "subj-a2",
            subjectName: "Matemática",
            teacherName: "Prof. Marcos",
            teacherEmail: null,
            monitoredStudentIds: ["stu-a1", "stu-a2"],
            monitoredStudentsNotes: "Acompanhamento semanal",
            agreements: "Lista de recuperação",
            conversationStatus: "PENDING",
            conversationDate: null,
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
        ],
        synthesis: {
          mainDifficulties: "Leitura e cálculo básico",
          priorityStudents: "Ana Clara Souza",
          attendanceIssues: "Monitorar faltas",
          behaviorIssues: "Sem ocorrências graves",
          pedagogicalActions: "Chamar responsáveis",
        },
      });

      // 1. Separação criptográfica: token da matriz NÃO é aceito no Pré-Conselho e vice-versa
      const matrixToken = createCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        subjectId: "subj-a2",
      });
      const preToken = createPreCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        conversationId: null,
      });
      expect(verifyPreCouncilTeacherToken(matrixToken.token).ok).toBe(false);
      expect(verifyCouncilTeacherToken(preToken.token).ok).toBe(false);
      expect(verifyPreCouncilTeacherToken(preToken.token).ok).toBe(true);

      // 2. Endpoint de geração de link exige tenant + permissão de escrita
      const linkRes = await postPreCouncilLinkRoute(
        new Request("https://www.redeativa.app.br/api/conselho-classe/board-a1/pre-council-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            host: "www.redeativa.app.br",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({ trimester: 1, conversationId: "subj-a2", expiresInDays: 7 }),
        }),
        { params: Promise.resolve({ boardId: "board-a1" }) }
      );
      expect(linkRes.status).toBe(200);
      const linkBody = await linkRes.json();
      expect(linkBody.url).toContain("/conselho-classe/pre-conselho/");
      expect(linkBody.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(linkBody.subjectName).toBe("Matemática");
      expect(hoisted.auditCalls[0].action).toBe("CREATE_PRE_COUNCIL_TEACHER_LINK");
      expect(hoisted.auditCalls[0].schoolId).toBe("school-a");
      expect(hoisted.auditCalls[0].entityId).toBe("tri-a1-1");

      // GESTAO_SECRETARIA sem vínculo local recebe 403
      hoisted.session = {
        user: {
          id: "usr-sec",
          name: "Secretária",
          email: "sec@tibagi.pr.gov.br",
          role: "GESTAO_SECRETARIA",
          active: true,
          networks: [{ networkId: "net-1" }],
          schools: [],
        },
      };
      const secRes = await postPreCouncilLinkRoute(
        new Request("https://www.redeativa.app.br/api/conselho-classe/board-a1/pre-council-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trimester: 1 }),
        }),
        { params: Promise.resolve({ boardId: "board-a1" }) }
      );
      expect(secRes.status).toBe(403);

      // 3. Portal docente rejeita domínio externo (401)
      const badDomainRes = await postPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:docente@gmail.com" }),
        }),
        { params: Promise.resolve({ token: preToken.token }) }
      );
      expect(badDomainRes.status).toBe(401);

      // 4. Autenticação @escola.pr.gov.br devolve contexto LGPD-safe (zero selos clínicos ou pareceres)
      const authRes = await postPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.oliveira@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token: preToken.token }) }
      );
      expect(authRes.status).toBe(200);
      const authBody = await authRes.json();
      const serialized = JSON.stringify(authBody);
      expect(serialized).toContain("Ana Clara Souza");
      expect(serialized).not.toContain("ALUNO_COM_LAUDO");
      expect(serialized).not.toContain("AEE");
      expect(serialized).not.toContain("Parecer sigiloso");
      expect(serialized).not.toContain("1001"); // CGM omitido

      // 5. Bloqueia confirmação em componente vinculado a outro teacherEmail (403)
      const wrongTeacherRes = await putPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.oliveira@escola.pr.gov.br",
            conversationId: "subj-a1",
          }),
        }),
        { params: Promise.resolve({ token: preToken.token }) }
      );
      expect(wrongTeacherRes.status).toBe(403);

      // 6. Confirma ciência em subj-a2 com sucesso + registra auditoria segura
      const ackRes = await putPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.oliveira@escola.pr.gov.br",
            conversationId: "subj-a2",
          }),
        }),
        { params: Promise.resolve({ token: preToken.token }) }
      );
      expect(ackRes.status).toBe(200);
      const ackBody = await ackRes.json();
      expect(ackBody.ack.digitalAckEmail).toBe("marcos.oliveira@escola.pr.gov.br");
      expect(hoisted.auditCalls).toHaveLength(2);
      expect(hoisted.auditCalls[1].action).toBe("TEACHER_ACK_PRE_COUNCIL");
      expect(hoisted.auditCalls[1].schoolId).toBe("school-a");
      expect(hoisted.auditCalls[1].entityId).toBe("tri-a1-1");
      expect(JSON.stringify(hoisted.auditCalls[1])).not.toContain("Ana Clara Souza");

      // 7. Segundo docente tentando sobrescrever ciência já confirmada recebe 409
      const conflictRes = await putPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.oliveira@escola.pr.gov.br",
            conversationId: "subj-a2",
          }),
        }),
        { params: Promise.resolve({ token: preToken.token }) }
      );
      expect(conflictRes.status).toBe(200); // mesmo docente pode reconfirmar de forma idempotente

      // Outro docente é bloqueado com 403/409
      const otherDocRes = await putPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:outro@escola.pr.gov.br",
            conversationId: "subj-a2",
          }),
        }),
        { params: Promise.resolve({ token: preToken.token }) }
      );
      expect([403, 409]).toContain(otherDocRes.status);

      // 8. Renderização SSR da página de login do portal de ciência e da impressão A4 mode="pre-conselho"
      const prePortalLoginHtml = renderToString(
        React.createElement(ProfessorPreConselhoClient, {
          token: preToken.token,
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
      expect(prePortalLoginHtml).toContain("Pré-Conselho de Classe — Ciência Docente");
      expect(prePortalLoginHtml).not.toContain("Ana Clara Souza");

      const updatedTrimester = hoisted.db.trimesters.find((t) => t.id === "tri-a1-1");
      const printHtml = renderToString(
        React.createElement(ConselhoPrintClient, {
          board: {
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
            classGroup: { id: "cg-a1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
            subjects: [
              {
                id: "subj-a1",
                schoolId: "school-a",
                boardId: "board-a1",
                name: "Língua Portuguesa",
                teacherName: "Prof. Helena",
                teacherEmail: "helena@escola.pr.gov.br",
                displayOrder: 0,
                active: true,
              },
              {
                id: "subj-a2",
                schoolId: "school-a",
                boardId: "board-a1",
                name: "Matemática",
                teacherName: "Prof. Marcos",
                teacherEmail: "marcos.oliveira@escola.pr.gov.br",
                displayOrder: 1,
                active: true,
              },
            ],
            trimesters: [updatedTrimester],
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
                subjectEntries: [],
              },
            ],
          },
          school: {
            id: "school-a",
            name: "Escola Estadual Alpha",
            inepCode: "41000011",
            city: "Tibagi",
            state: "PR",
            nre: "Ponta Grossa",
            network: "ESTADUAL",
            logoUrl: null,
          },
          initialMode: "pre-conselho",
          initialTrimester: 1,
          initialStudentId: null,
          initialHideHealthTags: false,
          anonymizedOpinionsByStudentId: {},
        })
      );

      expect(printHtml).toContain("PRÉ-CONSELHO DE CLASSE — 2º Semestre / 2026");
      expect(printHtml).toContain("Registro de Conversas Individuais por Componente Curricular");
      expect(printHtml).toContain("SÍNTESE DO PRÉ-CONSELHO DA TURMA");
      expect(printHtml).toContain("Registro de Ciência dos Docentes");
      expect(printHtml).toContain("Ciência digital confirmada por");
      expect(printHtml).toContain("Pedagoga Alpha");
      expect(printHtml).toContain("Pedagoga Responsável");

      const preCouncilTabHtml = renderToString(
        React.createElement(CouncilPreCouncilTab, {
          board: {
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
            classGroup: { id: "cg-a1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
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
            ],
            trimesters: [],
            studentCards: [],
          },
          activeTrimester: 1,
          trimesterRecord: null,
          hideSensitiveTags: false,
          onOpenStudentModal: () => {},
          onOpenSubjectsModal: () => {},
          onTrimesterUpdated: () => {},
          onMatrixSaved: async () => {},
          onNotify: () => {},
        })
      );
      expect(preCouncilTabHtml).toContain("Conversas (");
      expect(preCouncilTabHtml).toContain("Síntese (");
      expect(preCouncilTabHtml).toContain(">Matriz<");
      expect(preCouncilTabHtml).toContain("Link do Pré-Conselho");
      expect(preCouncilTabHtml).toContain("Imprimir A4");
    } finally {
      if (prevDevAuth === undefined) {
        delete process.env.ENABLE_DEV_AUTH;
      } else {
        process.env.ENABLE_DEV_AUTH = prevDevAuth;
      }
    }
  });

  it("calcula alertas ao vivo, estatísticas por componente e protege rascunho local docente sem armazenar credenciais", () => {
    expect(
      canConversationConfirmDigitalAck({
        conversationStatus: "PENDING",
        agreements: "",
      })
    ).toBe(false);
    expect(
      canConversationConfirmDigitalAck({
        conversationStatus: "PENDING",
        agreements: "Retomar atividades avaliativas",
      })
    ).toBe(true);
    expect(
      canConversationConfirmDigitalAck({
        conversationStatus: "COMPLETED",
        agreements: "",
      })
    ).toBe(true);

    const liveAlerts = buildLiveAlertsFromDraft({
      students: [
        {
          studentId: "stu-a1",
          name: "Ana Clara Souza",
          enrollmentStatus: "ATIVO",
          attendancePercent: 70,
          grade: 5.5,
        },
        {
          studentId: "stu-a2",
          name: "Bruno Oliveira",
          enrollmentStatus: "ATIVO",
          attendancePercent: 95,
          grade: 8.5,
        },
        {
          studentId: "stu-a3",
          name: "Carlos Inativo",
          enrollmentStatus: "TRANSFERIDO",
          attendancePercent: 40,
          grade: 3.0,
        },
      ],
      descriptorCodesByStudentId: {
        "stu-a1": [2, 4],
        "stu-a2": [1],
        "stu-a3": [2],
      },
    });
    expect(liveAlerts).toHaveLength(1);
    expect(liveAlerts[0].studentId).toBe("stu-a1");
    expect(liveAlerts[0].reasons).toEqual([
      "Nota 5,5",
      "Dificuldade",
      "Infrequência",
      "Freq. 70%",
    ]);

    const stats = getMatrixFillStatsBySubject(
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
        classGroup: { id: "cg-a1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
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
        ],
        trimesters: [],
        studentCards: [
          {
            id: "card-1",
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
              name: "Ana",
              cgm: "1001",
              active: true,
              isSpecialNeeds: false,
              isExchangeStudent: false,
              age: 12,
              lowAttendanceRecord: { attendancePercent: 80 },
            },
            subjectEntries: [
              {
                id: "e1",
                schoolId: "school-a",
                cardId: "card-1",
                subjectId: "subj-a1",
                trimester: 1,
                grade: 7.5,
                descriptorCodes: [1],
                updatedByEmail: "helena@escola.pr.gov.br",
              },
            ],
          },
          {
            id: "card-2",
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
              name: "Bruno",
              cgm: "1002",
              active: true,
              isSpecialNeeds: false,
              isExchangeStudent: false,
              age: 12,
              lowAttendanceRecord: { attendancePercent: 90 },
            },
            subjectEntries: [],
          },
        ],
      },
      1
    );
    expect(stats["subj-a1"]).toEqual({
      filledCount: 1,
      totalActiveCount: 2,
      alertCount: 0,
      belowAvgCount: 0,
    });

    const prevWindow = (globalThis as any).window;
    const prevLocalStorage = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    (globalThis as any).window = { ...(prevWindow || {}), localStorage: mockStorage };
    (globalThis as any).localStorage = mockStorage;
    try {
      saveTeacherPortalLocalDraft("board-a1", 1, "subj-a1", "Helena@escola.pr.gov.br", {
        descriptorByStudentId: { "stu-a1": [4, 2, 2] },
        monitoredStudentIds: ["stu-a1", "stu-a1"],
        monitoredStudentsNotes: "Necessita acompanhamento em leitura",
      });

      const savedKeys = Array.from(store.keys());
      expect(savedKeys).toHaveLength(1);
      expect(savedKeys[0]).toMatch(/^redeativa_precouncil_draft_board-a1_1_subj-a1_helena@escola\.pr\.gov\.br$/);
      const rawStored = store.get(savedKeys[0])!;
      expect(rawStored).not.toContain("googleIdToken");
      expect(rawStored).not.toContain("dev-mock-token");

      const restored = loadTeacherPortalLocalDraft(
        "board-a1",
        1,
        "subj-a1",
        "helena@escola.pr.gov.br"
      );
      expect(restored).not.toBeNull();
      expect(restored!.descriptorByStudentId["stu-a1"]).toEqual([2, 4]);
      expect(restored!.monitoredStudentIds).toEqual(["stu-a1"]);
      expect(restored!.monitoredStudentsNotes).toBe("Necessita acompanhamento em leitura");

      clearTeacherPortalLocalDraft("board-a1", 1, "subj-a1", "helena@escola.pr.gov.br");
      expect(
        loadTeacherPortalLocalDraft("board-a1", 1, "subj-a1", "helena@escola.pr.gov.br")
      ).toBeNull();
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = prevWindow;
      }
      if (prevLocalStorage === undefined) {
        delete (globalThis as any).localStorage;
      } else {
        (globalThis as any).localStorage = prevLocalStorage;
      }
    }
  });

  it("consolida Matriz e Pré-Conselho no portal docente com atomicidade, preservação de combinados e retrocompatibilidade do link antigo", async () => {
    const prevDevAuth = process.env.ENABLE_DEV_AUTH;
    process.env.ENABLE_DEV_AUTH = "true";

    try {
      // Seed com dados sensíveis para verificar filtragem estrita no portal
      hoisted.db.cards[0].tags = ["ALUNO_COM_LAUDO", "AEE"];
      hoisted.db.cards[0].trimester1Opinion = "Parecer sigiloso médico";
      hoisted.db.trimesters[0].preCouncilJson = JSON.stringify({
        version: 1,
        periodLabel: "1º Trimestre",
        objectiveText: "Objetivo oficial",
        responsiblePedagogueName: "Pedagoga Alpha",
        responsiblePedagogueRole: "Pedagoga Responsável",
        conversations: [
          {
            id: "subj-a2",
            subjectId: "subj-a2",
            subjectName: "Matemática",
            teacherName: "Prof. Marcos",
            teacherEmail: "marcos.unificado@escola.pr.gov.br",
            monitoredStudentIds: [],
            monitoredStudentsNotes: "",
            agreements: "Pedagoga registrou combinado prévio",
            conversationStatus: "PENDING",
            conversationDate: null,
            teacherSubmittedAt: null,
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
        ],
        synthesis: {
          mainDifficulties: "Cálculo mental",
          priorityStudents: "Ana Clara Souza",
          attendanceIssues: "",
          behaviorIssues: "",
          pedagogicalActions: "Agendar reunião",
        },
      });

      const teacherToken = createCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        subjectId: null,
      });

      // 1. POST retorna contexto com preCouncil e sem selos clínicos/pareceres
      const postRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherToken.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.unificado@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token: teacherToken.token }) }
      );
      expect(postRes.status).toBe(200);
      const postBody = await postRes.json();
      expect(postBody.council.preCouncil).toBeDefined();
      expect(postBody.council.preCouncil.conversationsBySubjectId["subj-a2"].canConfirmAck).toBe(
        true
      );
      expect(JSON.stringify(postBody)).not.toContain("ALUNO_COM_LAUDO");
      expect(JSON.stringify(postBody)).not.toContain("Parecer sigiloso médico");

      // 2. Bloqueia FK traversal de outro tenant em monitoredStudentIds (400)
      const crossTenantRes = await putTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.unificado@escola.pr.gov.br",
            subjectId: "subj-a2",
            entries: [{ studentId: "stu-a1", descriptorCodes: [2] }],
            preCouncil: {
              monitoredStudentIds: ["stu-b1"],
              monitoredStudentsNotes: "Tentativa cruzada",
            },
          }),
        }),
        { params: Promise.resolve({ token: teacherToken.token }) }
      );
      expect(crossTenantRes.status).toBe(400);
      expect(hoisted.db.entries.filter((e) => e.subjectId === "subj-a2")).toHaveLength(0);

      // 3. Atomicidade: confirmAck: true em subj-a1 (atribuída a Helena, ainda sem conversa nem combinados) falha com 400
      //    e NÃO grava parcialmente entries na matriz
      const subjA1 = hoisted.db.subjects.find((s) => s.id === "subj-a1");
      subjA1.teacherEmail = "helena@escola.pr.gov.br";
      const prematureAckRes = await putTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:helena@escola.pr.gov.br",
            subjectId: "subj-a1",
            entries: [{ studentId: "stu-a1", descriptorCodes: [2, 4] }],
            preCouncil: {
              monitoredStudentIds: ["stu-a1"],
              monitoredStudentsNotes: "Precisa reforço",
            },
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token: teacherToken.token }) }
      );
      expect(prematureAckRes.status).toBe(400);
      expect(hoisted.db.entries.filter((e) => e.subjectId === "subj-a1")).toHaveLength(0);
      expect(hoisted.db.subjects.find((s) => s.id === "subj-a1")?.teacherEmail).toBe(
        "helena@escola.pr.gov.br"
      );

      // 4. Salva matriz + observações prévias em subj-a2 sem apagar agreements/synthesis da pedagoga
      const saveOnlyRes = await putTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.unificado@escola.pr.gov.br",
            subjectId: "subj-a2",
            entries: [{ studentId: "stu-a1", descriptorCodes: [2] }],
            preCouncil: {
              monitoredStudentIds: ["stu-a1"],
              monitoredStudentsNotes: "Dificuldade em frações",
            },
            confirmAck: false,
          }),
        }),
        { params: Promise.resolve({ token: teacherToken.token }) }
      );
      expect(saveOnlyRes.status).toBe(200);
      const saveOnlyBody = await saveOnlyRes.json();
      expect(saveOnlyBody.result.updatedCount).toBe(1);
      expect(saveOnlyBody.result.ackConfirmed).toBe(false);
      expect(hoisted.auditCalls.some((c) => c.action === "TEACHER_SUBMIT_COUNCIL_SUBJECT")).toBe(
        true
      );
      expect(hoisted.auditCalls.some((c) => c.action === "TEACHER_ACK_PRE_COUNCIL")).toBe(false);

      const savedPre = parsePreCouncilData(hoisted.db.trimesters[0].preCouncilJson)!;
      const convMat = savedPre.conversations.find((c) => c.subjectId === "subj-a2")!;
      expect(convMat.agreements).toBe("Pedagoga registrou combinado prévio");
      expect(savedPre.synthesis.mainDifficulties).toBe("Cálculo mental");
      expect(convMat.monitoredStudentIds).toEqual(["stu-a1"]);
      expect(convMat.monitoredStudentsNotes).toBe("Dificuldade em frações");
      expect(convMat.teacherSubmittedAt).toBeTruthy();

      // 5. Confirma ciência pelo fluxo unificado após combinados registrados -> audita TEACHER_ACK_PRE_COUNCIL
      const ackRes = await putTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherToken.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.unificado@escola.pr.gov.br",
            subjectId: "subj-a2",
            entries: [{ studentId: "stu-a1", descriptorCodes: [1] }],
            preCouncil: {
              monitoredStudentIds: ["stu-a1"],
              monitoredStudentsNotes: "Dificuldade em frações revisada",
            },
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token: teacherToken.token }) }
      );
      expect(ackRes.status).toBe(200);
      const ackBody = await ackRes.json();
      expect(ackBody.result.ackConfirmed).toBe(true);
      expect(ackBody.result.digitalAckAt).toBeTruthy();
      const ackAudit = hoisted.auditCalls.find((c) => c.action === "TEACHER_ACK_PRE_COUNCIL");
      expect(ackAudit).toBeDefined();
      expect(ackAudit.schoolId).toBe("school-a");

      // 6. Escopo restrito em /pre-council-portal/[token]:
      //    POST retorna preCouncil sem payload de matriz (council: null) e PUT bloqueia escrita de matriz (403)
      const legacyPreToken = createPreCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        conversationId: null,
      });
      const legacyPost = await postPreCouncilPortalRoute(
        new Request(
          `http://localhost/api/conselho-classe/pre-council-portal/${legacyPreToken.token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              googleIdToken: "dev-mock-token:marcos.unificado@escola.pr.gov.br",
            }),
          }
        ),
        { params: Promise.resolve({ token: legacyPreToken.token }) }
      );
      expect(legacyPost.status).toBe(200);
      const legacyPostBody = await legacyPost.json();
      expect(legacyPostBody.preCouncil).toBeDefined();
      expect(legacyPostBody.council).toBeNull();
      const serializedLegacyPost = JSON.stringify(legacyPostBody);
      expect(serializedLegacyPost).not.toContain("1001");
      expect(serializedLegacyPost).not.toContain("ALUNO_COM_LAUDO");

      const legacyUnifiedPut = await putPreCouncilPortalRoute(
        new Request(
          `http://localhost/api/conselho-classe/pre-council-portal/${legacyPreToken.token}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              googleIdToken: "dev-mock-token:marcos.unificado@escola.pr.gov.br",
              subjectId: "subj-a2",
              entries: [{ studentId: "stu-a2", descriptorCodes: [1] }],
              preCouncil: {
                monitoredStudentIds: ["stu-a1"],
                monitoredStudentsNotes: "Atualizado pelo link antigo",
              },
              confirmAck: false,
            }),
          }
        ),
        { params: Promise.resolve({ token: legacyPreToken.token }) }
      );
      expect(legacyUnifiedPut.status).toBe(403);
    } finally {
      if (prevDevAuth === undefined) {
        delete process.env.ENABLE_DEV_AUTH;
      } else {
        process.env.ENABLE_DEV_AUTH = prevDevAuth;
      }
    }
  });

  it("[C-01] bloqueia mutação e fallback silencioso para Escola Piloto em sessão sem escola vinculada", async () => {
    const { canMutateSchoolCouncil } = await import("@/services/classCouncilService");

    const orphanPedagogaSession = {
      user: {
        id: "usr-orphan-ped",
        name: "Pedagoga Sem Vínculo",
        email: "orphan.ped@escola.pr.gov.br",
        role: "PEDAGOGA",
        active: true,
        schoolId: null,
        schools: [],
        networks: [],
      },
    };
    const orphanGestorSession = {
      user: {
        id: "usr-orphan-gestor",
        name: "Gestor Sem Vínculo",
        email: "orphan.gestor@escola.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        active: true,
        schoolId: null,
        schools: [],
        networks: [],
      },
    };

    expect(canMutateSchoolCouncil(orphanPedagogaSession, "school-a")).toBe(false);
    expect(canMutateSchoolCouncil(orphanGestorSession, "school-a")).toBe(false);
    expect(
      canMutateSchoolCouncil(
        {
          user: {
            id: "usr-super",
            role: "SUPERADMIN",
            active: true,
            schoolId: null,
            schools: [],
          },
        },
        ""
      )
    ).toBe(false);

    hoisted.session = orphanPedagogaSession;
    const getBoardsRes = await getBoardsRoute(
      new Request("http://localhost/api/conselho-classe?year=2026")
    );
    expect(getBoardsRes.status).toBe(403);

    const postBoardRes = await postBoardRoute(
      new Request("http://localhost/api/conselho-classe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classGroupId: "cg-a1", year: 2026 }),
      })
    );
    expect(postBoardRes.status).toBe(403);

    const patchBoardRes = await patchBoardMetadataRoute(
      new Request("http://localhost/api/conselho-classe/board-a1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerLeaderName: "Estudante Teste" }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(patchBoardRes.status).toBe(403);

    const actualCurrentSchool = await vi.importActual<typeof import("@/lib/currentSchool")>(
      "@/lib/currentSchool"
    );
    expect(
      await actualCurrentSchool.getAuthorizedCurrentSchool(orphanPedagogaSession)
    ).toBeNull();
    expect(
      await actualCurrentSchool.getAuthorizedCurrentSchool({
        user: {
          id: "usr-inactive",
          role: "PEDAGOGA",
          active: false,
          schoolId: "school-a",
          schools: [{ schoolId: "school-a", active: true }],
        },
      })
    ).toBeNull();
  });

  it("[A-01] Pré-Conselho exige conversa/combinados prévios, valida ClassCouncilSubject e sincroniza titularidade", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prevDevAuth = env.ENABLE_DEV_AUTH;
    const prevVercelEnv = env.VERCEL_ENV;
    env.ENABLE_DEV_AUTH = "true";
    delete env.VERCEL_ENV;

    try {
      const basePreCouncil = buildInitialPreCouncilData({
        trimester: 1,
        subjects: [
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
      });
      hoisted.db.trimesters[0].preCouncilJson = JSON.stringify({
        ...basePreCouncil,
        conversations: [
          {
            id: "conv-a2",
            subjectId: "subj-a2",
            subjectName: "Matemática",
            teacherName: "Prof. Marcos",
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
      });

      const { token } = createPreCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        conversationId: "conv-a2",
      });

      // 1. Bloqueia confirmação (400) enquanto conversa estiver PENDING e sem combinados/notas
      const pendingAckRes = await putPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos@escola.pr.gov.br",
            conversationId: "conv-a2",
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(pendingAckRes.status).toBe(400);

      // 2. Libera conversa com combinados, porém ClassCouncilSubject pertence a outro docente -> 403
      hoisted.db.trimesters[0].preCouncilJson = JSON.stringify({
        ...basePreCouncil,
        conversations: [
          {
            id: "conv-a2",
            subjectId: "subj-a2",
            subjectName: "Matemática",
            teacherName: "Prof. Marcos",
            teacherEmail: null,
            monitoredStudentIds: [],
            monitoredStudentsNotes: "",
            agreements: "Revisar tarefas semanais com acompanhamento escolar.",
            conversationStatus: "COMPLETED",
            conversationDate: "2026-04-20",
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
        ],
      });
      hoisted.db.subjects[1].teacherEmail = "helena@escola.pr.gov.br";

      const wrongSubjectOwnerRes = await putPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos@escola.pr.gov.br",
            conversationId: "conv-a2",
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(wrongSubjectOwnerRes.status).toBe(403);

      // 3. Sem titular conflitante em ClassCouncilSubject, confirma ciência (200) e sincroniza teacherEmail no banco
      hoisted.db.subjects[1].teacherEmail = null;
      hoisted.auditCalls.length = 0;

      const validAckRes = await putPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos@escola.pr.gov.br",
            conversationId: "conv-a2",
            confirmAck: true,
          }),
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(validAckRes.status).toBe(200);
      expect(hoisted.db.subjects[1].teacherEmail).toBe("marcos@escola.pr.gov.br");
      expect(hoisted.auditCalls).toHaveLength(1);
      expect(hoisted.auditCalls[0].action).toBe("TEACHER_ACK_PRE_COUNCIL");
      expect(hoisted.auditCalls[0].schoolId).toBe("school-a");
      expect(hoisted.auditCalls[0].entityId).toBe("tri-a1-1");
    } finally {
      if (prevDevAuth === undefined) delete env.ENABLE_DEV_AUTH;
      else env.ENABLE_DEV_AUTH = prevDevAuth;
      if (prevVercelEnv === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = prevVercelEnv;
    }
  });

  it("[A-02] portais docentes redigem anotações/lançamentos de outros docentes e esvaziam síntese sem componente acessível", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prevDevAuth = env.ENABLE_DEV_AUTH;
    const prevVercelEnv = env.VERCEL_ENV;
    env.ENABLE_DEV_AUTH = "true";
    delete env.VERCEL_ENV;

    try {
      hoisted.db.subjects[0].teacherEmail = "helena@escola.pr.gov.br";
      hoisted.db.subjects[1].teacherEmail = null;
      hoisted.db.entries.push({
        id: "ent-helena-1",
        schoolId: "school-a",
        cardId: "card-a1",
        trimester: 1,
        subjectId: "subj-a1",
        descriptorCodes: [2],
        grade: 4.5,
        updatedByEmail: "helena@escola.pr.gov.br",
      });

      const basePre = buildInitialPreCouncilData({
        trimester: 1,
        subjects: [
          {
            id: "subj-a1",
            schoolId: "school-a",
            boardId: "board-a1",
            name: "Língua Portuguesa",
            teacherName: "Prof. Helena",
            teacherEmail: "helena@escola.pr.gov.br",
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
      });
      hoisted.db.trimesters[0].preCouncilJson = JSON.stringify({
        ...basePre,
        synthesis: {
          mainDifficulties: "Dificuldade em interpretação e cálculos.",
          priorityStudents: "Estudantes com baixa entrega",
          generalStrategy: "Tutoria dirigida em contraturno",
          pedagogueClosingNotes: "Acompanhamento quinzenal com famílias",
        },
        conversations: [
          {
            id: "conv-helena",
            subjectId: "subj-a1",
            subjectName: "Língua Portuguesa",
            teacherName: "Prof. Helena",
            teacherEmail: "helena@escola.pr.gov.br",
            monitoredStudentIds: ["stu-a1"],
            monitoredStudentsNotes: "Anotacao sigilosa da Helena",
            agreements: "Combinado privado da Helena",
            conversationStatus: "COMPLETED",
            conversationDate: "2026-04-18",
            digitalAckEmail: "helena@escola.pr.gov.br",
            digitalAckName: "Prof. Helena",
            digitalAckAt: "2026-04-19T12:00:00.000Z",
          },
          {
            id: "conv-marcos",
            subjectId: "subj-a2",
            subjectName: "Matemática",
            teacherName: "Prof. Marcos",
            teacherEmail: "marcos@escola.pr.gov.br",
            monitoredStudentIds: [],
            monitoredStudentsNotes: "",
            agreements: "Combinado de matemática",
            conversationStatus: "COMPLETED",
            conversationDate: "2026-04-18",
            digitalAckEmail: null,
            digitalAckName: null,
            digitalAckAt: null,
          },
        ],
      });

      const teacherLink = createCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        subjectId: null,
      });
      const portalRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherLink.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token: teacherLink.token }) }
      );
      expect(portalRes.status).toBe(200);
      const portalBody = await portalRes.json();
      const serializedPortal = JSON.stringify(portalBody);
      expect(serializedPortal).not.toContain('"cgm":"1001"');
      expect(serializedPortal).not.toContain("Anotacao sigilosa da Helena");
      expect(serializedPortal).not.toContain("Combinado privado da Helena");
      expect(portalBody.council.subjects.map((s: { id: string }) => s.id)).toEqual(["subj-a2"]);
      expect(portalBody.council.preCouncil.conversationsBySubjectId["subj-a1"]).toBeUndefined();
      expect(
        portalBody.council.students.every((st: { subjectEntries: Array<{ subjectId: string }> }) =>
          st.subjectEntries.every((e) => e.subjectId !== "subj-a1")
        )
      ).toBe(true);

      const preLink = createPreCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        conversationId: null,
      });
      const prePortalRes = await postPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preLink.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token: preLink.token }) }
      );
      expect(prePortalRes.status).toBe(200);
      const prePortalBody = await prePortalRes.json();
      expect(prePortalBody.council).toBeNull();
      const serializedPrePortal = JSON.stringify(prePortalBody);
      expect(serializedPrePortal).not.toContain("Anotacao sigilosa da Helena");
      expect(serializedPrePortal).not.toContain("Combinado privado da Helena");

      // Quando TODOS os componentes pertencem a terceiros, estudantes e síntese ficam vazios
      hoisted.db.subjects[1].teacherEmail = "helena@escola.pr.gov.br";
      const parsedCurrentPre = JSON.parse(hoisted.db.trimesters[0].preCouncilJson!);
      parsedCurrentPre.conversations[1].teacherEmail = "helena@escola.pr.gov.br";
      hoisted.db.trimesters[0].preCouncilJson = JSON.stringify(parsedCurrentPre);

      const allOthersPortalRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${teacherLink.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token: teacherLink.token }) }
      );
      expect(allOthersPortalRes.status).toBe(403);
      const allOthersPortalBody = await allOthersPortalRes.json();
      expect(allOthersPortalBody.council).toBeUndefined();
      expect(JSON.stringify(allOthersPortalBody)).not.toContain("Ana Clara");

      const allOthersPreRes = await postPreCouncilPortalRoute(
        new Request(`http://localhost/api/conselho-classe/pre-council-portal/${preLink.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token: preLink.token }) }
      );
      expect(allOthersPreRes.status).toBe(200);
      const allOthersPreBody = await allOthersPreRes.json();
      expect(allOthersPreBody.preCouncil.synthesis.mainDifficulties).toBe("");
    } finally {
      if (prevDevAuth === undefined) delete env.ENABLE_DEV_AUTH;
      else env.ENABLE_DEV_AUTH = prevDevAuth;
      if (prevVercelEnv === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = prevVercelEnv;
    }
  });

  it("[M-04 & B-03] calcula backoff de polling (Retry-After/429) e valida formato AAAA-MM-DD em dueDate", async () => {
    const {
      computePortalPollBackoffMs,
      TEACHER_PORTAL_POLL_BASE_MS,
      TEACHER_PORTAL_POLL_MAX_MS,
    } = await import("@/components/conselho/preCouncilUtils");
    const { councilPostActionItemSchema } = await import("@/lib/schemas");

    expect(computePortalPollBackoffMs({ retryAfterHeader: "30" })).toBe(30_000);
    expect(computePortalPollBackoffMs({ retryAfterBody: 45 })).toBe(45_000);
    expect(
      computePortalPollBackoffMs({ currentDelayMs: TEACHER_PORTAL_POLL_BASE_MS })
    ).toBe(30_000);
    expect(
      computePortalPollBackoffMs({ currentDelayMs: TEACHER_PORTAL_POLL_MAX_MS })
    ).toBe(TEACHER_PORTAL_POLL_MAX_MS);

    expect(
      councilPostActionItemSchema.safeParse({
        number: 1,
        description: "Acompanhamento de leitura",
        responsible: "ESCOLA",
        dueDate: "amanha",
      }).success
    ).toBe(false);

    for (const validDueDate of ["2026-12-01", "", null]) {
      expect(
        councilPostActionItemSchema.safeParse({
          number: 1,
          description: "Acompanhamento de leitura",
          responsible: "ESCOLA",
          dueDate: validDueDate,
        }).success
      ).toBe(true);
    }
  });

  it("cria migration SQL idempotente CREATE TABLE antes de 20261119113000 para os 5 models do Conselho", () => {
    const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
    const entries = fs.readdirSync(migrationsDir).sort();
    const baseIdx = entries.indexOf("20261118120000_class_council_module");
    const seatingIdx = entries.indexOf("20261119113000_class_council_seating_map_layout");
    expect(baseIdx).toBeGreaterThan(-1);
    expect(seatingIdx).toBeGreaterThan(baseIdx);

    const sql = fs.readFileSync(
      path.join(migrationsDir, "20261118120000_class_council_module", "migration.sql"),
      "utf8"
    );
    for (const table of [
      "ClassCouncilBoard",
      "ClassCouncilSubject",
      "ClassCouncilTrimester",
      "StudentCouncilCard",
      "StudentCouncilSubjectEntry",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    expect(sql).toContain("ON DELETE RESTRICT ON UPDATE CASCADE");
  });

  it("preserva contribuição docente recente no Pré-Conselho quando pedagoga salva snapshot desatualizado e preserva abaixo da média manual da Ficha", async () => {
    // 1. Pré-Conselho com envio docente recente não visto no rascunho da pedagoga
    const existingPre = buildInitialPreCouncilData({
      trimester: 1,
      subjects: hoisted.db.subjects.filter((s) => s.boardId === "board-a1"),
    });
    existingPre.conversations[1] = {
      ...existingPre.conversations[1],
      monitoredStudentIds: ["stu-a2"],
      monitoredStudentsNotes: "Observação do docente enviada no portal.",
      teacherSubmittedAt: "2026-11-20T14:00:00.000Z",
    };
    hoisted.db.trimesters[0].preCouncilJson = JSON.stringify(existingPre);

    const staleSaveRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          preCouncil: {
            version: 1,
            periodLabel: "1º Trimestre",
            objectiveText: existingPre.objectiveText,
            responsiblePedagogueName: "Pedagoga Alpha",
            responsiblePedagogueRole: "Pedagoga Responsável",
            conversations: [
              {
                id: existingPre.conversations[0].id,
                subjectId: "subj-a1",
                subjectName: "Língua Portuguesa",
                teacherName: "Prof. Helena",
                teacherEmail: null,
                monitoredStudentIds: [],
                monitoredStudentsNotes: "",
                agreements: "",
                conversationStatus: "PENDING",
                conversationDate: null,
              },
              {
                id: existingPre.conversations[1].id,
                subjectId: "subj-a2",
                subjectName: "Matemática",
                teacherName: "Prof. Marcos",
                teacherEmail: null,
                monitoredStudentIds: ["stu-a1"],
                monitoredStudentsNotes: "Anotação da pedagoga.",
                agreements: "Conversar com família",
                conversationStatus: "COMPLETED",
                conversationDate: "2026-11-20",
                teacherSubmittedAt: null, // cliente desatualizado não viu o envio das 14:00
              },
            ],
            synthesis: existingPre.synthesis,
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(staleSaveRes.status).toBe(200);
    const staleBody = await staleSaveRes.json();
    const parsedAfterStale = parsePreCouncilData(staleBody.trimesterRecord.preCouncilJson)!;
    expect(parsedAfterStale.conversations[1].monitoredStudentIds).toEqual(
      expect.arrayContaining(["stu-a1", "stu-a2"])
    );
    expect(parsedAfterStale.conversations[1].monitoredStudentsNotes).toContain(
      "Observação do docente enviada no portal."
    );
    expect(parsedAfterStale.conversations[1].monitoredStudentsNotes).toContain(
      "Anotação da pedagoga."
    );

    // 2. Quando a pedagoga ecoa o teacherSubmittedAt mais recente, sua edição explícita prevalece
    const syncedSaveRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          preCouncil: {
            ...parsedAfterStale,
            conversations: parsedAfterStale.conversations.map((c, idx) =>
              idx === 1
                ? {
                    ...c,
                    monitoredStudentIds: ["stu-a1"],
                    monitoredStudentsNotes: "Texto consolidado pela coordenação.",
                    teacherSubmittedAt: "2026-11-20T14:00:00.000Z",
                  }
                : c
            ),
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(syncedSaveRes.status).toBe(200);
    const syncedBody = await syncedSaveRes.json();
    const parsedAfterSynced = parsePreCouncilData(syncedBody.trimesterRecord.preCouncilJson)!;
    expect(parsedAfterSynced.conversations[1].monitoredStudentIds).toEqual(["stu-a1"]);
    expect(parsedAfterSynced.conversations[1].monitoredStudentsNotes).toBe(
      "Texto consolidado pela coordenação."
    );

    // 3. saveCouncilMatrixBatch preserva item manual livre e item manual vinculado a disciplina sem nota na matriz
    hoisted.db.cards[0].trimester1BelowAvgJson = JSON.stringify([
      { subjectId: null, subjectName: "Projeto Integrador (manual)", grade: 5.0 },
      { subjectId: "subj-a2", subjectName: "Matemática", grade: 4.5 },
    ]);
    const matrixSaveRes = await putMatrixRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/matrix", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          entries: [{ studentId: "stu-a1", subjectId: "subj-a2", descriptorCodes: [2] }],
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(matrixSaveRes.status).toBe(200);
    const savedBelow = JSON.parse(hoisted.db.cards[0].trimester1BelowAvgJson!);
    expect(savedBelow.map((i: { subjectName: string }) => i.subjectName)).toEqual(
      expect.arrayContaining(["Projeto Integrador (manual)", "Matemática"])
    );
  });

  it("formata datas civis sem deslocamento de -1 dia, aplica A4 paisagem em turma e melhora Prontuário 360º", async () => {
    const { formatCouncilCalendarDatePtBr } = await import("@/components/conselho/types");

    // 1. Datas no Pós-Conselho e generate-minute preservam YYYY-MM-DD exato em America/Sao_Paulo
    const patchRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          postCouncilHeldAt: "2026-05-10",
          postCouncilActionItems: [
            {
              number: 1,
              description: "Atendimento de reforço",
              responsible: "ESCOLA",
              dueDate: "2026-05-15",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(patchRes.status).toBe(200);

    const minuteRes = await postGenerateMinuteRoute(
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
    expect(minuteRes.status).toBe(201);
    const minuteBody = await minuteRes.json();
    expect(formatCouncilCalendarDatePtBr(minuteBody.minute.attendedAt)).toBe("10/05/2026");
    expect(formatCouncilCalendarDatePtBr(minuteBody.minute.actionItems[0].dueDate)).toBe(
      "15/05/2026"
    );

    // 2. ConselhoPrintClient: modo turma usa A4 paisagem; pós-conselho/aluno formatam datas e notas pt-BR
    const printBoard = {
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
      classGroup: { id: "cg-a1", name: "9º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
      subjects: [
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
      trimesters: [
        {
          id: "tri-a1-1",
          schoolId: "school-a",
          boardId: "board-a1",
          trimester: 1,
          status: "IN_PROGRESS",
          positivePoints: null,
          attentionPoints: null,
          plannedActions: null,
          postCouncilHeldAt: "2026-05-10T00:00:00.000Z",
          postCouncilAdvances: "Participação",
          postCouncilWhatWorked: null,
          postCouncilRecognizedAttitudes: null,
          postCouncilCriticalSubjects: null,
          postCouncilPerformanceFactors: null,
          postCouncilBehaviorAttendance: null,
          postCouncilWhatToImprove: null,
          postCouncilHowTeachersCanHelp: null,
          postCouncilCommitments: null,
          postCouncilActionItemsJson: JSON.stringify([
            { number: 1, description: "Plantão", responsible: "ESCOLA", dueDate: "2026-05-15" },
          ]),
          linkedMinuteId: null,
          updatedByName: null,
          updatedByEmail: null,
          updatedAt: "2026-05-10T15:00:00.000Z",
        },
      ],
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
          trimester1BelowAvgJson: JSON.stringify([
            { subjectId: "subj-a2", subjectName: "Matemática", grade: 4.5 },
          ]),
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
              id: "ent-1",
              schoolId: "school-a",
              cardId: "card-a1",
              subjectId: "subj-a2",
              trimester: 1,
              descriptorCodes: [2],
              grade: 4.5,
            },
          ],
        },
      ],
    };
    const printSchool = {
      id: "school-a",
      name: "Escola Teste",
      inepCode: "41000011",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
    };

    const htmlTurmaPrint = renderToString(
      React.createElement(ConselhoPrintClient, {
        board: printBoard as never,
        school: printSchool,
        initialMode: "turma",
        initialTrimester: 1,
        initialStudentId: "stu-a1",
        initialHideHealthTags: true,
        anonymizedOpinionsByStudentId: {},
      })
    );
    expect(htmlTurmaPrint).toContain("size: A4 landscape");
    expect(htmlTurmaPrint).toContain("(4,5)");

    const htmlPosPrint = renderToString(
      React.createElement(ConselhoPrintClient, {
        board: printBoard as never,
        school: printSchool,
        initialMode: "pos-conselho",
        initialTrimester: 1,
        initialStudentId: "stu-a1",
        initialHideHealthTags: false,
        anonymizedOpinionsByStudentId: {},
      })
    );
    expect(htmlPosPrint).toContain("10/05/2026");
    expect(htmlPosPrint).toContain("15/05/2026");

    // 3. CouncilStudent360Section: dark mode, py-0.5, trimestre relevante=2 e indicador de componentes ocultos
    const html360 = renderToString(
      React.createElement(CouncilStudent360Section, {
        councilCards: [
          {
            id: "c360-1",
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
            trimester2Opinion: "Evolução contínua no 2º trimestre.",
            trimester3Opinion: null,
            trimester1BelowAvgJson: null,
            trimester2BelowAvgJson: JSON.stringify([
              { subjectId: "subj-a2", subjectName: "Matemática", grade: 4.5 },
            ]),
            trimester3BelowAvgJson: null,
            board: {
              id: "board-a1",
              year: 2026,
              schoolId: "school-a",
              classGroup: { id: "cg-a1", name: "9º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
              subjects: [
                { id: "subj-a1", name: "Língua Portuguesa", teacherName: "Helena", displayOrder: 0 },
                { id: "subj-a2", name: "Matemática", teacherName: "Marcos", displayOrder: 1 },
              ],
            },
            subjectEntries: [
              { id: "e1", subjectId: "subj-a1", trimester: 2, descriptorCodes: [1], grade: 8.0 },
              { id: "e2", subjectId: "subj-a2", trimester: 2, descriptorCodes: [2], grade: 4.5 },
            ],
          },
        ],
      })
    ).replace(/<!-- -->/g, "");
    expect(html360).toContain("dark:bg-slate-900");
    expect(html360).not.toContain("py-0.2");
    expect(html360).toContain("trimester=2");
    expect(html360).toContain("Ver todos (+1 sem alerta)");
    expect(html360).toContain("Matemática (4,5)");
  });

  it("poda studentId órfão previamente persistido em outro componente ao salvar Pré-Conselho, sincroniza cards ausentes e mantém bloqueio a IDs estrangeiros (400)", async () => {
    hoisted.db.students.push({
      id: "stu-a3",
      name: "Daniela Lima",
      cgm: "1003",
      classGroupId: "cg-a1",
      schoolId: "school-a",
      active: true,
      isSpecialNeeds: false,
    });

    const basePre = buildInitialPreCouncilData({
      trimester: 1,
      subjects: hoisted.db.subjects.filter((s) => s.boardId === "board-a1"),
      responsiblePedagogueName: "Pedagoga Alpha",
    });
    basePre.conversations[0] = {
      ...basePre.conversations[0],
      monitoredStudentIds: ["stu-orphan-deleted", "stu-a1"],
    };
    hoisted.db.trimesters[0].preCouncilJson = JSON.stringify(basePre);

    // 1. Injetar ID estrangeiro novo (stu-b1) ou órfão em outra conversa continua bloqueado (400)
    const foreignRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          preCouncil: {
            ...basePre,
            conversations: [
              basePre.conversations[0],
              {
                ...basePre.conversations[1],
                monitoredStudentIds: ["stu-b1"],
              },
            ],
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(foreignRes.status).toBe(400);

    // 2. Salvar com órfão já persistido em subj-a1 + novo estudante stu-a3 sem card prévio -> 200 OK e poda o órfão
    const validSaveRes = await patchTrimesterRoute(
      new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: 1,
          preCouncil: {
            ...basePre,
            conversations: [
              basePre.conversations[0],
              {
                ...basePre.conversations[1],
                monitoredStudentIds: ["stu-a3"],
                agreements: "Acompanhar atividades semanais.",
                conversationStatus: "COMPLETED",
                conversationDate: "2026-11-24",
              },
            ],
          },
        }),
      }),
      { params: Promise.resolve({ boardId: "board-a1" }) }
    );
    expect(validSaveRes.status).toBe(200);
    const savedBody = await validSaveRes.json();
    const parsedSaved = parsePreCouncilData(savedBody.trimesterRecord.preCouncilJson)!;
    expect(parsedSaved.conversations[0].monitoredStudentIds).toEqual(["stu-a1"]);
    expect(parsedSaved.conversations[1].monitoredStudentIds).toEqual(["stu-a3"]);
    expect(parsedSaved.conversations[1].conversationStatus).toBe("COMPLETED");
  });

  it("sincroniza teacherEmail entre Pré-Conselho e ClassCouncilSubject e preserva autoria docente em rascunho desatualizado", async () => {
    const prevDevAuth = process.env.ENABLE_DEV_AUTH;
    const prevVercelEnv = process.env.VERCEL_ENV;
    process.env.ENABLE_DEV_AUTH = "true";
    delete process.env.VERCEL_ENV;

    try {
      const basePre = buildInitialPreCouncilData({
        trimester: 1,
        subjects: hoisted.db.subjects.filter((s) => s.boardId === "board-a1"),
        responsiblePedagogueName: "Pedagoga Alpha",
      });

      // 1. Pedagoga preenche teacherEmail e marca conversa realizada no Pré-Conselho -> sincroniza ClassCouncilSubject
      const savePreRes = await patchTrimesterRoute(
        new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: 1,
            preCouncil: {
              ...basePre,
              conversations: basePre.conversations.map((c) =>
                c.subjectId === "subj-a2"
                  ? {
                      ...c,
                      teacherName: "Prof. Marcos Novo",
                      teacherEmail: "marcos.novo@escola.pr.gov.br",
                      conversationStatus: "COMPLETED",
                      conversationDate: "2026-11-24",
                    }
                  : c
              ),
            },
          }),
        }),
        { params: Promise.resolve({ boardId: "board-a1" }) }
      );
      expect(savePreRes.status).toBe(200);
      expect(hoisted.db.subjects.find((s) => s.id === "subj-a2")?.teacherEmail).toBe(
        "marcos.novo@escola.pr.gov.br"
      );

      // Portal docente reconhece o novo e-mail e libera ciência
      const portalToken = createCouncilTeacherToken({
        schoolId: "school-a",
        boardId: "board-a1",
        trimester: 1,
        subjectId: "subj-a2",
      });
      const portalOkRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${portalToken.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:marcos.novo@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token: portalToken.token }) }
      );
      expect(portalOkRes.status).toBe(200);
      const portalOkBody = await portalOkRes.json();
      expect(
        portalOkBody.council.preCouncil.conversationsBySubjectId["subj-a2"].canConfirmAck
      ).toBe(true);

      // 2. Pedagoga atualiza teacherEmail via PUT /subjects -> sincroniza preCouncilJson também
      const putSubjRes = await putSubjectsRoute(
        new Request("http://localhost/api/conselho-classe/board-a1/subjects", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjects: hoisted.db.subjects
              .filter((s) => s.boardId === "board-a1")
              .map((s) =>
                s.id === "subj-a2"
                  ? {
                      id: s.id,
                      name: s.name,
                      teacherName: "Prof. Marcos Revisado",
                      teacherEmail: "marcos.revisado@escola.pr.gov.br",
                      displayOrder: s.displayOrder,
                      active: true,
                    }
                  : {
                      id: s.id,
                      name: s.name,
                      teacherName: s.teacherName,
                      teacherEmail: s.teacherEmail,
                      displayOrder: s.displayOrder,
                      active: true,
                    }
              ),
          }),
        }),
        { params: Promise.resolve({ boardId: "board-a1" }) }
      );
      expect(putSubjRes.status).toBe(200);
      const parsedAfterSubj = parsePreCouncilData(hoisted.db.trimesters[0].preCouncilJson)!;
      expect(
        parsedAfterSubj.conversations.find((c) => c.subjectId === "subj-a2")?.teacherEmail
      ).toBe("marcos.revisado@escola.pr.gov.br");

      const portalRevisedRes = await postTeacherPortalRoute(
        new Request(`http://localhost/api/conselho-classe/teacher-portal/${portalToken.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:marcos.revisado@escola.pr.gov.br",
          }),
        }),
        { params: Promise.resolve({ token: portalToken.token }) }
      );
      expect(portalRevisedRes.status).toBe(200);
      const portalRevisedBody = await portalRevisedRes.json();
      expect(
        portalRevisedBody.council.preCouncil.conversationsBySubjectId["subj-a2"].canConfirmAck
      ).toBe(true);

      // 3. Salvamento com rascunho desatualizado (hasUnseenTeacherSubmission) não apaga teacherEmail recém-enviado pelo docente
      const currentPre = parsePreCouncilData(hoisted.db.trimesters[0].preCouncilJson)!;
      currentPre.conversations = currentPre.conversations.map((c) =>
        c.subjectId === "subj-a2"
          ? {
              ...c,
              teacherEmail: "docente.envio@escola.pr.gov.br",
              teacherName: "Prof. Envio",
              teacherSubmittedAt: "2026-11-24T20:00:00.000Z",
            }
          : c
      );
      hoisted.db.trimesters[0].preCouncilJson = JSON.stringify(currentPre);

      const staleRes = await patchTrimesterRoute(
        new Request("http://localhost/api/conselho-classe/board-a1/trimesters", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: 1,
            preCouncil: {
              ...basePre,
              conversations: basePre.conversations.map((c) =>
                c.subjectId === "subj-a2"
                  ? {
                      ...c,
                      teacherName: "",
                      teacherEmail: null,
                      agreements: "Combinado registrado",
                      conversationStatus: "COMPLETED",
                      conversationDate: "2026-11-24",
                      teacherSubmittedAt: null,
                    }
                  : c
              ),
            },
          }),
        }),
        { params: Promise.resolve({ boardId: "board-a1" }) }
      );
      expect(staleRes.status).toBe(200);
      const parsedAfterStale = parsePreCouncilData(
        (await staleRes.json()).trimesterRecord.preCouncilJson
      )!;
      const convA2 = parsedAfterStale.conversations.find((c) => c.subjectId === "subj-a2")!;
      expect(convA2.teacherEmail).toBe("docente.envio@escola.pr.gov.br");
      expect(convA2.teacherName).toBe("Prof. Envio");
    } finally {
      if (prevDevAuth === undefined) delete process.env.ENABLE_DEV_AUTH;
      else process.env.ENABLE_DEV_AUTH = prevDevAuth;
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
    }
  });
});
