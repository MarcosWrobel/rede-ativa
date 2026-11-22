"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FilePlus2, Plus, Printer, Save, Trash2 } from "lucide-react";
import {
  COUNCIL_ACTION_RESPONSIBLE_LABELS,
  formatCouncilCalendarDateYmd,
  parsePostActionItemsList,
  type CouncilActionResponsible,
  type CouncilPostActionItem,
  type CouncilTrimesterNumber,
  type CouncilTrimesterRecord,
} from "./types";

interface CouncilPostMeetingTabProps {
  boardId: string;
  activeTrimester: CouncilTrimesterNumber;
  trimesterRecord: CouncilTrimesterRecord | null;
  onTrimesterUpdated: (updated: CouncilTrimesterRecord) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

export default function CouncilPostMeetingTab({
  boardId,
  activeTrimester,
  trimesterRecord,
  onTrimesterUpdated,
  onNotify,
  readOnly = false,
}: CouncilPostMeetingTabProps) {
  const [heldAt, setHeldAt] = useState(
    formatCouncilCalendarDateYmd(trimesterRecord?.postCouncilHeldAt)
  );
  const [advances, setAdvances] = useState(trimesterRecord?.postCouncilAdvances || "");
  const [whatWorked, setWhatWorked] = useState(trimesterRecord?.postCouncilWhatWorked || "");
  const [recognizedAttitudes, setRecognizedAttitudes] = useState(
    trimesterRecord?.postCouncilRecognizedAttitudes || ""
  );
  const [criticalSubjects, setCriticalSubjects] = useState(
    trimesterRecord?.postCouncilCriticalSubjects || ""
  );
  const [performanceFactors, setPerformanceFactors] = useState(
    trimesterRecord?.postCouncilPerformanceFactors || ""
  );
  const [behaviorAttendance, setBehaviorAttendance] = useState(
    trimesterRecord?.postCouncilBehaviorAttendance || ""
  );
  const [whatToImprove, setWhatToImprove] = useState(
    trimesterRecord?.postCouncilWhatToImprove || ""
  );
  const [howTeachersCanHelp, setHowTeachersCanHelp] = useState(
    trimesterRecord?.postCouncilHowTeachersCanHelp || ""
  );
  const [commitments, setCommitments] = useState(trimesterRecord?.postCouncilCommitments || "");
  const [actionItems, setActionItems] = useState<CouncilPostActionItem[]>(() =>
    parsePostActionItemsList(trimesterRecord?.postCouncilActionItemsJson)
  );
  const [linkedMinuteId, setLinkedMinuteId] = useState<string | null>(
    trimesterRecord?.linkedMinuteId || null
  );
  const [saving, setSaving] = useState(false);
  const [generatingMinute, setGeneratingMinute] = useState(false);

  useEffect(() => {
    setHeldAt(formatCouncilCalendarDateYmd(trimesterRecord?.postCouncilHeldAt));
    setAdvances(trimesterRecord?.postCouncilAdvances || "");
    setWhatWorked(trimesterRecord?.postCouncilWhatWorked || "");
    setRecognizedAttitudes(trimesterRecord?.postCouncilRecognizedAttitudes || "");
    setCriticalSubjects(trimesterRecord?.postCouncilCriticalSubjects || "");
    setPerformanceFactors(trimesterRecord?.postCouncilPerformanceFactors || "");
    setBehaviorAttendance(trimesterRecord?.postCouncilBehaviorAttendance || "");
    setWhatToImprove(trimesterRecord?.postCouncilWhatToImprove || "");
    setHowTeachersCanHelp(trimesterRecord?.postCouncilHowTeachersCanHelp || "");
    setCommitments(trimesterRecord?.postCouncilCommitments || "");
    setActionItems(parsePostActionItemsList(trimesterRecord?.postCouncilActionItemsJson));
    setLinkedMinuteId(trimesterRecord?.linkedMinuteId || null);
  }, [trimesterRecord, activeTrimester]);

  function addActionItem() {
    if (readOnly) return;
    setActionItems((prev) => [
      ...prev,
      {
        number: prev.length + 1,
        description: "",
        responsible: "ESCOLA",
        dueDate: null,
      },
    ]);
  }

  function removeActionItem(index: number) {
    if (readOnly) return;
    setActionItems((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((item, idx) => ({ ...item, number: idx + 1 }))
    );
  }

  async function savePostCouncilData(): Promise<CouncilTrimesterRecord | null> {
    const cleanActions = actionItems
      .map((item, idx) => ({
        number: idx + 1,
        description: item.description.trim(),
        responsible: item.responsible,
        dueDate: item.dueDate?.trim() || null,
      }))
      .filter((item) => item.description.length >= 2);

    const res = await fetch(`/api/conselho-classe/${boardId}/trimesters`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trimester: activeTrimester,
        postCouncilHeldAt: heldAt || null,
        postCouncilAdvances: advances.trim() || null,
        postCouncilWhatWorked: whatWorked.trim() || null,
        postCouncilRecognizedAttitudes: recognizedAttitudes.trim() || null,
        postCouncilCriticalSubjects: criticalSubjects.trim() || null,
        postCouncilPerformanceFactors: performanceFactors.trim() || null,
        postCouncilBehaviorAttendance: behaviorAttendance.trim() || null,
        postCouncilWhatToImprove: whatToImprove.trim() || null,
        postCouncilHowTeachersCanHelp: howTeachersCanHelp.trim() || null,
        postCouncilCommitments: commitments.trim() || null,
        postCouncilActionItems: cleanActions,
      }),
    });
    const data: {
      success?: boolean;
      trimesterRecord?: CouncilTrimesterRecord;
      error?: string;
    } = await res.json();

    if (!res.ok || !data.trimesterRecord) {
      onNotify(data.error || "Não foi possível salvar a reunião de pós-conselho.", "error");
      return null;
    }
    onTrimesterUpdated(data.trimesterRecord);
    return data.trimesterRecord;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSaving(true);
    try {
      const saved = await savePostCouncilData();
      if (saved) {
        onNotify("Pós-conselho salvo.", "success");
      }
    } catch {
      onNotify("Falha de conexão ao salvar o pós-conselho.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleGeneratePostCouncilMinute() {
    if (readOnly) return;
    setGeneratingMinute(true);
    try {
      const savedTrimester = await savePostCouncilData();
      if (!savedTrimester) return;

      const res = await fetch(`/api/conselho-classe/${boardId}/generate-minute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "POST_COUNCIL",
          trimester: activeTrimester,
          studentIds: [],
        }),
      });
      const data: {
        success?: boolean;
        minute?: { id: string };
        error?: string;
      } = await res.json();

      if (!res.ok || !data.minute) {
        onNotify(data.error || "Não foi possível gerar a minuta de ata.", "error");
        return;
      }

      setLinkedMinuteId(data.minute.id);
      onTrimesterUpdated({ ...savedTrimester, linkedMinuteId: data.minute.id });
      onNotify("Minuta gerada no Livro de Atas.", "success");
    } catch {
      onNotify("Falha de conexão ao gerar minuta.", "error");
    } finally {
      setGeneratingMinute(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
            Reunião de Pós-Conselho com Estudantes — {activeTrimester}º Trimestre
          </h2>

          <div className="flex items-center gap-2">
            <label
              htmlFor="post-council-date"
              className="text-xs font-bold text-slate-600 dark:text-slate-400"
            >
              Data da reunião:
            </label>
            <input
              id="post-council-date"
              type="date"
              disabled={readOnly}
              value={heldAt}
              onChange={(e) => setHeldAt(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Eixo 1: Pontos Positivos */}
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            1. Pontos Positivos
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="post-advances"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                Avanços da turma
              </label>
              <textarea
                id="post-advances"
                rows={3}
                disabled={readOnly}
                value={advances}
                onChange={(e) => setAdvances(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="post-what-worked"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                O que funcionou bem
              </label>
              <textarea
                id="post-what-worked"
                rows={3}
                disabled={readOnly}
                value={whatWorked}
                onChange={(e) => setWhatWorked(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="post-recognized-attitudes"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                Atitudes reconhecidas
              </label>
              <textarea
                id="post-recognized-attitudes"
                rows={3}
                disabled={readOnly}
                value={recognizedAttitudes}
                onChange={(e) => setRecognizedAttitudes(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Eixo 2: Dificuldades Observadas */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
            2. Dificuldades Observadas
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="post-critical-subjects"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                Componentes críticos
              </label>
              <textarea
                id="post-critical-subjects"
                rows={3}
                disabled={readOnly}
                value={criticalSubjects}
                onChange={(e) => setCriticalSubjects(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="post-performance-factors"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                Fatores que prejudicam o rendimento
              </label>
              <textarea
                id="post-performance-factors"
                rows={3}
                disabled={readOnly}
                value={performanceFactors}
                onChange={(e) => setPerformanceFactors(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="post-behavior-attendance"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                Comportamento e frequência
              </label>
              <textarea
                id="post-behavior-attendance"
                rows={3}
                disabled={readOnly}
                value={behaviorAttendance}
                onChange={(e) => setBehaviorAttendance(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Eixo 3: Escuta dos Estudantes */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wider text-sky-700 dark:text-sky-400">
            3. Escuta dos Estudantes
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="post-what-to-improve"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                O que melhorar
              </label>
              <textarea
                id="post-what-to-improve"
                rows={3}
                disabled={readOnly}
                value={whatToImprove}
                onChange={(e) => setWhatToImprove(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="post-how-teachers-help"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                Como os docentes podem ajudar
              </label>
              <textarea
                id="post-how-teachers-help"
                rows={3}
                disabled={readOnly}
                value={howTeachersCanHelp}
                onChange={(e) => setHowTeachersCanHelp(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="post-commitments"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                Compromissos assumidos pelos estudantes
              </label>
              <textarea
                id="post-commitments"
                rows={3}
                disabled={readOnly}
                value={commitments}
                onChange={(e) => setCommitments(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Eixo 4: Encaminhamentos Numerados */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
              4. Encaminhamentos Numerados
            </h3>
            {!readOnly && (
              <button
                type="button"
                onClick={addActionItem}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Novo encaminhamento</span>
              </button>
            )}
          </div>

          {actionItems.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nenhum encaminhamento numerado adicionado neste trimestre.
            </p>
          ) : (
            <div className="space-y-2">
              {actionItems.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40"
                >
                  <div className="md:col-span-1 text-xs font-black text-slate-600 dark:text-slate-400 text-center">
                    #{idx + 1}
                  </div>
                  <div className="md:col-span-6">
                    <input
                      type="text"
                      required
                      disabled={readOnly}
                      aria-label={`Descrição do encaminhamento ${idx + 1}`}
                      placeholder="Descreva o encaminhamento combinado"
                      value={item.description}
                      onChange={(e) =>
                        setActionItems((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, description: e.target.value } : row
                          )
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <select
                      disabled={readOnly}
                      aria-label={`Responsável pelo encaminhamento ${idx + 1}`}
                      value={item.responsible}
                      onChange={(e) =>
                        setActionItems((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  responsible: e.target.value as CouncilActionResponsible,
                                }
                              : row
                          )
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    >
                      {Object.entries(COUNCIL_ACTION_RESPONSIBLE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      type="date"
                      disabled={readOnly}
                      aria-label={`Prazo do encaminhamento ${idx + 1}`}
                      value={item.dueDate || ""}
                      onChange={(e) =>
                        setActionItems((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, dueDate: e.target.value || null } : row
                          )
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="md:col-span-1 flex justify-end">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeActionItem(idx)}
                        aria-label={`Remover encaminhamento ${idx + 1}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {linkedMinuteId && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 p-3 flex items-center justify-between gap-2 text-xs text-emerald-900 dark:text-emerald-200">
            <span className="font-semibold">
              Minuta vinculada ao Livro de Atas deste trimestre.
            </span>
            <Link href="/atas" className="font-extrabold underline hover:text-emerald-700">
              Abrir Livro de Atas
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/conselho-classe/${boardId}/imprimir?mode=pos-conselho&trimester=${activeTrimester}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir pós-conselho</span>
            </Link>

            {!readOnly && (
              <button
                type="button"
                disabled={generatingMinute}
                onClick={handleGeneratePostCouncilMinute}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 text-xs font-bold text-indigo-800 dark:text-indigo-200 transition cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>{generatingMinute ? "Gerando..." : "Gerar minuta"}</span>
              </button>
            )}
          </div>

          {!readOnly && (
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? "Salvando..." : "Salvar pós-conselho"}</span>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
