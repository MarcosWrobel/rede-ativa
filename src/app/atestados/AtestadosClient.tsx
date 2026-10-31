"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Stethoscope,
  Calendar,
  Search,
  Plus,
  CheckCircle2,
  AlertCircle,
  Trash2,
  UserCheck,
  FileText,
  Clock,
  Sparkles,
  ArrowRight,
  X,
  Filter
} from "lucide-react";
import { JUSTIFICATION_TYPE_LABELS } from "@/lib/pedagogicalClassifier";

interface StudentOption {
  id: string;
  name: string;
  cgm: string | null;
  classGroupId: string | null;
  classGroup: { id: string; name: string } | null;
}

interface Props {
  initialJustifications: any[];
  initialMetrics: {
    total: number;
    active: number;
    expired: number;
  };
  classes: any[];
  students: StudentOption[];
  todayStr: string;
}

export default function AtestadosClient({
  initialJustifications,
  initialMetrics,
  classes,
  students,
  todayStr,
}: Props) {
  const [justifications, setJustifications] = useState(initialJustifications);
  const [metrics, setMetrics] = useState(initialMetrics);

  // --- Estado do Formulário de Lançamento Rápido ---
  const [selectedStudent, setSelectedStudent] = useState<StudentOption | null>(null);
  const [studentSearchInput, setStudentSearchInput] = useState("");
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const [formTurmaFilter, setFormTurmaFilter] = useState("ALL");

  const [type, setType] = useState("ATESTADO_MEDICO");
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [cidCode, setCidCode] = useState("");
  const [notes, setNotes] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccessMsg, setFormSuccessMsg] = useState<string | null>(null);

  const studentSearchRef = useRef<HTMLInputElement>(null);

  // --- Filtros da Tabela de Atestados ---
  const [tableSearch, setTableSearch] = useState("");
  const [tableTurmaFilter, setTableTurmaFilter] = useState("ALL");
  const [tableStatusFilter, setTableStatusFilter] = useState("ACTIVE"); // ACTIVE | EXPIRED | ALL
  const [tableTypeFilter, setTableTypeFilter] = useState("ALL");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filtra alunos para o autocomplete do formulário
  const filteredStudentOptions = useMemo(() => {
    const q = studentSearchInput.toLowerCase().trim();
    return students.filter((s) => {
      if (formTurmaFilter !== "ALL" && s.classGroupId !== formTurmaFilter) return false;
      if (!q) return true;
      const matchName = s.name.toLowerCase().includes(q);
      const matchCgm = s.cgm ? s.cgm.toLowerCase().includes(q) : false;
      return matchName || matchCgm;
    }).slice(0, 10);
  }, [students, studentSearchInput, formTurmaFilter]);

  // Função auxiliar para calcular data final ao clicar em pílula de dias
  const handleApplyDuration = (days: number) => {
    try {
      const base = startDate ? new Date(`${startDate}T12:00:00.000-03:00`) : new Date();
      base.setDate(base.getDate() + (days - 1));
      const endStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(base);
      setEndDate(endStr);
    } catch (e) {}
  };

  // Salva atestado (mode: "close" ou "next")
  const handleSaveJustification = async (launchNext: boolean = false) => {
    setFormError(null);
    setFormSuccessMsg(null);

    if (!selectedStudent) {
      setFormError("Por favor, selecione o(a) estudante para lançar o atestado.");
      studentSearchRef.current?.focus();
      return;
    }

    if (!startDate || !endDate) {
      setFormError("Informe as datas inicial e final do atestado.");
      return;
    }

    if (startDate > endDate) {
      setFormError("A data final não pode ser anterior à data inicial.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/justifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          type,
          startDate,
          endDate,
          cidCode: cidCode.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao registrar atestado.");
      }

      // Adiciona o novo atestado na lista local
      setJustifications((prev) => [data.justification, ...prev]);
      setMetrics((prev) => ({
        ...prev,
        total: prev.total + 1,
        active: prev.active + 1,
      }));

      const studentName = selectedStudent.name;

      if (launchNext) {
        // Modo "Lançar Próximo": limpa aluno, cid e notas, mas preserva datas e tipo
        setSelectedStudent(null);
        setStudentSearchInput("");
        setCidCode("");
        setNotes("");
        setFormSuccessMsg(`✓ Atestado de ${studentName} lançado com sucesso! Pronto para o próximo.`);
        setTimeout(() => setFormSuccessMsg(null), 4000);
        studentSearchRef.current?.focus();
      } else {
        // Modo salvar normal: reseta o formulário
        setSelectedStudent(null);
        setStudentSearchInput("");
        setCidCode("");
        setNotes("");
        setFormSuccessMsg(`✓ Atestado de ${studentName} gravado com sucesso!`);
        setTimeout(() => setFormSuccessMsg(null), 5000);
      }
    } catch (err: any) {
      setFormError(err.message || "Erro de conexão ao salvar atestado.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Exclusão de atestado lançado com erro
  const handleDeleteJustification = async (id: string, studentName: string) => {
    if (!confirm(`Deseja realmente remover o atestado de ${studentName}?`)) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/justifications/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao remover atestado.");

      setJustifications((prev) => prev.filter((j) => j.id !== id));
      setMetrics((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
      }));
    } catch (err: any) {
      alert(err.message || "Não foi possível remover o atestado.");
    } finally {
      setDeletingId(null);
    }
  };

  // Filtragem da tabela de atestados
  const filteredJustifications = useMemo(() => {
    const q = tableSearch.toLowerCase().trim();
    const today = new Date(`${todayStr}T00:00:00.000-03:00`);

    return justifications.filter((j) => {
      // Filtro de Turma
      if (tableTurmaFilter !== "ALL" && j.student?.classGroup?.id !== tableTurmaFilter) {
        return false;
      }
      // Filtro de Tipo
      if (tableTypeFilter !== "ALL" && j.type !== tableTypeFilter) {
        return false;
      }
      // Filtro de Status
      const isEndActive = new Date(j.endDate) >= today;
      if (tableStatusFilter === "ACTIVE" && !isEndActive) return false;
      if (tableStatusFilter === "EXPIRED" && isEndActive) return false;

      // Busca textual
      if (!q) return true;
      const matchName = j.student?.name?.toLowerCase().includes(q);
      const matchCgm = j.student?.cgm?.toLowerCase().includes(q);
      const matchCid = j.cidCode?.toLowerCase().includes(q);
      const matchNotes = j.notes?.toLowerCase().includes(q);
      return matchName || matchCgm || matchCid || matchNotes;
    });
  }, [justifications, tableSearch, tableTurmaFilter, tableStatusFilter, tableTypeFilter, todayStr]);

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center shadow-inner">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              Atestados & Justificativas Escolares
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              Lançamento ágil de atestados médicos, declarações e monitoramento de vigência
            </p>
          </div>
        </div>

        {/* Métricas Compactas no Topo */}
        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-1.5 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">Vigentes Hoje</span>
            <span className="text-lg font-black text-emerald-900 leading-tight">{metrics.active}</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-1.5 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Total Registrado</span>
            <span className="text-lg font-black text-slate-800 leading-tight">{metrics.total}</span>
          </div>
        </div>
      </div>

      {/* PAINEL SUPERIOR: LANÇADOR RÁPIDO DE ATESTADOS */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-2xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900">
              Lançador Rápido de Atestados
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            Cadastre atestados de múltiplos estudantes sem navegar de tela em tela
          </span>
        </div>

        {formSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{formSuccessMsg}</span>
          </div>
        )}

        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Seletor de Estudante com Autocomplete */}
          <div className="md:col-span-5 space-y-1.5 relative">
            <label className="text-xs font-bold text-slate-700 block">
              1. Selecionar Estudante <span className="text-rose-500">*</span>
            </label>

            {selectedStudent ? (
              <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-extrabold text-sky-950">{selectedStudent.name}</p>
                  <p className="text-[10px] text-sky-700">
                    Turma: <strong>{selectedStudent.classGroup?.name || "Sem turma"}</strong>
                    {selectedStudent.cgm ? ` • CGM: ${selectedStudent.cgm}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStudent(null);
                    setStudentSearchInput("");
                    setTimeout(() => studentSearchRef.current?.focus(), 50);
                  }}
                  className="p-1 rounded-lg text-sky-700 hover:bg-sky-200/60 transition"
                  title="Trocar estudante"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <select
                    value={formTurmaFilter}
                    onChange={(e) => setFormTurmaFilter(e.target.value)}
                    className="w-1/3 py-2 px-2 text-xs border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700"
                  >
                    <option value="ALL">Todas Turmas</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      ref={studentSearchRef}
                      type="text"
                      placeholder="Nome ou CGM do aluno..."
                      value={studentSearchInput}
                      onChange={(e) => {
                        setStudentSearchInput(e.target.value);
                        setShowStudentDropdown(true);
                      }}
                      onFocus={() => setShowStudentDropdown(true)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                    />
                  </div>
                </div>

                {/* Dropdown de Autocomplete */}
                {showStudentDropdown && filteredStudentOptions.length > 0 && (
                  <div className="absolute left-0 right-0 z-30 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {filteredStudentOptions.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudent(st);
                          setShowStudentDropdown(false);
                          setStudentSearchInput("");
                        }}
                        className="w-full text-left p-2.5 hover:bg-slate-50 transition flex items-center justify-between text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900">{st.name}</p>
                          <p className="text-[10px] text-slate-500">
                            {st.classGroup?.name || "Sem turma"} {st.cgm ? `• CGM: ${st.cgm}` : ""}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          Selecionar
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tipo de Justificativa */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              2. Natureza / Tipo <span className="text-rose-500">*</span>
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full py-2 px-3 text-xs border border-slate-200 rounded-xl bg-white font-semibold text-slate-800"
            >
              <option value="ATESTADO_MEDICO">🩺 Atestado Médico</option>
              <option value="DECLARACAO_COMPARECIMENTO">📄 Declaração de Consulta</option>
              <option value="ATESTADO_ODONTOLOGICO">🦷 Atestado Odontológico</option>
              <option value="JUSTIFICATIVA_FAMILIAR">🏠 Justificativa Familiar</option>
              <option value="DISPENSA_LEGAL">⚖️ Dispensa Legal / Luto</option>
            </select>
          </div>

          {/* Período de Vigência + Pílulas de Duração */}
          <div className="md:col-span-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 block">
                3. Vigência (Início & Fim) <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-slate-400">Atalhos de duração:</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                className="p-2 text-xs border border-slate-200 rounded-xl bg-white font-medium text-slate-800"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="p-2 text-xs border border-slate-200 rounded-xl bg-white font-medium text-slate-800"
              />
            </div>

            {/* Pílulas de Duração em 1 Clique */}
            <div className="flex flex-wrap items-center gap-1 pt-1">
              {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleApplyDuration(d)}
                  className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-[10px] font-bold text-slate-600 border border-slate-200 transition cursor-pointer"
                  title={`Calcular ${d} dia(s) a partir do início`}
                >
                  +{d}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Linha Opcional: CID e Observações */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-slate-100">
          <div className="md:col-span-3 space-y-1">
            <label className="text-[11px] font-semibold text-slate-600 block">
              Código CID-10 <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              placeholder="Ex.: J06, Z00.0..."
              value={cidCode}
              onChange={(e) => setCidCode(e.target.value.toUpperCase())}
              className="w-full p-2 text-xs border border-slate-200 rounded-xl bg-white font-mono uppercase"
            />
          </div>

          <div className="md:col-span-5 space-y-1">
            <label className="text-[11px] font-semibold text-slate-600 block">
              Observações / Médico / CRM <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              placeholder="Ex.: Dr. Roberto Silva - CRM 23412 / Consulta de rotina..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2 text-xs border border-slate-200 rounded-xl bg-white"
            />
          </div>

          {/* Botões de Ação Duplo */}
          <div className="md:col-span-4 flex items-end justify-end gap-2.5 pt-4 md:pt-0">
            <button
              type="button"
              onClick={() => handleSaveJustification(false)}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? "Gravando..." : "Salvar Atestado"}
            </button>

            <button
              type="button"
              onClick={() => handleSaveJustification(true)}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              title="Salva este atestado e mantém a tela pronta para o próximo estudante"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Salvar & Lançar Próximo</span>
            </button>
          </div>
        </div>
      </div>

      {/* PAINEL INFERIOR: TABELA CENTRAL DE ATESTADOS DA ESCOLA */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900">
              Atestados Registrados na Unidade Escolar
            </h2>
            <p className="text-xs text-slate-500">
              Total de {filteredJustifications.length} registro(s) encontrados com os filtros atuais
            </p>
          </div>

          {/* Filtros em Abas de Status */}
          <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-bold text-slate-600">
            <button
              type="button"
              onClick={() => setTableStatusFilter("ACTIVE")}
              className={`px-3 py-1.5 rounded-lg transition ${
                tableStatusFilter === "ACTIVE" ? "bg-white text-emerald-800 shadow-2xs font-extrabold" : "hover:text-slate-900"
              }`}
            >
              🟢 Vigentes ({metrics.active})
            </button>
            <button
              type="button"
              onClick={() => setTableStatusFilter("EXPIRED")}
              className={`px-3 py-1.5 rounded-lg transition ${
                tableStatusFilter === "EXPIRED" ? "bg-white text-slate-800 shadow-2xs font-extrabold" : "hover:text-slate-900"
              }`}
            >
              ⚪ Encerrados ({metrics.expired})
            </button>
            <button
              type="button"
              onClick={() => setTableStatusFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg transition ${
                tableStatusFilter === "ALL" ? "bg-white text-slate-800 shadow-2xs font-extrabold" : "hover:text-slate-900"
              }`}
            >
              Todos ({metrics.total})
            </button>
          </div>
        </div>

        {/* Linha de Busca & Filtros da Tabela */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
          <div className="md:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por estudante, CGM, CID ou observação..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white text-slate-800 font-medium"
            />
          </div>

          <div className="md:col-span-3">
            <select
              value={tableTurmaFilter}
              onChange={(e) => setTableTurmaFilter(e.target.value)}
              className="w-full py-2 px-3 border border-slate-200 rounded-xl bg-slate-50/50 font-semibold text-slate-700"
            >
              <option value="ALL">Todas as Turmas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={tableTypeFilter}
              onChange={(e) => setTableTypeFilter(e.target.value)}
              className="w-full py-2 px-3 border border-slate-200 rounded-xl bg-slate-50/50 font-semibold text-slate-700"
            >
              <option value="ALL">Todos os Tipos</option>
              <option value="ATESTADO_MEDICO">Atestado Médico</option>
              <option value="DECLARACAO_COMPARECIMENTO">Declaração Consulta</option>
              <option value="ATESTADO_ODONTOLOGICO">Atestado Odonto</option>
              <option value="JUSTIFICATIVA_FAMILIAR">Justificativa Familiar</option>
              <option value="DISPENSA_LEGAL">Dispensa Legal</option>
            </select>
          </div>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Estudante / Turma</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3">Período & Vigência</th>
                <th className="px-3 py-3">CID-10</th>
                <th className="px-3 py-3">Observações / Médico</th>
                <th className="px-3 py-3">Lançado por</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredJustifications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400 italic">
                    Nenhum atestado encontrado com os critérios selecionados.
                  </td>
                </tr>
              ) : (
                filteredJustifications.map((j) => {
                  const today = new Date(`${todayStr}T00:00:00.000-03:00`);
                  const isEndActive = new Date(j.endDate) >= today;

                  return (
                    <tr key={j.id} className="hover:bg-slate-50/60 transition">
                      <td className="px-4 py-3">
                        <Link
                          href={`/alunos/${j.student?.id}`}
                          className="font-bold text-slate-900 hover:text-sky-600 transition block"
                        >
                          {j.student?.name}
                        </Link>
                        <p className="text-[10px] text-slate-500">
                          {j.student?.classGroup?.name || "Sem turma"} {j.student?.cgm ? `• CGM: ${j.student.cgm}` : ""}
                        </p>
                      </td>

                      <td className="px-3 py-3">
                        <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
                          {JUSTIFICATION_TYPE_LABELS[j.type] || j.type}
                        </span>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5">
                          {isEndActive ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                              🟢 Vigente até {new Date(j.endDate).toLocaleDateString("pt-BR")}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">
                              Encerrado ({new Date(j.endDate).toLocaleDateString("pt-BR")})
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Início: {new Date(j.startDate).toLocaleDateString("pt-BR")}
                        </p>
                      </td>

                      <td className="px-3 py-3 font-mono font-bold text-slate-800">
                        {j.cidCode || "—"}
                      </td>

                      <td className="px-3 py-3 text-slate-600 max-w-xs truncate" title={j.notes || ""}>
                        {j.notes || "—"}
                      </td>

                      <td className="px-3 py-3 text-[10px] text-slate-500 whitespace-nowrap">
                        {j.createdByName}
                      </td>

                      <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                        <Link
                          href={`/alunos/${j.student?.id}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-sky-700 hover:bg-sky-50 transition inline-block align-middle"
                          title="Abrir Prontuário 360º"
                        >
                          <UserCheck className="w-4 h-4" />
                        </Link>

                        <button
                          type="button"
                          onClick={() => handleDeleteJustification(j.id, j.student?.name)}
                          disabled={deletingId === j.id}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition inline-block align-middle disabled:opacity-50"
                          title="Remover justificativa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
