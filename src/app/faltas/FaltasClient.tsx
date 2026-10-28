"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { 
  AlertTriangle, 
  Send, 
  Search, 
  Flame, 
  ShieldAlert, 
  CheckCircle, 
  Edit3, 
  ExternalLink,
  Users
} from "lucide-react";

interface Props {
  rankedAbsences: any[];
  lowAttendance: any[];
  classGroups: any[];
}

export default function FaltasClient({ rankedAbsences, lowAttendance, classGroups }: Props) {
  const [activeTab, setActiveTab] = useState<"ranking" | "serp">("ranking");
  const [selectedSegment, setSelectedSegment] = useState("TODOS");
  const [selectedTurma, setSelectedTurma] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Edit action modal
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [actionText, setActionText] = useState("");
  const [percentText, setPercentText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [recordsList, setRecordsList] = useState(lowAttendance);

  // Filter ranked absences
  const filteredRanked = useMemo(() => {
    return rankedAbsences.filter((item) => {
      const st = item.student;
      const matchSearch =
        !searchTerm || st.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchSegment =
        selectedSegment === "TODOS" || st.classGroup.segment === selectedSegment;
      const matchTurma = !selectedTurma || st.classGroupId === selectedTurma;
      return matchSearch && matchSegment && matchTurma;
    });
  }, [rankedAbsences, searchTerm, selectedSegment, selectedTurma]);

  // Filter low attendance records
  const filteredLowAttendance = useMemo(() => {
    return recordsList.filter((rec) => {
      const st = rec.student;
      const matchSearch =
        !searchTerm ||
        st.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (rec.actionsTaken && rec.actionsTaken.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchSegment =
        selectedSegment === "TODOS" || st.classGroup.segment === selectedSegment;
      const matchTurma = !selectedTurma || st.classGroupId === selectedTurma;
      return matchSearch && matchSegment && matchTurma;
    });
  }, [recordsList, searchTerm, selectedSegment, selectedTurma]);

  const handleSaveAction = async () => {
    if (!editingRecord) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/low-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: editingRecord.student.id,
          attendancePercent: percentText,
          enrollmentDetail: editingRecord.enrollmentDetail,
          actionsTaken: actionText,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setRecordsList((prev) =>
          prev.map((r) => (r.id === editingRecord.id ? updated : r))
        );
        setEditingRecord(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <span>Controle de Faltas & Busca Ativa (SERP / CT)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitoramento prioritário de alunos infrequentes e acompanhamento de medidas protetivas.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex p-1 bg-slate-200 rounded-xl space-x-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab("ranking")}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === "ranking"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Ranking de Faltas ({rankedAbsences.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("serp")}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === "serp"
                ? "bg-white text-amber-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Busca Ativa & CT ({recordsList.length})
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Buscar por nome do aluno..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <select
            value={selectedSegment}
            onChange={(e) => {
              setSelectedSegment(e.target.value);
              setSelectedTurma("");
            }}
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
          >
            <option value="TODOS">Todos os Níveis</option>
            <option value="FUNDAMENTAL">Ensino Fundamental</option>
            <option value="MEDIO">Ensino Médio</option>
            <option value="NOTURNO">Ensino Noturno</option>
          </select>

          <select
            value={selectedTurma}
            onChange={(e) => setSelectedTurma(e.target.value)}
            className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:bg-white"
          >
            <option value="">Todas as Turmas</option>
            {classGroups
              .filter(
                (cg) => selectedSegment === "TODOS" || cg.segment === selectedSegment
              )
              .map((cg) => (
                <option key={cg.id} value={cg.id}>
                  {cg.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* TAB 1: Ranking de Faltas */}
      {activeTab === "ranking" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
              <Flame className="w-4 h-4 text-red-500" />
              <span>Alunos com Maior Frequência de Contatos por Falta</span>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {filteredRanked.length} alunos listados
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100/70 text-slate-500 uppercase font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 w-16 text-center">Posição</th>
                  <th className="px-4 py-3">Aluno</th>
                  <th className="px-4 py-3">Turma</th>
                  <th className="px-4 py-3">Nível</th>
                  <th className="px-4 py-3 text-center">Total Contatos (Faltas)</th>
                  <th className="px-4 py-3">Último Acionamento</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRanked.map((item, idx) => (
                  <tr key={item.student.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 text-center font-bold text-slate-400">
                      {idx === 0 && <span className="text-red-600 font-extrabold">1º</span>}
                      {idx === 1 && <span className="text-amber-600 font-extrabold">2º</span>}
                      {idx === 2 && <span className="text-amber-500 font-extrabold">3º</span>}
                      {idx > 2 && `${idx + 1}º`}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {item.student.name}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">
                      {item.student.classGroup.name}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {item.student.classGroup.segment}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-3 py-1 rounded-full font-extrabold text-xs ${
                        item.count >= 10
                          ? "bg-red-100 text-red-700 border border-red-200"
                          : item.count >= 5
                          ? "bg-amber-100 text-amber-800 border border-amber-200"
                          : "bg-slate-100 text-slate-700"
                      }`}>
                        {item.count} contatos
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(item.lastDate).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/busca-ativa`}
                        className="inline-flex items-center text-xs font-bold text-sky-600 hover:text-sky-800 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100 hover:bg-sky-100 transition"
                      >
                        <Send className="w-3 h-3 mr-1" /> Enviar Mensagem
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Busca Ativa SERP / Conselho Tutelar */}
      {activeTab === "serp" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-amber-50/60 border-b border-amber-200 flex items-center justify-between">
            <div className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center space-x-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Acompanhamento de Baixa Frequência & Medidas Protetivas (Conselho Tutelar)</span>
            </div>
            <span className="text-xs text-amber-800 font-medium">
              {filteredLowAttendance.length} casos registrados
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100/70 text-slate-500 uppercase font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Aluno</th>
                  <th className="px-4 py-3">Turma</th>
                  <th className="px-4 py-3 text-center">Frequência (%)</th>
                  <th className="px-4 py-3">Detalhe Matrícula / Cálculo</th>
                  <th className="px-4 py-3">Ações Tomadas (SERP / CT / EJA)</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLowAttendance.map((rec) => {
                  const freq = rec.attendancePercent;
                  const isCritical = freq < 50;
                  const isWarning = freq >= 50 && freq < 75;

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {rec.student.name}
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-medium">
                        {rec.student.classGroup.name}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-full font-bold text-xs ${
                          isCritical
                            ? "bg-red-100 text-red-800 border border-red-200"
                            : isWarning
                            ? "bg-amber-100 text-amber-800 border border-amber-200"
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {freq}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 italic">
                        {rec.enrollmentDetail || "Matrícula regular"}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {rec.actionsTaken ? (
                          <span className="inline-block px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                            {rec.actionsTaken}
                          </span>
                        ) : (
                          <span className="text-slate-400">Nenhuma ação anotada</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRecord(rec);
                            setActionText(rec.actionsTaken || "");
                            setPercentText(String(rec.attendancePercent || ""));
                          }}
                          className="inline-flex items-center text-xs font-bold text-sky-600 hover:text-sky-800 hover:underline"
                        >
                          <Edit3 className="w-3 h-3 mr-1" /> Atualizar Ações
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Action Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Atualizar Acompanhamento (Busca Ativa)
            </h3>
            <p className="text-xs text-slate-600">
              Aluno: <strong>{editingRecord.student.name}</strong> ({editingRecord.student.classGroup.name})
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Frequência Escolar (%):
              </label>
              <input
                type="number"
                step="0.01"
                value={percentText}
                onChange={(e) => setPercentText(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-slate-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Ações Tomadas (Encaminhamentos / SERP / CT):
              </label>
              <textarea
                rows={4}
                value={actionText}
                onChange={(e) => setActionText(e.target.value)}
                placeholder="Ex: 4 buscas SERP realizadas - Encaminhado ao Conselho Tutelar via protocolo 1234/2026..."
                className="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveAction}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs"
              >
                {isSaving ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
