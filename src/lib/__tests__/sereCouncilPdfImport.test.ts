import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import {
  isValidPdfBuffer,
  mergeParsedSereCouncilReports,
  normalizeSereTruncatedDisciplineName,
  parseSereCouncilPdfBuffer,
  parseSereCouncilPdfText,
} from "@/lib/sereCouncilPdfParser";

/**
 * Gera um PDF sintético fiel ao layout posicional do
 * "RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL" do SERE (Sistema Escola - SEED-PR).
 */
function buildSyntheticSereCouncilPdf(opts: {
  course: string;
  grade: string;
  shift: string;
  classCode: string;
  year?: number;
  subjects: string[];
  rows: Array<{
    nro: number;
    nameLines: string[];
    grades: Array<[string, string, string]>; // [T1, T2, T3] por disciplina
  }>;
}): Uint8Array {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageHeight = doc.internal.pageSize.getHeight(); // ~595.28pt
  const yFromBottom = (pdfY: number) => pageHeight - pdfY;

  doc.setFontSize(8);
  doc.text("GOVERNO DO ESTADO DO PARANÁ", 28.3, yFromBottom(573.5));
  doc.text("DATA: 18/11/2026", 748, yFromBottom(573.5));
  doc.text("SECRETARIA DE ESTADO DA EDUCAÇÃO - SEED", 28.3, yFromBottom(562.5));
  doc.text("SISTEMA ESCOLA", 743.5, yFromBottom(562.5));
  doc.text("ESCOLA SINTÉTICA MODELO", 28.3, yFromBottom(539.5));
  doc.text(String(opts.year ?? 2026), 802, yFromBottom(539.5));

  doc.text(`Curso: ${opts.course}`, 28.3, yFromBottom(528.5));
  doc.text(`Seriação: ${opts.grade}`, 247.7, yFromBottom(528.5));
  doc.text(`Turno: ${opts.shift}`, 359.5, yFromBottom(528.5));
  doc.text(`Turma: ${opts.classCode}`, 783.5, yFromBottom(528.5));

  doc.setFontSize(10);
  doc.text("RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL", 318.3, yFromBottom(503));

  doc.setFontSize(7);
  doc.text("Disciplinas", 300, yFromBottom(475));
  doc.text("Nro.", 31.1, yFromBottom(453.5));
  doc.text("Nome", 48.4, yFromBottom(453.5));

  const firstT1X = 164.2;
  const tStep = 18.4;
  const subjectStep = 73.7;

  opts.subjects.forEach((subj, sIdx) => {
    const baseX = firstT1X + sIdx * subjectStep;
    doc.text(subj, baseX + 5, yFromBottom(458));
    doc.text("T1", baseX, yFromBottom(445));
    doc.text("T2", baseX + tStep, yFromBottom(445));
    doc.text("T3", baseX + tStep * 2, yFromBottom(445));
  });

  let currentY = 432;
  for (const row of opts.rows) {
    doc.text(String(row.nro), 31.4, yFromBottom(currentY));
    if (row.nameLines.length === 1) {
      doc.text(row.nameLines[0], 48.4, yFromBottom(currentY));
    } else {
      // Simula exatamente o comportamento do SERE: 1ª linha acima e 2ª linha abaixo do centro da linha
      doc.text(row.nameLines[0], 48.4, yFromBottom(currentY + 3.5));
      doc.text(row.nameLines[1], 48.4, yFromBottom(currentY - 3.5));
    }

    row.grades.forEach(([t1, t2, t3], sIdx) => {
      const baseX = firstT1X + sIdx * subjectStep;
      doc.text(t1, baseX - 2, yFromBottom(currentY));
      doc.text(t2, baseX + tStep - 2, yFromBottom(currentY));
      doc.text(t3, baseX + tStep * 2 - 2, yFromBottom(currentY));
      // 4ª coluna "--" (média final em aberto) — deve ser ignorada pelo parser
      doc.text("--", baseX + tStep * 3 + 1.4, yFromBottom(currentY));
    });

    currentY -= 20;
  }

  // Rodapé oficial do SERE que NÃO pode virar estudante
  doc.text("Total de registros abaixo da Média", 48.4, yFromBottom(currentY - 5));
  doc.text("10", firstT1X + tStep, yFromBottom(currentY - 5));
  doc.text("31", firstT1X + tStep * 2, yFromBottom(currentY - 5));

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}

describe("sereCouncilPdfParser — extração posicional e consolidação multi-PDF", () => {
  it("normaliza cabeçalhos truncados de 12 caracteres do SERE para português limpo", () => {
    expect(normalizeSereTruncatedDisciplineName("EDUCACAO FIS").name).toBe("Educação Física");
    expect(normalizeSereTruncatedDisciplineName("LINGUA PORTU").name).toBe("Língua Portuguesa");
    expect(normalizeSereTruncatedDisciplineName("EDUCACAO FIN").name).toBe("Educação Financeira");
    expect(normalizeSereTruncatedDisciplineName("PROJETO DE V").name).toBe("Projeto de Vida");
    expect(normalizeSereTruncatedDisciplineName("REC APREND L").name).toBe(
      "Recomposição da Aprendizagem - Língua Portuguesa"
    );
    expect(normalizeSereTruncatedDisciplineName("REC APREND M").name).toBe(
      "Recomposição da Aprendizagem - Matemática"
    );
    expect(normalizeSereTruncatedDisciplineName("LINGUA INGLE").name).toBe("Língua Inglesa");
    expect(normalizeSereTruncatedDisciplineName("GEOGRAFIA I").name).toBe("Geografia I");
    expect(normalizeSereTruncatedDisciplineName("ARTE II").name).toBe("Arte II");
    expect(normalizeSereTruncatedDisciplineName("MATEMATICA III").name).toBe("Matemática III");
    expect(normalizeSereTruncatedDisciplineName("QUIMICA III").name).toBe("Química III");
    expect(normalizeSereTruncatedDisciplineName("MATEMATICA I").name).toBe("Matemática I");
    expect(normalizeSereTruncatedDisciplineName("MATEMATICA II").name).toBe("Matemática II");
    expect(normalizeSereTruncatedDisciplineName("MATEMATICA APLICADA").name).toBe(
      "Matematica Aplicada"
    );
    expect(normalizeSereTruncatedDisciplineName("MATEMATICA APLICADA").name).not.toBe(
      "Matemática"
    );
  });

  it("valida magic bytes %PDF- rejeitando arquivos falsos", () => {
    const valid = new TextEncoder().encode("%PDF-1.4\n...");
    const fake = new TextEncoder().encode("<html>not a pdf</html>");
    expect(isValidPdfBuffer(valid)).toBe(true);
    expect(isValidPdfBuffer(fake)).toBe(false);
    expect(isValidPdfBuffer(new Uint8Array([]))).toBe(false);
  });

  it("extrai corretamente PDF único (Ensino Fundamental), nomes em 2 linhas, '--' e ignora rodapé", async () => {
    const pdfBytes = buildSyntheticSereCouncilPdf({
      course: "ENS FUND 6/9 ANO-SERIE",
      grade: "6º Ano",
      shift: "Manhã",
      classCode: "1",
      subjects: ["CIENCIAS", "EDUCACAO FIS", "LINGUA PORTU", "MATEMATICA"],
      rows: [
        {
          nro: 1,
          nameLines: ["ALUNO TESTE UM"],
          grades: [
            ["8.5", "7.0", "5.5"],
            ["10.0", "9.0", "8.0"],
            ["6.0", "5.8", "4.5"],
            ["7.2", "6.5", "3.0"],
          ],
        },
        {
          nro: 2,
          nameLines: ["MARIA CLARA APARECIDA", "DA SILVA SANTOS"],
          grades: [
            ["--", "--", "--"],
            ["--", "--", "--"],
            ["--", "--", "--"],
            ["--", "--", "--"],
          ],
        },
        {
          nro: 3,
          nameLines: ["JOAO PEDRO", "OLIVEIRA"],
          grades: [
            ["9.0", "8.5", "7.5"],
            ["8.0", "8.0", "9.0"],
            ["5.0", "6.2", "7.0"],
            ["4.5", "5.5", "6.0"],
          ],
        },
      ],
    });

    const parsed = await parseSereCouncilPdfBuffer(pdfBytes, "6_ano.pdf");

    expect(parsed.metadata.course).toBe("ENS FUND 6/9 ANO-SERIE");
    expect(parsed.metadata.grade).toBe("6º Ano");
    expect(parsed.metadata.shift).toBe("Manhã");
    expect(parsed.metadata.classCode).toBe("1");
    expect(parsed.metadata.year).toBe(2026);
    expect(parsed.metadata.reportDate).toBe("18/11/2026");

    expect(parsed.subjects.map((s) => s.name)).toEqual([
      "Ciências",
      "Educação Física",
      "Língua Portuguesa",
      "Matemática",
    ]);

    expect(parsed.students).toHaveLength(3);
    expect(parsed.students[0].rawName).toBe("ALUNO TESTE UM");
    expect(parsed.students[0].grades).toHaveLength(12);
    expect(parsed.students[0].grades.filter((g) => g.grade < 6.0)).toHaveLength(4);

    // Estudante com nome em 2 linhas e tudo "--"
    expect(parsed.students[1].rawName).toBe("MARIA CLARA APARECIDA DA SILVA SANTOS");
    expect(parsed.students[1].hasAnyGrade).toBe(false);
    expect(parsed.students[1].grades).toHaveLength(0);

    // Estudante #3 com nome em 2 linhas e notas
    expect(parsed.students[2].rawName).toBe("JOAO PEDRO OLIVEIRA");
    expect(parsed.students[2].grades).toHaveLength(12);

    // Aviso de estudante sem notas
    expect(parsed.warnings.some((w) => w.includes("sem notas lançadas"))).toBe(true);
  });

  it("consolida 2 PDFs da 3ª Série (FGB + Itinerário Formativo) em um único lote de disciplinas e notas", async () => {
    const pdfFgb = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["EDUCACAO FIS", "FISICA", "LINGUA PORTU", "MATEMATICA"],
      rows: [
        {
          nro: 1,
          nameLines: ["ESTUDANTE SINTETICO ALPHA"],
          grades: [
            ["8.3", "6.5", "3.0"],
            ["3.8", "0.3", "5.5"],
            ["6.6", "5.0", "1.0"],
            ["6.0", "6.0", "3.3"],
          ],
        },
      ],
    });

    const pdfIf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO IF LGG/CHS L INGL",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["EDUCACAO FIN", "PROJETO DE V", "ARTE II", "HISTORIA I", "SOCIOLOGIA I"],
      rows: [
        {
          nro: 1,
          nameLines: ["ESTUDANTE SINTETICO ALPHA"],
          grades: [
            ["6.0", "6.0", "1.8"],
            ["7.5", "6.0", "0.0"],
            ["8.0", "8.0", "3.0"],
            ["7.1", "5.0", "--"],
            ["6.9", "7.5", "0.0"],
          ],
        },
      ],
    });

    const r1 = await parseSereCouncilPdfBuffer(pdfFgb, "fgb.pdf");
    const r2 = await parseSereCouncilPdfBuffer(pdfIf, "if.pdf");
    const merged = mergeParsedSereCouncilReports([r1, r2]);

    expect(merged.files).toHaveLength(2);
    expect(merged.subjects).toHaveLength(9);
    expect(merged.students).toHaveLength(1);
    // 12 notas do FGB + 14 notas válidas do IF (1 é "--") = 26 notas
    expect(merged.totalGrades).toBe(26);
    expect(merged.warnings.filter((w) => w.includes("turmas diferentes"))).toHaveLength(0);
  });

  it("emite alerta quando 2 PDFs enviados juntos pertencem a turmas diferentes", async () => {
    const pdfA = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Manhã",
      classCode: "1",
      subjects: ["FISICA", "MATEMATICA"],
      rows: [{ nro: 1, nameLines: ["ALUNO A"], grades: [["7.0", "7.0", "7.0"], ["8.0", "8.0", "8.0"]] }],
    });
    const pdfB = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO IF",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["ARTE II", "HISTORIA I"],
      rows: [{ nro: 1, nameLines: ["ALUNO B"], grades: [["6.0", "6.0", "6.0"], ["5.0", "5.0", "5.0"]] }],
    });

    const merged = mergeParsedSereCouncilReports([
      await parseSereCouncilPdfBuffer(pdfA, "a.pdf"),
      await parseSereCouncilPdfBuffer(pdfB, "b.pdf"),
    ]);

    expect(merged.warnings.some((w) => w.includes("turmas diferentes"))).toBe(true);
  });

  it("suporta fallback textual puro via parseSereCouncilPdfText", () => {
    const text = [
      "DATA: 18/11/2026\n2026\nCurso: ENSINO MEDIO FGB Seriação: 3ª Série Turno: Noite Turma: 3\n" +
        "RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL\n" +
        "Nro. Nome  EDUCACAO FIS  MATEMATICA\n" +
        "T1 T2 T3 T1 T2 T3\n" +
        "1 ALUNO FALLBACK 8.0 5.5 7.0 -- 4.0 6.0 9.0 --\n" +
        "Total de registros abaixo da Média 1 1 0 1 0 0",
    ];
    const parsed = parseSereCouncilPdfText(text, "fallback.pdf");
    expect(parsed.subjects.map((s) => s.name)).toEqual(["Educação Física", "Matemática"]);
    expect(parsed.students).toHaveLength(1);
    expect(parsed.students[0].grades).toHaveLength(6);
  });

  it("detecta homônimo dentro do mesmo PDF antes de mesclar notas", () => {
    const parsedHomonym = parseSereCouncilPdfText(
      [
        [
          "Curso: ENSINO MEDIO FGB Seriação: 3ª Série Turno: Manhã Turma: 3",
          "2026",
          "Nro. Nome  MATEMATICA  LINGUA PORTU",
          "T1 T2 T3 T1 T2 T3",
          "1 JOAO SILVA 8.0 7.0 -- 6.5 7.0 --",
          "2 JOAO SILVA 4.0 5.0 -- 3.5 4.0 --",
          "3 MARIA SOUZA 9.0 8.5 -- 8.0 8.5 --",
        ].join("\n"),
      ],
      "homonimo.pdf"
    );

    const joao = parsedHomonym.students.find((s) => s.rawName === "JOAO SILVA");
    expect(joao).toBeDefined();
    expect(joao?.isAmbiguousInPdf).toBe(true);
    expect(joao?.grades).toHaveLength(0);
    expect(parsedHomonym.warnings.some((w) => w.includes("homônimo"))).toBe(true);

    const maria = parsedHomonym.students.find((s) => s.rawName === "MARIA SOUZA");
    expect(maria?.isAmbiguousInPdf).toBeUndefined();
    expect(maria?.grades).toHaveLength(4);
  });

  it("detecta homônimos entre páginas distintas em PDF binário real (jsPDF multipágina) e preserva mesclagem legítima", async () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageHeight = doc.internal.pageSize.getHeight();
    const yFromBottom = (pdfY: number) => pageHeight - pdfY;
    const firstT1X = 164.2;
    const tStep = 18.4;

    const drawPage = (
      subject: string,
      rows: Array<{ nro: number; name: string; grades: [string, string, string] }>
    ) => {
      doc.setFontSize(8);
      doc.text("GOVERNO DO ESTADO DO PARANÁ", 28.3, yFromBottom(573.5));
      doc.text("DATA: 18/11/2026", 748, yFromBottom(573.5));
      doc.text("2026", 802, yFromBottom(539.5));
      doc.text("Curso: ENSINO MEDIO FGB", 28.3, yFromBottom(528.5));
      doc.text("Seriação: 3ª Série", 247.7, yFromBottom(528.5));
      doc.text("Turno: Manhã", 359.5, yFromBottom(528.5));
      doc.text("Turma: 1", 783.5, yFromBottom(528.5));
      doc.setFontSize(10);
      doc.text("RELATÓRIO DE ACOMPANHAMENTO TRIMESTRAL", 318.3, yFromBottom(503));
      doc.setFontSize(7);
      doc.text("Disciplinas", 300, yFromBottom(475));
      doc.text("Nro.", 31.1, yFromBottom(453.5));
      doc.text("Nome", 48.4, yFromBottom(453.5));
      doc.text(subject, firstT1X + 5, yFromBottom(458));
      doc.text("T1", firstT1X, yFromBottom(445));
      doc.text("T2", firstT1X + tStep, yFromBottom(445));
      doc.text("T3", firstT1X + tStep * 2, yFromBottom(445));

      let currentY = 432;
      for (const row of rows) {
        doc.text(String(row.nro), 31.4, yFromBottom(currentY));
        doc.text(row.name, 48.4, yFromBottom(currentY));
        doc.text(row.grades[0], firstT1X - 2, yFromBottom(currentY));
        doc.text(row.grades[1], firstT1X + tStep - 2, yFromBottom(currentY));
        doc.text(row.grades[2], firstT1X + tStep * 2 - 2, yFromBottom(currentY));
        doc.text("--", firstT1X + tStep * 3 + 1.4, yFromBottom(currentY));
        currentY -= 20;
      }
    };

    drawPage("MATEMATICA", [
      { nro: 1, name: "CARLOS EDUARDO LIMA", grades: ["7.5", "8.0", "--"] },
      { nro: 3, name: "BEATRIZ MOURA", grades: ["8.5", "9.0", "--"] },
    ]);
    doc.addPage("a4", "landscape");
    drawPage("FISICA", [
      { nro: 2, name: "CARLOS EDUARDO LIMA", grades: ["4.0", "5.0", "--"] },
      { nro: 3, name: "BEATRIZ MOURA", grades: ["7.0", "8.2", "--"] },
    ]);

    const pdfBytes = new Uint8Array(doc.output("arraybuffer"));
    const parsed = await parseSereCouncilPdfBuffer(pdfBytes, "multipagina.pdf");
    const merged = mergeParsedSereCouncilReports([parsed]);

    const carlos = merged.students.find((s) => s.rawName === "CARLOS EDUARDO LIMA");
    expect(carlos).toBeDefined();
    expect(carlos?.isAmbiguousInPdf).toBe(true);
    expect(carlos?.grades).toHaveLength(0);
    expect(carlos?.hasAnyGrade).toBe(false);
    expect(merged.warnings.some((w) => w.includes("homônimo"))).toBe(true);

    const beatriz = merged.students.find((s) => s.rawName === "BEATRIZ MOURA");
    expect(beatriz).toBeDefined();
    expect(beatriz?.isAmbiguousInPdf).toBeUndefined();
    expect(beatriz?.grades).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Testes de Integração da Rota POST /api/conselho-classe/[boardId]/import-pdf
// ---------------------------------------------------------------------------

const {
  mockRequireAuth,
  mockGetCurrentSchool,
  mockAssertTenantOwnership,
  mockFindOwnership,
  mockGetBoardDetail,
  mockCanMutate,
  mockLogAudit,
  mockSubjectCreate,
  mockSubjectFindUnique,
  mockSubjectFindFirst,
  mockSubjectUpdate,
  mockEvalUpsert,
  mockCardUpdate,
  mockClassGroupUpdateMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetCurrentSchool: vi.fn(),
  mockAssertTenantOwnership: vi.fn(),
  mockFindOwnership: vi.fn(),
  mockGetBoardDetail: vi.fn(),
  mockCanMutate: vi.fn(),
  mockLogAudit: vi.fn(),
  mockSubjectCreate: vi.fn(),
  mockSubjectFindUnique: vi.fn(),
  mockSubjectFindFirst: vi.fn(),
  mockSubjectUpdate: vi.fn(),
  mockEvalUpsert: vi.fn(),
  mockCardUpdate: vi.fn(),
  mockClassGroupUpdateMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: mockGetCurrentSchool,
}));

vi.mock("@/lib/tenantGuard", () => ({
  assertTenantOwnership: mockAssertTenantOwnership,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mockLogAudit,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classCouncilSubject: {
      create: mockSubjectCreate,
      findUnique: mockSubjectFindUnique,
      findFirst: mockSubjectFindFirst,
      update: mockSubjectUpdate,
    },
    studentCouncilSubjectEntry: {
      upsert: mockEvalUpsert,
    },
    studentCouncilCard: {
      update: mockCardUpdate,
    },
    classGroup: {
      updateMany: mockClassGroupUpdateMany,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/services/classCouncilService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/classCouncilService")>();
  return {
    ...actual,
    findCouncilBoardOwnershipRecord: mockFindOwnership,
    getCouncilBoardDetail: mockGetBoardDetail,
    canMutateSchoolCouncil: mockCanMutate,
  };
});

import { POST as importPdfPost } from "@/app/api/conselho-classe/[boardId]/import-pdf/route";

function makePdfFormRequest(
  files: Array<{ name: string; bytes: Uint8Array }>,
  mode = "preview",
  updateClassShift = false
) {
  const fd = new FormData();
  fd.append("mode", mode);
  if (updateClassShift) {
    fd.append("updateClassShift", "true");
  }
  for (const f of files) {
    fd.append("files", new File([new Uint8Array(f.bytes)], f.name, { type: "application/pdf" }));
  }
  return new Request("http://localhost:3000/api/conselho-classe/board-1/import-pdf", {
    method: "POST",
    body: fd,
  });
}

describe("POST /api/conselho-classe/[boardId]/import-pdf — segurança, RBAC e merge não-destrutivo", () => {
  const baseBoard = {
    id: "board-1",
    schoolId: "school-a",
    classGroupId: "cg-1",
    year: 2026,
    classGroup: { id: "cg-1", name: "3ª Série 3", segment: "ENSINO_MEDIO", shift: "NOITE" },
    subjects: [
      {
        id: "sub-mat",
        name: "Matemática",
        teacherName: "Prof. Ana",
        teacherEmail: "ana@escola.pr.gov.br",
        displayOrder: 1,
        active: true,
      },
      {
        id: "sub-art",
        name: "Arte II",
        teacherName: "Prof. Carlos",
        teacherEmail: null,
        displayOrder: 2,
        active: true,
      },
    ],
    trimesters: [],
    studentCards: [
      {
        id: "card-1",
        studentId: "stu-1",
        student: { id: "stu-1", name: "ESTUDANTE SINTETICO ALPHA", active: true },
        tags: ["ALUNO_COM_LAUDO", "AEE"],
        hasSensitiveHealthTag: true,
        trimester1BelowAvgJson: JSON.stringify([
          { subjectName: "Observação Manual", grade: 5.0 },
          { subjectId: "sub-art", subjectName: "Arte II", grade: 4.5 },
        ]),
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        subjectEntries: [
          {
            subjectId: "sub-mat",
            trimester: 1,
            descriptorCodes: [3, 4], // códigos manuais que DEVEM ser preservados
            grade: null,
          },
          {
            subjectId: "sub-art",
            trimester: 1,
            descriptorCodes: [2],
            grade: 4.5, // nota de outra matriz (IF) já salva
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      ok: true,
      schoolId: "school-a",
      session: {
        user: {
          id: "user-1",
          name: "Pedagoga Teste",
          email: "pedagoga@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "school-a",
        },
      },
    });
    // Testa explicitamente com edição INSTITUCIONAL_ESSENCIAL para garantir que funciona nas duas edições
    mockGetCurrentSchool.mockResolvedValue({
      id: "school-a",
      edition: "INSTITUCIONAL_ESSENCIAL",
    });
    mockAssertTenantOwnership.mockReturnValue(true);
    mockCanMutate.mockReturnValue(true);
    mockFindOwnership.mockResolvedValue({
      id: "board-1",
      schoolId: "school-a",
      classGroupId: "cg-1",
      year: 2026,
    });
    mockGetBoardDetail.mockResolvedValue(baseBoard);
    mockSubjectCreate.mockImplementation(async ({ data }: { data: { name: string; displayOrder: number } }) => ({
      id: `sub-new-${data.displayOrder}`,
      name: data.name,
      displayOrder: data.displayOrder,
    }));
    mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    mockSubjectFindUnique.mockResolvedValue(null);
    mockSubjectFindFirst.mockResolvedValue(null);
    mockSubjectUpdate.mockResolvedValue({});
    mockClassGroupUpdateMany.mockResolvedValue({ count: 1 });
    mockEvalUpsert.mockResolvedValue({});
    mockCardUpdate.mockResolvedValue({});
  });

  it("bloqueia acesso cross-tenant com 403 Forbidden", async () => {
    mockAssertTenantOwnership.mockReturnValue(false);
    const pdf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["MATEMATICA"],
      rows: [{ nro: 1, nameLines: ["ESTUDANTE SINTETICO ALPHA"], grades: [["5.0", "6.0", "7.0"]] }],
    });

    const res = await importPdfPost(makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "preview"), {
      params: Promise.resolve({ boardId: "board-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("bloqueia perfil somente leitura (GESTAO_SECRETARIA) com 403 Forbidden", async () => {
    mockCanMutate.mockReturnValue(false);
    const pdf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["MATEMATICA"],
      rows: [{ nro: 1, nameLines: ["ESTUDANTE SINTETICO ALPHA"], grades: [["5.0", "6.0", "7.0"]] }],
    });

    const res = await importPdfPost(makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "apply"), {
      params: Promise.resolve({ boardId: "board-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejeita arquivo não-PDF com 400 Bad Request", async () => {
    const fakeBytes = new TextEncoder().encode("not a valid pdf file");
    const res = await importPdfPost(makePdfFormRequest([{ name: "falso.pdf", bytes: fakeBytes }], "preview"), {
      params: Promise.resolve({ boardId: "board-1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("não é um PDF válido");
  });

  it("executa prévia (mode=preview) sem gravações no banco em edição INSTITUCIONAL_ESSENCIAL", async () => {
    const pdf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["FISICA", "MATEMATICA"],
      rows: [
        {
          nro: 1,
          nameLines: ["ESTUDANTE SINTETICO ALPHA"],
          grades: [
            ["4.5", "6.0", "7.5"],
            ["5.2", "7.0", "8.0"],
          ],
        },
      ],
    });

    const res = await importPdfPost(makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "preview"), {
      params: Promise.resolve({ boardId: "board-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("preview");
    expect(body.preview.summary.subjectsMatched).toBe(1); // Matemática já existe
    expect(body.preview.summary.subjectsToCreate).toBe(1); // Física é nova
    expect(body.preview.summary.studentsMatched).toBe(1);
    expect(body.preview.summary.gradesToImport).toBe(6);
    expect(body.preview.summary.belowAverageGrades).toBe(2);
    expect(mockSubjectCreate).not.toHaveBeenCalled();
    expect(mockEvalUpsert).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("aplica importação (mode=apply) preservando descritivos manuais (3,4), notas de outra matriz, itens manuais e auditando sem PII", async () => {
    const pdf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["FISICA", "MATEMATICA"],
      rows: [
        {
          nro: 1,
          nameLines: ["ESTUDANTE SINTETICO ALPHA"],
          grades: [
            ["4.5", "6.5", "7.5"],
            ["5.2", "7.0", "8.0"],
          ],
        },
      ],
    });

    const res = await importPdfPost(makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "apply"), {
      params: Promise.resolve({ boardId: "board-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("apply");
    expect(body.summary.subjectsCreated).toBe(1);
    expect(body.summary.subjectsMatched).toBe(1);
    expect(body.summary.evaluationsUpserted).toBe(6);

    // Verifica preservação dos descritivos manuais [3, 4] + adição automática de [2] em Matemática T1 (nota 5.2 < 6.0)
    const matT1Call = mockEvalUpsert.mock.calls.find(
      ([arg]) => arg.where.cardId_subjectId_trimester.subjectId === "sub-mat" && arg.where.cardId_subjectId_trimester.trimester === 1
    );
    expect(matT1Call).toBeDefined();
    expect(matT1Call![0].update.descriptorCodes).toEqual([2, 3, 4]);
    expect(matT1Call![0].update.grade).toBe(5.2);

    // Verifica que trimester1BelowAvgJson preservou Arte II (outra matriz) + item manual + adicionou Matemática e Física
    expect(mockCardUpdate).toHaveBeenCalledTimes(1);
    const updatedT1Json = JSON.parse(mockCardUpdate.mock.calls[0][0].data.trimester1BelowAvgJson);
    const subjectNames = updatedT1Json.map((item: { subjectName: string }) => item.subjectName);
    expect(subjectNames).toContain("Matemática");
    expect(subjectNames).toContain("Arte II");
    expect(subjectNames).toContain("Física");
    expect(subjectNames).toContain("Observação Manual");

    // Verifica auditoria com schoolId na raiz e zero PII
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    const auditPayload = mockLogAudit.mock.calls[0][0];
    expect(auditPayload.action).toBe("IMPORT_COUNCIL_SERE_PDF");
    expect(auditPayload.schoolId).toBe("school-a");
    expect(JSON.stringify(auditPayload.details)).not.toContain("ESTUDANTE SINTETICO ALPHA");
  });

  it("exige confirmação explícita para atualizar turno da turma com escopo schoolId", async () => {
    const pdf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Tarde",
      classCode: "2",
      subjects: ["MATEMATICA"],
      rows: [{ nro: 1, nameLines: ["ESTUDANTE SINTETICO ALPHA"], grades: [["7.0", "7.0", "7.0"]] }],
    });

    const previewRes = await importPdfPost(
      makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "preview"),
      { params: Promise.resolve({ boardId: "board-1" }) }
    );
    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.preview.detectedShift).toBe("TARDE");
    expect(previewBody.preview.warnings).toContain(
      "O PDF informa turno Tarde, diferente do turno atual da turma (Noite). Confirme abaixo se deseja atualizar o turno da turma."
    );

    const applyWithoutConfirm = await importPdfPost(
      makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "apply", false),
      { params: Promise.resolve({ boardId: "board-1" }) }
    );
    expect(applyWithoutConfirm.status).toBe(200);
    expect(mockClassGroupUpdateMany).not.toHaveBeenCalled();

    const applyRes = await importPdfPost(
      makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "apply", true),
      { params: Promise.resolve({ boardId: "board-1" }) }
    );
    expect(applyRes.status).toBe(200);
    expect(mockClassGroupUpdateMany).toHaveBeenCalledWith({
      where: { id: "cg-1", schoolId: "school-a" },
      data: { shift: "TARDE" },
    });
  });

  it("recupera conflito P2002 na criação de disciplina e reativa componente existente", async () => {
    const p2002Err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mockSubjectCreate.mockRejectedValueOnce(p2002Err);
    mockSubjectFindUnique.mockResolvedValueOnce({
      id: "sub-fis-existing",
      name: "Física",
      displayOrder: 3,
      active: false,
    });

    const pdf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["FISICA"],
      rows: [{ nro: 1, nameLines: ["ESTUDANTE SINTETICO ALPHA"], grades: [["5.2", "6.8", "7.0"]] }],
    });

    const res = await importPdfPost(
      makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "apply"),
      { params: Promise.resolve({ boardId: "board-1" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.subjectsCreated).toBe(0);
    expect(body.summary.subjectsMatched).toBe(1);
    expect(mockSubjectUpdate).toHaveBeenCalledWith({
      where: { id: "sub-fis-existing" },
      data: { active: true },
    });
    expect(mockEvalUpsert).toHaveBeenCalledTimes(3);
  });

  it("sanitiza erro interno HTTP 500 sem vazar detalhes de infraestrutura", async () => {
    mockGetBoardDetail.mockRejectedValueOnce(new Error("SENSITIVE_DB_CONNECTION_STRING_LEAK"));
    const pdf = buildSyntheticSereCouncilPdf({
      course: "ENSINO MEDIO FGB",
      grade: "3ª Série",
      shift: "Noite",
      classCode: "3",
      subjects: ["MATEMATICA"],
      rows: [{ nro: 1, nameLines: ["ESTUDANTE SINTETICO ALPHA"], grades: [["7.0", "7.0", "7.0"]] }],
    });

    const res = await importPdfPost(makePdfFormRequest([{ name: "fgb.pdf", bytes: pdf }], "preview"), {
      params: Promise.resolve({ boardId: "board-1" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("SENSITIVE_DB_CONNECTION_STRING_LEAK");
  });
});

describe("Guardrails de UX Writing (GEMINI.md Seção 10) — CouncilSerePdfImportModal", () => {
  it("não contém jargões técnicos ou termos proibidos na interface visível", () => {
    const filePath = path.join(
      process.cwd(),
      "src/components/conselho/CouncilSerePdfImportModal.tsx"
    );
    const source = fs.readFileSync(filePath, "utf8");
    const forbidden = [
      /f[eé]\s+p[uú]blica/i,
      /SHA-256/i,
      /PBKDF2/i,
      /imut[áa]vel/i,
      /inviol[áa]vel/i,
      /database/i,
      /webhook/i,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
  });
});
