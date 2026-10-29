"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  AlertTriangle, 
  Send, 
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
  Info
} from "lucide-react";

interface Props {
  rankedAbsences: any[];
  lowAttendance: any[];
  classGroups: any[];
}

export default function FaltasClient({ rankedAbsences, lowAttendance, classGroups }: Props) {
  const router = useRouter();
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

  // Import Power BI Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [importError, setImportError] = useState("");

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

  // Helper para interpretar CSV ou JSON colado / enviado
  const processInputData = (raw: string) => {
    setImportError("");
    setSyncResult(null);
    const clean = raw.replace(/^\uFEFF/, "").trim(); // Remove UTF-8 BOM
    if (!clean) {
      setParsedData([]);
      return;
    }

    try {
      // 1. Tenta JSON
      if (clean.startsWith("[") || clean.startsWith("{")) {
        const json = JSON.parse(clean);
        const arr = Array.isArray(json) ? json : json.alunos || [];
        if (arr.length > 0) {
          setParsedData(arr);
          return;
        }
      }

      // 2. Tenta CSV
      const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 1) {
        const delimiter = lines[0].includes(";") ? ";" : ",";
        const rows: any[] = [];
        
        // Pula o cabeçalho se houver
        const startIdx = lines[0].toLowerCase().includes("cgm") || lines[0].toLowerCase().includes("nome") ? 1 : 0;

        for (let i = startIdx; i < lines.length; i++) {
          const parts = lines[i]
            .split(delimiter)
            .map((p) => p.replace(/^["']|["']$/g, "").trim());

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
      // Atualiza a página para refletir as novas frequências no banco
      router.refresh();
    } catch (e: any) {
      setImportError(e.message || "Erro de rede ao conectar com a API.");
    } finally {
      setIsSyncing(false);
    }
  };

  // Estatísticas do preview
  const previewStats = useMemo(() => {
    if (parsedData.length === 0) return null;
    let emRisco = 0;
    parsedData.forEach((a) => {
      const num = parseFloat(String(a.mediaGeral || "").replace("%", "").replace(",", "."));
      if (!isNaN(num) && num < 75) emRisco++;
    });
    return {
      total: parsedData.length,
      emRisco,
    };
  }, [parsedData]);

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <span>Controle de Faltas & Busca Ativa (SERP / CT)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitoramento prioritário de alunos infrequentes e sincronização de dados oficiais da SEED-PR.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Botão para Sincronização Power BI */}
          <button
            type="button"
            onClick={() => {
              setIsImportModalOpen(true);
              setSyncResult(null);
              setImportError("");
            }}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center space-x-1.5 shadow-xs transition"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Importar Power BI</span>
          </button>

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
            {classGroups.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.segment})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab 1: Ranking of absences from WhatsApp logs */}
      {activeTab === "ranking" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-slate-800 font-bold text-sm">
              <Flame className="w-4 h-4 text-red-500" />
              <span>Ranking por Contatos de Falta Efetuados</span>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              Alunos com avisos de falta disparados à família
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
                {filteredRanked.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      Nenhum registro de falta encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredRanked.map((item, index) => (
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

      {/* Tab 2: SERP / Conselho Tutelar (Alunos em Risco Crítico de Infrequência) */}
      {activeTab === "serp" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-amber-50/60 border-b border-amber-200/60 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-amber-900 font-bold text-sm">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Controle de Frequência Oficial & Encaminhamentos (SERP / CT)</span>
            </div>
            <span className="text-xs text-amber-700 font-medium">
              Percentuais oficiais sincronizados do Power BI Estadual
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">Estudante</th>
                  <th className="p-3">Turma</th>
                  <th className="p-3 text-center">Frequência Geral</th>
                  <th className="p-3">Detalhes / Semanas</th>
                  <th className="p-3">Medidas Adotadas (SERP / CT)</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLowAttendance.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      Nenhum aluno em situação de baixa frequência registrado ainda. Importe os dados do Power BI acima!
                    </td>
                  </tr>
                ) : (
                  filteredLowAttendance.map((rec) => {
                    const isCritical = rec.attendancePercent < 75;
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50 transition">
                        <td className="p-3 font-semibold text-slate-900">
                          {rec.student.name}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-medium">
                            {rec.student.classGroup.name}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full font-black text-xs ${
                              isCritical
                                ? "bg-red-100 text-red-800 animate-pulse"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {rec.attendancePercent.toFixed(1)}%
                          </span>
                        </td>
                        <td className="p-3 text-slate-500 font-mono text-[11px]">
                          {rec.enrollmentDetail || "—"}
                        </td>
                        <td className="p-3 text-slate-700">
                          {rec.actionsTaken ? (
                            <span className="text-xs bg-slate-100 px-2 py-1 rounded border border-slate-200 font-medium">
                              {rec.actionsTaken}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Nenhum encaminhamento registrado</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRecord(rec);
                              setPercentText(String(rec.attendancePercent));
                              setActionText(rec.actionsTaken || "");
                            }}
                            className="inline-flex items-center space-x-1 text-slate-600 hover:text-sky-600 p-1"
                            title="Editar Medidas"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
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
                {/* Upload de Arquivo */}
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

                {/* Colar JSON / CSV */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5 flex items-center justify-between">
                    <span>Opção 2: Colar Lista JSON ou Texto Copiado</span>
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

                {/* Preview dos dados detectados */}
                {previewStats && (
                  <div className="p-3 bg-slate-100 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span className="font-semibold text-slate-800">
                        {previewStats.total} alunos identificados
                      </span>
                    </div>
                    <div>
                      <span className="px-2 py-1 bg-red-100 text-red-700 rounded-md font-bold">
                        {previewStats.emRisco} com frequência &lt; 75%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Rodapé do Modal */}
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
                      <span>Sincronizando no Banco...</span>
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
