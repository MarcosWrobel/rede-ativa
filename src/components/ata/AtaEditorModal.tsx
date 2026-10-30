"use client";

import { useState } from "react";
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
    // Preenche com o responsável do aluno inicial se houver
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
      alert("Selecione pelo menos um estudante para vincular a esta ata.");
      return null;
    }

    setSaving(true);
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

      const url = existingMinute?.id ? `/api/atas/${existingMinute.id}` : "/api/atas";
      const method = existingMinute?.id ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar rascunho");

      return data.minute;
    } catch (err: any) {
      alert(err.message || "Erro ao salvar");
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Lavrar Oficialmente
  const handleFinalize = async () => {
    if (!summary || summary.trim().length < 10) {
      alert("É necessário preencher o texto formal da ata antes da lavratura oficial.");
      return;
    }

    const confirm = window.confirm(
      "CONFIRMAÇÃO JURÍDICA: Deseja lavrar esta Ata Pedagógica agora?\n\nApós a lavratura, ela receberá número sequencial anual oficial, hash SHA-256 e ficará 100% imutável (qualquer alteração futura só poderá ser feita via Adendo 'Em tempo')."
    );
    if (!confirm) return;

    setSaving(true);
    try {
      // 1. Salva rascunho primeiro
      const savedMinute = await handleSaveDraft();
      if (!savedMinute) return;

      // 2. Chama lavratura definitiva
      const res = await fetch(`/api/atas/${savedMinute.id}/finalize`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao lavrar ata");

      setFinalizedAta(data.minute);
      onSaved();
    } catch (err: any) {
      alert(err.message || "Erro ao lavrar ata");
    } finally {
      setSaving(false);
    }
  };

  // Gerar QR Code para participante assinar no celular
  const handleGenerateMobileSign = async (index: number) => {
    const part = participants[index];
    if (!existingMinute?.id) {
      // Salva rascunho primeiro para ter ID no banco
      const saved = await handleSaveDraft();
      if (!saved) return;
      generateTokenForParticipant(saved.id, saved.participants[index]?.id, part.name);
      return;
    }
    generateTokenForParticipant(existingMinute.id, part.id, part.name);
  };

  const generateTokenForParticipant = async (minuteId: string, participantId: string, name: string) => {
    try {
      const res = await fetch(`/api/atas/${minuteId}/sign-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

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
              className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition"
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
    >
      <div className="space-y-6 text-xs">
        {/* Bloco 1: Alunos e Categoria */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <div className="md:col-span-7 space-y-1.5">
            <label className="font-bold text-slate-700 block">
              Estudante(s) Vinculado(s):
            </label>
            <select
              multiple
              value={selectedStudentIds}
              onChange={(e) => {
                const options = Array.from(e.target.selectedOptions, (opt) => opt.value);
                setSelectedStudentIds(options);
              }}
              className="w-full p-2 border border-slate-300 rounded-xl bg-white font-medium text-slate-800 h-24 focus:outline-sky-500"
            >
              {availableStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.classGroupName ? `(${s.classGroupName})` : ""} {s.cgm ? `— CGM: ${s.cgm}` : ""}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500">
              Segure Ctrl / Cmd para selecionar mais de um estudante (ex.: conflito ou irmãos).
            </p>
          </div>

          <div className="md:col-span-5 space-y-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Categoria da Ata:
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center space-x-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={isConfidential}
                onChange={(e) => setIsConfidential(e.target.checked)}
                className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
              />
              <span className="font-bold text-rose-700 flex items-center space-x-1">
                <Lock className="w-3.5 h-3.5" />
                <span>Sigilo Reforçado (ECA / Proteção à Intimidade)</span>
              </span>
            </label>
          </div>
        </div>

        {/* Bloco 2: Pauta e Anotações Brutas com Ditado por Voz e IA */}
        <div className="space-y-3">
          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Assunto / Pauta do Atendimento:
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex.: Comparecimento da família para alinhamento pedagógico e faltas"
              className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800"
            />
          </div>

          <div className="border border-sky-100 bg-sky-50/40 p-4 rounded-2xl space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold text-sky-900 flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-sky-600" />
                <span>Assistente de Formalização Pedagógica (Gemini AI + Voz)</span>
              </span>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={toggleSpeechRecognition}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition shadow-2xs cursor-pointer ${
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
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold transition shadow-2xs disabled:opacity-50 cursor-pointer"
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
              placeholder="Digite aqui tópicos rápidos da conversa ou use o ditado por voz. Ex.: Mãe compareceu às 10h. Justificou que aluno faltou por consulta odontológica. Aluno comprometeu-se a entregar tarefas e não conversar nas aulas de matemática."
              className="w-full p-2.5 border border-sky-200 rounded-xl bg-white text-slate-700 placeholder:text-slate-400 focus:outline-sky-500"
            />
          </div>
        </div>

        {/* Bloco 3: Texto Oficial da Ata e Combinados */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-extrabold text-slate-900 block">
                Texto Formal da Ata (Norma Culta / ECA-safe):
              </label>
              <span className="text-[10px] text-slate-400">Revisável pela pedagoga antes de lavrar</span>
            </div>
            <textarea
              rows={5}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="O texto formal da ata será gerado pela IA ou digitado diretamente aqui..."
              className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-800 leading-relaxed font-serif text-[13px] focus:outline-slate-900"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Síntese dos Combinados e Prazos Acordados:
            </label>
            <input
              type="text"
              value={agreementsSummary}
              onChange={(e) => setAgreementsSummary(e.target.value)}
              placeholder="Ex.: Responsável entregará atestado até sexta-feira e aluno realizará trabalhos de compensação."
              className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-medium text-slate-800"
            />
          </div>
        </div>

        {/* Bloco 4: Encaminhamentos Estruturados com Prazos */}
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <label className="font-extrabold text-slate-800">
              Encaminhamentos & Prazos da Ata (Gera lembretes no Prontuário):
            </label>
            <button
              type="button"
              onClick={() =>
                setActionItems((prev) => [
                  ...prev,
                  { description: "", responsible: "FAMILIA", dueDate: "" },
                ])
              }
              className="text-sky-600 hover:text-sky-700 font-bold flex items-center space-x-1 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Adicionar Ação</span>
            </button>
          </div>

          {actionItems.map((act, idx) => (
            <div key={idx} className="flex items-center space-x-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
              <input
                type="text"
                placeholder="Descrição da ação pactuada..."
                value={act.description}
                onChange={(e) => {
                  const copy = [...actionItems];
                  copy[idx].description = e.target.value;
                  setActionItems(copy);
                }}
                className="flex-1 p-1.5 border border-slate-300 rounded-lg bg-white"
              />
              <select
                value={act.responsible}
                onChange={(e) => {
                  const copy = [...actionItems];
                  copy[idx].responsible = e.target.value;
                  setActionItems(copy);
                }}
                className="p-1.5 border border-slate-300 rounded-lg bg-white font-semibold"
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
                className="p-1.5 border border-slate-300 rounded-lg bg-white"
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

        {/* Bloco 5: Participantes & Coleta Híbrida de Assinaturas */}
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="font-extrabold text-slate-800 block">
                Presentes e Coleta de Assinatura:
              </label>
              <p className="text-[10px] text-slate-500">
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
              className="text-sky-600 hover:text-sky-700 font-bold flex items-center space-x-1 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Adicionar Presente</span>
            </button>
          </div>

          <div className="space-y-3">
            {participants.map((p, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <div className="md:col-span-3">
                    <select
                      value={p.role}
                      onChange={(e) => {
                        const copy = [...participants];
                        copy[idx].role = e.target.value;
                        setParticipants(copy);
                      }}
                      className="w-full p-2 border border-slate-300 rounded-xl bg-white font-semibold"
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
                      className="w-full p-2 border border-slate-300 rounded-xl bg-white font-medium"
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
                      className="w-full p-2 border border-slate-300 rounded-xl bg-white font-medium"
                    />
                  </div>

                  <div className="md:col-span-2 flex items-center justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setParticipants((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Opções de assinatura para este participante */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
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

                  <div className="flex items-center space-x-2">
                    {p.signatureData ? (
                      <span className="inline-flex items-center space-x-1 text-emerald-600 font-bold text-[11px] bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Assinado Digitalmente</span>
                      </span>
                    ) : p.signatureMode === "REFUSED" ? (
                      <span className="inline-flex items-center space-x-1 text-rose-600 font-bold text-[11px] bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Recusou-se a assinar</span>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveSignParticipantIndex(idx)}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] shadow-2xs transition"
                        >
                          Assinar na Tela
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateMobileSign(idx)}
                          className="px-2.5 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-[11px] transition flex items-center space-x-1"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>QR Celular</span>
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
                          className="px-2.5 py-1 rounded-lg border border-rose-300 hover:bg-rose-50 text-rose-700 font-bold text-[11px] transition"
                        >
                          Recusa
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Se estiver coletando assinatura em tela para este participante */}
                {activeSignParticipantIndex === idx && (
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
          <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl space-y-3 text-center">
            <h4 className="font-extrabold text-sky-900 text-sm">
              Aponte a câmera do celular para assinar na tela
            </h4>
            <p className="text-xs text-sky-700">
              Participante: <strong>{qrModalInfo.name}</strong>
            </p>
            <div className="flex justify-center p-2 bg-white rounded-xl border border-sky-200 w-fit mx-auto shadow-sm">
              {/* Renderiza imagem de QR Code via serviço SVG seguro */}
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
              className="px-4 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs"
            >
              Fechar QR Code
            </button>
          </div>
        )}

        {/* Barra de Ações Inferior */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 transition"
          >
            Cancelar
          </button>

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
    </AtaDialog>
  );
}
