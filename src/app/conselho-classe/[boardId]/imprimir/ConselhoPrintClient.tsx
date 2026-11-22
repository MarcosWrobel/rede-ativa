"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import {
  formatShortStudentName,
  getDisplayGridForPerspective,
  getEffectiveDoorSideForPerspective,
  getEffectiveTeacherDeskForPerspective,
  parseSeatingMapStore,
  type SeatingMapPrintPerspective,
} from "@/components/conselho/seatingMapUtils";
import {
  buildInitialPreCouncilData,
  DEFAULT_PRE_COUNCIL_ACK_STATEMENT,
  DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
  formatPreCouncilDatePtBr,
  formatPreCouncilDateTimePtBr,
  parsePreCouncilData,
} from "@/components/conselho/preCouncilUtils";
import {
  COUNCIL_ACTION_RESPONSIBLE_LABELS,
  COUNCIL_DESCRIPTORS,
  COUNCIL_ENROLLMENT_STATUS_LABELS,
  COUNCIL_SEATING_MAP_LABELS,
  COUNCIL_STUDENT_TAG_OPTIONS,
  formatCouncilCalendarDatePtBr,
  formatCouncilGradePtBr,
  formatSegmentLabel,
  formatShiftLabel,
  getCardBelowAvgForTrimester,
  parsePostActionItemsList,
  type CouncilBoardDetailRecord,
  type CouncilEnrollmentStatus,
  type CouncilSeatingMapMode,
  type CouncilTrimesterNumber,
  type SchoolPrintMeta,
} from "@/components/conselho/types";

export type CouncilPrintMode = "turma" | "pre-conselho" | "pos-conselho" | "aluno" | "mapa-sala";

interface AnonymizedOpinions {
  t1: string;
  t2: string;
  t3: string;
}

interface ConselhoPrintClientProps {
  board: CouncilBoardDetailRecord;
  school: SchoolPrintMeta;
  initialMode: CouncilPrintMode;
  initialTrimester: CouncilTrimesterNumber;
  initialStudentId: string | null;
  initialHideHealthTags: boolean;
  anonymizedOpinionsByStudentId: Record<string, AnonymizedOpinions>;
  initialMapId?: string | null;
  initialPerspective?: SeatingMapPrintPerspective;
}

function getSchoolNetworkHeader(school: SchoolPrintMeta) {
  const network = school.network || "ESTADUAL";
  if (network === "MUNICIPAL") {
    return {
      line1: `Prefeitura Municipal de ${school.city || "Município"} • Secretaria Municipal de Educação`,
      line2: school.nre
        ? `Supervisão / Regional: ${school.nre}`
        : "Secretaria Municipal de Educação",
    };
  }
  if (network === "PRIVADA") {
    return {
      line1: "Rede de Ensino Particular / Privada",
      line2: school.nre ? `Supervisão Regional: ${school.nre}` : "Diretoria de Ensino",
    };
  }
  return {
    line1: `Governo do Estado ${school.state === "PR" ? "do Paraná" : `de ${school.state || "PR"}`} • Secretaria de Estado da Educação`,
    line2: `Núcleo Regional de Educação de ${school.nre || school.city || "Regional"}`,
  };
}

export default function ConselhoPrintClient({
  board,
  school,
  initialMode,
  initialTrimester,
  initialStudentId,
  initialHideHealthTags,
  anonymizedOpinionsByStudentId,
  initialMapId = null,
  initialPerspective = "ROOM",
}: ConselhoPrintClientProps) {
  const [mode, setMode] = useState<CouncilPrintMode>(initialMode);
  const [trimester, setTrimester] = useState<CouncilTrimesterNumber>(initialTrimester);
  const [studentId, setStudentId] = useState<string>(
    initialStudentId || board.studentCards[0]?.studentId || ""
  );
  const [hideHealthTags, setHideHealthTags] = useState<boolean>(initialHideHealthTags);
  const seatingMapStore = useMemo(
    () => parseSeatingMapStore(board.seatingMapLayoutJson),
    [board.seatingMapLayoutJson]
  );
  const [selectedMapId, setSelectedMapId] = useState<string>(
    () =>
      (initialMapId && seatingMapStore.maps.some((m) => m.id === initialMapId)
        ? initialMapId
        : seatingMapStore.activeMapId ?? seatingMapStore.maps[0]?.id ?? "")
  );
  const [seatingPerspective, setSeatingPerspective] =
    useState<SeatingMapPrintPerspective>(initialPerspective);

  const networkHeader = getSchoolNetworkHeader(school);
  const schoolLogo = school.logoUrl || "/logo.svg";
  const activeSubjects = useMemo(
    () => board.subjects.filter((s) => s.active),
    [board.subjects]
  );
  const trimesterRecord = useMemo(
    () => board.trimesters.find((t) => t.trimester === trimester) || null,
    [board.trimesters, trimester]
  );
  const tagMap = useMemo(
    () => new Map(COUNCIL_STUDENT_TAG_OPTIONS.map((t) => [t.value, t])),
    []
  );
  const selectedStudentCard = useMemo(
    () => board.studentCards.find((c) => c.studentId === studentId) || null,
    [board.studentCards, studentId]
  );

  const postActions = useMemo(
    () => parsePostActionItemsList(trimesterRecord?.postCouncilActionItemsJson),
    [trimesterRecord]
  );

  const selectedAnonymizedOpinion = useMemo(() => {
    if (!selectedStudentCard) return "";
    const ops = anonymizedOpinionsByStudentId[selectedStudentCard.studentId];
    if (!ops) return "";
    if (trimester === 1) return ops.t1;
    if (trimester === 2) return ops.t2;
    return ops.t3;
  }, [selectedStudentCard, anonymizedOpinionsByStudentId, trimester]);

  const selectedSeatingMap = useMemo(
    () =>
      seatingMapStore.maps.find((m) => m.id === selectedMapId) ??
      seatingMapStore.maps[0] ??
      null,
    [seatingMapStore.maps, selectedMapId]
  );

  const cardByStudentId = useMemo(
    () => new Map(board.studentCards.map((c) => [c.studentId, c])),
    [board.studentCards]
  );

  const preCouncilData = useMemo(
    () =>
      parsePreCouncilData(trimesterRecord?.preCouncilJson) ??
      buildInitialPreCouncilData({
        trimester,
        subjects: board.subjects,
      }),
    [trimesterRecord?.preCouncilJson, trimester, board.subjects]
  );

  const docTitle =
    mode === "turma"
      ? `Ficha Trimestral da Turma — ${trimester}º Trimestre / ${board.year}`
      : mode === "pre-conselho"
        ? `PRÉ-CONSELHO DE CLASSE — ${preCouncilData.periodLabel} / ${board.year}`
        : mode === "pos-conselho"
          ? `Ata de Reunião de Pós-Conselho — ${trimester}º Trimestre / ${board.year}`
          : mode === "mapa-sala"
            ? `Mapa de Sala — ${selectedSeatingMap ? `${selectedSeatingMap.name} • ` : ""}${board.year}`
            : `Ficha Individual do Estudante — ${trimester}º Trimestre / ${board.year}`;

  const isLandscapePrint = mode === "mapa-sala" || mode === "turma";

  return (
    <div className={`${isLandscapePrint ? "max-w-7xl" : "max-w-5xl"} mx-auto space-y-5`}>
      {isLandscapePrint && (
        <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } }"}</style>
      )}

      {/* Barra de Controle (Oculta na Impressão) */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/conselho-classe/${board.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-slate-950"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao conselho</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Tipo de ficha para impressão"
            value={mode}
            onChange={(e) => setMode(e.target.value as CouncilPrintMode)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100"
          >
            <option value="turma">Ficha da Turma</option>
            <option value="pre-conselho">Pré-Conselho de Classe</option>
            <option value="pos-conselho">Reunião de Pós-Conselho</option>
            <option value="aluno">Ficha Individual do Estudante</option>
            <option value="mapa-sala">Mapa de Sala (A4 Paisagem)</option>
          </select>

          {mode !== "mapa-sala" && (
            <select
              aria-label="Trimestre para impressão"
              value={trimester}
              onChange={(e) => setTrimester(Number(e.target.value) as CouncilTrimesterNumber)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100"
            >
              <option value={1}>1º Trimestre</option>
              <option value={2}>2º Trimestre</option>
              <option value={3}>3º Trimestre</option>
            </select>
          )}

          {mode === "mapa-sala" && seatingMapStore.maps.length > 0 && (
            <select
              aria-label="Selecionar versão do mapa de sala"
              value={selectedSeatingMap?.id ?? ""}
              onChange={(e) => setSelectedMapId(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100 max-w-[220px]"
            >
              {seatingMapStore.maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {seatingMapStore.activeMapId === m.id ? " (Vigente)" : ""}
                </option>
              ))}
            </select>
          )}

          {mode === "mapa-sala" && (
            <div
              role="group"
              aria-label="Orientação do mapa de sala para impressão"
              className="inline-flex items-center rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
            >
              <button
                type="button"
                aria-pressed={seatingPerspective === "ROOM"}
                onClick={() => setSeatingPerspective("ROOM")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  seatingPerspective === "ROOM"
                    ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-300"
                }`}
              >
                Visão da sala (quadro no topo)
              </button>
              <button
                type="button"
                aria-pressed={seatingPerspective === "TEACHER"}
                onClick={() => setSeatingPerspective("TEACHER")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  seatingPerspective === "TEACHER"
                    ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-300"
                }`}
              >
                Visão do professor (quadro na base)
              </button>
            </div>
          )}

          {mode === "aluno" && (
            <select
              aria-label="Selecionar estudante para impressão"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100 max-w-[220px]"
            >
              {board.studentCards.map((c) => (
                <option key={c.studentId} value={c.studentId}>
                  {c.student.name}
                </option>
              ))}
            </select>
          )}

          {mode !== "pre-conselho" && mode !== "pos-conselho" && mode !== "mapa-sala" && (
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={hideHealthTags}
                onChange={(e) => setHideHealthTags(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Ocultar selos de saúde</span>
            </label>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Imprimir A4</span>
          </button>
        </div>
      </div>

      {/* Folha A4 de Impressão */}
      <div
        className={`bg-white rounded-2xl border-2 border-slate-800 text-slate-900 print:rounded-none print:border print:shadow-none ${
          mode === "mapa-sala" ? "p-4 sm:p-5 space-y-3 print:p-2 print:space-y-2" : "p-6 sm:p-8 space-y-5 print:p-4"
        }`}
      >
        {/* Cabeçalho Institucional Dinâmico */}
        <header className="border-b-2 border-slate-900 pb-3 flex items-center justify-between gap-4">
          <div className="w-16 h-16 shrink-0 flex items-center justify-center print:w-14 print:h-14">
            <img
              src={schoolLogo}
              alt={`Brasão de ${school.name}`}
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex-1 text-center space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {networkHeader.line1}
            </p>
            <p className="text-[10px] font-semibold text-slate-600">{networkHeader.line2}</p>
            <h1 className="text-base font-black uppercase tracking-tight text-slate-900">
              {school.name}
            </h1>
            <p className="text-[10px] text-slate-500">
              INEP: {school.inepCode} • {school.city} - {school.state}
            </p>
          </div>
          <div className="w-16 h-16 shrink-0 opacity-0 pointer-events-none print:w-14 print:h-14" />
        </header>

        {/* Título do Documento */}
        <div className="text-center space-y-1">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">
            {docTitle}
          </h2>
          <p className="text-xs font-bold text-slate-700">
            Turma: {board.classGroup.name} • {formatSegmentLabel(board.classGroup.segment)} •{" "}
            {formatShiftLabel(board.classGroup.shift)}
          </p>
        </div>

        {/* MODO 1: FICHA DA TURMA */}
        {mode === "turma" && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl border border-slate-300 bg-slate-50">
              <div>
                <span className="font-bold block text-[10px] uppercase text-slate-500">
                  Líder (Turma)
                </span>
                <span>{board.peerLeaderName || "Não informado"}</span>
              </div>
              <div>
                <span className="font-bold block text-[10px] uppercase text-slate-500">
                  Líder (Docentes)
                </span>
                <span>{board.teacherLeaderName || "Não informado"}</span>
              </div>
              <div>
                <span className="font-bold block text-[10px] uppercase text-slate-500">
                  Mapa de Sala
                </span>
                <span>
                  {COUNCIL_SEATING_MAP_LABELS[
                    board.seatingMapMode as CouncilSeatingMapMode
                  ] || board.seatingMapMode}
                </span>
              </div>
              <div>
                <span className="font-bold block text-[10px] uppercase text-slate-500">
                  Prova Paraná (%)
                </span>
                <span>
                  1ª: {board.externalEvalEd1Percent ?? "—"}% | 2ª:{" "}
                  {board.externalEvalEd2Percent ?? "—"}% | 3ª:{" "}
                  {board.externalEvalEd3Percent ?? "—"}%
                </span>
              </div>
            </div>

            {/* Legenda Compacta */}
            <div className="text-[10px] border border-slate-300 rounded-lg p-2 bg-slate-50 flex flex-wrap gap-x-4 gap-y-1">
              {COUNCIL_DESCRIPTORS.map((d) => (
                <span key={d.code}>
                  <strong>{d.code}:</strong> {d.fullLabel}
                </span>
              ))}
            </div>

            {/* Tabela de Estudantes x Componentes */}
            <table className="w-full border-collapse border border-slate-400 text-[10px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 p-1.5 text-left">Estudante</th>
                  {activeSubjects.map((s) => (
                    <th key={s.id} className="border border-slate-400 p-1 text-center">
                      <div className="font-bold leading-tight">{s.name}</div>
                      {s.teacherName && (
                        <div className="font-normal text-[9px] text-slate-600">
                          {s.teacherName}
                        </div>
                      )}
                    </th>
                  ))}
                  <th className="border border-slate-400 p-1.5 text-left">Selos / Observações</th>
                </tr>
              </thead>
              <tbody>
                {board.studentCards.map((card) => {
                  const visibleTags = card.tags.filter((val) => {
                    const meta = tagMap.get(val as never);
                    if (!meta) return false;
                    if (hideHealthTags && meta.isSensitiveHealth) return false;
                    return true;
                  });
                  const belowAvg = getCardBelowAvgForTrimester(card, trimester);

                  return (
                    <tr key={card.id}>
                      <td className="border border-slate-400 p-1.5 font-semibold">
                        <div>{card.student.name}</div>
                        <div className="text-[9px] text-slate-500">
                          {COUNCIL_ENROLLMENT_STATUS_LABELS[
                            card.enrollmentStatus as CouncilEnrollmentStatus
                          ] || card.enrollmentStatus}
                        </div>
                      </td>
                      {activeSubjects.map((s) => {
                        const entry = card.subjectEntries.find(
                          (e) => e.subjectId === s.id && e.trimester === trimester
                        );
                        return (
                          <td
                            key={s.id}
                            className="border border-slate-400 p-1 text-center font-bold"
                          >
                            {entry && entry.descriptorCodes.length > 0
                              ? entry.descriptorCodes.join(", ")
                              : "—"}
                            {entry?.grade !== null && entry?.grade !== undefined
                              ? ` (${formatCouncilGradePtBr(entry.grade)})`
                              : ""}
                          </td>
                        );
                      })}
                      <td className="border border-slate-400 p-1.5">
                        {visibleTags.length > 0 && (
                          <div className="font-semibold">
                            {visibleTags
                              .map((t) => tagMap.get(t as never)?.shortLabel || t)
                              .join(" • ")}
                          </div>
                        )}
                        {belowAvg.length > 0 && (
                          <div className="text-[9px] text-slate-700">
                            Abaixo: {belowAvg.map((b) => b.subjectName).join(", ")}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Observações da Turma */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border border-slate-300 rounded-xl p-2.5">
                <h3 className="font-bold uppercase text-[10px] text-slate-600 mb-1">
                  Pontos Positivos
                </h3>
                <p className="whitespace-pre-line">{trimesterRecord?.positivePoints || "—"}</p>
              </div>
              <div className="border border-slate-300 rounded-xl p-2.5">
                <h3 className="font-bold uppercase text-[10px] text-slate-600 mb-1">
                  Pontos de Atenção
                </h3>
                <p className="whitespace-pre-line">{trimesterRecord?.attentionPoints || "—"}</p>
              </div>
              <div className="border border-slate-300 rounded-xl p-2.5">
                <h3 className="font-bold uppercase text-[10px] text-slate-600 mb-1">
                  Ações Planejadas
                </h3>
                <p className="whitespace-pre-line">{trimesterRecord?.plannedActions || "—"}</p>
              </div>
            </div>
          </div>
        )}

        {/* MODO 1B: PRÉ-CONSELHO DE CLASSE (3 PÁGINAS) */}
        {mode === "pre-conselho" && (
          <div className="space-y-5 text-xs">
            <section className="space-y-1">
              <h3 className="text-xs font-black text-slate-900">Objetivo</h3>
              <p className="text-[11px] leading-relaxed text-slate-800 whitespace-pre-line">
                {preCouncilData.objectiveText}
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-black text-slate-900">
                Registro de Conversas Individuais por Componente Curricular
              </h3>
              <table className="w-full border-collapse border border-slate-400 text-[10.5px]">
                <thead className="print:table-header-group">
                  <tr className="bg-slate-100 text-slate-900 text-left">
                    <th className="border border-slate-400 p-2 w-[18%] font-bold">
                      Componente Curricular
                    </th>
                    <th className="border border-slate-400 p-2 w-[16%] font-bold">Docente</th>
                    <th className="border border-slate-400 p-2 w-[33%] font-bold">
                      Estudantes em Acompanhamento
                    </th>
                    <th className="border border-slate-400 p-2 w-[33%] font-bold">
                      Combinados / Encaminhamentos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preCouncilData.conversations.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="border border-slate-400 p-4 text-center text-slate-500"
                      >
                        Nenhum componente curricular registrado para este Pré-Conselho.
                      </td>
                    </tr>
                  ) : (
                    preCouncilData.conversations.map((conv) => {
                      const studentNames = conv.monitoredStudentIds
                        .map((id) => cardByStudentId.get(id)?.student.name)
                        .filter((n): n is string => Boolean(n));

                      return (
                        <tr key={conv.id} className="break-inside-avoid align-top">
                          <td className="border border-slate-400 p-2 font-bold text-slate-900">
                            {conv.subjectName}
                          </td>
                          <td className="border border-slate-400 p-2 text-slate-800">
                            {conv.teacherName || "—"}
                          </td>
                          <td className="border border-slate-400 p-2 text-slate-800">
                            <div className="min-h-[28px] space-y-1">
                              {studentNames.length > 0 && (
                                <p className="font-semibold leading-snug">
                                  {studentNames.join(", ")}
                                </p>
                              )}
                              {conv.monitoredStudentsNotes && (
                                <p className="whitespace-pre-line text-slate-700 leading-snug">
                                  {conv.monitoredStudentsNotes}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="border border-slate-400 p-2 text-slate-800">
                            <div className="min-h-[28px] whitespace-pre-line leading-snug">
                              {conv.agreements || ""}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </section>

            {/* Síntese do Pré-Conselho da Turma */}
            <section className="space-y-3 break-inside-avoid pt-2">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-900">
                SÍNTESE DO PRÉ-CONSELHO DA TURMA
              </h3>

              {(
                [
                  {
                    label: "Principais dificuldades identificadas na turma:",
                    value: preCouncilData.synthesis.mainDifficulties,
                    lines: 2,
                  },
                  {
                    label: "Estudantes que necessitam de maior acompanhamento pedagógico:",
                    value: preCouncilData.synthesis.priorityStudents,
                    lines: 3,
                  },
                  {
                    label: "Questões relacionadas à frequência:",
                    value: preCouncilData.synthesis.attendanceIssues,
                    lines: 2,
                  },
                  {
                    label: "Questões relacionadas ao comportamento/convivência:",
                    value: preCouncilData.synthesis.behaviorIssues,
                    lines: 2,
                  },
                  {
                    label: "Encaminhamentos que ficarão sob responsabilidade da equipe pedagógica:",
                    value: preCouncilData.synthesis.pedagogicalActions,
                    lines: 3,
                  },
                ] as const
              ).map((field) => (
                <div key={field.label} className="space-y-1">
                  <p className="text-[11px] font-bold text-slate-900">{field.label}</p>
                  {field.value ? (
                    <div className="rounded-lg border border-slate-300 bg-slate-50/40 p-2 text-[11px] whitespace-pre-line text-slate-800 leading-relaxed">
                      {field.value}
                    </div>
                  ) : (
                    <div className="space-y-2.5 pt-1">
                      {Array.from({ length: field.lines }).map((_, lineIdx) => (
                        <div key={lineIdx} className="border-b border-slate-400 h-4" />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>

            {/* Registro de Ciência dos Docentes (Página 3) */}
            <section className="space-y-2.5 print:break-before-page pt-2">
              <div className="space-y-1">
                <h3 className="text-xs font-black text-slate-900">
                  Registro de Ciência dos Docentes
                </h3>
                <p className="text-[11px] leading-relaxed text-slate-800">
                  {DEFAULT_PRE_COUNCIL_ACK_STATEMENT}
                </p>
              </div>

              <table className="w-full border-collapse border border-slate-400 text-[10.5px]">
                <thead className="print:table-header-group">
                  <tr className="bg-slate-100 text-slate-900 text-left">
                    <th className="border border-slate-400 p-2 w-[24%] font-bold">
                      Professor(a)
                    </th>
                    <th className="border border-slate-400 p-2 w-[26%] font-bold">
                      Componente Curricular
                    </th>
                    <th className="border border-slate-400 p-2 w-[34%] font-bold">Assinatura</th>
                    <th className="border border-slate-400 p-2 w-[16%] font-bold">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {preCouncilData.conversations.map((conv) => (
                    <tr key={`ack-${conv.id}`} className="break-inside-avoid">
                      <td className="border border-slate-400 p-2 font-semibold text-slate-900">
                        {conv.teacherName || "—"}
                      </td>
                      <td className="border border-slate-400 p-2 text-slate-800">
                        {conv.subjectName}
                      </td>
                      <td className="border border-slate-400 p-2 text-slate-800">
                        {conv.digitalAckEmail ? (
                          <div className="text-[9.5px] leading-snug">
                            <span className="font-bold block">
                              Ciência digital confirmada por{" "}
                              {conv.digitalAckName || conv.digitalAckEmail}
                            </span>
                            <span className="text-slate-600">{conv.digitalAckEmail}</span>
                          </div>
                        ) : (
                          <div className="min-h-[24px]" />
                        )}
                      </td>
                      <td className="border border-slate-400 p-2 text-slate-800">
                        {conv.digitalAckAt
                          ? formatPreCouncilDateTimePtBr(conv.digitalAckAt)
                          : formatPreCouncilDatePtBr(conv.conversationDate) || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {/* MODO 2: ATA DE PÓS-CONSELHO */}
        {mode === "pos-conselho" && (
          <div className="space-y-4 text-xs">
            <div className="text-right text-[11px] font-semibold text-slate-600">
              Data da reunião:{" "}
              {formatCouncilCalendarDatePtBr(trimesterRecord?.postCouncilHeldAt) || "Não informada"}
            </div>

            <div className="border border-slate-300 rounded-xl p-3 space-y-1.5">
              <h3 className="font-black uppercase text-[11px] text-slate-800">
                1. Pontos Positivos
              </h3>
              <p>
                <strong>Avanços:</strong> {trimesterRecord?.postCouncilAdvances || "—"}
              </p>
              <p>
                <strong>O que funcionou bem:</strong> {trimesterRecord?.postCouncilWhatWorked || "—"}
              </p>
              <p>
                <strong>Atitudes reconhecidas:</strong>{" "}
                {trimesterRecord?.postCouncilRecognizedAttitudes || "—"}
              </p>
            </div>

            <div className="border border-slate-300 rounded-xl p-3 space-y-1.5">
              <h3 className="font-black uppercase text-[11px] text-slate-800">
                2. Dificuldades Observadas
              </h3>
              <p>
                <strong>Componentes críticos:</strong>{" "}
                {trimesterRecord?.postCouncilCriticalSubjects || "—"}
              </p>
              <p>
                <strong>Fatores que prejudicam o rendimento:</strong>{" "}
                {trimesterRecord?.postCouncilPerformanceFactors || "—"}
              </p>
              <p>
                <strong>Comportamento e frequência:</strong>{" "}
                {trimesterRecord?.postCouncilBehaviorAttendance || "—"}
              </p>
            </div>

            <div className="border border-slate-300 rounded-xl p-3 space-y-1.5">
              <h3 className="font-black uppercase text-[11px] text-slate-800">
                3. Escuta dos Estudantes
              </h3>
              <p>
                <strong>O que melhorar:</strong>{" "}
                {trimesterRecord?.postCouncilWhatToImprove || "—"}
              </p>
              <p>
                <strong>Como os docentes podem ajudar:</strong>{" "}
                {trimesterRecord?.postCouncilHowTeachersCanHelp || "—"}
              </p>
              <p>
                <strong>Compromissos assumidos:</strong>{" "}
                {trimesterRecord?.postCouncilCommitments || "—"}
              </p>
            </div>

            <div className="border border-slate-300 rounded-xl p-3 space-y-2">
              <h3 className="font-black uppercase text-[11px] text-slate-800">
                4. Encaminhamentos Numerados
              </h3>
              {postActions.length === 0 ? (
                <p>Nenhum encaminhamento registrado.</p>
              ) : (
                <table className="w-full border-collapse border border-slate-300 text-[11px]">
                  <thead>
                    <tr className="bg-slate-100 text-left">
                      <th className="border border-slate-300 p-1.5 w-10">Nº</th>
                      <th className="border border-slate-300 p-1.5">Encaminhamento</th>
                      <th className="border border-slate-300 p-1.5">Responsável</th>
                      <th className="border border-slate-300 p-1.5">Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {postActions.map((a) => (
                      <tr key={a.number}>
                        <td className="border border-slate-300 p-1.5 font-bold">{a.number}</td>
                        <td className="border border-slate-300 p-1.5">{a.description}</td>
                        <td className="border border-slate-300 p-1.5">
                          {COUNCIL_ACTION_RESPONSIBLE_LABELS[a.responsible] || a.responsible}
                        </td>
                        <td className="border border-slate-300 p-1.5">
                          {formatCouncilCalendarDatePtBr(a.dueDate) || "Contínuo"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* MODO 3: FICHA INDIVIDUAL DO ESTUDANTE */}
        {mode === "aluno" && selectedStudentCard && (
          <div className="space-y-4 text-xs">
            <div className="border border-slate-300 rounded-xl p-3 bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <span className="font-bold text-[10px] uppercase text-slate-500 block">
                  Estudante
                </span>
                <span className="font-black text-sm">{selectedStudentCard.student.name}</span>
                {selectedStudentCard.student.cgm && (
                  <span className="block text-[11px] text-slate-600">
                    CGM: {selectedStudentCard.student.cgm}
                  </span>
                )}
              </div>
              <div>
                <span className="font-bold text-[10px] uppercase text-slate-500 block">
                  Situação / Avaliações Externas
                </span>
                <span>
                  {COUNCIL_ENROLLMENT_STATUS_LABELS[
                    selectedStudentCard.enrollmentStatus as CouncilEnrollmentStatus
                  ] || selectedStudentCard.enrollmentStatus}
                </span>
                <span className="block text-[11px] text-slate-600">
                  Prova Paraná: 1ª {selectedStudentCard.externalEvalEd1Percent ?? "—"}% | 2ª{" "}
                  {selectedStudentCard.externalEvalEd2Percent ?? "—"}% | 3ª{" "}
                  {selectedStudentCard.externalEvalEd3Percent ?? "—"}%
                </span>
              </div>
              <div>
                <span className="font-bold text-[10px] uppercase text-slate-500 block">
                  Selos de Identificação
                </span>
                <span>
                  {selectedStudentCard.tags
                    .filter((val) => {
                      const meta = tagMap.get(val as never);
                      return meta && (!hideHealthTags || !meta.isSensitiveHealth);
                    })
                    .map((val) => tagMap.get(val as never)?.label || val)
                    .join(" • ") || "Nenhum selo selecionado"}
                </span>
              </div>
            </div>

            <table className="w-full border-collapse border border-slate-400 text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-400 p-1.5">Componente Curricular</th>
                  <th className="border border-slate-400 p-1.5">Docente</th>
                  <th className="border border-slate-400 p-1.5 text-center">1º Trim.</th>
                  <th className="border border-slate-400 p-1.5 text-center">2º Trim.</th>
                  <th className="border border-slate-400 p-1.5 text-center">3º Trim.</th>
                </tr>
              </thead>
              <tbody>
                {activeSubjects.map((s) => (
                  <tr key={s.id}>
                    <td className="border border-slate-400 p-1.5 font-semibold">{s.name}</td>
                    <td className="border border-slate-400 p-1.5 text-slate-600">
                      {s.teacherName || "—"}
                    </td>
                    {([1, 2, 3] as const).map((tri) => {
                      const entry = selectedStudentCard.subjectEntries.find(
                        (e) => e.subjectId === s.id && e.trimester === tri
                      );
                      return (
                        <td
                          key={tri}
                          className="border border-slate-400 p-1.5 text-center font-bold"
                        >
                          {entry && entry.descriptorCodes.length > 0
                            ? entry.descriptorCodes.join(", ")
                            : "—"}
                          {entry?.grade !== null && entry?.grade !== undefined
                            ? ` (${formatCouncilGradePtBr(entry.grade)})`
                            : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border border-slate-300 rounded-xl p-3 space-y-2">
              <h3 className="font-black uppercase text-[11px] text-slate-800">
                Deliberação do {trimester}º Trimestre
              </h3>
              <p className="whitespace-pre-line">
                {selectedAnonymizedOpinion || "Sem parecer qualitativo registrado."}
              </p>

              {(() => {
                const below = getCardBelowAvgForTrimester(selectedStudentCard, trimester);
                if (below.length === 0) return null;
                return (
                  <div className="pt-1 text-[11px] font-semibold text-slate-800">
                    Componentes abaixo da média:{" "}
                    {below
                      .map((b) =>
                        b.grade !== null
                          ? `${b.subjectName} (${formatCouncilGradePtBr(b.grade)})`
                          : b.subjectName
                      )
                      .join(", ")}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* MODO 4: MAPA DE SALA (A4 PAISAGEM LIMPA) */}
        {mode === "mapa-sala" && (() => {
          if (!selectedSeatingMap) {
            return (
              <div className="rounded-xl border border-slate-300 p-6 text-center text-xs text-slate-600">
                Nenhum mapa de sala salvo para esta turma até o momento.
              </div>
            );
          }

          const grid = getDisplayGridForPerspective(selectedSeatingMap, seatingPerspective);
          const deskPos = getEffectiveTeacherDeskForPerspective(
            selectedSeatingMap.teacherDeskPosition,
            seatingPerspective
          );
          const doorSide = getEffectiveDoorSideForPerspective(
            selectedSeatingMap.doorSide,
            seatingPerspective
          );

          const positionedSet = new Set(
            selectedSeatingMap.seats
              .map((s) => s.studentId)
              .filter((id): id is string => Boolean(id))
          );
          const unassignedActive = board.studentCards.filter(
            (c) => c.enrollmentStatus === "ATIVO" && !positionedSet.has(c.studentId)
          );

          const frontStrip = (
            <div className="space-y-1">
              <div className="mx-auto max-w-md border-2 border-slate-900 bg-slate-100 py-1 px-3 text-center text-[10px] font-black uppercase tracking-widest">
                Quadro / Frente da sala
              </div>
              <div
                className={`flex items-center justify-between gap-2 text-[10px] font-bold ${
                  doorSide === "RIGHT" ? "flex-row-reverse" : ""
                }`}
              >
                {doorSide !== "NONE" ? (
                  <span className="px-2 py-0.5 border border-slate-700 rounded text-slate-800">
                    Porta
                  </span>
                ) : (
                  <span />
                )}
                <div
                  className={`flex-1 flex ${
                    deskPos === "LEFT"
                      ? "justify-start"
                      : deskPos === "RIGHT"
                      ? "justify-end"
                      : "justify-center"
                  }`}
                >
                  <span className="px-3 py-0.5 border border-slate-800 rounded bg-slate-50">
                    Mesa do professor
                  </span>
                </div>
              </div>
            </div>
          );

          const rowHeaders = (
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${selectedSeatingMap.columns}, minmax(0, 1fr))`,
              }}
            >
              {grid.colIndices.map((colIdx) => (
                <div
                  key={`print-col-${colIdx}`}
                  className="text-center text-[10px] font-black uppercase border-b border-slate-400 pb-0.5"
                >
                  Fila {colIdx + 1}
                </div>
              ))}
            </div>
          );

          return (
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border border-slate-300 rounded-lg px-3 py-1.5 bg-slate-50 text-[11px]">
                <span>
                  <strong>Regime:</strong>{" "}
                  {COUNCIL_SEATING_MAP_LABELS[
                    board.seatingMapMode as CouncilSeatingMapMode
                  ] || board.seatingMapMode}
                </span>
                {selectedSeatingMap.effectiveDate && (
                  <span>
                    <strong>Vigência:</strong>{" "}
                    {formatCouncilCalendarDatePtBr(selectedSeatingMap.effectiveDate)}
                  </span>
                )}
                <span>
                  <strong>Orientação:</strong>{" "}
                  {seatingPerspective === "TEACHER"
                    ? "Visão do professor (quadro na base)"
                    : "Visão da sala (quadro no topo)"}
                </span>
              </div>

              {seatingPerspective === "ROOM" && (
                <>
                  {frontStrip}
                  {rowHeaders}
                </>
              )}

              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${selectedSeatingMap.columns}, minmax(0, 1fr))`,
                }}
              >
                {grid.rowsGrid.flatMap((rowCells) =>
                  rowCells.map(({ seat, logicalCol, logicalRow, positionLabel }) => {
                    const studentCard = seat.studentId
                      ? cardByStudentId.get(seat.studentId) ?? null
                      : null;

                    if (seat.blocked) {
                      return (
                        <div
                          key={`print-${logicalCol}-${logicalRow}`}
                          className="border border-dashed border-slate-300 rounded-md p-1.5 min-h-[42px] flex flex-col justify-between bg-slate-50/50 text-slate-400"
                        >
                          <span className="text-[9px] font-bold">{positionLabel}</span>
                          <span className="text-[9px] text-center">Espaço livre</span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`print-${logicalCol}-${logicalRow}`}
                        className="border border-slate-700 rounded-md p-1.5 min-h-[42px] flex flex-col justify-between bg-white"
                      >
                        <span className="text-[9px] font-bold text-slate-500 leading-none">
                          {positionLabel}
                        </span>
                        <div className="text-[11px] font-bold text-slate-900 leading-tight text-center py-0.5">
                          {studentCard ? formatShortStudentName(studentCard.student.name) : "—"}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {seatingPerspective === "TEACHER" && (
                <>
                  {rowHeaders}
                  {frontStrip}
                </>
              )}

              {(selectedSeatingMap.notes || unassignedActive.length > 0) && (
                <div className="border border-slate-300 rounded-lg p-2 text-[10px] space-y-1">
                  {selectedSeatingMap.notes && (
                    <p>
                      <strong>Observações:</strong> {selectedSeatingMap.notes}
                    </p>
                  )}
                  {unassignedActive.length > 0 && (
                    <p>
                      <strong>Estudantes sem carteira associada ({unassignedActive.length}):</strong>{" "}
                      {unassignedActive.map((c) => c.student.name).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Rodapé de Assinaturas Físicas A4 */}
        {mode === "pre-conselho" ? (
          <footer className="pt-10 flex justify-center text-center text-[11px] print:break-inside-avoid">
            <div className="w-80">
              <div className="border-t border-slate-800 pt-1.5 font-bold text-slate-900">
                {preCouncilData.responsiblePedagogueName || "Equipe Pedagógica"}
              </div>
              <div className="text-slate-700">
                {preCouncilData.responsiblePedagogueRole || DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE}
              </div>
            </div>
          </footer>
        ) : (
          <footer
            className={`${
              mode === "mapa-sala" ? "pt-4" : "pt-8"
            } grid grid-cols-2 gap-8 text-center text-[11px] print:break-inside-avoid`}
          >
            <div>
              <div className="border-t border-slate-800 pt-1 font-semibold">
                Equipe Pedagógica / Coordenação
              </div>
            </div>
            <div>
              <div className="border-t border-slate-800 pt-1 font-semibold">
                Direção Escolar
              </div>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
