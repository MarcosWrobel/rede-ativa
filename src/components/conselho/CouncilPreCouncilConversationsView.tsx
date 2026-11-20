"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  DEFAULT_PRE_COUNCIL_OBJECTIVE,
  formatPreCouncilDateTimePtBr,
  getTodayYmdSaoPaulo,
  type PreCouncilAlertsBundle,
  type SubjectMatrixFillStats,
} from "./preCouncilUtils";
import {
  COUNCIL_DESCRIPTORS,
  formatCouncilGradePtBr,
  isBelowAverageGradeUi,
  type CouncilBoardDetailRecord,
  type CouncilTrimesterNumber,
  type PreCouncilData,
  type PreCouncilSubjectConversation,
} from "./types";

interface CouncilPreCouncilConversationsViewProps {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  draft: PreCouncilData;
  selectedConvId: string;
  onSelectConvId: (id: string) => void;
  onUpdateDraft: (updater: (prev: PreCouncilData) => PreCouncilData) => void;
  onSyncSubjects: () => void;
  onAddCustomRow: () => void;
  onRemoveConversation: (convId: string) => void;
  onOpenUnifiedTeacherLink: (subjectId: string | null) => void;
  onMatrixSaved: () => Promise<void>;
  onNotify: (message: string, kind?: "success" | "error") => void;
  alertsBundle: PreCouncilAlertsBundle;
  matrixStatsBySubjectId: Record<string, SubjectMatrixFillStats>;
  hideSensitiveTags: boolean;
  readOnly?: boolean;
}

type ConversationFilterMode = "ALL" | "PENDING" | "COMPLETED";

export default function CouncilPreCouncilConversationsView({
  board,
  activeTrimester,
  draft,
  selectedConvId,
  onSelectConvId,
  onUpdateDraft,
  onSyncSubjects,
  onAddCustomRow,
  onRemoveConversation,
  onOpenUnifiedTeacherLink,
  onMatrixSaved,
  onNotify,
  alertsBundle,
  matrixStatsBySubjectId,
  hideSensitiveTags,
  readOnly = false,
}: CouncilPreCouncilConversationsViewProps) {
  const [searchConv, setSearchConv] = useState("");
  const [convFilter, setConvFilter] = useState<ConversationFilterMode>("ALL");
  const [studentSearch, setStudentSearch] = useState("");
  const [showObjectiveEditor, setShowObjectiveEditor] = useState(false);

  // Edição rápida de tags da Matriz dentro da conversa selecionada
  const [showMatrixEditor, setShowMatrixEditor] = useState(false);
  const [inlineTagsDirty, setInlineTagsDirty] = useState<Record<string, number[]>>({});
  const [inlineStudentSearch, setInlineStudentSearch] = useState("");
  const [savingInlineMatrix, setSavingInlineMatrix] = useState(false);

  const studentCardById = useMemo(
    () => new Map(board.studentCards.map((c) => [c.studentId, c])),
    [board.studentCards]
  );

  const sortedStudents = useMemo(() => {
    return [...board.studentCards].sort((a, b) => {
      if (a.enrollmentStatus === "ATIVO" && b.enrollmentStatus !== "ATIVO") return -1;
      if (a.enrollmentStatus !== "ATIVO" && b.enrollmentStatus === "ATIVO") return 1;
      return a.student.name.localeCompare(b.student.name, "pt-BR");
    });
  }, [board.studentCards]);

  const filteredConversations = useMemo(() => {
    const q = searchConv.trim().toLowerCase();
    return draft.conversations.filter((conv) => {
      if (convFilter !== "ALL" && conv.conversationStatus !== convFilter) {
        return false;
      }
      if (q) {
        const matchSubject = conv.subjectName.toLowerCase().includes(q);
        const matchTeacher = conv.teacherName.toLowerCase().includes(q);
        if (!matchSubject && !matchTeacher) return false;
      }
      return true;
    });
  }, [draft.conversations, searchConv, convFilter]);

  const selectedConversation = useMemo(() => {
    return (
      draft.conversations.find((c) => c.id === selectedConvId) ||
      filteredConversations[0] ||
      draft.conversations[0] ||
      null
    );
  }, [draft.conversations, filteredConversations, selectedConvId]);

  const selectedIndexInAll = useMemo(() => {
    if (!selectedConversation) return -1;
    return draft.conversations.findIndex((c) => c.id === selectedConversation.id);
  }, [draft.conversations, selectedConversation]);

  // Limpa edições inline não salvas ao trocar componente ou trimestre
  useEffect(() => {
    setInlineTagsDirty({});
    setInlineStudentSearch("");
  }, [selectedConversation?.id, activeTrimester, board.id]);

  const selectedSubjectAlerts = useMemo(() => {
    if (!selectedConversation?.subjectId) return [];
    return alertsBundle.bySubjectId[selectedConversation.subjectId] || [];
  }, [alertsBundle.bySubjectId, selectedConversation]);

  const missingAlertStudentIds = useMemo(() => {
    if (!selectedConversation) return [];
    const currentSet = new Set(selectedConversation.monitoredStudentIds);
    return selectedSubjectAlerts
      .map((a) => a.studentId)
      .filter((id) => !currentSet.has(id));
  }, [selectedConversation, selectedSubjectAlerts]);

  const searchableStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return sortedStudents
      .filter((card) => {
        if (!q) return card.enrollmentStatus === "ATIVO";
        return (
          card.student.name.toLowerCase().includes(q) ||
          (card.student.cgm || "").toLowerCase().includes(q)
        );
      })
      .slice(0, 24);
  }, [sortedStudents, studentSearch]);

  const inlineMatrixStudents = useMemo(() => {
    const q = inlineStudentSearch.trim().toLowerCase();
    return sortedStudents.filter((card) => {
      if (!q) return true;
      return (
        card.student.name.toLowerCase().includes(q) ||
        (card.student.cgm || "").toLowerCase().includes(q)
      );
    });
  }, [sortedStudents, inlineStudentSearch]);

  function updateSelectedConversation(
    updater: (conv: PreCouncilSubjectConversation) => PreCouncilSubjectConversation
  ) {
    if (readOnly || !selectedConversation) return;
    onUpdateDraft((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === selectedConversation.id ? updater(c) : c
      ),
    }));
  }

  function toggleStudentInConversation(studentId: string) {
    if (readOnly || !selectedConversation) return;
    updateSelectedConversation((conv) => {
      const exists = conv.monitoredStudentIds.includes(studentId);
      return {
        ...conv,
        monitoredStudentIds: exists
          ? conv.monitoredStudentIds.filter((id) => id !== studentId)
          : [...conv.monitoredStudentIds, studentId],
      };
    });
  }

  function handleIncludeAllAlerts() {
    if (readOnly || !selectedConversation || missingAlertStudentIds.length === 0) return;
    updateSelectedConversation((conv) => ({
      ...conv,
      monitoredStudentIds: Array.from(
        new Set([...conv.monitoredStudentIds, ...missingAlertStudentIds])
      ),
    }));
    onNotify(
      `${missingAlertStudentIds.length} estudante(s) com alerta incluído(s) em acompanhamento.`,
      "success"
    );
  }

  function getInlineDescriptorCodes(studentId: string, subjectId: string): number[] {
    if (inlineTagsDirty[studentId] !== undefined) {
      return inlineTagsDirty[studentId];
    }
    const card = studentCardById.get(studentId);
    const entry = card?.subjectEntries.find(
      (e) => e.subjectId === subjectId && e.trimester === activeTrimester
    );
    return entry?.descriptorCodes || [];
  }

  function toggleInlineTag(studentId: string, subjectId: string, code: number) {
    if (readOnly) return;
    const current = getInlineDescriptorCodes(studentId, subjectId);
    const exists = current.includes(code);
    const next = exists
      ? current.filter((c) => c !== code)
      : [...current, code].sort((a, b) => a - b);
    setInlineTagsDirty((prev) => ({
      ...prev,
      [studentId]: next,
    }));
  }

  function handleFillInlineEmptyAtende(subjectId: string) {
    if (readOnly) return;
    const updates: Record<string, number[]> = { ...inlineTagsDirty };
    for (const card of sortedStudents) {
      if (card.enrollmentStatus !== "ATIVO") continue;
      const current =
        updates[card.studentId] !== undefined
          ? updates[card.studentId]
          : getInlineDescriptorCodes(card.studentId, subjectId);
      if (current.length === 0) {
        updates[card.studentId] = [1];
      }
    }
    setInlineTagsDirty(updates);
  }

  async function handleSaveInlineMatrix(subjectId: string) {
    if (readOnly) return;
    const entries = Object.entries(inlineTagsDirty).map(([studentId, descriptorCodes]) => ({
      studentId,
      subjectId,
      descriptorCodes,
    }));
    if (entries.length === 0) return;

    setSavingInlineMatrix(true);
    try {
      const res = await fetch(`/api/conselho-classe/${board.id}/matrix`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: activeTrimester,
          entries,
        }),
      });
      const data: { success?: boolean; error?: string } = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Não foi possível salvar as tags do componente.", "error");
        return;
      }
      setInlineTagsDirty({});
      await onMatrixSaved();
      onNotify("Tags do componente atualizadas.", "success");
    } catch {
      onNotify("Falha de conexão ao salvar tags do componente.", "error");
    } finally {
      setSavingInlineMatrix(false);
    }
  }

  const inlineDirtyCount = Object.keys(inlineTagsDirty).length;
  const selectedStats = selectedConversation?.subjectId
    ? matrixStatsBySubjectId[selectedConversation.subjectId]
    : undefined;

  return (
    <div className="space-y-4">
      {/* Lista lateral + Editor focado */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Coluna Esquerda: Lista de Componentes/Docentes */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Buscar componente ou docente"
              placeholder="Buscar componente ou docente..."
              value={searchConv}
              onChange={(e) => setSearchConv(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-bold flex-1">
              {(
                [
                  { key: "ALL", label: "Todos" },
                  { key: "PENDING", label: "Pendentes" },
                  { key: "COMPLETED", label: "Realizadas" },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setConvFilter(item.key)}
                  className={`py-1.5 rounded-lg transition cursor-pointer ${
                    convFilter === item.key
                      ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {!readOnly && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onSyncSubjects}
                  aria-label="Sincronizar componentes da turma"
                  title="Sincronizar componentes da turma"
                  className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onAddCustomRow}
                  aria-label="Adicionar componente manual"
                  title="Adicionar componente manual"
                  className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {filteredConversations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center text-xs text-slate-500">
              Nenhum componente encontrado. Cadastre os componentes da turma ou clique em
              &ldquo;Adicionar linha&rdquo;.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {filteredConversations.map((conv) => {
                const isSelected = selectedConversation?.id === conv.id;
                const subjectAlertsCount = conv.subjectId
                  ? (alertsBundle.bySubjectId[conv.subjectId] || []).length
                  : 0;
                const isDone = conv.conversationStatus === "COMPLETED";
                const stats = conv.subjectId ? matrixStatsBySubjectId[conv.subjectId] : undefined;

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => onSelectConvId(conv.id)}
                    className={`w-full text-left rounded-xl border p-3 transition cursor-pointer space-y-1.5 ${
                      isSelected
                        ? "border-sky-500 bg-sky-50 dark:border-sky-500 dark:bg-sky-950/50"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                          {conv.subjectName || "Novo componente"}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {conv.teacherName || "Docente não informado"}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isDone
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Clock3 className="w-3 h-3" />
                        )}
                        <span>{isDone ? "Realizada" : "Pendente"}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                      {stats && (
                        <span>
                          Matriz {stats.filledCount}/{stats.totalActiveCount}
                        </span>
                      )}
                      <span>• {conv.monitoredStudentIds.length} em acomp.</span>
                      {subjectAlertsCount > 0 && (
                        <span className="text-rose-700 dark:text-rose-300">
                          • {subjectAlertsCount} alerta(s)
                        </span>
                      )}
                      {conv.digitalAckEmail && (
                        <span className="text-emerald-700 dark:text-emerald-300 font-bold">
                          • Ciência digital
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Coluna Direita: Editor da Conversa + Matriz do Componente */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          {!selectedConversation ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Selecione um componente curricular à esquerda ou adicione uma linha para iniciar o
              registro das conversas.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {selectedConversation.subjectName || "Novo componente"}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Registro de conversa individual com o docente</span>
                    {selectedConversation.teacherSubmittedAt && (
                      <span className="px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 font-bold text-[10px]">
                        Enviado pelo docente em{" "}
                        {formatPreCouncilDateTimePtBr(selectedConversation.teacherSubmittedAt)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {!readOnly && selectedConversation.subjectId && (
                    <button
                      type="button"
                      onClick={() => onOpenUnifiedTeacherLink(selectedConversation.subjectId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900 text-xs font-bold text-sky-900 dark:text-sky-200 transition cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>Link</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={selectedIndexInAll <= 0}
                    onClick={() => {
                      const prevConv = draft.conversations[selectedIndexInAll - 1];
                      if (prevConv) onSelectConvId(prevConv.id);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Anterior</span>
                  </button>
                  <button
                    type="button"
                    disabled={
                      selectedIndexInAll < 0 ||
                      selectedIndexInAll >= draft.conversations.length - 1
                    }
                    onClick={() => {
                      const nextConv = draft.conversations[selectedIndexInAll + 1];
                      if (nextConv) onSelectConvId(nextConv.id);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
                  >
                    <span>Próximo</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onRemoveConversation(selectedConversation.id)}
                      aria-label="Remover linha do Pré-Conselho"
                      title="Remover linha"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4 space-y-1">
                  <label
                    htmlFor="pre-conv-subject"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Componente curricular
                  </label>
                  <input
                    id="pre-conv-subject"
                    type="text"
                    disabled={readOnly}
                    value={selectedConversation.subjectName}
                    onChange={(e) =>
                      updateSelectedConversation((c) => ({
                        ...c,
                        subjectName: e.target.value,
                      }))
                    }
                    placeholder="Ex.: Matemática"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="md:col-span-4 space-y-1">
                  <label
                    htmlFor="pre-conv-teacher"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Docente(s)
                  </label>
                  <input
                    id="pre-conv-teacher"
                    type="text"
                    disabled={readOnly}
                    value={selectedConversation.teacherName}
                    onChange={(e) =>
                      updateSelectedConversation((c) => ({
                        ...c,
                        teacherName: e.target.value,
                      }))
                    }
                    placeholder="Nome do(a) professor(a)"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="md:col-span-4 space-y-1">
                  <label
                    htmlFor="pre-conv-email"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    E-mail institucional
                  </label>
                  <input
                    id="pre-conv-email"
                    type="email"
                    disabled={readOnly}
                    value={selectedConversation.teacherEmail || ""}
                    onChange={(e) =>
                      updateSelectedConversation((c) => ({
                        ...c,
                        teacherEmail: e.target.value || null,
                      }))
                    }
                    placeholder="docente@escola.pr.gov.br"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="md:col-span-5 space-y-1">
                  <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Situação da conversa
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={selectedConversation.conversationStatus === "PENDING"}
                      onClick={() =>
                        updateSelectedConversation((c) => ({
                          ...c,
                          conversationStatus: "PENDING",
                        }))
                      }
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition cursor-pointer ${
                        selectedConversation.conversationStatus === "PENDING"
                          ? "bg-amber-500 border-amber-500 text-white"
                          : "bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      Pendente
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={selectedConversation.conversationStatus === "COMPLETED"}
                      onClick={() =>
                        updateSelectedConversation((c) => ({
                          ...c,
                          conversationStatus: "COMPLETED",
                          conversationDate: c.conversationDate || getTodayYmdSaoPaulo(),
                        }))
                      }
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition cursor-pointer ${
                        selectedConversation.conversationStatus === "COMPLETED"
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      Realizada
                    </button>
                  </div>
                </div>

                <div className="md:col-span-7 space-y-1">
                  <label
                    htmlFor="pre-conv-date"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Data da conversa
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="pre-conv-date"
                      type="date"
                      disabled={readOnly}
                      value={selectedConversation.conversationDate || ""}
                      onChange={(e) =>
                        updateSelectedConversation((c) => ({
                          ...c,
                          conversationDate: e.target.value || null,
                        }))
                      }
                      className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedConversation((c) => ({
                            ...c,
                            conversationDate: getTodayYmdSaoPaulo(),
                            conversationStatus: "COMPLETED",
                          }))
                        }
                        className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        Hoje
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Bloco Integrado: Matriz de Tags do Componente */}
              {selectedConversation.subjectId && selectedStats && (
                <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <span className="text-xs font-extrabold text-indigo-950 dark:text-indigo-100 block">
                        Matriz de tags deste componente
                      </span>
                      <span className="text-[11px] text-indigo-800 dark:text-indigo-300">
                        {selectedStats.filledCount}/{selectedStats.totalActiveCount} avaliados •{" "}
                        {selectedStats.belowAvgCount} abaixo da média • {selectedStats.alertCount}{" "}
                        com alerta nas tags
                      </span>
                    </div>

                    <button
                      type="button"
                      aria-expanded={showMatrixEditor}
                      onClick={() => setShowMatrixEditor((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 hover:bg-indigo-100 dark:hover:bg-indigo-950 text-xs font-bold text-indigo-900 dark:text-indigo-200 transition cursor-pointer"
                    >
                      <span>{showMatrixEditor ? "Ocultar tags" : "Editar tags do componente"}</span>
                      {showMatrixEditor ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {showMatrixEditor && (
                    <div className="space-y-3 pt-2 border-t border-indigo-200/70 dark:border-indigo-800">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="search"
                            aria-label="Filtrar estudante nas tags do componente"
                            placeholder="Buscar por estudante ou matrícula..."
                            value={inlineStudentSearch}
                            onChange={(e) => setInlineStudentSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                          />
                        </div>

                        {!readOnly && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleFillInlineEmptyAtende(selectedConversation.subjectId!)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 text-emerald-900 dark:text-emerald-200 text-xs font-bold transition cursor-pointer"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                              <span>Preencher vazios: Atende</span>
                            </button>

                            <button
                              type="button"
                              disabled={savingInlineMatrix || inlineDirtyCount === 0}
                              onClick={() =>
                                void handleSaveInlineMatrix(selectedConversation.subjectId!)
                              }
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
                            >
                              <Save className="w-3.5 h-3.5" />
                              <span>
                                {savingInlineMatrix
                                  ? "Salvando..."
                                  : inlineDirtyCount > 0
                                    ? `Salvar tags (${inlineDirtyCount})`
                                    : "Salvar tags"}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {inlineMatrixStudents.map((card) => {
                          const entry = card.subjectEntries.find(
                            (e) =>
                              e.subjectId === selectedConversation.subjectId &&
                              e.trimester === activeTrimester
                          );
                          const codes = getInlineDescriptorCodes(
                            card.studentId,
                            selectedConversation.subjectId!
                          );
                          const formattedGrade = formatCouncilGradePtBr(entry?.grade ?? null);
                          const gradeIsBelow = isBelowAverageGradeUi(entry?.grade ?? null);

                          return (
                            <div
                              key={card.studentId}
                              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                  {card.student.name}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                                  {formattedGrade !== null && (
                                    <span
                                      className={`font-bold ${
                                        gradeIsBelow
                                          ? "text-rose-700 dark:text-rose-300"
                                          : "text-slate-600 dark:text-slate-300"
                                      }`}
                                    >
                                      Nota {formattedGrade}
                                    </span>
                                  )}
                                  {card.student.lowAttendanceRecord && (
                                    <span>
                                      Freq.{" "}
                                      {card.student.lowAttendanceRecord.attendancePercent.toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1">
                                {COUNCIL_DESCRIPTORS.map((d) => {
                                  const selected = codes.includes(d.code);
                                  return (
                                    <button
                                      key={d.code}
                                      type="button"
                                      disabled={readOnly}
                                      aria-pressed={selected}
                                      onClick={() =>
                                        toggleInlineTag(
                                          card.studentId,
                                          selectedConversation.subjectId!,
                                          d.code
                                        )
                                      }
                                      title={d.fullLabel}
                                      className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                                        selected
                                          ? d.activeClass
                                          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                      }`}
                                    >
                                      {d.shortLabel}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Estudantes em Acompanhamento */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-sky-600" />
                    <span>
                      Estudantes em Acompanhamento ({selectedConversation.monitoredStudentIds.length})
                    </span>
                  </span>
                  {hideSensitiveTags && (
                    <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                      Selos de saúde ocultos
                    </span>
                  )}
                </div>

                {/* Chips selecionados */}
                {selectedConversation.monitoredStudentIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedConversation.monitoredStudentIds.map((stId) => {
                      const card = studentCardById.get(stId);
                      if (!card) return null;
                      return (
                        <span
                          key={stId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-600 text-white text-xs font-bold"
                        >
                          <span>{card.student.name}</span>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => toggleStudentInConversation(stId)}
                              aria-label={`Remover ${card.student.name}`}
                              className="hover:text-sky-200 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Nenhum estudante selecionado neste componente até o momento.
                  </p>
                )}

                {/* Sugestões automáticas do componente com botão rápido */}
                {selectedSubjectAlerts.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-rose-800 dark:text-rose-300">
                        Sugestões da matriz e frequência (nota &lt; 6,0, descritivo ou freq. &lt;
                        75%):
                      </span>
                      {!readOnly && missingAlertStudentIds.length > 0 && (
                        <button
                          type="button"
                          onClick={handleIncludeAllAlerts}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition cursor-pointer"
                        >
                          <UserPlus className="w-3 h-3" />
                          <span>Incluir todos os alertas ({missingAlertStudentIds.length})</span>
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedSubjectAlerts.map((alert) => {
                        const selected = selectedConversation.monitoredStudentIds.includes(
                          alert.studentId
                        );
                        return (
                          <button
                            key={alert.studentId}
                            type="button"
                            disabled={readOnly}
                            aria-pressed={selected}
                            onClick={() => toggleStudentInConversation(alert.studentId)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition cursor-pointer disabled:cursor-not-allowed ${
                              selected
                                ? "bg-sky-100 border-sky-400 text-sky-900 dark:bg-sky-950/70 dark:border-sky-600 dark:text-sky-200"
                                : "bg-white dark:bg-slate-900 border-rose-200 dark:border-rose-900 text-slate-800 dark:text-slate-200 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            }`}
                          >
                            {selected ? (
                              <Check className="w-3 h-3 text-sky-700 dark:text-sky-300" />
                            ) : (
                              <UserPlus className="w-3 h-3 text-rose-600" />
                            )}
                            <span>{alert.studentName}</span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                              ({alert.reasons.join(" • ")})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Busca manual de qualquer estudante da turma */}
                {!readOnly && (
                  <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        aria-label="Adicionar estudante da turma ao acompanhamento"
                        placeholder="Buscar por estudante ou matrícula..."
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {searchableStudents.map((card) => {
                        const selected = selectedConversation.monitoredStudentIds.includes(
                          card.studentId
                        );
                        return (
                          <button
                            key={card.studentId}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleStudentInConversation(card.studentId)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                              selected
                                ? "bg-sky-600 border-sky-600 text-white"
                                : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                          >
                            {selected && <Check className="w-3 h-3" />}
                            <span>{card.student.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-1 pt-1">
                  <label
                    htmlFor="pre-conv-students-notes"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Observações sobre estudantes em acompanhamento
                  </label>
                  <textarea
                    id="pre-conv-students-notes"
                    rows={2}
                    disabled={readOnly}
                    value={selectedConversation.monitoredStudentsNotes}
                    onChange={(e) =>
                      updateSelectedConversation((c) => ({
                        ...c,
                        monitoredStudentsNotes: e.target.value,
                      }))
                    }
                    placeholder="Detalhamento opcional por estudante ou contexto apresentado pelo docente..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Combinados / Encaminhamentos */}
              <div className="space-y-1.5">
                <label
                  htmlFor="pre-conv-agreements"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  Combinados / Encaminhamentos
                </label>
                <textarea
                  id="pre-conv-agreements"
                  rows={3}
                  disabled={readOnly}
                  value={selectedConversation.agreements}
                  onChange={(e) =>
                    updateSelectedConversation((c) => ({
                      ...c,
                      agreements: e.target.value,
                    }))
                  }
                  placeholder="Atividades de recuperação, adaptação metodológica, atendimento à família ou encaminhamentos..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
