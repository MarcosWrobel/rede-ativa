"use client";

import { useState, useEffect, useCallback } from "react";
import ModalDialog from "@/components/ModalDialog";
import {
  extractWhatsAppReplyViaExtension,
  isExtensionActive,
} from "@/lib/clientDispatcher";
import { getStoredPreference } from "@/lib/storageKeys";
import {
  REPLY_CATEGORY_OPTIONS,
  type ReplyCategory,
} from "@/lib/whatsappProvider";
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  User,
  Phone,
  BookOpen,
  Stethoscope,
  Zap,
  ExternalLink,
  Download,
} from "lucide-react";

export interface MessageLogModalItem {
  id: string;
  studentId?: string;
  phoneUsed: string;
  reasonTitle: string;
  messageContent?: string;
  sentByName?: string | null;
  sentAt?: string | Date;
  guardianReplied?: boolean;
  replyNotes?: string | null;
  replyCategory?: string | null;
  repliedAt?: string | Date | null;
  deliveryStatus?: string | null;
  contentHash?: string | null;
  student?: {
    id?: string;
    name?: string;
    guardianName?: string | null;
    classGroup?: {
      name?: string;
    } | null;
  } | null;
}

export interface WhatsAppReplyCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageLog: MessageLogModalItem | null;
  studentName?: string;
  classNameLabel?: string;
  onSuccess: (updatedLog: any) => void;
}

export function isPhoneCompatible(phoneA?: string | null, phoneB?: string | null): boolean {
  if (!phoneA || !phoneB) return true;
  const digitsA = String(phoneA).replace(/\D/g, "");
  const digitsB = String(phoneB).replace(/\D/g, "");
  if (!digitsA || !digitsB) return true;
  const tailA = digitsA.slice(-8);
  const tailB = digitsB.slice(-8);
  return tailA === tailB || digitsA.includes(tailB) || digitsB.includes(tailA);
}

export default function WhatsAppReplyCaptureModal({
  isOpen,
  onClose,
  messageLog,
  studentName,
  classNameLabel,
  onSuccess,
}: WhatsAppReplyCaptureModalProps) {
  const [rawReply, setRawReply] = useState<string>("");
  const [replyCategory, setReplyCategory] = useState<ReplyCategory | "">(
    (messageLog?.replyCategory as ReplyCategory) || ""
  );
  const [replyNotes, setReplyNotes] = useState<string>(
    messageLog?.replyNotes || ""
  );
  const [extractedByExtension, setExtractedByExtension] = useState<boolean>(false);
  const [extractedAtIso, setExtractedAtIso] = useState<string | null>(null);
  const [domTimestamp, setDomTimestamp] = useState<string | null>(null);
  const [activeChatTitle, setActiveChatTitle] = useState<string | null>(null);
  const [capturedScreenshot, setCapturedScreenshot] = useState<string | null>(null);

  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractionNotice, setExtractionNotice] = useState<{
    type: "success" | "warn" | "info" | "error";
    message: string;
  } | null>(null);
  const [numberNotOnWhatsApp, setNumberNotOnWhatsApp] = useState<boolean>(false);
  const [isMarkingInvalid, setIsMarkingInvalid] = useState<boolean>(false);
  const [markedInvalidSuccess, setMarkedInvalidSuccess] = useState<boolean>(false);

  const [isClassifyingAi, setIsClassifyingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiTip, setAiTip] = useState<{
    suggestedFollowUp?: string;
    requiresMedicalCertificate?: boolean;
  } | null>(null);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resolvedStudentName =
    studentName || messageLog?.student?.name || "Estudante";
  const resolvedClassName =
    classNameLabel || messageLog?.student?.classGroup?.name || "Turma não informada";

  const handleMarkNoWhatsApp = async () => {
    if (!messageLog) return;
    setIsMarkingInvalid(true);
    try {
      const res = await fetch("/api/messages/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: messageLog.id,
          deliveryStatus: "FAILED_NO_WHATSAPP",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao atualizar status de entrega.");
      }
      setMarkedInvalidSuccess(true);
      setExtractionNotice({
        type: "warn",
        message: "Número sinalizado com sucesso como sem WhatsApp no prontuário.",
      });
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Erro ao marcar número como sem WhatsApp.";
      setExtractionNotice({
        type: "error",
        message: errorMsg,
      });
    } finally {
      setIsMarkingInvalid(false);
    }
  };

  const runAiClassifyAndOcr = useCallback(
    async (textToClassify: string, screenshotDataUrl?: string | null) => {
      const trimmed = textToClassify.trim();
      if (trimmed.length < 3 && !screenshotDataUrl) {
        setAiError(
          "Cole ou digite ao menos uma frase informada pelo responsável ou capture a tela da conversa."
        );
        return;
      }

      setIsClassifyingAi(true);
      setAiError(null);

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        const savedKey = getStoredPreference("gemini_api_key");
        if (savedKey && savedKey.trim().length > 10) {
          headers["x-gemini-key"] = savedKey.trim();
        }

        const res = await fetch("/api/ai/classify-reply", {
          method: "POST",
          headers,
          body: JSON.stringify({
            rawReply: trimmed,
            screenshotDataUrl: screenshotDataUrl || undefined,
            studentName: resolvedStudentName,
            guardianName: messageLog?.student?.guardianName || undefined,
            reasonTitle: messageLog?.reasonTitle || "Busca Ativa Escolar",
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Falha ao classificar retorno com IA.");
        }

        if (data.classification) {
          if (data.classification.extractedRawReply && !trimmed) {
            setRawReply(data.classification.extractedRawReply);
            setExtractedByExtension(true);
            setExtractedAtIso(new Date().toISOString());
            setExtractionNotice({
              type: "success",
              message: "Mensagem lida da tela (OCR) e sintetizada com sucesso.",
            });
          }
          if (data.classification.category) {
            setReplyCategory(data.classification.category);
          }
          if (data.classification.formalSummary) {
            setReplyNotes(data.classification.formalSummary);
          }
          setAiTip({
            suggestedFollowUp: data.classification.suggestedFollowUp,
            requiresMedicalCertificate: Boolean(
              data.classification.requiresMedicalCertificate
            ),
          });
        }
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error
            ? err.message
            : "Erro ao consultar serviço de inteligência pedagógica.";
        setAiError(errorMsg);
      } finally {
        setIsClassifyingAi(false);
      }
    },
    [resolvedStudentName, messageLog?.reasonTitle]
  );

  const applyExtractionPayload = useCallback(
    async (res: {
      success?: boolean;
      rawText?: string;
      selectionUsed?: boolean;
      domTimestamp?: string | null;
      activeChatTitle?: string | null;
      screenshotDataUrl?: string | null;
      error?: string;
      message?: string;
    }, phoneUsed: string) => {
      if (res.screenshotDataUrl) {
        setCapturedScreenshot(res.screenshotDataUrl);
      }

      if (res.rawText && res.rawText.trim().length > 0) {
        const cleanedText = res.rawText.trim();
        setRawReply(cleanedText);
        setExtractedByExtension(true);
        setExtractedAtIso(new Date().toISOString());
        setDomTimestamp(res.domTimestamp || null);
        setActiveChatTitle(res.activeChatTitle || null);
        setNumberNotOnWhatsApp(false);
        setExtractionNotice({
          type: "success",
          message: res.selectionUsed
            ? "Texto selecionado no WhatsApp Web capturado com sucesso."
            : `Resposta extraída da conversa${res.activeChatTitle ? ` (${res.activeChatTitle})` : ""}.`,
        });
        return;
      }

      if (res.error === "NUMBER_NOT_ON_WHATSAPP") {
        setExtractedByExtension(false);
        setExtractedAtIso(null);
        setNumberNotOnWhatsApp(true);
        setExtractionNotice({
          type: "error",
          message: `O número ${phoneUsed} não possui conta ativa no WhatsApp.`,
        });
        return;
      }

      // Se o DOM não retornou texto mas capturamos a imagem da tela (captureVisibleTab), acionamos o OCR Multimodal!
      if (res.screenshotDataUrl) {
        setActiveChatTitle(res.activeChatTitle || null);
        setDomTimestamp(res.domTimestamp || null);
        setExtractionNotice({
          type: "info",
          message: "Imagem da conversa capturada. Extraindo mensagens via leitura visual (OCR)...",
        });
        await runAiClassifyAndOcr("", res.screenshotDataUrl);
        return;
      }

      if (res.error === "NO_INCOMING_MESSAGE") {
        setExtractedByExtension(false);
        setExtractedAtIso(null);
        setNumberNotOnWhatsApp(false);
        setActiveChatTitle(res.activeChatTitle || null);
        const chatLabel = res.activeChatTitle || phoneUsed;
        setExtractionNotice({
          type: "info",
          message: `Conversa localizada (${chatLabel}), sem resposta da família até o momento.`,
        });
      } else {
        setExtractedByExtension(false);
        setExtractedAtIso(null);
        setNumberNotOnWhatsApp(false);
        setExtractionNotice({
          type: "warn",
          message:
            res.message ||
            "Nenhuma resposta detectada. No WhatsApp Web, clique em '📥 Capturar Retorno' ou cole o texto abaixo.",
        });
      }
    },
    [runAiClassifyAndOcr]
  );

  const handleExtractFromExtension = useCallback(
    async (logId: string, phoneUsed: string, targetStudentName?: string) => {
      setIsExtracting(true);
      setExtractionNotice({
        type: "info",
        message: `Capturando mensagens e tela da conversa (${phoneUsed}) no WhatsApp Web...`,
      });

      try {
        const res = await extractWhatsAppReplyViaExtension(logId, phoneUsed, targetStudentName);
        await applyExtractionPayload(res, phoneUsed);
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error
            ? err.message
            : "Falha na comunicação com a extensão.";
        setExtractedByExtension(false);
        setExtractedAtIso(null);
        setNumberNotOnWhatsApp(false);
        setExtractionNotice({
          type: "warn",
          message: `${errorMsg} Cole o texto manualmente abaixo.`,
        });
      } finally {
        setIsExtracting(false);
      }
    },
    [applyExtractionPayload]
  );

  // Inicializa o estado ao abrir o modal, recupera capturas recentes e escuta o botão "📥 Capturar Retorno" do WhatsApp Web
  useEffect(() => {
    if (!isOpen || !messageLog) {
      return;
    }

    setRawReply("");
    setReplyCategory((messageLog.replyCategory as ReplyCategory) || "");
    setReplyNotes(messageLog.replyNotes || "");
    setExtractedByExtension(false);
    setExtractedAtIso(null);
    setDomTimestamp(null);
    setActiveChatTitle(null);
    setCapturedScreenshot(null);
    setAiTip(null);
    setAiError(null);
    setSaveError(null);
    setNumberNotOnWhatsApp(false);
    setMarkedInvalidSuccess(false);

    // Recupera retorno recente em cache caso a usuária tenha capturado no WhatsApp Web antes de abrir o modal
    let autoRecovered = false;
    try {
      const globalCached = typeof window !== "undefined" ? (window as any).__REDEATIVA_LAST_PUSHED_REPLY__ : null;
      const sessionCachedStr = typeof window !== "undefined" ? sessionStorage.getItem("redeativa_last_pushed_reply") : null;
      const cached = globalCached || (sessionCachedStr ? JSON.parse(sessionCachedStr) : null);

      if (cached && (cached.rawText?.trim() || cached.screenshotDataUrl)) {
        const receivedAt = cached.receivedAt || 0;
        const isFresh = Date.now() - receivedAt < 10 * 60 * 1000; // Últimos 10 minutos
        const matchesLogOrPhone =
          (cached.logId && cached.logId === messageLog.id) ||
          isPhoneCompatible(cached.phone, messageLog.phoneUsed);

        if (isFresh && matchesLogOrPhone) {
          void applyExtractionPayload(cached, messageLog.phoneUsed);
          autoRecovered = true;
        }
      }
    } catch {}

    if (!autoRecovered) {
      if (isExtensionActive()) {
        setExtractionNotice({
          type: "info",
          message:
            "Com a conversa aberta no WhatsApp Web, clique em 'Extrair resposta' acima (ou no botão '📥 Capturar Retorno' direto no WhatsApp).",
        });
      } else {
        setExtractionNotice({
          type: "info",
          message:
            "Cole a mensagem recebida abaixo ou utilize a extensão para capturar da janela do WhatsApp Web.",
        });
      }
    }

    // Consulta a extensão via bridge para verificar se há captura recente no storage local
    try {
      window.postMessage(
        {
          type: "REDEATIVA_GET_LAST_CAPTURED_REPLY",
          logId: messageLog.id,
          phone: messageLog.phoneUsed,
        },
        "*"
      );
    } catch {}

    const handlePushedCapture = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      const data = event.data;
      if (
        (data.type === "REDEATIVA_WHATSAPP_REPLY_EXTRACTED" ||
          data.type === "LEOPOLDINA_WHATSAPP_REPLY_EXTRACTED") &&
        data.pushedFromWhatsApp
      ) {
        const matchesLogOrPhone =
          !data.phone ||
          (data.logId && data.logId === messageLog.id) ||
          isPhoneCompatible(data.phone, messageLog.phoneUsed);

        if (matchesLogOrPhone) {
          void applyExtractionPayload(data, messageLog.phoneUsed);
        }
      }
    };

    window.addEventListener("message", handlePushedCapture);
    return () => window.removeEventListener("message", handlePushedCapture);
  }, [isOpen, messageLog, applyExtractionPayload]);

  const handleManualExtractionClick = () => {
    if (!messageLog) return;

    if (!isExtensionActive()) {
      setExtractionNotice({
        type: "warn",
        message:
          "Extensão Sincronizadora não detectada neste navegador. Ative a extensão no Chrome ou cole o texto manualmente.",
      });
      return;
    }

    void handleExtractFromExtension(messageLog.id, messageLog.phoneUsed, resolvedStudentName);
  };

  const handleAiClassify = async () => {
    await runAiClassifyAndOcr(rawReply, capturedScreenshot);
  };

  const handleConfirmAndSeal = async () => {
    if (!messageLog) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const payload = {
        logId: messageLog.id,
        guardianReplied: true,
        replyCategory: replyCategory || null,
        replyNotes: replyNotes.trim() || null,
        rawReply: rawReply.trim() || undefined,
        extractedAt:
          extractedByExtension && extractedAtIso ? extractedAtIso : undefined,
        sourceMethod: extractedByExtension ? "EXTENSION_ASSISTED" : "MANUAL",
      };

      const res = await fetch("/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao registrar retorno da família.");
      }

      onSuccess(data.updated);
      onClose();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Erro ao selar retorno.";
      setSaveError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !messageLog) {
    return null;
  }

  const formattedSentAt = messageLog.sentAt
    ? new Date(messageLog.sentAt).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Data não registrada";

  return (
    <ModalDialog
      open={isOpen}
      onClose={onClose}
      title="Capturar Retorno do Responsável"
      subtitle={`${resolvedStudentName} • ${resolvedClassName}`}
      size="xl"
    >
      <div className="space-y-4 text-xs">
        {/* SEÇÃO 1: Cabeçalho com Metadados do Registro */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-200 font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>{messageLog.reasonTitle}</span>
              </span>
              <span className="inline-flex items-center space-x-1 text-slate-600 dark:text-slate-300">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-mono font-semibold">{messageLog.phoneUsed}</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>Enviado em {formattedSentAt}</span>
              </span>
              {messageLog.sentByName && (
                <span className="inline-flex items-center space-x-1">
                  <User className="w-3 h-3" />
                  <span>por {messageLog.sentByName}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* SEÇÃO 2: Captura Assistida via Extensão + Fallback Manual */}
        <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              aria-label="Texto Bruto Recebido (WhatsApp Web):"
              className="font-extrabold text-slate-900 dark:text-white flex items-center space-x-1.5"
            >
              <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Mensagem recebida (WhatsApp Web):</span>
            </label>

            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href={
                  messageLog.phoneUsed
                    ? `https://web.whatsapp.com/send?phone=${messageLog.phoneUsed.replace(/\D/g, "")}`
                    : "https://web.whatsapp.com"
                }
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir Conversa"
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 font-semibold transition"
                title="Abrir a conversa deste aluno no WhatsApp Web"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                <span>Abrir conversa</span>
              </a>

              <button
                type="button"
                onClick={handleManualExtractionClick}
                disabled={isExtracting}
                aria-label="Extrair da Aba do WhatsApp Web"
                className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold transition cursor-pointer disabled:opacity-50"
                title="Capturar texto selecionado, mensagens da conversa ou imagem da tela (OCR) do WhatsApp Web"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Buscando resposta...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Extrair resposta</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Badges de confirmação / status de leitura da extensão */}
          {extractedByExtension && (
            <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-900 dark:text-emerald-200">
              <span className="inline-flex items-center space-x-1 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Captura assistida via extensão</span>
              </span>
              {activeChatTitle && (
                <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 font-medium">
                  Conversa: <strong>{activeChatTitle}</strong>
                </span>
              )}
              {domTimestamp && (
                <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 font-mono">
                  Horário: {domTimestamp}
                </span>
              )}
            </div>
          )}

          {extractionNotice && (
            <div
              className={`p-2.5 rounded-lg text-[11px] flex flex-wrap items-center justify-between gap-1.5 ${
                extractionNotice.type === "success"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                  : extractionNotice.type === "error"
                  ? "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900"
                  : extractionNotice.type === "warn"
                  ? "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                  : "bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
              }`}
            >
              <div className="flex items-center space-x-1.5 min-w-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{extractionNotice.message}</span>
              </div>

              {(extractionNotice.type === "warn" || extractionNotice.type === "error") && (
                <div className="flex items-center space-x-2 shrink-0">
                  <a
                    href={
                      messageLog.phoneUsed
                        ? `https://web.whatsapp.com/send?phone=${messageLog.phoneUsed.replace(/\D/g, "")}`
                        : "https://web.whatsapp.com"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold underline text-amber-900 dark:text-amber-200 hover:text-amber-950 flex items-center space-x-1"
                  >
                    <span>Abrir WhatsApp</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {!isExtensionActive() && (
                    <a
                      href="/extensao-rede-ativa.zip"
                      download
                      className="font-bold underline text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 flex items-center space-x-1"
                    >
                      <span>Baixar extensão</span>
                      <Download className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {numberNotOnWhatsApp && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/80 text-[11px] text-rose-900 dark:text-rose-200">
              <div className="flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>
                  Número sem conta no WhatsApp. Deseja registrar no prontuário que o contato é inválido?
                </span>
              </div>
              <button
                type="button"
                onClick={handleMarkNoWhatsApp}
                disabled={isMarkingInvalid || markedInvalidSuccess}
                className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold transition flex items-center space-x-1 cursor-pointer"
              >
                {isMarkingInvalid ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Atualizando prontuário...</span>
                  </>
                ) : markedInvalidSuccess ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Sinalizado no Prontuário</span>
                  </>
                ) : (
                  <span>Marcar sem WhatsApp</span>
                )}
              </button>
            </div>
          )}

          <textarea
            rows={3}
            value={rawReply}
            onChange={(e) => {
              setRawReply(e.target.value);
            }}
            placeholder='Cole aqui a resposta recebida ou clique no botão acima para extrair da aba ativa (ex: "Bom dia, o aluno teve febre alta e foi ao médico...")'
            className="w-full p-2.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500 font-sans"
          />
        </div>

        {/* SEÇÃO 3: Classificação Pedagógica Assistida com IA */}
        <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              aria-label="Classificação e Síntese Formal (Human-in-the-Loop):"
              className="font-extrabold text-purple-950 dark:text-purple-200 flex items-center space-x-1.5"
            >
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>Classificação e síntese formal:</span>
            </span>

            <button
              type="button"
              disabled={isClassifyingAi || (!rawReply.trim() && !capturedScreenshot)}
              onClick={handleAiClassify}
              aria-label="Sugerir Classificação e Síntese com IA"
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 disabled:opacity-50 text-white font-bold transition shadow-2xs cursor-pointer"
            >
              {isClassifyingAi ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sintetizando...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Classificar com IA</span>
                </>
              )}
            </button>
          </div>

          {aiError && (
            <p className="text-rose-700 dark:text-rose-400 font-semibold text-[11px]">
              {aiError}
            </p>
          )}

          {aiTip && (
            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800/80 text-purple-950 dark:text-purple-200 space-y-1">
              {aiTip.suggestedFollowUp && (
                <div className="font-semibold">
                  Encaminhamento sugerido:{" "}
                  <span className="font-normal">{aiTip.suggestedFollowUp}</span>
                </div>
              )}
              {aiTip.requiresMedicalCertificate && (
                <div className="inline-flex items-center space-x-1 text-emerald-700 dark:text-emerald-400 font-bold text-[11px]">
                  <Stethoscope className="w-3.5 h-3.5" />
                  <span>Relato menciona consulta médica/atestado comprobatório.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* SEÇÃO 4: Revisão Humana e Lavratura Probatória */}
        <div className="space-y-3 pt-1">
          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
              Categoria da Justificativa / Motivo da Ausência:
            </label>
            <select
              value={replyCategory}
              onChange={(e) => setReplyCategory(e.target.value as ReplyCategory | "")}
              className="w-full p-2.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold"
            >
              <option value="">-- Selecione uma categoria (opcional) --</option>
              {REPLY_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
              Resumo Formal para o Prontuário 360º e Dossiê SERP/Conselho Tutelar:
            </label>
            <textarea
              rows={3}
              value={replyNotes}
              onChange={(e) => setReplyNotes(e.target.value)}
              placeholder="Ex: Responsável informou via WhatsApp que a ausência ocorreu por motivo de saúde..."
              className="w-full p-2.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-sky-500 leading-relaxed font-sans"
            />
          </div>

          {saveError && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 font-semibold text-xs flex items-center space-x-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium transition cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleConfirmAndSeal}
              disabled={isSaving}
              aria-label="Confirmar e Selar Retorno (SHA-256)"
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 disabled:opacity-50 text-white font-bold transition shadow-xs cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Registrando...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Registrar retorno</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
