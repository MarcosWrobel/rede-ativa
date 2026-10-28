"use client";

import { useState } from "react";
import { 
  FileText, 
  Plus, 
  Edit, 
  Check, 
  AlertTriangle, 
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Sun,
  Sunset,
  Moon,
  Info,
  X,
  Wand2,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { formatMessage, SchoolShift } from "@/lib/messageFormatter";

interface Props {
  initialTemplates: any[];
}

export default function ModelosClient({ initialTemplates }: Props) {
  const [templates, setTemplates] = useState<any[]>(initialTemplates);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formSegment, setFormSegment] = useState("TODOS");
  const [formPrefix, setFormPrefix] = useState("");
  const [formSuffix, setFormSuffix] = useState("");
  const [formIsAbsence, setFormIsAbsence] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formError, setFormError] = useState("");
  
  // Field focus target for tag insertion ('prefix' or 'suffix')
  const [lastFocusedField, setLastFocusedField] = useState<"prefix" | "suffix">("prefix");
  const [previewShift, setPreviewShift] = useState<SchoolShift>("TARDE");

  // AI Generator state
  const [isAiCardOpen, setIsAiCardOpen] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuccess, setAiSuccess] = useState("");
  const [missingApiKey, setMissingApiKey] = useState(false);

  const openCreateModal = () => {
    setEditingTemplate(null);
    setFormTitle("");
    setFormSegment("TODOS");
    setFormPrefix("{saudacao}\nPrezados responsáveis, informamos que o(a) aluno(a)");
    setFormSuffix("Atenciosamente,\nEquipe Pedagógica — Colégio Leopoldina");
    setFormIsAbsence(false);
    setFormError("");
    setAiPrompt("");
    setAiError("");
    setAiSuccess("");
    setMissingApiKey(false);
    setIsAiCardOpen(true);
    setLastFocusedField("prefix");
    setIsModalOpen(true);
  };

  const openEditModal = (t: any) => {
    setEditingTemplate(t);
    setFormTitle(t.title);
    setFormSegment(t.segment);
    setFormPrefix(t.prefixText);
    setFormSuffix(t.suffixText);
    setFormIsAbsence(t.isAbsenceRelated);
    setFormError("");
    setAiPrompt("");
    setAiError("");
    setAiSuccess("");
    setMissingApiKey(false);
    setIsAiCardOpen(false);
    setLastFocusedField("prefix");
    setIsModalOpen(true);
  };

  const handleInsertTag = (tag: string) => {
    if (lastFocusedField === "prefix") {
      setFormPrefix((prev) => (prev ? `${prev} ${tag}` : tag));
    } else {
      setFormSuffix((prev) => (prev ? `${prev} ${tag}` : tag));
    }
  };

  const handleGenerateWithAI = async (promptToUse?: string) => {
    const text = (promptToUse || aiPrompt).trim();
    if (!text) {
      setAiError("Por favor, digite uma descrição para a IA gerar o modelo.");
      return;
    }

    setIsGeneratingAI(true);
    setAiError("");
    setAiSuccess("");
    setMissingApiKey(false);

    try {
      const res = await fetch("/api/ai/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.missingApiKey) {
          setMissingApiKey(true);
        }
        throw new Error(data.error || "Erro ao gerar modelo com IA");
      }

      if (data.template) {
        setFormTitle(data.template.title);
        setFormPrefix(data.template.prefixText);
        setFormSuffix(data.template.suffixText);
        setFormIsAbsence(Boolean(data.template.isAbsenceRelated));
        setAiSuccess("✨ Modelo preenchido automaticamente com IA! Revise os campos abaixo.");
      }
    } catch (err: any) {
      setAiError(err.message || "Erro de conexão com o serviço de IA.");
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle) {
      setFormError("Título do motivo é obrigatório.");
      return;
    }

    setIsSubmitting(true);
    setFormError("");

    try {
      if (editingTemplate) {
        const res = await fetch("/api/templates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingTemplate.id,
            title: formTitle,
            segment: formSegment,
            prefixText: formPrefix,
            suffixText: formSuffix,
            isAbsenceRelated: formIsAbsence,
          }),
        });
        const updated = await res.json();
        if (!res.ok) throw new Error(updated.error || "Erro ao atualizar");
        setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } else {
        const res = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle,
            segment: formSegment,
            prefixText: formPrefix,
            suffixText: formSuffix,
            isAbsenceRelated: formIsAbsence,
          }),
        });
        const created = await res.json();
        if (!res.ok) throw new Error(created.error || "Erro ao criar");
        setTemplates((prev) => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || "Erro ao salvar modelo");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sample student for modal live preview
  const sampleStudent = {
    name: "LUCAS SILVA PEREIRA",
    classGroup: {
      name: previewShift === "NOITE" ? "3º Série" : previewShift === "TARDE" ? "2º ADM" : "6º 1",
      segment: previewShift === "NOITE" ? "NOTURNO" : previewShift === "TARDE" ? "MEDIO" : "FUNDAMENTAL",
      shift: previewShift,
    },
    guardianName: "Mariana Silva",
  };

  const simulatedMessage = formatMessage(formPrefix, formSuffix, {
    student: sampleStudent,
    pedagogaName: "Pedagoga Leopoldina",
    overrideShift: previewShift,
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <FileText className="w-6 h-6 text-sky-600" />
            <span>Modelos de Mensagem Padronizados</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Modelos inteligentes com suporte a criação via <strong>Inteligência Artificial (Google Gemini)</strong> e adaptação automática por período.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center space-x-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-sm transition"
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>Criar Novo Modelo (com IA)</span>
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-xl p-4 text-xs text-slate-800 flex items-start space-x-3 shadow-2xs">
        <Sparkles className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-slate-900">Novo: Criador Inteligente de Modelos com IA</p>
          <p className="text-slate-600 leading-relaxed">
            Ao criar um modelo, você pode simplesmente descrever em linguagem comum o que deseja avisar (ex: <em>&ldquo;reunião de pais quinta às 18h30&rdquo;</em>). A IA do <strong>Google Gemini</strong> redige a mensagem com linguagem pedagógica acolhedora e formatação pronta para o WhatsApp.
          </p>
        </div>
      </div>

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {templates.map((tmpl) => (
          <div
            key={tmpl.id}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-md transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-bold text-slate-900 text-sm">{tmpl.title}</span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {tmpl.segment === "TODOS" ? "Todos os Níveis" : tmpl.segment}
                </span>
              </div>

              {tmpl.isAbsenceRelated && (
                <div className="mb-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                    Contabiliza no Ranking de Faltas
                  </span>
                </div>
              )}

              <div className="space-y-2 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div>
                  <span className="font-semibold text-slate-700 block text-[11px]">Texto antes do aluno:</span>
                  <p className="italic line-clamp-2 mt-0.5">{tmpl.prefixText || "(vazio)"}</p>
                </div>
                <div className="pt-1 border-t border-slate-200/60">
                  <span className="font-semibold text-slate-700 block text-[11px]">Texto depois do aluno:</span>
                  <p className="italic line-clamp-3 mt-0.5">{tmpl.suffixText || "(vazio)"}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => openEditModal(tmpl)}
                className="inline-flex items-center text-xs font-bold text-sky-600 hover:text-sky-800"
              >
                <Edit className="w-3.5 h-3.5 mr-1" /> Editar Modelo
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de Criação / Edição */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <FileText className="w-5 h-5 text-sky-600" />
                <span>{editingTemplate ? "Editar Modelo de Mensagem" : "Criar Novo Modelo de Mensagem"}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* AI Assistant Generator Card */}
            <div className="bg-gradient-to-br from-indigo-50/80 via-purple-50/40 to-sky-50/80 border border-indigo-200 rounded-xl p-4 shadow-xs space-y-3">
              <div 
                className="flex items-center justify-between cursor-pointer select-none"
                onClick={() => setIsAiCardOpen(!isAiCardOpen)}
              >
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                    <Wand2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-extrabold text-indigo-950 text-xs block">
                      Criador Inteligente com IA (Google Gemini)
                    </span>
                    <span className="text-[11px] text-indigo-700">
                      Descreva a mensagem em linguagem natural e a IA redige para você
                    </span>
                  </div>
                </div>
                <button type="button" className="text-indigo-600 hover:text-indigo-800 p-1">
                  {isAiCardOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {isAiCardOpen && (
                <div className="space-y-3 pt-2 border-t border-indigo-100 text-xs">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleGenerateWithAI();
                        }
                      }}
                      placeholder="Ex: Aviso pedindo atestado médico após 2 dias de faltas consecutivas..."
                      className="flex-1 p-2.5 bg-white border border-indigo-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleGenerateWithAI()}
                      disabled={isGeneratingAI}
                      className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center space-x-1.5 shadow-xs disabled:opacity-50"
                    >
                      {isGeneratingAI ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Redigindo...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-amber-300" />
                          <span>Gerar com IA</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Quick Ideas Chips */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider block">
                      Ideias rápidas para testar:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        "Aviso de entrega de boletins na quinta às 18h30",
                        "Solicitação de atestado médico para justificar ausências",
                        "Notificação preventiva de faltas antes do Conselho Tutelar",
                        "Recado sobre uso obrigatório do uniforme escolar",
                        "Convite para a Mostra Cultural no sábado de manhã",
                      ].map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => {
                            setAiPrompt(idea);
                            handleGenerateWithAI(idea);
                          }}
                          className="px-2 py-1 rounded bg-white hover:bg-indigo-100 border border-indigo-200 text-indigo-900 text-[10px] font-medium transition shadow-2xs"
                        >
                          + {idea}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Feedback Messages */}
                  {aiSuccess && (
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
                      <Check className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                      <span>{aiSuccess}</span>
                    </div>
                  )}

                  {aiError && (
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs space-y-1">
                      <div className="flex items-center space-x-2 font-bold">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>{aiError}</span>
                      </div>
                      {missingApiKey && (
                        <p className="text-[11px] text-rose-600 pl-6">
                          Para ativar a IA gratuitamente, gere sua chave no{" "}
                          <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline font-bold inline-flex items-center hover:text-rose-900"
                          >
                            Google AI Studio <ExternalLink className="w-3 h-3 ml-0.5" />
                          </a>{" "}
                          e adicione como <code>GEMINI_API_KEY</code> na Vercel.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Motivo / Título do Modelo:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: CONVOCAÇÃO URGENTE"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value.toUpperCase())}
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white uppercase font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Nível de Aplicação:
                  </label>
                  <select
                    value={formSegment}
                    onChange={(e) => setFormSegment(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="TODOS">Todos os Níveis (Recomendado)</option>
                    <option value="FUNDAMENTAL">Apenas Ensino Fundamental</option>
                    <option value="MEDIO">Apenas Ensino Médio</option>
                    <option value="NOTURNO">Apenas Ensino Noturno</option>
                  </select>
                </div>
              </div>

              {/* Tag Insertion Palette */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 text-[11px] flex items-center space-x-1">
                    <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                    <span>Inserir Variável Inteligente (clique para adicionar no campo ativo):</span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Alvo atual: <strong>{lastFocusedField === "prefix" ? "Antes do Aluno" : "Depois do Aluno"}</strong>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { tag: "{saudacao}", desc: "Bom dia / Boa tarde / Boa noite" },
                    { tag: "{aluno}", desc: "Nome do aluno" },
                    { tag: "{turma}", desc: "Turma do aluno" },
                    { tag: "{responsavel}", desc: "Nome do responsável" },
                    { tag: "{pedagoga}", desc: "Nome da pedagoga" },
                    { tag: "{periodo}", desc: "matutino / vespertino / noturno" },
                  ].map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => handleInsertTag(item.tag)}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-sky-700 font-mono text-[11px] font-bold shadow-2xs transition"
                      title={item.desc}
                    >
                      + {item.tag}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Texto antes da identificação do aluno:
                </label>
                <textarea
                  rows={3}
                  value={formPrefix}
                  onFocus={() => setLastFocusedField("prefix")}
                  onChange={(e) => setFormPrefix(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-sky-500 font-sans"
                  placeholder="Ex: {saudacao} Registramos a ausência do(a) aluno(a)"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Texto depois da identificação do aluno:
                </label>
                <textarea
                  rows={4}
                  value={formSuffix}
                  onFocus={() => setLastFocusedField("suffix")}
                  onChange={(e) => setFormSuffix(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-sky-500 font-sans"
                  placeholder="Ex: hoje. Poderia nos informar o motivo? Atenciosamente, {pedagoga}."
                />
              </div>

              {/* Live Preview Simulator */}
              <div className="p-4 bg-slate-100/70 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-[11px]">
                    Simulação em Tempo Real da Mensagem:
                  </span>
                  <div className="flex items-center space-x-1 bg-white p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setPreviewShift("MANHA")}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-1 ${
                        previewShift === "MANHA" ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <Sun className="w-3 h-3" />
                      <span>Manhã</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewShift("TARDE")}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-1 ${
                        previewShift === "TARDE" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <Sunset className="w-3 h-3" />
                      <span>Tarde</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewShift("NOITE")}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-1 ${
                        previewShift === "NOITE" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <Moon className="w-3 h-3" />
                      <span>Noite</span>
                    </button>
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200 text-[11px] whitespace-pre-wrap font-sans text-slate-800 shadow-inner">
                  {simulatedMessage || "(Preencha os campos acima para ver a prévia)"}
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="isAbsence"
                  checked={formIsAbsence}
                  onChange={(e) => setFormIsAbsence(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500 w-4 h-4"
                />
                <label htmlFor="isAbsence" className="text-slate-700 font-medium">
                  Este modelo refere-se a faltas / infrequência escolar (contabiliza no ranking de faltas)
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-xs"
                >
                  {isSubmitting ? "Gravando..." : "Salvar Modelo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
