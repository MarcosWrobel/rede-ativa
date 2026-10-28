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
  X
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

  const openCreateModal = () => {
    setEditingTemplate(null);
    setFormTitle("");
    setFormSegment("TODOS");
    setFormPrefix("{saudacao}\nPrezados responsáveis, informamos que o(a) aluno(a)");
    setFormSuffix("Atenciosamente,\nEquipe Pedagógica — Colégio Leopoldina");
    setFormIsAbsence(false);
    setFormError("");
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
            <span>Modelos de Mensagem Unificados</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Modelos inteligentes sem duplicidade, com adaptação automática ao período (manhã, tarde e noite) e aos dados do aluno.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center space-x-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Modelo de Mensagem</span>
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 text-xs text-sky-900 flex items-start space-x-3">
        <Sparkles className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold">Como funciona a adaptação por período?</p>
          <p className="text-sky-800 leading-relaxed">
            Você não precisa mais criar uma mensagem para o Fundamental, outra para o Médio e outra para o Noturno.
            Insira a tag <code className="bg-sky-100 text-sky-900 font-mono px-1 py-0.5 rounded font-bold">{"{saudacao}"}</code> e o sistema aplicará automaticamente <strong>Bom dia!</strong>, <strong>Boa tarde!</strong> ou <strong>Boa noite!</strong> dependendo da turma do aluno ou horário de envio.
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
