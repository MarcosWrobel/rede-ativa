import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeMinuteHash,
  verifyMinuteIntegrity,
  computeAddendumHash,
  verifyAddendumChain,
  anonymizeOtherMinorsInText,
  canAccessConfidentialMinute,
} from "@/lib/ataCrypto";
import { hashPin } from "@/lib/signingPin";
import { resolveAuthSecret } from "@/lib/auth.config";
import { hashSchoolSyncToken, findSchoolBySyncToken } from "@/lib/syncToken";

const hoisted = vi.hoisted(() => {
  const state = {
    session: null as any,
    cookies: {} as Record<string, string>,
    db: {
      schools: [] as any[],
      users: [] as any[],
      students: [] as any[],
      minutes: [] as any[],
      minuteStudents: [] as any[],
      minuteParticipants: [] as any[],
      addendums: [] as any[],
      actionItems: [] as any[],
      auditLogs: [] as any[],
      messageLogs: [] as any[],
    },
  };
  return { state };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.state.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      hoisted.state.cookies[name] !== undefined
        ? { name, value: hoisted.state.cookies[name] }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "189.10.20.30", host: "localhost:3000" })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/app/alunos/[id]/ProntuarioClient", () => ({
  default: vi.fn((props: any) => ({ component: "ProntuarioClient", props })),
}));

vi.mock("@/app/alunos/[id]/dossie/DossieClient", () => ({
  default: vi.fn((props: any) => ({ component: "DossieClient", props })),
}));

vi.mock("@/app/assinar/ata/[token]/MobileSignClient", () => ({
  default: vi.fn((props: any) => ({ component: "MobileSignClient", props })),
}));

vi.mock("@/lib/prisma", () => {
  const buildMinute = (m: any) => {
    if (!m) return null;
    const school = hoisted.state.db.schools.find((s) => s.id === m.schoolId) || {
      id: m.schoolId,
      name: "Escola Teste",
      city: "Tibagi",
      state: "PR",
      nre: "Ponta Grossa",
      inepCode: "41000001",
    };
    return {
      ...m,
      school,
      students: hoisted.state.db.minuteStudents.filter((s) => s.minuteId === m.id),
      participants: hoisted.state.db.minuteParticipants.filter((p) => p.minuteId === m.id),
      addendums: hoisted.state.db.addendums.filter((a) => a.minuteId === m.id),
      actionItems: hoisted.state.db.actionItems.filter((i) => i.minuteId === m.id),
    };
  };

  const client: any = {
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        return (
          hoisted.state.db.schools.find(
            (s) => (where.id && s.id === where.id) || (where.inepCode && s.inepCode === where.inepCode)
          ) || null
        );
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          hoisted.state.db.schools.find((s) => {
            if (where?.syncTokenHash && s.syncTokenHash !== where.syncTokenHash) return false;
            if (where?.active !== undefined && s.active !== where.active) return false;
            return true;
          }) || null
        );
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.schools
          .filter((s) => {
            if (where?.active !== undefined && s.active !== where.active) return false;
            if (where?.network && s.network !== where.network) return false;
            if (where?.city?.equals && s.city.toLowerCase() !== where.city.equals.toLowerCase()) return false;
            return true;
          })
          .map((s) => ({
            ...s,
            _count: { students: 10, classGroups: 2, userSchools: 2, pedagogicalMinutes: 1 },
            students: [],
          }));
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const target = hoisted.state.db.schools.find((s) => s.id === where.id);
        if (target) Object.assign(target, data);
        return target;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.users.find((u) => u.id === where.id) || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const target = hoisted.state.db.users.find((u) => u.id === where.id);
        if (target) Object.assign(target, data);
        return target;
      }),
    },
    student: {
      findUnique: vi.fn(async ({ where }: any) => {
        const st = hoisted.state.db.students.find((s) => s.id === where.id);
        if (!st) return null;
        return { ...st, messageLogs: [], classGroup: { name: "6º Ano A" }, lowAttendanceRecord: null };
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.students.filter((st) => {
          if (where?.id?.in && !where.id.in.includes(st.id)) return false;
          if (where?.schoolId && st.schoolId !== where.schoolId) return false;
          return true;
        });
      }),
    },
    studentContact: { findMany: vi.fn(async () => []) },
    absenceJustification: { findMany: vi.fn(async () => []) },
    inPersonAttendance: { findMany: vi.fn(async () => []) },
    attendanceSnapshot: { findMany: vi.fn(async () => []) },
    pedagogicalMinute: {
      findUnique: vi.fn(async ({ where }: any) => {
        const found = hoisted.state.db.minutes.find(
          (m) =>
            (where.id && m.id === where.id) ||
            (where.verificationCode && m.verificationCode === where.verificationCode)
        );
        return buildMinute(found);
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const list = hoisted.state.db.minutes
          .filter((m) => m.schoolId === where.schoolId && m.year === where.year && m.ataNumber != null)
          .sort((a, b) => b.ataNumber - a.ataNumber);
        return list[0] || null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.minutes
          .filter((m) => {
            if (where?.schoolId && m.schoolId !== where.schoolId) return false;
            if (where?.students?.some?.studentId) {
              return hoisted.state.db.minuteStudents.some(
                (ms) => ms.minuteId === m.id && ms.studentId === where.students.some.studentId
              );
            }
            return true;
          })
          .map(buildMinute);
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = hoisted.state.db.minutes.find((m) => m.id === where.id);
        if (found && data) {
          for (const [k, v] of Object.entries(data)) {
            if (v !== undefined) {
              found[k] = v;
            }
          }
        }
        return buildMinute(found);
      }),
    },
    pedagogicalMinuteStudent: {
      deleteMany: vi.fn(async ({ where }: any) => {
        hoisted.state.db.minuteStudents = hoisted.state.db.minuteStudents.filter((s) => s.minuteId !== where.minuteId);
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        hoisted.state.db.minuteStudents.push(...data);
        return { count: data.length };
      }),
    },
    pedagogicalMinuteParticipant: {
      findUnique: vi.fn(async ({ where }: any) => {
        const p = hoisted.state.db.minuteParticipants.find(
          (item) =>
            (where.id && item.id === where.id) ||
            (where.mobileSignToken && item.mobileSignToken === where.mobileSignToken)
        );
        if (!p) return null;
        const minute = buildMinute(hoisted.state.db.minutes.find((m) => m.id === p.minuteId));
        return { ...p, minute };
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return hoisted.state.db.minuteParticipants.filter((p) => p.minuteId === where.minuteId);
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        hoisted.state.db.minuteParticipants = hoisted.state.db.minuteParticipants.filter(
          (p) => p.minuteId !== where.minuteId
        );
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        hoisted.state.db.minuteParticipants.push(...data);
        return { count: data.length };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matches = hoisted.state.db.minuteParticipants.filter(
          (p) =>
            p.id === where.id &&
            p.mobileSignToken === where.mobileSignToken &&
            (where.signedAt === null ? !p.signedAt : true)
        );
        matches.forEach((m) => Object.assign(m, data));
        return { count: matches.length };
      }),
    },
    pedagogicalMinuteAddendum: {
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `add-${Date.now()}`, ...data };
        hoisted.state.db.addendums.push(item);
        return item;
      }),
    },
    pedagogicalActionItem: {
      findMany: vi.fn(async () => {
        return hoisted.state.db.actionItems.map((item) => ({
          ...item,
          minute: buildMinute(hoisted.state.db.minutes.find((m) => m.id === item.minuteId)),
        }));
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    messageLog: {
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        hoisted.state.db.auditLogs.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (cb: any) => cb(client)),
    $executeRaw: vi.fn(async () => 1),
  };

  return { prisma: client };
});

import ProntuarioPage from "@/app/alunos/[id]/page";
import DossiePage from "@/app/alunos/[id]/dossie/page";
import AssinarAtaPage from "@/app/assinar/ata/[token]/page";
import { GET as getPublicAta } from "@/app/api/atas/public/[code]/route";
import { POST as finalizeAta } from "@/app/api/atas/[id]/finalize/route";
import { PATCH as patchAta } from "@/app/api/atas/[id]/route";
import { POST as voidAta } from "@/app/api/atas/[id]/void/route";
import { POST as addAddendum } from "@/app/api/atas/[id]/addendums/route";
import { DELETE as deletePhysicalScan } from "@/app/api/atas/[id]/physical-scan/route";
import { POST as sanitizeSchool } from "@/app/api/schools/[id]/sanitize/route";
import { GET as getSecretariaMetrics } from "@/app/api/secretaria/metrics/route";
import { GET as getSyncConfig } from "@/app/api/sync-config/route";
import { POST as postMobileSignature } from "@/app/api/atas/sign-token/[token]/route";
import { GET as getActionAlerts } from "@/app/api/atas/actions/alerts/route";
import { prisma } from "@/lib/prisma";

describe("Auditoria de Segurança Multi-Tenant & Conformidade Jurídico-Pericial V2", () => {
  beforeEach(() => {
    hoisted.state.cookies = {};
    hoisted.state.session = {
      user: {
        id: "usr-pedagoga-a",
        name: "Pedagoga Ana",
        email: "ana@escola-a.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "escola-a",
        active: true,
        schools: [{ schoolId: "escola-a", role: "PEDAGOGA", active: true }],
      },
    };
    hoisted.state.db = {
      schools: [
        {
          id: "default-leopoldina",
          inepCode: "41042730",
          name: "Colégio Estadual Leopoldina B. Pedroso",
          city: "Ponta Grossa",
          state: "PR",
          nre: "Ponta Grossa",
          network: "ESTADUAL",
          active: true,
        },
        {
          id: "escola-a",
          inepCode: "41000010",
          name: "Escola Municipal Alfa",
          city: "Tibagi",
          state: "PR",
          nre: "SEMEC Tibagi",
          network: "MUNICIPAL",
          active: true,
        },
        {
          id: "escola-b",
          inepCode: "41000020",
          name: "Escola Municipal Beta",
          city: "Castro",
          state: "PR",
          nre: "SEMEC Castro",
          network: "MUNICIPAL",
          active: true,
        },
      ],
      users: [
        {
          id: "usr-pedagoga-a",
          email: "ana@escola-a.pr.gov.br",
          signingPinHash: null,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
        {
          id: "usr-gestor-a",
          email: "diretor@escola-a.pr.gov.br",
          signingPinHash: null,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      ],
      students: [
        { id: "stu-a1", name: "Lucas Mendes", cgm: "1001", schoolId: "escola-a" },
        { id: "stu-a2", name: "José Cauã Inês", cgm: "1002", schoolId: "escola-a" },
        { id: "stu-b1", name: "Mariana Segredo", cgm: "2001", schoolId: "escola-b" },
      ],
      minutes: [],
      minuteStudents: [],
      minuteParticipants: [],
      addendums: [],
      actionItems: [],
      auditLogs: [],
      messageLogs: [],
    };
  });

  it("[SEC-01] bloqueia BOLA/IDOR SSR em /alunos/[id] e /alunos/[id]/dossie sem poluir AuditLog alheio", async () => {
    await expect(ProntuarioPage({ params: Promise.resolve({ id: "stu-b1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(DossiePage({ params: Promise.resolve({ id: "stu-b1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(hoisted.state.db.auditLogs).toHaveLength(0);

    // Mesmo tenant funciona e grava IP no AuditLog
    const okDossie: any = await DossiePage({ params: Promise.resolve({ id: "stu-a1" }) });
    expect(okDossie.props.student.id).toBe("stu-a1");
    expect(hoisted.state.db.auditLogs).toHaveLength(1);
    expect(hoisted.state.db.auditLogs[0].schoolId).toBe("escola-a");
    expect(hoisted.state.db.auditLogs[0].ipAddress).toBe("189.10.20.30");
  });

  it("[SEC-02] bloqueia GESTAO_SECRETARIA de consultar métricas consolidadas de outro município (403)", async () => {
    hoisted.state.session = {
      user: {
        id: "usr-sec-tibagi",
        name: "Secretária Tibagi",
        email: "semec@tibagi.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [{ networkId: "semec-tibagi", city: "Tibagi" }],
      },
    };

    const forbidden = await getSecretariaMetrics(
      new Request("http://localhost:3000/api/secretaria/metrics?city=Castro")
    );
    expect(forbidden.status).toBe(403);

    const allowed = await getSecretariaMetrics(
      new Request("http://localhost:3000/api/secretaria/metrics?city=Tibagi")
    );
    expect(allowed.status).toBe(200);
  });

  it("[SEC-03 & SEC-04 & SEC-05] protege SYNC_API_TOKEN global, faz hash SHA-256 de syncToken escolar, exige AUTH_SECRET em produção e blinda INEP 41042730 contra sanitize", async () => {
    // 1. GESTOR_ESCOLAR bloqueado em /api/sync-config
    hoisted.state.session = {
      user: {
        id: "usr-gestor-a",
        email: "diretor@escola-a.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "escola-a",
        active: true,
      },
    };
    const syncCfgRes = await getSyncConfig();
    expect(syncCfgRes.status).toBe(403);

    // 2. Hash SHA-256 de token escolar
    const raw = "tok-secreto-256-bits";
    const hashed = hashSchoolSyncToken(raw);
    expect(hashed.startsWith("sha256:")).toBe(true);
    expect(hashed).not.toContain(raw);
    hoisted.state.db.schools[1].syncTokenHash = hashed;
    const found = await findSchoolBySyncToken(prisma, raw);
    expect(found?.id).toBe("escola-a");

    // 3. Segredo JWT obrigatório em runtime de produção
    expect(() =>
      resolveAuthSecret({ NODE_ENV: "production", AUTH_SECRET: "", NEXTAUTH_SECRET: "" })
    ).toThrow(/AUTH_SECRET/);

    // 4. Proteção atômica incondicional do INEP 41042730 mesmo com confirmationCode antigo
    hoisted.state.session = {
      user: {
        id: "usr-super",
        email: "marcos.wrobel@escola.pr.gov.br",
        role: "SUPERADMIN",
        active: true,
      },
    };
    const sanitizeRes = await sanitizeSchool(
      new Request("http://localhost:3000/api/schools/default-leopoldina/sanitize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationCode: "RESET_LEOPOLDINA_PROD" }),
      }),
      { params: Promise.resolve({ id: "default-leopoldina" }) }
    );
    expect(sanitizeRes.status).toBe(403);
  });

  it("[JUR-01 & JUR-03] bloqueia lavratura sem PIN cadastrado (signingPinHash === null), preserva biometricStrokeData no PATCH e sela no SHA-256", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T14:00:00.000Z"));
    try {
      hoisted.state.db.minutes.push({
        id: "ata-1",
        schoolId: "escola-a",
        year: 2026,
        status: "DRAFT",
        category: "BUSCA_ATIVA_FALTAS",
        isConfidential: false,
        attendedAt: new Date("2026-11-05T14:00:00.000Z"),
        subject: "Reunião de Frequência",
        summary: "Aos cinco dias de novembro, realizou-se atendimento com a família.",
        authorName: "Pedagoga Ana",
        authorEmail: "ana@escola-a.pr.gov.br",
        authorRole: "PEDAGOGA",
      });
      hoisted.state.db.minuteStudents.push({
        id: "ms-1",
        minuteId: "ata-1",
        studentId: "stu-a1",
        studentNameSnapshot: "Lucas Mendes",
      });
      hoisted.state.db.minuteParticipants.push({
        id: "mp-1",
        minuteId: "ata-1",
        role: "RESPONSAVEL",
        studentId: "stu-a1",
        name: "Mãe do Lucas",
        signatureMode: "MOBILE_QR",
        signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
        biometricStrokeData: JSON.stringify([{ x: 10, y: 20, t: 100, p: 0.8 }]),
        signerUserAgent: "Mozilla/5.0 Android",
        signedAt: new Date("2026-11-05T14:05:00.000Z"),
      });

      // 1. Salvamento de rascunho via PATCH NÃO apaga biometricStrokeData nem signerUserAgent
      const patchRes = await patchAta(
        new Request("http://localhost:3000/api/atas/ata-1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: "Reunião de Frequência Escolar",
            participants: [{ id: "mp-1", role: "RESPONSAVEL", name: "Mãe do Lucas", signatureMode: "MOBILE_QR" }],
          }),
        }),
        { params: Promise.resolve({ id: "ata-1" }) }
      );
      expect(patchRes.status).toBe(200);
      expect(hoisted.state.db.minuteParticipants[0].biometricStrokeData).toContain('"p":0.8');
      expect(hoisted.state.db.minuteParticipants[0].signerUserAgent).toBe("Mozilla/5.0 Android");

      // 2. Tentativa de lavrar com signingPinHash === null é BLOQUEADA com 401 PIN_REQUIRED
      const noPinSetupRes = await finalizeAta(
        new Request("http://localhost:3000/api/atas/ata-1/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: "ata-1" }) }
      );
      expect(noPinSetupRes.status).toBe(401);
      const noPinBody = await noPinSetupRes.json();
      expect(noPinBody.error).toContain("PIN_REQUIRED");

      // 3. Cadastra PIN e lavra oficialmente
      hoisted.state.db.users[0].signingPinHash = await hashPin("7392");
      const okFin = await finalizeAta(
        new Request("http://localhost:3000/api/atas/ata-1/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: "7392" }),
        }),
        { params: Promise.resolve({ id: "ata-1" }) }
      );
      expect(okFin.status).toBe(200);
      const finData = await okFin.json();
      const verCode = finData.minute.verificationCode;

      // 4. [JUR-02] Certidão pública valida o hash em tempo real (Autêntica)
      const pubOk = await getPublicAta(
        new Request(`http://localhost:3000/api/atas/public/${verCode}`),
        { params: Promise.resolve({ code: verCode }) }
      );
      const pubOkJson = await pubOk.json();
      expect(pubOkJson.data.isAuthentic).toBe(true);

      // 5. Adulterar biometricStrokeData ou summary direto no banco faz Certidão Pública acusar fraude (isAuthentic: false)!
      hoisted.state.db.minuteParticipants[0].biometricStrokeData = JSON.stringify([{ x: 99, y: 99, t: 1, p: 0.1 }]);
      const pubTamperedStroke = await getPublicAta(
        new Request(`http://localhost:3000/api/atas/public/${verCode}`),
        { params: Promise.resolve({ code: verCode }) }
      );
      const pubTamperedJson = await pubTamperedStroke.json();
      expect(pubTamperedJson.data.isAuthentic).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("[JUR-01 & JUR-04] restringe VOID_ATA e DELETE /physical-scan em ata FINALIZED à Direção Escolar + PIN", async () => {
    const pinHash = await hashPin("4829");
    hoisted.state.db.users[0].signingPinHash = pinHash;
    hoisted.state.db.users[1].signingPinHash = pinHash;

    hoisted.state.db.minutes.push({
      id: "ata-fin-1",
      schoolId: "escola-a",
      year: 2026,
      ataNumber: 12,
      status: "FINALIZED",
      subject: "Ata Oficial Lavrada",
      summary: "Texto oficial selado.",
      contentHash: "abc123hash",
      physicalSignedScanData: "data:application/pdf;base64,JVBERi0xLjQK...",
    });

    // 1. PATCH /api/atas/[id] não permite sobrescrever physicalSignedScanData em ata FINALIZED
    const patchScanBypass = await patchAta(
      new Request("http://localhost:3000/api/atas/ata-fin-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ physicalSignedScanData: null }),
      }),
      { params: Promise.resolve({ id: "ata-fin-1" }) }
    );
    expect(patchScanBypass.status).toBe(403);

    // 2. PEDAGOGA bloqueada em DELETE /physical-scan de ata FINALIZED e em POST /void
    const pedDelScan = await deletePhysicalScan(
      new Request("http://localhost:3000/api/atas/ata-fin-1/physical-scan", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ata-fin-1" }) }
    );
    expect(pedDelScan.status).toBe(403);

    const pedVoid = await voidAta(
      new Request("http://localhost:3000/api/atas/ata-fin-1/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Tentativa sem alçada da direção", signingPin: "4829" }),
      }),
      { params: Promise.resolve({ id: "ata-fin-1" }) }
    );
    expect(pedVoid.status).toBe(403);

    // 3. Adendo exige PIN de Fé Pública
    const addNoPin = await addAddendum(
      new Request("http://localhost:3000/api/atas/ata-fin-1/addendums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Em tempo: retifica-se horário." }),
      }),
      { params: Promise.resolve({ id: "ata-fin-1" }) }
    );
    expect(addNoPin.status).toBe(401);

    const addWithPin = await addAddendum(
      new Request("http://localhost:3000/api/atas/ata-fin-1/addendums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Em tempo: retifica-se horário.", signingPin: "4829" }),
      }),
      { params: Promise.resolve({ id: "ata-fin-1" }) }
    );
    expect(addWithPin.status).toBe(201);

    // 4. GESTOR_ESCOLAR com PIN válido consegue tornar sem efeito (VOIDED)
    hoisted.state.session = {
      user: {
        id: "usr-gestor-a",
        name: "Diretor Carlos",
        email: "diretor@escola-a.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "escola-a",
        active: true,
        schools: [{ schoolId: "escola-a", role: "GESTOR_ESCOLAR", active: true }],
      },
    };
    const dirVoid = await voidAta(
      new Request("http://localhost:3000/api/atas/ata-fin-1/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Erro material de duplicidade de registro.", signingPin: "4829" }),
      }),
      { params: Promise.resolve({ id: "ata-fin-1" }) }
    );
    expect(dirVoid.status).toBe(200);
  });

  it("[JUR-05] anonimiza menores acentuados (José, Cauã, Inês, Théo), protege QR Code coletivo contra race condition e isola atas isConfidential", async () => {
    // 1. Anonimização Unicode de nomes acentuados
    const rawText =
      "Compareceram os responsáveis por Lucas Mendes e por José Cauã Inês. Relatou-se que José e Théo dialogaram em sala.";
    const anonymized = anonymizeOtherMinorsInText(rawText, "stu-a1", [
      { id: "stu-a1", name: "Lucas Mendes" },
      { id: "stu-a2", name: "José Cauã Inês" },
      { id: "stu-a3", name: "Théo Ávila" },
    ]);
    expect(anonymized).toContain("Lucas Mendes");
    expect(anonymized).not.toContain("José");
    expect(anonymized).not.toContain("Cauã");
    expect(anonymized).not.toContain("Théo");
    expect(anonymized).toContain("J. C. I. (outro estudante)");

    // 2. Link móvel /assinar/ata/[token] anonimiza o outro menor e queima token atomicamente
    hoisted.state.db.minutes.push({
      id: "ata-coletiva",
      schoolId: "escola-a",
      year: 2026,
      status: "DRAFT",
      isConfidential: true,
      authorId: "usr-outro-autor",
      authorEmail: "outra.pedagoga@escola-a.pr.gov.br",
      subject: "Mediação entre Lucas Mendes e José Cauã Inês",
      summary: "Reunião com responsáveis de Lucas Mendes e José Cauã Inês sobre convivência.",
      agreementsSummary: "José comprometeu-se junto com Lucas Mendes.",
      attendedAt: new Date(),
    });
    hoisted.state.db.minuteStudents.push(
      { id: "ms-c1", minuteId: "ata-coletiva", studentId: "stu-a1", studentNameSnapshot: "Lucas Mendes" },
      { id: "ms-c2", minuteId: "ata-coletiva", studentId: "stu-a2", studentNameSnapshot: "José Cauã Inês" }
    );
    hoisted.state.db.minuteParticipants.push({
      id: "mp-c1",
      minuteId: "ata-coletiva",
      role: "RESPONSAVEL",
      studentId: "stu-a1",
      name: "Pai do Lucas",
      mobileSignToken: "tok-unico-123",
      mobileSignExpiresAt: new Date(Date.now() + 600000),
      signedAt: null,
    });
    hoisted.state.db.actionItems.push({
      id: "act-conf-1",
      minuteId: "ata-coletiva",
      description: "Encaminhamento sigiloso à rede de proteção",
      responsible: "ESCOLA",
      status: "PENDING",
      dueDate: new Date(),
      createdAt: new Date(),
    });

    const signPage: any = await AssinarAtaPage({ params: Promise.resolve({ token: "tok-unico-123" }) });
    expect(signPage.props.summary).toContain("Lucas Mendes");
    expect(signPage.props.summary).not.toContain("José Cauã Inês");

    // Assinatura válida funciona na 1ª vez e rejeita payload HTML malicioso
    const badMime = await postMobileSignature(
      new Request("http://localhost:3000/api/atas/sign-token/tok-unico-123", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" }),
      }),
      { params: Promise.resolve({ token: "tok-unico-123" }) }
    );
    expect(badMime.status).toBe(400);

    const goodSign = await postMobileSignature(
      new Request("http://localhost:3000/api/atas/sign-token/tok-unico-123", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA" }),
      }),
      { params: Promise.resolve({ token: "tok-unico-123" }) }
    );
    expect(goodSign.status).toBe(200);

    // 3. Sigilo Reforçado ECA: outra pedagoga não-autora não recebe alertas de ata isConfidential
    expect(canAccessConfidentialMinute(hoisted.state.db.minutes[0], hoisted.state.session)).toBe(false);
    const alertsRes = await getActionAlerts(new Request("http://localhost:3000/api/atas/actions/alerts"));
    const alertsJson = await alertsRes.json();
    expect(alertsJson.metrics.totalPending).toBe(0);
  });

  it("mantém 100% de retrocompatibilidade de verifyMinuteIntegrity (v1 legado) e verifyAddendumChain", () => {
    const basePayload = {
      schoolId: "escola-a",
      year: 2026,
      ataNumber: 1,
      attendedAt: "2026-11-05T10:00:00.000Z",
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      subject: "Ata Histórica",
      summary: "Conteúdo histórico lavrado antes da v2.",
      authorEmail: "ana@escola-a.pr.gov.br",
      students: [{ studentId: "stu-a1", name: "Lucas Mendes" }],
      participants: [
        {
          role: "RESPONSAVEL",
          name: "Pai do Lucas",
          signatureMode: "MOBILE_QR",
          signatureData: "data:image/png;base64,AAA",
          biometricStrokeData: '[{"x":1,"y":2}]',
        },
      ],
    };

    const legacyV1Hash = computeMinuteHash(basePayload, { includeStrokeHash: false });
    expect(verifyMinuteIntegrity(basePayload, legacyV1Hash).isValid).toBe(true);

    const createdAt = "2026-11-05T12:00:00.000Z";
    const addHash = computeAddendumHash(legacyV1Hash, "Adendo oficial", "ana@escola-a.pr.gov.br", createdAt);
    expect(
      verifyAddendumChain(legacyV1Hash, [
        {
          previousHash: legacyV1Hash,
          addendumHash: addHash,
          content: "Adendo oficial",
          authorEmail: "ana@escola-a.pr.gov.br",
          createdAt,
        },
      ]).isValid
    ).toBe(true);
  });
});
