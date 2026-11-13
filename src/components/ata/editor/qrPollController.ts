import type { AtaParticipantDraft } from "./types";

export type QrPollStatus =
  | "waiting"
  | "syncing"
  | "sync_error"
  | "expired"
  | "participant_removed"
  | "unauthorized"
  | "forbidden"
  | "not_found";

export type SupportedSignatureMode =
  | "PENDING"
  | "SCREEN_CANVAS"
  | "MOBILE_QR"
  | "ESCOLA_OAUTH"
  | "PAPER_A4"
  | "REFUSED";

export type QrRecoveryAction =
  | "resumePolling"
  | "retryFinalSync"
  | "refreshMinute";

export interface QrPollUiState {
  status: QrPollStatus;
  signatureConfirmed: boolean;
  connectionWarning: boolean;
  isBusy: boolean;
  pendingRecoveryAction?: QrRecoveryAction;
  expiredReason?: "expired" | "inactive";
  retryAllowedAt?: number;
}

export interface QrPollCallbacks {
  onStateChange: (state: QrPollUiState) => void;
  onParticipantsSynced: (participants: AtaParticipantDraft[]) => void;
  onCompletedClose: () => void;
  onSaved?: () => void;
}

export interface QrPollConfig {
  minuteId: string;
  participantId: string;
  url: string;
  openId: string;
  initialHidden?: boolean;
}

export interface QrPollController {
  dispose: () => void;
  handleVisibilityChange: (hidden: boolean) => void;
  handleRetryAction: () => Promise<void>;
  refreshMinute: () => Promise<void>;
  getState: () => QrPollUiState;
}

const SUPPORTED_SIGNATURE_MODES = new Set<SupportedSignatureMode>([
  "PENDING",
  "SCREEN_CANVAS",
  "MOBILE_QR",
  "ESCOLA_OAUTH",
  "PAPER_A4",
  "REFUSED",
]);

interface PollParticipantItem {
  participantId: string;
  role: string;
  signatureMode: SupportedSignatureMode;
  hasSignature: boolean;
  hasActiveSignLink: boolean;
  institutionalVerificationComplete: boolean;
  linkExpired: boolean;
}

export function parseRetryAfterHeader(headerValue: string | null | undefined, fallbackMs = 10_000): number {
  if (!headerValue || typeof headerValue !== "string") return fallbackMs;
  const trimmed = headerValue.trim();
  if (!trimmed) return fallbackMs;

  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.max(1000, Math.round(seconds * 1000));
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const deltaMs = parsedDate - Date.now();
    return Math.max(1000, deltaMs);
  }

  return fallbackMs;
}

function cancellableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", onAbort);
  });
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal
): Promise<{ status: number; ok: boolean; headers: Headers; data: any }> {
  const timeoutController = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  function onParentAbort() {
    timeoutController.abort();
  }

  parentSignal.addEventListener("abort", onParentAbort);

  try {
    const res = await fetch(url, { signal: timeoutController.signal });
    const data = await res.json().catch(() => null);
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      data,
    };
  } catch (err: any) {
    if (timedOut) {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}

export function validatePollParticipantsContract(
  minuteId: string,
  data: any
): { ok: true; participants: PollParticipantItem[] } | { ok: false } {
  if (!data || typeof data !== "object") return { ok: false };
  if (data.poll !== true || data.minuteId !== minuteId) return { ok: false };
  if (!Array.isArray(data.participants)) return { ok: false };

  const parsed: PollParticipantItem[] = [];
  for (const item of data.participants) {
    if (!item || typeof item !== "object") return { ok: false };
    if (typeof item.participantId !== "string" || !item.participantId.trim()) return { ok: false };
    if (typeof item.role !== "string") return { ok: false };
    if (!SUPPORTED_SIGNATURE_MODES.has(item.signatureMode)) return { ok: false };
    if (typeof item.hasSignature !== "boolean") return { ok: false };
    if (typeof item.hasActiveSignLink !== "boolean") return { ok: false };
    if (typeof item.institutionalVerificationComplete !== "boolean") return { ok: false };
    if (typeof item.linkExpired !== "boolean") return { ok: false };

    parsed.push({
      participantId: item.participantId,
      role: item.role,
      signatureMode: item.signatureMode,
      hasSignature: item.hasSignature,
      hasActiveSignLink: item.hasActiveSignLink,
      institutionalVerificationComplete: item.institutionalVerificationComplete,
      linkExpired: item.linkExpired,
    });
  }

  return { ok: true, participants: parsed };
}

export function validateFullMinuteResponse(
  minuteId: string,
  data: any
): { ok: true; participants: AtaParticipantDraft[] } | { ok: false } {
  if (!data || typeof data !== "object") return { ok: false };
  if (data.success !== true && data.minute === undefined) return { ok: false };
  const minute = data.minute;
  if (!minute || typeof minute !== "object") return { ok: false };
  if (minute.id !== minuteId) return { ok: false };
  if (!Array.isArray(minute.participants)) return { ok: false };

  for (const p of minute.participants) {
    if (!p || typeof p !== "object") return { ok: false };
    if (typeof p.id !== "string" || !p.id.trim()) return { ok: false };
    if (typeof p.name !== "string") return { ok: false };
    if (typeof p.role !== "string") return { ok: false };
    if (!SUPPORTED_SIGNATURE_MODES.has(p.signatureMode)) return { ok: false };
    if (typeof p.hasSignature !== "boolean") return { ok: false };
  }

  return { ok: true, participants: minute.participants as AtaParticipantDraft[] };
}

export function createQrPollController(
  config: QrPollConfig,
  callbacks: QrPollCallbacks
): QrPollController {
  const { minuteId, participantId } = config;
  let disposed = false;
  let activeExecutionId = 0;
  let mainAbortController: AbortController | null = new AbortController();

  let isHidden = Boolean(config.initialHidden);
  let isPollingInFlight = false;
  let pollRequestSeq = 0;
  let consecutivePollFailures = 0;
  let rateLimitTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledPollTimer: ReturnType<typeof setTimeout> | null = null;

  let state: QrPollUiState = {
    status: "waiting",
    signatureConfirmed: false,
    connectionWarning: false,
    isBusy: false,
  };

  function updateState(partial: Partial<QrPollUiState>) {
    if (disposed) return;
    state = { ...state, ...partial };
    callbacks.onStateChange(state);
  }

  function clearTimers() {
    if (rateLimitTimer) {
      clearTimeout(rateLimitTimer);
      rateLimitTimer = null;
    }
    if (scheduledPollTimer) {
      clearTimeout(scheduledPollTimer);
      scheduledPollTimer = null;
    }
  }

  function scheduleRateLimitExpiration(delayMs: number) {
    if (rateLimitTimer) clearTimeout(rateLimitTimer);
    rateLimitTimer = setTimeout(() => {
      rateLimitTimer = null;
      if (disposed) return;
      updateState({ retryAllowedAt: undefined });
    }, Math.max(0, delayMs));
  }

  async function fetchFullMinute(
    executionId: number,
    preserveConfirmation: boolean
  ): Promise<boolean> {
    if (disposed || executionId !== activeExecutionId) return false;

    pollRequestSeq += 1;
    if (scheduledPollTimer) {
      clearTimeout(scheduledPollTimer);
      scheduledPollTimer = null;
    }

    updateState({
      status: "syncing",
      isBusy: true,
      pendingRecoveryAction: preserveConfirmation ? "retryFinalSync" : "refreshMinute",
    });

    const maxAttempts = 3; // 1 inicial + 2 retentativas
    let attempt = 0;

    while (attempt < maxAttempts) {
      if (disposed || executionId !== activeExecutionId) return false;
      attempt += 1;

      try {
        const result = await fetchJsonWithTimeout(
          `/api/atas/${minuteId}`,
          12_000,
          mainAbortController!.signal
        );

        if (disposed || executionId !== activeExecutionId) return false;

        if (result.status === 401) {
          updateState({ status: "unauthorized", isBusy: false });
          return false;
        }
        if (result.status === 403) {
          updateState({ status: "forbidden", isBusy: false });
          return false;
        }
        if (result.status === 404) {
          updateState({ status: "not_found", isBusy: false });
          callbacks.onSaved?.();
          return false;
        }

        if (result.status === 429) {
          const retryMs = parseRetryAfterHeader(result.headers.get("retry-after"), 10_000);
          const allowedAt = Date.now() + retryMs;
          if (retryMs > 30_000) {
            scheduleRateLimitExpiration(retryMs);
            updateState({
              status: "sync_error",
              retryAllowedAt: allowedAt,
              isBusy: false,
              pendingRecoveryAction: preserveConfirmation ? "retryFinalSync" : "refreshMinute",
            });
            return false;
          }
          if (attempt < maxAttempts) {
            await cancellableSleep(retryMs, mainAbortController!.signal);
            continue;
          }
          scheduleRateLimitExpiration(retryMs);
          updateState({
            status: "sync_error",
            retryAllowedAt: allowedAt,
            isBusy: false,
            pendingRecoveryAction: preserveConfirmation ? "retryFinalSync" : "refreshMinute",
          });
          return false;
        }

        if (result.ok) {
          const validated = validateFullMinuteResponse(minuteId, result.data);
          if (validated.ok) {
            callbacks.onParticipantsSynced(validated.participants);

            if (preserveConfirmation) {
              updateState({ isBusy: false });
              callbacks.onCompletedClose();
              return true;
            }

            // Fluxo pós-refreshMinute: reavalia se o participante reapareceu
            const found = validated.participants.find((p) => p.id === participantId);
            if (!found) {
              updateState({
                status: "participant_removed",
                isBusy: false,
                pendingRecoveryAction: "refreshMinute",
              });
              return false;
            }

            const isDone =
              found.signatureMode === "ESCOLA_OAUTH"
                ? Boolean(found.hasSignature && (found as any).verifiedEmail)
                : Boolean(found.hasSignature);

            if (isDone) {
              updateState({
                signatureConfirmed: true,
                isBusy: false,
              });
              callbacks.onCompletedClose();
              return true;
            }

            if ((found as any).hasActiveSignLink === false) {
              updateState({
                status: "expired",
                expiredReason: "inactive",
                isBusy: false,
                pendingRecoveryAction: undefined,
              });
              return false;
            }

            // Participante reapareceu pendente e com link ativo: retoma polling
            updateState({
              status: "waiting",
              isBusy: false,
              pendingRecoveryAction: undefined,
            });
            scheduleNextPoll(executionId, 2500);
            return true;
          }
        }
      } catch (err: any) {
        if (disposed || executionId !== activeExecutionId) return false;
        if (err?.name === "AbortError") {
          return false;
        }
      }

      if (attempt < maxAttempts) {
        const backoffMs = attempt === 1 ? 500 : 1500;
        try {
          await cancellableSleep(backoffMs, mainAbortController!.signal);
        } catch {
          return false;
        }
      }
    }

    if (!disposed && executionId === activeExecutionId) {
      updateState({
        status: "sync_error",
        isBusy: false,
        pendingRecoveryAction: preserveConfirmation ? "retryFinalSync" : "refreshMinute",
      });
    }

    return false;
  }

  function scheduleNextPoll(executionId: number, delayMs: number) {
    if (disposed || executionId !== activeExecutionId || isHidden) return;
    if (state.status !== "waiting") return;
    if (scheduledPollTimer) clearTimeout(scheduledPollTimer);

    scheduledPollTimer = setTimeout(() => {
      scheduledPollTimer = null;
      void runPollCycle(executionId);
    }, delayMs);
  }

  async function runPollCycle(executionId: number): Promise<void> {
    if (disposed || executionId !== activeExecutionId) return;
    if (isHidden || state.status !== "waiting" || state.isBusy || isPollingInFlight) return;

    if (state.retryAllowedAt && Date.now() < state.retryAllowedAt) {
      const waitRemaining = Math.max(1000, state.retryAllowedAt - Date.now());
      scheduleNextPoll(executionId, waitRemaining);
      return;
    }

    const currentPollSeq = ++pollRequestSeq;
    isPollingInFlight = true;

    try {
      const result = await fetchJsonWithTimeout(
        `/api/atas/${minuteId}?poll=1`,
        8000,
        mainAbortController!.signal
      );

      if (disposed || executionId !== activeExecutionId || currentPollSeq !== pollRequestSeq) return;
      if (state.status !== "waiting" || state.isBusy) return;

      if (result.status === 401) {
        updateState({ status: "unauthorized" });
        return;
      }
      if (result.status === 403) {
        updateState({ status: "forbidden" });
        return;
      }
      if (result.status === 404) {
        updateState({ status: "not_found" });
        callbacks.onSaved?.();
        return;
      }
      if (result.status === 410) {
        updateState({ status: "expired", expiredReason: "expired" });
        return;
      }

      if (result.status === 429) {
        const retryMs = parseRetryAfterHeader(result.headers.get("retry-after"), 10_000);
        const allowedAt = Date.now() + retryMs;
        scheduleRateLimitExpiration(retryMs);

        if (retryMs > 30_000) {
          updateState({
            status: "sync_error",
            pendingRecoveryAction: "resumePolling",
            retryAllowedAt: allowedAt,
          });
          return;
        }

        updateState({ retryAllowedAt: allowedAt });
        scheduleNextPoll(executionId, retryMs);
        return;
      }

      if (result.ok) {
        const validated = validatePollParticipantsContract(minuteId, result.data);
        if (validated.ok) {
          consecutivePollFailures = 0;
          if (state.connectionWarning) {
            updateState({ connectionWarning: false });
          }

          const targetPart = validated.participants.find((p) => p.participantId === participantId);

          if (!targetPart) {
            updateState({
              status: "participant_removed",
              pendingRecoveryAction: "refreshMinute",
            });
            return;
          }

          const isCompleted =
            targetPart.signatureMode === "ESCOLA_OAUTH"
              ? targetPart.hasSignature && targetPart.institutionalVerificationComplete
              : targetPart.hasSignature;

          if (isCompleted) {
            updateState({
              signatureConfirmed: true,
              status: "syncing",
            });
            void fetchFullMinute(executionId, true);
            return;
          }

          if (targetPart.linkExpired) {
            updateState({ status: "expired", expiredReason: "expired" });
            return;
          }

          if (!targetPart.hasActiveSignLink) {
            updateState({ status: "expired", expiredReason: "inactive" });
            return;
          }

          scheduleNextPoll(executionId, 2500);
          return;
        }
      }

      // Respostas malformadas ou HTTP 400/408/409/422/5xx
      consecutivePollFailures += 1;
      updateState({
        connectionWarning: consecutivePollFailures >= 3,
      });
      scheduleNextPoll(executionId, 5000);
    } catch (err: any) {
      if (disposed || executionId !== activeExecutionId || currentPollSeq !== pollRequestSeq) return;
      if (err?.name === "AbortError") return;

      consecutivePollFailures += 1;
      updateState({
        connectionWarning: consecutivePollFailures >= 3,
      });
      scheduleNextPoll(executionId, 5000);
    } finally {
      isPollingInFlight = false;
      if (
        !disposed &&
        executionId === activeExecutionId &&
        !isHidden &&
        state.status === "waiting" &&
        !state.isBusy &&
        !scheduledPollTimer
      ) {
        if (state.retryAllowedAt && Date.now() < state.retryAllowedAt) {
          const remaining = Math.max(1000, state.retryAllowedAt - Date.now());
          scheduleNextPoll(executionId, remaining);
        } else {
          scheduleNextPoll(executionId, 2500);
        }
      }
    }
  }

  function handleVisibilityChange(hidden: boolean) {
    if (disposed) return;
    isHidden = hidden;
    if (hidden) {
      if (scheduledPollTimer) {
        clearTimeout(scheduledPollTimer);
        scheduledPollTimer = null;
      }
    } else {
      if (state.status === "waiting") {
        if (state.retryAllowedAt && Date.now() < state.retryAllowedAt) {
          const remaining = Math.max(1000, state.retryAllowedAt - Date.now());
          scheduleNextPoll(activeExecutionId, remaining);
        } else {
          void runPollCycle(activeExecutionId);
        }
      }
    }
  }

  async function refreshMinute(): Promise<void> {
    if (disposed || state.isBusy) return;
    if (state.retryAllowedAt && Date.now() < state.retryAllowedAt) return;
    await fetchFullMinute(activeExecutionId, false);
  }

  async function handleRetryAction(): Promise<void> {
    if (disposed || state.isBusy) return;
    if (state.retryAllowedAt && Date.now() < state.retryAllowedAt) return;

    const action = state.pendingRecoveryAction;
    if (action === "resumePolling") {
      updateState({
        status: "waiting",
        retryAllowedAt: undefined,
        pendingRecoveryAction: undefined,
      });
      void runPollCycle(activeExecutionId);
      return;
    }

    if (action === "refreshMinute") {
      void fetchFullMinute(activeExecutionId, false);
      return;
    }

    if (action === "retryFinalSync" && state.signatureConfirmed) {
      void fetchFullMinute(activeExecutionId, true);
      return;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    activeExecutionId += 1;
    pollRequestSeq += 1;
    clearTimers();
    if (mainAbortController) {
      mainAbortController.abort();
      mainAbortController = null;
    }
  }

  // Inicializa a primeira execução
  activeExecutionId += 1;
  if (!isHidden) {
    scheduleNextPoll(activeExecutionId, 2500);
  }

  return {
    dispose,
    handleVisibilityChange,
    handleRetryAction,
    refreshMinute,
    getState: () => state,
  };
}
