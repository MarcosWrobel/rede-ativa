import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  auth: vi.fn(),
  cookiesMap: new Map<string, string>(),
  onSchoolFindUnique: null as null | ((callIndex: number, schoolId: string) => void),
  schoolFindUniqueCallCount: 0,
  schoolRecord: null as any,
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

vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
  RATE_LIMIT_POLICIES: {
    AI_ENDPOINT: { key: "ai", max: 100, windowSeconds: 60 },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        id: "usr-ped",
        email: "pedagoga.piloto@escola.pr.gov.br",
        name: "Pedagoga Piloto",
        role: "PEDAGOGA",
        active: true,
        schoolId: "default-leopoldina",
        schools: [
          {
            userId: "usr-ped",
            schoolId: "default-leopoldina",
            role: "PEDAGOGA",
            active: true,
            school: hoisted.schoolRecord,
          },
        ],
        networks: [],
      })),
    },
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        hoisted.schoolFindUniqueCallCount += 1;
        if (where?.id && hoisted.onSchoolFindUnique) {
          hoisted.onSchoolFindUnique(hoisted.schoolFindUniqueCallCount, where.id);
        }
        return where?.id === "default-leopoldina" ? hoisted.schoolRecord : null;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => ({ id: `audit-${Date.now()}`, ...data })),
    },
  },
}));

import { POST as formalizeAtaPost } from "@/app/api/ai/formalize-ata/route";

describe("Fase 01 — F04 SDK real @google/genai e transporte simulado (maxRetries: 0 & store: false)", () => {
  const prevEnv = {
    FORCE_STRICT_DB_AUTH: process.env.FORCE_STRICT_DB_AUTH,
    AI_FORMALIZE_EXTERNAL_ENABLED: process.env.AI_FORMALIZE_EXTERNAL_ENABLED,
    AI_FORMALIZE_ALLOWED_SCHOOL_IDS: process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.cookiesMap.clear();
    hoisted.cookiesMap.set("active_school_id", "default-leopoldina");
    hoisted.schoolFindUniqueCallCount = 0;
    hoisted.onSchoolFindUnique = null;
    hoisted.schoolRecord = {
      id: "default-leopoldina",
      inepCode: "41042730",
      name: "Escola Piloto Sintética",
      city: "Ponta Grossa",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
      networkId: null,
      active: true,
      settingsJson: JSON.stringify({
        edition: "PILOTO_INTEGRADA",
        aiExternalFormalizeEnabled: true,
        aiExternalFormalizePolicyVersion: 2,
      }),
      updatedAt: new Date("2026-11-24T08:00:00.000Z"),
    };
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-ped",
        email: "pedagoga.piloto@escola.pr.gov.br",
        name: "Pedagoga Piloto",
        role: "PEDAGOGA",
        schoolId: "default-leopoldina",
      },
    });
    process.env.FORCE_STRICT_DB_AUTH = "true";
    process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";
    process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = "default-leopoldina";
    process.env.GEMINI_API_KEY = "AIzaSyntheticRealSdkTransportTest123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const extractFetchUrl = (input: RequestInfo | URL): string => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  };

  const basePayload = {
    isConfidential: false,
    nonConfidentialConfirmed: true,
    ataScope: "STUDENTS",
    category: "ACOMPANHAMENTO_PEDAGOGICO",
    rawNotes:
      "Ana Paula Oliveira compareceu com Carlos Oliveira em 15/09/2026 às 14:30 (CPF 123.456.789-00).",
    studentNames: ["Ana Paula Oliveira"],
    guardianNames: ["Carlos Oliveira"],
    attendedAt: "2026-09-15T14:30:00-03:00",
  };

  it("ao receber 503 em todos os modelos, interactions.create faz apenas 1 chamada HTTP ({ maxRetries: 0, store: false }) e zero retentativas internas", async () => {
    const transportCalls: Array<{ url: string; bodyText: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractFetchUrl(input);
        const bodyText =
          typeof init?.body === "string"
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : "";
        transportCalls.push({ url, bodyText });
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "The model is currently unavailable.",
              status: "UNAVAILABLE",
            },
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );

    const res = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basePayload),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.usedFallback).toBe(true);
    expect(data.mode).toBe("LOCAL_FALLBACK");
    expect(data.result.formalSummary).toContain("Ana Paula Oliveira");

    const generateContentCalls = transportCalls.filter((c) =>
      c.url.includes(":generateContent")
    );
    const interactionsCalls = transportCalls.filter((c) =>
      c.url.includes("/interactions")
    );

    expect(generateContentCalls).toHaveLength(4);
    expect(interactionsCalls).toHaveLength(1);
    expect(transportCalls).toHaveLength(5);

    const interactionBody = JSON.parse(interactionsCalls[0].bodyText);
    expect(interactionBody.store).toBe(false);
    expect(interactionsCalls[0].bodyText).not.toContain("Ana Paula");
    expect(interactionsCalls[0].bodyText).not.toContain("Carlos Oliveira");
    expect(interactionsCalls[0].bodyText).not.toContain("Escola Piloto");
    expect(interactionsCalls[0].bodyText).not.toContain("123.456.789-00");
    expect(interactionsCalls[0].bodyText).not.toContain("15/09/2026");
  }, 15000);

  it("desligamento da política após a 1ª tentativa 503 impede novos envios no transporte e conclui localmente", async () => {
    const transportCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = extractFetchUrl(input);
        transportCalls.push(url);
        return new Response(
          JSON.stringify({ error: { code: 503, message: "UNAVAILABLE", status: "UNAVAILABLE" } }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    // #1 requireAuthorizedSchool, #2 elegibilidade inicial, #3 preDispatch, #4 antes 1ª tentativa, #5 antes 2ª tentativa -> desliga
    hoisted.onSchoolFindUnique = (callIndex, schoolId) => {
      if (schoolId === "default-leopoldina" && callIndex === 5) {
        hoisted.schoolRecord = {
          ...hoisted.schoolRecord,
          settingsJson: JSON.stringify({
            edition: "PILOTO_INTEGRADA",
            aiExternalFormalizeEnabled: false,
          }),
        };
      }
    };

    const res = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basePayload),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.usedFallback).toBe(true);
    expect(data.mode).toBe("LOCAL_ONLY");
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls[0]).toContain(":generateContent");
    expect(transportCalls.some((u) => u.includes("/interactions"))).toBe(false);
  });

  it("falha ao consultar política imediatamente antes de interactions.create bloqueia chamada alternativa no transporte", async () => {
    const transportCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = extractFetchUrl(input);
        transportCalls.push(url);
        return new Response(
          JSON.stringify({ error: { code: 503, message: "UNAVAILABLE", status: "UNAVAILABLE" } }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    // #1..#3 validações iniciais, #4..#7 os 4 modelos generateContent, #8 antes de interactions.create -> erro DB
    hoisted.onSchoolFindUnique = (callIndex) => {
      if (callIndex === 8) {
        throw new Error("Simulated transient DB read failure");
      }
    };

    const res = await formalizeAtaPost(
      new Request("http://localhost/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basePayload),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.usedFallback).toBe(true);
    expect(data.mode).toBe("LOCAL_ONLY");
    expect(transportCalls).toHaveLength(4);
    expect(transportCalls.every((u) => u.includes(":generateContent"))).toBe(true);
    expect(transportCalls.some((u) => u.includes("/interactions"))).toBe(false);
  }, 15000);
});
