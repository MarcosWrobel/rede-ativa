"use client";

import { useState, useMemo, useEffect } from "react";
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
} from "lucide-react";
import { determineShift, formatMessage, SchoolShift } from "@/lib/messageFormatter";
import {
  getActiveJustification,
  KINSHIP_LABELS,
  JUSTIFICATION_TYPE_LABELS,
} from "@/lib/pedagogicalClassifier";

interface Props {
  classGroups: any[];
  templates: any[];
  initialStudents: any[];
  initialSelectedStudentId?: string;
  initialCustomPhone?: string;
  currentUser: {
    name: string;
    email: string;
  };
}

export default function BuscaAtivaClient({
  classGroups,
  templates,
  initialStudents,
  initialSelectedStudentId = "",
  initialCustomPhone = "",
  currentUser,
}: Props) {
  const [selectedSegment, setSelectedSegment] = useState<string>("TODOS");
  const [selectedTurmaId, setSelectedTurmaId] = useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialSelectedStudentId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [activeShift, setActiveShift] = useState<SchoolShift>("TARDE");
  const [customMessage, setCustomMessage] = useState<string>("");
  const [customPhone, setCustomPhone] = useState<string>("");
  const [selectedGuardianName, setSelectedGuardianName] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [lastSentSuccess, setLastSentSuccess] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Inicializa aluno vindo via URL (?studentId=...&phone=...)
  useEffect(() => {
    if (!initialSelectedStudentId) return;
    const st = initialStudents.find((s) => s.id === initialSelectedStudentId);
    if (st) {
      setCustomPhone(initialCustomPhone || st.phone || "");
      setSelectedGuardianName(st.guardianName || "");
      setActiveShift(determineShift(st));
    }
  }, [initialSelectedStudentId, initialCustomPhone, initialStudents]);

  // Filtered turmas by segment
  const filteredClassGroups = useMemo(() => {
    if (selectedSegment === "TODOS") return classGroups;
    return classGroups.filter((cg) => cg.segment === selectedSegment);
  }, [classGroups, selectedSegment]);

  // Filtered students by segment and turma
  const filteredStudents = useMemo(() => {
    return initialStudents.filter((s) => {
      const matchSegment = selectedSegment === "TODOS" || s.classGroup.segment === selectedSegment;
      const matchTurma = !selectedTurmaId || s.classGroupId === selectedTurmaId;
      return matchSegment && matchTurma;
    });
  }, [initialStudents, selectedSegment, selectedTurmaId]);

  // Selected student object
  const selectedStudent = useMemo(() => {
    return initialStudents.find((s) => s.id === selectedStudentId);
  }, [initialStudents, selectedStudentId]);

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
      guardianName: guardianOverride !== undefined ? guardianOverride : selectedGuardianName || student.guardianName,
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
    const st = initialStudents.find((s) => s.id === studentId);
    if (st) {
      setCustomPhone(st.phone);
      setSelectedGuardianName(st.guardianName || "");
      const detectedShift = determineShift(st);
      setActiveShift(detectedShift);
      if (selectedTemplate) {
        updatePreview(st, selectedTemplate, detectedShift, st.guardianName || "");
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

  const handleSend = async () => {
    if (!selectedStudent || !customMessage) {
      setErrorMessage("Por favor, selecione um aluno e configure a mensagem.");
      return;
    }

    setIsSending(true);
    setErrorMessage("");
    setLastSentSuccess(null);

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          templateId: selectedTemplate?.id || null,
          reasonTitle: selectedTemplate?.title || "CONTATO PEDAGÓGICO",
          messageContent: customMessage,
          customPhone: customPhone || selectedStudent.phone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao registrar envio");
      }

      setLastSentSuccess({
        time: new Date().toLocaleTimeString("pt-BR"),
        studentName: selectedStudent.name,
        whatsappUrl: data.whatsappUrl,
      });

      window.open(data.whatsappUrl, "_blank");
    } catch (err: any) {
      setErrorMessage(err.message || "Erro ao processar envio.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & User info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <Send className="w-6 h-6 text-sky-600" />
            <span>Painel de Busca Ativa & Envio de Mensagens</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Envio automatizado com gravação auditada de cada interação em nome de <strong>{currentUser.name}</strong>.
          </p>
        </div>
        <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-800 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse" />
          Operando como: {currentUser.name} ({currentUser.email})
        </div>
      </div>

      {/* Main Grid: Selection (Left) + Preview & Send (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Segment, Turma, Student & Reason selection */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. Nível / Segmento Tabs */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              1. Nível de Ensino / Turno
            </label>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-lg">
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
                      ? "bg-white text-sky-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {seg === "MEDIO" ? "MÉDIO" : seg}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Turma & Student Selection */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                2. Selecione a Turma
              </label>
              <select
                value={selectedTurmaId}
                onChange={(e) => {
                  setSelectedTurmaId(e.target.value);
                  setSelectedStudentId("");
                }}
                className="w-full text-sm border border-slate-300 rounded-lg p-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition"
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
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                3. Selecione o Aluno ({filteredStudents.length} disponíveis)
              </label>
              <select
                value={selectedStudentId}
                onChange={(e) => handleSelectStudent(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg p-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 font-medium transition"
              >
                <option value="">-- Escolha um aluno na lista --</option>
                {filteredStudents.map((st) => {
                  const hasActiveJust = getActiveJustification(st.justifications) !== null;
                  return (
                    <option key={st.id} value={st.id}>
                      {hasActiveJust ? "🩺 " : ""}
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
                      <strong>{selectedGuardianName || selectedStudent.guardianName || "Não informado"}</strong>
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

                {/* Alerta de Atestado Médico Vigente (PED-03) */}
                {activeJustification && (
                  <div className="p-2.5 bg-emerald-100 border border-emerald-300 rounded-lg text-emerald-950 flex items-start space-x-2">
                    <Stethoscope className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-extrabold">
                        🩺 Atenção: Atestado / Justificativa Vigente!
                      </strong>
                      <span className="text-[11px] block">
                        {JUSTIFICATION_TYPE_LABELS[activeJustification.type] || activeJustification.type} válido de{" "}
                        <strong>{new Date(activeJustification.startDate).toLocaleDateString("pt-BR")}</strong> até{" "}
                        <strong>{new Date(activeJustification.endDate).toLocaleDateString("pt-BR")}</strong>.
                        {activeJustification.notes ? ` (${activeJustification.notes})` : ""}
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
                              : c.whatsappValid
                              ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                              : "bg-rose-50 text-rose-800 border-rose-200"
                          }`}
                          title={c.whatsappValid ? c.name : `${c.name} — Número sinalizado sem WhatsApp`}
                        >
                          {!c.whatsappValid && <PhoneOff className="w-3 h-3" />}
                          <span>
                            {KINSHIP_LABELS[c.kinship] || c.kinship}: {c.name.split(" ")[0]} ({c.phone})
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
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <span>Atenção: Aluno em Acompanhamento de Frequência!</span>
                      <div className="text-[11px] font-normal mt-0.5 space-y-0.5">
                        <div>
                          Freq Geral: <strong>{selectedStudent.lowAttendanceRecord.attendancePercent}%</strong>
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
                    <span className="font-semibold text-sky-900">Últimos contatos registrados:</span>
                    <ul className="mt-1 space-y-0.5">
                      {selectedStudent.messageLogs.map((log: any) => (
                        <li key={log.id} className="truncate">
                          • {new Date(log.sentAt).toLocaleDateString("pt-BR")}: <strong>{log.reasonTitle}</strong> ({log.sentByName})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. Reason / Template Selection */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
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
        </div>

        {/* Right Column: Live Message Preview & WhatsApp Action */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Edit3 className="w-5 h-5 text-sky-600" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">Prévia da Mensagem (Editável)</h2>
                  <p className="text-[11px] text-slate-400">Texto adaptado automaticamente ao aluno e período</p>
                </div>
              </div>

              {/* Seletor Rápido de Período / Turno */}
              <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto">
                <span className="text-[11px] font-bold text-slate-500 px-1.5 hidden md:inline">Período:</span>
                <button
                  type="button"
                  onClick={() => handleChangeShift("MANHA")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1 ${
                    activeShift === "MANHA"
                      ? "bg-amber-500 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                  }`}
                  title="Aplicar saudação de Bom dia (Matutino)"
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
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                  }`}
                  title="Aplicar saudação de Boa tarde (Vespertino)"
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
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                  }`}
                  title="Aplicar saudação de Boa noite (Noturno)"
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Noite</span>
                </button>
              </div>
            </div>

            {/* Textarea */}
            <div className="relative">
              <textarea
                rows={12}
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Selecione um aluno e um motivo à esquerda para gerar o texto da mensagem automaticamente..."
                className="w-full text-sm font-sans p-4 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 leading-relaxed transition shadow-inner"
              />
            </div>

            {/* Error or Alert */}
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Success notification */}
            {lastSentSuccess && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs space-y-2">
                <div className="flex items-center font-bold text-sm text-emerald-900">
                  <CheckCircle className="w-4 h-4 mr-1.5 text-emerald-600" />
                  Mensagem registrada com sucesso no sistema!
                </div>
                <p>
                  O envio para <strong>{lastSentSuccess.studentName}</strong> foi registrado em seu nome às {lastSentSuccess.time}.
                </p>
                <a
                  href={lastSentSuccess.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center font-bold text-emerald-700 underline hover:text-emerald-900"
                >
                  Abrir WhatsApp Web novamente <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
            )}

            {/* Dispatch Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-500 flex items-center space-x-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Registra automaticamente em seu histórico e trilha de auditoria</span>
              </div>

              <button
                type="button"
                onClick={handleSend}
                disabled={isSending || !selectedStudent || !customMessage}
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition disabled:cursor-not-allowed text-sm"
              >
                <Send className="w-4 h-4" />
                <span>{isSending ? "Registrando e abrindo..." : "Enviar pelo WhatsApp & Gravar Log"}</span>
              </button>
            </div>
          </div>

          {/* Quick Instructions Guide */}
          <div className="bg-sky-50/50 rounded-xl border border-sky-100 p-5 text-xs text-sky-950 space-y-2.5">
            <h3 className="font-bold text-sky-900 flex items-center space-x-1.5 text-sm">
              <HelpCircle className="w-4 h-4 text-sky-700" />
              <span>Instruções de Uso (Busca Ativa Leopoldina)</span>
            </h3>
            <ol className="list-decimal list-inside space-y-1 text-slate-700 leading-relaxed">
              <li><strong>Escolha o Turno e Turma</strong>: Use os botões no topo para filtrar Fundamental, Médio ou Noturno.</li>
              <li><strong>Selecione o Aluno</strong>: O sistema alerta automaticamente caso haja 🩺 <strong>Atestado Médico Vigente</strong> e permite alternar entre os telefones da Mãe, Pai ou Recado.</li>
              <li><strong>Defina o Motivo</strong>: Clique no modelo desejado (Aluno Faltou, Sair Mais Cedo, Muitas Faltas, Tarefa, etc.). O texto é gerado com os dados do aluno.</li>
              <li><strong>Envie com 1 Clique</strong>: Ao clicar no botão verde, o sistema salva o registro atômico com seu usuário institucional e abre a conversa do WhatsApp imediatamente.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
