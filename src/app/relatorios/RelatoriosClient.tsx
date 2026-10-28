"use client";

import { useState, useMemo } from "react";
import { 
  BarChart3, 
  Printer, 
  Calendar, 
  Users, 
  CheckCircle2, 
  HelpCircle,
  TrendingUp,
  FileSpreadsheet
} from "lucide-react";

interface Props {
  allLogs: any[];
}

export default function RelatoriosClient({ allLogs }: Props) {
  const [selectedSegment, setSelectedSegment] = useState("TODOS");

  // Filter logs by segment
  const filteredLogs = useMemo(() => {
    if (selectedSegment === "TODOS") return allLogs;
    return allLogs.filter((l) => l.student.classGroup.segment === selectedSegment);
  }, [allLogs, selectedSegment]);

  // Aggregate by Reason
  const reasonStats = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLogs.forEach((l) => {
      const r = l.reasonTitle || "Outros";
      counts[r] = (counts[r] || 0) + 1;
    });
    const total = filteredLogs.length || 1;
    return Object.entries(counts)
      .map(([reason, count]) => ({
        reason,
        count,
        percent: ((count / total) * 100).toFixed(1),
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredLogs]);

  // Aggregate by Pedagoga
  const pedagogaStats = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLogs.forEach((l) => {
      const p = l.sentByName || "Equipe";
      counts[p] = (counts[p] || 0) + 1;
    });
    const total = filteredLogs.length || 1;
    return Object.entries(counts)
      .map(([pedagoga, count]) => ({
        pedagoga,
        count,
        percent: ((count / total) * 100).toFixed(1),
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredLogs]);

  // Aggregate by Return Status
  const returnStats = useMemo(() => {
    let replied = 0;
    filteredLogs.forEach((l) => {
      if (l.guardianReplied) replied++;
    });
    const total = filteredLogs.length || 1;
    const pending = total - replied;
    return {
      replied,
      pending,
      repliedPercent: ((replied / total) * 100).toFixed(1),
      pendingPercent: ((pending / total) * 100).toFixed(1),
    };
  }, [filteredLogs]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Title & Print button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <BarChart3 className="w-6 h-6 text-purple-600" />
            <span>Relatórios Gerenciais de Ocorrências & Comunicação</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Indicadores consolidados para equipe pedagógica, direção e órgãos de proteção.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Segment switch */}
          <div className="flex p-1 bg-slate-200 rounded-lg text-xs font-bold">
            {["TODOS", "FUNDAMENTAL", "MEDIO", "NOTURNO"].map((seg) => (
              <button
                key={seg}
                type="button"
                onClick={() => setSelectedSegment(seg)}
                className={`px-3 py-1.5 rounded-md transition ${
                  selectedSegment === seg
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {seg === "MEDIO" ? "MÉDIO" : seg}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 shadow-2xs transition print:hidden"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Imprimir Relatório</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Total de Ocorrências Registradas
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2">
            {filteredLogs.length.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Filtro atual: <strong>{selectedSegment}</strong>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Retornos dos Pais
          </div>
          <div className="text-3xl font-extrabold text-emerald-600 mt-2">
            {returnStats.repliedPercent}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {returnStats.replied} confirmados • {returnStats.pending} pendentes
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Motivo Mais Recorrente
          </div>
          <div className="text-xl font-extrabold text-sky-700 mt-2 truncate">
            {reasonStats[0]?.reason || "Nenhum"}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {reasonStats[0]?.count || 0} ocorrências ({reasonStats[0]?.percent}%)
          </div>
        </div>
      </div>

      {/* Grid: Reason stats (Left) + Pedagoga & Reply stats (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reasons Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            1. Total de Ocorrências por Motivo de Contato
          </h2>
          <div className="space-y-3">
            {reasonStats.map((item) => (
              <div key={item.reason} className="space-y-1">
                <div className="flex justify-between text-xs font-medium text-slate-700">
                  <span className="truncate pr-2 font-semibold">{item.reason}</span>
                  <span className="whitespace-nowrap font-mono text-slate-500">
                    <strong>{item.count}</strong> ({item.percent}%)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-600 rounded-full"
                    style={{ width: `${item.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pedagogas & Return Rates */}
        <div className="space-y-6">
          {/* Pedagogas */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              2. Ocorrências por Pedagoga Responsável
            </h2>
            <div className="space-y-3">
              {pedagogaStats.map((item) => (
                <div key={item.pedagoga} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-slate-700">
                    <span className="font-semibold">{item.pedagoga}</span>
                    <span className="whitespace-nowrap font-mono text-slate-500">
                      <strong>{item.count}</strong> ({item.percent}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Return Status Distribution */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              3. Índice de Retorno dos Responsáveis
            </h2>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="text-2xl font-bold text-emerald-700">{returnStats.replied}</div>
                <div className="text-xs font-semibold text-emerald-800 mt-1">Responsável Retornou</div>
                <div className="text-[11px] text-emerald-600 mt-0.5">{returnStats.repliedPercent}% do total</div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-2xl font-bold text-slate-600">{returnStats.pending}</div>
                <div className="text-xs font-semibold text-slate-700 mt-1">Retorno Pendente</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{returnStats.pendingPercent}% do total</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
