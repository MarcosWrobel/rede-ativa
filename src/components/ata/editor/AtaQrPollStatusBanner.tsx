import React from "react";
import { Loader2, AlertCircle, Clock, RefreshCw, LogIn, X, CheckCircle2 } from "lucide-react";
import type { QrPollUiState } from "./qrPollController";

export interface AtaQrPollStatusBannerProps {
  state: QrPollUiState;
  onRetry: () => void;
  onClose: () => void;
  onRenewLink?: () => void;
  onLogin?: () => void;
}

export default function AtaQrPollStatusBanner({
  state,
  onRetry,
  onClose,
  onRenewLink,
  onLogin,
}: AtaQrPollStatusBannerProps) {
  const {
    status,
    signatureConfirmed,
    connectionWarning,
    isBusy,
    pendingRecoveryAction,
    expiredReason,
    retryAllowedAt,
  } = state;

  const isRateLimited = typeof retryAllowedAt === "number" && Date.now() < retryAllowedAt;

  // Em estado de repouso normal sem aviso, não exibe banner especial
  if (status === "waiting" && !connectionWarning) {
    return null;
  }

  // Aviso de conexão transitória sem travar o acompanhamento
  if (status === "waiting" && connectionWarning) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900"
      >
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Sem conexão para verificar a assinatura. Tentando novamente...</span>
        </div>
        <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0 ml-2" />
      </div>
    );
  }

  // Sincronizando dados após confirmação ou refresh manual
  if (status === "syncing") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="p-3.5 bg-sky-50 border border-sky-200 rounded-xl flex items-center justify-between text-xs text-sky-950"
      >
        <div className="flex items-center space-x-2.5">
          {signatureConfirmed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <RefreshCw className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
          )}
          <span className="font-semibold">
            {signatureConfirmed
              ? "Assinatura recebida. Atualizando dados da ata..."
              : "Atualizando dados da ata..."}
          </span>
        </div>
        <Loader2 className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
      </div>
    );
  }

  // Falha de sincronização / limite de taxa
  if (status === "sync_error") {
    const isResume = pendingRecoveryAction === "resumePolling";
    let message = "Não foi possível atualizar os dados da ata.";
    if (isResume) {
      message = "Limite de consultas excedido. Aguarde antes de verificar novamente.";
    } else if (signatureConfirmed) {
      message = "Assinatura recebida, mas não foi possível atualizar a tela.";
    }

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs text-rose-950"
      >
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="font-semibold">{message}</span>
        </div>
        <div className="flex justify-end items-center space-x-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs cursor-pointer transition"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={onRetry}
            disabled={isBusy || isRateLimited}
            className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer transition flex items-center space-x-1.5"
          >
            {isBusy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            <span>{isResume ? "Retomar verificação" : "Tentar atualizar"}</span>
          </button>
        </div>
      </div>
    );
  }

  // Link expirado ou inativo
  if (status === "expired") {
    const message =
      expiredReason === "inactive"
        ? "Este link não está mais ativo."
        : "Este link de assinatura expirou.";

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950"
      >
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="font-semibold">{message}</span>
        </div>
        <div className="flex justify-end items-center space-x-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs cursor-pointer transition"
          >
            Fechar
          </button>
          {onRenewLink && (
            <button
              type="button"
              onClick={onRenewLink}
              className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs cursor-pointer transition"
            >
              Gerar novo QR Code
            </button>
          )}
        </div>
      </div>
    );
  }

  // Participante removido da ata
  if (status === "participant_removed") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="p-3.5 bg-slate-100 border border-slate-300 rounded-xl space-y-2 text-xs text-slate-800"
      >
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-slate-600 shrink-0" />
          <span className="font-semibold">Este participante não está mais vinculado à ata.</span>
        </div>
        <div className="flex justify-end items-center space-x-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs cursor-pointer transition"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={onRetry}
            disabled={isBusy}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold text-xs cursor-pointer transition flex items-center space-x-1.5"
          >
            {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            <span>Atualizar ata</span>
          </button>
        </div>
      </div>
    );
  }

  // Sessão expirada (401)
  if (status === "unauthorized") {
    const message = signatureConfirmed
      ? "Assinatura recebida. Entre novamente para atualizar os dados da ata."
      : "Sua sessão expirou.";

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs text-amber-950"
      >
        <div className="flex items-center space-x-2">
          <LogIn className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="font-semibold">{message}</span>
        </div>
        <div className="flex justify-end items-center space-x-2 pt-1">
          <button
            type="button"
            onClick={onLogin || (() => (window.location.href = "/login"))}
            className="px-3 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs cursor-pointer transition flex items-center space-x-1"
          >
            <LogIn className="w-3 h-3" />
            <span>Entrar novamente</span>
          </button>
        </div>
      </div>
    );
  }

  // Acesso negado (403)
  if (status === "forbidden") {
    const message = signatureConfirmed
      ? "Assinatura recebida. Sem permissão para atualizar os dados."
      : "Sem permissão para acompanhar esta assinatura.";

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs text-rose-950"
      >
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="font-semibold">{message}</span>
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer transition flex items-center space-x-1"
          >
            <X className="w-3 h-3" />
            <span>Fechar</span>
          </button>
        </div>
      </div>
    );
  }

  // Ata não encontrada (404)
  if (status === "not_found") {
    const message = signatureConfirmed
      ? "Assinatura recebida. A ata não está mais disponível para atualização."
      : "Esta ata não está mais disponível.";

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="p-3.5 bg-slate-100 border border-slate-300 rounded-xl space-y-2 text-xs text-slate-800"
      >
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-slate-600 shrink-0" />
          <span className="font-semibold">{message}</span>
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs cursor-pointer transition flex items-center space-x-1"
          >
            <X className="w-3 h-3" />
            <span>Fechar</span>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
