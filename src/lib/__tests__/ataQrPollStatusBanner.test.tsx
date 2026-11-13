import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import AtaQrPollStatusBanner from "@/components/ata/editor/AtaQrPollStatusBanner";
import type { QrPollUiState } from "@/components/ata/editor/qrPollController";

describe("AtaQrPollStatusBanner (Acessibilidade e Mensagens)", () => {
  const baseState: QrPollUiState = {
    status: "waiting",
    signatureConfirmed: false,
    connectionWarning: false,
    isBusy: false,
  };

  it("não renderiza nada em waiting normal", () => {
    const html = renderToString(
      <AtaQrPollStatusBanner
        state={baseState}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toBe("");
  });

  it("renderiza aviso de conexão em waiting com connectionWarning", () => {
    const html = renderToString(
      <AtaQrPollStatusBanner
        state={{ ...baseState, connectionWarning: true }}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Sem conexão para verificar a assinatura");
  });

  it("renderiza mensagem de confirmação de assinatura em sync_error", () => {
    const html = renderToString(
      <AtaQrPollStatusBanner
        state={{
          ...baseState,
          status: "sync_error",
          signatureConfirmed: true,
          pendingRecoveryAction: "retryFinalSync",
        }}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Assinatura recebida, mas não foi possível atualizar a tela.");
    expect(html).toContain("Tentar atualizar");
  });

  it("renderiza mensagem neutra de erro de ata em sync_error sem assinatura", () => {
    const html = renderToString(
      <AtaQrPollStatusBanner
        state={{
          ...baseState,
          status: "sync_error",
          signatureConfirmed: false,
          pendingRecoveryAction: "refreshMinute",
        }}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toContain("Não foi possível atualizar os dados da ata.");
    expect(html).not.toContain("Assinatura recebida");
  });

  it("renderiza mensagem factual de taxa excedida com botão de retomar verificação", () => {
    const html = renderToString(
      <AtaQrPollStatusBanner
        state={{
          ...baseState,
          status: "sync_error",
          pendingRecoveryAction: "resumePolling",
          retryAllowedAt: Date.now() + 60_000,
        }}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toContain("Limite de consultas excedido. Aguarde antes de verificar novamente.");
    expect(html).toContain("Retomar verificação");
    expect(html).toContain("disabled");
  });

  it("distingue link expirado de link inativo em status=expired", () => {
    const htmlExpired = renderToString(
      <AtaQrPollStatusBanner
        state={{ ...baseState, status: "expired", expiredReason: "expired" }}
        onRetry={() => {}}
        onClose={() => {}}
        onRenewLink={() => {}}
      />
    );
    expect(htmlExpired).toContain("Este link de assinatura expirou.");
    expect(htmlExpired).toContain("Gerar novo QR Code");

    const htmlInactive = renderToString(
      <AtaQrPollStatusBanner
        state={{ ...baseState, status: "expired", expiredReason: "inactive" }}
        onRetry={() => {}}
        onClose={() => {}}
        onRenewLink={() => {}}
      />
    );
    expect(htmlInactive).toContain("Este link não está mais ativo.");
  });

  it("preserva confirmação da assinatura em erros 401 e 404", () => {
    const html401 = renderToString(
      <AtaQrPollStatusBanner
        state={{ ...baseState, status: "unauthorized", signatureConfirmed: true }}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html401).toContain("Assinatura recebida. Entre novamente para atualizar os dados da ata.");

    const html404 = renderToString(
      <AtaQrPollStatusBanner
        state={{ ...baseState, status: "not_found", signatureConfirmed: true }}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html404).toContain("Assinatura recebida. A ata não está mais disponível para atualização.");
  });
});
