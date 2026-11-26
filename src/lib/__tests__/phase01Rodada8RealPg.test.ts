import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
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
import { POST as reopenMinutePost } from "@/app/api/atas/[id]/reopen/route";
import { POST as signTokenPost } from "@/app/api/atas/[id]/sign-token/route";
import { GET as publicSignGet } from "@/app/api/atas/sign-token/[token]/route";
import { POST as finalizeMinutePost } from "@/app/api/atas/[id]/finalize/route";
import { GET as physicalScanGet, POST as physicalScanPost } from "@/app/api/atas/[id]/physical-scan/route";
import { GET as publicVerifyGet } from "@/app/api/atas/public/[code]/route";
import ValidarAtaPage from "@/app/validar/ata/[code]/page";
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

const VALID_PIN = "6284";

function makePdfDataUrl(label: string) {
  const bytes = Buffer.from(
    `%PDF-1.4\n% ${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`,
    "latin1"
  );
  return {
    bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
  };
}

const NET_R8_ID = "syn-net-r8";
const SCHOOL_1_ID = "syn-school-r8-1";
const SCHOOL_2_ID = "syn-school-r8-2";
const CG_1_ID = "syn-cg-r8-1";
const CG_2_ID = "syn-cg-r8-2";
const STU_1A_ID = "syn-stu-r8-1a";
const STU_1B_ID = "syn-stu-r8-1b";
const STU_2A_ID = "syn-stu-r8-2a";

const PED1_ID = "syn-usr-r8-ped1";
const PED2_ID = "syn-usr-r8-ped2";
const GESTOR1_ID = "syn-usr-r8-gestor1";
const EXGESTOR1_ID = "syn-usr-r8-exgestor1";
const SEC1_ID = "syn-usr-r8-sec1";
const SUPER_ID = "syn-usr-r8-super";
const GESTOR2_ID = "syn-usr-r8-gestor2";

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

async function cleanupR8SyntheticData() {
  const schoolIds = [SCHOOL_1_ID, SCHOOL_2_ID];
  const userIds = [
    PED1_ID,
    PED2_ID,
    GESTOR1_ID,
    EXGESTOR1_ID,
    SEC1_ID,
    SUPER_ID,
    GESTOR2_ID,
  ];
  await prisma.auditLog.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.pedagogicalMinute.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.student.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.classGroup.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.userNetwork.deleteMany({
    where: { OR: [{ networkId: NET_R8_ID }, { userId: { in: userIds } }] },
  });
  await prisma.userSchool.deleteMany({
    where: { OR: [{ schoolId: { in: schoolIds } }, { userId: { in: userIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.educationNetwork.deleteMany({ where: { id: NET_R8_ID } });
}

describe.skipIf(!hasIsolatedDb)(
  "Fase 01 — Rodada 8 Sigilo Histórico, Backfill Real Rodada 6 (DB + S3) e Mascaramento Pós-Renomeação (PG 16 Real)",
  () => {
    const prevForceStrict = process.env.FORCE_STRICT_DB_AUTH;

    beforeAll(async () => {
      process.env.FORCE_STRICT_DB_AUTH = "true";
      await cleanupR8SyntheticData();
      const pinHash = await hashPin(VALID_PIN);

      await prisma.educationNetwork.create({
        data: {
          id: NET_R8_ID,
          name: "Rede Municipal Sintética R8",
          shortName: "SEMEC R8",
          city: "Cidade Sintética",
          state: "PR",
          type: "MUNICIPAL",
          active: true,
        },
      });

      await prisma.school.createMany({
        data: [
          {
            id: SCHOOL_1_ID,
            name: "Escola Sintética R8 Um",
            inepCode: "99990801",
            city: "Cidade Sintética",
            state: "PR",
            network: "MUNICIPAL",
            networkId: NET_R8_ID,
            active: true,
            settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL", aiExternalFormalizeEnabled: false }),
          },
          {
            id: SCHOOL_2_ID,
            name: "Escola Sintética R8 Dois",
            inepCode: "99990802",
            city: "Outra Cidade",
            state: "PR",
            network: "ESTADUAL",
            active: true,
            settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL", aiExternalFormalizeEnabled: false }),
          },
        ],
      });

      await prisma.classGroup.createMany({
        data: [
          { id: CG_1_ID, name: "8º R8 A", segment: "FUNDAMENTAL", shift: "MANHA", schoolId: SCHOOL_1_ID },
          { id: CG_2_ID, name: "8º R8 B", segment: "FUNDAMENTAL", shift: "MANHA", schoolId: SCHOOL_2_ID },
        ],
      });

      await prisma.student.createMany({
        data: [
          { id: STU_1A_ID, name: "Lucas Pereira", cgm: "80001", phone: "550099990001", schoolId: SCHOOL_1_ID, classGroupId: CG_1_ID },
          { id: STU_1B_ID, name: "Joao Marcos Silva", cgm: "80002", phone: "550099990002", schoolId: SCHOOL_1_ID, classGroupId: CG_1_ID },
          { id: STU_2A_ID, name: "Marina Campos", cgm: "80003", phone: "550099990003", schoolId: SCHOOL_2_ID, classGroupId: CG_2_ID },
        ],
      });

      await prisma.user.createMany({
        data: [
          { id: PED1_ID, email: "ped1.r8@example.invalid", name: "Pedagoga Autora R8", role: "PEDAGOGA", active: true, schoolId: SCHOOL_1_ID, signingPinHash: pinHash },
          { id: PED2_ID, email: "ped2.r8@example.invalid", name: "Colega R8", role: "PEDAGOGA", active: true, schoolId: SCHOOL_1_ID, signingPinHash: pinHash },
          { id: GESTOR1_ID, email: "gestor1.r8@example.invalid", name: "Diretor Um R8", role: "GESTOR_ESCOLAR", active: true, schoolId: SCHOOL_1_ID, signingPinHash: pinHash },
          // Em banco está rebaixada para PEDAGOGA mesmo se apresentar JWT antigo de GESTOR_ESCOLAR
          { id: EXGESTOR1_ID, email: "exgestor1.r8@example.invalid", name: "Ex Gestora R8", role: "PEDAGOGA", active: true, schoolId: SCHOOL_1_ID, signingPinHash: pinHash },
          { id: SEC1_ID, email: "sec1.r8@example.invalid", name: "Secretaria R8", role: "GESTAO_SECRETARIA", active: true, schoolId: SCHOOL_1_ID },
          { id: SUPER_ID, email: "super.r8@example.invalid", name: "SuperAdmin R8", role: "SUPERADMIN", active: true, schoolId: SCHOOL_1_ID },
          { id: GESTOR2_ID, email: "gestor2.r8@example.invalid", name: "Diretor Dois R8", role: "GESTOR_ESCOLAR", active: true, schoolId: SCHOOL_2_ID, signingPinHash: pinHash },
        ],
      });

      await prisma.userSchool.createMany({
        data: [
          { userId: PED1_ID, schoolId: SCHOOL_1_ID, role: "PEDAGOGA", active: true },
          { userId: PED2_ID, schoolId: SCHOOL_1_ID, role: "PEDAGOGA", active: true },
          { userId: GESTOR1_ID, schoolId: SCHOOL_1_ID, role: "GESTOR_ESCOLAR", active: true },
          { userId: EXGESTOR1_ID, schoolId: SCHOOL_1_ID, role: "PEDAGOGA", active: true },
          { userId: GESTOR2_ID, schoolId: SCHOOL_2_ID, role: "GESTOR_ESCOLAR", active: true },
        ],
      });

      await prisma.userNetwork.create({
        data: { userId: SEC1_ID, networkId: NET_R8_ID, role: "GESTAO_SECRETARIA", active: true },
      });
    });

    afterAll(async () => {
      await cleanupR8SyntheticData();
      if (prevForceStrict === undefined) delete process.env.FORCE_STRICT_DB_AUTH;
      else process.env.FORCE_STRICT_DB_AUTH = prevForceStrict;
    });

    beforeEach(() => {
      process.env.FORCE_STRICT_DB_AUTH = "true";
      hoisted.cookiesMap.clear();
    });

    afterEach(() => {
      hoisted.authSession = null;
      hoisted.cookiesMap.clear();
    });

    it("1. Anexo histórico de revisão sigilosa preserva sigilo quando a revisão atual vira comum e trata legados desconhecidos de forma restritiva", async () => {
      const pdfSecretRev1 = makePdfDataUrl("R8-CONFIDENTIAL-REV1");
      const pdfPublicRev2 = makePdfDataUrl("R8-PUBLIC-REV2");

      setSessionActor({
        id: PED1_ID,
        email: "ped1.r8@example.invalid",
        name: "Pedagoga Autora R8",
        role: "PEDAGOGA",
        schoolId: SCHOOL_1_ID,
      });

      const createRes = await createMinutePost(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "SAUDE_VULNERABILIDADE",
            isConfidential: true,
            subject: "Ata Sigilosa na Rev 1",
            summary: "Registro inicialmente classificado como sigiloso na revisão 1.",
            studentIds: [STU_1A_ID],
            participants: [{ role: "RESPONSAVEL", name: "Responsável Um" }],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const minuteId = (await createRes.json()).minute.id as string;

      const scan1Res = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 1,
            scanData: pdfSecretRev1.dataUrl,
            govBrVerified: true,
            govBrProtocol: "ITI-SECRET-REV1",
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(scan1Res.status).toBe(200);

      // Reabrir na rev 1 -> arquiva prova com originIsConfidential: true e autoria de ped1
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
      expect(reopenJson.minute.physicalProofHistory).toHaveLength(1);
      const secretHistId = reopenJson.minute.physicalProofHistory[0].id as string;

      // Confere gravação no banco da origem (escola, revisão, sigilo e autoria)
      const histRow = await prisma.pedagogicalMinutePhysicalProofHistory.findUnique({
        where: { id: secretHistId },
      });
      expect(histRow).toMatchObject({
        schoolId: SCHOOL_1_ID,
        contentRevision: 1,
        originIsConfidential: true,
        originAuthorId: PED1_ID,
        originAuthorEmail: "ped1.r8@example.invalid",
        govBrVerified: true,
        govBrProtocol: "ITI-SECRET-REV1",
      });

      // Altera a ata atual na revisão 2 para COMUM (isConfidential: false) e anexa nova prova comum na rev 2
      const makeCommonRes = await patchMinuteById(
        new Request(`http://localhost:3000/api/atas/${minuteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 2,
            isConfidential: false,
            subject: "Ata Reclassificada como Comum na Rev 2",
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(makeCommonRes.status).toBe(200);
      const commonRev = (await makeCommonRes.json()).minute.contentRevision;
      expect(commonRev).toBe(3);

      const scan2Res = await physicalScanPost(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: commonRev,
            scanData: pdfPublicRev2.dataUrl,
          }),
        }),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(scan2Res.status).toBe(200);

      // Também cria um registro legado no histórico desta mesma ata sem classificação/autoria comprovadas
      const legacyUnknownHist = await prisma.pedagogicalMinutePhysicalProofHistory.create({
        data: {
          minuteId,
          schoolId: SCHOOL_1_ID,
          contentRevision: null,
          originIsConfidential: null,
          originAuthorId: null,
          originAuthorEmail: null,
          scanProvider: "DATABASE",
          scanMimeType: "application/pdf",
          scanSizeBytes: pdfSecretRev1.bytes.length,
          scanSha256: makePdfDataUrl("R8-LEGACY-UNKNOWN").sha256,
          scanFallbackData: makePdfDataUrl("R8-LEGACY-UNKNOWN").dataUrl,
          govBrVerified: true,
          govBrProtocol: "ITI-LEGACY-UNKNOWN",
          supersededAt: new Date("2026-11-20T10:00:00Z"),
          supersededByRevision: null,
          supersededByEmail: null,
        },
      });

      // 1) Autora original (ped1): acessa anexo da rev 1 sigilosa, mas NÃO acessa legado sem autoria/classificação comprovadas
      const ped1Detail = await (
        await getMinuteById(new Request(`http://localhost:3000/api/atas/${minuteId}`), {
          params: Promise.resolve({ id: minuteId }),
        })
      ).json();
      expect(ped1Detail.minute.physicalProofHistory.map((h: any) => h.id)).toEqual([secretHistId]);

      const ped1SecretDownload = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${secretHistId}`),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(ped1SecretDownload.status).toBe(200);
      expect(Buffer.from(await ped1SecretDownload.arrayBuffer()).toString("latin1")).toContain("R8-CONFIDENTIAL-REV1");

      const ped1UnknownDownload = await physicalScanGet(
        new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${legacyUnknownHist.id}`),
        { params: Promise.resolve({ id: minuteId }) }
      );
      expect(ped1UnknownDownload.status).toBe(403);

      // 2) Colega da mesma escola (ped2): lê ata comum rev 3, mas NÃO vê metadados nem arquivo histórico sigiloso ou legado
      setSessionActor({
        id: PED2_ID,
        email: "ped2.r8@example.invalid",
        name: "Colega R8",
        role: "PEDAGOGA",
        schoolId: SCHOOL_1_ID,
      });

      const ped2List = await (await listAtasGet(new Request("http://localhost:3000/api/atas"))).json();
      const ped2Item = ped2List.minutes.find((m: any) => m.id === minuteId);
      expect(ped2Item.subject).toBe("Ata Reclassificada como Comum na Rev 2");
      expect(ped2Item.physicalProofHistory).toEqual([]);

      const ped2Detail = await (
        await getMinuteById(new Request(`http://localhost:3000/api/atas/${minuteId}`), {
          params: Promise.resolve({ id: minuteId }),
        })
      ).json();
      expect(ped2Detail.minute.physicalProofHistory).toEqual([]);

      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${secretHistId}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${legacyUnknownHist.id}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(403);

      // 3) Ex-gestora usando token/sessão antigo dizendo GESTOR_ESCOLAR, mas rebaixada no DB para PEDAGOGA -> 403 e histórico oculto!
      setSessionActor({
        id: EXGESTOR1_ID,
        email: "exgestor1.r8@example.invalid",
        name: "Ex Gestora R8",
        role: "GESTOR_ESCOLAR",
        schoolId: SCHOOL_1_ID,
      });
      const exGestorList = await (await listAtasGet(new Request("http://localhost:3000/api/atas"))).json();
      expect(exGestorList.minutes.find((m: any) => m.id === minuteId).physicalProofHistory).toEqual([]);
      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${secretHistId}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(403);

      // 4) Secretaria da rede -> lê ata comum, mas NÃO acessa anexos históricos sigilosos/desconhecidos
      setSessionActor({
        id: SEC1_ID,
        email: "sec1.r8@example.invalid",
        name: "Secretaria R8",
        role: "GESTAO_SECRETARIA",
        activeSchoolCookie: SCHOOL_1_ID,
      });
      const secDetail = await (
        await getMinuteById(new Request(`http://localhost:3000/api/atas/${minuteId}`), {
          params: Promise.resolve({ id: minuteId }),
        })
      ).json();
      expect(secDetail.minute.physicalProofHistory).toEqual([]);
      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${secretHistId}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(403);

      // 5) Diretora da Escola 2 (cross-tenant) -> 403
      setSessionActor({
        id: GESTOR2_ID,
        email: "gestor2.r8@example.invalid",
        name: "Diretor Dois R8",
        role: "GESTOR_ESCOLAR",
        schoolId: SCHOOL_2_ID,
      });
      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${secretHistId}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await getMinuteById(new Request(`http://localhost:3000/api/atas/${minuteId}`), {
            params: Promise.resolve({ id: minuteId }),
          })
        ).status
      ).toBe(403);

      // 6) Diretor da Escola 1 -> vê metadados e baixa ambos (sigiloso de origem + legado restritivo)
      setSessionActor({
        id: GESTOR1_ID,
        email: "gestor1.r8@example.invalid",
        name: "Diretor Um R8",
        role: "GESTOR_ESCOLAR",
        schoolId: SCHOOL_1_ID,
      });
      const gestorDetail = await (
        await getMinuteById(new Request(`http://localhost:3000/api/atas/${minuteId}`), {
          params: Promise.resolve({ id: minuteId }),
        })
      ).json();
      expect(gestorDetail.minute.physicalProofHistory.map((h: any) => h.id)).toEqual([
        secretHistId,
        legacyUnknownHist.id,
      ]);
      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${secretHistId}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(200);
      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${legacyUnknownHist.id}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(200);

      // 7) SuperAdmin -> acessa ambos metadados e arquivo
      setSessionActor({
        id: SUPER_ID,
        email: "super.r8@example.invalid",
        name: "SuperAdmin R8",
        role: "SUPERADMIN",
        activeSchoolCookie: SCHOOL_1_ID,
      });
      const superDetail = await (
        await getMinuteById(new Request(`http://localhost:3000/api/atas/${minuteId}`), {
          params: Promise.resolve({ id: minuteId }),
        })
      ).json();
      expect(superDetail.minute.physicalProofHistory).toHaveLength(2);
      expect(
        (
          await physicalScanGet(
            new Request(`http://localhost:3000/api/atas/${minuteId}/physical-scan?historyId=${secretHistId}`),
            { params: Promise.resolve({ id: minuteId }) }
          )
        ).status
      ).toBe(200);
    }, 30000);

    it("2. Migração aditiva arquiva anexos superados da Rodada 6 (DB e Object Storage S3) de forma idempotente, recuperável e sem manter selo Gov.br antigo", async () => {
      const r6DbPdf = makePdfDataUrl("R6-SUPERSEDED-DATABASE");
      const r6S3Pdf = makePdfDataUrl("R6-SUPERSEDED-S3-OBJECT");
      const r6LegacyPdf = makePdfDataUrl("R6-FINALIZED-LEGACY-VALID");
      const r8NewDbPdf = makePdfDataUrl("R8-NEW-REV2-DATABASE");
      const r8NewS3Pdf = makePdfDataUrl("R8-NEW-REV2-S3");

      // Sobe servidor HTTP sintético simulando Object Storage S3/R2
      const s3Store = new Map<string, Buffer>([
        ["atas/syn-school-r8-1/2026/min-r6-s3.pdf", r6S3Pdf.bytes],
      ]);
      const s3Server = http.createServer((req, res) => {
        const parsed = new URL(req.url || "/", "http://127.0.0.1");
        const key = decodeURIComponent(parsed.pathname.replace(/^\/syn-bucket\//, ""));
        if (req.method === "GET") {
          const payload = s3Store.get(key);
          if (!payload) {
            res.writeHead(404);
            res.end("Not Found");
            return;
          }
          res.writeHead(200, { "Content-Type": "application/pdf" });
          res.end(payload);
          return;
        }
        if (req.method === "PUT") {
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            s3Store.set(key, Buffer.concat(chunks));
            res.writeHead(200);
            res.end("OK");
          });
          return;
        }
        if (req.method === "DELETE") {
          s3Store.delete(key);
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(405);
        res.end();
      });

      await new Promise<void>((resolve) => s3Server.listen(0, "127.0.0.1", resolve));
      const s3Addr = s3Server.address();
      if (!s3Addr || typeof s3Addr === "string") {
        throw new Error("Falha ao inicializar servidor S3 sintético");
      }

      const prevS3Env = {
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_BUCKET: process.env.S3_BUCKET,
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
        S3_REGION: process.env.S3_REGION,
      };

      const baseUrl = new URL(process.env.DATABASE_URL!);
      const r6UrlObj = new URL(baseUrl.toString());
      r6UrlObj.pathname = "/redeativa_r6_upgrade_test";
      const R6_DB_URL = r6UrlObj.toString();

      // Prepara pasta temporária somente com migrações até Rodada 6 (20261124120000)
      const tmpPrismaDir = fs.mkdtempSync(path.join(os.tmpdir(), "r8-r6upgrade-"));
      const rootDir = process.cwd();
      const migsDir = path.join(rootDir, "prisma/migrations");
      const allMigs = fs
        .readdirSync(migsDir)
        .filter((d) => fs.statSync(path.join(migsDir, d)).isDirectory())
        .sort();
      const r6Migs = allMigs.filter((d) => d <= "20261124120000_ata_signature_revision_lock");
      expect(r6Migs).toContain("20261124120000_ata_signature_revision_lock");

      const tmpSchemaPath = path.join(tmpPrismaDir, "schema.prisma");
      const tmpMigsDir = path.join(tmpPrismaDir, "migrations");
      fs.mkdirSync(tmpMigsDir, { recursive: true });
      fs.copyFileSync(path.join(rootDir, "prisma/schema.prisma"), tmpSchemaPath);
      for (const m of r6Migs) {
        fs.cpSync(path.join(migsDir, m), path.join(tmpMigsDir, m), { recursive: true });
      }

      const fullSchemaPath = path.join(rootDir, "prisma/schema.prisma");
      const r8MigFilePath = path.join(
        migsDir,
        "20261124180000_ata_r8_history_origin_backfill_and_aliases/migration.sql"
      );

      // Garante banco de upgrade limpo e conectado para leitura pós-migração
      const r6Client = new PrismaClient({ datasources: { db: { url: R6_DB_URL } } });

      try {
        // Parte A: Teste REAL de upgrade de esquema a partir do estado Rodada 6 em redeativa_r6_upgrade_test
        await r6Client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
        await r6Client.$executeRawUnsafe(`CREATE SCHEMA public`);
        execFileSync(
          "npx",
          ["prisma", "migrate", "deploy", "--schema", tmpSchemaPath],
          {
            cwd: rootDir,
            env: { ...process.env, DATABASE_URL: R6_DB_URL, DIRECT_URL: R6_DB_URL },
            stdio: "pipe",
          }
        );

        // Insere dados sintéticos exatos no formato Rodada 6 (antes da existência de PedagogicalMinutePhysicalProofHistory)
        await r6Client.$executeRawUnsafe(
          `INSERT INTO "School" ("id", "inepCode", "name", "city", "state", "nre", "updatedAt")
           VALUES ('r6-sch', '88880601', 'Escola Legada R6', 'Cidade R6', 'PR', 'NRE R6', NOW())`
        );
        await r6Client.$executeRawUnsafe(
          `INSERT INTO "PedagogicalMinute" (
             "id", "schoolId", "year", "status", "contentRevision", "category", "isConfidential",
             "attendedAt", "subject", "summary", "authorId", "authorName", "authorEmail", "authorRole",
             "hasPhysicalScan", "physicalSignedScanData", "physicalScanProvider", "physicalScanMimeType",
             "physicalScanSizeBytes", "physicalScanSha256", "physicalScanUploadedAt", "physicalScanUploadedBy",
             "physicalScanRevision", "physicalScanSupersededAt", "govBrVerified", "govBrProtocol", "updatedAt"
           ) VALUES
           (
             'r6-min-db', 'r6-sch', 2026, 'DRAFT', 2, 'BUSCA_ATIVA_FALTAS', false,
             '2026-11-20T12:00:00Z', 'Ata R6 DB Superada', 'Resumo R6 DB', 'r6-ped', 'Pedagoga R6', 'ped.r6@example.invalid', 'PEDAGOGA',
             true, $1, 'DATABASE', 'application/pdf',
             $2, $3, '2026-11-21T10:00:00Z', 'Pedagoga R6',
             1, '2026-11-22T15:30:00Z', true, 'ITI-R6-DB-OLD', NOW()
           ),
           (
             'r6-min-s3', 'r6-sch', 2026, 'DRAFT', 2, 'ACOMPANHAMENTO_PEDAGOGICO', false,
             '2026-11-20T13:00:00Z', 'Ata R6 S3 Superada', 'Resumo R6 S3', 'r6-ped', 'Pedagoga R6', 'ped.r6@example.invalid', 'PEDAGOGA',
             true, NULL, 'S3', 'application/pdf',
             $4, $5, '2026-11-21T11:00:00Z', 'Pedagoga R6',
             1, '2026-11-22T16:45:00Z', true, 'ITI-R6-S3-OLD', NOW()
           ),
           (
             'r6-min-legacy-fin', 'r6-sch', 2026, 'FINALIZED', 1, 'BUSCA_ATIVA_FALTAS', false,
             '2026-10-10T10:00:00Z', 'Ata R6 Lavrada Válida', 'Resumo R6 Finalizada', 'r6-ped', 'Pedagoga R6', 'ped.r6@example.invalid', 'PEDAGOGA',
             true, $6, 'DATABASE', 'application/pdf',
             $7, $8, '2026-10-10T11:00:00Z', 'Pedagoga R6',
             NULL, NULL, true, 'ITI-R6-LEGACY-VALID', NOW()
           )`,
          r6DbPdf.dataUrl,
          r6DbPdf.bytes.length,
          r6DbPdf.sha256,
          r6S3Pdf.bytes.length,
          r6S3Pdf.sha256,
          r6LegacyPdf.dataUrl,
          r6LegacyPdf.bytes.length,
          r6LegacyPdf.sha256
        );
        await r6Client.$executeRawUnsafe(
          `UPDATE "PedagogicalMinute" SET "ataNumber" = 1, "verificationCode" = 'R6-LEG-01', "finalizedAt" = '2026-10-10T12:00:00Z' WHERE "id" = 'r6-min-legacy-fin'`
        );

        // Executa upgrade REAL das migrações restantes (Rodada 7 + Rodada 8) sobre os dados da Rodada 6
        execFileSync(
          "npx",
          ["prisma", "migrate", "deploy"],
          {
            cwd: rootDir,
            env: { ...process.env, DATABASE_URL: R6_DB_URL, DIRECT_URL: R6_DB_URL },
            stdio: "pipe",
          }
        );

        // Executa o SQL de migração da Rodada 8 uma segunda vez para comprovar estrita idempotência
        execFileSync(
          "npx",
          ["prisma", "db", "execute", "--file", r8MigFilePath, "--schema", fullSchemaPath],
          {
            cwd: rootDir,
            env: { ...process.env, DATABASE_URL: R6_DB_URL, DIRECT_URL: R6_DB_URL },
            stdio: "pipe",
          }
        );

        const r6HistDb = await r6Client.pedagogicalMinutePhysicalProofHistory.findMany({
          where: { minuteId: "r6-min-db" },
        });
        expect(r6HistDb).toHaveLength(1);
        expect(r6HistDb[0]).toMatchObject({
          id: "r6-backfill-r6-min-db",
          schoolId: "r6-sch",
          contentRevision: 1,
          originIsConfidential: null,
          originAuthorId: null,
          originAuthorEmail: null,
          scanProvider: "DATABASE",
          scanFallbackData: r6DbPdf.dataUrl,
          scanStorageKey: null,
          scanSha256: r6DbPdf.sha256,
          govBrVerified: true,
          govBrProtocol: "ITI-R6-DB-OLD",
          supersededByRevision: null,
          supersededByEmail: null,
        });

        const r6HistS3 = await r6Client.pedagogicalMinutePhysicalProofHistory.findMany({
          where: { minuteId: "r6-min-s3" },
        });
        expect(r6HistS3).toHaveLength(1);
        expect(r6HistS3[0]).toMatchObject({
          id: "r6-backfill-r6-min-s3",
          schoolId: "r6-sch",
          contentRevision: 1,
          originIsConfidential: null,
          originAuthorId: null,
          originAuthorEmail: null,
          scanProvider: "S3",
          scanFallbackData: null,
          scanSha256: r6S3Pdf.sha256,
          govBrVerified: true,
          govBrProtocol: "ITI-R6-S3-OLD",
          supersededByRevision: null,
          supersededByEmail: null,
        });

        const r6UpdatedDbMin = await r6Client.pedagogicalMinute.findUnique({ where: { id: "r6-min-db" } });
        expect(r6UpdatedDbMin).toMatchObject({
          hasPhysicalScan: false,
          physicalSignedScanData: null,
          physicalScanStorageKey: null,
          physicalScanSha256: null,
          physicalScanRevision: null,
          govBrVerified: false,
          govBrProtocol: null,
        });
        expect(r6UpdatedDbMin?.physicalScanSupersededAt).not.toBeNull();

        const r6UpdatedS3Min = await r6Client.pedagogicalMinute.findUnique({ where: { id: "r6-min-s3" } });
        expect(r6UpdatedS3Min).toMatchObject({
          hasPhysicalScan: false,
          physicalScanStorageKey: null,
          govBrVerified: false,
          govBrProtocol: null,
        });
        expect(r6UpdatedS3Min?.physicalScanSupersededAt).not.toBeNull();

        const r6LegacyHist = await r6Client.pedagogicalMinutePhysicalProofHistory.findMany({
          where: { minuteId: "r6-min-legacy-fin" },
        });
        expect(r6LegacyHist).toHaveLength(0);
        const r6LegacyFin = await r6Client.pedagogicalMinute.findUnique({ where: { id: "r6-min-legacy-fin" } });
        expect(r6LegacyFin).toMatchObject({
          hasPhysicalScan: true,
          govBrVerified: true,
          govBrProtocol: "ITI-R6-LEGACY-VALID",
        });

        // Parte B: Fluxo completo HTTP/API + S3 sintético sobre o banco principal do teste após aplicar exatamente a mesma SQL de backfill
        process.env.S3_ENDPOINT = `http://127.0.0.1:${s3Addr.port}`;
        process.env.S3_BUCKET = "syn-bucket";
        process.env.S3_ACCESS_KEY_ID = "syn-key";
        process.env.S3_SECRET_ACCESS_KEY = "syn-secret";
        process.env.S3_REGION = "auto";

        const minDbRow = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: SCHOOL_1_ID,
            year: 2026,
            status: "DRAFT",
            contentRevision: 2,
            category: "BUSCA_ATIVA_FALTAS",
            subject: "Ata Backfill DB Fluxo R8",
            summary: "Ata reaberta na R6 com arquivo no banco.",
            authorId: PED1_ID,
            authorName: "Pedagoga Autora R8",
            authorEmail: "ped1.r8@example.invalid",
            authorRole: "PEDAGOGA",
            hasPhysicalScan: true,
            physicalSignedScanData: r6DbPdf.dataUrl,
            physicalScanProvider: "DATABASE",
            physicalScanMimeType: "application/pdf",
            physicalScanSizeBytes: r6DbPdf.bytes.length,
            physicalScanSha256: r6DbPdf.sha256,
            physicalScanUploadedAt: new Date("2026-11-21T10:00:00Z"),
            physicalScanUploadedBy: "Pedagoga Autora R8",
            physicalScanRevision: 1,
            physicalScanSupersededAt: new Date("2026-11-22T10:00:00Z"),
            govBrVerified: true,
            govBrProtocol: "ITI-R6-DB-OLD",
            students: { create: [{ studentId: STU_1A_ID, studentNameSnapshot: "Lucas Pereira" }] },
          },
        });

        const minS3Row = await prisma.pedagogicalMinute.create({
          data: {
            schoolId: SCHOOL_1_ID,
            year: 2026,
            status: "DRAFT",
            contentRevision: 2,
            category: "BUSCA_ATIVA_FALTAS",
            subject: "Ata Backfill S3 Fluxo R8",
            summary: "Ata reaberta na R6 com referência no Object Storage S3.",
            authorId: PED1_ID,
            authorName: "Pedagoga Autora R8",
            authorEmail: "ped1.r8@example.invalid",
            authorRole: "PEDAGOGA",
            hasPhysicalScan: true,
            physicalSignedScanData: null,
            physicalScanStorageKey: "atas/syn-school-r8-1/2026/min-r6-s3.pdf",
            physicalScanProvider: "S3",
            physicalScanMimeType: "application/pdf",
            physicalScanSizeBytes: r6S3Pdf.bytes.length,
            physicalScanSha256: r6S3Pdf.sha256,
            physicalScanUploadedAt: new Date("2026-11-21T11:00:00Z"),
            physicalScanUploadedBy: "Pedagoga Autora R8",
            physicalScanRevision: 1,
            physicalScanSupersededAt: new Date("2026-11-22T11:00:00Z"),
            govBrVerified: true,
            govBrProtocol: "ITI-R6-S3-OLD",
            students: { create: [{ studentId: STU_1A_ID, studentNameSnapshot: "Lucas Pereira" }] },
          },
        });

        const legacyFinalCode = `R8LEG-${Date.now()}`;
        await prisma.pedagogicalMinute.create({
          data: {
            schoolId: SCHOOL_1_ID,
            year: 2026,
            ataNumber: 902,
            status: "FINALIZED",
            contentRevision: 1,
            physicalScanRevision: null,
            physicalScanSupersededAt: null,
            hasPhysicalScan: true,
            physicalSignedScanData: r6LegacyPdf.dataUrl,
            physicalScanProvider: "DATABASE",
            physicalScanMimeType: "application/pdf",
            physicalScanSizeBytes: r6LegacyPdf.bytes.length,
            physicalScanSha256: r6LegacyPdf.sha256,
            govBrVerified: true,
            govBrProtocol: "ITI-R6-LEGACY-VALID",
            verificationCode: legacyFinalCode,
            finalizedAt: new Date("2026-10-10T10:00:00Z"),
            attendedAt: new Date("2026-10-10T10:00:00Z"),
            subject: "Ata Pré-Versionamento R6",
            summary: "Lavrada antes de existir controle de revisão.",
            authorId: PED1_ID,
            authorName: "Pedagoga Autora R8",
            authorEmail: "ped1.r8@example.invalid",
            authorRole: "PEDAGOGA",
            students: { create: [{ studentId: STU_1A_ID, studentNameSnapshot: "Lucas Pereira" }] },
          },
        });

        // Aplica SQL exata do backfill da Rodada 8 duas vezes neste banco para validar idempotência também no fluxo HTTP
        execFileSync(
          "npx",
          ["prisma", "db", "execute", "--file", r8MigFilePath, "--schema", fullSchemaPath],
          {
            cwd: rootDir,
            env: { ...process.env },
            stdio: "pipe",
          }
        );
        execFileSync(
          "npx",
          ["prisma", "db", "execute", "--file", r8MigFilePath, "--schema", fullSchemaPath],
          {
            cwd: rootDir,
            env: { ...process.env },
            stdio: "pipe",
          }
        );

        // Regra restritiva sobre registros backfilled sem origem comprovada: PED1 (mesmo autora da ata) -> 403 e histórico omitido
        setSessionActor({
          id: PED1_ID,
          email: "ped1.r8@example.invalid",
          name: "Pedagoga Autora R8",
          role: "PEDAGOGA",
          schoolId: SCHOOL_1_ID,
        });
        expect(
          (
            await physicalScanGet(
              new Request(`http://localhost:3000/api/atas/${minS3Row.id}/physical-scan?historyId=r6-backfill-${minS3Row.id}`),
              { params: Promise.resolve({ id: minS3Row.id }) }
            )
          ).status
        ).toBe(403);

        // Diretora acessa os históricos restaurados (tanto do DB quanto do S3)
        setSessionActor({
          id: GESTOR1_ID,
          email: "gestor1.r8@example.invalid",
          name: "Diretor Um R8",
          role: "GESTOR_ESCOLAR",
          schoolId: SCHOOL_1_ID,
        });

        const s3OrigRes = await physicalScanGet(
          new Request(`http://localhost:3000/api/atas/${minS3Row.id}/physical-scan?historyId=r6-backfill-${minS3Row.id}`),
          { params: Promise.resolve({ id: minS3Row.id }) }
        );
        expect(s3OrigRes.status).toBe(200);
        expect(s3OrigRes.headers.get("X-Scan-SHA256")).toBe(r6S3Pdf.sha256);
        expect(s3OrigRes.headers.get("X-Scan-Integrity-Verified")).toBe("true");
        expect(Buffer.from(await s3OrigRes.arrayBuffer()).toString("latin1")).toContain("R6-SUPERSEDED-S3-OBJECT");

        // Anexa nova prova física SEM Gov.br na rev 2 da ata DB (com DATABASE temporariamente desativado para DB fallback) e COM novo Gov.br na ata S3
        delete process.env.S3_BUCKET;
        const postNewDb = await physicalScanPost(
          new Request(`http://localhost:3000/api/atas/${minDbRow.id}/physical-scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 2,
              scanData: r8NewDbPdf.dataUrl,
              govBrVerified: false,
            }),
          }),
          { params: Promise.resolve({ id: minDbRow.id }) }
        );
        expect(postNewDb.status).toBe(200);

        process.env.S3_BUCKET = "syn-bucket";
        const postNewS3 = await physicalScanPost(
          new Request(`http://localhost:3000/api/atas/${minS3Row.id}/physical-scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 2,
              scanData: r8NewS3Pdf.dataUrl,
              govBrVerified: true,
              govBrProtocol: "ITI-R8-NEW-2",
            }),
          }),
          { params: Promise.resolve({ id: minS3Row.id }) }
        );
        expect(postNewS3.status).toBe(200);

        // Lavra ambas na revisão 2 com PIN
        const finDbRes = await finalizeMinutePost(
          new Request(`http://localhost:3000/api/atas/${minDbRow.id}/finalize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 2 }),
          }),
          { params: Promise.resolve({ id: minDbRow.id }) }
        );
        expect(finDbRes.status).toBe(200);
        const codeDb = (await finDbRes.json()).minute.verificationCode as string;

        const finS3Res = await finalizeMinutePost(
          new Request(`http://localhost:3000/api/atas/${minS3Row.id}/finalize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signingPin: VALID_PIN, expectedRevision: 2 }),
          }),
          { params: Promise.resolve({ id: minS3Row.id }) }
        );
        expect(finS3Res.status).toBe(200);
        const codeS3 = (await finS3Res.json()).minute.verificationCode as string;

        // Confirma que os dois originais da Rodada 6 seguem recuperáveis via histórico APÓS anexar nova prova e lavrar!
        const dbOrigAfter = await physicalScanGet(
          new Request(`http://localhost:3000/api/atas/${minDbRow.id}/physical-scan?historyId=r6-backfill-${minDbRow.id}`),
          { params: Promise.resolve({ id: minDbRow.id }) }
        );
        expect(dbOrigAfter.status).toBe(200);
        expect(Buffer.from(await dbOrigAfter.arrayBuffer()).toString("latin1")).toContain("R6-SUPERSEDED-DATABASE");

        const s3OrigAfter = await physicalScanGet(
          new Request(`http://localhost:3000/api/atas/${minS3Row.id}/physical-scan?historyId=r6-backfill-${minS3Row.id}`),
          { params: Promise.resolve({ id: minS3Row.id }) }
        );
        expect(s3OrigAfter.status).toBe(200);
        expect(Buffer.from(await s3OrigAfter.arrayBuffer()).toString("latin1")).toContain("R6-SUPERSEDED-S3-OBJECT");

        // Validação pública atribui selo Gov.br APENAS à prova vigente
        const pubDbJson = await (
          await publicVerifyGet(new Request(`http://localhost:3000/api/atas/public/${codeDb}`), {
            params: Promise.resolve({ code: codeDb }),
          })
        ).json();
        expect(pubDbJson.data.govBrVerified).toBe(false);
        expect(pubDbJson.data.govBrProtocol).toBeNull();
        const ssrDbHtml = renderToString(
          (await ValidarAtaPage({ params: Promise.resolve({ code: codeDb }) })) as React.ReactElement
        );
        expect(ssrDbHtml).not.toContain("Assinatura Gov.br verificada");
        expect(ssrDbHtml).not.toContain("ITI-R6-DB-OLD");

        const pubS3Json = await (
          await publicVerifyGet(new Request(`http://localhost:3000/api/atas/public/${codeS3}`), {
            params: Promise.resolve({ code: codeS3 }),
          })
        ).json();
        expect(pubS3Json.data.govBrVerified).toBe(true);
        expect(pubS3Json.data.govBrProtocol).toBe("ITI-R8-NEW-2");
        const ssrS3Html = renderToString(
          (await ValidarAtaPage({ params: Promise.resolve({ code: codeS3 }) })) as React.ReactElement
        );
        expect(ssrS3Html).toContain("ITI-R8-NEW-2");
        expect(ssrS3Html).not.toContain("ITI-R6-S3-OLD");

        const pubLegacyJson = await (
          await publicVerifyGet(new Request(`http://localhost:3000/api/atas/public/${legacyFinalCode}`), {
            params: Promise.resolve({ code: legacyFinalCode }),
          })
        ).json();
        expect(pubLegacyJson.data.govBrVerified).toBe(true);
        expect(pubLegacyJson.data.govBrProtocol).toBe("ITI-R6-LEGACY-VALID");
      } finally {
        await r6Client.$disconnect();
        await new Promise<void>((resolve) => s3Server.close(() => resolve()));
        fs.rmSync(tmpPrismaDir, { recursive: true, force: true });
        for (const [k, v] of Object.entries(prevS3Env)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }, 60000);

    it("3. Mascaramento preserva proteção do nome anterior e atual em assunto, resumo e combinados após renomeação de estudante", async () => {
      setSessionActor({
        id: PED1_ID,
        email: "ped1.r8@example.invalid",
        name: "Pedagoga Autora R8",
        role: "PEDAGOGA",
        schoolId: SCHOOL_1_ID,
      });

      const createRes = await createMinutePost(
        new Request("http://localhost:3000/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "CONVIVENCIA_INDISCIPLINA",
            subject: "Alinhamento conjunto de Lucas Pereira com Joao Marcos Silva",
            summary:
              "O atendimento registrou diálogo entre Lucas Pereira e Joao Marcos Silva. Durante o relato, Joao concordou em cumprir a rotina escolar.",
            agreementsSummary: "A família de Lucas Pereira e o estudante Joao acompanharão semanalmente.",
            studentIds: [STU_1A_ID, STU_1B_ID],
            participants: [
              {
                role: "ESTUDANTE",
                studentId: STU_1A_ID,
                name: "Lucas Pereira",
              },
              {
                role: "RESPONSAVEL",
                name: "Mãe do Lucas Pereira",
              },
            ],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const createdJson = await createRes.json();
      const minuteId = createdJson.minute.id as string;
      const partLucasEstudanteId = createdJson.minute.participants.find(
        (p: any) => p.role === "ESTUDANTE"
      ).id as string;
      const partResponsavelId = createdJson.minute.participants.find(
        (p: any) => p.role === "RESPONSAVEL"
      ).id as string;

      // Renomeia o outro estudante no cadastro após o texto original já citar seu nome antigo
      await prisma.student.update({
        where: { id: STU_1B_ID },
        data: { name: "Mateus Henrique Costa" },
      });

      try {
        // Nova revisão conferida via PATCH atualiza combinados preservando a grafia antiga já salva no assunto/resumo
        const patchRes = await patchMinuteById(
          new Request(`http://localhost:3000/api/atas/${minuteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: 1,
              subject: "Alinhamento conjunto de Lucas Pereira com Joao Marcos Silva",
              summary:
                "O atendimento registrou diálogo entre Lucas Pereira e Joao Marcos Silva. Durante o relato, Joao concordou em cumprir a rotina escolar.",
              agreementsSummary:
                "A família de Lucas Pereira acompanhará semanalmente; Joao e Mateus Henrique Costa farão devolutiva em sala.",
              studentIds: [STU_1A_ID, STU_1B_ID],
            }),
          }),
          { params: Promise.resolve({ id: minuteId }) }
        );
        expect(patchRes.status).toBe(200);
        const patchedJson = await patchRes.json();
        expect(patchedJson.minute.contentRevision).toBe(2);

        // Valida retenção mínima estritamente associada ao studentId no servidor (sem vazar ao payload da API)
        for (const s of patchedJson.minute.students) {
          expect(s).not.toHaveProperty("previousNameSnapshots");
        }
        const stuBLinkDb = await prisma.pedagogicalMinuteStudent.findUnique({
          where: { minuteId_studentId: { minuteId, studentId: STU_1B_ID } },
        });
        expect(stuBLinkDb?.studentNameSnapshot).toBe("Mateus Henrique Costa");
        expect(stuBLinkDb?.previousNameSnapshots).toEqual(["Joao Marcos Silva"]);
        const stuALinkDb = await prisma.pedagogicalMinuteStudent.findUnique({
          where: { minuteId_studentId: { minuteId, studentId: STU_1A_ID } },
        });
        expect(stuALinkDb?.previousNameSnapshots).toEqual([]);

        // Emite link móvel para o participante vinculado a Lucas Pereira (ESTUDANTE) na revisão 2
        const tokRes = await signTokenPost(
          new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ participantId: partLucasEstudanteId, expectedRevision: 2 }),
          }),
          { params: Promise.resolve({ id: minuteId }) }
        );
        expect(tokRes.status).toBe(200);
        const token = (await tokRes.json()).token as string;

        // API pública GET /api/atas/sign-token/[token]: protege as duas grafias em assunto, resumo e combinados; preserva Lucas Pereira
        const signGetRes = await publicSignGet(
          new Request(`http://localhost:3000/api/atas/sign-token/${token}`),
          { params: Promise.resolve({ token }) }
        );
        expect(signGetRes.status).toBe(200);
        const signPayload = (await signGetRes.json()).participant;

        expect(signPayload.subject).toContain("Lucas Pereira");
        expect(signPayload.subject).not.toMatch(/Jo[aã]o/i);
        expect(signPayload.subject).toContain("(outro estudante)");

        expect(signPayload.summary).toContain("Lucas Pereira");
        expect(signPayload.summary).not.toMatch(/Jo[aã]o/i);
        expect(signPayload.summary).toContain("(outro estudante)");

        expect(signPayload.agreementsSummary).toContain("Lucas Pereira");
        expect(signPayload.agreementsSummary).not.toMatch(/Jo[aã]o/i);
        expect(signPayload.agreementsSummary).not.toContain("Mateus");
        expect(signPayload.agreementsSummary).toContain("(outro estudante)");

        // SSR da página móvel /assinar/ata/[token]: também protege ambas as grafias e preserva dados autorizados
        const ssrHtml = renderToString(
          (await AssinarAtaPage({ params: Promise.resolve({ token }) })) as React.ReactElement
        ).replace(/<!-- -->/g, "");
        expect(ssrHtml).toContain("Lucas Pereira");
        expect(ssrHtml).not.toMatch(/Jo[aã]o\s+Marcos|Mateus\s+Henrique/i);
        expect(ssrHtml).not.toMatch(/(?<![\p{L}\p{N}])Jo[aã]o(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])Mateus(?![\p{L}\p{N}])/iu);
        expect(ssrHtml).toContain("(outro estudante)");
        expect(ssrHtml).not.toContain("previousNameSnapshots");

        // Emite link também para participante sem studentId (RESPONSAVEL): protege todos os menores (ambas as grafias de B e nome de A)
        const tokRespRes = await signTokenPost(
          new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ participantId: partResponsavelId, expectedRevision: 2 }),
          }),
          { params: Promise.resolve({ id: minuteId }) }
        );
        expect(tokRespRes.status).toBe(200);
        const tokenResp = (await tokRespRes.json()).token as string;
        const signRespPayload = (
          await (
            await publicSignGet(new Request(`http://localhost:3000/api/atas/sign-token/${tokenResp}`), {
              params: Promise.resolve({ token: tokenResp }),
            })
          ).json()
        ).participant;
        expect(signRespPayload.agreementsSummary).not.toContain("Lucas Pereira");
        expect(signRespPayload.agreementsSummary).not.toMatch(/Jo[aã]o/i);
        expect(signRespPayload.agreementsSummary).not.toContain("Mateus");
      } finally {
        await prisma.student.update({
          where: { id: STU_1B_ID },
          data: { name: "Joao Marcos Silva" },
        });
      }
    }, 30000);
  }
);
