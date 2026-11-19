"use client";

import { CheckCircle2, Link2 } from "lucide-react";
import {
  DEFAULT_PRE_COUNCIL_ACK_STATEMENT,
  formatPreCouncilDatePtBr,
  formatPreCouncilDateTimePtBr,
  type CitedStudentSummaryItem,
  type PreCouncilAlertsBundle,
  type SubjectMatrixFillStats,
} from "./preCouncilUtils";
import type { PreCouncilData } from "./types";

interface CouncilPreCouncilSynthesisAckViewProps {
  draft: PreCouncilData;
  onUpdateDraft: (updater: (prev: PreCouncilData) => PreCouncilData) => void;
  citedSummary: CitedStudentSummaryItem[];
  alertsBundle: PreCouncilAlertsBundle;
  matrixStatsBySubjectId: Record<string, SubjectMatrixFillStats>;
  onOpenUnifiedTeacherLink: (subjectId: string | null) => void;
  readOnly?: boolean;
}

export default function CouncilPreCouncilSynthesisAckView({
  draft,
  onUpdateDraft,
  citedSummary,
  alertsBundle,
  matrixStatsBySubjectId,
  onOpenUnifiedTeacherLink,
  readOnly = false,
}: CouncilPreCouncilSynthesisAckViewProps) {
  return (
    <div className="space-y-4">
      {/* Resumo de apoio dos componentes e frequência */}
      {(citedSummary.length > 0 || alertsBundle.lowAttendanceStudents.length > 0) && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          {citedSummary.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                Estudantes citados nas conversas por componente
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {citedSummary.map((item) => (
                  <span
                    key={item.studentId}
                    title={item.subjectNames.join(", ")}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-[11px] font-bold text-sky-900 dark:text-sky-200"
                  >
                    <span>{item.studentName}</span>
                    <span className="text-[10px] text-sky-700 dark:text-sky-300">
                      ({item.count} comp.)
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {alertsBundle.lowAttendanceStudents.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-extrabold text-amber-800 dark:text-amber-300">
                Estudantes com frequência abaixo de 75%
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {alertsBundle.lowAttendanceStudents.map((item) => (
                  <span
                    key={item.studentId}
                    className="px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-[11px] font-semibold text-amber-900 dark:text-amber-200"
                  >
                    {item.studentName} ({item.attendancePercent.toFixed(1)}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Síntese do Pré-Conselho da Turma */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wide">
          Síntese do Pré-Conselho da Turma
        </h3>

        <div className="space-y-1.5">
          <label
            htmlFor="pre-syn-difficulties"
            className="block text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            Principais dificuldades identificadas na turma
          </label>
          <textarea
            id="pre-syn-difficulties"
            rows={3}
            disabled={readOnly}
            value={draft.synthesis.mainDifficulties}
            onChange={(e) =>
              onUpdateDraft((prev) => ({
                ...prev,
                synthesis: { ...prev.synthesis, mainDifficulties: e.target.value },
              }))
            }
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="pre-syn-priority-students"
            className="block text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            Estudantes que necessitam de maior acompanhamento pedagógico
          </label>
          <textarea
            id="pre-syn-priority-students"
            rows={3}
            disabled={readOnly}
            value={draft.synthesis.priorityStudents}
            onChange={(e) =>
              onUpdateDraft((prev) => ({
                ...prev,
                synthesis: { ...prev.synthesis, priorityStudents: e.target.value },
              }))
            }
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="pre-syn-attendance"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Questões relacionadas à frequência
            </label>
            <textarea
              id="pre-syn-attendance"
              rows={3}
              disabled={readOnly}
              value={draft.synthesis.attendanceIssues}
              onChange={(e) =>
                onUpdateDraft((prev) => ({
                  ...prev,
                  synthesis: { ...prev.synthesis, attendanceIssues: e.target.value },
                }))
              }
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="pre-syn-behavior"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Questões relacionadas ao comportamento/convivência
            </label>
            <textarea
              id="pre-syn-behavior"
              rows={3}
              disabled={readOnly}
              value={draft.synthesis.behaviorIssues}
              onChange={(e) =>
                onUpdateDraft((prev) => ({
                  ...prev,
                  synthesis: { ...prev.synthesis, behaviorIssues: e.target.value },
                }))
              }
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="pre-syn-actions"
            className="block text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            Encaminhamentos que ficarão sob responsabilidade da equipe pedagógica
          </label>
          <textarea
            id="pre-syn-actions"
            rows={3}
            disabled={readOnly}
            value={draft.synthesis.pedagogicalActions}
            onChange={(e) =>
              onUpdateDraft((prev) => ({
                ...prev,
                synthesis: { ...prev.synthesis, pedagogicalActions: e.target.value },
              }))
            }
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Registro de Ciência dos Docentes */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="space-y-1">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Registro de Ciência dos Docentes
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {DEFAULT_PRE_COUNCIL_ACK_STATEMENT}
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onOpenUnifiedTeacherLink(null)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900 text-xs font-bold text-sky-900 dark:text-sky-200 transition cursor-pointer shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Link geral da turma</span>
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-left">
                <th className="p-2.5 font-bold">Professor(a)</th>
                <th className="p-2.5 font-bold">Componente Curricular</th>
                <th className="p-2.5 font-bold">Matriz</th>
                <th className="p-2.5 font-bold">Conversa</th>
                <th className="p-2.5 font-bold">Ciência</th>
                <th className="p-2.5 font-bold">Data</th>
                {!readOnly && <th className="p-2.5 font-bold text-right">Link</th>}
              </tr>
            </thead>
            <tbody>
              {draft.conversations.map((conv) => {
                const stats = conv.subjectId
                  ? matrixStatsBySubjectId[conv.subjectId]
                  : undefined;

                return (
                  <tr key={conv.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">
                      {conv.teacherName || "Não informado"}
                    </td>
                    <td className="p-2.5 text-slate-700 dark:text-slate-300">
                      {conv.subjectName}
                    </td>
                    <td className="p-2.5 text-slate-600 dark:text-slate-400">
                      {stats ? `${stats.filledCount}/${stats.totalActiveCount}` : "—"}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          conv.conversationStatus === "COMPLETED"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                        }`}
                      >
                        {conv.conversationStatus === "COMPLETED" ? "Realizada" : "Pendente"}
                      </span>
                    </td>
                    <td className="p-2.5">
                      {conv.digitalAckEmail ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Ciência digital</span>
                          </span>
                          <div className="text-[10px] text-slate-500">
                            {conv.digitalAckName} ({conv.digitalAckEmail})
                            {conv.digitalAckAt
                              ? ` • ${formatPreCouncilDateTimePtBr(conv.digitalAckAt)}`
                              : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">Folha física A4 / Aguardando</span>
                      )}
                    </td>
                    <td className="p-2.5 text-slate-600 dark:text-slate-400">
                      {formatPreCouncilDatePtBr(conv.conversationDate || conv.digitalAckAt) || "—"}
                    </td>
                    {!readOnly && (
                      <td className="p-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenUnifiedTeacherLink(conv.subjectId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          <Link2 className="w-3 h-3" />
                          <span>Gerar</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Rodapé Responsável (Página 3) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="space-y-1">
            <label
              htmlFor="pre-pedagogue-name"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Pedagoga responsável (rodapé do documento)
            </label>
            <input
              id="pre-pedagogue-name"
              type="text"
              disabled={readOnly}
              value={draft.responsiblePedagogueName}
              onChange={(e) =>
                onUpdateDraft((prev) => ({
                  ...prev,
                  responsiblePedagogueName: e.target.value,
                }))
              }
              placeholder="Nome completo da profissional responsável"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="pre-pedagogue-role"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              Cargo / função no rodapé
            </label>
            <input
              id="pre-pedagogue-role"
              type="text"
              disabled={readOnly}
              value={draft.responsiblePedagogueRole}
              onChange={(e) =>
                onUpdateDraft((prev) => ({
                  ...prev,
                  responsiblePedagogueRole: e.target.value,
                }))
              }
              placeholder="Pedagoga Responsável"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
