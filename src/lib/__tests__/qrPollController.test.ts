import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createQrPollController,
  validatePollParticipantsContract,
  validateFullMinuteResponse,
  parseRetryAfterHeader,
} from "@/components/ata/editor/qrPollController";

describe("qrPollController (Máquina de Estados e Resiliência)", () => {
  const minuteId = "minute-test-123";
  const participantId = "part-abc";
  const config = {
    minuteId,
    participantId,
    url: "https://www.redeativa.app.br/assinar/ata/token-123",
    openId: "open-uuid-1",
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  describe("parseRetryAfterHeader", () => {
    it("converte segundos em milissegundos", () => {
      expect(parseRetryAfterHeader("15")).toBe(15_000);
      expect(parseRetryAfterHeader("0")).toBe(1000); // Mínimo defensivo 1s
    });

    it("interpreta data HTTP RFC 7231", () => {
      const now = Date.now();
      const futureDate = new Date(now + 25_000).toUTCString();
      const delta = parseRetryAfterHeader(futureDate);
      expect(delta).toBeGreaterThanOrEqual(24_000);
      expect(delta).toBeLessThanOrEqual(26_000);
    });

    it("aplica fallback em cabeçalho ausente ou inválido", () => {
      expect(parseRetryAfterHeader(null, 10_000)).toBe(10_000);
      expect(parseRetryAfterHeader("data-invalida", 8000)).toBe(8000);
    });
  });

  describe("Validação de Contrato", () => {
    it("validatePollParticipantsContract valida campos e rejeita modos inválidos", () => {
      const valid = {
        poll: true,
        minuteId,
        participants: [
          {
            participantId,
            role: "RESPONSAVEL",
            signatureMode: "MOBILE_QR",
            hasSignature: true,
            hasActiveSignLink: false,
            institutionalVerificationComplete: false,
            linkExpired: false,
          },
        ],
      };
      const res = validatePollParticipantsContract(minuteId, valid);
      expect(res.ok).toBe(true);

      const invalidMode = {
        ...valid,
        participants: [{ ...valid.participants[0], signatureMode: "MODO_INVENTADO" }],
      };
      expect(validatePollParticipantsContract(minuteId, invalidMode).ok).toBe(false);

      const missingId = {
        ...valid,
        participants: [{ ...valid.participants[0], participantId: "" }],
      };
      expect(validatePollParticipantsContract(minuteId, missingId).ok).toBe(false);
    });

    it("validateFullMinuteResponse rejeita [null] ou participantes corrompidos", () => {
      expect(validateFullMinuteResponse(minuteId, { success: true, minute: { id: minuteId, participants: [null] } }).ok).toBe(false);
      expect(validateFullMinuteResponse(minuteId, { success: true, minute: { id: minuteId, participants: [{ id: "1" }] } }).ok).toBe(false);

      const validFull = {
        success: true,
        minute: {
          id: minuteId,
          participants: [
            {
              id: participantId,
              name: "Maria da Silva",
              role: "RESPONSAVEL",
              signatureMode: "MOBILE_QR",
              hasSignature: true,
            },
          ],
        },
      };
      expect(validateFullMinuteResponse(minuteId, validFull).ok).toBe(true);
    });
  });

  describe("Ciclo de Polling e Concorrência", () => {
    it("não dispara chamadas simultâneas se a anterior estiver pendente", async () => {
      let pendingResolvers: Array<() => void> = [];
      const fetchMock = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          pendingResolvers.push(() =>
            resolve(
              new Response(
                JSON.stringify({
                  poll: true,
                  minuteId,
                  participants: [
                    {
                      participantId,
                      role: "RESPONSAVEL",
                      signatureMode: "MOBILE_QR",
                      hasSignature: false,
                      hasActiveSignLink: true,
                      institutionalVerificationComplete: false,
                      linkExpired: false,
                    },
                  ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              )
            )
          );
        });
      });
      globalThis.fetch = fetchMock;

      const onStateChange = vi.fn();
      const controller = createQrPollController(config, {
        onStateChange,
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      // Avança para o primeiro tick
      await vi.advanceTimersByTimeAsync(2500);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Avança mais tempo enquanto a primeira chamada ainda não resolveu
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(1); // Não duplicou!

      // Resolve a primeira requisição
      pendingResolvers[0]();
      await vi.advanceTimersByTimeAsync(100);

      // Próximo tick agendado para 2.5s depois
      await vi.advanceTimersByTimeAsync(2500);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      controller.dispose();
    });

    it("descarte total: dispose aborta requisição e cancela retentativas", async () => {
      let aborted = false;
      const fetchMock = vi.fn().mockImplementation((_url, opts) => {
        opts.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {}); // pendente para sempre
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(aborted).toBe(false);

      controller.dispose();
      expect(aborted).toBe(true);

      // Avança tempo: nenhuma chamada subsequente
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("ordem de avaliação: assinatura completa com link expirado reconhece a assinatura", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("?poll=1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: true, // Conflito: assinado porém expirado!
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        // Busca completa subsequente
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              minute: {
                id: minuteId,
                participants: [
                  {
                    id: participantId,
                    name: "Responsável",
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const onCompletedClose = vi.fn();
      const onParticipantsSynced = vi.fn();
      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced,
        onCompletedClose,
      });

      await vi.advanceTimersByTimeAsync(2500); // Polling dispara
      await vi.advanceTimersByTimeAsync(100);  // Sync final dispara

      expect(controller.getState().signatureConfirmed).toBe(true);
      expect(onParticipantsSynced).toHaveBeenCalledTimes(1);
      expect(onCompletedClose).toHaveBeenCalledTimes(1);

      controller.dispose();
    });

    it("ESCOLA_OAUTH pendente: hasSignature=true sem verifiedEmail mantém em waiting", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            poll: true,
            minuteId,
            participants: [
              {
                participantId,
                role: "PROFESSOR",
                signatureMode: "ESCOLA_OAUTH",
                hasSignature: true,
                hasActiveSignLink: true,
                institutionalVerificationComplete: false, // Pendente!
                linkExpired: false,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(controller.getState().status).toBe("waiting");
      expect(controller.getState().signatureConfirmed).toBe(false);

      controller.dispose();
    });

    it("identidade estrita: homônimos com IDs distintos; ignora outro participantId", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            poll: true,
            minuteId,
            participants: [
              {
                participantId: "outro-participante-id",
                role: "RESPONSAVEL",
                signatureMode: "MOBILE_QR",
                hasSignature: true,
                hasActiveSignLink: false,
                institutionalVerificationComplete: false,
                linkExpired: false,
              },
              {
                participantId,
                role: "RESPONSAVEL",
                signatureMode: "MOBILE_QR",
                hasSignature: false,
                hasActiveSignLink: true,
                institutionalVerificationComplete: false,
                linkExpired: false,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(controller.getState().signatureConfirmed).toBe(false);
      expect(controller.getState().status).toBe("waiting");

      controller.dispose();
    });
  });

  describe("Timeouts e Resiliência HTTP", () => {
    it("timeout no polling após 8s é tratado como erro transitório e reagenda em 5s", async () => {
      const fetchMock = vi.fn().mockImplementation((_url, opts) => {
        return new Promise((_, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("Request timed out");
            err.name = "TimeoutError";
            reject(err);
          });
        });
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500); // dispara
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8000); // estoura timeout
      expect(controller.getState().status).toBe("waiting");

      await vi.advanceTimersByTimeAsync(5000); // reagendamento pós-falha
      expect(fetchMock).toHaveBeenCalledTimes(2);

      controller.dispose();
    });

    it("orçamento unificado na busca completa: exatamente 3 chamadas (1 inicial + 2 retries) e transita para sync_error", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("?poll=1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: false,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        // Busca completa com erro 500 persistente
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500); // Poll confirma assinatura
      expect(controller.getState().signatureConfirmed).toBe(true);

      // Tentativa 1 (imediata)
      await vi.advanceTimersByTimeAsync(50);
      // Tentativa 2 (após 500ms)
      await vi.advanceTimersByTimeAsync(500);
      // Tentativa 3 (após 1500ms)
      await vi.advanceTimersByTimeAsync(1500);

      // 1 chamada de polling + 3 tentativas da busca completa = 4 chamadas
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(controller.getState().status).toBe("sync_error");
      expect(controller.getState().signatureConfirmed).toBe(true);
      expect(controller.getState().pendingRecoveryAction).toBe("retryFinalSync");

      controller.dispose();
    });

    it("Retry-After > 30s no polling transita para sync_error com resumePolling e reabilita após o prazo", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "45", // 45 segundos
          },
        })
      );
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);

      const state = controller.getState();
      expect(state.status).toBe("sync_error");
      expect(state.pendingRecoveryAction).toBe("resumePolling");
      expect(state.retryAllowedAt).toBeDefined();

      // Antes do prazo de 45s: clique manual em retry não faz nada
      await controller.handleRetryAction();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Avança o relógio além dos 45s: timer de taxa acorda e limpa retryAllowedAt
      await vi.advanceTimersByTimeAsync(46_000);
      expect(controller.getState().retryAllowedAt).toBeUndefined();

      // Agora o clique manual retoma o polling com sucesso
      await controller.handleRetryAction();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      controller.dispose();
    });

    it("refreshMinute mantém participant_removed caso o participante continue ausente", async () => {
      let isPollCall = true;
      const fetchMock = vi.fn().mockImplementation(() => {
        if (isPollCall) {
          isPollCall = false;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [], // Ausente!
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        // Resposta da busca completa pelo refreshMinute
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              minute: {
                id: minuteId,
                participants: [
                  {
                    id: "outro-part",
                    name: "Outro Participante",
                    role: "EQUIPE_ESCOLAR",
                    signatureMode: "SCREEN_CANVAS",
                    hasSignature: false,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(controller.getState().status).toBe("participant_removed");
      expect(controller.getState().pendingRecoveryAction).toBe("refreshMinute");

      // Clica em atualizar ata
      await controller.handleRetryAction();
      await vi.advanceTimersByTimeAsync(100);

      // Permanece em participant_removed sem presumir assinatura
      expect(controller.getState().status).toBe("participant_removed");
      expect(controller.getState().signatureConfirmed).toBe(false);

      controller.dispose();
    });

    it("timeout durante a leitura do corpo (response.json() travado) é tratado como falha transitória", async () => {
      const fetchMock = vi.fn().mockImplementation((_url, opts) => {
        return Promise.resolve({
          status: 200,
          ok: true,
          headers: new Headers(),
          json: () =>
            new Promise((_resolve, reject) => {
              opts.signal.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }),
        });
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8000);
      expect(controller.getState().status).toBe("waiting");

      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      controller.dispose();
    });

    it("timeout de 12s na busca completa preserva signatureConfirmed e transita para sync_error", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string, opts: any) => {
        if (url.includes("?poll=1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: false,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(controller.getState().signatureConfirmed).toBe(true);
      expect(controller.getState().status).toBe("syncing");

      // 3 tentativas de 12s + backoffs (500ms + 1500ms)
      await vi.advanceTimersByTimeAsync(12_000);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(12_000);
      await vi.advanceTimersByTimeAsync(1500);
      await vi.advanceTimersByTimeAsync(12_000);

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(controller.getState().status).toBe("sync_error");
      expect(controller.getState().signatureConfirmed).toBe(true);
      expect(controller.getState().pendingRecoveryAction).toBe("retryFinalSync");
      expect(controller.getState().isBusy).toBe(false);

      controller.dispose();
    });

    it.each([
      { statusCode: 401, expectedStatus: "unauthorized", expectsOnSaved: false },
      { statusCode: 403, expectedStatus: "forbidden", expectsOnSaved: false },
      { statusCode: 404, expectedStatus: "not_found", expectsOnSaved: true },
    ])(
      "preserva signatureConfirmed=true se a busca completa retornar HTTP $statusCode",
      async ({ statusCode, expectedStatus, expectsOnSaved }) => {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
          if (url.includes("?poll=1")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  poll: true,
                  minuteId,
                  participants: [
                    {
                      participantId,
                      role: "RESPONSAVEL",
                      signatureMode: "MOBILE_QR",
                      hasSignature: true,
                      hasActiveSignLink: false,
                      institutionalVerificationComplete: false,
                      linkExpired: false,
                    },
                  ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              )
            );
          }

          return Promise.resolve(new Response("Erro", { status: statusCode }));
        });
        globalThis.fetch = fetchMock;

        const onSaved = vi.fn();
        const controller = createQrPollController(config, {
          onStateChange: vi.fn(),
          onParticipantsSynced: vi.fn(),
          onCompletedClose: vi.fn(),
          onSaved,
        });

        await vi.advanceTimersByTimeAsync(2500);
        await vi.advanceTimersByTimeAsync(50);

        expect(controller.getState().status).toBe(expectedStatus);
        expect(controller.getState().signatureConfirmed).toBe(true);
        expect(controller.getState().isBusy).toBe(false);
        expect(onSaved).toHaveBeenCalledTimes(expectsOnSaved ? 1 : 0);

        controller.dispose();
      }
    );

    it("Retry-After em formato data HTTP respeita o prazo e retorno à aba antes do prazo não antecipa", async () => {
      const targetDate = new Date(Date.now() + 20_000).toUTCString();
      let callIndex = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        callIndex += 1;
        if (callIndex === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Rate limit" }), {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": targetDate,
              },
            })
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              poll: true,
              minuteId,
              participants: [
                {
                  participantId,
                  role: "RESPONSAVEL",
                  signatureMode: "MOBILE_QR",
                  hasSignature: false,
                  hasActiveSignLink: true,
                  institutionalVerificationComplete: false,
                  linkExpired: false,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Usuário sai e volta à aba após apenas 5s (antes dos ~17.5s restantes)
      controller.handleVisibilityChange(true);
      await vi.advanceTimersByTimeAsync(5000);
      controller.handleVisibilityChange(false);

      // Não pode antecipar a requisição
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Avança exatamente até o prazo restante (~12.5s): reagendamento dispara no prazo certo
      await vi.advanceTimersByTimeAsync(12_600);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      controller.dispose();
    });

    it("busca completa inválida ([null] ou JSON corrompido com HTTP 200) não fecha modal e entra em sync_error", async () => {
      let attempt = 0;
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("?poll=1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: false,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        attempt += 1;
        if (attempt === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, minute: { id: minuteId, participants: [null] } }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return Promise.resolve(new Response("{json-invalido", { status: 200 }));
      });
      globalThis.fetch = fetchMock;

      const onParticipantsSynced = vi.fn();
      const onCompletedClose = vi.fn();
      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced,
        onCompletedClose,
      });

      await vi.advanceTimersByTimeAsync(2500);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1500);

      expect(onParticipantsSynced).not.toHaveBeenCalled();
      expect(onCompletedClose).not.toHaveBeenCalled();
      expect(controller.getState().status).toBe("sync_error");
      expect(controller.getState().signatureConfirmed).toBe(true);

      controller.dispose();
    });

    it.each([
      {
        label: "assinado -> conclui e fecha",
        returnedPart: {
          id: participantId,
          name: "Responsável",
          role: "RESPONSAVEL",
          signatureMode: "MOBILE_QR",
          hasSignature: true,
          hasActiveSignLink: false,
        },
        expectedStatus: "waiting", // fecha antes via onCompletedClose
        expectsClose: true,
        expectsConfirmed: true,
      },
      {
        label: "pendente com link ativo -> retoma waiting",
        returnedPart: {
          id: participantId,
          name: "Responsável",
          role: "RESPONSAVEL",
          signatureMode: "MOBILE_QR",
          hasSignature: false,
          hasActiveSignLink: true,
        },
        expectedStatus: "waiting",
        expectsClose: false,
        expectsConfirmed: false,
      },
      {
        label: "com link inativo -> transita para expired (inactive)",
        returnedPart: {
          id: participantId,
          name: "Responsável",
          role: "RESPONSAVEL",
          signatureMode: "MOBILE_QR",
          hasSignature: false,
          hasActiveSignLink: false,
        },
        expectedStatus: "expired",
        expectsClose: false,
        expectsConfirmed: false,
      },
    ])(
      "refreshMinute() quando participante reaparece ($label)",
      async ({ returnedPart, expectedStatus, expectsClose, expectsConfirmed }) => {
        let isPollCall = true;
        const fetchMock = vi.fn().mockImplementation(() => {
          if (isPollCall) {
            isPollCall = false;
            return Promise.resolve(
              new Response(JSON.stringify({ poll: true, minuteId, participants: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                minute: {
                  id: minuteId,
                  participants: [returnedPart],
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        });
        globalThis.fetch = fetchMock;

        const onCompletedClose = vi.fn();
        const controller = createQrPollController(config, {
          onStateChange: vi.fn(),
          onParticipantsSynced: vi.fn(),
          onCompletedClose,
        });

        await vi.advanceTimersByTimeAsync(2500);
        expect(controller.getState().status).toBe("participant_removed");

        await controller.handleRetryAction();
        await vi.advanceTimersByTimeAsync(50);

        expect(controller.getState().signatureConfirmed).toBe(expectsConfirmed);
        expect(onCompletedClose).toHaveBeenCalledTimes(expectsClose ? 1 : 0);
        if (!expectsClose) {
          expect(controller.getState().status).toBe(expectedStatus);
        }

        controller.dispose();
      }
    );

    it("cancelamento durante espera de retentativa (500ms) não atualiza estado após dispose", async () => {
      let fullCalls = 0;
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("?poll=1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: false,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        fullCalls += 1;
        return Promise.resolve(new Response("Erro 500", { status: 500 }));
      });
      globalThis.fetch = fetchMock;

      const onStateChange = vi.fn();
      const controller = createQrPollController(config, {
        onStateChange,
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      await vi.advanceTimersByTimeAsync(10); // primeira chamada completa falhou -> entrou no sleep de 500ms
      expect(fullCalls).toBe(1);

      const callsBeforeDispose = onStateChange.mock.calls.length;
      controller.dispose();

      // Avança além dos 500ms e 1500ms: não pode fazer novas chamadas nem alterar estado
      await vi.advanceTimersByTimeAsync(5000);
      expect(fullCalls).toBe(1);
      expect(onStateChange.mock.calls.length).toBe(callsBeforeDispose);
    });

    it("alternar visibilidade enquanto polling está em andamento não duplica requisição", async () => {
      let resolveFirstPoll!: (res: Response) => void;
      let pollCalls = 0;

      const fetchMock = vi.fn().mockImplementation(() => {
        pollCalls += 1;
        if (pollCalls === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirstPoll = resolve;
          });
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              poll: true,
              minuteId,
              participants: [
                {
                  participantId,
                  role: "RESPONSAVEL",
                  signatureMode: "PENDING",
                  hasSignature: false,
                  hasActiveSignLink: true,
                  institutionalVerificationComplete: false,
                  linkExpired: false,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(pollCalls).toBe(1);

      // Aba oculta e volta a ficar visível com a primeira requisição ainda pendente
      controller.handleVisibilityChange(true);
      controller.handleVisibilityChange(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(pollCalls).toBe(1);

      // Ao resolver a primeira requisição (com aba visível), agenda o próximo ciclo normalmente
      resolveFirstPoll(
        new Response(
          JSON.stringify({
            poll: true,
            minuteId,
            participants: [
              {
                participantId,
                role: "RESPONSAVEL",
                signatureMode: "PENDING",
                hasSignature: false,
                hasActiveSignLink: true,
                institutionalVerificationComplete: false,
                linkExpired: false,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      await vi.advanceTimersByTimeAsync(2500);
      expect(pollCalls).toBe(2);

      controller.dispose();
    });

    it("aba oculta durante requisição em andamento impede novo agendamento até voltar a ficar visível", async () => {
      let resolveInFlight!: (res: Response) => void;
      let pollCalls = 0;

      const fetchMock = vi.fn().mockImplementation(() => {
        pollCalls += 1;
        if (pollCalls === 1) {
          return new Promise<Response>((resolve) => {
            resolveInFlight = resolve;
          });
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              poll: true,
              minuteId,
              participants: [
                {
                  participantId,
                  role: "RESPONSAVEL",
                  signatureMode: "PENDING",
                  hasSignature: false,
                  hasActiveSignLink: true,
                  institutionalVerificationComplete: false,
                  linkExpired: false,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(pollCalls).toBe(1);

      // Oculta a aba antes da resposta chegar
      controller.handleVisibilityChange(true);
      resolveInFlight(
        new Response(
          JSON.stringify({
            poll: true,
            minuteId,
            participants: [
              {
                participantId,
                role: "RESPONSAVEL",
                signatureMode: "PENDING",
                hasSignature: false,
                hasActiveSignLink: true,
                institutionalVerificationComplete: false,
                linkExpired: false,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      // Mesmo após avançar muito o relógio, não dispara nova consulta com a aba oculta
      await vi.advanceTimersByTimeAsync(15_000);
      expect(pollCalls).toBe(1);

      // Ao voltar à aba, retoma normalmente
      controller.handleVisibilityChange(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(pollCalls).toBe(2);

      controller.dispose();
    });

    it("handleRetryAction não fecha painel nem dispara retryFinalSync quando estado é expired sem assinatura", async () => {
      let fullCalls = 0;
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("?poll=1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "PENDING",
                    hasSignature: false,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: true,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        fullCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              minute: {
                id: minuteId,
                participants: [
                  {
                    id: participantId,
                    name: "Mãe",
                    role: "RESPONSAVEL",
                    signatureMode: "PENDING",
                    hasSignature: false,
                    hasActiveSignLink: true,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const onCompletedClose = vi.fn();
      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose,
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(controller.getState().status).toBe("expired");
      expect(controller.getState().pendingRecoveryAction).toBeUndefined();

      // Chamar handleRetryAction em estado expired sem pendingRecoveryAction deve ser no-op
      await controller.handleRetryAction();
      expect(fullCalls).toBe(0);
      expect(onCompletedClose).not.toHaveBeenCalled();

      // Chamar refreshMinute explicitamente atualiza a lista sem fechar o painel se ainda pendente
      await controller.refreshMinute();
      expect(fullCalls).toBe(1);
      expect(onCompletedClose).not.toHaveBeenCalled();
      expect(controller.getState().status).toBe("waiting");

      controller.dispose();
    });

    it("validateFullMinuteResponse rejeita signatureMode desconhecido e impede fechamento genérico", async () => {
      const invalidFull = validateFullMinuteResponse(minuteId, {
        success: true,
        minute: {
          id: minuteId,
          participants: [
            {
              id: participantId,
              name: "Mãe",
              role: "RESPONSAVEL",
              signatureMode: "UNKNOWN_MODE",
              hasSignature: true,
            },
          ],
        },
      });
      expect(invalidFull.ok).toBe(false);

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("?poll=1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: false,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              minute: {
                id: minuteId,
                participants: [
                  {
                    id: participantId,
                    name: "Mãe",
                    role: "RESPONSAVEL",
                    signatureMode: "UNKNOWN_MODE",
                    hasSignature: true,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const onParticipantsSynced = vi.fn();
      const onCompletedClose = vi.fn();
      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced,
        onCompletedClose,
      });

      await vi.advanceTimersByTimeAsync(2500);
      await vi.advanceTimersByTimeAsync(2500);

      expect(controller.getState().status).toBe("sync_error");
      expect(onParticipantsSynced).not.toHaveBeenCalled();
      expect(onCompletedClose).not.toHaveBeenCalled();

      controller.dispose();
    });

    it("retoma polling após refreshMinute quando consulta anterior pendente bloqueou o timer agendado", async () => {
      let resolveStalePoll!: (res: Response) => void;
      let pollCalls = 0;
      let fullCalls = 0;

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("?poll=1")) {
          pollCalls += 1;
          if (pollCalls === 1) {
            return new Promise<Response>((resolve) => {
              resolveStalePoll = resolve;
            });
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                poll: true,
                minuteId,
                participants: [
                  {
                    participantId,
                    role: "RESPONSAVEL",
                    signatureMode: "PENDING",
                    hasSignature: false,
                    hasActiveSignLink: true,
                    institutionalVerificationComplete: false,
                    linkExpired: false,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        fullCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              minute: {
                id: minuteId,
                participants: [
                  {
                    id: participantId,
                    name: "Mãe",
                    role: "RESPONSAVEL",
                    signatureMode: "PENDING",
                    hasSignature: false,
                    hasActiveSignLink: true,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      globalThis.fetch = fetchMock;

      const controller = createQrPollController(config, {
        onStateChange: vi.fn(),
        onParticipantsSynced: vi.fn(),
        onCompletedClose: vi.fn(),
      });

      // 1. Primeira consulta ?poll=1 fica pendente
      await vi.advanceTimersByTimeAsync(2500);
      expect(pollCalls).toBe(1);

      // 2. refreshMinute() invalida o polling anterior, termina rápido e agenda próximo polling para 2.5s
      await controller.refreshMinute();
      expect(fullCalls).toBe(1);
      expect(controller.getState().status).toBe("waiting");

      // 3. Timer de 2.5s dispara enquanto o primeiro ?poll=1 ainda está pendente (bloqueado por isPollingInFlight)
      await vi.advanceTimersByTimeAsync(2500);
      expect(pollCalls).toBe(1);

      // 4. Primeiro ?poll=1 finalmente resolve (descartado como antigo) -> finally deve garantir retomada
      resolveStalePoll(
        new Response(
          JSON.stringify({
            poll: true,
            minuteId,
            participants: [
              {
                participantId,
                role: "RESPONSAVEL",
                signatureMode: "PENDING",
                hasSignature: false,
                hasActiveSignLink: true,
                institutionalVerificationComplete: false,
                linkExpired: true,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(controller.getState().status).toBe("waiting");

      // 5. Avançando o relógio, novas consultas ?poll=1 devem ocorrer normalmente
      await vi.advanceTimersByTimeAsync(15_000);
      expect(pollCalls).toBeGreaterThan(1);

      controller.dispose();
    });
  });
});
