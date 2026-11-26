import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const hoisted = vi.hoisted(() => ({
  auth: vi.fn(),
  cookiesMap: new Map<string, string>(),
  generateContentMock: vi.fn(),
  interactionsCreateMock: vi.fn(),
  googleGenAIConstructorCalls: [] as any[],
  auditPayloads: [] as any[],
  minuteQuerySelects: [] as string[][],
  minuteQueryWheres: [] as any[],
  minuteQueryCallCount: 0,
  ignorePinnedMinuteWhere: false,
  onMinuteQuery: null as null | ((callIndex: number, where: any, select: any) => void),
  transactionOptions: [] as any[],
  failTransactionWithError: null as any,
  failNextAuditCreate: false,
  auditFailureMessage: "Simulated AuditLog persistence error",
  schoolUpdateManyCalls: [] as Array<{ where: any; data: any; count: number }>,
  onBeforeSchoolUpdateMany: null as null | (() => void),
  onSchoolFindUnique: null as null | ((callIndex: number, schoolId: string) => void),
  schoolFindUniqueCallCount: 0,
  state: {
    schools: [] as any[],
    users: [] as any[],
    userSchools: [] as any[],
    students: [] as any[],
    atas: [] as any[],
    messageLogs: [] as any[],
    auditLogs: [] as any[],
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (k: string) =>
      hoisted.cookiesMap.has(k) ? { value: hoisted.cookiesMap.get(k) } : undefined,
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => hoisted.auth(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: (...args: any[]) => hoisted.generateContentMock(...args),
    };
    interactions = {
      create: (...args: any[]) => hoisted.interactionsCreateMock(...args),
    };
    constructor(opts: any) {
      hoisted.googleGenAIConstructorCalls.push(opts);
    }
  },
}));

vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
  RATE_LIMIT_POLICIES: {
    AI_ENDPOINT: { key: "ai", max: 100, windowSeconds: 60 },
    MESSAGE_REPLY: { key: "reply", max: 100, windowSeconds: 60 },
  },
}));

vi.mock("@/lib/prisma", () => {
  const projectMinute = (record: any, select?: Record<string, any>) => {
    if (!record) return null;
    if (!select) return record;
    const out: Record<string, any> = {};
    for (const key of Object.keys(select)) {
      if (select[key]) {
        out[key] = record[key];
      }
    }
    return out;
  };

  const runMinuteQuery = (where: any, select: any) => {
    hoisted.minuteQueryCallCount += 1;
    hoisted.minuteQuerySelects.push(select ? Object.keys(select) : []);
    hoisted.minuteQueryWheres.push(where ? { ...where } : {});
    if (hoisted.onMinuteQuery) {
      hoisted.onMinuteQuery(hoisted.minuteQueryCallCount, where, select);
    }
    const rec =
      hoisted.state.atas.find((a) => {
        if (where?.id !== undefined && a.id !== where.id) return false;
        if (where?.schoolId !== undefined && a.schoolId !== where.schoolId) return false;
        if (hoisted.ignorePinnedMinuteWhere) return true;
        if (where?.status !== undefined && a.status !== where.status) return false;
        if (
          where?.isConfidential !== undefined &&
          Boolean(a.isConfidential) !== Boolean(where.isConfidential)
        ) {
          return false;
        }
        if (where?.authorId !== undefined && (a.authorId ?? null) !== where.authorId) {
          return false;
        }
        if (where?.authorEmail !== undefined && (a.authorEmail ?? null) !== where.authorEmail) {
          return false;
        }
        if (where?.updatedAt !== undefined) {
          const expectedMs =
            where.updatedAt instanceof Date
              ? where.updatedAt.getTime()
              : new Date(where.updatedAt).getTime();
          const actualMs = a.updatedAt ? new Date(a.updatedAt).getTime() : NaN;
          if (!Number.isFinite(actualMs) || actualMs !== expectedMs) {
            return false;
          }
        }
        return true;
      }) || null;
    return projectMinute(rec, select);
  };

  const mockPrisma: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        const user = hoisted.state.users.find(
          (u) => (where?.email && u.email === where.email) || (where?.id && u.id === where.id)
        );
        if (!user) return null;
        const schools = hoisted.state.userSchools
          .filter((l) => l.userId === user.id && l.active)
          .map((l) => ({
            ...l,
            school: hoisted.state.schools.find((s) => s.id === l.schoolId),
          }))
          .filter((l) => l.school?.active);
        return { ...user, schools, networks: [] };
      }),
    },
    school: {
      findMany: vi.fn(async () => hoisted.state.schools),
      findUnique: vi.fn(async ({ where }: any) => {
        hoisted.schoolFindUniqueCallCount += 1;
        if (where?.id && hoisted.onSchoolFindUnique) {
          hoisted.onSchoolFindUnique(hoisted.schoolFindUniqueCallCount, where.id);
        }
        return hoisted.state.schools.find((s) => s.id === where?.id) || null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          hoisted.state.schools.find(
            (s) =>
              (!where?.inepCode || s.inepCode === where.inepCode) &&
              (!where?.id?.not || s.id !== where.id.not) &&
              (!where?.networkId || s.networkId === where.networkId) &&
              (where?.active === undefined || s.active === where.active)
          ) || null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = {
          id: data.id || `school-${hoisted.state.schools.length + 1}`,
          ...data,
          createdAt: new Date("2026-11-23T12:00:00Z"),
          updatedAt: new Date("2026-11-23T12:00:00Z"),
        };
        hoisted.state.schools.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const s = hoisted.state.schools.find((x) => x.id === where?.id);
        if (!s) throw new Error("School not found");
        Object.assign(s, data, { updatedAt: data.updatedAt || new Date(Date.now() + 10) });
        return s;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (hoisted.onBeforeSchoolUpdateMany) {
          const cb = hoisted.onBeforeSchoolUpdateMany;
          hoisted.onBeforeSchoolUpdateMany = null;
          cb();
        }
        const s = hoisted.state.schools.find((x) => x.id === where?.id);
        if (!s) {
          hoisted.schoolUpdateManyCalls.push({ where, data, count: 0 });
          return { count: 0 };
        }
        const currentSettings = s.settingsJson ?? null;
        const expectedSettings =
          where?.settingsJson === undefined ? currentSettings : where.settingsJson;
        const settingsMatch = currentSettings === expectedSettings;
        const updatedAtMatch =
          !where?.updatedAt ||
          new Date(s.updatedAt).getTime() === new Date(where.updatedAt).getTime();

        if (!settingsMatch || !updatedAtMatch) {
          hoisted.schoolUpdateManyCalls.push({ where, data, count: 0 });
          return { count: 0 };
        }

        Object.assign(s, data, {
          updatedAt: data.updatedAt || new Date(new Date(s.updatedAt).getTime() + 1),
        });
        hoisted.schoolUpdateManyCalls.push({ where, data, count: 1 });
        return { count: 1 };
      }),
    },
    userSchool: {
      upsert: vi.fn(async ({ create, update }: any) => ({ ...create, ...update })),
    },
    messageTemplate: {
      create: vi.fn(async ({ data }: any) => ({ id: `tpl-${Date.now()}`, ...data })),
    },
    student: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids = where?.id?.in;
        return hoisted.state.students.filter(
          (st) =>
            (!where?.schoolId || st.schoolId === where.schoolId) &&
            (!Array.isArray(ids) || ids.includes(st.id))
        );
      }),
    },
    pedagogicalMinute: {
      findUnique: vi.fn(async ({ where, select }: any) => runMinuteQuery(where, select)),
      findFirst: vi.fn(async ({ where, select }: any) => runMinuteQuery(where, select)),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        if (hoisted.failNextAuditCreate) {
          hoisted.failNextAuditCreate = false;
          throw new Error(hoisted.auditFailureMessage || "AuditLog failure");
        }
        let parsedDetails = data.details;
        if (typeof data.details === "string") {
          try {
            parsedDetails = JSON.parse(data.details);
          } catch {
            parsedDetails = data.details;
          }
        }
        const rawEntry = {
          id: `audit-${hoisted.state.auditLogs.length + 1}`,
          ...data,
          createdAt: new Date("2026-11-23T12:00:00Z"),
        };
        const inspectedEntry = {
          ...rawEntry,
          details: parsedDetails,
        };
        hoisted.state.auditLogs.push(rawEntry);
        hoisted.auditPayloads.push(inspectedEntry);
        return rawEntry;
      }),
    },
    messageLog: {
      findUnique: vi.fn(async ({ where }: any) => {
        return hoisted.state.messageLogs.find((m) => m.id === where?.id) || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = hoisted.state.messageLogs.find((m) => m.id === where?.id);
        Object.assign(row, data);
        return row;
      }),
    },
    studentContact: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (arg: any, opts?: any) => {
      hoisted.transactionOptions.push(opts ?? null);
      if (hoisted.failTransactionWithError) {
        const err = hoisted.failTransactionWithError;
        hoisted.failTransactionWithError = null;
        throw err;
      }
      const snapshot = {
        schools: hoisted.state.schools.map((s: any) => ({
          ...s,
          updatedAt: s.updatedAt ? new Date(s.updatedAt.getTime()) : s.updatedAt,
          createdAt: s.createdAt ? new Date(s.createdAt.getTime()) : s.createdAt,
        })),
        auditLogs: [...hoisted.state.auditLogs],
        auditPayloads: [...hoisted.auditPayloads],
      };
      try {
        if (typeof arg === "function") {
          return await arg(mockPrisma);
        }
        if (Array.isArray(arg)) {
          return await Promise.all(arg);
        }
        return arg;
      } catch (err) {
        hoisted.state.schools = snapshot.schools;
        hoisted.state.auditLogs = snapshot.auditLogs;
        hoisted.auditPayloads = snapshot.auditPayloads;
        throw err;
      }
    }),
  };

  return { prisma: mockPrisma };
});

import { POST as formalizeAtaPost } from "@/app/api/ai/formalize-ata/route";
import { POST as classifyReplyPost } from "@/app/api/ai/classify-reply/route";
import { POST as messagesReplyPost } from "@/app/api/messages/reply/route";
import { POST as generateTemplatePost } from "@/app/api/ai/generate-template/route";
import { GET as testKeyGet, POST as testKeyPost } from "@/app/api/ai/test-key/route";
import { POST as createSchoolPost } from "@/app/api/schools/route";
import { PUT as putSchoolById } from "@/app/api/schools/[id]/route";
import { GET as getSchoolAiPolicy, PATCH as patchSchoolAiPolicy } from "@/app/api/schools/[id]/ai-policy/route";
import { POST as rotateSyncTokenPost, DELETE as revokeSyncTokenDelete } from "@/app/api/schools/[id]/sync-token/route";
import { verifyMessageIntegrity } from "@/lib/messageCrypto";
import {
  computeLegacyAiPolicyTransition,
  parseLegacyAllowedSchoolIdsForTransition,
  parseSchoolAiExternalFormalizeFlag,
} from "@/lib/aiPolicy";
import { transitionSchoolAiPoliciesToPanelControl } from "@/services/aiPolicyTransitionService";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

describe("Fase 01 — F04 IA Externa Exclusiva para Formalização da Escola Piloto & Fluxo Local WhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FORCE_STRICT_DB_AUTH = "true";
    process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";
    process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = "default-leopoldina";
    process.env.GEMINI_API_KEY = "AIzaSyntheticServerKeyOnlyForTest123";
    hoisted.cookiesMap.clear();
    hoisted.googleGenAIConstructorCalls = [];
    hoisted.auditPayloads = [];
    hoisted.minuteQuerySelects = [];
    hoisted.minuteQueryWheres = [];
    hoisted.minuteQueryCallCount = 0;
    hoisted.ignorePinnedMinuteWhere = false;
    hoisted.onMinuteQuery = null;
    hoisted.failNextAuditCreate = false;
    hoisted.schoolUpdateManyCalls = [];
    hoisted.onBeforeSchoolUpdateMany = null;
    hoisted.onSchoolFindUnique = null;
    hoisted.schoolFindUniqueCallCount = 0;

    hoisted.state = {
      schools: [
        {
          id: "default-leopoldina",
          inepCode: "41042730",
          name: "Escola Piloto Sintética",
          city: "Ponta Grossa",
          state: "PR",
          nre: "Ponta Grossa",
          network: "ESTADUAL",
          networkId: null,
          active: true,
          syncTokenHash: null,
          settingsJson: JSON.stringify({
            edition: "PILOTO_INTEGRADA",
            aiExternalFormalizeEnabled: true,
            aiExternalFormalizePolicyVersion: 2,
          }),
          updatedAt: new Date("2026-11-23T10:00:00.000Z"),
        },
        {
          id: "school-nova-b",
          inepCode: "41099988",
          name: "Escola Municipal B",
          city: "Tibagi",
          state: "PR",
          nre: "Telêmaco Borba",
          network: "MUNICIPAL",
          networkId: "net-tibagi",
          active: true,
          syncTokenHash: null,
          settingsJson: null,
          updatedAt: new Date("2026-11-23T10:00:00.000Z"),
        },
      ],
      users: [
        {
          id: "usr-ped",
          email: "pedagoga.piloto@escola.pr.gov.br",
          name: "Pedagoga Piloto",
          role: "PEDAGOGA",
          active: true,
          schoolId: "default-leopoldina",
        },
        {
          id: "usr-docente",
          email: "docente@escola.pr.gov.br",
          name: "Docente Sem Permissão",
          role: "DOCENTE",
          active: true,
          schoolId: "default-leopoldina",
        },
      ],
      userSchools: [
        { userId: "usr-ped", schoolId: "default-leopoldina", role: "PEDAGOGA", active: true },
        { userId: "usr-ped", schoolId: "school-nova-b", role: "PEDAGOGA", active: true },
        { userId: "usr-docente", schoolId: "default-leopoldina", role: "DOCENTE", active: true },
      ],
      students: [
        { id: "stu-a-1", name: "Ana Paula Oliveira", schoolId: "default-leopoldina" },
        { id: "stu-sig-1", name: "Estudante Sigiloso Teste", schoolId: "default-leopoldina" },
        { id: "stu-b-1", name: "Estudante Escola B", schoolId: "school-nova-b" },
      ],
      atas: [
        {
          id: "ata-sigilosa",
          schoolId: "default-leopoldina",
          status: "DRAFT",
          isConfidential: true,
          category: "SAUDE_VULNERABILIDADE",
          authorId: "usr-ped",
          authorEmail: "pedagoga.piloto@escola.pr.gov.br",
          updatedAt: new Date("2026-11-23T10:00:00.000Z"),
          students: [{ student: { id: "stu-sig-1", name: "Estudante Sigiloso Teste" } }],
          participants: [{ name: "Responsável Sigiloso Teste", role: "RESPONSAVEL" }],
        },
      ],
      messageLogs: [
        {
          id: "msg-wa-1",
          studentId: "stu-wa-1",
          phoneUsed: "42999990000",
          reasonTitle: "Faltas Consecutivas",
          messageContent: "Olá, notamos faltas.",
          sentByName: "Pedagoga Piloto",
          sentAt: new Date("2026-11-20T14:00:00Z"),
          guardianReplied: false,
          replyNotes: null,
          replyCategory: null,
          deliveryStatus: "SENT",
          student: {
            id: "stu-wa-1",
            name: "Gabriel Mendes Souza",
            guardianName: "Marcos Mendes",
            schoolId: "default-leopoldina",
          },
        },
      ],
      auditLogs: [],
    };

    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-ped",
        email: "pedagoga.piloto@escola.pr.gov.br",
        name: "Pedagoga Piloto",
        role: "PEDAGOGA",
        schoolId: "default-leopoldina",
      },
    });
  });

  it("escola piloto autorizada: pseudonimiza nomes, datas, anos, horas, CPF/RG/tel/email e restaura minuta sem retornar mapa; fallback usa store:false", async () => {
    hoisted.generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        formalSubject: "Atendimento de [ESTUDANTE_1]",
        formalSummary:
          "[DATA_ATENDIMENTO], às [HORA_ATENDIMENTO], realizou-se atendimento sobre [ESTUDANTE_1] com [RESPONSAVEL_1] e [DOCENTE_1] em [ESCOLA].",
        agreementsSummary: "Acompanhamento de [ESTUDANTE_1].",
        actionItems: [
          {
            description: "Apresentar documento de [ESTUDANTE_1].",
            responsible: "FAMILIA",
            suggestedDaysToComplete: 5,
          },
        ],
      }),
    });

    const req = new Request("http://localhost/api/ai/formalize-ata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isConfidential: false,
        nonConfidentialConfirmed: true,
        ataScope: "STUDENTS",
        rawNotes:
          "Ana Paula Oliveira faltou em 15/09/2026 às 14:30. Mãe Carlos Oliveira (CPF 123.456.789-00, RG 9.888.777-1, email mae@teste.com, tel (42) 99988-7766) conversou com Professora Beatriz na Escola Piloto Sintética.",
        category: "ACOMPANHAMENTO_PEDAGOGICO",
        studentNames: ["Ana Paula Oliveira"],
        guardianNames: ["Carlos Oliveira"],
        teacherNames: ["Professora Beatriz"],
        attendedAt: "2026-09-15T14:30:00-03:00",
      }),
    });

    const res = await formalizeAtaPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("EXTERNAL_AI");
    expect(body.mapping).toBeUndefined();
    expect(body.pseudonymMap).toBeUndefined();
    expect(body.result.formalSummary).toContain("Ana Paula Oliveira");
    expect(body.result.formalSummary).toContain("Carlos Oliveira");
    expect(body.result.formalSummary).toContain("quinze dias do mês de setembro");

    // Inspeciona TUDO que saiu para ai.models.generateContent
    expect(hoisted.generateContentMock).toHaveBeenCalledTimes(1);
    const outbound = JSON.stringify(hoisted.generateContentMock.mock.calls[0][0]);
    for (const leakedToken of [
      "Ana Paula",
      "Carlos Oliveira",
      "Beatriz",
      "Escola Piloto Sintética",
      "15/09/2026",
      "2026-09-15",
      "setembro",
      "2026",
      "14:30",
      "14h30",
      "123.456.789-00",
      "9.888.777-1",
      "mae@teste.com",
      "99988-7766",
    ]) {
      expect(outbound).not.toContain(leakedToken);
    }

    // Testa agora caminho fallback ai.interactions.create e exige store: false
    hoisted.generateContentMock.mockRejectedValue(new Error("temporarily unavailable"));
    hoisted.interactionsCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        formalSubject: "Atendimento de [ESTUDANTE_1]",
        formalSummary: "[DATA_ATENDIMENTO], atendimento com [ESTUDANTE_1].",
        agreementsSummary: "Combinados gerais.",
        actionItems: [{ description: "Retornar em 5 dias", responsible: "FAMILIA", suggestedDaysToComplete: 5 }],
      }),
    });

    const fallbackReq = new Request("http://localhost/api/ai/formalize-ata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isConfidential: false,
        nonConfidentialConfirmed: true,
        ataScope: "STUDENTS",
        rawNotes: "Ana Paula Oliveira compareceu com Carlos Oliveira.",
        category: "ACOMPANHAMENTO_PEDAGOGICO",
        studentNames: ["Ana Paula Oliveira"],
        guardianNames: ["Carlos Oliveira"],
        attendedAt: "2026-09-15T14:30:00-03:00",
      }),
    });

    const fallbackRes = await formalizeAtaPost(fallbackReq);
    expect(fallbackRes.status).toBe(200);
    expect(hoisted.interactionsCreateMock).toHaveBeenCalledTimes(1);
    const interactionArg = hoisted.interactionsCreateMock.mock.calls[0][0];
    const interactionOpts = hoisted.interactionsCreateMock.mock.calls[0][1];
    expect(interactionArg.store).toBe(false);
    expect(interactionOpts).toEqual({ maxRetries: 0 });
    expect(JSON.stringify(interactionArg)).not.toContain("Ana Paula");
    expect(JSON.stringify(interactionArg)).not.toContain("Carlos Oliveira");
    expect(JSON.stringify(interactionArg)).not.toContain("2026");

    // Garante que logs operacionais não contêm prompt nem nomes reais
    expect(JSON.stringify(hoisted.auditPayloads)).not.toContain("Ana Paula");
    expect(JSON.stringify(hoisted.auditPayloads)).not.toContain("123.456.789-00");
  });

  it("outra escola, perfil não autorizado, chave enviada pelo cliente, imagens e conteúdo sigiloso fazem ZERO chamadas externas", async () => {
    // 1. Outra escola (school-nova-b desligada no painel, mesmo se ID constar na antiga AI_FORMALIZE_ALLOWED_SCHOOL_IDS) -> local sem chamar Gemini
    process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = "default-leopoldina,school-nova-b";
    hoisted.cookiesMap.set("active_school_id", "school-nova-b");
    const nonPilotRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-key": "AIzaBrowserKeyMustBeIgnored123456",
        },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Atendimento de rotina sobre frequência.",
          studentNames: ["Aluno B"],
          guardianNames: ["Mãe B"],
          apiKey: "AIzaBrowserBodyKeyMustBeIgnored123",
        }),
      })
    );
    expect(nonPilotRes.status).toBe(200);
    expect((await nonPilotRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // Mesmo sem AI_FORMALIZE_ALLOWED_SCHOOL_IDS, a escola previamente habilitada preserva acesso externo
    delete process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        formalSubject: "Atendimento escolar",
        formalSummary: "[DATA_ATENDIMENTO], atendimento com [ESTUDANTE_1].",
        agreementsSummary: "Acompanhamento de rotina.",
        actionItems: [],
      }),
    });
    const preservedPilotRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Atendimento de rotina escolar para Ana Paula Oliveira.",
          studentNames: ["Ana Paula Oliveira"],
        }),
      })
    );
    expect(preservedPilotRes.status).toBe(200);
    expect((await preservedPilotRes.json()).mode).toBe("EXTERNAL_AI");
    expect(hoisted.generateContentMock).toHaveBeenCalledTimes(1);
    hoisted.generateContentMock.mockClear();

    // 2. Perfil não autorizado (DOCENTE) -> 403
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValueOnce({
      user: { id: "usr-docente", email: "docente@escola.pr.gov.br", role: "DOCENTE" },
    });
    const unauthRoleRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNotes: "Tentativa por docente", studentNames: ["Aluno"] }),
      })
    );
    expect(unauthRoleRes.status).toBe(403);
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // Restauração da pedagoga piloto para testes seguintes
    hoisted.auth.mockResolvedValue({
      user: { id: "usr-ped", email: "pedagoga.piloto@escola.pr.gov.br", role: "PEDAGOGA" },
    });

    // 3. Rejeição de imagem / anexo (400)
    const imgRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawNotes: "Notas",
          screenshotDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        }),
      })
    );
    expect(imgRes.status).toBe(400);
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // 4. Ata sigilosa ou conteúdo sensível de proteção/saúde -> LOCAL_POLICY_GUARD (0 chamadas)
    const confRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minuteId: "ata-sigilosa",
          rawNotes: "Encaminhamento ao Conselho Tutelar e laudo médico CID F84.",
          studentNames: ["Aluno Protegido"],
        }),
      })
    );
    expect(confRes.status).toBe(200);
    expect((await confRes.json()).mode).toBe("LOCAL_POLICY_GUARD");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // 5. Identificador residual não listado nos participantes -> bloqueado pelo inspetor pré-envio
    const residualRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          rawNotes: "Responsável: Maria Joana Aparecida procurou a escola.",
          studentNames: [],
        }),
      })
    );
    expect(residualRes.status).toBe(200);
    expect((await residualRes.json()).mode).toBe("LOCAL_POLICY_GUARD");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // 6. Sem confirmação explícita de sigilo, ou com ata/escola inconfirmáveis -> encaminha para modo local
    const unconfirmedConfRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawNotes: "Atendimento sem sinalização explícita de sigilo.",
          studentNames: ["Aluno Sem Sigilo"],
        }),
      })
    );
    expect(unconfirmedConfRes.status).toBe(200);
    expect((await unconfirmedConfRes.json()).mode).toBe("LOCAL_POLICY_GUARD");

    const missingMinuteRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minuteId: "ata-inexistente",
          isConfidential: false,
          rawNotes: "Atendimento com ata não confirmada no banco.",
          studentNames: ["Aluno A"],
        }),
      })
    );
    expect(missingMinuteRes.status).toBe(404);
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // Se a flag aiExternalFormalizeEnabled da própria escola piloto estiver desligada, permanece local
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: false,
    });
    const disabledByFlagRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          rawNotes: "Atendimento com flag escolar desligada.",
          studentNames: ["Aluno A"],
        }),
      })
    );
    expect(disabledByFlagRes.status).toBe(200);
    expect((await disabledByFlagRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
  });

  it("controle explícito de IA externa por escola em /admin/escolas protege concorrência, audita mudanças e preserva sync-token", async () => {
    const adminEscolasSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/admin/escolas/AdminEscolasClient.tsx"),
      "utf8"
    );
    expect(adminEscolasSrc).toContain("aiExternalFormalizeEnabled: false");
    expect(adminEscolasSrc).toContain("Novas escolas iniciam em modo local");
    expect(adminEscolasSrc).toContain("/ai-policy");

    hoisted.state.users.push(
      {
        id: "usr-gestor",
        email: "gestor@escola.pr.gov.br",
        name: "Diretor",
        role: "GESTOR_ESCOLAR",
        active: true,
        schoolId: "default-leopoldina",
      },
      {
        id: "usr-super",
        email: "superadmin@escola.pr.gov.br",
        name: "SuperAdmin",
        role: "SUPERADMIN",
        active: true,
        schoolId: "default-leopoldina",
      }
    );
    hoisted.state.userSchools.push({
      userId: "usr-gestor",
      schoolId: "default-leopoldina",
      role: "GESTOR_ESCOLAR",
      active: true,
    });

    // 1. Perfil inferior recebe 403 tanto em PATCH /ai-policy quanto em PUT /schools/[id]
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-gestor",
        email: "gestor@escola.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });
    const forbiddenPolicyPatch = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: false,
          expectedUpdatedAt: hoisted.state.schools[0].updatedAt.toISOString(),
          expectedPreviousEnabled: true,
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(forbiddenPolicyPatch.status).toBe(403);

    const forbiddenPutToggle = await putSchoolById(
      new Request("http://localhost/api/schools/default-leopoldina", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiExternalFormalizeEnabled: false }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(forbiddenPutToggle.status).toBe(403);

    // 2. SuperAdmin: novas escolas começam desligadas; tentativa de criar ligada retorna 400
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-super",
        email: "superadmin@escola.pr.gov.br",
        name: "SuperAdmin",
        role: "SUPERADMIN",
        schoolId: "default-leopoldina",
      },
    });
    const rejectCreateEnabledRes = await createSchoolPost(
      new Request("http://localhost/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inepCode: "41099111",
          name: "Escola Nova Bloqueada",
          city: "Tibagi",
          network: "MUNICIPAL",
          aiExternalFormalizeEnabled: true,
        }),
      })
    );
    expect(rejectCreateEnabledRes.status).toBe(400);

    const createNewSchoolRes = await createSchoolPost(
      new Request("http://localhost/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inepCode: "41099222",
          name: "Escola Nova Local Padrão",
          city: "Tibagi",
          network: "MUNICIPAL",
        }),
      })
    );
    expect(createNewSchoolRes.status).toBe(201);
    const createdSchoolJson = await createNewSchoolRes.json();
    expect(createdSchoolJson.school.aiExternalFormalizeEnabled).toBe(false);

    // 3. PUT geral em /api/schools/[id] também recusa alterar aiExternalFormalizeEnabled (400)
    const rejectGeneralPut = await putSchoolById(
      new Request("http://localhost/api/schools/default-leopoldina", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiExternalFormalizeEnabled: false }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(rejectGeneralPut.status).toBe(400);

    // 4. PATCH /ai-policy ativa escola piloto diretamente (sem institutionalAcceptanceConfirmed e sem env allowlist), grava auditoria e bloqueia versão obsoleta (409)
    delete process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
    hoisted.state.schools[0].settingsJson = JSON.stringify({ edition: "PILOTO_INTEGRADA" });
    const staleUpdatedAt = hoisted.state.schools[0].updatedAt.toISOString();
    const superEnableRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: true,
          expectedUpdatedAt: staleUpdatedAt,
          expectedPreviousEnabled: false,
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(superEnableRes.status).toBe(200);
    const superJson = await superEnableRes.json();
    expect(superJson.school.aiExternalFormalizeEnabled).toBe(true);
    expect(superJson.serverAvailability).toEqual(
      expect.objectContaining({
        globalEnabled: true,
        credentialConfigured: true,
        available: true,
      })
    );
    expect(hoisted.auditPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "UPDATE_SCHOOL_AI_POLICY",
          schoolId: "default-leopoldina",
          details: expect.objectContaining({
            schoolId: "default-leopoldina",
            operatorEmail: "superadmin@escola.pr.gov.br",
            previousState: false,
            nextState: true,
            changedAt: expect.any(String),
          }),
        }),
      ])
    );

    // Escola secundária pode ser ligada diretamente pelo painel sem editar env AI_FORMALIZE_ALLOWED_SCHOOL_IDS
    const secondSchoolInitialUpdatedAt = hoisted.state.schools[1].updatedAt.toISOString();
    const enableSecondRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/school-nova-b/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: true,
          expectedUpdatedAt: secondSchoolInitialUpdatedAt,
          expectedPreviousEnabled: false,
        }),
      }),
      { params: Promise.resolve({ id: "school-nova-b" }) }
    );
    expect(enableSecondRes.status).toBe(200);
    const enableSecondJson = await enableSecondRes.json();
    expect(enableSecondJson.school.aiExternalFormalizeEnabled).toBe(true);

    // Desligar escola secundária retorna para modo local
    const disableSecondRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/school-nova-b/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: false,
          expectedUpdatedAt: enableSecondJson.school.updatedAt,
          expectedPreviousEnabled: true,
        }),
      }),
      { params: Promise.resolve({ id: "school-nova-b" }) }
    );
    expect(disableSecondRes.status).toBe(200);
    expect((await disableSecondRes.json()).school.aiExternalFormalizeEnabled).toBe(false);

    // Formulário desatualizado (mesmo expectedUpdatedAt antigo) recebe 409 Conflict e não sobrescreve
    const staleFormRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: false,
          expectedUpdatedAt: staleUpdatedAt,
          expectedPreviousEnabled: false,
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(staleFormRes.status).toBe(409);
    const getAfterStale = await getSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy"),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect((await getAfterStale.json()).school.aiExternalFormalizeEnabled).toBe(true);

    // 5. Concorrência CAS entre desligamento de IA e rotação/revogação de sync-token preserva ambos
    hoisted.onBeforeSchoolUpdateMany = () => {
      // Outro operador desligou a IA externa exatamente antes do CAS do POST /sync-token concluir
      const parsed = JSON.parse(hoisted.state.schools[0].settingsJson);
      parsed.aiExternalFormalizeEnabled = false;
      hoisted.state.schools[0].settingsJson = JSON.stringify(parsed);
      hoisted.state.schools[0].updatedAt = new Date(
        hoisted.state.schools[0].updatedAt.getTime() + 500
      );
    };
    const rotateRes = await rotateSyncTokenPost(
      new Request("http://localhost/api/schools/default-leopoldina/sync-token", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(rotateRes.status).toBe(200);
    const afterRotateSettings = JSON.parse(hoisted.state.schools[0].settingsJson);
    expect(afterRotateSettings.aiExternalFormalizeEnabled).toBe(false);
    expect(afterRotateSettings.syncTokenEncrypted).toBeTruthy();

    // Agora testa PUT geral com expectedUpdatedAt atualizando telefone sem sobrescrever IA externa nem token
    const generalPutRes = await putSchoolById(
      new Request("http://localhost/api/schools/default-leopoldina", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "(42) 3222-1111",
          expectedUpdatedAt: hoisted.state.schools[0].updatedAt.toISOString(),
          settings: { criticalAbsenceThreshold: 6 },
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(generalPutRes.status).toBe(200);
    const afterGeneralPutSettings = JSON.parse(hoisted.state.schools[0].settingsJson);
    expect(afterGeneralPutSettings.aiExternalFormalizeEnabled).toBe(false);
    expect(afterGeneralPutSettings.syncTokenEncrypted).toBeTruthy();
    expect(afterGeneralPutSettings.criticalAbsenceThreshold).toBe(6);

    // Revogação do sync-token preserva aiExternalFormalizeEnabled
    const revokeRes = await revokeSyncTokenDelete(
      new Request("http://localhost/api/schools/default-leopoldina/sync-token", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(revokeRes.status).toBe(200);
    const afterRevokeSettings = JSON.parse(hoisted.state.schools[0].settingsJson);
    expect(afterRevokeSettings.aiExternalFormalizeEnabled).toBe(false);
    expect(afterRevokeSettings.syncTokenEncrypted).toBeUndefined();
  });

  it("Rodada 3 F04: provedor simulado valida caso elegível minimizado e confirma ZERO chamadas em concorrência, conteúdo incerto e escola não autorizada", async () => {
    hoisted.state.atas.push(
      {
        id: "ata-draft-ok",
        schoolId: "default-leopoldina",
        status: "DRAFT",
        isConfidential: false,
        category: "ACOMPANHAMENTO_PEDAGOGICO",
        updatedAt: new Date("2026-11-23T10:00:00.000Z"),
        students: [{ student: { id: "stu-a-1", name: "Ana Paula Oliveira" } }],
        participants: [{ name: "Carlos Oliveira", role: "RESPONSAVEL" }],
      },
      {
        id: "ata-finalized",
        schoolId: "default-leopoldina",
        status: "FINALIZED",
        isConfidential: false,
        category: "ACOMPANHAMENTO_PEDAGOGICO",
        updatedAt: new Date("2026-11-23T10:00:00.000Z"),
        students: [],
        participants: [],
      }
    );

    // 1. Caso elegível com minuta salva DRAFT + saída sanitizada (chaves extras descartadas)
    hoisted.generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        formalSubject: "Alinhamento de [ESTUDANTE_1]",
        formalSummary:
          "[DATA_ATENDIMENTO], realizou-se atendimento com [ESTUDANTE_1] e [RESPONSAVEL_1] em [ESCOLA].",
        agreementsSummary: "Frequência regular acompanhada.",
        actionItems: [
          {
            description: "Comparecer em 7 dias.",
            responsible: "FAMILIA",
            suggestedDaysToComplete: 7,
          },
        ],
        unexpectedSecretField: "deve-ser-descartado",
      }),
    });

    const eligibleDraftRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minuteId: "ata-draft-ok",
          isConfidential: false,
          ataScope: "STUDENTS",
          studentIds: ["stu-a-1"],
          rawNotes: "Ana Paula Oliveira compareceu com Carlos Oliveira para alinhamento escolar.",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          studentNames: ["Ana Paula Oliveira"],
          guardianNames: ["Carlos Oliveira"],
          attendedAt: "2026-09-15T14:30:00-03:00",
        }),
      })
    );
    expect(eligibleDraftRes.status).toBe(200);
    const eligibleDraftJson = await eligibleDraftRes.json();
    expect(eligibleDraftJson.mode).toBe("EXTERNAL_AI");
    expect(eligibleDraftJson.result.unexpectedSecretField).toBeUndefined();
    expect(hoisted.generateContentMock).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.stringify(hoisted.generateContentMock.mock.calls[0][0]);
    expect(sentPayload).not.toContain("Escola Piloto Sintética");
    expect(sentPayload).not.toContain("Ponta Grossa");
    expect(sentPayload).not.toContain("41042730");
    expect(sentPayload).not.toContain("stu-a-1");

    // A partir daqui, todos os cenários abaixo DEVEM fazer ZERO novas chamadas externas
    hoisted.generateContentMock.mockClear();
    hoisted.interactionsCreateMock.mockClear();

    // 2. Minuta nova com apenas valor inicial do editor (isConfidential: false sem nonConfidentialConfirmed: true) -> LOCAL_POLICY_GUARD
    const newDefaultOnlyRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Estudante compareceu com o responsável para conversa de rotina.",
          studentNames: ["Aluno Novo"],
        }),
      })
    );
    expect(newDefaultOnlyRes.status).toBe(200);
    expect((await newDefaultOnlyRes.json()).mode).toBe("LOCAL_POLICY_GUARD");

    // 3. Categoria omitida ou não aprovada para IA externa -> LOCAL_POLICY_GUARD
    for (const cat of [undefined, "SAUDE_VULNERABILIDADE", "REDE_PROTECAO_CT", "CONVIVENCIA_INDISCIPLINA"]) {
      const catRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            category: cat,
            rawNotes: "Registro escolar de acompanhamento.",
            studentNames: ["Aluno Teste"],
          }),
        })
      );
      expect((await catRes.json()).mode).toBe("LOCAL_POLICY_GUARD");
    }

    // 4. Ata FINALIZED (403), studentIds de outra escola, nome próprio solto e endereço -> bloqueio antes de envio externo
    const finalizedRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minuteId: "ata-finalized",
          isConfidential: false,
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Tentativa em ata finalizada.",
        }),
      })
    );
    expect(finalizedRes.status).toBe(403);

    const crossStudentRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          studentIds: ["stu-b-1"],
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Estudante de outra escola citado.",
        }),
      })
    );
    expect((await crossStudentRes.json()).mode).toBe("LOCAL_POLICY_GUARD");

    const unmaskedProperAndAddressRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Vizinho Carlos Henrique mora na Rua das Flores, 120.",
        }),
      })
    );
    expect((await unmaskedProperAndAddressRes.json()).mode).toBe("LOCAL_POLICY_GUARD");

    // 5. Desligamento concorrente (TOCTOU) entre leitura inicial (#2) e revalidação pré-despacho (#3) -> LOCAL_ONLY com ZERO chamadas
    hoisted.schoolFindUniqueCallCount = 0;
    hoisted.onSchoolFindUnique = (callIndex, schoolId) => {
      if (schoolId === "default-leopoldina" && callIndex === 3) {
        hoisted.state.schools[0].settingsJson = JSON.stringify({
          edition: "PILOTO_INTEGRADA",
          aiExternalFormalizeEnabled: false,
        });
      }
    };
    const toctouRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Registro limpo durante desligamento concorrente.",
          studentNames: ["Ana Paula Oliveira"],
        }),
      })
    );
    hoisted.onSchoolFindUnique = null;
    expect(hoisted.schoolFindUniqueCallCount).toBe(3);
    expect(toctouRes.status).toBe(200);
    expect((await toctouRes.json()).mode).toBe("LOCAL_ONLY");

    // 6. Nenhuma chamada externa realizada nos cenários bloqueados/incertos/concorrentes
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();
  });

  it("fluxo WhatsApp (classify-reply & messages/reply), generate-template e test-key rodam 100% locais com ZERO chamadas externas mesmo com credencial da piloto ativa", async () => {
    // classify-reply com texto: classifica localmente sem chamar Gemini
    const classifyRes = await classifyReplyPost(
      new Request("http://localhost/api/ai/classify-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-gemini-key": "AIzaClientIgnored12345" },
        body: JSON.stringify({
          rawReply: "Meu filho foi ao médico hoje, amanhã entrego o atestado.",
          studentName: "Gabriel Mendes Souza",
        }),
      })
    );
    expect(classifyRes.status).toBe(200);
    const classifyData = await classifyRes.json();
    expect(classifyData.mode).toBe("LOCAL_ONLY");
    expect(classifyData.classification.category).toBe("SAUDE");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();

    // classify-reply rejeita imagem com 400
    const classifyImgRes = await classifyReplyPost(
      new Request("http://localhost/api/ai/classify-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawReply: "",
          screenshotDataUrl: "data:image/png;base64,abc",
        }),
      })
    );
    expect(classifyImgRes.status).toBe(400);

    // messages/reply registra e reclassifica localmente preservando integridade SHA-256
    const replyRes = await messagesReplyPost(
      new Request("http://localhost/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: "msg-wa-1",
          guardianReplied: true,
          rawReply: "Ele estava trabalhando para ajudar em casa hoje.",
          classifyWithAi: true,
        }),
      })
    );
    expect(replyRes.status).toBe(200);
    const replyData = await replyRes.json();
    expect(replyData.mode).toBe("LOCAL_ONLY");
    expect(replyData.updated.replyCategory).toBe("TRABALHO");
    const integrity = verifyMessageIntegrity(replyData.updated.contentHash, {
      studentId: replyData.updated.studentId,
      schoolId: "default-leopoldina",
      phoneUsed: replyData.updated.phoneUsed,
      reasonTitle: replyData.updated.reasonTitle,
      messageContent: replyData.updated.messageContent,
      sentByName: replyData.updated.sentByName,
      sentAt: replyData.updated.sentAt,
      guardianReplied: replyData.updated.guardianReplied,
      replyNotes: replyData.updated.replyNotes,
      replyCategory: replyData.updated.replyCategory,
      repliedAt: replyData.updated.repliedAt,
    });
    expect(integrity.valid).toBe(true);

    // Mesma garantia em escola fora da lista piloto (school-nova-b): classificação e registro WhatsApp 100% locais
    hoisted.state.messageLogs.push({
      id: "msg-wa-2",
      studentId: "stu-b-1",
      phoneUsed: "42999991111",
      reasonTitle: "Faltas Consecutivas",
      messageContent: "Olá, notamos faltas.",
      sentByName: "Pedagoga Piloto",
      sentAt: new Date("2026-11-20T14:00:00Z"),
      guardianReplied: false,
      replyNotes: null,
      replyCategory: null,
      deliveryStatus: "SENT",
      student: {
        id: "stu-b-1",
        name: "Estudante Escola B",
        guardianName: "Responsável Escola B",
        schoolId: "school-nova-b",
      },
    });
    hoisted.cookiesMap.set("active_school_id", "school-nova-b");
    const nonPilotClassify = await classifyReplyPost(
      new Request("http://localhost/api/ai/classify-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawReply: "A família viajou e retorna amanhã.",
          studentName: "Estudante Escola B",
        }),
      })
    );
    expect(nonPilotClassify.status).toBe(200);
    expect((await nonPilotClassify.json()).mode).toBe("LOCAL_ONLY");
    const nonPilotReply = await messagesReplyPost(
      new Request("http://localhost/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: "msg-wa-2",
          guardianReplied: true,
          rawReply: "Estava com febre e vai ao posto de saúde.",
          classifyWithAi: true,
        }),
      })
    );
    expect(nonPilotReply.status).toBe(200);
    expect((await nonPilotReply.json()).mode).toBe("LOCAL_ONLY");
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");

    // generate-template e test-key não fazem chamadas externas
    const tplRes = await generateTemplatePost(
      new Request("http://localhost/api/ai/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Entrega de boletins escolares" }),
      })
    );
    expect(tplRes.status).toBe(200);
    expect((await tplRes.json()).mode).toBe("LOCAL_ONLY");

    const keyGetRes = await testKeyGet();
    expect(keyGetRes.status).toBe(200);
    expect((await keyGetRes.json()).schoolAuthorized).toBe(true);

    const keyPostRes = await testKeyPost(
      new Request("http://localhost/api/ai/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "AIzaClientIgnoredKey123456" }),
      })
    );
    expect(keyPostRes.status).toBe(200);
    expect((await keyPostRes.json()).source).toBe("configuracao_servidor_institucional");

    // Zero chamadas externas ao longo de todo este teste
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();
    expect(hoisted.googleGenAIConstructorCalls).toHaveLength(0);
  });

  it("Rodada 4 F04: autoriza minuteId antes de carregar participantes, bloqueia colega sem sigilo com zero vazamento e gera minuta sigilosa local para autor/gestor", async () => {
    hoisted.state.users.push(
      {
        id: "usr-ped-colega",
        email: "colega.piloto@escola.pr.gov.br",
        name: "Colega Sem Acesso",
        role: "PEDAGOGA",
        active: true,
        schoolId: "default-leopoldina",
      },
      {
        id: "usr-gestor",
        email: "gestor.piloto@escola.pr.gov.br",
        name: "Diretora Piloto",
        role: "PEDAGOGA",
        active: true,
        schoolId: "default-leopoldina",
      }
    );
    hoisted.state.userSchools.push(
      { userId: "usr-ped-colega", schoolId: "default-leopoldina", role: "PEDAGOGA", active: true },
      { userId: "usr-gestor", schoolId: "default-leopoldina", role: "GESTOR_ESCOLAR", active: true }
    );
    hoisted.state.atas.push({
      id: "ata-escola-b",
      schoolId: "school-nova-b",
      status: "DRAFT",
      isConfidential: false,
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      authorId: "usr-ped",
      authorEmail: "pedagoga.piloto@escola.pr.gov.br",
      updatedAt: new Date("2026-11-23T10:00:00.000Z"),
      students: [{ student: { id: "stu-b-1", name: "Aluno Secreto Escola B" } }],
      participants: [{ name: "Responsável Escola B", role: "RESPONSAVEL" }],
    });

    // 1. Colega da mesma escola sem autorização ao rascunho sigiloso: bloqueado antes de carregar participantes (externa ON e OFF)
    for (const externalEnabled of [true, false]) {
      hoisted.state.schools[0].settingsJson = JSON.stringify({
        edition: "PILOTO_INTEGRADA",
        aiExternalFormalizeEnabled: externalEnabled,
      });
      hoisted.minuteQuerySelects = [];
      hoisted.auth.mockResolvedValueOnce({
        user: {
          id: "usr-ped-colega",
          email: "colega.piloto@escola.pr.gov.br",
          name: "Colega Sem Acesso",
          role: "PEDAGOGA",
        },
      });

      const deniedRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minuteId: "ata-sigilosa",
            rawNotes: "Tentativa de leitura por colega sem acesso.",
          }),
        })
      );
      expect(deniedRes.status).toBe(403);
      const deniedText = await deniedRes.text();
      expect(deniedText).not.toContain("Estudante Sigiloso Teste");
      expect(deniedText).not.toContain("Responsável Sigiloso Teste");
      expect(deniedText).not.toContain("SAUDE_VULNERABILIDADE");
      expect(deniedText).not.toContain("stu-sig-1");
      expect(deniedText).not.toContain("ata-sigilosa");
      expect(hoisted.minuteQuerySelects).toHaveLength(1);
      expect(hoisted.minuteQuerySelects[0]).not.toContain("students");
      expect(hoisted.minuteQuerySelects[0]).not.toContain("participants");
    }

    // 2. Ata de outra escola nem sequer é localizada na consulta inicial restrita à escola ativa (404)
    hoisted.minuteQuerySelects = [];
    hoisted.minuteQueryWheres = [];
    const crossTenantMinuteRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minuteId: "ata-escola-b",
          rawNotes: "Tentativa cross-tenant.",
        }),
      })
    );
    expect(crossTenantMinuteRes.status).toBe(404);
    expect(await crossTenantMinuteRes.text()).not.toContain("Aluno Secreto Escola B");
    expect(hoisted.minuteQueryWheres[0]?.schoolId).toBe("default-leopoldina");
    expect(hoisted.minuteQuerySelects).toHaveLength(1);
    expect(hoisted.minuteQuerySelects[0]).not.toContain("students");

    // 3. Autora e gestora da mesma escola geram minuta sigilosa localmente com 0 chamadas externas (inclusive com IA externa desligada)
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: false,
    });
    for (const actor of [
      {
        id: "usr-ped",
        email: "pedagoga.piloto@escola.pr.gov.br",
        name: "Pedagoga Piloto",
        role: "PEDAGOGA",
      },
      {
        id: "usr-gestor",
        email: "gestor.piloto@escola.pr.gov.br",
        name: "Diretora Piloto",
        role: "PEDAGOGA",
      },
    ]) {
      hoisted.minuteQuerySelects = [];
      hoisted.auth.mockResolvedValueOnce({ user: actor });
      const okLocalRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minuteId: "ata-sigilosa",
            rawNotes: "Atendimento sigiloso registrado para acompanhamento da rede.",
          }),
        })
      );
      expect(okLocalRes.status).toBe(200);
      const okJson = await okLocalRes.json();
      expect(okJson.mode).toBe("LOCAL_ONLY");
      expect(okJson.result.formalSummary).toContain("Estudante Sigiloso Teste");
      expect(hoisted.minuteQuerySelects).toHaveLength(2);
      expect(hoisted.minuteQuerySelects[0]).not.toContain("students");
      expect(hoisted.minuteQuerySelects[1]).toContain("students");
      expect(hoisted.minuteQuerySelects[1]).toContain("participants");
    }

    // 4. Fluxo de minuta nova sem minuteId continua funcionando localmente
    const newLocalDraftRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawNotes: "Novo atendimento presencial com a mãe sobre frequência.",
          studentNames: ["Ana Paula Oliveira"],
          guardianNames: ["Carlos Oliveira"],
        }),
      })
    );
    expect(newLocalDraftRes.status).toBe(200);
    expect((await newLocalDraftRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();
  });

  it("Rodada 4 F04: revalida política imediatamente antes de cada chamada externa (models.generateContent e interactions.create) encerrando ao desligar ou falhar verificação", async () => {
    const cleanPayload = {
      isConfidential: false,
      nonConfidentialConfirmed: true,
      ataScope: "STUDENTS",
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      rawNotes: "Ana Paula Oliveira compareceu com Carlos Oliveira para assinatura de combinados.",
      studentNames: ["Ana Paula Oliveira"],
      guardianNames: ["Carlos Oliveira"],
      attendedAt: "2026-09-15T14:30:00-03:00",
    };

    // 1. Tentativa #1 falha -> antes da Tentativa #2 a política é desligada -> 0 segunda chamada e 0 interactions.create
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: true,
      aiExternalFormalizePolicyVersion: 2,
    });
    hoisted.generateContentMock.mockRejectedValueOnce(new Error("503 temporarily unavailable"));
    hoisted.schoolFindUniqueCallCount = 0;
    // Chamadas expected: #1 requireAuthorizedSchool, #2 elegibilidade inicial, #3 preDispatch, #4 antes tentativa #1, #5 antes tentativa #2
    hoisted.onSchoolFindUnique = (callIndex, schoolId) => {
      if (schoolId === "default-leopoldina" && callIndex === 5) {
        hoisted.state.schools[0].settingsJson = JSON.stringify({
          edition: "PILOTO_INTEGRADA",
          aiExternalFormalizeEnabled: false,
        });
      }
    };

    const abortedBeforeSecondTry = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanPayload),
      })
    );
    hoisted.onSchoolFindUnique = null;
    expect(abortedBeforeSecondTry.status).toBe(200);
    const abortedJson = await abortedBeforeSecondTry.json();
    expect(abortedJson.mode).toBe("LOCAL_ONLY");
    expect(abortedJson.usedFallback).toBe(true);
    expect(abortedJson.result.formalSummary).toContain("Ana Paula Oliveira");
    expect(hoisted.generateContentMock).toHaveBeenCalledTimes(1);
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();

    // 2. Tentativa #1 falha -> antes da Tentativa #2 a consulta ao banco falha (fail closed) -> 0 segunda chamada e 0 interactions.create
    hoisted.generateContentMock.mockClear();
    hoisted.interactionsCreateMock.mockClear();
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: true,
      aiExternalFormalizePolicyVersion: 2,
    });
    hoisted.generateContentMock.mockRejectedValueOnce(new Error("timeout on model 1"));
    hoisted.schoolFindUniqueCallCount = 0;
    hoisted.onSchoolFindUnique = (callIndex) => {
      if (callIndex === 5) {
        throw new Error("Simulated transient DB failure");
      }
    };

    const failedCheckRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanPayload),
      })
    );
    hoisted.onSchoolFindUnique = null;
    expect(failedCheckRes.status).toBe(200);
    expect((await failedCheckRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).toHaveBeenCalledTimes(1);
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();

    // 3. Todas as 4 tentativas de models.generateContent falham -> antes de interactions.create a política desliga -> 0 interactions.create
    hoisted.generateContentMock.mockClear();
    hoisted.interactionsCreateMock.mockClear();
    hoisted.generateContentMock.mockRejectedValue(new Error("network failure"));
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: true,
      aiExternalFormalizePolicyVersion: 2,
    });
    hoisted.schoolFindUniqueCallCount = 0;
    // Chamadas: #1 auth, #2 inicial, #3 preDispatch, #4..#7 modelos 1..4, #8 imediatamente antes de interactions.create
    hoisted.onSchoolFindUnique = (callIndex, schoolId) => {
      if (schoolId === "default-leopoldina" && callIndex === 8) {
        hoisted.state.schools[0].settingsJson = JSON.stringify({
          edition: "PILOTO_INTEGRADA",
          aiExternalFormalizeEnabled: false,
        });
      }
    };

    const abortedBeforeInteractions = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanPayload),
      })
    );
    hoisted.onSchoolFindUnique = null;
    expect(abortedBeforeInteractions.status).toBe(200);
    expect((await abortedBeforeInteractions.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).toHaveBeenCalledTimes(4);
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();
  });

  it("Rodada 4 F04: auditoria transacional com rollback em /ai-policy, bloqueio global emergencial, desligamento resiliente e WhatsApp local", async () => {
    hoisted.state.users.push({
      id: "usr-super",
      email: "superadmin@escola.pr.gov.br",
      name: "SuperAdmin",
      role: "SUPERADMIN",
      active: true,
      schoolId: "default-leopoldina",
    });
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: false,
    });
    const initialUpdatedAt = new Date("2026-11-23T10:00:00.000Z");
    hoisted.state.schools[0].updatedAt = initialUpdatedAt;

    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-super",
        email: "superadmin@escola.pr.gov.br",
        name: "SuperAdmin",
        role: "SUPERADMIN",
        schoolId: "default-leopoldina",
      },
    });

    // 1. Falha de persistência do AuditLog ao ativar (false -> true) sofre rollback transacional (500)
    hoisted.failNextAuditCreate = true;
    const rollbackEnableRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: true,
          expectedUpdatedAt: initialUpdatedAt.toISOString(),
          expectedPreviousEnabled: false,
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(rollbackEnableRes.status).toBe(500);
    const rollbackBody = await rollbackEnableRes.json();
    expect(rollbackBody.code).toBe("AUDIT_PERSISTENCE_FAILED");
    expect(rollbackBody.school?.aiExternalFormalizeEnabled).toBe(false);
    expect(JSON.parse(hoisted.state.schools[0].settingsJson).aiExternalFormalizeEnabled).toBe(false);
    expect(hoisted.state.schools[0].updatedAt.toISOString()).toBe(initialUpdatedAt.toISOString());
    expect(
      hoisted.state.auditLogs.filter((a) => a.action === "UPDATE_SCHOOL_AI_POLICY")
    ).toHaveLength(0);

    // Formalização imediata continua exclusivamente local (0 chamadas externas)
    const stillLocalRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Atendimento de frequência regular.",
          studentNames: ["Ana Paula Oliveira"],
        }),
      })
    );
    expect(stillLocalRes.status).toBe(200);
    expect((await stillLocalRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // 2. Ativação normal persiste política + AuditLog na mesma transação e mantém 409 para expectedUpdatedAt antigo
    const okEnableRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: true,
          expectedUpdatedAt: initialUpdatedAt.toISOString(),
          expectedPreviousEnabled: false,
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(okEnableRes.status).toBe(200);
    const okEnableJson = await okEnableRes.json();
    expect(okEnableJson.auditRecorded).toBe(true);
    expect(
      hoisted.state.auditLogs.filter((a) => a.action === "UPDATE_SCHOOL_AI_POLICY")
    ).toHaveLength(1);

    const conflictStaleRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: false,
          expectedUpdatedAt: initialUpdatedAt.toISOString(),
          expectedPreviousEnabled: true,
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(conflictStaleRes.status).toBe(409);

    // 3. Bloqueio global emergencial sobrepõe escola ativa (0 chamadas externas)
    process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "false";
    const globalKillRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Atendimento sob bloqueio global emergencial.",
          studentNames: ["Ana Paula Oliveira"],
        }),
      })
    );
    expect(globalKillRes.status).toBe(200);
    expect((await globalKillRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
    process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";

    // 4. Desligamento emergencial (true -> false) permanece resiliente se AuditLog estiver indisponível
    hoisted.failNextAuditCreate = true;
    const emergencyOffRes = await patchSchoolAiPolicy(
      new Request("http://localhost/api/schools/default-leopoldina/ai-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiExternalFormalizeEnabled: false,
          expectedUpdatedAt: okEnableJson.school.updatedAt,
          expectedPreviousEnabled: true,
        }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(emergencyOffRes.status).toBe(200);
    const emergencyOffJson = await emergencyOffRes.json();
    expect(emergencyOffJson.auditRecorded).toBe(false);
    expect(emergencyOffJson.school.aiExternalFormalizeEnabled).toBe(false);
    expect(JSON.parse(hoisted.state.schools[0].settingsJson).aiExternalFormalizeEnabled).toBe(false);

    // Após desligamento emergencial, nova formalização vai para LOCAL_ONLY
    const postEmergencyRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Atendimento após desligamento emergencial.",
          studentNames: ["Ana Paula Oliveira"],
        }),
      })
    );
    expect((await postEmergencyRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    // 5. Classificação WhatsApp permanece 100% local
    const waClassify = await classifyReplyPost(
      new Request("http://localhost/api/ai/classify-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawReply: "Estou sem carro para levar na escola hoje.",
          studentName: "Gabriel Mendes Souza",
        }),
      })
    );
    expect(waClassify.status).toBe(200);
    expect((await waClassify.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();
  });

  it("Rodada 5 F04: mudança de sigilo entre autorização e leitura de participantes retorna 409 genérico sem vazamento (externa e local) e mantém geração local ao autor/gestor", async () => {
    hoisted.state.users.push(
      {
        id: "usr-ped-colega",
        email: "colega.mutavel@escola.pr.gov.br",
        name: "Colega Sem Acesso",
        role: "PEDAGOGA",
        active: true,
        schoolId: "default-leopoldina",
      },
      {
        id: "usr-gestor",
        email: "gestora.mutavel@escola.pr.gov.br",
        name: "Gestora Escolar",
        role: "PEDAGOGA",
        active: true,
        schoolId: "default-leopoldina",
      }
    );
    hoisted.state.userSchools.push(
      { userId: "usr-ped-colega", schoolId: "default-leopoldina", role: "PEDAGOGA", active: true },
      { userId: "usr-gestor", schoolId: "default-leopoldina", role: "GESTOR_ESCOLAR", active: true }
    );

    const t1 = new Date("2026-11-24T08:00:00.000Z");
    const t2 = new Date("2026-11-24T08:00:05.000Z");

    const mutavelMinute = {
      id: "ata-mutavel",
      schoolId: "default-leopoldina",
      status: "DRAFT",
      isConfidential: false,
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      authorId: "usr-ped",
      authorEmail: "pedagoga.piloto@escola.pr.gov.br",
      updatedAt: t1,
      students: [{ student: { id: "stu-sig-mut-1", name: "Estudante Sigiloso Mutado" } }],
      participants: [{ name: "Responsável Sigiloso Mutado", role: "RESPONSAVEL" }],
    };
    hoisted.state.atas.push(mutavelMinute);

    for (const externalEnabled of [true, false]) {
      for (const ignoreWhere of [false, true]) {
        mutavelMinute.isConfidential = false;
        mutavelMinute.category = "ACOMPANHAMENTO_PEDAGOGICO";
        mutavelMinute.updatedAt = t1;
        hoisted.ignorePinnedMinuteWhere = ignoreWhere;
        hoisted.minuteQueryCallCount = 0;
        hoisted.minuteQueryWheres = [];
        hoisted.transactionOptions = [];
        hoisted.onMinuteQuery = (callIndex) => {
          // Entre a 1ª consulta (metadados) e a 2ª consulta (participantes), a ata torna-se sigilosa e avança updatedAt
          if (callIndex === 2) {
            mutavelMinute.isConfidential = true;
            mutavelMinute.category = "SAUDE_VULNERABILIDADE";
            mutavelMinute.updatedAt = t2;
          }
        };

        hoisted.state.schools[0].settingsJson = JSON.stringify({
          edition: "PILOTO_INTEGRADA",
          aiExternalFormalizeEnabled: externalEnabled,
          aiExternalFormalizePolicyVersion: 2,
        });
        hoisted.auth.mockResolvedValueOnce({
          user: {
            id: "usr-ped-colega",
            email: "colega.mutavel@escola.pr.gov.br",
            name: "Colega Sem Acesso",
            role: "PEDAGOGA",
          },
        });

        const raceRes = await formalizeAtaPost(
          new Request("http://localhost/api/ai/formalize-ata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              minuteId: "ata-mutavel",
              rawNotes: "Anotação durante troca concorrente de sigilo.",
            }),
          })
        );

        hoisted.onMinuteQuery = null;
        hoisted.ignorePinnedMinuteWhere = false;

        expect(raceRes.status).toBe(409);
        const bodyText = await raceRes.text();
        expect(bodyText).not.toContain("Estudante Sigiloso Mutado");
        expect(bodyText).not.toContain("Responsável Sigiloso Mutado");
        expect(bodyText).not.toContain("SAUDE_VULNERABILIDADE");
        expect(bodyText).not.toContain("ACOMPANHAMENTO_PEDAGOGICO");
        expect(bodyText).not.toContain("ata-mutavel");
        expect(bodyText).not.toContain("stu-sig-mut-1");
        expect(bodyText.toLowerCase()).not.toContain("sigilo");

        // Confirma snapshot único RepeatableRead e filtro travado por escola, status, sigilo, categoria, autoria e updatedAt na 2ª consulta
        expect(hoisted.transactionOptions).toContainEqual(
          expect.objectContaining({ isolationLevel: "RepeatableRead" })
        );
        expect(hoisted.minuteQueryWheres[0]?.schoolId).toBe("default-leopoldina");
        expect(hoisted.minuteQueryWheres[1]).toEqual(
          expect.objectContaining({
            id: "ata-mutavel",
            schoolId: "default-leopoldina",
            status: "DRAFT",
            isConfidential: false,
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            authorId: "usr-ped",
            authorEmail: "pedagoga.piloto@escola.pr.gov.br",
            updatedAt: t1,
          })
        );
      }
    }

    // Erro de serialização P2034 / 40001 na transação de snapshot retorna 409 genérico sem vazamento ou chamada externa
    for (const externalEnabled of [true, false]) {
      mutavelMinute.isConfidential = false;
      mutavelMinute.category = "ACOMPANHAMENTO_PEDAGOGICO";
      mutavelMinute.updatedAt = t1;
      hoisted.state.schools[0].settingsJson = JSON.stringify({
        edition: "PILOTO_INTEGRADA",
        aiExternalFormalizeEnabled: externalEnabled,
        aiExternalFormalizePolicyVersion: 2,
      });
      hoisted.auth.mockResolvedValueOnce({
        user: {
          id: "usr-ped-colega",
          email: "colega.mutavel@escola.pr.gov.br",
          name: "Colega Sem Acesso",
          role: "PEDAGOGA",
        },
      });
      const p2034Err: any = new Error("could not serialize access due to concurrent update");
      p2034Err.code = "P2034";
      hoisted.failTransactionWithError = p2034Err;

      const serializationConflictRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minuteId: "ata-mutavel",
            rawNotes: "Anotação durante conflito de serialização.",
          }),
        })
      );
      expect(serializationConflictRes.status).toBe(409);
      const conflictText = await serializationConflictRes.text();
      expect(conflictText).not.toContain("Estudante Sigiloso Mutado");
      expect(conflictText).not.toContain("Responsável Sigiloso Mutado");
      expect(conflictText).not.toContain("SAUDE_VULNERABILIDADE");
      expect(conflictText).not.toContain("P2034");
      expect(conflictText.toLowerCase()).not.toContain("sigilo");
    }

    // Agora autor e gestora conseguem formalizar a ata já sigilosa em modo local com 0 chamadas externas
    mutavelMinute.isConfidential = true;
    mutavelMinute.category = "SAUDE_VULNERABILIDADE";
    mutavelMinute.updatedAt = t2;
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: false,
    });

    for (const actor of [
      {
        id: "usr-ped",
        email: "pedagoga.piloto@escola.pr.gov.br",
        name: "Pedagoga Piloto",
        role: "PEDAGOGA",
      },
      {
        id: "usr-gestor",
        email: "gestora.mutavel@escola.pr.gov.br",
        name: "Gestora Escolar",
        role: "PEDAGOGA",
      },
    ]) {
      hoisted.auth.mockResolvedValueOnce({ user: actor });
      const okLocal = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minuteId: "ata-mutavel",
            rawNotes: "Atendimento sigiloso validado pelo autor e direção.",
          }),
        })
      );
      expect(okLocal.status).toBe(200);
      const okJson = await okLocal.json();
      expect(okJson.mode).toBe("LOCAL_ONLY");
      expect(okJson.result.formalSummary).toContain("Estudante Sigiloso Mutado");
    }

    expect(hoisted.generateContentMock).not.toHaveBeenCalled();
    expect(hoisted.interactionsCreateMock).not.toHaveBeenCalled();
  });

  it("Rodada 10 F04: flag legada sem policyVersion=2 falha fechado em LOCAL_ONLY e cálculo de transição preserva apenas lista confiável sem sobrescrever painel", async () => {
    hoisted.state.schools[0].settingsJson = JSON.stringify({
      edition: "PILOTO_INTEGRADA",
      aiExternalFormalizeEnabled: true,
    });
    const parsedLegacy = parseSchoolAiExternalFormalizeFlag(hoisted.state.schools[0].settingsJson);
    expect(parsedLegacy).toEqual({
      verified: true,
      enabled: false,
      panelControlled: false,
      legacyFlagPendingTransition: true,
      rawStoredEnabled: true,
    });

    const legacyPendingRes = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isConfidential: false,
          nonConfidentialConfirmed: true,
          ataScope: "STUDENTS",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          rawNotes: "Ana Paula Oliveira em acompanhamento sem transição confirmada.",
          studentNames: ["Ana Paula Oliveira"],
        }),
      })
    );
    expect(legacyPendingRes.status).toBe(200);
    expect((await legacyPendingRes.json()).mode).toBe("LOCAL_ONLY");
    expect(hoisted.generateContentMock).not.toHaveBeenCalled();

    expect(parseLegacyAllowedSchoolIdsForTransition(undefined)).toEqual({
      reliable: false,
      reason: "missing_legacy_list",
      ids: new Set(),
    });
    expect(parseLegacyAllowedSchoolIdsForTransition("   ")).toEqual({
      reliable: false,
      reason: "empty_legacy_list",
      ids: new Set(),
    });
    expect(parseLegacyAllowedSchoolIdsForTransition("*")).toEqual({
      reliable: false,
      reason: "wildcard_not_allowed",
      ids: new Set(),
    });
    expect(parseLegacyAllowedSchoolIdsForTransition("school-a,ALL")).toEqual({
      reliable: false,
      reason: "wildcard_not_allowed",
      ids: new Set(),
    });
    expect(parseLegacyAllowedSchoolIdsForTransition("school-a,invalid id")).toEqual({
      reliable: false,
      reason: "malformed_legacy_list",
      ids: new Set(),
    });

    const reliableList = parseLegacyAllowedSchoolIdsForTransition("default-leopoldina,school-extra");
    expect(reliableList.reliable).toBe(true);
    expect(
      computeLegacyAiPolicyTransition({
        schoolId: "default-leopoldina",
        settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA", aiExternalFormalizeEnabled: true }),
        legacyAllowed: reliableList,
        transitionedAtIso: "2026-11-24T22:00:00.000Z",
      })
    ).toMatchObject({
      action: "update",
      outcome: "preserved_enabled",
      nextEnabled: true,
    });

    expect(
      computeLegacyAiPolicyTransition({
        schoolId: "school-outside",
        settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA", aiExternalFormalizeEnabled: true }),
        legacyAllowed: reliableList,
      })
    ).toMatchObject({
      action: "update",
      outcome: "reconciled_to_local_outside_legacy_list",
      nextEnabled: false,
    });

    expect(
      computeLegacyAiPolicyTransition({
        schoolId: "default-leopoldina",
        settingsJson: JSON.stringify({
          edition: "PILOTO_INTEGRADA",
          aiExternalFormalizeEnabled: false,
          aiExternalFormalizePolicyVersion: 2,
        }),
        legacyAllowed: reliableList,
      })
    ).toEqual({
      action: "skip",
      outcome: "already_panel_controlled",
      effectiveEnabled: false,
    });
  });

  it("rejeita explicitamente filtro schoolIds vazio ou com apenas espaços em transitionSchoolAiPoliciesToPanelControl sem consultar todas as escolas", async () => {
    await expect(
      transitionSchoolAiPoliciesToPanelControl({
        schoolIds: [],
        dryRun: true,
      })
    ).rejects.toThrow(/schoolIds/i);

    await expect(
      transitionSchoolAiPoliciesToPanelControl({
        schoolIds: ["", "   "],
        dryRun: false,
      })
    ).rejects.toThrow(/schoolIds/i);

    expect(prisma.school.findMany).not.toHaveBeenCalled();
  });
});
