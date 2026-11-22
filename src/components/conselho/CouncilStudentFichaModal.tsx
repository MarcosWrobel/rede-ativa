"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FilePlus2, Plus, Printer, Save, Trash2 } from "lucide-react";
import ModalDialog from "@/components/ModalDialog";
import {
  COUNCIL_DESCRIPTORS,
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  formatCouncilGradePtBr,
  getCardBelowAvgForTrimester,
  getCardOpinionForTrimester,
  type CouncilBelowAvgItem,
  type CouncilBoardDetailRecord,
  type CouncilEnrollmentStatus,
  type CouncilStudentCardRecord,
  type CouncilStudentTag,
  type CouncilTrimesterNumber,
} from "./types";

interface CouncilStudentFichaModalProps {
  open: boolean;
  onClose: () => void;
  board: CouncilBoardDetailRecord;
  card: CouncilStudentCardRecord | null;
  activeTrimester: CouncilTrimesterNumber;
  hideSensitiveTags: boolean;
  onCardUpdated: (updatedCard: CouncilStudentCardRecord) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

function toNullablePercent(raw: string): number | null {
  const clean = raw.trim().replace(",", ".");
  if (!clean) return null;
  const parsed = Number.parseFloat(clean);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

export default function CouncilStudentFichaModal({
  open,
  onClose,
  board,
  card,
  activeTrimester,
  hideSensitiveTags,
  onCardUpdated,
  onNotify,
  readOnly = false,
}: CouncilStudentFichaModalProps) {
  const [selectedTrimester, setSelectedTrimester] =
    useState<CouncilTrimesterNumber>(activeTrimester);
  const [enrollmentStatus, setEnrollmentStatus] = useState<CouncilEnrollmentStatus>("ATIVO");
  const [ed1, setEd1] = useState("");
  const [ed2, setEd2] = useState("");
  const [ed3, setEd3] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [opinion, setOpinion] = useState("");
  const [belowAvgItems, setBelowAvgItems] = useState<CouncilBelowAvgItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [generatingMinute, setGeneratingMinute] = useState(false);
  const [createdMinuteId, setCreatedMinuteId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTrimester(activeTrimester);
  }, [activeTrimester, open]);

  useEffect(() => {
    if (!card) return;
    setEnrollmentStatus(
      (card.enrollmentStatus as CouncilEnrollmentStatus) || "ATIVO"
    );
    setEd1(
      card.externalEvalEd1Percent !== null && card.externalEvalEd1Percent !== undefined
        ? String(card.externalEvalEd1Percent)
        : ""
    );
    setEd2(
      card.externalEvalEd2Percent !== null && card.externalEvalEd2Percent !== undefined
        ? String(card.externalEvalEd2Percent)
        : ""
    );
    setEd3(
      card.externalEvalEd3Percent !== null && card.externalEvalEd3Percent !== undefined
        ? String(card.externalEvalEd3Percent)
        : ""
    );
    setTags(card.tags || []);
    setCreatedMinuteId(null);
  }, [card]);

  useEffect(() => {
    if (!card) return;
    setOpinion(getCardOpinionForTrimester(card, selectedTrimester));
    setBelowAvgItems(getCardBelowAvgForTrimester(card, selectedTrimester));
  }, [card, selectedTrimester]);

  if (!card) {
    return (
      <ModalDialog open={open} onClose={onClose} size="xl" title="Ficha do Estudante">
        <p className="text-xs text-slate-500">Nenhum estudante selecionado.</p>
      </ModalDialog>
    );
  }

  const activeSubjects = board.subjects.filter((s) => s.active);
  const visibleTagOptions = COUNCIL_STUDENT_TAG_OPTIONS.filter(
    (opt) => !hideSensitiveTags || !opt.isSensitiveHealth
  );

  function toggleTag(tagValue: CouncilStudentTag) {
    if (readOnly) return;
    setTags((prev) =>
      prev.includes(tagValue) ? prev.filter((t) => t !== tagValue) : [...prev, tagValue]
    );
  }

  function addBelowAvgRow() {
    if (readOnly) return;
    setBelowAvgItems((prev) => [
      ...prev,
      {
        subjectId: null,
        subjectName: "",
        grade: null,
      },
    ]);
  }

  async function handleSaveCard(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || !card) return;

    const cleanBelow = belowAvgItems
      .map((item) => ({
        subjectId: item.subjectId || null,
        subjectName: item.subjectName.trim(),
        grade:
          item.grade !== null && item.grade !== undefined && Number.isFinite(item.grade)
            ? Math.max(0, Math.min(10, item.grade))
            : null,
      }))
      .filter((item) => item.subjectName.length > 0);

    setSaving(true);
    try {
      const res = await fetch(
        `/api/conselho-classe/${board.id}/students/${card.studentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollmentStatus,
            externalEvalEd1Percent: toNullablePercent(ed1),
            externalEvalEd2Percent: toNullablePercent(ed2),
            externalEvalEd3Percent: toNullablePercent(ed3),
            tags,
            trimester: selectedTrimester,
            qualitativeOpinion: opinion.trim() || null,
            belowAverageSubjects: cleanBelow,
          }),
        }
      );

      const data: {
        success?: boolean;
        card?: CouncilStudentCardRecord;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.card) {
        onNotify(data.error || "Não foi possível salvar a ficha do estudante.", "error");
        return;
      }

      onCardUpdated(data.card);
      onNotify("Ficha registrada.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar a ficha.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateStudentMinute() {
    if (readOnly || !card) return;
    setGeneratingMinute(true);
    try {
      const res = await fetch(`/api/conselho-classe/${board.id}/generate-minute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "STUDENT_DELIBERATION",
          trimester: selectedTrimester,
          studentIds: [card.studentId],
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

      setCreatedMinuteId(data.minute.id);
      onNotify("Minuta gerada no Livro de Atas.", "success");
    } catch {
      onNotify("Falha de conexão ao gerar minuta.", "error");
    } finally {
      setGeneratingMinute(false);
    }
  }

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={`Ficha Individual — ${card.student.name}`}
    >
      <form onSubmit={handleSaveCard} className="space-y-5">
        {hideSensitiveTags && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
            Modo projeção ativo: selos clínicos ocultos na tela para proteção de privacidade.
          </div>
        )}

        {/* Situação e Avaliações Externas Individuais */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label
              htmlFor="ficha-enrollment-status"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Situação no ciclo
            </label>
            <select
              id="ficha-enrollment-status"
              disabled={readOnly}
              value={enrollmentStatus}
              onChange={(e) =>
                setEnrollmentStatus(e.target.value as CouncilEnrollmentStatus)
              }
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              {Object.entries(COUNCIL_ENROLLMENT_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="ficha-ed1"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Prova Paraná — 1ª Ed. (%)
            </label>
            <input
              id="ficha-ed1"
              type="number"
              min={0}
              max={100}
              step="0.1"
              disabled={readOnly}
              value={ed1}
              onChange={(e) => setEd1(e.target.value)}
              placeholder="%"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="ficha-ed2"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Prova Paraná — 2ª Ed. (%)
            </label>
            <input
              id="ficha-ed2"
              type="number"
              min={0}
              max={100}
              step="0.1"
              disabled={readOnly}
              value={ed2}
              onChange={(e) => setEd2(e.target.value)}
              placeholder="%"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="ficha-ed3"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Prova Paraná — 3ª Ed. (%)
            </label>
            <input
              id="ficha-ed3"
              type="number"
              min={0}
              max={100}
              step="0.1"
              disabled={readOnly}
              value={ed3}
              onChange={(e) => setEd3(e.target.value)}
              placeholder="%"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Selos de Identificação */}
        <div className="space-y-2">
          <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">
            Selos de identificação pedagógica
          </span>
          <div className="flex flex-wrap gap-2">
            {visibleTagOptions.map((opt) => {
              const checked = tags.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={checked}
                  onClick={() => toggleTag(opt.value)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                    checked
                      ? "bg-sky-600 border-sky-600 text-white shadow-xs"
                      : "bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Comparativo dos 3 Trimestres */}
        {activeSubjects.length > 0 && (
          <div className="space-y-2">
            <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Evolução trimestral por componente curricular
            </span>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-left">
                    <th className="p-2 border-b border-slate-200 dark:border-slate-700 font-bold">
                      Componente
                    </th>
                    <th className="p-2 border-b border-slate-200 dark:border-slate-700 font-bold">
                      1º Trimestre
                    </th>
                    <th className="p-2 border-b border-slate-200 dark:border-slate-700 font-bold">
                      2º Trimestre
                    </th>
                    <th className="p-2 border-b border-slate-200 dark:border-slate-700 font-bold">
                      3º Trimestre
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeSubjects.map((subj) => (
                    <tr
                      key={subj.id}
                      className="border-b border-slate-100 dark:border-slate-800/80 last:border-b-0"
                    >
                      <td className="p-2 font-semibold text-slate-800 dark:text-slate-200">
                        {subj.name}
                      </td>
                      {([1, 2, 3] as const).map((tri) => {
                        const entry = card.subjectEntries.find(
                          (e) => e.subjectId === subj.id && e.trimester === tri
                        );
                        return (
                          <td key={tri} className="p-2">
                            {entry && entry.descriptorCodes.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1">
                                {entry.descriptorCodes.map((code) => {
                                  const d = COUNCIL_DESCRIPTORS.find((item) => item.code === code);
                                  return (
                                    <span
                                      key={code}
                                      className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                                        d?.badgeClass || "bg-slate-100 text-slate-700"
                                      }`}
                                      title={d?.fullLabel}
                                    >
                                      {code}
                                    </span>
                                  );
                                })}
                                {entry.grade !== null && entry.grade !== undefined && (
                                  <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300 ml-1">
                                    ({formatCouncilGradePtBr(entry.grade)})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Deliberações do Conselho no Trimestre Selecionado */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-900 dark:text-white">
              Deliberação do Conselho por Trimestre
            </span>
            <div className="flex items-center gap-1.5">
              {([1, 2, 3] as const).map((tri) => (
                <button
                  key={tri}
                  type="button"
                  onClick={() => setSelectedTrimester(tri)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    selectedTrimester === tri
                      ? "bg-slate-900 text-white dark:bg-sky-600"
                      : "bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  {tri}º Trimestre
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="ficha-qualitative-opinion"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Parecer qualitativo do {selectedTrimester}º trimestre
            </label>
            <textarea
              id="ficha-qualitative-opinion"
              rows={4}
              disabled={readOnly}
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
              placeholder="Síntese pedagógica, encaminhamentos combinados com a família e recomendações..."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Componentes abaixo da média ({selectedTrimester}º trimestre)
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={addBelowAvgRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Adicionar componente</span>
                </button>
              )}
            </div>

            {belowAvgItems.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nenhum componente abaixo da média registrado neste trimestre.
              </p>
            ) : (
              <div className="space-y-2">
                {belowAvgItems.map((item, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <select
                      disabled={readOnly}
                      aria-label={`Componente abaixo da média ${idx + 1}`}
                      value={item.subjectId || ""}
                      onChange={(e) => {
                        const subjId = e.target.value || null;
                        const found = activeSubjects.find((s) => s.id === subjId);
                        setBelowAvgItems((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  subjectId: subjId,
                                  subjectName: found ? found.name : row.subjectName,
                                }
                              : row
                          )
                        );
                      }}
                      className="flex-1 min-w-[180px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="">Outro componente...</option>
                      {activeSubjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>

                    {!item.subjectId && (
                      <input
                        type="text"
                        disabled={readOnly}
                        aria-label={`Nome do componente ${idx + 1}`}
                        placeholder="Nome do componente"
                        value={item.subjectName}
                        onChange={(e) =>
                          setBelowAvgItems((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, subjectName: e.target.value } : row
                            )
                          )
                        }
                        className="flex-1 min-w-[150px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                    )}

                    <input
                      type="number"
                      min={0}
                      max={10}
                      step="0.1"
                      disabled={readOnly}
                      aria-label={`Nota em ${item.subjectName || `item ${idx + 1}`}`}
                      placeholder="0,0 a 10,0"
                      value={item.grade !== null && item.grade !== undefined ? String(item.grade) : ""}
                      onChange={(e) => {
                        const val = e.target.value.trim().replace(",", ".");
                        const num = val ? Number.parseFloat(val) : null;
                        setBelowAvgItems((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  grade: num !== null && Number.isFinite(num) ? num : null,
                                }
                              : row
                          )
                        );
                      }}
                      className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />

                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() =>
                          setBelowAvgItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label={`Remover componente ${item.subjectName || idx + 1}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {createdMinuteId && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 p-3 flex items-center justify-between gap-2 text-xs text-emerald-900 dark:text-emerald-200">
            <span className="font-semibold">
              Minuta de ata registrada em rascunho no Livro de Atas.
            </span>
            <Link
              href={`/atas?studentId=${card.studentId}`}
              className="font-extrabold underline hover:text-emerald-700"
            >
              Abrir Livro de Atas
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/conselho-classe/${board.id}/imprimir?mode=aluno&studentId=${card.studentId}&trimester=${selectedTrimester}${
                hideSensitiveTags ? "&hideHealthTags=1" : ""
              }`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir ficha</span>
            </Link>

            {!readOnly && (
              <button
                type="button"
                disabled={generatingMinute}
                onClick={handleGenerateStudentMinute}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 text-xs font-bold text-indigo-800 dark:text-indigo-200 transition cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>{generatingMinute ? "Gerando..." : "Gerar minuta"}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
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
                <span>{saving ? "Salvando..." : "Salvar ficha"}</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}
