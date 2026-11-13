import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

const { mockPrisma, mockAuthState } = vi.hoisted(() => {
  const mockAuthState = {
    ok: true,
    schoolId: "school-a",
    role: "PEDAGOGA",
    session: {
      user: {
        id: "user-1",
        email: "pedagoga@escola.pr.gov.br",
        name: "Pedagoga Ana",
        role: "PEDAGOGA",
        schoolId: "school-a",
      },
    },
  };

  const mockPrisma = {
    pedagogicalMinute: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pedagogicalMinuteParticipant: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
    },
    pedagogicalMinuteStudent: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    pedagogicalActionItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    student: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
  };

  return { mockPrisma, mockAuthState };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => mockAuthState),
}));
vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async (id?: string) => ({
    id: id || "school-a",
    name: "Escola Estadual Teste",
    inepCode: "00000001",
  })),
}));
vi.mock("@/lib/tenantGuard", () => ({
  assertTenantOwnership: vi.fn((resourceSchoolId: string, activeSchoolId: string) => resourceSchoolId === activeSchoolId),
}));
vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true })),
  getPublicIpRateLimitKey: vi.fn(() => "ip-test"),
  RATE_LIMIT_POLICIES: { SIGN_TOKEN_ACCESS: { max: 30, windowMs: 60_000 } },
}));
vi.mock("@/lib/audit", () => ({
  extractClientIp: vi.fn(() => "127.0.0.1"),
  logAudit: vi.fn(async () => {}),
}));
vi.mock("@/lib/escolaGoogleVerify", () => ({
  verifyEscolaGoogleIdToken: vi.fn(),
  verifyParticipantIdentityMatch: vi.fn(),
}));

import AtaEditorModal from "@/components/ata/AtaEditorModal";
import { getParticipantSignatureSummary } from "@/components/ata/editor/signatureState";
import { formatSignLinkValidity } from "@/components/ata/editor/signLinkValidity";
import { mergeParticipantSignatures } from "@/services/ataParticipantService";
import { isSignTokenExpired } from "@/lib/signTokenExpiry";
import {
  GET as getMinuteHandler,
  PATCH as patchMinuteHandler,
} from "@/app/api/atas/[id]/route";
import {
  POST as createSignTokenHandler,
  DELETE as deleteSignTokenHandler,
} from "@/app/api/atas/[id]/sign-token/route";
import {
  GET as getPublicSignTokenHandler,
  POST as postPublicSignTokenHandler,
} from "@/app/api/atas/sign-token/[token]/route";

describe("Reabertura de assinatura desenhada, validade de token QR e proteção contra concorrência", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.ok = true;
    mockAuthState.schoolId = "school-a";
    mockAuthState.role = "PEDAGOGA";
    mockAuthState.session.user.schoolId = "school-a";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("1 & 2. Critério centralizado e renderização ao reabrir sem salvar", () => {
    it("getParticipantSignatureSummary distingue assinatura persistida, verificação institucional, recusa e imagem renderizável", () => {
      const mobileNoImage = getParticipantSignatureSummary({
        signatureMode: "MOBILE_QR",
        signatureData: undefined,
        verifiedEmail: null,
        hasSignature: true,
      });
      expect(mobileNoImage).toEqual({
        isRefused: false,
        isInstitutionalVerified: false,
        hasRenderableImage: false,
        hasPersistedSignature: true,
      });

      const escolaOk = getParticipantSignatureSummary({
        signatureMode: "ESCOLA_OAUTH",
        signatureData: null,
        verifiedEmail: "docente@escola.pr.gov.br",
        hasSignature: true,
      });
      expect(escolaOk).toEqual({
        isRefused: false,
        isInstitutionalVerified: true,
        hasRenderableImage: false,
        hasPersistedSignature: true,
      });

      const escolaIncomplete = getParticipantSignatureSummary({
        signatureMode: "ESCOLA_OAUTH",
        signatureData: null,
        verifiedEmail: "docente@escola.pr.gov.br",
        hasSignature: false,
      });
      expect(escolaIncomplete.hasPersistedSignature).toBe(false);

      const refused = getParticipantSignatureSummary({
        signatureMode: "REFUSED",
        signatureData: "data:image/png;base64,abc",
        verifiedEmail: null,
        hasSignature: true,
      });
      expect(refused).toEqual({
        isRefused: true,
        isInstitutionalVerified: false,
        hasRenderableImage: false,
        hasPersistedSignature: false,
      });
    });

    it("AtaEditorModal renderiza em SSR sem erro quando recebe existingMinute sem signatureData", () => {
      const html = renderToString(
        <AtaEditorModal
          isOpen={true}
          onClose={() => {}}
          availableStudents={[]}
          onSaved={() => {}}
          existingMinute={{
            id: "min-1",
            category: "ACOMPANHAMENTO_PEDAGOGICO",
            status: "FINALIZED",
            verificationCode: "ATA-2026-0001",
            subject: "Reunião de Acompanhamento",
            rawNotes: "Notas",
            summary: "Resumo formal da ata pedagógica.",
            attendedAt: new Date().toISOString(),
            students: [{ studentId: "stu-1", studentNameSnapshot: "Aluno Teste" }],
            participants: [
              {
                id: "part-mobile",
                role: "RESPONSAVEL",
                name: "Mãe do Aluno",
                signatureMode: "MOBILE_QR",
                signatureData: undefined,
                hasSignature: true,
              },
              {
                id: "part-oauth",
                role: "PROFESSOR",
                name: "Prof. Carlos",
                signatureMode: "ESCOLA_OAUTH",
                signatureData: null,
                verifiedEmail: "carlos@escola.pr.gov.br",
                hasSignature: true,
              },
            ],
          }}
        />
      );

      expect(html).toContain("<dialog");
    });
  });

  describe("3 & 5. Payload local antigo e salvamento durante validade", () => {
    it("mergeParticipantSignatures preserva assinatura remota desenhada e token ativo quando payload local vem desatualizado", () => {
      const futureExpiry = new Date("2026-11-12T15:00:00.000Z");
      const merged = mergeParticipantSignatures(
        [
          {
            id: "part-signed",
            role: "RESPONSAVEL",
            name: "Responsável Assinou",
            signatureMode: "PENDING",
            signatureData: null,
          },
          {
            id: "part-waiting",
            role: "RESPONSAVEL",
            name: "Responsável Aguardando",
            signatureMode: "PENDING",
            signatureData: null,
          },
        ],
        [
          {
            id: "part-signed",
            role: "RESPONSAVEL",
            name: "Responsável Assinou",
            signatureMode: "MOBILE_QR",
            signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
            signedAt: new Date("2026-11-12T14:42:00.000Z"),
          },
          {
            id: "part-waiting",
            role: "RESPONSAVEL",
            name: "Responsável Aguardando",
            signatureMode: "PENDING",
            signatureData: null,
            mobileSignToken: "tok-ativo-123",
            mobileSignExpiresAt: futureExpiry,
          },
        ],
        { clearMobileTokens: false, minuteId: "min-1" }
      );

      expect(merged[0].signatureMode).toBe("MOBILE_QR");
      expect(merged[0].signatureData).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
      expect(merged[0].hasSignature).toBe(true);

      expect(merged[1].mobileSignToken).toBe("tok-ativo-123");
      expect(merged[1].mobileSignExpiresAt).toEqual(futureExpiry);
      expect(merged[1].hasActiveSignLink).toBe(true);
    });

    it("PATCH /api/atas/[id] durante validade preserva token ativo no banco", async () => {
      const futureExpiry = new Date("2026-11-12T15:00:00.000Z");
      const existingParticipants = [
        {
          id: "part-1",
          role: "RESPONSAVEL",
          name: "Mãe",
          signatureMode: "PENDING",
          signatureData: null,
          mobileSignToken: "tok-keep",
          mobileSignExpiresAt: futureExpiry,
        },
      ];
      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValue({
        id: "min-1",
        schoolId: "school-a",
        status: "DRAFT",
        students: [{ studentId: "stu-1" }],
        participants: existingParticipants,
        actionItems: [],
      });
      mockPrisma.pedagogicalMinuteParticipant.findMany.mockResolvedValue(existingParticipants);
      mockPrisma.student.findMany.mockResolvedValue([
        { id: "stu-1", name: "Aluno", cgm: "123", classGroup: { name: "9A" } },
      ]);
      mockPrisma.pedagogicalMinute.update.mockResolvedValue({
        id: "min-1",
        participants: [],
        students: [],
        actionItems: [],
      });

      const req = new Request("http://localhost:3001/api/atas/min-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Assunto atualizado",
          studentIds: ["stu-1"],
          participants: [
            {
              id: "part-1",
              role: "RESPONSAVEL",
              name: "Mãe",
              signatureMode: "PENDING",
              signatureData: null,
            },
          ],
        }),
      });

      const res = await patchMinuteHandler(req, { params: Promise.resolve({ id: "min-1" }) });
      expect(res.status).toBe(200);
      expect(mockPrisma.pedagogicalMinuteParticipant.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              id: "part-1",
              mobileSignToken: "tok-keep",
              mobileSignExpiresAt: futureExpiry,
              hasActiveSignLink: true,
            }),
          ],
        })
      );
    });
  });

  describe("4. Validade de 20 minutos, fronteira exata e renovação para 24h (relógio controlado)", () => {
    it("isSignTokenExpired aplica fronteira única (>=)", () => {
      const exp = new Date("2026-11-12T15:00:00.000Z");
      expect(isSignTokenExpired(exp, exp.getTime() - 1)).toBe(false);
      expect(isSignTokenExpired(exp, exp.getTime())).toBe(true);
      expect(isSignTokenExpired(exp, exp.getTime() + 1)).toBe(true);
    });

    it("cenários independentes de 20m (antes, no vencimento, após) e renovação para 24h", async () => {
      vi.useFakeTimers();
      const t0 = new Date("2026-11-12T14:00:00.000Z");
      vi.setSystemTime(t0);

      let storedToken = null as string | null;
      let storedExpiry = null as Date | null;
      let storedSignatureData = null as string | null;
      let storedSignedAt = null as Date | null;

      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValue({
        id: "min-1",
        status: "DRAFT",
        schoolId: "school-a",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
      });
      const buildStoredParticipant = () => ({
        id: "part-1",
        minuteId: "min-1",
        name: "Mãe",
        role: "RESPONSAVEL",
        studentId: null,
        expectedEmail: null,
        signatureData: storedSignatureData,
        signedAt: storedSignedAt,
        hasSignature: Boolean(storedSignatureData),
        verifiedEmail: null,
        mobileSignToken: storedToken,
        mobileSignExpiresAt: storedExpiry,
        minute: {
          id: "min-1",
          status: "DRAFT",
          subject: "Atendimento",
          summary: "Resumo",
          agreementsSummary: null,
          attendedAt: t0,
          school: { name: "Escola Teste" },
          students: [],
        },
      });
      mockPrisma.pedagogicalMinuteParticipant.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.mobileSignToken !== undefined && where.mobileSignToken !== storedToken) {
          return null;
        }
        return buildStoredParticipant();
      });
      mockPrisma.pedagogicalMinuteParticipant.update.mockImplementation(async ({ data }: any) => {
        if (data.mobileSignToken !== undefined) storedToken = data.mobileSignToken;
        if (data.mobileSignExpiresAt !== undefined) storedExpiry = data.mobileSignExpiresAt;
        if (data.signatureData !== undefined) storedSignatureData = data.signatureData;
        if (data.signedAt !== undefined) storedSignedAt = data.signedAt;
        return { id: "part-1", name: "Mãe", ...data };
      });
      mockPrisma.pedagogicalMinuteParticipant.findUnique.mockImplementation(async ({ where }: any) => {
        if (!storedToken || where.mobileSignToken !== storedToken) return null;
        return buildStoredParticipant();
      });
      mockPrisma.pedagogicalMinuteParticipant.updateMany.mockImplementation(async ({ where, data }: any) => {
        if (where.mobileSignToken !== storedToken || storedSignedAt !== null) {
          return { count: 0 };
        }
        storedToken = data.mobileSignToken;
        storedExpiry = data.mobileSignExpiresAt;
        storedSignatureData = data.signatureData;
        storedSignedAt = data.signedAt;
        return { count: 1 };
      });

      // 1) Gera link de 20 minutos
      const createRes = await createSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-1/sign-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-1", expiresInMinutes: 20 }),
        }),
        { params: Promise.resolve({ id: "min-1" }) }
      );
      const createJson = await createRes.json();
      expect(createRes.status).toBe(200);
      expect(createJson.expiresInMinutes).toBe(20);
      const firstToken = createJson.token;
      expect(storedExpiry?.getTime()).toBe(t0.getTime() + 20 * 60_000);

      // 2) Consulta em t = +19m59s (antes do vencimento) -> 200 e ?poll=1 linkExpired: false
      vi.setSystemTime(new Date(t0.getTime() + 19 * 60_000 + 59_000));
      const getBeforeRes = await getPublicSignTokenHandler(
        new Request(`http://localhost:3001/api/atas/sign-token/${firstToken}`),
        { params: Promise.resolve({ token: firstToken }) }
      );
      expect(getBeforeRes.status).toBe(200);

      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "min-1",
        schoolId: "school-a",
        status: "DRAFT",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
        participants: [
          {
            id: "part-1",
            role: "RESPONSAVEL",
            signatureMode: "PENDING",
            hasSignature: false,
            hasActiveSignLink: true,
            verifiedEmail: null,
            mobileSignExpiresAt: storedExpiry,
          },
        ],
      });
      const pollBeforeRes = await getMinuteHandler(
        new Request("http://localhost:3001/api/atas/min-1?poll=1"),
        { params: Promise.resolve({ id: "min-1" }) }
      );
      const pollBeforeJson = await pollBeforeRes.json();
      expect(pollBeforeJson.participants[0].linkExpired).toBe(false);

      // 3) No instante exato do vencimento (t = +20m00s) -> 410 em GET e POST, e ?poll=1 linkExpired: true
      vi.setSystemTime(new Date(t0.getTime() + 20 * 60_000));
      const getExactRes = await getPublicSignTokenHandler(
        new Request(`http://localhost:3001/api/atas/sign-token/${firstToken}`),
        { params: Promise.resolve({ token: firstToken }) }
      );
      expect(getExactRes.status).toBe(410);

      const postExactRes = await postPublicSignTokenHandler(
        new Request(`http://localhost:3001/api/atas/sign-token/${firstToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAA" }),
        }),
        { params: Promise.resolve({ token: firstToken }) }
      );
      expect(postExactRes.status).toBe(410);

      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "min-1",
        schoolId: "school-a",
        status: "DRAFT",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
        participants: [
          {
            id: "part-1",
            role: "RESPONSAVEL",
            signatureMode: "PENDING",
            hasSignature: false,
            hasActiveSignLink: true,
            verifiedEmail: null,
            mobileSignExpiresAt: storedExpiry,
          },
        ],
      });
      const pollExactRes = await getMinuteHandler(
        new Request("http://localhost:3001/api/atas/min-1?poll=1"),
        { params: Promise.resolve({ id: "min-1" }) }
      );
      const pollExactJson = await pollExactRes.json();
      expect(pollExactJson.participants[0].linkExpired).toBe(true);

      // 4) Após vencer (t = +20m01s) -> 410
      vi.setSystemTime(new Date(t0.getTime() + 20 * 60_000 + 1_000));
      const postAfterRes = await postPublicSignTokenHandler(
        new Request(`http://localhost:3001/api/atas/sign-token/${firstToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAA" }),
        }),
        { params: Promise.resolve({ token: firstToken }) }
      );
      expect(postAfterRes.status).toBe(410);

      // 5) Renovação para 24h (1440 min) invalida o primeiro token (404) e o novo token assina antes das 24h
      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValue({
        id: "min-1",
        status: "DRAFT",
        schoolId: "school-a",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
      });
      const renewRes = await createSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-1/sign-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-1", expiresInMinutes: 1440 }),
        }),
        { params: Promise.resolve({ id: "min-1" }) }
      );
      const renewJson = await renewRes.json();
      expect(renewRes.status).toBe(200);
      expect(renewJson.expiresInMinutes).toBe(1440);
      const secondToken = renewJson.token;
      expect(secondToken).not.toBe(firstToken);

      const oldTokenRes = await getPublicSignTokenHandler(
        new Request(`http://localhost:3001/api/atas/sign-token/${firstToken}`),
        { params: Promise.resolve({ token: firstToken }) }
      );
      expect(oldTokenRes.status).toBe(404);

      // Em t0 + 23h59m, o novo token de 24h ainda assina normalmente
      vi.setSystemTime(new Date(t0.getTime() + 20 * 60_000 + 1_000 + 23 * 3600_000 + 59 * 60_000));
      const signRenewedRes = await postPublicSignTokenHandler(
        new Request(`http://localhost:3001/api/atas/sign-token/${secondToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAA" }),
        }),
        { params: Promise.resolve({ token: secondToken }) }
      );
      expect(signRenewedRes.status).toBe(200);
      expect(storedSignatureData).toBe("data:image/png;base64,AAAAAAAAAAAAAAAAAAAA");
    });
  });

  describe("6. Formatação de validade (mesmo dia, 24h com data+hora e fallback seguro)", () => {
    it("formata 20 minutos, 24 horas (data + horário) e retorna null para expiresAt ausente/inválido", () => {
      const base = new Date(2026, 10, 12, 14, 15, 0).getTime();
      const exp20 = new Date(base + 18 * 60_000).toISOString();
      const res20 = formatSignLinkValidity(exp20, base);
      expect(res20?.isLocallyElapsed).toBe(false);
      expect(res20?.label).toContain("14h33");
      expect(res20?.label).toContain("18 minutos restantes");

      const exp24h = new Date(base + 24 * 60 * 60_000 - 61_000).toISOString();
      const res24h = formatSignLinkValidity(exp24h, base);
      expect(res24h?.isLocallyElapsed).toBe(false);
      expect(res24h?.label).toContain("13/11 às 14h13");
      expect(res24h?.label).toContain("23h e 59min restantes");

      const elapsed = formatSignLinkValidity(exp20, base + 19 * 60_000);
      expect(elapsed?.isLocallyElapsed).toBe(true);
      expect(elapsed?.label).toContain("aguardando confirmação do servidor");

      expect(formatSignLinkValidity(null, base)).toBeNull();
      expect(formatSignLinkValidity(undefined, base)).toBeNull();
      expect(formatSignLinkValidity("data-invalida", base)).toBeNull();
    });
  });

  describe("7. Isolamento multi-tenant e sigilo preservados", () => {
    it("rejeita emissão de sign-token e leitura de ata de outra escola com 403", async () => {
      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValue({
        id: "min-other",
        status: "DRAFT",
        schoolId: "school-b",
        isConfidential: false,
        authorEmail: "outra@escola.pr.gov.br",
        participants: [],
      });

      const tokenRes = await createSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-other/sign-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-1", expiresInMinutes: 20 }),
        }),
        { params: Promise.resolve({ id: "min-other" }) }
      );
      expect(tokenRes.status).toBe(403);

      const getRes = await getMinuteHandler(
        new Request("http://localhost:3001/api/atas/min-other"),
        { params: Promise.resolve({ id: "min-other" }) }
      );
      expect(getRes.status).toBe(403);
    });
  });

  describe("8. Cancelamento direcionado de QR (DELETE) e concorrência transacional", () => {
    it("DELETE /api/atas/[id]/sign-token cancela link pendente sem apagar assinatura existente (409 se já assinado)", async () => {
      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValue({
        id: "min-1",
        status: "DRAFT",
        schoolId: "school-a",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
      });

      // Cenário 1: participante ainda sem assinatura -> cancela token e retorna 200
      mockPrisma.pedagogicalMinuteParticipant.findFirst.mockResolvedValueOnce({
        id: "part-1",
        minuteId: "min-1",
        name: "Responsável Teste",
        signatureData: null,
        signedAt: null,
        verifiedEmail: null,
        hasSignature: false,
        biometricVerified: false,
        mobileSignToken: "tok-active",
      });
      mockPrisma.pedagogicalMinuteParticipant.update.mockResolvedValueOnce({
        id: "part-1",
        mobileSignToken: null,
        hasActiveSignLink: false,
      });

      const cancelOkRes = await deleteSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-1/sign-token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-1" }),
        }),
        { params: Promise.resolve({ id: "min-1" }) }
      );
      expect(cancelOkRes.status).toBe(200);
      expect(mockPrisma.pedagogicalMinuteParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "part-1" },
          data: {
            mobileSignToken: null,
            mobileSignExpiresAt: null,
            hasActiveSignLink: false,
          },
        })
      );

      // Cenário 2: celular assinou milissegundos antes do DELETE -> retorna 409 e nunca limpa assinatura
      mockPrisma.pedagogicalMinuteParticipant.update.mockClear();
      mockPrisma.pedagogicalMinuteParticipant.findFirst.mockResolvedValueOnce({
        id: "part-1",
        minuteId: "min-1",
        name: "Responsável Teste",
        signatureData: "data:image/png;base64,MOBILE",
        signedAt: new Date(),
        verifiedEmail: null,
        hasSignature: true,
        biometricVerified: false,
        mobileSignToken: null,
      });

      const cancelConflictRes = await deleteSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-1/sign-token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-1" }),
        }),
        { params: Promise.resolve({ id: "min-1" }) }
      );
      expect(cancelConflictRes.status).toBe(409);
      expect(mockPrisma.pedagogicalMinuteParticipant.update).not.toHaveBeenCalled();

      // Cenário 3: bloqueia outra escola (403), ata sigilosa por outro servidor (403) e participante de outra ata/inexistente (404)
      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "min-other-school",
        status: "DRAFT",
        schoolId: "school-b",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
      });
      const otherSchoolDeleteRes = await deleteSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-other-school/sign-token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-1" }),
        }),
        { params: Promise.resolve({ id: "min-other-school" }) }
      );
      expect(otherSchoolDeleteRes.status).toBe(403);

      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "min-secret",
        status: "DRAFT",
        schoolId: "school-a",
        isConfidential: true,
        authorId: "user-2",
        authorEmail: "outra.autora@escola.pr.gov.br",
      });
      const secretDeleteRes = await deleteSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-secret/sign-token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-1" }),
        }),
        { params: Promise.resolve({ id: "min-secret" }) }
      );
      expect(secretDeleteRes.status).toBe(403);

      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "min-1",
        status: "DRAFT",
        schoolId: "school-a",
        isConfidential: false,
        authorId: "user-1",
        authorEmail: "pedagoga@escola.pr.gov.br",
      });
      mockPrisma.pedagogicalMinuteParticipant.findFirst.mockResolvedValueOnce(null);
      const foreignParticipantDeleteRes = await deleteSignTokenHandler(
        new Request("http://localhost:3001/api/atas/min-1/sign-token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "part-de-outra-ata" }),
        }),
        { params: Promise.resolve({ id: "min-1" }) }
      );
      expect(foreignParticipantDeleteRes.status).toBe(404);
    });

    it("POST /api/atas/sign-token/[token] revalida estado atual dentro do lock e rejeita token invalidado/assinado com 404/409", async () => {
      mockPrisma.pedagogicalMinuteParticipant.findUnique.mockResolvedValueOnce({
        id: "part-1",
        minuteId: "min-1",
        name: "Responsável",
        role: "RESPONSAVEL",
        signatureData: null,
        signedAt: null,
        hasSignature: false,
        verifiedEmail: null,
        mobileSignToken: "tok-race",
        mobileSignExpiresAt: new Date(Date.now() + 600_000),
        minute: { id: "min-1", status: "DRAFT" },
      });
      // Dentro do lock transacional, o token já havia sido cancelado por outro request
      mockPrisma.pedagogicalMinuteParticipant.findFirst.mockResolvedValueOnce(null);

      const raceRes = await postPublicSignTokenHandler(
        new Request("http://localhost:3001/api/atas/sign-token/tok-race", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAA" }),
        }),
        { params: Promise.resolve({ token: "tok-race" }) }
      );
      expect(raceRes.status).toBe(404);
    });

    it("PATCH /api/atas/[id] mantém ata FINALIZED imutável (403) e bloqueia alteração de identidade assinada (409)", async () => {
      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValue({
        id: "min-fin",
        status: "FINALIZED",
        schoolId: "school-a",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
        participants: [],
      });
      const finalizedRes = await patchMinuteHandler(
        new Request("http://localhost:3001/api/atas/min-fin", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: "Tentativa" }),
        }),
        { params: Promise.resolve({ id: "min-fin" }) }
      );
      expect(finalizedRes.status).toBe(403);

      const signedDraftParticipants = [
        {
          id: "part-signed",
          role: "RESPONSAVEL",
          name: "Ana Original",
          kinship: "Mãe",
          signatureData: "data:image/png;base64,SIGNED",
          hasSignature: true,
          signedAt: new Date(),
        },
      ];
      mockPrisma.pedagogicalMinute.findUnique.mockResolvedValue({
        id: "min-draft",
        status: "DRAFT",
        schoolId: "school-a",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
        participants: signedDraftParticipants,
      });
      mockPrisma.pedagogicalMinuteParticipant.findMany.mockResolvedValueOnce(signedDraftParticipants);
      const conflictRes = await patchMinuteHandler(
        new Request("http://localhost:3001/api/atas/min-draft", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: "Atendimento",
            summary: "Resumo válido com mais de dez caracteres.",
            participants: [
              {
                id: "part-signed",
                role: "RESPONSAVEL",
                name: "Pessoa Substituída",
                kinship: "Mãe",
              },
            ],
          }),
        }),
        { params: Promise.resolve({ id: "min-draft" }) }
      );
      expect(conflictRes.status).toBe(409);
    });
  });
});
