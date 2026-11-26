import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@/lib/signingPin";

const hoisted = vi.hoisted(() => ({
  authSession: null as any,
  cookiesMap: new Map<string, string>(),
  googleVerifyPayload: {
    email: "docente.r6.sintetico@escola.pr.gov.br",
    name: "Docente Sintético R6",
    sub: "sub-r6-docente-1",
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (key: string) =>
      hoisted.cookiesMap.has(key) ? { name: key, value: hoisted.cookiesMap.get(key)! } : undefined,
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
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

vi.mock("@/lib/escolaGoogleVerify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/escolaGoogleVerify")>();
  return {
    ...actual,
    verifyEscolaGoogleIdToken: vi.fn(async () => ({
      ok: true as const,
      tokenInfo: hoisted.googleVerifyPayload,
    })),
  };
});

import { POST as createMinutePost } from "@/app/api/atas/route";
import { GET as getMinuteById, PATCH as patchMinuteById } from "@/app/api/atas/[id]/route";
import { POST as signScreenPost } from "@/app/api/atas/[id]/sign-screen/route";
import { POST as signTokenPost } from "@/app/api/atas/[id]/sign-token/route";
import { GET as publicSignGet, POST as publicSignPost } from "@/app/api/atas/sign-token/[token]/route";
import { POST as reopenMinutePost } from "@/app/api/atas/[id]/reopen/route";
import { POST as finalizeMinutePost } from "@/app/api/atas/[id]/finalize/route";
import { POST as addendumPost } from "@/app/api/atas/[id]/addendums/route";
import { PATCH as nestedActionPatch } from "@/app/api/atas/[id]/actions/[actionId]/route";
import { PATCH as directActionPatch } from "@/app/api/atas/actions/[id]/route";
import {
  GET as physicalScanGet,
  POST as physicalScanPost,
  DELETE as physicalScanDelete,
} from "@/app/api/atas/[id]/physical-scan/route";
import { POST as formalizeAtaPost } from "@/app/api/ai/formalize-ata/route";
import AssinarAtaPage from "@/app/assinar/ata/[token]/page";

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

const VALID_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SCHOOL_A_ID = "syn-school-r6-a";
const SCHOOL_B_ID = "syn-school-r6-b";
const AUTHOR_A_ID = "syn-user-r6-author-a";
const AUTHOR_A_EMAIL = "pedagoga.r6a@example.invalid";
const COLLEAGUE_A_ID = "syn-user-r6-colleague-a";
const COLLEAGUE_A_EMAIL = "colega.r6a@example.invalid";
const MANAGER_A_ID = "syn-user-r6-manager-a";
const MANAGER_A_EMAIL = "gestora.r6a@example.invalid";
const USER_B_ID = "syn-user-r6-b";
const USER_B_EMAIL = "pedagoga.r6b@example.invalid";

const CG_A_ID = "syn-cg-r6-a";
const CG_B_ID = "syn-cg-r6-b";
const STU_A1_ID = "syn-stu-r6-a1";
const STU_A2_ID = "syn-stu-r6-a2";
const STU_B1_ID = "syn-stu-r6-b1";

const VALID_PIN = "8391";

function setActor(user: { id: string; email: string; name: string; role: string; schoolId: string }) {
  hoisted.authSession = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      schoolId: user.schoolId,
      active: true,
      schools: [{ schoolId: user.schoolId, role: user.role, active: true }],
    },
  };
  hoisted.cookiesMap.set("active_school_id", user.schoolId);
}

function buildMultiConnUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set("connection_limit", "6");
  return parsed.toString();
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasIsolatedDb)(
  "Fase 01 — Rodada 6 Assinatura por Revisão, Trava e Reabertura em PostgreSQL 16 Real",
  () => {
    let lockClient: PrismaClient;
    const prevForceStrict = process.env.FORCE_STRICT_DB_AUTH;

    beforeAll(async () => {
      lockClient = new PrismaClient({
        datasources: { db: { url: buildMultiConnUrl(process.env.DATABASE_URL!) } },
      });
      await lockClient.$connect();

      const pinHash = await hashPin(VALID_PIN);

      for (const s of [
        { id: SCHOOL_A_ID, name: "Escola Sintética R6 Alfa", inepCode: "99990601" },
        { id: SCHOOL_B_ID, name: "Escola Sintética R6 Beta", inepCode: "99990602" },
      ]) {
        await prisma.school.upsert({
          where: { id: s.id },
          update: {
            name: s.name,
            inepCode: s.inepCode,
            active: true,
            settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA", aiExternalFormalizeEnabled: false }),
          },
          create: {
            id: s.id,
            name: s.name,
            inepCode: s.inepCode,
            city: "Cidade Sintética",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA", aiExternalFormalizeEnabled: false }),
          },
        });
      }

      for (const u of [
        { id: AUTHOR_A_ID, email: AUTHOR_A_EMAIL, name: "Pedagoga Autora R6", role: "PEDAGOGA", schoolId: SCHOOL_A_ID },
        { id: COLLEAGUE_A_ID, email: COLLEAGUE_A_EMAIL, name: "Colega R6", role: "PEDAGOGA", schoolId: SCHOOL_A_ID },
        { id: MANAGER_A_ID, email: MANAGER_A_EMAIL, name: "Diretora R6", role: "GESTOR_ESCOLAR", schoolId: SCHOOL_A_ID },
        { id: USER_B_ID, email: USER_B_EMAIL, name: "Pedagoga Beta R6", role: "PEDAGOGA", schoolId: SCHOOL_B_ID },
      ]) {
        await prisma.user.upsert({
          where: { id: u.id },
          update: {
            email: u.email,
            name: u.name,
            role: u.role,
            active: true,
            schoolId: u.schoolId,
            signingPinHash: pinHash,
            pinAttempts: 0,
            pinLockedUntil: null,
          },
          create: {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            active: true,
            schoolId: u.schoolId,
            signingPinHash: pinHash,
            pinAttempts: 0,
          },
        });
        await prisma.userSchool.upsert({
          where: { userId_schoolId: { userId: u.id, schoolId: u.schoolId } },
          update: { role: u.role, active: true },
          create: { userId: u.id, schoolId: u.schoolId, role: u.role, active: true },
        });
      }

      await prisma.classGroup.upsert({
        where: { id: CG_A_ID },
        update: { name: "7º R6 A", schoolId: SCHOOL_A_ID, segment: "FUNDAMENTAL", shift: "MANHA" },
        create: { id: CG_A_ID, name: "7º R6 A", schoolId: SCHOOL_A_ID, segment: "FUNDAMENTAL", shift: "MANHA" },
      });
      await prisma.classGroup.upsert({
        where: { id: CG_B_ID },
        update: { name: "8º R6 B", schoolId: SCHOOL_B_ID, segment: "FUNDAMENTAL", shift: "TARDE" },
        create: { id: CG_B_ID, name: "8º R6 B", schoolId: SCHOOL_B_ID, segment: "FUNDAMENTAL", shift: "TARDE" },
      });

      for (const stu of [
        { id: STU_A1_ID, name: "Lucas Alfa R6", cgm: "99900601", phone: "00000000601", schoolId: SCHOOL_A_ID, cg: CG_A_ID },
        { id: STU_A2_ID, name: "Marina Sigilosa R6", cgm: "99900602", phone: "00000000602", schoolId: SCHOOL_A_ID, cg: CG_A_ID },
        { id: STU_B1_ID, name: "Rafael Beta R6", cgm: "99900603", phone: "00000000603", schoolId: SCHOOL_B_ID, cg: CG_B_ID },
      ]) {
        await prisma.student.upsert({
          where: { id: stu.id },
          update: {
            name: stu.name,
            cgm: stu.cgm,
            phone: stu.phone,
            schoolId: stu.schoolId,
            classGroupId: stu.cg,
          },
          create: {
            id: stu.id,
            name: stu.name,
            cgm: stu.cgm,
            phone: stu.phone,
            schoolId: stu.schoolId,
            classGroupId: stu.cg,
          },
        });
      }
    });

    beforeEach(() => {
      process.env.FORCE_STRICT_DB_AUTH = "1";
      hoisted.cookiesMap.clear();
      setActor({
        id: AUTHOR_A_ID,
        email: AUTHOR_A_EMAIL,
        name: "Pedagoga Autora R6",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });
    });

    afterEach(() => {
      if (prevForceStrict === undefined) delete process.env.FORCE_STRICT_DB_AUTH;
      else process.env.FORCE_STRICT_DB_AUTH = prevForceStrict;
    });

    afterAll(async () => {
      await prisma.auditLog.deleteMany({
        where: { schoolId: { in: [SCHOOL_A_ID, SCHOOL_B_ID] } },
      });
      await prisma.pedagogicalMinute.deleteMany({
        where: { schoolId: { in: [SCHOOL_A_ID, SCHOOL_B_ID] } },
      });
      await prisma.student.deleteMany({
        where: { schoolId: { in: [SCHOOL_A_ID, SCHOOL_B_ID] } },
      });
      await prisma.classGroup.deleteMany({
        where: { schoolId: { in: [SCHOOL_A_ID, SCHOOL_B_ID] } },
      });
      await prisma.userSchool.deleteMany({
        where: { schoolId: { in: [SCHOOL_A_ID, SCHOOL_B_ID] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [AUTHOR_A_ID, COLLEAGUE_A_ID, MANAGER_A_ID, USER_B_ID] } },
      });
      await prisma.school.deleteMany({
        where: { id: { in: [SCHOOL_A_ID, SCHOOL_B_ID] } },
      });
      await lockClient.$disconnect();
    });

    it("1. Ciclo completo na mesma revisão (tela + QR + OAuth + PIN + aditamento Em tempo)", async () => {
      const createRes = await createMinutePost(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attendedAt: new Date().toISOString(),
            category: "BUSCA_ATIVA_FALTAS",
            subject: "Ciclo Completo Revisão Única",
            summary: "Registro inicial com três signatários na mesma revisão.",
            studentIds: [STU_A1_ID],
            participants: [
              { role: "RESPONSAVEL", name: "Mãe do Lucas R6", kinship: "Mãe", studentId: STU_A1_ID },
              { role: "ESTUDANTE", name: "Lucas Alfa R6", studentId: STU_A1_ID },
              {
                role: "PROFESSOR",
                name: "Docente Sintético R6",
                expectedEmail: "docente.r6.sintetico@escola.pr.gov.br",
              },
            ],
            actionItems: [
              { description: "Acompanhar presença por 15 dias", responsible: "FAMILIA", dueDate: "2026-12-10" },
            ],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const minuteId = created.minute.id as string;
      const [pScreen, pQr, pOAuth] = created.minute.participants;
      expect(created.minute.contentRevision).toBe(1);

      // 1a assinatura imediata em tela via /sign-screen
      const screenRes = await signScreenPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: pScreen.id,
            expectedRevision: 1,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(screenRes.status).toBe(200);
      const screenJson = await screenRes.json();
      expect(screenJson.minute.participants.find((p: any) => p.id === pScreen.id).signedRevision).toBe(1);

      const signAudit = await prisma.auditLog.findFirst({
        where: { entityId: minuteId, action: "SIGN_ATA_SCREEN" },
      });
      expect(signAudit?.schoolId).toBe(SCHOOL_A_ID);

      // Emitir links e coletar os demais signatários na mesma revisão sem regravar o rascunho
      const qrTokenRes = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: pQr.id, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(qrTokenRes.status).toBe(200);
      const qrToken = (await qrTokenRes.json()).token as string;

      const qrSignRes = await publicSignPost(
        new Request(`http://localhost:3000/api/atas/sign-token/${qrToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, signatureData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ token: qrToken }) }
      );
      expect(qrSignRes.status).toBe(200);

      const oauthTokenRes = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: pOAuth.id, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(oauthTokenRes.status).toBe(200);
      const oauthToken = (await oauthTokenRes.json()).token as string;

      const oauthSignRes = await publicSignPost(
        new Request(`http://localhost:3000/api/atas/sign-token/${oauthToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, googleIdToken: "tok-google-sintetico" }),
        }),
        { params: Promise.resolve({ token: oauthToken }) }
      );
      expect(oauthSignRes.status).toBe(200);

      // Lavratura oficial com PIN real
      const finalizeRes = await finalizeMinutePost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(finalizeRes.status).toBe(200);
      const finalized = await finalizeRes.json();
      expect(finalized.minute.status).toBe("FINALIZED");
      for (const p of finalized.minute.participants) {
        expect(p.signedRevision).toBe(1);
      }

      // Aditamento pós-lavratura ("Em tempo") continua funcionando normalmente
      const addRes = await addendumPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/addendums`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signingPin: VALID_PIN,
            content: "Em tempo: família apresentou atestado complementar em arquivo.",
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(addRes.status).toBe(201);
    });

    it("2. Edição antes da 1ª assinatura avança revisão, mascara outro menor em SSR e invalida página antiga aberta", async () => {
      const createRes = await createMinutePost(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attendedAt: new Date().toISOString(),
            category: "CONVIVENCIA_INDISCIPLINA",
            subject: "Mediação Lucas Alfa R6 e Marina Sigilosa R6",
            summary: "Atendimento conjunto envolvendo Lucas Alfa R6 e Marina Sigilosa R6.",
            studentIds: [STU_A1_ID, STU_A2_ID],
            participants: [
              { role: "ESTUDANTE", name: "Lucas Alfa R6", studentId: STU_A1_ID },
            ],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const minuteId = created.minute.id as string;
      const partId = created.minute.participants[0].id as string;

      const tok1Res = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: partId, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      const tok1 = (await tok1Res.json()).token as string;

      // SSR da rev 1 exibe o menor vinculado e mascara o outro menor
      const pageEl = await AssinarAtaPage({ params: Promise.resolve({ token: tok1 }) });
      const pageHtml = renderToString(pageEl as React.ReactElement);
      expect(pageHtml).toContain("Lucas Alfa R6");
      expect(pageHtml).not.toContain("Marina Sigilosa R6");

      // Edição efetiva antes de qualquer assinatura avança contentRevision para 2 e revoga tok1
      const patchRes = await patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${minuteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            summary: "Texto revisado antes da assinatura de Lucas Alfa R6 e Marina Sigilosa R6.",
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.minute.contentRevision).toBe(2);
      expect(patched.minute.participants[0].hasActiveSignLink).toBe(false);

      // Página antiga tentando enviar tok1 falha com 404/409
      const oldGetRes = await publicSignGet(
        new Request(`http://localhost:3000/api/atas/sign-token/${tok1}`),
        { params: Promise.resolve({ token: tok1 }) }
      );
      expect([404, 409]).toContain(oldGetRes.status);

      const oldPostRes = await publicSignPost(
        new Request(`http://localhost:3000/api/atas/sign-token/${tok1}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, signatureData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ token: tok1 }) }
      );
      expect([404, 409]).toContain(oldPostRes.status);

      // Novo link na revisão 2 assina com signedRevision = 2
      const tok2Res = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: partId, expectedRevision: 2 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      const tok2 = (await tok2Res.json()).token as string;
      const sign2Res = await publicSignPost(
        new Request(`http://localhost:3000/api/atas/sign-token/${tok2}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 2, signatureData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ token: tok2 }) }
      );
      expect(sign2Res.status).toBe(200);

      const dbPart = await prisma.pedagogicalMinuteParticipant.findUnique({ where: { id: partId } });
      expect(dbPart?.signedRevision).toBe(2);
    });

    it("3. Concorrência sob pg_advisory_xact_lock: assinatura vs edição e edição vs assinatura em ambas as ordens", async () => {
      // Ordem A: assinatura entra primeiro no lock; PATCH concorrente retorna 409 e texto permanece rev 1
      const m1 = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_A_ID,
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Concorrência Assinatura Vence",
          summary: "Texto original que não pode mudar após assinatura.",
          authorId: AUTHOR_A_ID,
          authorEmail: AUTHOR_A_EMAIL,
          authorName: "Pedagoga Autora R6",
          participants: {
            create: [{ role: "RESPONSAVEL", name: "Responsável Lock A" }],
          },
        },
        include: { participants: true },
      });

      let lockReadyA!: () => void;
      const lockReadyPromiseA = new Promise<void>((r) => {
        lockReadyA = r;
      });
      let releaseA!: () => void;
      const releasePromiseA = new Promise<void>((r) => {
        releaseA = r;
      });

      const holderA = lockClient.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('minute_write_' || ${m1.id}));`;
          lockReadyA();
          await releasePromiseA;
          await tx.pedagogicalMinuteParticipant.update({
            where: { id: m1.participants[0].id },
            data: {
              signatureMode: "SCREEN_CANVAS",
              signatureData: VALID_PNG_DATA_URL,
              hasSignature: true,
              signedRevision: 1,
              signedAt: new Date(),
            },
          });
        },
        { maxWait: 10_000, timeout: 15_000 }
      );

      await lockReadyPromiseA;
      let patchSettledEarly = false;
      const patchPromise = patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${m1.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            summary: "Edição concorrente indevida após assinatura.",
          }),
        }),
        { params: Promise.resolve({ id: m1.id }) }
      ).then((r) => {
        patchSettledEarly = true;
        return r;
      });

      await delay(120);
      expect(patchSettledEarly).toBe(false);
      releaseA();
      const [, patchRes] = await Promise.all([holderA, patchPromise]);
      expect(patchRes.status).toBe(409);
      const dbM1 = await prisma.pedagogicalMinute.findUnique({ where: { id: m1.id } });
      expect(dbM1?.summary).toBe("Texto original que não pode mudar após assinatura.");
      expect(dbM1?.contentRevision).toBe(1);

      // Ordem B: PATCH efetivo avança rev 2 e revoga link; assinatura em rev 1 esperando no lock retorna 404/409
      const tokB = `tok-r6-race-${Date.now()}`;
      const m2 = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_A_ID,
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Concorrência Edição Vence",
          summary: "Texto rev 1 antes do PATCH.",
          authorId: AUTHOR_A_ID,
          authorEmail: AUTHOR_A_EMAIL,
          authorName: "Pedagoga Autora R6",
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Responsável Lock B",
                mobileSignToken: tokB,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                mobileSignRevision: 1,
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });

      let lockReadyB!: () => void;
      const lockReadyPromiseB = new Promise<void>((r) => {
        lockReadyB = r;
      });
      let releaseB!: () => void;
      const releasePromiseB = new Promise<void>((r) => {
        releaseB = r;
      });

      const holderB = lockClient.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('minute_write_' || ${m2.id}));`;
          lockReadyB();
          await releasePromiseB;
          await tx.pedagogicalMinute.update({
            where: { id: m2.id },
            data: { contentRevision: 2, summary: "Texto alterado para revisão 2." },
          });
          await tx.pedagogicalMinuteParticipant.updateMany({
            where: { minuteId: m2.id },
            data: { mobileSignToken: null, mobileSignExpiresAt: null, mobileSignRevision: null, hasActiveSignLink: false },
          });
        },
        { maxWait: 10_000, timeout: 15_000 }
      );

      await lockReadyPromiseB;
      let signSettledEarly = false;
      const signPromise = publicSignPost(
        new Request(`http://localhost:3000/api/atas/sign-token/${tokB}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, signatureData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ token: tokB }) }
      ).then((r) => {
        signSettledEarly = true;
        return r;
      });

      await delay(120);
      expect(signSettledEarly).toBe(false);
      releaseB();
      const [, staleSignRes] = await Promise.all([holderB, signPromise]);
      expect([404, 409]).toContain(staleSignRes.status);
      const dbP2 = await prisma.pedagogicalMinuteParticipant.findUnique({
        where: { id: m2.participants[0].id },
      });
      expect(dbP2?.hasSignature).toBe(false);
      expect(dbP2?.signedRevision).toBeNull();
    }, 30_000);

    it("4. Após 1ª assinatura, trava PATCH, clearSignature, rotas de encaminhamento em DRAFT, IA e alteração em /finalize", async () => {
      const m = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_A_ID,
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Ata Travada",
          summary: "Texto travado pela primeira assinatura.",
          authorId: AUTHOR_A_ID,
          authorEmail: AUTHOR_A_EMAIL,
          authorName: "Pedagoga Autora R6",
          students: { create: [{ studentId: STU_A1_ID, studentNameSnapshot: "Lucas Alfa R6", cgmSnapshot: "99900601" }] },
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Assinado Rev 1",
                signatureMode: "SCREEN_CANVAS",
                signatureData: VALID_PNG_DATA_URL,
                hasSignature: true,
                signedRevision: 1,
                signedAt: new Date(),
              },
            ],
          },
          actionItems: {
            create: [{ description: "Encaminhamento original", responsible: "FAMILIA" }],
          },
        },
        include: { participants: true, actionItems: true },
      });
      const partId = m.participants[0].id;
      const actionId = m.actionItems[0].id;

      // PATCH na revisão atual -> 409
      const patchSameRev = await patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, subject: "Tentativa de Edição" }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(patchSameRev.status).toBe(409);

      // PATCH com clearSignature individual -> 409
      const clearIndividual = await patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            participants: [{ id: partId, role: "RESPONSAVEL", name: "Assinado Rev 1", clearSignature: true }],
          }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(clearIndividual.status).toBe(409);

      // Rotas auxiliares de encaminhamento bloqueadas em DRAFT -> 409
      const nestedActRes = await nestedActionPatch(
        new Request(`http://localhost:3000/api/atas/${m.id}/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED" }),
        }),
        { params: Promise.resolve({ id: m.id, actionId }) }
      );
      expect(nestedActRes.status).toBe(409);

      const directActRes = await directActionPatch(
        new Request(`http://localhost:3000/api/atas/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED" }),
        }),
        { params: Promise.resolve({ id: actionId }) }
      );
      expect(directActRes.status).toBe(409);

      // /api/ai/formalize-ata com minuteId já assinado -> 409
      const aiLockedRes = await formalizeAtaPost(
        new Request("http://localhost:3000/api/ai/formalize-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minuteId: m.id,
            rawNotes: "Notas novas indevidas.",
            studentIds: [STU_A1_ID],
          }),
        })
      );
      expect(aiLockedRes.status).toBe(409);

      // /finalize tentando alterar conteúdo ou encaminhamento -> 409
      const finConflictRes = await finalizeMinutePost(
        new Request(`http://localhost:3000/api/atas/${m.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signingPin: VALID_PIN,
            expectedRevision: 1,
            summary: "Tentativa de trocar texto na hora da lavratura.",
          }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(finConflictRes.status).toBe(409);

      // Finalização limpa funciona e depois permite atualizar status do encaminhamento
      const finOkRes = await finalizeMinutePost(
        new Request(`http://localhost:3000/api/atas/${m.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(finOkRes.status).toBe(200);

      const afterFinalizeActRes = await directActionPatch(
        new Request(`http://localhost:3000/api/atas/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED" }),
        }),
        { params: Promise.resolve({ id: actionId }) }
      );
      expect(afterFinalizeActRes.status).toBe(200);
    });

    it("5. Reabertura explícita invalida assinaturas/recusas/links em transação única, preserva via física e audita apenas metadados", async () => {
      const m = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_A_ID,
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Assunto Confidencial Estudante Lucas Alfa R6",
          summary: "Conteúdo sigiloso da ata sobre Lucas Alfa R6.",
          authorId: AUTHOR_A_ID,
          authorEmail: AUTHOR_A_EMAIL,
          authorName: "Pedagoga Autora R6",
          hasPhysicalScan: true,
          physicalSignedScanData: "data:application/pdf;base64,JVBERi0xLjQK",
          physicalScanProvider: "db-fallback",
          physicalScanMimeType: "application/pdf",
          physicalScanRevision: 1,
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Assinante 1",
                signatureMode: "SCREEN_CANVAS",
                signatureData: VALID_PNG_DATA_URL,
                hasSignature: true,
                signedRevision: 1,
                signedAt: new Date(),
              },
              {
                role: "FAMILIAR_CONTATO",
                name: "Recusa 2",
                signatureMode: "REFUSED",
                refusalReason: "Recusa presencial",
                witnessName: "Diretora",
              },
              {
                role: "PROFESSOR",
                name: "Link Pendente 3",
                mobileSignToken: `tok-reopen-${Date.now()}`,
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                mobileSignRevision: 1,
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });

      // Sem confirmação explícita -> 400
      const noConfirmRes = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${m.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: false }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(noConfirmRes.status).toBe(400);

      // Com confirmação explícita e revisão exibida -> 200
      const reopenRes = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${m.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(reopenRes.status).toBe(200);
      const reopened = await reopenRes.json();
      expect(reopened.contentRevision).toBe(2);
      expect(reopened.invalidatedRevision).toBe(1);

      const fresh = await prisma.pedagogicalMinute.findUnique({
        where: { id: m.id },
        include: { participants: true, physicalProofHistory: true },
      });
      expect(fresh?.contentRevision).toBe(2);
      expect(fresh?.hasPhysicalScan).toBe(false);
      expect(fresh?.physicalSignedScanData).toBeNull();
      expect(fresh?.govBrVerified).toBe(false);
      expect(fresh?.physicalScanSupersededAt).not.toBeNull();
      expect(fresh?.physicalProofHistory.length).toBe(1);
      expect(fresh?.physicalProofHistory[0]?.scanFallbackData).toBe("data:application/pdf;base64,JVBERi0xLjQK");
      expect(fresh?.physicalProofHistory[0]?.supersededByRevision).toBe(2);
      for (const p of fresh!.participants) {
        expect(p.signatureMode).toBe("PENDING");
        expect(p.hasSignature).toBe(false);
        expect(p.signatureData).toBeNull();
        expect(p.signedRevision).toBeNull();
        expect(p.mobileSignToken).toBeNull();
        expect(p.mobileSignRevision).toBeNull();
        expect(p.hasActiveSignLink).toBe(false);
        expect(p.refusalReason).toBeNull();
      }

      const reopenAudit = await prisma.auditLog.findFirst({
        where: { entityId: m.id, action: "REOPEN_ATA_DRAFT" },
      });
      expect(reopenAudit?.schoolId).toBe(SCHOOL_A_ID);
      expect(reopenAudit?.details).not.toContain("Lucas Alfa R6");
      expect(reopenAudit?.details).not.toContain("Conteúdo sigiloso");
    });

    it("6. Isolamento entre escolas e sigilo reforçado em /sign-screen, /reopen, /sign-token e /physical-scan", async () => {
      const secretMinute = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_A_ID,
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          isConfidential: true,
          category: "SAUDE_VULNERABILIDADE",
          subject: "Atendimento Sigiloso R6",
          summary: "Texto restrito à autora e gestão da Escola A.",
          authorId: AUTHOR_A_ID,
          authorEmail: AUTHOR_A_EMAIL,
          authorName: "Pedagoga Autora R6",
          participants: { create: [{ role: "RESPONSAVEL", name: "Responsável Secreto" }] },
        },
        include: { participants: true },
      });
      const partId = secretMinute.participants[0].id;

      // Colega da mesma escola SEM acesso à ata sigilosa -> 403 em todas as rotas
      setActor({
        id: COLLEAGUE_A_ID,
        email: COLLEAGUE_A_EMAIL,
        name: "Colega R6",
        role: "PEDAGOGA",
        schoolId: SCHOOL_A_ID,
      });

      const colleagueScreen = await signScreenPost(
        new Request(`http://localhost:3000/api/atas/${secretMinute.id}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: partId, expectedRevision: 1, signatureData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(colleagueScreen.status).toBe(403);

      const colleagueReopen = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${secretMinute.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(colleagueReopen.status).toBe(403);

      const colleagueScan = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${secretMinute.id}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            scanData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(colleagueScan.status).toBe(403);

      // Operador de OUTRA escola -> 403 em todas as rotas
      setActor({
        id: USER_B_ID,
        email: USER_B_EMAIL,
        name: "Pedagoga Beta R6",
        role: "PEDAGOGA",
        schoolId: SCHOOL_B_ID,
      });

      const crossScreen = await signScreenPost(
        new Request(`http://localhost:3000/api/atas/${secretMinute.id}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: partId, expectedRevision: 1, signatureData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(crossScreen.status).toBe(403);

      const crossReopen = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${secretMinute.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(crossReopen.status).toBe(403);

      const crossToken = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${secretMinute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: partId, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(crossToken.status).toBe(403);

      // Diretora da Escola A consegue atuar legitimamente
      setActor({
        id: MANAGER_A_ID,
        email: MANAGER_A_EMAIL,
        name: "Diretora R6",
        role: "GESTOR_ESCOLAR",
        schoolId: SCHOOL_A_ID,
      });
      const managerRead = await getMinuteById(
        new Request(`http://localhost:3000/api/atas/${secretMinute.id}`),
        { params: Promise.resolve({ id: secretMinute.id }) }
      );
      expect(managerRead.status).toBe(200);
    });

    it("7. Rascunho legado sem vínculo de revisão e via física/Gov.br em DRAFT exigem reabertura com guarda do original antes de lavrar", async () => {
      const legacy = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_A_ID,
          year: 2026,
          status: "DRAFT",
          contentRevision: 1,
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Ata Legada + Via Física",
          summary: "Rascunho antigo já assinado antes da coluna signedRevision.",
          authorId: AUTHOR_A_ID,
          authorEmail: AUTHOR_A_EMAIL,
          authorName: "Pedagoga Autora R6",
          hasPhysicalScan: true,
          physicalSignedScanData: VALID_PNG_DATA_URL,
          physicalScanProvider: "db-fallback",
          physicalScanMimeType: "image/png",
          physicalScanRevision: null,
          govBrVerified: true,
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Assinante Legado",
                signatureMode: "MOBILE_QR",
                signatureData: VALID_PNG_DATA_URL,
                hasSignature: true,
                signedRevision: null,
                signedAt: new Date(),
              },
              {
                role: "PROFESSOR",
                name: "Pendente",
              },
            ],
          },
        },
        include: { participants: true },
      });
      const pendingPartId = legacy.participants[1].id;

      // PATCH, sign-token, sign-screen, DELETE physical-scan e /finalize ficam bloqueados com 409
      const patchLegacy = await patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${legacy.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, subject: "Editado" }),
        }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(patchLegacy.status).toBe(409);

      const tokenLegacy = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: pendingPartId, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(tokenLegacy.status).toBe(409);

      const screenLegacy = await signScreenPost(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: pendingPartId,
            expectedRevision: 1,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(screenLegacy.status).toBe(409);

      const deleteScanLegacy = await physicalScanDelete(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/physical-scan`, { method: "DELETE" }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(deleteScanLegacy.status).toBe(409);

      const finalizeLegacy = await finalizeMinutePost(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(finalizeLegacy.status).toBe(409);

      // Reabertura autorizada avança revisão para 2 mantendo arquivo original acessível apenas via histórico (?historyId=...)
      const reopenRes = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(reopenRes.status).toBe(200);
      const reopenJson = await reopenRes.json();
      const historyId = reopenJson.minute?.physicalProofHistory?.[0]?.id;
      expect(historyId).toBeTruthy();

      const activeSupersededGet = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/physical-scan`),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(activeSupersededGet.status).toBe(404);

      const preservedGet = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/physical-scan?historyId=${historyId}`),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(preservedGet.status).toBe(200);

      // Agora permite anexar nova via física vinculada à revisão 2 (travando novamente) e lavrar
      const newScanRes = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 2,
            scanData: VALID_PNG_DATA_URL,
            govBrVerified: true,
            govBrProtocol: "GOVBR-SYNTHETIC-2026",
          }),
        }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(newScanRes.status).toBe(200);

      const finAfterReopen = await finalizeMinutePost(
        new Request(`http://localhost:3000/api/atas/${legacy.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 2 }),
        }),
        { params: Promise.resolve({ id: legacy.id }) }
      );
      expect(finAfterReopen.status).toBe(200);
      const finJson = await finAfterReopen.json();
      expect(finJson.minute.status).toBe("FINALIZED");
      expect(finJson.minute.physicalScanRevision).toBe(2);
    });
  }
);
