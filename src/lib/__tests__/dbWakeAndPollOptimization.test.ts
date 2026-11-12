import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  auth: vi.fn(async () => null as any),
  requireAuth: vi.fn(async () => ({
    ok: true,
    userId: "user-1",
    userName: "Pedagoga Teste",
    email: "pedagoga@escola.pr.gov.br",
    role: "PEDAGOGA",
    schoolId: "school-1",
    session: { user: { id: "user-1", email: "pedagoga@escola.pr.gov.br", role: "PEDAGOGA", schoolId: "school-1" } },
  })),
  getCurrentSchool: vi.fn(async (schoolId?: string | null) => ({
    id: schoolId || "school-1",
    inepCode: "99990001",
    name: "Escola Teste",
    city: "Ponta Grossa",
    state: "PR",
    nre: "Ponta Grossa",
    network: "ESTADUAL",
    edition: "INSTITUCIONAL_ESSENCIAL",
  })),
  minuteFindUnique: vi.fn(async () => null as any),
  schoolFindMany: vi.fn(async () => [] as any[]),
}));

vi.mock("@/lib/auth", () => ({
  auth: hoisted.auth,
}));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    ...actual,
    requireAuth: hoisted.requireAuth,
  };
});

vi.mock("@/lib/currentSchool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currentSchool")>("@/lib/currentSchool");
  return {
    ...actual,
    getCurrentSchool: hoisted.getCurrentSchool,
    getCachedDirectory: vi.fn(() => null),
    setCachedDirectory: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pedagogicalMinute: {
      findUnique: hoisted.minuteFindUnique,
      update: vi.fn(async () => ({})),
    },
    school: {
      findMany: hoisted.schoolFindMany,
    },
  },
}));

vi.mock("@/components/AppLayoutClient", () => ({
  default: ({ children }: any) => children,
}));
vi.mock("@/components/PwaRegister", () => ({
  default: () => null,
}));
vi.mock("@/components/ExtensionDiagnosticsPanel", () => ({
  default: () => null,
}));

import RootLayout from "@/app/layout";
import { GET as getAtaById } from "@/app/api/atas/[id]/route";

describe("Otimizações de Wake-up no RootLayout e Polling Enxuto de Atas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("RootLayout sem sessão", () => {
    it("não chama getCurrentSchool nem consulta escolas quando o visitante não está autenticado", async () => {
      hoisted.auth.mockResolvedValueOnce(null);

      await RootLayout({ children: null });

      expect(hoisted.getCurrentSchool).not.toHaveBeenCalled();
      expect(hoisted.schoolFindMany).not.toHaveBeenCalled();
    });

    it("chama getCurrentSchool com o schoolId da sessão quando o usuário está autenticado", async () => {
      hoisted.auth.mockResolvedValueOnce({
        user: {
          name: "Pedagoga Teste",
          email: "pedagoga@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "school-1",
          schools: [],
        },
      });

      await RootLayout({ children: null });

      expect(hoisted.getCurrentSchool).toHaveBeenCalledTimes(1);
      expect(hoisted.getCurrentSchool).toHaveBeenCalledWith("school-1");
    });
  });

  describe("GET /api/atas/[id]?poll=1", () => {
    it("seleciona apenas campos mínimos persistidos (sem binários ou tokens) e devolve estado reduzido", async () => {
      hoisted.minuteFindUnique.mockResolvedValueOnce({
        id: "ata-1",
        schoolId: "school-1",
        status: "DRAFT",
        isConfidential: false,
        authorEmail: "pedagoga@escola.pr.gov.br",
        participants: [
          {
            id: "part-1",
            role: "RESPONSAVEL",
            signatureMode: "MOBILE_QR",
            hasSignature: true,
            hasActiveSignLink: false,
            verifiedEmail: null,
            mobileSignExpiresAt: null,
          },
          {
            id: "part-2",
            role: "PROFESSOR",
            signatureMode: "ESCOLA_OAUTH",
            hasSignature: false,
            hasActiveSignLink: true,
            verifiedEmail: null,
            mobileSignExpiresAt: new Date(Date.now() - 60_000),
          },
        ],
      });

      const req = new Request("https://www.redeativa.app.br/api/atas/ata-1?poll=1");
      const res = await getAtaById(req, { params: Promise.resolve({ id: "ata-1" }) });
      expect(res.status).toBe(200);

      const queryArgs = (hoisted.minuteFindUnique as any).mock.calls[0][0];
      expect(queryArgs.include).toBeUndefined();
      expect(queryArgs.select.physicalSignedScanData).toBeUndefined();
      expect(queryArgs.select.school).toBeUndefined();
      expect(queryArgs.select.participants.select.signatureData).toBeUndefined();
      expect(queryArgs.select.participants.select.biometricStrokeData).toBeUndefined();
      expect(queryArgs.select.participants.select.mobileSignToken).toBeUndefined();
      expect(queryArgs.select.participants.select.hasSignature).toBe(true);

      const body = await res.json();
      expect(body.poll).toBe(true);
      expect(body.participants).toEqual([
        {
          participantId: "part-1",
          role: "RESPONSAVEL",
          signatureMode: "MOBILE_QR",
          hasSignature: true,
          hasActiveSignLink: false,
          institutionalVerificationComplete: false,
          linkExpired: false,
        },
        {
          participantId: "part-2",
          role: "PROFESSOR",
          signatureMode: "ESCOLA_OAUTH",
          hasSignature: false,
          hasActiveSignLink: true,
          institutionalVerificationComplete: false,
          linkExpired: true,
        },
      ]);
    });

    it("mantém bloqueio multi-tenant (403) e sigilo reforçado (403) no modo ?poll=1", async () => {
      hoisted.minuteFindUnique.mockResolvedValueOnce({
        id: "ata-outra-escola",
        schoolId: "school-outra",
        status: "DRAFT",
        isConfidential: false,
        authorEmail: "outra@escola.pr.gov.br",
        participants: [],
      });

      const reqCross = new Request("https://www.redeativa.app.br/api/atas/ata-outra-escola?poll=1");
      const resCross = await getAtaById(reqCross, {
        params: Promise.resolve({ id: "ata-outra-escola" }),
      });
      expect(resCross.status).toBe(403);

      hoisted.minuteFindUnique.mockResolvedValueOnce({
        id: "ata-sigilosa",
        schoolId: "school-1",
        status: "DRAFT",
        isConfidential: true,
        authorEmail: "diretora@escola.pr.gov.br",
        participants: [],
      });

      const reqConf = new Request("https://www.redeativa.app.br/api/atas/ata-sigilosa?poll=1");
      const resConf = await getAtaById(reqConf, {
        params: Promise.resolve({ id: "ata-sigilosa" }),
      });
      expect(resConf.status).toBe(403);
    });
  });
});
