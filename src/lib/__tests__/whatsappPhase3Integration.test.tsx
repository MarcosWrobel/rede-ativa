import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import ProntuarioClient from "@/app/alunos/[id]/ProntuarioClient";
import HistoricoClient from "@/app/historico/HistoricoClient";

describe("FASE 3 — Frontend & UX Pedagógica Human-in-the-Loop", () => {
  const mockStudent = {
    id: "student-100",
    name: "Ana Clara dos Santos",
    cgm: "123456789",
    classGroupId: "class-1",
    schoolId: "cmvvaoxvl0000kw07c9m80sye",
    classGroup: { id: "class-1", name: "1º Ano A" },
    messageLogs: [
      {
        id: "log-unreplied-1",
        studentId: "student-100",
        reasonTitle: "Infrequência Notificada",
        phoneUsed: "42999990001",
        sentByName: "Pedagoga Joana",
        sentAt: "2026-11-08T09:00:00Z",
        guardianReplied: false,
        replyNotes: null,
        replyCategory: null,
        deliveryStatus: "SENT",
        contentHash: "hash-initial-1",
      },
      {
        id: "log-replied-2",
        studentId: "student-100",
        reasonTitle: "Busca Ativa Preventiva",
        phoneUsed: "42999990002",
        sentByName: "Pedagoga Joana",
        sentAt: "2026-11-07T14:00:00Z",
        guardianReplied: true,
        replyNotes: "Mãe informou transporte quebrado.",
        replyCategory: "TRANSPORTE",
        deliveryStatus: "READ",
        contentHash: "hash-sealed-2",
      },
    ],
  };

  it("renderiza botões 'Capturar Retorno' e 'Editar Retorno' na timeline do Prontuário 360º", () => {
    const html = renderToString(
      <ProntuarioClient
        initialStudent={mockStudent}
        initialContacts={[]}
        initialJustifications={[]}
        initialAttendances={[]}
        initialSnapshots={[]}
        initialMinutes={[]}
        initialTab="timeline"
        currentSchool={{
          id: "cmvvaoxvl0000kw07c9m80sye",
          name: "Colégio Estadual Leopoldina B. Pedroso",
          edition: "PILOTO_INTEGRADA",
        }}
        isAdmin={false}
      />
    );

    // Deve conter os botões human-in-the-loop na timeline
    expect(html).toContain("Capturar Retorno");
    expect(html).toContain("Editar Retorno");
    expect(html).toContain("Sem Retorno");
    expect(html).toContain("Família Retornou");
  });

  it("renderiza HistoricoClient com o botão de registrar retorno integrado", () => {
    const mockLogs = [
      {
        id: "hist-1",
        reasonTitle: "Busca Ativa",
        phoneUsed: "42988887777",
        sentByName: "Pedagoga Carla",
        sentAt: "2026-11-08T11:00:00Z",
        guardianReplied: false,
        replyNotes: null,
        replyCategory: null,
        deliveryStatus: "SENT",
        student: {
          id: "student-200",
          name: "Lucas Pereira",
          classGroup: { name: "7º Ano B" },
        },
      },
    ];

    const html = renderToString(
      <HistoricoClient
        initialLogs={mockLogs}
        initialTotal={1}
        pedagogas={["Pedagoga Carla"]}
        classGroups={[{ id: "class-2", name: "7º Ano B" }]}
        currentUser={{
          name: "Pedagoga Carla",
          email: "carla@escola.pr.gov.br",
          role: "PEDAGOGA",
        }}
      />
    );

    expect(html).toContain("Lucas Pereira");
    expect(html).toContain("Capturar Retorno");
    expect(html).toContain("+ Nota");
  });

  it("mantém estudante e turma visíveis no HistoricoClient após substituir item por data.updated do PUT /api/messages/manage", () => {
    const initialLog = {
      id: "hist-edit-1",
      schoolId: "school-alpha",
      studentId: "student-200",
      reasonTitle: "Busca Ativa",
      messageContent: "Mensagem original",
      phoneUsed: "42988887777",
      sentByName: "Pedagoga Carla",
      sentAt: "2026-11-08T11:00:00.000Z",
      guardianReplied: false,
      replyNotes: null,
      replyCategory: null,
      deliveryStatus: "SENT",
      contentHash: "hash-before",
      student: {
        id: "student-200",
        schoolId: "school-alpha",
        classGroupId: "class-2",
        name: "Lucas Pereira",
        cgm: "987654321",
        guardianName: "Maria Pereira",
        guardianPhone: "42988887777",
        classGroup: {
          id: "class-2",
          schoolId: "school-alpha",
          name: "7º Ano B",
          shift: "MATUTINO",
        },
      },
    };

    const dataFromManagePut = {
      success: true,
      updated: {
        ...initialLog,
        reasonTitle: "Falta Retificada",
        contentHash: "hash-after",
      },
    };

    // Simula a substituição feita em HistoricoClient.handleSaveEdit:
    // prev.map((item) => (item.id === activeEditLog.id ? data.updated : item))
    const logsAfterEdit = [initialLog].map((item) =>
      item.id === initialLog.id ? dataFromManagePut.updated : item
    );

    const html = renderToString(
      <HistoricoClient
        initialLogs={logsAfterEdit}
        initialTotal={1}
        pedagogas={["Pedagoga Carla"]}
        classGroups={[{ id: "class-2", name: "7º Ano B" }]}
        currentUser={{
          name: "Gestora Ana",
          email: "gestora@escola.pr.gov.br",
          role: "GESTOR_ESCOLAR",
          isAdmin: true,
        }}
      />
    );

    expect(html).toContain("Lucas Pereira");
    expect(html).toContain("7º Ano B");
    expect(html).toContain("Falta Retificada");
  });

  it("consome o payload { logs, total, page, pageSize, totalPages } de GET /api/messages no HistoricoClient", () => {
    const getMessagesResponse = {
      logs: [
        {
          id: "hist-get-1",
          schoolId: "school-alpha",
          studentId: "stu-1",
          reasonTitle: "Faltas Consecutivas",
          messageContent: "Contato realizado com responsável.",
          phoneUsed: "41999991111",
          sentByName: "Pedagoga Ana",
          sentAt: "2026-11-15T12:00:00.000Z",
          guardianReplied: false,
          replyNotes: null,
          replyCategory: null,
          deliveryStatus: "SENT",
          student: {
            id: "stu-1",
            name: "Mariana Souza",
            schoolId: "school-alpha",
            classGroupId: "cg-1",
            classGroup: {
              id: "cg-1",
              name: "8º Ano A",
              segment: "EF2",
              schoolId: "school-alpha",
            },
          },
        },
      ],
      total: 11,
      page: 1,
      pageSize: 10,
      totalPages: 2,
    };

    const html = renderToString(
      <HistoricoClient
        initialLogs={getMessagesResponse.logs}
        initialTotal={getMessagesResponse.total}
        pedagogas={["Pedagoga Ana"]}
        classGroups={[{ id: "cg-1", name: "8º Ano A" }]}
        currentUser={{
          name: "Pedagoga Ana",
          email: "ana@escola.pr.gov.br",
          role: "PEDAGOGA",
        }}
      />
    );

    expect(html).toContain("Mariana Souza");
    expect(html).toContain("8º Ano A");
    expect(html).toContain("Faltas Consecutivas");
    expect(html).toContain("11");
  });
});
