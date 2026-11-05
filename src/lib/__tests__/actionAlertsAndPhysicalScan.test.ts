import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyActionItemCategory } from "@/lib/actionClassifier";
import { POST, DELETE } from "@/app/api/atas/[id]/physical-scan/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pedagogicalMinute: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pedagogicalActionItem: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async (schoolId?: string | null) => ({
    id: schoolId || "school-leopoldina",
    name: "Colégio Estadual Leopoldina B. Pedroso",
    inepCode: "41042730",
    nre: "Ponta Grossa",
    city: "Tibagi",
  })),
}));

describe("Arcabouço Jurídico: JUR-03 (Alertas de Prazos) & JUR-04 (Via Física / Gov.br)", () => {
  const mockedAuth = auth as unknown as { mockResolvedValueOnce: any };
  const mockedPrisma = prisma as unknown as {
    pedagogicalMinute: { findUnique: any; update: any };
    pedagogicalActionItem: { findMany: any };
  };
  const mockedLogAudit = logAudit as unknown as { mockResolvedValueOnce: any };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("JUR-03: Classificação Inteligente de Prazos & Encaminhamentos", () => {
    it("classifica entrega de laudos médicos e exames", () => {
      const c1 = classifyActionItemCategory("Apresentar laudo do neurologista até 20/11");
      expect(c1.category).toBe("LAUDO_MEDICO");
      expect(c1.label).toBe("Entrega de Laudo / Saúde");

      const c2 = classifyActionItemCategory("Trazer atestado médico comprobatório do período de ausência");
      expect(c2.category).toBe("LAUDO_MEDICO");

      const c3 = classifyActionItemCategory("Agendamento de avaliação no CAPS infantojuvenil");
      expect(c3.category).toBe("LAUDO_MEDICO");
    });

    it("classifica comparecimento e retornos da família", () => {
      const c1 = classifyActionItemCategory("Comparecimento da mãe para devolutiva pedagógica");
      expect(c1.category).toBe("RETORNO_FAMILIAR");
      expect(c1.label).toBe("Retorno da Família");

      const c2 = classifyActionItemCategory("Reunião com os responsáveis para alinhamento de rotina");
      expect(c2.category).toBe("RETORNO_FAMILIAR");
    });

    it("classifica acionamentos da Rede de Proteção (CRAS/CREAS/CT)", () => {
      const c1 = classifyActionItemCategory("Encaminhamento da situação de vulnerabilidade ao CRAS municipal");
      expect(c1.category).toBe("REDE_PROTECAO");
      expect(c1.label).toBe("Rede de Proteção / CRAS / CT");

      const c2 = classifyActionItemCategory("Comunicação formal ao Conselho Tutelar via ficha SERP");
      expect(c2.category).toBe("REDE_PROTECAO");
    });

    it("classifica combinados pedagógicos", () => {
      const c1 = classifyActionItemCategory("Participação no reforço escolar de matemática às terças-feiras");
      expect(c1.category).toBe("PEDAGOGICO");
      expect(c1.label).toBe("Acompanhamento Pedagógico");
    });

    it("utiliza fallback para combinados genéricos", () => {
      const c1 = classifyActionItemCategory("Organização pessoal do material didático");
      expect(c1.category).toBe("GERAL");
      expect(c1.label).toBe("Combinado Geral");
    });
  });

  describe("JUR-04: API de Captura de Via Física & Assinatura Gov.br", () => {
    const mockSession = {
      user: {
        id: "user-pedagoga-1",
        name: "Pedagoga Maria",
        email: "maria@escola.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "school-leopoldina",
      },
    };

    it("bloqueia requisição não autenticada com 401", async () => {
      mockedAuth.mockResolvedValueOnce(null as any);

      const req = new Request("http://localhost/api/atas/ata-1/physical-scan", {
        method: "POST",
        body: JSON.stringify({ scanData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..." }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "ata-1" }) });
      expect(res.status).toBe(401);
    });

    it("bloqueia com 403 tentativa de anexar via física em ata de outra escola (IDOR)", async () => {
      mockedAuth.mockResolvedValueOnce(mockSession as any);
      mockedPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "ata-outra-escola",
        schoolId: "escola-estrangeira-999",
        ataNumber: 15,
        year: 2026,
        subject: "Atendimento Confidencial",
        status: "FINALIZED",
      } as any);

      const req = new Request("http://localhost/api/atas/ata-outra-escola/physical-scan", {
        method: "POST",
        body: JSON.stringify({ scanData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..." }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "ata-outra-escola" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Acesso negado");
    });

    it("anexa com sucesso via física assinada e dados do Gov.br com auditoria", async () => {
      mockedAuth.mockResolvedValueOnce(mockSession as any);
      mockedPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "ata-1",
        schoolId: "school-leopoldina",
        ataNumber: 7,
        year: 2026,
        subject: "Atendimento Pais - Busca Ativa",
        status: "FINALIZED",
      } as any);

      mockedPrisma.pedagogicalMinute.update.mockResolvedValueOnce({
        id: "ata-1",
        physicalSignedScanData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
        physicalScanUploadedAt: new Date(),
        physicalScanUploadedBy: "Pedagoga Maria",
        govBrVerified: true,
        govBrProtocol: "ITI-2026-BR-9988",
      } as any);

      const req = new Request("http://localhost/api/atas/ata-1/physical-scan", {
        method: "POST",
        body: JSON.stringify({
          scanData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
          govBrVerified: true,
          govBrProtocol: "ITI-2026-BR-9988",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "ata-1" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.minute.govBrVerified).toBe(true);
      expect(json.minute.govBrProtocol).toBe("ITI-2026-BR-9988");

      expect(mockedLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ATTACH_PHYSICAL_SCAN",
          schoolId: "school-leopoldina",
          entityType: "PedagogicalMinute",
          entityId: "ata-1",
        })
      );
    });

    it("remove via física com sucesso via DELETE e audita ação", async () => {
      mockedAuth.mockResolvedValueOnce(mockSession as any);
      mockedPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
        id: "ata-1",
        schoolId: "school-leopoldina",
        ataNumber: 7,
        year: 2026,
        subject: "Atendimento Pais - Busca Ativa",
      } as any);

      mockedPrisma.pedagogicalMinute.update.mockResolvedValueOnce({
        id: "ata-1",
        physicalSignedScanData: null,
      } as any);

      const req = new Request("http://localhost/api/atas/ata-1/physical-scan", {
        method: "DELETE",
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: "ata-1" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      expect(mockedLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "REMOVE_PHYSICAL_SCAN",
          schoolId: "school-leopoldina",
        })
      );
    });
  });
});
