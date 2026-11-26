import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import crypto from "crypto";
import { renderToString } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@/lib/signingPin";

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
import { GET as getMinuteById, PATCH as patchMinuteById } from "@/app/api/atas/[id]/route";
import { POST as signScreenPost } from "@/app/api/atas/[id]/sign-screen/route";
import { POST as signTokenPost } from "@/app/api/atas/[id]/sign-token/route";
import { GET as publicSignGet, POST as publicSignPost } from "@/app/api/atas/sign-token/[token]/route";
import { POST as reopenMinutePost } from "@/app/api/atas/[id]/reopen/route";
import { POST as finalizeMinutePost } from "@/app/api/atas/[id]/finalize/route";
import { GET as physicalScanGet, POST as physicalScanPost } from "@/app/api/atas/[id]/physical-scan/route";
import { GET as publicVerifyGet } from "@/app/api/atas/public/[code]/route";
import ValidarAtaPage from "@/app/validar/ata/[code]/page";
import AssinarAtaPage from "@/app/assinar/ata/[token]/page";
import { evaluateEffectivePhysicalProof } from "@/lib/ataRevision";

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
const VALID_PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
  "latin1"
).toString("base64")}`;

const SCHOOL_R7_ID = "syn-school-r7-a";
const USER_R7_ID = "syn-user-r7-a";
const USER_R7_EMAIL = "pedagoga.r7a@example.invalid";
const CG_R7_ID = "syn-cg-r7-a";
const STU_1_ID = "syn-stu-r7-a1";
const STU_2_ID = "syn-stu-r7-a2";
const VALID_PIN = "9472";

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

describe.skipIf(!hasIsolatedDb)(
  "Fase 01 — Rodada 7 Revisão Confirmada, Snapshots, Guarda Histórica de Via Física e Multi-Aba (PG 16 Real)",
  () => {
    const prevForceStrict = process.env.FORCE_STRICT_DB_AUTH;

    beforeAll(async () => {
      const pinHash = await hashPin(VALID_PIN);
      await prisma.school.upsert({
        where: { id: SCHOOL_R7_ID },
        update: {
          name: "Escola Sintética R7",
          inepCode: "99990701",
          active: true,
          settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA", aiExternalFormalizeEnabled: false }),
        },
        create: {
          id: SCHOOL_R7_ID,
          name: "Escola Sintética R7",
          inepCode: "99990701",
          city: "Cidade Sintética",
          state: "PR",
          network: "ESTADUAL",
          active: true,
          settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA", aiExternalFormalizeEnabled: false }),
        },
      });

      await prisma.user.upsert({
        where: { id: USER_R7_ID },
        update: {
          email: USER_R7_EMAIL,
          name: "Pedagoga Sintética R7",
          role: "PEDAGOGA",
          active: true,
          schoolId: SCHOOL_R7_ID,
          signingPinHash: pinHash,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
        create: {
          id: USER_R7_ID,
          email: USER_R7_EMAIL,
          name: "Pedagoga Sintética R7",
          role: "PEDAGOGA",
          active: true,
          schoolId: SCHOOL_R7_ID,
          signingPinHash: pinHash,
          pinAttempts: 0,
        },
      });

      await prisma.userSchool.upsert({
        where: { userId_schoolId: { userId: USER_R7_ID, schoolId: SCHOOL_R7_ID } },
        update: { role: "PEDAGOGA", active: true },
        create: { userId: USER_R7_ID, schoolId: SCHOOL_R7_ID, role: "PEDAGOGA", active: true },
      });

      await prisma.classGroup.upsert({
        where: { id: CG_R7_ID },
        update: { name: "6º Ano R7 A", schoolId: SCHOOL_R7_ID, segment: "FUNDAMENTAL", shift: "MANHA" },
        create: { id: CG_R7_ID, name: "6º Ano R7 A", schoolId: SCHOOL_R7_ID, segment: "FUNDAMENTAL", shift: "MANHA" },
      });

      for (const s of [
        { id: STU_1_ID, name: "Gabriel Primeiro R7", cgm: "77001", phone: "00000000701" },
        { id: STU_2_ID, name: "Helena Segunda R7", cgm: "77002", phone: "00000000702" },
      ]) {
        await prisma.student.upsert({
          where: { id: s.id },
          update: { name: s.name, cgm: s.cgm, phone: s.phone, schoolId: SCHOOL_R7_ID, classGroupId: CG_R7_ID },
          create: { id: s.id, name: s.name, cgm: s.cgm, phone: s.phone, schoolId: SCHOOL_R7_ID, classGroupId: CG_R7_ID },
        });
      }
    });

    beforeEach(() => {
      process.env.FORCE_STRICT_DB_AUTH = "1";
      hoisted.cookiesMap.clear();
      setActor({
        id: USER_R7_ID,
        email: USER_R7_EMAIL,
        name: "Pedagoga Sintética R7",
        role: "PEDAGOGA",
        schoolId: SCHOOL_R7_ID,
      });
    });

    afterEach(() => {
      if (prevForceStrict === undefined) delete process.env.FORCE_STRICT_DB_AUTH;
      else process.env.FORCE_STRICT_DB_AUTH = prevForceStrict;
    });

    afterAll(async () => {
      await prisma.auditLog.deleteMany({ where: { schoolId: SCHOOL_R7_ID } });
      await prisma.pedagogicalMinute.deleteMany({ where: { schoolId: SCHOOL_R7_ID } });
      await prisma.student.deleteMany({ where: { schoolId: SCHOOL_R7_ID } });
      await prisma.classGroup.deleteMany({ where: { schoolId: SCHOOL_R7_ID } });
      await prisma.userSchool.deleteMany({ where: { schoolId: SCHOOL_R7_ID } });
      await prisma.user.deleteMany({ where: { id: USER_R7_ID } });
      await prisma.school.deleteMany({ where: { id: SCHOOL_R7_ID } });
    });

    it("Ponto 1: reabertura exige expectedRevision confirmado, retorna 409 em revisão obsoleta sem alterar dados nem auditar, e reabre em revisão atual", async () => {
      const m = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_R7_ID,
          year: 2026,
          status: "DRAFT",
          contentRevision: 2,
          attendedAt: new Date("2026-11-20T14:00:00.000Z"),
          subject: "Ata Ponto 1 Reabertura",
          summary: "Conteúdo revisado na revisão 2.",
          authorId: USER_R7_ID,
          authorName: "Pedagoga Sintética R7",
          authorEmail: USER_R7_EMAIL,
          authorRole: "PEDAGOGA",
          students: {
            create: {
              studentId: STU_1_ID,
              studentNameSnapshot: "Gabriel Primeiro R7",
              classNameSnapshot: "6º Ano R7 A",
              cgmSnapshot: "77001",
            },
          },
          participants: {
            create: [
              {
                role: "RESPONSAVEL",
                name: "Mãe do Gabriel",
                signatureMode: "SCREEN_CANVAS",
                signatureData: VALID_PNG_DATA_URL,
                hasSignature: true,
                signedRevision: 2,
                signedAt: new Date(),
              },
              {
                role: "PROFESSOR",
                name: "Prof. Júlio",
                signatureMode: "PENDING",
                mobileSignToken: "tok-keep-r7-p1",
                mobileSignExpiresAt: new Date(Date.now() + 600_000),
                mobileSignRevision: 2,
                hasActiveSignLink: true,
              },
            ],
          },
        },
        include: { participants: true },
      });

      // 1) Sem expectedRevision -> 400
      const missingRes = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${m.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(missingRes.status).toBe(400);

      // 2) expectedRevision obsoleto (1 != 2) -> 409 sem alterar nada e sem evento de auditoria
      const staleRes = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${m.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(staleRes.status).toBe(409);

      const intactAfter409 = await prisma.pedagogicalMinute.findUnique({
        where: { id: m.id },
        include: { participants: true },
      });
      expect(intactAfter409?.contentRevision).toBe(2);
      expect(intactAfter409?.participants.find((p) => p.role === "RESPONSAVEL")?.hasSignature).toBe(true);
      expect(intactAfter409?.participants.find((p) => p.role === "PROFESSOR")?.mobileSignToken).toBe("tok-keep-r7-p1");

      const auditsAfter409 = await prisma.auditLog.count({
        where: { entityId: m.id, action: "REOPEN_ATA_DRAFT" },
      });
      expect(auditsAfter409).toBe(0);

      // 3) expectedRevision vigente (2) -> 200 em transação única
      const validRes = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${m.id}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true, expectedRevision: 2 }),
        }),
        { params: Promise.resolve({ id: m.id }) }
      );
      expect(validRes.status).toBe(200);
      const validJson = await validRes.json();
      expect(validJson.invalidatedRevision).toBe(2);
      expect(validJson.contentRevision).toBe(3);

      const fresh = await prisma.pedagogicalMinute.findUnique({
        where: { id: m.id },
        include: { participants: true },
      });
      expect(fresh?.contentRevision).toBe(3);
      for (const p of fresh!.participants) {
        expect(p.hasSignature).toBe(false);
        expect(p.signedRevision).toBeNull();
        expect(p.mobileSignToken).toBeNull();
        expect(p.hasActiveSignLink).toBe(false);
      }

      const auditsAfterValid = await prisma.auditLog.count({
        where: { entityId: m.id, action: "REOPEN_ATA_DRAFT" },
      });
      expect(auditsAfterValid).toBe(1);
    });

    it("Ponto 2: no-op não reescreve linhas; alteração cadastral com mesmos studentIds atualiza snapshots, avança revisão, revoga token e mascara novo nome do outro menor", async () => {
      const createRes = await createMinutePost(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "BUSCA_ATIVA_FALTAS",
            attendedAt: "2026-11-20T14:00:00.000Z",
            subject: "Ata Ponto 2 Snapshots",
            summary: "Registro sobre Gabriel Primeiro R7 e Helena Renomeada Sigilosa R7.",
            studentIds: [STU_1_ID, STU_2_ID],
            participants: [
              { role: "ESTUDANTE", studentId: STU_1_ID, name: "Gabriel Primeiro R7" },
              { role: "ESTUDANTE", studentId: STU_2_ID, name: "Helena Segunda R7" },
            ],
            actionItems: [{ description: "Monitorar presença", responsible: "FAMILIA", dueDate: "2026-11-29" }],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const minuteId = created.minute.id;
      const p1Id = created.minute.participants.find((p: any) => p.studentId === STU_1_ID).id;

      const beforeIds = await prisma.pedagogicalMinute.findUnique({
        where: { id: minuteId },
        include: {
          students: { orderBy: { studentId: "asc" } },
          participants: { orderBy: { id: "asc" } },
          actionItems: true,
        },
      });

      const tokRev1Res = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: p1Id, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(tokRev1Res.status).toBe(200);
      const tokRev1 = (await tokRev1Res.json()).token;

      // 1) PATCH exatamente igual -> no-op: preserva IDs das linhas, token e revisão 1 sem UPDATE_ATA_DRAFT
      const noopRes = await patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${minuteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            category: "BUSCA_ATIVA_FALTAS",
            isConfidential: false,
            attendedAt: "2026-11-20T14:00:00.000Z",
            subject: "Ata Ponto 2 Snapshots",
            rawNotes: null,
            summary: "Registro sobre Gabriel Primeiro R7 e Helena Renomeada Sigilosa R7.",
            agreementsSummary: null,
            studentIds: [STU_1_ID, STU_2_ID],
            participants: created.minute.participants.map((p: any) => ({
              id: p.id,
              role: p.role,
              studentId: p.studentId,
              name: p.name,
              signatureMode: p.signatureMode,
            })),
            actionItems: [{ description: "Monitorar presença", responsible: "FAMILIA", dueDate: "2026-11-29" }],
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(noopRes.status).toBe(200);
      const noopJson = await noopRes.json();
      expect(noopJson.minute.contentRevision).toBe(1);

      const afterNoop = await prisma.pedagogicalMinute.findUnique({
        where: { id: minuteId },
        include: {
          students: { orderBy: { studentId: "asc" } },
          participants: { orderBy: { id: "asc" } },
          actionItems: true,
        },
      });
      expect(afterNoop?.students.map((s) => s.id)).toEqual(beforeIds?.students.map((s) => s.id));
      expect(afterNoop?.participants.map((p) => p.id)).toEqual(beforeIds?.participants.map((p) => p.id));
      expect(afterNoop?.actionItems.map((a) => a.id)).toEqual(beforeIds?.actionItems.map((a) => a.id));
      expect(afterNoop?.participants.find((p) => p.id === p1Id)?.mobileSignToken).toBe(tokRev1);
      expect(await prisma.auditLog.count({ where: { entityId: minuteId, action: "UPDATE_ATA_DRAFT" } })).toBe(0);

      // 2) Altera nome dos estudantes no cadastro mantendo os MESMOS studentIds -> PATCH atualiza snapshot, avança revisão e revoga tokRev1
      await prisma.student.update({ where: { id: STU_1_ID }, data: { name: "Gabriel Renomeado R7" } });
      await prisma.student.update({ where: { id: STU_2_ID }, data: { name: "Helena Renomeada Sigilosa R7" } });

      try {
        const snapshotRes = await patchMinuteById(
          new Request(`http://localhost:3000/api/atas/${minuteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              subject: "Ata Ponto 2 Snapshots",
              summary: "Registro sobre Gabriel Primeiro R7 e Helena Renomeada Sigilosa R7.",
              studentIds: [STU_1_ID, STU_2_ID],
            }),
          }),
          { params: Promise.resolve({ id: minuteId }) }
        );
        expect(snapshotRes.status).toBe(200);
        const snapJson = await snapshotRes.json();
        expect(snapJson.minute.contentRevision).toBe(2);
        const snapNames = snapJson.minute.students.map((s: any) => s.studentNameSnapshot);
        expect(snapNames).toContain("Gabriel Renomeado R7");
        expect(snapNames).toContain("Helena Renomeada Sigilosa R7");

        const rev1Get = await publicSignGet(
          new Request(`http://localhost:3000/api/atas/sign-token/${tokRev1}`),
          { params: Promise.resolve({ token: tokRev1 }) }
        );
        expect(rev1Get.status).toBe(404);

        const tokRev2Res = await signTokenPost(
          new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ participantId: p1Id, expectedRevision: 2 }),
          }),
          { params: Promise.resolve({ id: minuteId }) }
        );
        expect(tokRev2Res.status).toBe(200);
        const tokRev2 = (await tokRev2Res.json()).token;

        const signGet2 = await publicSignGet(
          new Request(`http://localhost:3000/api/atas/sign-token/${tokRev2}`),
          { params: Promise.resolve({ token: tokRev2 }) }
        );
        expect(signGet2.status).toBe(200);
        const signJson2 = await signGet2.json();
        expect(signJson2.participant.minuteRevision).toBe(2);
        expect(signJson2.participant.summary).toContain("Gabriel Primeiro R7");
        expect(signJson2.participant.summary).not.toContain("Helena Renomeada Sigilosa R7");

        const ssrHtml = renderToString(
          (await AssinarAtaPage({ params: Promise.resolve({ token: tokRev2 }) })) as React.ReactElement
        ).replace(/<!-- -->/g, "");
        expect(ssrHtml).toContain("Gabriel Primeiro R7");
        expect(ssrHtml).not.toContain("Helena Renomeada Sigilosa R7");
      } finally {
        await prisma.student.update({ where: { id: STU_1_ID }, data: { name: "Gabriel Primeiro R7" } });
        await prisma.student.update({ where: { id: STU_2_ID }, data: { name: "Helena Segunda R7" } });
      }
    });

    it("Ponto 3: via física histórica vai para tabela própria, não reativa por protocolo/reuso/mesmo SHA-256, não vaza pós-lavratura e mantém compatibilidade pré-versionamento", async () => {
      const createRes = await createMinutePost(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            subject: "Ata Ponto 3 Guarda Histórica",
            summary: "Conteúdo revisado para coleta física e reabertura.",
            studentIds: [STU_1_ID],
            participants: [{ role: "RESPONSAVEL", name: "Mãe Guarda R7" }],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const { id: minuteId, participants } = (await createRes.json()).minute;
      const partId = participants[0].id;

      // 1) Upload PNG + Gov.br na rev 1
      const scan1Res = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            scanData: VALID_PNG_DATA_URL,
            govBrVerified: true,
            govBrProtocol: "ITI-R7-REV1-001",
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(scan1Res.status).toBe(200);
      const pngSha256 = crypto
        .createHash("sha256")
        .update(Buffer.from(VALID_PNG_DATA_URL.split(",")[1], "base64"))
        .digest("hex");

      // 2) Reabrir rev 1 -> arquiva em PedagogicalMinutePhysicalProofHistory e limpa campos ativos
      const reopenRes = await reopenMinutePost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReopen: true, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(reopenRes.status).toBe(200);
      const reopenJson = await reopenRes.json();
      expect(reopenJson.minute.hasPhysicalScan).toBe(false);
      expect(reopenJson.minute.govBrVerified).toBe(false);
      expect(reopenJson.minute.govBrProtocol).toBeNull();
      expect(reopenJson.minute.physicalProofHistory).toHaveLength(1);
      const historyId = reopenJson.minute.physicalProofHistory[0].id;

      // Rota ativa GET /physical-scan -> 404; histórico ?historyId= -> 200
      const activeScanGet = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(activeScanGet.status).toBe(404);

      const histScanGet = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${historyId}`),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(histScanGet.status).toBe(200);
      expect(histScanGet.headers.get("X-Scan-Historical")).toBe("true");
      expect(histScanGet.headers.get("X-Scan-SHA256")).toBe(pngSha256);

      // Listagem e detalhe não mostram via física ativa nem selo Gov.br ativo
      const listRes = await listAtasGet(new Request("http://localhost:3000/api/atas"));
      const listMinute = (await listRes.json()).minutes.find((m: any) => m.id === minuteId);
      expect(listMinute.hasPhysicalScan).toBe(false);
      expect(listMinute.govBrVerified).toBe(false);
      expect(listMinute.govBrProtocol).toBeNull();
      expect(listMinute.physicalProofHistory).toHaveLength(1);

      const detailRes = await getMinuteById(new Request(`http://localhost:3000/api/atas/${minuteId}`), {
        params: Promise.resolve({ id: minuteId }),
      });
      const detailJson = await detailRes.json();
      expect(detailJson.minute.hasPhysicalScan).toBe(false);
      expect(detailJson.minute.govBrVerified).toBe(false);
      expect(detailJson.minute.physicalProofHistory).toHaveLength(1);

      // Tentativa de reativação por protocolo sem novo arquivo -> 400
      const protoOnlyRes = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 2,
            govBrVerified: true,
            govBrProtocol: "ITI-REACTIVATE-TRY",
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(protoOnlyRes.status).toBe(400);

      // Tentativa sem expectedRevision -> 400; revisão errada -> 409
      const noRevScan = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scanData: VALID_PDF_DATA_URL }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(noRevScan.status).toBe(400);

      const staleRevScan = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, scanData: VALID_PDF_DATA_URL }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(staleRevScan.status).toBe(409);

      // Reenvio do MESMO SHA-256 superado -> 409
      const sameShaRes = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 2, scanData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(sameShaRes.status).toBe(409);

      // Lavratura da revisão 2 com assinatura digital SEM nova via física -> público NÃO exibe selo Gov.br superado; histórico continua acessível
      const sign2Res = await signScreenPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: partId,
            expectedRevision: 2,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(sign2Res.status).toBe(200);

      const fin2Res = await finalizeMinutePost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 2 }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(fin2Res.status).toBe(200);
      const vCode2 = (await fin2Res.json()).minute.verificationCode;

      const pubRes = await publicVerifyGet(
        new Request(`http://localhost:3000/api/atas/public/${vCode2}`),
        { params: Promise.resolve({ code: vCode2 }) }
      );
      expect(pubRes.status).toBe(200);
      const pubData = (await pubRes.json()).data;
      expect(pubData.govBrVerified).toBe(false);
      expect(pubData.govBrProtocol).toBeNull();

      const pubHtml = renderToString(
        (await ValidarAtaPage({ params: Promise.resolve({ code: vCode2 }) })) as React.ReactElement
      );
      expect(pubHtml).not.toContain("Assinatura Gov.br verificada");

      const histAfterFinalize = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${historyId}`),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(histAfterFinalize.status).toBe(200);

      // Compatibilidade com ata lavrada pré-versionamento (physicalScanRevision: null, contentRevision: 1, sem physicalScanSupersededAt)
      const legacyFinalCode = `R7LEG-${Date.now()}`;
      const legacyFinal = await prisma.pedagogicalMinute.create({
        data: {
          schoolId: SCHOOL_R7_ID,
          year: 2026,
          ataNumber: 901,
          status: "FINALIZED",
          contentRevision: 1,
          physicalScanRevision: null,
          physicalScanSupersededAt: null,
          hasPhysicalScan: true,
          physicalSignedScanData: VALID_PDF_DATA_URL,
          physicalScanProvider: "DATABASE",
          physicalScanMimeType: "application/pdf",
          govBrVerified: true,
          govBrProtocol: "ITI-LEGACY-COMPAT-R7",
          verificationCode: legacyFinalCode,
          finalizedAt: new Date("2026-10-10T10:00:00.000Z"),
          attendedAt: new Date("2026-10-10T10:00:00.000Z"),
          subject: "Ata Lavrada Pré-Versionamento R7",
          summary: "Lavrada antes do versionamento.",
          authorId: USER_R7_ID,
          authorName: "Pedagoga Sintética R7",
          authorEmail: USER_R7_EMAIL,
          authorRole: "PEDAGOGA",
          students: {
            create: {
              studentId: STU_1_ID,
              studentNameSnapshot: "Gabriel Primeiro R7",
              classNameSnapshot: "6º Ano R7 A",
              cgmSnapshot: "77001",
            },
          },
        },
      });
      expect(evaluateEffectivePhysicalProof(legacyFinal).hasValidPhysicalProof).toBe(true);
      const legacyScanRes = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${legacyFinal.id}/physical-scan`),
        { params: Promise.resolve({ id: legacyFinal.id }) }
      );
      expect(legacyScanRes.status).toBe(200);
      const legacyPubRes = await publicVerifyGet(
        new Request(`http://localhost:3000/api/atas/public/${legacyFinalCode}`),
        { params: Promise.resolve({ code: legacyFinalCode }) }
      );
      expect((await legacyPubRes.json()).data.govBrVerified).toBe(true);
      const legacySsr = renderToString(
        (await ValidarAtaPage({ params: Promise.resolve({ code: legacyFinalCode }) })) as React.ReactElement
      );
      expect(legacySsr).toContain("Assinatura Gov.br verificada");
      expect(legacySsr).toContain("ITI-LEGACY-COMPAT-R7");
    });

    it("Ponto 4: sign-token exige expectedRevision conferido, poll=1 expõe signedRevision e 2º participante conclui na mesma revisão", async () => {
      const createRes = await createMinutePost(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            subject: "Ata Ponto 4 Multi-Aba",
            summary: "Conteúdo conferido para dois signatários.",
            studentIds: [STU_1_ID],
            participants: [
              { role: "RESPONSAVEL", name: "Mãe Ponto 4" },
              { role: "PROFESSOR", name: "Docente Ponto 4" },
            ],
          }),
        })
      );
      const minute = (await createRes.json()).minute;
      const p1 = minute.participants[0];
      const p2 = minute.participants[1];

      // 1) sign-token sem expectedRevision -> 400; revisão antiga/divergente -> 409
      const missingRevToken = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: p1.id }),
        }),
        { params: Promise.resolve({ id: minute.id }) }
      );
      expect(missingRevToken.status).toBe(400);

      const staleRevToken = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: p1.id, expectedRevision: 99 }),
        }),
        { params: Promise.resolve({ id: minute.id }) }
      );
      expect(staleRevToken.status).toBe(409);

      // 2) 1º participante assina na tela na revisão 1 -> ?poll=1 reflete signedRevision=1 para sincronizar outras abas
      const sign1Res = await signScreenPost(
        new Request(`http://localhost:3000/api/atas/${minute.id}/sign-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: p1.id,
            expectedRevision: 1,
            signatureData: VALID_PNG_DATA_URL,
          }),
        }),
        { params: Promise.resolve({ id: minute.id }) }
      );
      expect(sign1Res.status).toBe(200);

      const pollRes = await getMinuteById(
        new Request(`http://localhost:3000/api/atas/${minute.id}?poll=1`),
        { params: Promise.resolve({ id: minute.id }) }
      );
      expect(pollRes.status).toBe(200);
      const pollJson = await pollRes.json();
      expect(pollJson.contentRevision).toBe(1);
      expect(pollJson.updatedAt).toBeTruthy();
      expect(pollJson.participants.find((p: any) => p.participantId === p1.id)?.signedRevision).toBe(1);

      // Tentativa concorrente de editar em outra aba -> 409
      const lockedPatch = await patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${minute.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, summary: "Tentativa na Aba 2" }),
        }),
        { params: Promise.resolve({ id: minute.id }) }
      );
      expect(lockedPatch.status).toBe(409);

      // 3) 2º participante restante emite link na MESMA revisão 1, assina via token e lavra
      const tok2Res = await signTokenPost(
        new Request(`http://localhost:3000/api/atas/${minute.id}/sign-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: p2.id, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minute.id }) }
      );
      expect(tok2Res.status).toBe(200);
      const tok2 = (await tok2Res.json()).token;

      const sign2Res = await publicSignPost(
        new Request(`http://localhost:3000/api/atas/sign-token/${tok2}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 1, signatureData: VALID_PNG_DATA_URL }),
        }),
        { params: Promise.resolve({ token: tok2 }) }
      );
      expect(sign2Res.status).toBe(200);

      const finRes = await finalizeMinutePost(
        new Request(`http://localhost:3000/api/atas/${minute.id}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 1 }),
        }),
        { params: Promise.resolve({ id: minute.id }) }
      );
      expect(finRes.status).toBe(200);
      const finalized = (await finRes.json()).minute;
      expect(finalized.status).toBe("FINALIZED");
      expect(finalized.contentRevision).toBe(1);
    });
  }
);
