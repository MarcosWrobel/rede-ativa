"use client";

import { useState, useEffect } from "react";
import { Copy, Plus, Save, Trash2, Sparkles } from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import {
  COMMON_CURRICULUM_PRESETS,
  formatShiftLabel,
  type CouncilSourceBoardOption,
  type CouncilSubjectRecord,
} from "./types";

interface SubjectRowDraft {
  id?: string;
  name: string;
  teacherName: string;
  teacherEmail: string;
  displayOrder: number;
  active: boolean;
}

interface CouncilSubjectsManagerModalProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  classNameLabel: string;
  initialSubjects: CouncilSubjectRecord[];
  availableSourceBoards: CouncilSourceBoardOption[];
  onSubjectsUpdated: (subjects: CouncilSubjectRecord[]) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

function toDraftRows(subjects: CouncilSubjectRecord[]): SubjectRowDraft[] {
  return subjects.map((s, idx) => ({
    id: s.id,
    name: s.name,
    teacherName: s.teacherName || "",
    teacherEmail: s.teacherEmail || "",
    displayOrder: s.displayOrder ?? idx,
    active: s.active,
  }));
}

export default function CouncilSubjectsManagerModal({
  open,
  onClose,
  boardId,
  classNameLabel,
  initialSubjects,
  availableSourceBoards,
  onSubjectsUpdated,
  onNotify,
  readOnly = false,
}: CouncilSubjectsManagerModalProps) {
  const [rows, setRows] = useState<SubjectRowDraft[]>(() => toDraftRows(initialSubjects));
  const [sourceBoardId, setSourceBoardId] = useState("");
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(toDraftRows(initialSubjects));
      setSourceBoardId("");
    }
  }, [open, initialSubjects]);

  const cloneCandidates = availableSourceBoards.filter(
    (b) => b.id !== boardId && b.subjectsCount > 0
  );

  function handleAddRow() {
    setRows((prev) => [
      ...prev,
      {
        name: "",
        teacherName: "",
        teacherEmail: "",
        displayOrder: prev.length,
        active: true,
      },
    ]);
  }

  function handleAddBasePresets() {
    setRows((prev) => {
      const existingLower = new Set(prev.map((r) => r.name.trim().toLowerCase()));
      const additions = COMMON_CURRICULUM_PRESETS.filter(
        (preset) => !existingLower.has(preset.toLowerCase())
      ).map((preset, offset) => ({
        name: preset,
        teacherName: "",
        teacherEmail: "",
        displayOrder: prev.length + offset,
        active: true,
      }));
      return [...prev, ...additions];
    });
  }

  function handleRemoveOrToggleRow(index: number) {
    setRows((prev) => {
      const target = prev[index];
      if (!target) return prev;
      if (!target.id) {
        return prev.filter((_, idx) => idx !== index);
      }
      return prev.map((item, idx) =>
        idx === index ? { ...item, active: !item.active } : item
      );
    });
  }

  async function handleCloneFromBoard() {
    if (readOnly || !sourceBoardId) return;
    setCloning(true);
    try {
      const res = await fetch(`/api/conselho-classe/${boardId}/subjects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceBoardId }),
      });
      const data: {
        success?: boolean;
        subjects?: CouncilSubjectRecord[];
        sourceClassName?: string | null;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.subjects) {
        onNotify(data.error || "Não foi possível importar os componentes curriculares.", "error");
        return;
      }

      setRows(toDraftRows(data.subjects));
      onSubjectsUpdated(data.subjects);
      onNotify(
        `Componentes importados${data.sourceClassName ? ` de ${data.sourceClassName}` : ""}.`,
        "success"
      );
    } catch {
      onNotify("Falha de conexão ao importar componentes curriculares.", "error");
    } finally {
      setCloning(false);
    }
  }

  async function handleSaveSubjects(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;

    const cleanRows = rows
      .map((r, idx) => ({
        ...(r.id ? { id: r.id } : {}),
        name: r.name.trim(),
        teacherName: r.teacherName.trim() || null,
        teacherEmail: r.teacherEmail.trim() || null,
        displayOrder: idx,
        active: r.active,
      }))
      .filter((r) => r.name.length > 0);

    if (cleanRows.length === 0) {
      onNotify("Adicione ao menos um componente curricular.", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/conselho-classe/${boardId}/subjects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects: cleanRows }),
      });
      const data: {
        success?: boolean;
        subjects?: CouncilSubjectRecord[];
        error?: string;
      } = await res.json();

      if (!res.ok || !data.subjects) {
        onNotify(data.error || "Não foi possível salvar os componentes.", "error");
        return;
      }

      onSubjectsUpdated(data.subjects);
      onNotify("Componentes curriculares salvos.", "success");
      onClose();
    } catch {
      onNotify("Falha de conexão ao salvar os componentes.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={`Componentes e docentes — ${classNameLabel}`}
    >
      <div className="space-y-5">
        {!readOnly && (
          <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/30 p-3.5 space-y-2">
            <label
              htmlFor="clone-subjects-source"
              className="block text-xs font-bold text-sky-950 dark:text-sky-200"
            >
              Importar componentes curriculares de outra turma da mesma escola
            </label>
            {cloneCandidates.length > 0 ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  id="clone-subjects-source"
                  value={sourceBoardId}
                  onChange={(e) => setSourceBoardId(e.target.value)}
                  className="flex-1 rounded-xl border border-sky-300 dark:border-sky-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecionar turma de origem...</option>
                  {cloneCandidates.map((cand) => (
                    <option key={cand.id} value={cand.id}>
                      {cand.classGroupName} ({formatShiftLabel(cand.shift)}) — {cand.subjectsCount}{" "}
                      componentes
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!sourceBoardId || cloning}
                  onClick={handleCloneFromBoard}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{cloning ? "Importando..." : "Importar componentes"}</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Nenhuma outra turma desta escola possui componentes curriculares cadastrados ainda.
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSaveSubjects} className="space-y-4">
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAddBasePresets}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-950 text-xs font-bold text-emerald-800 dark:text-emerald-200 transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Adicionar base comum</span>
              </button>
              <button
                type="button"
                onClick={handleAddRow}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Novo componente</span>
              </button>
            </div>
          )}

          <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                Nenhum componente cadastrado. Utilize &ldquo;Adicionar base comum&rdquo;, &ldquo;Novo
                componente&rdquo; ou importe de outra turma.
              </p>
            ) : (
              rows.map((row, idx) => (
                <div
                  key={row.id || `new-${idx}`}
                  className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center p-2.5 rounded-xl border ${
                    row.active
                      ? "border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40"
                      : "border-slate-200/60 dark:border-slate-800/60 bg-slate-100/50 dark:bg-slate-900/40 opacity-60"
                  }`}
                >
                  <div className="md:col-span-4">
                    <input
                      type="text"
                      required
                      disabled={readOnly}
                      aria-label={`Nome do componente ${idx + 1}`}
                      placeholder="Componente curricular / Itinerário"
                      value={row.name}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, name: e.target.value } : item
                          )
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <input
                      type="text"
                      disabled={readOnly}
                      aria-label={`Docente de ${row.name || `componente ${idx + 1}`}`}
                      placeholder="Docente titular"
                      value={row.teacherName}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, teacherName: e.target.value } : item
                          )
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <input
                      type="email"
                      disabled={readOnly}
                      aria-label={`E-mail docente de ${row.name || `componente ${idx + 1}`}`}
                      placeholder="E-mail institucional"
                      value={row.teacherEmail}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, teacherEmail: e.target.value } : item
                          )
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="md:col-span-1 flex justify-end">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOrToggleRow(idx)}
                        aria-label={
                          row.id
                            ? row.active
                              ? `Desativar ${row.name}`
                              : `Reativar ${row.name}`
                            : `Remover linha ${idx + 1}`
                        }
                        title={row.id ? (row.active ? "Desativar" : "Reativar") : "Remover"}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              Fechar
            </button>
            {!readOnly && (
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Salvando..." : "Salvar componentes"}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
