import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import WhatsAppReplyCaptureModal from "@/components/whatsapp/WhatsAppReplyCaptureModal";

describe("WhatsAppReplyCaptureModal (Human-in-the-Loop UX)", () => {
  const mockLog = {
    id: "msg-test-1001",
    studentId: "student-1001",
    phoneUsed: "42999998888",
    reasonTitle: "Busca Ativa por Infrequência Consecutiva",
    messageContent: "Olá, notamos a ausência do aluno...",
    sentByName: "Pedagoga Maria",
    sentAt: "2026-11-08T10:30:00Z",
    guardianReplied: false,
    replyNotes: null,
    replyCategory: null,
    deliveryStatus: "SENT",
    contentHash: "hash-initial-12345",
    student: {
      id: "student-1001",
      name: "João da Silva Sauro",
      classGroup: {
        name: "9º Ano A - Manhã",
      },
    },
  };

  it("não renderiza conteúdo ativo quando isOpen for false", () => {
    const html = renderToString(
      <WhatsAppReplyCaptureModal
        isOpen={false}
        onClose={() => {}}
        messageLog={mockLog}
        studentName="João da Silva Sauro"
        classNameLabel="9º Ano A - Manhã"
        onSuccess={() => {}}
      />
    );
    expect(html).toBe("");
  });

  it("renderiza cabeçalho, dados do estudante, turma e motivo com isOpen=true", () => {
    const html = renderToString(
      <WhatsAppReplyCaptureModal
        isOpen={true}
        onClose={() => {}}
        messageLog={mockLog}
        studentName="João da Silva Sauro"
        classNameLabel="9º Ano A - Manhã"
        onSuccess={() => {}}
      />
    );

    // Seção 1: Metadados
    expect(html).toContain("Capturar Retorno do Responsável");
    expect(html).toContain("João da Silva Sauro");
    expect(html).toContain("9º Ano A - Manhã");
    expect(html).toContain("Busca Ativa por Infrequência Consecutiva");
    expect(html).toContain("42999998888");
    expect(html).toContain("Pedagoga Maria");

    // Seção 2: Captura assistida + Fallback
    expect(html).toContain("Texto Bruto Recebido (WhatsApp Web):");
    expect(html).toContain("Extrair da Aba do WhatsApp Web");

    // Seção 3: Classificação com IA
    expect(html).toContain("Classificação e Síntese Formal (Human-in-the-Loop):");
    expect(html).toContain("Sugerir Classificação e Síntese com IA");

    // Seção 4: Revisão humana e selagem probatória
    expect(html).toContain("Categoria da Justificativa / Motivo da Ausência:");
    expect(html).toContain("Confirmar e Selar Retorno (SHA-256)");
  });

  it("renderiza opções de categorias de retorno padronizadas", () => {
    const html = renderToString(
      <WhatsAppReplyCaptureModal
        isOpen={true}
        onClose={() => {}}
        messageLog={mockLog}
        onSuccess={() => {}}
      />
    );

    expect(html).toContain("SAUDE");
    expect(html).toContain("TRANSPORTE");
    expect(html).toContain("TRABALHO");
    expect(html).toContain("VIAGEM_FAMILIAR");
  });

  it("carrega retorno anterior quando messageLog já tiver sido respondido", () => {
    const repliedLog = {
      ...mockLog,
      guardianReplied: true,
      replyCategory: "SAUDE",
      replyNotes: "Responsável informou consulta médica e entregará atestado.",
      contentHash: "hash-sealed-sha256-abc",
    };

    const html = renderToString(
      <WhatsAppReplyCaptureModal
        isOpen={true}
        onClose={() => {}}
        messageLog={repliedLog}
        studentName={repliedLog.student.name}
        classNameLabel={repliedLog.student.classGroup.name}
        onSuccess={() => {}}
      />
    );

    expect(html).toContain("Responsável informou consulta médica e entregará atestado.");
    expect(html).toContain("value=\"SAUDE\"");
  });

  it("renderiza link de abertura direta do WhatsApp Web com o número limpo do estudante", () => {
    const html = renderToString(
      <WhatsAppReplyCaptureModal
        isOpen={true}
        onClose={() => {}}
        messageLog={mockLog}
        studentName="João da Silva Sauro"
        classNameLabel="9º Ano A - Manhã"
        onSuccess={() => {}}
      />
    );

    // Link direto para a conversa do aluno no WhatsApp Web
    expect(html).toContain("https://web.whatsapp.com/send?phone=42999998888");
    expect(html).toContain("Abrir Conversa");
    expect(html).toContain("Extrair da Aba do WhatsApp Web");
  });

  it("renderiza botão de ação e placeholder de fallback manual", () => {
    const html = renderToString(
      <WhatsAppReplyCaptureModal
        isOpen={true}
        onClose={() => {}}
        messageLog={mockLog}
        studentName="João da Silva Sauro"
        classNameLabel="9º Ano A - Manhã"
        onSuccess={() => {}}
      />
    );

    expect(html).toContain("Extrair da Aba do WhatsApp Web");
    expect(html).toContain("Cole aqui a resposta recebida ou clique no botão acima para extrair da aba ativa");
  });
});
