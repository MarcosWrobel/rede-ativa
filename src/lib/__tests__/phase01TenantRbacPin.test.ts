import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const hoisted = vi.hoisted(() => ({
  auth: vi.fn(),
  cookiesMap: new Map<string, string>(),
  state: {
    users: [] as any[],
    schools: [] as any[],
    userSchools: [] as any[],
    userNetworks: [] as any[],
    students: [] as any[],
    atas: [] as any[],
    messageLogs: [] as any[],
  },
  userUpdateCalls: [] as any[],
  userFindManySelects: [] as any[],
  schoolFindManyWheres: [] as any[],
  userSchoolUpsertCalls: [] as any[],
  userSchoolUpdateCalls: [] as any[],
  auditPayloads: [] as any[],
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (k: string) =>
      hoisted.cookiesMap.has(k) ? { value: hoisted.cookiesMap.get(k) } : undefined,
    set: (k: string, v: string) => {
      hoisted.cookiesMap.set(k, v);
    },
    delete: (k: string) => {
      hoisted.cookiesMap.delete(k);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err: any = new Error(`NEXT_REDIRECT:${url}`);
    err.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw err;
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => hoisted.auth(),
}));

vi.mock("@/lib/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rateLimit")>("@/lib/rateLimit");
  return {
    ...actual,
    enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
    checkRateLimit: vi.fn(async () => ({ success: true, remaining: 5, resetAt: Date.now() + 60_000 })),
    resetRateLimit: vi.fn(async () => {}),
    getRateLimitStatus: vi.fn(async () => ({ count: 0, isBlocked: false, retryAfterSeconds: 0 })),
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (entry: any) => {
    hoisted.auditPayloads.push(entry);
  }),
  extractClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/prisma", () => {
  const prismaMock: any = {
    user: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const user = hoisted.state.users.find(
          (u) =>
            (where?.email && u.email === where.email) ||
            (where?.id && u.id === where.id)
        );
        if (!user) return null;

        const schoolWhere = select?.schools?.where;
        const links = hoisted.state.userSchools
          .filter((l) => l.userId === user.id)
          .map((l) => {
            const school = hoisted.state.schools.find((s) => s.id === l.schoolId);
            return { ...l, school };
          })
          .filter((l) => {
            if (schoolWhere?.schoolId && l.schoolId !== schoolWhere.schoolId) return false;
            if (schoolWhere?.active !== undefined && l.active !== schoolWhere.active) return false;
            if (schoolWhere?.school?.active !== undefined && Boolean(l.school?.active) !== schoolWhere.school.active) {
              return false;
            }
            return true;
          });

        const netLinks = hoisted.state.userNetworks
          .filter((n) => n.userId === user.id && n.active && n.network?.active);

        const base = {
          ...user,
          schools: links,
          networks: netLinks,
          _count: { messageLogs: 2, repliedLogs: 1 },
        };
        if (select) {
          const out: Record<string, any> = {};
          for (const key of Object.keys(select)) {
            if (select[key] && key in base) out[key] = base[key];
          }
          if (select.schools) out.schools = links;
          if (select.networks) out.networks = netLinks;
          if (select._count) out._count = base._count;
          return out;
        }
        return base;
      }),
      findMany: vi.fn(async ({ where, select }: any) => {
        if (select) hoisted.userFindManySelects.push(select);
        const filtered = hoisted.state.users.filter((u) => {
          const reqSchoolId = where?.schools?.some?.schoolId;
          if (reqSchoolId) {
            return hoisted.state.userSchools.some(
              (l) => l.userId === u.id && l.schoolId === reqSchoolId
            );
          }
          return true;
        });
        return filtered.map((u) => {
          const links = hoisted.state.userSchools.filter((l) => l.userId === u.id);
          const full = {
            ...u,
            _count: { messageLogs: 2, repliedLogs: 1 },
            schools: links,
          };
          if (!select) return full;
          const out: Record<string, any> = {};
          for (const key of Object.keys(select)) {
            if (select[key] && key in full) out[key] = full[key];
          }
          return out;
        });
      }),
      create: vi.fn(async ({ data, select }: any) => {
        const created = {
          id: "usr-created",
          name: data.name,
          email: data.email,
          role: data.role,
          active: data.active ?? true,
          schoolId: data.schoolId ?? null,
          image: null,
          createdAt: new Date("2026-11-23T12:00:00Z"),
          updatedAt: new Date("2026-11-23T12:00:00Z"),
          signingPinHash: "secret-pin-hash-must-never-leak",
          pinCreatedAt: new Date("2026-11-23T12:00:00Z"),
          pinAttempts: 2,
          pinLockedUntil: new Date("2026-11-23T13:00:00Z"),
        };
        hoisted.state.users.push(created);
        if (data.schools?.create) {
          hoisted.state.userSchools.push({
            id: `us-${Date.now()}`,
            userId: created.id,
            ...data.schools.create,
          });
        }
        if (!select) return created;
        const out: Record<string, any> = {};
        for (const key of Object.keys(select)) {
          if (select[key] && key in created) out[key] = (created as any)[key];
        }
        if (select.schools) {
          out.schools = hoisted.state.userSchools.filter((l) => l.userId === created.id);
        }
        return out;
      }),
      update: vi.fn(async ({ where, data, select }: any) => {
        hoisted.userUpdateCalls.push({ where, data });
        const user = hoisted.state.users.find((u) => u.id === where.id);
        if (!user) throw new Error("User not found");
        Object.assign(user, data);
        if (!select) return user;
        const out: Record<string, any> = {};
        for (const key of Object.keys(select)) {
          if (select[key] && key in user) out[key] = user[key];
        }
        if (select.schools) {
          out.schools = hoisted.state.userSchools
            .filter((l) => l.userId === user.id)
            .map((l) => ({
              ...l,
              school: hoisted.state.schools.find((s) => s.id === l.schoolId) || null,
            }));
        }
        if (select._count) out._count = { messageLogs: 2, repliedLogs: 1 };
        return out;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matches = hoisted.state.users.filter((u) => !where?.id || u.id === where.id);
        for (const u of matches) Object.assign(u, data);
        return { count: matches.length };
      }),
    },
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        return (
          hoisted.state.schools.find(
            (s) =>
              (where?.id && s.id === where.id) ||
              (where?.inepCode && s.inepCode === where.inepCode)
          ) || null
        );
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          hoisted.state.schools.find((s) => {
            if (where?.active !== undefined && s.active !== where.active) return false;
            if (where?.id && s.id !== where.id) return false;
            if (where?.inepCode && s.inepCode !== where.inepCode) return false;
            if (where?.networkId?.in && !where.networkId.in.includes(s.networkId)) return false;
            if (typeof where?.networkId === "string" && s.networkId !== where.networkId) return false;
            if (where?.OR) {
              return where.OR.some((cond: any) =>
                (cond.id && s.id === cond.id) ||
                (cond.networkId?.in && cond.networkId.in.includes(s.networkId))
              );
            }
            return true;
          }) || null
        );
      }),
      findMany: vi.fn(async ({ where, select }: any = {}) => {
        if (where) hoisted.schoolFindManyWheres.push(where);
        return hoisted.state.schools
          .filter((s) => {
            if (where?.active !== undefined && s.active !== where.active) return false;
            if (where?.network && s.network !== where.network) return false;
            if (where?.networkId?.in && !where.networkId.in.includes(s.networkId)) return false;
            if (where?.city?.equals && s.city.toLowerCase() !== where.city.equals.toLowerCase()) {
              return false;
            }
            return true;
          })
          .map((s) => ({
            ...s,
            _count: { students: 0, classGroups: 0, userSchools: 0, pedagogicalMinutes: 0 },
            students: [],
          }));
      }),
    },
    userNetwork: {
      findMany: vi.fn(async ({ where }: any = {}) =>
        hoisted.state.userNetworks.filter(
          (n) =>
            (!where?.userId || n.userId === where.userId) &&
            (where?.active === undefined || n.active === where.active)
        )
      ),
    },
    userSchool: {
      findMany: vi.fn(async ({ where }: any = {}) =>
        hoisted.state.userSchools
          .filter(
            (l) =>
              (!where?.userId || l.userId === where.userId) &&
              (where?.active === undefined || l.active === where.active)
          )
          .map((l) => ({
            ...l,
            school: hoisted.state.schools.find((s) => s.id === l.schoolId) || null,
          }))
      ),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        hoisted.userSchoolUpsertCalls.push({ where, create, update });
        const key = where?.userId_schoolId;
        let existing = hoisted.state.userSchools.find(
          (l) => l.userId === key?.userId && l.schoolId === key?.schoolId
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        existing = { id: `us-${Date.now()}`, ...create };
        hoisted.state.userSchools.push(existing);
        return existing;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        hoisted.userSchoolUpdateCalls.push({ where, data });
        const key = where?.userId_schoolId;
        const existing = hoisted.state.userSchools.find(
          (l) => l.userId === key?.userId && l.schoolId === key?.schoolId
        );
        if (!existing) throw new Error("UserSchool link not found");
        Object.assign(existing, data);
        return existing;
      }),
    },
    student: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.state.students.filter((s) => s.schoolId === where?.schoolId)
      ),
      count: vi.fn(async () => 0),
    },
    pedagogicalMinute: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.state.atas.filter((a) => a.schoolId === where?.schoolId)
      ),
    },
    messageLog: {
      findUnique: vi.fn(async ({ where }: any) =>
        hoisted.state.messageLogs.find((m) => m.id === where?.id) || null
      ),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: any) => {
        const m = hoisted.state.messageLogs.find((x) => x.id === where.id);
        return { ...m, ...data };
      }),
    },
    lowAttendanceRecord: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    attendanceSnapshot: {
      findMany: vi.fn(async () => []),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (arg: any) => (typeof arg === "function" ? arg(prismaMock) : Promise.all(arg))),
  };
  return { prisma: prismaMock };
});

import { GET as getStudents } from "@/app/api/students/route";
import { GET as getPendingMessages } from "@/app/api/messages/pending/route";
import { GET as getAtas } from "@/app/api/atas/route";
import { GET as getReports } from "@/app/api/reports/route";
import { POST as switchSchoolPost } from "@/app/api/auth/switch-school/route";
import { GET as getUsers, POST as postUser, PUT as putUser } from "@/app/api/users/route";
import { GET as getSecretariaMetrics } from "@/app/api/secretaria/metrics/route";
import { GET as getSchools } from "@/app/api/schools/route";
import { getAuthorizedCurrentSchool } from "@/lib/currentSchool";
import SecretariaPage from "@/app/secretaria/page";
import { PUT as manageMessagePut } from "@/app/api/messages/manage/route";
import { GET as weeklyDigestGet } from "@/app/api/cron/weekly-digest/route";
import { resolveAuthorizedSchoolForCouncil } from "@/services/classCouncilService";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import { checkIsSchoolManager, checkIsSuperAdmin } from "@/lib/roles";

describe("Fase 01 — F02 Contexto Escolar, RBAC Efetivo, Revogação Imediata e Projeção de PIN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FORCE_STRICT_DB_AUTH = "true";
    process.env.CRON_SECRET = "cron-phase01-secret";
    hoisted.cookiesMap.clear();
    hoisted.userUpdateCalls = [];
    hoisted.userFindManySelects = [];
    hoisted.auditPayloads = [];

    hoisted.state = {
      schools: [
        {
          id: "default-leopoldina",
          inepCode: "41042730",
          name: "Escola Piloto A",
          city: "Ponta Grossa",
          state: "PR",
          nre: "Ponta Grossa",
          network: "ESTADUAL",
          networkId: null,
          active: true,
          syncTokenHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          settingsJson: null,
          updatedAt: new Date(),
        },
        {
          id: "school-mun-b",
          inepCode: "41999902",
          name: "Escola Municipal B",
          city: "Tibagi",
          state: "PR",
          nre: "Telêmaco Borba",
          network: "MUNICIPAL",
          networkId: "net-tibagi",
          active: true,
          syncTokenHash: null,
          settingsJson: null,
          updatedAt: new Date(),
        },
      ],
      users: [
        {
          id: "usr-nolink",
          email: "sem.vinculo@escola.pr.gov.br",
          name: "Sem Vínculo",
          role: "PEDAGOGA",
          active: true,
          schoolId: "default-leopoldina", // seleção legada sem UserSchool ativo!
          signingPinHash: "hash-sigiloso-1",
          pinCreatedAt: new Date(),
          pinAttempts: 1,
          pinLockedUntil: new Date(),
          createdAt: new Date(),
        },
        {
          id: "usr-dual",
          email: "gestor.multi@escola.pr.gov.br",
          name: "Gestora Dual",
          role: "GESTOR_ESCOLAR",
          active: true,
          schoolId: "default-leopoldina",
          signingPinHash: "hash-sigiloso-2",
          pinCreatedAt: new Date(),
          pinAttempts: 3,
          pinLockedUntil: new Date("2026-12-01T12:00:00Z"),
          createdAt: new Date(),
        },
        {
          id: "usr-local-admin",
          email: "admin.local@escola.pr.gov.br",
          name: "Admin Local",
          role: "ADMIN",
          active: true,
          schoolId: "school-mun-b",
          signingPinHash: "hash-sigiloso-3",
          pinCreatedAt: new Date(),
          pinAttempts: 0,
          pinLockedUntil: null,
          createdAt: new Date(),
        },
        {
          id: "usr-sec",
          email: "sec.tibagi@escola.pr.gov.br",
          name: "Secretária Municipal",
          role: "PEDAGOGA",
          active: true,
          schoolId: "school-mun-b",
          signingPinHash: "hash-sigiloso-4",
          pinCreatedAt: new Date(),
          pinAttempts: 0,
          pinLockedUntil: null,
          createdAt: new Date(),
        },
      ],
      userSchools: [
        // usr-nolink não tem nenhum vínculo ativo!
        { userId: "usr-dual", schoolId: "default-leopoldina", role: "GESTOR_ESCOLAR", active: true },
        { userId: "usr-dual", schoolId: "school-mun-b", role: "PEDAGOGA", active: true },
        { userId: "usr-local-admin", schoolId: "school-mun-b", role: "ADMIN", active: true },
        // Secretária tem vínculo local rebaixado como PEDAGOGA, mas rede ativa abaixo
        { userId: "usr-sec", schoolId: "school-mun-b", role: "PEDAGOGA", active: true },
      ],
      userNetworks: [
        {
          userId: "usr-sec",
          networkId: "net-tibagi",
          role: "GESTAO_SECRETARIA",
          active: true,
          network: {
            id: "net-tibagi",
            name: "SEMEC Tibagi",
            shortName: "SEMEC",
            city: "Tibagi",
            type: "MUNICIPAL",
            active: true,
          },
        },
      ],
      students: [
        { id: "stu-a", name: "Estudante A", schoolId: "default-leopoldina" },
      ],
      atas: [],
      messageLogs: [
        {
          id: "log-b",
          studentId: "stu-b",
          student: { id: "stu-b", name: "Estudante B", schoolId: "school-mun-b" },
          phoneUsed: "42999990000",
          reasonTitle: "Teste",
          messageContent: "Conteúdo sintético",
          sentByName: "Gestora Dual",
          sentAt: new Date(),
        },
      ],
    };
  });

  it("F02: sessão sem vínculo ativo NÃO faz fallback para 1ª escola ativa nem default-leopoldina (API, Conselho, Pending)", async () => {
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-nolink",
        email: "sem.vinculo@escola.pr.gov.br",
        name: "Sem Vínculo",
        role: "PEDAGOGA",
        schoolId: "default-leopoldina",
        schools: [],
      },
    });

    const studentsRes = await getStudents(new Request("http://localhost/api/students"));
    expect(studentsRes.status).toBe(403);

    const pendingRes = await getPendingMessages(new Request("http://localhost/api/messages/pending"));
    expect(pendingRes.status).toBe(403);

    const atasRes = await getAtas(new Request("http://localhost/api/atas"));
    expect(atasRes.status).toBe(403);

    const reportsRes = await getReports(new Request("http://localhost/api/reports"));
    expect(reportsRes.status).toBe(403);

    const councilSchool = await resolveAuthorizedSchoolForCouncil({
      user: {
        id: "usr-nolink",
        email: "sem.vinculo@escola.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "default-leopoldina",
        schools: [],
      },
    });
    expect(councilSchool).toBeNull();
  });

  it("F02: preserva fluxos legítimos com credencial própria (x-sync-token e CRON_SECRET)", async () => {
    hoisted.auth.mockResolvedValue(null);

    // Extension sync token válido ("test" -> sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08)
    const pendingTokenRes = await getPendingMessages(
      new Request("http://localhost/api/messages/pending?limit=5", {
        headers: { "x-sync-token": "test" },
      })
    );
    expect(pendingTokenRes.status).toBe(200);

    // CRON_SECRET válido com schoolId explícito
    const cronRes = await weeklyDigestGet(
      new NextRequest("http://localhost/api/cron/weekly-digest?schoolId=default-leopoldina", {
        headers: { authorization: "Bearer cron-phase01-secret" },
      })
    );
    expect(cronRes.status).toBe(200);
  });

  it("RBAC por escola efetiva após switch-school + rejeita alcance global de 'ADMIN' local", async () => {
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        name: "Gestora Dual",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });

    // Na Escola A (GESTOR_ESCOLAR), GET /api/users funciona
    const usersA = await getUsers(new Request("http://localhost/api/users"));
    expect(usersA.status).toBe(200);

    // Troca para Escola B onde é apenas PEDAGOGA
    const switchRes = await switchSchoolPost(
      new Request("http://localhost/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: "school-mun-b" }),
      })
    );
    expect(switchRes.status).toBe(200);
    const switchData = await switchRes.json();
    expect(switchData.effectiveRole).toBe("PEDAGOGA");
    expect(switchData.activeSchool?.id).toBe("school-mun-b");
    expect(switchRes.cookies.get("active_school_id")?.value).toBe("school-mun-b");
    hoisted.cookiesMap.set("active_school_id", "school-mun-b");

    // Na requisição seguinte na Escola B, operações administrativas DEVEM retornar 403!
    const usersB = await getUsers(new Request("http://localhost/api/users"));
    expect(usersB.status).toBe(403);

    const manageB = await manageMessagePut(
      new Request("http://localhost/api/messages/manage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: "log-b", reasonTitle: "Tentativa" }),
      })
    );
    expect(manageB.status).toBe(403);

    // Usuário ADMIN local em school-mun-b não é SuperAdmin nem consegue acessar ?all=true
    hoisted.cookiesMap.set("active_school_id", "school-mun-b");
    const adminLocalSession = {
      user: { id: "usr-local-admin", email: "admin.local@escola.pr.gov.br", role: "ADMIN" },
    };
    hoisted.auth.mockResolvedValue(adminLocalSession);
    expect(checkIsSuperAdmin(adminLocalSession)).toBe(false);
    const adminAllRes = await getUsers(new Request("http://localhost/api/users?all=true"));
    expect(adminAllRes.status).toBe(403);
  });

  it("RBAC: GESTAO_SECRETARIA preserva autoridade via vínculo ativo de rede mesmo com UserSchool local PEDAGOGA", async () => {
    hoisted.cookiesMap.set("active_school_id", "school-mun-b");
    const secSession = {
      user: {
        id: "usr-sec",
        email: "sec.tibagi@escola.pr.gov.br",
        role: "PEDAGOGA",
        schools: [{ schoolId: "school-mun-b", role: "PEDAGOGA", active: true }],
        networks: [
          {
            networkId: "net-tibagi",
            role: "GESTAO_SECRETARIA",
            city: "Tibagi",
            type: "MUNICIPAL",
            active: true,
          },
        ],
      },
    };
    hoisted.auth.mockResolvedValue(secSession);

    expect(
      checkIsSchoolManager(secSession, "school-mun-b", {
        id: "school-mun-b",
        networkId: "net-tibagi",
        network: "MUNICIPAL",
        city: "Tibagi",
        active: true,
      })
    ).toBe(true);

    const usersRes = await getUsers(new Request("http://localhost/api/users"));
    expect(usersRes.status).toBe(200);
  });

  it("Revogação imediata de conta ou vínculo surte efeito na requisição protegida seguinte e em SSR", async () => {
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        name: "Gestora Dual",
        role: "GESTOR_ESCOLAR",
        active: true,
        schoolId: "default-leopoldina",
      },
    });

    expect((await getStudents(new Request("http://localhost/api/students"))).status).toBe(200);

    // 1. Revoga apenas o vínculo na Escola A e B (conta ainda ativa, mas sem vínculos)
    hoisted.state.userSchools.forEach((l) => {
      if (l.userId === "usr-dual") l.active = false;
    });
    expect((await getStudents(new Request("http://localhost/api/students"))).status).toBe(403);
    await expect(resolveAuthorizedPageContext()).rejects.toThrow("NEXT_REDIRECT:/sem-escola");

    // 2. Desativa o usuário no banco — bloqueia imediatamente mesmo com JWT antigo válido
    hoisted.state.users.find((u) => u.id === "usr-dual")!.active = false;
    const revokedRes = await getStudents(new Request("http://localhost/api/students"));
    expect(revokedRes.status).toBe(403);
    await expect(resolveAuthorizedPageContext()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=AccountInactive"
    );
  });

  it("PIN: GET, POST e PUT /api/users excluem signingPinHash, pinCreatedAt, pinAttempts e pinLockedUntil via seleção explícita", async () => {
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        name: "Gestora Dual",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });

    const getRes = await getUsers(new Request("http://localhost/api/users"));
    expect(getRes.status).toBe(200);
    const getText = JSON.stringify(await getRes.json());
    for (const secretField of ["signingPinHash", "pinCreatedAt", "pinAttempts", "pinLockedUntil"]) {
      expect(getText).not.toContain(secretField);
    }
    expect(hoisted.userFindManySelects[0]).toBeTruthy();
    expect(hoisted.userFindManySelects[0].signingPinHash).toBeUndefined();

    const postRes = await postUser(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nova Pedagoga",
          email: "nova.pedagoga@escola.pr.gov.br",
          role: "PEDAGOGA",
        }),
      })
    );
    expect(postRes.status).toBe(201);
    const postJson = await postRes.json();
    const postStr = JSON.stringify(postJson);
    for (const secretField of ["signingPinHash", "pinCreatedAt", "pinAttempts", "pinLockedUntil"]) {
      expect(postStr).not.toContain(secretField);
    }
    expect(postJson.email).toBe("nova.pedagoga@escola.pr.gov.br");

    const putRes = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "usr-created",
          role: "PEDAGOGA",
          active: true,
        }),
      })
    );
    expect(putRes.status).toBe(200);
    const putStr = JSON.stringify(await putRes.json());
    for (const secretField of ["signingPinHash", "pinCreatedAt", "pinAttempts", "pinLockedUntil"]) {
      expect(putStr).not.toContain(secretField);
    }
  });

  it("F02 + RBAC: restringe Secretaria estritamente a networkId (duas escolas na mesma cidade, com e sem rede) preservando acesso legítimo por rede", async () => {
    hoisted.schoolFindManyWheres = [];
    hoisted.state.schools.push(
      {
        id: "school-tibagi-net1",
        inepCode: "41088001",
        name: "Escola Municipal Rede 1",
        city: "Tibagi",
        state: "PR",
        nre: "SEMEC Tibagi",
        network: "MUNICIPAL",
        networkId: "net-tibagi-1",
        active: true,
        updatedAt: new Date("2026-11-23T00:00:00Z"),
        settingsJson: null,
        syncTokenHash: null,
      },
      {
        id: "school-tibagi-net2",
        inepCode: "41088002",
        name: "Escola Municipal Outra Rede",
        city: "Tibagi",
        state: "PR",
        nre: "SEMEC Privada Tibagi",
        network: "MUNICIPAL",
        networkId: "net-tibagi-2",
        active: true,
        updatedAt: new Date("2026-11-23T00:00:00Z"),
        settingsJson: null,
        syncTokenHash: null,
      },
      {
        id: "school-tibagi-orphan",
        inepCode: "41088003",
        name: "Escola Municipal Sem Rede",
        city: "Tibagi",
        state: "PR",
        nre: "SEMEC Tibagi",
        network: "MUNICIPAL",
        networkId: null,
        active: true,
        updatedAt: new Date("2026-11-23T00:00:00Z"),
        settingsJson: null,
        syncTokenHash: null,
      }
    );

    hoisted.state.users.push({
      id: "usr-sec-strict",
      email: "sec.net1@escola.pr.gov.br",
      name: "Secretaria Rede 1",
      role: "GESTAO_SECRETARIA",
      active: true,
      schoolId: "school-tibagi-net2", // preferência incompatível não pode autorizar net2
    });
    hoisted.state.userNetworks.push({
      userId: "usr-sec-strict",
      networkId: "net-tibagi-1",
      role: "GESTAO_SECRETARIA",
      active: true,
      network: { id: "net-tibagi-1", city: "Tibagi", type: "MUNICIPAL", active: true },
    });

    const secSession = {
      user: {
        id: "usr-sec-strict",
        email: "sec.net1@escola.pr.gov.br",
        name: "Secretaria Rede 1",
        role: "GESTAO_SECRETARIA",
      },
    };
    hoisted.auth.mockResolvedValue(secSession);

    // 1. Cookie forjado para escola de outra rede ou sem networkId na mesma cidade é rejeitado; resolve apenas net1
    hoisted.cookiesMap.set("active_school_id", "school-tibagi-net2");
    const resolvedFromNet2Cookie = await getAuthorizedCurrentSchool(secSession);
    expect(resolvedFromNet2Cookie?.id).toBe("school-tibagi-net1");

    hoisted.cookiesMap.set("active_school_id", "school-tibagi-orphan");
    const resolvedFromOrphanCookie = await getAuthorizedCurrentSchool(secSession);
    expect(resolvedFromOrphanCookie?.id).toBe("school-tibagi-net1");

    // 2. Troca de escola bloqueia net2 e sem networkId, liberando apenas net1
    const switchNet2 = await switchSchoolPost(
      new Request("http://localhost/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: "school-tibagi-net2" }),
      })
    );
    expect(switchNet2.status).toBe(403);

    const switchOrphan = await switchSchoolPost(
      new Request("http://localhost/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: "school-tibagi-orphan" }),
      })
    );
    expect(switchOrphan.status).toBe(403);

    const switchNet1 = await switchSchoolPost(
      new Request("http://localhost/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: "school-tibagi-net1" }),
      })
    );
    expect(switchNet1.status).toBe(200);

    // 3. GET /api/schools preserva acesso legítimo da Secretaria pelo vínculo de rede sem expor net2 ou órfã
    const schoolsRes = await getSchools();
    expect(schoolsRes.status).toBe(200);
    const schoolsJson = await schoolsRes.json();
    expect(schoolsJson.schools.map((s: any) => s.id)).toEqual(["school-tibagi-net1"]);

    // 4. GET /api/secretaria/metrics isola por networkId mesmo com parâmetro ?city=Tibagi
    const metricsRes = await getSecretariaMetrics(
      new Request("http://localhost/api/secretaria/metrics?city=Tibagi")
    );
    expect(metricsRes.status).toBe(200);
    const metricsJson = await metricsRes.json();
    expect(metricsJson.schools.map((s: any) => s.id)).toEqual(["school-tibagi-net1"]);
    expect(metricsJson.metrics.totalSchools).toBe(1);

    const forbiddenNetParam = await getSecretariaMetrics(
      new Request("http://localhost/api/secretaria/metrics?networkId=net-tibagi-2")
    );
    expect(forbiddenNetParam.status).toBe(403);

    // 5. Página SSR /secretaria isola estritamente por networkId na mesma cidade
    const pageEl: any = await SecretariaPage({ searchParams: Promise.resolve({ city: "Tibagi" }) });
    expect(pageEl.props.initialSchools.map((s: any) => s.id)).toEqual(["school-tibagi-net1"]);
    expect(pageEl.props.metrics.totalSchools).toBe(1);
  });

  it("F02: User.schoolId funciona apenas como preferência e nunca autoriza acesso ou cria UserSchool em PUT /api/users", async () => {
    hoisted.userSchoolUpsertCalls = [];
    hoisted.userSchoolUpdateCalls = [];
    hoisted.state.users.push({
      id: "usr-pref-only",
      email: "pref.only@escola.pr.gov.br",
      name: "Somente Preferência",
      role: "PEDAGOGA",
      active: true,
      schoolId: "default-leopoldina",
    });

    // 1. Usuário com User.schoolId preenchido, mas sem UserSchool, falha fechado em API e SSR
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-pref-only",
        email: "pref.only@escola.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "default-leopoldina",
      },
    });
    expect((await getStudents(new Request("http://localhost/api/students"))).status).toBe(403);

    // 2. Gestor da escola-a/Piloto não vê usr-pref-only em GET /api/users e não pode criar UserSchool via PUT
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });
    const listRes = await getUsers(new Request("http://localhost/api/users"));
    expect(listRes.status).toBe(200);
    const listIds = (await listRes.json()).map((u: any) => u.id);
    expect(listIds).not.toContain("usr-pref-only");

    const putPrefOnly = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "usr-pref-only", role: "PEDAGOGA", active: true }),
      })
    );
    expect(putPrefOnly.status).toBe(403);
    expect(hoisted.userSchoolUpsertCalls).toHaveLength(0);
    expect(hoisted.userSchoolUpdateCalls).toHaveLength(0);
    expect(hoisted.state.userSchools.some((l) => l.userId === "usr-pref-only")).toBe(false);
  });

  it("RBAC Rodada 3: restringe POST/PUT /api/users ao UserSchool local, preserva User.active=false/UserNetwork e reserva scope global ao SUPERADMIN", async () => {
    // Adiciona rede separada e escola municipal vinculada apenas a net-outra-rede
    hoisted.state.schools.push({
      id: "school-outra-rede",
      inepCode: "41077777",
      name: "Escola Municipal Outra Rede",
      city: "Castro",
      state: "PR",
      nre: "Ponta Grossa",
      network: "MUNICIPAL",
      networkId: "net-outra-rede",
      active: true,
      settingsJson: null,
      updatedAt: new Date(),
    });
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        name: "Gestora Dual",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });

    // 1. Convite de novo integrante cria User (preferência inicial) + UserSchool ativo
    const inviteNewRes = await postUser(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Integrante Novo",
          email: "novo.integrante@escola.pr.gov.br",
          role: "PEDAGOGA",
        }),
      })
    );
    expect(inviteNewRes.status).toBe(201);
    const createdUser = hoisted.state.users.find((u) => u.email === "novo.integrante@escola.pr.gov.br");
    expect(createdUser?.schoolId).toBe("default-leopoldina");
    expect(
      hoisted.state.userSchools.find(
        (l) => l.userId === createdUser?.id && l.schoolId === "default-leopoldina"
      )?.active
    ).toBe(true);

    // 2. Edição de conta existente altera apenas UserSchool sem mutar User.role/User.active globais
    hoisted.userUpdateCalls = [];
    const editCreatedRes = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: createdUser.id,
          role: "GESTOR_ESCOLAR",
          active: true,
        }),
      })
    );
    expect(editCreatedRes.status).toBe(200);
    expect(hoisted.userUpdateCalls).toHaveLength(0);
    expect(createdUser.role).toBe("PEDAGOGA");
    expect(
      hoisted.state.userSchools.find(
        (l) => l.userId === createdUser.id && l.schoolId === "default-leopoldina"
      )?.role
    ).toBe("GESTOR_ESCOLAR");

    // 3. Reativação de vínculo local (via PUT e POST) com conta global desativada preserva User.active=false e mantém 403
    hoisted.state.users.push({
      id: "usr-global-off",
      email: "conta.off@escola.pr.gov.br",
      name: "Conta Desativada Global",
      role: "GESTOR_ESCOLAR",
      active: false,
      schoolId: "school-mun-b",
    });
    hoisted.state.userSchools.push({
      id: "us-global-off-a",
      userId: "usr-global-off",
      schoolId: "default-leopoldina",
      role: "PEDAGOGA",
      active: false,
    });

    const reactivatePutRes = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "usr-global-off",
          role: "GESTOR_ESCOLAR",
          active: true,
        }),
      })
    );
    expect(reactivatePutRes.status).toBe(200);
    const reactivatedJson = await reactivatePutRes.json();
    expect(reactivatedJson.schoolActive).toBe(true);
    expect(reactivatedJson.globalActive).toBe(false);
    expect(reactivatedJson.accountGloballyInactive).toBe(true);
    expect(hoisted.userUpdateCalls).toHaveLength(0);
    expect(hoisted.state.users.find((u) => u.id === "usr-global-off")?.active).toBe(false);

    // Convite via POST para outra conta globalmente desativada também preserva active=false
    hoisted.state.users.push({
      id: "usr-global-off-post",
      email: "conta.off.post@escola.pr.gov.br",
      name: "Conta Inativa POST",
      role: "GESTOR_ESCOLAR",
      active: false,
      schoolId: null,
    });
    const reactivatePostRes = await postUser(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "conta.off.post@escola.pr.gov.br",
          role: "PEDAGOGA",
        }),
      })
    );
    expect(reactivatePostRes.status).toBe(201);
    const reactPostJson = await reactivatePostRes.json();
    expect(reactPostJson.globalActive).toBe(false);
    expect(hoisted.userUpdateCalls).toHaveLength(0);
    expect(hoisted.state.users.find((u) => u.id === "usr-global-off-post")?.active).toBe(false);

    // Próxima requisição protegida com usr-global-off continua bloqueada (403) porque conta global está inativa
    hoisted.auth.mockResolvedValue({
      user: { id: "usr-global-off", email: "conta.off@escola.pr.gov.br", role: "GESTOR_ESCOLAR" },
    });
    expect((await getStudents(new Request("http://localhost/api/students"))).status).toBe(403);

    // 4. Usuário com UM ÚNICO UserSchool (default-leopoldina) + UserNetwork ativo em net-outra-rede:
    // revogação local na escola preserva User.active=true, User.role e UserNetwork ativo na outra rede
    hoisted.state.users.push({
      id: "usr-single-school-net",
      email: "sec.unicolink@escola.pr.gov.br",
      name: "Gestora Rede Outra",
      role: "GESTAO_SECRETARIA",
      active: true,
      schoolId: "default-leopoldina",
    });
    hoisted.state.userSchools.push({
      id: "us-single-leop",
      userId: "usr-single-school-net",
      schoolId: "default-leopoldina",
      role: "PEDAGOGA",
      active: true,
    });
    hoisted.state.userNetworks.push({
      userId: "usr-single-school-net",
      networkId: "net-outra-rede",
      role: "GESTAO_SECRETARIA",
      active: true,
      network: {
        id: "net-outra-rede",
        name: "SEMEC Castro",
        shortName: "SEMEC Castro",
        city: "Castro",
        type: "MUNICIPAL",
        active: true,
      },
    });

    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });
    const revokeLocalOnlyRes = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "usr-single-school-net",
          role: "PEDAGOGA",
          active: false,
        }),
      })
    );
    expect(revokeLocalOnlyRes.status).toBe(200);
    expect(hoisted.userUpdateCalls).toHaveLength(0);
    const singleNetUser = hoisted.state.users.find((u) => u.id === "usr-single-school-net");
    expect(singleNetUser?.active).toBe(true);
    expect(singleNetUser?.role).toBe("GESTAO_SECRETARIA");
    expect(
      hoisted.state.userNetworks.find(
        (n) => n.userId === "usr-single-school-net" && n.networkId === "net-outra-rede"
      )?.active
    ).toBe(true);

    hoisted.state.students.push(
      { id: "stu-leop-1", name: "Aluno Sede Isolado", schoolId: "default-leopoldina" },
      { id: "stu-outra-1", name: "Aluno Outra Rede", schoolId: "school-outra-rede" }
    );

    // Próxima requisição tentando selecionar default-leopoldina falha fechado (403 no switch-school e zero vazamento de stu-leop-1);
    // na rede autorizada (school-outra-rede & /api/secretaria/metrics) mantém acesso legítimo (200)
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-single-school-net",
        email: "sec.unicolink@escola.pr.gov.br",
        role: "PEDAGOGA",
      },
    });
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    const blockedSwitchRes = await switchSchoolPost(
      new Request("http://localhost/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: "default-leopoldina" }),
      })
    );
    expect(blockedSwitchRes.status).toBe(403);

    const studentsAfterLocalRevoke = await getStudents(
      new Request("http://localhost/api/students")
    );
    expect(studentsAfterLocalRevoke.status).toBe(200);
    const studentsAfterJson = await studentsAfterLocalRevoke.json();
    expect(studentsAfterJson.map((s: any) => s.id)).toEqual(["stu-outra-1"]);

    hoisted.cookiesMap.set("active_school_id", "school-outra-rede");
    expect((await getStudents(new Request("http://localhost/api/students"))).status).toBe(200);
    const secMetricsOk = await getSecretariaMetrics(
      new Request("http://localhost/api/secretaria/metrics?city=Castro")
    );
    expect(secMetricsOk.status).toBe(200);
    expect((await secMetricsOk.json()).schools.map((s: any) => s.id)).toEqual(["school-outra-rede"]);

    // Revogação local de usuário sem UserNetwork bloqueia acesso protegido com 403 na próxima requisição
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });
    const revokeNewMemberRes = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: createdUser.id,
          active: false,
        }),
      })
    );
    expect(revokeNewMemberRes.status).toBe(200);
    hoisted.auth.mockResolvedValue({
      user: {
        id: createdUser.id,
        email: createdUser.email,
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });
    expect((await getStudents(new Request("http://localhost/api/students"))).status).toBe(403);

    // 5. Escopo global é bloqueado (403) para GESTOR_ESCOLAR e exclusivo ao SUPERADMIN
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-dual",
        email: "gestor.multi@escola.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        schoolId: "default-leopoldina",
      },
    });
    const forbiddenGlobalRes = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "usr-single-school-net",
          scope: "global",
          active: false,
        }),
      })
    );
    expect(forbiddenGlobalRes.status).toBe(403);

    hoisted.state.users.push({
      id: "usr-super-rbac",
      email: "super.rbac@escola.pr.gov.br",
      name: "SuperAdmin RBAC",
      role: "SUPERADMIN",
      active: true,
      schoolId: "default-leopoldina",
    });
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-super-rbac",
        email: "super.rbac@escola.pr.gov.br",
        name: "SuperAdmin RBAC",
        role: "SUPERADMIN",
      },
    });
    const superGlobalRes = await putUser(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "usr-global-off",
          scope: "global",
          role: "GESTOR_ESCOLAR",
          active: true,
        }),
      })
    );
    expect(superGlobalRes.status).toBe(200);
    expect(hoisted.userUpdateCalls.length).toBeGreaterThanOrEqual(1);
    expect(hoisted.state.users.find((u) => u.id === "usr-global-off")?.active).toBe(true);
    expect(hoisted.auditPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "UPDATE_USER_GLOBAL",
          details: expect.objectContaining({ scope: "global" }),
        }),
      ])
    );
  });
});
