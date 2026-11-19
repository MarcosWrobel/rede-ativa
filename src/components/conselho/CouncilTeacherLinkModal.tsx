"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import type { CouncilSubjectRecord, CouncilTrimesterNumber } from "./types";

interface CouncilTeacherLinkModalProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  classNameLabel: string;
  activeTrimester: CouncilTrimesterNumber;
  subjects: CouncilSubjectRecord[];
  initialSubjectId: string | null;
  onNotify: (message: string, kind?: "success" | "error") => void;
}

interface GeneratedTeacherLink {
  url: string;
  qrCodeDataUrl: string;
  trimester: number;
  subjectId: string | null;
  subjectName: string | null;
  expiresAt: string;
}

export default function CouncilTeacherLinkModal({
  open,
  onClose,
  boardId,
  classNameLabel,
  activeTrimester,
  subjects,
  initialSubjectId,
  onNotify,
}: CouncilTeacherLinkModalProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(initialSubjectId || "");
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedTeacherLink | null>(null);
  const [copied, setCopied] = useState(false);
  const reqSeqRef = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const generateLink = useCallback(
    async (subjectIdValue: string, daysValue: number) => {
      const seq = ++reqSeqRef.current;
      setLoading(true);
      setErrorMsg(null);
      setCopied(false);

      try {
        const res = await fetch(`/api/conselho-classe/${boardId}/teacher-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trimester: activeTrimester,
            subjectId: subjectIdValue || null,
            expiresInDays: daysValue,
          }),
        });
        const data: GeneratedTeacherLink & { success?: boolean; error?: string } =
          await res.json();

        if (seq !== reqSeqRef.current) return;

        if (!res.ok || !data.url) {
          setErrorMsg(data.error || "Não foi possível gerar o link para professores.");
          setGenerated(null);
          return;
        }

        setGenerated({
          url: data.url,
          qrCodeDataUrl: data.qrCodeDataUrl,
          trimester: data.trimester,
          subjectId: data.subjectId,
          subjectName: data.subjectName,
          expiresAt: data.expiresAt,
        });
      } catch {
        if (seq !== reqSeqRef.current) return;
        setErrorMsg("Falha de conexão ao gerar o link para professores.");
      } finally {
        if (seq === reqSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [boardId, activeTrimester]
  );

  useEffect(() => {
    if (!open) return;
    const nextSubject = initialSubjectId || "";
    setSelectedSubjectId(nextSubject);
    void generateLink(nextSubject, expiresInDays);
  }, [open, initialSubjectId, activeTrimester, generateLink]);

  async function handleCopyLink() {
    if (!generated?.url) return;
    try {
      await navigator.clipboard.writeText(generated.url);
      setCopied(true);
      onNotify("Link copiado.", "success");
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 3000);
    } catch {
      onNotify("Selecione o endereço e copie manualmente.", "error");
    }
  }

  const activeSubjects = subjects.filter((s) => s.active);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Link para professores"
      subtitle={`${classNameLabel} • ${activeTrimester}º Trimestre`}
    >
      <div className="space-y-4 text-xs">
        <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/80 dark:bg-sky-950/40 p-3 flex items-start gap-2.5 text-sky-900 dark:text-sky-100">
          <ShieldCheck className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            O professor acessa com a conta institucional <strong>@escola.pr.gov.br</strong>,
            consulta a nota importada e marca apenas as tags do componente. Selos de saúde e
            pareceres permanecem ocultos.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 space-y-1">
            <label
              htmlFor="teacher-link-subject-select"
              className="block font-bold text-slate-700 dark:text-slate-300"
            >
              Escopo do link
            </label>
            <select
              id="teacher-link-subject-select"
              value={selectedSubjectId}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedSubjectId(next);
                void generateLink(next, expiresInDays);
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              <option value="">Todos os componentes da turma</option>
              {activeSubjects.map((subj) => (
                <option key={subj.id} value={subj.id}>
                  {subj.name}
                  {subj.teacherName ? ` (${subj.teacherName})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="teacher-link-expiry-select"
              className="block font-bold text-slate-700 dark:text-slate-300"
            >
              Validade
            </label>
            <select
              id="teacher-link-expiry-select"
              value={expiresInDays}
              onChange={(e) => {
                const nextDays = Number(e.target.value);
                setExpiresInDays(nextDays);
                void generateLink(selectedSubjectId, nextDays);
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              <option value={1}>1 dia</option>
              <option value={7}>7 dias</option>
              <option value={15}>15 dias</option>
              <option value={30}>30 dias</option>
            </select>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-rose-800 dark:text-rose-200 font-semibold">
            {errorMsg}
          </div>
        )}

        {loading && !generated && (
          <div className="py-8 text-center text-slate-500 font-semibold">
            Gerando link de acesso docente...
          </div>
        )}

        {generated && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
              {generated.qrCodeDataUrl && (
                <div className="p-2 bg-white rounded-xl border border-slate-200 shrink-0">
                  <img
                    src={generated.qrCodeDataUrl}
                    alt="QR Code de acesso para professores"
                    className="w-36 h-36 object-contain"
                  />
                </div>
              )}

              <div className="flex-1 min-w-0 space-y-2.5 w-full">
                <div>
                  <span className="block text-[11px] font-bold text-slate-500 uppercase">
                    {generated.subjectName
                      ? `Componente: ${generated.subjectName}`
                      : "Link geral da turma"}
                  </span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    Válido até{" "}
                    {new Date(generated.expiresAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    aria-label="Endereço do link para professores"
                    value={generated.url}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-[11px] font-mono text-slate-800 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold transition shrink-0 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? "Copiado" : "Copiar link"}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void generateLink(selectedSubjectId, expiresInDays)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-slate-700 dark:text-slate-300 transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                    <span>Atualizar link</span>
                  </button>

                  <a
                    href={generated.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-slate-700 dark:text-slate-300 transition"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Abrir portal</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
