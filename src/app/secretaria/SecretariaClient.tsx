"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Landmark,
  Building2,
  Users,
  AlertTriangle,
  Send,
  Plus,
  ArrowRight,
  TrendingUp,
  FileSpreadsheet,
  CheckCircle2,
  Search,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

interface SchoolSummary {
  id: string;
  name: string;
  shortName: string;
  inepCode: string;
  city: string;
  state: string;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  studentsCount: number;
  classesCount: number;
  staffCount: number;
  minutesCount: number;
  criticalCount: number;
  averageAttendance: number;
}

interface Metrics {
  totalSchools: number;
  totalStudents: number;
  totalClasses: number;
  criticalStudentsCount: number;
  networkAverageAttendance: number;
  messagesSentThisMonth: number;
}

interface Props {
  city: string;
  metrics: Metrics;
  initialSchools: SchoolSummary[];
  isSuperAdmin: boolean;
  currentUser: {
    name: string;
    email: string;
  };
}

export default function SecretariaClient({
  city,
  metrics,
  initialSchools,
  isSuperAdmin,
  currentUser,
}: Props) {
  const [schools, setSchools] = useState<SchoolSummary[]>(initialSchools);
  const [search, setSearch] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSchool, setNewSchool] = useState({
    inep: "",
    name: "",
    phone: "",
    email: "",
  });
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSwitchSchool = async (schoolId: string) => {
    setSwitching(schoolId);
    setErrorMsg("");
    try {
      const res = await fetch("/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Falha ao acessar escola");
      }
      window.location.href = "/";
    } catch (e: any) {
      setErrorMsg(e.message || "Erro de conexão ao acessar unidade");
      setSwitching(null);
    }
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchool.name.trim() || !newSchool.inep.trim()) {
      setErrorMsg("Nome e Código INEP são obrigatórios.");
      return;
    }

    setCreating(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inepCode: newSchool.inep.trim(),
          name: newSchool.name.trim(),
          city,
          state: "PR",
          network: "MUNICIPAL",
          phone: newSchool.phone.trim() || null,
          email: newSchool.email.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao cadastrar escola");
      }

      setSuccessMsg(`Escola "${data.school.name}" cadastrada com sucesso!`);
      const sc = data.school;
      setSchools((prev) => [
        ...prev,
        {
          id: sc.id,
          name: sc.name,
          shortName: sc.name.replace(/^(Escola Municipal|E\.M\.)\s+/i, ""),
          inepCode: sc.inepCode,
          city: sc.city,
          state: sc.state,
          phone: sc.phone,
          email: sc.email,
          logoUrl: sc.logoUrl,
          studentsCount: 0,
          classesCount: 0,
          staffCount: 1,
          minutesCount: 0,
          criticalCount: 0,
          averageAttendance: 100,
        },
      ]);
      setNewSchool({ inep: "", name: "", phone: "", email: "" });
      setShowCreateModal(false);
    } catch (e: any) {
      setErrorMsg(e.message || "Erro ao criar escola municipal");
    } finally {
      setCreating(false);
    }
  };

  const filteredSchools = schools.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.inepCode.includes(search)
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-sky-900 via-sky-800 to-indigo-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-white/10 to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-xs rounded-full text-xs font-semibold tracking-wide text-sky-200 border border-white/10">
              <Landmark className="w-3.5 h-3.5" />
              <span>Secretaria Municipal de Educação & Cultura (SEMEC)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Rede Municipal de Ensino — {city}
            </h1>
            <p className="text-sm text-sky-200/90 max-w-2xl leading-relaxed">
              Visão executiva agregada de frequência escolar, busca ativa e monitoramento
              de evasão de todas as unidades municipais de {city}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-sky-900 hover:bg-sky-50 text-xs font-bold rounded-xl shadow-md transition transform active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Escola Municipal</span>
            </button>
            {isSuperAdmin && (
              <Link
                href="/admin/escolas"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl border border-white/20 transition"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Painel SuperAdmin</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-2xl flex items-center justify-between text-xs text-red-700 dark:text-red-300">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg("")}
            className="font-bold underline ml-3"
          >
            Fechar
          </button>
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300">
          <span>{successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg("")}
            className="font-bold underline ml-3"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Escolas Ativas
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
            {metrics.totalSchools}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Na rede de {city}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Total de Alunos
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
            {metrics.totalStudents.toLocaleString("pt-BR")}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">
            {metrics.totalClasses} turmas cadastradas
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Frequência da Rede
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
            {metrics.networkAverageAttendance}%
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Média municipal</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Risco Crítico (&lt;75%)
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400 mt-2">
            {metrics.criticalStudentsCount}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Em alerta na rede</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Buscas Ativas Mês
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
            {metrics.messagesSentThisMonth}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Disparos registrados</span>
        </div>
      </div>

      {/* Schools Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Unidades Escolares da Rede Municipal
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Supervisione cada escola e alterne para o painel pedagógico individual com um clique
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por escola ou INEP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-sky-500 dark:text-white"
            />
          </div>
        </div>

        {filteredSchools.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Nenhuma escola municipal encontrada
            </p>
            <p className="text-xs text-slate-500">
              Cadastre a primeira escola da rede municipal clicando no botão acima.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 sm:p-6">
            {filteredSchools.map((s) => (
              <div
                key={s.id}
                className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-sky-300 dark:hover:border-sky-700 transition space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-950/80 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                        INEP: {s.inepCode}
                      </span>
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm line-clamp-2">
                        {s.name}
                      </h3>
                    </div>
                    {s.logoUrl && (
                      <img
                        src={s.logoUrl}
                        alt="Logo"
                        className="w-9 h-9 object-contain rounded-lg border border-slate-200 bg-white p-0.5"
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Alunos</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {s.studentsCount} ({s.classesCount} turmas)
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">
                        Frequência Média
                      </span>
                      <span
                        className={`font-black ${
                          s.averageAttendance < 75
                            ? "text-red-600"
                            : s.averageAttendance < 85
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {s.averageAttendance}%
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">
                        Risco Crítico (&lt;75%)
                      </span>
                      <span className="font-bold text-amber-600 dark:text-amber-400">
                        {s.criticalCount} alunos
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">
                        Atas Oficiais
                      </span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {s.minutesCount} lavradas
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => handleSwitchSchool(s.id)}
                    disabled={switching === s.id}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl transition shadow-xs disabled:opacity-50"
                  >
                    {switching === s.id ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Carregando unidade...</span>
                      </>
                    ) : (
                      <>
                        <span>Acessar Painel da Escola</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Criar Escola Municipal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Landmark className="w-5 h-5 text-sky-600" />
                <span>Nova Escola Municipal — {city}</span>
              </h3>
              <p className="text-xs text-slate-500">
                A escola será provisionada na rede municipal com starter pack de modelos pedagógicos e
                instância isolada de dados.
              </p>
            </div>

            <form onSubmit={handleCreateSchool} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Código INEP da Escola *
                </label>
                <input
                  type="text"
                  placeholder="Ex: 41042730 ou identificador municipal"
                  value={newSchool.inep}
                  onChange={(e) => setNewSchool({ ...newSchool, inep: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Nome da Escola Municipal *
                </label>
                <input
                  type="text"
                  placeholder="Ex: Escola Municipal Professor David Federmann"
                  value={newSchool.name}
                  onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 dark:text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Telefone Institucional
                  </label>
                  <input
                    type="text"
                    placeholder="(42) 3275-0000"
                    value={newSchool.phone}
                    onChange={(e) => setNewSchool({ ...newSchool, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    E-mail Oficial
                  </label>
                  <input
                    type="email"
                    placeholder="escola@tibagi.pr.gov.br"
                    value={newSchool.email}
                    onChange={(e) => setNewSchool({ ...newSchool, email: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl transition shadow-xs disabled:opacity-50"
                >
                  {creating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Cadastrando...</span>
                    </>
                  ) : (
                    <span>Cadastrar e Ativar</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
