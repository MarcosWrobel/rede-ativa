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
  ToggleRight
} from "lucide-react";

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

  const openCreateModal = () => {
    setEditingTemplate(null);
    setFormTitle("");
    setFormSegment("TODOS");
    setFormPrefix("Prezados pais e/ou responsáveis, informamos que o(a) aluno(a)");
    setFormSuffix("Atenciosamente,\nEquipe Pedagógica — Colégio Leopoldina");
    setFormIsAbsence(false);
    setFormError("");
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
    setIsModalOpen(true);
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
            Gerencie os textos padrão das mensagens sem risco de corrupção ou quebra de fórmulas.
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
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  {tmpl.segment}
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
                  <span className="font-semibold text-slate-700 block text-[11px]">Texto antes do nome:</span>
                  <p className="italic line-clamp-2 mt-0.5">{tmpl.prefixText || "(vazio)"}</p>
                </div>
                <div className="pt-1 border-t border-slate-200/60">
                  <span className="font-semibold text-slate-700 block text-[11px]">Texto depois do nome:</span>
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

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              {editingTemplate ? "Editar Modelo de Mensagem" : "Criar Novo Modelo de Mensagem"}
            </h3>

            {formError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Motivo / Título do Modelo:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: CONVOCAÇÃO URGENTE"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value.toUpperCase())}
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white uppercase"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Nível de Aplicação:
                </label>
                <select
                  value={formSegment}
                  onChange={(e) => setFormSegment(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                >
                  <option value="TODOS">Todos os Níveis</option>
                  <option value="FUNDAMENTAL">Ensino Fundamental</option>
                  <option value="MEDIO">Ensino Médio</option>
                  <option value="NOTURNO">Ensino Noturno</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Texto antes do nome do aluno:
                </label>
                <textarea
                  rows={2}
                  value={formPrefix}
                  onChange={(e) => setFormPrefix(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Texto depois do nome do aluno:
                </label>
                <textarea
                  rows={4}
                  value={formSuffix}
                  onChange={(e) => setFormSuffix(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
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
                <label htmlFor="isAbsence" className="text-slate-700 font-medium">
                  Este modelo refere-se a faltas / infrequência escolar (contar no ranking de faltas)
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
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
