import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import WhatsAppReplyCaptureModal, {
  isPhoneCompatible,
  buildInitialReplyModalState,
  clearWhatsAppPushedReplyCache,
  shouldAcceptLiveWhatsAppPush,
  LAST_PUSHED_REPLY_STORAGE_KEY,
} from "@/components/whatsapp/WhatsAppReplyCaptureModal";

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
    expect(html).toContain("A leitura de imagens está indisponível");
    expect(html).toContain("copie ou digite a resposta");
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

  it("opera com neutralidade de marca e sem dependência de scrapers para nova escola na edição INSTITUCIONAL_ESSENCIAL", () => {
    const municipalLog = {
      ...mockLog,
      id: "msg-municipal-999",
      phoneUsed: "43988887777",
      student: {
        id: "student-muni-1",
        name: "Carlos Eduardo da Silva",
        classGroup: { name: "5º Ano Municipal" },
      },
    };

    const html = renderToString(
      <WhatsAppReplyCaptureModal
        isOpen={true}
        onClose={() => {}}
        messageLog={municipalLog}
        studentName="Carlos Eduardo da Silva"
        classNameLabel="5º Ano Municipal"
        onSuccess={() => {}}
      />
    );

    // Não contém referências hardcoded à escola piloto nem à sede
    expect(html).not.toContain("41042730");
    expect(html).not.toContain("default-leopoldina");
    expect(html).not.toContain("Leopoldina");

    // Contém os elementos neutros e canônicos da Busca Ativa Rede Ativa
    expect(html).toContain("Carlos Eduardo da Silva");
    expect(html).toContain("5º Ano Municipal");
    expect(html).toContain("43988887777");
    expect(html).toContain("Capturar Retorno do Responsável");
    expect(html).toContain("Confirmar e Selar Retorno (SHA-256)");
  });

  describe("isPhoneCompatible (Tolerância de formato e DDI)", () => {
    it("reconhece compatibilidade entre formato limpo e formato com DDI 55", () => {
      expect(isPhoneCompatible("5542999998888", "42999998888")).toBe(true);
      expect(isPhoneCompatible("42999998888", "5542999998888")).toBe(true);
    });

    it("reconhece compatibilidade com máscaras, parênteses e traços", () => {
      expect(isPhoneCompatible("+55 (42) 99999-8888", "42999998888")).toBe(true);
      expect(isPhoneCompatible("42 9999-8888", "(42) 9999-8888")).toBe(true);
    });

    it("rejeita telefones comprovadamente distintos", () => {
      expect(isPhoneCompatible("42999998888", "41888887777")).toBe(false);
      expect(isPhoneCompatible("5541911112222", "5542999998888")).toBe(false);
      expect(isPhoneCompatible("5541999998888", "5542999998888")).toBe(false);
    });

    it("permite fallback permissivo quando um dos parâmetros for nulo ou vazio", () => {
      expect(isPhoneCompatible(null, "42999998888")).toBe(true);
      expect(isPhoneCompatible("42999998888", undefined)).toBe(true);
      expect(isPhoneCompatible("", "")).toBe(true);
    });
  });

  describe("Isolamento de Estado e Limpeza entre Contatos Sequenciais", () => {
    it("inicializa contato pendente completamente limpo sem herdar estado de contato anterior", () => {
      const firstContact = {
        ...mockLog,
        id: "msg-contato-1",
        guardianReplied: true,
        replyCategory: "SAUDE",
        replyNotes: "Mãe informou consulta médica do primeiro contato.",
      };
      const secondContact = {
        ...mockLog,
        id: "msg-contato-2",
        phoneUsed: "42988881111",
        guardianReplied: false,
        replyCategory: null,
        replyNotes: null,
      };

      const firstState = buildInitialReplyModalState(firstContact);
      expect(firstState.replyCategory).toBe("SAUDE");
      expect(firstState.replyNotes).toBe("Mãe informou consulta médica do primeiro contato.");
      expect(firstState.rawReply).toBe("");

      const secondState = buildInitialReplyModalState(secondContact);
      expect(secondState).toEqual({
        rawReply: "",
        replyCategory: "",
        replyNotes: "",
        extractedByExtension: false,
        extractedAtIso: null,
        domTimestamp: null,
        activeChatTitle: null,
        capturedScreenshot: null,
      });
    });

    it("renderiza segundo contato totalmente limpo após primeiro contato respondido", () => {
      const firstHtml = renderToString(
        <WhatsAppReplyCaptureModal
          isOpen={true}
          onClose={() => {}}
          messageLog={{
            ...mockLog,
            id: "msg-seq-1",
            guardianReplied: true,
            replyCategory: "SAUDE",
            replyNotes: "Atestado entregue pelo contato 1.",
          }}
          studentName="Estudante Um"
          classNameLabel="6º Ano A"
          onSuccess={() => {}}
        />
      );
      expect(firstHtml).toContain("Atestado entregue pelo contato 1.");

      const secondHtml = renderToString(
        <WhatsAppReplyCaptureModal
          isOpen={true}
          onClose={() => {}}
          messageLog={{
            ...mockLog,
            id: "msg-seq-2",
            phoneUsed: "42977776666",
            guardianReplied: false,
            replyCategory: null,
            replyNotes: null,
          }}
          studentName="Estudante Dois"
          classNameLabel="7º Ano B"
          onSuccess={() => {}}
        />
      );
      expect(secondHtml).toContain("Estudante Dois");
      expect(secondHtml).toContain("42977776666");
      expect(secondHtml).not.toContain("Estudante Um");
      expect(secondHtml).not.toContain("Atestado entregue pelo contato 1.");
      expect(secondHtml).not.toContain("Captura assistida via extensão");
    });

    it("rejeita replays de cache de storage (fromStorageCache), eventos sem correlação, eventos já consumidos e mensagens destinadas a outro contato", () => {
      const consumed = new Set<string>(["req_ja_consumido"]);

      // Cache legado reenviado pelo bridge deve ser sempre ignorado
      expect(
        shouldAcceptLiveWhatsAppPush(
          {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            pushedFromWhatsApp: true,
            fromStorageCache: true,
            requestId: "req_cap_2",
            logId: "msg-contato-2",
            phone: "42988881111",
            rawText: "Mensagem antiga do primeiro contato",
          },
          "msg-contato-2",
          "42988881111",
          "req_cap_2",
          consumed
        )
      ).toBe(false);

      // Push destinado a outro logId deve ser ignorado
      expect(
        shouldAcceptLiveWhatsAppPush(
          {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            pushedFromWhatsApp: true,
            requestId: "req_cap_2",
            logId: "msg-contato-1",
            phone: "42988881111",
            rawText: "Mensagem do contato 1",
          },
          "msg-contato-2",
          "42988881111",
          "req_cap_2",
          consumed
        )
      ).toBe(false);

      // Push destinado a outro telefone deve ser ignorado
      expect(
        shouldAcceptLiveWhatsAppPush(
          {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            pushedFromWhatsApp: true,
            requestId: "req_cap_2",
            logId: "msg-contato-2",
            phone: "41911112222",
            rawText: "Mensagem de outro telefone",
          },
          "msg-contato-2",
          "42988881111",
          "req_cap_2",
          consumed
        )
      ).toBe(false);

      // Push sem requestId ou sem logId (sem correlação válida) deve ser rejeitado (sem fallback para último contexto)
      expect(
        shouldAcceptLiveWhatsAppPush(
          {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            pushedFromWhatsApp: true,
            rawText: "Bom dia, meu filho está com consulta hoje.",
          },
          "msg-contato-2",
          "42988881111",
          "req_cap_2",
          consumed
        )
      ).toBe(false);

      // Push com requestId já consumido (repetição da mesma operação) deve ser rejeitado
      expect(
        shouldAcceptLiveWhatsAppPush(
          {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            pushedFromWhatsApp: true,
            requestId: "req_ja_consumido",
            logId: "msg-contato-2",
            phone: "42988881111",
            rawText: "Repetição de operação consumida",
          },
          "msg-contato-2",
          "42988881111",
          "req_ja_consumido",
          consumed
        )
      ).toBe(false);

      // Push ao vivo com correlação válida (requestId, logId e phone compatível) e não consumido é aceito
      expect(
        shouldAcceptLiveWhatsAppPush(
          {
            type: "REDEATIVA_WHATSAPP_REPLY_EXTRACTED",
            pushedFromWhatsApp: true,
            requestId: "req_cap_2",
            logId: "msg-contato-2",
            phone: "5542988881111",
            rawText: "Bom dia, meu filho está com consulta hoje.",
          },
          "msg-contato-2",
          "42988881111",
          "req_cap_2",
          consumed
        )
      ).toBe(true);
    });

    it("limpa __REDEATIVA_LAST_PUSHED_REPLY__, sessionStorage e notifica extensão via postMessage", () => {
      const originalWindow = (globalThis as any).window;
      const originalSessionStorage = (globalThis as any).sessionStorage;
      const postMessageMock = vi.fn();
      const removeItemMock = vi.fn();

      try {
        (globalThis as any).window = {
          location: { origin: "http://localhost:3001" },
          __REDEATIVA_LAST_PUSHED_REPLY__: { rawText: "Mensagem antiga" },
          postMessage: postMessageMock,
        };
        (globalThis as any).sessionStorage = {
          removeItem: removeItemMock,
        };

        clearWhatsAppPushedReplyCache();

        expect((globalThis as any).window.__REDEATIVA_LAST_PUSHED_REPLY__).toBeUndefined();
        expect(removeItemMock).toHaveBeenCalledWith(LAST_PUSHED_REPLY_STORAGE_KEY);
        expect(postMessageMock).toHaveBeenCalledWith(
          { type: "REDEATIVA_CLEAR_LAST_CAPTURED_REPLY" },
          "http://localhost:3001"
        );
      } finally {
        if (originalWindow === undefined) {
          delete (globalThis as any).window;
        } else {
          (globalThis as any).window = originalWindow;
        }
        if (originalSessionStorage === undefined) {
          delete (globalThis as any).sessionStorage;
        } else {
          (globalThis as any).sessionStorage = originalSessionStorage;
        }
      }
    });
  });
});
