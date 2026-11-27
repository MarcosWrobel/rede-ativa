import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const hoisted = vi.hoisted(() => ({
  session: null as any,
  currentSchool: {
    id: "school-a",
    inepCode: "41000099",
    name: "Escola Municipal Alpha",
    city: "Castro",
    state: "PR",
    nre: "SEMEC Castro",
    network: "MUNICIPAL",
    edition: "INSTITUCIONAL_ESSENCIAL" as const,
  },
  db: {
    students: [] as any[],
    classGroups: [] as any[],
    templates: [] as any[],
    actions: [] as any[],
    users: [] as any[],
  },
  logAudit: vi.fn(async () => {}),
  checkRateLimit: vi.fn(async () => ({ success: true, retryAfterSeconds: 0 })),
  resetRateLimit: vi.fn(async () => {}),
  classGroupFindMany: vi.fn(),
  templateFindMany: vi.fn(),
  templateFindUnique: vi.fn(),
  messageLogCreate: vi.fn(),
  studentFindUnique: vi.fn(),
  studentFindMany: vi.fn(),
  studentCreate: vi.fn(),
  studentCreateMany: vi.fn(),
  studentUpdate: vi.fn(),
  actionFindUnique: vi.fn(),
  actionFindMany: vi.fn(),
  actionUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  userUpsert: vi.fn(),
  userUpdate: vi.fn(),
  transaction: vi.fn(),
  capturedAuthConfig: null as any,
}));

vi.mock("next-auth", () => ({
  default: vi.fn((config: any) => {
    hoisted.capturedAuthConfig = config;
    return {
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
      auth: vi.fn(async () => hoisted.session),
    };
  }),
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((opts: any) => ({ id: opts.id, ...opts })),
}));

vi.mock("@/lib/auth.config", () => ({
  authConfig: { providers: [], callbacks: {} },
  sanitizeJwtLogoUrl: (v: any) => v ?? null,
}));

vi.mock("@/lib/currentSchool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currentSchool")>("@/lib/currentSchool");
  return {
    ...actual,
    getCurrentSchool: vi.fn(async () => hoisted.currentSchool),
    getAuthorizedCurrentSchool: vi.fn(async () => hoisted.currentSchool),
    requireAuthorizedSchool: vi.fn(async () => ({ ok: true, school: hoisted.currentSchool })),
    ensureDefaultSchool: vi.fn(async () => hoisted.currentSchool),
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: hoisted.logAudit,
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: hoisted.checkRateLimit,
  resetRateLimit: hoisted.resetRateLimit,
  RATE_LIMIT_POLICIES: {
    PIN_BRUTE_FORCE: { limit: 5, windowMs: 900000 },
  },
}));

vi.mock("@/lib/signingPin", () => ({
  verifyServerSigningPin: vi.fn(async () => ({ ok: true })),
  validatePinFormat: vi.fn(() => ({ valid: true })),
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
  verifyPin: vi.fn(async (pin: string, hash: string) => hash === `hashed:${pin}`),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    absenceJustification: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: any) => ({ id: "just-1", ...data })),
    },
    classGroup: {
      findMany: hoisted.classGroupFindMany,
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          hoisted.db.classGroups.find(
            (cg) => (!where?.id || cg.id === where.id) && (!where?.schoolId || cg.schoolId === where.schoolId)
          ) || null
        );
      }),
      create: vi.fn(async ({ data }: any) => ({ id: "cg-new", ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    studentContact: {
      findMany: vi.fn(async () => []),
    },
    pedagogicalActionItem: {
      findMany: hoisted.actionFindMany,
      findUnique: hoisted.actionFindUnique,
      update: hoisted.actionUpdate,
    },
    messageTemplate: {
      findMany: hoisted.templateFindMany,
      findUnique: hoisted.templateFindUnique,
    },
    messageLog: {
      create: hoisted.messageLogCreate,
    },
    student: {
      findUnique: hoisted.studentFindUnique,
      findMany: hoisted.studentFindMany,
      create: hoisted.studentCreate,
      createMany: hoisted.studentCreateMany,
      update: hoisted.studentUpdate,
    },
    user: {
      findUnique: hoisted.userFindUnique,
      upsert: hoisted.userUpsert,
      update: hoisted.userUpdate,
    },
    $transaction: hoisted.transaction,
  },
}));

import { GET as getJustifications, POST as postJustification } from "@/app/api/justifications/route";
import { GET as getActions } from "@/app/api/atas/actions/route";
import { PATCH as patchActionById } from "@/app/api/atas/actions/[id]/route";
import { GET as getTemplates } from "@/app/api/templates/route";
import { dispatchAndPersistMessage } from "@/services/messageDispatchService";
import { POST as createStudent, PUT as updateStudent } from "@/app/api/students/route";
import { POST as importStudents } from "@/app/api/students/import/route";
import { POST as finalizeAta } from "@/app/api/atas/[id]/finalize/route";
import { POST as postSigningPin } from "@/app/api/user/signing-pin/route";

describe("Remediação Cirúrgica Setor B & Regra 10 GEMINI.md", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.currentSchool = {
      id: "school-a",
      inepCode: "41000099",
      name: "Escola Municipal Alpha",
      city: "Castro",
      state: "PR",
      nre: "SEMEC Castro",
      network: "MUNICIPAL",
      edition: "INSTITUCIONAL_ESSENCIAL",
    };
    hoisted.session = {
      user: {
        id: "usr-pedagoga-a",
        name: "Pedagoga Alpha",
        email: "pedagoga@escola-a.pr.gov.br",
        role: "PEDAGOGA",
        active: true,
        schoolId: "school-a",
        schools: [{ schoolId: "school-a", role: "PEDAGOGA", active: true }],
      },
    };
    hoisted.db = {
      students: [
        {
          id: "stu-a1",
          cgm: "111111",
          name: "ALUNO ALPHA",
          guardianName: "Responsável Alpha",
          phone: "42999991111",
          classGroupId: "cg-a1",
          schoolId: "school-a",
          active: true,
          classGroup: { id: "cg-a1", name: "6º Ano A" },
        },
        {
          id: "stu-a-no-cgm",
          cgm: null,
          name: "ALUNO SEM CGM",
          guardianName: "Responsável",
          phone: "42999992222",
          classGroupId: "cg-a1",
          schoolId: "school-a",
          active: true,
          classGroup: { id: "cg-a1", name: "6º Ano A" },
        },
        {
          id: "stu-b1",
          cgm: "999999",
          name: "ALUNO BETA",
          guardianName: "Responsável Beta",
          phone: "42999993333",
          classGroupId: "cg-b1",
          schoolId: "school-b",
          active: true,
          classGroup: { id: "cg-b1", name: "7º Ano B" },
        },
      ],
      classGroups: [{ id: "cg-a1", name: "6º Ano A", shift: "MANHA", schoolId: "school-a" }],
      templates: [],
      actions: [],
      users: [
        {
          id: "usr-pedagoga-a",
          name: "Pedagoga Alpha",
          email: "pedagoga@escola-a.pr.gov.br",
          role: "PEDAGOGA",
          active: true,
          schoolId: "school-a",
          signingPinHash: "hashed:8391",
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      ],
    };

    hoisted.checkRateLimit.mockResolvedValue({ success: true, retryAfterSeconds: 0 });
    hoisted.userFindUnique.mockImplementation(async ({ where }: any) => {
      const u = hoisted.db.users.find(
        (x) => (where?.id && x.id === where.id) || (where?.email && x.email === where.email)
      );
      if (!u) return null;
      return {
        ...u,
        schools: [
          {
            schoolId: hoisted.currentSchool.id,
            role: hoisted.session?.user?.role || u.role,
            active: true,
            school: hoisted.currentSchool,
          },
        ],
        networks: [],
      };
    });
    hoisted.classGroupFindMany.mockImplementation(async () => hoisted.db.classGroups);
    hoisted.templateFindMany.mockResolvedValue([]);
    hoisted.templateFindUnique.mockResolvedValue(null);
    hoisted.actionFindMany.mockResolvedValue([]);
    hoisted.studentFindUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id) return hoisted.db.students.find((s) => s.id === where.id) || null;
      if (where?.cgm) return hoisted.db.students.find((s) => s.cgm === where.cgm) || null;
      return null;
    });
    hoisted.studentFindMany.mockImplementation(async ({ where }: any) => {
      if (where?.schoolId) return hoisted.db.students.filter((s) => s.schoolId === where.schoolId);
      if (where?.cgm?.in) return hoisted.db.students.filter((s) => s.cgm && where.cgm.in.includes(s.cgm));
      return hoisted.db.students;
    });
    hoisted.studentCreateMany.mockResolvedValue({ count: 0 });
    hoisted.transaction.mockImplementation(async (arg: any) => {
      if (typeof arg === "function") {
        return arg({
          $executeRaw: vi.fn(async () => 0),
          absenceJustification: {
            findMany: vi.fn(async () => []),
          },
          studentContact: {
            findMany: vi.fn(async () => []),
          },
          student: {
            findUnique: hoisted.studentFindUnique,
            findFirst: vi.fn(async ({ where }: any) => {
              return (
                hoisted.db.students.find(
                  (s) =>
                    (!where?.id || s.id === where.id) &&
                    (!where?.schoolId || s.schoolId === where.schoolId)
                ) || null
              );
            }),
            findMany: hoisted.studentFindMany,
            create: hoisted.studentCreate,
            createMany: hoisted.studentCreateMany,
            update: hoisted.studentUpdate,
            updateMany: vi.fn(async ({ where, data }: any) => {
              await hoisted.studentUpdate({ where, data });
              return { count: 1 };
            }),
          },
          classGroup: {
            findMany: hoisted.classGroupFindMany,
            findFirst: vi.fn(async ({ where }: any) => {
              return (
                hoisted.db.classGroups.find(
                  (cg) =>
                    (!where?.id || cg.id === where.id) &&
                    (!where?.schoolId || cg.schoolId === where.schoolId)
                ) || null
              );
            }),
            findUnique: vi.fn(async ({ where }: any) => ({
              id: where.id,
              schoolId: hoisted.currentSchool.id,
              name: "6º Ano A",
            })),
            create: vi.fn(async ({ data }: any) => ({ id: "cg-new", ...data })),
            update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
          },
          messageTemplate: {
            findMany: hoisted.templateFindMany,
            findUnique: hoisted.templateFindUnique,
          },
          messageLog: {
            create: hoisted.messageLogCreate,
            update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
          },
        });
      }
      return Promise.all(arg);
    });
  });

  it("1. Isola turmas em GET /api/justifications e aplica assertTenantOwnership em POST /api/justifications", async () => {
    const getRes = await getJustifications(new Request("http://localhost/api/justifications"));
    expect(getRes.status).toBe(200);
    expect(hoisted.classGroupFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: "school-a" },
      })
    );

    // Mesmo papel ADMIN legado não pode burlar posse de tenant (somente SUPERADMIN)
    hoisted.session.user.role = "ADMIN";
    const postRes = await postJustification(
      new Request("http://localhost/api/justifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "stu-b1",
          type: "ATESTADO_MEDICO",
          startDate: "2026-11-10",
          endDate: "2026-11-12",
        }),
      })
    );
    expect(postRes.status).toBe(403);
  });

  it("2. Isola turmas, filtra atas sigilosas em GET /api/atas/actions e valida posse em PATCH /api/atas/actions/[id]", async () => {
    hoisted.actionFindMany
      .mockResolvedValueOnce([
        {
          id: "act-public",
          status: "PENDING",
          dueDate: null,
          responsible: "FAMILIA",
          minute: {
            id: "min-1",
            schoolId: "school-a",
            authorId: "other-user",
            authorEmail: "outra@escola-a.pr.gov.br",
            isConfidential: false,
            students: [],
          },
        },
        {
          id: "act-secret-other",
          status: "PENDING",
          dueDate: null,
          responsible: "ESCOLA",
          minute: {
            id: "min-2",
            schoolId: "school-a",
            authorId: "other-user",
            authorEmail: "outra@escola-a.pr.gov.br",
            isConfidential: true,
            students: [],
          },
        },
        {
          id: "act-secret-mine",
          status: "PENDING",
          dueDate: null,
          responsible: "ESCOLA",
          minute: {
            id: "min-3",
            schoolId: "school-a",
            authorId: "usr-pedagoga-a",
            authorEmail: "pedagoga@escola-a.pr.gov.br",
            isConfidential: true,
            students: [],
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "act-public",
          status: "PENDING",
          dueDate: null,
          responsible: "FAMILIA",
          minute: { isConfidential: false, schoolId: "school-a", authorId: "other-user", authorEmail: "outra@escola-a.pr.gov.br" },
        },
        {
          id: "act-secret-other",
          status: "PENDING",
          dueDate: null,
          responsible: "ESCOLA",
          minute: { isConfidential: true, schoolId: "school-a", authorId: "other-user", authorEmail: "outra@escola-a.pr.gov.br" },
        },
        {
          id: "act-secret-mine",
          status: "PENDING",
          dueDate: null,
          responsible: "ESCOLA",
          minute: { isConfidential: true, schoolId: "school-a", authorId: "usr-pedagoga-a", authorEmail: "pedagoga@escola-a.pr.gov.br" },
        },
      ]);

    const actionsRes = await getActions(new Request("http://localhost/api/atas/actions"));
    expect(actionsRes.status).toBe(200);
    const actionsData = await actionsRes.json();

    expect(hoisted.classGroupFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-a" } })
    );
    expect(actionsData.actionItems.map((a: any) => a.id)).toEqual([
      "act-public",
      "act-secret-mine",
    ]);
    expect(actionsData.metrics.total).toBe(2);

    // PATCH em encaminhamento de outra escola deve falhar com 403 via assertTenantOwnership
    hoisted.session.user.role = "ADMIN";
    hoisted.actionFindUnique.mockResolvedValueOnce({
      id: "act-b1",
      description: "Encaminhamento escola B",
      completionNotes: null,
      minute: {
        id: "min-b1",
        schoolId: "school-b",
        ataNumber: 12,
        year: 2026,
        subject: "Sigilo",
      },
    });
    const patchRes = await patchActionById(
      new Request("http://localhost/api/atas/actions/act-b1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      }),
      { params: Promise.resolve({ id: "act-b1" }) }
    );
    expect(patchRes.status).toBe(403);
  });

  it("3. Restringe fallback schoolId: null em /api/templates à escola piloto e valida templateId em messageDispatchService", async () => {
    await getTemplates(new Request("http://localhost/api/templates"));
    expect(hoisted.templateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          schoolId: "school-a",
        }),
      })
    );
    const nonPilotWhere = hoisted.templateFindMany.mock.calls[0][0].where;
    expect(nonPilotWhere.OR).toBeUndefined();

    hoisted.currentSchool = {
      ...hoisted.currentSchool,
      id: "default-leopoldina",
      inepCode: "41042730",
    };
    await getTemplates(new Request("http://localhost/api/templates"));
    const pilotWhere = hoisted.templateFindMany.mock.calls[1][0].where;
    expect(pilotWhere.OR).toEqual([{ schoolId: "default-leopoldina" }, { schoolId: null }]);

    // templateId inexistente retorna 404 controlado sem tentar create em MessageLog
    hoisted.currentSchool.id = "school-a";
    hoisted.currentSchool.inepCode = "41000099";
    hoisted.templateFindUnique.mockResolvedValueOnce(null);
    const dispatchRes = await dispatchAndPersistMessage({
      studentId: "stu-a1",
      templateId: "tpl-removido",
      reasonTitle: "Ausência",
      messageContent: "Olá família",
      currentSchoolId: "school-a",
      session: hoisted.session,
      userId: "usr-pedagoga-a",
      userName: "Pedagoga Alpha",
      userEmail: "pedagoga@escola-a.pr.gov.br",
    });
    expect(dispatchRes.ok).toBe(false);
    if (!dispatchRes.ok) {
      expect(dispatchRes.status).toBe(404);
    }
    expect(hoisted.messageLogCreate).not.toHaveBeenCalled();
  });

  it("4. Trata colisão de CGM (409) em POST/PUT /api/students e absorve P2002 concorrente em /api/students/import", async () => {
    const postConflictRes = await createStudent(
      new Request("http://localhost/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cgm: "999999",
          name: "NOVO ALUNO",
          phone: "42999990000",
          classGroupId: "cg-a1",
        }),
      })
    );
    expect(postConflictRes.status).toBe(409);

    hoisted.studentCreate.mockRejectedValueOnce({ code: "P2002" });
    const postRaceRes = await createStudent(
      new Request("http://localhost/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cgm: "777777",
          name: "CORRIDA CGM",
          phone: "42999990000",
          classGroupId: "cg-a1",
        }),
      })
    );
    expect(postRaceRes.status).toBe(409);

    hoisted.studentUpdate.mockRejectedValueOnce({ code: "P2002" });
    const putRaceRes = await updateStudent(
      new Request("http://localhost/api/students", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "stu-a1",
          cgm: "888888",
        }),
      })
    );
    expect(putRaceRes.status).toBe(409);

    // Em /api/students/import, colisão concorrente P2002 ao vincular CGM é absorvida por applyPendingCgmUpdatesSafely
    hoisted.studentUpdate.mockRejectedValue({ code: "P2002" });
    const importRes = await importStudents(
      new Request("http://localhost/api/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turmas: [{ tempId: "t1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }],
          students: [
            {
              turmaTempId: "t1",
              cgm: "555555",
              name: "ALUNO SEM CGM",
              phone: "42999992222",
            },
          ],
          options: { updateExisting: true },
        }),
      })
    );
    expect(importRes.status).toBe(200);
    const importData = await importRes.json();
    expect(importData.success).toBe(true);
    expect(importData.summary.cgmsBound).toBe(0);
  });

  it("5. Garante schoolId válido em AuditLog (finalize lockout, signing-pin e auth.ts)", async () => {
    // 5a. Lockout em /api/atas/[id]/finalize nunca usa "global"
    hoisted.checkRateLimit.mockResolvedValueOnce({ success: false, retryAfterSeconds: 900 });
    const finalizeRes = await finalizeAta(
      new Request("http://localhost/api/atas/min-1/finalize", {
        method: "POST",
        body: JSON.stringify({ signingPin: "0000" }),
      }),
      { params: Promise.resolve({ id: "min-1" }) }
    );
    expect(finalizeRes.status).toBe(429);
    expect(hoisted.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SIGNING_PIN_LOCKOUT",
        schoolId: "school-a",
      })
    );

    // 5b. Falha de PIN atual em /api/user/signing-pin grava logAudit com schoolId da escola ativa
    hoisted.userFindUnique.mockResolvedValueOnce(hoisted.db.users[0]);
    hoisted.userUpdate.mockResolvedValueOnce(hoisted.db.users[0]);
    const wrongPinRes = await postSigningPin(
      new Request("http://localhost/api/user/signing-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change", currentPin: "0000", newPin: "4917" }),
      })
    );
    expect(wrongPinRes.status).toBe(401);
    expect(hoisted.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CHANGE_SIGNING_PIN",
        schoolId: "school-a",
        details: expect.objectContaining({ success: false }),
      })
    );

    // 5c. auth.ts grava schoolId explícito (null ou dbUser.schoolId) em LOGIN_DENIED e USER_LOGIN
    const signInCallback = hoisted.capturedAuthConfig?.callbacks?.signIn;
    expect(typeof signInCallback).toBe("function");

    hoisted.userFindUnique.mockResolvedValueOnce(null);
    await signInCallback({ user: { email: "intruso@gmail.com", name: "Intruso" }, account: { provider: "google" } });
    expect(hoisted.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        schoolId: null,
      })
    );

    const activeUser = hoisted.db.users[0];
    hoisted.userFindUnique.mockResolvedValueOnce(activeUser);
    hoisted.userUpsert.mockResolvedValueOnce(activeUser);
    await signInCallback({
      user: { email: activeUser.email, name: activeUser.name },
      account: { provider: "google" },
    });
    expect(hoisted.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "USER_LOGIN",
        schoolId: "school-a",
      })
    );
  });

  it("6. Regra 10 GEMINI.md: remove 'fé pública', 'imutável' e citações legais das telas do Setor A", () => {
    const uiFiles = [
      "src/app/visao-geral/page.tsx",
      "src/app/onboarding/OnboardingClient.tsx",
      "src/app/secretaria/SecretariaClient.tsx",
      "src/app/admin/AdminClient.tsx",
      "src/app/auditoria/AuditoriaClient.tsx",
    ];
    const forbidden = [/fé pública/i, /fe publica/i, /imutável/i, /14\.063\/2020/, /Art\. 56/i];

    for (const relPath of uiFiles) {
      const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
      for (const pattern of forbidden) {
        expect(content, `${relPath} não deve conter ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
