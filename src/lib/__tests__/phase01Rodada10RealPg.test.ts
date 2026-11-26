import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { invalidateSchoolCache } from "@/lib/currentSchool";

const hoisted = vi.hoisted(() => ({
  authSession: null as any,
  cookiesMap: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (key: string) =>
      hoisted.cookiesMap.has(key) ? { name: key, value: hoisted.cookiesMap.get(key)! } : undefined,
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.authSession),
}));

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return {
    ...actual,
    enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
    checkRateLimit: vi.fn(async () => ({ success: true, retryAfterSeconds: 60 })),
    resetRateLimit: vi.fn(async () => {}),
  };
});

import { POST as formalizeAtaPost } from "@/app/api/ai/formalize-ata/route";
import { POST as classifyReplyPost } from "@/app/api/ai/classify-reply/route";
import { PATCH as patchSchoolAiPolicy, GET as getSchoolAiPolicy } from "@/app/api/schools/[id]/ai-policy/route";
import AdminEscolasPage from "@/app/admin/escolas/page";
import DossiePage from "@/app/alunos/[id]/dossie/page";
import { transitionSchoolAiPoliciesToPanelControl } from "@/services/aiPolicyTransitionService";

const RUN_ISOLATED_DB = process.env.REDEATIVA_TEST_ISOLATED_DB === "1";

const SCHOOL_ALLOWED_ID = "syn-r10-ai-allowed";
const SCHOOL_BLOCKED_ID = "syn-r10-ai-blocked";
const SCHOOL_DISABLED_ID = "syn-r10-ai-disabled";
const SCHOOL_UNRELIABLE_ID = "syn-r10-ai-unreliable";
const SCHOOL_DOSSIE_ID = "syn-r10-dossie-school";
const ALL_SCHOOL_IDS = [
  SCHOOL_ALLOWED_ID,
  SCHOOL_BLOCKED_ID,
  SCHOOL_DISABLED_ID,
  SCHOOL_UNRELIABLE_ID,
  SCHOOL_DOSSIE_ID,
];

const PED_R10_ID = "syn-r10-ped";
const SUPER_R10_ID = "syn-r10-super";
const ALL_USER_IDS = [PED_R10_ID, SUPER_R10_ID];

const CG_DOSSIE_ID = "syn-r10-cg-dossie";
const STU_TITULAR_ID = "syn-r10-stu-titular";
const STU_RENOMEADO_ID = "syn-r10-stu-renomeado";
const MINUTE_DOSSIE_ID = "syn-r10-ata-dossie-presentes";

function setSessionActor(params: {
  id: string;
  email: string;
  name: string;
  role: string;
  schoolId: string;
}) {
  hoisted.authSession = {
    user: {
      id: params.id,
      email: params.email,
      name: params.name,
      role: params.role,
      active: true,
      schoolId: params.schoolId,
    },
  };
  hoisted.cookiesMap.set("active_school_id", params.schoolId);
}

async function cleanupFixtures() {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ schoolId: { in: ALL_SCHOOL_IDS } }, { userId: { in: ALL_USER_IDS } }],
    },
  });
  await prisma.pedagogicalMinute.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.student.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.classGroup.deleteMany({
    where: { schoolId: { in: ALL_SCHOOL_IDS } },
  });
  await prisma.userSchool.deleteMany({
    where: {
      OR: [{ schoolId: { in: ALL_SCHOOL_IDS } }, { userId: { in: ALL_USER_IDS } }],
    },
  });
  await prisma.user.deleteMany({
    where: { id: { in: ALL_USER_IDS } },
  });
  await prisma.school.deleteMany({
    where: { id: { in: ALL_SCHOOL_IDS } },
  });
  for (const sid of ALL_SCHOOL_IDS) {
    invalidateSchoolCache(sid);
  }
}

describe.skipIf(!RUN_ISOLATED_DB)(
  "Fase 01 — Rodada 10 Transição Segura de IA e Anonimização de Presentes no Dossiê (PG 16 Real)",
  () => {
    const prevEnv = {
      FORCE_STRICT_DB_AUTH: process.env.FORCE_STRICT_DB_AUTH,
      AI_FORMALIZE_EXTERNAL_ENABLED: process.env.AI_FORMALIZE_EXTERNAL_ENABLED,
      AI_FORMALIZE_ALLOWED_SCHOOL_IDS: process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };

    beforeAll(async () => {
      await cleanupFixtures();

      await prisma.school.createMany({
        data: [
          {
            id: SCHOOL_ALLOWED_ID,
            name: "Escola R10 Legada Autorizada",
            inepCode: "99991001",
            city: "Ponta Grossa",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({
              edition: "PILOTO_INTEGRADA",
              syncTokenEncrypted: "enc-keep-r10-1",
              customPref: "preserve-allowed",
              aiExternalFormalizeEnabled: true,
            }),
          },
          {
            id: SCHOOL_BLOCKED_ID,
            name: "Escola R10 Ligada Fora da Lista",
            inepCode: "99991002",
            city: "Ponta Grossa",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({
              edition: "PILOTO_INTEGRADA",
              customPref: "preserve-blocked",
              aiExternalFormalizeEnabled: true,
            }),
          },
          {
            id: SCHOOL_DISABLED_ID,
            name: "Escola R10 Desligada Local",
            inepCode: "99991003",
            city: "Ponta Grossa",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({
              edition: "INSTITUCIONAL_ESSENCIAL",
              aiExternalFormalizeEnabled: false,
            }),
          },
          {
            id: SCHOOL_UNRELIABLE_ID,
            name: "Escola R10 Lista Não Confiável",
            inepCode: "99991004",
            city: "Ponta Grossa",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({
              edition: "PILOTO_INTEGRADA",
              customUnreliable: "preserve-unreliable",
              aiExternalFormalizeEnabled: true,
            }),
          },
          {
            id: SCHOOL_DOSSIE_ID,
            name: "Escola R10 Dossiê Presentes",
            inepCode: "99991005",
            city: "Ponta Grossa",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({
              edition: "PILOTO_INTEGRADA",
              aiExternalFormalizeEnabled: false,
              aiExternalFormalizePolicyVersion: 2,
            }),
          },
        ],
      });

      await prisma.user.createMany({
        data: [
          {
            id: PED_R10_ID,
            email: "pedagoga.r10@example.invalid",
            name: "Pedagoga Sintética R10",
            role: "PEDAGOGA",
            active: true,
            schoolId: SCHOOL_ALLOWED_ID,
          },
          {
            id: SUPER_R10_ID,
            email: "superadmin.r10@example.invalid",
            name: "SuperAdmin Sintético R10",
            role: "SUPERADMIN",
            active: true,
            schoolId: SCHOOL_ALLOWED_ID,
          },
        ],
      });

      await prisma.userSchool.createMany({
        data: [
          { userId: PED_R10_ID, schoolId: SCHOOL_ALLOWED_ID, role: "PEDAGOGA", active: true },
          { userId: PED_R10_ID, schoolId: SCHOOL_BLOCKED_ID, role: "PEDAGOGA", active: true },
          { userId: PED_R10_ID, schoolId: SCHOOL_DISABLED_ID, role: "PEDAGOGA", active: true },
          { userId: PED_R10_ID, schoolId: SCHOOL_UNRELIABLE_ID, role: "PEDAGOGA", active: true },
          { userId: PED_R10_ID, schoolId: SCHOOL_DOSSIE_ID, role: "PEDAGOGA", active: true },
          { userId: SUPER_R10_ID, schoolId: SCHOOL_ALLOWED_ID, role: "GESTOR_ESCOLAR", active: true },
          { userId: SUPER_R10_ID, schoolId: SCHOOL_BLOCKED_ID, role: "GESTOR_ESCOLAR", active: true },
          { userId: SUPER_R10_ID, schoolId: SCHOOL_DOSSIE_ID, role: "GESTOR_ESCOLAR", active: true },
        ],
      });

      await prisma.classGroup.create({
        data: {
          id: CG_DOSSIE_ID,
          name: "9º R10 A",
          schoolId: SCHOOL_DOSSIE_ID,
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      });

      await prisma.student.createMany({
        data: [
          {
            id: STU_TITULAR_ID,
            name: "Helena Martins Atual",
            cgm: "99100501",
            phone: "00000001001",
            schoolId: SCHOOL_DOSSIE_ID,
            classGroupId: CG_DOSSIE_ID,
          },
          {
            id: STU_RENOMEADO_ID,
            // Nome alterado no cadastro após a ata (cobre renomeação pós-lavratura via student.name)
            name: "Rafael Gomes Atual",
            cgm: "99100502",
            phone: "00000001002",
            schoolId: SCHOOL_DOSSIE_ID,
            classGroupId: CG_DOSSIE_ID,
          },
        ],
      });

      await prisma.pedagogicalMinute.create({
        data: {
          id: MINUTE_DOSSIE_ID,
          schoolId: SCHOOL_DOSSIE_ID,
          year: 2026,
          ataNumber: 1001,
          status: "FINALIZED",
          contentRevision: 1,
          attendedAt: new Date("2026-11-20T14:00:00.000Z"),
          category: "CONFLITO_CONVIVENCIA",
          isConfidential: false,
          subject:
            "Atendimento conjunto de Helena Martins Atual, Rafael Gomes Atual, Rafael Gomes Snapshot e Rafael Gomes Primitivo",
          summary:
            "Acompanhamento com Helena Martins Atual sobre ocorrência com Rafael Gomes Atual, antes Rafael Gomes Snapshot e Rafael Gomes Primitivo.",
          agreementsSummary:
            "Combinado separado com Rafael Gomes Primitivo e Rafael Gomes Atual.",
          verificationCode: "R10-DOSSIE-1001",
          authorId: PED_R10_ID,
          authorName: "Pedagoga Sintética R10",
          authorEmail: "pedagoga.r10@example.invalid",
          authorRole: "PEDAGOGA",
          students: {
            create: [
              {
                studentId: STU_TITULAR_ID,
                studentNameSnapshot: "Helena Martins Atual",
                classNameSnapshot: "9º R10 A",
                cgmSnapshot: "99100501",
                previousNameSnapshots: [],
              },
              {
                studentId: STU_RENOMEADO_ID,
                studentNameSnapshot: "Rafael Gomes Snapshot",
                classNameSnapshot: "9º R10 A",
                cgmSnapshot: "99100502",
                previousNameSnapshots: ["Rafael Gomes Primitivo"],
              },
            ],
          },
          participants: {
            create: [
              {
                role: "ESTUDANTE",
                studentId: STU_TITULAR_ID,
                name: "Helena Martins Atual",
                signatureMode: "ONSCREEN",
                hasSignature: true,
                signedRevision: 1,
              },
              {
                role: "ESTUDANTE",
                studentId: STU_RENOMEADO_ID,
                name: "Rafael Gomes Snapshot",
                signatureMode: "ONSCREEN",
                hasSignature: true,
                signedRevision: 1,
              },
              {
                role: "ESTUDANTE",
                studentId: null,
                name: "Rafael Gomes Primitivo",
                signatureMode: "ONSCREEN",
                hasSignature: true,
                signedRevision: 1,
              },
              {
                role: "ESTUDANTE",
                studentId: null,
                name: "Estudante Legado Indeterminável R10",
                signatureMode: "ONSCREEN",
                hasSignature: true,
                signedRevision: 1,
              },
              {
                role: "RESPONSAVEL",
                studentId: null,
                name: "Claudia Martins (Mãe de Helena Martins Atual)",
                signatureMode: "ONSCREEN",
                hasSignature: true,
                signedRevision: 1,
              },
              {
                role: "RESPONSAVEL",
                studentId: null,
                name: "Responsável por Rafael Gomes Atual",
                signatureMode: "ONSCREEN",
                hasSignature: true,
                signedRevision: 1,
              },
              {
                role: "PROFESSOR",
                studentId: null,
                name: "Rafael Almeida (Professor)",
                signatureMode: "ESCOLA_OAUTH",
                hasSignature: true,
                signedRevision: 1,
              },
            ],
          },
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      hoisted.authSession = null;
      hoisted.cookiesMap.clear();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      for (const sid of ALL_SCHOOL_IDS) {
        invalidateSchoolCache(sid);
      }
    });

    afterAll(async () => {
      await cleanupFixtures();
    });

    it("1. Transição preserva autorizadas, bloqueia legadas fora da lista/lista não confiável, respeita edições do painel na reexecução e mantém WhatsApp local", async () => {
      process.env.FORCE_STRICT_DB_AUTH = "true";
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";
      process.env.GEMINI_API_KEY = "AIzaSyntheticRodada10Key00001";
      delete process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;

      const externalRequests: Array<{ url: string; bodyText: string }> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          const bodyText =
            typeof init?.body === "string"
              ? init.body
              : input instanceof Request
                ? await input.clone().text()
                : "";
          externalRequests.push({ url, bodyText });
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          formalSubject: "Alinhamento de [ESTUDANTE_1]",
                          formalSummary:
                            "[DATA_ATENDIMENTO], atendimento pedagógico regular referente a [ESTUDANTE_1].",
                          agreementsSummary: "Monitoramento de assiduidade.",
                          actionItems: [],
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        })
      );

      // 1A. Antes da transição, nenhuma escola legada sem aiExternalFormalizePolicyVersion: 2 chama IA externa (fail-closed)
      for (const sid of [SCHOOL_ALLOWED_ID, SCHOOL_BLOCKED_ID, SCHOOL_DISABLED_ID, SCHOOL_UNRELIABLE_ID]) {
        setSessionActor({
          id: PED_R10_ID,
          email: "pedagoga.r10@example.invalid",
          name: "Pedagoga Sintética R10",
          role: "PEDAGOGA",
          schoolId: sid,
        });
        const preRes = await formalizeAtaPost(
          new Request("http://localhost/api/ai/formalize-ata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              isConfidential: false,
              nonConfidentialConfirmed: true,
              ataScope: "STUDENTS",
              category: "ACOMPANHAMENTO_PEDAGOGICO",
              rawNotes: "Atendimento de rotina anterior à transição.",
              studentNames: ["Aluno R10"],
            }),
          })
        );
        expect(preRes.status).toBe(200);
        expect((await preRes.json()).mode).toBe("LOCAL_ONLY");
      }
      expect(externalRequests).toHaveLength(0);

      // 1B. Lista antiga ausente/não confiável mantém modo local na escola marcada ligada
      for (const badList of [undefined, "", "*", "syn-r10-ai-allowed,bad id"]) {
        const dryBad = await transitionSchoolAiPoliciesToPanelControl({
          legacyAllowedSchoolIdsRaw: badList === undefined ? null : badList,
          dryRun: true,
          schoolIds: [SCHOOL_UNRELIABLE_ID],
        });
        expect(dryBad.legacyList.reliable).toBe(false);
        expect(dryBad.totals.reconciledToLocalUnreliableLegacyList).toBe(1);
        expect(dryBad.items[0].nextEnabled).toBe(false);
      }

      const unreliableReport = await transitionSchoolAiPoliciesToPanelControl({
        legacyAllowedSchoolIdsRaw: null,
        schoolIds: [SCHOOL_UNRELIABLE_ID],
      });
      expect(unreliableReport.totals.reconciledToLocalUnreliableLegacyList).toBe(1);
      invalidateSchoolCache(SCHOOL_UNRELIABLE_ID);
      const unreliableRow = await prisma.school.findUniqueOrThrow({
        where: { id: SCHOOL_UNRELIABLE_ID },
      });
      expect(JSON.parse(unreliableRow.settingsJson || "{}")).toMatchObject({
        edition: "PILOTO_INTEGRADA",
        customUnreliable: "preserve-unreliable",
        aiExternalFormalizeEnabled: false,
        aiExternalFormalizePolicyVersion: 2,
        aiExternalFormalizeTransitionOutcome: "reconciled_to_local_unreliable_legacy_list",
      });

      setSessionActor({
        id: PED_R10_ID,
        email: "pedagoga.r10@example.invalid",
        name: "Pedagoga Sintética R10",
        role: "PEDAGOGA",
        schoolId: SCHOOL_UNRELIABLE_ID,
      });
      const unreliablePostRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Teste sem lista antiga confiável.",
            studentNames: ["Aluno Sem Lista"],
          }),
        })
      );
      expect((await unreliablePostRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      const dbUrl = process.env.DATABASE_URL!;
      const scriptPath = path.resolve(process.cwd(), "scripts/transition_ai_policy_to_panel.mjs");

      // 1C-bis. Filtro vazio explícito (--school-ids= / schoolIds: []) falha fechado sem consultar ou alterar escolas
      await expect(
        transitionSchoolAiPoliciesToPanelControl({
          legacyAllowedSchoolIdsRaw: SCHOOL_ALLOWED_ID,
          dryRun: true,
          schoolIds: [],
        })
      ).rejects.toThrow(/schoolIds/i);

      await expect(
        transitionSchoolAiPoliciesToPanelControl({
          legacyAllowedSchoolIdsRaw: SCHOOL_ALLOWED_ID,
          dryRun: false,
          schoolIds: ["", "  "],
        })
      ).rejects.toThrow(/schoolIds/i);

      for (const emptyFlag of ["--school-ids=", "--school-ids= , "]) {
        let cliFailed = false;
        try {
          execFileSync(
            "node",
            [
              scriptPath,
              "--dry-run",
              `--legacy-allowed-ids=${SCHOOL_ALLOWED_ID}`,
              emptyFlag,
            ],
            {
              env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                NODE_ENV: process.env.NODE_ENV || "test",
                DATABASE_URL: dbUrl,
              },
              encoding: "utf8",
              stdio: "pipe",
            }
          );
        } catch (err: any) {
          cliFailed = true;
          expect(err.status).not.toBe(0);
          expect(String(err.stderr || "")).toContain("--school-ids=");
        }
        expect(cliFailed).toBe(true);
      }

      // 1C. Dry-run do script CLI não altera o banco; execução efetiva aplica transição preservando ALLOWED e bloqueando BLOCKED
      const scopeIds = `${SCHOOL_ALLOWED_ID},${SCHOOL_BLOCKED_ID},${SCHOOL_DISABLED_ID}`;

      const dryRunOut = execFileSync(
        "node",
        [
          scriptPath,
          "--dry-run",
          `--legacy-allowed-ids=${SCHOOL_ALLOWED_ID}`,
          `--school-ids=${scopeIds}`,
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: process.env.NODE_ENV || "test",
            DATABASE_URL: dbUrl,
          },
          encoding: "utf8",
        }
      );
      const dryRunJson = JSON.parse(dryRunOut);
      expect(dryRunJson.dryRun).toBe(true);
      expect(dryRunJson.totals.wouldUpdate).toBe(3);

      const allowedBeforeCli = await prisma.school.findUniqueOrThrow({ where: { id: SCHOOL_ALLOWED_ID } });
      expect(JSON.parse(allowedBeforeCli.settingsJson || "{}").aiExternalFormalizePolicyVersion).toBeUndefined();

      const applyOut = execFileSync(
        "node",
        [
          scriptPath,
          `--legacy-allowed-ids=${SCHOOL_ALLOWED_ID}`,
          `--school-ids=${scopeIds}`,
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: process.env.NODE_ENV || "test",
            DATABASE_URL: dbUrl,
          },
          encoding: "utf8",
        }
      );
      const applyJson = JSON.parse(applyOut);
      expect(applyJson.totals).toMatchObject({
        evaluated: 3,
        updated: 3,
        preservedEnabled: 1,
        reconciledToLocalOutsideLegacyList: 1,
        keptLocal: 1,
      });

      invalidateSchoolCache(SCHOOL_ALLOWED_ID);
      invalidateSchoolCache(SCHOOL_BLOCKED_ID);
      invalidateSchoolCache(SCHOOL_DISABLED_ID);

      const [allowedAfter, blockedAfter, disabledAfter] = await Promise.all([
        prisma.school.findUniqueOrThrow({ where: { id: SCHOOL_ALLOWED_ID } }),
        prisma.school.findUniqueOrThrow({ where: { id: SCHOOL_BLOCKED_ID } }),
        prisma.school.findUniqueOrThrow({ where: { id: SCHOOL_DISABLED_ID } }),
      ]);
      expect(JSON.parse(allowedAfter.settingsJson || "{}")).toMatchObject({
        edition: "PILOTO_INTEGRADA",
        syncTokenEncrypted: "enc-keep-r10-1",
        customPref: "preserve-allowed",
        aiExternalFormalizeEnabled: true,
        aiExternalFormalizePolicyVersion: 2,
      });
      expect(JSON.parse(blockedAfter.settingsJson || "{}")).toMatchObject({
        edition: "PILOTO_INTEGRADA",
        customPref: "preserve-blocked",
        aiExternalFormalizeEnabled: false,
        aiExternalFormalizePolicyVersion: 2,
      });
      expect(JSON.parse(disabledAfter.settingsJson || "{}")).toMatchObject({
        edition: "INSTITUCIONAL_ESSENCIAL",
        aiExternalFormalizeEnabled: false,
        aiExternalFormalizePolicyVersion: 2,
      });

      // Escola autorizada na lista anterior usa IA externa com pseudonimização (sem exigir AI_FORMALIZE_ALLOWED_SCHOOL_IDS)
      setSessionActor({
        id: PED_R10_ID,
        email: "pedagoga.r10@example.invalid",
        name: "Pedagoga Sintética R10",
        role: "PEDAGOGA",
        schoolId: SCHOOL_ALLOWED_ID,
      });
      const allowedExtRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Lucas Almeida compareceu para atendimento de rotina.",
            studentNames: ["Lucas Almeida"],
          }),
        })
      );
      expect(allowedExtRes.status).toBe(200);
      const allowedExtJson = await allowedExtRes.json();
      expect(allowedExtJson.mode).toBe("EXTERNAL_AI");
      expect(allowedExtJson.result.formalSummary).toContain("Lucas Almeida");
      expect(externalRequests).toHaveLength(1);
      expect(externalRequests[0].bodyText).not.toContain("Lucas Almeida");
      externalRequests.length = 0;

      // Texto sigiloso na escola autorizada permanece local
      const secretAllowedRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: true,
            ataScope: "STUDENTS",
            category: "SAUDE_VULNERABILIDADE",
            rawNotes: "Atendimento sigiloso de saúde.",
            studentNames: ["Lucas Almeida"],
          }),
        })
      );
      expect((await secretAllowedRes.json()).mode).toBe("LOCAL_POLICY_GUARD");
      expect(externalRequests).toHaveLength(0);

      // Escola ligada antes, mas fora da lista anterior, permanece local após transição
      setSessionActor({
        id: PED_R10_ID,
        email: "pedagoga.r10@example.invalid",
        name: "Pedagoga Sintética R10",
        role: "PEDAGOGA",
        schoolId: SCHOOL_BLOCKED_ID,
      });
      const blockedRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Atendimento regular em escola conciliada.",
            studentNames: ["Mariana Silva"],
          }),
        })
      );
      expect((await blockedRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      // 1D. Painel /admin/escolas exibe estado resultante; SUPERADMIN liga a escola anteriormente bloqueada
      setSessionActor({
        id: SUPER_R10_ID,
        email: "superadmin.r10@example.invalid",
        name: "SuperAdmin Sintético R10",
        role: "SUPERADMIN",
        schoolId: SCHOOL_BLOCKED_ID,
      });
      const adminPageHtml = renderToString(await AdminEscolasPage());
      expect(adminPageHtml).toContain("Escola R10 Legada Autorizada");
      expect(adminPageHtml).toContain("Atas: IA externa ativa");
      expect(adminPageHtml).toContain("Escola R10 Ligada Fora da Lista");
      expect(adminPageHtml).toContain("Atas: modo local");

      const enableBlockedRes = await patchSchoolAiPolicy(
        new Request(`http://localhost/api/schools/${SCHOOL_BLOCKED_ID}/ai-policy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aiExternalFormalizeEnabled: true,
            expectedUpdatedAt: blockedAfter.updatedAt.toISOString(),
            expectedPreviousEnabled: false,
          }),
        }),
        { params: Promise.resolve({ id: SCHOOL_BLOCKED_ID }) }
      );
      expect(enableBlockedRes.status).toBe(200);
      const enableBlockedJson = await enableBlockedRes.json();
      expect(enableBlockedJson.school.aiExternalFormalizeEnabled).toBe(true);

      // 1E. Reexecutar a transição com a lista antiga NÃO sobrescreve a decisão mais recente feita no painel
      const rerunOut = execFileSync(
        "node",
        [
          scriptPath,
          `--legacy-allowed-ids=${SCHOOL_ALLOWED_ID}`,
          `--school-ids=${scopeIds}`,
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: process.env.NODE_ENV || "test",
            DATABASE_URL: dbUrl,
          },
          encoding: "utf8",
        }
      );
      const rerunJson = JSON.parse(rerunOut);
      expect(rerunJson.totals).toMatchObject({
        evaluated: 3,
        updated: 0,
        skipped: 3,
        alreadyPanelControlled: 3,
      });

      const getBlockedRes = await getSchoolAiPolicy(
        new Request(`http://localhost/api/schools/${SCHOOL_BLOCKED_ID}/ai-policy`),
        { params: Promise.resolve({ id: SCHOOL_BLOCKED_ID }) }
      );
      expect((await getBlockedRes.json()).school.aiExternalFormalizeEnabled).toBe(true);

      // Efeito imediato na próxima formalização
      setSessionActor({
        id: PED_R10_ID,
        email: "pedagoga.r10@example.invalid",
        name: "Pedagoga Sintética R10",
        role: "PEDAGOGA",
        schoolId: SCHOOL_BLOCKED_ID,
      });
      const enabledBlockedFormalize = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Mariana Silva compareceu após habilitação pelo painel.",
            studentNames: ["Mariana Silva"],
          }),
        })
      );
      expect((await enabledBlockedFormalize.json()).mode).toBe("EXTERNAL_AI");
      expect(externalRequests).toHaveLength(1);
      expect(externalRequests[0].bodyText).not.toContain("Mariana Silva");
      externalRequests.length = 0;

      // Bloqueio geral do servidor prevalece mesmo com escola ligada
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "false";
      const globalOffRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Atendimento sob bloqueio global do servidor.",
            studentNames: ["Mariana Silva"],
          }),
        })
      );
      expect((await globalOffRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";

      // Desligamento pelo painel retorna imediatamente ao modo local
      setSessionActor({
        id: SUPER_R10_ID,
        email: "superadmin.r10@example.invalid",
        name: "SuperAdmin Sintético R10",
        role: "SUPERADMIN",
        schoolId: SCHOOL_BLOCKED_ID,
      });
      const disableBlockedRes = await patchSchoolAiPolicy(
        new Request(`http://localhost/api/schools/${SCHOOL_BLOCKED_ID}/ai-policy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aiExternalFormalizeEnabled: false,
            expectedUpdatedAt: enableBlockedJson.school.updatedAt,
            expectedPreviousEnabled: true,
          }),
        }),
        { params: Promise.resolve({ id: SCHOOL_BLOCKED_ID }) }
      );
      expect(disableBlockedRes.status).toBe(200);
      expect((await disableBlockedRes.json()).school.aiExternalFormalizeEnabled).toBe(false);

      setSessionActor({
        id: PED_R10_ID,
        email: "pedagoga.r10@example.invalid",
        name: "Pedagoga Sintética R10",
        role: "PEDAGOGA",
        schoolId: SCHOOL_BLOCKED_ID,
      });
      const afterPanelDisableRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Atendimento após desligamento pelo painel.",
            studentNames: ["Mariana Silva"],
          }),
        })
      );
      expect((await afterPanelDisableRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      // WhatsApp permanece estritamente local mesmo na escola habilitada
      setSessionActor({
        id: PED_R10_ID,
        email: "pedagoga.r10@example.invalid",
        name: "Pedagoga Sintética R10",
        role: "PEDAGOGA",
        schoolId: SCHOOL_ALLOWED_ID,
      });
      const waRes = await classifyReplyPost(
        new Request("http://localhost/api/ai/classify-reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawReply: "Consultamos o posto de saúde hoje cedo.",
            studentName: "Lucas Almeida",
          }),
        })
      );
      expect(waRes.status).toBe(200);
      expect((await waRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);
    });

    it("2. Dossiê anonimiza lista Presentes no servidor (outro estudante, renomeado e legado) preservando titular e visão integral autorizada sem expor grafias antigas", async () => {
      setSessionActor({
        id: PED_R10_ID,
        email: "pedagoga.r10@example.invalid",
        name: "Pedagoga Sintética R10",
        role: "PEDAGOGA",
        schoolId: SCHOOL_DOSSIE_ID,
      });

      const dossieElement = (await DossiePage({
        params: Promise.resolve({ id: STU_TITULAR_ID }),
      })) as React.ReactElement<any>;

      const clientProps = dossieElement.props;
      expect(JSON.stringify(clientProps)).not.toContain("previousNameSnapshots");
      expect(clientProps.minutes).toHaveLength(1);
      expect(clientProps.minutes[0].maskedParticipantNames).toEqual([
        "Helena Martins Atual",
        "Outro estudante",
        "Outro estudante",
        "Outro estudante",
        "Claudia Martins (Mãe de Helena Martins Atual)",
        "Responsável por Outro estudante",
        "Rafael Almeida (Professor)",
      ]);

      // Participantes integrais ficam preservados nos dados autorizados para quando o usuário desmarcar "Anonimizar outros estudantes"
      expect(clientProps.minutes[0].participants.map((p: any) => p.name)).toEqual([
        "Helena Martins Atual",
        "Rafael Gomes Snapshot",
        "Rafael Gomes Primitivo",
        "Estudante Legado Indeterminável R10",
        "Claudia Martins (Mãe de Helena Martins Atual)",
        "Responsável por Rafael Gomes Atual",
        "Rafael Almeida (Professor)",
      ]);

      const dossieHtml = renderToString(dossieElement).replace(/<!-- -->/g, "");
      const presentesMatch = dossieHtml.match(
        /data-testid="dossie-minute-presentes">([\s\S]*?)<\/span>/
      );
      expect(presentesMatch?.[1]).toBeTruthy();
      const presentesText = presentesMatch?.[1] || "";

      expect(presentesText).toContain("Helena Martins Atual");
      expect(presentesText).toContain("Outro estudante");
      expect(presentesText).toContain("Claudia Martins (Mãe de Helena Martins Atual)");
      expect(presentesText).toContain("Responsável por Outro estudante");
      expect(presentesText).toContain("Rafael Almeida (Professor)");

      for (const leaked of [
        "Rafael Gomes Atual",
        "Rafael Gomes Snapshot",
        "Rafael Gomes Primitivo",
        "Estudante Legado Indeterminável R10",
        "previousNameSnapshots",
      ]) {
        expect(dossieHtml).not.toContain(leaked);
        expect(presentesText).not.toContain(leaked);
      }
    });
  }
);
