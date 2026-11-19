"use client";

import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import type { CouncilTrimesterNumber, CouncilTrimesterRecord } from "./types";

interface CouncilTrimesterOverviewTabProps {
  boardId: string;
  activeTrimester: CouncilTrimesterNumber;
  trimesterRecord: CouncilTrimesterRecord | null;
  onTrimesterUpdated: (updated: CouncilTrimesterRecord) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

export default function CouncilTrimesterOverviewTab({
  boardId,
  activeTrimester,
  trimesterRecord,
  onTrimesterUpdated,
  onNotify,
  readOnly = false,
}: CouncilTrimesterOverviewTabProps) {
  const [status, setStatus] = useState<"IN_PROGRESS" | "CONSOLIDATED">(
    trimesterRecord?.status === "CONSOLIDATED" ? "CONSOLIDATED" : "IN_PROGRESS"
  );
  const [positivePoints, setPositivePoints] = useState(trimesterRecord?.positivePoints || "");
  const [attentionPoints, setAttentionPoints] = useState(trimesterRecord?.attentionPoints || "");
  const [plannedActions, setPlannedActions] = useState(trimesterRecord?.plannedActions || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(trimesterRecord?.status === "CONSOLIDATED" ? "CONSOLIDATED" : "IN_PROGRESS");
    setPositivePoints(trimesterRecord?.positivePoints || "");
    setAttentionPoints(trimesterRecord?.attentionPoints || "");
    setPlannedActions(trimesterRecord?.plannedActions || "");
  }, [trimesterRecord, activeTrimester]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/conselho-classe/${boardId}/trimesters`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: activeTrimester,
          status,
          positivePoints: positivePoints.trim() || null,
          attentionPoints: attentionPoints.trim() || null,
          plannedActions: plannedActions.trim() || null,
        }),
      });
      const data: {
        success?: boolean;
        trimesterRecord?: CouncilTrimesterRecord;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.trimesterRecord) {
        onNotify(data.error || "Não foi possível salvar as observações da turma.", "error");
        return;
      }

      onTrimesterUpdated(data.trimesterRecord);
      onNotify("Observações registradas.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar as observações.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSave}
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-5 shadow-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
          Observações Gerais da Turma — {activeTrimester}º Trimestre
        </h2>

        <div className="flex items-center gap-2">
          <label
            htmlFor="trimester-status-select"
            className="text-xs font-bold text-slate-600 dark:text-slate-400"
          >
            Situação do ciclo:
          </label>
          <select
            id="trimester-status-select"
            disabled={readOnly}
            value={status}
            onChange={(e) =>
              setStatus(e.target.value === "CONSOLIDATED" ? "CONSOLIDATED" : "IN_PROGRESS")
            }
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
          >
            <option value="IN_PROGRESS">Em andamento</option>
            <option value="CONSOLIDATED">Consolidado</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label
            htmlFor="overview-positive-points"
            className="block text-xs font-bold text-emerald-800 dark:text-emerald-300"
          >
            Pontos positivos da turma
          </label>
          <textarea
            id="overview-positive-points"
            rows={6}
            disabled={readOnly}
            value={positivePoints}
            onChange={(e) => setPositivePoints(e.target.value)}
            placeholder="Avanços observados, participação, organização e destaques coletivos..."
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="overview-attention-points"
            className="block text-xs font-bold text-amber-800 dark:text-amber-300"
          >
            Pontos de atenção
          </label>
          <textarea
            id="overview-attention-points"
            rows={6}
            disabled={readOnly}
            value={attentionPoints}
            onChange={(e) => setAttentionPoints(e.target.value)}
            placeholder="Dificuldades recorrentes, infrequência, convivência ou demandas pedagógicas..."
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="overview-planned-actions"
            className="block text-xs font-bold text-sky-800 dark:text-sky-300"
          >
            Ações planejadas para o trimestre
          </label>
          <textarea
            id="overview-planned-actions"
            rows={6}
            disabled={readOnly}
            value={plannedActions}
            onChange={(e) => setPlannedActions(e.target.value)}
            placeholder="Combinados pedagógicos, intervenções por componente, atendimento às famílias..."
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
          />
        </div>
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? "Salvando..." : "Salvar observações"}</span>
          </button>
        </div>
      )}
    </form>
  );
}
