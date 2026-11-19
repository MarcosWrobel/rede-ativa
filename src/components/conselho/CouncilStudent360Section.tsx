"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ClipboardList, ExternalLink, Eye, EyeOff, Printer } from "lucide-react";
import {
  COUNCIL_DESCRIPTORS,
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  formatSegmentLabel,
  formatShiftLabel,
  parseBelowAverageList,
  type CouncilEnrollmentStatus,
  type CouncilTrimesterNumber,
} from "./types";

export interface Student360CouncilCardRecord {
  id: string;
  schoolId: string;
  boardId: string;
  studentId: string;
  enrollmentStatus: string;
  externalEvalEd1Percent: number | null;
  externalEvalEd2Percent: number | null;
  externalEvalEd3Percent: number | null;
  tags: string[];
  hasSensitiveHealthTag: boolean;
  trimester1Opinion: string | null;
  trimester2Opinion: string | null;
  trimester3Opinion: string | null;
  trimester1BelowAvgJson: string | null;
  trimester2BelowAvgJson: string | null;
  trimester3BelowAvgJson: string | null;
  board: {
    id: string;
    year: number;
    schoolId: string;
    classGroup: {
      id: string;
      name: string;
      segment: string;
      shift: string;
    };
    subjects: Array<{
      id: string;
      name: string;
      teacherName: string | null;
      displayOrder: number;
    }>;
  };
  subjectEntries: Array<{
    id: string;
    subjectId: string;
    trimester: number;
    descriptorCodes: number[];
    grade: number | null;
  }>;
}

interface CouncilStudent360SectionProps {
  councilCards: Student360CouncilCardRecord[];
}

function getTrimesterOpinion(
  card: Student360CouncilCardRecord,
  trimester: CouncilTrimesterNumber
): string {
  if (trimester === 1) return card.trimester1Opinion || "";
  if (trimester === 2) return card.trimester2Opinion || "";
  return card.trimester3Opinion || "";
}

function getTrimesterBelowAvg(
  card: Student360CouncilCardRecord,
  trimester: CouncilTrimesterNumber
) {
  if (trimester === 1) return parseBelowAverageList(card.trimester1BelowAvgJson);
  if (trimester === 2) return parseBelowAverageList(card.trimester2BelowAvgJson);
  return parseBelowAverageList(card.trimester3BelowAvgJson);
}

export default function CouncilStudent360Section({
  councilCards,
}: CouncilStudent360SectionProps) {
  const [hideSensitiveTags, setHideSensitiveTags] = useState(false);

  const tagMap = useMemo(
    () => new Map(COUNCIL_STUDENT_TAG_OPTIONS.map((t) => [t.value, t])),
    []
  );
  const descriptorMap = useMemo(
    () => new Map(COUNCIL_DESCRIPTORS.map((d) => [d.code, d])),
    []
  );

  return (
    <section
      aria-label="Acompanhamento trimestral no conselho de classe"
      className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-sky-600" />
          <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
            Acompanhamento Trimestral (Conselho de Classe)
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setHideSensitiveTags((prev) => !prev)}
          aria-pressed={hideSensitiveTags}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
            hideSensitiveTags
              ? "bg-amber-50 border-amber-300 text-amber-900"
              : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          {hideSensitiveTags ? (
            <EyeOff className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
          <span>{hideSensitiveTags ? "Exibir laudo e AEE" : "Ocultar laudo e AEE"}</span>
        </button>
      </div>

      {councilCards.length === 0 ? (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
          <span>
            Nenhum registro trimestral do conselho de classe lançado para este estudante ainda.
          </span>
          <Link
            href="/conselho-classe"
            className="inline-flex items-center gap-1.5 font-bold text-sky-700 hover:text-sky-900 shrink-0"
          >
            <span>Abrir Conselho de Classe</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {councilCards.map((card) => {
            const visibleTags = card.tags.filter((tagValue) => {
              const meta = tagMap.get(tagValue as never);
              if (!meta) return false;
              if (hideSensitiveTags && meta.isSensitiveHealth) return false;
              return true;
            });

            const subjectNameById = new Map(
              card.board.subjects.map((s) => [s.id, s.name])
            );

            return (
              <div
                key={card.id}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-900 text-white text-[11px] font-bold">
                        {card.board.year}
                      </span>
                      <span className="text-sm font-extrabold text-slate-900">
                        {card.board.classGroup.name}
                      </span>
                      <span className="text-xs text-slate-600">
                        {formatSegmentLabel(card.board.classGroup.segment)} •{" "}
                        {formatShiftLabel(card.board.classGroup.shift)}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] font-bold text-slate-700">
                        {COUNCIL_ENROLLMENT_STATUS_LABELS[
                          card.enrollmentStatus as CouncilEnrollmentStatus
                        ] || card.enrollmentStatus}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      <span>
                        Prova Paraná: 1ª Ed. {card.externalEvalEd1Percent ?? "—"}% | 2ª Ed.{" "}
                        {card.externalEvalEd2Percent ?? "—"}% | 3ª Ed.{" "}
                        {card.externalEvalEd3Percent ?? "—"}%
                      </span>
                    </div>

                    {visibleTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {visibleTags.map((tagVal) => {
                          const meta = tagMap.get(tagVal as never);
                          if (!meta) return null;
                          return (
                            <span
                              key={tagVal}
                              className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${meta.badgeClass}`}
                            >
                              {meta.label}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/conselho-classe/${card.board.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-sky-600" />
                      <span>Abrir conselho da turma</span>
                    </Link>
                    <Link
                      href={`/conselho-classe/${card.board.id}/imprimir?mode=aluno&studentId=${card.studentId}&trimester=1${
                        hideSensitiveTags ? "&hideHealthTags=1" : ""
                      }`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Imprimir ficha individual</span>
                    </Link>
                  </div>
                </div>

                {/* 3 Cartões Trimestrais */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {([1, 2, 3] as const).map((tri) => {
                    const opinion = getTrimesterOpinion(card, tri);
                    const belowAvg = getTrimesterBelowAvg(card, tri);
                    const entries = card.subjectEntries.filter(
                      (e) => e.trimester === tri && e.descriptorCodes.length > 0
                    );
                    const alertEntries = entries.filter((e) =>
                      e.descriptorCodes.some((c) => c === 2 || c === 3 || c === 4)
                    );

                    return (
                      <div
                        key={tri}
                        className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                          <strong className="text-slate-900 font-extrabold">
                            {tri}º Trimestre
                          </strong>
                          <span className="text-[11px] text-slate-500">
                            {entries.length} componente(s)
                          </span>
                        </div>

                        <div>
                          <span className="text-[11px] font-bold text-slate-500 block">
                            Parecer do conselho
                          </span>
                          <p className="text-slate-800 whitespace-pre-line mt-0.5">
                            {opinion || "Sem parecer registrado."}
                          </p>
                        </div>

                        {belowAvg.length > 0 && (
                          <div className="rounded-lg bg-rose-50 border border-rose-200 p-2 text-[11px] text-rose-900">
                            <strong className="block font-bold">
                              Abaixo da média:
                            </strong>
                            <span>
                              {belowAvg
                                .map((b) =>
                                  b.grade !== null ? `${b.subjectName} (${b.grade})` : b.subjectName
                                )
                                .join(", ")}
                            </span>
                          </div>
                        )}

                        {entries.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[11px] font-bold text-slate-500 block">
                              Descritivos por componente
                            </span>
                            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                              {(alertEntries.length > 0 ? alertEntries : entries).map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-center justify-between gap-2 text-[11px] border-b border-slate-100 last:border-b-0 py-0.5"
                                >
                                  <span className="text-slate-700 truncate">
                                    {subjectNameById.get(entry.subjectId) || "Componente"}
                                  </span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {entry.descriptorCodes.map((code) => {
                                      const meta = descriptorMap.get(code as 1 | 2 | 3 | 4 | 5);
                                      return (
                                        <span
                                          key={code}
                                          title={meta?.fullLabel}
                                          className={`px-1.5 py-0.2 rounded border text-[10px] font-bold ${
                                            meta?.badgeClass || "bg-slate-100 text-slate-700"
                                          }`}
                                        >
                                          {code}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                              {alertEntries.length > 0 && entries.length > alertEntries.length && (
                                <p className="text-[10px] text-slate-500 pt-0.5">
                                  + {entries.length - alertEntries.length} componente(s) dentro das
                                  expectativas.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
