"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import { buildWhatsAppDispatchUrl } from "@/lib/whatsappProvider";

interface CouncilTeacherInviteModalProps {
  open: boolean;
  onClose: () => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
}

interface InviteStatusResponse {
  success?: boolean;
  error?: string;
  schoolName?: string;
  hasActiveInvite?: boolean;
  code?: string | null;
  formattedCode?: string | null;
  inviteUrl?: string | null;
  expiresAt?: string | null;
}

export function buildTeacherInviteWhatsAppMessage(params: {
  schoolName: string;
  formattedCode: string | null;
  inviteUrl: string;
  expiresAt: string | null;
}): string {
  const validityLabel = params.expiresAt
    ? new Date(params.expiresAt).toLocaleDateString("pt-BR")
    : "";
  const lines = [
    `Vínculo Docente • ${params.schoolName}`,
    "Acesse com sua conta institucional @escola.pr.gov.br para vincular suas turmas e componentes:",
    params.inviteUrl,
  ];
  if (params.formattedCode) {
    lines.push(`Código da escola: ${params.formattedCode}`);
  }
  if (validityLabel) {
    lines.push(`Validade: até ${validityLabel}`);
  }
  return lines.join("\n");
}

export default function CouncilTeacherInviteModal({
  open,
  onClose,
  onNotify,
}: CouncilTeacherInviteModalProps) {
  const [loading, setLoading] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(15);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("Instituição de Ensino");
  const [hasActiveInvite, setHasActiveInvite] = useState(false);
  const [formattedCode, setFormattedCode] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<"code" | "url" | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/conselho-classe/teacher-invite", { cache: "no-store" });
      const data = (await res.json()) as InviteStatusResponse;
      if (!res.ok) {
        setErrorMsg(data.error || "Não foi possível consultar o código de vínculo.");
        return;
      }
      setSchoolName(data.schoolName || "Instituição de Ensino");
      setHasActiveInvite(Boolean(data.hasActiveInvite));
      setInviteUrl(data.inviteUrl ?? null);
      setExpiresAt(data.expiresAt ?? null);
    } catch {
      setErrorMsg("Falha de conexão ao consultar o código de vínculo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setFormattedCode(null);
      setCopiedKey(null);
      setErrorMsg(null);
      return;
    }
    void loadStatus();
  }, [open, loadStatus]);

  async function handleGenerate() {
    setLoading(true);
    setErrorMsg(null);
    setCopiedKey(null);
    try {
      const res = await fetch("/api/conselho-classe/teacher-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "GENERATE", expiresInDays }),
      });
      const data = (await res.json()) as InviteStatusResponse;
      if (!res.ok) {
        setErrorMsg(data.error || "Não foi possível gerar o código.");
        return;
      }
      setSchoolName(data.schoolName || schoolName);
      setHasActiveInvite(true);
      setFormattedCode(data.formattedCode ?? null);
      setInviteUrl(data.inviteUrl ?? null);
      setExpiresAt(data.expiresAt ?? null);
      onNotify("Código de vínculo docente gerado.", "success");
    } catch {
      setErrorMsg("Falha de conexão ao gerar o código.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/conselho-classe/teacher-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE" }),
      });
      const data = (await res.json()) as InviteStatusResponse;
      if (!res.ok) {
        setErrorMsg(data.error || "Não foi possível revogar o código.");
        return;
      }
      setHasActiveInvite(false);
      setFormattedCode(null);
      setInviteUrl(null);
      setExpiresAt(null);
      onNotify("Código de vínculo revogado.", "success");
    } catch {
      setErrorMsg("Falha de conexão ao revogar o código.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(text: string, kind: "code" | "url") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(kind);
      onNotify(kind === "code" ? "Código copiado." : "Link copiado.", "success");
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      onNotify("Selecione e copie manualmente.", "error");
    }
  }

  const whatsappUrl = inviteUrl
    ? buildWhatsAppDispatchUrl(
        "",
        buildTeacherInviteWhatsAppMessage({
          schoolName,
          formattedCode,
          inviteUrl,
          expiresAt,
        })
      )
    : null;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Código de Vínculo Docente"
      subtitle={schoolName}
    >
      <div className="space-y-4 text-xs">
        <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/80 dark:bg-sky-950/40 p-3 flex items-start gap-2.5 text-sky-950 dark:text-sky-100">
          <KeyRound className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Compartilhe este código ou link com os professores da escola. Ao entrar com{" "}
            <strong>@escola.pr.gov.br</strong>, cada docente seleciona suas turmas e componentes
            vagos. Componentes já vinculados a outro professor não são alterados.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label
              htmlFor="teacher-invite-expiry"
              className="block font-bold text-slate-700 dark:text-slate-300"
            >
              Validade do código
            </label>
            <select
              id="teacher-invite-expiry"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              <option value={7}>7 dias</option>
              <option value={15}>15 dias</option>
              <option value={30}>30 dias</option>
              <option value={90}>90 dias</option>
            </select>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGenerate()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{hasActiveInvite ? "Gerar novo código" : "Gerar código da escola"}</span>
          </button>

          {hasActiveInvite && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleRevoke()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold transition cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Revogar</span>
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-rose-800 dark:text-rose-200 font-semibold">
            {errorMsg}
          </div>
        )}

        {hasActiveInvite && inviteUrl && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-3">
            {expiresAt && (
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Convite ativo até {new Date(expiresAt).toLocaleDateString("pt-BR")}
              </p>
            )}

            {formattedCode ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-300 dark:border-sky-800 bg-white dark:bg-slate-900 px-3.5 py-2.5">
                <div>
                  <span className="block text-[10px] font-bold uppercase text-slate-500">
                    Código da escola (para digitação no portal)
                  </span>
                  <span className="text-base font-black tracking-widest font-mono text-slate-900 dark:text-slate-100">
                    {formattedCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopy(formattedCode, "code")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold transition cursor-pointer"
                >
                  {copiedKey === "code" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === "code" ? "Copiado" : "Copiar código"}</span>
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2.5 flex items-center gap-2 text-[11px] text-amber-900 dark:text-amber-200">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  Por segurança, o código digitável não fica armazenado em texto claro. Use o link
                  abaixo ou clique em <strong>Gerar novo código</strong> para visualizar um novo.
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                aria-label="Link de autovínculo docente"
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-[11px] font-mono text-slate-800 dark:text-slate-200"
              />
              <button
                type="button"
                onClick={() => void handleCopy(inviteUrl, "url")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-slate-800 dark:text-slate-200 transition cursor-pointer shrink-0"
              >
                {copiedKey === "url" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === "url" ? "Copiado" : "Copiar link"}</span>
              </button>
            </div>

            {whatsappUrl && (
              <div className="flex flex-wrap gap-2">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 font-bold text-emerald-800 dark:text-emerald-200 transition"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Enviar via WhatsApp</span>
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
