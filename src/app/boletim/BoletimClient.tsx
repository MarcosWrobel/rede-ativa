"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileSpreadsheet,
  Printer,
  RefreshCw,
  AlertTriangle,
  Scale,
  MessageCircle,
  TrendingDown,
  UserCheck,
  Send,
  ExternalLink,
  Calendar,
  Sparkles,
  School,
  Building2,
  Clock,
  ArrowRight,
} from "lucide-react";
import type { WeeklyDigestData } from "@/lib/weeklyDigest";
import { buildWaMeUrl } from "@/lib/whatsappProvider";

interface Props {
  initialData: WeeklyDigestData;
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
}

export default function BoletimClient({ initialData, currentUser }: Props) {
  const [data, setData] = useState<WeeklyDigestData>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setErrorMsg(null);
      const res = await fetch("/api/cron/weekly-digest", { method: "POST" });
      if (!res.ok) {
        throw new Error(`Falha ao atualizar dados (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao recarregar diagnóstico");
    } finally {
      setRefreshing(false);
    }
  };

  const genDate = new Date(data.generatedAt);
  const dateFormatted = genDate.toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFormatted = genDate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16 print:bg-white print:p-0 print:pb-0">
      {/* Top Banner / Controls (Ocultos na Impressão) */}
      <div className="bg-white border-b border-slate-200 sticky top-14 z-20 print:hidden shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-indigo-700 flex items-center justify-center text-white shadow-sm">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                <span>Boletim Executivo de Busca Ativa</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                  Semanal
                </span>
              </h1>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Posição semanal consolidada • {data.school.name}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-sky-600" : ""}`} />
              <span>{refreshing ? "Atualizando..." : "Recalcular Diagnóstico"}</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-amber-400" />
              <span>Imprimir / Salvar PDF</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-rose-50 border-t border-rose-200 px-4 py-2 text-xs text-rose-700 font-medium text-center">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6 print:p-0 print:space-y-4">
        {/* Document Header (Impresso e em tela) */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs print:border-0 print:shadow-none print:p-0">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 print:border-slate-900 print:border-b-2 pb-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Governo do Estado do Paraná • SEED-PR • NRE {data.school.nre}
              </div>
              <h2 className="text-xl font-black text-slate-900">
                {data.school.name}
              </h2>
              <div className="text-xs text-slate-600 pt-0.5">
                INEP: <span className="font-mono font-bold">{data.school.inepCode}</span> • Município: {data.school.city} / PR
              </div>
            </div>

            <div className="text-left sm:text-right text-xs text-slate-500 space-y-0.5 border sm:border-0 border-slate-100 p-2.5 sm:p-0 rounded-lg bg-slate-50 sm:bg-transparent">
              <div className="font-bold text-slate-800 flex items-center sm:justify-end gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Posição: {dateFormatted} ({timeFormatted})</span>
              </div>
              <div className="text-[11px]">Gerado por: {currentUser.name}</div>
              <div className="text-[11px] text-sky-700 font-medium">Ciclo Semanal de Infrequência Escolar</div>
            </div>
          </div>

          {/* KPI Cards Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 pt-5">
            {/* Card 1: Críticos sem contato */}
            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/70 text-rose-900 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-700">Urgência Máxima</span>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              </div>
              <div className="py-2">
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-rose-800">
                  {data.kpis.criticalWithoutRecentContactCount}
                </div>
                <div className="text-xs font-medium text-rose-700">
                  Alunos &lt;75% sem busca há &gt;7 dias
                </div>
              </div>
              <div className="text-[11px] text-rose-600 pt-1 border-t border-rose-200/60">
                De um total de <strong>{data.kpis.criticalCount}</strong> infrequentes
              </div>
            </div>

            {/* Card 2: SERP / Conselho Tutelar */}
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 text-amber-900 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-700">Rede de Proteção</span>
                <Scale className="w-4 h-4 text-amber-600" />
              </div>
              <div className="py-2">
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-amber-800">
                  {data.kpis.serpActiveCount}
                </div>
                <div className="text-xs font-medium text-amber-700">
                  Casos SERP / Conselho Tutelar
                </div>
              </div>
              <div className="text-[11px] text-amber-600 pt-1 border-t border-amber-200/60">
                Em acompanhamento externo
              </div>
            </div>

            {/* Card 3: Taxa de Resposta */}
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-900 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-700">Engajamento (7 dias)</span>
                <MessageCircle className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="py-2">
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-emerald-800">
                  {data.kpis.replyRatePercent}%
                </div>
                <div className="text-xs font-medium text-emerald-700">
                  Taxa de retorno dos responsáveis
                </div>
              </div>
              <div className="text-[11px] text-emerald-600 pt-1 border-t border-emerald-200/60">
                <strong>{data.kpis.repliedLast7Days}</strong> de {data.kpis.sentLast7Days} contatos
              </div>
            </div>

            {/* Card 4: Quedas Abruptas */}
            <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/70 text-indigo-900 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-700">Oscilação Rápida</span>
                <TrendingDown className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="py-2">
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-indigo-800">
                  {data.kpis.abruptDropCount}
                </div>
                <div className="text-xs font-medium text-indigo-700">
                  Quedas abruptas &ge; 15%
                </div>
              </div>
              <div className="text-[11px] text-indigo-600 pt-1 border-t border-indigo-200/60">
                Detectadas no comparativo semanal
              </div>
            </div>
          </div>

          {/* Breakdown por Turno & Top Turmas */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-5 mt-5 border-t border-slate-100">
            {/* Turnos */}
            <div className="md:col-span-5 bg-slate-50 rounded-xl p-4 border border-slate-200">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                Distribuição de Infrequência por Turno
              </h3>
              <div className="space-y-2.5">
                {[
                  { label: "Manhã (Matutino)", key: "MANHA", color: "bg-sky-500" },
                  { label: "Tarde (Vespertino)", key: "TARDE", color: "bg-amber-500" },
                  { label: "Noite (Noturno)", key: "NOITE", color: "bg-indigo-600" },
                ].map((shift) => {
                  const count = data.shiftBreakdown[shift.key] || 0;
                  const pct =
                    data.kpis.criticalCount > 0
                      ? Math.round((count / data.kpis.criticalCount) * 100)
                      : 0;
                  return (
                    <div key={shift.key} className="space-y-1">
                      <div className="flex justify-between text-xs font-medium text-slate-700">
                        <span>{shift.label}</span>
                        <span className="font-bold">
                          {count} aluno(s) ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full ${shift.color} rounded-full transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Turmas em Alerta */}
            <div className="md:col-span-7 bg-slate-50 rounded-xl p-4 border border-slate-200">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                Turmas com Maior Concentração de Alunos Críticos
              </h3>
              {data.topRiskClasses.length === 0 ? (
                <div className="text-xs text-slate-500 italic py-3">
                  Nenhuma turma com alunos em nível crítico registrada nesta semana.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {data.topRiskClasses.map((item) => (
                    <div
                      key={item.className}
                      className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs"
                    >
                      <div className="font-bold text-slate-900 text-xs truncate">
                        {item.className}
                      </div>
                      <div className="text-[11px] text-slate-500">{item.shift}</div>
                      <div className="mt-1 text-xs font-extrabold text-rose-600">
                        {item.criticalCount} infrequente(s)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Fila de Ação Imediata (Tabela Executiva de Prioridades) */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs print:border-0 print:shadow-none print:p-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-600" />
                <span>Fila de Ação Pedagógica Recomendada</span>
              </h3>
              <p className="text-xs text-slate-500">
                Alunos com frequência &lt;75% que necessitam de intervenção ou renovação de contato imediato.
              </p>
            </div>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full w-fit">
              {data.actionQueue.length} alunos listados
            </span>
          </div>

          {data.actionQueue.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <UserCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
              <p className="font-bold text-slate-700">Tudo em dia!</p>
              <p>Nenhum aluno em infrequência crítica está sem contato nos últimos 7 dias.</p>
            </div>
          ) : (
            <div className="overflow-x-auto pt-3">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-3">Estudante / Turma</th>
                    <th className="py-2.5 px-3">Frequência</th>
                    <th className="py-2.5 px-3">Último Contato</th>
                    <th className="py-2.5 px-3">SERP</th>
                    <th className="py-2.5 px-3 text-right print:hidden">Ações Rápidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.actionQueue.map((st) => {
                    const waLink = buildWaMeUrl(
                      st.phone,
                      `Olá, responsáveis pelo(a) aluno(a) ${st.name}. Entramos em contato do ${data.school.name} a respeito da frequência escolar.`
                    );
                    return (
                      <tr key={st.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-3">
                          <Link
                            href={`/alunos/${st.id}`}
                            className="font-bold text-slate-900 hover:text-sky-600 transition"
                          >
                            {st.name}
                          </Link>
                          <div className="text-[11px] text-slate-500">
                            Turma: <strong>{st.className}</strong> ({st.shift})
                            {st.cgm && ` • CGM: ${st.cgm}`}
                          </div>
                        </td>

                        <td className="py-3 px-3 font-mono">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            {st.attendancePercent.toFixed(1)}%
                          </span>
                        </td>

                        <td className="py-3 px-3">
                          {st.daysWithoutContact === null ? (
                            <span className="inline-flex items-center text-rose-700 font-bold">
                              Sem contato registrado
                            </span>
                          ) : (
                            <span className="text-slate-700 font-medium">
                              Há <strong>{st.daysWithoutContact} dia(s)</strong>
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          {st.serpStatus ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              {st.serpStatus}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right print:hidden">
                          <div className="inline-flex items-center space-x-1.5">
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-xs transition"
                              title="Abrir WhatsApp direto para a família"
                            >
                              <Send className="w-3 h-3" />
                              <span className="hidden sm:inline">WhatsApp</span>
                            </a>
                            <Link
                              href={`/alunos/${st.id}`}
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-bold shadow-xs transition"
                              title="Ver Prontuário 360º e emitir Dossiê"
                            >
                              <span>Prontuário</span>
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Rodapé Institucional para Impressão */}
        <footer className="hidden print:block pt-8 text-[11px] text-slate-500 border-t border-slate-300">
          <div className="flex justify-between items-center">
            <span>{data.school.name} • Sistema de Busca Ativa & Comunicação Escolar</span>
            <span>Documento emitido para fins pedagógicos internos</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
