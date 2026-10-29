"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  AlertTriangle, 
  Search, 
  Flame, 
  ShieldAlert, 
  CheckCircle, 
  Edit3, 
  ExternalLink,
  Users,
  UploadCloud,
  FileSpreadsheet,
  Check,
  X,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Minus,
  Download,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  GraduationCap
} from "lucide-react";

interface Props {
  rankedAbsences: any[];
  lowAttendance: any[];
  classGroups: any[];
}

export default function FaltasClient({ rankedAbsences, lowAttendance, classGroups }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"serp" | "ranking">("serp");
  
  // Filtros Avançados
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSegment, setSelectedSegment] = useState("TODOS");
  const [selectedShift, setSelectedShift] = useState("TODOS");
  const [selectedTurma, setSelectedTurma] = useState("");
  const [selectedRiskRange, setSelectedRiskRange] = useState<"TODOS" | "CRITICO" | "ATENCAO" | "REGULAR">("TODOS");
  const [selectedActionStatus, setSelectedActionStatus] = useState<"TODOS" | "COM_ACAO" | "SEM_ACAO">("TODOS");
  const [sortBy, setSortBy] = useState<"MENOR_FREQ" | "MAIOR_FREQ" | "MAIOR_QUEDA" | "NOME_AZ" | "NOME_ZA">("MENOR_FREQ");
  
  // Controle de Visualização
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Edit action modal
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [actionText, setActionText] = useState("");
  const [percentText, setPercentText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [recordsList, setRecordsList] = useState(lowAttendance);

  // Import Power BI Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [importError, setImportError] = useState("");

  // Helper para interpretar enrollmentDetail
  const parseDetail = (detail?: string | null) => {
    if (!detail) return { cgm: null, semanaAtual: null, semanaAnterior: null, variacao: null };
    const cgmMatch = detail.match(/CGM:\s*([^\s|]+)/);
    const atualMatch = detail.match(/Semana Atual:\s*([^\s|]+)/);
    const antMatch = detail.match(/Semana Anterior:\s*([^\s|]+)/);
    
    const semanaAtual = atualMatch ? atualMatch[1] : null;
    const semanaAnterior = antMatch ? antMatch[1] : null;
    const cgm = cgmMatch ? cgmMatch[1] : null;

    let variacao: number | null = null;
    if (semanaAtual && semanaAnterior) {
      const vAtual = parseFloat(semanaAtual.replace("%", "").replace(",", "."));
      const vAnt = parseFloat(semanaAnterior.replace("%", "").replace(",", "."));
      if (!isNaN(vAtual) && !isNaN(vAnt)) {
        variacao = +(vAtual - vAnt).toFixed(1);
      }
    }

    return { cgm, semanaAtual, semanaAnterior, variacao };
  };

  // 1. KPIs Consolidados da Escola (Calculados sobre todos os registros de presença)
  const kpis = useMemo(() => {
    const total = recordsList.length;
    if (total === 0) {
      return { total: 0, critico: 0, atencao: 0, regular: 0, mediaGeral: 0, comAcao: 0 };
    }

    let critico = 0;
    let atencao = 0;
    let regular = 0;
    let sumPercent = 0;
    let comAcao = 0;

    recordsList.forEach((rec) => {
      const p = rec.attendancePercent;
      sumPercent += p;
      if (p < 75) critico++;
      else if (p < 85) atencao++;
      else regular++;

      if (rec.actionsTaken && rec.actionsTaken.trim().length > 0) {
        comAcao++;
      }
    });

    return {
      total,
      critico,
      atencao,
      regular,
      mediaGeral: +(sumPercent / total).toFixed(1),
      comAcao,
    };
  }, [recordsList]);

  // Turmas filtradas pelo segmento/turno selecionado
  const filteredClassGroups = useMemo(() => {
    return classGroups.filter((cg) => {
      const matchSegment = selectedSegment === "TODOS" || cg.segment === selectedSegment;
      const matchShift = selectedShift === "TODOS" || cg.shift === selectedShift;
      return matchSegment && matchShift;
    });
  }, [classGroups, selectedSegment, selectedShift]);

  // 2. Filtro e Ordenação dos Alunos em Infrequência
  const filteredLowAttendance = useMemo(() => {
    let list = recordsList.filter((rec) => {
      const st = rec.student;
      const term = searchTerm.toLowerCase().trim();

      // Busca por Nome ou CGM
      const detailInfo = parseDetail(rec.enrollmentDetail);
      const studentCgm = (st.cgm || detailInfo.cgm || "").toLowerCase();
      const matchSearch =
        !term ||
        st.name.toLowerCase().includes(term) ||
        studentCgm.includes(term) ||
        (rec.actionsTaken && rec.actionsTaken.toLowerCase().includes(term));

      // Segmento e Turno
      const matchSegment = selectedSegment === "TODOS" || st.classGroup.segment === selectedSegment;
      const matchShift = selectedShift === "TODOS" || st.classGroup.shift === selectedShift;
      const matchTurma = !selectedTurma || st.classGroupId === selectedTurma;

      // Faixa de Risco
      const p = rec.attendancePercent;
      let matchRisk = true;
      if (selectedRiskRange === "CRITICO") matchRisk = p < 75;
      else if (selectedRiskRange === "ATENCAO") matchRisk = p >= 75 && p < 85;
      else if (selectedRiskRange === "REGULAR") matchRisk = p >= 85;

      // Status de Ações
      let matchAction = true;
      const hasAction = !!rec.actionsTaken && rec.actionsTaken.trim().length > 0;
      if (selectedActionStatus === "COM_ACAO") matchAction = hasAction;
      else if (selectedActionStatus === "SEM_ACAO") matchAction = !hasAction;

      return matchSearch && matchSegment && matchShift && matchTurma && matchRisk && matchAction;
    });

    // Ordenação
    list.sort((a, b) => {
      if (sortBy === "MENOR_FREQ") return a.attendancePercent - b.attendancePercent;
      if (sortBy === "MAIOR_FREQ") return b.attendancePercent - a.attendancePercent;
      if (sortBy === "NOME_AZ") return a.student.name.localeCompare(b.student.name);
      if (sortBy === "NOME_ZA") return b.student.name.localeCompare(a.student.name);
      if (sortBy === "MAIOR_QUEDA") {
        const vA = parseDetail(a.enrollmentDetail).variacao ?? 0;
        const vB = parseDetail(b.enrollmentDetail).variacao ?? 0;
        return vA - vB; // Menores valores (ex: -50%) primeiro
      }
      return 0;
    });

    return list;
  }, [
    recordsList,
    searchTerm,
    selectedSegment,
    selectedShift,
    selectedTurma,
    selectedRiskRange,
    selectedActionStatus,
    sortBy,
  ]);

  // Paginação
  const paginatedRecords = useMemo(() => {
    if (pageSize >= 9999) return filteredLowAttendance;
    const start = (currentPage - 1) * pageSize;
    return filteredLowAttendance.slice(start, start + pageSize);
  }, [filteredLowAttendance, currentPage, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredLowAttendance.length / pageSize));

  // Exportar visualização atual para CSV
  const handleExportCSV = () => {
    if (filteredLowAttendance.length === 0) return;
    const headers = ["CGM", "Nome", "Turma", "Turno", "Frequencia_Geral", "Semana_Atual", "Semana_Anterior", "Variacao", "Medidas_Adotadas"];
    const rows = [headers.join(";")];

    filteredLowAttendance.forEach((rec) => {
      const d = parseDetail(rec.enrollmentDetail);
      const cgm = rec.student.cgm || d.cgm || "";
      rows.push([
        `"${cgm}"`,
        `"${rec.student.name.replace(/"/g, '""')}"`,
        `"${rec.student.classGroup.name}"`,
        `"${rec.student.classGroup.shift || ""}"`,
        `"${rec.attendancePercent.toFixed(1)}%"`,
        `"${d.semanaAtual || ""}"`,
        `"${d.semanaAnterior || ""}"`,
        `"${d.variacao !== null ? (d.variacao > 0 ? "+" : "") + d.variacao + "%" : ""}"`,
        `"${(rec.actionsTaken || "").replace(/"/g, '""')}"`
      ].join(";"));
    });

    const csvContent = "\uFEFF" + rows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Frequencia_Filtrada_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Salvar ação pedagógica
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

  // Helper para interpretar CSV ou JSON no modal de importação
  const processInputData = (raw: string) => {
    setImportError("");
    setSyncResult(null);
    const clean = raw.replace(/^\uFEFF/, "").trim();
    if (!clean) {
      setParsedData([]);
      return;
    }

    try {
      if (clean.startsWith("[") || clean.startsWith("{")) {
        const json = JSON.parse(clean);
        const arr = Array.isArray(json) ? json : json.alunos || [];
        if (arr.length > 0) {
          setParsedData(arr);
          return;
        }
      }

      const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 1) {
        const delimiter = lines[0].includes(";") ? ";" : ",";
        const rows: any[] = [];
        const startIdx = lines[0].toLowerCase().includes("cgm") || lines[0].toLowerCase().includes("nome") ? 1 : 0;

        for (let i = startIdx; i < lines.length; i++) {
          const parts = lines[i].split(delimiter).map((p) => p.replace(/^["']|["']$/g, "").trim());
          if (parts.length >= 2) {
            rows.push({
              cgm: parts[0] || "",
              nome: parts[1] || "",
              turma: parts[2] || "",
              mediaGeral: parts[3] || "",
              semanaAtual: parts[4] || "",
              semanaAnterior: parts[5] || "",
            });
          }
        }

        if (rows.length > 0) {
          setParsedData(rows);
          return;
        }
      }

      setImportError("Formato não reconhecido. Cole o JSON ou envie o arquivo CSV exportado pela extensão.");
      setParsedData([]);
    } catch (e: any) {
      setImportError("Erro ao processar dados: " + e.message);
      setParsedData([]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = String(evt.target?.result || "");
      setImportText(`Arquivo carregado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      processInputData(content);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleConfirmSync = async () => {
    if (parsedData.length === 0) return;
    setIsSyncing(true);
    setImportError("");
    setSyncResult(null);

    try {
      const res = await fetch("/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alunos: parsedData }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Falha na sincronização.");
      }

      setSyncResult(data);
      router.refresh();
    } catch (e: any) {
      setImportError(e.message || "Erro de rede ao conectar com a API.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 1. Header Principal com Alternador de Abas e Ações */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Painel de Frequência & Busca Ativa Escolar
              </h1>
              <p className="text-xs text-slate-500">
                Colégio Estadual Leopoldina B. Pedroso • Dados Oficiais Integrados com Power BI (SEED-PR)
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Botão de Importação Power BI */}
          <button
            type="button"
            onClick={() => {
              setIsImportModalOpen(true);
              setSyncResult(null);
              setImportError("");
            }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center space-x-1.5 shadow-xs transition"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Sincronizar Power BI</span>
          </button>

          {/* Exportar CSV */}
          <button
            type="button"
            onClick={handleExportCSV}
            title="Exportar dados filtrados para Excel"
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center space-x-1.5 shadow-2xs transition"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>

          {/* Alternador de Densidade */}
          <button
            type="button"
            onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
            title={density === "compact" ? "Mudar para modo espaçoso" : "Mudar para modo compacto"}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs flex items-center space-x-1 shadow-2xs transition"
          >
            {density === "compact" ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            <span className="text-[11px] font-medium hidden md:inline">
              {density === "compact" ? "Compacto" : "Espaçoso"}
            </span>
          </button>

          {/* Abas */}
          <div className="flex p-1 bg-slate-200 rounded-xl space-x-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab("serp")}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === "serp"
                  ? "bg-white text-amber-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Frequência & SERP ({recordsList.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ranking")}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === "ranking"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Contatos de Falta ({rankedAbsences.length})
            </button>
          </div>
        </div>
      </div>

      {/* 2. Cards de Resumo Executivo (KPIs) */}
      {activeTab === "serp" && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3">
          <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center space-x-3">
            <div className="p-2.5 bg-slate-100 text-slate-700 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Monitorados
              </span>
              <strong className="text-lg sm:text-xl font-black text-slate-900 leading-none">
                {kpis.total} alunos
              </strong>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-red-200/80 shadow-2xs flex items-center space-x-3 bg-red-50/20">
            <div className="p-2.5 bg-red-100 text-red-700 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-red-600 uppercase tracking-wider block">
                Risco Crítico (&lt;75%)
              </span>
              <strong className="text-lg sm:text-xl font-black text-red-700 leading-none">
                {kpis.critico}
                <span className="text-xs font-normal text-red-500 ml-1">
                  ({kpis.total > 0 ? ((kpis.critico / kpis.total) * 100).toFixed(0) : 0}%)
                </span>
              </strong>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-amber-200/80 shadow-2xs flex items-center space-x-3 bg-amber-50/20">
            <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider block">
                Atenção (75-85%)
              </span>
              <strong className="text-lg sm:text-xl font-black text-amber-800 leading-none">
                {kpis.atencao} alunos
              </strong>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center space-x-3">
            <div className="p-2.5 bg-sky-100 text-sky-700 rounded-xl">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Média Geral Escola
              </span>
              <strong className="text-lg sm:text-xl font-black text-slate-900 leading-none">
                {kpis.mediaGeral}%
              </strong>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200 shadow-2xs col-span-2 lg:col-span-1 flex items-center space-x-3">
            <div className="p-2.5 bg-purple-100 text-purple-700 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Ações SERP / CT
              </span>
              <strong className="text-lg sm:text-xl font-black text-purple-800 leading-none">
                {kpis.comAcao} registros
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* 3. Barra de Filtros Inteligente Multi-Critério */}
      <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        {/* Linha 1: Busca + Filtros Principais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 text-xs">
          {/* Busca Rápida */}
          <div className="lg:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por Nome do Aluno ou CGM..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500 text-xs"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Segmento */}
          <div className="lg:col-span-2">
            <select
              value={selectedSegment}
              onChange={(e) => {
                setSelectedSegment(e.target.value);
                setSelectedTurma("");
                setCurrentPage(1);
              }}
              className="w-full border border-slate-300 rounded-lg py-2 px-2.5 bg-slate-50 focus:bg-white text-xs font-medium"
            >
              <option value="TODOS">Todos os Segmentos</option>
              <option value="FUNDAMENTAL">Fundamental</option>
              <option value="MEDIO">Ensino Médio</option>
              <option value="NOTURNO">Noturno</option>
            </select>
          </div>

          {/* Turno */}
          <div className="lg:col-span-2">
            <select
              value={selectedShift}
              onChange={(e) => {
                setSelectedShift(e.target.value);
                setSelectedTurma("");
                setCurrentPage(1);
              }}
              className="w-full border border-slate-300 rounded-lg py-2 px-2.5 bg-slate-50 focus:bg-white text-xs font-medium"
            >
              <option value="TODOS">Todos os Turnos</option>
              <option value="MANHA">Manhã</option>
              <option value="TARDE">Tarde</option>
              <option value="NOITE">Noite</option>
            </select>
          </div>

          {/* Turma */}
          <div className="lg:col-span-2">
            <select
              value={selectedTurma}
              onChange={(e) => {
                setSelectedTurma(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full border border-slate-300 rounded-lg py-2 px-2.5 bg-slate-50 focus:bg-white text-xs font-medium"
            >
              <option value="">Todas as Turmas ({filteredClassGroups.length})</option>
              {filteredClassGroups.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Ordenação */}
          <div className="lg:col-span-2">
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="w-full border border-slate-300 rounded-lg py-2 px-2.5 bg-slate-50 focus:bg-white text-xs font-medium text-slate-800"
            >
              <option value="MENOR_FREQ">Menor Frequência</option>
              <option value="MAIOR_FREQ">Maior Frequência</option>
              <option value="MAIOR_QUEDA">Maior Queda Semanal</option>
              <option value="NOME_AZ">Ordem Alfabética (A-Z)</option>
              <option value="NOME_ZA">Ordem Alfabética (Z-A)</option>
            </select>
          </div>
        </div>

        {/* Linha 2: Chips Rápidos de Faixa de Risco & Status SERP */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">
              Faixa:
            </span>
            {[
              { id: "TODOS", label: "Todas as Faixas" },
              { id: "CRITICO", label: `🚨 Risco Crítico (<75%) (${kpis.critico})` },
              { id: "ATENCAO", label: `⚠️ Em Atenção (75-85%) (${kpis.atencao})` },
              { id: "REGULAR", label: `✅ Regular (≥85%) (${kpis.regular})` },
            ].map((chip) => {
              const isSelected = selectedRiskRange === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => {
                    setSelectedRiskRange(chip.id as any);
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                    isSelected
                      ? chip.id === "CRITICO"
                        ? "bg-red-600 text-white shadow-2xs"
                        : chip.id === "ATENCAO"
                        ? "bg-amber-600 text-white shadow-2xs"
                        : "bg-slate-900 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center space-x-3">
            {/* Status SERP */}
            <div className="flex items-center space-x-1.5 text-xs text-slate-600">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                SERP:
              </span>
              <select
                value={selectedActionStatus}
                onChange={(e: any) => {
                  setSelectedActionStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="border border-slate-300 rounded-md py-1 px-2 bg-slate-50 text-xs"
              >
                <option value="TODOS">Todos os Casos</option>
                <option value="COM_ACAO">Com Encaminhamento Registrado</option>
                <option value="SEM_ACAO">Sem Encaminhamento Registrado</option>
              </select>
            </div>

            {/* Limpar Filtros */}
            {(searchTerm || selectedSegment !== "TODOS" || selectedShift !== "TODOS" || selectedTurma || selectedRiskRange !== "TODOS" || selectedActionStatus !== "TODOS") && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setSelectedSegment("TODOS");
                  setSelectedShift("TODOS");
                  setSelectedTurma("");
                  setSelectedRiskRange("TODOS");
                  setSelectedActionStatus("TODOS");
                  setCurrentPage(1);
                }}
                className="text-xs text-sky-600 hover:text-sky-800 font-semibold"
              >
                Limpar Filtros
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4. Grade de Dados com Sticky Header (Aba SERP / Frequência Oficial) */}
      {activeTab === "serp" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          {/* Barra de Status da Tabela */}
          <div className="p-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-slate-800">
                Mostrando {filteredLowAttendance.length} alunos
              </span>
              {filteredLowAttendance.length !== recordsList.length && (
                <span className="text-slate-500 font-normal">
                  (de um total de {recordsList.length})
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-slate-500">Exibir por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="border border-slate-300 rounded-md py-0.5 px-2 bg-white text-xs font-semibold"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={99999}>Todos ({filteredLowAttendance.length})</option>
              </select>
            </div>
          </div>

          {/* Wrapper da Tabela com Rolagem e Sticky Header */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Tabela de infrequência escolar"
            className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-290px)] focus:outline-none"
          >
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 font-extrabold border-b border-slate-200 shadow-2xs">
                <tr>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} w-10 text-center`}>#</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} min-w-[200px]`}>Estudante</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} min-w-[120px]`}>Turma / Turno</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} text-center min-w-[130px]`}>Média Geral</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} text-center min-w-[95px]`}>Semana Atual</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} text-center min-w-[95px]`}>Semana Ant.</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} text-center min-w-[100px]`}>Variação</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} min-w-[220px]`}>Medidas Adotadas (SERP / CT)</th>
                  <th className={`p-3 ${density === "compact" ? "py-2" : "py-3"} text-right min-w-[130px]`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {paginatedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-10 text-center text-slate-400">
                      Nenhum estudante encontrado com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((rec, index) => {
                    const rowNum = (currentPage - 1) * pageSize + index + 1;
                    const d = parseDetail(rec.enrollmentDetail);
                    const cgm = rec.student.cgm || d.cgm;
                    const percent = rec.attendancePercent;
                    const isCritical = percent < 75;
                    const isAttention = percent >= 75 && percent < 85;

                    return (
                      <tr
                        key={rec.id}
                        className={`transition hover:bg-slate-50/80 ${
                          isCritical ? "bg-red-50/15" : ""
                        }`}
                      >
                        {/* Numeração */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"} text-center text-slate-400 font-mono text-[11px]`}>
                          {rowNum}
                        </td>

                        {/* Nome do Estudante & CGM */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"}`}>
                          <div className="font-bold text-slate-900 tracking-tight leading-snug">
                            {rec.student.name}
                          </div>
                          <div className="flex items-center space-x-2 text-[11px] text-slate-500 font-mono mt-0.5">
                            {cgm && (
                              <span className="bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                                CGM: {cgm}
                              </span>
                            )}
                            {rec.student.phone && (
                              <span className="text-slate-400">
                                Tel: {rec.student.phone}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Turma & Turno */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"}`}>
                          <div className="font-semibold text-slate-800">
                            {rec.student.classGroup.name}
                          </div>
                          <span className="text-[10px] text-slate-500 font-medium">
                            {rec.student.classGroup.shift || rec.student.classGroup.segment}
                          </span>
                        </td>

                        {/* Média Geral com Barra de Risco */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"} text-center`}>
                          <div className="inline-flex items-center space-x-2">
                            <span
                              className={`px-2.5 py-0.5 rounded-full font-black text-xs ${
                                isCritical
                                  ? "bg-red-100 text-red-800 animate-pulse border border-red-300"
                                  : isAttention
                                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              }`}
                            >
                              {percent.toFixed(1)}%
                            </span>
                          </div>
                          {/* Mini barra de progresso visual */}
                          <div className="w-20 mx-auto bg-slate-200 rounded-full h-1 mt-1 overflow-hidden">
                            <div
                              className={`h-1 rounded-full ${
                                isCritical ? "bg-red-500" : isAttention ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(100, Math.max(5, percent))}%` }}
                            />
                          </div>
                        </td>

                        {/* Semana Atual */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"} text-center font-mono font-bold text-slate-800`}>
                          {d.semanaAtual || "—"}
                        </td>

                        {/* Semana Anterior */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"} text-center font-mono text-slate-600`}>
                          {d.semanaAnterior || "—"}
                        </td>

                        {/* Variação Semanal */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"} text-center font-mono text-xs`}>
                          {d.variacao !== null ? (
                            d.variacao < 0 ? (
                              <span className="inline-flex items-center space-x-0.5 text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded">
                                <TrendingDown className="w-3.5 h-3.5" />
                                <span>{d.variacao}%</span>
                              </span>
                            ) : d.variacao > 0 ? (
                              <span className="inline-flex items-center space-x-0.5 text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                                <TrendingUp className="w-3.5 h-3.5" />
                                <span>+{d.variacao}%</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-0.5 text-slate-400 font-medium">
                                <Minus className="w-3 h-3" />
                                <span>0%</span>
                              </span>
                            )
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Medidas Adotadas (SERP / CT) */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"}`}>
                          {rec.actionsTaken ? (
                            <div className="text-xs text-slate-800 bg-amber-50/50 p-1.5 rounded-lg border border-amber-200/60 font-medium">
                              {rec.actionsTaken}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">
                              Nenhuma ação registrada
                            </span>
                          )}
                        </td>

                        {/* Ações: Editar Medidas + Disparar Busca Ativa */}
                        <td className={`p-3 ${density === "compact" ? "py-1.5" : "py-3"} text-right space-x-1.5 whitespace-nowrap`}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRecord(rec);
                              setPercentText(String(rec.attendancePercent));
                              setActionText(rec.actionsTaken || "");
                            }}
                            className="p-1 text-slate-500 hover:text-sky-600 rounded transition"
                            title="Editar Medidas / Frequência"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <Link
                            href={`/busca-ativa?turma=${rec.student.classGroupId}&aluno=${rec.student.id}`}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg text-xs font-bold border border-sky-200 transition"
                            title="Abrir Busca Ativa para contato com os responsáveis"
                          >
                            <span>Busca Ativa</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {pageSize < 9999 && totalPages > 1 && (
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong> ({filteredLowAttendance.length} alunos)
              </span>

              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40 transition"
                >
                  <ChevronLeft className="w-3.5 h-3.5 inline mr-0.5" /> Anterior
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40 transition"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5 inline ml-0.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Aba Alternativa: Ranking de Faltas (Contatos de WhatsApp) */}
      {activeTab === "ranking" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-slate-800 font-bold text-sm">
              <Flame className="w-4 h-4 text-red-500" />
              <span>Ranking por Contatos de Falta Disparados</span>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              Alunos com avisos de falta disparados à família via sistema
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3 w-16 text-center">Posição</th>
                  <th className="p-3">Estudante</th>
                  <th className="p-3">Turma</th>
                  <th className="p-3 text-center">Contatos de Falta</th>
                  <th className="p-3">Último Disparo</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rankedAbsences.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      Nenhum registro de falta enviado via WhatsApp ainda.
                    </td>
                  </tr>
                ) : (
                  rankedAbsences.map((item, index) => (
                    <tr key={item.student.id} className="hover:bg-slate-50 transition">
                      <td className="p-3 text-center font-bold">
                        {index === 0 && <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-black">1º</span>}
                        {index === 1 && <span className="inline-block px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-black">2º</span>}
                        {index === 2 && <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-black">3º</span>}
                        {index > 2 && <span className="text-slate-400">{index + 1}º</span>}
                      </td>
                      <td className="p-3 font-semibold text-slate-900">
                        {item.student.name}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-medium">
                          {item.student.classGroup.name}
                        </span>
                      </td>
                      <td className="p-3 text-center font-extrabold text-red-600 text-sm">
                        {item.count} avisos
                      </td>
                      <td className="p-3 text-slate-500">
                        {new Date(item.lastDate).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="p-3 text-right">
                        <Link
                          href={`/busca-ativa?turma=${item.student.classGroupId}&aluno=${item.student.id}`}
                          className="inline-flex items-center space-x-1 text-sky-600 hover:text-sky-800 font-semibold text-xs"
                        >
                          <span>Busca Ativa</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Importação Power BI */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Importar Frequência Escolar do Power BI
                  </h3>
                  <p className="text-xs text-slate-500">
                    Atualize os percentuais oficiais para a equipe pedagógica
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sucesso */}
            {syncResult && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                <div className="flex items-center space-x-2 text-emerald-800 font-bold text-sm">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <span>Sincronização Concluída com Sucesso!</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                  <div className="bg-white p-2 rounded border border-emerald-100">
                    <span className="text-slate-500 block">Total Recebido</span>
                    <strong className="text-slate-900 text-sm">{syncResult.totalRecebido}</strong>
                  </div>
                  <div className="bg-white p-2 rounded border border-emerald-100">
                    <span className="text-slate-500 block">Atualizados</span>
                    <strong className="text-emerald-700 text-sm">{syncResult.atualizados}</strong>
                  </div>
                  <div className="bg-white p-2 rounded border border-emerald-100">
                    <span className="text-slate-500 block">CGMs Vinculados</span>
                    <strong className="text-sky-700 text-sm">{syncResult.cgmVinculados}</strong>
                  </div>
                  <div className="bg-white p-2 rounded border border-emerald-100">
                    <span className="text-slate-500 block">Alunos em Risco</span>
                    <strong className="text-red-700 text-sm">{syncResult.emRiscoCount}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Erro */}
            {importError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{importError}</span>
              </div>
            )}

            {/* Opções de Ingestão */}
            {!syncResult && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5 flex items-center space-x-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span>Opção 1: Enviar arquivo .CSV (Baixado pela Extensão)</span>
                  </label>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer border border-slate-200 rounded-xl p-1 bg-slate-50"
                  />
                </div>

                <div className="flex items-center my-2">
                  <div className="grow border-t border-slate-200"></div>
                  <span className="px-3 text-slate-400 text-[11px] font-semibold">OU</span>
                  <div className="grow border-t border-slate-200"></div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5 flex items-center justify-between">
                    <span>Opção 2: Colar Lista JSON</span>
                    <span className="text-[11px] font-normal text-slate-400">Clique em "Copiar JSON" na extensão</span>
                  </label>
                  <textarea
                    rows={4}
                    value={importText}
                    onChange={(e) => {
                      setImportText(e.target.value);
                      processInputData(e.target.value);
                    }}
                    placeholder="Cole aqui o JSON gerado pelo botão 'Copiar JSON' da extensão..."
                    className="w-full text-xs font-mono p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {syncResult ? "Fechar" : "Cancelar"}
              </button>
              {!syncResult && (
                <button
                  type="button"
                  onClick={handleConfirmSync}
                  disabled={isSyncing || parsedData.length === 0}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-xs flex items-center space-x-1.5"
                >
                  {isSyncing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Sincronizando...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Sincronizar no Banco ({parsedData.length} alunos)</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Ações */}
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
