"use client";

import { useState, useMemo, useEffect, useRef, useId } from "react";
import Link from "next/link";
import {
  Send,
  Phone,
  AlertTriangle,
  CheckCircle,
  Edit3,
  ExternalLink,
  HelpCircle,
  ShieldCheck,
  Sun,
  Sunset,
  Moon,
  Stethoscope,
  UserCheck,
  FileText,
  PhoneOff,
  ListChecks,
  User,
  SkipForward,
  Check,
  RotateCcw,
  Clock,
} from "lucide-react";
import { determineShift, formatMessage, SchoolShift } from "@/lib/messageFormatter";
import {
  getActiveJustification,
  KINSHIP_LABELS,
  JUSTIFICATION_TYPE_LABELS,
} from "@/lib/pedagogicalClassifier";
import {
  DELIVERY_STATUS_LABELS,
  evaluateQueueCandidate,
  WA_ME_REUSABLE_WINDOW_NAME,
  type DeliveryStatus,
} from "@/lib/whatsappProvider";

interface Props {
  classGroups: any[];
  templates: any[];
  initialStudents: any[];
  initialSelectedStudentId?: string;
  initialCustomPhone?: string;
  initialMode?: "individual" | "fila";
  initialTurmaId?: string;
  currentUser: {
    name: string;
    email: string;
  };
}

interface QueueItem {
  student: any;
  phone: string;
  guardianName: string;
  message: string;
  logId: string | null;
  whatsappUrl: string | null;
  outcome: "PENDING" | "OPENED" | "SENT" | "FAILED_NO_WHATSAPP" | "SKIPPED";
}

export default function BuscaAtivaClient({
  classGroups,
  templates,
  initialStudents,
  initialSelectedStudentId = "",
  initialCustomPhone = "",
  initialMode = "individual",
  initialTurmaId = "",
  currentUser,
}: Props) {
  const [studentsState, setStudentsState] = useState<any[]>(initialStudents);
  const [dispatchMode, setDispatchMode] = useState<"individual" | "fila">(initialMode);

  // --- Individual Mode States ---
  const [selectedSegment, setSelectedSegment] = useState<string>("TODOS");
  const [selectedTurmaId, setSelectedTurmaId] = useState<string>(initialTurmaId);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialSelectedStudentId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [activeShift, setActiveShift] = useState<SchoolShift>("MANHA");
  const [customMessage, setCustomMessage] = useState<string>("");
  const [customPhone, setCustomPhone] = useState<string>("");
  const [selectedGuardianName, setSelectedGuardianName] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [lastSentSuccess, setLastSentSuccess] = useState<{
    logId: string;
    time: string;
    studentId: string;
    studentName: string;
    phoneUsed: string;
    whatsappUrl: string;
    deliveryStatus: DeliveryStatus;
  } | null>(null);
  const [isUpdatingDelivery, setIsUpdatingDelivery] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // --- Queue Mode (AUT-02) States ---
  const [checkedStudentIds, setCheckedStudentIds] = useState<string[]>([]);
  const [queueActive, setQueueActive] = useState(false);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueCursor, setQueueCursor] = useState(0);
  const [isQueueBusy, setIsQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState("");

  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const queueProgressLabelId = useId();

  // Inicializa aluno vindo via URL (?studentId=...&phone=...)
  useEffect(() => {
    if (!initialSelectedStudentId) return;
    const st = studentsState.find((s) => s.id === initialSelectedStudentId);
    if (st) {
      setCustomPhone(initialCustomPhone || st.phone || "");
      setSelectedGuardianName(st.guardianName || "");
      setActiveShift(determineShift(st));
    }
  }, [initialSelectedStudentId, initialCustomPhone, studentsState]);

  // Filtered turmas by segment
  const filteredClassGroups = useMemo(() => {
    if (selectedSegment === "TODOS") return classGroups;
    return classGroups.filter((cg) => cg.segment === selectedSegment);
  }, [classGroups, selectedSegment]);

  // Filtered students by segment and turma
  const filteredStudents = useMemo(() => {
    return studentsState.filter((s) => {
      const matchSegment = selectedSegment === "TODOS" || s.classGroup.segment === selectedSegment;
      const matchTurma = !selectedTurmaId || s.classGroupId === selectedTurmaId;
      return matchSegment && matchTurma;
    });
  }, [studentsState, selectedSegment, selectedTurmaId]);

  // Selected student object (Individual Mode)
  const selectedStudent = useMemo(() => {
    return studentsState.find((s) => s.id === selectedStudentId);
  }, [studentsState, selectedStudentId]);

  const activeJustification = useMemo(
    () => (selectedStudent ? getActiveJustification(selectedStudent.justifications) : null),
    [selectedStudent]
  );

  // Filtered templates by segment
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (t.segment === "TODOS") return true;
      if (selectedSegment === "TODOS") return true;
      return t.segment === selectedSegment;
    });
  }, [templates, selectedSegment]);

  // Selected template object
  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId);
  }, [templates, selectedTemplateId]);

  // Avaliações de elegibilidade da turma para o Modo Fila (AUT-02)
  const turmaEvaluations = useMemo(() => {
    if (!selectedTurmaId) return [];
    return filteredStudents.map((student) => ({
      student,
      evalResult: evaluateQueueCandidate(student),
    }));
  }, [filteredStudents, selectedTurmaId]);

  const selectableStudentsInTurma = useMemo(
    () => turmaEvaluations.filter((item) => item.evalResult.skipReason !== "SEM_WHATSAPP"),
    [turmaEvaluations]
  );

  const defaultEligibleIds = useMemo(
    () =>
      turmaEvaluations
        .filter((item) => item.evalResult.eligibleByDefault)
        .map((item) => item.student.id),
    [turmaEvaluations]
  );

  // Quando a turma muda no Modo Fila, pré-seleciona apenas os alunos elegíveis (sem atestado e sem disparo hoje)
  useEffect(() => {
    if (dispatchMode === "fila" && selectedTurmaId && !queueActive) {
      setCheckedStudentIds(defaultEligibleIds);
      const turmaObj = classGroups.find((c) => c.id === selectedTurmaId);
      if (turmaObj?.shift && ["MANHA", "TARDE", "NOITE"].includes(turmaObj.shift)) {
        setActiveShift(turmaObj.shift as SchoolShift);
      }
    }
  }, [dispatchMode, selectedTurmaId, defaultEligibleIds, classGroups, queueActive]);

  // Sincroniza propriedade DOM .indeterminate no checkbox mestre (Modern Web Guidance: checkbox)
  useEffect(() => {
    if (!selectAllCheckboxRef.current) return;
    const totalSelectable = selectableStudentsInTurma.length;
    const selectedCount = checkedStudentIds.length;
    selectAllCheckboxRef.current.indeterminate =
      selectedCount > 0 && selectedCount < totalSelectable;
  }, [checkedStudentIds, selectableStudentsInTurma]);

  // Update preview message when student, template, contact or shift changes
  const updatePreview = (
    student: any,
    template: any,
    shiftOverride?: SchoolShift,
    guardianOverride?: string
  ) => {
    if (!student || !template) return;
    const shift = shiftOverride || activeShift;
    const effectiveStudent = {
      ...student,
      guardianName:
        guardianOverride !== undefined
          ? guardianOverride
          : selectedGuardianName || student.guardianName,
    };
    const msg = formatMessage(template.prefixText, template.suffixText, {
      student: effectiveStudent,
      pedagogaName: currentUser.name,
      overrideShift: shift,
    });
    setCustomMessage(msg);
  };

  const handleSelectStudent = (studentId: string) => {
    setSelectedStudentId(studentId);
    setLastSentSuccess(null);
    setErrorMessage("");
    const st = studentsState.find((s) => s.id === studentId);
    if (st) {
      const candidate = evaluateQueueCandidate(st);
      setCustomPhone(candidate.resolvedPhone || st.phone);
      setSelectedGuardianName(candidate.resolvedGuardianName || st.guardianName || "");
      const detectedShift = determineShift(st);
      setActiveShift(detectedShift);
      if (selectedTemplate) {
        updatePreview(
          st,
          selectedTemplate,
          detectedShift,
          candidate.resolvedGuardianName || st.guardianName || ""
        );
      }
    }
  };

  const handleSelectContactOption = (phone: string, guardianName: string) => {
    setCustomPhone(phone);
    setSelectedGuardianName(guardianName);
    if (selectedStudent && selectedTemplate) {
      updatePreview(selectedStudent, selectedTemplate, activeShift, guardianName);
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setErrorMessage("");
    setQueueError("");
    const tmpl = templates.find((t) => t.id === templateId);
    if (selectedStudent && tmpl) {
      updatePreview(selectedStudent, tmpl);
    }
  };

  const handleChangeShift = (newShift: SchoolShift) => {
    setActiveShift(newShift);
    if (selectedStudent && selectedTemplate) {
      updatePreview(selectedStudent, selectedTemplate, newShift);
    }
  };

  // Marca localmente um telefone como sem WhatsApp após retorno da API (AUT-01)
  const syncLocalInvalidContact = (studentId: string, invalidPhone: string) => {
    setStudentsState((prev) =>
      prev.map((s) => {
        if (s.id !== studentId) return s;
        const existingContacts = s.contacts || [];
        const digits = invalidPhone.replace(/\D/g, "");
        const matched = existingContacts.some((c: any) => c.phone.replace(/\D/g, "") === digits);
        const nextContacts = matched
          ? existingContacts.map((c: any) =>
              c.phone.replace(/\D/g, "") === digits ? { ...c, whatsappValid: false } : c
            )
          : [
              ...existingContacts,
              {
                id: `temp-${Date.now()}`,
                name: s.guardianName || "Contato Cadastral",
                kinship: "RESPONSAVEL",
                phone: invalidPhone,
                whatsappValid: false,
              },
            ];
        return { ...s, contacts: nextContacts };
      })
    );
  };

  // Envio Individual (AUT-01)
  const handleSend = async () => {
    if (!selectedStudent || !customMessage) {
      setErrorMessage("Por favor, selecione um aluno e configure a mensagem.");
      return;
    }

    setIsSending(true);
    setErrorMessage("");
    setLastSentSuccess(null);

    try {
      const targetPhone = customPhone || selectedStudent.phone;
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          templateId: selectedTemplate?.id || null,
          reasonTitle: selectedTemplate?.title || "CONTATO PEDAGÓGICO",
          messageContent: customMessage,
          customPhone: targetPhone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao registrar envio");
      }

      setLastSentSuccess({
        logId: data.logId,
        time: new Date().toLocaleTimeString("pt-BR"),
        studentId: selectedStudent.id,
        studentName: selectedStudent.name,
        phoneUsed: targetPhone,
        whatsappUrl: data.whatsappUrl,
        deliveryStatus: data.deliveryStatus || "LINK_OPENED",
      });

      window.open(data.whatsappUrl, WA_ME_REUSABLE_WINDOW_NAME);
    } catch (err: any) {
      setErrorMessage(err.message || "Erro ao processar envio.");
    } finally {
      setIsSending(false);
    }
  };

  // Atualização rápida de status de entrega pós-wa.me (AUT-01)
  const handleUpdateIndividualStatus = async (nextStatus: DeliveryStatus) => {
    if (!lastSentSuccess) return;
    setIsUpdatingDelivery(true);
    try {
      const res = await fetch("/api/messages/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: lastSentSuccess.logId,
          deliveryStatus: nextStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao atualizar status");

      setLastSentSuccess((prev) =>
        prev ? { ...prev, deliveryStatus: nextStatus } : null
      );

      if (nextStatus === "FAILED_NO_WHATSAPP") {
        syncLocalInvalidContact(lastSentSuccess.studentId, lastSentSuccess.phoneUsed);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Erro ao atualizar status de entrega.");
    } finally {
      setIsUpdatingDelivery(false);
    }
  };

  // --- Handlers Modo Fila por Turma (AUT-02) ---
  const handleToggleQueueStudent = (studentId: string) => {
    setCheckedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const handleToggleSelectAllInTurma = () => {
    if (checkedStudentIds.length === selectableStudentsInTurma.length) {
      setCheckedStudentIds([]);
    } else {
      setCheckedStudentIds(selectableStudentsInTurma.map((i) => i.student.id));
    }
  };

  const handleStartQueue = () => {
    if (!selectedTurmaId) {
      setQueueError("Selecione uma turma para iniciar a fila.");
      return;
    }
    if (!selectedTemplate) {
      setQueueError("Selecione o motivo/modelo de mensagem para gerar os textos da fila.");
      return;
    }
    if (checkedStudentIds.length === 0) {
      setQueueError("Marque pelo menos um estudante na lista da turma.");
      return;
    }

    const builtItems: QueueItem[] = checkedStudentIds
      .map((id) => turmaEvaluations.find((e) => e.student.id === id))
      .filter(Boolean)
      .map((entry: any) => {
        const effectiveStudent = {
          ...entry.student,
          guardianName: entry.evalResult.resolvedGuardianName || entry.student.guardianName,
        };
        const msg = formatMessage(selectedTemplate.prefixText, selectedTemplate.suffixText, {
          student: effectiveStudent,
          pedagogaName: currentUser.name,
          overrideShift: activeShift,
        });
        return {
          student: entry.student,
          phone: entry.evalResult.resolvedPhone || entry.student.phone,
          guardianName: entry.evalResult.resolvedGuardianName || entry.student.guardianName || "",
          message: msg,
          logId: null,
          whatsappUrl: null,
          outcome: "PENDING" as const,
        };
      });

    setQueueItems(builtItems);
    setQueueCursor(0);
    setQueueError("");
    setQueueActive(true);
  };

  const currentQueueItem = queueActive ? queueItems[queueCursor] || null : null;
  const completedQueueCount = useMemo(
    () =>
      queueItems.filter((item) =>
        ["SENT", "FAILED_NO_WHATSAPP", "SKIPPED"].includes(item.outcome)
      ).length,
    [queueItems]
  );
  const isQueueFinished = queueActive && queueItems.length > 0 && queueCursor >= queueItems.length;

  const updateCurrentQueueField = (patch: Partial<QueueItem>) => {
    setQueueItems((prev) =>
      prev.map((item, idx) => (idx === queueCursor ? { ...item, ...patch } : item))
    );
  };

  // Passo 1 do item na fila: grava log LINK_OPENED e abre wa.me na aba única reutilizável
  const handleQueueOpenWhatsApp = async () => {
    if (!currentQueueItem) return;
    setIsQueueBusy(true);
    setQueueError("");

    try {
      // Se já abriu para este aluno, apenas reabre a aba sem duplicar log no banco
      if (currentQueueItem.logId && currentQueueItem.whatsappUrl) {
        window.open(currentQueueItem.whatsappUrl, WA_ME_REUSABLE_WINDOW_NAME);
        return;
      }

      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: currentQueueItem.student.id,
          templateId: selectedTemplate?.id || null,
          reasonTitle: selectedTemplate?.title || "BUSCA ATIVA POR TURMA",
          messageContent: currentQueueItem.message,
          customPhone: currentQueueItem.phone,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao registrar envio da fila");

      updateCurrentQueueField({
        logId: data.logId,
        whatsappUrl: data.whatsappUrl,
        outcome: "OPENED",
      });

      window.open(data.whatsappUrl, WA_ME_REUSABLE_WINDOW_NAME);
    } catch (err: any) {
      setQueueError(err.message || "Erro ao abrir WhatsApp para este aluno.");
    } finally {
      setIsQueueBusy(false);
    }
  };

  // Passo 2 do item na fila: confirma SENT ou FAILED_NO_WHATSAPP e avança automaticamente
  const handleQueueResolveAndNext = async (status: "SENT" | "FAILED_NO_WHATSAPP") => {
    if (!currentQueueItem) return;
    setIsQueueBusy(true);
    setQueueError("");

    try {
      let targetLogId = currentQueueItem.logId;

      // Caso a pedagoga clique direto em "Sem WhatsApp" (ex.: já sabia ao tentar) sem ter criado o log antes
      if (!targetLogId) {
        const sendRes = await fetch("/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: currentQueueItem.student.id,
            templateId: selectedTemplate?.id || null,
            reasonTitle: selectedTemplate?.title || "BUSCA ATIVA POR TURMA",
            messageContent: currentQueueItem.message,
            customPhone: currentQueueItem.phone,
            initialDeliveryStatus: status,
          }),
        });
        const sendData = await sendRes.json();
        if (!sendRes.ok) throw new Error(sendData.error || "Erro ao registrar tentativa");
        targetLogId = sendData.logId;
      }

      const patchRes = await fetch("/api/messages/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logId: targetLogId,
          deliveryStatus: status,
        }),
      });
      const patchData = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchData.error || "Erro ao salvar status");

      if (status === "FAILED_NO_WHATSAPP") {
        syncLocalInvalidContact(currentQueueItem.student.id, currentQueueItem.phone);
      }

      setQueueItems((prev) =>
        prev.map((item, idx) =>
          idx === queueCursor ? { ...item, logId: targetLogId, outcome: status } : item
        )
      );
      setQueueCursor((c) => c + 1);
    } catch (err: any) {
      setQueueError(err.message || "Falha ao concluir item da fila.");
    } finally {
      setIsQueueBusy(false);
    }
  };

  const handleQueueSkip = () => {
    setQueueItems((prev) =>
      prev.map((item, idx) => (idx === queueCursor ? { ...item, outcome: "SKIPPED" } : item))
    );
    setQueueCursor((c) => c + 1);
  };

  const handleResetQueue = () => {
    setQueueActive(false);
    setQueueItems([]);
    setQueueCursor(0);
    setQueueError("");
  };

  return (
    <div className="space-y-6">
      {/* Title, Mode Switcher & User info */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <Send className="w-6 h-6 text-sky-600" />
            <span>Painel de Busca Ativa & Envio de Mensagens</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Operação assistida via <strong>WhatsApp Web (wa.me)</strong> com rastreio de entrega e saneamento cadastral em nome de{" "}
            <strong>{currentUser.name}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Seletor de Modo: Individual vs Fila por Turma (AUT-02) */}
          <div className="inline-flex p-1 rounded-xl bg-slate-200/80 border border-slate-300 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setDispatchMode("individual");
                handleResetQueue();
              }}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition ${
                dispatchMode === "individual"
                  ? "bg-white text-sky-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Envio Individual</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDispatchMode("fila");
                setLastSentSuccess(null);
              }}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition ${
                dispatchMode === "fila"
                  ? "bg-sky-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>Fila por Turma (wa.me)</span>
            </button>
          </div>

          <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-800 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse" />
            {currentUser.name}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODO 1: ENVIO INDIVIDUAL (COM CONFIRMAÇÃO REAL DE ENTREGA — AUT-01)   */}
      {/* ===================================================================== */}
      {dispatchMode === "individual" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Segment, Turma, Student & Reason selection */}
          <div className="lg:col-span-5 space-y-5">
            {/* 1. Nível / Segmento Tabs */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                1. Nível de Ensino / Turno
              </label>
              <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {["TODOS", "FUNDAMENTAL", "MEDIO", "NOTURNO"].map((seg) => (
                  <button
                    key={seg}
                    type="button"
                    onClick={() => {
                      setSelectedSegment(seg);
                      setSelectedTurmaId("");
                      setSelectedStudentId("");
                    }}
                    className={`py-1.5 text-xs font-semibold rounded-md transition ${
                      selectedSegment === seg
                        ? "bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                    }`}
                  >
                    {seg === "MEDIO" ? "MÉDIO" : seg}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Turma & Student Selection */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                  2. Selecione a Turma
                </label>
                <select
                  value={selectedTurmaId}
                  onChange={(e) => {
                    setSelectedTurmaId(e.target.value);
                    setSelectedStudentId("");
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition"
                >
                  <option value="">Todas as Turmas ({filteredClassGroups.length})</option>
                  {filteredClassGroups.map((cg) => (
                    <option key={cg.id} value={cg.id}>
                      {cg.name} ({cg.segment})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                  3. Selecione o Aluno ({filteredStudents.length} disponíveis)
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => handleSelectStudent(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 font-medium transition"
                >
                  <option value="">-- Escolha um aluno na lista --</option>
                  {filteredStudents.map((st) => {
                    const hasActiveJust = getActiveJustification(st.justifications) !== null;
                    const prefix = st.isExchangeStudent
                      ? "✈️ [Intercâmbio] "
                      : hasActiveJust
                      ? "🩺 [Atestado] "
                      : st.isSpecialNeeds
                      ? "♿ [AEE] "
                      : "";
                    return (
                      <option key={st.id} value={st.id}>
                        {prefix}
                        {st.name} — {st.classGroup.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Student Context Card if selected */}
              {selectedStudent && (
                <div className="p-3.5 bg-sky-50/60 border border-sky-200 rounded-xl space-y-2.5 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <span className="font-bold text-slate-900 text-sm block">
                        {selectedStudent.name}
                      </span>
                      <span className="text-slate-600">
                        Turma: <strong>{selectedStudent.classGroup.name}</strong> • Responsável:{" "}
                        <strong>
                          {selectedGuardianName || selectedStudent.guardianName || "Não informado"}
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      <Link
                        href={`/alunos/${selectedStudent.id}`}
                        className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-white hover:bg-sky-100 text-sky-800 border border-sky-200 font-bold text-[10px]"
                        title="Abrir Prontuário 360º"
                      >
                        <UserCheck className="w-3 h-3" />
                        <span>360º</span>
                      </Link>
                      <Link
                        href={`/alunos/${selectedStudent.id}/dossie`}
                        className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-[10px]"
                        title="Emitir Dossiê PDF"
                      >
                        <FileText className="w-3 h-3" />
                        <span>PDF</span>
                      </Link>
                    </div>
                  </div>

                  {/* Alerta de Intercâmbio Ganhando Mundo */}
                  {selectedStudent.isExchangeStudent && (
                    <div className="p-2.5 bg-blue-100 border border-blue-300 rounded-lg text-blue-950 flex items-start space-x-2">
                      <span className="text-base shrink-0">✈️</span>
                      <div>
                        <strong className="block font-extrabold">
                          Aluno em Intercâmbio Oficial (Ganhando Mundo)
                        </strong>
                        <span className="text-[11px] block">
                          Este(a) estudante está participando do programa internacional Ganhando Mundo no exterior. Cobranças de frequência e avisos de infrequência devem ser suspensos.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Alerta de Atestado Médico Vigente (PED-03) */}
                  {activeJustification && (
                    <div className="p-2.5 bg-emerald-100 border border-emerald-300 rounded-lg text-emerald-950 flex items-start space-x-2">
                      <Stethoscope className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-extrabold">
                          🩺 Atenção: Atestado / Justificativa Vigente!
                        </strong>
                        <span className="text-[11px] block">
                          {JUSTIFICATION_TYPE_LABELS[activeJustification.type] ||
                            activeJustification.type}{" "}
                          válido de{" "}
                          <strong>
                            {new Date(activeJustification.startDate).toLocaleDateString("pt-BR")}
                          </strong>{" "}
                          até{" "}
                          <strong>
                            {new Date(activeJustification.endDate).toLocaleDateString("pt-BR")}
                          </strong>
                          .{activeJustification.notes ? ` (${activeJustification.notes})` : ""}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Seletor Rápido de Múltiplos Contatos (PED-04) */}
                  {selectedStudent.contacts?.length > 0 && (
                    <div className="pt-1.5 border-t border-sky-100 space-y-1.5">
                      <span className="text-[11px] font-bold text-sky-900 block">
                        Escolher destinatário familiar:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleSelectContactOption(
                              selectedStudent.phone,
                              selectedStudent.guardianName || ""
                            )
                          }
                          className={`px-2 py-1 rounded-md text-[11px] font-bold border transition ${
                            customPhone === selectedStudent.phone
                              ? "bg-sky-600 text-white border-sky-600"
                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          Principal ({selectedStudent.phone})
                        </button>

                        {selectedStudent.contacts.map((c: any) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleSelectContactOption(c.phone, c.name)}
                            className={`inline-flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-bold border transition ${
                              customPhone === c.phone
                                ? "bg-sky-600 text-white border-sky-600"
                                : c.whatsappValid !== false
                                ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                                : "bg-rose-50 text-rose-800 border-rose-200"
                            }`}
                            title={
                              c.whatsappValid !== false
                                ? c.name
                                : `${c.name} — Número sinalizado sem WhatsApp`
                            }
                          >
                            {c.whatsappValid === false && <PhoneOff className="w-3 h-3" />}
                            <span>
                              {KINSHIP_LABELS[c.kinship] || c.kinship}: {c.name.split(" ")[0]} (
                              {c.phone})
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center space-x-2 pt-1.5 border-t border-sky-100">
                    <Phone className="w-3.5 h-3.5 text-sky-600" />
                    <span className="text-slate-600">Número de envio:</span>
                    <input
                      type="text"
                      value={customPhone}
                      onChange={(e) => setCustomPhone(e.target.value)}
                      className="font-mono text-xs px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-800 w-36"
                      title="Editar telefone pontualmente para este envio se necessário"
                    />
                    <span className="text-[10px] text-slate-400">(editável)</span>
                  </div>

                  {/* History & Attendance Warning */}
                  {selectedStudent.lowAttendanceRecord && (
                    <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded-lg text-amber-900 font-medium flex items-start space-x-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span>Atenção: Aluno em Acompanhamento de Frequência!</span>
                        <div className="text-[11px] font-normal mt-0.5 space-y-0.5">
                          <div>
                            Freq Geral:{" "}
                            <strong>
                              {selectedStudent.lowAttendanceRecord.attendancePercent}%
                            </strong>
                            {selectedStudent.lowAttendanceRecord.enrollmentDetail && (
                              <span className="text-amber-800 font-mono text-[10px] block mt-0.5">
                                {selectedStudent.lowAttendanceRecord.enrollmentDetail}
                              </span>
                            )}
                          </div>
                          {selectedStudent.lowAttendanceRecord.actionsTaken && (
                            <div className="text-slate-700 italic">
                              {selectedStudent.lowAttendanceRecord.actionsTaken}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedStudent.messageLogs?.length > 0 && (
                    <div className="mt-2 text-slate-600 text-[11px] border-t border-sky-100 pt-1.5">
                      <span className="font-semibold text-sky-900">
                        Últimos contatos registrados:
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {selectedStudent.messageLogs.map((log: any) => (
                          <li key={log.id} className="truncate">
                            • {new Date(log.sentAt).toLocaleDateString("pt-BR")}:{" "}
                            <strong>{log.reasonTitle}</strong> ({log.sentByName})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 4. Reason / Template Selection */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                4. Selecione o Motivo da Mensagem
              </label>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {filteredTemplates.map((t) => {
                  const isSelected = selectedTemplateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelectTemplate(t.id)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs font-medium transition flex items-center justify-between ${
                        isSelected
                          ? "bg-sky-600 text-white border-sky-600 shadow-xs"
                          : "bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      <span>{t.title}</span>
                      {t.isAbsenceRelated && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            isSelected
                              ? "bg-white/20 text-white"
                              : "bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-transparent dark:border-red-900/50"
                          }`}
                        >
                          Falta
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Live Message Preview & WhatsApp Action */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center space-x-2">
                  <Edit3 className="w-5 h-5 text-sky-600" />
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Prévia da Mensagem (Editável)
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Texto adaptado automaticamente ao aluno e período
                    </p>
                  </div>
                </div>

                {/* Seletor Rápido de Período / Turno */}
                <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1.5 hidden md:inline">
                    Período:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleChangeShift("MANHA")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1 ${
                      activeShift === "MANHA"
                        ? "bg-amber-500 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span>Manhã</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeShift("TARDE")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1 ${
                      activeShift === "TARDE"
                        ? "bg-sky-600 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    <Sunset className="w-3.5 h-3.5" />
                    <span>Tarde</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeShift("NOITE")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1 ${
                      activeShift === "NOITE"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>Noite</span>
                  </button>
                </div>
              </div>

              <div className="relative">
                <textarea
                  rows={11}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Selecione um aluno e um motivo à esquerda para gerar o texto da mensagem automaticamente..."
                  className="w-full text-sm font-sans p-4 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 leading-relaxed transition shadow-inner"
                />
              </div>

              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* AUT-01: Confirmação Real de Entrega ou Saneamento de Número pós-wa.me */}
              {lastSentSuccess && (
                <div
                  className={`p-4 rounded-xl border text-xs space-y-3 ${
                    lastSentSuccess.deliveryStatus === "FAILED_NO_WHATSAPP"
                      ? "bg-rose-50 border-rose-200 text-rose-900"
                      : "bg-emerald-50 border-emerald-200 text-emerald-900"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center font-bold text-sm">
                      {lastSentSuccess.deliveryStatus === "FAILED_NO_WHATSAPP" ? (
                        <>
                          <PhoneOff className="w-4 h-4 mr-1.5 text-rose-600" />
                          <span>Número sinalizado como Sem WhatsApp!</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 mr-1.5 text-emerald-600" />
                          <span>
                            Acionamento aberto para {lastSentSuccess.studentName} (
                            {lastSentSuccess.time})
                          </span>
                        </>
                      )}
                    </div>

                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-white border border-current">
                      Status: {DELIVERY_STATUS_LABELS[lastSentSuccess.deliveryStatus]}
                    </span>
                  </div>

                  <p className="text-[11px] opacity-90">
                    {lastSentSuccess.deliveryStatus === "FAILED_NO_WHATSAPP"
                      ? `O telefone ${lastSentSuccess.phoneUsed} foi marcado automaticamente como inválido no cadastro do estudante e constará como tentativa frustrada no Dossiê do Conselho Tutelar/SERP.`
                      : "Após a abertura do WhatsApp Web (wa.me), confirme com 1 clique se o envio foi concluído ou se o número não possui conta no WhatsApp:"}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isUpdatingDelivery || lastSentSuccess.deliveryStatus === "SENT"}
                      onClick={() => handleUpdateIndividualStatus("SENT")}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold transition shadow-2xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        {lastSentSuccess.deliveryStatus === "SENT"
                          ? "Envio Confirmado"
                          : "Confirmar Envio Efetivado"}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={
                        isUpdatingDelivery ||
                        lastSentSuccess.deliveryStatus === "FAILED_NO_WHATSAPP"
                      }
                      onClick={() => handleUpdateIndividualStatus("FAILED_NO_WHATSAPP")}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-rose-100 text-rose-700 border border-rose-300 disabled:opacity-50 font-bold transition"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                      <span>Número sem WhatsApp (Invalidar)</span>
                    </button>

                    <a
                      href={lastSentSuccess.whatsappUrl}
                      target={WA_ME_REUSABLE_WINDOW_NAME}
                      rel="noopener noreferrer"
                      className="inline-flex items-center font-bold text-sky-800 underline hover:text-sky-950 ml-auto"
                    >
                      Reabrir conversa <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                </div>
              )}

              {/* Dispatch Button */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-500 flex items-center space-x-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Reutiliza aba única do WhatsApp Web e grava trilha de auditoria</span>
                </div>

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isSending || !selectedStudent || !customMessage}
                  className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition disabled:cursor-not-allowed text-sm"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {isSending ? "Registrando e abrindo..." : "Abrir WhatsApp (wa.me) & Gravar"}
                  </span>
                </button>
              </div>
            </div>

            {/* Quick Instructions Guide */}
            <div className="bg-sky-50/50 dark:bg-slate-900 rounded-xl border border-sky-100 dark:border-slate-800 p-5 text-xs text-sky-950 dark:text-slate-300 space-y-2">
              <h3 className="font-bold text-sky-900 dark:text-sky-400 flex items-center space-x-1.5 text-sm">
                <HelpCircle className="w-4 h-4 text-sky-700 dark:text-sky-400" />
                <span>Dica Rápida: Precisa avisar vários alunos faltosos de uma mesma turma?</span>
              </h3>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                Alterne no topo para{" "}
                <button
                  type="button"
                  onClick={() => setDispatchMode("fila")}
                  className="font-bold text-sky-700 dark:text-sky-400 underline hover:text-sky-900 dark:hover:text-sky-300"
                >
                  Fila por Turma (wa.me)
                </button>{" "}
                para marcar os faltosos do dia de uma só vez e avançar aluno por aluno na mesma guia do WhatsApp Web, pulando automaticamente quem possui atestado médico vigente!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODO 2: FILA ASSISTIDA POR TURMA VIA WA.ME (AUT-02)                   */}
      {/* ===================================================================== */}
      {dispatchMode === "fila" && !queueActive && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Configuração da Fila (Esquerda) */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
              <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                <ListChecks className="w-4 h-4 text-sky-600" />
                <span>1. Configurar Chamada / Fila da Turma</span>
              </h2>

              <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-lg">
                {["TODOS", "FUNDAMENTAL", "MEDIO", "NOTURNO"].map((seg) => (
                  <button
                    key={seg}
                    type="button"
                    onClick={() => {
                      setSelectedSegment(seg);
                      setSelectedTurmaId("");
                    }}
                    className={`py-1.5 text-xs font-semibold rounded-md transition ${
                      selectedSegment === seg
                        ? "bg-white text-sky-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {seg === "MEDIO" ? "MÉDIO" : seg}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Turma Alvo da Busca Ativa:
                </label>
                <select
                  value={selectedTurmaId}
                  onChange={(e) => setSelectedTurmaId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2.5 bg-slate-50 focus:bg-white font-semibold"
                >
                  <option value="">-- Escolha uma turma para listar os estudantes --</option>
                  {filteredClassGroups.map((cg) => (
                    <option key={cg.id} value={cg.id}>
                      {cg.name} ({cg.segment})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Saudação / Período da Mensagem:
                </label>
                <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl">
                  {(["MANHA", "TARDE", "NOITE"] as SchoolShift[]).map((sh) => (
                    <button
                      key={sh}
                      type="button"
                      onClick={() => setActiveShift(sh)}
                      className={`py-1.5 rounded-lg text-xs font-bold transition ${
                        activeShift === sh
                          ? "bg-sky-600 text-white shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {sh === "MANHA" ? "Manhã" : sh === "TARDE" ? "Tarde" : "Noite"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Modelo Institucional do Disparo:
                </label>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {filteredTemplates.map((t) => {
                    const isSelected = selectedTemplateId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectTemplate(t.id)}
                        className={`w-full text-left p-2.5 rounded-lg border text-xs font-medium transition flex items-center justify-between ${
                          isSelected
                            ? "bg-sky-600 text-white border-sky-600 shadow-xs"
                            : "bg-slate-50/50 hover:bg-slate-100 border-slate-200 text-slate-700"
                        }`}
                      >
                        <span>{t.title}</span>
                        {t.isAbsenceRelated && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              isSelected ? "bg-white/20 text-white" : "bg-red-50 text-red-600"
                            }`}
                          >
                            Falta
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {queueError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-semibold flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{queueError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleStartQueue}
                disabled={!selectedTurmaId || !selectedTemplateId || checkedStudentIds.length === 0}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-sm shadow-md transition flex items-center justify-center space-x-2 cursor-pointer disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                <span>
                  Iniciar Fila Guiada wa.me ({checkedStudentIds.length} selecionado
                  {checkedStudentIds.length === 1 ? "" : "s"})
                </span>
              </button>
            </div>
          </div>

          {/* Lista de Seleção em Lote dos Alunos da Turma (Direita) */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    2. Seleção de Estudantes para Acionamento
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Alunos com 🩺 Atestado Vigente, 📵 Sem WhatsApp ou já acionados hoje vêm desmarcados automaticamente.
                  </p>
                </div>

                {selectedTurmaId && selectableStudentsInTurma.length > 0 && (
                  <label className="checkbox-hit-label text-xs font-bold text-slate-800 px-2">
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      className="checkbox-custom"
                      checked={
                        selectableStudentsInTurma.length > 0 &&
                        checkedStudentIds.length === selectableStudentsInTurma.length
                      }
                      onChange={handleToggleSelectAllInTurma}
                    />
                    <span>
                      Marcar Todos ({checkedStudentIds.length}/{selectableStudentsInTurma.length})
                    </span>
                  </label>
                )}
              </div>

              {!selectedTurmaId ? (
                <div className="p-12 text-center text-slate-400 text-sm">
                  Selecione uma turma à esquerda para carregar a chamada de busca ativa.
                </div>
              ) : turmaEvaluations.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">
                  Nenhum estudante ativo cadastrado nesta turma.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
                  {turmaEvaluations.map(({ student, evalResult }) => {
                    const isChecked = checkedStudentIds.includes(student.id);
                    const isDisabled = evalResult.skipReason === "SEM_WHATSAPP";

                    return (
                      <div
                        key={student.id}
                        className={`px-5 py-2.5 flex items-center justify-between gap-3 text-xs transition ${
                          isChecked ? "bg-sky-50/50" : "hover:bg-slate-50"
                        }`}
                      >
                        <label
                          className={`checkbox-hit-label flex-1 ${
                            isDisabled ? "opacity-60 cursor-not-allowed" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="checkbox-custom shrink-0"
                            disabled={isDisabled}
                            checked={isChecked}
                            onChange={() => handleToggleQueueStudent(student.id)}
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-slate-900">{student.name}</span>

                              {evalResult.skipReason === "INTERCAMBIO_GANHANDO_MUNDO" && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 font-bold text-[10px]">
                                  <span>✈️ Ganhando Mundo</span>
                                </span>
                              )}

                              {evalResult.skipReason === "ATESTADO_VIGENTE" && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[10px]">
                                  <Stethoscope className="w-3 h-3" />
                                  <span>Atestado Vigente</span>
                                </span>
                              )}

                              {evalResult.skipReason === "JA_ACIONADO_HOJE" && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-bold text-[10px]">
                                  <Clock className="w-3 h-3" />
                                  <span>Já acionado hoje</span>
                                </span>
                              )}

                              {evalResult.skipReason === "SEM_WHATSAPP" && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 font-bold text-[10px]">
                                  <PhoneOff className="w-3 h-3" />
                                  <span>Sem WhatsApp válido</span>
                                </span>
                              )}

                              {evalResult.usedFallbackContact && (
                                <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-semibold text-[10px]">
                                  Usando contato alternativo ({evalResult.resolvedGuardianName})
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-500 font-mono">
                              Fone: {evalResult.resolvedPhone || "Não cadastrado"}
                              {student.lowAttendanceRecord && (
                                <span className="ml-2 font-sans font-bold text-amber-700">
                                  • Freq: {student.lowAttendanceRecord.attendancePercent}%
                                </span>
                              )}
                            </div>
                          </div>
                        </label>

                        <Link
                          href={`/alunos/${student.id}`}
                          className="px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-100 text-[10px] font-bold text-slate-600 shrink-0"
                        >
                          360º
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ASSISTENTE EM EXECUÇÃO DA FILA WA.ME (PASSO A PASSO)                  */}
      {/* ===================================================================== */}
      {dispatchMode === "fila" && queueActive && (
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Cabeçalho com <progress> nativo acessível (Modern Web Guidance: progress) */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span id={queueProgressLabelId} className="text-sm font-extrabold text-slate-900">
                Progresso da Fila Assistida via WhatsApp Web (wa.me)
              </span>

              <div
                role="status"
                aria-live="polite"
                className="text-xs font-bold text-sky-800 bg-sky-50 px-3 py-1 rounded-full border border-sky-200"
              >
                {completedQueueCount} de {queueItems.length} concluídos
              </div>
            </div>

            <progress
              className="queue-progress"
              value={completedQueueCount}
              max={queueItems.length}
              aria-labelledby={queueProgressLabelId}
            />

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Motivo: <strong>{selectedTemplate?.title}</strong> • Todas as mensagens abrem na mesma guia do navegador.
              </span>
              <button
                type="button"
                onClick={handleResetQueue}
                className="inline-flex items-center space-x-1 font-bold text-slate-600 hover:text-slate-900"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Encerrar / Voltar à Turma</span>
              </button>
            </div>
          </div>

          {/* Cartão do Estudante Atual na Fila */}
          {!isQueueFinished && currentQueueItem && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-600">
                    Estudante {queueCursor + 1} de {queueItems.length}
                  </span>
                  <h2 className="text-xl font-black text-slate-900 mt-0.5">
                    {currentQueueItem.student.name}
                  </h2>
                  <p className="text-xs text-slate-600">
                    Turma: <strong>{currentQueueItem.student.classGroup.name}</strong> • Responsável:{" "}
                    <strong>{currentQueueItem.guardianName || "Não informado"}</strong>
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <Phone className="w-4 h-4 text-sky-600" />
                  <input
                    type="text"
                    value={currentQueueItem.phone}
                    onChange={(e) => updateCurrentQueueField({ phone: e.target.value })}
                    className="font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white w-36"
                    title="Telefone de destino para este estudante"
                  />
                </div>
              </div>

              <textarea
                rows={7}
                value={currentQueueItem.message}
                onChange={(e) => updateCurrentQueueField({ message: e.target.value })}
                className="w-full text-sm p-3.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white leading-relaxed"
              />

              {queueError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-semibold">
                  {queueError}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={isQueueBusy}
                  onClick={handleQueueSkip}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
                >
                  <SkipForward className="w-4 h-4" />
                  <span>Pular Aluno</span>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isQueueBusy}
                    onClick={handleQueueOpenWhatsApp}
                    className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>
                      {currentQueueItem.outcome === "OPENED"
                        ? "Reabrir no WhatsApp (wa.me)"
                        : "1. Abrir no WhatsApp (wa.me)"}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isQueueBusy}
                    onClick={() => handleQueueResolveAndNext("SENT")}
                    className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>2. Enviado → Próximo</span>
                  </button>

                  <button
                    type="button"
                    disabled={isQueueBusy}
                    onClick={() => handleQueueResolveAndNext("FAILED_NO_WHATSAPP")}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 text-xs font-bold transition cursor-pointer"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>Sem WhatsApp</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Resumo Final da Fila Concluída */}
          {isQueueFinished && (
            <div className="bg-white p-6 rounded-2xl border border-emerald-200 shadow-sm space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-black text-slate-900">
                Fila de Busca Ativa da Turma Concluída!
              </h2>

              <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto text-xs">
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-xl font-black text-emerald-700">
                    {queueItems.filter((i) => i.outcome === "SENT").length}
                  </div>
                  <div className="font-bold text-emerald-900">Envios Confirmados</div>
                </div>
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                  <div className="text-xl font-black text-rose-700">
                    {queueItems.filter((i) => i.outcome === "FAILED_NO_WHATSAPP").length}
                  </div>
                  <div className="font-bold text-rose-900">Sem WhatsApp</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xl font-black text-slate-700">
                    {queueItems.filter((i) => i.outcome === "SKIPPED").length}
                  </div>
                  <div className="font-bold text-slate-700">Pulados</div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleResetQueue}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition cursor-pointer"
                >
                  <ListChecks className="w-4 h-4" />
                  <span>Selecionar Outra Turma</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
