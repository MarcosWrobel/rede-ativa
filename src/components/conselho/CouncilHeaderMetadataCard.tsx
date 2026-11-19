"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  BookOpen,
  Eye,
  EyeOff,
  FileUp,
  Printer,
  Save,
  ChevronDown,
  ChevronUp,
  Users,
  Award,
  LayoutGrid,
} from "lucide-react";
import {
  COUNCIL_SEATING_MAP_LABELS,
  formatSegmentLabel,
  formatShiftLabel,
  type CouncilBoardDetailRecord,
  type CouncilSeatingMapMode,
  type CouncilTrimesterNumber,
} from "./types";

interface CouncilHeaderMetadataCardProps {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  hideSensitiveTags: boolean;
  onToggleHideSensitiveTags: () => void;
  onOpenSubjectsModal: () => void;
  onOpenPdfImportModal?: () => void;
  onBoardUpdated: (updated: CouncilBoardDetailRecord) => void;
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

export default function CouncilHeaderMetadataCard({
  board,
  activeTrimester,
  hideSensitiveTags,
  onToggleHideSensitiveTags,
  onOpenSubjectsModal,
  onOpenPdfImportModal,
  onBoardUpdated,
  onNotify,
  readOnly = false,
}: CouncilHeaderMetadataCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [peerLeaderStudentId, setPeerLeaderStudentId] = useState(board.peerLeaderStudentId || "");
  const [peerLeaderName, setPeerLeaderName] = useState(board.peerLeaderName || "");
  const [teacherLeaderStudentId, setTeacherLeaderStudentId] = useState(
    board.teacherLeaderStudentId || ""
  );
  const [teacherLeaderName, setTeacherLeaderName] = useState(board.teacherLeaderName || "");
  const [ed1, setEd1] = useState(
    board.externalEvalEd1Percent !== null && board.externalEvalEd1Percent !== undefined
      ? String(board.externalEvalEd1Percent)
      : ""
  );
  const [ed2, setEd2] = useState(
    board.externalEvalEd2Percent !== null && board.externalEvalEd2Percent !== undefined
      ? String(board.externalEvalEd2Percent)
      : ""
  );
  const [ed3, setEd3] = useState(
    board.externalEvalEd3Percent !== null && board.externalEvalEd3Percent !== undefined
      ? String(board.externalEvalEd3Percent)
      : ""
  );
  const [seatingMapMode, setSeatingMapMode] = useState<CouncilSeatingMapMode>(
    (board.seatingMapMode as CouncilSeatingMapMode) || "REVEZAMENTO_MENSAL"
  );
  const [seatingMapNotes, setSeatingMapNotes] = useState(board.seatingMapNotes || "");

  useEffect(() => {
    setPeerLeaderStudentId(board.peerLeaderStudentId || "");
    setPeerLeaderName(board.peerLeaderName || "");
    setTeacherLeaderStudentId(board.teacherLeaderStudentId || "");
    setTeacherLeaderName(board.teacherLeaderName || "");
    setEd1(
      board.externalEvalEd1Percent !== null && board.externalEvalEd1Percent !== undefined
        ? String(board.externalEvalEd1Percent)
        : ""
    );
    setEd2(
      board.externalEvalEd2Percent !== null && board.externalEvalEd2Percent !== undefined
        ? String(board.externalEvalEd2Percent)
        : ""
    );
    setEd3(
      board.externalEvalEd3Percent !== null && board.externalEvalEd3Percent !== undefined
        ? String(board.externalEvalEd3Percent)
        : ""
    );
    setSeatingMapMode((board.seatingMapMode as CouncilSeatingMapMode) || "REVEZAMENTO_MENSAL");
    setSeatingMapNotes(board.seatingMapNotes || "");
  }, [board]);

  const activeStudents = board.studentCards.filter((c) => c.enrollmentStatus === "ATIVO");
  const activeSubjectsCount = board.subjects.filter((s) => s.active).length;

  async function handleSaveMetadata(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/conselho-classe/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peerLeaderStudentId: peerLeaderStudentId || null,
          peerLeaderName: peerLeaderName.trim() || null,
          teacherLeaderStudentId: teacherLeaderStudentId || null,
          teacherLeaderName: teacherLeaderName.trim() || null,
          externalEvalEd1Percent: toNullablePercent(ed1),
          externalEvalEd2Percent: toNullablePercent(ed2),
          externalEvalEd3Percent: toNullablePercent(ed3),
          seatingMapMode,
          seatingMapNotes: seatingMapNotes.trim() || null,
        }),
      });
      const data: { success?: boolean; board?: CouncilBoardDetailRecord; error?: string } =
        await res.json();
      if (!res.ok || !data.board) {
        onNotify(data.error || "Não foi possível salvar os dados da turma.", "error");
        return;
      }
      onBoardUpdated(data.board);
      onNotify("Dados da turma atualizados.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar os dados da turma.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label="Resumo e metadados da turma"
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Conselho de Classe — {board.classGroup.name}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
              {board.year}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {formatSegmentLabel(board.classGroup.segment)} • {formatShiftLabel(board.classGroup.shift)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-sky-600" />
              {activeStudents.length} estudantes ativos ({board.studentCards.length} na ficha)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
              {activeSubjectsCount} componentes curriculares
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5 text-indigo-600" />
              Mapa: {COUNCIL_SEATING_MAP_LABELS[seatingMapMode] || seatingMapMode}
            </span>
            {(board.peerLeaderName || board.teacherLeaderName) && (
              <span className="inline-flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-amber-600" />
                Líderes:{" "}
                {[
                  board.peerLeaderName ? `${board.peerLeaderName} (turma)` : null,
                  board.teacherLeaderName ? `${board.teacherLeaderName} (docentes)` : null,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSubjectsModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-sky-600" />
            <span>Componentes</span>
          </button>

          {!readOnly && onOpenPdfImportModal && (
            <button
              type="button"
              onClick={onOpenPdfImportModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-xs font-bold text-sky-900 dark:text-sky-200 transition cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Importar PDF SERE</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleHideSensitiveTags}
            aria-pressed={hideSensitiveTags}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
              hideSensitiveTags
                ? "bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200"
                : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
            title="Redução da exposição de dados sensíveis na tela durante reuniões"
          >
            {hideSensitiveTags ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            <span>{hideSensitiveTags ? "Exibir laudo e AEE" : "Ocultar laudo e AEE"}</span>
          </button>

          <Link
            href={`/conselho-classe/${board.id}/imprimir?mode=turma&trimester=${activeTrimester}${
              hideSensitiveTags ? "&hideHealthTags=1" : ""
            }`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-500 text-white text-xs font-bold transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir ficha</span>
          </Link>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer"
          >
            <span>Metadados e líderes</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <form
          onSubmit={handleSaveMetadata}
          className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="peer-leader-select"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Líder de turma (eleito pelos pares)
            </label>
            <select
              id="peer-leader-select"
              disabled={readOnly}
              value={peerLeaderStudentId}
              onChange={(e) => {
                const selectedId = e.target.value;
                setPeerLeaderStudentId(selectedId);
                const found = board.studentCards.find((c) => c.studentId === selectedId);
                if (found) setPeerLeaderName(found.student.name);
                else if (!selectedId) setPeerLeaderName("");
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="">Selecionar estudante...</option>
              {board.studentCards.map((c) => (
                <option key={c.studentId} value={c.studentId}>
                  {c.student.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              disabled={readOnly}
              aria-label="Nome do líder eleito pelos pares"
              placeholder="Ou digite o nome do líder"
              value={peerLeaderName}
              onChange={(e) => setPeerLeaderName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="teacher-leader-select"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Líder indicado pelos docentes
            </label>
            <select
              id="teacher-leader-select"
              disabled={readOnly}
              value={teacherLeaderStudentId}
              onChange={(e) => {
                const selectedId = e.target.value;
                setTeacherLeaderStudentId(selectedId);
                const found = board.studentCards.find((c) => c.studentId === selectedId);
                if (found) setTeacherLeaderName(found.student.name);
                else if (!selectedId) setTeacherLeaderName("");
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="">Selecionar estudante...</option>
              {board.studentCards.map((c) => (
                <option key={c.studentId} value={c.studentId}>
                  {c.student.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              disabled={readOnly}
              aria-label="Nome do líder indicado pelos docentes"
              placeholder="Ou digite o nome do líder"
              value={teacherLeaderName}
              onChange={(e) => setTeacherLeaderName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Prova Paraná — Média da turma (%)
            </span>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="board-ed1" className="block text-[11px] text-slate-500">
                  1ª Edição
                </label>
                <input
                  id="board-ed1"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  disabled={readOnly}
                  value={ed1}
                  onChange={(e) => setEd1(e.target.value)}
                  placeholder="%"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="board-ed2" className="block text-[11px] text-slate-500">
                  2ª Edição
                </label>
                <input
                  id="board-ed2"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  disabled={readOnly}
                  value={ed2}
                  onChange={(e) => setEd2(e.target.value)}
                  placeholder="%"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="board-ed3" className="block text-[11px] text-slate-500">
                  3ª Edição
                </label>
                <input
                  id="board-ed3"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  disabled={readOnly}
                  value={ed3}
                  onChange={(e) => setEd3(e.target.value)}
                  placeholder="%"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="seating-map-mode"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Organização do mapa de sala
            </label>
            <select
              id="seating-map-mode"
              disabled={readOnly}
              value={seatingMapMode}
              onChange={(e) => setSeatingMapMode(e.target.value as CouncilSeatingMapMode)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              {Object.entries(COUNCIL_SEATING_MAP_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              disabled={readOnly}
              aria-label="Observação do mapa de sala"
              placeholder="Critérios ou observações do mapa de sala"
              value={seatingMapNotes}
              onChange={(e) => setSeatingMapNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          {!readOnly && (
            <div className="md:col-span-2 xl:col-span-4 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Salvando..." : "Salvar metadados"}</span>
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
