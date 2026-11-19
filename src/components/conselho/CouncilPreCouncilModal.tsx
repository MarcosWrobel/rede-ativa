"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  buildInitialPreCouncilData,
  buildCitedStudentsSummary,
  buildPreCouncilStudentAlertsBySubject,
  DEFAULT_PRE_COUNCIL_ACK_STATEMENT,
  DEFAULT_PRE_COUNCIL_OBJECTIVE,
  DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
  formatPreCouncilDatePtBr,
  formatPreCouncilDateTimePtBr,
  getDefaultPreCouncilPeriodLabel,
  getPreCouncilProgress,
  getTodayYmdSaoPaulo,
  mergeSubjectsIntoPreCouncilConversations,
  parsePreCouncilData,
} from "./preCouncilUtils";
import type {
  CouncilBoardDetailRecord,
  CouncilTrimesterNumber,
  CouncilTrimesterRecord,
  PreCouncilData,
  PreCouncilSubjectConversation,
} from "./types";

interface CouncilPreCouncilModalProps {
  open: boolean;
  onClose: () => void;
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  trimesterRecord: CouncilTrimesterRecord | null;
  currentUserName?: string | null;
  hideSensitiveTags: boolean;
  onTrimesterUpdated: (updated: CouncilTrimesterRecord) => void;
  onRefreshBoard: () => Promise<void>;
  onNotify: (message: string, kind?: "success" | "error") => void;
  readOnly?: boolean;
}

type ModalTabKey = "conversations" | "synthesis" | "acknowledgments";
type ConversationFilterMode = "ALL" | "PENDING" | "COMPLETED";

interface GeneratedPreCouncilLink {
  url: string;
  qrCodeDataUrl: string;
  trimester: number;
  conversationId: string | null;
  subjectName: string | null;
  expiresAt: string;
}

function createInitialOrParsedState(params: {
  board: CouncilBoardDetailRecord;
  activeTrimester: CouncilTrimesterNumber;
  trimesterRecord: CouncilTrimesterRecord | null;
  currentUserName?: string | null;
}): PreCouncilData {
  const parsed = parsePreCouncilData(params.trimesterRecord?.preCouncilJson);
  if (parsed) {
    return parsed;
  }
  return buildInitialPreCouncilData({
    trimester: params.activeTrimester,
    subjects: params.board.subjects,
    responsiblePedagogueName: params.currentUserName || "",
  });
}

function createCustomRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pre-custom-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `pre-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function CouncilPreCouncilModal({
  open,
  onClose,
  board,
  activeTrimester,
  trimesterRecord,
  currentUserName = "",
  hideSensitiveTags,
  onTrimesterUpdated,
  onRefreshBoard,
  onNotify,
  readOnly = false,
}: CouncilPreCouncilModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const discardButtonRef = useRef<HTMLButtonElement | null>(null);
  const keepEditingButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleId = useId();
  const unsavedNoticeId = useId();

  const [draft, setDraft] = useState<PreCouncilData>(() =>
    createInitialOrParsedState({
      board,
      activeTrimester,
      trimesterRecord,
      currentUserName,
    })
  );
  const [baselineSnapshot, setBaselineSnapshot] = useState<string>(() =>
    JSON.stringify(
      createInitialOrParsedState({
        board,
        activeTrimester,
        trimesterRecord,
        currentUserName,
      })
    )
  );
  const [activeTab, setActiveTab] = useState<ModalTabKey>("conversations");
  const [selectedConvId, setSelectedConvId] = useState<string>("");
  const [searchConv, setSearchConv] = useState("");
  const [convFilter, setConvFilter] = useState<ConversationFilterMode>("ALL");
  const [studentSearch, setStudentSearch] = useState("");
  const [showObjectiveEditor, setShowObjectiveEditor] = useState(false);

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCloseConfirm, setPendingCloseConfirm] = useState(false);

  const [linkScopeConvId, setLinkScopeConvId] = useState<string>("");
  const [linkExpiryDays, setLinkExpiryDays] = useState<number>(7);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<GeneratedPreCouncilLink | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Hidrata estado ao abrir o modal ou trocar o trimestre/turma
  useEffect(() => {
    if (!open) return;
    const initial = createInitialOrParsedState({
      board,
      activeTrimester,
      trimesterRecord,
      currentUserName,
    });
    setDraft(initial);
    setBaselineSnapshot(JSON.stringify(initial));
    setSelectedConvId(initial.conversations[0]?.id || "");
    setActiveTab("conversations");
    setSearchConv("");
    setConvFilter("ALL");
    setStudentSearch("");
    setShowObjectiveEditor(false);
    setPendingCloseConfirm(false);
    setGeneratedLink(null);
    setLinkError(null);
    setLinkScopeConvId("");
    setCopiedLink(false);
  }, [open, board.id, activeTrimester]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Controle nativo do <dialog> modal no navegador
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== "function") return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const isDirty = useMemo(() => {
    if (readOnly) return false;
    return JSON.stringify(draft) !== baselineSnapshot;
  }, [draft, baselineSnapshot, readOnly]);

  useEffect(() => {
    if (pendingCloseConfirm) {
      keepEditingButtonRef.current?.focus();
    }
  }, [pendingCloseConfirm]);

  const progress = useMemo(() => getPreCouncilProgress(draft), [draft]);

  const alertsBundle = useMemo(
    () => buildPreCouncilStudentAlertsBySubject(board, activeTrimester),
    [board, activeTrimester]
  );

  const citedSummary = useMemo(
    () => buildCitedStudentsSummary(draft.conversations, board.studentCards),
    [draft.conversations, board.studentCards]
  );

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

  const selectedSubjectAlerts = useMemo(() => {
    if (!selectedConversation?.subjectId) return [];
    return alertsBundle.bySubjectId[selectedConversation.subjectId] || [];
  }, [alertsBundle.bySubjectId, selectedConversation]);

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

  function requestClose() {
    if (isDirty) {
      setPendingCloseConfirm(true);
      return;
    }
    setPendingCloseConfirm(false);
    onClose();
  }

  function updateSelectedConversation(
    updater: (conv: PreCouncilSubjectConversation) => PreCouncilSubjectConversation
  ) {
    if (readOnly || !selectedConversation) return;
    setDraft((prev) => ({
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

  function handleSyncSubjects() {
    if (readOnly) return;
    const merged = mergeSubjectsIntoPreCouncilConversations(draft.conversations, board.subjects);
    if (merged.addedCount === 0) {
      onNotify("Todos os componentes ativos da turma já estão listados.", "success");
      return;
    }
    setDraft((prev) => ({
      ...prev,
      conversations: merged.conversations,
    }));
    onNotify(
      `${merged.addedCount} componente(s) adicionado(s) ao Pré-Conselho.`,
      "success"
    );
  }

  function handleAddCustomRow() {
    if (readOnly) return;
    const newId = createCustomRowId();
    const newRow: PreCouncilSubjectConversation = {
      id: newId,
      subjectId: null,
      subjectName: "",
      teacherName: "",
      teacherEmail: null,
      monitoredStudentIds: [],
      monitoredStudentsNotes: "",
      agreements: "",
      conversationStatus: "PENDING",
      conversationDate: null,
      digitalAckEmail: null,
      digitalAckName: null,
      digitalAckAt: null,
    };
    setDraft((prev) => ({
      ...prev,
      conversations: [...prev.conversations, newRow],
    }));
    setSelectedConvId(newId);
    setConvFilter("ALL");
    setSearchConv("");
  }

  function handleRemoveConversation(convId: string) {
    if (readOnly) return;
    const remaining = draft.conversations.filter((c) => c.id !== convId);
    setDraft((prev) => ({
      ...prev,
      conversations: remaining,
    }));
    if (selectedConvId === convId) {
      setSelectedConvId(remaining[0]?.id || "");
    }
  }

  async function savePreCouncilData(silentSuccess = false): Promise<PreCouncilData | null> {
    if (readOnly) return null;

    const emptyNameRow = draft.conversations.find((c) => !c.subjectName.trim());
    if (emptyNameRow) {
      setActiveTab("conversations");
      setSelectedConvId(emptyNameRow.id);
      onNotify("Informe o nome do componente curricular em todas as linhas.", "error");
      return null;
    }

    setSaving(true);
    try {
      const payloadToSend = {
        version: 1 as const,
        periodLabel:
          draft.periodLabel.trim() || getDefaultPreCouncilPeriodLabel(activeTrimester),
        objectiveText: draft.objectiveText.trim() || DEFAULT_PRE_COUNCIL_OBJECTIVE,
        responsiblePedagogueName: draft.responsiblePedagogueName.trim(),
        responsiblePedagogueRole:
          draft.responsiblePedagogueRole.trim() || DEFAULT_PRE_COUNCIL_PEDAGOGUE_ROLE,
        conversations: draft.conversations.map((c) => ({
          id: c.id,
          subjectId: c.subjectId || null,
          subjectName: c.subjectName.trim(),
          teacherName: c.teacherName.trim(),
          teacherEmail: c.teacherEmail?.trim() || null,
          monitoredStudentIds: Array.from(new Set(c.monitoredStudentIds)),
          monitoredStudentsNotes: c.monitoredStudentsNotes.trim(),
          agreements: c.agreements.trim(),
          conversationStatus: c.conversationStatus,
          conversationDate: c.conversationDate?.trim() || null,
        })),
        synthesis: {
          mainDifficulties: draft.synthesis.mainDifficulties.trim(),
          priorityStudents: draft.synthesis.priorityStudents.trim(),
          attendanceIssues: draft.synthesis.attendanceIssues.trim(),
          behaviorIssues: draft.synthesis.behaviorIssues.trim(),
          pedagogicalActions: draft.synthesis.pedagogicalActions.trim(),
        },
      };

      const res = await fetch(`/api/conselho-classe/${board.id}/trimesters`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: activeTrimester,
          preCouncil: payloadToSend,
        }),
      });
      const data: {
        success?: boolean;
        trimesterRecord?: CouncilTrimesterRecord;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.trimesterRecord) {
        onNotify(data.error || "Não foi possível salvar o Pré-Conselho.", "error");
        return null;
      }

      onTrimesterUpdated(data.trimesterRecord);
      const savedParsed = parsePreCouncilData(data.trimesterRecord.preCouncilJson);
      if (savedParsed) {
        setDraft(savedParsed);
        setBaselineSnapshot(JSON.stringify(savedParsed));
        if (!savedParsed.conversations.some((c) => c.id === selectedConvId)) {
          setSelectedConvId(savedParsed.conversations[0]?.id || "");
        }
      }
      setPendingCloseConfirm(false);
      if (!silentSuccess) {
        onNotify("Pré-Conselho salvo.", "success");
      }
      return savedParsed;
    } catch {
      onNotify("Falha de conexão ao salvar o Pré-Conselho.", "error");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshAcks() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/conselho-classe/${board.id}`);
      const data: { success?: boolean; board?: CouncilBoardDetailRecord } = await res.json();
      if (!res.ok || !data.board) {
        onNotify("Não foi possível atualizar os dados da turma.", "error");
        return;
      }

      const freshTrimester =
        data.board.trimesters.find((t) => t.trimester === activeTrimester) || null;
      const freshParsed = parsePreCouncilData(freshTrimester?.preCouncilJson);

      await onRefreshBoard();

      if (freshParsed) {
        if (!isDirty) {
          setDraft(freshParsed);
          setBaselineSnapshot(JSON.stringify(freshParsed));
        } else {
          const ackById = new Map(
            freshParsed.conversations.map((c) => [
              c.id,
              {
                digitalAckEmail: c.digitalAckEmail,
                digitalAckName: c.digitalAckName,
                digitalAckAt: c.digitalAckAt,
              },
            ])
          );
          setDraft((prev) => ({
            ...prev,
            conversations: prev.conversations.map((c) => {
              const ack = ackById.get(c.id);
              return ack ? { ...c, ...ack } : c;
            }),
          }));
        }
      }

      onNotify("Dados de ciência atualizados.", "success");
    } catch {
      onNotify("Falha de conexão ao atualizar os registros.", "error");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleGeneratePreCouncilLink(overrideConversationId?: string) {
    if (readOnly) return;
    setLinkError(null);
    setCopiedLink(false);
    setGeneratingLink(true);

    const targetConvId =
      overrideConversationId !== undefined ? overrideConversationId : linkScopeConvId;
    if (overrideConversationId !== undefined) {
      setLinkScopeConvId(overrideConversationId);
    }

    try {
      const hasSavedOnServer = Boolean(parsePreCouncilData(trimesterRecord?.preCouncilJson));
      if (isDirty || !hasSavedOnServer) {
        const saved = await savePreCouncilData(true);
        if (!saved) {
          setGeneratingLink(false);
          return;
        }
      }

      const res = await fetch(`/api/conselho-classe/${board.id}/pre-council-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trimester: activeTrimester,
          conversationId: targetConvId || null,
          expiresInDays: linkExpiryDays,
        }),
      });
      const data: GeneratedPreCouncilLink & { success?: boolean; error?: string } =
        await res.json();

      if (!res.ok || !data.url) {
        setLinkError(data.error || "Não foi possível gerar o link de ciência.");
        setGeneratedLink(null);
        return;
      }

      setGeneratedLink({
        url: data.url,
        qrCodeDataUrl: data.qrCodeDataUrl,
        trimester: data.trimester,
        conversationId: data.conversationId,
        subjectName: data.subjectName,
        expiresAt: data.expiresAt,
      });
      onNotify("Link de ciência gerado.", "success");
    } catch {
      setLinkError("Falha de conexão ao gerar o link de ciência.");
    } finally {
      setGeneratingLink(false);
    }
  }

  async function handleCopyLink() {
    if (!generatedLink?.url) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      setCopiedLink(true);
      onNotify("Link copiado.", "success");
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedLink(false), 3000);
    } catch {
      onNotify("Selecione o endereço e copie manualmente.", "error");
    }
  }

  if (!open) {
    return null;
  }

  const tabs: Array<{ key: ModalTabKey; label: string }> = [
    {
      key: "conversations",
      label: `Conversas por componente (${progress.completed}/${progress.total})`,
    },
    { key: "synthesis", label: "Síntese da turma" },
    {
      key: "acknowledgments",
      label: `Ciência dos docentes (${progress.acknowledged}/${progress.total})`,
    },
  ];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      {...({ closedby: "none" } as any)}
      className="dialog-focus m-auto w-[min(96vw,1380px)] max-w-none h-[min(94vh,920px)] max-h-[94vh] p-0 rounded-2xl bg-transparent shadow-2xl overscroll-contain backdrop:bg-slate-950/75 backdrop:overscroll-contain backdrop:overflow-hidden"
    >
      <div className="flex flex-col w-full h-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {/* Cabeçalho do Modal */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={titleId}
                className="text-lg font-black text-slate-900 dark:text-white tracking-tight"
              >
                Pré-Conselho — {board.classGroup.name}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                {activeTrimester}º Trimestre / {board.year}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Conversas realizadas:{" "}
                <strong className="text-slate-900 dark:text-slate-100">
                  {progress.completed}/{progress.total}
                </strong>
              </span>
              <span>
                Ciências digitais:{" "}
                <strong className="text-emerald-700 dark:text-emerald-300">
                  {progress.acknowledged}/{progress.total}
                </strong>
              </span>
              <span>
                Estudantes citados:{" "}
                <strong className="text-slate-900 dark:text-slate-100">
                  {progress.citedStudentsCount}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleRefreshAcks()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              <span>Atualizar</span>
            </button>

            <Link
              href={`/conselho-classe/${board.id}/imprimir?mode=pre-conselho&trimester=${activeTrimester}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir A4</span>
            </Link>

            <button
              type="button"
              onClick={requestClose}
              aria-label="Fechar Pré-Conselho"
              className="inline-flex items-center justify-center p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Navegação por Abas Internas */}
        <div
          role="tablist"
          aria-label="Etapas do Pré-Conselho"
          className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 pt-1 gap-1 shrink-0"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                id={`pre-council-tab-${tab.key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex-none px-4 py-2.5 text-xs font-bold transition cursor-pointer ${
                  selected
                    ? "text-sky-700 dark:text-sky-400 after:content-[''] after:absolute after:inset-x-2 after:bottom-0 after:border-b-[3px] after:border-sky-600 dark:after:border-sky-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Corpo Principal com Rolagem Interna */}
        <div
          role="tabpanel"
          aria-labelledby={`pre-council-tab-${activeTab}`}
          className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4"
        >
          {/* ABA 1: CONVERSAS POR COMPONENTE */}
          {activeTab === "conversations" && (
            <div className="space-y-4">
              {/* Configuração do Período e Objetivo */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                  <div className="flex-1 max-w-sm space-y-1">
                    <label
                      htmlFor="pre-council-period-label"
                      className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                    >
                      Período no documento
                    </label>
                    <input
                      id="pre-council-period-label"
                      type="text"
                      disabled={readOnly}
                      value={draft.periodLabel}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, periodLabel: e.target.value }))
                      }
                      placeholder="Ex.: 2º Semestre ou 1º Trimestre"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowObjectiveEditor((prev) => !prev)}
                      aria-expanded={showObjectiveEditor}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer"
                    >
                      <span>Objetivo do documento</span>
                      {showObjectiveEditor ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={handleSyncSubjects}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/50 text-xs font-bold text-sky-900 dark:text-sky-200 transition cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Sincronizar componentes</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleAddCustomRow}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Adicionar linha</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {showObjectiveEditor && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="pre-council-objective-text"
                        className="text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        Texto do Objetivo (impresso na 1ª página)
                      </label>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              objectiveText: DEFAULT_PRE_COUNCIL_OBJECTIVE,
                            }))
                          }
                          className="text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                        >
                          Restaurar padrão
                        </button>
                      )}
                    </div>
                    <textarea
                      id="pre-council-objective-text"
                      rows={3}
                      disabled={readOnly}
                      value={draft.objectiveText}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, objectiveText: e.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
                    />
                  </div>
                )}
              </div>

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

                  <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-bold">
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

                  {filteredConversations.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center text-xs text-slate-500">
                      Nenhum componente encontrado. Cadastre os componentes da turma ou clique em
                      &ldquo;Adicionar linha&rdquo;.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-[52vh] overflow-y-auto pr-1">
                      {filteredConversations.map((conv) => {
                        const isSelected = selectedConversation?.id === conv.id;
                        const subjectAlertsCount = conv.subjectId
                          ? (alertsBundle.bySubjectId[conv.subjectId] || []).length
                          : 0;
                        const isDone = conv.conversationStatus === "COMPLETED";

                        return (
                          <button
                            key={conv.id}
                            type="button"
                            onClick={() => setSelectedConvId(conv.id)}
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
                              <span>{conv.monitoredStudentIds.length} estudante(s)</span>
                              {subjectAlertsCount > 0 && (
                                <span className="text-rose-700 dark:text-rose-300">
                                  • {subjectAlertsCount} em atenção
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

                {/* Coluna Direita: Editor da Conversa Selecionada */}
                <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                  {!selectedConversation ? (
                    <div className="py-12 text-center text-xs text-slate-500">
                      Selecione um componente curricular à esquerda ou adicione uma linha para
                      iniciar o registro das conversas.
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                        <div>
                          <h3 className="text-sm font-black text-slate-900 dark:text-white">
                            {selectedConversation.subjectName || "Novo componente"}
                          </h3>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Registro de conversa individual com o docente
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={selectedIndexInAll <= 0}
                            onClick={() => {
                              const prevConv = draft.conversations[selectedIndexInAll - 1];
                              if (prevConv) setSelectedConvId(prevConv.id);
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
                              if (nextConv) setSelectedConvId(nextConv.id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
                          >
                            <span>Próximo</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleRemoveConversation(selectedConversation.id)}
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

                      {/* Estudantes em Acompanhamento */}
                      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-extrabold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-sky-600" />
                            <span>
                              Estudantes em Acompanhamento (
                              {selectedConversation.monitoredStudentIds.length})
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

                        {/* Sugestões automáticas do componente */}
                        {selectedSubjectAlerts.length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                            <span className="block text-[11px] font-bold text-rose-800 dark:text-rose-300">
                              Sugestões com alerta neste componente (nota &lt; 6,0, descritivo ou
                              frequência &lt; 75%):
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedSubjectAlerts.map((alert) => {
                                const selected =
                                  selectedConversation.monitoredStudentIds.includes(
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
                                const selected =
                                  selectedConversation.monitoredStudentIds.includes(card.studentId);
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
          )}

          {/* ABA 2: SÍNTESE DA TURMA */}
          {activeTab === "synthesis" && (
            <div className="space-y-4">
              {/* Resumo de apoio da consulta dos componentes */}
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
                              ({item.count} {item.count === 1 ? "comp." : "comp."})
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
                      setDraft((prev) => ({
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
                      setDraft((prev) => ({
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
                        setDraft((prev) => ({
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
                        setDraft((prev) => ({
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
                      setDraft((prev) => ({
                        ...prev,
                        synthesis: { ...prev.synthesis, pedagogicalActions: e.target.value },
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ABA 3: CIÊNCIA DOS DOCENTES */}
          {activeTab === "acknowledgments" && (
            <div className="space-y-4">
              {/* Emissão de Link / QR Code para Ciência Digital */}
              {!readOnly && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                      <div className="sm:col-span-2 space-y-1">
                        <label
                          htmlFor="pre-ack-link-scope"
                          className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                        >
                          Link de ciência docente (conta @escola.pr.gov.br)
                        </label>
                        <select
                          id="pre-ack-link-scope"
                          value={linkScopeConvId}
                          onChange={(e) => setLinkScopeConvId(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                        >
                          <option value="">Todos os componentes deste Pré-Conselho</option>
                          {draft.conversations.map((conv) => (
                            <option key={conv.id} value={conv.id}>
                              {conv.subjectName || "Componente"}
                              {conv.teacherName ? ` (${conv.teacherName})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor="pre-ack-link-expiry"
                          className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                        >
                          Validade
                        </label>
                        <select
                          id="pre-ack-link-expiry"
                          value={linkExpiryDays}
                          onChange={(e) => setLinkExpiryDays(Number(e.target.value))}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                        >
                          <option value={1}>1 dia</option>
                          <option value={7}>7 dias</option>
                          <option value={15}>15 dias</option>
                          <option value={30}>30 dias</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={generatingLink || saving || draft.conversations.length === 0}
                      onClick={() => void handleGeneratePreCouncilLink()}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer shrink-0"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>{generatingLink ? "Gerando..." : "Gerar link e QR Code"}</span>
                    </button>
                  </div>

                  {linkError && (
                    <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs font-semibold text-rose-800 dark:text-rose-200">
                      {linkError}
                    </div>
                  )}

                  {generatedLink && (
                    <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                      {generatedLink.qrCodeDataUrl && (
                        <div className="p-2 bg-white rounded-xl border border-slate-200 shrink-0">
                          <img
                            src={generatedLink.qrCodeDataUrl}
                            alt="QR Code de ciência docente no Pré-Conselho"
                            className="w-32 h-32 object-contain"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 space-y-2 w-full text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[11px]">
                            {generatedLink.subjectName
                              ? `Componente: ${generatedLink.subjectName}`
                              : "Link geral da turma"}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Válido até{" "}
                            {new Date(generatedLink.expiresAt).toLocaleDateString("pt-BR")}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            aria-label="Endereço do link de ciência docente"
                            value={generatedLink.url}
                            onFocus={(e) => e.target.select()}
                            className="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-[11px] font-mono text-slate-800 dark:text-slate-200"
                          />
                          <button
                            type="button"
                            onClick={() => void handleCopyLink()}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold transition shrink-0 cursor-pointer"
                          >
                            {copiedLink ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedLink ? "Copiado" : "Copiar link"}</span>
                          </button>
                          <a
                            href={generatedLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-slate-700 dark:text-slate-200 transition shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Abrir</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tabela de Ciência dos Docentes */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    Registro de Ciência dos Docentes
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {DEFAULT_PRE_COUNCIL_ACK_STATEMENT}
                  </p>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 text-left">
                        <th className="p-2.5 font-bold">Professor(a)</th>
                        <th className="p-2.5 font-bold">Componente Curricular</th>
                        <th className="p-2.5 font-bold">Conversa</th>
                        <th className="p-2.5 font-bold">Ciência</th>
                        <th className="p-2.5 font-bold">Data</th>
                        {!readOnly && <th className="p-2.5 font-bold text-right">Link</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.conversations.map((conv) => (
                        <tr
                          key={conv.id}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">
                            {conv.teacherName || "Não informado"}
                          </td>
                          <td className="p-2.5 text-slate-700 dark:text-slate-300">
                            {conv.subjectName}
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
                            {formatPreCouncilDatePtBr(conv.conversationDate || conv.digitalAckAt) ||
                              "—"}
                          </td>
                          {!readOnly && (
                            <td className="p-2.5 text-right">
                              <button
                                type="button"
                                disabled={generatingLink || saving}
                                onClick={() => void handleGeneratePreCouncilLink(conv.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                              >
                                <Link2 className="w-3 h-3" />
                                <span>Gerar</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
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
                        setDraft((prev) => ({
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
                        setDraft((prev) => ({
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
          )}
        </div>

        {/* Rodapé Fixo com Faixa Estável de Confirmação de Alterações */}
        <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-5 py-3 shrink-0 space-y-2">
          <div
            id={unsavedNoticeId}
            aria-live="polite"
            className={`min-h-[36px] rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs border transition ${
              pendingCloseConfirm
                ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 text-amber-900 dark:text-amber-100 font-bold"
                : isDirty
                  ? "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30 text-sky-900 dark:text-sky-200 font-semibold"
                  : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40 text-slate-600 dark:text-slate-400"
            }`}
          >
            {pendingCloseConfirm ? (
              <>
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Existem alterações não salvas no Pré-Conselho. Deseja descartá-las?
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    ref={discardButtonRef}
                    type="button"
                    aria-describedby={unsavedNoticeId}
                    onClick={() => {
                      setPendingCloseConfirm(false);
                      onClose();
                    }}
                    className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold transition cursor-pointer"
                  >
                    Descartar e fechar
                  </button>
                  <button
                    ref={keepEditingButtonRef}
                    type="button"
                    aria-describedby={unsavedNoticeId}
                    onClick={() => setPendingCloseConfirm(false)}
                    className="px-3 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-100 font-bold transition cursor-pointer"
                  >
                    Continuar editando
                  </button>
                </div>
              </>
            ) : (
              <span>
                {isDirty
                  ? "Alterações pendentes para salvar neste Pré-Conselho."
                  : "Pré-Conselho sincronizado com os registros do trimestre."}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/conselho-classe/${board.id}/imprimir?mode=pre-conselho&trimester=${activeTrimester}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir A4</span>
            </Link>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Fechar
              </button>

              {!readOnly && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void savePreCouncilData(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? "Salvando..." : "Salvar pré-conselho"}</span>
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
