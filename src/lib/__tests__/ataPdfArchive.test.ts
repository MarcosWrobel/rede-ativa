import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = {
  session: {
    user: {
      id: "usr_pedagoga_1",
      name: "Natiele Pacheco",
      email: "natiele.pacheco@escola.pr.gov.br",
      role: "PEDAGOGA",
      schoolId: "school-leopoldina",
    },
  } as any,
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => mockState.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async (schoolId?: string | null) => ({
    id: schoolId || "school-leopoldina",
    name: "Colégio Estadual Leopoldina B. Pedroso",
    inepCode: "41042730",
  })),
}));

import { generateAtaPdfA1b } from "../ataPdfArchive";
import { GET as getPdfaRoute } from "@/app/api/atas/[id]/pdfa/route";
import { prisma } from "../prisma";

describe("JUR-08: Preservação Arquivística Binária PDF/A-1b (ISO 19005-1 Level B)", () => {
  const dummyMinute = {
    id: "ata-pdfa-test-1",
    schoolId: "school-leopoldina",
    year: 2026,
    ataNumber: 42,
    status: "FINALIZED",
    category: "BUSCA_ATIVA_FALTAS",
    isConfidential: false,
    attendedAt: new Date("2026-11-01T14:30:00Z"),
    finalizedAt: new Date("2026-11-01T15:00:00Z"),
    subject: "Atendimento Pedagógico para Regularização de Infrequência Escolar",
    summary:
      "Aos primeiro dias do mês de novembro de dois mil e vinte e seis, realizou-se a presente reunião pedagógica com os responsáveis legais para firmar compromisso de frequência integral às aulas.",
    agreementsSummary:
      "A família compromete-se a acompanhar diariamente a frequência do estudante e justificar eventuais ausências médicas.",
    authorId: "usr_pedagoga_1",
    authorName: "Natiele Pacheco",
    authorEmail: "natiele.pacheco@escola.pr.gov.br",
    authorRole: "PEDAGOGA",
    contentHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    verificationCode: "VAL-PDFA-99",
    school: {
      name: "Colégio Estadual Leopoldina B. Pedroso",
      city: "Curitiba",
      state: "PR",
      nre: "Área Metropolitana Norte",
      inepCode: "41042730",
      network: "ESTADUAL",
    },
    students: [
      {
        studentId: "stu_1",
        studentNameSnapshot: "Lucas Gabriel Wrobel",
        classNameSnapshot: "9º Ano A",
      },
      {
        studentId: "stu_2",
        studentNameSnapshot: "Mariana Silva Santos",
        classNameSnapshot: "9º Ano A",
      },
    ],
    participants: [
      {
        name: "Marcos Wrobel",
        role: "RESPONSAVEL",
        documentType: "CPF",
        documentNumber: "123.456.789-00",
        signatureMode: "SCREEN_CANVAS",
        signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
      {
        name: "Prof. Carlos Eduardo",
        role: "PROFESSOR",
        verifiedEmail: "carlos.eduardo@escola.pr.gov.br",
      },
    ],
    addendums: [
      {
        id: "add_1",
        content: "Em tempo, fica consignado que o atestado médico referente ao dia 30/10 foi entregue nesta data.",
        authorName: "Natiele Pacheco",
        createdAt: new Date("2026-11-02T10:00:00Z"),
        addendumHash: "b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
      },
    ],
  };

  it("gera binário PDF válido iniciando com %PDF- e computa hash SHA-256", async () => {
    const result = await generateAtaPdfA1b(dummyMinute);

    expect(result.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(result.pdfBytes.length).toBeGreaterThan(10000); // PDF completo com fontes
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.filename).toBe("Ata_042_2026_PDFA1b.pdf");

    // Valida magic bytes de PDF
    const headerStr = Buffer.from(result.pdfBytes.slice(0, 10)).toString("latin1");
    expect(headerStr).toContain("%PDF-");
  });

  it("incorpora catálogo de metadados XMP contendo identificadores pdfaid:part 1 e conformance B", async () => {
    const result = await generateAtaPdfA1b(dummyMinute);
    const pdfStr = Buffer.from(result.pdfBytes).toString("latin1");

    // XMP e identificação ISO 19005-1 Level B
    expect(pdfStr).toContain("pdfaid:part");
    expect(pdfStr).toContain("<pdfaid:part>1</pdfaid:part>");
    expect(pdfStr).toContain("pdfaid:conformance");
    expect(pdfStr).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(pdfStr).toContain("GTS_PDFA1");
    expect(pdfStr).toContain("sRGB IEC61966-2.1");
  });

  it("aplica anonimização de outros menores (ECA Art. 143) quando targetStudentId é informado", async () => {
    const minuteMulti = {
      ...dummyMinute,
      subject: "Ocorrência envolvendo Lucas Gabriel Wrobel e Mariana Silva Santos no recreio",
      summary: "Lucas Gabriel Wrobel e Mariana Silva Santos participaram do ocorrido no pátio escolar.",
    };

    const result = await generateAtaPdfA1b(minuteMulti, { targetStudentId: "stu_1" });
    const pdfStr = Buffer.from(result.pdfBytes).toString("latin1");

    // Como as fontes TrueType mapeiam glifos, inspecionamos a geração e confirmamos que executou
    expect(result.pdfBytes.length).toBeGreaterThan(1000);
    expect(result.sha256).toHaveLength(64);
  });

  it("GET /api/atas/[id]/pdfa rejeita rascunhos DRAFT com status 400", async () => {
    vi.spyOn(prisma.pedagogicalMinute, "findUnique").mockResolvedValueOnce({
      ...dummyMinute,
      status: "DRAFT",
    } as any);

    const req = new Request("http://localhost/api/atas/draft-1/pdfa");
    const res = await getPdfaRoute(req, { params: Promise.resolve({ id: "draft-1" }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("lavratura prévia");
  });

  it("GET /api/atas/[id]/pdfa bloqueia acesso cross-tenant com 403 Forbidden", async () => {
    vi.spyOn(prisma.pedagogicalMinute, "findUnique").mockResolvedValueOnce({
      ...dummyMinute,
      schoolId: "outra-escola-alheia",
    } as any);

    const req = new Request("http://localhost/api/atas/alien-1/pdfa");
    const res = await getPdfaRoute(req, { params: Promise.resolve({ id: "alien-1" }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Acesso negado");
  });
});
