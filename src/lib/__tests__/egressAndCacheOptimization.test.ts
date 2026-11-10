import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  auth: vi.fn(async () => null as any),
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
  requireSchoolAdmin: vi.fn(async () => ({
    ok: true,
    userId: "user-1",
    userName: "Gestora Teste",
    email: "gestora@escola.pr.gov.br",
    role: "GESTOR_ESCOLAR",
    schoolId: "school-opt-1",
  })),
  requireSuperAdmin: vi.fn(async () => ({ ok: true })),
  logAudit: vi.fn(async () => {}),
  schoolFindUnique: vi.fn(async () => null as any),
  schoolFindFirst: vi.fn(async () => null as any),
  schoolUpdate: vi.fn(async (args: any) => ({
    id: args?.where?.id || "school-opt-1",
    inepCode: "99998888",
    name: args?.data?.name || "Escola Otimizada",
    city: "Ponta Grossa",
    state: "PR",
    nre: "Ponta Grossa",
    network: "MUNICIPAL",
    phone: null,
    email: null,
    active: true,
    syncTokenHash: null,
    settingsJson: null,
    networkId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-10T12:00:00.000Z"),
  })),
  studentFindUnique: vi.fn(async () => null as any),
  studentContactFindMany: vi.fn(async () => [] as any[]),
  absenceJustificationFindMany: vi.fn(async () => [] as any[]),
  studentAttendanceFindMany: vi.fn(async () => [] as any[]),
  attendanceSnapshotFindMany: vi.fn(async () => [] as any[]),
  pedagogicalMinuteFindMany: vi.fn(async () => [] as any[]),
  findSchoolBySyncToken: vi.fn(async () => null as any),
  getRateLimitStatus: vi.fn(async () => ({ count: 0, isBlocked: false, retryAfterSeconds: 0 })),
  checkRateLimit: vi.fn(async () => ({
    success: true,
    limit: 10,
    remaining: 9,
    resetAt: Date.now() + 60000,
    retryAfterSeconds: 60,
  })),
  resetRateLimit: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({
  cookies: hoisted.cookies,
}));

vi.mock("@/lib/auth", () => ({
  auth: hoisted.auth,
}));

vi.mock("@/lib/permissions", () => ({
  requireSchoolAdmin: hoisted.requireSchoolAdmin,
  requireSuperAdmin: hoisted.requireSuperAdmin,
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    ...actual,
    logAudit: hoisted.logAudit,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findUnique: hoisted.schoolFindUnique,
      findFirst: hoisted.schoolFindFirst,
      update: hoisted.schoolUpdate,
      upsert: vi.fn(async () => null),
    },
    student: {
      findUnique: hoisted.studentFindUnique,
    },
    studentContact: {
      findMany: hoisted.studentContactFindMany,
    },
    absenceJustification: {
      findMany: hoisted.absenceJustificationFindMany,
    },
    inPersonAttendance: {
      findMany: hoisted.studentAttendanceFindMany,
    },
    attendanceSnapshot: {
      findMany: hoisted.attendanceSnapshotFindMany,
    },
    pedagogicalMinute: {
      findMany: hoisted.pedagogicalMinuteFindMany,
    },
  },
}));

vi.mock("@/lib/syncToken", async () => {
  const actual = await vi.importActual<typeof import("@/lib/syncToken")>("@/lib/syncToken");
  return {
    ...actual,
    findSchoolBySyncToken: hoisted.findSchoolBySyncToken,
  };
});

vi.mock("@/lib/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rateLimit")>("@/lib/rateLimit");
  return {
    ...actual,
    getRateLimitStatus: hoisted.getRateLimitStatus,
    checkRateLimit: hoisted.checkRateLimit,
    resetRateLimit: hoisted.resetRateLimit,
  };
});

import { isInlineBase64Logo, isProxyLogoPath, resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { getCurrentSchool } from "@/lib/currentSchool";
import { loadStudent360Bundle } from "@/lib/safePhase3Queries";
import { authenticateExtensionSyncToken } from "@/lib/extensionSyncAuth";
import { resolveTokenRole, assertNoDevAuthInProduction } from "@/lib/roles";
import { GET as getSchoolLogoRoute } from "@/app/api/schools/[id]/logo/route";
import { PUT as putSchoolRoute } from "@/app/api/schools/[id]/route";

describe("Otimizações de Egress, Cache & Operações no Neon PostgreSQL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("schoolLogo helpers & /api/schools/[id]/logo proxy cacheável", () => {
    it("preserva URLs curtas externas e substitui payloads data:image ou ausentes pela rota proxy", () => {
      expect(isInlineBase64Logo("data:image/svg+xml;base64,PHN2Zz4=")).toBe(true);
      expect(isProxyLogoPath("/api/schools/school-1/logo?v=1700")).toBe(true);

      expect(
        resolveSchoolLogoProxyUrl({
          id: "school-1",
          logoUrl: "/brasao-tibagi.png",
          updatedAt: new Date("2026-11-10T10:00:00.000Z"),
        })
      ).toBe("/brasao-tibagi.png");

      const versioned = resolveSchoolLogoProxyUrl({
        id: "school-1",
        logoUrl: "data:image/png;base64,AAAA",
        updatedAt: new Date("2026-11-10T10:00:00.000Z"),
      });
      expect(versioned).toMatch(/^\/api\/schools\/school-1\/logo\?v=\d+$/);

      const omitted = resolveSchoolLogoProxyUrl({
        id: "school-1",
        updatedAt: new Date("2026-11-10T10:00:00.000Z"),
      });
      expect(omitted).toMatch(/^\/api\/schools\/school-1\/logo\?v=\d+$/);
    });

    it("decodifica SVG Base64 com Cache-Control público agressivo e CSP estrita", async () => {
      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
      const base64Svg = Buffer.from(svgContent, "utf-8").toString("base64");

      hoisted.schoolFindUnique.mockResolvedValueOnce({
        id: "school-svg-1",
        active: true,
        logoUrl: `data:image/svg+xml;base64,${base64Svg}`,
      });

      const req = new Request("https://www.redeativa.app.br/api/schools/school-svg-1/logo?v=123");
      const res = await getSchoolLogoRoute(req, { params: Promise.resolve({ id: "school-svg-1" }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
      expect(res.headers.get("Cache-Control")).toContain("s-maxage=604800");
      expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
      expect(await res.text()).toBe(svgContent);
    });

    it("redireciona com 307 para /logo.svg quando a escola não possui brasão cadastrado", async () => {
      hoisted.schoolFindUnique.mockResolvedValueOnce({
        id: "school-empty",
        active: true,
        logoUrl: null,
      });

      const req = new Request("https://www.redeativa.app.br/api/schools/school-empty/logo");
      const res = await getSchoolLogoRoute(req, { params: Promise.resolve({ id: "school-empty" }) });

      expect(res.status).toBe(307);
      expect(res.headers.get("Location")).toBe("https://www.redeativa.app.br/logo.svg");
    });

    it("N2: não diferencia escola inexistente de escola sem brasão (ambas retornam 307 /logo.svg)", async () => {
      hoisted.schoolFindUnique.mockResolvedValueOnce(null);
      const reqMissing = new Request("https://www.redeativa.app.br/api/schools/id-inexistente/logo");
      const resMissing = await getSchoolLogoRoute(reqMissing, { params: Promise.resolve({ id: "id-inexistente" }) });

      expect(resMissing.status).toBe(307);
      expect(resMissing.headers.get("Location")).toBe("https://www.redeativa.app.br/logo.svg");
    });
  });

  describe("P5 & P9: Consistência de SUPERADMIN e Guard de Dev Auth em Produção", () => {
    it("P5: resolveTokenRole sempre retorna SUPERADMIN para root admin tanto no 1º login quanto no refresh", () => {
      expect(resolveTokenRole({ isRootAdmin: true, dbRole: "ADMIN" })).toBe("SUPERADMIN");
      expect(resolveTokenRole({ isRootAdmin: true, activeSchoolRole: "GESTOR_ESCOLAR", dbRole: "ADMIN" })).toBe("SUPERADMIN");
      expect(resolveTokenRole({ isRootAdmin: false, activeSchoolRole: "GESTOR_ESCOLAR", dbRole: "PEDAGOGA" })).toBe("GESTOR_ESCOLAR");
      expect(resolveTokenRole({ isRootAdmin: false, dbRole: "PEDAGOGA" })).toBe("PEDAGOGA");
    });

    it("P9: assertNoDevAuthInProduction lança erro fatal se ENABLE_DEV_AUTH=true em produção", () => {
      expect(() =>
        assertNoDevAuthInProduction({ NODE_ENV: "production", ENABLE_DEV_AUTH: "true" })
      ).toThrow(/CRITICAL SECURITY/);

      expect(() =>
        assertNoDevAuthInProduction({ NODE_ENV: "development", VERCEL_ENV: "production", ENABLE_DEV_AUTH: "true" })
      ).toThrow(/CRITICAL SECURITY/);

      expect(() =>
        assertNoDevAuthInProduction({ NODE_ENV: "development", ENABLE_DEV_AUTH: "true" })
      ).not.toThrow();
    });
  });

  describe("P4 & N5: normalizeRuntimeDatabaseUrl e withNeonWakeRetry", () => {
    it("P4: preserva host -pooler do Neon e injeta pgbouncer=true, connection_limit=1, pool_timeout=20 e connect_timeout=15", async () => {
      const { normalizeRuntimeDatabaseUrl } = await vi.importActual<typeof import("@/lib/prisma")>("@/lib/prisma");
      const rawPooler = "postgresql://user:pass@ep-test-pooler.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require";
      const normalized = normalizeRuntimeDatabaseUrl(rawPooler)!;

      expect(normalized).toContain("ep-test-pooler.c-2.sa-east-1.aws.neon.tech");
      expect(normalized).toContain("pgbouncer=true");
      expect(normalized).toContain("connection_limit=1");
      expect(normalized).toContain("pool_timeout=20");
      expect(normalized).toContain("connect_timeout=15");
    });

    it("N5: withNeonWakeRetry absorve erro transitório P1001 de wake-up do Neon e sucede na tentativa seguinte", async () => {
      const { withNeonWakeRetry } = await vi.importActual<typeof import("@/lib/prisma")>("@/lib/prisma");
      let calls = 0;
      const result = await withNeonWakeRetry(async () => {
        calls += 1;
        if (calls === 1) {
          const err: any = new Error("Can't reach database server");
          err.code = "P1001";
          throw err;
        }
        return "woke-up-ok";
      }, 2);

      expect(result).toBe("woke-up-ok");
      expect(calls).toBe(2);
    });
  });

  describe("getCurrentSchool & PUT /api/schools/[id] sem trafegar logoUrl Base64", () => {
    it("getCurrentSchool omite logoUrl e syncTokenHash do select Prisma e retorna URL proxy", async () => {
      hoisted.schoolFindFirst.mockResolvedValueOnce({
        id: "school-leopoldina",
        inepCode: "41042730",
        name: "Colégio Estadual Leopoldina B. Pedroso",
        city: "Ponta Grossa",
        state: "PR",
        nre: "Ponta Grossa",
        network: "ESTADUAL",
        phone: null,
        email: null,
        active: true,
        settingsJson: null,
        networkId: null,
        updatedAt: new Date("2026-11-10T10:00:00.000Z"),
      });

      const school = await getCurrentSchool();

      expect(hoisted.schoolFindFirst).toHaveBeenCalledTimes(1);
      const queryArgs = (hoisted.schoolFindFirst.mock.calls as any[])[0][0];
      expect(queryArgs.select).toBeDefined();
      expect(queryArgs.select.logoUrl).toBeUndefined();
      expect(queryArgs.select.syncTokenHash).toBeUndefined();
      expect(school.logoUrl).toMatch(/^\/api\/schools\/school-leopoldina\/logo\?v=\d+$/);
    });

    it("PUT /api/schools/[id] preserva o brasão no banco ao receber o caminho proxy de volta", async () => {
      hoisted.schoolFindUnique.mockResolvedValueOnce({
        inepCode: "99998888",
        name: "Escola Otimizada",
      });

      const req = new Request("http://localhost/api/schools/school-opt-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Escola Otimizada Renomeada",
          logoUrl: "/api/schools/school-opt-1/logo?v=1700000",
        }),
      });

      const res = await putSchoolRoute(req, { params: Promise.resolve({ id: "school-opt-1" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(hoisted.schoolUpdate).toHaveBeenCalledTimes(1);
      const updateCall = (hoisted.schoolUpdate.mock.calls as any[])[0][0];
      expect(updateCall.data.logoUrl).toBeUndefined();
      expect(updateCall.select?.logoUrl).toBeUndefined();
      expect(data.school.logoUrl).toMatch(/^\/api\/schools\/school-opt-1\/logo\?v=\d+$/);
    });

    it("PUT /api/schools/[id] atualiza logoUrl normalmente quando recebe novo upload data:image", async () => {
      hoisted.schoolFindUnique.mockResolvedValueOnce({
        inepCode: "99998888",
        name: "Escola Otimizada",
      });

      const req = new Request("http://localhost/api/schools/school-opt-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Escola Com Novo Brasão",
          logoUrl: "data:image/png;base64,iVBORw0KGgo=",
        }),
      });

      const res = await putSchoolRoute(req, { params: Promise.resolve({ id: "school-opt-1" }) });
      expect(res.status).toBe(200);
      const updateCall = (hoisted.schoolUpdate.mock.calls as any[])[0][0];
      expect(updateCall.data.logoUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
    });
  });

  describe("loadStudent360Bundle sem Base64 de scans e assinaturas", () => {
    it("omite physicalSignedScanData, signatureData e biometricStrokeData do select e expõe hasPhysicalScan", async () => {
      hoisted.studentFindUnique.mockResolvedValueOnce({
        id: "stu-1",
        schoolId: "school-1",
        name: "Estudante Teste",
      });
      hoisted.pedagogicalMinuteFindMany.mockResolvedValueOnce([
        {
          id: "min-1",
          schoolId: "school-1",
          physicalScanSha256: "abc123sha",
          physicalScanUploadedAt: new Date("2026-11-10T11:00:00.000Z"),
        },
      ]);

      const bundle = await loadStudent360Bundle("stu-1");

      expect(bundle).not.toBeNull();
      const minuteArgs = (hoisted.pedagogicalMinuteFindMany.mock.calls as any[])[0][0];
      expect(minuteArgs.select).toBeDefined();
      expect(minuteArgs.select.physicalSignedScanData).toBeUndefined();
      expect(minuteArgs.select.participants.select.signatureData).toBeUndefined();
      expect(minuteArgs.select.participants.select.biometricStrokeData).toBeUndefined();
      expect(minuteArgs.select.participants.select.mobileSignToken).toBeUndefined();
      expect(minuteArgs.select.participants.select.hasSignature).toBe(true);
      expect(minuteArgs.select.participants.select.hasActiveSignLink).toBe(true);

      expect(bundle?.minutes[0].hasPhysicalScan).toBe(true);
      expect(bundle?.minutes[0].physicalSignedScanData).toBeNull();
    });
  });

  describe("authenticateExtensionSyncToken com zero escritas em RateLimitBucket para tokens válidos", () => {
    it("não chama checkRateLimit nem resetRateLimit quando o token é válido e não havia falhas prévias", async () => {
      hoisted.getRateLimitStatus.mockResolvedValueOnce({ count: 0, isBlocked: false, retryAfterSeconds: 0 });
      hoisted.findSchoolBySyncToken.mockResolvedValueOnce({
        id: "school-piloto",
        name: "Escola Piloto",
      });

      const req = new Request("https://www.redeativa.app.br/api/frequencia/sync", {
        method: "POST",
        headers: {
          Authorization: "Bearer token-valido-123",
          "x-forwarded-for": "187.10.20.30",
        },
      });

      const result = await authenticateExtensionSyncToken({
        req,
        corsHeaders: {},
        label: "Extensão Power BI",
      });

      expect(result.ok).toBe(true);
      expect(hoisted.getRateLimitStatus).toHaveBeenCalledTimes(1);
      expect(hoisted.checkRateLimit).not.toHaveBeenCalled();
      expect(hoisted.resetRateLimit).not.toHaveBeenCalled();
    });

    it("registra falha em checkRateLimit quando o token é inválido e reseta após sucesso subsequente", async () => {
      hoisted.getRateLimitStatus.mockResolvedValueOnce({ count: 0, isBlocked: false, retryAfterSeconds: 0 });
      hoisted.findSchoolBySyncToken.mockResolvedValueOnce(null);

      const invalidReq = new Request("https://www.redeativa.app.br/api/frequencia/sync", {
        method: "POST",
        headers: { Authorization: "Bearer errado" },
      });

      const failed = await authenticateExtensionSyncToken({
        req: invalidReq,
        corsHeaders: {},
        label: "Extensão Power BI",
      });

      expect(failed.ok).toBe(false);
      if (!failed.ok) {
        expect(failed.response.status).toBe(401);
      }
      expect(hoisted.checkRateLimit).toHaveBeenCalledTimes(1);

      hoisted.getRateLimitStatus.mockResolvedValueOnce({ count: 2, isBlocked: false, retryAfterSeconds: 120 });
      hoisted.findSchoolBySyncToken.mockResolvedValueOnce({ id: "school-piloto", name: "Escola Piloto" });

      const validReq = new Request("https://www.redeativa.app.br/api/frequencia/sync", {
        method: "POST",
        headers: { Authorization: "Bearer correto" },
      });

      const recovered = await authenticateExtensionSyncToken({
        req: validReq,
        corsHeaders: {},
        label: "Extensão Power BI",
      });

      expect(recovered.ok).toBe(true);
      expect(hoisted.resetRateLimit).toHaveBeenCalledTimes(1);
    });

    it("bloqueia com HTTP 429 sem tocar findSchoolBySyncToken quando o IP já atingiu o limite de falhas", async () => {
      hoisted.getRateLimitStatus.mockResolvedValueOnce({ count: 10, isBlocked: false, retryAfterSeconds: 45 });

      const req = new Request("https://www.redeativa.app.br/api/serp/sync", {
        method: "POST",
        headers: { Authorization: "Bearer tentativa-brute-force" },
      });

      const blocked = await authenticateExtensionSyncToken({
        req,
        corsHeaders: {},
        label: "Extensão SERP",
      });

      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.response.status).toBe(429);
      }
      expect(hoisted.findSchoolBySyncToken).not.toHaveBeenCalled();
      expect(hoisted.checkRateLimit).not.toHaveBeenCalled();
    });
  });
});
