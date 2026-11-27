import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const VALID_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const hoisted = vi.hoisted(() => {
  const state = {
    session: null as any,
    headersMap: { "x-forwarded-for": "203.0.113.50" } as Record<string, string>,
    rateLimitOverrides: new Map<string, any>(),
    auditLogs: [] as any[],
    db: {
      users: [] as any[],
      students: [] as any[],
      classGroups: [] as any[],
      minutes: [] as any[],
      minuteStudents: [] as any[],
      minuteParticipants: [] as any[],
      actionItems: [] as any[],
      addendums: [] as any[],
    },
    updateManyForceZero: false,
  };

  return { state };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.state.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers(hoisted.state.headersMap)),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/app/encaminhamentos/EncaminhamentosClient", () => ({
  default: vi.fn((props: any) => ({ type: "EncaminhamentosClient", props })),
}));

vi.mock("@/app/atas/livro/[ano]/LivroAnualClient", () => ({
  default: vi.fn((props: any) => ({ type: "LivroAnualClient", props })),
}));

vi.mock("@/app/assinar/ata/[token]/MobileSignClient", () => ({
  default: vi.fn((props: any) => ({ type: "MobileSignClient", props })),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async (id?: string) => ({
    id: id || "escola-a",
    name: "Escola Estadual Alpha",
    inepCode: "41000001",
    city: "Ponta Grossa",
    state: "PR",
    network: "ESTADUAL",
    edition: "PILOTO_INTEGRADA",
  })),
  ensureDefaultSchool: vi.fn(async () => ({ id: "default-leopoldina" })),
}));

vi.mock("@/lib/audit", () => ({
  extractClientIp: vi.fn(() => "203.0.113.50"),
  logAudit: vi.fn(async (entry: any) => {
    hoisted.state.auditLogs.push(entry);
  }),
}));

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async (key: string, policy: any) => {
      for (const [pattern, override] of hoisted.state.rateLimitOverrides.entries()) {
        if (key.includes(pattern)) {
          return override;
        }
      }
      return {
        success: true,
        limit: policy?.limit ?? 10,
        remaining: 9,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60,
      };
    }),
    enforceRateLimit: vi.fn(async (key: string, policy: any) => {
      for (const [pattern, override] of hoisted.state.rateLimitOverrides.entries()) {
        if (key.includes(pattern) && override && override.success === false) {
          return {
            ok: false,
            response: new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 }),
          };
        }
      }
      return { ok: true, headers: {} };
    }),
    resetRateLimit: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/escolaGoogleVerify", () => ({
  verifyEscolaGoogleIdToken: vi.fn(async () => ({
    ok: true,
    tokenInfo: {
      email: "docente@escola.pr.gov.br",
      name: "Professora Mariana",
      sub: "google-sub-1",
    },
  })),
  verifyParticipantIdentityMatch: vi.fn(() => ({ match: true })),
}));

vi.mock("@/lib/prisma", () => {
  const getClient = (): any => ({
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: any) => fn(getClient())),
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.users.find((u) => u.id === where.id || u.email === where.email) || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = hoisted.state.db.users.findIndex((u) => u.id === where.id);
        if (idx !== -1) {
          hoisted.state.db.users[idx] = { ...hoisted.state.db.users[idx], ...data };
          return hoisted.state.db.users[idx];
        }
        return null;
      }),
    },
    student: {
      findMany: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.students.filter((s) => {
          if (where?.id?.in && !where.id.in.includes(s.id)) return false;
          if (where?.schoolId && s.schoolId !== where.schoolId) return false;
          return true;
        });
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    classGroup: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.state.db.classGroups.filter((c) => !where?.schoolId || c.schoolId === where.schoolId)
      ),
    },
    pedagogicalMinute: {
      findMany: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.minutes
          .filter((m) => {
            if (where?.schoolId && m.schoolId !== where.schoolId) return false;
            if (where?.year && m.year !== where.year) return false;
            if (where?.status?.in && !where.status.in.includes(m.status)) return false;
            if (where?.OR) {
              const q = String(where.OR[0]?.subject?.contains || "").toLowerCase();
              const matched =
                (m.subject || "").toLowerCase().includes(q) ||
                (m.summary || "").toLowerCase().includes(q) ||
                (m.authorName || "").toLowerCase().includes(q);
              if (!matched) return false;
            }
            return true;
          })
          .map((m) => ({
            ...m,
            students: hoisted.state.db.minuteStudents.filter((ms) => ms.minuteId === m.id),
            participants: hoisted.state.db.minuteParticipants.filter((mp) => mp.minuteId === m.id),
            actionItems: hoisted.state.db.actionItems.filter((ai) => ai.minuteId === m.id),
            addendums: hoisted.state.db.addendums.filter((ad) => ad.minuteId === m.id),
          }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const m = hoisted.state.db.minutes.find(
          (item) =>
            (where.id && item.id === where.id) ||
            (where.verificationCode && item.verificationCode === where.verificationCode)
        );
        if (!m) return null;
        return {
          ...m,
          school: { id: m.schoolId, name: "Escola Estadual Alpha", network: "ESTADUAL" },
          students: hoisted.state.db.minuteStudents.filter((ms) => ms.minuteId === m.id),
          participants: hoisted.state.db.minuteParticipants.filter((mp) => mp.minuteId === m.id),
          actionItems: hoisted.state.db.actionItems.filter((ai) => ai.minuteId === m.id),
          addendums: hoisted.state.db.addendums.filter((ad) => ad.minuteId === m.id),
        };
      }),
      findFirst: vi.fn(async () => ({ ataNumber: 4 })),
      create: vi.fn(async ({ data }: any) => {
        const id = `min-created-${Date.now()}`;
        const createdMinute = {
          id,
          ...data,
          students: data.students?.create || [],
          participants: (data.participants?.create || []).map((p: any, idx: number) => ({
            id: `part-created-${idx}`,
            mobileSignToken: "tok-created-leak-guard",
            mobileSignExpiresAt: new Date(Date.now() + 600_000),
            ...p,
          })),
          actionItems: data.actionItems?.create || [],
        };
        hoisted.state.db.minutes.push(createdMinute);
        return createdMinute;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = hoisted.state.db.minutes.findIndex((m) => m.id === where.id);
        if (idx === -1) return null;
        const cleanData = Object.fromEntries(
          Object.entries(data).filter(([, v]) => v !== undefined)
        );
        hoisted.state.db.minutes[idx] = { ...hoisted.state.db.minutes[idx], ...cleanData };
        const m = hoisted.state.db.minutes[idx];
        return {
          ...m,
          students: hoisted.state.db.minuteStudents.filter((ms) => ms.minuteId === m.id),
          participants: hoisted.state.db.minuteParticipants.filter((mp) => mp.minuteId === m.id),
          actionItems: hoisted.state.db.actionItems.filter((ai) => ai.minuteId === m.id),
          addendums: hoisted.state.db.addendums.filter((ad) => ad.minuteId === m.id),
        };
      }),
    },
    pedagogicalMinuteStudent: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    pedagogicalMinuteParticipant: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.state.db.minuteParticipants.filter((mp) => mp.minuteId === where.minuteId)
      ),
      findUnique: vi.fn(async ({ where }: any) => {
        const p = hoisted.state.db.minuteParticipants.find(
          (mp) =>
            (where.id && mp.id === where.id) ||
            (where.mobileSignToken && mp.mobileSignToken === where.mobileSignToken)
        );
        if (!p) return null;
        const m = hoisted.state.db.minutes.find((item) => item.id === p.minuteId);
        return {
          ...p,
          minute: m
            ? {
                ...m,
                school: { name: "Escola Estadual Alpha" },
                students: hoisted.state.db.minuteStudents.filter((ms) => ms.minuteId === m.id),
              }
            : null,
        };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const p = hoisted.state.db.minuteParticipants.find(
          (mp) =>
            (!where?.id || mp.id === where.id) &&
            (!where?.mobileSignToken || mp.mobileSignToken === where.mobileSignToken)
        );
        if (!p) return null;
        const m = hoisted.state.db.minutes.find((item) => item.id === p.minuteId);
        return {
          ...p,
          minute: m
            ? {
                ...m,
                school: { name: "Escola Estadual Alpha" },
                students: hoisted.state.db.minuteStudents.filter((ms) => ms.minuteId === m.id),
              }
            : null,
        };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (hoisted.state.updateManyForceZero) {
          return { count: 0 };
        }
        let count = 0;
        hoisted.state.db.minuteParticipants = hoisted.state.db.minuteParticipants.map((mp) => {
          if (
            mp.id === where.id &&
            mp.mobileSignToken === where.mobileSignToken &&
            (where.signedAt !== null || mp.signedAt === null)
          ) {
            count++;
            return { ...mp, ...data };
          }
          return mp;
        });
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        hoisted.state.db.minuteParticipants = hoisted.state.db.minuteParticipants.filter(
          (mp) => mp.minuteId !== where.minuteId
        );
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const items = Array.isArray(data) ? data : [data];
        hoisted.state.db.minuteParticipants.push(
          ...items.map((item, idx) => ({ id: item.id || `mp-new-${idx}`, ...item }))
        );
        return { count: items.length };
      }),
    },
    pedagogicalActionItem: {
      findMany: vi.fn(async () => {
        return hoisted.state.db.actionItems.map((ai) => ({
          ...ai,
          minute: hoisted.state.db.minutes.find((m) => m.id === ai.minuteId) || null,
        }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const ai = hoisted.state.db.actionItems.find((item) => item.id === where.id);
        if (!ai) return null;
        return {
          ...ai,
          minute: hoisted.state.db.minutes.find((m) => m.id === ai.minuteId) || null,
        };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const ai = hoisted.state.db.actionItems.find(
          (item) => item.id === where.id && item.minuteId === where.minuteId
        );
        if (!ai) return null;
        return {
          ...ai,
          minute: hoisted.state.db.minutes.find((m) => m.id === ai.minuteId) || null,
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = hoisted.state.db.actionItems.findIndex((item) => item.id === where.id);
        hoisted.state.db.actionItems[idx] = { ...hoisted.state.db.actionItems[idx], ...data };
        return hoisted.state.db.actionItems[idx];
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    pedagogicalMinuteAddendum: {
      create: vi.fn(async ({ data }: any) => ({ id: "add-1", ...data })),
    },
  });

  return { prisma: getClient() };
});

import { verifyServerSigningPin, hashPin } from "@/lib/signingPin";
import { stripParticipantSecrets, validatePngSignatureDataUrl } from "@/lib/ataCrypto";
import { getCurrentBrasiliaYear } from "@/services/ataFinalizationService";
import { GET as getAtas, POST as postAtas } from "@/app/api/atas/route";
import { PATCH as patchAta } from "@/app/api/atas/[id]/route";
import { POST as finalizeAta } from "@/app/api/atas/[id]/finalize/route";
import { POST as voidAta } from "@/app/api/atas/[id]/void/route";
import { POST as addAddendum } from "@/app/api/atas/[id]/addendums/route";
import { POST as postPhysicalScan, DELETE as deletePhysicalScan } from "@/app/api/atas/[id]/physical-scan/route";
import { PATCH as patchActionDirect } from "@/app/api/atas/actions/[id]/route";
import { PATCH as patchActionNested } from "@/app/api/atas/[id]/actions/[actionId]/route";
import { POST as postMobileSign } from "@/app/api/atas/sign-token/[token]/route";
import EncaminhamentosPage from "@/app/encaminhamentos/page";
import LivroAnualPage from "@/app/atas/livro/[ano]/page";
import ValidarAtaPage from "@/app/validar/ata/[code]/page";
import AssinarAtaPage from "@/app/assinar/ata/[token]/page";
import { prisma } from "@/lib/prisma";

describe("Remediação Setorial do Setor C (Itens [C1] a [C5])", () => {
  beforeEach(async () => {
    hoisted.state.auditLogs = [];
    hoisted.state.rateLimitOverrides.clear();
    hoisted.state.updateManyForceZero = false;

    const pinHash = await hashPin("8391");
    hoisted.state.session = {
      user: {
        id: "usr-pedagoga-1",
        name: "Pedagoga Clara",
        email: "clara@escola.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "escola-a",
        active: true,
        schools: [{ schoolId: "escola-a", role: "PEDAGOGA", active: true }],
      },
    };

    hoisted.state.db = {
      users: [
        {
          id: "usr-pedagoga-1",
          email: "clara@escola.pr.gov.br",
          signingPinHash: pinHash,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
        {
          id: "usr-gestor-1",
          email: "diretor@escola.pr.gov.br",
          signingPinHash: pinHash,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      ],
      students: [{ id: "stu-1", name: "Lucas Mendes", schoolId: "escola-a", cgm: "1001" }],
      classGroups: [{ id: "cg-1", name: "6º Ano A", schoolId: "escola-a", shift: "MANHA" }],
      minutes: [
        {
          id: "min-draft-public",
          schoolId: "escola-a",
          year: 2026,
          ataNumber: null,
          status: "DRAFT",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          isConfidential: false,
          attendedAt: new Date("2026-11-18T12:00:00Z"),
          subject: "Atendimento Regular",
          summary: "Atendimento regular registrado em rascunho pedagógico.",
          authorId: "usr-pedagoga-1",
          authorEmail: "clara@escola.pr.gov.br",
          authorName: "Pedagoga Clara",
          contentHash: null,
        },
        {
          id: "min-conf-draft",
          schoolId: "escola-a",
          year: 2026,
          ataNumber: null,
          status: "DRAFT",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          isConfidential: true,
          attendedAt: new Date("2026-11-18T12:00:00Z"),
          subject: "Caso Sigiloso Confidencial",
          summary: "Detalhes sigilosos sob tutela restrita ECA.",
          authorId: "usr-gestor-1",
          authorEmail: "diretor@escola.pr.gov.br",
          authorName: "Diretor Marcos",
          contentHash: null,
        },
        {
          id: "min-conf-fin",
          schoolId: "escola-a",
          year: 2026,
          ataNumber: 12,
          status: "FINALIZED",
          category: "CONSELHO_TUTELAR",
          isConfidential: true,
          attendedAt: new Date("2026-11-10T12:00:00Z"),
          subject: "Ata Sigilosa Finalizada",
          summary: "Relato sigiloso protegido ECA.",
          authorId: "usr-gestor-1",
          authorEmail: "diretor@escola.pr.gov.br",
          authorName: "Diretor Marcos",
          contentHash: "a".repeat(64),
          verificationCode: "VRF-CONF-12",
        },
        {
          id: "min-pub-fin",
          schoolId: "escola-a",
          year: 2026,
          ataNumber: 13,
          status: "FINALIZED",
          category: "FREQUENCIA",
          isConfidential: false,
          attendedAt: new Date("2026-11-11T12:00:00Z"),
          subject: "Ata Pública Finalizada",
          summary: "Acompanhamento de frequência regular.",
          authorId: "usr-pedagoga-1",
          authorEmail: "clara@escola.pr.gov.br",
          authorName: "Pedagoga Clara",
          contentHash: "b".repeat(64),
          verificationCode: "VRF-PUB-13",
        },
      ],
      minuteStudents: [],
      minuteParticipants: [
        {
          id: "part-draft-1",
          minuteId: "min-draft-public",
          role: "RESPONSAVEL",
          name: "Responsável Maria",
          signatureMode: "PENDING",
          signatureData: null,
          hasSignature: false,
          hasActiveSignLink: true,
          mobileSignToken: "tok-segredo-ativo-999",
          mobileSignExpiresAt: new Date(Date.now() + 600_000),
          signedAt: null,
        },
        {
          id: "part-oauth-1",
          minuteId: "min-draft-public",
          role: "PROFESSOR",
          name: "Professora Mariana",
          expectedEmail: "docente@escola.pr.gov.br",
          signatureMode: "PENDING",
          signatureData: null,
          hasSignature: false,
          hasActiveSignLink: true,
          mobileSignToken: "tok-oauth-123",
          mobileSignExpiresAt: new Date(Date.now() + 600_000),
          signedAt: null,
        },
      ],
      actionItems: [
        {
          id: "act-conf-1",
          minuteId: "min-conf-fin",
          description: "Encaminhamento confidencial protegido",
          responsible: "DIRECAO",
          status: "PENDING",
          dueDate: new Date("2026-11-25T12:00:00Z"),
        },
        {
          id: "act-pub-1",
          minuteId: "min-pub-fin",
          description: "Encaminhamento público comum",
          responsible: "FAMILIA",
          status: "PENDING",
          dueDate: new Date("2026-11-25T12:00:00Z"),
        },
      ],
      addendums: [],
    };
  });

  it("[C1-01] verifyServerSigningPin opera em fail-closed para userId ausente, mock incompleto ou usuário inexistente", async () => {
    const resNoUser = await verifyServerSigningPin(prisma, undefined, "8391");
    expect(resNoUser).toEqual({
      ok: false,
      status: 401,
      error: "PIN_REQUIRED: Confirmação de autoria por PIN obrigatória.",
    });

    const resPartialPrisma = await verifyServerSigningPin({}, "usr-pedagoga-1", "8391");
    expect(resPartialPrisma.ok).toBe(false);
    expect(resPartialPrisma.status).toBe(401);

    const resUnknownUser = await verifyServerSigningPin(prisma, "usr-inexistente", "8391");
    expect(resUnknownUser.ok).toBe(false);
    expect(resUnknownUser.status).toBe(401);
  });

  it("[C1-02 & C1-03] /void usa transação com advisory lock, grava SIGNING_PIN_LOCKOUT em /void e /addendums, e usa ano de Brasília", async () => {
    // 2027-01-01T01:30:00Z = 2026-12-31 22:30 BRT (America/Sao_Paulo) -> deve ser 2026
    expect(getCurrentBrasiliaYear(new Date("2027-01-01T01:30:00.000Z"))).toBe(2026);

    hoisted.state.session = {
      user: {
        id: "usr-gestor-1",
        name: "Diretor Marcos",
        email: "diretor@escola.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "escola-a",
        active: true,
        schools: [{ schoolId: "escola-a", role: "GESTOR_ESCOLAR", active: true }],
      },
    };

    // Lockout 429 em /void grava AuditLog
    hoisted.state.rateLimitOverrides.set("pin-fail:usr-gestor-1", {
      success: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 900,
    });

    const voidLockRes = await voidAta(
      new Request("http://localhost:3000/api/atas/min-pub-fin/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelamento com motivo completo e detalhado", signingPin: "0000" }),
      }),
      { params: Promise.resolve({ id: "min-pub-fin" }) }
    );
    expect(voidLockRes.status).toBe(429);
    expect(hoisted.state.auditLogs.some((l) => l.action === "SIGNING_PIN_LOCKOUT")).toBe(true);

    // Lockout 429 em /addendums grava AuditLog
    hoisted.state.auditLogs = [];
    const addLockRes = await addAddendum(
      new Request("http://localhost:3000/api/atas/min-pub-fin/addendums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Em tempo: retifica-se horário do registro.", signingPin: "0000" }),
      }),
      { params: Promise.resolve({ id: "min-pub-fin" }) }
    );
    expect(addLockRes.status).toBe(429);
    expect(hoisted.state.auditLogs.some((l) => l.action === "SIGNING_PIN_LOCKOUT")).toBe(true);

    // Sucesso de /void executa $transaction + advisory lock
    hoisted.state.rateLimitOverrides.clear();
    const voidOkRes = await voidAta(
      new Request("http://localhost:3000/api/atas/min-pub-fin/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Ata substituída por erro material formal", signingPin: "8391" }),
      }),
      { params: Promise.resolve({ id: "min-pub-fin" }) }
    );
    expect(voidOkRes.status).toBe(200);
    expect((prisma as any).$transaction).toHaveBeenCalled();
  });

  it("[C5-01] stripParticipantSecrets remove mobileSignToken e mobileSignExpiresAt em POST, PATCH e finalize", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
    try {
      for (const p of hoisted.state.db.minuteParticipants) {
        if (p.minuteId === "min-draft-public" && p.hasActiveSignLink) {
          p.mobileSignExpiresAt = new Date(Date.now() + 600_000);
        }
      }

      const emptyMinute = { id: "m1", participants: [] };
      expect(stripParticipantSecrets(emptyMinute)).toBe(emptyMinute);

      // 1. POST /api/atas
      const createRes = await postAtas(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: "Novo Rascunho",
            summary: "Texto inicial.",
            studentIds: ["stu-1"],
            participants: [{ role: "RESPONSAVEL", name: "Pai Teste" }],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const createJson = await createRes.json();
      expect(createJson.minute.participants[0].mobileSignToken).toBeUndefined();
      expect(createJson.minute.participants[0].mobileSignExpiresAt).toBeUndefined();

      // 2. PATCH /api/atas/[id]
      const patchRes = await patchAta(
        new Request("http://localhost:3000/api/atas/min-draft-public", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: "Atendimento Regular Atualizado",
            participants: [{ id: "part-draft-1", role: "RESPONSAVEL", name: "Responsável Maria" }],
          }),
        }),
        { params: Promise.resolve({ id: "min-draft-public" }) }
      );
      expect(patchRes.status).toBe(200);
      const patchJson = await patchRes.json();
      expect(patchJson.minute.participants[0].mobileSignToken).toBeUndefined();
      expect(patchJson.minute.participants[0].mobileSignExpiresAt).toBeUndefined();
      expect(patchJson.minute.participants[0].hasActiveSignLink).toBe(true);

      // 3. POST /api/atas/[id]/finalize (novo e idempotente)
      const finRes = await finalizeAta(
        new Request("http://localhost:3000/api/atas/min-draft-public/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signingPin: "8391",
            summary: "Texto completo de encerramento pedagógico validado.",
          }),
        }),
        { params: Promise.resolve({ id: "min-draft-public" }) }
      );
      expect(finRes.status).toBe(200);
      const finJson = await finRes.json();
      expect(finJson.minute.participants.length).toBeGreaterThan(0);
      for (const p of finJson.minute.participants) {
        expect(p.mobileSignToken).toBeUndefined();
        expect(p.mobileSignExpiresAt).toBeUndefined();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("[C4-01, C5-02 & C5-03] Blindagem integral de sigilo ECA em SSR, mutações e busca", async () => {
    // 1. SSR /encaminhamentos oculta encaminhamento de ata sigilosa de outro autor
    const encPage: any = await EncaminhamentosPage();
    expect(encPage.props.initialActionItems).toHaveLength(1);
    expect(encPage.props.initialActionItems[0].id).toBe("act-pub-1");
    expect(encPage.props.initialMetrics.total).toBe(1);

    // 2. Listagem sem q mascara subject/students/participants; busca q exclui ata sigilosa sem acesso
    const listRes = await getAtas(new Request("http://localhost:3000/api/atas?year=2026"));
    const listJson = await listRes.json();
    const confListed = listJson.minutes.find((m: any) => m.id === "min-conf-fin");
    expect(confListed.subject).toBe("Atendimento sob sigilo institucional");
    expect(confListed.students).toEqual([]);
    expect(confListed.participants).toEqual([]);
    expect(confListed.restrictedConfidential).toBe(true);

    const searchRes = await getAtas(new Request("http://localhost:3000/api/atas?year=2026&q=sigiloso"));
    const searchJson = await searchRes.json();
    expect(searchJson.minutes.some((m: any) => m.isConfidential)).toBe(false);

    // 3. LivroAnualPage também mascara subject/students/participants
    const livroPage: any = await LivroAnualPage({ params: Promise.resolve({ ano: "2026" }) });
    const confLivro = livroPage.props.minutes.find((m: any) => m.id === "min-conf-fin");
    expect(confLivro.subject).toBe("Atendimento sob sigilo institucional");
    expect(confLivro.participants).toEqual([]);

    // 4. Todas as mutações retornam 403 para pedagoga não-autora em ata isConfidential
    const patchConf = await patchAta(
      new Request("http://localhost:3000/api/atas/min-conf-draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: "Tentativa indevida" }),
      }),
      { params: Promise.resolve({ id: "min-conf-draft" }) }
    );
    expect(patchConf.status).toBe(403);

    const finConf = await finalizeAta(
      new Request("http://localhost:3000/api/atas/min-conf-draft/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signingPin: "8391", summary: "Tentativa de lavrar sigilo" }),
      }),
      { params: Promise.resolve({ id: "min-conf-draft" }) }
    );
    expect(finConf.status).toBe(403);

    const addConf = await addAddendum(
      new Request("http://localhost:3000/api/atas/min-conf-fin/addendums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Tentativa de aditamento sigiloso", signingPin: "8391" }),
      }),
      { params: Promise.resolve({ id: "min-conf-fin" }) }
    );
    expect(addConf.status).toBe(403);

    const scanPostConf = await postPhysicalScan(
      new Request("http://localhost:3000/api/atas/min-conf-fin/physical-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanData: VALID_PNG_DATA_URL }),
      }),
      { params: Promise.resolve({ id: "min-conf-fin" }) }
    );
    expect(scanPostConf.status).toBe(403);

    const scanDelConf = await deletePhysicalScan(
      new Request("http://localhost:3000/api/atas/min-conf-draft/physical-scan", { method: "DELETE" }),
      { params: Promise.resolve({ id: "min-conf-draft" }) }
    );
    expect(scanDelConf.status).toBe(403);

    const actDirectConf = await patchActionDirect(
      new Request("http://localhost:3000/api/atas/actions/act-conf-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      }),
      { params: Promise.resolve({ id: "act-conf-1" }) }
    );
    expect(actDirectConf.status).toBe(403);

    const actNestedConf = await patchActionNested(
      new Request("http://localhost:3000/api/atas/min-conf-fin/actions/act-conf-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      }),
      { params: Promise.resolve({ id: "min-conf-fin", actionId: "act-conf-1" }) }
    );
    expect(actNestedConf.status).toBe(403);
  });

  it("[C4-02 & C4-03] Bloqueia physicalSignedScanData no PATCH de rascunho e retorna 400 para magic bytes inválidos em physical-scan", async () => {
    const patchBypassRes = await patchAta(
      new Request("http://localhost:3000/api/atas/min-draft-public", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Tentativa bypass scan",
          physicalSignedScanData: VALID_PNG_DATA_URL,
        }),
      }),
      { params: Promise.resolve({ id: "min-draft-public" }) }
    );
    expect(patchBypassRes.status).toBe(400);

    // HTML disfarçado com prefixo application/pdf deve retornar 400 (não 500)
    const spoofedPdfRes = await postPhysicalScan(
      new Request("http://localhost:3000/api/atas/min-pub-fin/physical-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanData: "data:application/pdf;base64,PGh0bWw+PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0PjwvaHRtbD4=",
        }),
      }),
      { params: Promise.resolve({ id: "min-pub-fin" }) }
    );
    expect(spoofedPdfRes.status).toBe(400);
  });

  it("[C2-01, C2-02, C2-03 & C3-01] Magic bytes PNG em sign-token, updateMany no Fluxo A, kinship anti-bypass e rate limit em SSR público", async () => {
    // 1. validatePngSignatureDataUrl valida magic bytes reais
    expect(validatePngSignatureDataUrl("data:image/png;base64,AAAAAAAAAAAAAAAAAAAA").ok).toBe(false);
    expect(validatePngSignatureDataUrl(VALID_PNG_DATA_URL).ok).toBe(true);

    // 2. POST /api/atas/sign-token/[token] rejeita PNG com bytes falsos
    const fakeBytesRes = await postMobileSign(
      new Request("http://localhost:3000/api/atas/sign-token/tok-segredo-ativo-999", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAA" }),
      }),
      { params: Promise.resolve({ token: "tok-segredo-ativo-999" }) }
    );
    expect(fakeBytesRes.status).toBe(400);

    // 3. Fluxo A (ESCOLA_OAUTH) usa updateMany atômico e retorna 409 em colisão simultânea
    hoisted.state.updateManyForceZero = true;
    const oauthRaceRes = await postMobileSign(
      new Request("http://localhost:3000/api/atas/sign-token/tok-oauth-123", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleIdToken: "mock-google-id-token" }),
      }),
      { params: Promise.resolve({ token: "tok-oauth-123" }) }
    );
    expect(oauthRaceRes.status).toBe(409);

    // 4. POST /api/atas não permite bypass de sanitizeKinshipForRole via biometricVerified: true sem assinatura
    const kinshipRes = await postAtas(
      new Request("http://localhost:3000/api/atas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Teste Kinship Anti-Bypass",
          studentIds: ["stu-1"],
          participants: [
            {
              role: "PROFESSOR",
              name: "Docente Teste",
              kinship: "Mãe",
              biometricVerified: true,
              verifiedEmail: "spoof@escola.pr.gov.br",
            },
          ],
        }),
      })
    );
    expect(kinshipRes.status).toBe(201);
    const kinshipJson = await kinshipRes.json();
    expect(kinshipJson.minute.participants[0].kinship).toBeNull();

    // 5. SSR Público (/validar/ata/[code] e /assinar/ata/[token]) aplica rate limit antes de consultar Prisma
    const findUniqueSpy = vi.mocked(prisma.pedagogicalMinute.findUnique);
    const partFindUniqueSpy = vi.mocked(prisma.pedagogicalMinuteParticipant.findUnique);
    findUniqueSpy.mockClear();
    partFindUniqueSpy.mockClear();

    hoisted.state.rateLimitOverrides.set("rl:public-ata-page:", {
      success: false,
      limit: 30,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 45,
    });
    const blockedValidateTree: any = await ValidarAtaPage({
      params: Promise.resolve({ code: "VRF-PUB-13" }),
    });
    expect(JSON.stringify(blockedValidateTree)).toContain("Limite de consultas excedido");
    expect(findUniqueSpy).not.toHaveBeenCalled();

    hoisted.state.rateLimitOverrides.set("rl:sign-token-page:", {
      success: false,
      limit: 15,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 45,
    });
    const blockedSignTree: any = await AssinarAtaPage({
      params: Promise.resolve({ token: "tok-segredo-ativo-999" }),
    });
    expect(JSON.stringify(blockedSignTree)).toContain("Limite de acessos excedido");
    expect(partFindUniqueSpy).not.toHaveBeenCalled();
  });

  it("[C6-01 — Regra 10] Arquivos de UI, PDF visível e mensagens de API do Setor C não exibem 'fé pública' nem afirmações jurídicas/técnicas proibidas", () => {
    const rootDir = process.cwd();
    const uiFiles = [
      "src/components/ata/SigningPinModal.tsx",
      "src/components/ata/AtaEditorModal.tsx",
      "src/components/ata/PhysicalScanModal.tsx",
      "src/app/atas/AtasClient.tsx",
      "src/app/assinar/ata/[token]/MobileSignClient.tsx",
      "src/app/assinar/ata/[token]/page.tsx",
      "src/app/validar/ata/[code]/page.tsx",
      "src/app/atas/[id]/imprimir/PrintPageClient.tsx",
      "src/app/atas/livro/[ano]/LivroAnualClient.tsx",
    ];

    const apiAndLibFiles = [
      "src/lib/signingPin.ts",
      "src/app/api/user/signing-pin/route.ts",
      "src/app/api/atas/[id]/route.ts",
      "src/app/api/atas/[id]/pdfa/route.ts",
      "src/app/api/atas/[id]/physical-scan/route.ts",
    ];

    const stripComments = (src: string) =>
      src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    for (const relPath of uiFiles) {
      const fullPath = path.join(rootDir, relPath);
      const code = stripComments(fs.readFileSync(fullPath, "utf-8"));
      expect(code, `${relPath} ainda contém "fé pública"`).not.toMatch(/f[ée]\s+p[úu]blica/i);
      expect(code, `${relPath} ainda contém "imutável"`).not.toMatch(/imut[áa]vel/i);
      expect(code, `${relPath} ainda contém citação à Lei 14.063`).not.toMatch(/14\.063/i);
      expect(code, `${relPath} ainda contém citação a artigo do ECA`).not.toMatch(/ECA\s+Art/i);
      expect(code, `${relPath} ainda contém "ISO 19005-1"`).not.toMatch(/ISO\s+19005-1/i);
    }

    for (const relPath of apiAndLibFiles) {
      const fullPath = path.join(rootDir, relPath);
      const code = stripComments(fs.readFileSync(fullPath, "utf-8"));
      expect(code, `${relPath} ainda contém "fé pública"`).not.toMatch(/f[ée]\s+p[úu]blica/i);
      expect(code, `${relPath} ainda contém "imutável"`).not.toMatch(/imut[áa]vel/i);
      expect(code, `${relPath} ainda contém citação à Lei 14.063`).not.toMatch(/14\.063/i);
      expect(code, `${relPath} ainda contém citação a artigo do ECA`).not.toMatch(/ECA\s+Art/i);
    }

    const pdfGenSrc = fs.readFileSync(path.join(rootDir, "src/lib/ataPdfArchive.ts"), "utf-8");
    const pdfCodeWithoutComments = stripComments(pdfGenSrc);
    expect(pdfCodeWithoutComments).not.toMatch(/f[ée]\s+p[úu]blica/i);
    expect(pdfCodeWithoutComments).not.toMatch(/14\.063/i);
    expect(pdfCodeWithoutComments).not.toMatch(/ESTATUTO DA CRIANÇA E DO ADOLESCENTE, ART\./i);
    expect(pdfCodeWithoutComments).toContain("<pdfaid:part>1</pdfaid:part>");
    expect(pdfCodeWithoutComments).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(pdfCodeWithoutComments).toContain("GTS_PDFA1");
    expect(pdfCodeWithoutComments).toContain("sRGB IEC61966-2.1");
  });
});
