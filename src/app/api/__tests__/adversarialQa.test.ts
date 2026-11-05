import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// CONTEXTOS DE AUTENTICAÇÃO E COOKIES (Tenant A vs Tenant B)
// ============================================================================
const hoisted = vi.hoisted(() => {
  const authContextSchoolA = {
    user: {
      id: "user-gestor-a",
      name: "Gestor Escola A",
      email: "gestor@escola-a.pr.gov.br",
      role: "GESTOR_ESCOLAR",
      schoolId: "escola-a",
      active: true,
      schools: [{ schoolId: "escola-a", role: "GESTOR_ESCOLAR", active: true }],
    },
  };

  const authContextSchoolB = {
    user: {
      id: "user-gestor-b",
      name: "Gestor Escola B",
      email: "gestor@escola-b.pr.gov.br",
      role: "GESTOR_ESCOLAR",
      schoolId: "escola-b",
      active: true,
      schools: [{ schoolId: "escola-b", role: "GESTOR_ESCOLAR", active: true }],
    },
  };

  const authContextLeopoldina = {
    user: {
      id: "user-gestor-leopoldina",
      name: "Gestor Leopoldina",
      email: "gestor@leopoldina.pr.gov.br",
      role: "GESTOR_ESCOLAR",
      schoolId: "default-leopoldina",
      inepCode: "41042730",
      active: true,
      schools: [{ schoolId: "default-leopoldina", role: "GESTOR_ESCOLAR", active: true }],
    },
  };

  const state = {
    currentSession: authContextSchoolA as any,
    cookieJar: {} as Record<string, string>,
    db: {} as any,
    prisma: {} as any,
  };

  return { authContextSchoolA, authContextSchoolB, authContextLeopoldina, state };
});

export const { authContextSchoolA, authContextSchoolB, authContextLeopoldina } = hoisted;

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.state.currentSession),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      hoisted.state.cookieJar[name] !== undefined
        ? { name, value: hoisted.state.cookieJar[name] }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/whatsappProvider", () => ({
  dispatchWhatsAppMessage: vi.fn(async () => ({
    mode: "MANUAL_LINK",
    initialStatus: "CLICKED_MANUAL",
    whatsappUrl: "https://wa.me/5541999990001",
  })),
}));

// ============================================================================
// CAMADA DE PERSISTÊNCIA EM MEMÓRIA PARA VERIFICAÇÃO DE ESTADO (DB STATEFUL)
// ============================================================================
interface TestDb {
  schools: any[];
  classGroups: any[];
  students: any[];
  minutes: any[];
  addendums: any[];
  minuteStudents: any[];
  messageLogs: any[];
  templates: any[];
  justifications: any[];
  users: any[];
  userSchools: any[];
  auditLogs: any[];
}

let db: TestDb;

function resetDb() {
  db = {
    schools: [
      {
        id: "escola-a",
        inepCode: "41000001",
        name: "Escola Estadual Alpha",
        city: "Tibagi",
        state: "PR",
        nre: "Ponta Grossa",
        network: "ESTADUAL",
        active: true,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "escola-b",
        inepCode: "41000002",
        name: "Escola Municipal Beta",
        city: "Tibagi",
        state: "PR",
        nre: "Ponta Grossa",
        network: "MUNICIPAL",
        active: true,
        createdAt: new Date("2026-01-02"),
      },
      {
        id: "default-leopoldina",
        inepCode: "41042730",
        name: "Colégio Estadual Leopoldina B. Pedroso",
        city: "Ponta Grossa",
        state: "PR",
        nre: "Ponta Grossa",
        network: "ESTADUAL",
        active: true,
        createdAt: new Date("2025-01-01"),
      },
    ],
    classGroups: [
      { id: "turma-a1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA", schoolId: "escola-a" },
      { id: "turma-b1", name: "9º Ano B", segment: "FUNDAMENTAL", shift: "TARDE", schoolId: "escola-b" },
      { id: "turma-legada-null", name: "1º Ano Sede Legado", segment: "MEDIO", shift: "MANHA", schoolId: null },
    ],
    students: [
      {
        id: "aluno-a1",
        cgm: "10000001",
        name: "ALUNO ALPHA UM",
        guardianName: "Responsável Alpha",
        phone: "41999990001",
        classGroupId: "turma-a1",
        schoolId: "escola-a",
        active: true,
      },
      {
        id: "aluno-b1",
        cgm: "20000002",
        name: "ALUNO BETA VITIMA",
        guardianName: "Responsável Beta",
        phone: "41999990002",
        classGroupId: "turma-b1",
        schoolId: "escola-b",
        active: true,
      },
      {
        id: "aluno-leopoldina-1",
        cgm: "410427301",
        name: "ESTUDANTE PILOTO SEDE",
        guardianName: "Responsável Sede",
        phone: "42999990003",
        classGroupId: "turma-legada-null",
        schoolId: "default-leopoldina",
        active: true,
      },
    ],
    minutes: [
      {
        id: "ata-draft-b",
        schoolId: "escola-b",
        year: 2026,
        ataNumber: null,
        status: "DRAFT",
        subject: "Atendimento Sigiloso Escola B",
        summary: "Conteúdo sigiloso de estudante da Escola B",
        contentHash: null,
        verificationCode: null,
      },
      {
        id: "ata-final-b",
        schoolId: "escola-b",
        year: 2026,
        ataNumber: 12,
        status: "FINALIZED",
        subject: "Ata Lavrada Escola B",
        summary: "Conteúdo oficial imutável Escola B",
        contentHash: "hash-genesis-escola-b",
        verificationCode: "CERT-BBBB",
      },
      {
        id: "ata-draft-a",
        schoolId: "escola-a",
        year: 2026,
        ataNumber: null,
        status: "DRAFT",
        subject: "Rascunho Escola A",
        summary: "Resumo original A",
        contentHash: null,
        verificationCode: null,
      },
    ],
    addendums: [],
    minuteStudents: [],
    messageLogs: [
      {
        id: "msg-b1",
        studentId: "aluno-b1",
        reasonTitle: "Falta Consecutiva",
        messageContent: "Mensagem privada da Escola B",
        phoneUsed: "5541999990002",
        sentByName: "Pedagoga B",
        sentAt: new Date("2026-10-10"),
        guardianReplied: false,
        replyNotes: null,
        deliveryStatus: "SENT",
      },
    ],
    templates: [
      {
        id: "tpl-privado-b",
        title: "Template Exclusivo Escola B",
        schoolId: "escola-b",
      },
    ],
    justifications: [
      {
        id: "just-b1",
        studentId: "aluno-b1",
        type: "ATESTADO_MEDICO",
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-05"),
        notes: "CID sigiloso da Escola B",
      },
    ],
    users: [
      {
        id: "user-gestor-a",
        email: "gestor@escola-a.pr.gov.br",
        name: "Gestor Escola A",
        role: "GESTOR_ESCOLAR",
        schoolId: "escola-a",
        active: true,
      },
      {
        id: "user-pedagoga-a",
        email: "pedagoga@escola-a.pr.gov.br",
        name: "Pedagoga Escola A",
        role: "PEDAGOGA",
        schoolId: "escola-a",
        active: true,
      },
      {
        id: "user-gestor-b",
        email: "gestor@escola-b.pr.gov.br",
        name: "Gestor Escola B",
        role: "GESTOR_ESCOLAR",
        schoolId: "escola-b",
        active: true,
      },
    ],
    userSchools: [
      { userId: "user-gestor-a", schoolId: "escola-a", role: "GESTOR_ESCOLAR", active: true },
      { userId: "user-pedagoga-a", schoolId: "escola-a", role: "PEDAGOGA", active: true },
      { userId: "user-gestor-b", schoolId: "escola-b", role: "GESTOR_ESCOLAR", active: true },
    ],
    auditLogs: [],
  };
}

function matchFilter(item: any, where: any): boolean {
  if (!where || Object.keys(where).length === 0) return true;
  for (const [key, cond] of Object.entries<any>(where)) {
    if (key === "OR") {
      if (!cond.some((sub: any) => matchFilter(item, sub))) return false;
      continue;
    }
    if (key === "AND") {
      if (!cond.every((sub: any) => matchFilter(item, sub))) return false;
      continue;
    }
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ("in" in cond) {
        if (!cond.in.includes(item[key])) return false;
        continue;
      }
      if ("equals" in cond) {
        if (cond.mode === "insensitive") {
          if (String(item[key] || "").toLowerCase() !== String(cond.equals || "").toLowerCase()) return false;
        } else if (item[key] !== cond.equals) {
          return false;
        }
        continue;
      }
      if ("not" in cond) {
        if (item[key] === cond.not) return false;
        continue;
      }
      // Relation filter on student
      if (key === "student") {
        const st = db.students.find((s) => s.id === item.studentId);
        if (!st || !matchFilter(st, cond)) return false;
        continue;
      }
    }
    if (item[key] !== cond) return false;
  }
  return true;
}

const prismaMock: any = {
  $executeRaw: vi.fn(async () => 1),
  $transaction: vi.fn(async (arg: any) => {
    if (typeof arg === "function") return arg(prismaMock);
    return Promise.all(arg);
  }),
  school: {
    findUnique: vi.fn(async ({ where }: any) =>
      db.schools.find((s) => (where.id && s.id === where.id) || (where.inepCode && s.inepCode === where.inepCode)) || null
    ),
    findFirst: vi.fn(async ({ where }: any) => db.schools.find((s) => matchFilter(s, where)) || null),
    update: vi.fn(async ({ where, data }: any) => {
      const idx = db.schools.findIndex((s) => s.id === where.id);
      if (idx === -1) throw new Error("School not found");
      db.schools[idx] = { ...db.schools[idx], ...data };
      return db.schools[idx];
    }),
    upsert: vi.fn(async () => db.schools.find((s) => s.id === "default-leopoldina")),
  },
  classGroup: {
    findFirst: vi.fn(async ({ where }: any) => db.classGroups.find((c) => matchFilter(c, where)) || null),
    findMany: vi.fn(async ({ where }: any = {}) =>
      db.classGroups
        .filter((c) => matchFilter(c, where))
        .map((c) => ({
          ...c,
          _count: { students: db.students.filter((s) => s.classGroupId === c.id && s.active).length },
        }))
    ),
    create: vi.fn(async ({ data }: any) => {
      const created = { id: `cg-${db.classGroups.length + 1}`, ...data };
      db.classGroups.push(created);
      return created;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const idx = db.classGroups.findIndex((c) => c.id === where.id);
      db.classGroups[idx] = { ...db.classGroups[idx], ...data };
      return db.classGroups[idx];
    }),
  },
  student: {
    findUnique: vi.fn(async ({ where }: any) => {
      const s = db.students.find((st) => st.id === where.id);
      if (!s) return null;
      return {
        ...s,
        classGroup: db.classGroups.find((c) => c.id === s.classGroupId) || { name: "Turma" },
      };
    }),
    findMany: vi.fn(async ({ where }: any = {}) =>
      db.students
        .filter((s) => matchFilter(s, where))
        .map((s) => ({
          ...s,
          classGroup: db.classGroups.find((c) => c.id === s.classGroupId) || { name: "Turma" },
          _count: { messageLogs: 0 },
        }))
    ),
    create: vi.fn(async ({ data }: any) => {
      const created = { id: `st-${db.students.length + 1}`, active: true, ...data };
      db.students.push(created);
      return {
        ...created,
        classGroup: db.classGroups.find((c) => c.id === created.classGroupId) || { name: "Turma" },
      };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      let count = 0;
      for (const row of data) {
        if (row.cgm && db.students.some((s) => s.cgm === row.cgm)) continue;
        db.students.push({ id: `st-${db.students.length + 1}`, ...row });
        count++;
      }
      return { count };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const idx = db.students.findIndex((s) => s.id === where.id);
      db.students[idx] = { ...db.students[idx], ...data };
      return {
        ...db.students[idx],
        classGroup: db.classGroups.find((c) => c.id === db.students[idx].classGroupId) || { name: "Turma" },
      };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      db.students = db.students.map((s) => {
        if (matchFilter(s, where)) {
          count++;
          return { ...s, ...data };
        }
        return s;
      });
      return { count };
    }),
  },
  pedagogicalMinute: {
    findUnique: vi.fn(async ({ where }: any) => {
      const m = db.minutes.find((x) => x.id === where.id);
      if (!m) return null;
      return {
        ...m,
        school: db.schools.find((s) => s.id === m.schoolId) || null,
        students: db.minuteStudents.filter((ms) => ms.minuteId === m.id),
        participants: [],
        addendums: db.addendums.filter((a) => a.minuteId === m.id),
        actionItems: [],
      };
    }),
    create: vi.fn(async ({ data }: any) => {
      const created = {
        id: `ata-${db.minutes.length + 1}`,
        schoolId: data.schoolId,
        year: data.year,
        status: data.status,
        subject: data.subject,
        summary: data.summary,
      };
      db.minutes.push(created);
      if (data.students?.create) {
        for (const s of data.students.create) {
          db.minuteStudents.push({ minuteId: created.id, ...s });
        }
      }
      return { ...created, students: data.students?.create || [], participants: [], actionItems: [] };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const idx = db.minutes.findIndex((x) => x.id === where.id);
      db.minutes[idx] = { ...db.minutes[idx], ...data };
      return db.minutes[idx];
    }),
    delete: vi.fn(async ({ where }: any) => {
      const idx = db.minutes.findIndex((x) => x.id === where.id);
      const [removed] = db.minutes.splice(idx, 1);
      return removed;
    }),
  },
  pedagogicalMinuteStudent: {
    deleteMany: vi.fn(async ({ where }: any) => {
      db.minuteStudents = db.minuteStudents.filter((ms) => ms.minuteId !== where.minuteId);
      return { count: 1 };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      db.minuteStudents.push(...data);
      return { count: data.length };
    }),
  },
  pedagogicalMinuteParticipant: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 0 })),
  },
  pedagogicalMinuteAction: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 0 })),
  },
  pedagogicalMinuteAddendum: {
    create: vi.fn(async ({ data }: any) => {
      const created = { id: `add-${db.addendums.length + 1}`, ...data };
      db.addendums.push(created);
      return created;
    }),
  },
  messageLog: {
    findUnique: vi.fn(async ({ where }: any) => {
      const m = db.messageLogs.find((x) => x.id === where.id);
      if (!m) return null;
      const st = db.students.find((s) => s.id === m.studentId);
      return {
        ...m,
        student: st
          ? { ...st, classGroup: db.classGroups.find((c) => c.id === st.classGroupId) || { name: "Turma" } }
          : null,
      };
    }),
    create: vi.fn(async ({ data }: any) => {
      const created = { id: `msg-${db.messageLogs.length + 1}`, ...data };
      db.messageLogs.push(created);
      return created;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const idx = db.messageLogs.findIndex((x) => x.id === where.id);
      db.messageLogs[idx] = { ...db.messageLogs[idx], ...data };
      const st = db.students.find((s) => s.id === db.messageLogs[idx].studentId)!;
      return { ...db.messageLogs[idx], student: { ...st, classGroup: { name: "Turma" } } };
    }),
    delete: vi.fn(async ({ where }: any) => {
      const idx = db.messageLogs.findIndex((x) => x.id === where.id);
      const [removed] = db.messageLogs.splice(idx, 1);
      return removed;
    }),
  },
  messageTemplate: {
    findUnique: vi.fn(async ({ where }: any) => db.templates.find((t) => t.id === where.id) || null),
  },
  absenceJustification: {
    findUnique: vi.fn(async ({ where }: any) => {
      const j = db.justifications.find((x) => x.id === where.id);
      if (!j) return null;
      const st = db.students.find((s) => s.id === j.studentId)!;
      return { ...j, student: { id: st.id, name: st.name, schoolId: st.schoolId } };
    }),
    findMany: vi.fn(async () => []),
    delete: vi.fn(async ({ where }: any) => {
      const idx = db.justifications.findIndex((x) => x.id === where.id);
      const [removed] = db.justifications.splice(idx, 1);
      return removed;
    }),
  },
  studentContact: {
    findMany: vi.fn(async () => []),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => {
      const u = db.users.find((x) => (where.id && x.id === where.id) || (where.email && x.email === where.email));
      if (!u) return null;
      return {
        ...u,
        schools: db.userSchools.filter((us) => us.userId === u.id),
      };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const idx = db.users.findIndex((x) => x.id === where.id);
      db.users[idx] = { ...db.users[idx], ...data };
      return { ...db.users[idx], schools: [], _count: { messageLogs: 0, repliedLogs: 0 } };
    }),
  },
  userSchool: {
    upsert: vi.fn(async () => ({})),
  },
  auditLog: {
    create: vi.fn(async ({ data }: any) => {
      const created = { id: `audit-${db.auditLogs.length + 1}`, createdAt: new Date(), ...data };
      db.auditLogs.push(created);
      return created;
    }),
    findMany: vi.fn(async ({ where }: any = {}) =>
      db.auditLogs.filter((l) => matchFilter(l, where))
    ),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        return hoisted.state.prisma[prop];
      },
    }
  ),
}));

hoisted.state.prisma = prismaMock;

// Import route handlers AFTER mocks
import { GET as getAtaById, PATCH as patchAtaById, DELETE as deleteAtaById } from "@/app/api/atas/[id]/route";
import { POST as postAtaAddendum } from "@/app/api/atas/[id]/addendums/route";
import { POST as postAtaVoid } from "@/app/api/atas/[id]/void/route";
import { PUT as putMessageManage, DELETE as deleteMessageManage } from "@/app/api/messages/manage/route";
import { DELETE as deleteJustificationById } from "@/app/api/justifications/[id]/route";
import { POST as postAta } from "@/app/api/atas/route";
import { POST as postClass } from "@/app/api/classes/route";
import { POST as postStudentsImport } from "@/app/api/students/import/route";
import { POST as postStudent } from "@/app/api/students/route";
import { POST as postMessageSend } from "@/app/api/messages/send/route";
import { PUT as putUser } from "@/app/api/users/route";
import { sanitizeCsvField } from "@/lib/csvSanitizer";
import AuditoriaPage from "@/app/auditoria/page";
import AtaPrintPage from "@/app/atas/[id]/imprimir/page";

describe("Suíte Adversarial Integrada Multi-Tenant & RBAC (7 Vetores)", () => {
  beforeEach(() => {
    resetDb();
    hoisted.state.currentSession = authContextSchoolA;
    hoisted.state.cookieJar = {};
  });

  // ==========================================================================
  // VETOR 1: BOLA / IDOR em Recursos de Documentos e Mensagens
  // ==========================================================================
  describe("Vetor 1: BOLA / IDOR", () => {
    it("1.1 bloqueia PATCH, DELETE e GET em /api/atas/[id] da escola-b", async () => {
      const getRes = await getAtaById(
        new Request("http://localhost:3000/api/atas/ata-draft-b"),
        { params: Promise.resolve({ id: "ata-draft-b" }) }
      );
      expect(getRes.status).toBe(403);
      const getBody = await getRes.json();
      expect(getBody.minute).toBeUndefined();

      const patchRes = await patchAtaById(
        new Request("http://localhost:3000/api/atas/ata-draft-b", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: "Adulterado pelo Atacante" }),
        }),
        { params: Promise.resolve({ id: "ata-draft-b" }) }
      );
      expect(patchRes.status).toBe(403);
      expect(db.minutes.find((m) => m.id === "ata-draft-b")?.subject).toBe("Atendimento Sigiloso Escola B");

      const delRes = await deleteAtaById(
        new Request("http://localhost:3000/api/atas/ata-draft-b", { method: "DELETE" }),
        { params: Promise.resolve({ id: "ata-draft-b" }) }
      );
      expect(delRes.status).toBe(403);
      expect(db.minutes.some((m) => m.id === "ata-draft-b")).toBe(true);
    });

    it("1.2 bloqueia POST aditivos e anulações em atas da escola-b", async () => {
      const addRes = await postAtaAddendum(
        new Request("http://localhost:3000/api/atas/ata-final-b/addendums", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Termo aditivo malicioso inserido pelo Tenant A" }),
        }),
        { params: Promise.resolve({ id: "ata-final-b" }) }
      );
      expect(addRes.status).toBe(403);
      expect(db.addendums).toHaveLength(0);

      const voidRes = await postAtaVoid(
        new Request("http://localhost:3000/api/atas/ata-final-b/void", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Cancelamento malicioso de ata oficial da Escola B" }),
        }),
        { params: Promise.resolve({ id: "ata-final-b" }) }
      );
      expect(voidRes.status).toBe(403);
      expect(db.minutes.find((m) => m.id === "ata-final-b")?.status).toBe("FINALIZED");
    });

    it("1.3 bloqueia PUT/DELETE de mensagens e DELETE de justificativas da escola-b", async () => {
      const putMsg = await putMessageManage(
        new Request("http://localhost:3000/api/messages/manage", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "msg-b1", messageContent: "Adulterado" }),
        })
      );
      expect(putMsg.status).toBe(403);
      expect(db.messageLogs[0].messageContent).toBe("Mensagem privada da Escola B");

      const delMsg = await deleteMessageManage(
        new Request("http://localhost:3000/api/messages/manage?id=msg-b1", { method: "DELETE" })
      );
      expect(delMsg.status).toBe(403);
      expect(db.messageLogs).toHaveLength(1);

      const delJust = await deleteJustificationById(
        new Request("http://localhost:3000/api/justifications/just-b1", { method: "DELETE" }),
        { params: Promise.resolve({ id: "just-b1" }) }
      );
      expect(delJust.status).toBe(403);
      expect(db.justifications).toHaveLength(1);
    });

    it("1.4 [BLOQUEADO] Cookie Spoofing em active_school_id é desconsiderado e bloqueia acesso com 403 Forbidden", async () => {
      // Atacante autenticado na escola-a injeta cookie não-autorizado active_school_id=escola-b
      hoisted.state.cookieJar = { active_school_id: "escola-b" };
      const getRes = await getAtaById(
        new Request("http://localhost:3000/api/atas/ata-draft-b"),
        { params: Promise.resolve({ id: "ata-draft-b" }) }
      );
      // O cookie forjado é ignorado, a sessão permanece escola-a e o acesso à ata da escola-b é rejeitado com 403
      expect(getRes.status).toBe(403);
      const payload = await getRes.json();
      expect(payload.minute).toBeUndefined();
    });

    it("1.5 [BLOQUEADO] SSR /atas/[id]/imprimir bloqueia acesso não autenticado e cross-tenant", async () => {
      // 1. Acesso anônimo: redireciona para login
      hoisted.state.currentSession = null;
      await expect(
        AtaPrintPage({ params: Promise.resolve({ id: "ata-final-b" }) })
      ).rejects.toThrow("NEXT_REDIRECT:/login");

      // 2. Acesso cross-tenant: usuário da escola-a tenta imprimir ata da escola-b -> bloqueado com notFound
      hoisted.state.currentSession = authContextSchoolA;
      await expect(
        AtaPrintPage({ params: Promise.resolve({ id: "ata-final-b" }) })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      // 3. Acesso autorizado: gestor da escola-b acessa ata da própria instituição
      hoisted.state.currentSession = authContextSchoolB;
      const element: any = await AtaPrintPage({ params: Promise.resolve({ id: "ata-final-b" }) });
      expect(element.props.minute.schoolId).toBe("escola-b");
      expect(element.props.minute.summary).toBe("Conteúdo oficial imutável Escola B");
    });
  });

  // ==========================================================================
  // VETOR 2: Tenant Context Leakage & Parameter Spoofing
  // ==========================================================================
  describe("Vetor 2: Parameter Spoofing", () => {
    it("2.1 ignora schoolId='escola-b' no JSON body de POST /api/atas e POST /api/classes", async () => {
      const ataRes = await postAta(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schoolId: "escola-b",
            subject: "Ata Teste Spoofing",
            studentIds: ["aluno-a1"],
            participants: [{ name: "Gestor A", role: "GESTOR_ESCOLAR" }],
          }),
        })
      );
      expect([200, 201]).toContain(ataRes.status);
      const createdAta = db.minutes[db.minutes.length - 1];
      expect(createdAta.schoolId).toBe("escola-a");

      const classRes = await postClass(
        new Request("http://localhost:3000/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schoolId: "escola-b",
            name: "8º Ano Z Spoof",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
          }),
        })
      );
      expect([200, 201]).toContain(classRes.status);
      const createdClass = db.classGroups[db.classGroups.length - 1];
      expect(createdClass.schoolId).toBe("escola-a");
    });

    it("2.2 [BLOQUEADO] Cookie active_school_id='escola-b' forjado é ignorado e turma é criada na escola autorizada", async () => {
      hoisted.state.cookieJar = { active_school_id: "escola-b" };
      const classRes = await postClass(
        new Request("http://localhost:3000/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Turma Injetada via Cookie",
            segment: "FUNDAMENTAL",
            shift: "TARDE",
          }),
        })
      );
      expect([200, 201]).toContain(classRes.status);
      const createdClass = db.classGroups[db.classGroups.length - 1];
      expect(createdClass.schoolId).toBe("escola-a");
      expect(createdClass.schoolId).not.toBe("escola-b");
    });
  });

  // ==========================================================================
  // VETOR 3: Mass Operations & Importação SERE Cross-Tenant
  // ==========================================================================
  describe("Vetor 3: Importação SERE Cross-Tenant", () => {
    it("3.1 [BLOQUEADO] Importação SERE bloqueia updateSchoolInfo sem SuperAdmin (403) e isola dados sem vazar escola sede", async () => {
      // 1. Bloqueia updateSchoolInfo por não-superadmin com 403 Forbidden
      const forbiddenRes = await postStudentsImport(
        new Request("http://localhost:3000/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turmas: [{ tempId: "t1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }],
            students: [
              {
                turmaTempId: "t1",
                name: "Aluno Tentativa Update School",
              },
            ],
            options: {
              updateExisting: true,
              updateSchoolInfo: true,
              schoolInfo: { name: "Escola Hackeada", city: "Outra" },
            },
          }),
        })
      );
      expect(forbiddenRes.status).toBe(403);
      const forbiddenBody = await forbiddenRes.json();
      expect(forbiddenBody.error).toContain("Apenas administradores globais");
      expect(db.schools.find((s) => s.id === "escola-a")?.name).toBe("Escola Estadual Alpha");

      // 2. Importação autorizada sem updateSchoolInfo protege estudantes de outras escolas e não vaza escola piloto
      const importRes = await postStudentsImport(
        new Request("http://localhost:3000/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turmas: [{ tempId: "t1", name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }],
            students: [
              {
                turmaTempId: "t1",
                cgm: "20000002", // CGM do aluno-b1 (Escola B)
                name: "ALUNO BETA SOBRESCRITO",
                phone: "41911112222",
              },
            ],
            transferredStudents: [{ cgm: "20000002", name: "ALUNO BETA VITIMA" }],
            options: {
              updateExisting: true,
              deactivateTransferred: true,
              updateSchoolInfo: false,
            },
          }),
        })
      );
      expect(importRes.status).toBe(200);

      // Aluno da Escola B permanece intacto
      const victimB = db.students.find((s) => s.id === "aluno-b1")!;
      expect(victimB.schoolId).toBe("escola-b");
      expect(victimB.name).toBe("ALUNO BETA VITIMA");
      expect(victimB.active).toBe(true);

      // freshStudents e classGroups contêm 0 vazamentos da escola piloto default-leopoldina
      const body = await importRes.json();
      const leakedLeopoldinaStudents = (body.students || []).filter(
        (s: any) => s.schoolId === "default-leopoldina"
      );
      const leakedLeopoldinaClasses = (body.classGroups || []).filter(
        (c: any) => c.schoolId === "default-leopoldina"
      );
      expect(leakedLeopoldinaStudents).toHaveLength(0);
      expect(leakedLeopoldinaClasses).toHaveLength(0);
    });
  });

  // ==========================================================================
  // VETOR 4: Cross-Tenant Relation Traversal
  // ==========================================================================
  describe("Vetor 4: Cross-Tenant FK Traversal", () => {
    it("4.1 bloqueia POST /api/students com classGroupId da escola-b (400), POST /api/atas misto (400) e POST /api/messages/send com templateId da escola-b (403)", async () => {
      const stRes = await postStudent(
        new Request("http://localhost:3000/api/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Aluno Cruzado",
            phone: "41988887777",
            classGroupId: "turma-b1",
          }),
        })
      );
      expect(stRes.status).toBe(400);
      expect(db.students.some((s) => s.name === "ALUNO CRUZADO")).toBe(false);

      const ataRes = await postAta(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: "Ata Mista Cross-Tenant",
            studentIds: ["aluno-a1", "aluno-b1"],
            participants: [{ name: "Gestor A", role: "GESTOR_ESCOLAR" }],
          }),
        })
      );
      expect(ataRes.status).toBe(400);

      const msgRes = await postMessageSend(
        new Request("http://localhost:3000/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "aluno-a1",
            templateId: "tpl-privado-b",
            reasonTitle: "Falta",
            messageContent: "Teste com template alheio",
          }),
        })
      );
      expect(msgRes.status).toBe(403);
      expect(db.messageLogs).toHaveLength(1); // Nenhum novo log criado
    });

    it("4.2 [BLOQUEADO] PATCH /api/atas/[id] rejeita vincular studentIds da escola-b com 400 Bad Request", async () => {
      const patchRes = await patchAtaById(
        new Request("http://localhost:3000/api/atas/ata-draft-a", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentIds: ["aluno-a1", "aluno-b1"],
          }),
        }),
        { params: Promise.resolve({ id: "ata-draft-a" }) }
      );
      expect(patchRes.status).toBe(400);
      const body = await patchRes.json();
      expect(body.error).toContain("não foram encontrados nesta instituição");
      expect(db.minuteStudents.some((ms) => ms.minuteId === "ata-draft-a" && ms.studentId === "aluno-b1")).toBe(false);
    });

    it("4.3 [BLOQUEADO] POST /api/students na escola-a rejeita sequestrar turma legada (schoolId=null) com 400 Bad Request", async () => {
      const stRes = await postStudent(
        new Request("http://localhost:3000/api/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Aluno Invasor Turma Legada",
            phone: "41988886666",
            classGroupId: "turma-legada-null",
          }),
        })
      );
      expect(stRes.status).toBe(400);
      const body = await stRes.json();
      expect(body.error.toLowerCase()).toContain("turma");
      expect(db.classGroups.find((c) => c.id === "turma-legada-null")?.schoolId).toBeNull();
    });
  });

  // ==========================================================================
  // VETOR 5: Escalação Horizontal e Vertical de Privilégios (RBAC vs Tenant)
  // ==========================================================================
  describe("Vetor 5: Escalação Horizontal e Vertical RBAC", () => {
    it("5.1 bloqueia PUT /api/users para usuário da escola-b (403) e promoção vertical para SUPERADMIN / GESTAO_SECRETARIA / ADMIN (403)", async () => {
      const horizRes = await putUser(
        new Request("http://localhost:3000/api/users", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "user-gestor-b", name: "Hackeado", active: false }),
        })
      );
      expect(horizRes.status).toBe(403);
      expect(db.users.find((u) => u.id === "user-gestor-b")?.active).toBe(true);

      for (const elevatedRole of ["SUPERADMIN", "GESTAO_SECRETARIA", "ADMIN"]) {
        const vertRes = await putUser(
          new Request("http://localhost:3000/api/users", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "user-pedagoga-a", role: elevatedRole }),
          })
        );
        expect(vertRes.status).toBe(403);
        expect(db.users.find((u) => u.id === "user-pedagoga-a")?.role).toBe("PEDAGOGA");
      }
    });
  });

  // ==========================================================================
  // VETOR 6: CSV Injection (Fórmulas Maliciosas em Exportações)
  // ==========================================================================
  describe("Vetor 6: CSV Formula Injection", () => {
    it("6.1 escapa todos os prefixos executáveis com apóstrofo na rotina do FaltasClient", () => {
      const payloads = [
        "=SUM(1+1)",
        "@SUM(1+1)",
        "+cmd|' /C calc'!A0",
        "-2+3+cmd",
        "\t=1+1",
        "\r=1+1",
      ];
      for (const p of payloads) {
        const out = sanitizeCsvField(p);
        expect(out.startsWith("'")).toBe(true);
        expect(out).toBe(`'${p}`);
      }
    });
  });

  // ==========================================================================
  // VETOR 7: Tenant-Blind Logging & Isolamento do Painel de Auditoria
  // ==========================================================================
  describe("Vetor 7: Isolamento do Painel de Auditoria e Tenant-Blind Logging", () => {
    it("7.1 [BLOQUEADO] Grava schoolId na raiz de CREATE_CLASS_GROUP e isola painel de auditoria da escola sede", async () => {
      // Mutações na escola-a
      hoisted.state.currentSession = authContextSchoolA;
      await postStudent(
        new Request("http://localhost:3000/api/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Aluno A Novo", phone: "41999991111", classGroupId: "turma-a1" }),
        })
      );
      await postClass(
        new Request("http://localhost:3000/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "7º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" }),
        })
      );

      // Mutações na escola-b
      hoisted.state.currentSession = authContextSchoolB;
      await postStudent(
        new Request("http://localhost:3000/api/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Aluno B Secreto", phone: "41999992222", classGroupId: "turma-b1" }),
        })
      );
      await postClass(
        new Request("http://localhost:3000/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Turma Secreta B", segment: "FUNDAMENTAL", shift: "TARDE" }),
        })
      );

      // CREATE_CLASS_GROUP da escola-b foi registrado com schoolId: 'escola-b'
      const auditLogB = db.auditLogs.find((l) => l.details?.includes("Turma Secreta B"));
      expect(auditLogB).toBeDefined();
      expect(auditLogB?.schoolId).toBe("escola-b");

      // Gestor da Escola A acessa /auditoria
      hoisted.state.currentSession = authContextSchoolA;
      const pageA: any = await AuditoriaPage();
      const logsForA = pageA.props.initialLogs;
      expect(logsForA.every((l: any) => l.schoolId === "escola-a")).toBe(true);
      expect(logsForA.some((l: any) => l.details?.includes("Aluno B Secreto"))).toBe(false);
      // CREATE_CLASS_GROUP da escola-a agora possui schoolId='escola-a' e aparece no painel da escola-a
      expect(logsForA.some((l: any) => l.action === "CREATE_CLASS_GROUP")).toBe(true);

      // Gestor da Escola Sede (Leopoldina) acessa /auditoria -> zero eventos vazam da escola-b
      hoisted.state.currentSession = authContextLeopoldina;
      const pageLeo: any = await AuditoriaPage();
      const logsForLeo = pageLeo.props.initialLogs;
      expect(logsForLeo.some((l: any) => l.details?.includes("Turma Secreta B"))).toBe(false);
      expect(logsForLeo.some((l: any) => l.schoolId === "escola-b")).toBe(false);
    });
  });
});
