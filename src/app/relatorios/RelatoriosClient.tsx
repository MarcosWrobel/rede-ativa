"use client";

import { useState, useEffect, useRef } from "react";
import {
  BarChart3,
  Printer,
  Calendar,
  Loader2,
} from "lucide-react";
import type { ReportsSummary } from "@/lib/reportsAggregator";

type PeriodPreset = "TODOS" | "30D" | "TRIM1" | "TRIM2" | "TRIM3" | "CUSTOM";

interface Props {
  initialSummary: ReportsSummary;
}

function computePresetDates(preset: PeriodPreset): { from: string; to: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();

  switch (preset) {
    case "30D": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      const from = start.toISOString().slice(0, 10);
      const to = now.toISOString().slice(0, 10);
      return { from, to, label: "Últimos 30 dias" };
    }
    case "TRIM1":
      return { from: `${year}-02-01`, to: `${year}-05-15`, label: `1º Trimestre/${year}` };
    case "TRIM2":
      return { from: `${year}-05-16`, to: `${year}-08-31`, label: `2º Trimestre/${year}` };
    case "TRIM3":
      return { from: `${year}-09-01`, to: `${year}-12-20`, label: `3º Trimestre/${year}` };
    case "CUSTOM":
      return { from: "", to: "", label: "Período Personalizado" };
    case "TODOS":
    default:
      return { from: "", to: "", label: "Todo o Período" };
  }
}

export default function RelatoriosClient({ initialSummary }: Props) {
  const [summary, setSummary] = useState<ReportsSummary>(initialSummary);
  const [selectedSegment, setSelectedSegment] = useState("TODOS");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("TODOS");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const presetInfo = computePresetDates(periodPreset);
  const effectiveFrom = periodPreset === "CUSTOM" ? customFrom : presetInfo.from;
  const effectiveTo = periodPreset === "CUSTOM" ? customTo : presetInfo.to;

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const controller = new AbortController();
    const fetchSummary = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ segment: selectedSegment });
        if (effectiveFrom) params.set("dateFrom", effectiveFrom);
        if (effectiveTo) params.set("dateTo", effectiveTo);

        const res = await fetch(`/api/reports?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: ReportsSummary = await res.json();
        setSummary(data);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Erro ao consultar agregações de relatórios:", err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchSummary();
    return () => controller.abort();
  }, [selectedSegment, effectiveFrom, effectiveTo]);

  const handlePrint = () => {
    window.print();
  };

  const { reasonStats, pedagogaStats } = summary;

  return (
    <div className="space-y-6">
      {/* Title & Print button */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <BarChart3 className="w-6 h-6 text-purple-600" />
            <span>Relatórios Gerenciais de Ocorrências & Comunicação</span>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-purple-600 print:hidden" />}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Indicadores consolidados via banco de dados para equipe pedagógica, direção e órgãos de proteção.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 print:hidden">
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
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 shadow-2xs transition"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Imprimir Relatório</span>
          </button>
        </div>
      </div>

      {/* Period Filter Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center space-x-1.5 font-bold text-slate-700 mr-1">
            <Calendar className="w-4 h-4 text-purple-600" />
            <span>Recorte Temporal:</span>
          </span>
          {(
            [
              { id: "TODOS", label: "Todo o Período" },
              { id: "30D", label: "Últimos 30 dias" },
              { id: "TRIM1", label: "1º Trimestre" },
              { id: "TRIM2", label: "2º Trimestre" },
              { id: "TRIM3", label: "3º Trimestre" },
              { id: "CUSTOM", label: "Personalizado" },
            ] as Array<{ id: PeriodPreset; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPeriodPreset(item.id)}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                periodPreset === item.id
                  ? "bg-purple-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {periodPreset === "CUSTOM" && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center space-x-1 text-slate-600">
              <span>De</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1 bg-slate-50 focus:bg-white font-mono text-xs"
              />
            </label>
            <label className="inline-flex items-center space-x-1 text-slate-600">
              <span>Até</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1 bg-slate-50 focus:bg-white font-mono text-xs"
              />
            </label>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 transition-opacity ${isLoading ? "opacity-65" : "opacity-100"}`}>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Total de Ocorrências Registradas
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-2">
            {summary.total.toLocaleString("pt-BR")}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Nível: <strong>{selectedSegment}</strong> •{" "}
            <span>
              {periodPreset === "CUSTOM" && (effectiveFrom || effectiveTo)
                ? `${effectiveFrom || "..."} até ${effectiveTo || "..."}`
                : presetInfo.label}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Retornos dos Pais
          </div>
          <div className="text-3xl font-extrabold text-emerald-600 mt-2">
            {summary.repliedPercent}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {summary.replied} confirmados • {summary.pending} pendentes
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
            {reasonStats[0]?.count || 0} ocorrências ({reasonStats[0]?.percent || "0.0"}%)
          </div>
        </div>
      </div>

      {/* Grid: Reason stats (Left) + Pedagoga & Reply stats (Right) */}
      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 transition-opacity ${isLoading ? "opacity-65" : "opacity-100"}`}>
        {/* Reasons Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            1. Total de Ocorrências por Motivo de Contato
          </h2>
          {reasonStats.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-4">
              Nenhuma ocorrência registrada para os filtros selecionados.
            </p>
          ) : (
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
          )}
        </div>

        {/* Pedagogas & Return Rates */}
        <div className="space-y-6">
          {/* Pedagogas */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              2. Ocorrências por Pedagoga Responsável
            </h2>
            {pedagogaStats.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4">
                Nenhum envio registrado no período selecionado.
              </p>
            ) : (
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
            )}
          </div>

          {/* Return Status Distribution */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              3. Índice de Retorno dos Responsáveis
            </h2>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="text-2xl font-bold text-emerald-700">{summary.replied}</div>
                <div className="text-xs font-semibold text-emerald-800 mt-1">Responsável Retornou</div>
                <div className="text-[11px] text-emerald-600 mt-0.5">{summary.repliedPercent}% do total</div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-2xl font-bold text-slate-600">{summary.pending}</div>
                <div className="text-xs font-semibold text-slate-700 mt-1">Retorno Pendente</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{summary.pendingPercent}% do total</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
