import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  abbreviateSubjectName,
  buildClassCouncilAnalytics,
  filterAndSortStudentAnalytics,
  sortStudentCellsByCriticality,
} from "@/components/conselho/councilAnalytics";
import CouncilAnalysisPanel from "@/components/conselho/CouncilAnalysisPanel";
import CouncilStudentFocusModal from "@/components/conselho/CouncilStudentFocusModal";
import type { CouncilBoardDetailRecord } from "@/components/conselho/types";

function createSyntheticBoard(): CouncilBoardDetailRecord {
  return {
    id: "board-9a",
    schoolId: "school-alpha",
    classGroupId: "cg-9a",
    year: 2026,
    peerLeaderStudentId: "st-regular",
    peerLeaderName: "Clara Regular",
    teacherLeaderStudentId: null,
    teacherLeaderName: null,
    externalEvalEd1Percent: 68,
    externalEvalEd2Percent: 72,
    externalEvalEd3Percent: null,
    seatingMapMode: "REVEZAMENTO_MENSAL",
    seatingMapNotes: null,
    classGroup: {
      id: "cg-9a",
      name: "9º Ano A",
      segment: "FUNDAMENTAL",
      shift: "MANHA",
    },
    subjects: [
      {
        id: "sub-mat",
        schoolId: "school-alpha",
        boardId: "board-9a",
        name: "Matemática",
        teacherName: "Prof. Carlos",
        teacherEmail: null,
        displayOrder: 1,
        active: true,
      },
      {
        id: "sub-port",
        schoolId: "school-alpha",
        boardId: "board-9a",
        name: "Língua Portuguesa",
        teacherName: "Profa. Helena",
        teacherEmail: null,
        displayOrder: 2,
        active: true,
      },
      {
        id: "sub-hist",
        schoolId: "school-alpha",
        boardId: "board-9a",
        name: "História",
        teacherName: "Prof. João",
        teacherEmail: null,
        displayOrder: 3,
        active: true,
      },
      {
        id: "sub-edfis",
        schoolId: "school-alpha",
        boardId: "board-9a",
        name: "Educação Física",
        teacherName: "Profa. Ana",
        teacherEmail: null,
        displayOrder: 4,
        active: true,
      },
    ],
    trimesters: [
      {
        id: "tri-1",
        schoolId: "school-alpha",
        boardId: "board-9a",
        trimester: 1,
        status: "CONSOLIDATED",
        positivePoints: null,
        attentionPoints: null,
        plannedActions: null,
        postCouncilHeldAt: null,
        postCouncilAdvances: null,
        postCouncilWhatWorked: null,
        postCouncilRecognizedAttitudes: null,
        postCouncilCriticalSubjects: null,
        postCouncilPerformanceFactors: null,
        postCouncilBehaviorAttendance: null,
        postCouncilWhatToImprove: null,
        postCouncilHowTeachersCanHelp: null,
        postCouncilCommitments: null,
        postCouncilActionItemsJson: null,
        linkedMinuteId: null,
        updatedByName: null,
        updatedByEmail: null,
        updatedAt: "2026-05-01T12:00:00.000Z",
      },
      {
        id: "tri-2",
        schoolId: "school-alpha",
        boardId: "board-9a",
        trimester: 2,
        status: "OPEN",
        positivePoints: null,
        attentionPoints: null,
        plannedActions: null,
        postCouncilHeldAt: null,
        postCouncilAdvances: null,
        postCouncilWhatWorked: null,
        postCouncilRecognizedAttitudes: null,
        postCouncilCriticalSubjects: null,
        postCouncilPerformanceFactors: null,
        postCouncilBehaviorAttendance: null,
        postCouncilWhatToImprove: null,
        postCouncilHowTeachersCanHelp: null,
        postCouncilCommitments: null,
        postCouncilActionItemsJson: null,
        linkedMinuteId: null,
        updatedByName: null,
        updatedByEmail: null,
        updatedAt: "2026-08-01T12:00:00.000Z",
      },
    ],
    studentCards: [
      {
        id: "card-crit",
        schoolId: "school-alpha",
        boardId: "board-9a",
        studentId: "st-crit",
        enrollmentStatus: "ATIVO",
        externalEvalEd1Percent: 45,
        externalEvalEd2Percent: 52,
        externalEvalEd3Percent: null,
        tags: ["ALUNO_COM_LAUDO", "AEE"],
        hasSensitiveHealthTag: true,
        trimester1Opinion: "Necessita acompanhamento frequente.",
        trimester2Opinion: "Encaminhar para atendimento familiar.",
        trimester3Opinion: null,
        trimester1BelowAvgJson: JSON.stringify([
          { subjectId: "sub-mat", subjectName: "Matemática", grade: 4.0 },
          { subjectId: "sub-port", subjectName: "Língua Portuguesa", grade: 4.5 },
          { subjectId: "sub-hist", subjectName: "História", grade: 5.0 },
        ]),
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        student: {
          id: "st-crit",
          name: "Bruno Crítico",
          cgm: "1001",
          active: true,
          isSpecialNeeds: true,
          isExchangeStudent: false,
          age: 14,
          lowAttendanceRecord: { attendancePercent: 68.5 },
        },
        subjectEntries: [
          // 1º Trimestre
          {
            id: "e-c-1-mat",
            schoolId: "school-alpha",
            cardId: "card-crit",
            subjectId: "sub-mat",
            trimester: 1,
            descriptorCodes: [2, 4],
            grade: 4.0,
          },
          {
            id: "e-c-1-port",
            schoolId: "school-alpha",
            cardId: "card-crit",
            subjectId: "sub-port",
            trimester: 1,
            descriptorCodes: [2],
            grade: 4.5,
          },
          {
            id: "e-c-1-hist",
            schoolId: "school-alpha",
            cardId: "card-crit",
            subjectId: "sub-hist",
            trimester: 1,
            descriptorCodes: [3],
            grade: 5.0,
          },
          // 2º Trimestre (melhorou de 3 para 2 abaixo da média)
          {
            id: "e-c-2-mat",
            schoolId: "school-alpha",
            cardId: "card-crit",
            subjectId: "sub-mat",
            trimester: 2,
            descriptorCodes: [2, 3],
            grade: 4.8,
          },
          {
            id: "e-c-2-port",
            schoolId: "school-alpha",
            cardId: "card-crit",
            subjectId: "sub-port",
            trimester: 2,
            descriptorCodes: [2, 4],
            grade: 5.2,
          },
          {
            id: "e-c-2-hist",
            schoolId: "school-alpha",
            cardId: "card-crit",
            subjectId: "sub-hist",
            trimester: 2,
            descriptorCodes: [1],
            grade: 6.5,
          },
        ],
      },
      {
        id: "card-att",
        schoolId: "school-alpha",
        boardId: "board-9a",
        studentId: "st-att",
        enrollmentStatus: "ATIVO",
        externalEvalEd1Percent: 65,
        externalEvalEd2Percent: 66,
        externalEvalEd3Percent: null,
        tags: [],
        hasSensitiveHealthTag: false,
        trimester1Opinion: null,
        trimester2Opinion: "Dificuldade pontual em Matemática.",
        trimester3Opinion: null,
        trimester1BelowAvgJson: null,
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        student: {
          id: "st-att",
          name: "Amanda Atenção",
          cgm: "1002",
          active: true,
          isSpecialNeeds: false,
          isExchangeStudent: false,
          age: 14,
          lowAttendanceRecord: { attendancePercent: 92.0 },
        },
        subjectEntries: [
          {
            id: "e-a-2-mat",
            schoolId: "school-alpha",
            cardId: "card-att",
            subjectId: "sub-mat",
            trimester: 2,
            descriptorCodes: [2],
            grade: 52, // escala 0-100 abaixo da média (< 60)
          },
          {
            id: "e-a-2-port",
            schoolId: "school-alpha",
            cardId: "card-att",
            subjectId: "sub-port",
            trimester: 2,
            descriptorCodes: [1],
            grade: 78,
          },
        ],
      },
      {
        id: "card-reg",
        schoolId: "school-alpha",
        boardId: "board-9a",
        studentId: "st-regular",
        enrollmentStatus: "ATIVO",
        externalEvalEd1Percent: 90,
        externalEvalEd2Percent: 92,
        externalEvalEd3Percent: null,
        tags: ["DESTAQUE_DA_TURMA"],
        hasSensitiveHealthTag: false,
        trimester1Opinion: null,
        trimester2Opinion: "Ótima participação.",
        trimester3Opinion: null,
        trimester1BelowAvgJson: null,
        trimester2BelowAvgJson: null,
        trimester3BelowAvgJson: null,
        student: {
          id: "st-regular",
          name: "Clara Regular",
          cgm: "1003",
          active: true,
          isSpecialNeeds: false,
          isExchangeStudent: false,
          age: 14,
          lowAttendanceRecord: { attendancePercent: 98.0 },
        },
        subjectEntries: [
          {
            id: "e-r-2-mat",
            schoolId: "school-alpha",
            cardId: "card-reg",
            subjectId: "sub-mat",
            trimester: 2,
            descriptorCodes: [1, 5],
            grade: 8.5,
          },
          {
            id: "e-r-2-port",
            schoolId: "school-alpha",
            cardId: "card-reg",
            subjectId: "sub-port",
            trimester: 2,
            descriptorCodes: [1],
            grade: 9.0,
          },
        ],
      },
    ],
  };
}

describe("Painel de Análise e Modo Telão do Conselho de Classe", () => {
  it("abrevia corretamente componentes curriculares conhecidos e personalizados", () => {
    expect(abbreviateSubjectName("Língua Portuguesa")).toBe("PORT");
    expect(abbreviateSubjectName("Matemática")).toBe("MAT");
    expect(abbreviateSubjectName("Educação Física")).toBe("ED.F");
    expect(abbreviateSubjectName("Projeto de Vida")).toBe("P.VID");
    expect(abbreviateSubjectName("Programação Web")).toBe("PR.WE");
    expect(abbreviateSubjectName("Oficina de Leitura Crítica")).toBe("OLC");
  });

  it("classifica prioridades, cruzamentos, ranking de componentes e evolução entre trimestres", () => {
    const board = createSyntheticBoard();
    const analytics = buildClassCouncilAnalytics(board, 2);

    expect(analytics.activeStudentsCount).toBe(3);
    expect(analytics.criticalCount).toBe(1);
    expect(analytics.attentionCount).toBe(1);
    expect(analytics.regularCount).toBe(1);
    expect(analytics.belowAvgStudentsCount).toBe(2);
    expect(analytics.lowAttendanceStudentsCount).toBe(1);

    // Cruzamentos pedagógicos
    expect(analytics.correlations.lowAttendanceAndBelowAvg).toBe(1);
    expect(analytics.correlations.conductAndBelowAvg).toBe(1);
    expect(analytics.correlations.difficultyWithRegularAttendance).toBe(1);
    expect(analytics.correlations.highlights).toBe(1);

    // Ranking de componentes: Matemática tem 2 abaixo da média e 2 dificuldades -> topo
    expect(analytics.subjects[0].subjectId).toBe("sub-mat");
    expect(analytics.subjects[0].belowAvgCount).toBe(2);
    expect(analytics.subjects[0].difficultyCount).toBe(2);

    // Comparativo 2º vs 1º trimestre para Bruno Crítico (caiu de 3 para 2 abaixo da média -> melhora)
    const bruno = analytics.students.find((s) => s.studentId === "st-crit");
    expect(bruno).toBeDefined();
    expect(bruno?.priority).toBe("CRITICAL");
    expect(bruno?.comparison?.hasPrevData).toBe(true);
    expect(bruno?.comparison?.prevTrimester).toBe(1);
    expect(bruno?.comparison?.belowAvgDelta).toBe(-1);
    expect(bruno?.comparison?.trend).toBe("IMPROVED");

    const brunoMat = bruno?.subjectCells.find((c) => c.subjectId === "sub-mat");
    expect(brunoMat?.gradeDelta).toBe(0.8);
  });

  it("filtra e ordena corretamente por prioridade, cruzamento, componente e ordem alfabética", () => {
    const board = createSyntheticBoard();
    const analytics = buildClassCouncilAnalytics(board, 2);

    const byPriority = filterAndSortStudentAnalytics(analytics.students, {
      searchTerm: "",
      quickFilter: "ALL",
      subjectIdFilter: "",
      sortMode: "PRIORITY",
    });
    expect(byPriority.map((s) => s.studentId)).toEqual(["st-crit", "st-att", "st-regular"]);

    const byName = filterAndSortStudentAnalytics(analytics.students, {
      searchTerm: "",
      quickFilter: "ALL",
      subjectIdFilter: "",
      sortMode: "NAME",
    });
    expect(byName.map((s) => s.studentId)).toEqual(["st-att", "st-crit", "st-regular"]);

    const corrInfreqBelow = filterAndSortStudentAnalytics(analytics.students, {
      searchTerm: "",
      quickFilter: "CORR_INFREQ_BELOW",
      subjectIdFilter: "",
      sortMode: "PRIORITY",
    });
    expect(corrInfreqBelow.map((s) => s.studentId)).toEqual(["st-crit"]);

    const byMatSubject = filterAndSortStudentAnalytics(analytics.students, {
      searchTerm: "",
      quickFilter: "ALL",
      subjectIdFilter: "sub-mat",
      sortMode: "PRIORITY",
    });
    expect(byMatSubject.map((s) => s.studentId)).toEqual(["st-crit", "st-att"]);

    const bruno = analytics.students.find((s) => s.studentId === "st-crit")!;
    const sortedCells = sortStudentCellsByCriticality(bruno.subjectCells);
    expect(sortedCells[0].subjectId).toBe("sub-mat");
    expect(sortedCells[1].subjectId).toBe("sub-port");
  });

  it("renderiza CouncilAnalysisPanel ocultando estritamente tags sensíveis quando hideSensitiveTags=true", () => {
    const board = createSyntheticBoard();

    const htmlHidden = renderToString(
      React.createElement(CouncilAnalysisPanel, {
        board,
        activeTrimester: 2,
        onChangeTrimester: vi.fn(),
        hideSensitiveTags: true,
        onToggleHideSensitiveTags: vi.fn(),
        onOpenStudentModal: vi.fn(),
        onOpenSubjectsModal: vi.fn(),
        onCardUpdated: vi.fn(),
        onMatrixSaved: vi.fn(async () => {}),
        onNotify: vi.fn(),
        readOnly: false,
      })
    );

    expect(htmlHidden).toContain("Modo Telão");
    expect(htmlHidden).toContain("Apresentar aluno a aluno");
    expect(htmlHidden).toContain("Componentes com mais atenção");
    expect(htmlHidden).toContain("Bruno Crítico");
    expect(htmlHidden).toContain("Destaque");
    expect(htmlHidden).not.toContain("Com Laudo");
    expect(htmlHidden).not.toContain(">AEE<");

    const htmlVisible = renderToString(
      React.createElement(CouncilAnalysisPanel, {
        board,
        activeTrimester: 2,
        onChangeTrimester: vi.fn(),
        hideSensitiveTags: false,
        onToggleHideSensitiveTags: vi.fn(),
        onOpenStudentModal: vi.fn(),
        onOpenSubjectsModal: vi.fn(),
        onCardUpdated: vi.fn(),
        onMatrixSaved: vi.fn(async () => {}),
        onNotify: vi.fn(),
        readOnly: false,
      })
    );
    expect(htmlVisible).toContain("Com Laudo");
    expect(htmlVisible).toContain(">AEE<");
  });

  it("renderiza CouncilStudentFocusModal com privacidade de tags sensíveis e bloqueio em readOnly", () => {
    const board = createSyntheticBoard();
    const analytics = buildClassCouncilAnalytics(board, 2);

    const htmlHiddenReadOnly = renderToString(
      React.createElement(CouncilStudentFocusModal, {
        open: true,
        onClose: vi.fn(),
        board,
        activeTrimester: 2,
        students: analytics.students,
        currentIndex: 0,
        onSelectIndex: vi.fn(),
        hideSensitiveTags: true,
        onToggleHideSensitiveTags: vi.fn(),
        onOpenFullFicha: vi.fn(),
        onCardUpdated: vi.fn(),
        onMatrixSaved: vi.fn(async () => {}),
        onNotify: vi.fn(),
        readOnly: true,
      })
    );

    const normalizedHtml = htmlHiddenReadOnly.replace(/<!--\s*-->/g, "");
    expect(normalizedHtml).toContain("Bruno Crítico");
    expect(normalizedHtml).toContain("Estudante 1 de 3");
    expect(normalizedHtml).toContain("Laudo e AEE ocultos");
    expect(normalizedHtml).not.toContain("Com Laudo");
    expect(normalizedHtml).not.toContain("Salvar descritivos");
    expect(normalizedHtml).not.toContain("Salvar parecer e tags");
  });

  it("garante largura expandida e superfície opaca no CouncilStudentFocusModal e globals.css", () => {
    const board = createSyntheticBoard();
    const analytics = buildClassCouncilAnalytics(board, 2);

    const html = renderToString(
      React.createElement(CouncilStudentFocusModal, {
        open: true,
        onClose: vi.fn(),
        board,
        activeTrimester: 2,
        students: analytics.students,
        currentIndex: 0,
        onSelectIndex: vi.fn(),
        hideSensitiveTags: false,
        onToggleHideSensitiveTags: vi.fn(),
        onOpenFullFicha: vi.fn(),
        onCardUpdated: vi.fn(),
        onMatrixSaved: vi.fn(async () => {}),
        onNotify: vi.fn(),
        readOnly: false,
      })
    );

    expect(html).toContain("<dialog");
    expect(html).toContain("dialog-focus");
    expect(html).toContain("bg-slate-50 dark:bg-slate-950");
    expect(html).toContain("border-slate-200 dark:border-slate-700");

    const globalsCss = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8"
    );
    expect(globalsCss).toContain("dialog.dialog-focus:modal");
    expect(globalsCss).toContain("max-width: min(96vw, 1380px)");
    expect(globalsCss).toContain("width: min(96vw, 1380px)");
    expect(globalsCss).toContain("dialog.dialog-focus::backdrop");
    expect(globalsCss).toContain("overscroll-behavior: contain");
  });

  it("cumpre as diretrizes de UX Writing (sem termos proibidos ou jargão técnico na interface)", () => {
    const filesToCheck = [
      "src/components/conselho/councilAnalytics.ts",
      "src/components/conselho/CouncilAnalysisPanel.tsx",
      "src/components/conselho/CouncilStudentFocusModal.tsx",
    ];
    const forbiddenPattern =
      /fé pública|imutável|inviolável|SHA-256|PBKDF2|workflow|insights|ecossistema|jornada|otimizar/i;

    for (const relPath of filesToCheck) {
      const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
      expect(content).not.toMatch(forbiddenPattern);
    }
  });
});
