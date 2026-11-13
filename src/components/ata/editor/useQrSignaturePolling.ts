import { useEffect, useRef, useState } from "react";
import type { AtaParticipantDraft } from "./types";
import {
  createQrPollController,
  type QrPollController,
  type QrPollUiState,
} from "./qrPollController";

export interface UseQrSignaturePollingParams {
  minuteId: string | null;
  qrModalInfo: {
    participantId: string;
    url: string;
    name: string;
    expiresInMinutes: number;
    participantRole: string;
    openId: string;
  } | null;
  onParticipantsSynced: (participants: AtaParticipantDraft[]) => void;
  onCompletedClose: () => void;
  onSaved?: () => void;
}

export function useQrSignaturePolling({
  minuteId,
  qrModalInfo,
  onParticipantsSynced,
  onCompletedClose,
  onSaved,
}: UseQrSignaturePollingParams) {
  const [uiState, setUiState] = useState<QrPollUiState>({
    status: "waiting",
    signatureConfirmed: false,
    connectionWarning: false,
    isBusy: false,
  });

  const callbacksRef = useRef({
    onParticipantsSynced,
    onCompletedClose,
    onSaved,
  });

  useEffect(() => {
    callbacksRef.current = {
      onParticipantsSynced,
      onCompletedClose,
      onSaved,
    };
  }, [onParticipantsSynced, onCompletedClose, onSaved]);

  const controllerRef = useRef<QrPollController | null>(null);

  useEffect(() => {
    if (!qrModalInfo || !minuteId) {
      if (controllerRef.current) {
        controllerRef.current.dispose();
        controllerRef.current = null;
      }
      setUiState({
        status: "waiting",
        signatureConfirmed: false,
        connectionWarning: false,
        isBusy: false,
      });
      return;
    }

    const controller = createQrPollController(
      {
        minuteId,
        participantId: qrModalInfo.participantId,
        url: qrModalInfo.url,
        openId: qrModalInfo.openId,
        initialHidden: typeof document !== "undefined" ? document.hidden : false,
      },
      {
        onStateChange: (newState) => {
          setUiState(newState);
        },
        onParticipantsSynced: (parts) => {
          callbacksRef.current.onParticipantsSynced(parts);
        },
        onCompletedClose: () => {
          callbacksRef.current.onCompletedClose();
        },
        onSaved: () => {
          callbacksRef.current.onSaved?.();
        },
      }
    );

    controllerRef.current = controller;
    setUiState(controller.getState());

    const handleVisibility = () => {
      controller.handleVisibilityChange(document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [minuteId, qrModalInfo?.participantId, qrModalInfo?.url, qrModalInfo?.openId]);

  const handleRetryAction = async () => {
    if (controllerRef.current) {
      await controllerRef.current.handleRetryAction();
    }
  };

  const refreshMinute = async () => {
    if (controllerRef.current) {
      await controllerRef.current.refreshMinute();
    }
  };

  return {
    uiState,
    handleRetryAction,
    refreshMinute,
  };
}
