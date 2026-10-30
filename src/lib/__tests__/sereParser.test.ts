import { describe, it, expect } from "vitest";
import {
  cleanSerePhone,
  classifySereSituacao,
  consolidateSelectedStudents,
  decodeCsvBuffer,
  formatSereSchoolName,
  parseSereFiles,
} from "../sereParser";

const SAMPLE_SERE_CSV = `,,,,,,,,,,,,,,,,,,,
,,GOVERNO DO ESTADO DO PARANÁ ,,,,,,,,,,,,Data: 30/10/2026,,,,,
,,SECRETARIA DE ESTADO DA EDUCAÇÃO – SEED,,,,,,,,,,,,SISTEMA ESCOLA,,,,,
,,TIBAGI,,,,,,,,,,,,,,,,,
,,"LEOPOLDINA B PEDROSO, C E PROFA-EF M PRO",,,,,,,,,,,,2026,,,,,
,,,,,,,,,,,,,,,,,,,
,RELAÇÃO DE ALUNOS POR TURMA,,,,,,,,,,,,,,,,,,
,,Curso: ENS FUND 6/9 ANO-SERIE,,,,Seriação: 6ºAno,,,,,,,Turno: Manhã,,,Turma: 1 ,,,
,,N. ,CGM,Nome do Estudante,Data de ,,Idad,Sex,Telefone,RG,,CPF,,,Situação,,Data Matricula,,
,,1,1018613740,ANA HELOISE ALMEIDA,23/05/2014,,12,F,(42)98839-3454,161410411,,16268241932,,,Matriculado,,09/01/2026,,
,,3,1010985745,BRAYAN MAXUEL BUENO MIRANDA,22/01/2010,,16,M,(42)99826-0509,153277739-,,15327773965,,,Sem ,,05/02/2026,,
,,4,1013465033,DAVI EMANUEL PEREIRA MARTINS,15/01/2014,,12,M,(42)99964-0375,15696733-5,,14500882952,,,Reclassificado,,05/02/2026,,
,,24,1015634738,STEFFANY SIQUEIRA DA SILVA,04/07/2014,,12,F,(42)99962-7282,147.026.259-,,14702625926,,,Transferido,,09/01/2026,,
,,25,1021726075,VICTOR HENRIQUE THUILLIER DA SILVA,27/05/2014,,12,M,(42)99804-4519,,,57977424894,,,Remanejado,,09/02/2026,,
,,33,1021726075,VICTOR HENRIQUE THUILLIER DA SILVA,27/05/2014,,12,M,(42)99804-4519,,,57977424894,,,Matriculado,,09/02/2026,,
,,,,,,,,,,,Página  1 de ,,,,,,,,14
,,Curso: ENS FUND 6/9 ANO-SERIE,,,,Seriação: 6ºAno,,,,,,,Turno: Manhã,,,Turma: 2 ,,,
,,N. ,CGM,Nome do Estudante,Data de ,,Idad,Sex,Telefone,RG,,CPF,,,Situação,,Data Matricula,,
,,5,1013864094,BENJAMIM EMANUEL THOMAZ FERREIRA,10/02/2014,,12,M,,15.463.958-6,,11297285956,,,Matriculado,,09/01/2026,,
,,26,1021726075,VICTOR HENRIQUE THUILLIER DA SILVA,27/05/2014,,12,M,(42)99804-4519,,,57977424894,,,Remanejado,,09/02/2026,,
,,,,,,,,,,,Página  2 de ,,,,,,,,14
,,Curso: ENS FUND 6/9 ANO-SERIE,,,,Seriação: 7ºAno,,,,,,,Turno: Manhã,,,Turma: 2 ,,,
,,N. ,CGM,Nome do Estudante,Data de ,,Idad,Sex,Telefone,RG,,CPF,,,Situação,,Data Matricula,,
,,32,1013465033,DAVI EMANUEL PEREIRA MARTINS,15/01/2014,,12,M,(42)99964-0375,15696733-5,,14500882952,,,Matriculado,,11/03/2026,,
,,,,,,,,,,,Página  4 de ,,,,,,,,14
,,Curso: NEM EPT IF TEC ADMINISTR-ET GN,,,,Seriação: 3ª Série,,,,,,,Turno: Manhã,,,Turma: 1 ,,,
,,N. ,CGM,Nome do Estudante,Data de ,,Idad,Sex,Telefone,RG,,CPF,,,Situação,,Data Matricula,,
,,1,1007828400,ANA CLARA NAPOLITANO ARAUJO,11/11/2009,,16,F,(42)98844-9077,166358272,,15746866903,,,Matriculado,,12/01/2026,,
,,2,1005206452,ARTHUR PINHEIRO DA COSTA,20/08/2009,,17,M,(43)99157-9715,161913456,,13362737986,,,Matriculado,,12/01/2026,,
,,3,1005243323,CARLOS DANIEL DE SOUZA MACHADO,24/02/2009,,17,M,(42)98870-4799,,,16434160909,,,Matriculado,,12/01/2026,,
,,31,1006051061,FERNANDA DE SOUZA EUZEBIO,07/04/2008,,18,F,(41)98841-4187,14.492.885-7,,12114345912,,,Concluinte,,25/02/2026,,
,,,,,,,,,,,Página  9 de ,,,,,,,,14
,,Curso: NOVO ENSINO MEDIO-PROFISSIONAL,,,,Seriação: 3ª Série,,,,,,,Turno: Manhã,,,Turma: 1 ,,,
,,N. ,CGM,Nome do Estudante,Data de ,,Idad,Sex,Telefone,RG,,CPF,,,Situação,,Data Matricula,,
,,1,1007828400,ANA CLARA NAPOLITANO ARAUJO,11/11/2009,,16,F,(42)98844-9077,166358272,,15746866903,,,Matriculado,,12/01/2026,,
,,2,1005206452,ARTHUR PINHEIRO DA COSTA,20/08/2009,,17,M,(43)99157-9715,161913456,,13362737986,,,Matriculado,,12/01/2026,,
,,3,1005243323,CARLOS DANIEL DE SOUZA MACHADO,24/02/2009,,17,M,(42)98870-4799,,,16434160909,,,Matriculado,,12/01/2026,,
,,31,1006051061,FERNANDA DE SOUZA EUZEBIO,07/04/2008,,18,F,(41)98841-4187,14.492.885-7,,12114345912,,,Concluinte,,25/02/2026,,
,,,,,,,,,,,Página  10 de ,,,,,,,,14
,,Curso: PROG ALUNO MONITOR EF,,,,Seriação: 3º PERIODO,,,,,,,Turno: Manhã,,,Turma: 1 ,,,
,,N. ,CGM,Nome do Estudante,Data de ,,Idad,Sex,Telefone,RG,,CPF,,,Situação,,Data Matricula,,
,,,1008918267,GUSTAVO MORAIS DA SILVA,22/06/2011,,15,M,(42)99955-1734,,,14757083947,,,Matriculado,,11/09/2026,,
,,,,,,,,,,,Página  12 de ,,,,,,,,14
`;

describe("sereParser — Importação de Lotes do SERE (SEED-PR)", () => {
  it("extrai cabeçalho oficial da escola mesmo com vírgula entre aspas", () => {
    const parsed = parseSereFiles([{ fileName: "manha.csv", content: SAMPLE_SERE_CSV }]);
    expect(parsed.format).toBe("SERE_REPORT");
    expect(parsed.schoolMetadata).toEqual({
      rawSchoolName: "LEOPOLDINA B PEDROSO, C E PROFA-EF M PRO",
      formattedSchoolName: "Colégio Estadual Profa. Leopoldina B. Pedroso",
      city: "Tibagi",
      reportDate: "30/10/2026",
      schoolYear: "2026",
    });
  });

  it("gera nomes canônicos de turmas, mescla dupla matrícula técnica e desmarca programas complementares", () => {
    const parsed = parseSereFiles([{ fileName: "manha.csv", content: SAMPLE_SERE_CSV }]);

    const names = parsed.turmas.map((t) => ({
      name: t.suggestedName,
      segment: t.segment,
      shift: t.shift,
      isComplementary: t.isComplementary,
      selectedByDefault: t.selectedByDefault,
    }));

    expect(names).toEqual([
      { name: "6º 1", segment: "FUNDAMENTAL", shift: "MANHA", isComplementary: false, selectedByDefault: true },
      { name: "6º 2", segment: "FUNDAMENTAL", shift: "MANHA", isComplementary: false, selectedByDefault: true },
      { name: "7º 2", segment: "FUNDAMENTAL", shift: "MANHA", isComplementary: false, selectedByDefault: true },
      { name: "3º ADM", segment: "MEDIO", shift: "MANHA", isComplementary: false, selectedByDefault: true },
      { name: "PROG ALUNO MONITOR 1", segment: "MEDIO", shift: "MANHA", isComplementary: true, selectedByDefault: false },
    ]);

    const t3Adm = parsed.turmas.find((t) => t.suggestedName === "3º ADM")!;
    expect(t3Adm.mergedDualMatrixCount).toBe(3);
  });

  it("trata corretamente Remanejado, Reclassificado, Transferido, Concluinte, Sem Frequência e telefone vazio", () => {
    const parsed = parseSereFiles([{ fileName: "manha.csv", content: SAMPLE_SERE_CSV }]);
    const consolidated = consolidateSelectedStudents(parsed, {}, {
      includeSemFrequencia: true,
      includeConcluinte: true,
    });

    // Esperados ativos nas turmas regulares:
    // 6º 1: Ana Heloise (Matriculado), Brayan (Sem ), Victor Henrique (Matriculado — ignorou os dois Remanejado)
    // 6º 2: Benjamim (Matriculado, sem fone)
    // 7º 2: Davi Emanuel (Matriculado — ignorou o Reclassificado do 6º 1)
    // 3º ADM: Ana Clara, Arthur, Carlos Daniel (Matriculado) + Fernanda (Concluinte)
    // Ignorados: Gustavo Morais (Programa Aluno Monitor desmarcado) e Steffany (Transferido)
    expect(consolidated.stats.selectedTurmasCount).toBe(4);
    expect(consolidated.stats.activeStudentsCount).toBe(9);
    expect(consolidated.stats.missingPhoneCount).toBe(1);

    const davi = consolidated.studentsToImport.find((s) => s.cgm === "1013465033");
    expect(davi?.turmaName).toBe("7º 2");

    const victor = consolidated.studentsToImport.find((s) => s.cgm === "1021726075");
    expect(victor?.turmaName).toBe("6º 1");

    const benjamim = consolidated.studentsToImport.find((s) => s.cgm === "1013864094");
    expect(benjamim?.phone).toBe("");

    expect(consolidated.transferredToDeactivate).toEqual([
      {
        cgm: "1015634738",
        name: "STEFFANY SIQUEIRA DA SILVA",
        situacaoRaw: "Transferido",
      },
    ]);
  });

  it("decodifica arquivos Windows-1252 (Latin-1) sem corromper acentos", () => {
    // "6ºAno - JOÃO" em bytes Windows-1252: '6' (0x36), 'º' (0xBA), 'A' (0x41), 'n' (0x6E), 'o' (0x6F), ' ', 'J' (0x4A), 'O' (0x4F), 'Ã' (0xC3), 'O' (0x4F)
    const latin1Bytes = new Uint8Array([0x36, 0xba, 0x41, 0x6e, 0x6f, 0x20, 0x4a, 0x4f, 0xc3, 0x4f]);
    expect(decodeCsvBuffer(latin1Bytes.buffer)).toBe("6ºAno JOÃO");
  });

  it("suporta planilha CSV tabular separada por ponto-e-vírgula (;)", () => {
    const tabular = [
      "CGM;Nome do Aluno;Turma;Turno;Telefone;Responsável",
      "1099887766;MARIA EDUARDA TESTE;1º Série;Noite;(42) 99911-2233; Dona Joana",
    ].join("\n");

    const parsed = parseSereFiles([{ fileName: "noturno.csv", content: tabular }]);
    expect(parsed.format).toBe("TABULAR_CSV");
    expect(parsed.turmas).toHaveLength(1);
    expect(parsed.turmas[0].suggestedName).toBe("1º Série");
    expect(parsed.turmas[0].segment).toBe("NOTURNO");
    expect(parsed.turmas[0].shift).toBe("NOITE");
    expect(parsed.turmas[0].students[0]).toMatchObject({
      cgm: "1099887766",
      name: "MARIA EDUARDA TESTE",
      phone: "42999112233",
      guardianName: "Dona Joana",
    });
  });

  it("higieniza telefones e classifica situações diversas", () => {
    expect(cleanSerePhone("(42)98839-3454")).toBe("42988393454");
    expect(cleanSerePhone("5542988393454")).toBe("42988393454");
    expect(cleanSerePhone("042988393454")).toBe("42988393454");
    expect(cleanSerePhone("0000000000")).toBe("");
    expect(cleanSerePhone("")).toBe("");

    expect(classifySereSituacao("Matriculado")).toBe("ACTIVE");
    expect(classifySereSituacao("Sem ")).toBe("SEM_FREQUENCIA");
    expect(classifySereSituacao("Concluinte")).toBe("CONCLUINTE");
    expect(classifySereSituacao("Remanejado")).toBe("MOVED_INTERNAL");
    expect(classifySereSituacao("Transferido")).toBe("LEFT_SCHOOL");
    expect(formatSereSchoolName("MONTEIRO LOBATO, C E-EF M")).toBe("Colégio Estadual Monteiro Lobato");
  });
});
