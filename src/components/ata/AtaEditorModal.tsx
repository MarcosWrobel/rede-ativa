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
  Filter,
  ArrowRight,
  ArrowLeft,
  X,
  Check,
  Calendar,
} from "lucide-react";

interface StudentOption {
  id: string;
  name: string;
  classGroupName?: string;
  cgm?: string | null;
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
}: Props) {
  // Controle de Etapa do Bimodal:
  // Step 1: Seleção de Estudantes, Turmas e Natureza
  // Step 2: Redação Assistida por IA, Encaminhamentos e Assinaturas
  const [step, setStep] = useState<1 | 2>(1);

  // Filtros de Pesquisa de Alunos (Passo 1)
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedTurmaFilter, setSelectedTurmaFilter] = useState("TODAS");

  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(() => {
    if (existingMinute?.students) {
      return existingMinute.students.map((s: any) => s.studentId);
    }
    return preSelectedStudentId ? [preSelectedStudentId] : [];
  });

  const [category, setCategory] = useState(
    existingMinute?.category || "ACOMPANHAMENTO_PEDAGOGICO"
  );
  const [isConfidential, setIsConfidential] = useState(
    existingMinute?.isConfidential || false
  );
  const [subject, setSubject] = useState(
    existingMinute?.subject || "Atendimento Pedagógico e Alinhamento de Frequência"
  );
  const [rawNotes, setRawNotes] = useState(existingMinute?.rawNotes || "");
  const [summary, setSummary] = useState(existingMinute?.summary || "");
  const [agreementsSummary, setAgreementsSummary] = useState(
    existingMinute?.agreementsSummary || ""
  );

  // Participantes
  const [participants, setParticipants] = useState<any[]>(() => {
    if (existingMinute?.participants && existingMinute.participants.length > 0) {
      return existingMinute.participants;
    }
    const stud = availableStudents.find((s) => s.id === preSelectedStudentId);
    if (stud?.guardianName) {
      return [
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
      ];
    }
    return [];
  });

  // Encaminhamentos
  const [actionItems, setActionItems] = useState<any[]>(() => {
    if (existingMinute?.actionItems) {
      return existingMinute.actionItems.map((a: any) => ({
        description: a.description,
        responsible: a.responsible,
        dueDate: a.dueDate ? a.dueDate.slice(0, 10) : "",
      }));
    }
    return [];
  });

  // Estados de IA, Gravação e Salvamento
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeSignParticipantIndex, setActiveSignParticipantIndex] = useState<number | null>(null);
  const [qrModalInfo, setQrModalInfo] = useState<{ url: string; name: string } | null>(null);
  const [finalizedAta, setFinalizedAta] = useState<any | null>(null);
  const [minuteId, setMinuteId] = useState<string | null>(existingMinute?.id || null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Sincroniza rascunho existente
  useEffect(() => {
    if (existingMinute) {
      setMinuteId(existingMinute.id || null);
      if (existingMinute.students) {
        setSelectedStudentIds(existingMinute.students.map((s: any) => s.studentId));
      }
      if (existingMinute.category) setCategory(existingMinute.category);
      if (existingMinute.isConfidential !== undefined) setIsConfidential(existingMinute.isConfidential);
      if (existingMinute.subject) setSubject(existingMinute.subject);
      if (existingMinute.rawNotes !== undefined) setRawNotes(existingMinute.rawNotes || "");
      if (existingMinute.summary !== undefined) setSummary(existingMinute.summary || "");
      if (existingMinute.agreementsSummary !== undefined) setAgreementsSummary(existingMinute.agreementsSummary || "");
      if (existingMinute.participants) setParticipants(existingMinute.participants);
      if (existingMinute.actionItems) {
        setActionItems(
          existingMinute.actionItems.map((a: any) => ({
            description: a.description,
            responsible: a.responsible,
            dueDate: a.dueDate ? a.dueDate.slice(0, 10) : "",
          }))
        );
      }
      // Se já está editando um rascunho com aluno, abre direto no passo 2
      setStep(2);
    } else {
      setMinuteId(null);
      setSelectedStudentIds(preSelectedStudentId ? [preSelectedStudentId] : []);
      setSummary("");
      setRawNotes("");
      setAgreementsSummary("");
      setFinalizedAta(null);
      setStep(preSelectedStudentId ? 2 : 1);
    }
  }, [existingMinute, preSelectedStudentId]);

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
    const isSelected = selectedStudentIds.includes(student.id);
    let nextIds: string[];

    if (isSelected) {
      nextIds = selectedStudentIds.filter((id) => id !== student.id);
    } else {
      nextIds = [...selectedStudentIds, student.id];

      // Se o aluno tiver responsável e ainda não estiver na lista de participantes, sugere adicionar
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
            (p: any) => p.name === qrModalInfo.name
          );
          if (currentPart?.signatureData) {
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
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Seu navegador não possui suporte para reconhecimento de voz nativo.");
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
    } catch (e: any) {
      console.warn("Erro ao iniciar voz:", e);
      setIsListening(false);
    }
  };

  // Formalização IA com Gemini
  const handleFormalizeWithAi = async () => {
    if (!rawNotes.trim()) {
      alert("Digite tópicos ou use o microfone antes de solicitar a formalização com IA.");
      return;
    }

    setIsAiLoading(true);
    try {
      const studentNames = availableStudents
        .filter((s) => selectedStudentIds.includes(s.id))
        .map((s) => s.name);
      const guardianNames = participants.map((p) => p.name).filter(Boolean);

      const res = await fetch("/api/ai/formalize-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawNotes,
          category,
          studentNames,
          guardianNames,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao consultar IA");

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
      }
    } catch (err: any) {
      alert(err.message || "Erro ao formalizar minuta");
    } finally {
      setIsAiLoading(false);
    }
  };

  // Salvar Rascunho
  const handleSaveDraft = async () => {
    if (selectedStudentIds.length === 0) {
      const msg = "Selecione pelo menos um estudante para vincular a esta ata.";
      setFinalizeError(msg);
      alert(msg);
      return null;
    }

    setSaving(true);
    setFinalizeError(null);
    try {
      const payload = {
        category,
        isConfidential,
        subject,
        rawNotes,
        summary,
        agreementsSummary,
        studentIds: selectedStudentIds,
        participants,
        actionItems,
      };

      const targetId = minuteId || existingMinute?.id;
      const url = targetId ? `/api/atas/${targetId}` : "/api/atas";
      const method = targetId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar rascunho");

      if (data.minute?.id) {
        setMinuteId(data.minute.id);
        if (data.minute.participants) {
          setParticipants(data.minute.participants);
        }
      }

      return data.minute;
    } catch (err: any) {
      setFinalizeError(err.message || "Erro ao salvar");
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Lavrar Oficialmente
  const handleFinalize = async () => {
    setFinalizeError(null);

    if (selectedStudentIds.length === 0) {
      setStep(1);
      const msg = "Selecione pelo menos um estudante antes de lavrar a ata.";
      setFinalizeError(msg);
      return;
    }

    if (!summary || summary.trim().length < 10) {
      const msg = "É necessário preencher o texto formal da ata (mínimo de 10 caracteres) antes da lavratura oficial.";
      setFinalizeError(msg);
      return;
    }

    let confirmed = true;
    try {
      confirmed = window.confirm(
        "CONFIRMAÇÃO JURÍDICA: Deseja lavrar esta Ata Pedagógica agora?\n\nApós a lavratura, ela receberá número sequencial anual oficial, hash SHA-256 e ficará 100% imutável (qualquer alteração futura só poderá ser feita via Adendo 'Em tempo')."
      );
    } catch {
      confirmed = true;
    }
    if (!confirmed) return;

    setSaving(true);
    try {
      // 1. Salva rascunho primeiro
      const savedMinute = await handleSaveDraft();
      if (!savedMinute) {
        throw new Error("Não foi possível salvar o rascunho da ata antes da lavratura.");
      }

      // 2. Chama lavratura definitiva
      const res = await fetch(`/api/atas/${savedMinute.id}/finalize`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao lavrar ata no servidor.");
      }

      setFinalizedAta(data.minute);
      onSaved();
    } catch (err: any) {
      console.error("[handleFinalize] Erro:", err);
      const msg = err.message || "Erro desconhecido ao lavrar ata.";
      setFinalizeError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Gerar QR Code para participante assinar no celular
  const handleGenerateMobileSign = async (index: number) => {
    const part = participants[index];
    const currentId = minuteId || existingMinute?.id;

    if (!currentId || !part.id) {
      const saved = await handleSaveDraft();
      if (!saved) return;
      const partId = saved.participants[index]?.id;
      if (partId) {
        generateTokenForParticipant(saved.id, partId, part.name);
      }
      return;
    }
    generateTokenForParticipant(currentId, part.id, part.name);
  };

  const generateTokenForParticipant = async (targetMinuteId: string, participantId: string, name: string) => {
    try {
      const res = await fetch(`/api/atas/${targetMinuteId}/sign-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMinuteId(targetMinuteId);
      setQrModalInfo({ url: data.signUrl, name });
    } catch (err: any) {
      alert(err.message || "Erro ao gerar link de assinatura");
    }
  };

  // Se já lavrou com sucesso, mostra tela de conclusão com atalhos
  if (finalizedAta) {
    const cleanNum = String(finalizedAta.ataNumber).padStart(3, "0");
    const cleanYear = finalizedAta.year;

    return (
      <AtaDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Ata Pedagógica Lavrada com Sucesso"
        maxWidthClass="max-w-2xl"
      >
        <div className="text-center py-6 space-y-4">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <FileCheck2 className="w-8 h-8" />
          </div>

          <div>
            <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 uppercase tracking-wide">
              Documento Oficial Registrado
            </span>
            <h3 className="text-2xl font-black text-slate-900 mt-2">
              Ata Pedagógica nº {cleanNum}/{cleanYear}
            </h3>
            <p className="text-xs text-slate-500 font-mono mt-1">
              Código de Validação: {finalizedAta.verificationCode}
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left text-xs space-y-2">
            <p className="font-bold text-slate-700">Integridade Criptográfica (SHA-256):</p>
            <p className="font-mono text-[10px] text-slate-600 break-all bg-white p-2.5 rounded-xl border border-slate-200">
              {finalizedAta.contentHash}
            </p>
            <p className="text-[11px] text-slate-500">
              Lavrado por: <strong>{finalizedAta.authorName}</strong> em{" "}
              {new Date(finalizedAta.finalizedAt).toLocaleString("pt-BR")}.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
            <a
              href={`/atas/${finalizedAta.id}/imprimir`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-sm"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span>Imprimir / Salvar PDF Oficial A4</span>
            </a>

            {finalizedAta.agreementsSummary && (
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `*Colégio Estadual Leopoldina B. Pedroso*\n*Comprovante de Atendimento Pedagógico — Ata nº ${cleanNum}/${cleanYear}*\n\nPrezada família, confirmamos o atendimento realizado nesta data. Seguem os combinados firmados:\n\n${finalizedAta.agreementsSummary}\n\nPara verificar a autenticidade deste documento oficial, acesse o link seguro: ${window.location.origin}/validar/ata/${finalizedAta.verificationCode}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm"
              >
                <Share2 className="w-4 h-4" />
                <span>Enviar Combinados via WhatsApp</span>
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              Concluir
            </button>
          </div>
        </div>
      </AtaDialog>
    );
  }

  return (
    <AtaDialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        existingMinute?.status === "FINALIZED"
          ? `Ata Pedagógica nº ${String(existingMinute.ataNumber).padStart(3, "0")}/${existingMinute.year} (Oficial Imutável)`
          : "Lavratura de Ata do Atendimento Pedagógico"
      }
      description="Substitui o caderno manuscrito com fé pública institucional, validade jurídica (Lei nº 14.063/2020) e integração ao Prontuário 360º."
      maxWidthClass="max-w-[96vw] lg:max-w-[1440px]"
    >
      <div className="space-y-6 text-xs">
        {/* WIZARD BIMODAL: NAVEGAÇÃO DE PASSOS */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                step === 1
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                1
              </span>
              <span>Alunos & Pauta ({selectedStudentIds.length} selecionado{selectedStudentIds.length !== 1 ? "s" : ""})</span>
            </button>

            <ArrowRight className="w-4 h-4 text-slate-300" />

            <button
              type="button"
              onClick={() => {
                if (selectedStudentIds.length === 0) {
                  alert("Selecione pelo menos um estudante antes de avançar para a redação.");
                  return;
                }
                setStep(2);
              }}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                step === 2
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                2
              </span>
              <span>Redação Oficial & Assinaturas</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
            Etapa {step} de 2
          </span>
        </div>

        {/* ============================================================== */}
        {/* ETAPA 1: SELEÇÃO AMPLA E BUSCA DE ALUNOS + PAUTA E CATEGORIA   */}
        {/* ============================================================== */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
              {/* COLUNA ESQUERDA: DADOS DA PAUTA + ESTUDANTES VINCULADOS (5 colunas) */}
              <div className="lg:col-span-5 space-y-4">
                {/* Card de Pauta e Categoria */}
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
                    <label className="flex items-center space-x-2.5 cursor-pointer p-2 rounded-xl bg-rose-50/70 border border-rose-200">
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
                      Nenhum estudante selecionado ainda.<br />
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
                        alert("Selecione pelo menos um estudante antes de avançar.");
                        return;
                      }
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

                {/* Filtros em destaque */}
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

                {/* Lista Ampla de Alunos com altura aumentada h-[460px] */}
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
                                {s.guardianName ? <span>Resp: <strong className="text-slate-600">{s.guardianName}</strong></span> : null}
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

            {/* Rodapé do Passo 1 */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 text-xs transition"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => {
                  if (selectedStudentIds.length === 0) {
                    alert("Selecione pelo menos um estudante antes de avançar.");
                    return;
                  }
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

            {/* Layout em 2 Colunas lado a lado no Desktop */}
            <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start">
              {/* COLUNA ESQUERDA: IA, TEXTO FORMAL E COMBINADOS (6 colunas) */}
              <div className="lg:col-span-6 space-y-4">
                {/* Assistente IA Gemini e Voz */}
                <div className="border border-sky-100 bg-sky-50/50 p-4 rounded-2xl space-y-2.5 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-extrabold text-sky-900 text-xs flex items-center space-x-1.5">
                      <Sparkles className="w-4 h-4 text-sky-600" />
                      <span>Formalização Pedagógica (Gemini AI + Voz)</span>
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
                        {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-sky-600" />}
                        <span>{isListening ? "Gravando voz..." : "Ditado por Voz"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleFormalizeWithAi}
                        disabled={isAiLoading}
                        className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold transition shadow-2xs disabled:opacity-50 cursor-pointer text-xs"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        <span>{isAiLoading ? "Formalizando..." : "Formalizar com IA"}</span>
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={3}
                    value={rawNotes}
                    onChange={(e) => setRawNotes(e.target.value)}
                    placeholder="Digite tópicos rápidos da conversa ou use o microfone. A IA redigirá na íntegra a ata formal em norma culta e respeitando o ECA."
                    className="w-full p-2.5 border border-sky-200 rounded-xl bg-white text-slate-700 placeholder:text-slate-400 focus:outline-sky-500 text-xs shadow-2xs"
                  />
                </div>

                {/* Texto Formal da Ata */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-extrabold text-slate-900 block text-xs">
                      Texto Formal da Ata (Norma Culta / ECA-safe):
                    </label>
                    <span className="text-[11px] text-slate-400">Revisável pela servidora antes de lavrar</span>
                  </div>
                  <textarea
                    rows={9}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
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
                {/* Encaminhamentos & Prazos */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-extrabold text-slate-800 block text-xs">
                        Encaminhamentos & Prazos da Ata:
                      </label>
                      <p className="text-[11px] text-slate-500">
                        Alimenta os lembretes do Prontuário 360º
                      </p>
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
                      Nenhum encaminhamento registrado. Clique em "+ Adicionar Ação" se houver combinados com prazo.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {actionItems.map((act, idx) => (
                        <div key={idx} className="flex items-center space-x-2 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
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
                            className="text-slate-400 hover:text-rose-600 p-1"
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
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-extrabold text-slate-800 block text-xs">
                        Presentes e Coleta de Assinatura:
                      </label>
                      <p className="text-[11px] text-slate-500">
                        A servidora logada assina eletronicamente com fé pública ao lavrar. Colha a assinatura dos demais abaixo.
                      </p>
                    </div>
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
                              className="text-slate-400 hover:text-rose-600 p-1 rounded-md"
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
                                checked={p.documentVerifiedByStaff}
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
                            {p.signatureData ? (
                              <span className="inline-flex items-center space-x-1 text-emerald-700 font-bold text-xs bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>
                                  {p.biometricVerified
                                    ? "Assinado com Biometria"
                                    : "Assinado Digitalmente"}
                                </span>
                              </span>
                            ) : p.signatureMode === "REFUSED" ? (
                              <span className="inline-flex items-center space-x-1 text-rose-600 font-bold text-xs bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>Recusou-se a assinar</span>
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setActiveSignParticipantIndex(idx)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-2xs transition cursor-pointer"
                                >
                                  Assinar na Tela
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleGenerateMobileSign(idx)}
                                  className="px-2.5 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-xs transition flex items-center space-x-1 cursor-pointer"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                  <span>QR Celular (Biometria)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const reason = prompt("Informe o motivo da recusa de assinatura (para constar na ata):");
                                    if (reason !== null) {
                                      const witness = prompt("Nome da testemunha escolar presente:");
                                      const copy = [...participants];
                                      copy[idx].signatureMode = "REFUSED";
                                      copy[idx].refusalReason = reason;
                                      copy[idx].witnessName = witness || "Equipe Pedagógica";
                                      setParticipants(copy);
                                    }
                                  }}
                                  className="px-2 py-1 rounded-lg border border-rose-300 hover:bg-rose-50 text-rose-700 font-bold text-xs transition cursor-pointer"
                                >
                                  Recusa
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Canvas de Assinatura em tela */}
                        {activeSignParticipantIndex === idx && !p.signatureData && (
                          <div className="pt-2">
                            <SignatureCanvas
                              signerName={p.name || "Participante"}
                              onSave={(dataUrl) => {
                                const copy = [...participants];
                                copy[idx].signatureData = dataUrl;
                                copy[idx].signatureMode = "SCREEN_CANVAS";
                                setParticipants(copy);
                                setActiveSignParticipantIndex(null);
                              }}
                              onClear={() => {
                                const copy = [...participants];
                                copy[idx].signatureData = null;
                                copy[idx].signatureMode = "PENDING";
                                setParticipants(copy);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Modal QR Code para Assinar no Celular */}
                {qrModalInfo && (
                  <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl space-y-3 text-center shadow-sm">
                    <h4 className="font-extrabold text-sky-900 text-sm">
                      Aponte a câmera do celular para assinar com Biometria
                    </h4>
                    <p className="text-xs text-sky-700">
                      Participante: <strong>{qrModalInfo.name}</strong>
                    </p>
                    <div className="flex justify-center p-2 bg-white rounded-xl border border-sky-200 w-fit mx-auto shadow-sm">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                          qrModalInfo.url
                        )}`}
                        alt="QR Code Assinatura"
                        className="w-36 h-36"
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono break-all">
                      {qrModalInfo.url}
                    </p>
                    <button
                      type="button"
                      onClick={() => setQrModalInfo(null)}
                      className="px-4 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
                    >
                      Fechar QR Code
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Aviso de Erro Visual na Lavratura */}
            {finalizeError && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="font-bold text-xs">Não foi possível lavrar a ata:</strong>
                  <p className="text-[11px] leading-relaxed">{finalizeError}</p>
                </div>
              </div>
            )}

            {/* Barra de Ações Inferior da Etapa 2 */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 transition flex items-center space-x-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar aos Alunos</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 rounded-xl text-slate-500 hover:text-slate-800 font-medium transition"
                >
                  Cancelar
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold transition disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar Rascunho"}
                </button>

                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold transition shadow-sm disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4 text-emerald-200" />
                  <span>{saving ? "Lavrando..." : "Lavrar Ata Oficial (Imutável)"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AtaDialog>
  );
}
