import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import AtaExtemporaneousBanner from "@/components/ata/editor/AtaExtemporaneousBanner";
import AtaAddendumsSection from "@/components/ata/editor/AtaAddendumsSection";
import AtaActionItemsSection from "@/components/ata/editor/AtaActionItemsSection";
import {
  isParticipantSignatureLocked,
  isParticipantQrActive,
  buildRefazerAssinaturaPatch,
  applyRoleChangeToUnsignedParticipant,
  applyPendingAiActionItemsDecision,
  resetParticipantSignatureWithServer,
} from "@/components/ata/editor/participantIdentity";

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
    expect(populatedHtml).toContain('value="DOCENTE"');
    expect(populatedHtml).toContain("Docente / Professor");
  });

  it("participantIdentity bloqueia identidade/kinship quando assinado ou QR ativo, sanitiza vínculo ao trocar papel e limpa tudo ao refazer assinatura", () => {
    const signedParticipant = {
      id: "part-1",
      role: "RESPONSAVEL",
      name: "Maria Responsável",
      kinship: "Mãe",
      phone: "42999990000",
      signatureMode: "SCREEN_CANVAS",
      signatureData: "data:image/png;base64,ABC",
      hasSignature: true,
      verifiedEmail: "maria@escola.pr.gov.br",
      biometricVerified: true,
      hasActiveSignLink: true,
    };

    expect(isParticipantSignatureLocked(signedParticipant)).toBe(true);
    // Troca de papel não altera participante já assinado
    expect(applyRoleChangeToUnsignedParticipant(signedParticipant, "EQUIPE_ESCOLAR")).toBe(
      signedParticipant
    );

    const reset = buildRefazerAssinaturaPatch(signedParticipant);
    expect(reset.signatureData).toBeNull();
    expect(reset.hasSignature).toBe(false);
    expect(reset.signatureMode).toBe("PENDING");
    expect(reset.verifiedEmail).toBeNull();
    expect(reset.biometricVerified).toBe(false);
    expect(reset.hasActiveSignLink).toBe(false);
    expect(reset.clearSignature).toBe(true);

    const qrPending = {
      id: "part-2",
      role: "RESPONSAVEL",
      name: "Carlos",
      kinship: "mãe / pai",
      signatureMode: "PENDING",
      hasActiveSignLink: false,
    };
    expect(isParticipantQrActive(qrPending, "part-2")).toBe(true);
    const changedToStaff = applyRoleChangeToUnsignedParticipant(qrPending, "EQUIPE_ESCOLAR");
    expect(changedToStaff.role).toBe("EQUIPE_ESCOLAR");
    expect(changedToStaff.kinship).toBe("");
  });

  it("applyPendingAiActionItemsDecision preserva prazos editados manualmente (inclusive durante resposta atrasada da IA) e exige confirmação", () => {
    const aiSuggested = [
      { description: "Conversar com docente", responsible: "DOCENTE", dueDate: "" },
    ];

    // Lista vazia aplica diretamente com dueDate vazio ("Sem prazo definido")
    const onEmpty = applyPendingAiActionItemsDecision([], aiSuggested);
    expect(onEmpty.nextItems).toEqual(aiSuggested);
    expect(onEmpty.pendingSuggestions).toBeNull();

    // Se a equipe preencheu prazo ou item durante o voo da requisição, não sobrescreve sem confirmação
    const inFlightEdited = [
      { description: "Revisar frequência semanal", responsible: "FAMILIA", dueDate: "2026-11-25" },
    ];
    const onEdited = applyPendingAiActionItemsDecision(inFlightEdited, aiSuggested);
    expect(onEdited.nextItems).toEqual(inFlightEdited);
    expect(onEdited.pendingSuggestions).toEqual(aiSuggested);

    const bannerHtml = renderToString(
      <AtaActionItemsSection
        actionItems={inFlightEdited}
        pendingSuggestions={aiSuggested}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
        onAcceptPendingSuggestions={() => {}}
        onDiscardPendingSuggestions={() => {}}
      />
    );
    expect(bannerHtml.replace(/<!-- -->/g, "")).toContain(
      "A formalização sugeriu 1 novo(s) encaminhamento(s), mas você já possui itens registrados."
    );
    expect(bannerHtml).toContain("Substituir pelos sugeridos");
    expect(bannerHtml).toContain("Manter atuais");
  });

  it("preserva prazo editado pelo usuário enquanto resposta da IA está em andamento (resposta atrasada)", async () => {
    const actionItemsRef = {
      current: [] as Array<{ id?: string; description: string; responsible: string; dueDate: string }>,
    };

    let resolveAi!: (suggested: typeof actionItemsRef.current) => void;
    const aiRequestPromise = new Promise<typeof actionItemsRef.current>((resolve) => {
      resolveAi = resolve;
    });

    // Enquanto a IA está processando, o usuário preenche um encaminhamento com prazo manual
    actionItemsRef.current = [
      {
        description: "Reunião de acompanhamento com a família",
        responsible: "FAMILIA",
        dueDate: "2026-12-05",
      },
    ];

    // Resposta atrasada da IA chega depois com dueDate vazio ("")
    resolveAi([
      {
        description: "Conversar com docente sobre frequência",
        responsible: "DOCENTE",
        dueDate: "",
      },
    ]);

    const lateSuggested = await aiRequestPromise;
    const decision = applyPendingAiActionItemsDecision(actionItemsRef.current, lateSuggested);

    expect(decision.nextItems).toEqual([
      {
        description: "Reunião de acompanhamento com a família",
        responsible: "FAMILIA",
        dueDate: "2026-12-05",
      },
    ]);
    expect(decision.pendingSuggestions).toEqual(lateSuggested);
  });

  it("resetParticipantSignatureWithServer exige sucesso do servidor antes de liberar identidade e mantém assinatura se falhar", async () => {
    const signedList = [
      {
        id: "part-signed-1",
        role: "RESPONSAVEL",
        name: "Maria Responsável",
        kinship: "Mãe",
        signatureMode: "SCREEN_CANVAS",
        signatureData: "data:image/png;base64,SIGNED",
        hasSignature: true,
        verifiedEmail: null,
        biometricVerified: false,
      },
    ];

    // Cenário 1: erro 500/409 no servidor -> mantém assinatura reconhecida e não libera identidade
    const failFetch = async () =>
      new Response(JSON.stringify({ error: "Falha transacional no servidor" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });

    const failResult = await resetParticipantSignatureWithServer({
      minuteId: "min-1",
      participantIndex: 0,
      participants: signedList,
      buildPayload: (next) => ({ participants: next }),
      fetcher: failFetch as typeof fetch,
    });

    expect(failResult.ok).toBe(false);
    expect(failResult.persistedOnServer).toBe(false);
    expect(failResult.error).toContain("Falha transacional no servidor");
    expect(isParticipantSignatureLocked(failResult.participants[0])).toBe(true);
    expect(failResult.participants[0].signatureData).toBe("data:image/png;base64,SIGNED");

    // Cenário 2: sucesso no servidor -> envia clearSignature: true no PATCH e só então libera identidade
    let capturedBody: any = null;
    const okFetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          success: true,
          minute: {
            id: "min-1",
            participants: capturedBody.participants.map((p: any) => ({
              ...p,
              signatureData: null,
              hasSignature: false,
              signatureMode: "PENDING",
            })),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const okResult = await resetParticipantSignatureWithServer({
      minuteId: "min-1",
      participantIndex: 0,
      participants: signedList,
      buildPayload: (next) => ({ participants: next }),
      fetcher: okFetch as typeof fetch,
    });

    expect(okResult.ok).toBe(true);
    expect(okResult.persistedOnServer).toBe(true);
    expect(capturedBody?.participants?.[0]?.clearSignature).toBe(true);
    expect(isParticipantSignatureLocked(okResult.participants[0])).toBe(false);
  });
});
