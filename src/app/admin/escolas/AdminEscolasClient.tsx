"use client";

import { useState } from "react";
import {
  Landmark,
  Plus,
  Building2,
  Users,
  GraduationCap,
  Key,
  Check,
  Search,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  X,
  Upload,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";

interface SchoolItem {
  id: string;
  name: string;
  shortName: string | null;
  inep: string | null;
  network: "ESTADUAL" | "MUNICIPAL" | "PRIVADA";
  municipality: string;
  state: string;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  hasSyncToken: boolean;
  studentsCount: number;
  classesCount: number;
  staffCount: number;
  createdAt: string;
}

interface AdminEscolasClientProps {
  schools: SchoolItem[];
  activeSchoolId: string | null;
}

export default function AdminEscolasClient({
  schools: initialSchools,
  activeSchoolId: initialActiveId,
}: AdminEscolasClientProps) {
  const [schools, setSchools] = useState<SchoolItem[]>(initialSchools);
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(initialActiveId);
  const [search, setSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<string>("ALL");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // New School Form State
  const [formData, setFormData] = useState({
    name: "",
    shortName: "",
    inep: "",
    network: "MUNICIPAL" as "ESTADUAL" | "MUNICIPAL" | "PRIVADA",
    municipality: "Tibagi",
    state: "PR",
    phone: "",
    email: "",
    address: "",
    logoUrl: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFeedback({ type: "error", message: "Selecione uma imagem válida (PNG, JPG, SVG)." });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setFormData((prev) => ({ ...prev, logoUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFeedback(null);

    try {
      const payload = {
        name: formData.name.trim(),
        inepCode: formData.inep.trim(),
        inep: formData.inep.trim(),
        network: formData.network,
        city: formData.municipality.trim(),
        municipality: formData.municipality.trim(),
        state: formData.state.trim().toUpperCase(),
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        logoUrl: formData.logoUrl || null,
      };

      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao cadastrar escola.");
      }

      setFeedback({
        type: "success",
        message: `Escola "${data.school.name}" cadastrada com sucesso!`,
      });

      const sc = data.school;
      const shortName = sc.name.replace(/^(Colégio Estadual|Escola Municipal|C\.E\.|E\.M\.)\s+/i, "");

      // Append new school to list
      setSchools((prev) => [
        ...prev,
        {
          id: sc.id,
          name: sc.name,
          shortName,
          inep: sc.inepCode || sc.inep,
          network: sc.network,
          municipality: sc.city || sc.municipality,
          state: sc.state,
          phone: sc.phone,
          email: sc.email,
          logoUrl: sc.logoUrl,
          hasSyncToken: false,
          studentsCount: 0,
          classesCount: 0,
          staffCount: 1,
          createdAt: sc.createdAt || new Date().toISOString(),
        },
      ]);

      setIsModalOpen(false);
      setFormData({
        name: "",
        shortName: "",
        inep: "",
        network: "MUNICIPAL",
        municipality: "Tibagi",
        state: "PR",
        phone: "",
        email: "",
        address: "",
        logoUrl: "",
      });
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Falha ao registrar instituição." });
    } finally {
      setCreating(false);
    }
  };

  const handleSwitchSchool = async (schoolId: string) => {
    if (schoolId === activeSchoolId) return;

    setSwitching(schoolId);
    setFeedback(null);

    try {
      const res = await fetch("/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSchoolId: schoolId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao alternar de escola.");
      }

      setActiveSchoolId(schoolId);
      // Reload page to refresh all server components in new school context
      window.location.reload();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Falha na alternância de escola." });
      setSwitching(null);
    }
  };

  // Filter schools
  const filteredSchools = schools.filter((s) => {
    const matchesNetwork = networkFilter === "ALL" || s.network === networkFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      s.name.toLowerCase().includes(q) ||
      (s.shortName && s.shortName.toLowerCase().includes(q)) ||
      (s.inep && s.inep.includes(q)) ||
      s.municipality.toLowerCase().includes(q);
    return matchesNetwork && matchesSearch;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 rounded-xl">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Gestão de Escolas & Redes
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cadastre novas instituições municipais ou estaduais e alterne o contexto operacional
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center space-x-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Nova Instituição</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl flex items-center space-x-3 text-sm ${
            feedback.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
              : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
          }`}
        >
          {feedback.type === "success" ? (
            <Check className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome da escola, INEP ou município..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <select
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
          >
            <option value="ALL">Todas as Redes</option>
            <option value="ESTADUAL">Estadual (SEED-PR)</option>
            <option value="MUNICIPAL">Municipal (SEMEC)</option>
            <option value="PRIVADA">Privada</option>
          </select>
        </div>
      </div>

      {/* Schools Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredSchools.map((s) => {
          const isActive = s.id === activeSchoolId;
          const isMunicipal = s.network === "MUNICIPAL";

          return (
            <div
              key={s.id}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 transition-all shadow-xs relative flex flex-col justify-between ${
                isActive
                  ? "border-sky-500 ring-2 ring-sky-500/20 shadow-md"
                  : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 flex items-center justify-center flex-shrink-0">
                      <img
                        src={s.logoUrl || "/logo.svg"}
                        alt={s.name}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = "/logo.svg";
                        }}
                      />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                        {s.name}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {s.municipality} - {s.state} {s.inep ? `• INEP: ${s.inep}` : ""}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isMunicipal
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                    }`}
                  >
                    {isMunicipal ? "SEMEC" : "SEED-PR"}
                  </span>
                </div>

                {/* Counts / Stats */}
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-100 dark:border-slate-800 text-center my-3">
                  <div>
                    <span className="block text-base font-bold text-slate-800 dark:text-slate-200">
                      {s.studentsCount}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Estudantes</span>
                  </div>
                  <div>
                    <span className="block text-base font-bold text-slate-800 dark:text-slate-200">
                      {s.classesCount}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Turmas</span>
                  </div>
                  <div>
                    <span className="block text-base font-bold text-slate-800 dark:text-slate-200">
                      {s.staffCount}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Equipe</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center space-x-1.5 text-xs">
                  {s.hasSyncToken ? (
                    <span className="inline-flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
                      <Key className="w-3.5 h-3.5" />
                      <span>Extensão Vinculada</span>
                    </span>
                  ) : (
                    <span className="text-slate-400 text-[11px]">Sem chave da extensão</span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  {isActive ? (
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 text-xs font-bold border border-sky-200 dark:border-sky-800">
                      <Check className="w-3.5 h-3.5" />
                      <span>Escola Ativa</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={switching === s.id}
                      onClick={() => handleSwitchSchool(s.id)}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold border border-slate-300 dark:border-slate-700 transition disabled:opacity-50"
                    >
                      {switching === s.id ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Alternando...</span>
                        </>
                      ) : (
                        <span>Alternar Contexto</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredSchools.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Nenhuma instituição encontrada
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Tente refazer sua busca ou filtre por outra rede de ensino.
          </p>
        </div>
      )}

      {/* Modal: Cadastrar Nova Escola */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute right-4 top-4 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2.5 mb-5">
              <div className="p-2 bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 rounded-xl">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Cadastrar Nova Instituição Escolar
                </h3>
                <p className="text-xs text-slate-500">
                  Cadastre colégios da rede municipal (SEMEC) ou estadual (SEED-PR)
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateSchool} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo da Escola *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Ex: Escola Municipal Professor David Federmann"
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nome Curto / Sigla
                  </label>
                  <input
                    type="text"
                    name="shortName"
                    value={formData.shortName}
                    onChange={handleInputChange}
                    placeholder="Ex: E.M. David Federmann"
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Código INEP (MEC)
                  </label>
                  <input
                    type="text"
                    name="inep"
                    value={formData.inep}
                    onChange={handleInputChange}
                    placeholder="Ex: 41042730"
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Rede de Ensino *
                  </label>
                  <select
                    name="network"
                    value={formData.network}
                    onChange={handleInputChange}
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold"
                  >
                    <option value="MUNICIPAL">Municipal (SEMEC)</option>
                    <option value="ESTADUAL">Estadual (SEED-PR)</option>
                    <option value="PRIVADA">Privada / Particular</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Município / UF *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      name="municipality"
                      required
                      value={formData.municipality}
                      onChange={handleInputChange}
                      placeholder="Tibagi"
                      className="col-span-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <input
                      type="text"
                      name="state"
                      required
                      maxLength={2}
                      value={formData.state}
                      onChange={handleInputChange}
                      placeholder="PR"
                      className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 uppercase text-center font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Telefone Institucional
                  </label>
                  <input
                    type="text"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="(42) 3275-0000"
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    E-mail Institucional
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="escola@tibagi.pr.gov.br"
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  URL do Brasão / Logotipo
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="logoUrl"
                    value={formData.logoUrl}
                    onChange={handleInputChange}
                    placeholder="https://... ou /logo.svg"
                    className="flex-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                  <label className="cursor-pointer inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 transition">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-50"
                >
                  {creating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Cadastrando...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Confirmar Cadastro</span>
                    </>
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
