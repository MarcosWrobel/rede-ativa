"use client";

import { useState, useEffect, useMemo } from "react";
import AtaDialog from "./AtaDialog";
import SignatureCanvas from "./SignatureCanvas";
import {
  Sparkles,
  Mic,
  MicOff,
  UserPlus,
  Trash2,
  QrCode,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
  Lock,
  Printer,
  Share2,
  Users,
  Search,
  ArrowRight,
  ArrowLeft,
  X,
  Check,
  ShieldCheck,
  FilePlus2,
  Ban,
  RotateCcw,
  ExternalLink,
  Copy,
  Key,
  Send,
  Clock,
} from "lucide-react";

interface StudentOption {
  id: string;
  name: string;
  classGroupName?: string;
  cgm?: string | null;
  email?: string | null;
  phone?: string | null;
  guardianName?: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  availableStudents: StudentOption[];
  preSelectedStudentId?: string;
  existingMinute?: any;
  isAdmin?: boolean;
}

const CATEGORIES = [
  { id: "ACOMPANHAMENTO_PEDAGOGICO", label: "Acompanhamento Pedagógico / Rendimento" },
  { id: "BUSCA_ATIVA_FALTAS", label: "Busca Ativa / Frequência Escolar" },
  { id: "CONVIVENCIA_INDISCIPLINA", label: "Convivência e Mediação de Conflitos" },
  { id: "SAUDE_VULNERABILIDADE", label: "Saúde / Vulnerabilidade Social" },
  { id: "REDE_PROTECAO_CT", label: "Rede de Proteção / Conselho Tutelar" },
  { id: "ORIENTACAO_ROTINA", label: "Orientação de Rotina Escolar" },
];

export default function AtaEditorModal({
  isOpen,
  onClose,
  onSaved,
  availableStudents,
  preSelectedStudentId,
  existingMinute,
  isAdmin = false,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);

  // Filtros de Pesquisa de Alunos (Passo 1)
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedTurmaFilter, setSelectedTurmaFilter] = useState("TODAS");
  const [step1Error, setStep1Error] = useState<string | null>(null);

  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [category, setCategory] = useState("ACOMPANHAMENTO_PEDAGOGICO");
  const [isConfidential, setIsConfidential] = useState(false);
  const [subject, setSubject] = useState("Atendimento Pedagógico e Alinhamento de Frequência");
  const [rawNotes, setRawNotes] = useState("");
  const [summary, setSummary] = useState("");
  const [agreementsSummary, setAgreementsSummary] = useState("");
  const [participants, setParticipants] = useState<any[]>([]);
  const [actionItems, setActionItems] = useState<any[]>([]);

  // Estados de IA, Gravação e Salvamento
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccessMsg, setAiSuccessMsg] = useState<{ type: "success" | "warning"; text: string } | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [hasServerKey, setHasServerKey] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [keyTestStatus, setKeyTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingFinal, setSavingFinal] = useState(false);
  const [draftSavedMsg, setDraftSavedMsg] = useState<string | null>(null);
  const [activeSignParticipantIndex, setActiveSignParticipantIndex] = useState<number | null>(null);
  const [activeRefusalIndex, setActiveRefusalIndex] = useState<number | null>(null);
  const [refusalDraftReason, setRefusalDraftReason] = useState("");
  const [refusalDraftWitness, setRefusalDraftWitness] = useState("Equipe Pedagógica");
  const [qrModalInfo, setQrModalInfo] = useState<{
    url: string;
    name: string;
    expiresInMinutes: number;
    participantRole: string;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [signDurationOption, setSignDurationOption] = useState<number>(20); // 20 min ou 1440 (24h)
  const [finalizedAta, setFinalizedAta] = useState<any | null>(null);
  const [minuteId, setMinuteId] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Estados exclusivos para visualização de Ata já Lavrada (Adendo / Cancelamento / Ações)
  const [viewMinuteData, setViewMinuteData] = useState<any | null>(null);
  const [addendumText, setAddendumText] = useState("");
  const [savingAddendum, setSavingAddendum] = useState(false);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [savingVoid, setSavingVoid] = useState(false);
  const [showAdminDeleteConfirm, setShowAdminDeleteConfirm] = useState(false);
  const [isDeletingAdmin, setIsDeletingAdmin] = useState(false);
  const [postFinalizeMsg, setPostFinalizeMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Carrega chave Gemini salva no navegador e checa chave no servidor
  useEffect(() => {
    try {
      const saved = localStorage.getItem("leopoldina_gemini_api_key");
      if (saved) setGeminiApiKey(saved);
    } catch (e) {}

    fetch("/api/ai/test-key")
      .then((res) => res.json())
      .then((data) => {
        if (data?.hasServerKey) setHasServerKey(true);
      })
      .catch(() => {});
  }, []);

  const handleSaveGeminiKey = (val: string) => {
    setGeminiApiKey(val);
    try {
      localStorage.setItem("leopoldina_gemini_api_key", val.trim());
    } catch (e) {}
  };

  const handleTestGeminiKey = async () => {
    setIsTestingApiKey(true);
    setKeyTestStatus(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (geminiApiKey && geminiApiKey.trim().length > 10) {
        headers["x-gemini-key"] = geminiApiKey.trim();
      }
      const res = await fetch("/api/ai/test-key", {
        method: "POST",
        headers,
        body: JSON.stringify({ apiKey: geminiApiKey }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setKeyTestStatus({
          ok: true,
          msg: `✨ Chave ativa! Modelo: ${data.respondingModel} (${data.durationMs}ms)`,
        });
      } else {
        setKeyTestStatus({
          ok: false,
          msg: data.error || "Chave inválida ou sem resposta do Google Gemini.",
        });
      }
    } catch (err: any) {
      setKeyTestStatus({
        ok: false,
        msg: err.message || "Erro ao conectar com o serviço do Google Gemini.",
      });
    } finally {
      setIsTestingApiKey(false);
    }
  };

  // Inicializa / reseta o modal sempre que abrir ou trocar de ata
  useEffect(() => {
    if (!isOpen) return;

    setFinalizeError(null);
    setStep1Error(null);
    setAiError(null);
    setAiSuccessMsg(null);
    setDraftSavedMsg(null);
    setQrModalInfo(null);
    setActiveSignParticipantIndex(null);
    setActiveRefusalIndex(null);
    setFinalizedAta(null);
    setAddendumText("");
    setShowVoidForm(false);
    setVoidReason("");
    setPostFinalizeMsg(null);

    if (existingMinute) {
      if (existingMinute.status === "FINALIZED" || existingMinute.status === "VOIDED") {
        setViewMinuteData(existingMinute);
        setMinuteId(existingMinute.id);
        return;
      }

      setViewMinuteData(null);
      setMinuteId(existingMinute.id || null);
      setSelectedStudentIds(
        existingMinute.students ? existingMinute.students.map((s: any) => s.studentId) : []
      );
      setCategory(existingMinute.category || "ACOMPANHAMENTO_PEDAGOGICO");
      setIsConfidential(Boolean(existingMinute.isConfidential));
      setSubject(existingMinute.subject || "Atendimento Pedagógico e Alinhamento de Frequência");
      setRawNotes(existingMinute.rawNotes || "");
      setSummary(existingMinute.summary || "");
      setAgreementsSummary(existingMinute.agreementsSummary || "");
      setParticipants(existingMinute.participants || []);
      setActionItems(
        existingMinute.actionItems
          ? existingMinute.actionItems.map((a: any) => ({
              id: a.id,
              description: a.description,
              responsible: a.responsible,
              dueDate: a.dueDate ? String(a.dueDate).slice(0, 10) : "",
              status: a.status || "PENDING",
            }))
          : []
      );
      setStep(existingMinute.students?.length > 0 ? 2 : 1);
    } else {
      setViewMinuteData(null);
      setMinuteId(null);
      setCategory("ACOMPANHAMENTO_PEDAGOGICO");
      setIsConfidential(false);
      setSubject("Atendimento Pedagógico e Alinhamento de Frequência");
      setRawNotes("");
      setSummary("");
      setAgreementsSummary("");
      setActionItems([]);

      if (preSelectedStudentId) {
        setSelectedStudentIds([preSelectedStudentId]);
        const stud = availableStudents.find((s) => s.id === preSelectedStudentId);
        if (stud?.guardianName) {
          setParticipants([
            {
              role: "RESPONSAVEL",
              name: stud.guardianName,
              kinship: "Mãe/Pai",
              documentType: "CPF",
              documentNumber: "",
              documentVerifiedByStaff: true,
              phone: stud.phone || "",
              signatureMode: "PENDING",
              signatureData: null,
              refusalReason: "",
              witnessName: "",
            },
          ]);
        } else {
          setParticipants([]);
        }
        setStep(2);
      } else {
        setSelectedStudentIds([]);
        setParticipants([]);
        setStep(1);
      }
    }
  }, [isOpen, existingMinute, preSelectedStudentId, availableStudents]);

  // Lista única de turmas para filtro
  const turmasList = useMemo(() => {
    const set = new Set<string>();
    availableStudents.forEach((s) => {
      if (s.classGroupName) set.add(s.classGroupName);
    });
    return Array.from(set).sort();
  }, [availableStudents]);

  // Alunos filtrados no passo 1
  const filteredStudents = useMemo(() => {
    const query = studentSearch.toLowerCase().trim();
    return availableStudents.filter((s) => {
      const matchTurma =
        selectedTurmaFilter === "TODAS" || s.classGroupName === selectedTurmaFilter;
      if (!matchTurma) return false;

      if (!query) return true;
      const matchName = s.name.toLowerCase().includes(query);
      const matchCgm = s.cgm?.toLowerCase().includes(query);
      const matchGuardian = s.guardianName?.toLowerCase().includes(query);
      return matchName || matchCgm || matchGuardian;
    });
  }, [availableStudents, studentSearch, selectedTurmaFilter]);

  // Toggle de seleção do aluno
  const handleToggleStudent = (student: StudentOption) => {
    setStep1Error(null);
    const isSelected = selectedStudentIds.includes(student.id);
    let nextIds: string[];

    if (isSelected) {
      nextIds = selectedStudentIds.filter((id) => id !== student.id);
    } else {
      nextIds = [...selectedStudentIds, student.id];

      if (student.guardianName && !participants.some((p) => p.name === student.guardianName)) {
        setParticipants((prev) => [
          ...prev,
          {
            role: "RESPONSAVEL",
            name: student.guardianName,
            kinship: "Mãe/Pai",
            documentType: "CPF",
            documentNumber: "",
            documentVerifiedByStaff: true,
            phone: student.phone || "",
            signatureMode: "PENDING",
            signatureData: null,
            refusalReason: "",
            witnessName: "",
          },
        ]);
      }
    }
    setSelectedStudentIds(nextIds);
  };

  // Polling para detectar assinatura no celular via QR Code
  useEffect(() => {
    if (!qrModalInfo || !minuteId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/atas/${minuteId}`);
        const data = await res.json();
        if (data.minute?.participants) {
          setParticipants(data.minute.participants);
          const currentPart = data.minute.participants.find(
            (p: any) => p.name === qrModalInfo.name || p.signatureData || p.verifiedEmail
          );
          if (currentPart?.signatureData || currentPart?.verifiedEmail) {
            setQrModalInfo(null);
          }
        }
      } catch (err) {
        console.warn("Polling de assinatura falhou:", err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [qrModalInfo, minuteId]);

  // Ditado por voz nativo pt-BR
  const toggleSpeechRecognition = () => {
    setAiError(null);
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setAiError("Seu navegador não possui suporte para reconhecimento de voz nativo.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "pt-BR";
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript + " ";
        }
        setRawNotes((prev: string) => (prev ? `${prev}\n${transcript.trim()}` : transcript.trim()));
      };

      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  // Formalização e Revisão com Diretrizes NRE/SEED-PR
  const handleFormalizeWithAi = async () => {
    setAiError(null);
    setAiSuccessMsg(null);
    const hasNotes = Boolean(rawNotes && rawNotes.trim().length >= 3);
    const hasExistingSummary = Boolean(summary && summary.trim().length >= 5);

    if (!hasNotes && !hasExistingSummary) {
      setAiError("Digite anotações no quadro acima ou insira um texto para revisão.");
      return;
    }

    setIsAiLoading(true);
    try {
      const studentNames = availableStudents
        .filter((s) => selectedStudentIds.includes(s.id))
        .map((s) => s.name);
      const guardianNames = participants.map((p) => p.name).filter(Boolean);

      const savedKey =
        geminiApiKey.trim() ||
        (typeof window !== "undefined" ? localStorage.getItem("leopoldina_gemini_api_key")?.trim() : "") ||
        "";

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (savedKey && savedKey.length > 10) {
        headers["x-gemini-key"] = savedKey;
      }

      const res = await fetch("/api/ai/formalize-ata", {
        method: "POST",
        headers,
        body: JSON.stringify({
          rawNotes: rawNotes.trim(),
          existingSummary: summary.trim(),
          category,
          studentNames,
          guardianNames,
          apiKey: savedKey || undefined,
        }),
      });

      const rawText = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          `Servidor retornou resposta inválida (HTTP ${res.status}). Verifique a conexão com a IA.`
        );
      }

      if (!res.ok) throw new Error(data?.error || "Erro ao revisar minuta");

      if (data.result) {
        if (data.result.formalSubject) setSubject(data.result.formalSubject);
        if (data.result.formalSummary) setSummary(data.result.formalSummary);
        if (data.result.agreementsSummary) setAgreementsSummary(data.result.agreementsSummary);

        if (data.result.actionItems && data.result.actionItems.length > 0) {
          const suggested = data.result.actionItems.map((a: any) => {
            let dueDate = "";
            if (a.suggestedDaysToComplete) {
              const d = new Date();
              d.setDate(d.getDate() + a.suggestedDaysToComplete);
              dueDate = d.toISOString().slice(0, 10);
            }
            return {
              description: a.description,
              responsible: a.responsible || "FAMILIA",
              dueDate,
            };
          });
          setActionItems(suggested);
        }

        if (data.usedFallback) {
          setAiSuccessMsg({
            type: "warning",
            text: `${data.fallbackReason || "Aviso:"} Minuta estruturada pelo modelo padrão local. Para correção ortográfica, sintaxe e redação pedagógica por IA, configure sua chave do Google Gemini no botão 'Configurar Chave IA' acima.`,
          });
          if (!savedKey) {
            setShowKeyModal(true);
          }
        } else {
          setAiSuccessMsg({
            type: "success",
            text: "Texto formalizado e revisado com sucesso pelo Google Gemini segundo as normas do NRE/SEED-PR.",
          });
          setTimeout(() => setAiSuccessMsg(null), 5000);
        }
      }
    } catch (err: any) {
      setAiError(err.message || "Erro ao formalizar e revisar minuta.");
    } finally {
      setIsAiLoading(false);
    }
  };

  // Monta payload limpo e higienizado para envio à API
  const buildSanitizedPayload = () => {
    const cleanSubject = subject.trim().length >= 2 ? subject.trim() : "Atendimento Pedagógico";

    const cleanParticipants = participants
      .filter((p) => p && (p.name?.trim() || p.signatureData || p.signatureMode === "REFUSED" || p.id))
      .map((p) => {
        const trimmedName = (p.name || "").trim();
        return {
          ...p,
          name: trimmedName.length >= 2 ? trimmedName : "Responsável Presente",
        };
      });

    const cleanActions = actionItems
      .filter((a) => a && typeof a.description === "string" && a.description.trim().length >= 2)
      .map((a) => ({
        ...a,
        description: a.description.trim(),
        dueDate: a.dueDate && String(a.dueDate).trim() !== "" ? a.dueDate : null,
      }));

    return {
      category,
      isConfidential,
      subject: cleanSubject,
      rawNotes,
      summary,
      agreementsSummary,
      studentIds: selectedStudentIds,
      participants: cleanParticipants,
      actionItems: cleanActions,
    };
  };

  // Função interna de persistência de rascunho (sem interferir em estados de loading externos)
  const saveDraftInternal = async () => {
    const payload = buildSanitizedPayload();
    const targetId = minuteId || existingMinute?.id;
    const url = targetId ? `/api/atas/${targetId}` : "/api/atas";
    const method = targetId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Erro ao salvar rascunho da ata.");
    }

    if (data.minute?.id) {
      setMinuteId(data.minute.id);
      if (data.minute.participants) {
        setParticipants(data.minute.participants);
      }
    }

    return data.minute;
  };

  // Botão "Salvar Rascunho"
  const handleSaveDraft = async () => {
    if (selectedStudentIds.length === 0) {
      setStep(1);
      setStep1Error("Selecione pelo menos um estudante para vincular a esta ata.");
      return null;
    }

    setSaving(true);
    setFinalizeError(null);
    setDraftSavedMsg(null);
    try {
      const saved = await saveDraftInternal();
      setDraftSavedMsg("Rascunho salvo com sucesso!");
      onSaved();
      setTimeout(() => setDraftSavedMsg(null), 4000);
      return saved;
    } catch (err: any) {
      setFinalizeError(err.message || "Erro ao salvar rascunho.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Botão "Lavrar Ata Oficial (Imutável)" — direto, sem window.confirm bloqueável
  const handleFinalize = async () => {
    setFinalizeError(null);
    setDraftSavedMsg(null);

    if (selectedStudentIds.length === 0) {
      setStep(1);
      setStep1Error("Selecione pelo menos um estudante antes de lavrar a ata.");
      return;
    }

    if (!summary || summary.trim().length < 10) {
      if (rawNotes && rawNotes.trim().length >= 10) {
        setFinalizeError(
          'O campo "Texto Formal da Ata" está vazio. Clique em "Formalizar com IA" acima para gerar o texto oficial a partir das suas notas rápidas, ou digite o texto formal diretamente.'
        );
      } else {
        setFinalizeError(
          "É necessário preencher o Texto Formal da Ata (mínimo de 10 caracteres) antes da lavratura oficial."
        );
      }
      return;
    }

    setSavingFinal(true);
    try {
      let targetId = minuteId || existingMinute?.id;

      // Se a ata ainda não foi criada no banco, cria o rascunho inicial primeiro
      if (!targetId) {
        const created = await saveDraftInternal();
        if (!created?.id) {
          throw new Error("Não foi possível registrar os dados iniciais da ata.");
        }
        targetId = created.id;
      }

      // Envia o payload atualizado direto para o endpoint atômico de lavratura oficial
      const payload = buildSanitizedPayload();
      const res = await fetch(`/api/atas/${targetId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao lavrar ata oficial no servidor.");
      }

      setFinalizedAta(data.minute);
      onSaved();
    } catch (err: any) {
      console.error("[handleFinalize] Erro:", err);
      setFinalizeError(err.message || "Erro inesperado ao lavrar ata.");
    } finally {
      setSavingFinal(false);
    }
  };

  // Gerar QR Code ou Link remoto para participante assinar
  const handleGenerateMobileSign = async (index: number, durationMinutes = signDurationOption) => {
    setFinalizeError(null);
    if (selectedStudentIds.length === 0) {
      setFinalizeError("Vincule pelo menos um estudante antes de gerar o link de assinatura.");
      return;
    }

    setSaving(true);
    try {
      // Sempre sincroniza o rascunho para garantir que o participante exista no banco
      const saved = await saveDraftInternal();
      if (!saved) return;

      const currentLocal = participants[index];
      const part = saved.participants?.[index] || saved.participants?.find((p: any) => p.name === currentLocal?.name);
      if (!part?.id) {
        throw new Error("Informe o nome do participante antes de gerar o link de assinatura.");
      }

      const res = await fetch(`/api/atas/${saved.id}/sign-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: part.id,
          expiresInMinutes: durationMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao gerar token de assinatura");

      setMinuteId(saved.id);
      setQrModalInfo({
        url: data.signUrl,
        name: part.name,
        expiresInMinutes: durationMinutes,
        participantRole: currentLocal?.role || "PARTICIPANTE",
      });
      onSaved();
    } catch (err: any) {
      setFinalizeError(err.message || "Erro ao gerar link de assinatura móvel.");
    } finally {
      setSaving(false);
    }
  };

  // Atalho de 1 clique: Incluir Estudante(s) selecionados como participante(s) da ata
  const handleAddSelectedStudentsAsParticipants = () => {
    const selected = availableStudents.filter((s) => selectedStudentIds.includes(s.id));
    if (selected.length === 0) return;

    setParticipants((prev) => {
      const copy = [...prev];
      selected.forEach((stu) => {
        const alreadyExists = copy.some(
          (p) => p.studentId === stu.id || (p.name.trim().toLowerCase() === stu.name.trim().toLowerCase() && p.role === "ESTUDANTE")
        );
        if (!alreadyExists) {
          copy.push({
            role: "ESTUDANTE",
            studentId: stu.id,
            name: stu.name,
            kinship: null,
            documentType: "CGM",
            documentNumber: stu.cgm || "",
            documentVerifiedByStaff: true,
            phone: stu.phone || "",
            expectedEmail: stu.email || null,
            signatureMode: "PENDING",
            signatureData: null,
            refusalReason: "",
            witnessName: "",
          });
        }
      });
      return copy;
    });
  };

  // Handlers de Ata Já Lavrada (Adendo, Status de Ação, Tornar Sem Efeito)
  const handleAddAddendum = async () => {
    if (!viewMinuteData?.id) return;
    if (addendumText.trim().length < 5) {
      setPostFinalizeMsg({ type: "err", text: "O texto do aditamento deve ter pelo menos 5 caracteres." });
      return;
    }

    setSavingAddendum(true);
    setPostFinalizeMsg(null);
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}/addendums`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: addendumText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao registrar aditamento");

      setViewMinuteData((prev: any) => ({
        ...prev,
        addendums: [...(prev.addendums || []), data.addendum],
      }));
      setAddendumText("");
      setPostFinalizeMsg({ type: "ok", text: 'Termo de aditamento ("Em tempo") registrado e selado com sucesso!' });
      onSaved();
    } catch (err: any) {
      setPostFinalizeMsg({ type: "err", text: err.message || "Erro ao salvar adendo." });
    } finally {
      setSavingAddendum(false);
    }
  };

  const handleToggleActionStatus = async (actionItem: any) => {
    if (!viewMinuteData?.id || !actionItem?.id) return;
    const nextStatus = actionItem.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}/actions/${actionItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setViewMinuteData((prev: any) => ({
        ...prev,
        actionItems: prev.actionItems.map((a: any) => (a.id === actionItem.id ? data.actionItem : a)),
      }));
      onSaved();
    } catch (err: any) {
      setPostFinalizeMsg({ type: "err", text: err.message || "Erro ao atualizar encaminhamento." });
    }
  };

  const handleVoidMinute = async () => {
    if (!viewMinuteData?.id) return;
    if (voidReason.trim().length < 10) {
      setPostFinalizeMsg({
        type: "err",
        text: "A justificativa para tornar a ata sem efeito deve ter no mínimo 10 caracteres.",
      });
      return;
    }

    setSavingVoid(true);
    setPostFinalizeMsg(null);
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao tornar ata sem efeito");

      setViewMinuteData((prev: any) => ({
        ...prev,
        status: "VOIDED",
        voidReason: voidReason.trim(),
        voidedAt: data.minute.voidedAt,
        voidedByName: data.minute.voidedByName,
      }));
      setShowVoidForm(false);
      setPostFinalizeMsg({ type: "ok", text: "Averbação de cancelamento registrada no Livro Oficial." });
      onSaved();
    } catch (err: any) {
      setPostFinalizeMsg({ type: "err", text: err.message || "Erro ao cancelar ata." });
    } finally {
      setSavingVoid(false);
    }
  };

  const handleAdminDelete = async () => {
    if (!viewMinuteData?.id) return;
    setIsDeletingAdmin(true);
    try {
      const res = await fetch(`/api/atas/${viewMinuteData.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao excluir ata");
      setShowAdminDeleteConfirm(false);
      onSaved();
      onClose();
    } catch (err: any) {
      setPostFinalizeMsg({ type: "err", text: err.message || "Erro ao excluir ata pelo Administrador." });
    } finally {
      setIsDeletingAdmin(false);
    }
  };

  // ============================================================================
  // TELA A: CELEBRAÇÃO DE ATA RECÉM-LAVRADA COM SUCESSO
  // ============================================================================
  if (finalizedAta) {
    const cleanNum = String(finalizedAta.ataNumber).padStart(3, "0");
    const cleanYear = finalizedAta.year;

    return (
      <AtaDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Ata Pedagógica Lavrada com Sucesso"
        maxWidthClass="max-w-3xl"
      >
        <div className="text-center py-6 space-y-5">
          <div className="flex items-center justify-center space-x-3 mx-auto">
            <div className="w-14 h-14 shrink-0 flex items-center justify-center">
              <img
                src="/logo.svg"
                alt="Brasão do Colégio"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
              <FileCheck2 className="w-7 h-7" />
            </div>
          </div>

          <div>
            <span className="inline-block px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-extrabold border border-emerald-200 uppercase tracking-wide">
              Documento Oficial Registrado no Livro {cleanYear}
            </span>
            <h3 className="text-3xl font-black text-slate-900 mt-2">
              Ata Pedagógica nº {cleanNum}/{cleanYear}
            </h3>
            {finalizedAta.finalizedAt && (
              <p className="text-xs font-extrabold text-emerald-800 mt-1">
                Lavrada em {new Date(finalizedAta.finalizedAt).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} às {new Date(finalizedAta.finalizedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            )}
            <p className="text-xs text-slate-500 font-mono mt-1">
              Código Público de Validação: <strong>{finalizedAta.verificationCode}</strong>
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left text-xs space-y-2 max-w-2xl mx-auto">
            <p className="font-bold text-slate-700 flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Selo de Integridade Criptográfica (SHA-256 — Lei nº 14.063/2020):</span>
            </p>
            <p className="font-mono text-[11px] text-slate-700 break-all bg-white p-3 rounded-xl border border-slate-200">
              {finalizedAta.contentHash}
            </p>
            <p className="text-xs text-slate-500">
              Lavrado com fé pública por <strong>{finalizedAta.authorName}</strong> em{" "}
              {new Date(finalizedAta.finalizedAt).toLocaleString("pt-BR")}.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href={`/atas/${finalizedAta.id}/imprimir`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition shadow-sm"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span>Imprimir / Salvar PDF Oficial A4</span>
            </a>

            {finalizedAta.agreementsSummary && (
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `*Colégio Estadual Leopoldina B. Pedroso*\n*Comprovante de Atendimento Pedagógico — Ata nº ${cleanNum}/${cleanYear}*\n\nPrezada família, confirmamos o atendimento realizado nesta data. Seguem os combinados firmados:\n\n${finalizedAta.agreementsSummary}\n\nPara verificar a autenticidade deste documento oficial, acesse: ${typeof window !== "undefined" ? window.location.origin : ""}/validar/ata/${finalizedAta.verificationCode}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-sm"
              >
                <Share2 className="w-4 h-4" />
                <span>Enviar Combinados via WhatsApp</span>
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-extrabold transition cursor-pointer"
            >
              Concluir e Fechar
            </button>
          </div>
        </div>
      </AtaDialog>
    );
  }

  // ============================================================================
  // TELA B: CONSULTA DE ATA JÁ LAVRADA (IMUTÁVEL) + ADENDOS ("EM TEMPO")
  // ============================================================================
  if (viewMinuteData) {
    const cleanNum = String(viewMinuteData.ataNumber || 0).padStart(3, "0");
    const isVoid = viewMinuteData.status === "VOIDED";

    return (
      <AtaDialog
        isOpen={isOpen}
        onClose={onClose}
        title={
          isVoid
            ? `Ata Pedagógica nº ${cleanNum}/${viewMinuteData.year} (Tornada Sem Efeito)`
            : `Ata Pedagógica nº ${cleanNum}/${viewMinuteData.year} — Documento Oficial Imutável`
        }
        description="Registro selado criptograficamente (SHA-256). Conforme a Lei nº 14.063/2020, o texto original é inalterável, admitindo-se apenas Termos de Aditamento ('Em tempo')."
      >
        <div className="space-y-5 text-xs">
          {isVoid && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 space-y-1">
              <p className="font-black text-sm flex items-center space-x-1.5">
                <Ban className="w-4 h-4 text-rose-600" />
                <span>ATA TORNADA SEM EFEITO POR AVERBAÇÃO OFICIAL</span>
              </p>
              <p>
                <strong>Motivo:</strong> {viewMinuteData.voidReason}
              </p>
              {viewMinuteData.voidedByName && (
                <p className="text-[11px] text-rose-600">
                  Averbado por {viewMinuteData.voidedByName} em{" "}
                  {viewMinuteData.voidedAt ? new Date(viewMinuteData.voidedAt).toLocaleString("pt-BR") : ""}
                </p>
              )}
            </div>
          )}

          {postFinalizeMsg && (
            <div
              className={`p-3.5 rounded-2xl border flex items-center space-x-2 ${
                postFinalizeMsg.type === "ok"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              {postFinalizeMsg.type === "ok" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="font-bold">{postFinalizeMsg.text}</span>
            </div>
          )}

          <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
            {/* Coluna Esquerda: Texto Oficial + Adendos */}
            <div className="lg:col-span-7 space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Assunto / Pauta</span>
                    <h3 className="text-base font-black text-slate-900">{viewMinuteData.subject}</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-mono text-[11px] font-bold text-slate-700">
                    {viewMinuteData.verificationCode}
                  </span>
                </div>

                <div className="p-4 bg-white border border-slate-200 rounded-xl font-serif text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
                  {viewMinuteData.summary}
                </div>

                {viewMinuteData.agreementsSummary && (
                  <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-xl">
                    <span className="font-extrabold text-sky-900 block mb-0.5">Síntese dos Combinados:</span>
                    <p className="text-slate-700">{viewMinuteData.agreementsSummary}</p>
                  </div>
                )}

                <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200 flex flex-wrap justify-between gap-2">
                  <span>
                    Lavrada por: <strong>{viewMinuteData.authorName}</strong> ({viewMinuteData.authorEmail})
                  </span>
                  <span>
                    Lavratura:{" "}
                    <strong>
                      {viewMinuteData.finalizedAt
                        ? `${new Date(viewMinuteData.finalizedAt).toLocaleDateString("pt-BR")} às ${new Date(viewMinuteData.finalizedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                        : `${new Date(viewMinuteData.attendedAt).toLocaleDateString("pt-BR")} às ${new Date(viewMinuteData.attendedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Termos de Aditamento ("Em tempo") */}
              <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3">
                <h4 className="font-extrabold text-slate-900 text-sm flex items-center space-x-1.5">
                  <FilePlus2 className="w-4 h-4 text-sky-600" />
                  <span>Termos de Aditamento / Retificação (&quot;Em tempo&quot;)</span>
                </h4>

                {viewMinuteData.addendums?.length > 0 ? (
                  <div className="space-y-2.5">
                    {viewMinuteData.addendums.map((add: any, i: number) => (
                      <div key={add.id || i} className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl space-y-1">
                        <p className="font-serif text-slate-800 text-xs leading-relaxed">
                          <strong>Em tempo ({i + 1}):</strong> {add.content}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          Por {add.authorName} em {new Date(add.createdAt).toLocaleString("pt-BR")} • Hash:{" "}
                          {add.addendumHash?.slice(0, 20)}...
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">Nenhum termo de aditamento registrado nesta ata.</p>
                )}

                {!isVoid && (
                  <div className="pt-2 space-y-2 border-t border-slate-100">
                    <label className="font-bold text-slate-700 block">
                      Lavrar novo adendo (&quot;Em tempo&quot;) sem alterar o texto original:
                    </label>
                    <textarea
                      rows={2}
                      value={addendumText}
                      onChange={(e) => setAddendumText(e.target.value)}
                      placeholder="Ex.: Em tempo, retifica-se o prazo de entrega do atestado médico para o dia..."
                      className="w-full p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white text-slate-800"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddAddendum}
                        disabled={savingAddendum}
                        className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        {savingAddendum ? "Registrando adendo..." : "Registrar Termo de Aditamento"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Coluna Direita: Alunos, Assinaturas, Encaminhamentos e Ações */}
            <div className="lg:col-span-5 space-y-4 mt-4 lg:mt-0">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <h4 className="font-extrabold text-slate-900 text-sm">Estudante(s) & Presentes</h4>
                <div className="flex flex-wrap gap-1.5">
                  {viewMinuteData.students?.map((s: any) => (
                    <span
                      key={s.studentId}
                      className="px-2.5 py-1 rounded-lg bg-sky-100 text-sky-900 font-bold text-xs"
                    >
                      {s.studentNameSnapshot} {s.classNameSnapshot ? `(${s.classNameSnapshot})` : ""}
                    </span>
                  ))}
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200">
                  {viewMinuteData.participants?.map((p: any, i: number) => (
                    <div
                      key={p.id || i}
                      className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2"
                    >
                      <div>
                        <p className="font-bold text-slate-900">{p.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {p.role} {p.documentNumber ? `• Doc: ${p.documentNumber}` : ""}
                          {p.verifiedEmail ? ` • ${p.verifiedEmail}` : ""}
                        </p>
                      </div>
                      {p.verifiedEmail ? (
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                          ✓ @escola.pr.gov.br
                        </span>
                      ) : p.signatureData ? (
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[11px]">
                          {p.biometricVerified ? "✓ Biometria" : "✓ Assinado"}
                        </span>
                      ) : p.signatureMode === "REFUSED" ? (
                        <span className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[11px]">
                          Recusa registrada
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-semibold text-[11px]">
                          Presença atestada
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Encaminhamentos */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
                <h4 className="font-extrabold text-slate-900 text-sm">Encaminhamentos & Prazos</h4>
                {viewMinuteData.actionItems?.length > 0 ? (
                  viewMinuteData.actionItems.map((act: any) => {
                    const done = act.status === "COMPLETED";
                    return (
                      <div
                        key={act.id}
                        className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2"
                      >
                        <div>
                          <p className={`font-bold ${done ? "line-through text-slate-400" : "text-slate-800"}`}>
                            {act.description}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Resp: {act.responsible}
                            {act.dueDate ? ` • Prazo: ${new Date(act.dueDate).toLocaleDateString("pt-BR")}` : ""}
                          </p>
                        </div>
                        {!isVoid && (
                          <button
                            type="button"
                            onClick={() => handleToggleActionStatus(act)}
                            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition ${
                              done
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-900 text-white hover:bg-slate-800"
                            }`}
                          >
                            {done ? "✓ Concluído" : "Concluir"}
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-slate-400 italic">Sem encaminhamentos pendentes.</p>
                )}
              </div>

              {/* Hash e Averbação de Cancelamento */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <span className="font-bold text-slate-700 block">Hash SHA-256 Original:</span>
                <p className="font-mono text-[10px] text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">
                  {viewMinuteData.contentHash}
                </p>

                {!isVoid && (
                  <div className="pt-2">
                    {!showVoidForm ? (
                      <button
                        type="button"
                        onClick={() => setShowVoidForm(true)}
                        className="text-rose-600 hover:text-rose-700 font-bold text-[11px] flex items-center space-x-1 cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Tornar esta Ata Sem Efeito (Averbação de Cancelamento)</span>
                      </button>
                    ) : (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2 mt-1">
                        <label className="font-bold text-rose-900 block">
                          Justificativa oficial para tornar a ata sem efeito (mín. 10 caracteres):
                        </label>
                        <textarea
                          rows={2}
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder="Informe o motivo administrativo/pedagógico..."
                          className="w-full p-2 border border-rose-300 rounded-lg bg-white text-slate-800"
                        />
                        <div className="flex justify-end space-x-2">
                          <button
                            type="button"
                            onClick={() => setShowVoidForm(false)}
                            className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleVoidMinute}
                            disabled={savingVoid}
                            className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50"
                          >
                            {savingVoid ? "Averbando..." : "Confirmar Cancelamento"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isAdmin && (
                  <div className="pt-2 border-t border-slate-200 mt-2">
                    {!showAdminDeleteConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowAdminDeleteConfirm(true)}
                        className="text-rose-600 hover:text-rose-700 font-bold text-[11px] flex items-center space-x-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir permanentemente do livro de registros (Administrador Geral)</span>
                      </button>
                    ) : (
                      <div className="p-3 bg-rose-100 border border-rose-300 rounded-xl space-y-2 mt-1">
                        <p className="text-xs font-bold text-rose-900">
                          ⚠️ Exclusão Permanente de Registro (Administrador Geral):
                        </p>
                        <p className="text-xs text-rose-800">
                          Esta ata ({viewMinuteData.ataNumber ? `Nº ${String(viewMinuteData.ataNumber).padStart(3, "0")}/${viewMinuteData.year}` : "Rascunho"}) e todos os seus participantes e assinaturas serão apagados em definitivo do banco de dados. Use esta ação para expurgar registros gerados em teste.
                        </p>
                        <div className="flex justify-end space-x-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setShowAdminDeleteConfirm(false)}
                            className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold cursor-pointer text-xs"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleAdminDelete}
                            disabled={isDeletingAdmin}
                            className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer disabled:opacity-50 text-xs"
                          >
                            {isDeletingAdmin ? "Excluindo..." : "Confirmar Exclusão Definitiva"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/atas/${viewMinuteData.id}/imprimir`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold transition"
              >
                <Printer className="w-4 h-4 text-amber-400" />
                <span>Imprimir / PDF Oficial A4</span>
              </a>
              {viewMinuteData.verificationCode && (
                <a
                  href={`/validar/ata/${viewMinuteData.verificationCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold transition"
                >
                  <ExternalLink className="w-4 h-4 text-sky-600" />
                  <span>Página de Validação Pública</span>
                </a>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-800 font-extrabold transition cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </AtaDialog>
    );
  }

  // ============================================================================
  // TELA C: EDITOR BIMODAL DE NOVA ATA OU RASCUNHO EM ABERTO
  // ============================================================================
  return (
    <AtaDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Lavratura de Ata do Atendimento Pedagógico"
      description="Substitui o caderno manuscrito com fé pública institucional, validade jurídica (Lei nº 14.063/2020) e integração ao Prontuário 360º."
      maxWidthClass="max-w-[98vw] 2xl:max-w-[1560px]"
    >
      <div className="space-y-5 text-xs">
        {/* WIZARD BIMODAL: NAVEGAÇÃO DE PASSOS */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                step === 1
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">
                1
              </span>
              <span>
                Alunos & Pauta ({selectedStudentIds.length} selecionado
                {selectedStudentIds.length !== 1 ? "s" : ""})
              </span>
            </button>

            <ArrowRight className="w-4 h-4 text-slate-300" />

            <button
              type="button"
              onClick={() => {
                if (selectedStudentIds.length === 0) {
                  setStep1Error("Selecione pelo menos um estudante no catálogo antes de avançar para a redação.");
                  return;
                }
                setStep1Error(null);
                setStep(2);
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                step === 2
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">
                2
              </span>
              <span>Redação Oficial & Assinaturas</span>
            </button>
          </div>

          <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
            Etapa {step} de 2
          </span>
        </div>

        {/* ============================================================== */}
        {/* ETAPA 1: SELEÇÃO AMPLA E BUSCA DE ALUNOS + PAUTA E CATEGORIA   */}
        {/* ============================================================== */}
        {step === 1 && (
          <div className="space-y-4">
            {step1Error && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center space-x-2 font-bold">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{step1Error}</span>
              </div>
            )}

            <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
              {/* COLUNA ESQUERDA: DADOS DA PAUTA + ESTUDANTES VINCULADOS (5 colunas) */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <div className="space-y-1">
                    <label className="font-extrabold text-slate-900 block text-sm">
                      Assunto / Pauta do Atendimento:
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Ex.: Comparecimento da família para alinhamento pedagógico e faltas"
                      className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800 text-sm focus:outline-sky-500 shadow-2xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700 block text-xs">
                      Natureza / Categoria da Ata:
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800 text-sm shadow-2xs"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-1">
                    <label className="flex items-center space-x-2.5 cursor-pointer p-2.5 rounded-xl bg-rose-50/70 border border-rose-200">
                      <input
                        type="checkbox"
                        checked={isConfidential}
                        onChange={(e) => setIsConfidential(e.target.checked)}
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="font-bold text-rose-800 text-xs flex items-center space-x-1.5">
                        <Lock className="w-3.5 h-3.5 text-rose-600" />
                        <span>Sigilo Reforçado (ECA / Proteção à Intimidade)</span>
                      </span>
                    </label>
                  </div>
                </div>

                {/* Card de Alunos Vinculados */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-900 text-sm flex items-center space-x-1.5">
                      <Users className="w-4 h-4 text-sky-600" />
                      <span>Alunos Vinculados nesta Ata</span>
                    </span>
                    <span className="text-xs font-black px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800">
                      {selectedStudentIds.length} selecionado{selectedStudentIds.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {selectedStudentIds.length === 0 ? (
                    <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                      Nenhum estudante selecionado ainda.
                      <br />
                      Pesquise e clique nos estudantes no catálogo ao lado para vinculá-los.
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                      {selectedStudentIds.map((id) => {
                        const s = availableStudents.find((item) => item.id === id);
                        if (!s) return null;
                        return (
                          <div
                            key={id}
                            className="flex items-center justify-between p-2.5 bg-sky-50/60 border border-sky-200 rounded-xl"
                          >
                            <div>
                              <p className="font-extrabold text-sky-950 text-xs">{s.name}</p>
                              <p className="text-[11px] text-sky-700">
                                Turma: {s.classGroupName || "Sem Turma"} {s.cgm ? `• CGM: ${s.cgm}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleToggleStudent(s)}
                              className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-white transition cursor-pointer"
                              title="Remover estudante"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedStudentIds.length === 0) {
                        setStep1Error("Selecione pelo menos um estudante antes de avançar.");
                        return;
                      }
                      setStep1Error(null);
                      setStep(2);
                    }}
                    disabled={selectedStudentIds.length === 0}
                    className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white font-extrabold text-xs transition shadow-2xs flex items-center justify-center space-x-2 cursor-pointer mt-2"
                  >
                    <span>Avançar para Redação & Assinatura</span>
                    <ArrowRight className="w-4 h-4 text-sky-400" />
                  </button>
                </div>
              </div>

              {/* COLUNA DIREITA: CATÁLOGO DE BUSCA E SELEÇÃO DE ALUNOS (7 colunas) */}
              <div className="lg:col-span-7 space-y-3 mt-4 lg:mt-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-sm">
                      Catálogo Geral de Alunos da Escola
                    </h3>
                    <p className="text-xs text-slate-500">
                      Encontre e marque os alunos. Suporta múltiplos alunos em atas conjuntas.
                    </p>
                  </div>
                  <span className="text-xs text-slate-600 font-medium">
                    Exibindo <strong>{filteredStudents.length}</strong> de {availableStudents.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-8 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      placeholder="Pesquisar por nome do aluno, CGM ou responsável..."
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="w-full pl-9 pr-8 py-2.5 border border-slate-300 rounded-xl bg-white font-medium text-slate-800 focus:outline-sky-500 text-sm shadow-2xs"
                    />
                    {studentSearch && (
                      <button
                        type="button"
                        onClick={() => setStudentSearch("")}
                        className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="sm:col-span-4">
                    <select
                      value={selectedTurmaFilter}
                      onChange={(e) => setSelectedTurmaFilter(e.target.value)}
                      className="w-full py-2.5 px-3 border border-slate-300 rounded-xl bg-white font-semibold text-slate-700 text-sm shadow-2xs"
                    >
                      <option value="TODAS">Todas as Turmas ({availableStudents.length})</option>
                      {turmasList.map((t) => (
                        <option key={t} value={t}>
                          Turma: {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white h-[460px] overflow-y-auto divide-y divide-slate-100 shadow-2xs">
                  {filteredStudents.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 text-sm">
                      Nenhum estudante encontrado para os termos pesquisados.
                    </div>
                  ) : (
                    filteredStudents.map((s) => {
                      const isSelected = selectedStudentIds.includes(s.id);
                      return (
                        <div
                          key={s.id}
                          onClick={() => handleToggleStudent(s)}
                          className={`p-3.5 flex items-center justify-between cursor-pointer transition select-none ${
                            isSelected
                              ? "bg-sky-50/90 border-l-4 border-l-sky-600"
                              : "hover:bg-slate-50/80 text-slate-700"
                          }`}
                        >
                          <div className="flex items-center space-x-3.5">
                            <div
                              className={`w-5 h-5 rounded-md border flex items-center justify-center transition shrink-0 ${
                                isSelected
                                  ? "bg-sky-600 border-sky-600 text-white"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>

                            <div>
                              <div className="flex items-center space-x-2">
                                <p className="text-sm font-extrabold text-slate-900">{s.name}</p>
                                {s.classGroupName && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold">
                                    {s.classGroupName}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {s.cgm ? <span className="font-mono mr-2">CGM: {s.cgm}</span> : null}
                                {s.guardianName ? (
                                  <span>
                                    Resp: <strong className="text-slate-600">{s.guardianName}</strong>
                                  </span>
                                ) : null}
                              </p>
                            </div>
                          </div>

                          {isSelected ? (
                            <span className="text-xs font-black uppercase px-2.5 py-1 rounded-lg bg-sky-100 text-sky-800">
                              Vinculado
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 hover:text-sky-600 font-medium">
                              + Vincular
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 text-xs transition cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => {
                  if (selectedStudentIds.length === 0) {
                    setStep1Error("Selecione pelo menos um estudante antes de avançar.");
                    return;
                  }
                  setStep1Error(null);
                  setStep(2);
                }}
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs transition shadow-sm flex items-center space-x-2 cursor-pointer"
              >
                <span>Avançar para Redação & Assinatura</span>
                <ArrowRight className="w-4 h-4 text-sky-400" />
              </button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ETAPA 2: REDAÇÃO OFICIAL, IA, ENCAMINHAMENTOS E ASSINATURAS    */}
        {/* ============================================================== */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Barra de Resumo Topo */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                    Pauta e Aluno(s) Vinculados:
                  </span>
                  <p className="font-extrabold text-sm text-slate-900">
                    {subject || "Sem assunto"} •{" "}
                    <span className="text-sky-700 font-semibold">
                      {availableStudents
                        .filter((s) => selectedStudentIds.includes(s.id))
                        .map((s) => s.name)
                        .join(", ")}
                    </span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-sky-600 font-bold text-xs flex items-center space-x-1.5 cursor-pointer shadow-2xs"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Alterar alunos / pauta</span>
              </button>
            </div>

            <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
              {/* COLUNA ESQUERDA: IA, TEXTO FORMAL E COMBINADOS (6 colunas) */}
              <div className="lg:col-span-6 space-y-4">
                <div className="border border-sky-100 bg-sky-50/50 p-4 rounded-2xl space-y-2.5 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-extrabold text-sky-900 text-xs">
                      Redação & Diretrizes NRE/SEED-PR
                    </span>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={toggleSpeechRecognition}
                        className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition shadow-2xs cursor-pointer text-xs ${
                          isListening
                            ? "bg-rose-600 text-white animate-pulse"
                            : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {isListening ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5 text-sky-600" />
                        )}
                        <span>{isListening ? "Gravando voz..." : "Ditado por Voz"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowKeyModal(!showKeyModal)}
                        className={`inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition shadow-2xs cursor-pointer ${
                          hasServerKey
                            ? "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                            : geminiApiKey
                            ? "bg-sky-50 border-sky-300 text-sky-800 hover:bg-sky-100"
                            : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                        }`}
                        title="Status e configuração da IA Google Gemini"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>
                          {hasServerKey
                            ? "IA Ativa (Servidor)"
                            : geminiApiKey
                            ? "Chave IA Ativa"
                            : "Configurar IA"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleFormalizeWithAi}
                        disabled={isAiLoading}
                        className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition shadow-2xs disabled:opacity-50 cursor-pointer text-xs"
                      >
                        <span>{isAiLoading ? "Revisando..." : "Formalizar & Revisar"}</span>
                      </button>
                    </div>
                  </div>

                  {showKeyModal && (
                    <div className="p-3 bg-white border border-sky-300 rounded-xl space-y-2 shadow-sm text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-slate-800 flex items-center space-x-1.5">
                          <Key className="w-3.5 h-3.5 text-sky-600" />
                          <span>Chave da API Google Gemini</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowKeyModal(false)}
                          className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                      {hasServerKey ? (
                        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-[11px] font-medium flex items-center space-x-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>
                            A chave da API Gemini está configurada nas variáveis de ambiente do servidor (Vercel/.env) e ativa para toda a equipe. Não é necessário preencher nada abaixo.
                          </span>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          Informe sua chave do Google Gemini (gratuita em <code>aistudio.google.com</code>). Ela é salva no seu navegador e utilizada para corrigir erros ortográficos, concordância e sintaxe na formalização da ata.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={geminiApiKey}
                          onChange={(e) => handleSaveGeminiKey(e.target.value)}
                          placeholder="Cole sua chave AIzaSy..."
                          className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleTestGeminiKey}
                          disabled={isTestingApiKey || !geminiApiKey}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                        >
                          {isTestingApiKey ? "Testando..." : "Testar"}
                        </button>
                      </div>
                      {keyTestStatus && (
                        <p className={`text-[11px] font-bold ${keyTestStatus.ok ? "text-emerald-700" : "text-rose-600"}`}>
                          {keyTestStatus.msg}
                        </p>
                      )}
                    </div>
                  )}

                  {aiSuccessMsg && (
                    <div
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                        aiSuccessMsg.type === "warning"
                          ? "bg-amber-50 border-amber-200 text-amber-900"
                          : "bg-emerald-50 border-emerald-200 text-emerald-800"
                      }`}
                    >
                      <div className="flex items-center space-x-1.5">
                        {aiSuccessMsg.type === "warning" ? (
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        )}
                        <span className="font-semibold">{aiSuccessMsg.text}</span>
                      </div>
                      {aiSuccessMsg.type === "warning" && (
                        <button
                          type="button"
                          onClick={() => setShowKeyModal(true)}
                          className="px-2 py-0.5 bg-amber-700 text-white font-bold rounded-lg text-[10px] hover:bg-amber-800 shrink-0 cursor-pointer"
                        >
                          Configurar Chave
                        </button>
                      )}
                    </div>
                  )}

                  {aiError && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold text-xs flex items-center space-x-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{aiError}</span>
                    </div>
                  )}

                  <textarea
                    rows={3}
                    value={rawNotes}
                    onChange={(e) => setRawNotes(e.target.value)}
                    placeholder="Digite anotações rápidas ou use o ditado por voz. Clique em 'Formalizar & Revisar' para redigir ou aprimorar o texto nas normas cultas do NRE."
                    className="w-full p-2.5 border border-sky-200 rounded-xl bg-white text-slate-700 placeholder:text-slate-400 focus:outline-sky-500 text-xs shadow-2xs"
                  />
                </div>

                {/* Texto Formal da Ata */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-extrabold text-slate-900 block text-xs">
                      Texto Formal da Ata (Norma Culta / Diretrizes NRE): <span className="text-rose-600">*</span>
                    </label>
                    <span className="text-[11px] text-slate-400">Texto corrido contínuo e sem entrelinhas</span>
                  </div>
                  <textarea
                    rows={9}
                    value={summary}
                    onChange={(e) => {
                      setSummary(e.target.value);
                      if (finalizeError) setFinalizeError(null);
                    }}
                    placeholder="O texto formal da ata será gerado pela IA ou redigido diretamente aqui..."
                    className="w-full p-3.5 border border-slate-300 rounded-2xl bg-white text-slate-800 leading-relaxed font-serif text-sm focus:outline-slate-900 shadow-2xs"
                  />
                </div>

                {/* Síntese dos Combinados */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 block text-xs">
                    Síntese dos Combinados e Prazos Acordados:
                  </label>
                  <input
                    type="text"
                    value={agreementsSummary}
                    onChange={(e) => setAgreementsSummary(e.target.value)}
                    placeholder="Ex.: Responsável entregará atestado até sexta-feira e aluno realizará trabalhos de compensação."
                    className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-medium text-slate-800 text-xs shadow-2xs"
                  />
                </div>
              </div>

              {/* COLUNA DIREITA: ENCAMINHAMENTOS E PARTICIPANTES/ASSINATURAS (6 colunas) */}
              <div className="lg:col-span-6 space-y-4 mt-4 lg:mt-0">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-extrabold text-slate-800 block text-xs">
                        Encaminhamentos & Prazos da Ata:
                      </label>
                      <p className="text-[11px] text-slate-500">Alimenta os lembretes do Prontuário 360º</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setActionItems((prev) => [
                          ...prev,
                          { description: "", responsible: "FAMILIA", dueDate: "" },
                        ])
                      }
                      className="text-sky-600 hover:text-sky-700 font-bold flex items-center space-x-1 cursor-pointer text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-2xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Adicionar Ação</span>
                    </button>
                  </div>

                  {actionItems.length === 0 ? (
                    <div className="text-center py-3 text-slate-400 text-xs italic">
                      Nenhum encaminhamento registrado. Clique em &quot;+ Adicionar Ação&quot; se houver combinados com prazo.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {actionItems.map((act, idx) => (
                        <div
                          key={idx}
                          className="flex items-center space-x-2 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs"
                        >
                          <input
                            type="text"
                            placeholder="Descrição da ação pactuada..."
                            value={act.description}
                            onChange={(e) => {
                              const copy = [...actionItems];
                              copy[idx].description = e.target.value;
                              setActionItems(copy);
                            }}
                            className="flex-1 p-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                          />
                          <select
                            value={act.responsible}
                            onChange={(e) => {
                              const copy = [...actionItems];
                              copy[idx].responsible = e.target.value;
                              setActionItems(copy);
                            }}
                            className="p-1.5 border border-slate-300 rounded-lg bg-white font-semibold text-xs"
                          >
                            <option value="FAMILIA">Família</option>
                            <option value="ESTUDANTE">Estudante</option>
                            <option value="ESCOLA">Escola</option>
                            <option value="REDE_PROTECAO">Rede / CT</option>
                          </select>
                          <input
                            type="date"
                            value={act.dueDate}
                            onChange={(e) => {
                              const copy = [...actionItems];
                              copy[idx].dueDate = e.target.value;
                              setActionItems(copy);
                            }}
                            className="p-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setActionItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Participantes & Coleta de Assinatura */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="font-extrabold text-slate-800 block text-xs">
                        Presentes e Coleta de Assinatura:
                      </label>
                      <p className="text-[11px] text-slate-500">
                        A servidora logada assina eletronicamente com fé pública ao lavrar. Colha a assinatura dos demais abaixo.
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={handleAddSelectedStudentsAsParticipants}
                        className="text-emerald-700 hover:text-emerald-800 font-bold flex items-center space-x-1 cursor-pointer text-xs px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-lg shadow-2xs transition"
                        title="Adiciona automaticamente os alunos selecionados na Etapa 1 para assinarem a ata"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>+ Aluno(s) da Pauta</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setParticipants((prev) => [
                            ...prev,
                            {
                              role: "RESPONSAVEL",
                              name: "",
                              kinship: "Mãe/Pai",
                              documentType: "CPF",
                              documentNumber: "",
                              documentVerifiedByStaff: true,
                              phone: "",
                              signatureMode: "PENDING",
                              signatureData: null,
                              refusalReason: "",
                              witnessName: "",
                            },
                          ])
                        }
                        className="text-sky-600 hover:text-sky-700 font-bold flex items-center space-x-1 cursor-pointer text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-2xs"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Adicionar Presente</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {participants.map((p, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5 shadow-2xs"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                          <div className="md:col-span-4">
                            <select
                              value={p.role}
                              onChange={(e) => {
                                const copy = [...participants];
                                copy[idx].role = e.target.value;
                                setParticipants(copy);
                              }}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white font-semibold text-xs"
                            >
                              <option value="RESPONSAVEL">Responsável Legal</option>
                              <option value="ESTUDANTE">Estudante</option>
                              <option value="PROFESSOR">Professor(a)</option>
                              <option value="EQUIPE_ESCOLAR">Equipe Escolar</option>
                              <option value="REDE_EXTERNA">Rede de Proteção / CT</option>
                              <option value="TESTEMUNHA">Testemunha Presencial</option>
                            </select>
                          </div>

                          <div className="md:col-span-4">
                            <input
                              type="text"
                              placeholder="Nome completo..."
                              value={p.name}
                              onChange={(e) => {
                                const copy = [...participants];
                                copy[idx].name = e.target.value;
                                setParticipants(copy);
                              }}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white font-medium text-xs"
                            />
                          </div>

                          <div className="md:col-span-3">
                            <input
                              type="text"
                              placeholder="Nº Doc (CPF / RG)..."
                              value={p.documentNumber || ""}
                              onChange={(e) => {
                                const copy = [...participants];
                                copy[idx].documentNumber = e.target.value;
                                setParticipants(copy);
                              }}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white font-medium text-xs"
                            />
                          </div>

                          <div className="md:col-span-1 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => setParticipants((prev) => prev.filter((_, i) => i !== idx))}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded-md cursor-pointer"
                              title="Remover participante"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          <div className="flex items-center space-x-2">
                            <label className="flex items-center space-x-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(p.documentVerifiedByStaff)}
                                onChange={(e) => {
                                  const copy = [...participants];
                                  copy[idx].documentVerifiedByStaff = e.target.checked;
                                  setParticipants(copy);
                                }}
                                className="rounded border-slate-300 text-sky-600"
                              />
                              <span className="text-[11px] text-slate-600 font-medium">
                                Documento conferido presencialmente (Fé Pública)
                              </span>
                            </label>
                          </div>

                          <div className="flex items-center space-x-1.5">
                            {p.verifiedEmail || p.signatureData ? (
                              <div className="flex items-center space-x-1.5">
                                <span className="inline-flex items-center space-x-1 text-emerald-700 font-bold text-xs bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>
                                    {p.verifiedEmail
                                      ? `✓ @escola (${p.verifiedEmail})`
                                      : p.biometricVerified
                                      ? "✓ Assinado com Biometria"
                                      : "✓ Assinado Digitalmente"}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const copy = [...participants];
                                    copy[idx] = {
                                      ...copy[idx],
                                      signatureData: null,
                                      signatureMode: "PENDING",
                                      verifiedEmail: null,
                                      verifiedGoogleSub: null,
                                      verifiedGoogleName: null,
                                      biometricVerified: false,
                                      clearSignature: true,
                                    };
                                    setParticipants(copy);
                                  }}
                                  className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                                  title="Refazer assinatura"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : p.signatureMode === "REFUSED" ? (
                              <div className="flex items-center space-x-1.5">
                                <span className="inline-flex items-center space-x-1 text-rose-600 font-bold text-xs bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>Recusou-se a assinar</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const copy = [...participants];
                                    copy[idx] = {
                                      ...copy[idx],
                                      signatureMode: "PENDING",
                                      refusalReason: "",
                                      witnessName: "",
                                      clearSignature: true,
                                    };
                                    setParticipants(copy);
                                  }}
                                  className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                                  title="Cancelar recusa"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveRefusalIndex(null);
                                    setActiveSignParticipantIndex(
                                      activeSignParticipantIndex === idx ? null : idx
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-2xs transition cursor-pointer"
                                >
                                  Assinar na Tela
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleGenerateMobileSign(idx)}
                                  disabled={saving}
                                  className="px-2.5 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-xs transition flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                  <span>QR Celular (Biometria)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveSignParticipantIndex(null);
                                    setRefusalDraftReason(p.refusalReason || "");
                                    setRefusalDraftWitness(p.witnessName || "Equipe Pedagógica");
                                    setActiveRefusalIndex(activeRefusalIndex === idx ? null : idx);
                                  }}
                                  className="px-2 py-1 rounded-lg border border-rose-300 hover:bg-rose-50 text-rose-700 font-bold text-xs transition cursor-pointer"
                                >
                                  Recusa
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Formulário inline de Recusa (sem window.prompt!) */}
                        {activeRefusalIndex === idx && (
                          <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl space-y-2 mt-2">
                            <p className="font-bold text-rose-900 text-xs">
                              Registro de Recusa de Assinatura (com fé pública):
                            </p>
                            <input
                              type="text"
                              value={refusalDraftReason}
                              onChange={(e) => setRefusalDraftReason(e.target.value)}
                              placeholder="Motivo alegado para a recusa..."
                              className="w-full p-2 border border-rose-300 rounded-lg bg-white text-xs"
                            />
                            <input
                              type="text"
                              value={refusalDraftWitness}
                              onChange={(e) => setRefusalDraftWitness(e.target.value)}
                              placeholder="Nome da testemunha escolar presente..."
                              className="w-full p-2 border border-rose-300 rounded-lg bg-white text-xs"
                            />
                            <div className="flex justify-end space-x-2">
                              <button
                                type="button"
                                onClick={() => setActiveRefusalIndex(null)}
                                className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold text-xs cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const copy = [...participants];
                                  copy[idx] = {
                                    ...copy[idx],
                                    signatureMode: "REFUSED",
                                    signatureData: null,
                                    refusalReason: refusalDraftReason.trim() || "Recusou-se a assinar presencialmente",
                                    witnessName: refusalDraftWitness.trim() || "Equipe Pedagógica",
                                  };
                                  setParticipants(copy);
                                  setActiveRefusalIndex(null);
                                }}
                                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer"
                              >
                                Confirmar Termo de Recusa
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Canvas de Assinatura em tela */}
                        {activeSignParticipantIndex === idx && !p.signatureData && (
                          <div className="pt-2">
                            <SignatureCanvas
                              signerName={p.name || "Participante"}
                              onSave={(dataUrl) => {
                                const copy = [...participants];
                                copy[idx] = {
                                  ...copy[idx],
                                  signatureData: dataUrl,
                                  signatureMode: "SCREEN_CANVAS",
                                  clearSignature: false,
                                };
                                setParticipants(copy);
                                setActiveSignParticipantIndex(null);
                              }}
                              onClear={() => {
                                const copy = [...participants];
                                copy[idx] = {
                                  ...copy[idx],
                                  signatureData: null,
                                  signatureMode: "PENDING",
                                };
                                setParticipants(copy);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Painel de Assinatura Móvel: QR Code, Link Direto e WhatsApp */}
                {qrModalInfo && (
                  <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl space-y-3 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200/80 pb-2">
                      <div>
                        <h4 className="font-extrabold text-sky-950 text-sm">
                          Assinatura Digital de {qrModalInfo.name}
                        </h4>
                        <p className="text-[11px] text-sky-700">
                          {qrModalInfo.participantRole === "ESTUDANTE"
                            ? "O estudante pode assinar em 1 clique conectando sua conta @escola.pr.gov.br ou na tela do celular."
                            : "Aguardando assinatura em tempo real..."}
                        </p>
                      </div>

                      {/* Seletor de Validade do Token */}
                      <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-sky-200 text-xs">
                        <span className="text-[10px] text-slate-400 font-bold px-1.5 flex items-center space-x-1">
                          <Clock className="w-3 h-3 text-sky-600" />
                          <span>Validade:</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSignDurationOption(20);
                            const pIdx = participants.findIndex((p) => p.name === qrModalInfo.name);
                            if (pIdx >= 0) handleGenerateMobileSign(pIdx, 20);
                          }}
                          className={`px-2 py-0.5 rounded-lg font-bold text-[11px] cursor-pointer transition ${
                            qrModalInfo.expiresInMinutes === 20
                              ? "bg-sky-600 text-white"
                              : "text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          20 min (Presencial)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSignDurationOption(1440);
                            const pIdx = participants.findIndex((p) => p.name === qrModalInfo.name);
                            if (pIdx >= 0) handleGenerateMobileSign(pIdx, 1440);
                          }}
                          className={`px-2 py-0.5 rounded-lg font-bold text-[11px] cursor-pointer transition ${
                            qrModalInfo.expiresInMinutes === 1440
                              ? "bg-sky-600 text-white"
                              : "text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          24 horas (Remoto)
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      <div className="md:col-span-4 flex justify-center">
                        <div className="p-2 bg-white rounded-xl border border-sky-200 shadow-2xs">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
                              qrModalInfo.url
                            )}`}
                            alt="QR Code Assinatura"
                            className="w-32 h-32"
                          />
                        </div>
                      </div>

                      <div className="md:col-span-8 space-y-2.5">
                        <p className="text-xs text-slate-700 leading-relaxed">
                          Aponte a câmera do celular para o QR Code ao lado ou utilize os botões rápidos para compartilhar o link direto com o signatário:
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(qrModalInfo.url);
                              setCopyFeedback(true);
                              setTimeout(() => setCopyFeedback(false), 2500);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold text-xs shadow-2xs transition flex items-center space-x-1.5 cursor-pointer"
                          >
                            {copyFeedback ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700">Link Copiado!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-slate-500" />
                                <span>Copiar Link de Assinatura</span>
                              </>
                            )}
                          </button>

                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(
                              `Olá, ${qrModalInfo.name}! Segue o link oficial para ciência e assinatura digital do atendimento pedagógico no Colégio Leopoldina: ${qrModalInfo.url}`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-2xs transition flex items-center space-x-1.5 cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Enviar via WhatsApp</span>
                          </a>

                          <a
                            href={qrModalInfo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-2xs transition flex items-center space-x-1.5 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Abrir em Nova Aba</span>
                          </a>
                        </div>

                        <p className="text-[10px] text-slate-500 font-mono break-all bg-white p-2 rounded-lg border border-sky-100">
                          {qrModalInfo.url}
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setQrModalInfo(null)}
                        className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer transition"
                      >
                        Fechar Painel de Assinatura
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Feedback de Rascunho Salvo */}
            {draftSavedMsg && (
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center space-x-2 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{draftSavedMsg}</span>
              </div>
            )}

            {/* Aviso de Erro Visual na Lavratura */}
            {finalizeError && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="font-bold text-xs">Atenção antes de lavrar a ata:</strong>
                  <p className="text-xs leading-relaxed">{finalizeError}</p>
                </div>
              </div>
            )}

            {/* Barra de Ações Inferior da Etapa 2 */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 text-xs transition flex items-center space-x-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar aos Alunos</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-slate-500 hover:text-slate-800 font-medium text-xs transition cursor-pointer"
                >
                  Fechar
                </button>
              </div>

              <div className="flex items-center space-x-2.5">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving || savingFinal}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Salvando rascunho..." : "Salvar Rascunho"}
                </button>

                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={saving || savingFinal}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition shadow-sm disabled:opacity-50 flex items-center space-x-2 cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4 text-emerald-200" />
                  <span>{savingFinal ? "Lavrando Ata Oficial..." : "Lavrar Ata Oficial (Imutável)"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AtaDialog>
  );
}
