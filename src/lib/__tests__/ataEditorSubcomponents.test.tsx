import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import AtaExtemporaneousBanner from "@/components/ata/editor/AtaExtemporaneousBanner";
import AtaAddendumsSection from "@/components/ata/editor/AtaAddendumsSection";
import AtaActionItemsSection from "@/components/ata/editor/AtaActionItemsSection";

describe("AtaEditor Subcomponents (SAAS-UI-01)", () => {
  it("AtaExtemporaneousBanner renderiza alerta visual, label vinculada e textarea obrigatória", () => {
    const html = renderToString(
      <AtaExtemporaneousBanner
        value="Responsável compareceu apenas nesta data para assinatura"
        onChange={() => {}}
      />
    );

    expect(html).toContain("Lavratura Extemporânea");
    expect(html).toContain("required");
    expect(html).toContain("aria-describedby=");
    expect(html).toContain("for=");
    expect(html).toContain("Responsável compareceu apenas nesta data para assinatura");
  });

  it("AtaAddendumsSection exibe adendos existentes, botão com aria-label e oculta formulário quando isVoid=true", () => {
    const addendums = [
      {
        id: "add-1",
        content: "Retifica-se a data de entrega do atestado.",
        authorName: "Pedagoga Ana",
        createdAt: "2026-11-10T10:00:00.000Z",
        addendumHash: "0123456789abcdef0123456789",
      },
    ];

    const htmlActive = renderToString(
      <AtaAddendumsSection
        addendums={addendums}
        isVoid={false}
        addendumText="Em tempo..."
        savingAddendum={false}
        onAddendumTextChange={() => {}}
        onSubmitAddendum={() => {}}
      />
    );

    expect(htmlActive.replace(/<!-- -->/g, "")).toContain("Em tempo (1):");
    expect(htmlActive).toContain("Retifica-se a data de entrega do atestado.");
    expect(htmlActive).toContain("Pedagoga Ana");
    expect(htmlActive).toContain('aria-label="Registrar Termo de Aditamento em tempo"');
    expect(htmlActive).toContain("Registrar Termo de Aditamento");

    const htmlVoid = renderToString(
      <AtaAddendumsSection
        addendums={addendums}
        isVoid={true}
        addendumText=""
        savingAddendum={false}
        onAddendumTextChange={() => {}}
        onSubmitAddendum={() => {}}
      />
    );

    expect(htmlVoid).not.toContain("Registrar Termo de Aditamento");
  });

  it("AtaActionItemsSection exibe estado vazio, campos rotulados e botões com aria-label", () => {
    const emptyHtml = renderToString(
      <AtaActionItemsSection
        actionItems={[]}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    );

    expect(emptyHtml).toContain("Nenhum encaminhamento registrado.");
    expect(emptyHtml).toContain('aria-label="Novo Encaminhamento e prazo"');

    const populatedHtml = renderToString(
      <AtaActionItemsSection
        actionItems={[
          {
            id: "act-1",
            description: "Entregar atestado médico na secretaria",
            responsible: "FAMILIA",
            dueDate: "2026-11-20",
          },
        ]}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    );

    expect(populatedHtml).toContain("Entregar atestado médico na secretaria");
    expect(populatedHtml).toContain('aria-label="Descrição do encaminhamento 1"');
    expect(populatedHtml).toContain('aria-label="Responsável pelo encaminhamento 1"');
    expect(populatedHtml).toContain('aria-label="Prazo do encaminhamento 1"');
    expect(populatedHtml).toContain('aria-label="Remover encaminhamento 1"');
  });
});
