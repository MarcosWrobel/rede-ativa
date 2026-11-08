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
});
