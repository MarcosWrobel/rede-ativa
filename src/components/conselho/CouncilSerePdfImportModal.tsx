"use client";

import { useState, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import { formatShiftLabel, type CouncilBoardDetailRecord } from "@/components/conselho/types";
import type {
  CouncilSerePdfApplySummary,
  CouncilSerePdfPreviewResult,
} from "@/services/classCouncilSerePdfService";

interface CouncilSerePdfImportModalProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  classNameLabel: string;
  onBoardUpdated: (board: CouncilBoardDetailRecord) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CouncilSerePdfImportModal({
  open,
  onClose,
  boardId,
  classNameLabel,
  onBoardUpdated,
  onNotify,
}: CouncilSerePdfImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<CouncilSerePdfPreviewResult | null>(null);
  const [confirmShiftUpdate, setConfirmShiftUpdate] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function resetState() {
    setFiles([]);
    setPreview(null);
    setConfirmShiftUpdate(false);
    setErrorMsg(null);
    setLoadingPreview(false);
    setApplying(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleClose() {
    if (loadingPreview || applying) return;
    resetState();
    onClose();
  }

  function handleFileSelection(selectedList: FileList | null) {
    if (!selectedList || selectedList.length === 0) return;
    setErrorMsg(null);
    setPreview(null);
    setConfirmShiftUpdate(false);

    const incoming = Array.from(selectedList);
    setFiles((prev) => {
      const merged = [...prev];
      for (const file of incoming) {
        const duplicate = merged.some(
          (f) => f.name === file.name && f.size === file.size
        );
        if (!duplicate && merged.length < 5) {
          merged.push(file);
        }
      }
      return merged;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleRemoveFile(index: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
    setPreview(null);
    setConfirmShiftUpdate(false);
    setErrorMsg(null);
  }

  function buildFormData(mode: "preview" | "apply"): FormData {
    const fd = new FormData();
    fd.append("mode", mode);
    if (mode === "apply" && confirmShiftUpdate) {
      fd.append("updateClassShift", "true");
    }
    for (const file of files) {
      fd.append("files", file);
    }
    return fd;
  }

  async function handleAnalyze() {
    if (files.length === 0) {
      setErrorMsg("Selecione pelo menos um arquivo PDF do SERE.");
      return;
    }

    setLoadingPreview(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/conselho-classe/${boardId}/import-pdf`, {
        method: "POST",
        body: buildFormData("preview"),
      });
      const data: {
        success?: boolean;
        preview?: CouncilSerePdfPreviewResult;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.preview) {
        setErrorMsg(data.error || "Não foi possível ler os arquivos selecionados.");
        return;
      }

      setPreview(data.preview);
    } catch {
      setErrorMsg("Falha de conexão ao analisar os arquivos PDF.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleApply() {
    if (files.length === 0 || !preview) return;

    setApplying(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/conselho-classe/${boardId}/import-pdf`, {
        method: "POST",
        body: buildFormData("apply"),
      });
      const data: {
        success?: boolean;
        board?: CouncilBoardDetailRecord;
        summary?: CouncilSerePdfApplySummary;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.board || !data.summary) {
        setErrorMsg(data.error || "Não foi possível concluir a importação.");
        return;
      }

      onBoardUpdated(data.board);
      onNotify(
        `Importação concluída: ${data.summary.evaluationsUpserted} nota(s) registradas para ${data.summary.studentsMatched} estudante(s).`
      );
      resetState();
      onClose();
    } catch {
      setErrorMsg("Falha de conexão ao aplicar as notas importadas.");
    } finally {
      setApplying(false);
    }
  }

  const canConfirm =
    Boolean(preview) && (preview?.summary.studentsMatched ?? 0) > 0 && !applying;

  return (
    <ModalDialog
      open={open}
      onClose={handleClose}
      title="Importar PDF do SERE"
      subtitle={classNameLabel}
      size="xl"
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Envie o <strong>Relatório de Acompanhamento Trimestral</strong> exportado do SERE.
          Para turmas com duas matrizes curriculares (como a 3ª série), selecione os dois arquivos
          PDF juntos para consolidar todas as disciplinas.
        </p>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-3.5 py-2.5 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!preview ? (
          <div className="space-y-3">
            <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/50 p-5 text-center space-y-2.5">
              <FileUp className="w-7 h-7 mx-auto text-sky-600 dark:text-sky-400" />
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Selecione 1 ou mais arquivos PDF (máximo 5 arquivos, 10 MB cada)
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  id="sere-council-pdf-input"
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={(e) => handleFileSelection(e.target.files)}
                  className="sr-only"
                />
                <label
                  htmlFor="sere-council-pdf-input"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Escolher PDF
                </label>
              </div>
            </div>

            {files.length > 0 && (
              <ul className="space-y-2" aria-label="Arquivos selecionados">
                {files.map((file, idx) => (
                  <li
                    key={`${file.name}-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white truncate">
                        {file.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {formatBytes(file.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(idx)}
                      aria-label={`Remover ${file.name}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={handleClose}
                disabled={loadingPreview}
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={files.length === 0 || loadingPreview}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
              >
                {loadingPreview ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analisando...
                  </>
                ) : (
                  "Analisar PDF"
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Resumo numérico da prévia */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Disciplinas
                </div>
                <div className="text-lg font-black text-slate-900 dark:text-white">
                  {preview.summary.subjectsTotal}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  {preview.summary.subjectsToCreate} nova(s) • {preview.summary.subjectsMatched} existente(s)
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Estudantes localizados
                </div>
                <div className="text-lg font-black text-emerald-700 dark:text-emerald-400">
                  {preview.summary.studentsMatched} / {preview.summary.studentsInPdf}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  {preview.summary.studentsUnmatched} não localizado(s)
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Notas a importar
                </div>
                <div className="text-lg font-black text-slate-900 dark:text-white">
                  {preview.summary.gradesToImport}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  {preview.trimestersTouched.length > 0
                    ? `Trimestres: ${preview.trimestersTouched.map((t) => `${t}º`).join(", ")}`
                    : "Sem notas"}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Notas abaixo de 6,0
                </div>
                <div className="text-lg font-black text-amber-700 dark:text-amber-400">
                  {preview.summary.belowAverageGrades}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Sinalizadas na ficha
                </div>
              </div>
            </div>

            {/* Metadados dos arquivos lidos */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 space-y-1.5">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Arquivos analisados
              </div>
              {preview.files.map((f, idx) => (
                <div
                  key={`${f.fileName}-${idx}`}
                  className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-0.5"
                >
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {f.fileName}
                  </span>
                  {f.course && <span>Curso: {f.course}</span>}
                  {f.grade && <span>Seriação: {f.grade}</span>}
                  {f.shift && <span>Turno: {f.shift}</span>}
                  {f.classCode && <span>Turma: {f.classCode}</span>}
                  {f.reportDate && <span>Data: {f.reportDate}</span>}
                </div>
              ))}
            </div>

            {/* Alertas */}
            {preview.warnings.length > 0 && (
              <div
                role="alert"
                className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 space-y-1"
              >
                <div className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Pontos de atenção antes de confirmar
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                  {preview.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Disciplinas detectadas */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Disciplinas identificadas ({preview.subjects.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {preview.subjects.map((sub) => (
                  <span
                    key={sub.matchKey}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                      sub.status === "new"
                        ? "bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200"
                        : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span>{sub.name}</span>
                    <span className="text-[10px] uppercase font-bold opacity-75">
                      {sub.status === "new" ? "Nova" : "Existente"}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* Lista de estudantes não localizados (se houver) */}
            {preview.summary.studentsUnmatched > 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 space-y-1.5">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Estudantes no PDF não localizados nesta turma ({preview.summary.studentsUnmatched})
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 text-xs text-slate-600 dark:text-slate-400">
                  {preview.students
                    .filter((s) => s.status !== "matched")
                    .map((s, idx) => (
                      <div key={`${s.pdfName}-${idx}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {s.rowNumber ? `${s.rowNumber}. ` : ""}
                          {s.pdfName}
                        </span>
                        <span className="text-[11px] font-semibold shrink-0">
                          {s.status === "unmatched_no_grades"
                            ? "Sem notas"
                            : s.status === "ambiguous"
                              ? "Homônimo"
                              : `${s.gradesCount} nota(s)`}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {preview.detectedShift && (
              <label className="flex items-start gap-2.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-950 dark:text-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmShiftUpdate}
                  onChange={(e) => setConfirmShiftUpdate(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400"
                />
                <span>
                  Atualizar turno da turma de <strong>{formatShiftLabel(preview.classGroupShift)}</strong>{" "}
                  para <strong>{formatShiftLabel(preview.detectedShift)}</strong> conforme o relatório.
                </span>
              </label>
            )}

            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <span>
                Professores cadastrados, textos do conselho, descritivos manuais e selos de
                acompanhamento já registrados serão preservados.
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setConfirmShiftUpdate(false);
                  setErrorMsg(null);
                }}
                disabled={applying}
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!canConfirm}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
              >
                {applying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Importando...
                  </>
                ) : (
                  "Confirmar importação"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
