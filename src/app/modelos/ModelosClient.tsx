"use client";

import { useState, useEffect } from "react";
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
  ChevronUp,
  Key
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
  const [customApiKey, setCustomApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testKeyResult, setTestKeyResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("leopoldina_gemini_api_key");
      if (saved) setCustomApiKey(saved);
    } catch (e) {}
  }, []);

  const handleSaveCustomKey = (key: string) => {
    setCustomApiKey(key);
    try {
      localStorage.setItem("leopoldina_gemini_api_key", key.trim());
    } catch (e) {}
  };

  const handleTestKey = async () => {
    setIsTestingKey(true);
    setTestKeyResult(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (customApiKey && customApiKey.trim().length > 10) {
        headers["x-gemini-key"] = customApiKey.trim();
      }
      const res = await fetch("/api/ai/test-key", {
        method: "POST",
        headers,
        body: JSON.stringify({ apiKey: customApiKey }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestKeyResult({
          ok: true,
          message: `✨ ${data.message} Modelo: ${data.respondingModel} respondeu em ${data.durationMs}ms (Origem: ${data.source.replace(/_/g, " ")}, chave ${data.maskedKey})`,
        });
      } else {
        setTestKeyResult({
          ok: false,
          message: data.error || "Falha ao validar chave com o Google.",
        });
      }
    } catch (err: any) {
      setTestKeyResult({
        ok: false,
        message: err.message || "Erro ao conectar com servidor de teste.",
      });
    } finally {
      setIsTestingKey(false);
    }
  };

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout max

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (customApiKey && customApiKey.trim().length > 10) {
        headers["x-gemini-key"] = customApiKey.trim();
      }

      const res = await fetch("/api/ai/generate-template", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ prompt: text }),
      });

      clearTimeout(timeoutId);

      const data = await res.json();
      if (!res.ok) {
        if (data.missingApiKey) {
          setMissingApiKey(true);
          setShowKeyInput(true);
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
      if (err.name === "AbortError") {
        setAiError("A requisição demorou para responder. Verifique sua chave ou tente novamente.");
      } else {
        setAiError(err.message || "Erro de conexão com o serviço de IA.");
      }
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

      {/* Modal de Criação / Edição com Layout Bi-Coluna e Rodapé Fixo */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl max-w-5xl w-full flex flex-col max-h-[90vh] shadow-2xl border border-slate-200 overflow-hidden">
            {/* 1. Cabeçalho Fixo */}
            <div className="flex-none px-5 sm:px-6 py-3.5 border-b border-slate-200 bg-white flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <FileText className="w-5 h-5 text-sky-600" />
                <span>{editingTemplate ? "Editar Modelo de Mensagem" : "Criar Novo Modelo de Mensagem"}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 2. Formulário e Corpo com Rolagem Interna e 2 Colunas */}
            <form id="template-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
                {/* COLUNA ESQUERDA (Edição, IA e Campos) - 7 colunas */}
                <div className="lg:col-span-7 space-y-4">
                  {/* AI Assistant Generator Card */}
                  <div className="bg-gradient-to-br from-indigo-50/80 via-purple-50/40 to-sky-50/80 border border-indigo-200 rounded-xl p-3.5 shadow-2xs space-y-2.5">
                    <div 
                      className="flex items-center justify-between cursor-pointer select-none"
                      onClick={() => setIsAiCardOpen(!isAiCardOpen)}
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                          <Wand2 className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="font-extrabold text-indigo-950 text-xs block leading-tight">
                            Redação com Inteligência Artificial (Google Gemini)
                          </span>
                          <span className="text-[10px] text-indigo-700">
                            Digite sua necessidade em linguagem natural
                          </span>
                        </div>
                      </div>
                      <button type="button" className="text-indigo-600 hover:text-indigo-800 p-1">
                        {isAiCardOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>

                    {isAiCardOpen && (
                      <div className="space-y-2.5 pt-2 border-t border-indigo-100 text-xs">
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
                            className="flex-1 p-2 bg-white border border-indigo-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleGenerateWithAI()}
                            disabled={isGeneratingAI}
                            className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center space-x-1.5 shadow-xs disabled:opacity-50"
                          >
                            {isGeneratingAI ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Redigindo...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                                <span>Gerar com IA</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Quick Ideas Chips */}
                        <div className="flex flex-wrap gap-1">
                          {[
                            "Aviso de entrega de boletins",
                            "Atestado médico para faltas",
                            "Notificação antes do Conselho Tutelar",
                            "Uso obrigatório de uniforme",
                            "Convite para Reunião de Pais",
                          ].map((idea) => (
                            <button
                              key={idea}
                              type="button"
                              onClick={() => {
                                setAiPrompt(idea);
                                handleGenerateWithAI(idea);
                              }}
                              className="px-2 py-0.5 rounded bg-white hover:bg-indigo-100 border border-indigo-200 text-indigo-900 text-[10px] font-medium transition shadow-2xs"
                            >
                              + {idea}
                            </button>
                          ))}
                        </div>

                        {/* Chave de API opcional */}
                        <div className="pt-1 border-t border-indigo-100 flex items-center justify-between text-[10px]">
                          <button
                            type="button"
                            onClick={() => setShowKeyInput(!showKeyInput)}
                            className="text-indigo-700 hover:text-indigo-900 font-bold inline-flex items-center space-x-1"
                          >
                            <Key className="w-3 h-3" />
                            <span>{showKeyInput ? "Ocultar configuração da Chave" : "Configurar / Colar Chave Gemini"}</span>
                          </button>
                          {customApiKey && (
                            <span className="text-emerald-700 font-semibold flex items-center">
                              <Check className="w-3 h-3 mr-0.5 text-emerald-600" /> Chave ativa
                            </span>
                          )}
                        </div>

                        {showKeyInput && (
                          <div className="p-2 bg-white border border-indigo-200 rounded-lg space-y-1.5">
                            <div className="flex gap-1.5">
                              <input
                                type="password"
                                value={customApiKey}
                                onChange={(e) => handleSaveCustomKey(e.target.value)}
                                placeholder="Cole sua chave AIzaSy..."
                                className="flex-1 p-1.5 border border-slate-300 rounded text-xs font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveCustomKey(customApiKey)}
                                className="px-2.5 py-1 bg-slate-800 text-white rounded text-[10px] font-bold hover:bg-slate-900"
                              >
                                Salvar
                              </button>
                              <button
                                type="button"
                                onClick={handleTestKey}
                                disabled={isTestingKey}
                                className="px-2.5 py-1 bg-indigo-600 text-white rounded text-[10px] font-bold hover:bg-indigo-700 flex items-center space-x-1 disabled:opacity-50"
                              >
                                {isTestingKey ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <span>Testar</span>
                                )}
                              </button>
                            </div>
                            {testKeyResult && (
                              <div
                                className={`p-1.5 rounded text-[11px] border flex items-start space-x-1.5 ${
                                  testKeyResult.ok
                                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                    : "bg-rose-50 border-rose-200 text-rose-800"
                                }`}
                              >
                                {testKeyResult.ok ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                ) : (
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0 mt-0.5" />
                                )}
                                <span className="leading-snug">{testKeyResult.message}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Feedback Messages */}
                        {aiSuccess && (
                          <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-1.5">
                            <Check className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
                            <span>{aiSuccess}</span>
                          </div>
                        )}

                        {aiError && (
                          <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{aiError}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {/* Campos Principais */}
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
                        className="w-full p-2 border border-slate-300 rounded-lg bg-white uppercase font-bold focus:ring-2 focus:ring-sky-500"
                      />
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Nível de Aplicação:
                      </label>
                      <select
                        value={formSegment}
                        onChange={(e) => setFormSegment(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg bg-white font-medium"
                      >
                        <option value="TODOS">Todos os Níveis (Recomendado)</option>
                        <option value="FUNDAMENTAL">Apenas Ensino Fundamental</option>
                        <option value="MEDIO">Apenas Ensino Médio</option>
                        <option value="NOTURNO">Apenas Ensino Noturno</option>
                      </select>
                    </div>
                  </div>

                  {/* Paleta de Variáveis Inteligentes */}
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700 text-[10px] flex items-center space-x-1">
                        <Sparkles className="w-3 h-3 text-sky-600" />
                        <span>Variáveis Rápidas (inserir no campo ativo):</span>
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Alvo: <strong>{lastFocusedField === "prefix" ? "Antes do Aluno" : "Depois do Aluno"}</strong>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
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
                          className="px-2 py-0.5 rounded-md bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-sky-700 font-mono text-[10px] font-bold shadow-2xs transition"
                          title={item.desc}
                        >
                          + {item.tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Textos da Mensagem */}
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      Texto antes da identificação do aluno:
                    </label>
                    <textarea
                      rows={2}
                      value={formPrefix}
                      onFocus={() => setLastFocusedField("prefix")}
                      onChange={(e) => setFormPrefix(e.target.value)}
                      className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-sky-500 font-sans"
                      placeholder="Ex: {saudacao} Registramos a ausência do(a) aluno(a)"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      Texto depois da identificação do aluno:
                    </label>
                    <textarea
                      rows={3}
                      value={formSuffix}
                      onFocus={() => setLastFocusedField("suffix")}
                      onChange={(e) => setFormSuffix(e.target.value)}
                      className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-sky-500 font-sans"
                      placeholder="Ex: hoje. Poderia nos informar o motivo? Atenciosamente, {pedagoga}."
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-1">
                    <input
                      type="checkbox"
                      id="isAbsence"
                      checked={formIsAbsence}
                      onChange={(e) => setFormIsAbsence(e.target.checked)}
                      className="rounded text-sky-600 focus:ring-sky-500 w-4 h-4"
                    />
                    <label htmlFor="isAbsence" className="text-slate-700 font-medium text-xs">
                      Este modelo é de <strong>infrequência / falta escolar</strong> (contabiliza no ranking)
                    </label>
                  </div>
                </div>

                {/* COLUNA DIREITA (Simulador Visual WhatsApp em Tempo Real) - 5 colunas */}
                <div className="lg:col-span-5 flex flex-col space-y-3">
                  <div className="bg-slate-100 border border-slate-200 rounded-xl p-3.5 flex-1 flex flex-col space-y-2.5">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="font-bold text-slate-800 text-[11px] flex items-center space-x-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Prévia em Tempo Real (WhatsApp)</span>
                      </span>

                      {/* Alternador de Turno */}
                      <div className="flex items-center space-x-1 bg-white p-0.5 rounded-lg border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setPreviewShift("MANHA")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-0.5 ${
                            previewShift === "MANHA" ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-100"
                          }`}
                          title="Simular Turno da Manhã"
                        >
                          <Sun className="w-2.5 h-2.5" />
                          <span>M</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewShift("TARDE")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-0.5 ${
                            previewShift === "TARDE" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"
                          }`}
                          title="Simular Turno da Tarde"
                        >
                          <Sunset className="w-2.5 h-2.5" />
                          <span>T</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewShift("NOITE")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-0.5 ${
                            previewShift === "NOITE" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
                          }`}
                          title="Simular Turno da Noite"
                        >
                          <Moon className="w-2.5 h-2.5" />
                          <span>N</span>
                        </button>
                      </div>
                    </div>

                    {/* Balão Visual do WhatsApp */}
                    <div className="flex-1 bg-[#efeae2] p-3 rounded-xl border border-slate-300/80 overflow-y-auto max-h-[280px] lg:max-h-[360px] flex flex-col justify-end">
                      <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-xs border border-slate-200 text-slate-800 text-[11px] leading-relaxed whitespace-pre-wrap font-sans relative">
                        {simulatedMessage || "(Preencha o formulário para visualizar como a mensagem será enviada à família)"}
                        <div className="text-[9px] text-slate-400 text-right mt-1.5">
                          12:00 • Enviado via WhatsApp
                        </div>
                      </div>
                    </div>

                    {/* Dica Pedagógica */}
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-[10px] text-slate-500 space-y-1">
                      <div className="font-bold text-slate-700 flex items-center space-x-1">
                        <Info className="w-3 h-3 text-sky-600" />
                        <span>Dica de Redação Pedagógica:</span>
                      </div>
                      <p>
                        A tag <code className="bg-slate-100 px-1 py-0.5 rounded text-sky-700">{"{saudacao}"}</code> adapta automaticamente para *"Bom dia"*, *"Boa tarde"* ou *"Boa noite"* de acordo com o horário do envio.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </form>

            {/* 3. Rodapé Fixo (Permanentemente visível) */}
            <div className="flex-none px-5 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                Pressione <strong>Salvar Modelo</strong> para concluir as alterações.
              </span>

              <div className="flex items-center space-x-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="template-form"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Gravando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Salvar Modelo</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
