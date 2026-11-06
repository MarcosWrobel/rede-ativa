"use client";

import { useState } from "react";
import {
  Building2,
  Save,
  Key,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Image as ImageIcon,
  CheckCircle2,
  Shield,
  Upload,
  Globe,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";

interface SchoolData {
  id: string;
  name: string;
  shortName: string;
  inep: string;
  network: "ESTADUAL" | "MUNICIPAL" | "PRIVADA";
  municipality: string;
  state: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string;
  hasSyncToken: boolean;
  syncTokenCreatedAt: string | null;
}

export default function EscolaSettingsClient({ school }: { school: SchoolData }) {
  const [formData, setFormData] = useState({
    name: school.name,
    shortName: school.shortName,
    inep: school.inep,
    network: school.network,
    municipality: school.municipality,
    state: school.state,
    phone: school.phone,
    email: school.email,
    address: school.address,
    logoUrl: school.logoUrl,
  });

  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync token state
  const [hasToken, setHasToken] = useState(school.hasSyncToken);
  const [tokenCreatedAt, setTokenCreatedAt] = useState(school.syncTokenCreatedAt);
  const [newGeneratedToken, setNewGeneratedToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Por favor, selecione um arquivo de imagem válido (PNG, JPG ou SVG).");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("O arquivo de imagem deve ter no máximo 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setFormData((prev) => ({ ...prev, logoUrl: reader.result as string }));
        setSuccessMessage("Logotipo carregado na pré-visualização. Clique em 'Salvar Alterações' para persistir.");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/schools/${school.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar dados da escola.");
      }

      setSuccessMessage("Dados da instituição e identidade visual atualizados com sucesso!");
      setTimeout(() => {
        // Reload to update dynamic header/sidebar
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || "Erro inesperado ao salvar alterações.");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateSyncToken = async () => {
    if (
      hasToken &&
      !confirm(
        "Atenção: Ao gerar uma nova chave de sincronização, extensões configuradas com a chave anterior perderão o acesso até que a nova chave seja inserida. Deseja continuar?"
      )
    ) {
      return;
    }

    setGeneratingToken(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/schools/${school.id}/sync-token`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao gerar chave de sincronização.");
      }

      setNewGeneratedToken(data.rawToken);
      setHasToken(true);
      setTokenCreatedAt(data.school.syncTokenCreatedAt);
      setSuccessMessage("Nova chave de sincronização gerada com sucesso! Copie-a abaixo antes de sair desta página.");
    } catch (err: any) {
      setErrorMessage(err.message || "Falha ao gerar chave da extensão.");
    } finally {
      setGeneratingToken(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2500);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 rounded-xl">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Identidade & Dados da Escola
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gerencie o nome institucional, brasão oficial, rede de ensino e credenciais de integração
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              formData.network === "MUNICIPAL"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                : "bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
            }`}
          >
            {formData.network === "MUNICIPAL" ? "Rede Municipal (SEMEC)" : "Rede Estadual (SEED-PR)"}
          </span>
        </div>
      </div>

      {/* Alerts */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center space-x-3 text-emerald-800 dark:text-emerald-200 text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl flex items-center space-x-3 text-red-800 dark:text-red-200 text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Section 1: Visual Identity */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2 mb-4">
            <ImageIcon className="w-4 h-4 text-sky-600" />
            <span>Brasão & Identidade Visual</span>
          </h2>

          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center p-2 overflow-hidden shadow-inner flex-shrink-0">
              {formData.logoUrl ? (
                <img
                  src={formData.logoUrl}
                  alt="Pré-visualização do logotipo"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/logo.svg";
                  }}
                />
              ) : (
                <Building2 className="w-10 h-10 text-slate-400" />
              )}
            </div>

            <div className="flex-1 space-y-3 w-full">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  URL da Imagem ou Logo Oficial
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="logoUrl"
                    value={formData.logoUrl}
                    onChange={handleInputChange}
                    placeholder="https://exemplo.gov.br/logo.png ou /logo.svg"
                    className="flex-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                  <label className="cursor-pointer inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 transition">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/svg+xml"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                  </label>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Recomendado: Formato SVG ou PNG com fundo transparente (resolução mínima 128x128px). Este brasão aparecerá no cabeçalho do sistema, atas digitais impressas e dossiês de busca ativa.
              </p>
            </div>
          </div>
        </div>

        {/* Section 2: School Details */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2 mb-2">
            <Globe className="w-4 h-4 text-sky-600" />
            <span>Dados Oficiais da Unidade Escolar</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nome Completo da Instituição *
              </label>
              <input
                type="text"
                name="name"
                required
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Ex: Escola Municipal Cecília Meireles"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nome Abreviado / Sigla
              </label>
              <input
                type="text"
                name="shortName"
                value={formData.shortName}
                onChange={handleInputChange}
                placeholder="Ex: E.M. Cecília Meireles"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Código INEP (MEC) *
              </label>
              <input
                type="text"
                name="inep"
                required
                value={formData.inep}
                onChange={handleInputChange}
                placeholder="Ex: 41042730"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Rede de Ensino *
              </label>
              <select
                name="network"
                value={formData.network}
                onChange={handleInputChange}
                className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
              >
                <option value="ESTADUAL">Estadual (SEED-PR)</option>
                <option value="MUNICIPAL">Municipal (SEMEC)</option>
                <option value="PRIVADA">Privada / Particular</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Município e Estado *
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

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center space-x-1">
                <Phone className="w-3 h-3 text-slate-400" />
                <span>Telefone Institucional</span>
              </label>
              <input
                type="text"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                placeholder="(42) 3275-1234"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center space-x-1">
                <Mail className="w-3 h-3 text-slate-400" />
                <span>E-mail Institucional</span>
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="escola@escola.pr.gov.br"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center space-x-1">
                <MapPin className="w-3 h-3 text-slate-400" />
                <span>Endereço Completo</span>
              </label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                placeholder="Rua / Avenida, Número, Bairro, CEP"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center space-x-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Salvar Alterações</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Section 3: Chrome Extension Sync Token */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-xl">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Chave de Sincronização da Extensão Chrome
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Token criptográfico exclusivo desta escola para envio automatizado de frequências e SERP
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {hasToken ? (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <Check className="w-3.5 h-3.5" />
                <span>Chave Ativa</span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Não Configurada</span>
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          A extensão do Google Chrome sincroniza as faltas do RCO / SERE diretamente para este servidor. Cada escola possui seu próprio token criptográfico, garantindo total isolamento de dados entre colégios estaduais e escolas municipais.
        </p>

        {/* Display New Token if generated */}
        {newGeneratedToken && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 border-2 border-emerald-500 rounded-xl space-y-3">
            <div className="flex items-center space-x-2 text-emerald-800 dark:text-emerald-200 text-xs font-bold">
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Chave Gerada com Sucesso! Copie agora — ela não será exibida novamente:</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={newGeneratedToken}
                className="flex-1 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-2 text-xs font-mono text-emerald-900 dark:text-emerald-100 select-all"
              />
              <button
                type="button"
                onClick={() => copyToClipboard(newGeneratedToken)}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition"
              >
                {copiedToken ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {tokenCreatedAt && (
              <span suppressHydrationWarning>Chave em vigor gerada em: {new Date(tokenCreatedAt).toLocaleDateString("pt-BR")}</span>
            )}
          </div>

          <button
            type="button"
            disabled={generatingToken}
            onClick={handleGenerateSyncToken}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 transition disabled:opacity-50"
          >
            {generatingToken ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Gerando Chave...</span>
              </>
            ) : (
              <>
                <Key className="w-4 h-4" />
                <span>{hasToken ? "Rotacionar Chave de Sincronização" : "Gerar Nova Chave"}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
