import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@/lib/signingPin";
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

import { GET as listAtasGet, POST as createMinutePost } from "@/app/api/atas/route";
import { PATCH as patchMinuteById } from "@/app/api/atas/[id]/route";
import { POST as signScreenPost } from "@/app/api/atas/[id]/sign-screen/route";
import { POST as signTokenPost } from "@/app/api/atas/[id]/sign-token/route";
import {
  GET as publicSignGet,
  POST as publicSignPost,
} from "@/app/api/atas/sign-token/[token]/route";
import { POST as finalizeMinutePost } from "@/app/api/atas/[id]/finalize/route";
import ProntuarioPage from "@/app/alunos/[id]/page";
import DossiePage from "@/app/alunos/[id]/dossie/page";
import AtaPrintPage from "@/app/atas/[id]/imprimir/page";
import LivroAnualPage from "@/app/atas/livro/[ano]/page";
import AssinarAtaPage from "@/app/assinar/ata/[token]/page";
import { PATCH as patchSchoolAiPolicy, GET as getSchoolAiPolicy } from "@/app/api/schools/[id]/ai-policy/route";
import { POST as formalizeAtaPost } from "@/app/api/ai/formalize-ata/route";
import { POST as classifyReplyPost } from "@/app/api/ai/classify-reply/route";
import { transitionSchoolAiPoliciesToPanelControl } from "@/services/aiPolicyTransitionService";

const hasIsolatedDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return (
      process.env.REDEATIVA_TEST_ISOLATED_DB === "1" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/redeativa_phase01_synthetic"
    );
  } catch {
    return false;
  }
})();

const VALID_PIN = "7418";
const VALID_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const NET_R9_ID = "syn-net-r9";
const SCHOOL_A_ID = "syn-school-r9-a";
const SCHOOL_B_ID = "syn-school-r9-b";
const SCHOOL_PRESERVED_ID = "syn-school-r9-preserved";

const CG_A_ID = "syn-cg-r9-a";
const CG_B_ID = "syn-cg-r9-b";
const STU_A1_ID = "syn-stu-r9-a1";
const STU_A2_ID = "syn-stu-r9-a2";
const STU_B1_ID = "syn-stu-r9-b1";

const PED_AUTHOR_ID = "syn-usr-r9-ped1";
const PED_COLLEAGUE_ID = "syn-usr-r9-ped2";
const GESTOR_A_ID = "syn-usr-r9-gestor-a";
const SUPER_R9_ID = "syn-usr-r9-super";

function setSessionActor(params: {
  id: string;
  email: string;
  name: string;
  role: string;
  schoolId?: string | null;
  activeSchoolCookie?: string;
}) {
  hoisted.authSession = {
    user: {
      id: params.id,
      email: params.email,
      name: params.name,
      role: params.role,
      schoolId: params.schoolId ?? null,
      active: true,
      schools: params.schoolId
        ? [{ schoolId: params.schoolId, role: params.role, active: true }]
        : [],
    },
  };
  if (params.activeSchoolCookie) {
    hoisted.cookiesMap.set("active_school_id", params.activeSchoolCookie);
  } else if (params.schoolId) {
    hoisted.cookiesMap.set("active_school_id", params.schoolId);
  } else {
    hoisted.cookiesMap.delete("active_school_id");
  }
}

async function cleanupR9SyntheticData() {
  const schoolIds = [SCHOOL_A_ID, SCHOOL_B_ID, SCHOOL_PRESERVED_ID];
  const userIds = [PED_AUTHOR_ID, PED_COLLEAGUE_ID, GESTOR_A_ID, SUPER_R9_ID];

  await prisma.auditLog.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.pedagogicalMinute.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.student.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.classGroup.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.userNetwork.deleteMany({
    where: { OR: [{ networkId: NET_R9_ID }, { userId: { in: userIds } }] },
  });
  await prisma.userSchool.deleteMany({
    where: { OR: [{ schoolId: { in: schoolIds } }, { userId: { in: userIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.educationNetwork.deleteMany({ where: { id: NET_R9_ID } });
}

describe.skipIf(!hasIsolatedDb)(
  "Fase 01 — Rodada 9 Pendências de Atas (Aliases no Servidor, Sigilo Mínimo, Texto >= 10 Chars) e Painel de IA (PG 16 Real)",
  () => {
    const prevEnv = {
      FORCE_STRICT_DB_AUTH: process.env.FORCE_STRICT_DB_AUTH,
      AI_FORMALIZE_EXTERNAL_ENABLED: process.env.AI_FORMALIZE_EXTERNAL_ENABLED,
      AI_FORMALIZE_ALLOWED_SCHOOL_IDS: process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };

    beforeAll(async () => {
      process.env.FORCE_STRICT_DB_AUTH = "true";
      await cleanupR9SyntheticData();
      const pinHash = await hashPin(VALID_PIN);

      await prisma.educationNetwork.create({
        data: {
          id: NET_R9_ID,
          name: "Rede Sintética R9",
          shortName: "SEMEC R9",
          city: "Tibagi",
          state: "PR",
          active: true,
        },
      });

      await prisma.school.createMany({
        data: [
          {
            id: SCHOOL_A_ID,
            name: "Escola Sintética R9 Piloto-Edição A",
            inepCode: "99990901",
            city: "Ponta Grossa",
            state: "PR",
            nre: "Ponta Grossa",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({
              edition: "PILOTO_INTEGRADA",
              aiExternalFormalizeEnabled: false,
            }),
          },
          {
            id: SCHOOL_B_ID,
            name: "Escola Sintética R9 Essencial B",
            inepCode: "99990902",
            city: "Tibagi",
            state: "PR",
            nre: "SEMEC Tibagi",
            network: "MUNICIPAL",
            networkId: NET_R9_ID,
            active: true,
            settingsJson: JSON.stringify({
              edition: "INSTITUCIONAL_ESSENCIAL",
              aiExternalFormalizeEnabled: false,
            }),
          },
          {
            id: SCHOOL_PRESERVED_ID,
            name: "Escola Sintética R9 Pré-Habilitada",
            inepCode: "99990903",
            city: "Ponta Grossa",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({
              edition: "INSTITUCIONAL_ESSENCIAL",
              aiExternalFormalizeEnabled: true,
            }),
          },
        ],
      });

      await prisma.classGroup.createMany({
        data: [
          { id: CG_A_ID, name: "9º R9 A", schoolId: SCHOOL_A_ID, segment: "FUNDAMENTAL", shift: "MANHA" },
          { id: CG_B_ID, name: "8º R9 B", schoolId: SCHOOL_B_ID, segment: "FUNDAMENTAL", shift: "TARDE" },
        ],
      });

      await prisma.student.createMany({
        data: [
          {
            id: STU_A1_ID,
            name: "Lucas Pereira",
            cgm: "99090101",
            phone: "00000000901",
            schoolId: SCHOOL_A_ID,
            classGroupId: CG_A_ID,
          },
          {
            id: STU_A2_ID,
            name: "Joao Marcos Silva",
            cgm: "99090102",
            phone: "00000000902",
            schoolId: SCHOOL_A_ID,
            classGroupId: CG_A_ID,
          },
          {
            id: STU_B1_ID,
            name: "Estudante Escola B",
            cgm: "99090201",
            phone: "00000000903",
            schoolId: SCHOOL_B_ID,
            classGroupId: CG_B_ID,
          },
        ],
      });

      await prisma.user.createMany({
        data: [
          {
            id: PED_AUTHOR_ID,
            email: "ped.autora.r9@example.invalid",
            name: "Pedagoga Autora R9",
            role: "PEDAGOGA",
            active: true,
            schoolId: SCHOOL_A_ID,
            signingPinHash: pinHash,
            pinAttempts: 0,
          },
          {
            id: PED_COLLEAGUE_ID,
            email: "ped.colega.r9@example.invalid",
            name: "Pedagoga Colega R9",
            role: "PEDAGOGA",
            active: true,
            schoolId: SCHOOL_A_ID,
            signingPinHash: pinHash,
            pinAttempts: 0,
          },
          {
            id: GESTOR_A_ID,
            email: "gestor.r9@example.invalid",
            name: "Gestor R9",
            role: "GESTOR_ESCOLAR",
            active: true,
            schoolId: SCHOOL_A_ID,
            signingPinHash: pinHash,
            pinAttempts: 0,
          },
          {
            id: SUPER_R9_ID,
            email: "superadmin.r9@example.invalid",
            name: "SuperAdmin R9",
            role: "SUPERADMIN",
            active: true,
            schoolId: SCHOOL_A_ID,
          },
        ],
      });

      await prisma.userSchool.createMany({
        data: [
          { userId: PED_AUTHOR_ID, schoolId: SCHOOL_A_ID, role: "PEDAGOGA", active: true },
          { userId: PED_AUTHOR_ID, schoolId: SCHOOL_B_ID, role: "PEDAGOGA", active: true },
          { userId: PED_AUTHOR_ID, schoolId: SCHOOL_PRESERVED_ID, role: "PEDAGOGA", active: true },
          { userId: PED_COLLEAGUE_ID, schoolId: SCHOOL_A_ID, role: "PEDAGOGA", active: true },
          { userId: GESTOR_A_ID, schoolId: SCHOOL_A_ID, role: "GESTOR_ESCOLAR", active: true },
        ],
      });

      invalidateSchoolCache();
    });

    beforeEach(() => {
      hoisted.cookiesMap.clear();
      invalidateSchoolCache();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      process.env.FORCE_STRICT_DB_AUTH = prevEnv.FORCE_STRICT_DB_AUTH;
      if (prevEnv.AI_FORMALIZE_EXTERNAL_ENABLED === undefined) {
        delete process.env.AI_FORMALIZE_EXTERNAL_ENABLED;
      } else {
        process.env.AI_FORMALIZE_EXTERNAL_ENABLED = prevEnv.AI_FORMALIZE_EXTERNAL_ENABLED;
      }
      if (prevEnv.AI_FORMALIZE_ALLOWED_SCHOOL_IDS === undefined) {
        delete process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
      } else {
        process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = prevEnv.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
      }
      if (prevEnv.GEMINI_API_KEY === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = prevEnv.GEMINI_API_KEY;
      }
    });

    afterAll(async () => {
      await cleanupR9SyntheticData();
    });

    it("1. Mantém previousNameSnapshots no servidor, reduz payload de atas sigilosas sem acesso e mascara no servidor mantendo visão integral aos autorizados", async () => {
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });

      // Garante nome inicial antes da renomeação
      await prisma.student.update({
        where: { id: STU_A2_ID },
        data: { name: "Joao Marcos Silva" },
      });

      const currentYear = new Date().getFullYear();

      // A) Cria ata comum conjunta com Joao Marcos Silva + Lucas Pereira
      const commonCreateRes = await createMinutePost(
        new Request("http://localhost/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "CONVIVENCIA_INDISCIPLINA",
            isConfidential: false,
            subject: "Mediação conjunta Lucas Pereira e Joao Marcos Silva",
            summary:
              "O atendimento registrou acordo entre Lucas Pereira e Joao Marcos Silva. Durante a conversa, Joao comprometeu-se com os horários.",
            agreementsSummary:
              "A família de Lucas Pereira acompanhará a rotina; Joao seguirá orientação semanal.",
            studentIds: [STU_A1_ID, STU_A2_ID],
            participants: [
              { role: "RESPONSAVEL", name: "Responsável Um" },
              { role: "ESTUDANTE", studentId: STU_A1_ID, name: "Lucas Pereira" },
            ],
          }),
        })
      );
      expect(commonCreateRes.status).toBe(201);
      const commonMinute = (await commonCreateRes.json()).minute;

      // B) Cria ata sigilosa conjunta com os mesmos estudantes (para validar sigilo mínimo + zero grafias)
      const secretCreateRes = await createMinutePost(
        new Request("http://localhost/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "SAUDE_VULNERABILIDADE",
            isConfidential: true,
            subject: "Atendimento restrito Lucas Pereira e Joao Marcos Silva",
            summary:
              "Relato sigiloso de saúde envolvendo Lucas Pereira e Joao Marcos Silva em acompanhamento confidencial.",
            agreementsSummary: "Acompanhamento reservado com familiares de Lucas Pereira e Joao.",
            studentIds: [STU_A1_ID, STU_A2_ID],
            participants: [{ role: "RESPONSAVEL", name: "Responsável Sigilo R9" }],
          }),
        })
      );
      expect(secretCreateRes.status).toBe(201);
      const secretMinute = (await secretCreateRes.json()).minute;

      // Renomeia STU_A2_ID e executa PATCH nas duas atas para persistir previousNameSnapshots no servidor
      await prisma.student.update({
        where: { id: STU_A2_ID },
        data: { name: "Mateus Henrique Costa" },
      });

      const patchCommonRes = await patchMinuteById(
        new Request(`http://localhost/api/atas/${commonMinute.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            subject: "Mediação conjunta Lucas Pereira e Joao Marcos Silva",
            summary:
              "O atendimento registrou acordo entre Lucas Pereira e Joao Marcos Silva. Agora consta como Mateus Henrique Costa.",
            agreementsSummary:
              "Família de Lucas Pereira acompanhará; Mateus Henrique Costa e Joao seguirão devolutiva.",
            studentIds: [STU_A1_ID, STU_A2_ID],
          }),
        }),
        { params: Promise.resolve({ id: commonMinute.id }) }
      );
      expect(patchCommonRes.status).toBe(200);
      const patchCommonJson = await patchCommonRes.json();
      expect(patchCommonJson.minute.contentRevision).toBe(2);
      expect(JSON.stringify(patchCommonJson)).not.toContain("previousNameSnapshots");

      const patchSecretRes = await patchMinuteById(
        new Request(`http://localhost/api/atas/${secretMinute.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            subject: "Atendimento restrito Lucas Pereira e Joao Marcos Silva",
            summary:
              "Relato sigiloso envolvendo Lucas Pereira, Joao Marcos Silva e Mateus Henrique Costa.",
            studentIds: [STU_A1_ID, STU_A2_ID],
          }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(patchSecretRes.status).toBe(200);

      // Confirma no PostgreSQL que previousNameSnapshots foi realmente retido em ambas no banco
      const dbAliasRow = await prisma.pedagogicalMinuteStudent.findFirst({
        where: { minuteId: commonMinute.id, studentId: STU_A2_ID },
      });
      expect(dbAliasRow?.previousNameSnapshots).toEqual(["Joao Marcos Silva"]);
      const dbSecretAliasRow = await prisma.pedagogicalMinuteStudent.findFirst({
        where: { minuteId: secretMinute.id, studentId: STU_A2_ID },
      });
      expect(dbSecretAliasRow?.previousNameSnapshots).toEqual(["Joao Marcos Silva"]);

      // 1.1 Resposta de sign-screen NÃO expõe previousNameSnapshots
      const signScreenRes = await signScreenPost(
        new Request(`http://localhost/api/atas/${commonMinute.id}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: commonMinute.participants[0].id,
            expectedRevision: 2,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: commonMinute.id }) }
      );
      expect(signScreenRes.status).toBe(200);
      const signScreenJson = await signScreenRes.json();
      expect(JSON.stringify(signScreenJson)).not.toContain("previousNameSnapshots");
      expect(signScreenJson.minute.students.length).toBe(2);
      for (const s of signScreenJson.minute.students) {
        expect(s).not.toHaveProperty("previousNameSnapshots");
      }

      // Emite link para participante ESTUDANTE (STU_A1_ID) na Revisão 2 e lavra ambas as atas
      const tokRes = await signTokenPost(
        new Request(`http://localhost/api/atas/${commonMinute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: commonMinute.participants[1].id,
            expectedRevision: 2,
            expiresInMinutes: 20,
          }),
        }),
        { params: Promise.resolve({ id: commonMinute.id }) }
      );
      expect(tokRes.status).toBe(200);
      const linkToken = (await tokRes.json()).token;

      // Confirma que link de assinatura mascara grafia antiga e atual sem expor previousNameSnapshots
      const getTokenRes = await publicSignGet(
        new Request(`http://localhost/api/atas/sign-token/${linkToken}`),
        { params: Promise.resolve({ token: linkToken }) }
      );
      expect(getTokenRes.status).toBe(200);
      const getTokenJson = await getTokenRes.json();
      expect(JSON.stringify(getTokenJson)).not.toContain("previousNameSnapshots");
      expect(getTokenJson.participant.summary).toContain("Lucas Pereira");
      expect(getTokenJson.participant.summary).not.toContain("Joao Marcos");
      expect(getTokenJson.participant.summary).not.toContain("Mateus Henrique");
      expect(getTokenJson.participant.agreementsSummary).not.toContain("Joao");
      expect(getTokenJson.participant.agreementsSummary).not.toContain("Mateus");

      const signLinkHtml = renderToString(
        await AssinarAtaPage({ params: Promise.resolve({ token: linkToken }) })
      );
      expect(signLinkHtml).not.toContain("previousNameSnapshots");
      expect(signLinkHtml).not.toContain("Joao Marcos");
      expect(signLinkHtml).not.toContain("Mateus Henrique");

      // Lavra ambas para testar Prontuário, Dossiê, Impressão e Livro Anual
      const finCommon = await finalizeMinutePost(
        new Request(`http://localhost/api/atas/${commonMinute.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 2 }),
        }),
        { params: Promise.resolve({ id: commonMinute.id }) }
      );
      expect(finCommon.status).toBe(200);

      const finSecret = await finalizeMinutePost(
        new Request(`http://localhost/api/atas/${secretMinute.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 2 }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(finSecret.status).toBe(200);

      // 1.2 Perfil AUTORIZADO: Prontuário, Dossiê, Impressão e Livro Anual nunca vazam previousNameSnapshots;
      // Dossiê traz textos pré-mascarados do servidor mantendo visão integral para o autorizado
      const prontAuthElem: any = await ProntuarioPage({
        params: Promise.resolve({ id: STU_A1_ID }),
      });
      const prontAuthSerialized = JSON.stringify(prontAuthElem.props);
      expect(prontAuthSerialized).not.toContain("previousNameSnapshots");
      const prontAuthCommon = prontAuthElem.props.initialMinutes.find(
        (m: any) => m.id === commonMinute.id
      );
      expect(prontAuthCommon.summary).toContain("Joao Marcos Silva");

      const dossieAuthElem: any = await DossiePage({
        params: Promise.resolve({ id: STU_A1_ID }),
      });
      const dossieAuthSerialized = JSON.stringify(dossieAuthElem.props);
      expect(dossieAuthSerialized).not.toContain("previousNameSnapshots");
      const dossieCommon = dossieAuthElem.props.minutes.find((m: any) => m.id === commonMinute.id);
      // Visão integral preservada para perfil autorizado
      expect(dossieCommon.summary).toContain("Joao Marcos Silva");
      expect(dossieCommon.summary).toContain("Mateus Henrique Costa");
      // Mascaramento realizado no servidor cobrindo grafia antiga e atual
      expect(dossieCommon.maskedSubject).not.toContain("Joao Marcos");
      expect(dossieCommon.maskedSummary).not.toContain("Joao Marcos");
      expect(dossieCommon.maskedSummary).not.toContain("Mateus Henrique");
      expect(dossieCommon.maskedSummary).toContain("Lucas Pereira");
      expect(dossieCommon.maskedAgreementsSummary).not.toContain("Joao");
      expect(dossieCommon.maskedAgreementsSummary).not.toContain("Mateus");
      const dossieHtml = renderToString(dossieAuthElem);
      expect(dossieHtml).not.toContain("previousNameSnapshots");
      expect(dossieHtml).not.toContain("Joao Marcos");
      expect(dossieHtml).not.toContain("Mateus Henrique");

      const printAuthElem: any = await AtaPrintPage({
        params: Promise.resolve({ id: commonMinute.id }),
      });
      expect(JSON.stringify(printAuthElem.props)).not.toContain("previousNameSnapshots");
      expect(printAuthElem.props.minute.summary).toContain("Joao Marcos Silva");

      const livroAuthElem: any = await LivroAnualPage({
        params: Promise.resolve({ ano: String(currentYear) }),
      });
      expect(JSON.stringify(livroAuthElem.props)).not.toContain("previousNameSnapshots");

      // 1.3 Colega SEM ACESSO ao sigilo: recebe SOMENTE aviso de restrição no Prontuário, GET /api/atas e Livro Anual
      setSessionActor({
        id: PED_COLLEAGUE_ID,
        email: "ped.colega.r9@example.invalid",
        name: "Pedagoga Colega R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });

      const prontColElem: any = await ProntuarioPage({
        params: Promise.resolve({ id: STU_A1_ID }),
      });
      const prontColRestricted = prontColElem.props.initialMinutes.find(
        (m: any) => m.id === secretMinute.id
      );
      expect(prontColRestricted).toBeDefined();
      expect(prontColRestricted.restrictedConfidential).toBe(true);
      expect(prontColRestricted.subject).toBe("Atendimento sob sigilo");
      expect(prontColRestricted.students).toEqual([]);
      expect(prontColRestricted.participants).toEqual([]);
      const prontColSecretSerialized = JSON.stringify(prontColRestricted);
      expect(prontColSecretSerialized).not.toContain("previousNameSnapshots");
      expect(prontColSecretSerialized).not.toContain("Joao Marcos");
      expect(prontColSecretSerialized).not.toContain("Mateus Henrique");
      expect(prontColSecretSerialized).not.toContain("SAUDE_VULNERABILIDADE");
      expect(prontColSecretSerialized).not.toContain("ped.autora.r9");
      expect(prontColSecretSerialized).not.toContain("Pedagoga Autora R9");
      expect(prontColSecretSerialized).not.toContain("Relato sigiloso");

      // Nenhum dado do prontuário inteiro vaza previousNameSnapshots ao colega
      expect(JSON.stringify(prontColElem.props)).not.toContain("previousNameSnapshots");

      const listColRes = await listAtasGet(
        new Request(`http://localhost/api/atas?year=${currentYear}`)
      );
      expect(listColRes.status).toBe(200);
      const listColJson = await listColRes.json();
      expect(JSON.stringify(listColJson)).not.toContain("previousNameSnapshots");
      const listColSecret = listColJson.minutes.find((m: any) => m.id === secretMinute.id);
      expect(listColSecret.restrictedConfidential).toBe(true);
      expect(listColSecret.category).toBeUndefined();
      expect(listColSecret.authorEmail).toBeUndefined();
      expect(listColSecret.authorName).toBeUndefined();
      expect(listColSecret.students).toEqual([]);

      const livroColElem: any = await LivroAnualPage({
        params: Promise.resolve({ ano: String(currentYear) }),
      });
      expect(JSON.stringify(livroColElem.props)).not.toContain("previousNameSnapshots");
      const livroColSecret = livroColElem.props.minutes.find((m: any) => m.id === secretMinute.id);
      expect(livroColSecret.restrictedConfidential).toBe(true);
      expect(livroColSecret.category).toBeUndefined();
      expect(livroColSecret.authorName).toBeUndefined();
      expect(livroColSecret.students).toEqual([]);

      const dossieColElem: any = await DossiePage({
        params: Promise.resolve({ id: STU_A1_ID }),
      });
      expect(dossieColElem.props.minutes.some((m: any) => m.id === secretMinute.id)).toBe(false);
      expect(JSON.stringify(dossieColElem.props)).not.toContain("previousNameSnapshots");

      await expect(
        AtaPrintPage({ params: Promise.resolve({ id: secretMinute.id }) })
      ).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("2. Permite salvar rascunhos incompletos (vazio, espaços e <10 chars), bloqueia coleta até completar e valida assinatura + lavratura", async () => {
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });

      // Cria rascunho com texto vazio ("") e notas brutas -> permitido salvar
      const draftCreateRes = await createMinutePost(
        new Request("http://localhost/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "BUSCA_ATIVA_FALTAS",
            subject: "Rascunho texto mínimo R9",
            rawNotes: "Notas brutas apenas para apoio interno.",
            summary: "",
            studentIds: [STU_A1_ID],
            participants: [
              { role: "RESPONSAVEL", name: "Responsável Tela R9" },
              {
                role: "PROFESSOR",
                name: "Docente Link R9",
                expectedEmail: "docente.link.r9@escola.pr.gov.br",
              },
            ],
          }),
        })
      );
      expect(draftCreateRes.status).toBe(201);
      const draftMinute = (await draftCreateRes.json()).minute;
      const pScreen = draftMinute.participants[0];
      const pLink = draftMinute.participants[1];

      // Bloqueia emissão de QR e assinatura em tela para summary ""
      const qrEmptyRes = await signTokenPost(
        new Request(`http://localhost/api/atas/${draftMinute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: pLink.id, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(qrEmptyRes.status).toBe(400);
      expect((await qrEmptyRes.json()).code).toBe("OFFICIAL_SUMMARY_REQUIRED");

      const screenEmptyRes = await signScreenPost(
        new Request(`http://localhost/api/atas/${draftMinute.id}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: pScreen.id,
            expectedRevision: 1,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(screenEmptyRes.status).toBe(400);
      expect((await screenEmptyRes.json()).code).toBe("OFFICIAL_SUMMARY_REQUIRED");

      // Salva rascunho somente com espaços -> deve salvar (200), mas continuar bloqueando coleta
      const patchSpacesRes = await patchMinuteById(
        new Request(`http://localhost/api/atas/${draftMinute.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            summary: "            ",
          }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(patchSpacesRes.status).toBe(200);
      expect((await patchSpacesRes.json()).minute.contentRevision).toBe(2);

      // Salva rascunho com 9 caracteres após trim -> deve salvar (200), mas continuar bloqueando coleta
      const patchShortRes = await patchMinuteById(
        new Request(`http://localhost/api/atas/${draftMinute.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 2,
            summary: "  123456789  ",
          }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(patchShortRes.status).toBe(200);
      expect((await patchShortRes.json()).minute.contentRevision).toBe(3);

      const qrShortRes = await signTokenPost(
        new Request(`http://localhost/api/atas/${draftMinute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: pLink.id, expectedRevision: 3 }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(qrShortRes.status).toBe(400);
      expect((await qrShortRes.json()).code).toBe("OFFICIAL_SUMMARY_REQUIRED");

      // Simula token pré-existente emitido na Revisão 3 com texto insuficiente
      const legacyIncompleteToken = `tok-r9-incomplete-${Date.now()}`;
      await prisma.pedagogicalMinuteParticipant.update({
        where: { id: pLink.id },
        data: {
          mobileSignToken: legacyIncompleteToken,
          mobileSignExpiresAt: new Date(Date.now() + 20 * 60_000),
          mobileSignRevision: 3,
          hasActiveSignLink: true,
        },
      });

      const getIncompleteLinkRes = await publicSignGet(
        new Request(`http://localhost/api/atas/sign-token/${legacyIncompleteToken}`),
        { params: Promise.resolve({ token: legacyIncompleteToken }) }
      );
      expect(getIncompleteLinkRes.status).toBe(409);
      expect((await getIncompleteLinkRes.json()).code).toBe("OFFICIAL_SUMMARY_REQUIRED");

      const postIncompleteLinkRes = await publicSignPost(
        new Request(`http://localhost/api/atas/sign-token/${legacyIncompleteToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 3,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ token: legacyIncompleteToken }) }
      );
      expect(postIncompleteLinkRes.status).toBe(409);
      expect((await postIncompleteLinkRes.json()).code).toBe("OFFICIAL_SUMMARY_REQUIRED");

      const dbParticipantUnchanged = await prisma.pedagogicalMinuteParticipant.findUnique({
        where: { id: pLink.id },
      });
      expect(dbParticipantUnchanged?.hasSignature).toBe(false);

      const ssrIncompleteHtml = renderToString(
        await AssinarAtaPage({ params: Promise.resolve({ token: legacyIncompleteToken }) })
      );
      expect(ssrIncompleteHtml).toContain("Texto oficial pendente de conclusão");
      expect(ssrIncompleteHtml).not.toContain("Confirmar Assinatura Oficial");

      // Completa texto oficial com >= 10 caracteres válidos -> Revisão 4 revoga link antigo e libera coleta + lavratura
      const patchValidRes = await patchMinuteById(
        new Request(`http://localhost/api/atas/${draftMinute.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 3,
            summary: "   Texto oficial válido e completo para assinatura e lavratura.   ",
          }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(patchValidRes.status).toBe(200);
      expect((await patchValidRes.json()).minute.contentRevision).toBe(4);

      const screenOkRes = await signScreenPost(
        new Request(`http://localhost/api/atas/${draftMinute.id}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: pScreen.id,
            expectedRevision: 4,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(screenOkRes.status).toBe(200);

      const qrOkRes = await signTokenPost(
        new Request(`http://localhost/api/atas/${draftMinute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: pLink.id, expectedRevision: 4 }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(qrOkRes.status).toBe(200);
      const validToken = (await qrOkRes.json()).token;

      const linkOkRes = await publicSignPost(
        new Request(`http://localhost/api/atas/sign-token/${validToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 4,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ token: validToken }) }
      );
      expect(linkOkRes.status).toBe(200);

      const finRes = await finalizeMinutePost(
        new Request(`http://localhost/api/atas/${draftMinute.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 4 }),
        }),
        { params: Promise.resolve({ id: draftMinute.id }) }
      );
      expect(finRes.status).toBe(200);
      const finJson = await finRes.json();
      expect(finJson.minute.status).toBe("FINALIZED");
      expect(finJson.minute.contentRevision).toBe(4);
    });

    it("3. Controla IA externa por escola pelo painel sem AI_FORMALIZE_ALLOWED_SCHOOL_IDS, com auditoria real, bloqueio global e WhatsApp local", async () => {
      process.env.FORCE_STRICT_DB_AUTH = "true";
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";
      process.env.GEMINI_API_KEY = "AIzaSyntheticPanelPolicyPgReal00001";
      // Simula servidor com ID da Escola B em env antiga (mas flag do painel false) e SEM Escola A na env
      process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS = SCHOOL_B_ID;

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
                          formalSummary: "[DATA_ATENDIMENTO], atendimento regular com [ESTUDANTE_1].",
                          agreementsSummary: "Acompanhamento de rotina.",
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

      // 3.1 Transição segura: escola marcada como ligada no formato legado, porém fora de AI_FORMALIZE_ALLOWED_SCHOOL_IDS,
      // permanece fail-closed em modo local (0 chamadas) antes e após a transição até ativação explícita no painel;
      // Escola B (desligada no painel, mesmo com seu ID na env antiga) também permanece estritamente local.
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_PRESERVED_ID,
      });
      const pendingBeforeTransitionRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Estudante compareceu com o responsável para alinhamento.",
            studentNames: ["Lucas Pereira"],
          }),
        })
      );
      expect(pendingBeforeTransitionRes.status).toBe(200);
      expect((await pendingBeforeTransitionRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      const transitionReport = await transitionSchoolAiPoliciesToPanelControl({
        legacyAllowedSchoolIdsRaw: SCHOOL_B_ID,
        schoolIds: [SCHOOL_A_ID, SCHOOL_B_ID, SCHOOL_PRESERVED_ID],
      });
      expect(
        transitionReport.items.find((i) => i.schoolId === SCHOOL_PRESERVED_ID)?.outcome
      ).toBe("reconciled_to_local_outside_legacy_list");

      const afterTransitionOutsideListRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Estudante compareceu com o responsável para alinhamento após transição.",
            studentNames: ["Lucas Pereira"],
          }),
        })
      );
      expect(afterTransitionOutsideListRes.status).toBe(200);
      expect((await afterTransitionOutsideListRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      // Escola B não habilitada no painel permanece em modo local
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_B_ID,
      });
      const disabledBRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Atendimento escolar de rotina na unidade B.",
            studentNames: ["Estudante Escola B"],
          }),
        })
      );
      expect(disabledBRes.status).toBe(200);
      expect((await disabledBRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      // 3.2 Permissão do administrador: GESTOR_ESCOLAR recebe 403 em /ai-policy
      setSessionActor({
        id: GESTOR_A_ID,
        email: "gestor.r9@example.invalid",
        name: "Gestor R9",
        role: "GESTOR_ESCOLAR",
        schoolId: SCHOOL_A_ID,
      });
      const schoolASnap = await prisma.school.findUniqueOrThrow({ where: { id: SCHOOL_A_ID } });
      const forbiddenRes = await patchSchoolAiPolicy(
        new Request(`http://localhost/api/schools/${SCHOOL_A_ID}/ai-policy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aiExternalFormalizeEnabled: true,
            expectedUpdatedAt: schoolASnap.updatedAt.toISOString(),
            expectedPreviousEnabled: false,
          }),
        }),
        { params: Promise.resolve({ id: SCHOOL_A_ID }) }
      );
      expect(forbiddenRes.status).toBe(403);

      // 3.3 SUPERADMIN liga Escola A (edição piloto sintética) pelo painel sem institutionalAcceptanceConfirmed
      setSessionActor({
        id: SUPER_R9_ID,
        email: "superadmin.r9@example.invalid",
        name: "SuperAdmin R9",
        role: "SUPERADMIN",
        schoolId: SCHOOL_A_ID,
      });
      const enableARes = await patchSchoolAiPolicy(
        new Request(`http://localhost/api/schools/${SCHOOL_A_ID}/ai-policy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aiExternalFormalizeEnabled: true,
            expectedUpdatedAt: schoolASnap.updatedAt.toISOString(),
            expectedPreviousEnabled: false,
          }),
        }),
        { params: Promise.resolve({ id: SCHOOL_A_ID }) }
      );
      expect(enableARes.status).toBe(200);
      const enableAJson = await enableARes.json();
      expect(enableAJson.school.aiExternalFormalizeEnabled).toBe(true);
      expect(enableAJson.serverAvailability.available).toBe(true);

      const getARes = await getSchoolAiPolicy(
        new Request(`http://localhost/api/schools/${SCHOOL_A_ID}/ai-policy`),
        { params: Promise.resolve({ id: SCHOOL_A_ID }) }
      );
      expect(getARes.status).toBe(200);
      const getAJson = await getARes.json();
      expect(getAJson.school.aiExternalFormalizeEnabled).toBe(true);
      expect(getAJson.school.aiExternalFormalizeUpdatedBy).toBe("superadmin.r9@example.invalid");

      const enableAudit = await prisma.auditLog.findFirst({
        where: {
          schoolId: SCHOOL_A_ID,
          action: "UPDATE_SCHOOL_AI_POLICY",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(enableAudit).toBeTruthy();
      const enableAuditDetails = JSON.parse(String(enableAudit?.details || "{}"));
      expect(enableAuditDetails).toEqual(
        expect.objectContaining({
          schoolId: SCHOOL_A_ID,
          operatorEmail: "superadmin.r9@example.invalid",
          previousState: false,
          nextState: true,
          changedAt: expect.any(String),
        })
      );

      // 3.4 Pedagoga da Escola A usa IA externa para ata elegível (com pseudonimização) enquanto Escola B e ata sigilosa seguem locais
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });
      const eligibleARes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Lucas Pereira compareceu com seu responsável para alinhamento escolar.",
            studentNames: ["Lucas Pereira"],
          }),
        })
      );
      expect(eligibleARes.status).toBe(200);
      const eligibleAJson = await eligibleARes.json();
      expect(eligibleAJson.mode).toBe("EXTERNAL_AI");
      expect(eligibleAJson.result.formalSummary).toContain("Lucas Pereira");
      expect(externalRequests).toHaveLength(1);
      expect(externalRequests[0].bodyText).not.toContain("Lucas Pereira");
      externalRequests.length = 0;

      // Ata sigilosa na mesma Escola A ligada continua 100% local
      const secretARes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: true,
            ataScope: "STUDENTS",
            category: "SAUDE_VULNERABILIDADE",
            rawNotes: "Encaminhamento sigiloso para atendimento psicológico.",
            studentNames: ["Lucas Pereira"],
          }),
        })
      );
      expect(secretARes.status).toBe(200);
      expect((await secretARes.json()).mode).toBe("LOCAL_POLICY_GUARD");
      expect(externalRequests).toHaveLength(0);

      // Escola B permanece desligada
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_B_ID,
      });
      const stillDisabledBRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Atendimento de rotina na escola B.",
            studentNames: ["Estudante Escola B"],
          }),
        })
      );
      expect((await stillDisabledBRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      // 3.5 Bloqueio global no servidor bloqueia Escola A mesmo ligada no painel
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "false";
      const globalBlockedRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Atendimento sob bloqueio global.",
            studentNames: ["Lucas Pereira"],
          }),
        })
      );
      expect((await globalBlockedRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);
      process.env.AI_FORMALIZE_EXTERNAL_ENABLED = "true";

      // 3.6 Desligamento pelo painel retorna Escola A para modo local e registra estado true -> false em auditoria
      setSessionActor({
        id: SUPER_R9_ID,
        email: "superadmin.r9@example.invalid",
        name: "SuperAdmin R9",
        role: "SUPERADMIN",
        schoolId: SCHOOL_A_ID,
      });
      const disableARes = await patchSchoolAiPolicy(
        new Request(`http://localhost/api/schools/${SCHOOL_A_ID}/ai-policy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aiExternalFormalizeEnabled: false,
            expectedUpdatedAt: enableAJson.school.updatedAt,
            expectedPreviousEnabled: true,
          }),
        }),
        { params: Promise.resolve({ id: SCHOOL_A_ID }) }
      );
      expect(disableARes.status).toBe(200);
      expect((await disableARes.json()).school.aiExternalFormalizeEnabled).toBe(false);

      const auditsA = await prisma.auditLog.findMany({
        where: { schoolId: SCHOOL_A_ID, action: "UPDATE_SCHOOL_AI_POLICY" },
        orderBy: { createdAt: "desc" },
      });
      expect(auditsA.length).toBeGreaterThanOrEqual(2);
      const latestDetails = JSON.parse(String(auditsA[0]?.details || "{}"));
      expect(latestDetails).toEqual(
        expect.objectContaining({
          schoolId: SCHOOL_A_ID,
          operatorEmail: "superadmin.r9@example.invalid",
          previousState: true,
          nextState: false,
        })
      );

      // Próxima formalização na Escola A volta ao modo local
      setSessionActor({
        id: PED_AUTHOR_ID,
        email: "ped.autora.r9@example.invalid",
        name: "Pedagoga Autora R9",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });
      const backToLocalRes = await formalizeAtaPost(
        new Request("http://localhost/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isConfidential: false,
            nonConfidentialConfirmed: true,
            ataScope: "STUDENTS",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            rawNotes: "Atendimento após desligamento pelo painel.",
            studentNames: ["Lucas Pereira"],
          }),
        })
      );
      expect(backToLocalRes.status).toBe(200);
      expect((await backToLocalRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);

      // WhatsApp segue exclusivamente local
      const waClassifyRes = await classifyReplyPost(
        new Request("http://localhost/api/ai/classify-reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawReply: "Estou com febre e atestado médico hoje.",
            studentName: "Lucas Pereira",
          }),
        })
      );
      expect(waClassifyRes.status).toBe(200);
      expect((await waClassifyRes.json()).mode).toBe("LOCAL_ONLY");
      expect(externalRequests).toHaveLength(0);
    });
  }
);
