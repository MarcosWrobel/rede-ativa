"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { clearRedeAtivaCachesOnly } from "@/lib/pwaCleanup";
import ModalDialog from "@/components/ModalDialog";
import {
  Landmark,
  Building2,
  Users,
  AlertTriangle,
  Send,
  Plus,
  ArrowRight,
  TrendingUp,
  Search,
  ShieldCheck,
  RefreshCw,
  BarChart3,
  LayoutGrid,
  ListOrdered,
  MapPin,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  ExternalLink,
  Sparkles,
  Brain,
  Printer,
  ShieldAlert,
  HelpCircle,
  FileText,
} from "lucide-react";
import { getCategoryMeta } from "@/lib/predictiveAnalytics";

export interface SchoolSummary {
  id: string;
  name: string;
  shortName: string;
  inepCode: string;
  city: string;
  state: string;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  nre?: string | null;
  district?: string | null;
  studentsCount: number;
  classesCount: number;
  staffCount: number;
  minutesCount: number;
  criticalCount: number;
  averageAttendance: number;
  hasSyncToken?: boolean;
  lastSyncAt?: string | null;
  daysSinceSync?: number | null;
  isSyncOutdated?: boolean;
}

export interface Metrics {
  totalSchools: number;
  totalStudents: number;
  totalClasses: number;
  criticalStudentsCount: number;
  networkAverageAttendance: number;
  messagesSentThisMonth: number;
}

export interface CauseBreakdownItem {
  category: string;
  count: number;
  percentage: number;
}

export interface PredictiveRecommendation {
  priority: "HIGH" | "MEDIUM" | "INFO";
  title: string;
  action: string;
}

export interface PredictiveData {
  totalCategorizedReplies: number;
  criticalRate: number;
  causesBreakdown: CauseBreakdownItem[];
  recommendations: PredictiveRecommendation[];
}

interface Props {
  city: string;
  availableCities?: string[];
  metrics: Metrics;
  initialSchools: SchoolSummary[];
  predictiveData?: PredictiveData;
  isSuperAdmin: boolean;
  currentUser: {
    name: string;
    email: string;
  };
}

export default function SecretariaClient({
  city,
  availableCities = [],
  metrics,
  initialSchools,
  predictiveData,
  isSuperAdmin,
  currentUser,
}: Props) {
  const [schools, setSchools] = useState<SchoolSummary[]>(initialSchools);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"RANKING" | "CARDS" | "PREDICTIVE">("RANKING");
  const [sortBy, setSortBy] = useState<
    "FREQUENCIA_ASC" | "FREQUENCIA_DESC" | "CRITICOS_DESC" | "ALUNOS_DESC" | "ATAS_DESC" | "NOME_ASC"
  >("FREQUENCIA_ASC");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "CRITICAL_ONLY" | "OUTDATED_ONLY">("ALL");
  const [selectedDistrict, setSelectedDistrict] = useState<string>("ALL");

  const [switching, setSwitching] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSchool, setNewSchool] = useState({
    inep: "",
    name: "",
    phone: "",
    email: "",
    district: "",
  });
  const [createFieldErrors, setCreateFieldErrors] = useState<{
    inep?: string;
    name?: string;
    email?: string;
  }>({});
  const [createModalError, setCreateModalError] = useState("");
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const inepInputId = useId();
  const inepErrorId = useId();
  const nameInputId = useId();
  const nameErrorId = useId();
  const districtInputId = useId();
  const phoneInputId = useId();
  const emailInputId = useId();
  const emailErrorId = useId();

  const inepInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const validateSchoolField = (field: "inep" | "name" | "email", value: string) => {
    const trimmed = value.trim();
    if (field === "inep") {
      if (!trimmed || trimmed.length < 4) {
        return "Informe o código INEP ou identificador municipal (mínimo 4 caracteres).";
      }
      return undefined;
    }
    if (field === "name") {
      if (!trimmed || trimmed.length < 3) {
        return "Informe o nome completo da escola (mínimo 3 caracteres).";
      }
      return undefined;
    }
    if (field === "email" && trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return "Informe um e-mail institucional válido.";
    }
    return undefined;
  };

  const handleOpenCreateModal = () => {
    setCreateFieldErrors({});
    setCreateModalError("");
    setShowCreateModal(true);
  };

  const handleCloseCreateModal = () => {
    if (creating) return;
    setShowCreateModal(false);
    setCreateFieldErrors({});
    setCreateModalError("");
  };

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
      await clearRedeAtivaCachesOnly().catch(() => {});
      window.location.href = "/";
    } catch (e: any) {
      setErrorMsg(e.message || "Erro de conexão ao acessar unidade");
      setSwitching(null);
    }
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;

    const nextErrors = {
      inep: validateSchoolField("inep", newSchool.inep),
      name: validateSchoolField("name", newSchool.name),
      email: validateSchoolField("email", newSchool.email),
    };
    const filteredErrors = Object.fromEntries(
      Object.entries(nextErrors).filter(([, value]) => Boolean(value))
    ) as typeof createFieldErrors;

    if (Object.keys(filteredErrors).length > 0) {
      setCreateFieldErrors(filteredErrors);
      setCreateModalError("");
      if (filteredErrors.inep) {
        inepInputRef.current?.focus();
      } else if (filteredErrors.name) {
        nameInputRef.current?.focus();
      } else if (filteredErrors.email) {
        emailInputRef.current?.focus();
      }
      return;
    }

    setCreating(true);
    setCreateFieldErrors({});
    setCreateModalError("");
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
          settings: {
            district: newSchool.district.trim() || "Sede Urbana",
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Erro ao cadastrar escola");
      }

      setSuccessMsg(`Escola "${data.school.name}" cadastrada e ativada na rede municipal.`);
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
          district: newSchool.district.trim() || "Sede Urbana",
          studentsCount: 0,
          classesCount: 0,
          staffCount: 1,
          minutesCount: 0,
          criticalCount: 0,
          averageAttendance: 100,
          hasSyncToken: false,
          lastSyncAt: null,
          daysSinceSync: null,
          isSyncOutdated: true,
        },
      ]);
      setNewSchool({ inep: "", name: "", phone: "", email: "", district: "" });
      setCreateFieldErrors({});
      setCreateModalError("");
      setShowCreateModal(false);
    } catch (e: any) {
      setCreateModalError(e.message || "Erro ao criar escola municipal. Revise os dados e tente novamente.");
    } finally {
      setCreating(false);
    }
  };

  // Extrai lista única de distritos/polos presentes nas escolas
  const availableDistricts = Array.from(
    new Set(schools.map((s) => s.district || "Sede Urbana").filter(Boolean))
  ).sort();

  // Escolas com sincronização defasada (> 7 dias ou base zerada)
  const outdatedSchools = schools.filter((s) => s.isSyncOutdated);

  // Filtragem e Ordenação da Rede
  const filteredAndSortedSchools = schools
    .filter((s) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.inepCode.includes(q) ||
        (s.district && s.district.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (filterStatus === "CRITICAL_ONLY" && s.criticalCount === 0) return false;
      if (filterStatus === "OUTDATED_ONLY" && !s.isSyncOutdated) return false;

      if (selectedDistrict !== "ALL") {
        const d = s.district || "Sede Urbana";
        if (d !== selectedDistrict) return false;
      }

      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "FREQUENCIA_ASC":
          return a.averageAttendance - b.averageAttendance;
        case "FREQUENCIA_DESC":
          return b.averageAttendance - a.averageAttendance;
        case "CRITICOS_DESC":
          return b.criticalCount - a.criticalCount;
        case "ALUNOS_DESC":
          return b.studentsCount - a.studentsCount;
        case "ATAS_DESC":
          return b.minutesCount - a.minutesCount;
        case "NOME_ASC":
        default:
          return a.name.localeCompare(b.name);
      }
    });

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Top Banner Executivo */}
      <div className="bg-gradient-to-r from-sky-900 via-sky-800 to-indigo-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-white/10 to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 backdrop-blur-xs rounded-full text-xs font-semibold tracking-wide text-sky-200 border border-white/10">
                <Landmark className="w-3.5 h-3.5" />
                <span>Secretaria Municipal de Educação</span>
              </div>

              {availableCities.length > 1 && (
                <select
                  value={city}
                  onChange={(e) => {
                    window.location.href = `/secretaria?city=${encodeURIComponent(e.target.value)}`;
                  }}
                  className="bg-sky-950/80 text-white font-bold text-xs rounded-full px-3 py-1 border border-white/20 focus:outline-hidden cursor-pointer"
                >
                  {availableCities.map((c) => (
                    <option key={c} value={c} className="text-slate-900">
                      Município: {c}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Rede Municipal de Ensino — {city}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white text-xs font-bold rounded-xl shadow-lg transition transform active:scale-95 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-emerald-100" />
              <span>Cadastrar Rede</span>
            </Link>
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-sky-900 hover:bg-sky-50 text-xs font-bold rounded-xl shadow-md transition transform active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-sky-600" />
              <span>Nova Escola</span>
            </button>
            {isSuperAdmin && (
              <Link
                href="/admin/escolas"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl border border-white/20 transition"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Administração</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Feedback Messages */}
      {errorMsg && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between text-xs text-red-700"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg("")}
            className="font-bold underline ml-3 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}
      {successMsg && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs font-semibold text-emerald-800"
        >
          <span>{successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg("")}
            className="font-bold underline ml-3 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Escolas Ativas
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tabular-nums">
            {metrics.totalSchools}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Na rede de {city}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Total de Alunos
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tabular-nums">
            {metrics.totalStudents.toLocaleString("pt-BR")}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block tabular-nums">
            {metrics.totalClasses} turmas cadastradas
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Frequência da Rede
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-2 tabular-nums">
            {metrics.networkAverageAttendance}%
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Média consolidada</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Risco Crítico (&lt;75%)
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-amber-600 mt-2 tabular-nums">
            {metrics.criticalStudentsCount}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Em alerta na rede</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-2xs col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Buscas Ativas Mês
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tabular-nums">
            {metrics.messagesSentThisMonth}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Contatos registrados</span>
        </div>
      </div>

      {/* Seção Principal: Controles e Visualização Comparativa */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xs overflow-hidden space-y-4 p-5 sm:p-6">
        {/* Barra Superior de Controles: Abas, Busca e Ordenação */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          {/* Alternador de Modo de Exibição */}
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setViewMode("RANKING")}
              className={`inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                viewMode === "RANKING"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ListOrdered className="w-4 h-4 text-sky-600" />
              <span>Ranking & Comparativo</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("CARDS")}
              className={`inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                viewMode === "CARDS"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <LayoutGrid className="w-4 h-4 text-sky-600" />
              <span>Grade de Unidades</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("PREDICTIVE")}
              className={`inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                viewMode === "PREDICTIVE"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Brain className="w-4 h-4 text-indigo-600" />
              <span>Diagnóstico Preditivo SEMEC</span>
            </button>
          </div>

          {/* Filtros e Busca */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {/* Campo de Busca */}
            <div className="relative min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por escola, polo ou INEP..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Filtro por Polo / Distrito */}
            {availableDistricts.length > 1 && (
              <select
                value={selectedDistrict}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 cursor-pointer"
              >
                <option value="ALL">Todos os Polos</option>
                {availableDistricts.map((d) => (
                  <option key={d} value={d}>
                    Polo: {d}
                  </option>
                ))}
              </select>
            )}

            {/* Ordenação */}
            <div className="flex items-center space-x-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 cursor-pointer"
              >
                <option value="FREQUENCIA_ASC">Menor Frequência (Prioridade de Apoio)</option>
                <option value="FREQUENCIA_DESC">Maior Frequência (Melhor Desempenho)</option>
                <option value="CRITICOS_DESC">Mais Alunos em Risco Crítico</option>
                <option value="ALUNOS_DESC">Maior Porte (Total Alunos)</option>
                <option value="ATAS_DESC">Mais Atas Lavradas</option>
                <option value="NOME_ASC">Nome (A-Z)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Alerta de Sincronização SERE + Chips de Filtragem Rápida */}
        <div className="space-y-3">
          {outdatedSchools.length > 0 && (
            <div className="bg-amber-50/90 border border-amber-300 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-amber-800" />
                </div>
                <div>
                  <p className="text-xs font-black text-amber-950 tabular-nums">
                    Alerta de Defasagem SERE: {outdatedSchools.length}{" "}
                    {outdatedSchools.length === 1 ? "unidade requer" : "unidades requerem"} atualização de frequência
                  </p>
                  <p className="text-[11px] text-amber-900/90">
                    Unidades com mais de 7 dias sem importação de faltas ou base inicial zerada aparecem sinalizadas abaixo.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilterStatus(filterStatus === "OUTDATED_ONLY" ? "ALL" : "OUTDATED_ONLY")}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs shrink-0 transition cursor-pointer"
              >
                {filterStatus === "OUTDATED_ONLY" ? "Exibir Todas as Escolas" : "Ver Apenas Defasadas"}
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterStatus("ALL")}
                className={`px-3 py-1.5 rounded-full font-bold transition cursor-pointer tabular-nums ${
                  filterStatus === "ALL"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Todas ({schools.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus("CRITICAL_ONLY")}
                className={`px-3 py-1.5 rounded-full font-bold transition cursor-pointer flex items-center space-x-1 ${
                  filterStatus === "CRITICAL_ONLY"
                    ? "bg-amber-600 text-white"
                    : "bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200"
                }`}
              >
                <span>Apenas com Risco Crítico</span>
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus("OUTDATED_ONLY")}
                aria-pressed={filterStatus === "OUTDATED_ONLY"}
                className={`px-3 py-1.5 rounded-full font-bold transition cursor-pointer flex items-center space-x-1 tabular-nums ${
                  filterStatus === "OUTDATED_ONLY"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200"
                }`}
              >
                <span>Sincronização Defasada ({outdatedSchools.length})</span>
              </button>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
              Exibindo {filteredAndSortedSchools.length} de {schools.length} escolas
            </span>
          </div>
        </div>

        {/* Visualização 1: Tabela de Ranking & Comparativo Visual */}
        {viewMode === "RANKING" && (
          <div
            tabIndex={0}
            role="region"
            aria-label="Ranking comparativo das escolas"
            className="overflow-x-auto focus:outline-none"
          >
            {filteredAndSortedSchools.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
                <p className="text-sm font-bold text-slate-700">Nenhuma escola municipal encontrada</p>
                <p className="text-xs text-slate-400">Tente ajustar os filtros ou a busca textual acima.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-2 text-center w-12 tabular-nums">Pos</th>
                    <th className="py-3 px-3 min-w-[230px]">Unidade Escolar &amp; Polo</th>
                    <th className="py-3 px-3 text-right min-w-[200px] tabular-nums">Frequência da Unidade</th>
                    <th className="py-3 px-3 text-right tabular-nums">Risco Crítico (&lt;75%)</th>
                    <th className="py-3 px-3 text-right tabular-nums">Alunos / Turmas</th>
                    <th className="py-3 px-3 text-right tabular-nums">Atas Lavradas</th>
                    <th className="py-3 px-3">Sincronização SERE</th>
                    <th className="py-3 px-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredAndSortedSchools.map((s, idx) => {
                    const diff = Number((s.averageAttendance - metrics.networkAverageAttendance).toFixed(1));
                    const isAboveNetwork = diff >= 0;
                    const needsAttention =
                      s.averageAttendance < 75 || s.criticalCount > 0 || Boolean(s.isSyncOutdated);

                    return (
                      <tr
                        key={s.id}
                        className={`hover:bg-slate-50/80 transition ${
                          s.averageAttendance < 75 ? "bg-rose-50/20" : ""
                        }`}
                      >
                        {/* Posição no Ranking */}
                        <td className="py-3.5 px-2 text-center tabular-nums">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-black text-[11px] tabular-nums ${
                              idx === 0
                                ? "bg-amber-100 text-amber-900 border border-amber-300"
                                : idx === 1
                                ? "bg-slate-200 text-slate-800"
                                : idx === 2
                                ? "bg-amber-50 text-amber-800"
                                : "text-slate-500"
                            }`}
                          >
                            {idx + 1}º
                          </span>
                        </td>

                        {/* Nome da Escola e Polo */}
                        <td className="py-3.5 px-3">
                          <div className="flex items-center space-x-2.5">
                            {s.logoUrl ? (
                              <img
                                src={s.logoUrl}
                                alt=""
                                className="w-7 h-7 object-contain rounded-md border border-slate-200 shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-md bg-sky-50 text-sky-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                                {s.name.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="font-extrabold text-slate-900 text-xs leading-snug">
                                  {s.name}
                                </p>
                                {needsAttention && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold border border-amber-200">
                                    Prioridade
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center space-x-2 text-[10px] text-slate-500 mt-0.5">
                                <span className="tabular-nums">INEP: {s.inepCode}</span>
                                <span>•</span>
                                <span className="inline-flex items-center gap-0.5">
                                  <MapPin className="w-2.5 h-2.5 text-slate-400" />
                                  {s.district || "Sede Urbana"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Frequência Média com Barra Visual e Comparativo vs Rede */}
                        <td className="py-3.5 px-3 text-right tabular-nums">
                          <div className="space-y-1">
                            <div className="flex items-baseline justify-end gap-2 text-xs">
                              <span
                                className={`text-[10px] font-bold tabular-nums ${
                                  isAboveNetwork ? "text-emerald-700" : "text-rose-600"
                                }`}
                              >
                                {isAboveNetwork ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`} vs rede
                              </span>
                              <span
                                className={`font-black text-sm tabular-nums ${
                                  s.averageAttendance < 75
                                    ? "text-rose-600"
                                    : s.averageAttendance < 85
                                    ? "text-amber-600"
                                    : "text-emerald-700"
                                }`}
                              >
                                {s.averageAttendance.toFixed(1)}%
                              </span>
                            </div>

                            {/* Barra de Progresso Visual */}
                            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div
                                style={{ width: `${Math.min(100, Math.max(0, s.averageAttendance))}%` }}
                                className={`h-full rounded-full transition-all duration-500 ${
                                  s.averageAttendance < 75
                                    ? "bg-rose-500"
                                    : s.averageAttendance < 85
                                    ? "bg-amber-500"
                                    : "bg-emerald-600"
                                }`}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Risco Crítico */}
                        <td className="py-3.5 px-3 text-right tabular-nums">
                          {s.criticalCount > 0 ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-extrabold text-xs tabular-nums">
                              <span>{s.criticalCount}</span>
                              {s.studentsCount > 0 && (
                                <span className="text-[10px] font-medium opacity-80">
                                  ({((s.criticalCount / s.studentsCount) * 100).toFixed(0)}%)
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs tabular-nums">0</span>
                          )}
                        </td>

                        {/* Alunos & Turmas */}
                        <td className="py-3.5 px-3 text-right tabular-nums">
                          <p className="font-bold text-slate-800">{s.studentsCount}</p>
                          <span className="text-[10px] text-slate-500">{s.classesCount} turmas</span>
                        </td>

                        {/* Atas Lavradas */}
                        <td className="py-3.5 px-3 text-right tabular-nums">
                          <span className="font-bold text-slate-800">{s.minutesCount}</span>
                        </td>

                        {/* Status de Sincronização SERE */}
                        <td className="py-3.5 px-3">
                          {s.studentsCount === 0 ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                              Base Zerada
                            </span>
                          ) : s.daysSinceSync == null ? (
                            <span className="text-slate-400 text-[10px]">Sem registros</span>
                          ) : s.daysSinceSync === 0 ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>Hoje</span>
                            </span>
                          ) : s.daysSinceSync <= 7 ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-sky-50 text-sky-800 text-[10px] font-bold border border-sky-200">
                              <Clock className="w-3 h-3 text-sky-600" />
                              <span>Há {s.daysSinceSync}d</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-black border border-rose-200">
                              <AlertTriangle className="w-3 h-3 text-rose-600" />
                              <span>Defasado ({s.daysSinceSync}d)</span>
                            </span>
                          )}
                        </td>

                        {/* Ação: Acessar Painel da Unidade */}
                        <td className="py-3.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleSwitchSchool(s.id)}
                            disabled={switching === s.id}
                            className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                          >
                            {switching === s.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <span>Acessar</span>
                                <ArrowRight className="w-3 h-3" />
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Visualização 2: Grade de Unidades (Cards) */}
        {viewMode === "CARDS" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {filteredAndSortedSchools.map((s) => {
              const diff = Number((s.averageAttendance - metrics.networkAverageAttendance).toFixed(1));
              const isAboveNetwork = diff >= 0;

              return (
                <div
                  key={s.id}
                  className="bg-slate-50/70 border border-slate-200 rounded-2xl p-5 flex flex-col justify-between hover:border-sky-300 hover:bg-slate-50 transition space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-extrabold text-sky-800 bg-sky-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                            INEP: {s.inepCode}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded-full">
                            {s.district || "Sede Urbana"}
                          </span>
                        </div>
                        <h3 className="font-extrabold text-slate-900 text-sm leading-snug pt-0.5">
                          {s.name}
                        </h3>
                      </div>
                      {s.logoUrl && (
                        <img
                          src={s.logoUrl}
                          alt="Logo"
                          className="w-9 h-9 object-contain rounded-lg border border-slate-200 bg-white p-0.5 shrink-0"
                        />
                      )}
                    </div>

                    {/* Barra de Frequência */}
                    <div className="bg-white p-3 rounded-xl border border-slate-200/70 space-y-1.5">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-bold text-slate-500 text-[11px]">Frequência Escolar</span>
                        <div className="flex items-baseline space-x-1.5">
                          <span
                            className={`font-black text-sm ${
                              s.averageAttendance < 75
                                ? "text-rose-600"
                                : s.averageAttendance < 85
                                ? "text-amber-600"
                                : "text-emerald-700"
                            }`}
                          >
                            {s.averageAttendance}%
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              isAboveNetwork ? "text-emerald-700" : "text-rose-600"
                            }`}
                          >
                            {isAboveNetwork ? `+${diff}%` : `${diff}%`}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, Math.max(0, s.averageAttendance))}%` }}
                          className={`h-full rounded-full ${
                            s.averageAttendance < 75
                              ? "bg-rose-500"
                              : s.averageAttendance < 85
                              ? "bg-amber-500"
                              : "bg-emerald-600"
                          }`}
                        />
                      </div>
                    </div>

                    {/* Métricas Principais */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 rounded-xl bg-white border border-slate-200/70">
                        <span className="text-[10px] text-slate-400 block font-bold">Alunos</span>
                        <span className="font-extrabold text-slate-800 text-sm">{s.studentsCount}</span>
                      </div>
                      <div className="p-2 rounded-xl bg-white border border-slate-200/70">
                        <span className="text-[10px] text-slate-400 block font-bold">Risco (&lt;75%)</span>
                        <span className="font-extrabold text-amber-600 text-sm">{s.criticalCount}</span>
                      </div>
                      <div className="p-2 rounded-xl bg-white border border-slate-200/70">
                        <span className="text-[10px] text-slate-400 block font-bold">Atas</span>
                        <span className="font-extrabold text-slate-800 text-sm">{s.minutesCount}</span>
                      </div>
                    </div>

                    {/* Sincronização SERE */}
                    <div className="flex items-center justify-between text-[11px] pt-1">
                      <span className="text-slate-500 font-medium">Sincronização SERE:</span>
                      {s.studentsCount === 0 ? (
                        <span className="font-bold text-slate-500">Base Zerada</span>
                      ) : s.daysSinceSync == null ? (
                        <span className="text-slate-400">Pendente</span>
                      ) : s.daysSinceSync === 0 ? (
                        <span className="font-bold text-emerald-700">Hoje</span>
                      ) : s.daysSinceSync <= 7 ? (
                        <span className="font-bold text-sky-700">Há {s.daysSinceSync} dias</span>
                      ) : (
                        <span className="font-black text-rose-600">Defasado ({s.daysSinceSync}d)</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSwitchSchool(s.id)}
                    disabled={switching === s.id}
                    className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer disabled:opacity-50"
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
              );
            })}
          </div>
        )}

        {/* Visualização 3: Diagnóstico Preditivo de Evasão & Causas Municipais (SAAS-07) */}
        {viewMode === "PREDICTIVE" && (
          <div className="space-y-6 pt-2">
            {/* Header com Ações e Contexto do Diagnóstico */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-indigo-900 via-indigo-800 to-sky-900 text-white shadow-md">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-indigo-200 text-[11px] font-bold">
                  <Brain className="w-3.5 h-3.5" />
                  <span>Inteligência Preditiva de Permanência Escolar (SEMEC)</span>
                </div>
                <h3 className="text-lg font-black tracking-tight">
                  Mapeamento de Causas e Diretrizes de Políticas Públicas — {city}
                </h3>
                <p className="text-xs text-indigo-200/90 max-w-2xl">
                  Cruzamento automatizado entre faltas registradas no SERE e justificativas prestadas pelas famílias via WhatsApp e Busca Ativa.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl border border-white/20 transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir Diagnóstico</span>
                </button>
              </div>
            </div>

            {/* KPIs Preditivos Rápidos */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-200/80">
                <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">
                  Respostas Familiares Categorizadas
                </span>
                <p className="text-2xl font-black text-indigo-950 mt-1">
                  {predictiveData?.totalCategorizedReplies || 0}
                </p>
                <span className="text-[11px] text-indigo-600/90 mt-0.5 block">
                  Justificativas com categorização temática
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200/80">
                <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">
                  Taxa Crítica da Rede (&lt;75%)
                </span>
                <p className="text-2xl font-black text-rose-950 mt-1">
                  {predictiveData?.criticalRate || 0}%
                </p>
                <span className="text-[11px] text-rose-600/90 mt-0.5 block">
                  {metrics.criticalStudentsCount} discentes em risco grave de retenção
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/80">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
                  Causa Prevalente na Rede
                </span>
                <p className="text-base sm:text-lg font-black text-emerald-950 mt-1 truncate">
                  {predictiveData?.causesBreakdown && predictiveData.causesBreakdown.length > 0
                    ? getCategoryMeta(predictiveData.causesBreakdown[0].category).label
                    : "Em consolidação"}
                </p>
                <span className="text-[11px] text-emerald-600/90 mt-0.5 block">
                  {predictiveData?.causesBreakdown && predictiveData.causesBreakdown.length > 0
                    ? `${predictiveData.causesBreakdown[0].percentage}% do volume total registrado`
                    : "Aguardando mais retornos"}
                </span>
              </div>
            </div>

            {/* Painel de Recomendações de Políticas Públicas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-sky-600" />
                  <span>Diretrizes Executivas e Recomendações de Intervenção Municipal</span>
                </h4>
                <span className="text-[11px] font-medium text-slate-500">
                  Acompanhamento consolidado de frequência e busca ativa na rede
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {predictiveData?.recommendations && predictiveData.recommendations.length > 0 ? (
                  predictiveData.recommendations.map((rec, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-2xl border transition-all ${
                        rec.priority === "HIGH"
                          ? "bg-rose-50/70 border-rose-300 text-rose-950"
                          : rec.priority === "MEDIUM"
                          ? "bg-amber-50/70 border-amber-300 text-amber-950"
                          : "bg-sky-50/70 border-sky-300 text-sky-950"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            rec.priority === "HIGH"
                              ? "bg-rose-600 text-white"
                              : rec.priority === "MEDIUM"
                              ? "bg-amber-600 text-white"
                              : "bg-sky-600 text-white"
                          }`}
                        >
                          {rec.priority === "HIGH"
                            ? "Prioridade Alta (Ação Imediata)"
                            : rec.priority === "MEDIUM"
                            ? "Prioridade Média (Intersetorial)"
                            : "Monitoramento Regular"}
                        </span>
                      </div>
                      <h5 className="font-bold text-xs sm:text-sm mb-1.5">{rec.title}</h5>
                      <p className="text-xs leading-relaxed opacity-90">{rec.action}</p>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                    Nenhuma recomendação atípica no momento. Rede em monitoramento contínuo.
                  </div>
                )}
              </div>
            </div>

            {/* Distribuição Gráfica das Causas de Faltas */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-sm font-extrabold text-slate-900">
                    Distribuição Percentual de Motivos de Infrequência
                  </h4>
                  <p className="text-xs text-slate-500">
                    Base fundamentada nos relatos das famílias durante as abordagens de Busca Ativa
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-700">
                  {predictiveData?.totalCategorizedReplies || 0} justificativas
                </span>
              </div>

              {predictiveData?.causesBreakdown && predictiveData.causesBreakdown.length > 0 ? (
                <div className="space-y-3.5">
                  {predictiveData.causesBreakdown.map((item, idx) => {
                    const meta = getCategoryMeta(item.category);
                    return (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800 flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${meta.bg.split(" ")[0]}`} />
                            {meta.label}
                          </span>
                          <span className="font-extrabold text-slate-900">
                            {item.percentage}% ({item.count} {item.count === 1 ? "registro" : "registros"})
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                          <div
                            style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
                            className={`h-full rounded-full transition-all duration-500 ${
                              item.category === "TRABALHO"
                                ? "bg-red-600"
                                : item.category === "TRANSPORTE"
                                ? "bg-amber-500"
                                : item.category === "SAUDE"
                                ? "bg-rose-500"
                                : item.category === "VULNERABILIDADE"
                                ? "bg-purple-600"
                                : "bg-sky-600"
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center rounded-xl bg-slate-50 text-xs text-slate-500 space-y-2">
                  <HelpCircle className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="font-semibold text-slate-700">
                    Nenhuma justificativa familiar categorizada ainda nesta rede municipal.
                  </p>
                  <p className="text-slate-400 max-w-md mx-auto">
                    Conforme as equipes pedagógicas das escolas realizarem as abordagens pelo WhatsApp e registrarem os motivos das ausências, os índices preditivos serão consolidados automaticamente.
                  </p>
                </div>
              )}
            </div>

            {/* Matriz de Priorização das Escolas com Menor Desempenho */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
              <h4 className="text-sm font-extrabold text-slate-900">
                Matriz de Foco Prioritário da Rede (Intervenção Imediata)
              </h4>
              <p className="text-xs text-slate-500">
                Unidades ordenadas por criticidade para subsidiar a atuação da equipe multidisciplinar da SEMEC
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 text-[11px] font-bold">
                      <th className="py-2.5 px-3">Escola Municipal</th>
                      <th className="py-2.5 px-3">Polo / Distrito</th>
                      <th className="py-2.5 px-3 text-center">Frequência Média</th>
                      <th className="py-2.5 px-3 text-center">Alunos em Risco Crítico</th>
                      <th className="py-2.5 px-3 text-center">Nível de Atenção</th>
                      <th className="py-2.5 px-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...schools]
                      .sort((a, b) => a.averageAttendance - b.averageAttendance)
                      .slice(0, 5)
                      .map((sc) => (
                        <tr key={sc.id} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-3 font-bold text-slate-800">{sc.name}</td>
                          <td className="py-2.5 px-3 text-slate-600">{sc.district || "Sede Urbana"}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`font-black px-2 py-0.5 rounded-md ${
                                sc.averageAttendance < 75
                                  ? "bg-rose-100 text-rose-800"
                                  : sc.averageAttendance < 85
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {sc.averageAttendance}%
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-slate-700">
                            {sc.criticalCount} alunos
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black ${
                                sc.averageAttendance < 75
                                  ? "bg-rose-600 text-white"
                                  : sc.averageAttendance < 85
                                  ? "bg-amber-500 text-white"
                                  : "bg-emerald-600 text-white"
                              }`}
                            >
                              {sc.averageAttendance < 75
                                ? "Urgência Alta"
                                : sc.averageAttendance < 85
                                ? "Atenção Moderada"
                                : "Estável"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleSwitchSchool(sc.id)}
                              disabled={switching === sc.id}
                              className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] transition cursor-pointer"
                            >
                              Inspecionar
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Criar Escola Municipal */}
      <ModalDialog
        open={showCreateModal}
        onClose={handleCloseCreateModal}
        preventClose={creating}
        title={`Nova Escola Municipal — ${city}`}
        subtitle="A unidade será vinculada à rede com modelos pedagógicos iniciais e base isolada de estudantes."
      >
        <form onSubmit={handleCreateSchool} noValidate className="space-y-4 text-xs">
          <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <legend className="px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
              Identificação Institucional
            </legend>

            <div className="space-y-1">
              <label htmlFor={inepInputId} className="text-[11px] font-bold text-slate-700 block">
                Código INEP da Escola *
              </label>
              <input
                ref={inepInputRef}
                id={inepInputId}
                type="text"
                inputMode="numeric"
                placeholder="Ex: 41042730 ou identificador municipal"
                value={newSchool.inep}
                disabled={creating}
                aria-invalid={Boolean(createFieldErrors.inep)}
                aria-describedby={createFieldErrors.inep ? inepErrorId : undefined}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewSchool({ ...newSchool, inep: val });
                  if (createFieldErrors.inep) {
                    setCreateFieldErrors((prev) => ({
                      ...prev,
                      inep: validateSchoolField("inep", val),
                    }));
                  }
                }}
                onBlur={() => {
                  if (newSchool.inep.trim()) {
                    setCreateFieldErrors((prev) => ({
                      ...prev,
                      inep: validateSchoolField("inep", newSchool.inep),
                    }));
                  }
                }}
                className={`w-full px-3 py-2 bg-white border rounded-xl text-xs focus:ring-2 text-slate-900 font-medium tabular-nums disabled:opacity-60 ${
                  createFieldErrors.inep
                    ? "border-red-400 focus:ring-red-500"
                    : "border-slate-300 focus:ring-sky-500"
                }`}
              />
              {createFieldErrors.inep && (
                <p id={inepErrorId} role="alert" className="text-[11px] text-red-700 font-semibold">
                  {createFieldErrors.inep}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor={nameInputId} className="text-[11px] font-bold text-slate-700 block">
                Nome da Escola Municipal *
              </label>
              <input
                ref={nameInputRef}
                id={nameInputId}
                type="text"
                placeholder="Ex: Escola Municipal Professor David Federmann"
                value={newSchool.name}
                disabled={creating}
                aria-invalid={Boolean(createFieldErrors.name)}
                aria-describedby={createFieldErrors.name ? nameErrorId : undefined}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewSchool({ ...newSchool, name: val });
                  if (createFieldErrors.name) {
                    setCreateFieldErrors((prev) => ({
                      ...prev,
                      name: validateSchoolField("name", val),
                    }));
                  }
                }}
                onBlur={() => {
                  if (newSchool.name.trim()) {
                    setCreateFieldErrors((prev) => ({
                      ...prev,
                      name: validateSchoolField("name", newSchool.name),
                    }));
                  }
                }}
                className={`w-full px-3 py-2 bg-white border rounded-xl text-xs focus:ring-2 text-slate-900 font-medium disabled:opacity-60 ${
                  createFieldErrors.name
                    ? "border-red-400 focus:ring-red-500"
                    : "border-slate-300 focus:ring-sky-500"
                }`}
              />
              {createFieldErrors.name && (
                <p id={nameErrorId} role="alert" className="text-[11px] text-red-700 font-semibold">
                  {createFieldErrors.name}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor={districtInputId} className="text-[11px] font-bold text-slate-700 block">
                Polo / Distrito Escolar
              </label>
              <input
                id={districtInputId}
                type="text"
                placeholder="Ex: Sede Urbana, Caetano Mendes, São Bento..."
                value={newSchool.district}
                disabled={creating}
                onChange={(e) => setNewSchool({ ...newSchool, district: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 text-slate-900 font-medium disabled:opacity-60"
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <legend className="px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
              Canais de Contato
            </legend>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={phoneInputId} className="text-[11px] font-bold text-slate-700 block">
                  Telefone Institucional
                </label>
                <input
                  id={phoneInputId}
                  type="text"
                  placeholder="(42) 3275-0000"
                  value={newSchool.phone}
                  disabled={creating}
                  onChange={(e) => setNewSchool({ ...newSchool, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 text-slate-900 font-medium tabular-nums disabled:opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor={emailInputId} className="text-[11px] font-bold text-slate-700 block">
                  E-mail Oficial
                </label>
                <input
                  ref={emailInputRef}
                  id={emailInputId}
                  type="email"
                  placeholder="escola@rede.pr.gov.br"
                  value={newSchool.email}
                  disabled={creating}
                  aria-invalid={Boolean(createFieldErrors.email)}
                  aria-describedby={createFieldErrors.email ? emailErrorId : undefined}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewSchool({ ...newSchool, email: val });
                    if (createFieldErrors.email) {
                      setCreateFieldErrors((prev) => ({
                        ...prev,
                        email: validateSchoolField("email", val),
                      }));
                    }
                  }}
                  onBlur={() => {
                    setCreateFieldErrors((prev) => ({
                      ...prev,
                      email: validateSchoolField("email", newSchool.email),
                    }));
                  }}
                  className={`w-full px-3 py-2 bg-white border rounded-xl text-xs focus:ring-2 text-slate-900 font-medium disabled:opacity-60 ${
                    createFieldErrors.email
                      ? "border-red-400 focus:ring-red-500"
                      : "border-slate-300 focus:ring-sky-500"
                  }`}
                />
                {createFieldErrors.email && (
                  <p id={emailErrorId} role="alert" className="text-[11px] text-red-700 font-semibold">
                    {createFieldErrors.email}
                  </p>
                )}
              </div>
            </div>
          </fieldset>

          {creating && (
            <div
              role="status"
              aria-live="polite"
              className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-xs font-semibold flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Cadastrando unidade escolar e preparando ambiente isolado...</span>
            </div>
          )}

          {createModalError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold"
            >
              {createModalError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleCloseCreateModal}
              disabled={creating}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
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
      </ModalDialog>
    </div>
  );
}
