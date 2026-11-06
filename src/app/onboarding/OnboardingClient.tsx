"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Building2,
  Landmark,
  Image as ImageIcon,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Key,
  Copy,
  Check,
  ShieldCheck,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  BookOpen,
  Info,
} from "lucide-react";

interface NetworkItem {
  id: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  type: string;
}

interface Props {
  user: {
    id: string;
    name: string;
    email: string;
  };
  networks: NetworkItem[];
  existingCities: string[];
  isSuperAdmin: boolean;
}

export default function OnboardingClient({
  user,
  networks,
  existingCities,
  isSuperAdmin,
}: Props) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Passo 1: Dados da Instituição
  const [formData, setFormData] = useState({
    inep: "",
    name: "",
    shortName: "",
    network: "MUNICIPAL" as "MUNICIPAL" | "ESTADUAL" | "PRIVADA",
    city: existingCities[0] || "Tibagi",
    state: "PR",
    district: "Sede Urbana",
    phone: "",
    email: "",
    logoUrl: "",
  });

  // Passo 2: Pré-visualização do Brasão
  const [logoPreview, setLogoPreview] = useState<string>("");

  // Passo 3: Carga SERE
  const [sereFile, setSereFile] = useState<File | null>(null);
  const [skipSere, setSkipSere] = useState(false);
  const [importingSere, setImportingSere] = useState(false);
  const [sereFeedback, setSereFeedback] = useState<string | null>(null);

  // Passo 4: Escola Criada e Chave
  const [createdSchool, setCreatedSchool] = useState<any>(null);
  const [syncToken, setSyncToken] = useState<string>("");
  const [copiedToken, setCopiedToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [switchingTenant, setSwitchingTenant] = useState(false);

  // Validação de INEP da escola piloto fundadora
  const isPilotInep = formData.inep.trim() === "41042730";

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMsg("O arquivo de brasão deve ser uma imagem válida (PNG, JPG, SVG).");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogoPreview(reader.result);
        setFormData((prev) => ({ ...prev, logoUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  // Avançar do Passo 1 para o 2
  const handleNextFromStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPilotInep) {
      setErrorMsg(
        "O código INEP 41042730 pertence à Unidade Piloto Fundadora e não pode ser cadastrado novamente."
      );
      return;
    }
    if (!formData.name.trim() || !formData.inep.trim()) {
      setErrorMsg("Nome da instituição e Código INEP são campos obrigatórios.");
      return;
    }
    if (formData.inep.trim().length < 4) {
      setErrorMsg("O Código INEP deve ter no mínimo 4 dígitos.");
      return;
    }

    setErrorMsg("");
    setCurrentStep(2);
  };

  // Criar escola e avançar para o Passo 3
  const handleCreateAndProceed = async () => {
    setLoading(true);
    setErrorMsg("");

    try {
      const payload = {
        name: formData.name.trim(),
        inepCode: formData.inep.trim(),
        inep: formData.inep.trim(),
        network: formData.network,
        city: formData.city.trim(),
        municipality: formData.city.trim(),
        state: formData.state.trim().toUpperCase(),
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        logoUrl: formData.logoUrl || null,
        settings: {
          district: formData.district.trim() || "Sede Urbana",
          shortName: formData.shortName.trim() || undefined,
        },
      };

      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao registrar instituição escolar");
      }

      setCreatedSchool(data.school);

      // Gerar Token de Sincronização da Extensão RCO
      try {
        const tokenRes = await fetch(`/api/schools/${data.school.id}/sync-token`, {
          method: "POST",
        });
        const tokenData = await tokenRes.json();
        if (tokenRes.ok && tokenData.syncToken) {
          setSyncToken(tokenData.syncToken);
        }
      } catch (tokenErr) {
        console.warn("Falha ao gerar syncToken automático:", tokenErr);
      }

      setCurrentStep(3);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro de conexão ao criar escola.");
    } finally {
      setLoading(false);
    }
  };

  // Upload opcional de remessa SERE
  const handleProcessSere = async () => {
    if (!sereFile || !createdSchool) {
      setCurrentStep(4);
      return;
    }

    setImportingSere(true);
    setErrorMsg("");
    setSereFeedback(null);

    try {
      const form = new FormData();
      form.append("file", sereFile);
      form.append("schoolId", createdSchool.id);

      const res = await fetch("/api/students/import", {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Falha ao processar arquivo SERE.");
      }

      setSereFeedback(
        `Importação concluída com sucesso! ${data.importedCount || 0} alunos vinculados à nova escola.`
      );
      setTimeout(() => {
        setCurrentStep(4);
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao importar arquivo SERE.");
    } finally {
      setImportingSere(false);
    }
  };

  // Concluir e alternar contexto de tenant
  const handleFinishOnboarding = async () => {
    if (!createdSchool) {
      window.location.href = "/";
      return;
    }

    setSwitchingTenant(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: createdSchool.id }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Falha ao comutar para o painel da nova escola");
      }

      // Redireciona para o painel principal no novo contexto
      window.location.href = "/busca-ativa";
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao acessar a nova unidade.");
      setSwitchingTenant(false);
    }
  };

  const copySyncToken = () => {
    if (!syncToken) return;
    navigator.clipboard.writeText(syncToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2500);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header com Navegação */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin/escolas"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar ao Diretório</span>
        </Link>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
          <span>Wizard de Auto-Onboarding</span>
        </div>
      </div>

      {/* Banner Principal */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Adesão & Provisionamento de Instituição de Ensino
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100/90 max-w-2xl leading-relaxed">
            Configure uma nova escola em 4 etapas guiadas: identidade institucional, brasão oficial,
            carga inicial de estudantes e chave de sincronização da Extensão RCO.
          </p>
        </div>
      </div>

      {/* Stepper Visual */}
      <div className="grid grid-cols-4 gap-2 sm:gap-4">
        {[
          { step: 1, label: "Identificação", desc: "INEP e Rede" },
          { step: 2, label: "Brasão Oficial", desc: "Cabeçalho A4" },
          { step: 3, label: "Carga SERE", desc: "Turmas & Alunos" },
          { step: 4, label: "Ativação", desc: "Token da Extensão" },
        ].map((item) => (
          <div
            key={item.step}
            className={`p-3 sm:p-4 rounded-2xl border transition-all text-center sm:text-left ${
              currentStep === item.step
                ? "bg-emerald-50 border-emerald-400 text-emerald-950 shadow-xs"
                : currentStep > item.step
                ? "bg-slate-50 border-slate-200 text-slate-800"
                : "bg-white border-slate-200 text-slate-400 opacity-60"
            }`}
          >
            <div className="flex items-center gap-2 justify-center sm:justify-start">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                  currentStep === item.step
                    ? "bg-emerald-600 text-white"
                    : currentStep > item.step
                    ? "bg-slate-800 text-white"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {currentStep > item.step ? "✓" : item.step}
              </span>
              <span className="font-extrabold text-xs hidden sm:inline">{item.label}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 hidden sm:block">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Feedback de Erro */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl flex items-center justify-between text-xs text-rose-800 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg("")}
            className="font-bold underline ml-2 cursor-pointer"
          >
            Dispensar
          </button>
        </div>
      )}

      {/* Conteúdo dos Passos */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs">
        {/* PASSO 1: Identificação Institucional */}
        {currentStep === 1 && (
          <form onSubmit={handleNextFromStep1} className="space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Landmark className="w-5 h-5 text-emerald-600" />
                <span>Passo 1: Dados Institucionais & Código INEP</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Cadastre o identificador único da escola no Ministério da Educação (MEC/INEP).
              </p>
            </div>

            {isPilotInep && (
              <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl text-xs text-rose-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  O código INEP <strong>41042730</strong> é reservado à Unidade Piloto Fundadora da plataforma. Utilize o código INEP exclusivo da nova instituição.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  Código INEP da Escola *
                </label>
                <input
                  type="text"
                  placeholder="Ex: 41049999"
                  value={formData.inep}
                  onChange={(e) => setFormData({ ...formData, inep: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  required
                />
                <span className="text-[10px] text-slate-400">8 dígitos conforme base oficial MEC</span>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  Rede de Ensino *
                </label>
                <select
                  value={formData.network}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      network: e.target.value as any,
                    })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="MUNICIPAL">Rede Municipal (SEMEC)</option>
                  <option value="ESTADUAL">Rede Estadual (SEED-PR)</option>
                  <option value="PRIVADA">Rede Privada / Particular</option>
                </select>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  Nome Oficial da Instituição de Ensino *
                </label>
                <input
                  type="text"
                  placeholder="Ex: Escola Municipal Professor David Federmann"
                  value={formData.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    const short = val.replace(/^(Escola Municipal|Colégio Estadual|E\.M\.|C\.E\.)\s+/i, "");
                    setFormData({ ...formData, name: val, shortName: short });
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  Município Sede *
                </label>
                <input
                  type="text"
                  placeholder="Ex: Tibagi"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  Estado (UF) *
                </label>
                <input
                  type="text"
                  maxLength={2}
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 uppercase"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  Polo / Distrito Escolar
                </label>
                <input
                  type="text"
                  placeholder="Ex: Sede Urbana, Caetano Mendes, São Bento..."
                  value={formData.district}
                  onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  WhatsApp Oficial da Busca Ativa
                </label>
                <input
                  type="text"
                  placeholder="(42) 99999-9999"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  E-mail Institucional da Secretaria
                </label>
                <input
                  type="email"
                  placeholder="escola@educacao.pr.gov.br"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                type="submit"
                disabled={isPilotInep}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                <span>Avançar para Identidade Visual</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* PASSO 2: Identidade Visual e Brasão */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-emerald-600" />
                <span>Passo 2: Brasão Oficial & Cabeçalho de Fé Pública</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Faça upload do brasão municipal ou estadual. Ele será aplicado automaticamente em todas as atas, certidões e relatórios oficiais em conformidade com a Lei 14.063/2020.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Upload do Brasão */}
              <div className="space-y-4">
                <label className="text-[11px] font-bold text-slate-700 block">
                  Carregar Arquivo do Brasão Oficial (PNG, SVG, JPG)
                </label>

                <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-emerald-500 transition-colors bg-slate-50/50">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="brasao-upload"
                  />
                  <label
                    htmlFor="brasao-upload"
                    className="cursor-pointer flex flex-col items-center justify-center space-y-2"
                  >
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                      <Upload className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-700">
                      Clique para selecionar o brasão oficial
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Recomendado: Fundo transparente (PNG ou SVG)
                    </span>
                  </label>
                </div>

                <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-[11px] text-sky-800 flex items-center gap-2">
                  <Info className="w-4 h-4 text-sky-600 shrink-0" />
                  <span>
                    Caso não possua o brasão em alta resolução no momento, você poderá adicionar ou alterar posteriormente no menu de Configurações da Escola.
                  </span>
                </div>
              </div>

              {/* Live Preview do Cabeçalho Oficial A4 */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-700 block">
                  Pré-visualização do Cabeçalho Institucional (Página A4)
                </label>
                <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/40 shadow-xs space-y-3">
                  <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                    {logoPreview || formData.logoUrl ? (
                      <img
                        src={logoPreview || formData.logoUrl}
                        alt="Brasão Oficial"
                        className="w-14 h-14 object-contain shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs shrink-0">
                        Brasão
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {formData.network === "MUNICIPAL"
                          ? `Prefeitura Municipal de ${formData.city}`
                          : "Governo do Estado do Paraná"}
                      </p>
                      <h4 className="text-xs font-black text-slate-900 leading-tight">
                        {formData.name || "Nome da Instituição de Ensino"}
                      </h4>
                      <p className="text-[10px] text-slate-600 font-medium">
                        INEP: {formData.inep || "XXXXXXXX"} • {formData.city}/{formData.state} • {formData.district}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 italic text-center">
                    Documento Oficial Emitido Eletronicamente • Rede Ativa SaaS
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                ← Voltar
              </button>

              <button
                type="button"
                onClick={handleCreateAndProceed}
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Provisionando Instituição...</span>
                  </>
                ) : (
                  <>
                    <span>Criar Instituição & Avançar</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* PASSO 3: Carga Inicial SERE / RCO */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <span>Passo 3: Importação Inicial de Turmas & Alunos (SERE / RCO)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Carregue a planilha oficial exportada do SERE (.xlsx ou .csv) ou relatório para popular as turmas da nova escola.
              </p>
            </div>

            {sereFeedback && (
              <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{sereFeedback}</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center hover:border-emerald-500 transition-colors bg-slate-50/50">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  onChange={(e) => setSereFile(e.target.files?.[0] || null)}
                  className="hidden"
                  id="sere-file-upload"
                />
                <label
                  htmlFor="sere-file-upload"
                  className="cursor-pointer flex flex-col items-center justify-center space-y-2"
                >
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">
                    {sereFile ? sereFile.name : "Clique para selecionar o arquivo SERE (.xlsx, .csv, .pdf)"}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Formatos aceitos: Planilhas SERE Web ou relatórios em PDF
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>
                    Prefere carregar as turmas mais tarde? Você pode pular esta etapa e importar pela Central de Faltas ou via Extensão RCO.
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCurrentStep(4)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Pular Etapa e Concluir →
              </button>

              <button
                type="button"
                onClick={handleProcessSere}
                disabled={importingSere || !sereFile}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {importingSere ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processando Remessa...</span>
                  </>
                ) : (
                  <>
                    <span>Importar Remessa & Continuar</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* PASSO 4: Ativação, Chave de Sincronização & Prontidão */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div className="text-center space-y-2 py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-black text-slate-900">
                Instituição Provisionada com Sucesso!
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                A escola <strong>{createdSchool?.name || formData.name}</strong> está configurada com isolamento lógico multi-tenant e starter pack de modelos pedagógicos ativo.
              </p>
            </div>

            {/* Token da Extensão RCO */}
            <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">
                    Chave de Sincronização da Extensão Chrome (RCO/SERE)
                  </span>
                </div>
                <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950 px-2.5 py-0.5 rounded-full border border-emerald-800">
                  Pronta para uso
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800 border border-slate-700 font-mono text-xs">
                <span className="truncate mr-3 text-emerald-300">
                  {syncToken || "Gerando chave de segurança..."}
                </span>
                <button
                  type="button"
                  onClick={copySyncToken}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-bold shrink-0 transition cursor-pointer"
                >
                  {copiedToken ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar Chave</span>
                    </>
                  )}
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Insira esta chave nas configurações da Extensão do Chrome para permitir a importação automática de faltas diárias do RCO diretamente para esta escola.
              </p>
            </div>

            {/* Resumo Operacional */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">
                  Unidade Escolar
                </span>
                <span className="font-bold text-slate-800 truncate block mt-0.5">
                  {createdSchool?.name || formData.name}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">
                  Código INEP
                </span>
                <span className="font-bold text-slate-800 block mt-0.5">
                  {createdSchool?.inepCode || formData.inep}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">
                  Rede de Ensino
                </span>
                <span className="font-bold text-emerald-700 block mt-0.5">
                  {formData.network === "MUNICIPAL"
                    ? `SEMEC ${formData.city}`
                    : formData.network === "ESTADUAL"
                    ? "SEED-PR"
                    : "Privada"}
                </span>
              </div>
            </div>

            {/* Ação Final: Comutar e Acessar */}
            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={handleFinishOnboarding}
                disabled={switchingTenant}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-lg transition transform active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {switchingTenant ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Acessando Unidade...</span>
                  </>
                ) : (
                  <>
                    <span>Acessar Painel da Nova Escola Agora</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
