import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

const hoisted = vi.hoisted(() => ({
  session: null as any,
  cookiesMap: {} as Record<string, string>,
  generatedContents: [] as string[],
  aiThrowError: null as any,
  generateContentImpl: null as null | ((args: any) => Promise<any>),
  schoolRecord: null as any,
  studentFindMany: vi.fn(async () => [] as any[]),
  executeRaw: vi.fn(async () => 1),
  logAudit: vi.fn(async () => {}),
  bundle: null as any,
  prontuarioProps: null as any,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      hoisted.cookiesMap[name] !== undefined
        ? { name, value: hoisted.cookiesMap[name] }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/faltas",
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return {
    ...actual,
    enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
    checkRateLimit: vi.fn(async () => ({
      success: true,
      limit: 20,
      remaining: 19,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 60,
    })),
    getRateLimitStatus: vi.fn(async () => ({ count: 0, retryAfterSeconds: 0 })),
    resetRateLimit: vi.fn(async () => {}),
  };
});

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: vi.fn(async (args: any) => {
          const textArg =
            typeof args?.contents === "string"
              ? args.contents
              : args?.contents?.[0]?.parts?.[0]?.text || "";
          hoisted.generatedContents.push(textArg);
          if (hoisted.aiThrowError) {
            throw hoisted.aiThrowError;
          }
          if (hoisted.generateContentImpl) {
            return hoisted.generateContentImpl(args);
          }
          return { text: "{}" };
        }),
      };
      interactions = {
        create: vi.fn(async (args: any) => {
          const textArg =
            typeof args?.input === "string"
              ? args.input
              : args?.input?.[0]?.text || "";
          hoisted.generatedContents.push(textArg);
          if (hoisted.aiThrowError) {
            throw hoisted.aiThrowError;
          }
          return { output_text: null };
        }),
      };
    },
  };
});

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    ...actual,
    logAudit: hoisted.logAudit,
  };
});

vi.mock("@/lib/safePhase3Queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/safePhase3Queries")>();
  return {
    ...actual,
    loadStudent360Bundle: vi.fn(async () => hoisted.bundle),
  };
});

vi.mock("@/lib/prisma", () => {
  const prismaObj: any = {
    school: {
      findUnique: vi.fn(async () => hoisted.schoolRecord),
      findFirst: vi.fn(async () => hoisted.schoolRecord),
    },
    student: {
      findMany: hoisted.studentFindMany,
      update: vi.fn(async () => ({})),
    },
    absenceJustification: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $executeRaw: hoisted.executeRaw,
    $queryRaw: vi.fn(async () => [{ studentId: "st-1", attendancePercent: 72 }]),
  };
  prismaObj.$transaction = vi.fn(async (arg: any) =>
    typeof arg === "function" ? arg(prismaObj) : Promise.all(arg)
  );
  return { prisma: prismaObj };
});

import { createAiPseudonymizer } from "@/lib/aiPseudonymizer";
import { getCurrentSchool, invalidateSchoolCache } from "@/lib/currentSchool";
import { computeDossierIntegritySeal } from "@/lib/messageCrypto";
import { POST as generateTemplatePost } from "@/app/api/ai/generate-template/route";
import { POST as classifyReplyPost } from "@/app/api/ai/classify-reply/route";
import { GET as testKeyGet, POST as testKeyPost } from "@/app/api/ai/test-key/route";
import { POST as formalizeAtaPost } from "@/app/api/ai/formalize-ata/route";
import { POST as frequenciaSyncPost } from "@/app/api/frequencia/sync/route";
import { POST as serpSyncPost } from "@/app/api/serp/sync/route";
import { POST as lowAttendanceImportPost } from "@/app/api/low-attendance/import/route";
import FaltasClient from "@/app/faltas/FaltasClient";
import ProntuarioClient from "@/app/alunos/[id]/ProntuarioClient";
import DossieClient from "@/app/alunos/[id]/dossie/DossieClient";
import BoletimClient from "@/app/boletim/BoletimClient";

describe("Remediação Setorial do Setor D (D1 a D5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSchoolCache();
    hoisted.generatedContents = [];
    hoisted.aiThrowError = null;
    hoisted.generateContentImpl = null;
    hoisted.cookiesMap = {};
    hoisted.session = {
      user: {
        id: "user-ped-1",
        name: "Pedagoga Teste",
        email: "pedagoga@escola.pr.gov.br",
        role: "PEDAGOGA",
        active: true,
        schoolId: "school-essencial-1",
        schools: [{ schoolId: "school-essencial-1", role: "PEDAGOGA", active: true }],
      },
    };
    hoisted.schoolRecord = {
      id: "school-essencial-1",
      inepCode: "41999111",
      name: "Escola Municipal Modelo",
      city: "Tibagi",
      state: "PR",
      nre: "SEMEC Tibagi",
      network: "MUNICIPAL",
      phone: null,
      email: null,
      active: true,
      settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
      networkId: "net-tibagi",
      educationNetwork: { settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }) },
      updatedAt: new Date("2026-11-18T10:00:00.000Z"),
    };
    hoisted.studentFindMany.mockResolvedValue([]);
    hoisted.executeRaw.mockResolvedValue(1);
    hoisted.bundle = null;
  });

  describe("[D3] Pseudonimização Obrigatória em IA & Hardening de Regex", () => {
    it("mascara telefones com parênteses sem deixar '(' residual e mascara CGMs isolados ou rotulados", () => {
      const pseudo = createAiPseudonymizer(["Lucas Silva"], ["Maria Silva"]);
      const raw =
        "Aluno Lucas Silva, CGM: 1018613740 (ou 987654321), telefone (42) 99888-7766 e CPF 123.456.789-00.";
      const masked = pseudo.maskText(raw);

      expect(masked).not.toContain("Lucas Silva");
      expect(masked).not.toContain("(42)");
      expect(masked).not.toContain("99888-7766");
      expect(masked).not.toContain("1018613740");
      expect(masked).not.toContain("987654321");
      expect(masked).not.toContain("123.456.789-00");
      expect(masked).toContain("telefone [TELEFONE_SIGILOSO]");
      expect(masked).toContain("CGM [CGM_SIGILOSO]");
      expect(masked).toContain("[DOCUMENTO_SIGILOSO]");
    });

    it("POST /api/ai/generate-template gera modelo local sem enviar dados ao Google Gemini mesmo com x-gemini-key", async () => {
      const req = new Request("http://localhost/api/ai/generate-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-key": "AIzaFakeKey1234567890",
        },
        body: JSON.stringify({
          prompt: "Faltas consecutivas",
        }),
      });

      const res = await generateTemplatePost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.mode).toBe("LOCAL_ONLY");
      expect(hoisted.generatedContents).toHaveLength(0);
    });

    it("POST /api/ai/classify-reply classifica retorno localmente com ZERO envio ao provedor externo", async () => {
      const req = new Request("http://localhost/api/ai/classify-reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-key": "AIzaFakeKey1234567890",
        },
        body: JSON.stringify({
          rawReply: "Ela estava doente e foi ao médico hoje",
          studentName: "Ana Clara Souza",
          guardianName: "Marcos Souza",
          reasonTitle: "Contato sobre Ana Clara Souza (42) 99123-4567 CGM 1018613740",
        }),
      });

      const res = await classifyReplyPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.mode).toBe("LOCAL_ONLY");
      expect(data.classification.category).toBe("SAUDE");
      expect(hoisted.generatedContents).toHaveLength(0);
    });

    it("GET/POST /api/ai/test-key e /api/ai/formalize-ata ocultam credenciais de servidor e /formalize-ata pseudonimiza PII antes do Gemini", async () => {
      const prevKey = process.env.GEMINI_API_KEY;
      const prevEnabled = process.env.AI_FORMALIZE_EXTERNAL_ENABLED;
      const prevAllowed = process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
      process.env.GEMINI_API_KEY = "AIzaSecretServerKeyValue12345";
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";
      process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = "school-essencial-1";
      hoisted.schoolRecord.settingsJson = JSON.stringify({
        edition: "INSTITUCIONAL_ESSENCIAL",
        aiExternalFormalizeEnabled: true,
        aiExternalFormalizePolicyVersion: 2,
      });
      try {
        const getRes = await testKeyGet();
        const getData = await getRes.json();
        expect(getData.hasServerKey).toBe(true);
        expect(getData.schoolAuthorized).toBe(true);
        expect(JSON.stringify(getData)).not.toContain("AIzaSecret");

        const postRes = await testKeyPost(
          new Request("http://localhost/api/ai/test-key", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          })
        );
        expect(postRes.status).toBe(200);
        const postData = await postRes.json();
        expect(postData.schoolAuthorized).toBe(true);
        expect(JSON.stringify(postData)).not.toContain("AIzaSecret");

        hoisted.aiThrowError = new Error("RAW_UPSTREAM_LEAK_TOKEN_XYZ");
        const formRes = await formalizeAtaPost(
          new Request("http://localhost/api/ai/formalize-ata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              isConfidential: false,
              nonConfidentialConfirmed: true,
              ataScope: "STUDENTS",
              category: "ACOMPANHAMENTO_PEDAGOGICO",
              rawNotes: "Compareceu a mãe Maria Pedro referente ao aluno João Pedro (42) 99888-7766.",
              studentNames: ["João Pedro"],
              guardianNames: ["Maria Pedro"],
            }),
          })
        );
        expect(formRes.status).toBe(200);
        const formData = await formRes.json();
        expect(formData.usedFallback).toBe(true);
        expect(formData.fallbackReason).not.toContain("RAW_UPSTREAM_LEAK_TOKEN_XYZ");
        expect(hoisted.generatedContents.length).toBeGreaterThan(0);
        expect(hoisted.generatedContents[0]).not.toContain("João Pedro");
        expect(hoisted.generatedContents[0]).not.toContain("Maria Pedro");
        expect(hoisted.generatedContents[0]).not.toContain("99888-7766");
      } finally {
        if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = prevKey;
        if (prevEnabled === undefined) delete process.env.AI_FORMALIZE_EXTERNAL_ENABLED;
        else process.env.AI_FORMALIZE_EXTERNAL_ENABLED = prevEnabled;
        if (prevAllowed === undefined) delete process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
        else process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = prevAllowed;
      }
    });
  });

  describe("[D1] Importação Manual de Frequência vs Bloqueio 403 e Herança de Rede", () => {
    it("permite importação manual via POST /api/low-attendance/import em INSTITUCIONAL_ESSENCIAL enquanto mantém 403 em /api/frequencia/sync e /api/serp/sync", async () => {
      hoisted.studentFindMany.mockResolvedValue([
        {
          id: "st-1",
          cgm: "1018613740",
          name: "ALUNO TESTE",
          isExchangeStudent: false,
          isSpecialNeeds: false,
          age: 14,
        },
      ]);

      const freqReq = new Request("http://localhost/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [{ cgm: "1018613740", nome: "ALUNO TESTE", mediaGeral: "72%" }],
        }),
      });
      expect((await frequenciaSyncPost(freqReq)).status).toBe(403);

      const serpReq = new Request("http://localhost/api/serp/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fichas: [{ cgm: "1018613740", nome: "ALUNO TESTE", status: "EM_ACOMPANHAMENTO" }],
        }),
      });
      expect((await serpSyncPost(serpReq)).status).toBe(403);

      const manualReq = new Request("http://localhost/api/low-attendance/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [{ cgm: "1018613740", nome: "ALUNO TESTE", mediaGeral: "72%" }],
        }),
      });
      const manualRes = await lowAttendanceImportPost(manualReq);
      expect(manualRes.status).toBe(200);
      const manualData = await manualRes.json();
      expect(manualData.sucesso).toBe(true);
      expect(manualData.atualizados).toBe(1);
    });

    it("propaga educationNetwork.settingsJson em getSchoolContextByVerifiedId para resolver edição herdada da rede", async () => {
      hoisted.schoolRecord = {
        id: "school-inherited-1",
        inepCode: "41888222",
        name: "Escola Estadual Rede Integrada",
        city: "Curitiba",
        state: "PR",
        nre: "Curitiba",
        network: "ESTADUAL",
        phone: null,
        email: null,
        active: true,
        settingsJson: null,
        networkId: "net-piloto",
        educationNetwork: {
          schools: [
            {
              settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }),
            },
          ],
        },
        updatedAt: new Date("2026-11-18T10:00:00.000Z"),
      };

      const { getSchoolContextByVerifiedId } = await import("@/lib/currentSchool");
      const resolved = await getSchoolContextByVerifiedId("school-inherited-1");
      expect(resolved?.edition).toBe("PILOTO_INTEGRADA");
    });
  });

  describe("[D4] Sigilo ECA no Prontuário 360º e Dossiê", () => {
    it("DossieClient anonimiza co-envolvidos em subject, summary e agreementsSummary e calcula selo apenas sobre atas exibidas", () => {
      const commonProps = {
        student: {
          id: "stu-1",
          name: "Carlos Almeida",
          cgm: "1018613740",
          schoolId: "school-essencial-1",
          phone: "42999991111",
          guardianName: "Sônia Almeida",
          classGroup: { name: "8º Ano A", shift: "MANHA", segment: "FUNDAMENTAL" },
          messageLogs: [],
        },
        contacts: [],
        justifications: [],
        attendances: [],
        snapshots: [],
        school: {
          name: "Escola Municipal Modelo",
          city: "Tibagi",
          nre: "SEMEC Tibagi",
          network: "MUNICIPAL",
          inepCode: "41999111",
          edition: "INSTITUCIONAL_ESSENCIAL" as const,
        },
        emittedBy: { name: "Pedagoga Teste", email: "pedagoga@escola.pr.gov.br" },
        emittedAtIso: "2026-11-18T12:00:00.000Z",
      };

      const finalizedMinute = {
        id: "min-1",
        ataNumber: 1,
        year: 2026,
        status: "FINALIZED",
        isConfidential: false,
        attendedAt: "2026-11-10T10:00:00.000Z",
        subject: "Mediação envolvendo Carlos Almeida e Pedro Henrique Silva",
        summary: "Reunião sobre Carlos Almeida e Pedro Henrique Silva no pátio.",
        agreementsSummary: "Pedro Henrique Silva cumprirá combinados em turma distinta.",
        authorName: "Pedagoga Teste",
        authorRole: "PEDAGOGA",
        verificationCode: "ATA-1234-5678",
        participants: [],
        students: [
          { studentId: "stu-1", studentNameSnapshot: "Carlos Almeida" },
          { studentId: "stu-2", studentNameSnapshot: "Pedro Henrique Silva" },
        ],
      };

      const draftMinute = {
        ...finalizedMinute,
        id: "min-draft",
        status: "DRAFT",
        ataNumber: null,
        subject: "Rascunho não exibido",
      };

      const html = renderToString(
        React.createElement(DossieClient, {
          ...commonProps,
          minutes: [finalizedMinute, draftMinute],
        })
      );

      expect(html).not.toContain("Pedro Henrique Silva");
      expect(html).toContain("P. H. S. (outro estudante)");

      const expectedSeal = computeDossierIntegritySeal({
        studentId: "stu-1",
        studentName: "Carlos Almeida",
        cgm: "1018613740",
        schoolId: "school-essencial-1",
        schoolInep: "41999111",
        totalMessages: 0,
        totalMinutes: 1, // apenas finalizedMinute (draftMinute excluído)
        totalJustifications: 0,
        emittedAtIso: "2026-11-18T12:00:00.000Z",
        emittedByEmail: "pedagoga@escola.pr.gov.br",
      });
      expect(html).toContain(expectedSeal);
    });

    it("SSR /alunos/[id] redacta subject, participants e addendums quando usuário não tem acesso à ata sigilosa", async () => {
      hoisted.bundle = {
        student: {
          id: "stu-1",
          name: "Carlos Almeida",
          schoolId: "school-essencial-1",
          classGroup: { name: "8º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
          messageLogs: [],
        },
        contacts: [],
        justifications: [],
        attendances: [],
        snapshots: [],
        minutes: [
          {
            id: "min-secret-1",
            schoolId: "school-essencial-1",
            status: "FINALIZED",
            isConfidential: true,
            authorId: "other-author",
            authorEmail: "diretora@escola.pr.gov.br",
            attendedAt: "2026-11-10T10:00:00.000Z",
            subject: "ASSUNTO CONFIDENCIAL SENSÍVEL",
            rawNotes: "NOTAS SECRETAS",
            summary: "RESUMO SECRETO ECA",
            agreementsSummary: "COMBINADO SECRETO",
            actionItems: [{ id: "a1", description: "AÇÃO SECRETA" }],
            addendums: [{ id: "add1", content: "ADENDO SECRETO" }],
            participants: [{ id: "p1", name: "Testemunha Sigilosa" }],
          },
        ],
      };

      const { default: ProntuarioPage } = await import("@/app/alunos/[id]/page");
      const element: any = await ProntuarioPage({
        params: Promise.resolve({ id: "stu-1" }),
      });

      const passedMinute = element.props.initialMinutes[0];
      expect(passedMinute.subject).toBe("Atendimento sob sigilo");
      expect(passedMinute.rawNotes).toBeNull();
      expect(passedMinute.agreementsSummary).toBeNull();
      expect(passedMinute.actionItems).toEqual([]);
      expect(passedMinute.addendums).toEqual([]);
      expect(passedMinute.participants).toEqual([]);
      expect(passedMinute.summary).not.toContain("RESUMO SECRETO ECA");
    });
  });

  describe("[D5] Neutralidade de Edição & Regra 10 (GEMINI.md)", () => {
    it("oculta extensão, SERP e Power BI na edição INSTITUCIONAL_ESSENCIAL e cumpre Regra 10 nas telas do Setor D", () => {
      const faltasHtml = renderToString(
        React.createElement(FaltasClient, {
          rankedAbsences: [],
          lowAttendance: [],
          classGroups: [],
          templates: [],
          currentSchool: {
            id: "school-essencial-1",
            name: "Escola Municipal Modelo",
            edition: "INSTITUCIONAL_ESSENCIAL",
          },
          currentUser: { name: "Diretora", email: "dir@escola.pr.gov.br", isAdmin: true },
        })
      );

      expect(faltasHtml).not.toContain("Baixar Extensão");
      expect(faltasHtml).not.toContain("Chave da Extensão");
      expect(faltasHtml).not.toContain("SERP");
      expect(faltasHtml).not.toContain("Power BI");
      expect(faltasHtml).toContain("Importar Frequência");

      const boletimHtml = renderToString(
        React.createElement(BoletimClient, {
          initialData: {
            generatedAt: "2026-11-18T12:00:00.000Z",
            school: {
              name: "Escola Municipal Modelo",
              nre: "SEMEC Tibagi",
              city: "Tibagi",
              inepCode: "41999111",
            },
            kpis: {
              totalStudents: 100,
              criticalCount: 5,
              criticalWithoutRecentContactCount: 2,
              serpActiveCount: 1,
              sentLast7Days: 10,
              repliedLast7Days: 8,
              replyRatePercent: 80,
              abruptDropCount: 1,
            },
            shiftBreakdown: { MANHA: 5, TARDE: 0, NOITE: 0 },
            topRiskClasses: [],
            abruptDrops: [],
            actionQueue: [],
          },
          schoolEdition: "INSTITUCIONAL_ESSENCIAL",
          schoolNetwork: "MUNICIPAL",
          currentUser: { name: "Pedagoga", email: "ped@escola.pr.gov.br", role: "PEDAGOGA" },
        })
      );
      expect(boletimHtml).not.toContain("SERP");
      expect(boletimHtml).not.toContain("SEED-PR");
      expect(boletimHtml).toContain("Secretaria Municipal de Educação");

      const prontuarioHtml = renderToString(
        React.createElement(ProntuarioClient, {
          initialStudent: {
            id: "stu-1",
            name: "Estudante Teste",
            classGroup: { name: "6º Ano A", segment: "FUNDAMENTAL", shift: "MANHA" },
            messageLogs: [],
          },
          initialContacts: [],
          initialJustifications: [],
          initialAttendances: [],
          initialSnapshots: [],
          initialMinutes: [],
          initialTab: "timeline",
          currentSchool: {
            id: "school-essencial-1",
            name: "Escola Municipal Modelo",
            edition: "INSTITUCIONAL_ESSENCIAL",
          },
        })
      );
      expect(prontuarioHtml).not.toMatch(/f[ée]\s+p[úu]blica/i);
      expect(prontuarioHtml).not.toMatch(/SHA-256/i);
      expect(prontuarioHtml).not.toContain("Dossiê Oficial");
      expect(prontuarioHtml).not.toContain("SERP");
      expect(prontuarioHtml).not.toContain("Power BI");

      // Verifica estaticamente ausência de termos proibidos pela Regra 10 nas UIs do Setor D
      const uiFiles = [
        "src/app/faltas/FaltasClient.tsx",
        "src/app/alunos/SereImportModal.tsx",
        "src/app/alunos/AlunosClient.tsx",
        "src/app/alunos/[id]/ProntuarioClient.tsx",
        "src/app/alunos/[id]/dossie/DossieClient.tsx",
        "src/app/boletim/BoletimClient.tsx",
        "src/app/atestados/AtestadosClient.tsx",
        "src/app/relatorios/RelatoriosClient.tsx",
        "src/app/secretaria/SecretariaClient.tsx",
        "src/lib/predictiveAnalytics.ts",
      ];
      const forbiddenPatterns = [
        /f[ée]\s+p[úu]blica/i,
        /imut[áa]vel/i,
        /SHA-256/i,
        /Dossi[êe]\s+Oficial/i,
        /CERTID[ÃA]O/i,
        /ocorr[êe]ncia/i,
        /\b14\.063\b/,
        /\b2\.200-2\b/,
        /Art\.\s*56/i,
      ];
      for (const rel of uiFiles) {
        const content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
        for (const pat of forbiddenPatterns) {
          expect(content, `${rel} violou padrão ${pat}`).not.toMatch(pat);
        }
      }
      expect(
        fs.readFileSync(path.resolve(process.cwd(), "src/app/faltas/FaltasClient.tsx"), "utf8")
      ).toContain("/api/low-attendance/import");
    });
  });
});
